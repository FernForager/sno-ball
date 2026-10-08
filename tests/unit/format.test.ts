/**
 * Tests for the pure text helpers in src/ui/format.ts. They run in plain
 * Node: nothing here needs a DOM or the network.
 */
import { describe, expect, it } from 'vitest';
import type { GeologyUnit, Place, Ring, Source } from '../../src/lib/types';
import {
  distanceWords,
  escapeHtml,
  excerpt,
  formatNumber,
  formatYear,
  heroSentence,
  ringLabel,
  ringTagline,
  summariseOutcome,
} from '../../src/ui/format';

// ---------------------------------------------------------------------------
// Shared fixtures (hand-written from the normalised shapes in types.ts)
// ---------------------------------------------------------------------------

const OSM: Source = { name: 'OpenStreetMap Nominatim', url: 'https://nominatim.openstreetmap.org/', license: 'ODbL' };
const DNR: Source = { name: 'Washington Geological Survey', url: 'https://gis.dnr.wa.gov/', license: 'Public record' };

/**
 * The Space Needle as the geocoder module normalises it. The address parts,
 * display name and OSM id are copied from a real Nominatim response
 * (tests/fixtures/live/nominatim-search-space-needle.json on the helper
 * branch), so this matches what the site sees in the browser.
 */
const spaceNeedle: Place = {
  query: '400 Broad St, Seattle',
  point: { lng: -122.3493036, lat: 47.6205131 },
  displayName: 'Space Needle, 400, Broad Street, South Lake Union, Cascade, Belltown, Seattle, King County, Washington, 98109, United States',
  address: {
    houseNumber: '400',
    road: 'Broad Street',
    neighbourhood: 'South Lake Union',
    suburb: 'Belltown',
    city: 'Seattle',
    county: 'King County',
    state: 'Washington',
    postcode: '98109',
    country: 'United States',
  },
  osm: { type: 'way', id: 12903132 },
  precise: true,
  source: OSM,
};

/** A ring with a real name, as rings.ts builds them. */
const ring = (level: Ring['level'], name: string, status: Ring['status'] = 'loading'): Ring => ({ level, name, facts: [], status });

const fullRings: Ring[] = [
  ring('house', '400 Broad Street'),
  ring('block', 'the block of Broad Street'),
  ring('street', 'Broad Street'),
  ring('neighborhood', 'Lower Queen Anne'),
  ring('city', 'Seattle'),
  ring('county', 'King County'),
  ring('region', 'Puget Sound'),
  ring('state', 'Washington'),
  ring('plate', 'North American Plate'),
];

const till: GeologyUnit = {
  symbol: 'Qgt',
  name: 'Pleistocene continental glacial till',
  age: 'Pleistocene',
  ageYearsAgo: { from: 2_580_000, to: 11_700 },
  source: DNR,
};

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Walla Walla, 1859')).toBe('Walla Walla, 1859');
    expect(escapeHtml('')).toBe('');
  });

  it('does not double-escape an entity that is already there', () => {
    // It does escape the ampersand again: that is the safe behaviour for raw text.
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

// ---------------------------------------------------------------------------
// formatNumber / formatYear
// ---------------------------------------------------------------------------

describe('formatNumber', () => {
  it.each([
    [0, '0'],
    [1234, '1,234'],
    [1_234_567, '1,234,567'],
    [2.5, '2.5'],
    [-42_000, '-42,000'],
  ])('%s -> %s', (n, expected) => {
    expect(formatNumber(n)).toBe(expected);
  });

  it('prints nothing for NaN or infinity', () => {
    expect(formatNumber(Number.NaN)).toBe('');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('formatYear', () => {
  it.each([
    [1926, '1926'],
    [1889, '1889'],
    [79, '79 CE'],
    [-500, '500 BCE'],
    [-12_000, '12,000 BCE'],
  ])('%s -> %s', (y, expected) => {
    expect(formatYear(y)).toBe(expected);
  });

  it('falls back to the plain number for year 0 and fractions instead of throwing', () => {
    expect(formatYear(0)).toBe('0');
    expect(formatYear(1926.5)).toBe('1,926.5');
  });
});

// ---------------------------------------------------------------------------
// excerpt
// ---------------------------------------------------------------------------

describe('excerpt', () => {
  const prose =
    'Seattle is the most populous city in the state of Washington. It is the seat of King County. ' +
    'The city lies between Puget Sound and Lake Washington, about 100 miles south of the Canadian border.';

  it('returns short text unchanged, with whitespace collapsed', () => {
    expect(excerpt('  Hello   world.\n', 100)).toBe('Hello world.');
  });

  it('cuts at the last sentence end that fits', () => {
    expect(excerpt(prose, 100)).toBe('Seattle is the most populous city in the state of Washington. It is the seat of King County.');
    expect(excerpt(prose, 70)).toBe('Seattle is the most populous city in the state of Washington.');
  });

  it('falls back to a word boundary plus an ellipsis when no sentence end fits', () => {
    const out = excerpt(prose, 40);
    expect(out).toBe('Seattle is the most populous city in…');
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('keeps abbreviations like U.S. together', () => {
    const text = 'It sits on U.S. Route 2, which crosses the state. The road climbs Stevens Pass.';
    // A cut at 20 would land just after "U.S." if that counted as a sentence end.
    expect(excerpt(text, 20)).toBe('It sits on U.S.…');
  });

  it('never keeps only a tiny first sentence when the budget is large', () => {
    const text = 'Yes. ' + 'This is a much longer second sentence that goes on for a while and then some more words.';
    const out = excerpt(text, 60);
    expect(out.startsWith('Yes. This is a much longer')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles a sentence ending in a closing quote', () => {
    const text = 'They called it "the Emerald City." Later the name stuck for good and became official.';
    expect(excerpt(text, 40)).toBe('They called it "the Emerald City."');
  });

  it('gives an empty string for a budget of zero', () => {
    expect(excerpt(prose, 0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// heroSentence
// ---------------------------------------------------------------------------

describe('heroSentence', () => {
  it('reads house, neighborhood, city, county and rock in the sample shape', () => {
    expect(heroSentence(spaceNeedle, fullRings, till)).toBe(
      '400 Broad Street sits in Lower Queen Anne, in Seattle, King County, on Pleistocene continental glacial till.',
    );
  });

  it('leaves the rock clause out when geology is null or missing', () => {
    expect(heroSentence(spaceNeedle, fullRings, null)).toBe('400 Broad Street sits in Lower Queen Anne, in Seattle, King County.');
    expect(heroSentence(spaceNeedle, fullRings)).toBe('400 Broad Street sits in Lower Queen Anne, in Seattle, King County.');
  });

  it('prefers ring names over the raw address when both exist', () => {
    // The rings say "Lower Queen Anne" (from the city atlas); the address said "South Lake Union".
    expect(heroSentence(spaceNeedle, fullRings)).toContain('Lower Queen Anne');
  });

  it('falls back to the address when no rings are given', () => {
    expect(heroSentence(spaceNeedle, [])).toBe('400 Broad Street sits in South Lake Union, in Seattle, King County.');
  });

  it('skips a missing neighborhood', () => {
    const rings = fullRings.filter((r) => r.level !== 'neighborhood');
    const { neighbourhood: _n, suburb: _s, ...withoutNeighborhood } = spaceNeedle.address;
    const place: Place = { ...spaceNeedle, address: withoutNeighborhood };
    expect(heroSentence(place, rings)).toBe('400 Broad Street sits in Seattle, King County.');
  });

  it('skips placeholder ring names such as "This spot" and "Unincorporated area"', () => {
    const rings: Ring[] = [
      { ...ring('house', 'This spot', 'empty'), note: 'general area' },
      ring('street', 'Mountain Loop Highway'),
      ring('neighborhood', 'This neighborhood', 'empty'),
      ring('city', 'Unincorporated area', 'empty'),
      ring('county', 'Snohomish County'),
    ];
    const place: Place = {
      ...spaceNeedle,
      precise: false,
      address: { road: 'Mountain Loop Highway', county: 'Snohomish County', state: 'Washington' },
    };
    expect(heroSentence(place, rings)).toBe('Mountain Loop Highway sits in Snohomish County.');
  });

  it('says "This spot" when there is no house or street', () => {
    const place: Place = { ...spaceNeedle, precise: false, address: { city: 'Spokane', county: 'Spokane County' } };
    expect(heroSentence(place, [])).toBe('This spot sits in Spokane, Spokane County.');
  });

  it('falls back to Washington when nothing at all is named', () => {
    const place: Place = { ...spaceNeedle, precise: false, address: {} };
    expect(heroSentence(place, [])).toBe('This spot sits in Washington.');
  });

  it('does not repeat a neighborhood that is just the city name', () => {
    const { suburb: _s, ...rest } = spaceNeedle.address;
    const place: Place = { ...spaceNeedle, address: { ...rest, neighbourhood: 'Seattle' } };
    expect(heroSentence(place, [])).toBe('400 Broad Street sits in Seattle, King County.');
  });

  it('ignores a house number without a road, and an imprecise match', () => {
    const noRoad: Place = { ...spaceNeedle, address: { houseNumber: '400', city: 'Seattle' } };
    expect(heroSentence(noRoad, [])).toBe('This spot sits in Seattle.');
    const imprecise: Place = { ...spaceNeedle, precise: false };
    expect(heroSentence(imprecise, [])).toBe('Broad Street sits in South Lake Union, in Seattle, King County.');
  });

  it('adds the age in front of a rock name that does not already carry it', () => {
    const basalt: GeologyUnit = { symbol: 'Mv', name: 'Columbia River Basalt', age: 'Miocene', source: DNR };
    expect(heroSentence(spaceNeedle, [], basalt)).toMatch(/on Miocene Columbia River Basalt\.$/);
    const noAge: GeologyUnit = { symbol: 'Qal', name: 'alluvium', age: '', source: DNR };
    expect(heroSentence(spaceNeedle, [], noAge)).toMatch(/on alluvium\.$/);
    const nameless: GeologyUnit = { symbol: 'x', name: ' ', age: 'Eocene', source: DNR };
    expect(heroSentence(spaceNeedle, [], nameless)).not.toContain(' on ');
  });
});

// ---------------------------------------------------------------------------
// distanceWords
// ---------------------------------------------------------------------------

describe('distanceWords', () => {
  it.each([
    [0, 'a few feet'],
    [2, 'a few feet'],
    [25, '80 feet'],
    [100, '330 feet'],
    [300, '980 feet'],
    [400, '0.2 miles'],
    [1609.344, '1 mile'],
    [4000, '2.5 miles'],
    [16_093, '10 miles'],
    [200_000, '124 miles'],
    [2_000_000, '1,243 miles'],
  ])('%s m -> %s', (m, expected) => {
    expect(distanceWords(m)).toBe(expected);
  });

  it('gives an empty string for negative or non-finite input', () => {
    expect(distanceWords(-5)).toBe('');
    expect(distanceWords(Number.NaN)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// ringLabel / ringTagline
// ---------------------------------------------------------------------------

describe('ringLabel and ringTagline', () => {
  it('has a label and a tagline for every level', () => {
    expect(ringLabel('house')).toBe('House');
    expect(ringLabel('neighborhood')).toBe('Neighborhood');
    expect(ringLabel('plate')).toBe('Plate');
    expect(ringTagline('state')).toBe('Washington');
    expect(ringTagline('county')).toMatch(/thirty-nine/);
  });
});

// ---------------------------------------------------------------------------
// The final status line
// ---------------------------------------------------------------------------

describe('summariseOutcome', () => {
  const hero = '400 Broad Street sits in Seattle, King County, on Pleistocene glacial till.';
  const ok = (names: string[] = []): PromiseSettledResult<string[]> => ({ status: 'fulfilled', value: names });
  const crashed = (reason: unknown): PromiseSettledResult<string[]> => ({ status: 'rejected', reason });

  it('says the story is ready, with the hero sentence, when every loader answered', () => {
    expect(summariseOutcome([ok(), ok(), ok()], hero)).toBe(`Story ready: ${hero}`);
    expect(summariseOutcome([], hero)).toBe(`Story ready: ${hero}`);
  });

  it('names each source that did not answer, once, in the order reported', () => {
    const line = summariseOutcome([ok(), ok(['Wikipedia (Seattle, Washington)', 'Wikipedia (Lower Queen Anne, Seattle)']), ok(['geology']), ok(['geology'])], hero);
    expect(line).toBe(
      'Story ready, but some sources did not answer (Wikipedia (Seattle, Washington), Wikipedia (Lower Queen Anne, Seattle), geology); the rest of the story is here.',
    );
    expect(line.startsWith('Story ready:')).toBe(false);
  });

  it('counts a loader that rejected outright as an unexpected error', () => {
    expect(summariseOutcome([ok(), crashed(new Error('boom'))], hero)).toBe(
      'Story ready, but some sources did not answer (an unexpected error); the rest of the story is here.',
    );
  });

  it('ignores blank names and copes with no hero sentence', () => {
    expect(summariseOutcome([ok(['', '  '])], hero)).toBe(`Story ready: ${hero}`);
    expect(summariseOutcome([ok()], '  ')).toBe('Story ready.');
  });
});
