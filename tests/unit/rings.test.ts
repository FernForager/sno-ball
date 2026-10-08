/**
 * Tests for the ring model (rings.ts), the county-to-region table
 * (data/wa-regions.ts) and the Seattle extras (seattle.ts).
 *
 * No network ever runs here. fetchJson is mocked and answers from the JSON
 * files in tests/fixtures/rings/. Provenance of those fixtures:
 *   - seattle-nhood-*, seattle-annexation-*, seattle-parcel-*,
 *     seattle-landmarks-near-*: REAL responses captured from Seattle GeoData
 *     on 2026-10-07 (copied from branch helper/fixtures-1, see its
 *     tests/fixtures/live/README.md for the exact request URLs).
 *   - arcgis-empty.json and arcgis-error.json: written by hand in the shapes
 *     ArcGIS uses for "no features" and for a rejected query.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressParts, Fact, LngLat, Place, Ring, WaRegion } from '../../src/lib/types';
import { RING_ORDER } from '../../src/lib/types';
import nhoodSpaceNeedle from '../fixtures/rings/seattle-nhood-space-needle.json';
import annexSpaceNeedle from '../fixtures/rings/seattle-annexation-space-needle.json';
import annexWedgwood from '../fixtures/rings/seattle-annexation-wedgwood.json';
import parcelSpaceNeedle from '../fixtures/rings/seattle-parcel-space-needle.json';
import parcelWedgwood from '../fixtures/rings/seattle-parcel-wedgwood.json';
import landmarksSpaceNeedle from '../fixtures/rings/seattle-landmarks-near-space-needle.json';
import arcgisEmpty from '../fixtures/rings/arcgis-empty.json';
import arcgisError from '../fixtures/rings/arcgis-error.json';

// ---------------------------------------------------------------------------
// Mocks for the shared infrastructure (same pattern as geocode.test.ts):
//  - fetchJson answers from fixtures
//  - the rate limiter runs the task at once
//  - the cache is a Map, so we can check that a repeat lookup does not fetch
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

import {
  COUNTY_REGION,
  REGION_BLURB,
  WA_REGIONS,
  normaliseCountyName,
  regionOf,
} from '../../src/data/wa-regions';
import {
  RING_LABELS,
  addRingFacts,
  buildRings,
  cityName,
  isRingBusy,
  markRingBusy,
  missingNumberNote,
  ringByLevel,
  ringName,
  setRingFacts,
  setRingNote,
  statusForFacts,
  updateRing,
} from '../../src/lib/rings';
import {
  FIRST_LANDMARK_YEAR,
  LANDMARKS_SOURCE,
  LANDMARK_RADIUS_M,
  MAX_LANDMARKS,
  NEIGHBORHOOD_SOURCE,
  PARCEL_SOURCE,
  SEATTLE_GEODATA_BASE,
  SEATTLE_TTL_MS,
  annexationFact,
  distanceMetres,
  envelopeAround,
  isSeattle,
  landmarkFacts,
  landmarkYear,
  parcelFacts,
  seattleAnnexation,
  seattleLandmarksNear,
  seattleNeighborhood,
  seattleParcel,
  tidyAssessorText,
} from '../../src/lib/seattle';

// ---------------------------------------------------------------------------
// Test places, shaped like what geocode.ts produces from real Nominatim
// answers (see tests/fixtures/geocode/).
// ---------------------------------------------------------------------------

const SPACE_NEEDLE: LngLat = { lng: -122.3493, lat: 47.6205 };
const WEDGWOOD: LngLat = { lng: -122.2903, lat: 47.6903 };

const OSM_SOURCE = { name: 'OpenStreetMap Nominatim', url: 'https://nominatim.org', license: 'ODbL' };

/** A precise match on the Space Needle building. */
const spaceNeedlePlace: Place = {
  query: '400 Broad St Seattle WA',
  point: SPACE_NEEDLE,
  displayName: 'Space Needle, 400, Broad Street, Belltown, Uptown, Seattle, King County, Washington, 98109, United States',
  address: {
    houseNumber: '400',
    road: 'Broad Street',
    neighbourhood: 'Belltown',
    suburb: 'Uptown',
    city: 'Seattle',
    county: 'King County',
    state: 'Washington',
    postcode: '98109',
    country: 'United States',
  },
  osm: { type: 'way', id: 12903132 },
  precise: true,
  source: OSM_SOURCE,
};

/** A search that only matched a street in Spokane, not one lot. */
const spokaneStreetPlace: Place = {
  query: 'Spokane Falls Blvd Spokane',
  point: { lng: -117.426, lat: 47.6588 },
  displayName: 'West Spokane Falls Boulevard, Riverside, Spokane, Spokane County, Washington, United States',
  address: {
    road: 'West Spokane Falls Boulevard',
    neighbourhood: 'Riverside',
    city: 'Spokane',
    county: 'Spokane County',
    state: 'Washington',
    country: 'United States',
  },
  precise: false,
  source: OSM_SOURCE,
};

/** A rural address: no neighbourhood, no city, Walla Walla County. */
const ruralPlace: Place = {
  query: '1234 Old Milton Hwy Walla Walla',
  point: { lng: -118.3, lat: 46.03 },
  displayName: '1234, Old Milton Highway, Walla Walla County, Washington, United States',
  address: {
    houseNumber: '1234',
    road: 'Old Milton Highway',
    county: 'Walla Walla County',
    state: 'Washington',
    country: 'United States',
  },
  precise: true,
  source: OSM_SOURCE,
};

function fact(kind: string, title: string): Fact {
  return { kind, title, source: { name: 'test', url: 'https://example.test' } };
}

/** A copy of the address parts with one key left out (`key: undefined` is not allowed with exactOptionalPropertyTypes). */
function without(address: AddressParts, key: keyof AddressParts): AddressParts {
  const copy = { ...address };
  delete copy[key];
  return copy;
}

/** The ring at a level, failing loudly when it is missing. */
function ring(rings: Ring[], level: Ring['level']): Ring {
  const r = ringByLevel(rings, level);
  if (!r) throw new Error(`no ${level} ring`);
  return r;
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

// ===========================================================================
// wa-regions
// ===========================================================================

describe('COUNTY_REGION', () => {
  it('covers all 39 counties, each with a known region', () => {
    const names = Object.keys(COUNTY_REGION);
    expect(names).toHaveLength(39);
    expect(new Set(names).size).toBe(39);
    for (const name of names) {
      expect(name).not.toMatch(/county/i);
      expect(WA_REGIONS).toContain(COUNTY_REGION[name]);
    }
  });

  it('uses every one of the ten regions at least once', () => {
    const used = new Set<WaRegion>(Object.values(COUNTY_REGION));
    expect(WA_REGIONS).toHaveLength(10);
    for (const region of WA_REGIONS) expect(used.has(region)).toBe(true);
  });

  it('places the big cities where a Washingtonian would expect', () => {
    expect(COUNTY_REGION['King']).toBe('Puget Sound');
    expect(COUNTY_REGION['Spokane']).toBe('Northeast Washington');
    expect(COUNTY_REGION['Clark']).toBe('Southwest Washington');
    expect(COUNTY_REGION['Yakima']).toBe('Yakima Valley');
    expect(COUNTY_REGION['Whitman']).toBe('Palouse and Blue Mountains');
    expect(COUNTY_REGION['Clallam']).toBe('Olympic Peninsula');
    expect(COUNTY_REGION['Grant']).toBe('Columbia Basin');
  });
});

describe('REGION_BLURB', () => {
  it('has two sentences for every region', () => {
    for (const region of WA_REGIONS) {
      const blurb = REGION_BLURB[region];
      expect(blurb.length).toBeGreaterThan(80);
      // Two sentence endings: a . ? or ! followed by a space or the end of the
      // text, not counting the abbreviation in "Mount St. Helens".
      const endings = blurb.match(/(?<!\bSt)[.?!](?=\s|$)/g) ?? [];
      expect(endings, `${region}: ${blurb}`).toHaveLength(2);
    }
  });
});

describe('regionOf', () => {
  it.each([
    ['King County', 'Puget Sound'],
    ['King', 'Puget Sound'],
    ['king county', 'Puget Sound'],
    ['  KING  ', 'Puget Sound'],
    ['Walla Walla County', 'Palouse and Blue Mountains'],
    ['Pend Oreille', 'Northeast Washington'],
    ['San Juan County', 'Puget Sound'],
  ])('%s -> %s', (county, region) => {
    expect(regionOf(county)).toBe(region);
  });

  it('is undefined for places that are not Washington counties', () => {
    expect(regionOf('Multnomah County')).toBeUndefined();
    expect(regionOf('')).toBeUndefined();
    expect(regionOf('County')).toBeUndefined();
  });

  it('normalises names the way geocoders write them', () => {
    expect(normaliseCountyName('Grays  Harbor County')).toBe('grays harbor');
    expect(normaliseCountyName('Lewis')).toBe('lewis');
  });
});

// ===========================================================================
// rings
// ===========================================================================

describe('buildRings', () => {
  it('builds one ring per level, in RING_ORDER', () => {
    const rings = buildRings(spaceNeedlePlace);
    expect(rings.map((r) => r.level)).toEqual([...RING_ORDER]);
    expect(Object.keys(RING_LABELS).sort()).toEqual([...RING_ORDER].sort());
  });

  it('names every ring for a precise Seattle address and marks them all loading', () => {
    const rings = buildRings(spaceNeedlePlace);
    expect(rings.map((r) => r.name)).toEqual([
      '400 Broad Street',
      'The block of Broad Street',
      'Broad Street',
      'Belltown', // neighbourhood wins over suburb ("Uptown")
      'Seattle',
      'King County',
      'Puget Sound',
      'Washington',
      'North American Plate',
    ]);
    for (const r of rings) {
      expect(r.status).toBe('loading');
      expect(r.facts).toEqual([]);
      expect(r.note).toBeUndefined();
    }
  });

  it('leaves the house ring empty, with a friendly note, for a non-precise match', () => {
    const rings = buildRings(spokaneStreetPlace);
    const house = ring(rings, 'house');
    expect(house.status).toBe('empty');
    expect(house.name).toBe('This spot');
    expect(house.note).toBe('This search matched a general area, not a specific lot.');

    // Everything else is still named from the address.
    expect(ring(rings, 'block').name).toBe('The block of West Spokane Falls Boulevard');
    expect(ring(rings, 'street').name).toBe('West Spokane Falls Boulevard');
    expect(ring(rings, 'neighborhood').name).toBe('Riverside');
    expect(ring(rings, 'city').name).toBe('Spokane');
    expect(ring(rings, 'county').name).toBe('Spokane County');
    expect(ring(rings, 'region').name).toBe('Northeast Washington');
    for (const level of RING_ORDER.filter((l) => l !== 'house')) {
      expect(ring(rings, level).status).toBe('loading');
    }
  });

  it('falls back to the suburb when there is no neighbourhood', () => {
    const place: Place = { ...spaceNeedlePlace, address: without(spaceNeedlePlace.address, 'neighbourhood') };
    expect(ring(buildRings(place), 'neighborhood')).toMatchObject({ name: 'Uptown', status: 'loading' });
  });

  it('marks neighborhood and city empty for a rural address, but still finds the region', () => {
    const rings = buildRings(ruralPlace);
    expect(ring(rings, 'house')).toMatchObject({ name: '1234 Old Milton Highway', status: 'loading' });
    // A plain heading, not "This neighborhood", so the headings outline reads cleanly.
    expect(ring(rings, 'neighborhood')).toMatchObject({
      name: 'Neighborhood',
      status: 'empty',
      note: 'No named neighborhood here in OpenStreetMap.',
    });
    expect(ring(rings, 'city')).toMatchObject({ name: 'Unincorporated area', status: 'empty' });
    expect(ring(rings, 'city').note).toMatch(/not inside a city or town/);
    expect(ring(rings, 'county')).toMatchObject({ name: 'Walla Walla County', status: 'loading' });
    expect(ring(rings, 'region')).toMatchObject({ name: 'Palouse and Blue Mountains', status: 'loading' });
  });

  it('tells the visitor when the number they typed is not on the map and the street was used instead', () => {
    // "2 N Main St, Omak, WA": Nominatim knew the street but not number 2.
    const omak: Place = {
      query: '2 N Main St, Omak, WA',
      point: { lng: -119.52851, lat: 48.40696 },
      displayName: 'Main Street South, Omak, Okanogan County, Washington, 98841, United States',
      address: { road: 'Main Street South', city: 'Omak', county: 'Okanogan County', state: 'Washington', postcode: '98841', country: 'United States' },
      precise: false,
      source: OSM_SOURCE,
    };
    expect(missingNumberNote(omak)).toBe("Number 2 isn't on the map yet, so this is the street.");
    const house = ring(buildRings(omak), 'house');
    expect(house).toMatchObject({ name: 'This spot', status: 'empty', note: "Number 2 isn't on the map yet, so this is the street." });
    expect(house.facts).toEqual([]);
    // The rest of the rings are unaffected.
    expect(ring(buildRings(omak), 'street')).toMatchObject({ name: 'Main Street South', status: 'loading' });

    // A query without a number keeps the general note; so does a result that does carry the number.
    expect(missingNumberNote(spokaneStreetPlace)).toBeUndefined();
    expect(ring(buildRings(spokaneStreetPlace), 'house').note).toBe('This search matched a general area, not a specific lot.');
    expect(missingNumberNote({ ...omak, address: { ...omak.address, houseNumber: '2' } })).toBeUndefined();
    // A number typed, but the match has no street at all (a town): "this is the street" would be false.
    expect(missingNumberNote({ ...omak, address: { city: 'Omak', county: 'Okanogan County' } })).toBeUndefined();
    expect(ring(buildRings({ ...omak, address: { city: 'Omak', county: 'Okanogan County' } }), 'house').note).toBe(
      'This search matched a general area, not a specific lot.',
    );
    // A ZIP code is not a street number.
    expect(missingNumberNote({ ...omak, query: '98841' })).toBeUndefined();
  });

  it('says "This lot" for a precise match without a house number or road', () => {
    const place: Place = { ...spaceNeedlePlace, address: without(spaceNeedlePlace.address, 'houseNumber') };
    expect(ring(buildRings(place), 'house').name).toBe('This lot');
  });

  it('marks county and region empty when the county is unknown', () => {
    const place: Place = { ...ruralPlace, address: without(ruralPlace.address, 'county') };
    const rings = buildRings(place);
    expect(ring(rings, 'county')).toMatchObject({ name: 'This county', status: 'empty' });
    expect(ring(rings, 'region')).toMatchObject({ name: 'This region', status: 'empty' });
    expect(ring(rings, 'region').note).toMatch(/corner of Washington/);
  });

  it('marks region empty for a county it cannot place, and treats blank parts as missing', () => {
    const place: Place = {
      ...ruralPlace,
      address: { ...ruralPlace.address, county: 'Multnomah County', road: '   ' },
    };
    const rings = buildRings(place);
    expect(ring(rings, 'region').status).toBe('empty');
    expect(ring(rings, 'street').status).toBe('empty');
    expect(ring(rings, 'block').status).toBe('empty');
    expect(ring(rings, 'house').name).toBe('This lot');
  });

  it('gives each ring its own facts array (no sharing between rings or calls)', () => {
    const a = buildRings(spaceNeedlePlace);
    const b = buildRings(spaceNeedlePlace);
    expect(ring(a, 'house').facts).not.toBe(ring(a, 'city').facts);
    expect(ring(a, 'house').facts).not.toBe(ring(b, 'house').facts);
  });
});

describe('ringName and cityName', () => {
  it('prefers city, then town, then village', () => {
    expect(cityName({ city: 'Seattle', town: 'X' })).toBe('Seattle');
    expect(cityName({ town: 'Coupeville' })).toBe('Coupeville');
    expect(cityName({ village: 'Index' })).toBe('Index');
    expect(cityName({})).toBeUndefined();
  });

  it('is undefined for the house when the match is not precise', () => {
    expect(ringName('house', spokaneStreetPlace)).toBeUndefined();
    expect(ringName('house', spaceNeedlePlace)).toBe('400 Broad Street');
  });
});

describe('isRingBusy and markRingBusy', () => {
  it('is busy while loading, or while facts are shown but a source is still pending', () => {
    expect(isRingBusy('loading', 0)).toBe(true);
    expect(isRingBusy('loading', 2)).toBe(true);
    // The Ballard case from the QA sweep: one loader landed, another is still out.
    expect(isRingBusy('thin', 1)).toBe(true);
    expect(isRingBusy('rich', 1)).toBe(true);
    expect(isRingBusy('thin', 0)).toBe(false);
    expect(isRingBusy('rich', 0)).toBe(false);
    // An empty ring's note is final; a loader that will name it sets 'loading' first.
    expect(isRingBusy('empty', 1)).toBe(false);
    expect(isRingBusy('empty', 0)).toBe(false);
  });

  it('sets or clears the flag, returning the same object when nothing changes', () => {
    const base = ring(buildRings(spaceNeedlePlace), 'city');
    expect(base.busy).toBeUndefined();
    expect(markRingBusy(base, false)).toBe(base);
    const busy = markRingBusy(base, true);
    expect(busy).not.toBe(base);
    expect(busy).toMatchObject({ level: 'city', name: 'Seattle', busy: true });
    expect(base.busy).toBeUndefined(); // the original is untouched
    expect(markRingBusy(busy, true)).toBe(busy);
    const cleared = markRingBusy(busy, false);
    expect(cleared).not.toBe(busy);
    expect('busy' in cleared).toBe(false); // removed, never an explicit undefined
    expect(cleared).toEqual(base);
  });
});

describe('statusForFacts', () => {
  it('follows the 0 / 1 / 2+ rule', () => {
    expect(statusForFacts([])).toBe('empty');
    expect(statusForFacts([fact('a', 'A')])).toBe('thin');
    expect(statusForFacts([fact('a', 'A'), fact('b', 'B')])).toBe('rich');
    expect(statusForFacts([fact('a', 'A'), fact('b', 'B'), fact('c', 'C')])).toBe('rich');
  });
});

describe('setRingFacts', () => {
  const base = buildRings(spaceNeedlePlace);
  const two = [fact('year-built', 'Built in 1961'), fact('renovated', 'Renovated in 2013')];

  it('replaces the facts and derives the status: 2+ rich', () => {
    const next = setRingFacts(base, 'house', two);
    expect(ring(next, 'house')).toMatchObject({ status: 'rich', facts: two });
  });

  it('1 fact is thin, 0 facts is empty', () => {
    expect(ring(setRingFacts(base, 'city', [two[0]!]), 'city').status).toBe('thin');
    expect(ring(setRingFacts(base, 'city', []), 'city').status).toBe('empty');
  });

  it('accepts an explicit status', () => {
    expect(ring(setRingFacts(base, 'city', [], 'loading'), 'city').status).toBe('loading');
    expect(ring(setRingFacts(base, 'city', two, 'thin'), 'city').status).toBe('thin');
  });

  it('never modifies the input and keeps untouched rings by reference', () => {
    const before = JSON.stringify(base);
    const next = setRingFacts(base, 'house', two);
    expect(JSON.stringify(base)).toBe(before);
    expect(next).not.toBe(base);
    expect(ring(next, 'house')).not.toBe(ring(base, 'house'));
    expect(ring(next, 'city')).toBe(ring(base, 'city'));
    expect(ring(base, 'house').facts).toEqual([]);
  });

  it('copies the facts array so later pushes do not leak in', () => {
    const facts = [two[0]!];
    const next = setRingFacts(base, 'house', facts);
    facts.push(two[1]!);
    expect(ring(next, 'house').facts).toHaveLength(1);
  });

  it('keeps the note while the ring stays empty and drops it once facts arrive', () => {
    const rings = buildRings(spokaneStreetPlace); // house ring is empty with a note
    const stillEmpty = setRingFacts(rings, 'house', []);
    expect(ring(stillEmpty, 'house').note).toBe('This search matched a general area, not a specific lot.');
    const filled = setRingFacts(rings, 'house', two);
    expect(ring(filled, 'house').note).toBeUndefined();
    expect(ring(filled, 'house').status).toBe('rich');
  });

  it('does nothing visible for a level that is not present', () => {
    const only = [ring(base, 'city')];
    expect(setRingFacts(only, 'house', two)).toEqual(only);
  });
});

describe('addRingFacts, setRingNote, updateRing, ringByLevel', () => {
  const base = buildRings(spaceNeedlePlace);

  it('addRingFacts appends and recomputes the status', () => {
    const one = addRingFacts(base, 'house', [fact('year-built', 'Built in 1961')]);
    expect(ring(one, 'house').status).toBe('thin');
    const two = addRingFacts(one, 'house', [fact('landmark', 'Space Needle')]);
    expect(ring(two, 'house').status).toBe('rich');
    expect(ring(two, 'house').facts.map((f) => f.kind)).toEqual(['year-built', 'landmark']);
    expect(ring(base, 'house').facts).toEqual([]);
  });

  it('setRingNote adds and removes a note without touching anything else', () => {
    const noted = setRingNote(base, 'house', 'No records for this lot in open data yet.');
    expect(ring(noted, 'house').note).toBe('No records for this lot in open data yet.');
    expect(ring(noted, 'house').status).toBe('loading');
    const cleared = setRingNote(noted, 'house', undefined);
    expect('note' in ring(cleared, 'house')).toBe(false);
  });

  it('updateRing applies a change to one ring only', () => {
    const next = updateRing(base, 'city', (r) => ({ ...r, wikipedia: 'Seattle' }));
    expect(ring(next, 'city').wikipedia).toBe('Seattle');
    expect(ring(next, 'county').wikipedia).toBeUndefined();
  });

  it('ringByLevel finds a ring or returns undefined', () => {
    expect(ringByLevel(base, 'plate')?.name).toBe('North American Plate');
    expect(ringByLevel([], 'plate')).toBeUndefined();
  });
});

// ===========================================================================
// seattle
// ===========================================================================

describe('isSeattle', () => {
  it('is true for a place whose city is Seattle, in any case', () => {
    expect(isSeattle(spaceNeedlePlace)).toBe(true);
    expect(isSeattle({ ...spaceNeedlePlace, address: { city: ' seattle ' } })).toBe(true);
    expect(isSeattle({ ...spaceNeedlePlace, address: { town: 'Seattle' } })).toBe(true);
  });

  it('is false elsewhere or when the city is unknown', () => {
    expect(isSeattle(spokaneStreetPlace)).toBe(false);
    expect(isSeattle(ruralPlace)).toBe(false);
    expect(isSeattle({ ...spaceNeedlePlace, address: { county: 'King County' } })).toBe(false);
  });
});

describe('helpers', () => {
  it('tidyAssessorText title-cases ALL CAPS and leaves mixed case alone', () => {
    expect(tidyAssessorText('400   BROAD ST')).toBe('400 Broad St');
    expect(tidyAssessorText('SPACE NEEDLE')).toBe('Space Needle');
    expect(tidyAssessorText('Rite-Aid Drugstore')).toBe('Rite-Aid Drugstore');
    expect(tidyAssessorText('DRUG STORE')).toBe('Drug Store');
    expect(tidyAssessorText('   ')).toBeUndefined();
    expect(tidyAssessorText(null)).toBeUndefined();
  });

  it('distanceMetres matches a known distance', () => {
    const monorail: LngLat = { lng: -122.34969722424917, lat: 47.62124047890483 };
    expect(distanceMetres(SPACE_NEEDLE, monorail)).toBeCloseTo(87.6, 0);
    expect(distanceMetres(SPACE_NEEDLE, SPACE_NEEDLE)).toBe(0);
  });

  it('envelopeAround converts metres to degrees around the point', () => {
    const e = envelopeAround(SPACE_NEEDLE, 400);
    expect(e.north - SPACE_NEEDLE.lat).toBeCloseTo(0.003593, 5);
    expect(SPACE_NEEDLE.lat - e.south).toBeCloseTo(0.003593, 5);
    expect(e.east - SPACE_NEEDLE.lng).toBeCloseTo(0.005331, 5);
    expect(SPACE_NEEDLE.lng - e.west).toBeCloseTo(0.005331, 5);
  });

  it('landmarkYear reads epoch ms and rejects the 1899 placeholder and nulls', () => {
    expect(landmarkYear(888940800000)).toBe(1998); // Space Needle
    expect(landmarkYear(1059955200000)).toBe(2003); // Monorail
    expect(landmarkYear(-2209161600000)).toBeUndefined(); // 1899-12-30 "no date"
    expect(landmarkYear(null)).toBeUndefined();
    expect(landmarkYear(undefined)).toBeUndefined();
    expect(landmarkYear('1998')).toBeUndefined();
    expect(FIRST_LANDMARK_YEAR).toBe(1973);
  });
});

describe('seattleNeighborhood', () => {
  it('returns district, neighborhood and alt names for the Space Needle', async () => {
    mocks.fetchJson.mockResolvedValueOnce(nhoodSpaceNeedle);
    const hood = await seattleNeighborhood(SPACE_NEEDLE);
    expect(hood).toEqual({
      district: 'Queen Anne',
      neighborhood: 'Lower Queen Anne',
      altNames: ['Uptown', 'Seattle Center'],
      source: NEIGHBORHOOD_SOURCE,
    });
    expect(NEIGHBORHOOD_SOURCE.license).toBe('PDDL');
  });

  it('asks the nma_nhoods_sub layer with a point-in-polygon query', async () => {
    mocks.fetchJson.mockResolvedValueOnce(nhoodSpaceNeedle);
    await seattleNeighborhood(SPACE_NEEDLE);
    const url = lastFetchedUrl();
    expect(url.origin + url.pathname).toBe(`${SEATTLE_GEODATA_BASE}/nma_nhoods_sub/FeatureServer/0/query`);
    expect(url.searchParams.get('geometry')).toBe('-122.3493,47.6205');
    expect(url.searchParams.get('geometryType')).toBe('esriGeometryPoint');
    expect(url.searchParams.get('inSR')).toBe('4326');
    expect(url.searchParams.get('spatialRel')).toBe('esriSpatialRelIntersects');
    expect(url.searchParams.get('outFields')).toBe('L_HOOD,S_HOOD,S_HOOD_ALT_NAMES');
    expect(url.searchParams.get('returnGeometry')).toBe('false');
    expect(url.searchParams.get('f')).toBe('json');
  });

  it('goes through the cache (7-day TTL) and the rate limiter', async () => {
    mocks.fetchJson.mockResolvedValueOnce(nhoodSpaceNeedle);
    await seattleNeighborhood(SPACE_NEEDLE);
    await seattleNeighborhood({ lng: -122.349300001, lat: 47.6205 }); // same spot within a metre
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.cached).toHaveBeenCalledTimes(2);
    expect(mocks.cached.mock.calls[0]?.[1]).toEqual({ ttlMs: SEATTLE_TTL_MS });
    expect(SEATTLE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(mocks.limiterFor).toHaveBeenCalledWith('services.arcgis.com');
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it('is null when no polygon contains the point', async () => {
    mocks.fetchJson.mockResolvedValueOnce(arcgisEmpty);
    expect(await seattleNeighborhood(WEDGWOOD)).toBeNull();
  });

  it('throws (and caches nothing) when ArcGIS answers with an error payload', async () => {
    mocks.fetchJson.mockResolvedValueOnce(arcgisError);
    await expect(seattleNeighborhood(SPACE_NEEDLE)).rejects.toThrow(/Invalid query parameters/);
    expect(mocks.store.size).toBe(0);
  });
});

describe('seattleAnnexation', () => {
  it('takes the earliest Year of the cumulative polygons (Space Needle -> 1869)', async () => {
    mocks.fetchJson.mockResolvedValueOnce(annexSpaceNeedle);
    const f = await seattleAnnexation(SPACE_NEEDLE);
    expect(f).toMatchObject({
      kind: 'annexed',
      title: 'Became part of Seattle in 1869',
      year: 1869,
      confidence: 'high',
    });
    expect(f?.body).toBe('Area of First Incorporation (Statutes of the Territory of Washington 1869)');
    expect(f?.source.name).toMatch(/City of Seattle/);
    expect(f?.source.url).toMatch(/^https:\/\//);
  });

  it('puts the ordinance number in the body (Wedgwood -> 1953, Ordinance 81655)', async () => {
    mocks.fetchJson.mockResolvedValueOnce(annexWedgwood);
    const f = await seattleAnnexation(WEDGWOOD);
    expect(f?.title).toBe('Became part of Seattle in 1953');
    expect(f?.year).toBe(1953);
    expect(f?.body).toMatch(/^Sand Point District/);
    expect(f?.body).toMatch(/\(Ordinance 81655\)$/);
  });

  it('queries the Annexation layer at the point', async () => {
    mocks.fetchJson.mockResolvedValueOnce(annexWedgwood);
    await seattleAnnexation(WEDGWOOD);
    const url = lastFetchedUrl();
    expect(url.pathname).toMatch(/\/Annexation\/FeatureServer\/0\/query$/);
    expect(url.searchParams.get('geometry')).toBe('-122.2903,47.6903');
    expect(url.searchParams.get('outFields')?.split(',')).toEqual(expect.arrayContaining(['Year', 'Title', 'Ordinance']));
  });

  it('is null for an empty answer', async () => {
    mocks.fetchJson.mockResolvedValueOnce(arcgisEmpty);
    expect(await seattleAnnexation(WEDGWOOD)).toBeNull();
  });

  it('ignores features without a numeric Year (pure function)', () => {
    expect(annexationFact([{ attributes: { Year: null, Title: 'x' } }])).toBeNull();
    const f = annexationFact([
      { attributes: { Year: 1907, Title: 'Later' } },
      { attributes: { Year: null, Title: 'Undated' } },
      { attributes: { Year: 1891, Title: 'Earlier' } },
    ]);
    expect(f?.year).toBe(1891);
    expect(f?.body).toBe('Earlier');
  });
});

describe('seattleParcel', () => {
  it('builds year-built, renovated, landmark and use facts for the Space Needle', async () => {
    mocks.fetchJson.mockResolvedValueOnce(parcelSpaceNeedle);
    const facts = await seattleParcel(SPACE_NEEDLE);
    expect(facts.map((f) => f.kind)).toEqual(['year-built', 'renovated', 'landmark', 'use']);

    const [built, renovated, landmark, use] = facts;
    expect(built).toMatchObject({ title: 'Built in 1961', year: 1961, confidence: 'high' });
    expect(built?.body).toBe('Space Needle, 400 Broad St (parcel 1985200495)');
    expect(renovated).toMatchObject({ title: 'Renovated in 2013', year: 2013 });
    expect(landmark?.title).toBe('Designated Seattle landmark');
    expect(use?.title).toBe('Building type: Space Needle');
    for (const f of facts) {
      expect(f.source).toEqual(PARCEL_SOURCE);
      expect(f.source.name).toBe('King County Assessor via Seattle GeoData');
    }
  });

  it('skips the landmark fact when LANDMARK is null (Wedgwood drugstore)', async () => {
    mocks.fetchJson.mockResolvedValueOnce(parcelWedgwood);
    const facts = await seattleParcel(WEDGWOOD);
    expect(facts.map((f) => f.kind)).toEqual(['year-built', 'renovated', 'use']);
    expect(facts[0]?.body).toBe('Rite-Aid Drugstore, 8512 35th Ave Ne (parcel 6844701790)');
    expect(facts[2]?.title).toBe('Building type: Drug Store');
  });

  it('asks PARCEL_GEO for exactly the documented fields', async () => {
    mocks.fetchJson.mockResolvedValueOnce(parcelSpaceNeedle);
    await seattleParcel(SPACE_NEEDLE);
    const url = lastFetchedUrl();
    expect(url.pathname).toMatch(/\/PARCEL_GEO\/FeatureServer\/0\/query$/);
    expect(url.searchParams.get('outFields')).toBe('PIN,ADDRESS,PROP_NAME,YR_BUILT_MAX,YR_RENOV_MAX,NR_BLDGS,LANDMARK,BLDG_DESC');
    expect(url.searchParams.get('returnGeometry')).toBe('false');
  });

  it('is empty when there is no parcel', async () => {
    mocks.fetchJson.mockResolvedValueOnce(arcgisEmpty);
    expect(await seattleParcel(WEDGWOOD)).toEqual([]);
  });

  it('prefers a polygon with a PIN over a right-of-way sliver', async () => {
    mocks.fetchJson.mockResolvedValueOnce({
      features: [
        { attributes: { PIN: ' ', ADDRESS: null, PROP_NAME: null, YR_BUILT_MAX: '0', YR_RENOV_MAX: '0', NR_BLDGS: 0, LANDMARK: null, BLDG_DESC: null } },
        { attributes: { PIN: '1234567890', ADDRESS: '1 MAIN ST', PROP_NAME: null, YR_BUILT_MAX: '1926', YR_RENOV_MAX: '0', NR_BLDGS: 3, LANDMARK: 'N', BLDG_DESC: 'APARTMENT' } },
      ],
    });
    const facts = await seattleParcel(WEDGWOOD);
    expect(facts.map((f) => f.kind)).toEqual(['year-built', 'use']);
    expect(facts[0]?.body).toBe('Newest of 3 buildings on this parcel. 1 Main St (parcel 1234567890)');
  });

  it('parcelFacts gives nothing for a parcel with no usable fields', () => {
    expect(parcelFacts({})).toEqual([]);
    expect(parcelFacts({ YR_BUILT_MAX: '0', YR_RENOV_MAX: 0, LANDMARK: 'N', BLDG_DESC: '  ' })).toEqual([]);
  });
});

describe('seattleLandmarksNear', () => {
  it('returns the five nearest distinct landmarks, nearest first', async () => {
    mocks.fetchJson.mockResolvedValueOnce(landmarksSpaceNeedle);
    const facts = await seattleLandmarksNear(SPACE_NEEDLE);
    expect(facts).toHaveLength(MAX_LANDMARKS);
    expect(facts.map((f) => f.title)).toEqual([
      'Space Needle',
      'Seattle Monorail', // five pylons in the fixture; only the nearest counts
      'Horiuchi Mural',
      'Seattle Center House-Armory',
      'Pacific Science Center',
    ]);
    expect(facts[0]).toMatchObject({ kind: 'landmark', year: 1998, confidence: 'high', source: LANDMARKS_SOURCE });
    expect(facts[0]?.body).toBe('219 Fourth Av. Designated a Seattle landmark in 1998, at this spot.');
    expect(facts[1]?.year).toBe(2003);
    expect(facts[1]?.body).toMatch(/about (290|300|310) feet away\.$/); // about 90 m, in feet
  });

  it('queries an envelope around the point and asks for geometry back in 4326', async () => {
    mocks.fetchJson.mockResolvedValueOnce(landmarksSpaceNeedle);
    await seattleLandmarksNear(SPACE_NEEDLE);
    const url = lastFetchedUrl();
    expect(url.pathname).toMatch(/\/Landmarks\/FeatureServer\/0\/query$/);
    expect(url.searchParams.get('geometryType')).toBe('esriGeometryEnvelope');
    expect(url.searchParams.get('inSR')).toBe('4326');
    expect(url.searchParams.get('outSR')).toBe('4326');
    expect(url.searchParams.get('returnGeometry')).toBe('true');
    expect(url.searchParams.get('outFields')).toBe('NAME,ADDRESS,LANDNO,ORDINANCE,EFF_DATE');

    const [west, south, east, north] = (url.searchParams.get('geometry') ?? '').split(',').map(Number);
    expect(west).toBeLessThan(SPACE_NEEDLE.lng);
    expect(east).toBeGreaterThan(SPACE_NEEDLE.lng);
    expect(south).toBeLessThan(SPACE_NEEDLE.lat);
    expect(north).toBeGreaterThan(SPACE_NEEDLE.lat);
    expect((north ?? 0) - (south ?? 0)).toBeCloseTo((2 * LANDMARK_RADIUS_M) / 111_320, 4);
  });

  it('honours a smaller radius', async () => {
    mocks.fetchJson.mockResolvedValueOnce(landmarksSpaceNeedle);
    const facts = await seattleLandmarksNear(SPACE_NEEDLE, 100);
    expect(facts.map((f) => f.title)).toEqual(['Space Needle', 'Seattle Monorail']);
  });

  it('keys the cache by point and radius', async () => {
    mocks.fetchJson.mockResolvedValue(landmarksSpaceNeedle);
    await seattleLandmarksNear(SPACE_NEEDLE, 100);
    await seattleLandmarksNear(SPACE_NEEDLE, 100);
    await seattleLandmarksNear(SPACE_NEEDLE, 400);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(2);
  });

  it('is empty when nothing is nearby', async () => {
    mocks.fetchJson.mockResolvedValueOnce(arcgisEmpty);
    expect(await seattleLandmarksNear(WEDGWOOD)).toEqual([]);
  });

  it('landmarkFacts leaves the year off for placeholder dates and skips features without geometry', () => {
    const features = [
      { attributes: { NAME: 'Old Thing', ADDRESS: null, EFF_DATE: -2209161600000 }, geometry: { x: SPACE_NEEDLE.lng, y: SPACE_NEEDLE.lat } },
      { attributes: { NAME: 'Nowhere', EFF_DATE: 1000000000000 } },
      { attributes: { NAME: '  ', EFF_DATE: 1000000000000 }, geometry: { x: SPACE_NEEDLE.lng, y: SPACE_NEEDLE.lat } },
    ];
    const facts = landmarkFacts(features, SPACE_NEEDLE, 400);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.title).toBe('Old Thing');
    expect(facts[0]?.year).toBeUndefined();
    expect(facts[0]?.body).toBe('A designated Seattle landmark, at this spot.');
  });
});
