/**
 * Tests for the bundled timelines (events.ts).
 *
 * No network: fetchJson is mocked. The loader tests use the small SYNTHETIC
 * files in tests/fixtures/events/ (see the README there). The real
 * pre-baked files in public/data/events/ are imported directly and checked
 * as data (unique ids, known scope tokens, http sources, sane spans), and a
 * few of their well-known events anchor the filter tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeologyUnit, HistoryEvent, WaRegion } from '../../src/lib/types';
import { COUNTY_REGION, WA_REGIONS } from '../../src/data/wa-regions';
import deepSmall from '../fixtures/events/deep-small.json';
import humanSmall from '../fixtures/events/human-small.json';
import humanBare from '../fixtures/events/human-bare-array.json';
import deepTime from '../../public/data/events/deep-time.json';
import humanHistory from '../../public/data/events/human-history.json';
import waPlaces from '../../public/data/wa-places.json';

const mocks = vi.hoisted(() => ({ fetchJson: vi.fn() }));

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

import { HttpError } from '../../src/lib/http';
import {
  EVENT_FILES,
  SPOT_RULES,
  distanceKm,
  eventsAtWindow,
  eventsForSpot,
  eventsUrl,
  formatDistance,
  iceThicknessFeet,
  isContinuing,
  loadEvents,
  nearestVolcano,
  parseEventFile,
  renderTemplate,
  resetEvents,
  ringFor,
  scopeTokens,
  spotRulePasses,
  storyLine,
  toHistoryEvent,
  tokenScope,
  type EventFile,
  type EventRecord,
  type SpotContext,
  type SpotEvent,
} from '../../src/lib/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deepFile = deepTime as unknown as EventFile;
const humanFile = humanHistory as unknown as EventFile;
const allRecords: EventRecord[] = [...deepFile.events, ...humanFile.events];
const allEvents: SpotEvent[] = allRecords.map(toHistoryEvent);
const byId = (id: string): SpotEvent => {
  const e = allEvents.find((x) => x.id === id);
  if (!e) throw new Error(`no event ${id} in the bundled files`);
  return e;
};
const ids = (events: readonly HistoryEvent[]): string[] => events.map((e) => e.id);

function unit(symbol: string, name: string, description?: string): GeologyUnit {
  const u: GeologyUnit = { symbol, name, age: 'test', source: { name: 'test', url: 'https://example.org/dnr' } };
  if (description !== undefined) u.description = description;
  return u;
}

const QGT = unit('Qgt', 'mostly Vashon Stade in western WA; unnamed in eastern WA', 'Till and outwash deposits from continental glaciers.');
const QA = unit('Qa', 'alluvium', 'Unconsolidated clay, silt, sand, and gravel deposited along rivers.');
const QFG = unit('Qfg', 'Missoula, glacial Lake, deposits of', 'Sand and coarse gravel deposited by catastrophic Pleistocene floods.');
const MVG = unit('Mvg', 'Grande Ronde Basalt (Columbia River Basalt Group)', 'Flood basalt flows.');

const seattle: SpotContext = {
  region: 'Puget Sound',
  county: 'King County',
  city: 'Seattle',
  neighborhood: 'Lower Queen Anne',
  point: { lng: -122.3493, lat: 47.6205 },
  geology: QGT,
  annexYear: 1891,
  incYear: 1869,
  placeName: '400 Broad Street',
};

const ritzville: SpotContext = {
  region: 'Columbia Basin',
  county: 'Adams County',
  city: 'Ritzville',
  point: { lng: -118.3797, lat: 47.1276 },
  geology: QFG,
  placeName: 'your spot',
};

const republic: SpotContext = {
  region: 'Northeast Washington',
  county: 'Ferry County',
  city: 'Republic',
  point: { lng: -118.7378, lat: 48.6482 },
  geology: null,
  placeName: 'your spot',
};

/** A plain HistoryEvent (no SpotEvent extras), as another module might build one. */
function plainEvent(over: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: 'plain',
    title: 'Plain event',
    when: '1900',
    startYearsAgo: 100,
    endYearsAgo: 100,
    region: 'King County',
    summary: 'A plain event.',
    sources: [{ name: 'test', url: 'https://example.org' }],
    confidence: 'medium',
    ...over,
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.fetchJson.mockReset();
  resetEvents();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

// ---------------------------------------------------------------------------
// The bundled files
// ---------------------------------------------------------------------------

describe('public/data/events (the converted timelines)', () => {
  const knownCounties = new Set(Object.keys(COUNTY_REGION).map((c) => `${c} County`));
  const knownCities = new Set((waPlaces as { name: string }[]).map((p) => p.name));
  const knownRegions = new Set<string>(WA_REGIONS);

  it('holds 36 deep-time and 115 human-history events, each marked with its kind', () => {
    expect(deepFile.kind).toBe('deep');
    expect(humanFile.kind).toBe('human');
    expect(deepFile.events).toHaveLength(36);
    expect(humanFile.events).toHaveLength(115);
    expect(deepFile.events.every((e) => e.kind === 'deep')).toBe(true);
    expect(humanFile.events.every((e) => e.kind === 'human')).toBe(true);
  });

  it('has unique slug ids across both files', () => {
    const seen = new Set<string>();
    for (const e of allRecords) {
      expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(e.id), `duplicate id ${e.id}`).toBe(false);
      seen.add(e.id);
    }
  });

  it('scopes every event with known tokens only (statewide, a WaRegion, a county, or a city)', () => {
    for (const e of allRecords) {
      expect(e.region.length, `${e.id} has no region`).toBeGreaterThan(0);
      for (const t of e.region) {
        const known = t === 'statewide' || knownRegions.has(t) || knownCounties.has(t) || knownCities.has(t);
        expect(known, `${e.id}: unknown scope token "${t}"`).toBe(true);
      }
    }
  });

  it('gives every event at least one source with an http(s) url', () => {
    for (const e of allRecords) {
      expect(e.sources.length, `${e.id} has no sources`).toBeGreaterThan(0);
      for (const s of e.sources) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.url, `${e.id}: ${s.url}`).toMatch(/^https?:\/\//);
      }
    }
  });

  it('never ends before it starts (end <= start, or 0 for continuing)', () => {
    for (const e of allRecords) {
      expect(Number.isFinite(e.start_years_ago), e.id).toBe(true);
      expect(Number.isFinite(e.end_years_ago), e.id).toBe(true);
      expect(e.end_years_ago <= e.start_years_ago || e.end_years_ago === 0, `${e.id}: ${e.start_years_ago} to ${e.end_years_ago}`).toBe(true);
    }
  });

  it('has lat and lon together or not at all, a confidence, and a known spot rule when any', () => {
    for (const e of allRecords) {
      expect((e.lat === null) === (e.lon === null), e.id).toBe(true);
      expect(['high', 'medium', 'low']).toContain(e.confidence);
      if (e.spot_rule !== undefined) expect(SPOT_RULES).toContain(e.spot_rule);
      expect(e.summary.length, e.id).toBeGreaterThan(20);
    }
  });

  it('carries the six deep-time spot rules from Plan v2 and the two city-records rules', () => {
    const rules = new Map(allRecords.filter((e) => e.spot_rule).map((e) => [e.id, e.spot_rule]));
    expect(rules.get('missoula-floods')).toBe('flood-deposits');
    expect(rules.get('vashon-ice-sheet')).toBe('vashon-ice');
    expect(rules.get('osceola-mudflow')).toBe('osceola-lahar');
    expect(rules.get('electron-mudflow')).toBe('electron-lahar');
    expect(rules.get('columbia-river-basalt')).toBe('crbg');
    expect(rules.get('seattle-fault-923')).toBe('seattle-fault-near');
    expect(rules.get('seattle-annexations-1907')).toBe('annexed-in-range');
    expect(rules.get('suburban-incorporations')).toBe('incorporated-in-range');
    expect(rules.size).toBe(8);
  });

  it('uses only placeholders that renderTemplate knows, so every template can render somewhere', () => {
    const known = new Set(['place', 'distance', 'county', 'city', 'inc_year', 'annex_year', 'ice_thickness', 'basalt_unit', 'nearest_volcano', 'flood_depth']);
    for (const e of allRecords) {
      for (const m of (e.at_your_spot ?? '').matchAll(/\{([a-z_]+)\}/g)) {
        expect(known.has(m[1]!), `${e.id}: {${m[1]}}`).toBe(true);
      }
      if (e.at_your_spot?.includes('{distance}')) expect(e.lat, `${e.id} uses {distance} but has no point`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// toHistoryEvent
// ---------------------------------------------------------------------------

describe('toHistoryEvent', () => {
  it('maps snake_case to the HistoryEvent shape and keeps the extras', () => {
    const r = (deepSmall as EventFile).events[0]!;
    const e = toHistoryEvent(r);
    expect(e).toMatchObject({
      id: 'test-ice-sheet',
      kind: 'deep',
      title: 'Test: the ice sheet',
      when: 'about 17,000 years ago',
      startYearsAgo: 19000,
      endYearsAgo: 16000,
      region: 'Puget Sound, Olympic Peninsula',
      regions: ['Puget Sound', 'Olympic Peninsula'],
      point: { lng: -122.3, lat: 47.6 },
      atYourSpot: '{place} was under {ice_thickness} of ice.',
      spotRule: 'vashon-ice',
      confidence: 'high',
    });
    expect(e.sources).toEqual([{ name: 'Test source', url: 'https://example.org/ice' }]);
  });

  it('leaves point, atYourSpot and spotRule out when the record has none', () => {
    const r = (deepSmall as EventFile).events[2]!;
    const e = toHistoryEvent(r);
    expect(e.point).toBeUndefined();
    expect('point' in e).toBe(false);
    expect(e.spotRule).toBeUndefined();
    expect(e.atYourSpot).toBe('The nearest volcano to {place} is {nearest_volcano}.');
    const noLine = toHistoryEvent({ ...r, at_your_spot: null });
    expect('atYourSpot' in noLine).toBe(false);
  });

  it('reads scope tokens back from a plain HistoryEvent region string', () => {
    expect(scopeTokens(plainEvent({ region: 'Seattle, King County' }))).toEqual(['Seattle', 'King County']);
    expect(scopeTokens(byId('seattle-fault-923'))).toEqual(['Seattle', 'King County', 'Kitsap County', 'Puget Sound']);
    expect(tokenScope('statewide')).toBe('statewide');
    expect(tokenScope('Okanogan')).toBe('region');
    expect(tokenScope('Okanogan County')).toBe('county');
    expect(tokenScope('Seattle')).toBe('city');
  });
});

// ---------------------------------------------------------------------------
// eventsForSpot
// ---------------------------------------------------------------------------

describe('eventsForSpot', () => {
  it('for Seattle: statewide, Puget Sound, King County and Seattle events, nothing from the dry side', () => {
    const got = ids(eventsForSpot(allEvents, seattle));
    expect(got).toEqual(expect.arrayContaining(['statehood-1889', 'vashon-ice-sheet', 'great-seattle-fire-1889', 'seattle-fault-923', 'osceola-mudflow']));
    expect(got).not.toContain('missoula-floods');
    expect(got).not.toContain('great-spokane-fire-1889');
    expect(got).not.toContain('electron-mudflow'); // Pierce County only
    expect(got.length).toBeGreaterThan(50);
  });

  it('for Ritzville (Columbia Basin, Adams County): the floods and the basalt, not the glacier', () => {
    const got = ids(eventsForSpot(allEvents, ritzville));
    expect(got).toEqual(expect.arrayContaining(['missoula-floods', 'columbia-river-basalt', 'statehood-1889', 'grand-coulee-kettle-falls', 'hanford-1943']));
    expect(got).not.toContain('vashon-ice-sheet');
    expect(got).not.toContain('great-seattle-fire-1889');
  });

  it('for Republic (Northeast Washington, Ferry County): the oldest rocks and the Stonerose fossils', () => {
    const got = ids(eventsForSpot(allEvents, republic));
    expect(got).toEqual(expect.arrayContaining(['belt-supergroup', 'stonerose', 'missoula-floods', 'statehood-1889']));
    expect(got).not.toContain('vashon-ice-sheet');
    expect(got).not.toContain('great-seattle-fire-1889');
  });

  it('matches counties with or without the word County, cities in any case, and derives the region from the county', () => {
    const base: SpotContext = { point: ritzville.point, placeName: 'x' };
    expect(ids(eventsForSpot(allEvents, { ...base, county: 'Adams' }))).toContain('missoula-floods');
    expect(ids(eventsForSpot(allEvents, { ...base, county: 'adams county' }))).toContain('missoula-floods');
    expect(ids(eventsForSpot(allEvents, { ...base, city: 'seattle' }))).toContain('great-seattle-fire-1889');
    expect(ids(eventsForSpot(allEvents, base))).toEqual(ids(allEvents.filter((e) => e.regions.includes('statewide'))));
  });

  it('does not confuse the Okanogan region token with Okanogan County or the city', () => {
    const regionOnly = toHistoryEvent({ ...(deepSmall as EventFile).events[0]!, id: 'ok-region', region: ['Okanogan'] });
    const countyOnly = toHistoryEvent({ ...(deepSmall as EventFile).events[0]!, id: 'ok-county', region: ['Okanogan County'] });
    const inStevens: SpotContext = { region: 'Northeast Washington', county: 'Stevens County', point: { lng: -117.9, lat: 48.55 }, placeName: 'x' };
    const inOkanogan: SpotContext = { region: 'Okanogan', county: 'Okanogan County', city: 'Omak', point: { lng: -119.5, lat: 48.4 }, placeName: 'x' };
    expect(ids(eventsForSpot([regionOnly, countyOnly], inStevens))).toEqual([]);
    expect(ids(eventsForSpot([regionOnly, countyOnly], inOkanogan))).toEqual(['ok-region', 'ok-county']);
    expect(ids(eventsForSpot([regionOnly, countyOnly], { ...inOkanogan, county: 'Chelan County', region: 'Okanogan' as WaRegion }))).toEqual(['ok-region']);
  });

  it('works on plain HistoryEvents too', () => {
    const e = plainEvent({ region: 'King County' });
    expect(eventsForSpot([e], seattle)).toEqual([e]);
    expect(eventsForSpot([e], ritzville)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// eventsAtWindow
// ---------------------------------------------------------------------------

describe('eventsAtWindow', () => {
  it('at the 1889 stop (111 years ago, plus or minus half a year): the fires, statehood, open spans, continuing nations', () => {
    const got = ids(eventsAtWindow(allEvents, { fromYearsAgo: 111.5, toYearsAgo: 110.5 }));
    expect(got.slice(0, 4).sort()).toEqual(['ellensburg-fire-1889', 'great-seattle-fire-1889', 'great-spokane-fire-1889', 'statehood-1889']);
    expect(got).toContain('kirkland-founded'); // 1888 to 1905 spans the stop
    expect(got).toContain('washington-territory-1853'); // ends at statehood
    expect(got).toContain('coast-salish-central'); // continuing since time immemorial
    expect(got).toContain('subduction-today'); // continuing deep time
    expect(got).not.toContain('kent-incorporates-1890');
    expect(got).not.toContain('denny-party-1851');
    expect(got).not.toContain('vashon-ice-sheet');
    expect(got[got.length - 1]).toBe('cascade-arc-begins'); // the oldest start comes last
  });

  it('at the 15,000 BCE stop (about 17,000 years ago): the ice sheet, the floods, the lakes', () => {
    const got = ids(eventsAtWindow(allEvents, { fromYearsAgo: 16500, toYearsAgo: 17500 }));
    expect(got).toEqual([
      'glacial-lakes-russell-bretz',
      'ice-age-megafauna',
      'okanogan-lobe',
      'vashon-ice-sheet',
      'missoula-floods',
      'modern-volcanoes',
      'olympics-rise',
      'subduction-today',
      'cascade-arc-begins',
    ]);
  });

  it('sorts newest first and treats end 0 as continuing', () => {
    const a = plainEvent({ id: 'a', startYearsAgo: 50, endYearsAgo: 0 }); // 1950, continuing
    const b = plainEvent({ id: 'b', startYearsAgo: 30, endYearsAgo: 30 }); // 1970
    const c = plainEvent({ id: 'c', startYearsAgo: 30, endYearsAgo: 25 }); // 1970 to 1975
    const d = plainEvent({ id: 'd', startYearsAgo: 60, endYearsAgo: 55 }); // 1940 to 1945
    expect(isContinuing(a)).toBe(true);
    expect(isContinuing(b)).toBe(false);
    expect(ids(eventsAtWindow([d, c, b, a], { fromYearsAgo: 31, toYearsAgo: 29 }))).toEqual(['c', 'b', 'a']); // c ran longer than b
    expect(ids(eventsAtWindow([d, c, b, a], { fromYearsAgo: -5, toYearsAgo: -6 }))).toEqual(['a']);
    expect(ids(eventsAtWindow([d, c, b, a], { fromYearsAgo: 55, toYearsAgo: 52 }))).toEqual(['d']);
    expect(ids(eventsAtWindow([d, c, b, a], { fromYearsAgo: 70, toYearsAgo: 65 }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ringFor
// ---------------------------------------------------------------------------

describe('ringFor', () => {
  it('puts human events in the most specific ring their tokens name', () => {
    expect(ringFor(byId('great-seattle-fire-1889'))).toEqual(['city', 'county']);
    expect(ringFor(byId('statehood-1889'))).toEqual(['state']);
    expect(ringFor(byId('manis-mastodon-people'))).toEqual(['region']);
    expect(ringFor(plainEvent({ region: 'King County' }))).toEqual(['county']);
  });

  it('keeps deep-time events out of the city and county rings', () => {
    expect(ringFor(byId('seattle-fault-923'))).toEqual(['region']); // Seattle, King County, ... all lift to region
    expect(ringFor(byId('osceola-mudflow'))).toEqual(['region']);
    expect(ringFor(byId('vashon-ice-sheet'))).toEqual(['region']);
    expect(ringFor(byId('subduction-today'))).toEqual(['state', 'plate']);
  });

  it('lists rings most specific first and never beyond state for human events', () => {
    for (const e of allEvents) {
      const rings = ringFor(e);
      expect(rings.length, e.id).toBeGreaterThan(0);
      if (e.kind === 'human') expect(rings.every((r) => ['city', 'county', 'region', 'state'].includes(r)), e.id).toBe(true);
      else expect(rings.every((r) => ['region', 'state', 'plate'].includes(r)), e.id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  const fire = byId('great-seattle-fire-1889');

  it('{place} and {distance}', () => {
    expect(renderTemplate('{place} is {distance} from the fire.', seattle, fire)).toBe('400 Broad Street is 2 miles from the fire.');
    const far = { ...ritzville, placeName: '' };
    expect(renderTemplate('{place}: {distance}', far, fire)).toMatch(/^your spot: 1\d\d miles$/);
    const onTop = { ...seattle, point: fire.point! };
    expect(renderTemplate('{distance}', onTop, fire)).toBe('a few hundred feet');
    expect(renderTemplate('{distance}', { ...seattle, point: { lng: fire.point!.lng, lat: fire.point!.lat + 0.005 } }, fire)).toBe('less than a mile');
  });

  it('{county}, {city}, {inc_year}, {annex_year}', () => {
    expect(renderTemplate('{city} in {county}, inc. {inc_year}, joined {annex_year}', seattle, fire)).toBe('Seattle in King County, inc. 1869, joined 1891');
  });

  it('{ice_thickness} interpolates Thorson (1980) by latitude', () => {
    expect(renderTemplate('about {ice_thickness}', seattle, fire)).toBe('about 3,000 feet');
    const bellingham = { ...seattle, point: { lng: -122.48, lat: 48.75 } };
    expect(renderTemplate('{ice_thickness}', bellingham, fire)).toBe('5,000 feet');
    const tacoma = { ...seattle, point: { lng: -122.44, lat: 47.25 } };
    expect(renderTemplate('{ice_thickness}', tacoma, fire)).toBe('2,000 feet');
    expect(iceThicknessFeet(47.145)).toBeCloseTo(1500, 6); // halfway between Olympia and Tacoma
    expect(iceThicknessFeet(46.0)).toBe(660); // south of the ice limit: clamped
    expect(iceThicknessFeet(49.5)).toBe(5000); // north of Bellingham: clamped
  });

  it('{basalt_unit} from the geology name, {nearest_volcano} from the five peaks', () => {
    const pullman = { ...ritzville, point: { lng: -117.18, lat: 46.73 }, geology: MVG };
    expect(renderTemplate('on {basalt_unit}', pullman, fire)).toBe('on Grande Ronde Basalt (Columbia River Basalt Group)');
    expect(renderTemplate('{nearest_volcano}', seattle, fire)).toBe('Mount Rainier');
    expect(renderTemplate('{nearest_volcano}', { ...seattle, point: { lng: -122.48, lat: 48.75 } }, fire)).toBe('Mount Baker');
    expect(renderTemplate('{nearest_volcano}', { ...seattle, point: { lng: -122.9, lat: 46.1 } }, fire)).toBe('Mount St. Helens');
    expect(nearestVolcano({ lng: -121.0, lat: 46.2 }).name).toBe('Mount Adams');
    expect(nearestVolcano({ lng: -121.1, lat: 48.1 }).name).toBe('Glacier Peak');
  });

  it('{flood_depth} says "hundreds of feet" until elevation lookups exist', () => {
    expect(renderTemplate('under {flood_depth} of water', ritzville, byId('missoula-floods'))).toBe('under hundreds of feet of water');
  });

  it('returns null when a placeholder cannot be resolved', () => {
    expect(renderTemplate('{distance}', seattle, byId('statehood-1889'))).toBeNull(); // no anchor point
    expect(renderTemplate('{basalt_unit}', seattle, fire)).toBeNull(); // till, not basalt
    expect(renderTemplate('{basalt_unit}', republic, fire)).toBeNull(); // no geology at all
    expect(renderTemplate('{inc_year}', ritzville, fire)).toBeNull();
    expect(renderTemplate('{annex_year}', ritzville, fire)).toBeNull();
    expect(renderTemplate('{county}', { point: seattle.point, placeName: 'x' }, fire)).toBeNull();
    expect(renderTemplate('{city}', { point: seattle.point, placeName: 'x' }, fire)).toBeNull();
    expect(renderTemplate('{elevation}', seattle, fire)).toBeNull(); // unknown placeholder
    expect(renderTemplate('no placeholders', seattle, fire)).toBe('no placeholders');
  });

  it('formats distances the way the plan asks', () => {
    expect(formatDistance(0.05)).toBe('a few hundred feet');
    expect(formatDistance(1)).toBe('less than a mile');
    expect(formatDistance(2.2)).toBe('1 mile');
    expect(formatDistance(4.8)).toBe('3 miles');
    expect(formatDistance(225)).toBe('140 miles');
    expect(distanceKm({ lng: -122.3493, lat: 47.6205 }, { lng: -117.426, lat: 47.6588 })).toBeCloseTo(369, 0);
  });
});

// ---------------------------------------------------------------------------
// spotRulePasses and storyLine
// ---------------------------------------------------------------------------

describe('spotRulePasses', () => {
  const wallaWalla: SpotContext = { region: 'Palouse and Blue Mountains', county: 'Walla Walla County', city: 'Walla Walla', point: { lng: -118.343, lat: 46.0646 }, geology: QA, placeName: 'x' };
  const spokane: SpotContext = { region: 'Northeast Washington', county: 'Spokane County', city: 'Spokane', point: { lng: -117.426, lat: 47.6588 }, geology: QFG, placeName: 'x' };
  const pullman: SpotContext = { region: 'Palouse and Blue Mountains', county: 'Whitman County', city: 'Pullman', point: { lng: -117.18, lat: 46.73 }, geology: MVG, placeName: 'x' };

  it('vashon-ice: glacial till at Seattle passes, alluvium at Walla Walla fails', () => {
    expect(spotRulePasses('vashon-ice', seattle)).toBe(true);
    expect(spotRulePasses('vashon-ice', wallaWalla)).toBe(false);
    // Fill in the Puget Lowland still passes (the ice was there whatever is on top now)
    expect(spotRulePasses('vashon-ice', { ...seattle, geology: unit('Qf', 'fill') })).toBe(true);
    expect(spotRulePasses('vashon-ice', { ...seattle, geology: null })).toBe(true);
    // Glacial drift outside the lowland (Spokane's Qg units) still passes by symbol
    expect(spotRulePasses('vashon-ice', { ...spokane, geology: unit('Qgd', 'glacial drift') })).toBe(true);
    expect(spotRulePasses('vashon-ice', spokane)).toBe(false);
    // Just south of Tenino: no
    expect(spotRulePasses('vashon-ice', { ...seattle, point: { lng: -122.9, lat: 46.6 }, geology: null })).toBe(false);
  });

  it('flood-deposits: Qfg at Spokane passes, Qgt at Seattle fails', () => {
    expect(spotRulePasses('flood-deposits', spokane)).toBe(true);
    expect(spotRulePasses('flood-deposits', seattle)).toBe(false);
    expect(spotRulePasses('flood-deposits', { ...spokane, geology: null })).toBe(false);
  });

  it('crbg: basalt at Pullman passes by name and by symbol; till at Seattle fails', () => {
    expect(spotRulePasses('crbg', pullman)).toBe(true);
    expect(spotRulePasses('crbg', { ...pullman, geology: unit('Mvg', 'Grande Ronde') })).toBe(true);
    expect(spotRulePasses('crbg', { ...pullman, geology: unit('Mvw', 'Wanapum') })).toBe(true);
    expect(spotRulePasses('crbg', { ...pullman, geology: unit('vb', 'Columbia River Basalt Group, undivided') })).toBe(true);
    expect(spotRulePasses('crbg', { ...pullman, geology: unit('Mc', 'Ellensburg Formation') })).toBe(false);
    expect(spotRulePasses('crbg', seattle)).toBe(false);
    expect(spotRulePasses('crbg', { ...pullman, geology: null })).toBe(false);
  });

  it('osceola-lahar and electron-lahar read the unit description', () => {
    const auburn = { ...seattle, city: 'Auburn', point: { lng: -122.23, lat: 47.31 }, geology: unit('Qvl', 'lahar deposits', 'Osceola Mudflow from Mount Rainier; clay-rich diamict.') };
    expect(spotRulePasses('osceola-lahar', auburn)).toBe(true);
    expect(spotRulePasses('electron-lahar', auburn)).toBe(false);
    const orting = { ...auburn, geology: unit('Qvl', 'Electron Mudflow deposits') };
    expect(spotRulePasses('electron-lahar', orting)).toBe(true);
    expect(spotRulePasses('osceola-lahar', orting)).toBe(false);
    expect(spotRulePasses('osceola-lahar', seattle)).toBe(false);
  });

  it('seattle-fault-near: within 25 km of the fault', () => {
    expect(spotRulePasses('seattle-fault-near', seattle)).toBe(true);
    expect(spotRulePasses('seattle-fault-near', { ...seattle, point: { lng: -122.2, lat: 47.98 } })).toBe(false); // Everett
    expect(spotRulePasses('seattle-fault-near', spokane)).toBe(false);
  });

  it('annexed-in-range and incorporated-in-range need the event window', () => {
    const annex = toHistoryEvent((humanSmall as EventFile).events[2]!); // 1905 to 1910
    expect(spotRulePasses('annexed-in-range', { ...seattle, annexYear: 1907 }, annex)).toBe(true);
    expect(spotRulePasses('annexed-in-range', { ...seattle, annexYear: 1891 }, annex)).toBe(false);
    expect(spotRulePasses('annexed-in-range', { ...seattle, annexYear: 1907 })).toBe(false); // no event, no window
    const { annexYear: _dropped, ...noAnnexYear } = seattle;
    expect(spotRulePasses('annexed-in-range', noAnnexYear, annex)).toBe(false);
    const inc = byId('suburban-incorporations'); // 1990 to 2003
    expect(spotRulePasses('incorporated-in-range', { ...seattle, incYear: 1995 }, inc)).toBe(true);
    expect(spotRulePasses('incorporated-in-range', { ...seattle, incYear: 2003 }, inc)).toBe(true);
    expect(spotRulePasses('incorporated-in-range', { ...seattle, incYear: 1869 }, inc)).toBe(false);
    const open = plainEvent({ startYearsAgo: 50, endYearsAgo: 0 });
    expect(spotRulePasses('incorporated-in-range', { ...seattle, incYear: 2020 }, open)).toBe(true);
  });
});

describe('storyLine', () => {
  it('renders the line only when the rule passes', () => {
    expect(storyLine(byId('vashon-ice-sheet'), seattle)).toBe(
      '400 Broad Street was under about 3,000 feet of ice; the hill it stands on was shaped by that ice, and the gravelly, clay-rich ground underfoot is what the glacier left behind.',
    );
    expect(storyLine(byId('vashon-ice-sheet'), { ...seattle, point: { lng: -118.343, lat: 46.0646 }, geology: QA })).toBeNull();
    expect(storyLine(byId('missoula-floods'), ritzville)).toMatch(/^your spot was under hundreds of feet of muddy/);
    expect(storyLine(byId('missoula-floods'), seattle)).toBeNull();
    expect(storyLine(byId('columbia-river-basalt'), { ...ritzville, geology: MVG })).toBe(
      'your spot sits on Grande Ronde Basalt (Columbia River Basalt Group) of the Columbia River Basalt Group: stacked lava flows, each one spread across the countryside in days.',
    );
  });

  it('renders rule-free lines, and returns null without a template or with an unresolved placeholder', () => {
    expect(storyLine(byId('statehood-1889'), republic)).toBe('Your spot has been in the State of Washington since this day.');
    expect(storyLine(byId('seattle-annexations-1907'), { ...seattle, annexYear: 1907 })).toBe('Your spot joined Seattle in 1907.');
    expect(storyLine(byId('seattle-annexations-1907'), { ...seattle, annexYear: 1891 })).toBeNull();
    expect(storyLine(plainEvent(), seattle)).toBeNull();
    expect(storyLine(plainEvent({ atYourSpot: '{distance} away' }), seattle)).toBeNull();
  });

  it('every bundled template renders for some reasonable spot', () => {
    const rich: SpotContext = { ...seattle, annexYear: 1907, incYear: 1995, geology: unit('Mvg', 'Grande Ronde Basalt', 'Osceola Mudflow and Electron Mudflow (test)') };
    for (const e of allEvents) {
      if (!e.atYourSpot) continue;
      const line = renderTemplate(e.atYourSpot, rich, e);
      expect(line, e.id).not.toBeNull();
      expect(line).not.toMatch(/\{[a-z_]+\}/);
    }
  });
});

// ---------------------------------------------------------------------------
// loadEvents
// ---------------------------------------------------------------------------

describe('loadEvents', () => {
  const urlOf = (kind: 'deep' | 'human') => eventsUrl(EVENT_FILES.find((f) => f.kind === kind)!.file);

  it('fetches both files once, maps them, skips a malformed record with a warning', async () => {
    mocks.fetchJson.mockImplementation(async (url: string) => {
      if (url === urlOf('deep')) return deepSmall;
      if (url === urlOf('human')) return humanSmall;
      throw new Error(`unexpected url ${url}`);
    });
    const a = await loadEvents();
    const b = await loadEvents();
    expect(a).toBe(b);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(2);
    expect(urlOf('deep').endsWith('/data/events/deep-time.json')).toBe(true);
    expect(urlOf('human').endsWith('/data/events/human-history.json')).toBe(true);
    expect(ids(a)).toEqual(['test-ice-sheet', 'test-basalt', 'test-subduction', 'test-seattle-fire', 'test-statehood', 'test-annexations', 'test-county-railroad']);
    expect((a[0] as SpotEvent).kind).toBe('deep');
    expect((a[6] as SpotEvent).kind).toBe('human');
    expect(a[6]!.endYearsAgo).toBe(119); // end defaults to start
    expect(warn).toHaveBeenCalledTimes(1); // the broken record
    expect(String(warn.mock.calls[0]?.[0])).toContain('test-broken');
  });

  it('tolerates one file failing: warns once and returns the other', async () => {
    mocks.fetchJson.mockImplementation(async (url: string) => {
      if (url === urlOf('deep')) throw new HttpError(404, url);
      return humanSmall;
    });
    const got = await loadEvents();
    expect(ids(got)).toEqual(['test-seattle-fire', 'test-statehood', 'test-annexations', 'test-county-railroad']);
    expect(warn).toHaveBeenCalledTimes(2); // the 404 and the broken record
    expect(String(warn.mock.calls[0]?.[0])).toContain('deep timeline');
  });

  it('tolerates a file that is not events at all, and accepts a bare array', async () => {
    mocks.fetchJson.mockImplementation(async (url: string) => (url === urlOf('deep') ? { nope: true } : humanBare));
    const got = await loadEvents();
    expect(ids(got)).toEqual(['test-bare-event']);
    expect(scopeTokens(got[0]!)).toEqual(['Puget Sound']);
    expect((got[0] as SpotEvent).kind).toBe('human'); // the fallback kind for that file
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list, with two warnings, when both files fail; the next call tries again after reset', async () => {
    mocks.fetchJson.mockRejectedValue(new Error('offline'));
    expect(await loadEvents()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    resetEvents();
    mocks.fetchJson.mockResolvedValue(deepSmall);
    expect((await loadEvents()).length).toBe(6); // both urls answered with the deep file
  });

  it('parseEventFile loads the real bundled files whole', () => {
    expect(parseEventFile(deepTime, 'deep')).toHaveLength(36);
    expect(parseEventFile(humanHistory, 'human')).toHaveLength(115);
    expect(warn).not.toHaveBeenCalled();
    expect(() => parseEventFile('text', 'deep')).toThrow();
  });
});
