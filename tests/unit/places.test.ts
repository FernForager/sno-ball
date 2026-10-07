/**
 * Tests for the written-history module (places.ts) and the county table
 * (counties.ts).
 *
 * No network ever runs here. fetchJson is mocked and answers from the JSON
 * files in tests/fixtures/places/. Provenance of those fixtures:
 *   - wikipedia-summary-seattle / -king-county / -washington / -walla-walla
 *     and wikidata-seattle-population: REAL responses captured on 2026-10-07
 *     (copied from branch helper/fixtures-1; see its
 *     tests/fixtures/live/README.md for the exact request URLs).
 *   - wikipedia-pageprops-seattle, wikipedia-pageprops-missing,
 *     wikipedia-summary-disambiguation, wikidata-population-decades and
 *     wa-counties-odd-rows: SYNTHETIC, written by hand in the documented
 *     shapes of those APIs (the population figures are Seattle's census
 *     counts, plus a few made-up mid-decade estimates and bad rows).
 *   - public/data/wa-counties.json: the real pre-baked county file, built
 *     from Wikidata by the helper session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fact, Place, Ring, RingLevel } from '../../src/lib/types';
import summarySeattle from '../fixtures/places/wikipedia-summary-seattle.json';
import summaryKingCounty from '../fixtures/places/wikipedia-summary-king-county.json';
import summaryWashington from '../fixtures/places/wikipedia-summary-washington.json';
import summaryWallaWalla from '../fixtures/places/wikipedia-summary-walla-walla.json';
import summaryDisambiguation from '../fixtures/places/wikipedia-summary-disambiguation.json';
import pagepropsSeattle from '../fixtures/places/wikipedia-pageprops-seattle.json';
import pagepropsMissing from '../fixtures/places/wikipedia-pageprops-missing.json';
import populationSeattle from '../fixtures/places/wikidata-seattle-population.json';
import populationDecades from '../fixtures/places/wikidata-population-decades.json';
import countiesOddRows from '../fixtures/places/wa-counties-odd-rows.json';
import waCounties from '../../public/data/wa-counties.json';

// ---------------------------------------------------------------------------
// Mocks for the shared infrastructure (same pattern as the sibling tests):
//  - fetchJson answers from fixtures, routed by URL in each test
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

import { HttpError } from '../../src/lib/http';
import {
  EXCERPT_MAX_CHARS,
  MAX_POPULATION_FACTS,
  SUMMARY_TTL_MS,
  WIKIDATA_TTL_MS,
  assertQid,
  excerpt,
  normaliseTitle,
  pageFromSummary,
  pagepropsUrl,
  populationFacts,
  populationHistory,
  populationQuery,
  populationReadings,
  qidFromPageprops,
  sentenceEnds,
  sparqlUrl,
  sparqlYear,
  summaryFact,
  thinToDecades,
  wikidataIdForTitle,
  wikipediaPage,
  wikipediaSummary,
  wikipediaSummaryUrl,
  wikipediaTitleFor,
} from '../../src/lib/places';
import {
  COUNTIES_FILE,
  countiesUrl,
  countyByName,
  countyFacts,
  countyForPlace,
  describeInception,
  loadCounties,
  parseCounties,
  resetCounties,
  type County,
} from '../../src/lib/counties';

// ---------------------------------------------------------------------------
// Test places and rings, shaped like geocode.ts and rings.ts produce them
// ---------------------------------------------------------------------------

const OSM_SOURCE = { name: 'OpenStreetMap Nominatim', url: 'https://nominatim.org', license: 'ODbL' };

const seattlePlace: Place = {
  query: '400 Broad St Seattle WA',
  point: { lng: -122.3493, lat: 47.6205 },
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
  precise: true,
  source: OSM_SOURCE,
};

const spokanePlace: Place = {
  query: '507 N Howard St Spokane WA',
  point: { lng: -117.426, lat: 47.6588 },
  displayName: '507, North Howard Street, Riverfront, Spokane, Spokane County, Washington, 99201, United States',
  address: {
    houseNumber: '507',
    road: 'North Howard Street',
    neighbourhood: 'Riverfront',
    city: 'Spokane',
    county: 'Spokane County',
    state: 'Washington',
    country: 'United States',
  },
  precise: true,
  source: OSM_SOURCE,
};

/** A match with no city and no county, e.g. a rural road. */
const ruralPlace: Place = {
  query: 'somewhere rural',
  point: { lng: -120.5, lat: 47.5 },
  displayName: 'Some Road, Washington, United States',
  address: { road: 'Some Road', state: 'Washington', country: 'United States' },
  precise: false,
  source: OSM_SOURCE,
};

function ring(level: RingLevel, name: string, extra: Partial<Ring> = {}): Ring {
  return { level, name, facts: [], status: 'loading', ...extra };
}

/** Route fetchJson by a substring of the URL; anything unmatched rejects loudly. */
function routeFetch(routes: Array<[string, unknown]>): void {
  mocks.fetchJson.mockImplementation(async (url: string) => {
    for (const [needle, answer] of routes) {
      if (url.includes(needle)) {
        if (answer instanceof Error) throw answer;
        return answer;
      }
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

beforeEach(() => {
  mocks.fetchJson.mockReset();
  mocks.cached.mockClear();
  mocks.limiterFor.mockClear();
  mocks.store.clear();
  resetCounties();
});

// ---------------------------------------------------------------------------
// Excerpts
// ---------------------------------------------------------------------------

describe('excerpt', () => {
  const seattleFirstSentence =
    'Seattle is the most populous city in the U.S. state of Washington and the Pacific Northwest region of North America.';

  it('keeps only the first sentence of the Seattle extract, because two would pass 320 characters', () => {
    const body = excerpt(summarySeattle.extract);
    expect(body).toBe(seattleFirstSentence);
    expect(body.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
  });

  it('does not mistake "U.S. state" for a sentence end', () => {
    const ends = sentenceEnds(summarySeattle.extract);
    expect(summarySeattle.extract.slice(0, ends[0])).toBe(seattleFirstSentence);
  });

  it('keeps the first two sentences of the King County extract (they fit)', () => {
    const body = excerpt(summaryKingCounty.extract);
    expect(body).toBe(
      'King County is a county located in the U.S. state of Washington. The population was 2,269,675 in the 2020 census, making it the most populous county in Washington, and the 13th-most populous in the United States.',
    );
    expect(body.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
  });

  it('stays within the cap and ends on a sentence boundary for every real fixture', () => {
    for (const fixture of [summarySeattle, summaryKingCounty, summaryWashington, summaryWallaWalla]) {
      const body = excerpt(fixture.extract);
      expect(body.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
      expect(body.endsWith('.')).toBe(true);
      expect(fixture.extract.startsWith(body)).toBe(true);
    }
  });

  it('skips abbreviations such as Mt. and St. and initials', () => {
    const text = 'Mt. Rainier is tall. St. Helens erupted in 1980. A third sentence follows.';
    expect(excerpt(text)).toBe('Mt. Rainier is tall. St. Helens erupted in 1980.');
    expect(excerpt('John A. Smith founded it. It grew. It shrank.')).toBe('John A. Smith founded it. It grew.');
  });

  it('collapses whitespace and line breaks', () => {
    expect(excerpt('One  sentence.\n\nTwo sentences.\nThree.')).toBe('One sentence. Two sentences.');
  });

  it('returns a short single sentence whole, even without a final period', () => {
    expect(excerpt('Just a fragment')).toBe('Just a fragment');
    expect(excerpt('Short.')).toBe('Short.');
  });

  it('cuts an over-long first sentence at a word and adds an ellipsis', () => {
    const long = `${'word '.repeat(100).trim()}.`; // 500 characters, one sentence
    const body = excerpt(long);
    expect(body.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
    expect(body.endsWith('word…')).toBe(true);
  });

  it('honours custom limits', () => {
    expect(excerpt('One. Two. Three. Four.', 100, 3)).toBe('One. Two. Three.');
    expect(excerpt('A. B. C. D.')).toBe('A. B. C. D.'); // single letters read as initials, so this is one sentence
    expect(excerpt('One. Two. Three.', 100, 1)).toBe('One.');
  });
});

// ---------------------------------------------------------------------------
// Wikipedia summaries
// ---------------------------------------------------------------------------

describe('wikipediaSummary', () => {
  it('builds the summary fact for Seattle from the REST summary', async () => {
    routeFetch([['/page/summary/Seattle', summarySeattle]]);
    const fact = await wikipediaSummary('Seattle');
    expect(fact).toEqual<Fact>({
      kind: 'summary',
      title: 'Seattle',
      body: 'Seattle is the most populous city in the U.S. state of Washington and the Pacific Northwest region of North America.',
      source: { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Seattle', license: 'CC BY-SA 4.0' },
      confidence: 'high',
    });
    expect(mocks.fetchJson).toHaveBeenCalledWith('https://en.wikipedia.org/api/rest_v1/page/summary/Seattle');
    expect(mocks.limiterFor).toHaveBeenCalledWith('en.wikipedia.org');
  });

  it('encodes titles with spaces, commas and parentheses the way Wikipedia expects', () => {
    expect(wikipediaSummaryUrl('King County, Washington')).toBe(
      'https://en.wikipedia.org/api/rest_v1/page/summary/King_County%2C_Washington',
    );
    expect(wikipediaSummaryUrl('Washington (state)')).toBe(
      'https://en.wikipedia.org/api/rest_v1/page/summary/Washington_(state)',
    );
    expect(normaliseTitle('  Walla  Walla, Washington ')).toBe('Walla_Walla,_Washington');
  });

  it('uses the article title and URL from the response, not the title asked for', async () => {
    routeFetch([['King_County', summaryKingCounty]]);
    const fact = await wikipediaSummary('King County, Washington');
    expect(fact?.title).toBe('King County, Washington');
    expect(fact?.source.url).toBe('https://en.wikipedia.org/wiki/King_County%2C_Washington');
    expect(fact?.body?.startsWith('King County is a county')).toBe(true);
  });

  it('caches for 7 days and does not fetch twice for the same title', async () => {
    routeFetch([['Washington_(state)', summaryWashington]]);
    const a = await wikipediaSummary('Washington (state)');
    const b = await wikipediaSummary('Washington  (state)');
    expect(a).toEqual(b);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.cached).toHaveBeenCalledWith('wikipedia:summary:Washington_(state)', { ttlMs: SUMMARY_TTL_MS }, expect.any(Function));
    expect(SUMMARY_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('resolves to null on a 404 (no such article) and remembers the miss', async () => {
    const url = wikipediaSummaryUrl('Nowhere, Washington');
    routeFetch([['Nowhere', new HttpError(404, url)]]);
    expect(await wikipediaSummary('Nowhere, Washington')).toBeNull();
    expect(await wikipediaSummary('Nowhere, Washington')).toBeNull();
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
  });

  it('throws other HTTP errors so the caller can tell "no article" from "service down"', async () => {
    routeFetch([['Seattle', new HttpError(503, wikipediaSummaryUrl('Seattle'))]]);
    await expect(wikipediaSummary('Seattle')).rejects.toBeInstanceOf(HttpError);
  });

  it('resolves to null for a disambiguation page', async () => {
    routeFetch([['Washington', summaryDisambiguation]]);
    expect(await wikipediaSummary('Washington')).toBeNull();
  });

  it('returns null for a blank title without fetching', async () => {
    expect(await wikipediaSummary('   ')).toBeNull();
    expect(mocks.fetchJson).not.toHaveBeenCalled();
  });

  it('exposes the Wikidata id, description and thumbnail on the page object', async () => {
    routeFetch([['Walla_Walla', summaryWallaWalla]]);
    const page = await wikipediaPage('Walla Walla, Washington');
    expect(page?.title).toBe('Walla Walla, Washington');
    expect(page?.wikidata).toMatch(/^Q\d+$/);
    expect(page?.description).toBeTruthy();
    expect(page?.thumbnail?.url).toMatch(/^https:\/\//);
    expect(page?.thumbnail?.width).toBeGreaterThan(0);
    expect(page && summaryFact(page).source.license).toBe('CC BY-SA 4.0');
  });

  it('pageFromSummary rejects responses missing their essentials', () => {
    expect(pageFromSummary({})).toBeNull();
    expect(pageFromSummary({ title: 'X', extract: 'Something.' })).toBeNull();
    expect(pageFromSummary({ title: 'X', extract: '', content_urls: { desktop: { page: 'https://x' } } })).toBeNull();
    const page = pageFromSummary({ title: 'X', extract: 'Something.', content_urls: { desktop: { page: 'https://x' } } });
    expect(page).toEqual({ title: 'X', url: 'https://x', extract: 'Something.' });
  });
});

// ---------------------------------------------------------------------------
// Title mapping
// ---------------------------------------------------------------------------

describe('wikipediaTitleFor', () => {
  it('maps city, county, state and Seattle neighborhood rings to article titles', () => {
    expect(wikipediaTitleFor('city', ring('city', 'Seattle'), seattlePlace)).toBe('Seattle, Washington');
    expect(wikipediaTitleFor('county', ring('county', 'King County'), seattlePlace)).toBe('King County, Washington');
    expect(wikipediaTitleFor('state', ring('state', 'Washington'), seattlePlace)).toBe('Washington (state)');
    expect(wikipediaTitleFor('neighborhood', ring('neighborhood', 'Belltown'), seattlePlace)).toBe('Belltown, Seattle');
  });

  it('accepts a county ring named without the word County', () => {
    expect(wikipediaTitleFor('county', ring('county', 'King'), seattlePlace)).toBe('King County, Washington');
    expect(wikipediaTitleFor('county', ring('county', 'Walla Walla county'), { ...seattlePlace, address: { county: 'Walla Walla' } })).toBe(
      'Walla Walla County, Washington',
    );
  });

  it('only maps neighborhoods inside Seattle', () => {
    expect(wikipediaTitleFor('neighborhood', ring('neighborhood', 'Riverfront'), spokanePlace)).toBeUndefined();
    expect(wikipediaTitleFor('city', ring('city', 'Spokane'), spokanePlace)).toBe('Spokane, Washington');
  });

  it('gives nothing for the house, block, street, region and plate rings', () => {
    for (const level of ['house', 'block', 'street', 'region', 'plate'] as const) {
      expect(wikipediaTitleFor(level, ring(level, 'anything'), seattlePlace)).toBeUndefined();
    }
  });

  it('gives nothing for a ring the address could not name (placeholder names)', () => {
    expect(wikipediaTitleFor('city', ring('city', 'Unincorporated area', { status: 'empty' }), ruralPlace)).toBeUndefined();
    expect(wikipediaTitleFor('county', ring('county', 'This county', { status: 'empty' }), ruralPlace)).toBeUndefined();
    expect(wikipediaTitleFor('state', ring('state', 'Washington'), ruralPlace)).toBe('Washington (state)');
  });

  it('prefers a title the ring already knows, stripping an "en:" prefix', () => {
    expect(wikipediaTitleFor('city', ring('city', 'Seattle', { wikipedia: 'en:Seattle' }), seattlePlace)).toBe('Seattle');
    expect(wikipediaTitleFor('street', ring('street', 'Broad Street', { wikipedia: 'Broad Street (Seattle)' }), seattlePlace)).toBe(
      'Broad Street (Seattle)',
    );
  });
});

// ---------------------------------------------------------------------------
// Wikidata ids
// ---------------------------------------------------------------------------

describe('wikidataIdForTitle', () => {
  it('finds Q5083 for Seattle via the pageprops API, following redirects', async () => {
    routeFetch([['prop=pageprops', pagepropsSeattle]]);
    expect(await wikidataIdForTitle('Seattle, Washington')).toBe('Q5083');
    const url = mocks.fetchJson.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://en.wikipedia.org/w/api.php?')).toBe(true);
    expect(url).toContain('action=query');
    expect(url).toContain('prop=pageprops');
    expect(url).toContain('ppprop=wikibase_item');
    expect(url).toContain('titles=Seattle%2C_Washington');
    expect(url).toContain('format=json');
    expect(url).toContain('origin=*');
    expect(url).toContain('redirects=1');
  });

  it('resolves to undefined for a missing page, and caches the miss for 30 days', async () => {
    routeFetch([['prop=pageprops', pagepropsMissing]]);
    expect(await wikidataIdForTitle('Nowhere, Washington')).toBeUndefined();
    expect(await wikidataIdForTitle('Nowhere, Washington')).toBeUndefined();
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.cached).toHaveBeenCalledWith('wikipedia:qid:Nowhere,_Washington', { ttlMs: WIKIDATA_TTL_MS }, expect.any(Function));
  });

  it('reads both the keyed and the array (formatversion=2) page shapes', () => {
    expect(qidFromPageprops(pagepropsSeattle)).toBe('Q5083');
    expect(qidFromPageprops({ query: { pages: [{ title: 'Seattle', pageprops: { wikibase_item: 'Q5083' } }] } })).toBe('Q5083');
    expect(qidFromPageprops({ query: { pages: [{ title: 'X', pageprops: { wikibase_item: 'not-an-id' } }] } })).toBeUndefined();
    expect(qidFromPageprops({})).toBeUndefined();
    expect(pagepropsUrl('Washington (state)')).toContain('titles=Washington_%28state%29');
  });
});

// ---------------------------------------------------------------------------
// Population history
// ---------------------------------------------------------------------------

describe('populationHistory', () => {
  it('builds two facts from the real Seattle readings (2010 census beats the 2018 estimate)', async () => {
    routeFetch([['query.wikidata.org/sparql', populationSeattle]]);
    const facts = await populationHistory('Q5083');
    expect(facts.map((f) => f.title)).toEqual(['Population 608,660 in 2010', 'Population 737,015 in 2020']);
    expect(facts.map((f) => f.year)).toEqual([2010, 2020]);
    for (const f of facts) {
      expect(f.kind).toBe('population');
      expect(f.source).toEqual({ name: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q5083', license: 'CC0' });
    }
    expect(mocks.limiterFor).toHaveBeenCalledWith('query.wikidata.org');
  });

  it('sends the documented SPARQL query, URL-encoded, asking for JSON', async () => {
    routeFetch([['query.wikidata.org/sparql', populationSeattle]]);
    await populationHistory('Q5083');
    const url = mocks.fetchJson.mock.calls[0]?.[0] as string;
    expect(url.startsWith('https://query.wikidata.org/sparql?format=json&query=')).toBe(true);
    const query = new URL(url).searchParams.get('query');
    expect(query).toBe('SELECT ?pop ?time WHERE { wd:Q5083 p:P1082 ?s . ?s ps:P1082 ?pop . ?s pq:P585 ?time } ORDER BY ?time');
    expect(sparqlUrl(populationQuery('Q5083'))).toBe(url);
  });

  it('thins a long series to one reading per decade and at most 8 facts', async () => {
    routeFetch([['query.wikidata.org/sparql', populationDecades]]);
    const facts = await populationHistory('Q5083');
    expect(facts.length).toBe(MAX_POPULATION_FACTS);
    expect(facts.length).toBe(8);
    const years = facts.map((f) => f.year ?? 0);
    expect(years[0]).toBe(1870); // oldest kept
    expect(years[years.length - 1]).toBe(2020); // newest decade kept; its census count beats the 2023 estimate
    expect(years).not.toContain(2023);
    expect(new Set(years.map((y) => Math.floor(y / 10))).size).toBe(8); // all different decades
    expect([...years].sort((a, b) => a - b)).toEqual(years); // oldest first
    expect(facts.find((f) => f.year === 1910)?.title).toBe('Population 237,194 in 1910');
  });

  it('caches the readings for 30 days', async () => {
    routeFetch([['query.wikidata.org/sparql', populationSeattle]]);
    await populationHistory('Q5083');
    await populationHistory('Q5083');
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.cached).toHaveBeenCalledWith('wikidata:population:Q5083', { ttlMs: WIKIDATA_TTL_MS }, expect.any(Function));
    expect(WIKIDATA_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('rejects an id that is not Q + digits before touching the network', async () => {
    await expect(populationHistory('Seattle')).rejects.toBeInstanceOf(RangeError);
    await expect(populationHistory('Q5083; DROP')).rejects.toBeInstanceOf(RangeError);
    expect(mocks.fetchJson).not.toHaveBeenCalled();
    expect(assertQid(' Q5083 ')).toBe('Q5083');
  });

  it('resolves to an empty list when Wikidata has no dated readings', async () => {
    routeFetch([['query.wikidata.org/sparql', { head: { vars: ['pop', 'time'] }, results: { bindings: [] } }]]);
    expect(await populationHistory('Q1')).toEqual([]);
  });

  it('populationReadings skips rows with bad numbers or missing dates', () => {
    const readings = populationReadings(populationDecades);
    expect(readings.length).toBe(19); // 21 rows minus "not a number" and the one without a time
    expect(readings[0]).toEqual({ year: 1870, population: 1107 });
    expect(readings.every((r) => Number.isInteger(r.population))).toBe(true);
    expect(sparqlYear('2010-04-01T00:00:00Z')).toBe(2010);
    expect(sparqlYear('+1852-12-22T00:00:00Z')).toBe(1852);
    expect(sparqlYear('-0500-00-00T00:00:00Z')).toBe(-500);
    expect(sparqlYear('garbage')).toBeUndefined();
    expect(sparqlYear(undefined)).toBeUndefined();
  });

  it('thinToDecades prefers the census year, else the latest estimate in the decade', () => {
    const r = (year: number, population: number) => ({ year, population });
    expect(thinToDecades([r(2011, 1), r(2015, 2), r(2019, 3)])).toEqual([r(2019, 3)]);
    expect(thinToDecades([r(2010, 1), r(2018, 2), r(2019, 3)])).toEqual([r(2010, 1)]);
    expect(thinToDecades([r(2019, 3), r(2010, 1)])).toEqual([r(2010, 1)]); // order of input does not matter
    const many = Array.from({ length: 16 }, (_, i) => r(1870 + i * 10, i));
    const picked = thinToDecades(many, 8);
    expect(picked.length).toBe(8);
    expect(picked[0]).toEqual(many[0]);
    expect(picked[7]).toEqual(many[15]);
    expect(thinToDecades(many, 1)).toEqual([many[15]]);
    expect(thinToDecades([], 8)).toEqual([]);
  });

  it('populationFacts formats counts with thousands separators', () => {
    const facts = populationFacts('Q42', [{ year: 1900, population: 237194 }]);
    expect(facts).toEqual<Fact[]>([
      {
        kind: 'population',
        title: 'Population 237,194 in 1900',
        year: 1900,
        source: { name: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q42', license: 'CC0' },
        confidence: 'high',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Counties
// ---------------------------------------------------------------------------

describe('loadCounties', () => {
  it('reads all 39 counties from the pre-baked JSON, once per visit', async () => {
    routeFetch([[COUNTIES_FILE, waCounties]]);
    const counties = await loadCounties();
    expect(counties.length).toBe(39);
    expect(counties.map((c) => c.name)).toEqual([...counties.map((c) => c.name)].sort((a, b) => a.localeCompare(b, 'en')));
    expect(counties.every((c) => /^Q\d+$/.test(c.qid) && c.name.endsWith(' County'))).toBe(true);
    expect(counties.every((c) => c.inception && c.seat && c.fips && c.wikipedia)).toBe(true);

    const again = await loadCounties();
    expect(again).toBe(counties);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    const url = mocks.fetchJson.mock.calls[0]?.[0] as string;
    expect(url.endsWith('/data/wa-counties.json')).toBe(true);
    expect(url).toBe(countiesUrl());
  });

  it('retries after a failed load instead of remembering the failure', async () => {
    mocks.fetchJson.mockRejectedValueOnce(new HttpError(503, countiesUrl()));
    await expect(loadCounties()).rejects.toBeInstanceOf(HttpError);
    routeFetch([[COUNTIES_FILE, waCounties]]);
    expect((await loadCounties()).length).toBe(39);
  });

  it('parseCounties drops null fields and skips unusable rows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const counties = parseCounties(countiesOddRows);
    warn.mockRestore();
    expect(counties.map((c) => c.name)).toEqual(['Nowhere County', 'Pend Oreille County', 'Thurston County']);
    expect(counties.find((c) => c.qid === 'Q485301')?.name).toBe('Pend Oreille County'); // label was only the id
    const thurston = counties.find((c) => c.qid === 'Q108738') as County;
    expect(thurston).toEqual({
      qid: 'Q108738',
      name: 'Thurston County',
      inception: '1852-01-01',
      seat: 'Olympia',
      population: 294793,
      populationYear: 2020,
      wikipedia: 'Thurston County, Washington',
      fips: '53067',
    });
    expect('areaKm2' in thurston).toBe(false);
    expect('namedAfter' in thurston).toBe(false);
    expect(() => parseCounties({ not: 'an array' })).toThrow(TypeError);
  });
});

describe('countyByName', () => {
  const counties = parseCounties(waCounties);

  it('accepts "King" and "King County" in any letter case', () => {
    expect(countyByName(counties, 'King')?.qid).toBe('Q108861');
    expect(countyByName(counties, 'King County')?.qid).toBe('Q108861');
    expect(countyByName(counties, 'king county')?.qid).toBe('Q108861');
    expect(countyByName(counties, '  Walla Walla  ')?.name).toBe('Walla Walla County');
    expect(countyByName(counties, 'Grays Harbor County')?.seat).toBe('Montesano');
  });

  it('is undefined for unknown or blank names', () => {
    expect(countyByName(counties, 'Multnomah County')).toBeUndefined();
    expect(countyByName(counties, '')).toBeUndefined();
    expect(countyByName(counties, 'County')).toBeUndefined();
  });

  it('countyForPlace reads the county part of a geocoded address', () => {
    expect(countyForPlace(counties, seattlePlace)?.name).toBe('King County');
    expect(countyForPlace(counties, spokanePlace)?.name).toBe('Spokane County');
    expect(countyForPlace(counties, ruralPlace)).toBeUndefined();
  });
});

describe('countyFacts', () => {
  const counties = parseCounties(waCounties);
  const king = countyByName(counties, 'King') as County;
  const adams = countyByName(counties, 'Adams') as County;

  it('gives founded, seat, named-after and population facts for King County', () => {
    const facts = countyFacts(king);
    const source = { name: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q108861', license: 'CC0' };
    expect(facts).toEqual<Fact[]>([
      { kind: 'founded', title: 'Established December 22, 1852', year: 1852, source, confidence: 'high' },
      { kind: 'seat', title: 'County seat: Seattle', source, confidence: 'high' },
      { kind: 'named-after', title: 'Named after Martin Luther King Jr.', source, confidence: 'high' },
      { kind: 'population', title: 'Population 2,269,675 in 2020', year: 2020, source, confidence: 'high' },
    ]);
  });

  it('shows only the year, with medium confidence, when Wikidata records a -01-01 date', () => {
    const founded = countyFacts(adams).find((f) => f.kind === 'founded');
    expect(founded?.title).toBe('Established in 1883');
    expect(founded?.year).toBe(1883);
    expect(founded?.confidence).toBe('medium');
  });

  it('leaves out facts whose data is missing', () => {
    const bare: County = { qid: 'Q1', name: 'Bare County' };
    expect(countyFacts(bare)).toEqual([]);
    const seatOnly: County = { qid: 'Q1', name: 'Bare County', seat: 'Somewhere', namedAfter: [] };
    expect(countyFacts(seatOnly).map((f) => f.kind)).toEqual(['seat']);
    const popNoYear: County = { qid: 'Q1', name: 'Bare County', population: 1234 };
    expect(countyFacts(popNoYear)[0]).toEqual({ kind: 'population', title: 'Population 1,234', source: expect.anything(), confidence: 'high' });
  });

  it('joins several namesakes with "and"', () => {
    const two: County = { qid: 'Q1', name: 'Two County', namedAfter: ['Lewis', 'Clark'] };
    expect(countyFacts(two)[0]?.title).toBe('Named after Lewis and Clark');
    const three: County = { qid: 'Q1', name: 'Three County', namedAfter: ['A', 'B', 'C'] };
    expect(countyFacts(three)[0]?.title).toBe('Named after A, B and C');
  });

  it('every real county yields at least founded, seat and population facts with a Wikidata source', () => {
    for (const county of counties) {
      const kinds = countyFacts(county).map((f) => f.kind);
      expect(kinds).toContain('founded');
      expect(kinds).toContain('seat');
      expect(kinds).toContain('population');
      for (const fact of countyFacts(county)) {
        expect(fact.source.name).toBe('Wikidata');
        expect(fact.source.url).toBe(`https://www.wikidata.org/wiki/${county.qid}`);
        expect(fact.source.license).toBe('CC0');
      }
    }
  });

  it('describeInception reads full dates, year-only dates and bare years', () => {
    expect(describeInception('1852-12-22')).toEqual({ text: 'December 22, 1852', year: 1852, exact: true });
    expect(describeInception('1883-01-01')).toEqual({ text: 'in 1883', year: 1883, exact: false });
    expect(describeInception('1883')).toEqual({ text: 'in 1883', year: 1883, exact: false });
    expect(describeInception('1861-01-14')).toEqual({ text: 'January 14, 1861', year: 1861, exact: true });
    expect(describeInception('not a date')).toBeUndefined();
    expect(describeInception('0000-05-05')).toBeUndefined();
  });
});
