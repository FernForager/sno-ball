/**
 * The dial's stops: every position the time control can sit on, from
 * 50 million years in the future back to the birth of the Earth.
 *
 * The dial is a gearbox (Plan v2 §4, Plan v1 §5). Each gear is a run of
 * evenly spaced stops; the gears get coarser as you go back in time.
 * Every position is a discrete stop, so the whole UI can be driven by one
 * number: the stop index. Index 0 is the single FUTURE stop, index 1 is Now
 * (2026) and the index grows as you go back in time, ending at 4567 Ma.
 *
 * The future stop is the one point that `time.ts` has no shape for. It is
 * represented as `{ kind: 'ago', value: -50_000_000 }`: a negative "years
 * ago" value, i.e. years after 2000 CE. `yearsAgo()` from time.ts handles it
 * without special cases (it returns -50,000,000), which keeps every ordering
 * and distance calculation here uniform. Never build it with `ago()`, which
 * rejects negatives on purpose; it only exists as the literal below.
 */

import {
  formatReadout,
  parseTime,
  year,
  yearsAgo,
  type TimePoint,
} from './time';

export type Gear =
  | 'now'
  | 'years'
  | 'decades'
  | 'centuries'
  | 'millennia'
  | 'ice-ages'
  | 'millions'
  | 'eons'
  | 'future';

export interface Stop {
  /** Position on the dial: 0 is the future stop, 1 is Now, 275 is 4567 Ma. */
  index: number;
  gear: Gear;
  time: TimePoint;
  /** Full text for the big readout, e.g. "the 1790s", "66 million years ago". */
  readout: string;
  /** Compact form for chips and the ribbon, e.g. "1790s", "66 Ma". */
  short: string;
}

/** The present-day stop. Everything from here forward is "continuing". */
export const NOW_YEAR = 2026;

/** The one stop to the right of Now, in millions of years from now. */
export const FUTURE_MA = 50;

/** Years-ago value of the future stop: negative because it is after 2000 CE. */
export const FUTURE_YEARS_AGO = -FUTURE_MA * 1_000_000;

const YEARS_FROM = NOW_YEAR;
const YEARS_TO = 1845;
const DECADES_FROM = 1840;
const DECADES_TO = 1770;
const CENTURIES_FROM = 1700;
const CENTURIES_BCE_TO = -1000;
const MILLENNIA_FROM = -2000;
const MILLENNIA_TO = -17_000;

const ICE_AGE_YEARS_AGO: readonly number[] = [
  20_000, 25_000, 30_000, 50_000, 75_000, 100_000, 150_000, 200_000, 300_000, 500_000, 750_000,
];

/** ICS period boundaries plus 16, 40 and 50 Ma for Washington's own story. */
const MILLIONS_MA: readonly number[] = [
  1, 2.6, 5.3, 16, 23, 34, 40, 50, 56, 66, 100, 145, 201, 252, 299, 359, 419, 444, 485, 539,
];

const EONS_MA: readonly number[] = [635, 720, 1000, 1470, 1600, 2500, 3000, 3500, 4000, 4567];

const fmt = (n: number): string => n.toLocaleString('en-US');

/** "1.47" style: up to `digits` decimals, trailing zeros dropped. */
const trim = (n: number, digits: number): string => String(Number(n.toFixed(digits)));

/** Compact age label used for chips and URLs: "20 ka", "66 Ma", "2.5 Ga". */
function shortAge(yearsBefore: number, space: string): string {
  if (yearsBefore >= 1_000_000_000) return `${trim(yearsBefore / 1_000_000_000, 2)}${space}Ga`;
  if (yearsBefore >= 1_000_000) return `${trim(yearsBefore / 1_000_000, 1)}${space}Ma`;
  return `${trim(yearsBefore / 1000, 1)}${space}ka`;
}

function centuryReadout(y: number): { readout: string; short: string } {
  if (y < 0) return { readout: `${fmt(-y)} BCE`, short: `${fmt(-y)} BCE` };
  if (y === 1) return { readout: '1 CE', short: '1 CE' };
  return { readout: `the ${y}s`, short: `${y}s` };
}

function millenniumReadout(y: number): { readout: string; short: string } {
  const bce = `${fmt(-y)} BCE`;
  // "about 17,000 years ago": years before 2000 CE, rounded to the thousand.
  const about = Math.round(yearsAgo(year(y)) / 1000) * 1000;
  return { readout: `${bce} (about ${fmt(about)} years ago)`, short: bce };
}

function buildStops(): Stop[] {
  const list: Omit<Stop, 'index'>[] = [];

  list.push({
    gear: 'future',
    time: { kind: 'ago', value: FUTURE_YEARS_AGO },
    readout: `${FUTURE_MA} million years from now`,
    short: `+${FUTURE_MA} Ma`,
  });

  list.push({ gear: 'now', time: year(NOW_YEAR), readout: 'Today', short: 'Now' });

  for (let y = YEARS_FROM - 1; y >= YEARS_TO; y--) {
    list.push({ gear: 'years', time: year(y), readout: String(y), short: String(y) });
  }
  for (let y = DECADES_FROM; y >= DECADES_TO; y -= 10) {
    list.push({ gear: 'decades', time: year(y), readout: `the ${y}s`, short: `${y}s` });
  }
  for (let y = CENTURIES_FROM; y >= 100; y -= 100) {
    list.push({ gear: 'centuries', time: year(y), ...centuryReadout(y) });
  }
  list.push({ gear: 'centuries', time: year(1), ...centuryReadout(1) });
  for (let y = -100; y >= CENTURIES_BCE_TO; y -= 100) {
    list.push({ gear: 'centuries', time: year(y), ...centuryReadout(y) });
  }
  for (let y = MILLENNIA_FROM; y >= MILLENNIA_TO; y -= 1000) {
    list.push({ gear: 'millennia', time: year(y), ...millenniumReadout(y) });
  }
  for (const n of ICE_AGE_YEARS_AGO) {
    const time: TimePoint = { kind: 'ago', value: n };
    list.push({ gear: 'ice-ages', time, readout: formatReadout(time), short: shortAge(n, ' ') });
  }
  for (const ma of MILLIONS_MA) {
    const n = ma * 1_000_000;
    const time: TimePoint = { kind: 'ago', value: n };
    list.push({ gear: 'millions', time, readout: formatReadout(time), short: shortAge(n, ' ') });
  }
  for (const ma of EONS_MA) {
    const n = ma * 1_000_000;
    const time: TimePoint = { kind: 'ago', value: n };
    list.push({ gear: 'eons', time, readout: formatReadout(time), short: shortAge(n, ' ') });
  }

  return list.map((s, index) => ({ index, ...s }));
}

/** Every stop on the dial, index 0 (future) to 275 (4567 Ma). */
export const STOPS: readonly Stop[] = Object.freeze(buildStops());

export const STOP_COUNT = STOPS.length;
export const FUTURE_INDEX = 0;
export const NOW_INDEX = 1;
export const OLDEST_INDEX = STOPS.length - 1;

/** Years before 2000 CE for a stop (negative for the future stop). */
export const stopYearsAgo = (stop: Stop): number => yearsAgo(stop.time);

function indexOfTime(t: TimePoint): number {
  const target = yearsAgo(t);
  const i = STOPS.findIndex((s) => yearsAgo(s.time) === target);
  if (i < 0) throw new Error(`no stop at ${formatReadout(t)}`);
  return i;
}

/** Index of the stop whose calendar year is `y`. Throws if there is none. */
export const indexOfYear = (y: number): number => indexOfTime(year(y));

/** Index of the stop `ma` million years ago. Throws if there is none. */
export const indexOfMa = (ma: number): number =>
  indexOfTime({ kind: 'ago', value: ma * 1_000_000 });

/**
 * A chapter on the MVP dial: one of the 27 moments the ◀ ▶ buttons step
 * through. Every named stop sits on an ordinary gear stop, so there is one
 * state model (the index) for both.
 */
export interface NamedStop {
  /** Index into STOPS. */
  index: number;
  /** Chip text: the date part, e.g. "1889", "15,000 BCE", "2.6 Ma". */
  label: string;
  /** Headline readout from the Plan v2 table, e.g. "1889 · Statehood and the great fires". */
  readout: string;
  /** What happened, without the date: "Statehood and the great fires". */
  teaser: string;
  /** Ids of events in public/data/events/*.json that this stop lights up. */
  eventIds: string[];
}

function named(
  index: number,
  label: string,
  readout: string,
  teaser: string,
  eventIds: string[] = [],
): NamedStop {
  return { index, label, readout, teaser, eventIds };
}

/** The 27 named stops of Plan v2 §4, youngest first (future stop is last). */
export const NAMED_STOPS: readonly NamedStop[] = Object.freeze([
  named(NOW_INDEX, 'Today', 'Today', 'The map as it is today'),
  named(indexOfYear(1980), '1980', 'May 18, 1980 · Mount St. Helens erupts', 'Mount St. Helens erupts', [
    'st-helens-1980',
  ]),
  named(
    indexOfYear(1942),
    '1942',
    '1942 · Wartime: Hanford, Boeing, forced removal',
    'Wartime: Hanford, Boeing, forced removal',
    ['hanford-1943', 'japanese-american-removal-1942'],
  ),
  // The 1936 aerial survey is a later milestone (its imagery is not on the
  // map yet); the sheets the dial can show for this stop were surveyed
  // years away, and the teaser says so.
  named(
    indexOfYear(1936),
    '1936',
    '1936 · Streetcars at their peak; nearest survey sheets',
    'Streetcars at their peak; nearest survey sheets',
  ),
  named(
    indexOfYear(1916),
    '1916',
    '1916 · Lake Washington drops nine feet; Boeing founded',
    'Lake Washington drops nine feet; Boeing founded',
    ['ship-canal-1916'],
  ),
  named(
    indexOfYear(1909),
    '1909',
    '1909 · AYP Exposition, regrades, the 1909 map',
    'AYP Exposition, regrades, the 1909 map',
    ['ayp-1909'],
  ),
  named(
    indexOfYear(1897),
    '1897',
    'July 17, 1897 · Klondike gold; the 1897 map',
    'Klondike gold; the 1897 map',
    ['klondike-1897'],
  ),
  named(indexOfYear(1889), '1889', '1889 · Statehood and the great fires', 'Statehood and the great fires', [
    'statehood-1889',
    'great-seattle-fire-1889',
    'great-spokane-fire-1889',
    'ellensburg-fire-1889',
  ]),
  named(indexOfYear(1855), '1855', '1855 · The treaties, then war', 'The treaties, then war', [
    'medicine-creek-1854',
    'point-elliott-1855',
    'point-no-point-neah-bay-1855',
    'walla-walla-council-1855',
    'quinault-treaty-1855',
    'chehalis-council-1855',
    'puget-sound-war',
    'yakama-war',
  ]),
  named(
    indexOfYear(1846),
    '1846',
    'June 15, 1846 · The border is drawn at the 49th parallel',
    'The border is drawn at the 49th parallel',
    ['oregon-treaty-1846'],
  ),
  // 1792 is not a gear stop (the decades gear runs 1840 … 1770), so this
  // chapter sits on the 1790s stop and keeps its 1792 readout.
  named(
    indexOfYear(1790),
    '1792',
    '1792 · Vancouver charts the Sound; Gray enters the Columbia',
    'Vancouver charts the Sound; Gray enters the Columbia',
    ['vancouver-1792', 'gray-columbia-1792'],
  ),
  named(
    indexOfYear(1700),
    '1700',
    'January 26, 1700 · The great Cascadia earthquake',
    'The great Cascadia earthquake',
    ['cascadia-1700'],
  ),
  named(
    indexOfYear(1500),
    '1500s',
    'the 1500s · Electron Mudflow (c. 1507); Ozette',
    'Electron Mudflow (c. 1507); Ozette',
    ['electron-mudflow', 'ozette'],
  ),
  named(
    indexOfYear(900),
    '900s',
    'the 900s · The Seattle Fault earthquake (923-924 CE)',
    'The Seattle Fault earthquake (923-924 CE)',
    ['seattle-fault-923'],
  ),
  named(
    indexOfYear(-6000),
    '6000 BCE',
    '8,000 years ago · Mazama ash; Osceola Mudflow 2,400 years later',
    'Mazama ash; Osceola Mudflow 2,400 years later',
    ['mazama-ash', 'osceola-mudflow'],
  ),
  named(
    indexOfYear(-12_000),
    '12,000 BCE',
    '14,000 years ago · Mastodon hunters at Sequim; Glacier Peak ash',
    'Mastodon hunters at Sequim; Glacier Peak ash',
    ['manis-mastodon', 'glacier-peak-ash'],
  ),
  named(
    indexOfYear(-15_000),
    '15,000 BCE',
    '17,000 years ago · Ice age peak: a mile of ice, the Missoula floods',
    'Ice age peak: a mile of ice, the Missoula floods',
    ['vashon-ice-sheet', 'missoula-floods'],
  ),
  named(
    indexOfMa(0.5),
    '500,000 ya',
    '500,000 years ago · Rainier and Adams are born',
    'Rainier and Adams are born',
    ['modern-volcanoes'],
  ),
  named(indexOfMa(2.6), '2.6 Ma', '2.6 million years ago · The ice ages begin', 'The ice ages begin'),
  named(
    indexOfMa(16),
    '16 Ma',
    '16 million years ago · Lava floods bury a third of Washington',
    'Lava floods bury a third of Washington',
    ['columbia-river-basalt'],
  ),
  named(
    indexOfMa(50),
    '50 Ma',
    '50 million years ago · Siletzia docks; palm forests',
    'Siletzia docks; palm forests',
    ['siletzia', 'eocene-forests', 'stonerose'],
  ),
  named(
    indexOfMa(100),
    '100 Ma',
    '100 million years ago · Exotic terranes weld on',
    'Exotic terranes weld on',
    ['terranes-cretaceous'],
  ),
  named(
    indexOfMa(539),
    '539 Ma',
    '539 million years ago · Cambrian seas (Metaline limestone)',
    'Cambrian seas (Metaline limestone)',
    ['metaline-cambrian'],
  ),
  named(
    indexOfMa(720),
    '720 Ma',
    '720 million years ago · Snowball Earth; Rodinia rifts',
    'Snowball Earth; Rodinia rifts',
    ['rodinia-rifts'],
  ),
  named(
    indexOfMa(1470),
    '1.47 Ga',
    "1.47 billion years ago · Washington's oldest rocks",
    "Washington's oldest rocks",
    ['belt-supergroup'],
  ),
  named(indexOfMa(4567), '4.57 Ga', '4.57 billion years ago · Birth of the Earth', 'Birth of the Earth'),
  named(
    FUTURE_INDEX,
    '+50 Ma',
    '50 million years from now',
    'The continents keep drifting: a sketch, not a model',
    ['future-50ma'],
  ),
]);

/** True when STOPS[index] is one of the named stops. */
export const isNamedIndex = (index: number): boolean => NAMED_STOPS.some((n) => n.index === index);

function mustStop(index: number): Stop {
  const s = STOPS[index];
  if (!s) throw new RangeError(`no stop at index ${index}`);
  return s;
}

/** The stop at an index; throws for an index off the dial. */
export const stopAt = (index: number): Stop => mustStop(index);

/**
 * Snap any point in time to the nearest stop, measured in years, so that
 * 1843 lands on 1845 (2 years off) rather than the 1840s (3 years off).
 * Exact ties go to the older stop.
 */
export function stopFor(t: TimePoint): Stop {
  const target = yearsAgo(t);
  let best = mustStop(0);
  let bestDist = Math.abs(yearsAgo(best.time) - target);
  for (let i = 1; i < STOPS.length; i++) {
    const s = mustStop(i);
    const d = Math.abs(yearsAgo(s.time) - target);
    if (d <= bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/** The named stop closest in years to STOPS[index]; ties go to the older one. */
export function nearestNamedStop(index: number): NamedStop {
  const target = yearsAgo(mustStop(index).time);
  let best: NamedStop | undefined;
  let bestDist = Infinity;
  for (const n of NAMED_STOPS) {
    const d = Math.abs(yearsAgo(mustStop(n.index).time) - target);
    if (d < bestDist || (d === bestDist && best && n.index > best.index)) {
      best = n;
      bestDist = d;
    }
  }
  if (!best) throw new Error('NAMED_STOPS is empty');
  return best;
}

/** Half the spacing of a gear with evenly spaced stops, in years. */
const HALF_STEP: Partial<Record<Gear, number>> = {
  years: 0.5,
  decades: 5,
  centuries: 50,
  millennia: 500,
};

/**
 * The span of time a stop stands for, as years before 2000 CE with
 * `fromYearsAgo` the younger edge (smaller number) and `toYearsAgo` the older.
 *
 * - Evenly spaced gears: the stop ± half the gear step.
 * - Ice ages, millions, eons (uneven spacing): halfway to each neighbour;
 *   the oldest stop mirrors its younger gap.
 * - Now: open toward the present (`fromYearsAgo` is -Infinity) so that what
 *   is still true today keeps showing; the older edge is the usual half year.
 * - Future: a single point.
 */
export function windowOf(stop: Stop): { fromYearsAgo: number; toYearsAgo: number } {
  const centre = yearsAgo(stop.time);
  if (stop.gear === 'future') return { fromYearsAgo: centre, toYearsAgo: centre };
  if (stop.gear === 'now') return { fromYearsAgo: -Infinity, toYearsAgo: centre + 0.5 };
  const half = HALF_STEP[stop.gear];
  if (half !== undefined) return { fromYearsAgo: centre - half, toYearsAgo: centre + half };

  const younger = yearsAgo(mustStop(stop.index - 1).time);
  const olderStop = STOPS[stop.index + 1];
  const fromYearsAgo = (centre + younger) / 2;
  const toYearsAgo = olderStop ? (centre + yearsAgo(olderStop.time)) / 2 : centre + (centre - fromYearsAgo);
  return { fromYearsAgo, toYearsAgo };
}

/**
 * The `at=` value for a stop: 'now', '1890', '-8000' (8000 BCE), '20ka',
 * '66Ma', '2.5Ga', '+50Ma'.
 */
export function encodeAt(stop: Stop): string {
  switch (stop.gear) {
    case 'now':
      return 'now';
    case 'future':
      return `+${FUTURE_MA}Ma`;
    case 'years':
    case 'decades':
    case 'centuries':
    case 'millennia':
      return String(stop.time.value);
    case 'ice-ages':
    case 'millions':
    case 'eons':
      return shortAge(stop.time.value, '');
  }
}

/**
 * Read an `at=` value back into a stop, snapping to the nearest one. Accepts
 * everything `encodeAt` writes, the future in words ("+50 Ma", "50 Ma from
 * now", "50 million years from now", "in 50 million years") and anything
 * `parseTime` understands ("1924", "800 BC", "20,000 years ago", "66 Ma",
 * "4.5 Ga"). Null when the text means nothing.
 */
export function decodeAt(s: string): Stop | null {
  const text = s.trim();
  if (!text) return null;
  const lower = text.toLowerCase().replace(/,/g, '');
  if (lower === 'now' || lower === 'today' || lower === 'present') return mustStop(NOW_INDEX);

  let m: RegExpExecArray | null;
  // The future, in millions of years after 2000 CE: "+50Ma", "+50 ma",
  // "50 Ma from now", "50 million years from now", "in 50 million years".
  if (
    (m = /^\+\s*(\d+(?:\.\d+)?)\s*(?:ma|mya|million\s+years?)(?:\s+from\s+now|\s+ahead)?$/.exec(lower)) ||
    (m = /^(?:in\s+)?(\d+(?:\.\d+)?)\s*(?:ma|mya|million\s+years?)\s+(?:from\s+now|ahead|in\s+the\s+future)$/.exec(lower)) ||
    (m = /^in\s+(\d+(?:\.\d+)?)\s*(?:ma|mya|million\s+years?)$/.exec(lower))
  ) {
    return stopFor({ kind: 'ago', value: -Number(m[1]!) * 1_000_000 });
  }
  // "-8000": a BCE year.
  if ((m = /^-\s*(\d+)$/.exec(lower))) {
    const y = Number(m[1]!);
    return y === 0 ? null : stopFor(year(-y));
  }
  const t = parseTime(text, NOW_YEAR);
  return t ? stopFor(t) : null;
}

/** Background tint per gear, for light and dark themes (Plan v1 §5). */
export function gearTint(gear: Gear): { light: string; dark: string } {
  switch (gear) {
    case 'now':
      return { light: '#fffdf7', dark: '#1c1b18' }; // warm white
    case 'years':
      return { light: '#fdf8ec', dark: '#201d16' }; // warm white, a shade older
    case 'decades':
      return { light: '#f3e4c8', dark: '#2a2115' }; // sepia
    case 'centuries':
      return { light: '#ecdcb9', dark: '#2e2516' }; // parchment
    case 'millennia':
      return { light: '#e2d2b0', dark: '#2b2418' }; // darker parchment
    case 'ice-ages':
      return { light: '#dcedf7', dark: '#14222e' }; // ice blue
    case 'millions':
      return { light: '#cfe3e0', dark: '#0f2a2b' }; // deep green-blue
    case 'eons':
      return { light: '#e8c9c2', dark: '#1a0806' }; // red fading to black
    case 'future':
      return { light: '#ece6f7', dark: '#1d1828' }; // pale violet
  }
}

/**
 * Move one notch along the dial. `dir` 1 goes back in time (higher index),
 * -1 toward the present and the future (lower index). In 'stop' mode this is
 * the neighbouring stop; in 'named' mode it is the next named stop in that
 * direction. At the end of the dial the index comes back unchanged.
 */
export function stepStop(index: number, dir: -1 | 1, mode: 'stop' | 'named'): number {
  const clamped = Math.min(Math.max(Math.trunc(index), 0), OLDEST_INDEX);
  if (mode === 'stop') return Math.min(Math.max(clamped + dir, 0), OLDEST_INDEX);

  let best: number | undefined;
  for (const n of NAMED_STOPS) {
    if (dir === 1 ? n.index > clamped : n.index < clamped) {
      if (best === undefined || Math.abs(n.index - clamped) < Math.abs(best - clamped)) best = n.index;
    }
  }
  return best ?? clamped;
}
