/**
 * The 39 counties of Washington.
 *
 * Counties change so rarely that the site does not ask Wikidata about them
 * at run time. Instead, public/data/wa-counties.json holds one record per
 * county (id, name, creation date, seat, area, latest population, centre
 * point, Wikipedia title, FIPS code, who or what it is named after), built
 * from the Wikidata Query Service; see public/data/README.md for the exact
 * queries and when it was last refreshed.
 *
 * loadCounties fetches that file once per visit (it is part of the site, so
 * no rate limit or long-lived cache is needed); countyByName finds a county
 * from the name a geocoder gives ("King" or "King County"); countyFacts
 * turns a record into the facts the county ring shows.
 */

import type { Fact, Place, Source } from './types';
import { fetchJson } from './http';
import { normaliseCountyName } from '../data/wa-regions';

/** One county as stored in public/data/wa-counties.json. Optional fields are absent when Wikidata has no value. */
export interface County {
  /** Wikidata id, e.g. "Q108861" for King County. */
  qid: string;
  /** Display name including the word County, e.g. "King County". */
  name: string;
  /** Creation date as YYYY-MM-DD. A -01-01 date usually means only the year is recorded. */
  inception?: string;
  /** The county seat, e.g. "Seattle". */
  seat?: string;
  areaKm2?: number;
  /** The most recent population statement and the year it refers to. */
  population?: number;
  populationYear?: number;
  /** Centre point in WGS 84 decimal degrees. */
  lat?: number;
  lon?: number;
  /** English Wikipedia article title, e.g. "King County, Washington". */
  wikipedia?: string;
  /** Five-digit county FIPS code, e.g. "53033". */
  fips?: string;
  /** Labels of the people or things the county is named after. */
  namedAfter?: string[];
}

/** Where the county file lives, relative to the site's base URL. */
export const COUNTIES_FILE = 'data/wa-counties.json';

/** The data in wa-counties.json comes from Wikidata, which is CC0. */
export const COUNTIES_LICENSE = 'CC0';

/** The full URL of the county file for this deployment (the site is served under /sno-ball/). */
export function countiesUrl(): string {
  const base = import.meta.env.BASE_URL;
  return (base.endsWith('/') ? base : `${base}/`) + COUNTIES_FILE;
}

/** The Source for facts drawn from one county record: its Wikidata page, CC0. */
export function countySource(county: County): Source {
  return { name: 'Wikidata', url: `https://www.wikidata.org/wiki/${county.qid}`, license: COUNTIES_LICENSE };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** The one in-flight or finished load for this visit. */
let countiesPromise: Promise<County[]> | undefined;

/**
 * All 39 counties, sorted by name, from public/data/wa-counties.json. The
 * file is fetched at most once per visit; every later call shares the same
 * promise. If the fetch fails the error is thrown and the next call tries
 * again. (Browser caching of the file itself is left to the HTTP cache.)
 */
export function loadCounties(): Promise<County[]> {
  if (!countiesPromise) {
    countiesPromise = fetchJson<unknown>(countiesUrl())
      .then(parseCounties)
      .catch((err: unknown) => {
        countiesPromise = undefined;
        throw err;
      });
  }
  return countiesPromise;
}

/** Forget the loaded counties so the next loadCounties fetches again. For tests. */
export function resetCounties(): void {
  countiesPromise = undefined;
}

/**
 * Turn the raw JSON of wa-counties.json into County records, sorted by name.
 * Rows that are not objects or lack a qid or name are skipped with a
 * console warning; null fields (Wikidata had no value) are dropped rather
 * than copied, so every optional field is either a real value or absent.
 * Throws a TypeError when the JSON is not an array at all.
 */
export function parseCounties(raw: unknown): County[] {
  if (!Array.isArray(raw)) throw new TypeError('wa-counties.json should be an array of county records');
  const counties: County[] = [];
  for (const row of raw) {
    const county = countyFromRow(row);
    if (county) counties.push(county);
    else console.warn('[counties] skipped a row without a qid and name', row);
  }
  return counties.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** A trimmed non-empty string, or undefined. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

/** A finite number, or undefined. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The county's display name. Wikidata's label service occasionally hands
 * back the item id instead of the English label (Pend Oreille County came
 * through as "Q485301" once); the Wikipedia title "<Name> County,
 * Washington" is then a reliable stand-in.
 */
function nameFromRow(label: string | undefined, wikipedia: string | undefined): string | undefined {
  if (label && !/^Q\d+$/.test(label)) return label;
  const fromTitle = wikipedia?.replace(/,\s*Washington$/i, '').trim();
  return fromTitle || label;
}

/** One County from one raw row, or undefined when the row is unusable. */
function countyFromRow(row: unknown): County | undefined {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return undefined;
  const r = row as Record<string, unknown>;
  const qid = str(r['qid']);
  const wikipedia = str(r['wikipedia']);
  const name = nameFromRow(str(r['name']), wikipedia);
  if (!qid || !name) return undefined;

  const inception = str(r['inception']);
  const seat = str(r['seat']);
  const areaKm2 = num(r['areaKm2']);
  const population = num(r['population']);
  const populationYear = num(r['populationYear']);
  const lat = num(r['lat']);
  const lon = num(r['lon']);
  const fips = str(r['fips']);
  const namedAfterRaw = r['namedAfter'];
  const namedAfter = Array.isArray(namedAfterRaw)
    ? namedAfterRaw.map(str).filter((s): s is string => s !== undefined)
    : [];

  return {
    qid,
    name,
    ...(inception ? { inception } : {}),
    ...(seat ? { seat } : {}),
    ...(areaKm2 !== undefined ? { areaKm2 } : {}),
    ...(population !== undefined ? { population } : {}),
    ...(populationYear !== undefined ? { populationYear } : {}),
    ...(lat !== undefined ? { lat } : {}),
    ...(lon !== undefined ? { lon } : {}),
    ...(wikipedia ? { wikipedia } : {}),
    ...(fips ? { fips } : {}),
    ...(namedAfter.length > 0 ? { namedAfter } : {}),
  };
}

// ---------------------------------------------------------------------------
// Finding a county
// ---------------------------------------------------------------------------

/**
 * The county whose name matches, ignoring letter case, extra spaces and the
 * word "County": "King", "King County" and "king county" all find King
 * County. Undefined when nothing matches.
 */
export function countyByName(counties: readonly County[], name: string): County | undefined {
  const wanted = normaliseCountyName(name);
  if (!wanted) return undefined;
  return counties.find((c) => normaliseCountyName(c.name) === wanted);
}

/**
 * The county a geocoded place is in, from the county part of its address
 * ("King County" from Nominatim, "King" from Photon), or undefined when the
 * address has no county or it is not one of Washington's.
 */
export function countyForPlace(counties: readonly County[], place: Place): County | undefined {
  const name = place.address.county;
  return name ? countyByName(counties, name) : undefined;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** How a county's creation date reads, and how sure we are of the day. */
export interface InceptionText {
  /** "December 22, 1852", or "in 1883" when only the year is known. */
  text: string;
  year: number;
  /** True when the record carries a real month and day. */
  exact: boolean;
}

/**
 * Read a creation date from the file. "1852-12-22" gives "December 22,
 * 1852" (exact); "1883-01-01" gives "in 1883" (not exact), because Wikidata
 * stores a year-only date as January 1 and most Washington counties were
 * created in the autumn or winter session of the legislature, not on New
 * Year's Day. A bare year such as "1883" is accepted too. Undefined when the
 * value cannot be read.
 */
export function describeInception(value: string): InceptionText | undefined {
  const s = value.trim();
  const m = /^(-?\d{1,6})(?:-(\d{2})-(\d{2}))?/.exec(s);
  if (!m) return undefined;
  const year = Number(m[1]);
  if (!Number.isInteger(year) || year === 0) return undefined;

  const month = m[2] === undefined ? undefined : Number(m[2]);
  const day = m[3] === undefined ? undefined : Number(m[3]);
  const monthName = month === undefined ? undefined : MONTHS[month - 1];
  const yearOnly = month === undefined || day === undefined || !monthName || day < 1 || day > 31 || (month === 1 && day === 1);
  if (yearOnly) return { text: `in ${year}`, year, exact: false };
  return { text: `${monthName} ${day}, ${year}`, year, exact: true };
}

/** "John Adams" / "the Columbia River and Lewis" style list: items joined with commas and a final "and". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The facts the county ring shows for one record, in this order and only
 * when the data exists:
 *   'founded'      "Established December 22, 1852" (year 1852; confidence
 *                  'medium' when only the year is recorded: "Established in 1883")
 *   'seat'         "County seat: Seattle"
 *   'named-after'  "Named after John Adams"
 *   'population'   "Population 2,269,675 in 2020" (year 2020), the latest count
 * Every fact's source is the county's Wikidata page (CC0).
 */
export function countyFacts(county: County): Fact[] {
  const source = countySource(county);
  const facts: Fact[] = [];

  const when = county.inception ? describeInception(county.inception) : undefined;
  if (when) {
    facts.push({
      kind: 'founded',
      title: `Established ${when.text}`,
      year: when.year,
      source,
      confidence: when.exact ? 'high' : 'medium',
    });
  }

  if (county.seat) {
    facts.push({ kind: 'seat', title: `County seat: ${county.seat}`, source, confidence: 'high' });
  }

  if (county.namedAfter && county.namedAfter.length > 0) {
    facts.push({ kind: 'named-after', title: `Named after ${listNames(county.namedAfter)}`, source, confidence: 'high' });
  }

  if (county.population !== undefined) {
    const count = county.population.toLocaleString('en-US');
    const year = county.populationYear;
    facts.push({
      kind: 'population',
      title: year !== undefined ? `Population ${count} in ${year}` : `Population ${count}`,
      ...(year !== undefined ? { year } : {}),
      source,
      confidence: 'high',
    });
  }

  return facts;
}
