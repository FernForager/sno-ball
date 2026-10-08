/**
 * Polite queues for outside services.
 *
 * Some services we rely on are run by volunteers with strict usage rules.
 * Nominatim (the OpenStreetMap geocoder) allows at most one request per
 * second from a site, and OpenHistoricalMap's Overpass server is similar.
 * A RateLimiter makes sure our requests to such a host START no closer
 * together than a minimum gap, and that no more than a few run at once.
 *
 * Use limiterFor(host) to get the one shared limiter for a host, and wrap
 * each request in it:
 *
 *   const data = await limiterFor(hostOf(url)).run(() => fetchJson(url));
 *
 * The gap is measured between starts, not from one finish to the next
 * start. With a 1100 ms gap, a request that itself takes 3 s does not push
 * the next one out to 4.1 s; the next may start at 1.1 s if the concurrency
 * limit allows. Tasks always start in the order they were queued.
 */

export interface LimiterOptions {
  /** Minimum time between the start of one task and the start of the next. */
  minIntervalMs: number;
  /** How many tasks may be running at the same time. Default 1 (strictly one after another). */
  concurrency?: number;
}

/**
 * A queue that spaces out the start of each task and caps how many run at
 * once. Create one per outside service (or use limiterFor) and pass every
 * request to `run`. The returned promise settles exactly like the task's
 * own promise, so a failing task rejects its caller without blocking the
 * tasks behind it.
 */
export class RateLimiter {
  readonly minIntervalMs: number;
  readonly concurrency: number;

  /** Tasks that have started and not yet settled. */
  private runningCount = 0;
  /** When the most recent task started (Date.now()); -Infinity before any has. */
  private lastStartAt = -Infinity;
  /** Resolvers for tasks waiting their turn, oldest first. */
  private readonly waiting: Array<() => void> = [];
  /** A timer already set to wake the queue when the gap has passed, if any. */
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: LimiterOptions) {
    if (!(opts.minIntervalMs >= 0)) throw new RangeError(`minIntervalMs must be >= 0, got ${opts.minIntervalMs}`);
    const concurrency = opts.concurrency ?? 1;
    if (!(concurrency >= 1)) throw new RangeError(`concurrency must be >= 1, got ${concurrency}`);
    this.minIntervalMs = opts.minIntervalMs;
    this.concurrency = concurrency;
  }

  /** Number of tasks currently running. Handy for tests and debugging. */
  get running(): number {
    return this.runningCount;
  }

  /** Number of tasks still waiting to start. */
  get pending(): number {
    return this.waiting.length;
  }

  /**
   * Queue a task and resolve with its result. The task is started once the
   * gap since the previous start has passed and a concurrency slot is free.
   * Whatever the task returns or throws is passed straight through.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.waitForTurn();
    try {
      return await task();
    } finally {
      this.runningCount--;
      this.pump();
    }
  }

  /** Resolves when this caller may start. Counts the caller as running from then on. */
  private waitForTurn(): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.pump();
    });
  }

  /**
   * Start as many waiting tasks as the rules allow right now. If the next
   * one must wait for the gap, set one timer to come back then.
   */
  private pump(): void {
    if (this.wakeTimer !== undefined) return; // already coming back later
    while (this.waiting.length > 0 && this.runningCount < this.concurrency) {
      const now = Date.now();
      const wait = this.lastStartAt + this.minIntervalMs - now;
      if (wait > 0) {
        this.wakeTimer = setTimeout(() => {
          this.wakeTimer = undefined;
          this.pump();
        }, wait);
        return;
      }
      const next = this.waiting.shift();
      if (!next) return;
      this.runningCount++;
      this.lastStartAt = now;
      next();
    }
  }
}

/** The rules each host asks us to follow. Anything not listed gets DEFAULT_POLICY. */
const HOST_POLICIES: Readonly<Record<string, LimiterOptions>> = {
  // Nominatim usage policy: absolute maximum one request per second.
  'nominatim.openstreetmap.org': { minIntervalMs: 1100, concurrency: 1 },
  // OpenHistoricalMap's Overpass: be gentle, queries can be heavy.
  'overpass-api.openhistoricalmap.org': { minIntervalMs: 1000, concurrency: 1 },
  // Wikimedia (Wikipedia, Wikidata, Commons) rate-limits a site as a whole,
  // and answered 429 for minutes when five requests went out at once. So
  // every Wikimedia host shares ONE queue (see HOST_GROUPS): strictly one
  // request at a time, at least a second apart. (350 ms was still enough to
  // draw 429s on six of twenty summary requests in a live check, so the
  // common excerpts are now pre-baked in public/data/wiki-summaries.json
  // and the few live requests left are spaced like Nominatim's.)
  wikimedia: { minIntervalMs: 1000, concurrency: 1 },
};

/**
 * Hosts that must wait in the same queue because the service behind them
 * counts them together. The value names the entry in HOST_POLICIES (and the
 * shared limiter) they all use.
 */
const HOST_GROUPS: Readonly<Record<string, string>> = {
  'en.wikipedia.org': 'wikimedia',
  'www.wikidata.org': 'wikimedia',
  'query.wikidata.org': 'wikimedia',
  'commons.wikimedia.org': 'wikimedia',
  'upload.wikimedia.org': 'wikimedia',
};

const DEFAULT_POLICY: LimiterOptions = { minIntervalMs: 150, concurrency: 4 };

/** One limiter per host (or host group), shared by every module for the life of the page. */
const limiters = new Map<string, RateLimiter>();

/**
 * The shared RateLimiter for a host such as 'nominatim.openstreetmap.org'.
 * The same host always returns the same instance, so every module that
 * talks to Nominatim waits in one queue. Hosts of one service family (all
 * the Wikimedia hosts) share a single queue between them. A full URL is
 * accepted too and reduced to its host. Hosts without a specific policy get
 * a gentle default of 150 ms between starts and four at a time.
 */
export function limiterFor(hostOrUrl: string): RateLimiter {
  const host = hostOrUrl.includes('/') ? hostOf(hostOrUrl) : hostOrUrl.trim().toLowerCase();
  const key = HOST_GROUPS[host] ?? host;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new RateLimiter(HOST_POLICIES[key] ?? DEFAULT_POLICY);
    limiters.set(key, limiter);
  }
  return limiter;
}

/**
 * The lower-cased host name of an absolute URL, e.g.
 * 'https://Nominatim.openstreetmap.org/search?q=x' -> 'nominatim.openstreetmap.org'.
 * Returns '' for anything that is not an absolute URL (including our own
 * relative paths such as '/sno-ball/data/counties.json'), which then shares
 * the default limiter.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
