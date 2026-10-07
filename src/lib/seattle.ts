/**
 * Seattle extras: the open data the City of Seattle publishes that lets us
 * say more about a spot inside the city limits than we can anywhere else.
 *
 *   seattleNeighborhood   which district and neighborhood the point is in
 *   seattleAnnexation     the year the spot became part of Seattle
 *   seattleParcel         the tax parcel: year built, renovation, landmark flag, use
 *   seattleLandmarksNear  designated city landmarks within a few hundred metres
 *
 * All four read the Seattle GeoData ArcGIS services (services.arcgis.com),
 * which allow browser requests from any site. Every request goes through
 * fetchJson (timeouts, retries), limiterFor (politeness) and cached (a
 * 7-day memory, so revisiting an address costs the city nothing).
 *
 * Only call these when the place is in Seattle: the caller checks with
 * isSeattle(place) first. The functions below never throw for "nothing
 * here" (they return null or []); they do throw when the service itself
 * fails, so the page can show a warning and carry on with the other rings.
 *
 * Each fetch function is split in two: a tiny loader that builds the URL and
 * fetches, and a pure "features -> facts" function that is easy to test.
 */

import type { Fact, LngLat, Place, Source } from './types';
import { fetchJson } from './http';
import { limiterFor } from './queue';
import { cached } from './cache';
import { cityName } from './rings';

// ---------------------------------------------------------------------------
// Constants and sources
// ---------------------------------------------------------------------------

/** Every Seattle GeoData feature service lives under this URL. */
export const SEATTLE_GEODATA_BASE = 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services';

/** The host above, used to pick the shared rate limiter. */
const SEATTLE_HOST = 'services.arcgis.com';

/** How long an answer stays in the cache: 7 days, in milliseconds. */
export const SEATTLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Default search radius for nearby landmarks, in metres (a few city blocks). */
export const LANDMARK_RADIUS_M = 400;

/** Most landmark facts to return. */
export const MAX_LANDMARKS = 5;

/**
 * Seattle's Landmarks Preservation Ordinance dates from 1973, so no landmark
 * was designated before then. The landmarks layer uses 1899-12-30 as a
 * "no date" placeholder, and this cut-off filters that out.
 */
export const FIRST_LANDMARK_YEAR = 1973;

/** Attribution for the Neighborhood Map Atlas layer. */
export const NEIGHBORHOOD_SOURCE: Source = {
  name: 'Seattle Neighborhood Map Atlas (Seattle GeoData)',
  url: 'https://www.arcgis.com/home/item.html?id=b4a142f592e94d39a3bf787f3c112c1d',
  license: 'PDDL',
};

/** Attribution for the city's annexation history layer. */
export const ANNEXATION_SOURCE: Source = {
  name: 'City of Seattle annexation history (Seattle GeoData)',
  url: 'https://www.arcgis.com/home/item.html?id=918eba8c31524025acec7a6289cec0f8',
  license: 'PDDL',
};

/** Attribution for tax parcels: the data is the County Assessor's, served by the city. */
export const PARCEL_SOURCE: Source = {
  name: 'King County Assessor via Seattle GeoData',
  url: 'https://www.arcgis.com/home/item.html?id=d68452b5929e4d43a99201eb50ab231f',
  license: 'King County Assessor terms',
};

/** Attribution for the designated landmarks layer (Seattle Dept. of Construction and Inspections). */
export const LANDMARKS_SOURCE: Source = {
  name: 'City of Seattle landmarks (Seattle GeoData, SDCI)',
  url: 'https://www.arcgis.com/home/item.html?id=462a18bf1f9f459eb7fd8ea08c843880',
  license: 'PDDL',
};

// ---------------------------------------------------------------------------
// Shapes of the raw ArcGIS answers (only the fields we read)
// ---------------------------------------------------------------------------

/** One row of an ArcGIS query answer: its attributes and, when asked for, a point. */
export interface ArcgisFeature<A> {
  attributes: A;
  geometry?: { x: number; y: number } | null;
}

/**
 * An ArcGIS `f=json` query answer. The server answers HTTP 200 even when the
 * query is bad, and puts the problem in `error` instead, so we check for it.
 */
export interface ArcgisQueryResponse<A> {
  features?: ArcgisFeature<A>[];
  error?: { code?: number; message?: string };
}

/** nma_nhoods_sub layer. */
export interface NeighborhoodAttrs {
  /** The larger district, e.g. "Queen Anne". */
  L_HOOD?: string | null;
  /** The neighborhood, e.g. "Lower Queen Anne". */
  S_HOOD?: string | null;
  /** Comma-separated other names, e.g. "Uptown, Seattle Center". */
  S_HOOD_ALT_NAMES?: string | null;
}

/** Annexation layer. A point usually falls in several cumulative polygons. */
export interface AnnexationAttrs {
  Year?: number | null;
  Title?: string | null;
  Ordinance?: string | null;
  Statute?: string | null;
  Method?: string | null;
}

/** PARCEL_GEO layer. Years come back as strings; LANDMARK is "Y" or null. */
export interface ParcelAttrs {
  PIN?: string | null;
  ADDRESS?: string | null;
  PROP_NAME?: string | null;
  YR_BUILT_MAX?: string | number | null;
  YR_RENOV_MAX?: string | number | null;
  NR_BLDGS?: number | null;
  LANDMARK?: string | null;
  BLDG_DESC?: string | null;
}

/** Landmarks layer. EFF_DATE is the designation date in epoch milliseconds, or null. */
export interface LandmarkAttrs {
  NAME?: string | null;
  ADDRESS?: string | null;
  LANDNO?: number | null;
  ORDINANCE?: number | null;
  EFF_DATE?: number | null;
}

/** What seattleNeighborhood resolves to. */
export interface SeattleNeighborhood {
  district: string;
  neighborhood: string;
  altNames: string[];
  source: Source;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * True when the geocoder put this place in the city of Seattle (its city,
 * town or village part reads "Seattle", in any letter case). The rest of
 * this module should only be called when this is true.
 */
export function isSeattle(place: Place): boolean {
  return cityName(place.address)?.toLowerCase() === 'seattle';
}

/** A trimmed string with runs of spaces collapsed, or undefined when blank or not a string. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.replace(/\s+/g, ' ').trim();
  return t ? t : undefined;
}

/** A positive finite number from a string or number field ("1961", 1961), else undefined. */
function positiveNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Assessor text is often ALL CAPS ("400   BROAD ST"). Collapse the spaces
 * and, when there is no lower-case letter at all, convert to Title Case so
 * it reads naturally ("400 Broad St"). Mixed-case text is left alone.
 */
export function tidyAssessorText(value: unknown): string | undefined {
  const t = text(value);
  if (!t) return undefined;
  if (/[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_m, before: string, letter: string) => before + letter.toUpperCase());
}

/** Coordinates rounded to 5 decimals (about a metre), for stable URLs and cache keys. */
function roundCoord(n: number): number {
  return Number(n.toFixed(5));
}

/** "lng,lat" with rounded coordinates, the form ArcGIS expects for a point. */
function pointText(p: LngLat): string {
  return `${roundCoord(p.lng)},${roundCoord(p.lat)}`;
}

/** A rectangle in degrees around a point. */
export interface Envelope {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * The rectangle `radiusM` metres out from a point in every direction, in
 * degrees. One degree of latitude is about 111,320 m everywhere; one degree
 * of longitude shrinks with the cosine of the latitude (at Seattle, about
 * 75,000 m). Good enough for a few-hundred-metre search box.
 */
export function envelopeAround(p: LngLat, radiusM: number): Envelope {
  const metresPerDegreeLat = 111_320;
  const dLat = radiusM / metresPerDegreeLat;
  const dLng = radiusM / (metresPerDegreeLat * Math.cos((p.lat * Math.PI) / 180));
  return { west: p.lng - dLng, south: p.lat - dLat, east: p.lng + dLng, north: p.lat + dLat };
}

/**
 * Great-circle distance between two points in metres (the haversine
 * formula on a sphere of radius 6,371,008.8 m). Accurate to well under a
 * metre over the distances this module cares about.
 */
export function distanceMetres(a: LngLat, b: LngLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusM = 6_371_008.8;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}

/**
 * The calendar year of a landmark's EFF_DATE (epoch milliseconds, UTC), or
 * undefined when it is missing, not a number, or before 1973, which means
 * the layer's 1899 "no date" placeholder rather than a real designation.
 */
export function landmarkYear(effDate: unknown): number | undefined {
  if (typeof effDate !== 'number' || !Number.isFinite(effDate)) return undefined;
  const y = new Date(effDate).getUTCFullYear();
  return y >= FIRST_LANDMARK_YEAR ? y : undefined;
}

/**
 * "at this spot" for a few metres, otherwise the distance in the units a
 * Washington reader expects: feet rounded to ten under about a fifth of a
 * mile ("about 300 feet away"), then miles to one decimal ("about 0.3 miles
 * away"). Exported so the page and tests agree on the wording.
 */
export function distanceText(metres: number): string {
  if (metres < 25) return 'at this spot';
  const feet = metres * 3.28084;
  if (feet < 1000) return `about ${Math.round(feet / 10) * 10} feet away`;
  const miles = Number((feet / 5280).toFixed(1));
  return `about ${miles} ${miles === 1 ? 'mile' : 'miles'} away`;
}

// ---------------------------------------------------------------------------
// URLs and the one fetch path
// ---------------------------------------------------------------------------

/**
 * The query URL for "which polygons of this layer contain this point?".
 * `service` is the FeatureServer name, e.g. 'Annexation' (layer 0 always).
 */
export function pointQueryUrl(service: string, p: LngLat, outFields: readonly string[]): string {
  const params = new URLSearchParams({
    geometry: pointText(p),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.join(','),
    returnGeometry: 'false',
    f: 'json',
  });
  return `${SEATTLE_GEODATA_BASE}/${service}/FeatureServer/0/query?${params.toString()}`;
}

/**
 * The query URL for "which points of this layer fall in the box `radiusM`
 * metres around this point?", asking for the points' coordinates back in
 * plain longitude/latitude (outSR 4326) so distances can be measured.
 */
export function envelopeQueryUrl(service: string, p: LngLat, radiusM: number, outFields: readonly string[]): string {
  const e = envelopeAround(p, radiusM);
  const corners = [e.west, e.south, e.east, e.north].map(roundCoord).join(',');
  const params = new URLSearchParams({
    geometry: corners,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  return `${SEATTLE_GEODATA_BASE}/${service}/FeatureServer/0/query?${params.toString()}`;
}

/**
 * Fetch the features for a query URL, through the cache (7 days), the
 * shared rate limiter for the host and fetchJson. An ArcGIS error payload
 * is thrown as an Error inside the loader, so it is never cached.
 */
async function queryFeatures<A>(cacheKey: string, url: string): Promise<ArcgisFeature<A>[]> {
  return cached(cacheKey, { ttlMs: SEATTLE_TTL_MS }, async () => {
    const res = await limiterFor(SEATTLE_HOST).run(() => fetchJson<ArcgisQueryResponse<A>>(url));
    if (res.error) {
      const code = res.error.code ?? 'unknown code';
      throw new Error(`Seattle GeoData rejected the query (${code}): ${res.error.message ?? 'no message'}`);
    }
    return res.features ?? [];
  });
}

// ---------------------------------------------------------------------------
// Neighborhood
// ---------------------------------------------------------------------------

const NEIGHBORHOOD_FIELDS = ['L_HOOD', 'S_HOOD', 'S_HOOD_ALT_NAMES'] as const;

/**
 * Turn the neighborhood layer's answer into a SeattleNeighborhood, or null
 * when no polygon contains the point (outside the city, or on the water).
 * The first polygon wins; the layer does not overlap. Alternative names
 * are split on commas ("Uptown, Seattle Center" -> two names).
 */
export function neighborhoodFromFeatures(features: readonly ArcgisFeature<NeighborhoodAttrs>[]): SeattleNeighborhood | null {
  const attrs = features[0]?.attributes;
  const neighborhood = text(attrs?.S_HOOD);
  if (!attrs || !neighborhood) return null;
  const altNames = (text(attrs.S_HOOD_ALT_NAMES) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    district: text(attrs.L_HOOD) ?? neighborhood,
    neighborhood,
    altNames,
    source: NEIGHBORHOOD_SOURCE,
  };
}

/**
 * The Seattle district and neighborhood a point is in, from the city's
 * Neighborhood Map Atlas (94 neighborhoods in 20 districts; the city calls
 * it an "unofficial delineation"). Resolves to null when the point is not
 * inside any neighborhood polygon.
 */
export async function seattleNeighborhood(p: LngLat): Promise<SeattleNeighborhood | null> {
  const url = pointQueryUrl('nma_nhoods_sub', p, NEIGHBORHOOD_FIELDS);
  const features = await queryFeatures<NeighborhoodAttrs>(`seattle:nhood:${pointText(p)}`, url);
  return neighborhoodFromFeatures(features);
}

// ---------------------------------------------------------------------------
// Annexation
// ---------------------------------------------------------------------------

const ANNEXATION_FIELDS = ['Year', 'Title', 'Ordinance', 'Statute', 'Method'] as const;

/**
 * The annexation fact for a point, or null when no polygon has a usable
 * Year. The layer's polygons are cumulative city extents (the 1869 polygon,
 * the larger 1883 polygon, ...), so a point in the old core falls in many
 * of them; the EARLIEST year is when the spot first became part of Seattle.
 */
export function annexationFact(features: readonly ArcgisFeature<AnnexationAttrs>[]): Fact | null {
  let earliest: (AnnexationAttrs & { Year: number }) | undefined;
  for (const { attributes } of features) {
    const year = attributes.Year;
    if (typeof year !== 'number' || !Number.isFinite(year)) continue;
    if (!earliest || year < earliest.Year) earliest = { ...attributes, Year: year };
  }
  if (!earliest) return null;

  const title = text(earliest.Title);
  const ordinance = text(earliest.Ordinance);
  const statute = text(earliest.Statute);
  const how = ordinance ? `Ordinance ${ordinance}` : statute;
  const body = [title, how ? `(${how})` : undefined].filter((s) => s !== undefined).join(' ');

  return {
    kind: 'annexed',
    title: `Became part of Seattle in ${earliest.Year}`,
    year: earliest.Year,
    ...(body ? { body } : {}),
    source: ANNEXATION_SOURCE,
    confidence: 'high',
  };
}

/**
 * When this spot became part of Seattle, from the city's annexation layer
 * (45 polygons, 1869 to 1986). Resolves to a Fact titled
 * "Became part of Seattle in <year>" with the ordinance or statute in the
 * body, or null when the point is outside every annexation polygon.
 */
export async function seattleAnnexation(p: LngLat): Promise<Fact | null> {
  const url = pointQueryUrl('Annexation', p, ANNEXATION_FIELDS);
  const features = await queryFeatures<AnnexationAttrs>(`seattle:annexation:${pointText(p)}`, url);
  return annexationFact(features);
}

// ---------------------------------------------------------------------------
// Parcel (year built etc.)
// ---------------------------------------------------------------------------

const PARCEL_FIELDS = [
  'PIN',
  'ADDRESS',
  'PROP_NAME',
  'YR_BUILT_MAX',
  'YR_RENOV_MAX',
  'NR_BLDGS',
  'LANDMARK',
  'BLDG_DESC',
] as const;

/**
 * Facts from one tax parcel's attributes: 'year-built' when YR_BUILT_MAX is
 * above 0, 'renovated' when YR_RENOV_MAX is, 'landmark' when LANDMARK is
 * "Y", and 'use' from the building description. An empty parcel (a road
 * right-of-way, say) gives an empty list.
 */
export function parcelFacts(attrs: ParcelAttrs): Fact[] {
  const facts: Fact[] = [];
  const name = tidyAssessorText(attrs.PROP_NAME);
  const address = tidyAssessorText(attrs.ADDRESS);
  const pin = text(attrs.PIN);
  const buildings = positiveNumber(attrs.NR_BLDGS);

  // "Space Needle, 400 Broad St (parcel 1985200495)": the same tail on each fact.
  const where = [name, address].filter((s) => s !== undefined).join(', ');
  const parcelTag = pin ? `(parcel ${pin})` : '';
  const describe = (lead: string): string => [lead, where, parcelTag].filter((s) => s.length > 0).join(' ').trim();

  const built = positiveNumber(attrs.YR_BUILT_MAX);
  if (built !== undefined) {
    const lead = buildings !== undefined && buildings > 1 ? `Newest of ${buildings} buildings on this parcel.` : '';
    const body = describe(lead);
    facts.push({
      kind: 'year-built',
      title: `Built in ${built}`,
      year: built,
      ...(body ? { body } : {}),
      source: PARCEL_SOURCE,
      confidence: 'high',
    });
  }

  const renovated = positiveNumber(attrs.YR_RENOV_MAX);
  if (renovated !== undefined) {
    facts.push({
      kind: 'renovated',
      title: `Renovated in ${renovated}`,
      year: renovated,
      source: PARCEL_SOURCE,
      confidence: 'high',
    });
  }

  if (text(attrs.LANDMARK)?.toUpperCase() === 'Y') {
    const body = describe('');
    facts.push({
      kind: 'landmark',
      title: 'Designated Seattle landmark',
      ...(body ? { body } : {}),
      source: PARCEL_SOURCE,
      confidence: 'high',
    });
  }

  const use = tidyAssessorText(attrs.BLDG_DESC);
  if (use !== undefined) {
    facts.push({
      kind: 'use',
      title: `Building type: ${use}`,
      source: PARCEL_SOURCE,
      confidence: 'high',
    });
  }

  return facts;
}

/**
 * Facts about the tax parcel under a point (year built, renovation,
 * landmark flag, building type) from King County Assessor data served by
 * Seattle GeoData. When several polygons contain the point, the first one
 * with a PIN is used, which skips road right-of-way slivers. Resolves to
 * an empty list when there is no parcel or it carries no usable fields.
 */
export async function seattleParcel(p: LngLat): Promise<Fact[]> {
  const url = pointQueryUrl('PARCEL_GEO', p, PARCEL_FIELDS);
  const features = await queryFeatures<ParcelAttrs>(`seattle:parcel:${pointText(p)}`, url);
  const parcel = features.find((f) => text(f.attributes.PIN) !== undefined) ?? features[0];
  return parcel ? parcelFacts(parcel.attributes) : [];
}

// ---------------------------------------------------------------------------
// Landmarks nearby
// ---------------------------------------------------------------------------

const LANDMARK_FIELDS = ['NAME', 'ADDRESS', 'LANDNO', 'ORDINANCE', 'EFF_DATE'] as const;

/**
 * Landmark facts from the points the envelope query returned: keep those
 * truly within `radiusM` of the point (the box has corners further out),
 * collapse landmarks that appear as several points (the Monorail has one
 * per pylon) to their nearest point, sort nearest first and keep at most
 * `max`. Each fact's title is the landmark's name and its year is the
 * designation year when the layer has a real one.
 */
export function landmarkFacts(
  features: readonly ArcgisFeature<LandmarkAttrs>[],
  p: LngLat,
  radiusM: number,
  max = MAX_LANDMARKS,
): Fact[] {
  const nearest = new Map<string, { name: string; attrs: LandmarkAttrs; distance: number }>();
  for (const feature of features) {
    const name = text(feature.attributes.NAME);
    const g = feature.geometry;
    if (!name || !g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    const distance = distanceMetres(p, { lng: g.x, lat: g.y });
    if (distance > radiusM) continue;
    const key = name.toLowerCase();
    const seen = nearest.get(key);
    if (!seen || distance < seen.distance) nearest.set(key, { name, attrs: feature.attributes, distance });
  }

  return [...nearest.values()]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, max)
    .map(({ name, attrs, distance }): Fact => {
      const year = landmarkYear(attrs.EFF_DATE);
      const address = text(attrs.ADDRESS);
      const designated = year !== undefined ? `Designated a Seattle landmark in ${year}` : 'A designated Seattle landmark';
      const body = [address ? `${address}.` : undefined, `${designated}, ${distanceText(distance)}.`]
        .filter((s) => s !== undefined)
        .join(' ');
      return {
        kind: 'landmark',
        title: name,
        body,
        ...(year !== undefined ? { year } : {}),
        source: LANDMARKS_SOURCE,
        confidence: 'high',
      };
    });
}

/**
 * Designated Seattle landmarks within `radiusM` metres of a point (default
 * 400 m, at most 5), nearest first, one fact per landmark name. Uses the
 * city's Landmarks layer (517 points, updated daily). Resolves to an empty
 * list when none are that close.
 */
export async function seattleLandmarksNear(p: LngLat, radiusM = LANDMARK_RADIUS_M): Promise<Fact[]> {
  const url = envelopeQueryUrl('Landmarks', p, radiusM, LANDMARK_FIELDS);
  const key = `seattle:landmarks:${pointText(p)}:r${Math.round(radiusM)}`;
  const features = await queryFeatures<LandmarkAttrs>(key, url);
  return landmarkFacts(features, p, radiusM);
}
