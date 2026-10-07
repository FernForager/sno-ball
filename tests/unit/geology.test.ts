import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeologyUnit, LngLat, PaleoPosition, WaRegion } from '../../src/lib/types';
import dnrUnitSpaceNeedle from '../fixtures/geology/dnr-unit-space-needle.json';
import dnrDmuSpaceNeedle from '../fixtures/geology/dnr-dmu-space-needle.json';
import dnrUnitSpokane from '../fixtures/geology/dnr-unit-spokane.json';
import dnrDmuSpokane from '../fixtures/geology/dnr-dmu-spokane.json';
import dnrUnitWallaWalla from '../fixtures/geology/dnr-unit-walla-walla.json';
import dnrDmuWallaWalla from '../fixtures/geology/dnr-dmu-walla-walla.json';
import dnrUnitEmpty from '../fixtures/geology/dnr-unit-empty.json';
import esriError from '../fixtures/geology/esri-error.json';
import macrostratSpaceNeedle from '../fixtures/geology/macrostrat-space-needle.json';
import gplatesSingle from '../fixtures/geology/gplates-space-needle.json';
import gplatesTimes from '../fixtures/geology/gplates-space-needle-times.json';

// ---------------------------------------------------------------------------
// Mocks for the shared infrastructure. No network runs in these tests:
//  - fetchJson answers from the fixture files above, routed by URL
//  - the rate limiter runs each task immediately
//  - the cache is an in-memory Map, cleared before every test
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

import { HttpError } from '../../src/lib/http';
import {
  DNR_SOURCE,
  GEOLOGIC_INTERVALS,
  MACROSTRAT_SOURCE,
  describeAge,
  describeSpan,
  dnrDescriptionUrl,
  dnrUnitUrl,
  geologyAt,
  intervalsIn,
  macrostratUrl,
  parseGeologicAge,
  pickMacrostratUnit,
  unitFromDnr,
  unitFromMacrostrat,
} from '../../src/lib/geology';
import {
  GPLATES_SOURCE,
  PALEO_MODEL,
  PALEO_STOPS,
  describePaleo,
  gplatesUrl,
  paleoPositions,
  pointFromMultiPoint,
  positionsFromBatch,
} from '../../src/lib/paleo';
import { ICE_AGE_FACTS, iceAgeFactFor } from '../../src/data/ice-age';

const SPACE_NEEDLE: LngLat = { lng: -122.3493, lat: 47.6205 };
const SPOKANE: LngLat = { lng: -117.426, lat: 47.6588 };
const WALLA_WALLA: LngLat = { lng: -118.343, lat: 46.0646 };

/** Route fetchJson by URL: DNR layer 11, DNR table 13, Macrostrat, GPlates. */
function routeFetch(routes: {
  unit?: unknown | (() => unknown);
  dmu?: unknown | (() => unknown);
  macrostrat?: unknown | (() => unknown);
  gplates?: unknown | ((url: string) => unknown);
}): void {
  const answer = (value: unknown, url: string): unknown => (typeof value === 'function' ? (value as (u: string) => unknown)(url) : value);
  mocks.fetchJson.mockImplementation(async (url: string) => {
    if (url.includes('/MapServer/11/query')) return answer(routes.unit, url);
    if (url.includes('/MapServer/13/query')) return answer(routes.dmu, url);
    if (url.includes('macrostrat.org')) return answer(routes.macrostrat, url);
    if (url.includes('gws.gplates.org')) return answer(routes.gplates, url);
    throw new Error(`unexpected URL in test: ${url}`);
  });
}

const fails = (status: number, url = 'https://example.test') => () => {
  throw new HttpError(status, url);
};

beforeEach(() => {
  mocks.fetchJson.mockReset();
  mocks.store.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ===========================================================================
// The geologic time scale
// ===========================================================================

describe('GEOLOGIC_INTERVALS and parseGeologicAge', () => {
  it('lists the ICS epochs and periods with the right bounds', () => {
    const byName = Object.fromEntries(GEOLOGIC_INTERVALS.map((i) => [i.name, i]));
    expect(byName['Holocene']).toMatchObject({ startMa: 0.0117, endMa: 0 });
    expect(byName['Pleistocene']).toMatchObject({ startMa: 2.58, endMa: 0.0117 });
    expect(byName['Miocene']).toMatchObject({ startMa: 23.03, endMa: 5.333 });
    expect(byName['Cretaceous']).toMatchObject({ startMa: 145, endMa: 66 });
    expect(byName['Cambrian']).toMatchObject({ startMa: 538.8, endMa: 485.4 });
    expect(byName['Archean']).toMatchObject({ startMa: 4000, endMa: 2500 });
    expect(byName['Quaternary']).toMatchObject({ startMa: 2.58, endMa: 0 });
  });

  it('is sorted youngest first within each rank and has no gaps between epochs', () => {
    const epochs = GEOLOGIC_INTERVALS.filter((i) => i.rank === 'epoch');
    for (let k = 1; k < epochs.length; k++) {
      expect(epochs[k]!.endMa).toBe(epochs[k - 1]!.startMa);
    }
  });

  it('parses the six example strings', () => {
    expect(parseGeologicAge('Pleistocene')).toEqual({ from: 2_580_000, to: 11_700 });
    expect(parseGeologicAge('Miocene to Pliocene')).toEqual({ from: 23_030_000, to: 2_580_000 });
    expect(parseGeologicAge('Eocene-Oligocene')).toEqual({ from: 56_000_000, to: 23_030_000 });
    expect(parseGeologicAge('Quaternary')).toEqual({ from: 2_580_000, to: 0 });
    expect(parseGeologicAge('late Cretaceous')).toEqual({ from: 145_000_000, to: 66_000_000 });
    expect(parseGeologicAge('Jurassic–Cretaceous')).toEqual({ from: 201_400_000, to: 66_000_000 });
  });

  it('ignores case, handles "and", and gives undefined when nothing matches', () => {
    expect(parseGeologicAge('HOLOCENE and pleistocene')).toEqual({ from: 2_580_000, to: 0 });
    expect(parseGeologicAge('Pleistocene(?)')).toEqual({ from: 2_580_000, to: 11_700 });
    expect(parseGeologicAge('age unknown')).toBeUndefined();
    expect(parseGeologicAge('')).toBeUndefined();
  });

  it('reads "pre-Tertiary" as older than the Tertiary', () => {
    expect(parseGeologicAge('pre-Tertiary')).toEqual({ from: 4_600_000_000, to: 66_000_000 });
  });

  it('intervalsIn lists every interval named, in order', () => {
    expect(intervalsIn('Miocene to Pliocene').map((i) => i.name)).toEqual(['Miocene', 'Pliocene']);
    expect(intervalsIn('Pleistocene continental glacial till').map((i) => i.name)).toEqual(['Pleistocene']);
    expect(intervalsIn('sandstone')).toEqual([]);
  });
});

// ===========================================================================
// WA DNR two-step lookup
// ===========================================================================

describe('DNR URLs', () => {
  it('queries layer 11 at the point with the fields we need', () => {
    const url = dnrUnitUrl(SPACE_NEEDLE);
    expect(url).toContain('/MapServer/11/query?');
    expect(url).toContain('geometry=-122.34930%2C47.62050');
    expect(url).toContain('inSR=4326');
    expect(url).toContain('MAP_UNIT_100K_QUAD_UNIT');
    expect(url).toContain('returnGeometry=false');
    expect(url).toContain('f=json');
  });

  it('queries table 13 by the join key, URL-encoded', () => {
    const url = dnrDescriptionUrl('Compiled | Qgt');
    expect(url).toContain('/MapServer/13/query?');
    expect(decodeURIComponent(url)).toContain("where=DMU_FEATURE_QUAD_UNIT='Compiled | Qgt'");
    expect(url).toContain('where=DMU_FEATURE_QUAD_UNIT%3D\'Compiled%20%7C%20Qgt\'');
    expect(url).toContain('outFields=DMU_100K_FULL_NAME,DMU_100K_AGE,DMU_100K_DESCRIPTION');
  });

  it("doubles a single quote inside the join key so the where clause stays valid", () => {
    expect(decodeURIComponent(dnrDescriptionUrl("O'Brien | Qa"))).toContain("'O''Brien | Qa'");
  });
});

describe('geologyAt via WA DNR', () => {
  it('joins layer 11 and table 13: Space Needle -> Qgt, Pleistocene till', async () => {
    routeFetch({ unit: dnrUnitSpaceNeedle, dmu: dnrDmuSpaceNeedle });

    const unit = await geologyAt(SPACE_NEEDLE);

    expect(unit).not.toBeNull();
    expect(unit!.symbol).toBe('Qgt');
    expect(unit!.name).toBe('Pleistocene continental glacial till');
    expect(unit!.age).toBe('Pleistocene');
    expect(unit!.ageYearsAgo).toEqual({ from: 2_580_000, to: 11_700 });
    expect(unit!.description).toMatch(/^Till and outwash deposits from continental glaciers/);
    expect(unit!.description).toContain('Full unit name: mostly Vashon Stade in western WA');
    expect(unit!.source).toEqual(DNR_SOURCE);

    // Exactly two requests, the second keyed by the join value from the first.
    expect(mocks.fetchJson).toHaveBeenCalledTimes(2);
    const secondUrl = mocks.fetchJson.mock.calls[1]![0] as string;
    expect(decodeURIComponent(secondUrl)).toContain("DMU_FEATURE_QUAD_UNIT='Compiled | Qgt'");
    expect(mocks.limiterFor).toHaveBeenCalledWith('gis.dnr.wa.gov');
  });

  it('caches the result so a repeat lookup makes no request', async () => {
    routeFetch({ unit: dnrUnitSpaceNeedle, dmu: dnrDmuSpaceNeedle });
    await geologyAt(SPACE_NEEDLE);
    await geologyAt(SPACE_NEEDLE);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(2);
  });

  it('handles a null full name and a "Quaternary" age (Walla Walla alluvium)', async () => {
    routeFetch({ unit: dnrUnitWallaWalla, dmu: dnrDmuWallaWalla });
    const unit = await geologyAt(WALLA_WALLA);
    expect(unit).toMatchObject({ symbol: 'Qa', name: 'Quaternary alluvium', age: 'Quaternary' });
    expect(unit!.ageYearsAgo).toEqual({ from: 2_580_000, to: 0 });
    expect(unit!.description).toMatch(/^Unconsolidated clay, silt, sand, and gravel/);
    expect(unit!.description).not.toContain('Full unit name');
  });

  it('still returns the unit when the description lookup fails, with an age read from the legend name', async () => {
    routeFetch({ unit: dnrUnitSpaceNeedle, dmu: fails(503) });
    const unit = await geologyAt(SPACE_NEEDLE);
    expect(unit).toMatchObject({ symbol: 'Qgt', name: 'Pleistocene continental glacial till', age: 'Pleistocene' });
    expect(unit!.ageYearsAgo).toEqual({ from: 2_580_000, to: 11_700 });
    expect(unit!.description).toBeUndefined();
    expect(unit!.source).toEqual(DNR_SOURCE);
    expect(console.warn).toHaveBeenCalled();
  });

  it('unitFromDnr never assigns undefined to optional fields', () => {
    const unit = unitFromDnr({
      MAP_UNIT_100K: 'Tx',
      MAP_UNIT_100K_SYMBOL: null,
      MAP_UNIT_100K_LABEL: 'Tx',
      MAP_UNIT_100K_QUAD_UNIT: null,
    });
    expect(unit).toEqual({ symbol: 'Tx', name: 'Tx', age: '', source: DNR_SOURCE });
    expect('ageYearsAgo' in unit).toBe(false);
    expect('description' in unit).toBe(false);
  });
});

// ===========================================================================
// Macrostrat fallback
// ===========================================================================

describe('geologyAt falls back to Macrostrat', () => {
  it('when DNR throws', async () => {
    routeFetch({ unit: fails(503), macrostrat: macrostratSpaceNeedle });

    const unit = await geologyAt(SPACE_NEEDLE);

    expect(unit).not.toBeNull();
    expect(unit!.name).toBe('Younger glacial drift');
    expect(unit!.symbol).toBe('Vashon Drift');
    expect(unit!.age).toBe('Pleistocene');
    expect(unit!.ageYearsAgo).toEqual({ from: 655_800, to: 8_800 });
    expect(unit!.description).toMatch(/^Till\.\s+Hard, blue-gray/);
    expect(unit!.description).toContain('Rock types: fine alluvium, coarse alluvium.');
    expect(unit!.description).toContain('Stratigraphic name: Vashon Drift; Sumas Drift.');
    // Macrostrat's CC BY terms ask for the original map to be credited too.
    expect(unit!.description).toContain('Original map: Horton, J.D., C.A. San Juan, and D.B. Stoeser. The State Geologic Map Compilation (SGMC)');
    expect(unit!.description).toMatch(/doi: 10\.3133\/ds1052\. U\.S\. Geological Survey Data Series 1052\.$/);
    expect(unit!.source).toEqual(MACROSTRAT_SOURCE);
    expect(mocks.limiterFor).toHaveBeenCalledWith('macrostrat.org');
    expect(console.warn).toHaveBeenCalled();
  });

  it('when DNR has no polygon at the point', async () => {
    routeFetch({ unit: dnrUnitEmpty, macrostrat: macrostratSpaceNeedle });
    const unit = await geologyAt(SPACE_NEEDLE);
    expect(unit!.source.name).toBe('Macrostrat');
    // Only the layer-11 request and the Macrostrat request: no table-13 call.
    expect(mocks.fetchJson).toHaveBeenCalledTimes(2);
  });

  it('when DNR answers HTTP 200 with an ArcGIS error object', async () => {
    routeFetch({ unit: esriError, macrostrat: macrostratSpaceNeedle });
    const unit = await geologyAt(SPACE_NEEDLE);
    expect(unit!.source.name).toBe('Macrostrat');
  });

  it('resolves null when neither source has a unit', async () => {
    routeFetch({ unit: dnrUnitEmpty, macrostrat: { success: { data: [] } } });
    expect(await geologyAt(SPACE_NEEDLE)).toBeNull();
  });

  it('throws when both services fail, so the page can report an outage', async () => {
    routeFetch({ unit: fails(503), macrostrat: fails(500, 'https://macrostrat.org') });
    await expect(geologyAt(SPACE_NEEDLE)).rejects.toBeInstanceOf(HttpError);
  });

  it('builds a sensible URL', () => {
    expect(macrostratUrl(SPACE_NEEDLE)).toBe(
      'https://macrostrat.org/api/v2/geologic_units/map?lat=47.62050&lng=-122.34930&format=json',
    );
  });

  it('pickMacrostratUnit prefers a described, named unit', () => {
    const units = macrostratSpaceNeedle.success.data;
    expect(pickMacrostratUnit(units)?.name).toBe('Younger glacial drift');
    expect(pickMacrostratUnit([])).toBeUndefined();
  });

  it('unitFromMacrostrat names the original map when a reference is given', () => {
    const unit = unitFromMacrostrat({ name: 'Basalt', descrip: 'Flood basalt.' }, 'Smith, J. Geologic map of somewhere. ');
    expect(unit.description).toBe('Flood basalt. Original map: Smith, J. Geologic map of somewhere.');
    expect(unitFromMacrostrat({ name: 'Basalt', descrip: 'Flood basalt.' }).description).toBe('Flood basalt.');
  });

  it('unitFromMacrostrat copes with a bare unit', () => {
    const unit = unitFromMacrostrat({ name: 'Quaternary sedimentary', b_int_name: 'Quaternary', t_int_name: 'Quaternary' });
    expect(unit).toMatchObject({ symbol: 'Quaternary sedimentary', name: 'Quaternary sedimentary', age: 'Quaternary' });
    expect(unit.ageYearsAgo).toEqual({ from: 2_580_000, to: 0 });
    expect('description' in unit).toBe(false);
  });
});

// ===========================================================================
// describeAge
// ===========================================================================

describe('describeAge', () => {
  const base = (over: Partial<GeologyUnit>): GeologyUnit => ({
    symbol: 'X',
    name: 'test unit',
    age: '',
    source: DNR_SOURCE,
    ...over,
  });

  it('gives the ice-sheet line for Pleistocene glacial till', () => {
    const unit = unitFromDnr(dnrUnitSpaceNeedle.features[0]!.attributes, dnrDmuSpaceNeedle.features[0]!.attributes);
    expect(describeAge(unit)).toBe('Laid down about 16,000 years ago by the ice sheet of the last ice age.');
  });

  it('does not claim the last ice age for older Pleistocene drift', () => {
    // The survey files pre-Fraser drift under "Pleistocene" too, but it is
    // tens to hundreds of thousands of years older than the Vashon ice.
    const unit = base({
      symbol: 'Qgdo',
      name: 'pre-Fraser continental glacial drift',
      age: 'Pleistocene',
      ageYearsAgo: { from: 2_580_000, to: 11_700 },
    });
    expect(describeAge(unit)).toBe('Formed between 2.6 million and 11,700 years ago, in the Pleistocene.');
    expect(describeAge(base({ name: 'older glacial drift', age: 'Pleistocene', ageYearsAgo: { from: 2_580_000, to: 11_700 } }))).toMatch(/^Formed/);
    expect(describeAge(base({ name: 'Double Bluff Drift', age: 'Pleistocene', ageYearsAgo: { from: 2_580_000, to: 11_700 } }))).toMatch(/^Formed/);
  });

  it('gives the flood line for Missoula flood deposits', () => {
    const unit = unitFromDnr(dnrUnitSpokane.features[0]!.attributes, dnrDmuSpokane.features[0]!.attributes);
    expect(describeAge(unit)).toBe(
      'Laid down between about 18,000 and 15,000 years ago by the Ice Age floods that swept across eastern Washington.',
    );
  });

  it('uses "within the last" for ranges that reach the present', () => {
    const unit = unitFromDnr(dnrUnitWallaWalla.features[0]!.attributes, dnrDmuWallaWalla.features[0]!.attributes);
    expect(describeAge(unit)).toBe('Formed within the last 2.6 million years, in the Quaternary.');
  });

  it('describes Holocene-only units as still forming', () => {
    const unit = base({ age: 'Holocene', ageYearsAgo: { from: 11_700, to: 0 } });
    expect(describeAge(unit)).toMatch(/^Laid down within the last 11,700 years/);
  });

  it('gives "Formed between X and Y million years ago, in the <age>" otherwise', () => {
    expect(describeAge(base({ age: 'Eocene', ageYearsAgo: { from: 56_000_000, to: 33_900_000 } }))).toBe(
      'Formed between 56 and 33.9 million years ago, in the Eocene.',
    );
    expect(describeAge(base({ age: 'Pleistocene', ageYearsAgo: { from: 2_580_000, to: 11_700 } }))).toBe(
      'Formed between 2.6 million and 11,700 years ago, in the Pleistocene.',
    );
  });

  it('falls back to the survey wording when no range could be parsed', () => {
    expect(describeAge(base({ age: 'age uncertain' }))).toBe('The survey dates this unit as "age uncertain".');
    expect(describeAge(base({}))).toBe('The survey gives no age for this unit.');
  });

  it('describeSpan formats the common shapes', () => {
    expect(describeSpan(56_000_000, 33_900_000)).toBe('between 56 and 33.9 million years ago');
    expect(describeSpan(2_580_000, 11_700)).toBe('between 2.6 million and 11,700 years ago');
    expect(describeSpan(11_700, 5_000)).toBe('between 11,700 and 5,000 years ago');
    expect(describeSpan(66_000_000, 0)).toBe('within the last 66 million years');
  });
});

// ===========================================================================
// Paleo positions (GPlates)
// ===========================================================================

describe('paleo', () => {
  it('exposes the six stops', () => {
    expect(PALEO_STOPS).toEqual([20, 50, 100, 200, 300, 500]);
  });

  it('builds the batched and single-time URLs', () => {
    expect(gplatesUrl(SPACE_NEEDLE, PALEO_STOPS)).toBe(
      'https://gws.gplates.org/reconstruct/reconstruct_points/?points=-122.34930%2C47.62050&times=20%2C50%2C100%2C200%2C300%2C500&model=MERDITH2021',
    );
    expect(gplatesUrl(SPACE_NEEDLE, [100])).toContain('&time=100&model=MERDITH2021');
  });

  it('pointFromMultiPoint rejects odd shapes and the 999.99 sentinel', () => {
    expect(pointFromMultiPoint({ type: 'MultiPoint', coordinates: [[-72.5869, 55.0114]] })).toEqual({ lng: -72.5869, lat: 55.0114 });
    expect(pointFromMultiPoint({ type: 'MultiPoint', coordinates: [[999.99, 999.99]] })).toBeUndefined();
    expect(pointFromMultiPoint({ type: 'MultiPoint', coordinates: [] })).toBeUndefined();
    expect(pointFromMultiPoint({ type: 'MultiPoint', coordinates: 'nope' })).toBeUndefined();
    expect(pointFromMultiPoint(undefined)).toBeUndefined();
  });

  it('maps a batched GPlates answer to positions, dropping off-plate stops', () => {
    const positions = positionsFromBatch(gplatesTimes, PALEO_STOPS);
    expect(positions.map((p) => p.ma)).toEqual([20, 50, 100, 200, 300]); // 500 Ma is the sentinel
    const at100 = positions.find((p) => p.ma === 100)!;
    expect(at100.point).toEqual({ lng: -72.5869, lat: 55.0114 });
    expect(at100.model).toBe(PALEO_MODEL);
    expect(at100.source).toEqual(GPLATES_SOURCE);
  });

  it('paleoPositions makes one batched request and caches it', async () => {
    routeFetch({ gplates: gplatesTimes });
    const first = await paleoPositions(SPACE_NEEDLE);
    expect(first).toHaveLength(5);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.fetchJson.mock.calls[0]![0]).toContain('times=20%2C50%2C100%2C200%2C300%2C500');
    expect(mocks.limiterFor).toHaveBeenCalledWith('gws.gplates.org');

    const second = await paleoPositions(SPACE_NEEDLE);
    expect(second).toEqual(first);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
  });

  it('falls back to one request per stop and skips the stops that fail', async () => {
    routeFetch({
      gplates: (url: string) => {
        if (url.includes('times=')) throw new HttpError(500, url);
        if (url.includes('time=200')) throw new HttpError(503, url);
        return gplatesSingle;
      },
    });
    const positions = await paleoPositions(SPACE_NEEDLE, [100, 200, 300]);
    expect(positions.map((p) => p.ma)).toEqual([100, 300]);
    // 1 batched attempt + 3 single attempts
    expect(mocks.fetchJson).toHaveBeenCalledTimes(4);
  });

  it('returns an empty list, and caches nothing, when every request fails', async () => {
    routeFetch({ gplates: fails(503) });
    expect(await paleoPositions(SPACE_NEEDLE, [100, 200])).toEqual([]);
    expect(mocks.store.size).toBe(0);
    expect(await paleoPositions(SPACE_NEEDLE, [100, 200])).toEqual([]);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(6); // (1 batched + 2 singles) twice
  });

  it('returns [] for no stops without touching the network', async () => {
    expect(await paleoPositions(SPACE_NEEDLE, [])).toEqual([]);
    expect(mocks.fetchJson).not.toHaveBeenCalled();
  });

  describe('describePaleo', () => {
    const pos = (ma: number, lng: number, lat: number): PaleoPosition => ({
      ma,
      point: { lng, lat },
      model: PALEO_MODEL,
      source: GPLATES_SOURCE,
    });

    it('uses hemisphere words and a rough east/west shift against the present point', () => {
      expect(describePaleo(pos(100, -72.5869, 55.0114), SPACE_NEEDLE)).toBe(
        '100 million years ago this spot sat near 55° north, about 7° farther north than today and far to the east of where it is now.',
      );
      expect(describePaleo(pos(20, -109.2309, 49.8907), SPACE_NEEDLE)).toBe(
        '20 million years ago this spot sat near 50° north, a little to the east of where it is now.',
      );
    });

    it('handles the southern hemisphere, the equator and a date-line crossing', () => {
      expect(describePaleo(pos(300, -36.07, -21.43), SPACE_NEEDLE)).toMatch(/near 21° south, about 69° farther south than today and far to the east/);
      expect(describePaleo(pos(500, 10, 0.4), { lng: 10, lat: 0.4 })).toBe('500 million years ago this spot sat near the equator, close to where it is now.');
      expect(describePaleo(pos(50, 170, 47), { lng: -170, lat: 47 })).toMatch(/well to the west of where it is now\.$/);
    });

    it('stops after the latitude when no present point is given', () => {
      expect(describePaleo(pos(100, -72.5869, 55.0114))).toBe('100 million years ago this spot sat near 55° north.');
    });
  });
});

// ===========================================================================
// Ice-age facts
// ===========================================================================

describe('ice-age facts', () => {
  const REGIONS: WaRegion[] = [
    'Puget Sound',
    'Olympic Peninsula',
    'Southwest Washington',
    'North Cascades',
    'South Cascades',
    'Columbia Basin',
    'Okanogan',
    'Northeast Washington',
    'Palouse and Blue Mountains',
    'Yakima Valley',
  ];

  it('has a sourced fact for every region and every named city', () => {
    for (const region of REGIONS) {
      expect(iceAgeFactFor(region), region).toBeDefined();
    }
    for (const city of ['Seattle', 'Tacoma', 'Everett', 'Olympia', 'Bellingham']) {
      expect(iceAgeFactFor(undefined, city)?.region).toBe(city);
    }
    for (const fact of ICE_AGE_FACTS) {
      expect(fact.source.url).toMatch(/^https:\/\//);
      expect(fact.source.name.length).toBeGreaterThan(0);
      expect(fact.yearsAgo).toBeGreaterThan(10_000);
      expect(fact.body.length).toBeGreaterThan(80);
    }
  });

  it('prefers the city fact over the region fact, ignoring case', () => {
    expect(iceAgeFactFor('Puget Sound', 'seattle')?.title).toBe('Under 3,000 feet of ice');
    expect(iceAgeFactFor('Puget Sound', ' Bellingham ')?.title).toBe('Under about 5,500 feet of ice');
    expect(iceAgeFactFor('Puget Sound', 'Kirkland')?.region).toBe('Puget Sound');
  });

  it('says what the spec asks about the Puget lobe and the floods', () => {
    const seattle = iceAgeFactFor('Puget Sound', 'Seattle')!;
    expect(seattle.yearsAgo).toBe(16_900);
    expect(seattle.body).toMatch(/3,000 feet \(900 m\)/);
    expect(seattle.body).toContain('Vashon Stade');
    expect(iceAgeFactFor('Puget Sound', 'Tacoma')!.body).toContain('1,700 feet');
    expect(iceAgeFactFor('Puget Sound', 'Everett')!.body).toContain('4,000 feet');
    expect(iceAgeFactFor('Puget Sound', 'Olympia')!.body).toMatch(/south of Olympia/);
    expect(iceAgeFactFor('Columbia Basin')!.body).toMatch(/18,000 and 15,000 years ago/);
    expect(iceAgeFactFor('Columbia Basin')!.body).toContain('Channeled Scablands');
    expect(iceAgeFactFor('Okanogan')!.body).toContain('Grand Coulee');
    expect(iceAgeFactFor('Olympic Peninsula')!.body).toMatch(/alpine glaciers/);
  });

  it('returns undefined when nothing is known', () => {
    expect(iceAgeFactFor(undefined)).toBeUndefined();
    expect(iceAgeFactFor(undefined, 'Spokane')).toBeUndefined();
  });
});
