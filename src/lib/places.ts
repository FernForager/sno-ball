/**
 * Written history: what Wikipedia and Wikidata say about the places a spot
 * belongs to (its city, county, state and, in Seattle, its neighborhood).
 *
 * Three free, browser-friendly services are used:
 *
 *  - Wikipedia REST summary   en.wikipedia.org/api/rest_v1/page/summary/<title>
 *    The opening paragraph of an article as plain text. We keep the first
 *    sentence or two as a QUOTED excerpt with a link to the article. The
 *    text is CC BY-SA 4.0, so it is shown as a quotation with attribution
 *    and never rewritten in our own words.
 *  - Wikipedia action API     en.wikipedia.org/w/api.php?action=query&prop=pageprops
 *    Tells us the Wikidata id behind an article title (Seattle -> Q5083).
 *  - Wikidata SPARQL          query.wikidata.org/sparql
 *    Population statements that carry a "point in time", so a city or county
 *    can show how it grew, decade by decade.
 *
 * Every network call goes through the shared fetchJson / limiterFor / cached
 * trio (http.ts, queue.ts, cache.ts), so a returning visitor never asks the
 * same question twice. The helpers that do not touch the network (excerpt,
 * summaryFact, populationFacts, thinToDecades, wikipediaTitleFor, ...) are
 * exported so they can be tested with fixture JSON.
 */

import type { Fact, Place, Ring, RingLevel, Source } from './types';
import { fromWikidataTime } from './time';
import { HttpError, fetchJson } from './http';
import { limiterFor } from './queue';
import { cached } from './cache';
import { cityName, ringName } from './rings';

// ---------------------------------------------------------------------------
// Endpoints, licences and limits
// ---------------------------------------------------------------------------

export const WIKIPEDIA_HOST = 'en.wikipedia.org';
export const WIKIDATA_HOST = 'query.wikidata.org';
export const WIKIPEDIA_REST_BASE = `https://${WIKIPEDIA_HOST}/api/rest_v1`;
export const WIKIPEDIA_ACTION_API = `https://${WIKIPEDIA_HOST}/w/api.php`;
export const WIKIDATA_SPARQL = `https://${WIKIDATA_HOST}/sparql`;

export const WIKIPEDIA_LICENSE = 'CC BY-SA 4.0';
export const WIKIDATA_LICENSE = 'CC0';

/** Article summaries change slowly; a week is plenty. */
export const SUMMARY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Wikidata ids never change and populations change once a year at most. */
export const WIKIDATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The longest excerpt we quote from an article, in characters. */
export const EXCERPT_MAX_CHARS = 320;
/** How many sentences an excerpt may run to. */
export const EXCERPT_SENTENCES = 2;
/** The most population facts one place gets. */
export const MAX_POPULATION_FACTS = 8;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A trimmed string with runs of whitespace collapsed, or undefined when blank or not a string. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.replace(/\s+/g, ' ').trim();
  return t ? t : undefined;
}

/** "Q5083" when the value is a well-formed Wikidata id, else undefined. */
function qidOrUndefined(value: unknown): string | undefined {
  const t = text(value);
  return t && /^Q\d+$/.test(t) ? t : undefined;
}

/**
 * An article title in the form Wikipedia URLs use: trimmed, with spaces as
 * underscores ("King County, Washington" -> "King_County,_Washington"). Used
 * both in request URLs and as the cache key, so the two spellings share one
 * cache entry.
 */
export function normaliseTitle(title: string): string {
  return title.trim().replace(/\s+/g, '_');
}

/** The Source every Wikidata-derived fact carries: the item's own page, CC0. */
export function wikidataSource(qid: string): Source {
  return { name: 'Wikidata', url: `https://www.wikidata.org/wiki/${qid}`, license: WIKIDATA_LICENSE };
}

// ---------------------------------------------------------------------------
// Which article to read for a ring
// ---------------------------------------------------------------------------

/**
 * The English Wikipedia article title to look up for one ring, or undefined
 * when there is no sensible article (the house, block, street, region and
 * plate rings; a neighborhood outside Seattle; a ring the geocoder could not
 * name). The rules:
 *   city          "<City>, Washington"      (Wikipedia redirects "Seattle, Washington" to "Seattle")
 *   county        "<Name> County, Washington"  (accepts "King" or "King County")
 *   state         "Washington (state)"
 *   neighborhood  "<Neighborhood>, Seattle", Seattle only
 * A ring that already carries a `wikipedia` title (for example from the
 * geocoder's tags, possibly prefixed "en:") is used as is.
 */
export function wikipediaTitleFor(level: RingLevel, ring: Ring, place: Place): string | undefined {
  const known = text(ring.wikipedia)?.replace(/^en:/, '');
  if (known) return known;

  if (level === 'state') return 'Washington (state)';

  // When the address has no part for this level, the ring's name is only a
  // placeholder such as "This county", which would make a nonsense title.
  if (ringName(level, place) === undefined) return undefined;
  const name = text(ring.name);
  if (!name) return undefined;

  switch (level) {
    case 'city':
      return `${name}, Washington`;
    case 'county':
      return `${name.replace(/\s+county$/i, '')} County, Washington`;
    case 'neighborhood':
      return cityName(place.address)?.toLowerCase() === 'seattle' ? `${name}, Seattle` : undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Wikipedia article summaries
// ---------------------------------------------------------------------------

/** The parts of a REST summary response we read. Everything is optional: the API evolves. */
export interface WikipediaSummaryResponse {
  /** 'standard' for an ordinary article, 'disambiguation' for a list of meanings. */
  type?: string;
  title?: string;
  description?: string;
  /** The opening paragraph as plain text. */
  extract?: string;
  wikibase_item?: string;
  thumbnail?: { source?: string; width?: number; height?: number };
  content_urls?: { desktop?: { page?: string }; mobile?: { page?: string } };
}

/** A Wikipedia article's opening, normalised for the site. */
export interface WikipediaPage {
  /** The article's real title, after any redirect ("Seattle, Washington" -> "Seattle"). */
  title: string;
  /** The desktop article URL, for attribution links. */
  url: string;
  /** The full opening paragraph, as Wikipedia gives it (CC BY-SA 4.0). */
  extract: string;
  /** Wikidata's short description, e.g. "City in Washington, United States". */
  description?: string;
  /** The Wikidata id, when the summary carries one. Saves a wikidataIdForTitle call. */
  wikidata?: string;
  thumbnail?: { url: string; width: number; height: number };
}

/** The REST summary URL for a title. */
export function wikipediaSummaryUrl(title: string): string {
  return `${WIKIPEDIA_REST_BASE}/page/summary/${encodeURIComponent(normaliseTitle(title))}`;
}

/**
 * Words that end with a period without ending a sentence. Kept short and
 * common; a missed boundary only means the excerpt runs one sentence longer
 * (and the 320-character cap still applies).
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'ft', 'inc', 'ltd', 'vs', 'approx',
  'e.g', 'i.e', 'u.s', 'd.c', 'a.m', 'p.m', 'b.c', 'a.d',
]);

/** True for a word that, followed by a period, is an abbreviation or an initial rather than a sentence end. */
function isAbbreviation(word: string): boolean {
  const w = word.replace(/^["'“‘(\[]+/, '').toLowerCase();
  if (!w) return false;
  if (/^[a-z]$/.test(w)) return true; // an initial: "John A. Smith"
  if (/^[a-z](\.[a-z])+$/.test(w)) return true; // "U.S", "D.C" (the final period is the match)
  return ABBREVIATIONS.has(w);
}

/**
 * The index just past each sentence end in `s`, in order. A sentence ends at
 * a period, question mark or exclamation mark (with any closing quote or
 * bracket) that is followed by whitespace and a capital letter or digit, or
 * that closes the text. Periods inside abbreviations ("U.S. state",
 * "Mt. Rainier") and after initials are skipped.
 */
export function sentenceEnds(s: string): number[] {
  const ends: number[] = [];
  const re = /[.!?]+["'”’)\]]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const end = m.index + m[0].length;
    if (end === s.length) {
      ends.push(end);
      break;
    }
    if (!/^\s+["'“‘(\[]?[A-Z0-9]/.test(s.slice(end))) continue;
    const before = /(\S+)$/.exec(s.slice(0, m.index))?.[1] ?? '';
    if (isAbbreviation(before)) continue;
    ends.push(end);
  }
  return ends;
}

/** Cut at the last word that fits within `maxChars` once an ellipsis is added. */
function cutAtWord(s: string, maxChars: number): string {
  const ellipsis = '…';
  const room = Math.max(1, maxChars - ellipsis.length);
  const head = s.slice(0, room + 1);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : s.slice(0, room);
  return cut.replace(/[\s,;:(-]+$/, '') + ellipsis;
}

/**
 * The opening of a Wikipedia extract as a quotable excerpt: the first two
 * sentences, or only the first when two together would pass 320 characters.
 * The cut lands on a sentence boundary, so the quote never stops
 * mid-thought; whitespace (including line breaks) is collapsed to single
 * spaces. In the rare case that even the first sentence is over the limit,
 * the text is cut at the last whole word that fits and an ellipsis is added.
 */
export function excerpt(extract: string, maxChars = EXCERPT_MAX_CHARS, sentences = EXCERPT_SENTENCES): string {
  const clean = extract.replace(/\s+/g, ' ').trim();
  const ends = sentenceEnds(clean);
  // Try the longest allowed run of sentences first, then shorter ones.
  for (let n = Math.min(sentences, ends.length); n >= 1; n--) {
    const end = ends[n - 1];
    if (end === undefined) continue;
    const candidate = clean.slice(0, end).trim();
    if (candidate.length <= maxChars) return candidate;
  }
  if (clean.length <= maxChars) return clean;
  return cutAtWord(clean, maxChars);
}

/**
 * Turn a raw REST summary into a WikipediaPage, or null when it is not a
 * usable article: a disambiguation page ("Washington may refer to..."), or a
 * response missing its title, URL or extract.
 */
export function pageFromSummary(raw: WikipediaSummaryResponse): WikipediaPage | null {
  if (raw.type === 'disambiguation') return null;
  const title = text(raw.title);
  const url = text(raw.content_urls?.desktop?.page);
  const extract = text(raw.extract);
  if (!title || !url || !extract) return null;

  const description = text(raw.description);
  const wikidata = qidOrUndefined(raw.wikibase_item);
  const thumb = raw.thumbnail;
  const thumbnail =
    thumb && typeof thumb.source === 'string' && typeof thumb.width === 'number' && typeof thumb.height === 'number'
      ? { url: thumb.source, width: thumb.width, height: thumb.height }
      : undefined;

  return {
    title,
    url,
    extract,
    ...(description ? { description } : {}),
    ...(wikidata ? { wikidata } : {}),
    ...(thumbnail ? { thumbnail } : {}),
  };
}

/**
 * The 'summary' fact for an article: the title, a quoted excerpt of the
 * opening (see excerpt) and a Wikipedia source with the article URL and the
 * CC BY-SA 4.0 licence. Pure, so the page can rebuild facts from a cached
 * WikipediaPage without another request.
 */
export function summaryFact(page: WikipediaPage): Fact {
  return {
    kind: 'summary',
    title: page.title,
    body: excerpt(page.extract),
    source: { name: 'Wikipedia', url: page.url, license: WIKIPEDIA_LICENSE },
    confidence: 'high',
  };
}

/**
 * Fetch and normalise the Wikipedia summary for a title, following
 * redirects ("Seattle, Washington" resolves to the "Seattle" article).
 * Resolves to null when there is no such article (HTTP 404) or when the
 * title is a disambiguation page; both answers are cached for a week along
 * with real hits. Any other failure (network, 5xx, 429 after the retry) is
 * thrown so the caller can show the ring as thin rather than wrong.
 */
export async function wikipediaPage(title: string): Promise<WikipediaPage | null> {
  const key = normaliseTitle(title);
  if (!key) return null;
  return cached<WikipediaPage | null>(`wikipedia:summary:${key}`, { ttlMs: SUMMARY_TTL_MS }, async () => {
    const url = wikipediaSummaryUrl(key);
    try {
      // Wikimedia extends its cool-down when a 429 is retried, so never retry one.
      const raw = await limiterFor(WIKIPEDIA_HOST).run(() => fetchJson<WikipediaSummaryResponse>(url, { retryOn429: false }));
      return pageFromSummary(raw);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  });
}

/**
 * The 'summary' Fact for a Wikipedia article title, or null when there is
 * no usable article (missing page, disambiguation page). The body is the
 * first sentence or two of the article's opening paragraph, at most 320
 * characters, ending on a sentence boundary; the source is the article URL
 * under CC BY-SA 4.0. Results are cached for 7 days.
 */
export async function wikipediaSummary(title: string): Promise<Fact | null> {
  const page = await wikipediaPage(title);
  return page ? summaryFact(page) : null;
}

// ---------------------------------------------------------------------------
// Wikidata id for an article
// ---------------------------------------------------------------------------

/** One page entry in an action=query response. */
export interface PagepropsPage {
  pageid?: number;
  ns?: number;
  title?: string;
  /** Present (as "" or true) when the page does not exist. */
  missing?: string | boolean;
  pageprops?: { wikibase_item?: string };
}

/** The parts of an action=query&prop=pageprops response we read. */
export interface PagepropsResponse {
  query?: {
    /** Keyed by page id in the default format; an array with formatversion=2. */
    pages?: Record<string, PagepropsPage> | PagepropsPage[];
  };
}

/** The action API URL that returns the Wikidata id for a title, following redirects. */
export function pagepropsUrl(title: string): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    titles: normaliseTitle(title),
    format: 'json',
    origin: '*',
    redirects: '1',
  });
  return `${WIKIPEDIA_ACTION_API}?${params.toString()}`;
}

/** The first well-formed Wikidata id in a pageprops response, or undefined (missing page, no item). */
export function qidFromPageprops(res: PagepropsResponse): string | undefined {
  const pages = res.query?.pages;
  const list: PagepropsPage[] = Array.isArray(pages) ? pages : pages ? Object.values(pages) : [];
  for (const page of list) {
    const qid = qidOrUndefined(page.pageprops?.wikibase_item);
    if (qid) return qid;
  }
  return undefined;
}

/**
 * The Wikidata id (e.g. "Q5083") for an English Wikipedia article title,
 * following redirects, or undefined when the page does not exist or has no
 * Wikidata item. Cached for 30 days. Tip: a WikipediaPage from
 * wikipediaPage() usually already carries the id in its `wikidata` field,
 * which saves this request.
 */
export async function wikidataIdForTitle(title: string): Promise<string | undefined> {
  const key = normaliseTitle(title);
  if (!key) return undefined;
  // null (not undefined) is stored for "no item", so the miss is cached too.
  const qid = await cached<string | null>(`wikipedia:qid:${key}`, { ttlMs: WIKIDATA_TTL_MS }, async () => {
    const url = pagepropsUrl(key);
    const res = await limiterFor(WIKIPEDIA_HOST).run(() => fetchJson<PagepropsResponse>(url, { retryOn429: false }));
    return qidFromPageprops(res) ?? null;
  });
  return qid ?? undefined;
}

// ---------------------------------------------------------------------------
// Population history from Wikidata
// ---------------------------------------------------------------------------

/** One cell of a SPARQL JSON result. */
export interface SparqlValue {
  type: string;
  value: string;
  datatype?: string;
}

/** One row of a SPARQL JSON result: variable name -> cell. */
export type SparqlBinding = Record<string, SparqlValue | undefined>;

/** The shape of a SPARQL JSON result (https://www.w3.org/TR/sparql11-results-json/). */
export interface SparqlResponse {
  head?: { vars?: string[] };
  results?: { bindings?: SparqlBinding[] };
}

/** A population count at a calendar year. */
export interface PopulationReading {
  year: number;
  population: number;
}

/**
 * The id trimmed and checked against the Wikidata form "Q" + digits. Throws
 * a RangeError otherwise, so a malformed id never reaches a SPARQL query.
 */
export function assertQid(qid: string): string {
  const id = qidOrUndefined(qid);
  if (!id) throw new RangeError(`not a Wikidata id: ${JSON.stringify(qid)}`);
  return id;
}

/** The SPARQL text that lists every dated population statement of an item, oldest first. */
export function populationQuery(qid: string): string {
  return `SELECT ?pop ?time WHERE { wd:${qid} p:P1082 ?s . ?s ps:P1082 ?pop . ?s pq:P585 ?time } ORDER BY ?time`;
}

/** The query service URL for a SPARQL query, asking for JSON. */
export function sparqlUrl(query: string): string {
  return `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
}

/**
 * The calendar year of a SPARQL dateTime such as "2010-04-01T00:00:00Z".
 * Wikidata's own signed form ("+2010-04-01T00:00:00Z", "-0500-...") is
 * accepted too; both go through time.ts so BCE years follow its rules.
 */
export function sparqlYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const signed = /^[+-]/.test(value) ? value : `+${value}`;
  return fromWikidataTime(signed) ?? undefined;
}

/**
 * The usable readings in a population query result, oldest first. Rows with
 * a non-numeric count or an unreadable date are skipped; counts are rounded
 * to whole people.
 */
export function populationReadings(res: SparqlResponse): PopulationReading[] {
  const out: PopulationReading[] = [];
  for (const row of res.results?.bindings ?? []) {
    const population = Number(row['pop']?.value);
    const year = sparqlYear(row['time']?.value);
    if (!Number.isFinite(population) || population < 0 || year === undefined) continue;
    out.push({ year, population: Math.round(population) });
  }
  return out.sort((a, b) => a.year - b.year);
}

/**
 * At most one reading per decade, and at most `max` readings in all. Within
 * a decade a reading taken in the census year (1900, 1910, ...) wins;
 * otherwise the latest reading in that decade does, so the newest estimate
 * is never hidden by an older one. When more decades remain than `max`,
 * they are sampled evenly across the span, always keeping the oldest and
 * the newest.
 */
export function thinToDecades(readings: readonly PopulationReading[], max = MAX_POPULATION_FACTS): PopulationReading[] {
  const sorted = [...readings].sort((a, b) => a.year - b.year);
  const byDecade = new Map<number, PopulationReading>();
  for (const r of sorted) {
    const decade = Math.floor(r.year / 10) * 10;
    const kept = byDecade.get(decade);
    if (!kept || kept.year % 10 !== 0) byDecade.set(decade, r);
  }
  const perDecade = [...byDecade.values()];
  if (perDecade.length <= max) return perDecade;
  if (max <= 1) return perDecade.slice(-1);

  const picked: PopulationReading[] = [];
  const last = perDecade.length - 1;
  for (let i = 0; i < max; i++) {
    const r = perDecade[Math.round((i * last) / (max - 1))];
    if (r && picked[picked.length - 1] !== r) picked.push(r);
  }
  return picked;
}

/**
 * 'population' facts ("Population 237,194 in 1910") for an item's readings,
 * thinned to one per decade and at most `max` in all, each carrying the
 * item's Wikidata page as its CC0 source. Pure, so it can be rebuilt from
 * cached readings.
 */
export function populationFacts(qid: string, readings: readonly PopulationReading[], max = MAX_POPULATION_FACTS): Fact[] {
  const source = wikidataSource(qid);
  return thinToDecades(readings, max).map((r) => ({
    kind: 'population',
    title: `Population ${r.population.toLocaleString('en-US')} in ${r.year}`,
    year: r.year,
    source,
    confidence: 'high',
  }));
}

/**
 * The population history of a Wikidata item (a city, county or
 * neighborhood) as up to 8 'population' facts, one per decade, oldest
 * first, from the Wikidata Query Service. Resolves to an empty list when
 * Wikidata records no dated population for the item. The raw readings are
 * cached for 30 days. Throws a RangeError for an id that is not "Q" + digits.
 */
export async function populationHistory(qid: string): Promise<Fact[]> {
  const id = assertQid(qid);
  const readings = await cached<PopulationReading[]>(`wikidata:population:${id}`, { ttlMs: WIKIDATA_TTL_MS }, async () => {
    const url = sparqlUrl(populationQuery(id));
    const res = await limiterFor(WIKIDATA_HOST).run(() => fetchJson<SparqlResponse>(url, { retryOn429: false }));
    return populationReadings(res);
  });
  return populationFacts(id, readings);
}
