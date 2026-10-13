/**
 * Tests for src/lib/dial-story.ts: how the story reads at a stop of the
 * dial. Everything runs in plain Node with hand-made rings and events
 * (nothing here reads the real timelines, which change as they are
 * fact-checked).
 */
import { describe, expect, it } from 'vitest';
import type { Fact, GeologyUnit, HistoryEvent, Ring, Source } from '../../src/lib/types';
import type { SpotContext } from '../../src/lib/events';
import { indexOfMa, indexOfYear, NOW_INDEX, stopAt, windowOf, FUTURE_INDEX } from '../../src/lib/stops';
import {
  MAX_EVENTS_PER_RING,
  TIMELINE_SOURCE,
  calendarYearOf,
  countEvents,
  datedFactsIn,
  eraStatus,
  eventFact,
  eventsByRing,
  globeCaption,
  heroAtStop,
  inceptionYear,
  isIceAgeStop,
  isRockForming,
  noSheetNote,
  notYetLine,
  paleoFact,
  ringEventsForStop,
  ringsAtStop,
  stopForEvent,
} from '../../src/lib/dial-story';

const SRC: Source = { name: 'A record', url: 'https://example.org/record' };
const SRC2: Source = { name: 'Another record', url: 'https://example.org/other' };

/** A human event scoped to one or more tokens, from `start` to `end` years before 2000 CE. */
function human(id: string, start: number, end: number, regions: string[], extra: Partial<HistoryEvent> & { kind?: 'deep' | 'human' } = {}): HistoryEvent {
  return {
    id,
    title: `Event ${id}`,
    when: `about ${start} years ago`,
    startYearsAgo: start,
    endYearsAgo: end,
    region: regions.join(', '),
    summary: `What happened in ${id}.`,
    sources: [SRC],
    confidence: 'high',
    ...extra,
    // The loader's SpotEvent carries these two; a plain HistoryEvent counts as human.
    ...({ kind: extra.kind ?? 'human', regions } as object),
  };
}

const deep = (id: string, start: number, end: number, regions: string[], extra: Partial<HistoryEvent> = {}): HistoryEvent =>
  human(id, start, end, regions, { ...extra, kind: 'deep' });

function ring(level: Ring['level'], name: string, facts: Fact[] = [], status: Ring['status'] = facts.length > 1 ? 'rich' : facts.length === 1 ? 'thin' : 'loading'): Ring {
  return { level, name, facts, status };
}

const CTX: SpotContext = {
  point: { lng: -122.349, lat: 47.62 },
  county: 'King County',
  city: 'Seattle',
  region: 'Puget Sound',
  placeName: '400 Broad Street',
};

/** The nine rings of a Seattle story, with a few dated facts. */
function seattleRings(): Ring[] {
  return [
    ring('house', '400 Broad Street', [{ kind: 'year-built', title: 'Built in 1961', year: 1961, source: SRC }]),
    ring('block', 'This block', [], 'empty'),
    ring('street', 'Broad Street', [], 'empty'),
    ring('neighborhood', 'Lower Queen Anne', [{ kind: 'annexed', title: 'Became part of Seattle in 1869', year: 1869, source: SRC }]),
    ring('city', 'Seattle', [{ kind: 'summary', title: 'Seattle', body: 'A city.', source: SRC }]),
    ring('county', 'King County', [{ kind: 'founded', title: 'Established December 22, 1852', year: 1852, source: SRC }]),
    ring('region', 'Puget Sound', [{ kind: 'region-blurb', title: 'The Puget Sound', body: 'Water.', source: SRC }]),
    ring('state', 'Washington', [{ kind: 'founded', title: 'Statehood November 11, 1889', year: 1889, source: SRC }]),
    ring('plate', 'North American Plate', [{ kind: 'paleo-position', title: 'Carried here', yearsAgo: 500_000_000, source: SRC }]),
  ];
}

const EVENTS: HistoryEvent[] = [
  deep('ice', 19_000, 16_000, ['Puget Sound']),
  deep('subduction', 30_000_000, 0, ['statewide']),
  human('salish', 10_000, 0, ['King County']),
  human('denny', 149, 149, ['Seattle', 'King County']),
  human('treaty', 145, 145, ['King County']),
  human('renton', 125, 99, ['Renton', 'King County']),
  human('fire', 111, 111, ['Seattle', 'King County'], { sources: [SRC, SRC2] }),
  human('statehood', 111, 111, ['statewide'], { atYourSpot: 'Your spot has been in the state since this day.' }),
  deep('st-helens', 20, 20, ['statewide']),
  human('boom', 6, 0, ['Seattle']),
];

const FOUNDED = { state: 1889, county: 1852, city: 1869, neighborhood: 1869 };

describe('small wordings', () => {
  it('reads a founding year out of the data files', () => {
    expect(inceptionYear('1852-12-22')).toBe(1852);
    expect(inceptionYear('1883-01-01')).toBe(1883);
    expect(inceptionYear('1883')).toBe(1883);
    expect(inceptionYear('-0500-01-01')).toBe(-500);
    expect(inceptionYear('')).toBeUndefined();
    expect(inceptionYear(undefined)).toBeUndefined();
    expect(inceptionYear('soon')).toBeUndefined();
  });

  it('counts the years to a founding, with the verb for the ring', () => {
    expect(notYetLine('King County', 1852, 1815, 'be established')).toBe('Not yet. King County will be established in 1852, 37 years from now.');
    expect(notYetLine('Washington', 1889, 1888, 'become a state')).toBe('Not yet. Washington will become a state in 1889, 1 year from now.');
    expect(notYetLine('Seattle', 1869, 1700)).toBe('Not yet. Seattle will be founded in 1869, 169 years from now.');
    // No year 0: 1 BCE to 1 CE is one year, and large counts get separators.
    expect(notYetLine('Rome', 1, -1, 'be founded')).toBe('Not yet. Rome will be founded in 1 CE, 1 year from now.');
    // From a thousand years on the count is rounded to two figures and marked "about".
    expect(notYetLine('Seattle', 1869, -1000)).toContain('about 2,900 years from now');
    expect(notYetLine('Seattle', 1869, 869)).toBe('Not yet. Seattle will be founded in 1869, 1,000 years from now.'.replace('1,000 years', 'about 1,000 years'));
    expect(notYetLine('Seattle', 1869, 870)).toContain('999 years from now');
    expect(notYetLine('King County', 1852, -15_000)).toContain('about 17,000 years from now');
  });

  it('gives each stop its calendar year, or none in deep time', () => {
    expect(calendarYearOf(stopAt(indexOfYear(1889)))).toBe(1889);
    expect(calendarYearOf(stopAt(indexOfYear(-15_000)))).toBe(-15_000);
    expect(calendarYearOf(stopAt(indexOfMa(66)))).toBeUndefined();
    expect(calendarYearOf(stopAt(FUTURE_INDEX))).toBeUndefined();
  });

  it('prefixes the hero and the status with the readout away from Now', () => {
    const hero = '400 Broad St sits in Seattle, King County.';
    expect(heroAtStop(stopAt(NOW_INDEX), hero)).toBe(hero);
    expect(heroAtStop(stopAt(indexOfYear(1889)), hero)).toBe(`As of 1889: ${hero}`);
    expect(heroAtStop(stopAt(indexOfYear(1790)), hero)).toBe(`As of the 1790s: ${hero}`);
    expect(heroAtStop(stopAt(indexOfYear(1889)), '  ')).toBe('');
    expect(eraStatus(stopAt(indexOfYear(1889)), 3)).toBe('As of 1889: 3 events on the rings.');
    expect(eraStatus(stopAt(indexOfYear(1889)), 1)).toBe('As of 1889: 1 event on the rings.');
    expect(eraStatus(stopAt(indexOfYear(1700)), 0)).toContain('nothing recorded');
  });

  it('words the map notes and globe captions', () => {
    // No sheet does not mean no historical map: OpenHistoricalMap's features still draw, and are named.
    expect(noSheetNote(1850)).toBe("No USGS map here for 1850. OpenHistoricalMap's 1850 features (where mapped) over today's streets, faded.");
    expect(noSheetNote(-500)).toContain('500 BCE');
    expect(globeCaption(66, 'position')).toBe('Your spot was here, 66 million years ago (MERDITH2021).');
    expect(globeCaption(2.6, 'none')).toContain('no position for this spot 2.6 million years ago');
    expect(globeCaption(100, 'pending')).toContain('Asking the plate model');
    expect(globeCaption(1470, 'position')).toContain('No plate model reaches back 1,470 million years ago');
  });
});

describe('deep-time highlights', () => {
  const till: GeologyUnit = { symbol: 'Qgt', name: 'glacial till', age: 'Pleistocene', ageYearsAgo: { from: 2_580_000, to: 11_700 }, source: SRC };

  it('lights the rock card only inside the unit age range', () => {
    expect(isRockForming(till, stopAt(indexOfYear(-15_000)))).toBe(true);
    expect(isRockForming(till, stopAt(indexOfMa(1)))).toBe(true);
    expect(isRockForming(till, stopAt(indexOfMa(16)))).toBe(false);
    expect(isRockForming(till, stopAt(indexOfYear(1889)))).toBe(false);
    expect(isRockForming(till, stopAt(FUTURE_INDEX))).toBe(false);
    const { ageYearsAgo: _range, ...undated } = till;
    expect(isRockForming(undated, stopAt(indexOfMa(1)))).toBe(false);
    expect(isRockForming(null, stopAt(indexOfMa(1)))).toBe(false);
  });

  it('lights the ice card at the glacial maximum', () => {
    expect(isIceAgeStop(stopAt(indexOfYear(-15_000)))).toBe(true);
    expect(isIceAgeStop(stopAt(indexOfYear(-12_000)))).toBe(true);
    expect(isIceAgeStop(stopAt(indexOfYear(-6000)))).toBe(false);
    expect(isIceAgeStop(stopAt(indexOfMa(0.5)))).toBe(false);
    expect(isIceAgeStop(stopAt(NOW_INDEX))).toBe(false);
  });
});

describe('events as facts', () => {
  it('keeps the title, dates the fact, carries every source and the spot line', () => {
    const fact = eventFact(EVENTS.find((e) => e.id === 'statehood')!, CTX);
    expect(fact.kind).toBe('event');
    expect(fact.title).toBe('Event statehood');
    expect(fact.year).toBe(1889);
    expect(fact.yearsAgo).toBeUndefined();
    expect(fact.body).toBe('About 111 years ago. What happened in statehood. Your spot has been in the state since this day.');
    expect(fact.source).toEqual(SRC);
    expect(fact.moreSources).toBeUndefined();
    expect(fact.confidence).toBe('high');

    const fire = eventFact(EVENTS.find((e) => e.id === 'fire')!, CTX);
    expect(fire.moreSources).toEqual([SRC2]);
  });

  it('dates deep-time facts in years ago and never leaves a fact without a source', () => {
    // 19,000 years before 2000 CE is still a calendar year (17,001 BCE), under the 20,000 threshold.
    const ice = eventFact(EVENTS.find((e) => e.id === 'ice')!, CTX);
    expect(ice.year).toBe(-17_001);
    expect(ice.yearsAgo).toBeUndefined();
    const bare = eventFact(human('bare', 50, 50, ['statewide'], { sources: [] }), CTX);
    expect(bare.source).toEqual(TIMELINE_SOURCE);
    const old = eventFact(EVENTS.find((e) => e.id === 'subduction')!, CTX);
    expect(old.yearsAgo).toBe(30_000_000);
  });

  it('dates the far-future projection in (negative) years ago, never as the year 50,002,000', () => {
    const future = eventFact(deep('future', -50_000_000, -50_000_000, ['statewide'], { when: 'fifty million years from now' }), CTX);
    expect(future.year).toBeUndefined();
    expect(future.yearsAgo).toBe(-50_000_000);
    expect(future.body).toMatch(/^Fifty million years from now\./);
    // An event a few years after 2000 is still a plain calendar year.
    expect(eventFact(human('recent', -9, -9, ['statewide']), CTX).year).toBe(2009);
  });

  it('snaps an event to its nearest stop', () => {
    expect(stopForEvent(EVENTS.find((e) => e.id === 'fire')!).index).toBe(indexOfYear(1889));
    expect(stopForEvent(EVENTS.find((e) => e.id === 'ice')!).index).toBe(indexOfYear(-17_000));
    expect(stopForEvent(EVENTS.find((e) => e.id === 'subduction')!).index).toBe(indexOfMa(34));
  });

  it('sorts events into the first ring the story has', () => {
    const present = new Set(seattleRings().map((r) => r.level));
    const byRing = eventsByRing(EVENTS, present, CTX);
    expect(byRing.get('city')?.map((e) => e.id)).toEqual(['denny', 'fire', 'boom']);
    // Renton's event matched this Seattle spot by its county token, so it goes on the county ring.
    expect(byRing.get('county')?.map((e) => e.id)).toEqual(['salish', 'treaty', 'renton']);
    expect(eventsByRing(EVENTS, present, { ...CTX, city: 'Renton' }).get('city')?.map((e) => e.id)).toEqual(['renton']);
    expect(byRing.get('region')?.map((e) => e.id)).toEqual(['ice']);
    expect(byRing.get('state')?.map((e) => e.id)).toEqual(['subduction', 'statehood', 'st-helens']);
    expect(byRing.has('plate')).toBe(false);
    // Without a city ring the events scoped to the county as well move out
    // to it; one scoped only to the city has nowhere to go (ringFor).
    const noCity = new Set<Ring['level']>(['county', 'state']);
    expect(eventsByRing(EVENTS, noCity, CTX).get('county')?.map((e) => e.id)).toEqual(['salish', 'denny', 'treaty', 'renton', 'fire']);
  });
});

describe('ringEventsForStop', () => {
  const cityEvents = EVENTS.filter((e) => ['denny', 'fire', 'boom'].includes(e.id));

  it('finds the events in the window and the nearest neighbour on each side', () => {
    const at1855 = ringEventsForStop(cityEvents, windowOf(stopAt(indexOfYear(1855))));
    expect(at1855.inWindow).toEqual([]);
    expect(at1855.earlier?.id).toBe('denny');
    expect(at1855.later?.id).toBe('fire');

    const at1889 = ringEventsForStop(cityEvents, windowOf(stopAt(indexOfYear(1889))));
    expect(at1889.inWindow.map((e) => e.id)).toEqual(['fire']);
    expect(at1889.earlier?.id).toBe('denny');
    expect(at1889.later?.id).toBe('boom');
  });

  it('has no earlier neighbour before the first event and none later after the last', () => {
    const early = ringEventsForStop(cityEvents, windowOf(stopAt(indexOfYear(1700))));
    expect(early.earlier).toBeUndefined();
    expect(early.later?.id).toBe('denny');
    const late = ringEventsForStop(cityEvents, windowOf(stopAt(indexOfYear(2020))));
    expect(late.inWindow.map((e) => e.id)).toEqual(['boom']); // continuing since 1994
    expect(late.later).toBeUndefined();
    expect(late.earlier?.id).toBe('fire');
  });

  it('lets a continuing event reach the present, not the future stop', () => {
    const atFuture = ringEventsForStop(cityEvents, windowOf(stopAt(FUTURE_INDEX)));
    expect(atFuture.inWindow).toEqual([]); // "boom" continues to today, not to +50 Ma
    expect(atFuture.later).toBeUndefined();
    expect(atFuture.earlier?.id).toBe('boom'); // the nearest thing before the future is the newest event
    const projection = deep('projection', -50_000_000, -50_000_000, ['Seattle']);
    expect(ringEventsForStop([...cityEvents, projection], windowOf(stopAt(FUTURE_INDEX))).inWindow).toEqual([projection]);
    // The present itself still shows what continues.
    expect(ringEventsForStop(cityEvents, windowOf(stopAt(NOW_INDEX))).inWindow.map((e) => e.id)).toEqual(['boom']);
  });

  it('keeps the dated present-day facts whose year is in the window', () => {
    const facts = seattleRings().flatMap((r) => r.facts);
    expect(datedFactsIn(facts, windowOf(stopAt(indexOfYear(1961)))).map((f) => f.title)).toEqual(['Built in 1961']);
    expect(datedFactsIn(facts, windowOf(stopAt(indexOfYear(1852)))).map((f) => f.title)).toEqual(['Established December 22, 1852']);
    expect(datedFactsIn(facts, windowOf(stopAt(indexOfMa(485)))).map((f) => f.title)).toEqual(['Carried here']);
    expect(datedFactsIn(facts, windowOf(stopAt(indexOfYear(1700))))).toEqual([]);
  });
});

describe('ringsAtStop', () => {
  const at = (year: number, extra: Partial<Parameters<typeof ringsAtStop>[0]> = {}) =>
    ringsAtStop({ rings: seattleRings(), stop: stopAt(indexOfYear(year)), events: EVENTS, ctx: CTX, founded: FOUNDED, ...extra });
  const find = (rings: Ring[], level: Ring['level']) => rings.find((r) => r.level === level)!;

  it('shows the events of the window on their rings, newest first, with the spot line', () => {
    const rings = at(1889);
    const state = find(rings, 'state');
    expect(state.facts.map((f) => f.title)).toEqual(['Event statehood', 'Event subduction', 'Statehood November 11, 1889']);
    expect(state.status).toBe('rich');
    expect(state.era).toBeUndefined();
    expect(state.facts[0]?.body).toContain('Your spot has been in the state since this day.');
    expect(find(rings, 'city').facts.map((f) => f.title)).toEqual(['Event fire']);
    expect(find(rings, 'county').facts.map((f) => f.title)).toEqual(['Event renton', 'Event salish']);
    expect(countEvents(rings)).toBe(5);
  });

  it('says NOT YET for a ring founded after the stop, with a jump to its founding year', () => {
    const rings = at(1855);
    const county = find(rings, 'county');
    expect(county.era).toBeUndefined(); // founded 1852, so it exists in 1855
    expect(county.facts.map((f) => f.title)).toEqual(['Event treaty', 'Event salish']);
    const city = find(rings, 'city');
    expect(city.era?.state).toBe('not-yet');
    expect(city.era?.text).toBe('Not yet. Seattle will be founded in 1869, 14 years from now.');
    expect(city.era?.jumps).toEqual([{ label: 'Jump to 1869', index: indexOfYear(1869), direction: 'jump' }]);
    expect(city.status).toBe('empty');
    const state = find(rings, 'state');
    expect(state.era?.text).toBe('Not yet. Washington will become a state in 1889, 34 years from now.');
    const hood = find(rings, 'neighborhood');
    expect(hood.era?.text).toBe('Not yet. Lower Queen Anne will become part of the city in 1869, 14 years from now.');
    // At the founding year itself the dated fact shows and the countdown is gone.
    const founded = find(at(1869), 'neighborhood');
    expect(founded.era).toBeUndefined();
    expect(founded.facts.map((f) => f.title)).toEqual(['Became part of Seattle in 1869']);
  });

  it('keeps the events that happened before a place was founded, under the countdown', () => {
    const rings = at(1851);
    const city = find(rings, 'city');
    expect(city.era?.state).toBe('not-yet');
    expect(city.facts.map((f) => f.title)).toEqual(['Event denny']);
    expect(city.status).toBe('thin');
  });

  it('goes QUIET with neighbour links when a ring has nothing in the window', () => {
    const city = find(at(1880), 'city');
    expect(city.era?.state).toBe('quiet');
    expect(city.era?.text).toBe('Nothing recorded for 1880.');
    expect(city.era?.jumps).toEqual([
      { label: '1851 · Event denny', index: indexOfYear(1851), direction: 'earlier' },
      { label: '1889 · Event fire', index: indexOfYear(1889), direction: 'later' },
    ]);
    expect(city.facts).toEqual([]);
    expect(city.status).toBe('empty');
    // The region has only the ice-age event, far in the past: one earlier link, no later one.
    const region = find(at(1880), 'region');
    expect(region.era?.jumps.map((j) => j.direction)).toEqual(['earlier']);
  });

  it('says "No record for this date" on the house, block and street unless a fact is dated there', () => {
    const rings = at(1880);
    expect(find(rings, 'house').era).toEqual({ state: 'no-record', text: 'No record for this date.', jumps: [] });
    expect(find(rings, 'house').facts).toEqual([]);
    const built = find(at(1961), 'house');
    expect(built.era).toBeUndefined();
    expect(built.facts.map((f) => f.title)).toEqual(['Built in 1961']);
    // A ring the story could not name is left exactly as it is.
    const base = seattleRings();
    const rings2 = ringsAtStop({ rings: base, stop: stopAt(indexOfYear(1880)), events: EVENTS, ctx: CTX, founded: FOUNDED });
    expect(find(rings2, 'block')).toBe(base[1]);
  });

  it('collapses the human rings into "No people yet here" before 20,000 years ago', () => {
    const rings = ringsAtStop({ rings: seattleRings(), stop: stopAt(indexOfMa(1)), events: EVENTS, ctx: CTX, founded: FOUNDED });
    for (const level of ['neighborhood', 'city', 'county'] as const) {
      expect(find(rings, level).era).toEqual({ state: 'no-people', text: 'No people yet here.', jumps: [] });
    }
    // Deep-time events still show on the region and state rings.
    expect(find(rings, 'state').facts.map((f) => f.title)).toEqual(['Event subduction']);
    // Not before 20,000 years ago: at 17,000 years ago the human rings
    // keep their own states (here the county's countdown to 1852).
    const ice = ringsAtStop({ rings: seattleRings(), stop: stopAt(indexOfYear(-15_000)), events: EVENTS, ctx: CTX, founded: FOUNDED });
    expect(find(ice, 'county').era?.state).toBe('not-yet');
    expect(find(ice, 'county').era?.text).toContain('about 17,000 years from now');
    expect(find(ice, 'region').facts.map((f) => f.title)).toEqual(['Event ice']);
    const unfounded = ringsAtStop({ rings: seattleRings(), stop: stopAt(indexOfYear(-15_000)), events: EVENTS, ctx: CTX, founded: {} });
    expect(find(unfounded, 'county').era?.state).toBe('quiet');
  });

  it('caps a ring at six events and says how many more there are', () => {
    const many = Array.from({ length: 9 }, (_, i) => human(`m${i}`, 111, 111, ['statewide']));
    const rings = ringsAtStop({ rings: seattleRings(), stop: stopAt(indexOfYear(1889)), events: many, ctx: CTX, founded: FOUNDED });
    const state = find(rings, 'state');
    expect(state.facts).toHaveLength(MAX_EVENTS_PER_RING);
    // Nine events plus the dated statehood fact: four more than the six shown.
    expect(state.note).toBe('and 4 more in this window.');
  });

  it('at the future stop shows only the projection, not every continuing event', () => {
    const projection = deep('future', -50_000_000, -50_000_000, ['statewide']);
    const rings = ringsAtStop({ rings: seattleRings(), stop: stopAt(FUTURE_INDEX), events: [...EVENTS, projection], ctx: CTX, founded: FOUNDED });
    expect(find(rings, 'state').facts.map((f) => f.title)).toEqual(['Event future']);
    expect(find(rings, 'state').facts[0]?.year).toBeUndefined();
    // "salish" and "boom" continue to today; at +50 Ma their rings are quiet,
    // and the ◀ link points back to the newest thing on the ring.
    expect(find(rings, 'county').era?.state).toBe('quiet');
    expect(find(rings, 'county').era?.jumps).toEqual([{ label: '1875 · Event renton', index: indexOfYear(1875), direction: 'earlier' }]);
    expect(find(rings, 'city').era?.jumps.map((j) => j.label)).toEqual(['1994 · Event boom']);
    expect(countEvents(rings)).toBe(1);
  });

  it('puts the plate model answer first on the plate ring at a globe stop', () => {
    const pos = { ma: 66, point: { lng: -100, lat: 40 }, model: 'MERDITH2021', source: SRC };
    const fact = paleoFact(pos, CTX.point);
    expect(fact.title).toBe('Where this spot sat 66 million years ago');
    expect(fact.yearsAgo).toBe(66_000_000);
    expect(fact.source).toEqual(SRC);
    const rings = ringsAtStop({ rings: seattleRings(), stop: stopAt(indexOfMa(66)), events: EVENTS, ctx: CTX, founded: FOUNDED, plateFact: fact });
    expect(find(rings, 'plate').facts[0]).toBe(fact);
    expect(find(rings, 'plate').era).toBeUndefined();
    const quiet = ringsAtStop({ rings: seattleRings(), stop: stopAt(indexOfMa(66)), events: EVENTS, ctx: CTX, founded: FOUNDED });
    expect(find(quiet, 'plate').era?.state).toBe('quiet');
  });

  it('never carries the loading story\'s busy flag or note into a stop', () => {
    const base = seattleRings().map((r) => ({ ...r, busy: true, note: 'still gathering' }));
    const rings = ringsAtStop({ rings: base, stop: stopAt(indexOfYear(1889)), events: EVENTS, ctx: CTX, founded: FOUNDED });
    for (const r of rings) {
      if (r.status === 'empty' && r.era === undefined) continue; // the unnamed block and street, untouched
      expect(r.busy).toBeUndefined();
      expect(r.note).toBeUndefined();
    }
  });
});
