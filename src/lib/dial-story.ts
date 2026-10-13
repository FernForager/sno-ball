/**
 * The story as it reads at one stop of the time dial.
 *
 * The page loads a place's story once, for today (src/main.ts). When the
 * visitor turns the dial, nothing is fetched again: the rings are re-told
 * from what is already known. This module holds the pure rules for that
 * re-telling, so they can be unit-tested without a browser:
 *
 *  - ringsAtStop: the rings for a stop. Each ring shows the timeline events
 *    whose span overlaps the stop's window (newest first, at most six, with
 *    "and N more"), plus any present-day fact dated inside the window ("Built
 *    in 1961" at the 1961 stop). A ring with nothing to say gets an `era`
 *    state instead: NOT YET when the county, city, state or neighborhood has
 *    not been founded at that date (with a jump to its founding year);
 *    "No people yet here" on the human rings before 20,000 years ago; "No
 *    record for this date" on the house, block and street; and otherwise
 *    the QUIET state, "Nothing recorded for <readout>", with ◀ ▶ jumps to
 *    the ring's nearest earlier and later events.
 *  - eventFact: a timeline event as a Fact, with its second-person line when
 *    the ground agrees (events.ts) and every source it cites.
 *  - the small wordings the postcard and status line use at a stop.
 *
 * Years are "years before 2000 CE" where they meet the events and stops,
 * and calendar years where a reader sees them; time.ts converts at the edge.
 */

import type { Fact, GeologyUnit, HistoryEvent, LngLat, PaleoPosition, Ring, RingEra, RingJump, RingLevel, Source } from './types';
import { AGO_THRESHOLD, fromYearsAgo, maToAgo, year, yearsAgo } from './time';
import { describePaleo } from './paleo';
import { eventsAtWindow, ringForSpot, storyLine, type SpotContext, type YearsAgoWindow } from './events';
import { NOW_INDEX, stopFor, stopYearsAgo, windowOf, type Stop } from './stops';

// ---------------------------------------------------------------------------
// Constants and wording
// ---------------------------------------------------------------------------

/** How many events one ring shows at a stop before "and N more". */
export const MAX_EVENTS_PER_RING = 6;

/** The source for a timeline event that (wrongly) cites none, so no fact is ever unattributed. */
export const TIMELINE_SOURCE: Source = {
  name: 'Snowball timelines (docs/research/timelines)',
  url: 'https://github.com/FernForager/sno-ball/tree/main/docs/research/timelines',
};

/** The rings that are about people, and so fall silent before 20,000 years ago. */
export const HUMAN_RINGS: readonly RingLevel[] = ['neighborhood', 'city', 'county'];

/** The rings with no timeline of their own: at a past stop they only show facts dated in the window. */
export const PLACE_RINGS: readonly RingLevel[] = ['house', 'block', 'street'];

/** The rings whose founding year the page can know. */
export type FoundedLevel = 'neighborhood' | 'city' | 'county' | 'state';

/** The founding year of each ring the page has learned it for (calendar years). */
export type FoundedYears = Partial<Record<FoundedLevel, number>>;

/** The verb of the "not yet" line for each ring. */
const FOUNDED_VERB: Readonly<Record<FoundedLevel, string>> = {
  neighborhood: 'become part of the city',
  city: 'be founded',
  county: 'be established',
  state: 'become a state',
};

/** The ice-age card lights up at stops inside this span (years before 2000 CE): the last glacial maximum. */
export const ICE_AGE_HIGHLIGHT: Readonly<YearsAgoWindow> = { fromYearsAgo: 13_000, toYearsAgo: 20_000 };

/** The oldest time the MERDITH2021 plate model reaches, in millions of years. */
export const PALEO_MODEL_MAX_MA = 1000;

export const NATURE_MAP_NOTE = "Coastlines are today's; sea level was lower.";
export const FUTURE_GLOBE_CAPTION = 'Where this spot may drift to, 50 million years from now.';

const fmt = (n: number): string => n.toLocaleString('en-US');

/** A calendar year as the site prints it: 1889, "79 CE", "500 BCE". */
function printYear(y: number): string {
  return y === 0 || !Number.isInteger(y) ? String(y) : yearsAgoReadout(y);
}

function yearsAgoReadout(y: number): string {
  if (y < 0) return `${fmt(-y)} BCE`;
  return y < 1000 ? `${y} CE` : String(y);
}

/** The calendar year a stop stands for, or undefined for the deep past and the future. */
export function calendarYearOf(stop: Stop): number | undefined {
  return stop.time.kind === 'year' ? stop.time.value : undefined;
}

/**
 * The year in a creation date as the data files store it ("1852-12-22",
 * "1883-01-01", "1883"), or undefined when there is none to read.
 */
export function inceptionYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(-?\d{1,6})(?:-|$)/.exec(value.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  return Number.isInteger(y) && y !== 0 ? y : undefined;
}

/**
 * "Not yet. King County will be established in 1852, 37 years from now."
 * The count skips the missing year 0, so 1 BCE to 1 CE is one year.
 */
export function notYetLine(name: string, foundedYear: number, selectedYear: number, verb = 'be founded'): string {
  const gap = yearsAgo(year(selectedYear)) - yearsAgo(year(foundedYear));
  const n = Math.max(1, Math.round(gap));
  return `Not yet. ${name} will ${verb} in ${printYear(foundedYear)}, ${fmt(n)} ${n === 1 ? 'year' : 'years'} from now.`;
}

/** The status line at a stop other than Now. */
export function eraStatus(stop: Stop, eventCount: number): string {
  if (eventCount === 0) return `As of ${stop.readout}: nothing recorded on the rings. Use ◀ ▶ on a card to find the nearest event.`;
  return `As of ${stop.readout}: ${fmt(eventCount)} ${eventCount === 1 ? 'event' : 'events'} on the rings.`;
}

/** The hero sentence at a stop: unchanged at Now, prefixed with the readout elsewhere. */
export function heroAtStop(stop: Stop, hero: string): string {
  const h = hero.trim();
  if (stop.index === NOW_INDEX || !h) return h;
  return `As of ${stop.readout}: ${h}`;
}

/** The map note when no USGS sheet was surveyed within 25 years of the stop. */
export function noSheetNote(calendarYear: number): string {
  return `No historical map here for ${printYear(calendarYear)}: today's streets shown faded.`;
}

/** The map note while the historical layers are switched off at a stop. */
export function todaysMapNote(calendarYear: number): string {
  return `Today's map. "Map as it was" brings back the ${printYear(calendarYear)} view.`;
}

/**
 * The caption under the globe for a stop `ma` million years ago: where the
 * model put the spot, that the model gave no answer, or that no model
 * reaches that far back (beyond PALEO_MODEL_MAX_MA).
 */
export function globeCaption(ma: number, answer: 'position' | 'none' | 'pending'): string {
  const when = `${fmt(Number(ma.toFixed(1)))} million years ago`;
  if (ma > PALEO_MODEL_MAX_MA) return `No plate model reaches back ${when}; the globe shows where the spot is today.`;
  if (answer === 'position') return `Your spot was here, ${when} (MERDITH2021).`;
  if (answer === 'pending') return `Asking the plate model where this spot was ${when}…`;
  return `The plate model has no position for this spot ${when}; the hollow dot is where it is today.`;
}

// ---------------------------------------------------------------------------
// Deep-time highlights
// ---------------------------------------------------------------------------

/** True when the stop falls inside the rock unit's age range: the rock is forming "now". */
export function isRockForming(unit: GeologyUnit | null | undefined, stop: Stop): boolean {
  const range = unit?.ageYearsAgo;
  if (!range) return false;
  const n = stopYearsAgo(stop);
  return n >= Math.min(range.from, range.to) && n <= Math.max(range.from, range.to);
}

/** True when the stop sits in the last glacial maximum, when the ice-age card's story is happening. */
export function isIceAgeStop(stop: Stop): boolean {
  const n = stopYearsAgo(stop);
  return n >= ICE_AGE_HIGHLIGHT.fromYearsAgo && n <= ICE_AGE_HIGHLIGHT.toYearsAgo;
}

// ---------------------------------------------------------------------------
// Events as facts
// ---------------------------------------------------------------------------

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * A timeline event as a Fact for a ring card: the title, a body made of the
 * event's "when", its summary and (when the ground and the records agree,
 * see storyLine) its line about the visitor's own spot; the date as a
 * calendar year or years ago; every source it cites; its confidence.
 */
export function eventFact(event: HistoryEvent, ctx: SpotContext): Fact {
  const when = fromYearsAgo(event.startYearsAgo);
  const line = storyLine(event, ctx);
  const body = [`${capitalise(event.when.trim())}.`, event.summary.trim(), line ?? ''].filter((s) => s.length > 0).join(' ');
  const [source, ...more] = event.sources;
  return {
    kind: 'event',
    title: event.title,
    body,
    ...(when.kind === 'year' ? { year: when.value } : { yearsAgo: when.value }),
    source: source ?? TIMELINE_SOURCE,
    ...(more.length > 0 ? { moreSources: more } : {}),
    confidence: event.confidence,
  };
}

/** The dial stop an event belongs on: the one nearest its start. */
export function stopForEvent(event: HistoryEvent): Stop {
  return stopFor(fromYearsAgo(event.startYearsAgo));
}

/**
 * The ring an event shows in: the most specific ring the story has among
 * those its matching scope tokens name (ringForSpot), so an event scoped
 * to another city in the same county goes on the county ring.
 */
export function ringLevelFor(event: HistoryEvent, present: ReadonlySet<RingLevel>, ctx: SpotContext): RingLevel | undefined {
  return ringForSpot(event, ctx).find((level) => present.has(level));
}

/** Every event sorted into the one ring it shows in, keeping the given order. */
export function eventsByRing(events: readonly HistoryEvent[], present: ReadonlySet<RingLevel>, ctx: SpotContext): Map<RingLevel, HistoryEvent[]> {
  const out = new Map<RingLevel, HistoryEvent[]>();
  for (const event of events) {
    const level = ringLevelFor(event, present, ctx);
    if (!level) continue;
    const list = out.get(level) ?? [];
    list.push(event);
    out.set(level, list);
  }
  return out;
}

export interface RingEventsAtStop {
  /** The ring's events whose span overlaps the window, newest first. */
  inWindow: HistoryEvent[];
  /** The ring's nearest event older than the window, if any. */
  earlier?: HistoryEvent;
  /** The ring's nearest event younger than the window, if any. */
  later?: HistoryEvent;
}

/**
 * One ring's events at a window: those inside it, newest first, and the
 * nearest neighbour on either side for the QUIET state's ◀ ▶ links. The
 * neighbours are measured from the event's start: the earlier one is the
 * event that began soonest before the window's older edge, the later one
 * the event that began soonest after its younger edge.
 */
export function ringEventsForStop(ringEvents: readonly HistoryEvent[], window: YearsAgoWindow): RingEventsAtStop {
  const oldest = Math.max(window.fromYearsAgo, window.toYearsAgo);
  const newest = Math.min(window.fromYearsAgo, window.toYearsAgo);
  const inWindow = eventsAtWindow(ringEvents, window);
  let earlier: HistoryEvent | undefined;
  let later: HistoryEvent | undefined;
  for (const event of ringEvents) {
    if (inWindow.includes(event)) continue;
    if (event.startYearsAgo > oldest) {
      if (!earlier || event.startYearsAgo < earlier.startYearsAgo) earlier = event;
    } else if (event.startYearsAgo < newest) {
      if (!later || event.startYearsAgo > later.startYearsAgo) later = event;
    }
  }
  return { inWindow, ...(earlier ? { earlier } : {}), ...(later ? { later } : {}) };
}

/** The present-day facts whose own date falls inside the window. */
export function datedFactsIn(facts: readonly Fact[], window: YearsAgoWindow): Fact[] {
  const oldest = Math.max(window.fromYearsAgo, window.toYearsAgo);
  const newest = Math.min(window.fromYearsAgo, window.toYearsAgo);
  return facts.filter((fact) => {
    const n = factYearsAgo(fact);
    return n !== undefined && n >= newest && n <= oldest;
  });
}

/** A fact's date in years before 2000 CE, or undefined when it has none. */
function factYearsAgo(fact: Fact): number | undefined {
  if (typeof fact.year === 'number' && Number.isInteger(fact.year) && fact.year !== 0) return yearsAgo(year(fact.year));
  if (typeof fact.yearsAgo === 'number' && Number.isFinite(fact.yearsAgo)) return fact.yearsAgo;
  return undefined;
}

// ---------------------------------------------------------------------------
// The rings at a stop
// ---------------------------------------------------------------------------

export interface StopStoryInput {
  /** The present-day rings, as loaded. */
  rings: readonly Ring[];
  stop: Stop;
  /** The events that apply to the spot (eventsForSpot), oldest first. */
  events: readonly HistoryEvent[];
  ctx: SpotContext;
  founded: FoundedYears;
  /** A fact for the plate ring at this stop (where the spot sat), when known. */
  plateFact?: Fact;
}

/** A jump to the stop of an event, labelled with the stop and the event's title. */
function jumpTo(event: HistoryEvent, direction: RingJump['direction']): RingJump {
  const stop = stopForEvent(event);
  return { label: `${stop.short} · ${event.title}`, index: stop.index, direction };
}

/**
 * The rings as they read at a stop (see the file comment). A ring the
 * present-day story could not name (status 'empty') is returned as it is,
 * the same object, so its card is left alone. Every other ring is a fresh
 * object: its events and dated facts, or an `era` state saying why there
 * is nothing, and never the busy flag of the loading story.
 */
export function ringsAtStop(input: StopStoryInput): Ring[] {
  const { rings, stop, events, ctx, founded } = input;
  const present = new Set(rings.map((r) => r.level));
  const byRing = eventsByRing(events, present, ctx);
  const window = windowOf(stop);
  const calendarYear = calendarYearOf(stop);
  const beforePeople = stopYearsAgo(stop) >= AGO_THRESHOLD;

  return rings.map((base) => {
    if (base.status === 'empty') return base;
    const level = base.level;
    const timeline = byRing.get(level) ?? [];
    const { inWindow, earlier, later } = ringEventsForStop(timeline, window);

    let facts: Fact[] = [...inWindow.map((e) => eventFact(e, ctx)), ...datedFactsIn(base.facts, window)];
    const more = Math.max(0, facts.length - MAX_EVENTS_PER_RING);
    if (more > 0) facts = facts.slice(0, MAX_EVENTS_PER_RING);
    if (level === 'plate' && input.plateFact) facts = [input.plateFact, ...facts];

    let era: RingEra | undefined;
    const foundedYear = isFoundedLevel(level) ? founded[level] : undefined;
    if (calendarYear !== undefined && foundedYear !== undefined && foundedYear > calendarYear) {
      era = {
        state: 'not-yet',
        text: notYetLine(base.name, foundedYear, calendarYear, FOUNDED_VERB[level as FoundedLevel]),
        jumps: [{ label: `Jump to ${printYear(foundedYear)}`, index: stopFor(year(foundedYear)).index, direction: 'jump' }],
      };
    } else if (facts.length === 0) {
      if (PLACE_RINGS.includes(level)) {
        era = { state: 'no-record', text: 'No record for this date.', jumps: [] };
      } else if (beforePeople && HUMAN_RINGS.includes(level)) {
        era = { state: 'no-people', text: 'No people yet here.', jumps: [] };
      } else {
        era = {
          state: 'quiet',
          text: `Nothing recorded for ${stop.readout}.`,
          jumps: [...(earlier ? [jumpTo(earlier, 'earlier')] : []), ...(later ? [jumpTo(later, 'later')] : [])],
        };
      }
    }

    const { note: _note, busy: _busy, era: _era, ...rest } = base;
    return {
      ...rest,
      facts,
      status: facts.length >= 2 ? 'rich' : facts.length === 1 ? 'thin' : 'empty',
      ...(more > 0 ? { note: `and ${fmt(more)} more in this window.` } : {}),
      ...(era ? { era } : {}),
    };
  });
}

function isFoundedLevel(level: RingLevel): level is FoundedLevel {
  return level === 'neighborhood' || level === 'city' || level === 'county' || level === 'state';
}

/** How many events the rings show at a stop (for the status line). */
export function countEvents(rings: readonly Ring[]): number {
  let n = 0;
  for (const ring of rings) for (const fact of ring.facts) if (fact.kind === 'event') n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// The plate ring at a globe stop
// ---------------------------------------------------------------------------

/** The plate ring's fact for a globe stop: where the spot sat then, in the plate model's words. */
export function paleoFact(pos: PaleoPosition, todayPoint: LngLat): Fact {
  return {
    kind: 'paleo-position',
    title: `Where this spot sat ${fmt(Number(pos.ma.toFixed(1)))} million years ago`,
    body: describePaleo(pos, todayPoint),
    yearsAgo: maToAgo(pos.ma),
    source: pos.source,
    confidence: 'medium',
  };
}
