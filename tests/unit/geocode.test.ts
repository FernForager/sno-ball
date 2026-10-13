import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LngLat, Place } from '../../src/lib/types';
import spaceNeedle from '../fixtures/geocode/nominatim-space-needle.json';
import spokaneAddress from '../fixtures/geocode/nominatim-spokane-address.json';
import outsideWa from '../fixtures/geocode/nominatim-outside-wa.json';
import emptyAnswer from '../fixtures/geocode/nominatim-empty.json';
import reverseAnswer from '../fixtures/geocode/nominatim-reverse.json';
import reverseError from '../fixtures/geocode/nominatim-reverse-error.json';
import photonSpaceNeedle from '../fixtures/geocode/photon-space-needle.json';
import paradise from '../fixtures/geocode/nominatim-paradise.json';

// ---------------------------------------------------------------------------
// Mocks for the shared infrastructure. No network ever runs in these tests:
//  - fetchJson answers from the fixture files above
//  - the rate limiter is a spy that runs the task immediately
//  - the cache is a plain in-memory Map, so we can test that repeat searches
//    do not fetch again
// vi.hoisted makes the spies exist before the vi.mock factories run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const fetchJson = vi.fn();
  const run = vi.fn((task: () => Promise<unknown>) => task());
  const limiterFor = vi.fn(() => ({ run }));
  const store = new Map<string, unknown>();
  const cached = vi.fn(async (key: string, _opts: { ttlMs: number }, loader: () => Promise<unknown>) => {
    if (store.has(key)) return store.get(key);
    const value = await loader();
    store.set(key, value);
    return value;
  });
  return { fetchJson, run, limiterFor, cached, store };
});

vi.mock('../../src/lib/http', () => {
  class HttpError extends Error {
    readonly status: number;
    readonly url: string;
    constructor(status: number, url: string, message?: string) {
      super(message ?? `HTTP ${status} for ${url}`);
      this.name = 'HttpError';
      this.status = status;
      this.url = url;
    }
  }
  return { fetchJson: mocks.fetchJson, HttpError };
});

vi.mock('../../src/lib/queue', () => ({
  limiterFor: mocks.limiterFor,
  RateLimiter: class {},
}));

vi.mock('../../src/lib/cache', () => ({
  cached: mocks.cached,
  cacheClear: vi.fn(async () => mocks.store.clear()),
}));

// Import after the mocks are declared (vi.mock is hoisted anyway, but this
// keeps the reading order honest).
import { HttpError } from '../../src/lib/http';
import {
  GEOCODE_TTL_MS,
  WA_BBOX,
  formatLngLat,
  geocode,
  geocodePhoton,
  geocodeWithFallback,
  hasStreetNumber,
  isInWashington,
  isPreciseForQuery,
  isPreciseNominatim,
  mentionsQueryHead,
  nominatimSearchUrl,
  normaliseAddress,
  normaliseQuery,
  parseLngLat,
  placeFromNominatim,
  queryHead,
  rankNominatimResults,
  reverseGeocode,
  streetNumberIn,
} from '../../src/lib/geocode';

const SEATTLE: LngLat = { lng: -122.3493, lat: 47.6205 };
const SPOKANE: LngLat = { lng: -117.426, lat: 47.6588 };
const PORTLAND: LngLat = { lng: -122.6742, lat: 45.5202 };
const VANCOUVER_BC: LngLat = { lng: -123.114, lat: 49.2609 };
const POST_FALLS_ID: LngLat = { lng: -116.9516, lat: 47.718 };

/** The first element, with a clear failure when the array is empty. */
function first(places: Place[]): Place {
  const p = places[0];
  if (!p) throw new Error('expected at least one place');
  return p;
}

/** The URL string the last fetchJson call was made with. */
function lastFetchedUrl(): URL {
  const call = mocks.fetchJson.mock.calls.at(-1);
  if (!call) throw new Error('fetchJson was not called');
  return new URL(String(call[0]));
}

beforeEach(() => {
  mocks.fetchJson.mockReset();
  mocks.run.mockClear();
  mocks.limiterFor.mockClear();
  mocks.cached.mockClear();
  mocks.store.clear();
});

describe('WA_BBOX and isInWashington', () => {
  it('has the agreed corners', () => {
    expect(WA_BBOX).toEqual({ west: -124.85, south: 45.54, east: -116.92, north: 49.0 });
  });

  it.each([
    ['Seattle', SEATTLE, true],
    ['Spokane', SPOKANE, true],
    ['Post Falls, Idaho (inside the rectangle)', POST_FALLS_ID, true],
    ['Portland, Oregon', PORTLAND, false],
    ['Vancouver, BC', VANCOUVER_BC, false],
    ['NaN', { lng: NaN, lat: 47 }, false],
  ])('%s -> %s', (_label, point, expected) => {
    expect(isInWashington(point)).toBe(expected);
  });
});

describe('normaliseQuery', () => {
  it('trims, lower-cases, collapses spaces and tidies commas', () => {
    expect(normaliseQuery('  400 Broad St ,Seattle   WA ')).toBe('400 broad st, seattle wa');
    expect(normaliseQuery('Space Needle')).toBe(normaliseQuery('  space   NEEDLE '));
  });
});

describe('normaliseAddress', () => {
  it('maps Nominatim keys to AddressParts and drops blanks', () => {
    const parts = normaliseAddress({
      house_number: '400',
      road: 'Broad Street',
      neighbourhood: 'Belltown',
      suburb: 'Uptown',
      city: 'Seattle',
      county: 'King County',
      state: 'Washington',
      postcode: '98109',
      country: 'United States',
      country_code: 'us',
      town: '',
    });
    expect(parts).toEqual({
      houseNumber: '400',
      road: 'Broad Street',
      neighbourhood: 'Belltown',
      suburb: 'Uptown',
      city: 'Seattle',
      county: 'King County',
      state: 'Washington',
      postcode: '98109',
      country: 'United States',
    });
    // Never an explicit undefined (exactOptionalPropertyTypes).
    expect(Object.values(parts).every((v) => typeof v === 'string')).toBe(true);
  });

  it('uses sensible fallbacks: hamlet is a village, quarter is a neighbourhood', () => {
    expect(normaliseAddress({ hamlet: 'Index', quarter: 'Old Town' })).toEqual({
      village: 'Index',
      neighbourhood: 'Old Town',
    });
    expect(normaliseAddress(undefined)).toEqual({});
  });
});

describe('geocode (Nominatim)', () => {
  it('maps the Space Needle result to a precise Place', async () => {
    mocks.fetchJson.mockResolvedValueOnce(spaceNeedle);
    const places = await geocode('Space Needle');
    expect(places).toHaveLength(1);
    const place = first(places);
    expect(place.query).toBe('Space Needle');
    expect(place.point.lat).toBeCloseTo(47.6205, 3);
    expect(place.point.lng).toBeCloseTo(-122.3493, 3);
    expect(place.displayName).toMatch(/^Space Needle, 400, Broad Street/);
    expect(place.address).toEqual({
      houseNumber: '400',
      road: 'Broad Street',
      neighbourhood: 'Belltown',
      suburb: 'Uptown',
      city: 'Seattle',
      county: 'King County',
      state: 'Washington',
      postcode: '98109',
      country: 'United States',
    });
    expect(place.osm).toEqual({ type: 'way', id: 12903132 });
    // tourism=attraction, but rank 30 with a house number: one specific building.
    expect(place.precise).toBe(true);
    // The data is OpenStreetMap's, so the credit names its contributors and
    // links to the copyright page, as the ODbL and Nominatim's policy ask.
    expect(place.source).toEqual({
      name: 'OpenStreetMap contributors (via Nominatim)',
      url: 'https://www.openstreetmap.org/copyright',
      license: 'ODbL',
    });
  });

  it('asks Nominatim with the agreed parameters, bounded to Washington', async () => {
    mocks.fetchJson.mockResolvedValueOnce(spaceNeedle);
    await geocode('Space Needle');
    const url = lastFetchedUrl();
    expect(url.host).toBe('nominatim.openstreetmap.org');
    expect(url.pathname).toBe('/search');
    const p = url.searchParams;
    expect(p.get('q')).toBe('space needle');
    expect(p.get('format')).toBe('jsonv2');
    expect(p.get('addressdetails')).toBe('1');
    expect(p.get('extratags')).toBe('1');
    expect(p.get('namedetails')).toBe('1');
    expect(p.get('limit')).toBe('5');
    expect(p.get('countrycodes')).toBe('us');
    expect(p.get('viewbox')).toBe('-124.85,49,-116.92,45.54');
    expect(p.get('bounded')).toBe('1');
    expect(p.get('dedupe')).toBe('1');
    expect(nominatimSearchUrl('space needle')).toBe(url.toString());
  });

  it('marks a Spokane address point as precise and a city as not', async () => {
    mocks.fetchJson.mockResolvedValueOnce(spokaneAddress);
    const places = await geocode('808 W Spokane Falls Blvd, Spokane');
    expect(places).toHaveLength(2);
    const [house, city] = places;
    expect(house?.precise).toBe(true); // place=house node
    expect(house?.address.houseNumber).toBe('808');
    expect(house?.address.road).toBe('West Spokane Falls Boulevard');
    expect(house?.address.city).toBe('Spokane');
    expect(house?.address.county).toBe('Spokane County');
    expect(house?.address.postcode).toBe('99201');
    expect(house?.osm).toEqual({ type: 'node', id: 2884761823 });
    expect(city?.precise).toBe(false); // boundary=administrative relation
    expect(city?.osm).toEqual({ type: 'relation', id: 237916 });
    expect(city?.address.houseNumber).toBeUndefined();
  });

  it('drops results outside Washington: beyond the box, or in another state', async () => {
    // Portland (south of the box), Vancouver BC (north), and Post Falls, which
    // sits inside the rectangle but in Idaho.
    mocks.fetchJson.mockResolvedValueOnce(outsideWa);
    expect(await geocode('Portland')).toEqual([]);
  });

  it('returns [] for an empty answer or a malformed one', async () => {
    mocks.fetchJson.mockResolvedValueOnce(emptyAnswer);
    expect(await geocode('xyzzy nowhere')).toEqual([]);
    mocks.fetchJson.mockResolvedValueOnce({ error: 'oops' });
    expect(await geocode('another nowhere')).toEqual([]);
  });

  it('skips a result with unusable coordinates', () => {
    expect(placeFromNominatim('x', { lat: 'abc', lon: '-122' })).toBeNull();
    expect(placeFromNominatim('x', { display_name: 'no coords' })).toBeNull();
  });

  it('never calls the network for a blank query', async () => {
    expect(await geocode('   ')).toEqual([]);
    expect(mocks.fetchJson).not.toHaveBeenCalled();
    expect(mocks.cached).not.toHaveBeenCalled();
  });

  it('routes every request through the Nominatim rate limiter', async () => {
    mocks.fetchJson.mockResolvedValueOnce(spaceNeedle).mockResolvedValueOnce(spokaneAddress);
    await geocode('Space Needle');
    await geocode('Spokane');
    expect(mocks.limiterFor).toHaveBeenCalledWith('nominatim.openstreetmap.org');
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(2);
  });

  it('caches by normalised query for 30 days, so repeats do not fetch', async () => {
    mocks.fetchJson.mockResolvedValueOnce(spaceNeedle);
    const a = await geocode('Space Needle');
    const b = await geocode('  space   needle ');
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(first(b).point).toEqual(first(a).point);
    const [key, opts] = mocks.cached.mock.calls[0] ?? [];
    expect(key).toBe('geocode:search:space needle');
    expect(opts).toEqual({ ttlMs: GEOCODE_TTL_MS });
    expect(GEOCODE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('lets an HttpError from Nominatim propagate', async () => {
    mocks.fetchJson.mockRejectedValueOnce(new HttpError(429, 'https://nominatim.openstreetmap.org/search'));
    await expect(geocode('Space Needle')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('isPreciseNominatim', () => {
  it.each([
    ['building', { category: 'building', type: 'yes' }, true],
    ['place=house', { category: 'place', type: 'house' }, true],
    ['older json "class" field', { class: 'building', type: 'residential' }, true],
    ['addresstype building', { category: 'amenity', addresstype: 'building' }, true],
    ['rank 30 with house number', { category: 'tourism', place_rank: 30, address: { house_number: '1' } }, true],
    ['rank 30 without house number', { category: 'tourism', place_rank: 30, address: {} }, false],
    ['a street', { category: 'highway', type: 'residential', addresstype: 'road', place_rank: 26 }, false],
    ['a city', { category: 'boundary', type: 'administrative', addresstype: 'city', place_rank: 16 }, false],
  ])('%s', (_label, result, expected) => {
    expect(isPreciseNominatim(result)).toBe(expected);
  });
});

describe('ranking and precision for the query that was typed', () => {
  const PARADISE_QUERY = 'Paradise, Mount Rainier National Park, WA';

  it('reads a street number only from the start of the query', () => {
    expect(streetNumberIn('400 Broad St, Seattle, WA')).toBe('400');
    expect(streetNumberIn('  2a Main St')).toBe('2a');
    expect(hasStreetNumber('400 Broad St, Seattle, WA')).toBe(true);
    expect(hasStreetNumber('Space Needle')).toBe(false);
    expect(hasStreetNumber(PARADISE_QUERY)).toBe(false);
    expect(hasStreetNumber('98101')).toBe(false); // a ZIP code, not a number and a street
    expect(hasStreetNumber('47.6205, -122.3493')).toBe(false);
  });

  it('takes the first comma-separated part as the name the visitor meant', () => {
    expect(queryHead(PARADISE_QUERY)).toBe('paradise');
    expect(queryHead('  Space   Needle ')).toBe('space   needle');
    expect(mentionsQueryHead('Space Needle', spaceNeedle[0]!)).toBe(true);
    expect(mentionsQueryHead(PARADISE_QUERY, paradise[0]!)).toBe(false); // the Enumclaw office
    expect(mentionsQueryHead(PARADISE_QUERY, paradise[1]!)).toBe(true); // the locality
    expect(mentionsQueryHead('', spaceNeedle[0]!)).toBe(false);
    // Typed without commas, the whole line is the first part; the result's own name inside it still counts.
    expect(mentionsQueryHead('Space Needle Seattle WA', spaceNeedle[0]!)).toBe(true);
    expect(mentionsQueryHead('the space needle', spaceNeedle[0]!)).toBe(true);
    expect(mentionsQueryHead('Paradise Mount Rainier National Park WA', paradise[0]!)).toBe(false);
    expect(mentionsQueryHead('Paradise Mount Rainier National Park WA', paradise[1]!)).toBe(true);
    // A result with a tiny name cannot match every query that happens to contain those letters.
    expect(mentionsQueryHead('Paradise', { ...paradise[1]!, name: 'Pa', display_name: 'Pa' })).toBe(false);
  });

  it('calls a building precise only when the query had a street number or names it', () => {
    // The Enumclaw office is a rank-30 result with a house number, so by
    // itself it looks like one building...
    expect(isPreciseNominatim(paradise[0]!)).toBe(true);
    // ...but the visitor asked for Paradise, which it merely mentions.
    expect(isPreciseForQuery(PARADISE_QUERY, paradise[0]!)).toBe(false);
    expect(isPreciseForQuery(PARADISE_QUERY, paradise[1]!)).toBe(false); // a locality is never precise
    expect(isPreciseForQuery('Space Needle', spaceNeedle[0]!)).toBe(true);
    expect(isPreciseForQuery('Space Needle Seattle WA', spaceNeedle[0]!)).toBe(true);
    expect(isPreciseForQuery('400 Broad St, Seattle, WA', spaceNeedle[0]!)).toBe(true);
    // A street number makes any building-level match count, named or not.
    expect(isPreciseForQuery('450 Roosevelt Ave E, Enumclaw, WA', paradise[0]!)).toBe(true);
  });

  it('ranks a place ahead of an office named after it, and keeps the order otherwise', () => {
    expect(rankNominatimResults(PARADISE_QUERY, paradise).map((r) => r.type)).toEqual(['locality', 'government']);
    // With a street number the order is Nominatim's own.
    expect(rankNominatimResults('450 Roosevelt Ave E, Enumclaw, WA', paradise).map((r) => r.type)).toEqual(['government', 'locality']);
    // Nominatim's order is kept within a group, and the input is not changed.
    const reversed = [paradise[1]!, paradise[0]!];
    expect(rankNominatimResults(PARADISE_QUERY, reversed).map((r) => r.type)).toEqual(['locality', 'government']);
    expect(paradise.map((r) => r.type)).toEqual(['government', 'locality']);
    // A result called by the query's first part moves up even as a POI.
    const needleFirst = [paradise[0]!, spaceNeedle[0]!];
    expect(rankNominatimResults('Space Needle', needleFirst).map((r) => r.name)).toEqual(['Space Needle', paradise[0]!.name]);
  });

  it('geocodes "Paradise, Mount Rainier National Park, WA" to the locality, not the Enumclaw office', async () => {
    mocks.fetchJson.mockResolvedValueOnce(paradise);
    const places = await geocode(PARADISE_QUERY);
    expect(places).toHaveLength(2);
    const [best, office] = places;
    expect(best?.displayName).toBe('Paradise, Pierce County, Washington, United States');
    expect(best?.point.lat).toBeCloseTo(46.78602, 4);
    expect(best?.point.lng).toBeCloseTo(-121.73525, 4);
    expect(best?.precise).toBe(false);
    expect(best?.address.county).toBe('Pierce County');
    // The office is still offered, second, and no longer passes for one building.
    expect(office?.address.city).toBe('Enumclaw');
    expect(office?.precise).toBe(false);
    // So the page's "first precise result, else the first" rule picks Paradise.
    expect(places.find((p) => p.precise) ?? places[0]).toBe(best);
  });

  it('keeps the Space Needle precise by name, and a numbered address unchanged', async () => {
    mocks.fetchJson.mockResolvedValueOnce(spaceNeedle);
    expect(first(await geocode('Space Needle')).precise).toBe(true);
    mocks.fetchJson.mockResolvedValueOnce(spaceNeedle);
    expect(first(await geocode('Space Needle Seattle WA')).precise).toBe(true);
    // Named places and a ZIP code are never precise and keep Nominatim's order.
    mocks.fetchJson.mockResolvedValueOnce([paradise[1]!]);
    expect(first(await geocode('Mount Rainier')).precise).toBe(false);
    mocks.fetchJson.mockResolvedValueOnce([paradise[1]!]);
    expect(first(await geocode('PO Box 1, Spokane, WA')).precise).toBe(false);
    mocks.fetchJson.mockResolvedValueOnce([paradise[1]!]);
    expect(first(await geocode('98101')).precise).toBe(false);
    mocks.fetchJson.mockResolvedValueOnce(spaceNeedle);
    const numbered = first(await geocode('400 Broad St, Seattle, WA'));
    expect(numbered.precise).toBe(true);
    expect(numbered.displayName).toMatch(/^Space Needle, 400, Broad Street/);
    expect(numbered.address.houseNumber).toBe('400');
    // The Spokane answer (house point first, city second) keeps Nominatim's order.
    mocks.fetchJson.mockResolvedValueOnce(spokaneAddress);
    const spokane = await geocode('808 W Spokane Falls Blvd, Spokane');
    expect(spokane.map((p) => p.precise)).toEqual([true, false]);
  });

  it('leaves reverse geocoding on the plain building rule (the "query" is only coordinates)', async () => {
    mocks.fetchJson.mockResolvedValueOnce(reverseAnswer);
    const place = await reverseGeocode(SEATTLE);
    expect(place?.precise).toBe(isPreciseNominatim(reverseAnswer));
  });
});

describe('reverseGeocode', () => {
  it('asks /reverse at zoom 18 and maps the answer', async () => {
    mocks.fetchJson.mockResolvedValueOnce(reverseAnswer);
    const place = await reverseGeocode(SEATTLE);
    const url = lastFetchedUrl();
    expect(url.host).toBe('nominatim.openstreetmap.org');
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('zoom')).toBe('18');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('addressdetails')).toBe('1');
    expect(Number(url.searchParams.get('lat'))).toBeCloseTo(SEATTLE.lat, 4);
    expect(Number(url.searchParams.get('lon'))).toBeCloseTo(SEATTLE.lng, 4);

    expect(place).not.toBeNull();
    expect(place?.query).toBe('47.62050, -122.34930');
    expect(place?.osm).toEqual({ type: 'node', id: 3359850618 });
    expect(place?.address.houseNumber).toBe('400');
    expect(place?.address.city).toBe('Seattle');
    expect(place?.source.name).toBe('OpenStreetMap contributors (via Nominatim)');
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it('returns null for a point outside Washington without a request', async () => {
    expect(await reverseGeocode(PORTLAND)).toBeNull();
    expect(mocks.fetchJson).not.toHaveBeenCalled();
  });

  it('returns null when Nominatim cannot name the spot', async () => {
    mocks.fetchJson.mockResolvedValueOnce(reverseError);
    expect(await reverseGeocode({ lng: -124.5, lat: 47.9 })).toBeNull();
  });

  it('caches by rounded coordinates', async () => {
    mocks.fetchJson.mockResolvedValueOnce(reverseAnswer);
    await reverseGeocode(SEATTLE);
    await reverseGeocode({ lng: SEATTLE.lng + 0.000001, lat: SEATTLE.lat - 0.000001 });
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    const [key] = mocks.cached.mock.calls[0] ?? [];
    expect(key).toBe('geocode:reverse:47.62050,-122.34930');
  });
});

describe('geocodePhoton', () => {
  it('maps GeoJSON features to Places and drops those outside Washington', async () => {
    mocks.fetchJson.mockResolvedValueOnce(photonSpaceNeedle);
    const places = await geocodePhoton('Space Needle');
    const url = lastFetchedUrl();
    expect(url.host).toBe('photon.komoot.io');
    expect(url.pathname).toBe('/api/');
    expect(url.searchParams.get('q')).toBe('space needle');
    expect(url.searchParams.get('bbox')).toBe('-124.85,45.54,-116.92,49');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('lang')).toBe('en');

    expect(places).toHaveLength(1); // the Portland feature is dropped
    const place = first(places);
    expect(place.point).toEqual({ lng: -122.3492774, lat: 47.6205063 });
    expect(place.osm).toEqual({ type: 'way', id: 12903132 });
    expect(place.precise).toBe(true);
    expect(place.displayName).toBe(
      'Space Needle, 400 Broad Street, Uptown, Seattle, King County, Washington, 98109, United States',
    );
    expect(place.address).toEqual({
      houseNumber: '400',
      road: 'Broad Street',
      neighbourhood: 'Belltown',
      suburb: 'Uptown',
      city: 'Seattle',
      county: 'King County',
      state: 'Washington',
      postcode: '98109',
      country: 'United States',
    });
    expect(place.source).toEqual({ name: 'OpenStreetMap contributors (via Photon)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL' });
    expect(mocks.limiterFor).toHaveBeenCalledWith('photon.komoot.io');
  });

  it('returns [] for a malformed answer', async () => {
    mocks.fetchJson.mockResolvedValueOnce({ type: 'FeatureCollection' });
    expect(await geocodePhoton('anything')).toEqual([]);
  });
});

describe('geocodeWithFallback', () => {
  it('uses Nominatim alone when it answers', async () => {
    mocks.fetchJson.mockResolvedValueOnce(spaceNeedle);
    const places = await geocodeWithFallback('Space Needle');
    expect(first(places).source.name).toBe('OpenStreetMap contributors (via Nominatim)');
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
  });

  it('falls back to Photon when Nominatim throws HttpError 429', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.fetchJson
      .mockRejectedValueOnce(new HttpError(429, 'https://nominatim.openstreetmap.org/search'))
      .mockResolvedValueOnce(photonSpaceNeedle);
    const places = await geocodeWithFallback('Space Needle');
    expect(mocks.fetchJson).toHaveBeenCalledTimes(2);
    expect(lastFetchedUrl().host).toBe('photon.komoot.io');
    expect(first(places).source.name).toBe('OpenStreetMap contributors (via Photon)');
    expect(first(places).osm).toEqual({ type: 'way', id: 12903132 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 429'));
    warn.mockRestore();
  });

  it('falls back to Photon when Nominatim finds nothing', async () => {
    mocks.fetchJson.mockResolvedValueOnce(emptyAnswer).mockResolvedValueOnce(photonSpaceNeedle);
    const places = await geocodeWithFallback('Space Needle');
    expect(places).toHaveLength(1);
    expect(first(places).source.name).toBe('OpenStreetMap contributors (via Photon)');
  });

  it('returns [] when both services find nothing', async () => {
    mocks.fetchJson.mockResolvedValueOnce(emptyAnswer).mockResolvedValueOnce({ features: [] });
    expect(await geocodeWithFallback('nowhere at all')).toEqual([]);
  });

  it('rethrows when Nominatim and Photon both fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.fetchJson
      .mockRejectedValueOnce(new HttpError(503, 'https://nominatim.openstreetmap.org/search'))
      .mockRejectedValueOnce(new HttpError(500, 'https://photon.komoot.io/api/'));
    await expect(geocodeWithFallback('Space Needle')).rejects.toMatchObject({ status: 500 });
    warn.mockRestore();
  });

  it('reverse-geocodes when the visitor typed coordinates', async () => {
    mocks.fetchJson.mockResolvedValueOnce(reverseAnswer);
    const places = await geocodeWithFallback('47.6205, -122.3493');
    expect(lastFetchedUrl().pathname).toBe('/reverse');
    expect(places).toHaveLength(1);
    expect(first(places).address.road).toBe('Broad Street');
  });
});

describe('parseLngLat and formatLngLat', () => {
  it.each([
    ['47.6205, -122.3493', { lat: 47.6205, lng: -122.3493 }],
    ['47.6205,-122.3493', { lat: 47.6205, lng: -122.3493 }],
    ['  47.6205   -122.3493 ', { lat: 47.6205, lng: -122.3493 }],
    ['47.6205; -122.3493', { lat: 47.6205, lng: -122.3493 }],
    ['(47.6205, -122.3493)', { lat: 47.6205, lng: -122.3493 }],
    ['@47.6205,-122.3493', { lat: 47.6205, lng: -122.3493 }],
    ['geo:47.6205,-122.3493', { lat: 47.6205, lng: -122.3493 }],
    ['-33.9, 151.2', { lat: -33.9, lng: 151.2 }],
    ['47, -122', { lat: 47, lng: -122 }],
  ])('parses %j', (text, expected) => {
    expect(parseLngLat(text)).toEqual({ lng: expected.lng, lat: expected.lat });
  });

  it.each([
    'Space Needle',
    '400 Broad St',
    '',
    '47.6205',
    '100, 200',
    '47.6, -181',
    '12 34 Ave NE',
    'lat=47.6, lng=-122.3',
  ])('rejects %j', (text) => {
    expect(parseLngLat(text)).toBeNull();
  });

  it('round-trips through formatLngLat', () => {
    const text = formatLngLat(SEATTLE);
    expect(text).toBe('47.62050, -122.34930');
    expect(parseLngLat(text)).toEqual({ lng: -122.3493, lat: 47.6205 });
  });
});
