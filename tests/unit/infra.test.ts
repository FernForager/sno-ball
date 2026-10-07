/**
 * Tests for the shared infrastructure: fetchJson (http.ts), RateLimiter
 * (queue.ts) and cached (cache.ts). Nothing here touches the network or a
 * real IndexedDB: `fetch` is stubbed, idb-keyval is mocked, and timers are
 * faked so a 1.5 s backoff or a 1.1 s gap takes no real time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  HttpError,
  MAX_RETRY_AFTER_MS,
  RETRY_BACKOFF_MS,
  fetchJson,
  isAbortError,
  parseRetryAfter,
} from '../../src/lib/http';
import { RateLimiter, hostOf, limiterFor } from '../../src/lib/queue';

// ---------------------------------------------------------------------------
// A fake idb-keyval. It is a Map behind async functions, plus a switch that
// makes every call throw, to simulate IndexedDB being unavailable.
// vi.mock is hoisted above the imports, so the fake must be hoisted too.
// ---------------------------------------------------------------------------
const fakeIdb = vi.hoisted(() => {
  const store = new Map<IDBValidKey, unknown>();
  const state = { broken: false };
  const guard = () => {
    if (state.broken) throw new Error('IndexedDB unavailable');
  };
  return {
    store,
    state,
    get: vi.fn(async (key: IDBValidKey) => {
      guard();
      return store.get(key);
    }),
    set: vi.fn(async (key: IDBValidKey, value: unknown) => {
      guard();
      store.set(key, value);
    }),
    keys: vi.fn(async () => {
      guard();
      return [...store.keys()];
    }),
    delMany: vi.fn(async (ks: IDBValidKey[]) => {
      guard();
      for (const k of ks) store.delete(k);
    }),
  };
});

vi.mock('idb-keyval', () => ({
  get: fakeIdb.get,
  set: fakeIdb.set,
  keys: fakeIdb.keys,
  delMany: fakeIdb.delMany,
}));

// ---------------------------------------------------------------------------
// http.ts
// ---------------------------------------------------------------------------

/** A minimal Response-like object that settles through microtasks only (fake-timer friendly). */
function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => {
      if (typeof body === 'string') return JSON.parse(body) as unknown;
      return body;
    },
    text: async () => text,
  } as unknown as Response;
}

/** A fetch that never answers on its own; it only rejects when its signal is aborted. */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
}

const URL_OK = 'https://example.test/api?q=1';

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns parsed JSON from a real Response using GET and no User-Agent', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ hello: 'world' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchJson<{ hello: string }>(URL_OK);

    expect(data).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init && 'headers' in init).toBe(false);
    expect(init && 'body' in init).toBe(false);
  });

  it('passes method, body and headers through, still without a User-Agent', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => fakeResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchJson(URL_OK, { method: 'POST', body: 'data=[out:json];', headers: { Accept: 'application/json' } });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('data=[out:json];');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
    const headerNames = Object.keys((init?.headers as Record<string, string>) ?? {}).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain('user-agent');
  });

  it('throws HttpError with status and url on a 404, without retrying', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(404, { error: 'Unable to geocode' }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await fetchJson(URL_OK).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    const httpErr = err as HttpError;
    expect(httpErr.status).toBe(404);
    expect(httpErr.url).toBe(URL_OK);
    expect(httpErr.name).toBe('HttpError');
    expect(httpErr.message).toContain('404');
    expect(httpErr.message).toContain('Unable to geocode');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws HttpError when a 200 body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200, '<html>not json</html>')));

    const err = await fetchJson(URL_OK).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(200);
    expect((err as HttpError).message).toMatch(/JSON/);
  });

  it('retries once on 503 after a 1.5 s backoff, then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(503, 'busy'))
      .mockResolvedValueOnce(fakeResponse(200, { second: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ second: boolean }>(URL_OK);

    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(promise).resolves.toEqual({ second: true });
  });

  it('retries on 429 and gives up with the last HttpError when the retry also fails', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => fakeResponse(429, 'slow down'));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson(URL_OK);
    const outcome = expect(promise).rejects.toMatchObject({ name: 'HttpError', status: 429 });
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS);
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(2); // first try + exactly one retry
  });

  it('does not retry a 429 when the caller says retryOn429: false (Wikimedia, Nominatim)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => fakeResponse(429, 'slow down'));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = expect(fetchJson(URL_OK, { retryOn429: false })).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS * 2);
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A 503 with the same option still gets its one retry.
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => fakeResponse(503, 'busy'));
    const busy = expect(fetchJson(URL_OK, { retryOn429: false })).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS * 2);
    await busy;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits as long as Retry-After asks before the retry, and gives up when it asks for too long', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(429, 'slow down', { 'Retry-After': '3' }))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ ok: boolean }>(URL_OK);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(promise).resolves.toEqual({ ok: true });

    // "Come back in a minute": no retry at all, and the wait is reported.
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => fakeResponse(429, 'cooling down', { 'Retry-After': '60' }));
    const outcome = expect(fetchJson(URL_OK)).rejects.toMatchObject({ status: 429, retryAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(MAX_RETRY_AFTER_MS * 2);
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parseRetryAfter reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(' 2 ')).toBe(2_000);
    const now = Date.parse('Wed, 07 Oct 2026 22:00:00 GMT');
    expect(parseRetryAfter('Wed, 07 Oct 2026 22:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('Wed, 07 Oct 2026 21:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('honours retries: 0 (no second attempt) and retries: 2 (three attempts)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => fakeResponse(503, 'busy'));
    vi.stubGlobal('fetch', fetchMock);

    const none = expect(fetchJson(URL_OK, { retries: 0 })).rejects.toBeInstanceOf(HttpError);
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS * 3);
    await none;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    const two = expect(fetchJson(URL_OK, { retries: 2 })).rejects.toBeInstanceOf(HttpError);
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS * 3);
    await two;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries once on a network error (fetch throws TypeError)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(fakeResponse(200, { recovered: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson<{ recovered: boolean }>(URL_OK);
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS);
    await expect(promise).resolves.toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 500 (only 429 and 503 are retryable statuses)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => fakeResponse(500, 'boom'));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = expect(fetchJson(URL_OK)).rejects.toMatchObject({ status: 500 });
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS * 2);
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out an attempt with a TimeoutError (default 15 s) and retries it once', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchJson(URL_OK);
    const outcome = expect(promise).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + RETRY_BACKOFF_MS); // first attempt times out, backoff passes
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS); // second attempt times out too
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses a custom timeoutMs and a timeout is not mistaken for a cancel', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const err = fetchJson(URL_OK, { timeoutMs: 50, retries: 0 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(50);
    const value = await err;

    expect(value).toMatchObject({ name: 'TimeoutError' });
    expect(String((value as Error).message)).toContain('50 ms');
    expect(isAbortError(value)).toBe(false);
  });

  it('stops at once and never retries when the caller aborts mid-request', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const promise = fetchJson(URL_OK, { signal: controller.signal });
    const outcome = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await outcome;

    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS * 2 + DEFAULT_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rejection = await promise.catch((e: unknown) => e);
    expect(isAbortError(rejection)).toBe(true);
  });

  it('stops during the backoff pause when the caller aborts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => fakeResponse(503, 'busy'));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const promise = fetchJson(URL_OK, { signal: controller.signal });
    const outcome = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(500); // inside the 1.5 s pause
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.abort();
    await outcome;

    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately without calling fetch when the signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(fetchJson(URL_OK, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isAbortError recognises abort reasons and nothing else', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new DOMException('x', 'TimeoutError'))).toBe(false);
    expect(isAbortError(new HttpError(500, URL_OK))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// queue.ts
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps at least minIntervalMs between task starts', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 1000 });
    const starts: number[] = [];
    const all = Promise.all(
      [1, 2, 3].map((n) =>
        limiter.run(async () => {
          starts.push(Date.now());
          return n;
        }),
      ),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([0, 1000]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(starts).toEqual([0, 1000, 2000]);
    await expect(all).resolves.toEqual([1, 2, 3]);
  });

  it('defaults to concurrency 1: the next task waits for the previous one to finish', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0 });
    const starts: number[] = [];
    const slow = limiter.run(async () => {
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 500));
    });
    const fast = limiter.run(async () => {
      starts.push(Date.now());
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(starts).toEqual([0]);
    expect(limiter.running).toBe(1);
    expect(limiter.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([0, 500]);
    await Promise.all([slow, fast]);
    expect(limiter.running).toBe(0);
    expect(limiter.pending).toBe(0);
  });

  it('never runs more than `concurrency` tasks at once', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0, concurrency: 2 });
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 100));
      active--;
    };
    const all = Promise.all([task, task, task, task].map((t) => limiter.run(t)));

    await vi.advanceTimersByTimeAsync(0);
    expect(active).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(active).toBe(2); // the next two started as the first two finished
    await vi.advanceTimersByTimeAsync(100);
    await all;
    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });

  it('measures the gap between starts, not from one finish to the next start', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 100, concurrency: 2 });
    const starts: number[] = [];
    const a = limiter.run(async () => {
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 1000)); // long task
    });
    const b = limiter.run(async () => {
      starts.push(Date.now());
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(starts).toEqual([0, 100]); // b did not wait for a to finish
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([a, b]);
  });

  it('starts tasks in the order they were queued', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 10 });
    const order: number[] = [];
    const all = Promise.all([1, 2, 3, 4].map((n) => limiter.run(async () => order.push(n))));
    await vi.advanceTimersByTimeAsync(100);
    await all;
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('passes a task failure to its caller without blocking the queue', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0 });
    const failing = limiter.run(async () => {
      throw new Error('task broke');
    });
    const next = limiter.run(async () => 'still works');

    await expect(failing).rejects.toThrow('task broke');
    await vi.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toBe('still works');
    expect(limiter.running).toBe(0);
  });

  it('rejects nonsense options', () => {
    expect(() => new RateLimiter({ minIntervalMs: -1 })).toThrow(RangeError);
    expect(() => new RateLimiter({ minIntervalMs: 0, concurrency: 0 })).toThrow(RangeError);
  });
});

describe('limiterFor / hostOf', () => {
  it('returns the same instance for the same host, with the host policy', () => {
    const nominatim = limiterFor('nominatim.openstreetmap.org');
    expect(limiterFor('nominatim.openstreetmap.org')).toBe(nominatim);
    expect(nominatim.minIntervalMs).toBe(1100);
    expect(nominatim.concurrency).toBe(1);

    const overpass = limiterFor('overpass-api.openhistoricalmap.org');
    expect(overpass).not.toBe(nominatim);
    expect(overpass.minIntervalMs).toBe(1000);
    expect(overpass.concurrency).toBe(1);
  });

  it('gives unknown hosts the gentle default and accepts a full URL', () => {
    const dnr = limiterFor('gis.dnr.wa.gov');
    expect(dnr.minIntervalMs).toBe(150);
    expect(dnr.concurrency).toBe(4);
    expect(limiterFor('https://gis.dnr.wa.gov/site1/rest/services/x/query?f=json')).toBe(dnr);
    expect(limiterFor('https://NOMINATIM.openstreetmap.org/search?q=x')).toBe(limiterFor('nominatim.openstreetmap.org'));
  });

  it('puts every Wikimedia host in one strictly sequential queue', () => {
    const wiki = limiterFor('en.wikipedia.org');
    expect(wiki.minIntervalMs).toBeGreaterThanOrEqual(300);
    expect(wiki.concurrency).toBe(1);
    expect(limiterFor('query.wikidata.org')).toBe(wiki);
    expect(limiterFor('www.wikidata.org')).toBe(wiki);
    expect(limiterFor('commons.wikimedia.org')).toBe(wiki);
    expect(limiterFor('https://en.wikipedia.org/api/rest_v1/page/summary/Seattle')).toBe(wiki);
    expect(limiterFor('gis.dnr.wa.gov')).not.toBe(wiki);
  });

  it('hostOf extracts a lower-cased host and returns "" for non-URLs', () => {
    expect(hostOf('https://Nominatim.openstreetmap.org/search?q=Seattle')).toBe('nominatim.openstreetmap.org');
    expect(hostOf('http://gis.dnr.wa.gov:443/site1/rest/services')).toBe('gis.dnr.wa.gov');
    expect(hostOf('/sno-ball/data/counties.json')).toBe('');
    expect(hostOf('not a url')).toBe('');
    expect(hostOf('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// cache.ts
// cache.ts keeps module-level state (the memory fallback and the "storage is
// broken" switch), so every test imports a fresh copy of the module.
// ---------------------------------------------------------------------------

type CacheModule = typeof import('../../src/lib/cache');

describe('cached', () => {
  let cache: CacheModule;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    fakeIdb.store.clear();
    fakeIdb.state.broken = false;
    fakeIdb.get.mockClear();
    fakeIdb.set.mockClear();
    fakeIdb.keys.mockClear();
    fakeIdb.delMany.mockClear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    cache = await import('../../src/lib/cache');
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('runs the loader on a miss and stores {value, storedAt} under the prefixed key', async () => {
    const loader = vi.fn(async () => ({ name: 'King County' }));

    const value = await cache.cached('county:king', { ttlMs: 60_000 }, loader);

    expect(value).toEqual({ name: 'King County' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.CACHE_PREFIX).toBe('sno-ball:v1:');
    expect(fakeIdb.store.get('sno-ball:v1:county:king')).toEqual({
      value: { name: 'King County' },
      storedAt: 1_000_000,
    });
  });

  it('returns the stored value without calling the loader while it is fresh', async () => {
    const loader = vi.fn(async () => 'fresh');
    await cache.cached('k', { ttlMs: 10_000 }, loader);

    await vi.advanceTimersByTimeAsync(9_999);
    const again = await cache.cached('k', { ttlMs: 10_000 }, loader);

    expect(again).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL (and any SWR window) has passed', async () => {
    const loader = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    await cache.cached('k', { ttlMs: 10_000 }, loader);

    await vi.advanceTimersByTimeAsync(10_000);
    const value = await cache.cached('k', { ttlMs: 10_000 }, loader);

    expect(value).toBe('v2');
    expect(loader).toHaveBeenCalledTimes(2);
    expect(fakeIdb.store.get('sno-ball:v1:k')).toEqual({ value: 'v2', storedAt: 1_010_000 });
  });

  it('within the stale-while-revalidate window returns the stale value at once and refreshes in the background', async () => {
    const opts = { ttlMs: 10_000, staleWhileRevalidateMs: 5_000 };
    let resolveRefresh: (v: string) => void = () => {};
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('old')
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveRefresh = r)));
    await cache.cached('k', opts, loader);

    await vi.advanceTimersByTimeAsync(12_000); // stale, but inside TTL + SWR
    const stale = await cache.cached('k', opts, loader);
    expect(stale).toBe('old'); // served immediately, before the refresh settles
    expect(loader).toHaveBeenCalledTimes(2);

    // A second stale read while the refresh is still running does not start another.
    expect(await cache.cached('k', opts, loader)).toBe('old');
    expect(loader).toHaveBeenCalledTimes(2);

    resolveRefresh('new');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeIdb.store.get('sno-ball:v1:k')).toEqual({ value: 'new', storedAt: 1_012_000 });
    expect(await cache.cached('k', opts, loader)).toBe('new');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not use the SWR path once the window has passed', async () => {
    const opts = { ttlMs: 10_000, staleWhileRevalidateMs: 5_000 };
    const loader = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    await cache.cached('k', opts, loader);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(await cache.cached('k', opts, loader)).toBe('new');
  });

  it('only warns when a background refresh fails and keeps serving the stale value', async () => {
    const opts = { ttlMs: 10_000, staleWhileRevalidateMs: 5_000 };
    const loader = vi.fn().mockResolvedValueOnce('old').mockRejectedValueOnce(new Error('offline'));
    await cache.cached('k', opts, loader);

    await vi.advanceTimersByTimeAsync(11_000);
    expect(await cache.cached('k', opts, loader)).toBe('old');
    await vi.advanceTimersByTimeAsync(0);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('background refresh failed');
    expect(fakeIdb.store.get('sno-ball:v1:k')).toEqual({ value: 'old', storedAt: 1_000_000 });
  });

  it('shares one loader call between concurrent requests for the same key', async () => {
    let resolveLoad: (v: string) => void = () => {};
    const loader = vi.fn(() => new Promise<string>((r) => (resolveLoad = r)));

    const a = cache.cached('k', { ttlMs: 1000 }, loader);
    const b = cache.cached('k', { ttlMs: 1000 }, loader);
    await vi.advanceTimersByTimeAsync(0); // let both reads miss
    expect(loader).toHaveBeenCalledTimes(1);

    resolveLoad('shared');
    await expect(a).resolves.toBe('shared');
    await expect(b).resolves.toBe('shared');
    expect(fakeIdb.set).toHaveBeenCalledTimes(1);
  });

  it('keeps different keys apart', async () => {
    expect(await cache.cached('a', { ttlMs: 1000 }, async () => 'A')).toBe('A');
    expect(await cache.cached('b', { ttlMs: 1000 }, async () => 'B')).toBe('B');
    expect(fakeIdb.store.size).toBe(2);
  });

  it('stores nothing when the loader fails, and the next call tries again', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('later');

    await expect(cache.cached('k', { ttlMs: 1000 }, loader)).rejects.toThrow('offline');
    expect(fakeIdb.store.size).toBe(0);

    expect(await cache.cached('k', { ttlMs: 1000 }, loader)).toBe('later');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('treats a corrupt or foreign-shaped entry as a miss', async () => {
    fakeIdb.store.set('sno-ball:v1:k', 'not an entry');
    const loader = vi.fn(async () => 'repaired');

    expect(await cache.cached('k', { ttlMs: 1000 }, loader)).toBe('repaired');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fakeIdb.store.get('sno-ball:v1:k')).toEqual({ value: 'repaired', storedAt: 1_000_000 });
  });

  it('falls back to memory when IndexedDB throws, warning once', async () => {
    fakeIdb.state.broken = true;
    const loader = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    expect(await cache.cached('k', { ttlMs: 10_000 }, loader)).toBe('first');
    expect(await cache.cached('k', { ttlMs: 10_000 }, loader)).toBe('first'); // served from memory
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await cache.cached('k', { ttlMs: 10_000 }, loader)).toBe('second'); // memory respects TTL too

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('IndexedDB is unavailable');
    expect(fakeIdb.get).toHaveBeenCalledTimes(1); // stops asking IndexedDB after the first failure
    expect(fakeIdb.store.size).toBe(0);
  });

  it('cacheClear removes our prefixed entries from IndexedDB and leaves other keys alone', async () => {
    fakeIdb.store.set('someone-elses-key', 'keep me');
    await cache.cached('a', { ttlMs: 1000 }, async () => 'A');
    await cache.cached('b', { ttlMs: 1000 }, async () => 'B');
    expect(fakeIdb.store.size).toBe(3);

    await cache.cacheClear();

    expect([...fakeIdb.store.keys()]).toEqual(['someone-elses-key']);
    const loader = vi.fn(async () => 'A again');
    expect(await cache.cached('a', { ttlMs: 1000 }, loader)).toBe('A again');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('cacheClear also empties the memory fallback', async () => {
    fakeIdb.state.broken = true;
    const loader = vi.fn().mockResolvedValueOnce('one').mockResolvedValueOnce('two');
    await cache.cached('k', { ttlMs: 10_000 }, loader);

    await cache.cacheClear();

    expect(await cache.cached('k', { ttlMs: 10_000 }, loader)).toBe('two');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
