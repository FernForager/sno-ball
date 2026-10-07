/**
 * One small door to the network.
 *
 * Every module that talks to an outside service (the geocoder, Wikipedia,
 * the geology server, ...) goes through fetchJson. Keeping it in one place
 * gives the whole site the same behaviour everywhere:
 *
 *  - a timeout, so a slow server cannot hang the page forever;
 *  - one polite retry when a server says "too busy" (429 or 503), when the
 *    network blips, or when an attempt times out, with a short pause first;
 *  - a clear HttpError (status + url) when the server answers with an error;
 *  - cancellation, so typing a new address can abandon the old requests.
 *
 * Browsers do not let a page set its own User-Agent header, so we never try.
 * Rate limiting (one request per second to Nominatim, etc.) is a separate
 * concern and lives in queue.ts; caching lives in cache.ts.
 */

/** How long one attempt may take before it is abandoned and (maybe) retried. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** The pause between a failed attempt and its retry. */
export const RETRY_BACKOFF_MS = 1_500;

/** Statuses that mean "try again in a moment" rather than "you did something wrong". */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

/**
 * Thrown when a server answers with a non-2xx status, or with a body that is
 * not JSON. `status` and `url` are kept so callers can decide what to do
 * (for example, treat a 404 from the parcel service as "no record" instead of
 * a failure) and so an error message can say exactly which request broke.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} from ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

export interface FetchJsonOptions {
  /** Abandon one attempt after this long. Default 15 000 ms. */
  timeoutMs?: number;
  /** Extra attempts after the first one fails in a retryable way. Default 1. */
  retries?: number;
  /** Cancel from the outside, e.g. when the visitor starts a new search. */
  signal?: AbortSignal;
  /** Extra request headers. Never a User-Agent (browsers forbid it). */
  headers?: Record<string, string>;
  /** Default 'GET'. */
  method?: 'GET' | 'POST';
  /** Request body for POST, already serialised (e.g. an Overpass query). */
  body?: string;
}

/**
 * Fetch a URL and parse the response as JSON. Throws HttpError for a non-2xx
 * status or a body that is not JSON. A 429, a 503, a network failure or a
 * timeout is retried once (configurable with `retries`) after a 1.5 s pause.
 * If the caller's `signal` is aborted at any point, the request stops at
 * once, the abort reason is thrown (an "AbortError"), and nothing is retried.
 * Pass `{ retries: 0 }` for a request that must not be repeated.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let attempt = 0; ; attempt++) {
    throwIfAborted(opts.signal);
    try {
      return await fetchJsonOnce<T>(url, opts, timeoutMs);
    } catch (err) {
      // A cancel from the caller is never retried: they asked us to stop.
      if (opts.signal?.aborted) throw err;
      if (attempt >= retries || !isRetryable(err)) throw err;
      await sleep(RETRY_BACKOFF_MS, opts.signal);
    }
  }
}

/**
 * True when an error is the result of a cancellation (an "AbortError"), as
 * opposed to a real failure. Use it in UI code to stay quiet when the
 * visitor simply moved on to another address.
 */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** One attempt: a single fetch with its own timeout, linked to the caller's signal. */
async function fetchJsonOnce<T>(url: string, opts: FetchJsonOptions, timeoutMs: number): Promise<T> {
  // Our own controller lets us abort for two reasons: the timeout fired, or
  // the caller aborted their signal. Linking by hand (instead of
  // AbortSignal.any) keeps this working in slightly older browsers.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError(url, timeoutMs));
  }, timeoutMs);
  const onCallerAbort = () => controller.abort(abortReason(opts.signal));
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      signal: controller.signal,
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
    });

    if (!res.ok) {
      const snippet = await safeText(res);
      throw new HttpError(res.status, url, `HTTP ${res.status} from ${url}${snippet ? `: ${snippet}` : ''}`);
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      // The body may have been cut off by our abort; let the outer catch
      // report that as a timeout. Anything else is a server sending non-JSON.
      if (controller.signal.aborted) throw err;
      throw new HttpError(res.status, url, `Expected JSON from ${url} but the body could not be parsed`);
    }
  } catch (err) {
    // Some runtimes reject with a generic AbortError instead of our reason;
    // normalise so a timeout always looks like a timeout to the caller.
    if (timedOut) throw timeoutError(url, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** Should this failure be tried again? HttpError only for 429/503; any network or timeout error yes. */
function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return RETRYABLE_STATUSES.has(err.status);
  return !isAbortError(err);
}

function timeoutError(url: string, timeoutMs: number): DOMException {
  return new DOMException(`Timed out after ${timeoutMs} ms: ${url}`, 'TimeoutError');
}

/** The reason a signal was aborted with, or a standard AbortError when none was given. */
function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The request was aborted', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** Up to 200 characters of an error body, for a more helpful message. Never throws. */
async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

/** Wait `ms`, but stop early (and reject) if the signal is aborted meanwhile. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
