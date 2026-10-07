/**
 * The time engine: one canonical representation for every date the site can
 * show, from a single year in the 1800s to billions of years ago.
 *
 * Two kinds of point:
 *  - { kind: 'year', value }  a calendar year in the proleptic Gregorian
 *    calendar. Negative values are BCE. There is no year 0: -1 is 1 BCE.
 *  - { kind: 'ago', value }   years before 2000 CE. Used once we are 20,000 or
 *    more years back, where calendar years stop meaning anything to a reader.
 *
 * Everything else (OpenHistoricalMap decimal dates, Wikidata timestamps,
 * geologic ages in Ma) converts to or from these two shapes here, so the rest
 * of the site never has to think about calendars.
 */

export type TimePoint =
  | { kind: 'year'; value: number }
  | { kind: 'ago'; value: number };

/** Reference year for "years ago" values. */
export const ANCHOR_YEAR = 2000;

/** From this many years before the anchor onward, points are 'ago', not 'year'. */
export const AGO_THRESHOLD = 20_000;

export function year(value: number): TimePoint {
  if (!Number.isInteger(value)) throw new RangeError(`year must be an integer, got ${value}`);
  if (value === 0) throw new RangeError('there is no year 0; use -1 for 1 BCE');
  return { kind: 'year', value };
}

export function ago(value: number): TimePoint {
  if (!(value >= 0)) throw new RangeError(`years ago must be >= 0, got ${value}`);
  return { kind: 'ago', value };
}

/** Years before the anchor year (2000 CE) for any point. */
export function yearsAgo(t: TimePoint): number {
  if (t.kind === 'ago') return t.value;
  // No year 0: 1 BCE (-1) is exactly 2000 years before 2000 CE.
  return t.value > 0 ? ANCHOR_YEAR - t.value : ANCHOR_YEAR - t.value - 1;
}

/** The canonical point for a number of years before the anchor. */
export function fromYearsAgo(n: number): TimePoint {
  if (n >= AGO_THRESHOLD) return ago(n);
  const y = ANCHOR_YEAR - Math.round(n);
  return year(y <= 0 ? y - 1 : y);
}

/**
 * OpenHistoricalMap decimal date for a calendar year: 1.0 is New Year's Day
 * of 1 CE, 0.0 is 1 BCE, -1.0 is 2 BCE (no year 0). An optional fraction
 * (0 to <1) moves into the year, e.g. 0.5 for roughly July.
 */
export function toDecimalDate(calendarYear: number, fraction = 0): number {
  if (calendarYear === 0) throw new RangeError('there is no year 0');
  if (fraction < 0 || fraction >= 1) throw new RangeError('fraction must be in [0, 1)');
  const base = calendarYear > 0 ? calendarYear : calendarYear + 1;
  return base + fraction;
}

/** Inverse of toDecimalDate, ignoring the fractional part. */
export function fromDecimalDate(decimal: number): number {
  const base = Math.floor(decimal);
  return base >= 1 ? base : base - 1;
}

/**
 * Parse a Wikidata time value such as "+1790-07-16T00:00:00Z" or
 * "-0500-00-00T00:00:00Z" into a calendar year. Wikidata's year "-0001" is
 * taken as 1 BCE (no year 0), matching the Wikibase data model.
 */
export function fromWikidataTime(value: string): number | null {
  const m = /^([+-])(\d{1,16})-(\d{2})-(\d{2})T/.exec(value);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const y = Number(m[2]);
  if (!Number.isFinite(y) || y === 0) return null;
  return sign * y;
}

export const maToAgo = (ma: number): number => ma * 1_000_000;
export const agoToMa = (yearsBefore: number): number => yearsBefore / 1_000_000;

function trimNumber(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toLocaleString('en-US');
}

/** A short human readout for a point, e.g. "1889", "500 BCE", "66 million years ago". */
export function formatReadout(t: TimePoint): string {
  if (t.kind === 'year') {
    if (t.value < 0) return `${(-t.value).toLocaleString('en-US')} BCE`;
    return t.value < 1000 ? `${t.value} CE` : String(t.value);
  }
  const n = t.value;
  if (n < 1_000_000) return `${Math.round(n).toLocaleString('en-US')} years ago`;
  if (n < 1_000_000_000) return `${trimNumber(n / 1_000_000, 1)} million years ago`;
  return `${trimNumber(n / 1_000_000_000, 2)} billion years ago`;
}

/**
 * Understand the ways people type a time: "1924", "800 BC", "AD 79",
 * "20,000 years ago", "20 ka", "66 Ma", "66 million years ago",
 * "2.4 billion years ago", "4.5 Ga", "now". Returns null when it can't.
 */
export function parseTime(text: string, now = new Date().getFullYear()): TimePoint | null {
  const s = text.trim().toLowerCase().replace(/,/g, '');
  if (!s) return null;
  if (s === 'now' || s === 'today' || s === 'present') return year(now);

  const num = (raw: string) => Number(raw);

  let m: RegExpExecArray | null;

  // "2.4 billion years ago", "4.5 ga", "4.5 gya"
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:billion\s+years?\s+ago|gya|ga)$/.exec(s))) {
    return ago(num(m[1]!) * 1_000_000_000);
  }
  // "66 million years ago", "66 ma", "66 mya"
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:million\s+years?\s+ago|mya|ma)$/.exec(s))) {
    return fromYearsAgo(maToAgo(num(m[1]!)));
  }
  // "20 thousand years ago", "20 ka", "20 kya"
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:thousand\s+years?\s+ago|kya|ka)$/.exec(s))) {
    return fromYearsAgo(num(m[1]!) * 1000);
  }
  // "20000 years ago", "20000 ya"
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:years?\s+ago|ya|bp)$/.exec(s))) {
    return fromYearsAgo(num(m[1]!));
  }
  // "800 bc", "800 bce", "800bc"
  if ((m = /^(\d+)\s*(?:bce?|b\.c\.e?\.?)$/.exec(s))) {
    const y = num(m[1]!);
    return y === 0 ? null : year(-y);
  }
  // "ad 79", "79 ad", "79 ce", "1924 ce"
  if ((m = /^(?:ad\s*)?(\d+)\s*(?:ad|ce|a\.d\.|c\.e\.)?$/.exec(s))) {
    const y = num(m[1]!);
    if (y === 0) return null;
    return year(y);
  }
  // "1860s"
  if ((m = /^(\d{3,4})s$/.exec(s))) {
    return year(num(m[1]!));
  }
  return null;
}
