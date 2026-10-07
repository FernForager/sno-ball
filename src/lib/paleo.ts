/**
 * Where a spot sat on the globe millions of years ago.
 *
 * Continents drift a few centimetres a year, which adds up: 100 million years
 * ago the ground under Seattle was not even part of North America yet. The
 * GPlates Web Service (gws.gplates.org, by the EarthByte group) can run a
 * plate-motion model backwards and tell us the latitude and longitude a
 * present-day point had at any time in the past. We use the MERDITH2021
 * model, which reaches back a billion years.
 *
 * The service accepts several times in one request (`times=20,50,100`),
 * confirmed by the captured fixture, and answers with an object keyed by the
 * time: { "20": { type: "MultiPoint", coordinates: [[lng, lat]] }, ... }.
 * When a point is not on any known plate at a given time the model returns
 * the sentinel coordinate [999.99, 999.99]; those stops are dropped.
 *
 * If the batched request fails we fall back to one request per stop and
 * skip any stop that fails. Answers are cached for 30 days: the past does
 * not change.
 */

import type { LngLat, PaleoPosition, Source } from './types';
import { fetchJson } from './http';
import { limiterFor } from './queue';
import { cached } from './cache';

/** The times we ask about, in millions of years ago. */
export const PALEO_STOPS: readonly number[] = [20, 50, 100, 200, 300, 500];

/** The plate-motion model we ask GPlates to use. */
export const PALEO_MODEL = 'MERDITH2021';

export const GPLATES_SOURCE: Readonly<Source> = {
  name: 'GPlates Web Service (EarthByte), MERDITH2021 plate model',
  url: 'https://gws.gplates.org',
  license: 'CC BY 4.0',
};

/** 30 days. */
export const PALEO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const GPLATES_BASE = 'https://gws.gplates.org/reconstruct/reconstruct_points/';

/** A GeoJSON MultiPoint as GPlates returns it: coordinates are [lng, lat] pairs. */
export interface GPlatesMultiPoint {
  type?: string;
  coordinates?: unknown;
}

/** The batched answer: one MultiPoint per requested time, keyed by the time as text. */
export type GPlatesBatchResponse = Record<string, GPlatesMultiPoint>;

/** Coordinates rounded to about a metre, for URLs and cache keys. */
function pointKey(p: LngLat): string {
  return `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
}

/**
 * The reconstruct_points URL for a point and one or more times (Ma). One
 * time gives the single-time form (`time=100`), several give the batched
 * form (`times=20,50,100`).
 */
export function gplatesUrl(p: LngLat, stops: readonly number[], model = PALEO_MODEL): string {
  const params = new URLSearchParams({ points: pointKey(p) });
  if (stops.length === 1) params.set('time', String(stops[0]));
  else params.set('times', stops.join(','));
  params.set('model', model);
  return `${GPLATES_BASE}?${params.toString()}`;
}

/**
 * The first [lng, lat] of a MultiPoint, or undefined when the shape is odd
 * or the coordinate is the "not on any plate" sentinel (999.99) or otherwise
 * off the globe.
 */
export function pointFromMultiPoint(mp: GPlatesMultiPoint | undefined): LngLat | undefined {
  if (!mp || !Array.isArray(mp.coordinates)) return undefined;
  const first: unknown = mp.coordinates[0];
  if (!Array.isArray(first)) return undefined;
  const [lng, lat] = first as unknown[];
  if (typeof lng !== 'number' || typeof lat !== 'number') return undefined;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return undefined; // includes 999.99
  return { lng, lat };
}

/**
 * Turn a batched GPlates answer into PaleoPositions for the stops asked for,
 * oldest last, skipping any stop the answer lacks or marks as off-plate.
 * The service keys by the time as text ("100"); a key written "100.0" is
 * matched by value too.
 */
export function positionsFromBatch(res: GPlatesBatchResponse, stops: readonly number[]): PaleoPosition[] {
  const out: PaleoPosition[] = [];
  for (const ma of stops) {
    const key = Object.keys(res).find((k) => k === String(ma) || Number(k) === ma);
    const point = key === undefined ? undefined : pointFromMultiPoint(res[key]);
    if (point) out.push({ ma, point, model: PALEO_MODEL, source: { ...GPLATES_SOURCE } });
  }
  return out;
}

/** Fetch every stop in one request. */
async function fetchBatch(p: LngLat, stops: readonly number[]): Promise<PaleoPosition[]> {
  const url = gplatesUrl(p, stops);
  const res = await limiterFor('gws.gplates.org').run(() => fetchJson<GPlatesBatchResponse | GPlatesMultiPoint>(url));
  // A single stop comes back as a bare MultiPoint rather than a keyed object.
  if (stops.length === 1 && 'type' in res) {
    return positionsFromBatch({ [String(stops[0])]: res as GPlatesMultiPoint }, stops);
  }
  return positionsFromBatch(res as GPlatesBatchResponse, stops);
}

/** Fetch stops one at a time, keeping whichever succeed. */
async function fetchOneByOne(p: LngLat, stops: readonly number[]): Promise<PaleoPosition[]> {
  const out: PaleoPosition[] = [];
  for (const ma of stops) {
    const url = gplatesUrl(p, [ma]);
    try {
      const res = await limiterFor('gws.gplates.org').run(() => fetchJson<GPlatesMultiPoint>(url));
      const point = pointFromMultiPoint(res);
      if (point) out.push({ ma, point, model: PALEO_MODEL, source: { ...GPLATES_SOURCE } });
    } catch (err) {
      console.warn(`[paleo] GPlates failed for ${ma} Ma; skipping that stop`, err);
    }
  }
  return out;
}

/**
 * Where a present-day point sat at each of the given times (Ma), in the
 * order of `stops`. Tries one batched request first, then one request per
 * stop; stops that fail or fall off the known plates are left out, so the
 * result can be shorter than `stops` and is empty when the service is down.
 * Successful (non-empty) answers are cached for 30 days.
 */
export async function paleoPositions(p: LngLat, stops: readonly number[] = PALEO_STOPS): Promise<PaleoPosition[]> {
  if (stops.length === 0) return [];
  const key = `paleo:${PALEO_MODEL}:${pointKey(p)}:${stops.join(',')}`;
  try {
    return await cached(key, { ttlMs: PALEO_TTL_MS }, async () => {
      let positions: PaleoPosition[];
      try {
        positions = await fetchBatch(p, stops);
      } catch (err) {
        console.warn('[paleo] batched GPlates request failed; trying one stop at a time', err);
        positions = await fetchOneByOne(p, stops);
      }
      // Throwing here keeps an empty answer out of the cache, so the next
      // visit tries the service again.
      if (positions.length === 0) throw new Error('GPlates returned no usable positions');
      return positions;
    });
  } catch (err) {
    console.warn('[paleo] no paleo positions available', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Words for the visitor
// ---------------------------------------------------------------------------

/** Longitude difference folded into -180..180, so crossing the date line reads right. */
function lngDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** "a little" / "well" / "far", for a shift in degrees. */
function howFar(degrees: number): string {
  const d = Math.abs(degrees);
  if (d < 15) return 'a little';
  if (d < 40) return 'well';
  return 'far';
}

/**
 * One sentence placing the past position for a reader, deliberately vague
 * because the models are: "100 million years ago this spot sat near 55°
 * north, about 7° farther north than today and far to the east of where it
 * is now." Pass the present-day point to get the comparison; without it the
 * sentence stops after the latitude.
 */
export function describePaleo(pos: PaleoPosition, present?: LngLat): string {
  const { lat, lng } = pos.point;
  const latText = Math.abs(lat) < 1 ? 'near the equator' : `near ${Math.round(Math.abs(lat))}° ${lat >= 0 ? 'north' : 'south'}`;
  const when = `${pos.ma.toLocaleString('en-US')} million years ago`;

  if (!present) return `${when} this spot sat ${latText}.`;

  const shifts: string[] = [];
  const dLat = lat - present.lat;
  if (Math.abs(dLat) >= 5) {
    shifts.push(`about ${Math.round(Math.abs(dLat))}° farther ${dLat > 0 ? 'north' : 'south'} than today`);
  }
  const dLng = lngDelta(present.lng, lng);
  if (Math.abs(dLng) >= 5) {
    shifts.push(`${howFar(dLng)} to the ${dLng > 0 ? 'east' : 'west'} of where it is now`);
  }

  const tail = shifts.length === 0 ? 'close to where it is now' : shifts.join(' and ');
  return `${when} this spot sat ${latText}, ${tail}.`;
}
