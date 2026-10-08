/**
 * Tests for the pre-baked Wikipedia excerpts (wiki-summaries.ts).
 *
 * No network: fetchJson is mocked. The main fixture is a frozen copy of
 * the four-entry placeholder (tests/fixtures/places/wiki-summaries-four.json,
 * built from the REST summary responses captured on 2026-10-07), so these
 * tests keep passing once the full public/data/wiki-summaries.json lands;
 * that real file is only checked to parse whole. Odd shapes are inline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fact } from '../../src/lib/types';
import wikiSummaries from '../fixtures/places/wiki-summaries-four.json';
import publicSummaries from '../../public/data/wiki-summaries.json';

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
  WIKI_SUMMARIES_FILE,
  findWikiSummary,
  loadWikiSummaries,
  parseWikiSummaries,
  resetWikiSummaries,
  summaryFactFromEntry,
  wikiSummariesUrl,
  type WikiSummaryEntry,
} from '../../src/lib/wiki-summaries';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.fetchJson.mockReset();
  resetWikiSummaries();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('loadWikiSummaries', () => {
  it('fetches the file from the site once per visit and shares the result', async () => {
    mocks.fetchJson.mockResolvedValue(wikiSummaries);
    const a = await loadWikiSummaries();
    const b = await loadWikiSummaries();
    expect(a).toBe(b);
    expect(Object.keys(a)).toEqual(['Washington (state)', 'King County, Washington', 'Seattle', 'Walla Walla, Washington']);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.fetchJson.mock.calls[0]?.[0]).toBe(wikiSummariesUrl());
    expect(wikiSummariesUrl().endsWith(`/${WIKI_SUMMARIES_FILE}`)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('yields an empty map, with one warning, when the file is missing (404)', async () => {
    mocks.fetchJson.mockRejectedValue(new HttpError(404, wikiSummariesUrl()));
    expect(await loadWikiSummaries()).toEqual({});
    expect(await loadWikiSummaries()).toEqual({});
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('yields an empty map, with one warning, when the JSON is not an object of entries', async () => {
    mocks.fetchJson.mockResolvedValue(['not', 'an', 'object']);
    expect(await loadWikiSummaries()).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);

    resetWikiSummaries();
    mocks.fetchJson.mockResolvedValue('<!doctype html>');
    expect(await loadWikiSummaries()).toEqual({});
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('parseWikiSummaries keeps good entries, drops bad ones and nulls a malformed thumbnail', () => {
    const parsed = parseWikiSummaries({
      Good: { title: 'Good', extract: 'Text.', url: 'https://x/Good', thumbnail: { source: 'https://x/t.jpg', width: 1, height: 2 }, description: 'd', fetchedAt: '2026-10-07T00:00:00Z' },
      NoThumb: { title: 'NoThumb', extract: 'Text.', url: 'https://x/NoThumb', thumbnail: { source: 'https://x/t.jpg' } },
      NoExtract: { title: 'NoExtract', extract: '', url: 'https://x/NoExtract' },
      NotAnObject: 'nope',
      Nothing: null,
    });
    expect(Object.keys(parsed)).toEqual(['Good', 'NoThumb']);
    expect(parsed['Good']).toEqual({
      title: 'Good',
      extract: 'Text.',
      url: 'https://x/Good',
      thumbnail: { source: 'https://x/t.jpg', width: 1, height: 2 },
      description: 'd',
      fetchedAt: '2026-10-07T00:00:00Z',
    });
    expect(parsed['NoThumb']).toEqual({ title: 'NoThumb', extract: 'Text.', url: 'https://x/NoThumb', thumbnail: null, description: null, fetchedAt: '' });
    expect(() => parseWikiSummaries([])).toThrow(TypeError);
    expect(() => parseWikiSummaries(null)).toThrow(TypeError);
  });
});

describe('findWikiSummary', () => {
  const map = parseWikiSummaries(wikiSummaries);

  it('finds an exact title first', () => {
    expect(findWikiSummary(map, 'Seattle')?.title).toBe('Seattle');
    expect(findWikiSummary(map, 'King County, Washington')?.url).toBe('https://en.wikipedia.org/wiki/King_County%2C_Washington');
  });

  it('then matches ignoring letter case, surrounding space and underscores', () => {
    expect(findWikiSummary(map, 'seattle')?.title).toBe('Seattle');
    expect(findWikiSummary(map, '  WASHINGTON (STATE) ')?.title).toBe('Washington (state)');
    expect(findWikiSummary(map, 'Walla_Walla,_Washington')?.title).toBe('Walla Walla, Washington');
  });

  it('is undefined for a title the file lacks, a blank title, or an empty file', () => {
    expect(findWikiSummary(map, 'Spokane, Washington')).toBeUndefined();
    expect(findWikiSummary(map, 'Seattle, Washington')).toBeUndefined(); // no redirect knowledge
    expect(findWikiSummary(map, '   ')).toBeUndefined();
    expect(findWikiSummary({}, 'Seattle')).toBeUndefined();
  });
});

describe('summaryFactFromEntry', () => {
  it('builds a summary fact carrying the Wikipedia source and the CC BY-SA licence', () => {
    const entry: WikiSummaryEntry = {
      title: 'Seattle',
      extract: 'Seattle is a city. It is large.',
      url: 'https://en.wikipedia.org/wiki/Seattle',
      thumbnail: null,
      description: null,
      fetchedAt: '2026-10-07T00:00:00Z',
    };
    expect(summaryFactFromEntry(entry)).toEqual<Fact>({
      kind: 'summary',
      title: 'Seattle',
      body: 'Seattle is a city. It is large.',
      source: { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Seattle', license: 'CC BY-SA 4.0' },
      confidence: 'high',
    });
  });

  it('every entry in the real public/data file makes a sourced fact, and the flagship titles are there', () => {
    const map = parseWikiSummaries(publicSummaries);
    // The file may hold four entries (the placeholder) or hundreds (the full bake).
    for (const key of ['Washington (state)', 'King County, Washington', 'Seattle', 'Walla Walla, Washington']) {
      expect(map[key]?.title, key).toBeTruthy();
    }
    for (const entry of Object.values(map)) {
      const fact = summaryFactFromEntry(entry);
      expect(fact.source.name).toBe('Wikipedia');
      expect(fact.source.url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
      expect(fact.source.license).toBe('CC BY-SA 4.0');
      expect(fact.body?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
