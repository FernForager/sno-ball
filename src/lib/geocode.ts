/**
 * Geocoding: turn what the visitor typed into a point in Washington, and turn
 * a point back into an address.
 *
 * Primary service: OpenStreetMap Nominatim (free, no key, ODbL data).
 * Fallback:        Photon by komoot (same OSM data, a different search engine),
 *                  used when Nominatim is down, rate-limiting us, or finds nothing.
 *
 * POLICY. Nominatim is a donated, shared service with strict usage rules
 * (https://operations.osmfoundation.org/policies/nominatim/). This module and
 * the UI honour them like so:
 *   1. Submit-only. We geocode when the visitor presses Enter or the Search
 *      button, never on every keystroke. No autocomplete, ever.
 *   2. One request at a time, at most one every 1.1 seconds, enforced by
 *      limiterFor('nominatim.openstreetmap.org') from ./queue.
 *   3. Results are cached for 30 days with cached() from ./cache, keyed by the
 *      normalised query, so repeat searches cost the service nothing.
 *   4. Attribution: every Place carries a Source, and the UI shows
 *      "© OpenStreetMap contributors" next to results and on the map.
 *   5. No custom User-Agent header: browsers cannot set one. The Referer the
 *      browser sends (fernforager.github.io/sno-ball/) identifies the site.
 */

import type { AddressParts, LngLat, Place, Source } from './types';
import { fetchJson, HttpError } from './http';
import { limiterFor } from './queue';
import { cached } from './cache';

// ---------------------------------------------------------------------------
// Washington's bounding box
// ---------------------------------------------------------------------------

/** A rectangle in degrees. west/east are longitudes, south/north are latitudes. */
export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * A rectangle that contains all of Washington State, with a little slack.
 * It also clips slivers of Oregon, Idaho and British Columbia, which is why
 * results are additionally checked against the address's state name below.
 */
export const WA_BBOX: Readonly<BBox> = { west: -124.85, south: 45.54, east: -116.92, north: 49.0 };

/**
 * True when a point falls inside WA_BBOX. This is a cheap rectangle test,
 * not a precise border check: a point just across the Idaho line passes too.
 */
export function isInWashington(p: LngLat): boolean {
  return (
    Number.isFinite(p.lng) &&
    Number.isFinite(p.lat) &&
    p.lng >= WA_BBOX.west &&
    p.lng <= WA_BBOX.east &&
    p.lat >= WA_BBOX.south &&
    p.lat <= WA_BBOX.north
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOMINATIM_HOST = 'nominatim.openstreetmap.org';
const PHOTON_HOST = 'photon.komoot.io';

/** Nominatim's search endpoint. Exported so tests and the UI can show it. */
export const NOMINATIM_SEARCH_URL = `https://${NOMINATIM_HOST}/search`;
/** Nominatim's reverse (point to address) endpoint. */
export const NOMINATIM_REVERSE_URL = `https://${NOMINATIM_HOST}/reverse`;
/** Photon's search endpoint. */
export const PHOTON_SEARCH_URL = `https://${PHOTON_HOST}/api/`;

/** How long a geocoding answer stays in the cache: 30 days, in milliseconds. */
export const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Most results to ask for in one search. */
const RESULT_LIMIT = 5;

/** Attribution attached to every Place that came from Nominatim. */
export const NOMINATIM_SOURCE: Source = {
  name: 'OpenStreetMap Nominatim',
  url: 'https://nominatim.org',
  license: 'ODbL',
};

/** Attribution attached to every Place that came from Photon. */
export const PHOTON_SOURCE: Source = {
  name: 'Photon (komoot)',
  url: 'https://photon.komoot.io',
  license: 'ODbL',
};

// Pacing: every request is wrapped in limiterFor(host).run(...). limiterFor
// hands back the one shared queue for that host (1.1 s between starts for
// Nominatim, a gentle default for Photon), so all modules wait in line together.

// ---------------------------------------------------------------------------
// Shapes of the raw API answers (only the fields we read)
// ---------------------------------------------------------------------------

/** One entry of a Nominatim `format=jsonv2` answer. Other fields are ignored. */
export interface NominatimResult {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  /** Nominatim sends coordinates as strings, e.g. "47.6205063". */
  lat?: string;
  lon?: string;
  /** The OSM tag key, e.g. 'building', 'place', 'tourism'. jsonv2 calls it `category`... */
  category?: string;
  /** ...and the older `json` format calls the same thing `class`. We accept both. */
  class?: string;
  /** The OSM tag value, e.g. 'house', 'city', 'attraction'. */
  type?: string;
  /** 30 means "address or building level", lower numbers are coarser places. */
  place_rank?: number;
  /** The address level Nominatim matched, e.g. 'building', 'house', 'city'. */
  addresstype?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
  /** Reverse geocoding answers `{ error: "Unable to geocode" }` for open water etc. */
  error?: string;
}

/** One GeoJSON feature in a Photon answer. Other fields are ignored. */
export interface PhotonFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: number[] };
  properties?: {
    osm_id?: number;
    /** Single letters: N = node, W = way, R = relation. */
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    /** Photon's own precision class: 'house', 'street', 'locality', 'district', 'city', ... */
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
  };
}

/** The whole Photon answer: a GeoJSON FeatureCollection. */
export interface PhotonResponse {
  type?: string;
  features?: PhotonFeature[];
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/**
 * Tidy a query so that "  Space   Needle " and "space needle" are the same
 * search and share one cache entry: trim, collapse whitespace, lower-case,
 * and put exactly one space after each comma.
 */
export function normaliseQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ');
}

/**
 * Read "lat, lng" from text the visitor typed or from a share link such as
 * `?at=47.62051,-122.34928`. Accepts a comma, semicolon or spaces between the
 * two numbers, optional brackets, and an optional leading "@" (Google Maps
 * style) or "geo:" prefix. Returns null for anything else, including numbers
 * outside the valid latitude/longitude ranges. Latitude always comes first.
 */
export function parseLngLat(text: string): LngLat | null {
  const cleaned = text
    .trim()
    .replace(/^geo:/i, '')
    .replace(/^@/, '')
    .replace(/^[([]\s*|\s*[)\]]$/g, '');
  const m = /^(-?\d+(?:\.\d+)?)\s*(?:[,;]\s*|\s+)(-?\d+(?:\.\d+)?)$/.exec(cleaned);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lng, lat };
}

/**
 * The inverse of parseLngLat: "47.62051, -122.34928". Five decimals is about
 * one metre, plenty for an address and short enough for a share link.
 */
export function formatLngLat(p: LngLat, decimals = 5): string {
  return `${p.lat.toFixed(decimals)}, ${p.lng.toFixed(decimals)}`;
}

/**
 * Which raw address keys feed each of our normalised AddressParts fields.
 * The first key that has a value wins. Nominatim's names come first; the rest
 * are common alternatives it uses for the same idea (a `hamlet` is a village,
 * a `quarter` is a neighbourhood, a `pedestrian` way is still the road).
 */
const ADDRESS_KEYS: ReadonlyArray<readonly [keyof AddressParts, readonly string[]]> = [
  ['houseNumber', ['house_number']],
  ['road', ['road', 'pedestrian', 'footway']],
  ['neighbourhood', ['neighbourhood', 'quarter']],
  ['suburb', ['suburb', 'city_district', 'borough']],
  ['city', ['city', 'municipality']],
  ['town', ['town']],
  ['village', ['village', 'hamlet']],
  ['county', ['county']],
  ['state', ['state']],
  ['postcode', ['postcode']],
  ['country', ['country']],
];

/**
 * Turn a raw geocoder `address` object (Nominatim's snake_case keys) into our
 * camelCase AddressParts. Missing or blank values are left out entirely so the
 * result is safe under exactOptionalPropertyTypes.
 */
export function normaliseAddress(raw: Record<string, string | undefined> | undefined): AddressParts {
  const parts: AddressParts = {};
  if (!raw) return parts;
  for (const [ours, candidates] of ADDRESS_KEYS) {
    for (const key of candidates) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim() !== '') {
        parts[ours] = value.trim();
        break;
      }
    }
  }
  return parts;
}

/**
 * True when the address names Washington, or names no state at all. Used to
 * drop the Oregon, Idaho and British Columbia slivers inside WA_BBOX.
 */
function isWashingtonState(state: string | undefined): boolean {
  if (!state) return true; // no state given: trust the bounding box
  const s = state.trim().toLowerCase();
  return s === 'washington' || s === 'wa';
}

/** Map an OSM type name to the three values our types allow, or undefined. */
function osmType(raw: string | undefined): 'node' | 'way' | 'relation' | undefined {
  switch (raw?.toLowerCase()) {
    case 'node':
    case 'n':
      return 'node';
    case 'way':
    case 'w':
      return 'way';
    case 'relation':
    case 'r':
      return 'relation';
    default:
      return undefined;
  }
}

/** Build the optional `osm` field for a Place, or `{}` when we lack type or id. */
function osmRef(type: string | undefined, id: number | undefined): Pick<Place, 'osm'> {
  const t = osmType(type);
  return t && typeof id === 'number' && Number.isFinite(id) ? { osm: { type: t, id } } : {};
}

/**
 * Did the geocoder land on one building or address point, rather than a
 * street, neighbourhood or city? True when the OSM object is a building
 * (`building=*`), an address point (`place=house`), Nominatim says the match
 * was at building/house/address level, or the result is at the finest rank
 * (30) and carries a house number (that catches named buildings such as the
 * Space Needle, which Nominatim files under `tourism`, not `building`).
 */
export function isPreciseNominatim(r: NominatimResult): boolean {
  const cls = (r.category ?? r.class ?? '').toLowerCase();
  const type = (r.type ?? '').toLowerCase();
  const addressType = (r.addresstype ?? '').toLowerCase();
  if (cls === 'building') return true;
  if (cls === 'place' && type === 'house') return true;
  if (addressType === 'building' || addressType === 'house' || addressType === 'address') return true;
  if (r.place_rank !== undefined && r.place_rank >= 30 && r.address?.['house_number']) return true;
  return false;
}

/**
 * Convert one Nominatim result into a Place. Returns null when the result has
 * no usable coordinates or lies outside Washington (outside WA_BBOX, or with
 * an address in another state).
 */
export function placeFromNominatim(query: string, r: NominatimResult): Place | null {
  const point: LngLat = { lng: Number(r.lon), lat: Number(r.lat) };
  if (!isInWashington(point)) return null;
  const address = normaliseAddress(r.address);
  if (!isWashingtonState(address.state)) return null;
  return {
    query,
    point,
    displayName: r.display_name?.trim() || r.name?.trim() || formatLngLat(point),
    address,
    ...osmRef(r.osm_type, r.osm_id),
    precise: isPreciseNominatim(r),
    source: NOMINATIM_SOURCE,
  };
}

/**
 * Convert one Photon GeoJSON feature into a Place, or null when it has no
 * usable point or lies outside Washington. Photon's `district` is the
 * sub-city area (our `suburb`) and its `locality` the smaller neighbourhood.
 */
export function placeFromPhoton(query: string, f: PhotonFeature): Place | null {
  const coords = f.geometry?.coordinates ?? [];
  const lng = coords[0];
  const lat = coords[1];
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  const point: LngLat = { lng, lat };
  if (!isInWashington(point)) return null;

  const p = f.properties ?? {};
  const address = normaliseAddress({
    house_number: p.housenumber,
    road: p.street,
    neighbourhood: p.locality,
    suburb: p.district,
    city: p.city,
    county: p.county,
    state: p.state,
    postcode: p.postcode,
    country: p.country,
  });
  if (!isWashingtonState(address.state)) return null;

  // Photon has no display_name, so build one in Nominatim's style.
  const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ');
  const displayName = [p.name, streetLine, p.district, p.city, p.county, p.state, p.postcode, p.country]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))
    .filter((s, i, all) => all.indexOf(s) === i) // drop repeats such as name === street
    .join(', ');

  const precise = p.type === 'house' || p.osm_key === 'building';

  return {
    query,
    point,
    displayName: displayName || formatLngLat(point),
    address,
    ...osmRef(p.osm_type, p.osm_id),
    precise,
    source: PHOTON_SOURCE,
  };
}

// ---------------------------------------------------------------------------
// URL builders (pure, so tests can check them)
// ---------------------------------------------------------------------------

/** The exact Nominatim search URL for a (normalised) query. */
export function nominatimSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    extratags: '1',
    namedetails: '1',
    limit: String(RESULT_LIMIT),
    countrycodes: 'us',
    // Nominatim takes any two opposite corners; we give west,north,east,south.
    viewbox: `${WA_BBOX.west},${WA_BBOX.north},${WA_BBOX.east},${WA_BBOX.south}`,
    bounded: '1',
    dedupe: '1',
    'accept-language': 'en',
  });
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
}

/** The exact Nominatim reverse URL for a point, at building zoom (18). */
export function nominatimReverseUrl(p: LngLat): string {
  const params = new URLSearchParams({
    lat: String(p.lat),
    lon: String(p.lng),
    format: 'jsonv2',
    addressdetails: '1',
    extratags: '1',
    namedetails: '1',
    zoom: '18',
    'accept-language': 'en',
  });
  return `${NOMINATIM_REVERSE_URL}?${params.toString()}`;
}

/** The exact Photon search URL for a (normalised) query. Photon's bbox order is west,south,east,north. */
export function photonSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    bbox: `${WA_BBOX.west},${WA_BBOX.south},${WA_BBOX.east},${WA_BBOX.north}`,
    limit: String(RESULT_LIMIT),
    lang: 'en',
  });
  return `${PHOTON_SEARCH_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// The public geocoding functions
// ---------------------------------------------------------------------------

/**
 * Search Nominatim for a Washington address or place name. Returns up to five
 * Places inside Washington, best match first, or an empty array when nothing
 * matched. Blank input returns [] without a request. Throws HttpError (from
 * ./http) when Nominatim answers with an error status, so callers can fall
 * back; geocodeWithFallback does that for you. Answers are cached for 30 days
 * and requests are paced at one per 1.1 s (see POLICY at the top).
 */
export async function geocode(query: string): Promise<Place[]> {
  const q = normaliseQuery(query);
  if (!q) return [];
  const url = nominatimSearchUrl(q);
  // Check the cache first; only on a miss do we queue a real request.
  const raw = await cached(`geocode:search:${q}`, { ttlMs: GEOCODE_TTL_MS }, () =>
    limiterFor(NOMINATIM_HOST).run(() => fetchJson<NominatimResult[]>(url)),
  );
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => placeFromNominatim(query, r))
    .filter((place): place is Place => place !== null);
}

/**
 * Turn a point into the nearest address or building (Nominatim reverse at
 * zoom 18). Returns null when the point is outside Washington (no request is
 * made), when Nominatim cannot name the spot (open water, for example), or
 * when its answer lies outside Washington. Nominatim may return a nearby
 * point of interest rather than the building itself; check `precise`.
 */
export async function reverseGeocode(p: LngLat): Promise<Place | null> {
  if (!isInWashington(p)) return null;
  const url = nominatimReverseUrl(p);
  // Round the key to five decimals (~1 m) so near-identical clicks share one entry.
  const key = `geocode:reverse:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const raw = await cached(key, { ttlMs: GEOCODE_TTL_MS }, () =>
    limiterFor(NOMINATIM_HOST).run(() => fetchJson<NominatimResult>(url)),
  );
  if (!raw || typeof raw !== 'object' || raw.error) return null;
  return placeFromNominatim(formatLngLat(p), raw);
}

/**
 * Search Photon (komoot) for a Washington address or place name. Same shape
 * of answer as geocode(); used as the fallback when Nominatim fails. Cached
 * and rate-limited like Nominatim, with Photon's gentler default pace.
 */
export async function geocodePhoton(query: string): Promise<Place[]> {
  const q = normaliseQuery(query);
  if (!q) return [];
  const url = photonSearchUrl(q);
  const raw = await cached(`geocode:photon:${q}`, { ttlMs: GEOCODE_TTL_MS }, () =>
    limiterFor(PHOTON_HOST).run(() => fetchJson<PhotonResponse>(url)),
  );
  const features = raw && Array.isArray(raw.features) ? raw.features : [];
  return features
    .map((f) => placeFromPhoton(query, f))
    .filter((place): place is Place => place !== null);
}

/**
 * The function the search box should call. Tries Nominatim first; when it
 * throws (network trouble, HTTP 429/503) or finds nothing, tries Photon.
 * If the visitor typed coordinates ("47.62, -122.35" or a share link's
 * value), it reverse-geocodes them instead, returning that one Place.
 * Returns [] when both services find nothing; throws only if Nominatim
 * failed AND Photon failed too.
 */
export async function geocodeWithFallback(query: string): Promise<Place[]> {
  const asPoint = parseLngLat(query);
  if (asPoint) {
    const place = await reverseGeocode(asPoint);
    return place ? [place] : [];
  }

  try {
    const places = await geocode(query);
    if (places.length > 0) return places;
  } catch (err) {
    const why = err instanceof HttpError ? `HTTP ${err.status}` : err instanceof Error ? err.message : String(err);
    console.warn(`[geocode] Nominatim failed (${why}); trying Photon`);
  }
  return geocodePhoton(query);
}
