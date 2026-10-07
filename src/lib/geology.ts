/**
 * The rock under a spot, and how old it is.
 *
 * Primary source: the Washington Geological Survey's 1:100,000 surface
 * geology map, served by WA DNR as an ArcGIS map service. Finding the unit
 * at a point takes two requests, because the polygon layer carries only the
 * unit code and a short name, while the age and the long description live
 * in a separate "Description of Map Units" table:
 *
 *   1. layer 11 (polygons) at the point  ->  "Qgt", "Pleistocene continental
 *      glacial till", join key "Compiled | Qgt"
 *   2. table 13 by that join key         ->  age "Pleistocene", full name,
 *      description "Till and outwash deposits from continental glaciers..."
 *
 * Fallback: Macrostrat (macrostrat.org), a worldwide compilation of geologic
 * maps, used when DNR has no polygon at the point (open water, just over the
 * state line) or when the DNR service fails.
 *
 * The survey gives ages as words ("Pleistocene", "Eocene to Oligocene"), so
 * this module also carries a table of the geologic time scale and turns those
 * words into a range of years before 2000 CE, which the rest of the site
 * understands (see time.ts).
 */

import type { GeologyUnit, LngLat, Source } from './types';
import { maToAgo } from './time';
import { fetchJson } from './http';
import { limiterFor } from './queue';
import { cached } from './cache';

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const DNR_SOURCE: Readonly<Source> = {
  name: 'Washington Geological Survey (WA DNR), 1:100,000 surface geology',
  // The survey's GIS data page, where this map (and its documentation) is published.
  url: 'https://www.dnr.wa.gov/programs-and-services/geology/publications-and-data/gis-data-and-databases',
  license: 'Public record',
};

export const MACROSTRAT_SOURCE: Readonly<Source> = {
  name: 'Macrostrat',
  url: 'https://macrostrat.org',
  license: 'CC BY 4.0',
};

/** Geology does not change, so a month is a conservative cache life. */
export const GEOLOGY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The geologic time scale
// ---------------------------------------------------------------------------

export interface GeologicInterval {
  /** The name as the International Commission on Stratigraphy (ICS) spells it. */
  name: string;
  rank: 'epoch' | 'period' | 'subperiod' | 'era' | 'eon' | 'informal';
  /** When it began, in millions of years ago (the older bound). */
  startMa: number;
  /** When it ended, in millions of years ago (the younger bound; 0 = today). */
  endMa: number;
}

/**
 * Named slices of geologic time, youngest first, with boundaries in millions
 * of years ago from the ICS International Chronostratigraphic Chart. The
 * epochs and periods the spec asks for come first; a few larger spans
 * (Quaternary, Cenozoic, ...) and older informal names that still appear on
 * Washington maps (Tertiary, Precambrian) follow, so that any age text the
 * survey writes can be understood.
 */
export const GEOLOGIC_INTERVALS: readonly GeologicInterval[] = [
  // Epochs of the Cenozoic
  { name: 'Holocene', rank: 'epoch', startMa: 0.0117, endMa: 0 },
  { name: 'Pleistocene', rank: 'epoch', startMa: 2.58, endMa: 0.0117 },
  { name: 'Pliocene', rank: 'epoch', startMa: 5.333, endMa: 2.58 },
  { name: 'Miocene', rank: 'epoch', startMa: 23.03, endMa: 5.333 },
  { name: 'Oligocene', rank: 'epoch', startMa: 33.9, endMa: 23.03 },
  { name: 'Eocene', rank: 'epoch', startMa: 56, endMa: 33.9 },
  { name: 'Paleocene', rank: 'epoch', startMa: 66, endMa: 56 },
  // Periods
  { name: 'Quaternary', rank: 'period', startMa: 2.58, endMa: 0 },
  { name: 'Neogene', rank: 'period', startMa: 23.03, endMa: 2.58 },
  { name: 'Paleogene', rank: 'period', startMa: 66, endMa: 23.03 },
  { name: 'Cretaceous', rank: 'period', startMa: 145, endMa: 66 },
  { name: 'Jurassic', rank: 'period', startMa: 201.4, endMa: 145 },
  { name: 'Triassic', rank: 'period', startMa: 251.9, endMa: 201.4 },
  { name: 'Permian', rank: 'period', startMa: 298.9, endMa: 251.9 },
  { name: 'Carboniferous', rank: 'period', startMa: 358.9, endMa: 298.9 },
  { name: 'Pennsylvanian', rank: 'subperiod', startMa: 323.2, endMa: 298.9 },
  { name: 'Mississippian', rank: 'subperiod', startMa: 358.9, endMa: 323.2 },
  { name: 'Devonian', rank: 'period', startMa: 419.2, endMa: 358.9 },
  { name: 'Silurian', rank: 'period', startMa: 443.8, endMa: 419.2 },
  { name: 'Ordovician', rank: 'period', startMa: 485.4, endMa: 443.8 },
  { name: 'Cambrian', rank: 'period', startMa: 538.8, endMa: 485.4 },
  // Eras and eons
  { name: 'Cenozoic', rank: 'era', startMa: 66, endMa: 0 },
  { name: 'Mesozoic', rank: 'era', startMa: 251.9, endMa: 66 },
  { name: 'Paleozoic', rank: 'era', startMa: 538.8, endMa: 251.9 },
  { name: 'Phanerozoic', rank: 'eon', startMa: 538.8, endMa: 0 },
  { name: 'Proterozoic', rank: 'eon', startMa: 2500, endMa: 538.8 },
  { name: 'Archean', rank: 'eon', startMa: 4000, endMa: 2500 },
  { name: 'Hadean', rank: 'eon', startMa: 4600, endMa: 4000 },
  // Older names still common on maps
  { name: 'Tertiary', rank: 'informal', startMa: 66, endMa: 2.58 },
  { name: 'Precambrian', rank: 'informal', startMa: 4600, endMa: 538.8 },
];

/** Age of the Earth in Ma: the oldest bound anything can have. */
const EARTH_AGE_MA = 4600;

/** One regular expression that finds every interval name as a whole word. */
const INTERVAL_PATTERN = new RegExp(
  `(pre-?\\s*)?\\b(${GEOLOGIC_INTERVALS.map((i) => i.name).join('|')})\\b`,
  'gi',
);

/**
 * Every interval named in a piece of age text, in the order they appear.
 * "Miocene to Pliocene" gives [Miocene, Pliocene]; words that are not
 * interval names ("late", "lower", "(?)") are ignored. Case does not matter.
 */
export function intervalsIn(text: string): GeologicInterval[] {
  const found: GeologicInterval[] = [];
  for (const m of text.matchAll(INTERVAL_PATTERN)) {
    const name = m[2]?.toLowerCase();
    const interval = GEOLOGIC_INTERVALS.find((i) => i.name.toLowerCase() === name);
    if (interval) found.push(interval);
  }
  return found;
}

/**
 * Turn age text from a geologic map ("Pleistocene", "Miocene to Pliocene",
 * "Eocene-Oligocene", "Quaternary", "late Cretaceous") into a range of years
 * before 2000 CE: `from` is the older bound and `to` the younger. When
 * several intervals are named the range spans all of them. "Pre-Tertiary"
 * means older than the Tertiary, so it runs from the age of the Earth to the
 * start of that interval. Returns undefined when no interval name is found.
 */
export function parseGeologicAge(text: string): { from: number; to: number } | undefined {
  let oldestMa = -Infinity;
  let youngestMa = Infinity;
  for (const m of text.matchAll(INTERVAL_PATTERN)) {
    const name = m[2]?.toLowerCase();
    const interval = GEOLOGIC_INTERVALS.find((i) => i.name.toLowerCase() === name);
    if (!interval) continue;
    if (m[1]) {
      // "pre-Tertiary": everything older than the interval.
      oldestMa = Math.max(oldestMa, EARTH_AGE_MA);
      youngestMa = Math.min(youngestMa, interval.startMa);
    } else {
      oldestMa = Math.max(oldestMa, interval.startMa);
      youngestMa = Math.min(youngestMa, interval.endMa);
    }
  }
  if (!Number.isFinite(oldestMa) || !Number.isFinite(youngestMa)) return undefined;
  // Round to whole years: 23.03 * 1e6 is not always an exact integer in floating point.
  return { from: Math.round(maToAgo(oldestMa)), to: Math.round(maToAgo(youngestMa)) };
}

// ---------------------------------------------------------------------------
// WA DNR: request shapes and URLs
// ---------------------------------------------------------------------------

const DNR_BASE = 'https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/100K_Surface_Geology_WA_GeMS/MapServer';

/** The fields we ask layer 11 (the polygons) for. */
export interface DnrUnitAttributes {
  /** The unit code, e.g. "Qgt". */
  MAP_UNIT_100K: string | null;
  /** The short unit name as the legend shows it, e.g. "Pleistocene continental glacial till". */
  MAP_UNIT_100K_SYMBOL: string | null;
  /** Usually the same as the code. */
  MAP_UNIT_100K_LABEL: string | null;
  /** The join key into table 13, e.g. "Compiled | Qgt". */
  MAP_UNIT_100K_QUAD_UNIT: string | null;
}

/** The fields we ask table 13 (Description of Map Units) for. */
export interface DnrDescriptionAttributes {
  /** Can be null, e.g. for plain alluvium. */
  DMU_100K_FULL_NAME: string | null;
  /** Age in words, e.g. "Pleistocene", "Eocene to Oligocene". */
  DMU_100K_AGE: string | null;
  DMU_100K_DESCRIPTION: string | null;
}

/** An ArcGIS query answer: features on success, or an error object with HTTP 200. */
interface EsriQueryResponse<A> {
  features?: Array<{ attributes: A }>;
  error?: { code?: number; message?: string };
}

/** Coordinates rounded to about a metre; enough for geology, and stable cache keys. */
function pointKey(p: LngLat): string {
  return `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
}

/** The layer-11 point query URL for a point (WGS 84 longitude, latitude). */
export function dnrUnitUrl(p: LngLat): string {
  const params = new URLSearchParams({
    geometry: pointKey(p),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'MAP_UNIT_100K,MAP_UNIT_100K_SYMBOL,MAP_UNIT_100K_LABEL,MAP_UNIT_100K_QUAD_UNIT',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${DNR_BASE}/11/query?${params.toString()}`;
}

/** The table-13 lookup URL for a join key such as "Compiled | Qgt". */
export function dnrDescriptionUrl(quadUnit: string): string {
  // SQL-style where clause: a literal single quote is written as two.
  // encodeURIComponent (not URLSearchParams) so the spaces in "Compiled | Qgt"
  // become %20, exactly as in the captured request.
  const where = encodeURIComponent(`DMU_FEATURE_QUAD_UNIT='${quadUnit.replace(/'/g, "''")}'`);
  return `${DNR_BASE}/13/query?where=${where}&outFields=DMU_100K_FULL_NAME,DMU_100K_AGE,DMU_100K_DESCRIPTION&f=json`;
}

/** Unwrap an ArcGIS answer, turning its HTTP-200 error object into a thrown Error. */
function featuresOf<A>(res: EsriQueryResponse<A>, url: string): A[] {
  if (res.error) {
    throw new Error(`ArcGIS error ${res.error.code ?? ''} from ${url}: ${res.error.message ?? 'unknown'}`.trim());
  }
  return (res.features ?? []).map((f) => f.attributes);
}

const trimmed = (s: string | null | undefined): string => (s ?? '').trim();

/**
 * Build a GeologyUnit from the DNR polygon attributes and, when the second
 * request succeeded, the matching description row. The legend name from the
 * polygon layer ("Pleistocene continental glacial till") is used as the
 * display name because it is always present and reads well; the longer
 * survey name from table 13 ("mostly Vashon Stade in western WA...") is
 * added to the end of the description. The age range is parsed from the
 * table's age text, or from the legend name when the table was unavailable.
 */
export function unitFromDnr(unit: DnrUnitAttributes, dmu?: DnrDescriptionAttributes): GeologyUnit {
  const code = trimmed(unit.MAP_UNIT_100K) || trimmed(unit.MAP_UNIT_100K_LABEL) || 'unit';
  const legendName = trimmed(unit.MAP_UNIT_100K_SYMBOL);
  const fullName = trimmed(dmu?.DMU_100K_FULL_NAME);
  const name = legendName || fullName || code;

  const ageText = trimmed(dmu?.DMU_100K_AGE) || intervalsIn(legendName).map((i) => i.name).join(' to ');
  const ageYearsAgo = parseGeologicAge(ageText || legendName);

  const descriptionParts = [trimmed(dmu?.DMU_100K_DESCRIPTION)];
  if (fullName && fullName !== legendName) descriptionParts.push(`(Full unit name: ${fullName}.)`);
  const description = descriptionParts.filter(Boolean).join(' ');

  return {
    symbol: code,
    name,
    age: ageText,
    ...(ageYearsAgo ? { ageYearsAgo } : {}),
    ...(description ? { description } : {}),
    source: { ...DNR_SOURCE },
  };
}

/**
 * The DNR two-step lookup for a point: null when no polygon covers it,
 * otherwise the unit with its description filled in. A failure of the
 * second (description) request is only warned about, so the visitor still
 * sees the unit name and an age guessed from it. Results are cached for a
 * month.
 */
export async function geologyFromDnr(p: LngLat): Promise<GeologyUnit | null> {
  return cached(`geology:dnr:${pointKey(p)}`, { ttlMs: GEOLOGY_TTL_MS }, async () => {
    const limiter = limiterFor('gis.dnr.wa.gov');

    const unitUrl = dnrUnitUrl(p);
    const unitRes = await limiter.run(() => fetchJson<EsriQueryResponse<DnrUnitAttributes>>(unitUrl));
    const unit = featuresOf(unitRes, unitUrl)[0];
    if (!unit) return null;

    let dmu: DnrDescriptionAttributes | undefined;
    const quadUnit = trimmed(unit.MAP_UNIT_100K_QUAD_UNIT);
    if (quadUnit) {
      const dmuUrl = dnrDescriptionUrl(quadUnit);
      try {
        const dmuRes = await limiter.run(() => fetchJson<EsriQueryResponse<DnrDescriptionAttributes>>(dmuUrl));
        dmu = featuresOf(dmuRes, dmuUrl)[0];
      } catch (err) {
        console.warn(`[geology] DNR description lookup failed for ${quadUnit}; showing the unit without it`, err);
      }
    }
    return unitFromDnr(unit, dmu);
  });
}

// ---------------------------------------------------------------------------
// Macrostrat fallback
// ---------------------------------------------------------------------------

/** One map unit as Macrostrat's geologic_units/map endpoint returns it. */
export interface MacrostratUnit {
  map_id?: number;
  name?: string;
  strat_name?: string;
  /** e.g. "Major:{fine alluvium,coarse alluvium}" or "sedimentary" */
  lith?: string;
  descrip?: string;
  /** Bottom (older) age in Ma. */
  b_age?: number;
  /** Top (younger) age in Ma. */
  t_age?: number;
  b_int_name?: string;
  t_int_name?: string;
  best_int_name?: string;
  /** Which original map this unit was compiled from; a key into the answer's `refs`. */
  source_id?: number;
}

interface MacrostratResponse {
  /** `refs` names the original maps by source_id, e.g. "133" -> "Horton, J.D., ... USGS Data Series 1052." */
  success?: { license?: string; data?: MacrostratUnit[]; refs?: Record<string, string> };
  error?: unknown;
}

/** The Macrostrat map-unit URL for a point. */
export function macrostratUrl(p: LngLat): string {
  const params = new URLSearchParams({ lat: p.lat.toFixed(5), lng: p.lng.toFixed(5), format: 'json' });
  return `https://macrostrat.org/api/v2/geologic_units/map?${params.toString()}`;
}

/**
 * Macrostrat returns every source map that covers the point (a state map, a
 * national map, a continental one...). Pick the most informative: a unit
 * with a description beats one without, then a named stratigraphic unit,
 * then the narrowest age range.
 */
export function pickMacrostratUnit(units: readonly MacrostratUnit[]): MacrostratUnit | undefined {
  const score = (u: MacrostratUnit): number =>
    (trimmed(u.descrip) ? 4 : 0) + (trimmed(u.strat_name) ? 2 : 0) + (trimmed(u.name) ? 1 : 0);
  const span = (u: MacrostratUnit): number => (u.b_age ?? Infinity) - (u.t_age ?? 0);
  return [...units].sort((a, b) => score(b) - score(a) || span(a) - span(b))[0];
}

/** "Major:{fine alluvium,coarse alluvium}" -> "fine alluvium, coarse alluvium". */
function tidyLithology(lith: string): string {
  return lith
    .replace(/\b(Major|Minor):\{([^}]*)\}/g, '$2')
    .replace(/[{}]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Build a GeologyUnit from one Macrostrat unit. `ref` is the citation of the
 * original map the unit was compiled from (Macrostrat's CC BY terms ask for
 * it to be passed on); it is appended to the description as "Original map:".
 */
export function unitFromMacrostrat(u: MacrostratUnit, ref?: string): GeologyUnit {
  const stratName = trimmed(u.strat_name);
  const name = trimmed(u.name) || stratName || 'Unnamed unit';
  // Macrostrat has no short map code; use the first named stratigraphic
  // unit ("Vashon Drift"), or the interval, so the field is never empty.
  const symbol = stratName.split(';')[0]?.trim() || trimmed(u.best_int_name) || name;

  const bottom = trimmed(u.b_int_name);
  const top = trimmed(u.t_int_name);
  const age = bottom && top ? (bottom === top ? bottom : `${bottom} to ${top}`) : trimmed(u.best_int_name);

  const ageYearsAgo =
    typeof u.b_age === 'number' && typeof u.t_age === 'number'
      ? { from: Math.round(maToAgo(u.b_age)), to: Math.round(maToAgo(u.t_age)) }
      : parseGeologicAge(age);

  const lith = tidyLithology(trimmed(u.lith));
  const parts = [trimmed(u.descrip)];
  if (lith) parts.push(`Rock types: ${lith}.`);
  if (stratName) parts.push(`Stratigraphic name: ${stratName}.`);
  const citation = trimmed(ref).replace(/[\s.]+$/, '');
  if (citation) parts.push(`Original map: ${citation}.`);
  const description = parts.filter(Boolean).join(' ');

  return {
    symbol,
    name,
    age,
    ...(ageYearsAgo ? { ageYearsAgo } : {}),
    ...(description ? { description } : {}),
    source: { ...MACROSTRAT_SOURCE },
  };
}

/** The Macrostrat lookup for a point: null when it has no unit there. Cached for a month. */
export async function geologyFromMacrostrat(p: LngLat): Promise<GeologyUnit | null> {
  return cached(`geology:macrostrat:${pointKey(p)}`, { ttlMs: GEOLOGY_TTL_MS }, async () => {
    const url = macrostratUrl(p);
    const res = await limiterFor('macrostrat.org').run(() => fetchJson<MacrostratResponse>(url));
    const best = pickMacrostratUnit(res.success?.data ?? []);
    if (!best) return null;
    const ref = best.source_id !== undefined ? res.success?.refs?.[String(best.source_id)] : undefined;
    return unitFromMacrostrat(best, ref);
  });
}

// ---------------------------------------------------------------------------
// The public lookup
// ---------------------------------------------------------------------------

/**
 * The surface geology unit at a point in Washington. Asks WA DNR first; when
 * DNR has no polygon there or its service fails, asks Macrostrat instead.
 * Resolves to null only when neither source knows a unit at the point. If
 * DNR fails and Macrostrat fails too, the Macrostrat error is thrown so the
 * page can say the lookup did not work rather than "no rock here".
 */
export async function geologyAt(p: LngLat): Promise<GeologyUnit | null> {
  try {
    const fromDnr = await geologyFromDnr(p);
    if (fromDnr) return fromDnr;
  } catch (err) {
    console.warn('[geology] WA DNR lookup failed; trying Macrostrat', err);
  }
  return geologyFromMacrostrat(p);
}

// ---------------------------------------------------------------------------
// Words for the visitor
// ---------------------------------------------------------------------------

const GLACIAL_WORDS = /\b(glaci\w*|till|drift|outwash|moraine|ice[ -]sheet)\b/i;
/**
 * Pleistocene glacial units that are NOT from the last (Vashon / Fraser)
 * glaciation: older drifts the survey also files under "Pleistocene". They
 * get the generic age sentence rather than the specific 16,000-year one.
 */
const OLDER_GLACIAL_WORDS = /\b(older|pre-?\s?fraser|pre-?\s?vashon|whidbey|double bluff|possession|olympia bed\w*|salmon springs|puyallup|stuck|orting|hayden creek|wingate hill)\b/i;
const FLOOD_WORDS = /\b(outburst flood\w*|missoula|ice age flood\w*|scabland\w*|catastrophic\b[^.]{0,40}\bflood\w*)/i;

/** The Pleistocene boundaries, in years before 2000 CE. */
const PLEISTOCENE_START = 2_580_000;
const HOLOCENE_START = 11_700;

/** 2_580_000 -> "2.6"; 56_000_000 -> "56". */
const millions = (yearsAgo: number): string => Number((yearsAgo / 1_000_000).toFixed(1)).toLocaleString('en-US');
/** 11_700 -> "11,700". */
const years = (yearsAgo: number): string => Math.round(yearsAgo).toLocaleString('en-US');
/** "56 million years" or "11,700 years", whichever reads better. */
const amount = (yearsAgo: number): string => (yearsAgo >= 1_000_000 ? `${millions(yearsAgo)} million years` : `${years(yearsAgo)} years`);

/**
 * A readable span: "between 56 and 33.9 million years ago", "between 2.6
 * million and 11,700 years ago", "within the last 2.6 million years". The
 * unit is written once, on the second number, unless the two differ.
 */
export function describeSpan(from: number, to: number): string {
  if (to <= 0) return `within the last ${amount(from)}`;
  let first: string;
  if (from >= 1_000_000 && to >= 1_000_000) first = millions(from); // "56 and 33.9 million years ago"
  else if (from >= 1_000_000) first = `${millions(from)} million`; // "2.6 million and 11,700 years ago"
  else first = years(from); // "11,700 and 5,000 years ago"
  return `between ${first} and ${amount(to)} ago`;
}

/**
 * One visitor-friendly sentence about when a unit formed. Glacial deposits of
 * the last ice age get a specific line ("Laid down about 16,000 years ago by
 * the ice sheet..."), Ice Age flood deposits another; everything else reads
 * "Formed between X and Y million years ago, in the <age>."
 */
export function describeAge(unit: GeologyUnit): string {
  const range = unit.ageYearsAgo;
  if (!range) {
    return unit.age ? `The survey dates this unit as "${unit.age}".` : 'The survey gives no age for this unit.';
  }

  const text = `${unit.symbol} ${unit.name} ${unit.description ?? ''}`;
  const lastIceAge = range.from <= PLEISTOCENE_START && range.from > HOLOCENE_START;

  if (lastIceAge && FLOOD_WORDS.test(text)) {
    return 'Laid down between about 18,000 and 15,000 years ago by the Ice Age floods that swept across eastern Washington.';
  }
  if (lastIceAge && GLACIAL_WORDS.test(text) && !OLDER_GLACIAL_WORDS.test(text)) {
    return 'Laid down about 16,000 years ago by the ice sheet of the last ice age.';
  }
  if (range.from <= HOLOCENE_START && range.to <= 0) {
    return 'Laid down within the last 11,700 years, since the ice age ended; in places it is still forming today.';
  }

  const inAge = unit.age ? `, in the ${unit.age}` : '';
  return `Formed ${describeSpan(range.from, range.to)}${inAge}.`;
}
