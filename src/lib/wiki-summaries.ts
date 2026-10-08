/**
 * Pre-baked Wikipedia excerpts.
 *
 * Wikipedia rate-limits a site as a whole, and in a live check six of
 * twenty summary requests came back 429 even though they were spaced out,
 * leaving the Seattle card empty. So the opening paragraphs of the articles
 * the site asks for most (the state, every county, every city and town, the
 * Seattle neighborhoods) are baked into public/data/wiki-summaries.json at
 * build time, per the data policy in CLAUDE.md, and the page only asks
 * Wikipedia for a title that file does not have.
 *
 * The file is an object keyed by the title the site requests ("Seattle",
 * "King County, Washington", "Washington (state)", "Lower Queen Anne,
 * Seattle"); each value is a WikiSummaryEntry. The text is Wikipedia prose
 * under CC BY-SA 4.0, so every fact built from it names Wikipedia, links the
 * article and is shown as a quoted excerpt, never rewritten.
 *
 * loadWikiSummaries fetches the file once per visit; a missing file, a
 * server error or unreadable JSON yields an empty map (with one console
 * warning) so the live path simply takes over. findWikiSummary looks a
 * title up, exactly first and then ignoring letter case; summaryFactFromEntry
 * turns an entry into the 'summary' Fact a ring shows.
 */

import type { Fact } from './types';
import { fetchJson } from './http';

/** One baked article opening, as stored in public/data/wiki-summaries.json. */
export interface WikiSummaryEntry {
  /** The article's real title, after any redirect ("Seattle, Washington" -> "Seattle"). */
  title: string;
  /** The opening paragraph as plain text, as Wikipedia gives it (CC BY-SA 4.0). */
  extract: string;
  /** The desktop article URL, for the attribution link. */
  url: string;
  thumbnail: { source: string; width: number; height: number } | null;
  /** Wikidata's short description, e.g. "City in Washington, United States". */
  description: string | null;
  /** When the extract was fetched from Wikipedia, as an ISO date-time. */
  fetchedAt: string;
}

/** Where the baked file lives, relative to the site's base URL. */
export const WIKI_SUMMARIES_FILE = 'data/wiki-summaries.json';

/** The licence of every extract in the file. */
export const WIKI_SUMMARIES_LICENSE = 'CC BY-SA 4.0';

/** The full URL of the baked file for this deployment (the site is served under /sno-ball/). */
export function wikiSummariesUrl(): string {
  const base = import.meta.env.BASE_URL;
  return (base.endsWith('/') ? base : `${base}/`) + WIKI_SUMMARIES_FILE;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** The one in-flight or finished load for this visit. */
let summariesPromise: Promise<Record<string, WikiSummaryEntry>> | undefined;

/**
 * The baked summaries, keyed by requested title. Fetched at most once per
 * visit; every later call shares the same promise. The promise never
 * rejects: when the file is missing (404), the server fails or the JSON is
 * not the expected shape, the result is an empty object and one warning
 * goes to the console, so the caller falls through to Wikipedia itself.
 */
export function loadWikiSummaries(): Promise<Record<string, WikiSummaryEntry>> {
  if (!summariesPromise) {
    summariesPromise = fetchJson<unknown>(wikiSummariesUrl())
      .then(parseWikiSummaries)
      .catch((err: unknown) => {
        console.warn('[wiki-summaries] the pre-baked summaries could not be loaded; asking Wikipedia instead:', err);
        return {};
      });
  }
  return summariesPromise;
}

/** Forget the loaded file so the next loadWikiSummaries fetches again. For tests. */
export function resetWikiSummaries(): void {
  summariesPromise = undefined;
}

/** A trimmed non-empty string, or undefined. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

/**
 * Turn the raw JSON of wiki-summaries.json into a map of entries. Values
 * that are not objects or lack a title, extract or URL are dropped (a bad
 * row must not break every other summary); a thumbnail or description that
 * is missing or malformed becomes null. Throws a TypeError when the JSON is
 * not an object at all, which loadWikiSummaries turns into an empty map.
 */
export function parseWikiSummaries(raw: unknown): Record<string, WikiSummaryEntry> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('wiki-summaries.json should be an object keyed by article title');
  }
  const out: Record<string, WikiSummaryEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = entryFromValue(value);
    if (entry) out[key] = entry;
  }
  return out;
}

/** One WikiSummaryEntry from one raw value, or undefined when it is unusable. */
function entryFromValue(value: unknown): WikiSummaryEntry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const title = str(v['title']);
  const extract = str(v['extract']);
  const url = str(v['url']);
  if (!title || !extract || !url) return undefined;

  const thumb = v['thumbnail'];
  const t = typeof thumb === 'object' && thumb !== null ? (thumb as Record<string, unknown>) : undefined;
  const source = t ? str(t['source']) : undefined;
  const thumbnail =
    t && source && typeof t['width'] === 'number' && typeof t['height'] === 'number'
      ? { source, width: t['width'], height: t['height'] }
      : null;

  return {
    title,
    extract,
    url,
    thumbnail,
    description: str(v['description']) ?? null,
    fetchedAt: str(v['fetchedAt']) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Looking a title up
// ---------------------------------------------------------------------------

/** A title in a form that ignores case, surrounding space, runs of space and the space/underscore difference. */
function looseKey(title: string): string {
  return title.replace(/[\s_]+/g, ' ').trim().toLowerCase();
}

/**
 * The entry for a requested title: an exact key match first ("Seattle"),
 * then one ignoring letter case and spacing ("seattle", "King_County,
 * Washington"). Undefined when the file has nothing for the title.
 */
export function findWikiSummary(summaries: Readonly<Record<string, WikiSummaryEntry>>, title: string): WikiSummaryEntry | undefined {
  const exact = summaries[title] ?? summaries[title.trim()];
  if (exact) return exact;
  const wanted = looseKey(title);
  if (!wanted) return undefined;
  for (const [key, entry] of Object.entries(summaries)) {
    if (looseKey(key) === wanted) return entry;
  }
  return undefined;
}

/**
 * The 'summary' Fact for a baked entry: the article title, its opening
 * paragraph as the body, and a Wikipedia source with the article URL and
 * the CC BY-SA 4.0 licence. (places.ts shortens the body to the usual
 * quotable excerpt before a ring shows it.)
 */
export function summaryFactFromEntry(entry: WikiSummaryEntry): Fact {
  return {
    kind: 'summary',
    title: entry.title,
    body: entry.extract,
    source: { name: 'Wikipedia', url: entry.url, license: WIKI_SUMMARIES_LICENSE },
    confidence: 'high',
  };
}
