/**
 * The cities and towns of Washington.
 *
 * public/data/wa-places.json holds one record per city or town (Wikidata
 * id, name, county, creation date, latest population, centre point,
 * Wikipedia title), built from the Wikidata Query Service; see
 * public/data/README.md for the queries and when it was last refreshed.
 *
 * The page uses it to know a city's Wikidata id and article title without
 * asking Wikipedia first: in a live check the Seattle card lost its
 * population facts because the id was only ever learned from a Wikipedia
 * lookup, and that lookup was rate-limited. loadPlaces fetches the file once
 * per visit; placeByName finds a record from the city name a geocoder gives,
 * preferring the one in the same county when two towns share a name.
 */

import { fetchJson } from './http';
import { normaliseCountyName } from '../data/wa-regions';

/** One city or town as stored in public/data/wa-places.json. Optional fields are absent when Wikidata has no value. */
export interface PlaceRecord {
  /** Wikidata id, e.g. "Q5083" for Seattle. */
  qid: string;
  /** Display name, e.g. "Walla Walla". */
  name: string;
  /** The county it is in, including the word County, e.g. "King County". */
  county?: string;
  /** Creation date as YYYY-MM-DD. A -01-01 date usually means only the year is recorded. */
  inception?: string;
  population?: number;
  populationYear?: number;
  lat?: number;
  lon?: number;
  /** English Wikipedia article title, e.g. "Spokane, Washington" (or just "Seattle"). */
  wikipedia?: string;
}

/** Where the place file lives, relative to the site's base URL. */
export const PLACES_FILE = 'data/wa-places.json';

/** The full URL of the place file for this deployment (the site is served under /sno-ball/). */
export function placesUrl(): string {
  const base = import.meta.env.BASE_URL;
  return (base.endsWith('/') ? base : `${base}/`) + PLACES_FILE;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** The one in-flight or finished load for this visit. */
let placesPromise: Promise<PlaceRecord[]> | undefined;

/**
 * Every city and town, sorted by name, from public/data/wa-places.json. The
 * file is fetched at most once per visit; every later call shares the same
 * promise. If the fetch fails the error is thrown and the next call tries
 * again.
 */
export function loadPlaces(): Promise<PlaceRecord[]> {
  if (!placesPromise) {
    placesPromise = fetchJson<unknown>(placesUrl())
      .then(parsePlaces)
      .catch((err: unknown) => {
        placesPromise = undefined;
        throw err;
      });
  }
  return placesPromise;
}

/** Forget the loaded places so the next loadPlaces fetches again. For tests. */
export function resetPlaces(): void {
  placesPromise = undefined;
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
 * Turn the raw JSON of wa-places.json into PlaceRecords, sorted by name.
 * Rows that are not objects or lack a qid or name are skipped with a
 * console warning; null fields (Wikidata had no value) are dropped rather
 * than copied, so every optional field is either a real value or absent.
 * Throws a TypeError when the JSON is not an array at all.
 */
export function parsePlaces(raw: unknown): PlaceRecord[] {
  if (!Array.isArray(raw)) throw new TypeError('wa-places.json should be an array of place records');
  const places: PlaceRecord[] = [];
  for (const row of raw) {
    const place = placeFromRow(row);
    if (place) places.push(place);
    else console.warn('[places-data] skipped a row without a qid and name', row);
  }
  return places.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** One PlaceRecord from one raw row, or undefined when the row is unusable. */
function placeFromRow(row: unknown): PlaceRecord | undefined {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return undefined;
  const r = row as Record<string, unknown>;
  const qid = str(r['qid']);
  const name = str(r['name']);
  if (!qid || !name || !/^Q\d+$/.test(qid)) return undefined;

  const county = str(r['county']);
  const inception = str(r['inception']);
  const population = num(r['population']);
  const populationYear = num(r['populationYear']);
  const lat = num(r['lat']);
  const lon = num(r['lon']);
  const wikipedia = str(r['wikipedia']);

  return {
    qid,
    name,
    ...(county ? { county } : {}),
    ...(inception ? { inception } : {}),
    ...(population !== undefined ? { population } : {}),
    ...(populationYear !== undefined ? { populationYear } : {}),
    ...(lat !== undefined ? { lat } : {}),
    ...(lon !== undefined ? { lon } : {}),
    ...(wikipedia ? { wikipedia } : {}),
  };
}

// ---------------------------------------------------------------------------
// Finding a place
// ---------------------------------------------------------------------------

/** A name in a form that ignores letter case and runs of space. */
function looseName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The record for a city or town name, ignoring letter case and extra
 * spaces ("seattle", "Walla  Walla"). When several towns share a name, the
 * one in `county` wins ("King" or "King County" both work); with no county
 * given, or none of them in it, the first by name order is returned.
 * Undefined when nothing matches or the name is blank.
 */
export function placeByName(places: readonly PlaceRecord[], name: string, county?: string): PlaceRecord | undefined {
  const wanted = looseName(name);
  if (!wanted) return undefined;
  const matches = places.filter((p) => looseName(p.name) === wanted);
  if (matches.length === 0) return undefined;
  const wantedCounty = county ? normaliseCountyName(county) : '';
  if (wantedCounty) {
    const same = matches.find((p) => p.county !== undefined && normaliseCountyName(p.county) === wantedCounty);
    if (same) return same;
  }
  return matches[0];
}
