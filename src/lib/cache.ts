/**
 * Remember answers so we ask the outside world as little as possible.
 *
 * Open data services are shared with everyone, and some (Nominatim) ask that
 * results be cached. `cached` wraps any loader function: the first call runs
 * it and stores the answer in the browser's IndexedDB (through the tiny
 * idb-keyval library); later calls for the same key return the stored answer
 * for as long as the TTL allows.
 *
 * Optionally, an entry that has just gone stale can still be returned at
 * once while a fresh copy loads in the background ("stale while
 * revalidate"), so a returning visitor never waits for data they already saw.
 *
 * If IndexedDB is unavailable (private browsing, storage blocked, a broken
 * profile), we fall back to a plain in-memory Map for the rest of the visit
 * and warn once in the console. The page keeps working either way.
 *
 * Keys are prefixed with 'sno-ball:v1:' so our entries can be told apart
 * from anything else on the same origin, and so bumping the version one day
 * invalidates everything at once.
 */

import { delMany, get, keys, set } from 'idb-keyval';

export interface CacheOptions {
  /** How long a stored value counts as fresh, in milliseconds. */
  ttlMs: number;
  /**
   * After the TTL, how much longer (ms) a value may still be handed out
   * immediately while a fresh one loads in the background. Default 0.
   */
  staleWhileRevalidateMs?: number;
}

/** Every key we write starts with this. Bump the version to drop all old entries. */
export const CACHE_PREFIX = 'sno-ball:v1:';

/** What is actually stored under each key. */
interface Entry<T> {
  value: T;
  /** Date.now() when the value was stored. */
  storedAt: number;
}

/** Used instead of IndexedDB once it has failed. Lives only as long as the page. */
const memory = new Map<string, Entry<unknown>>();

/** Loads currently running, so two callers asking for the same key share one request. */
const inflight = new Map<string, Promise<unknown>>();

/** Flips to false the first time IndexedDB throws; stays false for this visit. */
let storageAvailable = true;

/**
 * Return the cached value for `key` when it is fresh, otherwise run `loader`,
 * store its result and return it. Within the stale-while-revalidate window
 * the stale value is returned straight away and `loader` runs in the
 * background to replace it (a failed background refresh is only warned
 * about). Concurrent calls for the same key share one loader call. A loader
 * that throws stores nothing and the error reaches the caller, so the next
 * call tries again.
 */
export async function cached<T>(key: string, opts: CacheOptions, loader: () => Promise<T>): Promise<T> {
  const fullKey = CACHE_PREFIX + key;
  const entry = await readEntry<T>(fullKey);

  if (entry) {
    const age = Date.now() - entry.storedAt;
    if (age < opts.ttlMs) return entry.value; // fresh
    if (age < opts.ttlMs + (opts.staleWhileRevalidateMs ?? 0)) {
      // Stale but still usable: hand it back now and refresh quietly.
      void loadAndStore(fullKey, loader).catch((err: unknown) => {
        console.warn(`[cache] background refresh failed for ${key}`, err);
      });
      return entry.value;
    }
  }

  return loadAndStore(fullKey, loader);
}

/**
 * Forget everything this site has cached: the in-memory copy and every
 * IndexedDB entry under our prefix. Entries that belong to other things on
 * the same origin are left alone.
 */
export async function cacheClear(): Promise<void> {
  memory.clear();
  if (!storageAvailable) return;
  try {
    const all = await keys<IDBValidKey>();
    const ours = all.filter((k): k is string => typeof k === 'string' && k.startsWith(CACHE_PREFIX));
    if (ours.length > 0) await delMany(ours);
  } catch (err) {
    markStorageUnavailable(err);
  }
}

/** Run the loader once for this key (sharing with any run already in flight) and store the result. */
function loadAndStore<T>(fullKey: string, loader: () => Promise<T>): Promise<T> {
  const running = inflight.get(fullKey);
  if (running) return running as Promise<T>;

  const load = (async () => {
    const value = await loader();
    await writeEntry(fullKey, { value, storedAt: Date.now() });
    return value;
  })();

  inflight.set(fullKey, load);
  const done = () => {
    if (inflight.get(fullKey) === load) inflight.delete(fullKey);
  };
  void load.then(done, done);
  return load;
}

async function readEntry<T>(fullKey: string): Promise<Entry<T> | undefined> {
  if (storageAvailable) {
    try {
      const raw: unknown = await get(fullKey);
      return isEntry<T>(raw) ? raw : undefined;
    } catch (err) {
      markStorageUnavailable(err);
    }
  }
  return memory.get(fullKey) as Entry<T> | undefined;
}

async function writeEntry<T>(fullKey: string, entry: Entry<T>): Promise<void> {
  if (storageAvailable) {
    try {
      await set(fullKey, entry);
      return;
    } catch (err) {
      markStorageUnavailable(err);
    }
  }
  memory.set(fullKey, entry);
}

/** Guards against corrupt or older-shaped entries: anything odd counts as a miss. */
function isEntry<T>(raw: unknown): raw is Entry<T> {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'value' in raw &&
    typeof (raw as { storedAt?: unknown }).storedAt === 'number'
  );
}

function markStorageUnavailable(err: unknown): void {
  if (!storageAvailable) return;
  storageAvailable = false;
  console.warn('[cache] IndexedDB is unavailable; caching in memory for this visit only.', err);
}
