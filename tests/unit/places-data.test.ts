/**
 * Tests for the pre-baked cities and towns (places-data.ts).
 *
 * No network: fetchJson is mocked. The three-entry fixture is SYNTHETIC
 * (Seattle's row is real; the two "Riverside" rows stand in for two towns
 * sharing a name, which the real file happens not to have); the full
 * public/data/wa-places.json is read once to check it parses whole.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { PLACES_FILE, loadPlaces, parsePlaces, placeByName, placesUrl, resetPlaces, type PlaceRecord } from '../../src/lib/places-data';

const THREE: unknown[] = [
  { qid: 'Q5083', name: 'Seattle', county: 'King County', inception: '1851-11-13', population: 737015, populationYear: 2020, lat: 47.605, lon: -122.33, wikipedia: 'Seattle' },
  { qid: 'Q2151727', name: 'Riverside', county: 'Okanogan County', inception: null, population: 290, populationYear: 2020, lat: 48.5, lon: -119.5, wikipedia: 'Riverside, Washington' },
  { qid: 'Q999999', name: 'Riverside', county: 'Spokane County', inception: null, population: null, populationYear: null, lat: null, lon: null, wikipedia: null },
];

beforeEach(() => {
  mocks.fetchJson.mockReset();
  resetPlaces();
});

describe('loadPlaces', () => {
  it('fetches the file from the site once per visit and sorts by name', async () => {
    mocks.fetchJson.mockResolvedValue(THREE);
    const places = await loadPlaces();
    expect(places.map((p) => p.name)).toEqual(['Riverside', 'Riverside', 'Seattle']);
    expect(await loadPlaces()).toBe(places);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.fetchJson.mock.calls[0]?.[0]).toBe(placesUrl());
    expect(placesUrl().endsWith(`/${PLACES_FILE}`)).toBe(true);
  });

  it('retries after a failed load instead of remembering the failure', async () => {
    mocks.fetchJson.mockRejectedValueOnce(new HttpError(503, placesUrl()));
    await expect(loadPlaces()).rejects.toBeInstanceOf(HttpError);
    mocks.fetchJson.mockResolvedValue(THREE);
    expect((await loadPlaces()).length).toBe(3);
  });

  it('parsePlaces drops null fields, skips unusable rows and rejects a non-array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parsed = parsePlaces([...THREE, { name: 'No id' }, { qid: 'not-an-id', name: 'Bad id' }, 'junk', null]);
    expect(parsed.length).toBe(3);
    expect(parsed[2]).toEqual<PlaceRecord>({
      qid: 'Q5083',
      name: 'Seattle',
      county: 'King County',
      inception: '1851-11-13',
      population: 737015,
      populationYear: 2020,
      lat: 47.605,
      lon: -122.33,
      wikipedia: 'Seattle',
    });
    expect(parsed[1]).toEqual<PlaceRecord>({ qid: 'Q999999', name: 'Riverside', county: 'Spokane County' });
    expect(warn).toHaveBeenCalledTimes(4);
    expect(() => parsePlaces({})).toThrow(TypeError);
    warn.mockRestore();
  });

  it('reads every entry of the real file with a Wikidata id and a name', () => {
    const places = parsePlaces(waPlaces);
    expect(places.length).toBe(288);
    expect(places.every((p) => /^Q\d+$/.test(p.qid) && p.name.length > 0)).toBe(true);
    expect(placeByName(places, 'Seattle', 'King County')?.qid).toBe('Q5083');
    expect(placeByName(places, 'Spokane', 'Spokane County')?.wikipedia).toBe('Spokane, Washington');
    expect(placeByName(places, 'Walla Walla')?.qid).toBe('Q222338');
  });
});

describe('placeByName', () => {
  const places = parsePlaces(THREE);

  it('matches the name ignoring letter case and extra spaces', () => {
    expect(placeByName(places, 'seattle')?.qid).toBe('Q5083');
    expect(placeByName(places, '  SEATTLE ')?.qid).toBe('Q5083');
    expect(placeByName(places, 'Seattle', 'Spokane County')?.qid).toBe('Q5083'); // the only Seattle, whatever the county
  });

  it('prefers the entry in the same county when two towns share a name', () => {
    expect(placeByName(places, 'Riverside', 'Spokane County')?.qid).toBe('Q999999');
    expect(placeByName(places, 'Riverside', 'Okanogan')?.qid).toBe('Q2151727');
    expect(placeByName(places, 'riverside', 'okanogan county')?.qid).toBe('Q2151727');
  });

  it('falls back to the first by name order with no county or an unknown one', () => {
    expect(placeByName(places, 'Riverside')?.qid).toBe('Q2151727');
    expect(placeByName(places, 'Riverside', 'King County')?.qid).toBe('Q2151727');
  });

  it('is undefined for an unknown or blank name', () => {
    expect(placeByName(places, 'Tacoma')).toBeUndefined();
    expect(placeByName(places, '')).toBeUndefined();
    expect(placeByName(places, '   ', 'King County')).toBeUndefined();
  });
});
