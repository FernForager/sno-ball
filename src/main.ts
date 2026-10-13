/**
 * The page itself: this file wires every module together.
 *
 * In plain words, here is what happens when someone uses the site:
 *
 *   1. The page shows a title, the search box (src/ui/search.ts) and an
 *      empty story area (src/ui/story.ts).
 *   2. The visitor types a Washington address and presses Enter (or taps
 *      an example chip). We ask the geocoder (src/lib/geocode.ts) for the
 *      spot it means. Nothing is looked up while they type.
 *   3. With a spot in hand we build the nine rings (src/lib/rings.ts), show
 *      them as "loading" cards straight away, start the map, and then ask
 *      every data source AT THE SAME TIME: the county file, Wikipedia, the
 *      geology map, the plate model, the bundled timelines, and (in
 *      Seattle) the city's open data. Each answer fills in its ring the
 *      moment it arrives; a source that fails only leaves its ring thin, it
 *      never stops the others.
 *   4. The address goes into the URL after a "#", so the story can be
 *      shared. Opening such a link (or reloading, or pressing Back) looks
 *      the typed address up again so every ring gets its real name; in the
 *      same browser that answer comes from the 30-day cache, so the geocoder
 *      is not asked twice. Only when the lookup fails is the story told
 *      from the coordinates alone.
 *   5. The time dial (src/ui/dial.ts) appears at the foot of the page once
 *      a story is on it. Every turn of the dial re-tells the story for that
 *      stop WITHOUT asking any service again (src/lib/dial-story.ts picks
 *      the events and the "not yet" and "quiet" states from what is already
 *      loaded), changes the map to suit the era (src/lib/map-history.ts:
 *      faded streets, old USGS sheets and OpenHistoricalMap features for
 *      the 1800s and 1900s, water and land only for the centuries before,
 *      the paleo globe for millions of years ago) and writes the stop into
 *      the share link as "&at=1889", so a link opens on the same stop.
 *
 * Everything here is plain DOM code; the modules under src/lib never touch
 * the page and the modules under src/ui never touch the network.
 */

import type { Fact, GeologyUnit, HistoryEvent, LngLat, PaleoPosition, Place, Ring, RingLevel, Source } from './lib/types';
import { RING_ORDER } from './lib/types';
import { maToAgo } from './lib/time';
import { isAbortError } from './lib/http';
import { eventsForSpot, loadEvents, type SpotContext } from './lib/events';
import { FUTURE_MA, NAMED_STOPS, NOW_INDEX, STOPS, decodeAt, encodeAt, gearTint, stopAt, stopYearsAgo, type Stop } from './lib/stops';
import {
  FUTURE_GLOBE_CAPTION,
  NATURE_MAP_NOTE,
  PALEO_MODEL_MAX_MA,
  calendarYearOf,
  countEvents,
  eraStatus,
  globeCaption,
  heroAtStop,
  inceptionYear,
  isIceAgeStop,
  isRockForming,
  noSheetNote,
  paleoFact,
  ringsAtStop,
  todaysMapNote,
  type FoundedYears,
} from './lib/dial-story';
import {
  asHistoryMap,
  attachHistoryLayers,
  baseOpacityFor,
  chooseTopoSheet,
  mapModeFor,
  topoCaption,
  topoSheetsAt,
  type HistoryLayers,
  type MapMode,
  type TopoSheet,
} from './lib/map-history';
import { cacheClear } from './lib/cache';
import { formatLngLat, geocodeWithFallback, parseLngLat } from './lib/geocode';
import { addRingFacts, buildRings, cityName, isRingBusy, markRingBusy, ringByLevel, setRingFacts, setRingNote, updateRing } from './lib/rings';
import { REGION_BLURB, regionOf } from './data/wa-regions';
import { iceAgeFactFor } from './data/ice-age';
import { countyByName, countyFacts, loadCounties } from './lib/counties';
import { loadPlaces, placeByName, type PlaceRecord } from './lib/places-data';
import { populationHistory, summaryFact, wikidataIdForTitle, wikipediaPage, wikipediaTitleFor } from './lib/places';
import { describeAge, geologyAt } from './lib/geology';
import { describePaleo, paleoPositions } from './lib/paleo';
import { isSeattle, seattleAnnexation, seattleLandmarksNear, seattleNeighborhood, seattleParcel } from './lib/seattle';
import { MapUnavailableError, RING_ZOOM, createStoryMap, type StoryMap } from './lib/map';
import { heroSentence, isPlaceholderName, summariseOutcome } from './ui/format';
import { JUMP_EVENT, el } from './ui/ring-card';
import { mountSearch } from './ui/search';
import { RING_EVENT, mountStory } from './ui/story';
import { mountDial, type DialHandle, type DialSource } from './ui/dial';

// ---------------------------------------------------------------------------
// Fixed facts and sources that live in this file
// ---------------------------------------------------------------------------

/** Ready-made searches under the box: one for each corner of the state. */
const EXAMPLES = [
  { label: 'Space Needle', query: '400 Broad St, Seattle, WA' },
  { label: 'Pike Place Market', query: '85 Pike St, Seattle, WA' },
  { label: 'Spokane Riverfront Park', query: '507 N Howard St, Spokane, WA' },
  { label: 'Walla Walla', query: '1 E Main St, Walla Walla, WA' },
  { label: 'Port Townsend', query: '1820 Jefferson St, Port Townsend, WA' },
];

/** The site's own words (region blurbs) carry this source so nothing is unattributed. */
const EDITORIAL_SOURCE: Source = { name: 'Snowball editorial', url: 'https://fernforager.github.io/sno-ball/' };

/** The one fact every state ring gets. */
const STATEHOOD_FACT: Fact = {
  kind: 'founded',
  title: 'Statehood November 11, 1889',
  body: 'Washington became the 42nd state when President Benjamin Harrison signed its statehood proclamation.',
  year: 1889,
  // A page that states the date, not a homepage: the Library of Congress's "Today in History".
  source: { name: 'Library of Congress, Today in History: November 11', url: 'https://www.loc.gov/item/today-in-history/november-11/', license: 'Public record' },
  confidence: 'high',
};

/** Where a Place built from a share link says it came from. */
const SHARE_LINK_SOURCE: Source = { name: 'Snowball share link', url: 'https://fernforager.github.io/sno-ball/' };

/** The message shown when nothing in Washington matches. */
const NOT_FOUND_MESSAGE = "I couldn't find that in Washington. Try adding the city.";

/** What a ring says when a share link could not be looked up and only the coordinates are known. */
const SHARE_LINK_NOTE = 'This link carries only the spot, not its address, so this ring was not looked up. Search the address to fill it in.';

/** How long a clean "Story ready" stays in the status line before it is cleared. */
const READY_STATUS_MS = 6_000;

/** The year the state ring is "founded": statehood. */
const STATEHOOD_YEAR = 1889;

/**
 * Facts arrive in whatever order the services answer, so each ring sorts
 * them by kind for a steady reading order: the Wikipedia excerpt first,
 * then dates, then the rest. Kinds not listed go last, in arrival order.
 */
const FACT_ORDER: readonly string[] = [
  'summary',
  'founded',
  'annexed',
  'year-built',
  'renovated',
  'landmark',
  'use',
  'seat',
  'named-after',
  'population',
  'region-blurb',
  'paleo-position',
];

function sortFacts(facts: readonly Fact[]): Fact[] {
  const rank = (f: Fact): number => {
    const i = FACT_ORDER.indexOf(f.kind);
    return i === -1 ? FACT_ORDER.length : i;
  };
  // Array.prototype.sort is stable, so facts of one kind keep their arrival order.
  return [...facts].sort((a, b) => rank(a) - rank(b));
}

// ---------------------------------------------------------------------------
// The URL hash: #/story?ll=<lat>,<lng>&q=<what was typed>[&at=<dial stop>]
// ---------------------------------------------------------------------------

interface HashStory {
  point: LngLat;
  query: string;
  /** The dial stop the link opens on; absent means Now. */
  at?: Stop;
}

/**
 * The hash for a story, so the page can be shared or reloaded. Written by
 * hand rather than with URLSearchParams so the link stays readable
 * ("ll=47.62051,-122.34928&q=400+Broad+St"); readHash understands both.
 * A dial stop other than Now is added as "&at=1889" (or "20ka", "66Ma",
 * "%2B50Ma" for the future: a bare "+" would read back as a space).
 */
function storyHash(point: LngLat, query: string, stop?: Stop): string {
  const q = encodeURIComponent(query).replace(/%20/g, '+');
  const at = stop && stop.index !== NOW_INDEX ? `&at=${encodeURIComponent(encodeAt(stop))}` : '';
  return `#/story?ll=${point.lat.toFixed(5)},${point.lng.toFixed(5)}&q=${q}${at}`;
}

/** Read a story back out of the hash, or null when the hash is not a story link. */
function readHash(hash: string): HashStory | null {
  const m = /^#\/story\?(.*)$/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams(m[1] ?? '');
  const point = parseLngLat(params.get('ll') ?? '');
  if (!point) return null;
  const at = decodeAt(params.get('at') ?? '');
  return { point, query: (params.get('q') ?? '').trim(), ...(at ? { at } : {}) };
}

/** True when two points round to the same five decimals (about a metre). */
function samePoint(a: LngLat, b: LngLat): boolean {
  return a.lat.toFixed(5) === b.lat.toFixed(5) && a.lng.toFixed(5) === b.lng.toFixed(5);
}

/**
 * A Place for a share link when the address could not be looked up. We only
 * know the coordinates and the original text, so the address parts are
 * empty: the rings that need them (city, county, region) stay unnamed with
 * a note saying why, but the geology, plate history and state facts still
 * work.
 */
function placeFromHash(story: HashStory): Place {
  const displayName = story.query || formatLngLat(story.point);
  return {
    query: story.query,
    point: story.point,
    displayName,
    address: {},
    precise: false,
    source: SHARE_LINK_SOURCE,
  };
}

// ---------------------------------------------------------------------------
// Page skeleton
// ---------------------------------------------------------------------------

const app = document.getElementById('app');
if (!app) throw new Error('#app is missing');

const searchRoot = el('div', { class: 'search-root' });
const storyRoot = el('div', { class: 'story-root' });
app.replaceChildren(
  el('header', { class: 'site-head' }, [
    el('h1', {}, ['Snowball']),
    el('p', { class: 'site-head__tagline muted' }, [
      'Every place in Washington has a story that starts long before the street did. Type an address to read it, ring by ring.',
    ]),
  ]),
  searchRoot,
  storyRoot,
);

const search = mountSearch(searchRoot, {
  examples: EXAMPLES,
  onSubmit: (query) => {
    void runSearch(query);
  },
  // "Forget my searches": empties the 30-day memory of every lookup.
  onForget: () => cacheClear(),
});
const story = mountStory(storyRoot);

// ---------------------------------------------------------------------------
// The map (started lazily, kept for the life of the page)
// ---------------------------------------------------------------------------

let storyMap: StoryMap | null = null;
let mapStart: Promise<StoryMap | null> | null = null;
/** The historical layers on the map (attached once the map exists). */
let historyLayers: HistoryLayers | null = null;

/**
 * Start the map the first time a story is told. MapLibre is large, so it
 * only loads now. If the browser cannot draw it, a one-line note takes the
 * map's place and the story carries on without it.
 */
function ensureMap(): Promise<StoryMap | null> {
  if (!mapStart) {
    mapStart = createStoryMap(story.mapContainer)
      .then((map) => {
        storyMap = map;
        historyLayers = attachHistoryLayers(asHistoryMap(map.map));
        // The USGS sheet to show depends on the zoom (a city needs a
        // coarser sheet than a block), so the choice is made again after
        // every zoom while the historical layers are on.
        map.map.on('zoomend', () => {
          if (current && mapModeFor(currentStop.gear) === 'historical') applyMap(current);
        });
        return map;
      })
      .catch((err: unknown) => {
        console.warn('[map] unavailable:', err);
        // MapUnavailableError's text is written for visitors (no WebGL) and
        // is final. Anything else (a dropped download on a flaky connection)
        // gets a plain line and is tried again on the next story.
        const permanent = err instanceof MapUnavailableError;
        const message = permanent ? err.message : 'The map could not be loaded right now.';
        story.mapContainer.replaceChildren(el('p', { class: 'postcard__note muted' }, [message]));
        if (!permanent) mapStart = null;
        return null;
      });
  }
  return mapStart;
}

// When the visitor's attention moves to another ring, the map zooms to fit it.
storyRoot.addEventListener(RING_EVENT, (event) => {
  const level = (event as CustomEvent<{ level?: RingLevel }>).detail?.level;
  if (level && RING_ORDER.includes(level)) storyMap?.setRingHighlight(level);
});

// A ring card's "jump to 1852" or ◀ ▶ button turns the dial.
storyRoot.addEventListener(JUMP_EVENT, (event) => {
  const index = (event as CustomEvent<{ index?: number }>).detail?.index;
  if (typeof index === 'number' && Number.isInteger(index) && dial) dial.setIndex(index);
});

// ---------------------------------------------------------------------------
// The time dial (mounted once, the first time a story is told)
// ---------------------------------------------------------------------------

let dial: DialHandle | null = null;

/** The stop the dial sits on. Index 1 is Now; the page starts there. */
let currentStop: Stop = stopAt(NOW_INDEX);

/** Whether the historical map layers are on at the "years" and "decades" stops; the postcard button flips it. */
let historicalOn = true;

/**
 * Mount the dial at the foot of the page, or move the existing one to
 * `index` without telling the page (the caller re-tells the story itself).
 * The first mount calls back once with source 'init', which re-tells the
 * current story for that stop.
 */
function ensureDial(index: number): void {
  if (dial) {
    if (dial.getIndex() !== index) {
      dial.setIndex(index, true);
      currentStop = stopAt(index);
    }
    return;
  }
  const root = el('div', { class: 'dial-root' });
  document.body.append(root);
  dial = mountDial(root, {
    stops: STOPS,
    namedStops: NAMED_STOPS,
    gearTint,
    // "1889", "15,000 BCE", "17,000 years ago", "16 Ma": decodeAt reads
    // everything encodeAt writes and everything parseTime understands.
    parseAt: (text) => decodeAt(text),
    initialIndex: index,
    onChange: (stop, source) => {
      currentStop = stopAt(stop.index);
      onStopChange(source);
    },
  });
}

/** The dial moved: keep the link in step, re-tell the story and redraw the map. */
function onStopChange(source: DialSource): void {
  const session = current;
  if (!session) return;
  // A link's own stop is already in the URL; every later move is written
  // in place, so the Back button steps between stories, not between stops.
  if (source !== 'init') {
    history.replaceState(null, '', storyHash(session.place.point, session.place.query, currentStop));
  }
  renderStop(session);
  applyMap(session);
}

/** Move the dial to a stop from a link (silently) and re-tell the story for it. */
function syncDial(session: Session, index: number): void {
  if (!dial || dial.getIndex() === index) return;
  dial.setIndex(index, true);
  currentStop = stopAt(index);
  renderStop(session);
  applyMap(session);
}

// ---------------------------------------------------------------------------
// One story at a time
// ---------------------------------------------------------------------------

/**
 * Everything about the story currently on screen. A new search makes a new
 * one; answers that belong to an older story are dropped on arrival (each
 * loader checks `token`), so typing a second address while the first is
 * still loading never mixes the two.
 */
interface Session {
  token: number;
  place: Place;
  rings: Ring[];
  /** The rock unit once it arrives (null = none found), for the hero sentence. */
  geology: GeologyUnit | null | undefined;
  /** How many loaders still owe each ring an answer. */
  pending: Map<RingLevel, number>;
  /** The present-day status line (the dial shows its own at other stops). */
  status: string | null;
  /** The founding year of each ring the loaders have learned it for. */
  founded: FoundedYears;
  /** The timeline events that apply to this spot, once the bundled files are read. */
  events: HistoryEvent[];
  /** The USGS sheets covering the spot, asked for once per story. */
  topoSheets: Promise<TopoSheet[]> | null;
  /** Where the spot sat at each globe stop (keyed by Ma) once the plate model has answered; null when it had no answer. */
  paleo: Map<number, PaleoPosition | null>;
  /** The globe stops (Ma) whose answer is still on its way. */
  paleoPending: Set<number>;
}

let current: Session | null = null;
let tokenCounter = 0;

/** Is this still the story on screen? */
function live(session: Session): boolean {
  return current === session;
}

/**
 * Replace the rings, re-render, and refresh the hero sentence. Each ring's
 * `busy` flag is set here from how many loaders still owe it an answer, so
 * a card with facts stays aria-busy until its last source has spoken. The
 * rings that did not change must stay the same objects (the ring helpers
 * and markRingBusy see to that), because the page only rebuilds the cards
 * of rings it has not seen.
 */
function setRings(session: Session, rings: Ring[]): void {
  if (!live(session)) return;
  session.rings = rings.map((ring) => markRingBusy(ring, isRingBusy(ring.status, session.pending.get(ring.level) ?? 0)));
  renderStop(session);
}

/** The present-day status line; what the visitor sees depends on the dial's stop. */
function setStoryStatus(session: Session, text: string | null): void {
  if (!live(session)) return;
  session.status = text;
  renderStatus(session);
}

function renderStatus(session: Session): void {
  if (currentStop.index === NOW_INDEX) {
    story.setStatus(session.status);
  } else {
    story.setStatus(eraStatus(currentStop, countEvents(ringsForStop(session))));
  }
}

/**
 * What the page knows about the spot, for the timelines: the names from
 * the rings (which may be better than the geocoder's), the region, the
 * rock, and the years the city and the neighborhood were founded.
 */
function spotContext(session: Session): SpotContext {
  const { place, rings } = session;
  const name = (level: RingLevel): string | undefined => {
    const n = ringByLevel(rings, level)?.name.trim();
    return n && !isPlaceholderName(n) ? n : undefined;
  };
  const county = name('county') ?? place.address.county?.trim() ?? undefined;
  const city = name('city') ?? cityName(place.address);
  const neighborhood = name('neighborhood');
  const region = county ? regionOf(county) : undefined;
  return {
    point: place.point,
    placeName: name('house') ?? 'your spot',
    ...(region ? { region } : {}),
    ...(county ? { county } : {}),
    ...(city ? { city } : {}),
    ...(neighborhood ? { neighborhood } : {}),
    ...(session.geology !== undefined ? { geology: session.geology } : {}),
    ...(session.founded.neighborhood !== undefined ? { annexYear: session.founded.neighborhood } : {}),
    ...(session.founded.city !== undefined ? { incYear: session.founded.city } : {}),
  };
}

/** The rings as they read at the dial's stop (the loaded rings themselves at Now). */
function ringsForStop(session: Session): Ring[] {
  if (currentStop.index === NOW_INDEX) return session.rings;
  const ma = globeMa(currentStop);
  const pos = ma === undefined ? undefined : session.paleo.get(ma);
  const plateFact = pos ? paleoFact(pos, session.place.point) : undefined;
  return ringsAtStop({
    rings: session.rings,
    stop: currentStop,
    events: session.events,
    ctx: spotContext(session),
    founded: session.founded,
    ...(plateFact ? { plateFact } : {}),
  });
}

/**
 * Show the story for the dial's stop: the rings, the hero sentence (with
 * the readout in front when not at Now), the status line, and the
 * deep-time cards lit when their story is happening at that stop.
 */
function renderStop(session: Session): void {
  if (!live(session)) return;
  story.setRings(ringsForStop(session));
  story.setHero(heroAtStop(currentStop, heroSentence(session.place, session.rings, session.geology)));
  story.setDeepHighlights({ rock: isRockForming(session.geology, currentStop), ice: isIceAgeStop(currentStop) });
  renderStatus(session);
}

/** A ring's founding year has been learned: remember it and re-tell. */
function setFounded(session: Session, level: keyof FoundedYears, year: number | undefined): void {
  if (!live(session) || year === undefined) return;
  session.founded[level] = year;
  renderStop(session);
}

/** Add facts to a ring (the common case as answers arrive), keeping its facts in reading order. */
function addFacts(session: Session, level: RingLevel, facts: Fact[]): void {
  if (facts.length === 0) return;
  const added = addRingFacts(session.rings, level, facts);
  setRings(
    session,
    updateRing(added, level, (r) => ({ ...r, facts: sortFacts(r.facts) })),
  );
}

/**
 * A ring is finished when every loader that promised it something has
 * answered: its status then comes from its facts (final from here on), a
 * ring left with nothing gets a short note so the card never shows a
 * skeleton forever, and the re-render clears its busy flag now that no
 * loader is pending for it.
 */
function settleRing(session: Session, level: RingLevel): void {
  const ring = ringByLevel(session.rings, level);
  if (!ring) return;
  let rings = session.rings;
  if (ring.status === 'loading') {
    rings = setRingFacts(rings, level, ring.facts);
    if (ring.facts.length === 0) rings = setRingNote(rings, level, 'Nothing on record for this yet.');
  }
  setRings(session, rings);
}

/**
 * Run one loader and tie its outcome to the rings it feeds. The loader's
 * own `apply` step runs only while the story is still current. The promise
 * never rejects: it resolves, once the rings the loader fed have been
 * settled with whatever they have, with the names of the sources that did
 * not answer (the loader's own name when it threw, or the list a loader
 * that asks several sources returns; empty when all went well). The status
 * line is built from these lists, so it can only be written after every
 * ring has settled.
 */
function track(session: Session, name: string, levels: readonly RingLevel[], work: () => Promise<void | string[]>): Promise<string[]> {
  for (const level of levels) session.pending.set(level, (session.pending.get(level) ?? 0) + 1);
  return work()
    .then(
      (failed) => failed ?? [],
      (err: unknown) => {
        if (!live(session) || isAbortError(err)) return [];
        console.warn(`[story] ${name} did not answer:`, err);
        return [name];
      },
    )
    .finally(() => {
      if (!live(session)) return;
      for (const level of levels) {
        const left = (session.pending.get(level) ?? 1) - 1;
        session.pending.set(level, left);
        if (left <= 0) settleRing(session, level);
      }
    });
}

/**
 * Tell the story of a place. Builds the rings, shows them loading, starts
 * the map, and then asks every data source at once. Resolves when all of
 * them have answered (or failed). Only one story is current at a time.
 * `atIndex` is the dial stop to open on (Now unless a link says otherwise).
 */
async function tellStory(place: Place, atIndex = NOW_INDEX): Promise<void> {
  const session: Session = {
    token: ++tokenCounter,
    place,
    rings: [],
    geology: undefined,
    pending: new Map(),
    status: null,
    founded: { state: STATEHOOD_YEAR },
    events: [],
    topoSheets: null,
    paleo: new Map(),
    paleoPending: new Set(),
  };
  current = session;
  // The historical layers start on for every new story.
  historicalOn = true;

  // --- The rings, named from the address --------------------------------
  let rings = buildRings(place);
  // Photon says "King" where Nominatim says "King County"; show the full form.
  const county = ringByLevel(rings, 'county');
  if (county && county.status !== 'empty' && !/\bcounty$/i.test(county.name)) {
    rings = updateRing(rings, 'county', (r) => ({ ...r, name: `${r.name} County` }));
  }
  // A share link whose address could not be looked up: say so plainly
  // instead of "not inside a city", which would be a false statement.
  if (place.source === SHARE_LINK_SOURCE) {
    for (const ring of rings) {
      if (ring.status === 'empty' && ring.level !== 'state' && ring.level !== 'plate') {
        rings = setRingNote(rings, ring.level, SHARE_LINK_NOTE);
      }
    }
  }
  story.clear();
  story.setPlace(place);
  // The dial is mounted (or moved to the link's stop) before the first
  // render, so the story is told for the right stop from the start.
  ensureDial(atIndex);
  setStoryStatus(session, 'Gathering the story…');
  setRings(session, rings);

  // --- Facts we already know, no request needed --------------------------
  addFacts(session, 'state', [STATEHOOD_FACT]);
  const region = place.address.county ? regionOf(place.address.county) : undefined;
  if (region) {
    addFacts(session, 'region', [
      { kind: 'region-blurb', title: `The ${region}`, body: REGION_BLURB[region], source: EDITORIAL_SOURCE, confidence: 'high' },
    ]);
  }
  const ice = iceAgeFactFor(region, cityName(place.address));
  story.setIceAge(ice ? { title: ice.title, body: ice.body, source: ice.source } : undefined);

  // --- The map ------------------------------------------------------------
  void ensureMap().then((map) => {
    if (!live(session) || !map) return;
    // A match on a whole street or town is shown from further out than one lot.
    map.showPlace(place.point, { label: place.displayName, ...(place.precise ? {} : { zoom: RING_ZOOM.neighborhood }) });
    applyMap(session);
  });

  // --- Every data source, all at once --------------------------------------
  const inSeattle = isSeattle(place);
  const neighborhoodLookup = inSeattle ? seattleNeighborhood(place.point) : Promise.resolve(null);

  const tasks: Promise<string[]>[] = [
    // The county file is part of the site, so this is quick.
    track(session, 'county records', ['county'], async () => {
      const name = place.address.county;
      if (!name) return;
      const record = countyByName(await loadCounties(), name);
      if (!record || !live(session)) return;
      setRings(
        session,
        updateRing(session.rings, 'county', (r) => ({
          ...r,
          wikidata: record.qid,
          ...(record.wikipedia ? { wikipedia: record.wikipedia } : {}),
        })),
      );
      addFacts(session, 'county', countyFacts(record));
      setFounded(session, 'county', inceptionYear(record.inception));
    }),

    // The bundled timelines (part of the site, so this is quick): the
    // events that apply to this spot, for the dial. They feed no ring at
    // Now, so nothing waits on them; at any other stop they are the story.
    track(session, 'timelines', [], async () => {
      const all = await loadEvents();
      if (!live(session)) return;
      session.events = eventsForSpot(all, spotContext(session));
      renderStop(session);
    }),

    // Wikipedia, one article after another (Wikimedia asks us not to burst;
    // titles in the pre-baked file cost no request at all), then the city's
    // population history last, because it is the least essential and the
    // most likely to be rate-limited. Each article that fails is named in
    // the list this loader resolves with; the others still land.
    track(session, 'Wikipedia', ['state', 'county', 'city', 'neighborhood'], async () => {
      const failed: string[] = [];
      // The city's Wikidata id and article title come from the site's own
      // place file first, so the population facts never depend on a
      // Wikipedia lookup that may be rate-limited, and the city's excerpt
      // is asked for under its real article title ("Seattle", not
      // "Seattle, Washington"), which is how the pre-baked file keys it.
      const cityRecord = await cityFromFile(place);
      let cityQid = cityRecord?.qid;
      if (!live(session)) return failed;
      if (cityRecord) {
        setRings(
          session,
          updateRing(session.rings, 'city', (r) => ({
            ...r,
            wikidata: cityRecord.qid,
            ...(cityRecord.wikipedia ? { wikipedia: cityRecord.wikipedia } : {}),
          })),
        );
        setFounded(session, 'city', inceptionYear(cityRecord.inception));
      }
      for (const level of ['state', 'county', 'city', 'neighborhood'] as const) {
        if (level === 'neighborhood') {
          // In Seattle the city's own atlas may have renamed this ring; wait for it.
          await neighborhoodLookup.catch(() => null);
        }
        if (!live(session)) return failed;
        const ring = ringByLevel(session.rings, level);
        const title = ring ? wikipediaTitleFor(level, ring, place) : undefined;
        if (!title) continue;
        try {
          const page = await wikipediaPage(title);
          if (!live(session)) return failed;
          if (!page) continue;
          if (level === 'city' && !cityQid) cityQid = page.wikidata;
          setRings(session, updateRing(session.rings, level, (r) => ({ ...r, wikipedia: page.title, ...(page.wikidata ? { wikidata: page.wikidata } : {}) })));
          addFacts(session, level, [summaryFact(page)]);
        } catch (err) {
          if (isAbortError(err)) return failed;
          console.warn(`[story] Wikipedia summary for "${title}" did not answer:`, err);
          failed.push(`Wikipedia (${title})`);
        }
      }
      // Population history runs whether or not the city's excerpt arrived.
      // Only a city the place file does not know, whose summary gave no id
      // either, costs one more Wikipedia request to find its id.
      const cityRing = ringByLevel(session.rings, 'city');
      const cityTitle = cityRing ? wikipediaTitleFor('city', cityRing, place) : undefined;
      if (!cityQid && cityTitle && live(session)) {
        try {
          cityQid = await wikidataIdForTitle(cityTitle);
        } catch (err) {
          if (isAbortError(err)) return failed;
          console.warn(`[story] Wikidata id for "${cityTitle}" did not answer:`, err);
        }
      }
      if (cityQid && live(session)) {
        try {
          addFacts(session, 'city', await populationHistory(cityQid));
        } catch (err) {
          // Population history is a bonus: a failure here is quietly noted.
          if (!isAbortError(err)) console.warn('[story] population history did not answer:', err);
        }
      }
      return failed;
    }),

    // The rock under the spot. The card feeds no ring, so a failure must be
    // shown here or the card would shimmer forever.
    track(session, 'geology', [], async () => {
      let unit: GeologyUnit | null;
      try {
        unit = await geologyAt(place.point);
      } catch (err) {
        if (live(session) && !isAbortError(err)) {
          story.setGeologyUnavailable('The geological map did not answer. Try again in a moment.');
        }
        throw err;
      }
      if (!live(session)) return;
      session.geology = unit;
      story.setGeology(unit, unit ? describeAge(unit) : undefined);
      renderStop(session);
    }),

    // Where the spot sat on the globe, millions of years ago. The full list
    // goes in the deep-time card; the plate ring gets one summary so the
    // same six sentences are not printed twice.
    track(session, 'plate model', ['plate'], async () => {
      const positions = await paleoPositions(place.point);
      if (!live(session)) return;
      story.setPaleo(positions.map((pos) => ({ text: describePaleo(pos, place.point), source: pos.source })));
      const oldest = [...positions].sort((a, b) => b.ma - a.ma)[0];
      if (!oldest) return;
      addFacts(session, 'plate', [
        {
          kind: 'paleo-position',
          title: 'Carried here on the North American Plate',
          body: `${describePaleo(oldest, place.point)} Every stop on the way is listed under "Where this spot has been" below.`,
          yearsAgo: maToAgo(oldest.ma),
          source: oldest.source,
          confidence: 'medium',
        },
      ]);
    }),
  ];

  // --- Seattle extras -------------------------------------------------------
  if (inSeattle) {
    tasks.push(
      track(session, 'Seattle neighborhood atlas', ['neighborhood'], async () => {
        const hood = await neighborhoodLookup;
        if (!hood || !live(session)) return;
        setRings(
          session,
          updateRing(session.rings, 'neighborhood', (r) => {
            const { note: _note, ...rest } = r;
            return {
              ...rest,
              name: hood.neighborhood,
              altNames: [hood.district, ...hood.altNames].filter((n) => n !== hood.neighborhood),
              // The atlas name is what Wikipedia calls the neighborhood too.
              wikipedia: `${hood.neighborhood}, Seattle`,
              status: r.status === 'empty' ? 'loading' : r.status,
            };
          }),
        );
      }),
      track(session, 'Seattle annexation history', ['neighborhood'], async () => {
        const fact = await seattleAnnexation(place.point);
        if (!fact) return;
        addFacts(session, 'neighborhood', [fact]);
        setFounded(session, 'neighborhood', fact.year);
      }),
      track(session, 'Seattle landmarks', ['block'], async () => {
        addFacts(session, 'block', await seattleLandmarksNear(place.point));
      }),
    );
    // The parcel only means something when the geocoder found one building.
    if (place.precise) {
      tasks.push(
        track(session, 'King County parcel', ['house'], async () => {
          addFacts(session, 'house', await seattleParcel(place.point));
        }),
      );
    }
  }

  // Rings no loader will feed (the street, for now) are settled at once.
  for (const level of RING_ORDER) {
    if (!session.pending.has(level)) settleRing(session, level);
  }
  // Every loader is now registered, so the busy flags can be set right:
  // the state ring, for example, got its statehood fact before the
  // Wikipedia loader (which still owes it an excerpt) was counted.
  setRings(session, session.rings);

  // The final status is written exactly once, after EVERY loader has
  // settled its rings (track() settles them before resolving), so it can
  // never say "Gathering" over a finished story or "ready" over a card that
  // is still loading. The live region tells screen readers what the story
  // says; a clean finish is cleared again after a few seconds, a partial
  // one stays as a note. The clearing timer can only run after this line
  // and only while this story is still on screen.
  const results = await Promise.allSettled(tasks);
  if (!live(session)) return;
  const status = summariseOutcome(results, heroSentence(place, session.rings, session.geology));
  setStoryStatus(session, status);
  if (status.startsWith('Story ready:')) {
    setTimeout(() => {
      if (live(session)) setStoryStatus(session, null);
    }, READY_STATUS_MS);
  }
}

// ---------------------------------------------------------------------------
// The map at each stop of the dial
// ---------------------------------------------------------------------------

/** Millions of years ago for a globe stop (the future stop counts as its own number); undefined elsewhere. */
function globeMa(stop: Stop): number | undefined {
  const mode = mapModeFor(stop.gear);
  if (mode === 'future') return -FUTURE_MA;
  if (mode !== 'globe') return undefined;
  return stopYearsAgo(stop) / 1_000_000;
}

/** Counts map updates, so a slow answer (the sheet catalog, the plate model) never paints an older stop. */
let mapApplyCounter = 0;

/**
 * Draw the map (or the globe) the dial's stop calls for, following the
 * gear-to-mode table in map-history.ts: today's map as it is; for the
 * 1800s and 1900s today's streets faded, OpenHistoricalMap's features of
 * that year and the nearest USGS sheet; water and land only for the
 * centuries, millennia and ice ages; the paleo globe for millions of years
 * ago and the future sketch. Safe to call before the map exists (nothing
 * happens) or before its style has loaded (it runs once it has).
 */
function applyMap(session: Session): void {
  if (!live(session)) return;
  const mine = ++mapApplyCounter;
  const stop = currentStop;
  const mode: MapMode = mapModeFor(stop.gear);
  story.setMapMode(mode);

  if (mode === 'globe' || mode === 'future') {
    showGlobe(session, stop, mine);
  } else {
    story.setGlobe(null);
  }

  const map = storyMap;
  const layers = historyLayers;
  if (!map || !layers) return;
  const run = (): void => {
    if (mine !== mapApplyCounter || !live(session)) return;
    try {
      applyLayers(session, stop, mode, layers, map, mine);
    } catch (err) {
      console.warn('[map] the historical layers could not be drawn:', err);
    }
  };
  if (map.map.isStyleLoaded()) run();
  else map.map.once('load', run);
}

/** The layer changes for a mode on a map whose style has loaded. */
function applyLayers(session: Session, stop: Stop, mode: MapMode, layers: HistoryLayers, map: StoryMap, mine: number): void {
  const fresh = (): boolean => mine === mapApplyCounter && live(session);
  switch (mode) {
    case 'today':
      layers.setGhost(false);
      layers.setBaseOpacity(1);
      layers.hideTopo();
      layers.setOhmDate(null);
      story.setMapNote(null);
      return;
    case 'nature':
      layers.setOhmDate(null);
      layers.hideTopo();
      layers.setBaseOpacity(1);
      layers.setGhost(true);
      story.setMapNote(NATURE_MAP_NOTE);
      return;
    case 'globe':
    case 'future':
      // The map is hidden under the globe; take its historical layers away
      // so nothing is fetched for a map nobody can see.
      layers.setOhmDate(null);
      layers.hideTopo();
      return;
    case 'historical':
      break;
  }

  const year = calendarYearOf(stop);
  if (year === undefined) return;
  layers.setGhost(false);
  const toggle = { label: historicalOn ? "Today's map" : 'Map as it was', onClick: toggleHistorical };
  if (!historicalOn) {
    layers.setBaseOpacity(1);
    layers.hideTopo();
    layers.setOhmDate(null);
    story.setMapNote(todaysMapNote(year), toggle);
    return;
  }
  layers.setBaseOpacity(baseOpacityFor(year));
  layers.setOhmDate(year);
  story.setMapNote(`Looking for a map of ${year}…`, toggle);
  // One catalog request per story (cached 30 days per 1 km cell inside).
  session.topoSheets ??= topoSheetsAt(session.place.point).catch((err: unknown) => {
    if (!isAbortError(err)) console.warn('[map] the USGS sheet catalog did not answer:', err);
    return [];
  });
  void session.topoSheets.then((sheets) => {
    if (!fresh()) return;
    const sheet = chooseTopoSheet(sheets, year, map.map.getZoom());
    if (sheet) {
      layers.showTopo(sheet);
      story.setMapNote(topoCaption(sheet), toggle);
    } else {
      layers.hideTopo();
      story.setMapNote(noSheetNote(year), toggle);
    }
  });
}

/** The postcard button: swap the historical layers for today's map and back. */
function toggleHistorical(): void {
  historicalOn = !historicalOn;
  if (current) applyMap(current);
}

/**
 * The globe for a deep-time stop: today's point and, once the plate model
 * has answered for that many million years ago, the reconstructed one
 * (the plate ring gets the same answer as a fact). Beyond the model's
 * reach the caption says so and nothing is asked; the future stop is a
 * sketch of the trend, not a model. The model is asked once per stop and
 * story; its answer is also cached for 30 days by paleo.ts.
 */
function showGlobe(session: Session, stop: Stop, mine: number): void {
  const todayPoint = session.place.point;
  const ma = globeMa(stop);
  if (ma === undefined) return;
  if (ma < 0) {
    story.setGlobe({ todayPoint, ma: -ma, caption: FUTURE_GLOBE_CAPTION, sketch: true });
    return;
  }
  if (ma > PALEO_MODEL_MAX_MA) {
    story.setGlobe({ todayPoint, ma, paleoPoint: null, caption: globeCaption(ma, 'none') });
    return;
  }
  if (session.paleo.has(ma)) {
    const point = session.paleo.get(ma)?.point ?? null;
    story.setGlobe({ todayPoint, ma, paleoPoint: point, caption: globeCaption(ma, point ? 'position' : 'none') });
    return;
  }
  story.setGlobe({ todayPoint, ma, caption: globeCaption(ma, 'pending') });
  if (session.paleoPending.has(ma)) return;
  session.paleoPending.add(ma);
  void paleoPositions(todayPoint, [ma]).then((positions) => {
    if (!live(session)) return;
    session.paleoPending.delete(ma);
    const pos = positions[0] ?? null;
    session.paleo.set(ma, pos);
    if (pos) renderStop(session);
    if (mine !== mapApplyCounter || currentStop !== stop) return;
    story.setGlobe({ todayPoint, ma, paleoPoint: pos?.point ?? null, caption: globeCaption(ma, pos ? 'position' : 'none') });
  });
}

/**
 * The place's city as public/data/wa-places.json records it (matched by
 * name, ignoring case, preferring the entry in the same county), or
 * undefined when the address names no city, the file does not list it, or
 * the file could not be loaded (a warning, never a failure: the Wikipedia
 * summary may still carry the id).
 */
async function cityFromFile(place: Place): Promise<PlaceRecord | undefined> {
  const name = cityName(place.address);
  if (!name) return undefined;
  try {
    return placeByName(await loadPlaces(), name, place.address.county);
  } catch (err) {
    if (!isAbortError(err)) console.warn('[story] the place file did not load:', err);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/** Counts searches, so a slow geocode cannot clobber a newer one. */
let searchCounter = 0;

/**
 * Geocode what the visitor typed, then tell the story of the best match.
 * The box is busy only while the geocoder works; the story then fills in
 * on its own, card by card, with the box free for the next search.
 */
async function runSearch(query: string): Promise<void> {
  const mine = ++searchCounter;
  search.setBusy(true);
  search.setError(null);
  story.setStatus('Finding that address…');
  try {
    const places = await geocodeWithFallback(query);
    if (mine !== searchCounter) return; // a newer search has started
    if (places.length === 0) {
      story.setStatus(null);
      search.setError(NOT_FOUND_MESSAGE);
      return;
    }
    // A named building beats a street or a town; otherwise trust the first.
    const place = places.find((p) => p.precise) ?? places[0];
    if (!place) return;
    // A new search starts at Now; the dial's stop is not carried over.
    const hash = storyHash(place.point, query);
    if (window.location.hash !== hash) window.location.hash = hash;
    void tellStory(place);
  } catch (err) {
    if (isAbortError(err)) return;
    console.warn('[search] geocoding failed:', err);
    story.setStatus(null);
    search.setError('The address lookup is not answering right now. Please try again in a moment.');
  } finally {
    if (mine === searchCounter) search.setBusy(false);
  }
}

/**
 * The Place a share link means. The link carries the typed address and the
 * spot, so the address is looked up again (one cached geocoder answer in the
 * same browser, one request in a new one, the same as typing it) and the
 * result at that exact spot is chosen, or the nearest one. When the lookup
 * fails or the link has no address, the story is told from the coordinates.
 */
async function placeForHash(fromHash: HashStory): Promise<Place> {
  if (!fromHash.query) return placeFromHash(fromHash);
  search.setBusy(true);
  story.setStatus('Finding that address…');
  try {
    const places = await geocodeWithFallback(fromHash.query);
    const exact = places.find((p) => samePoint(p.point, fromHash.point));
    if (exact) return exact;
    const nearest = [...places].sort((a, b) => degreesApart(a.point, fromHash.point) - degreesApart(b.point, fromHash.point))[0];
    return nearest ?? placeFromHash(fromHash);
  } catch (err) {
    if (!isAbortError(err)) console.warn('[search] could not look the share link up again:', err);
    return placeFromHash(fromHash);
  } finally {
    search.setBusy(false);
  }
}

/** A rough closeness measure (squared degrees) for picking the nearest geocoder result. */
function degreesApart(a: LngLat, b: LngLat): number {
  return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
}

/** Counts link openings, so a slow lookup cannot clobber a newer one. */
let hashCounter = 0;

/**
 * Open the story a share link points to (also what a reload and the Back
 * button do). Does nothing when the hash is not a story link; when it
 * already shows that spot, only the dial is moved to the link's stop.
 */
async function openFromHash(): Promise<void> {
  const fromHash = readHash(window.location.hash);
  if (!fromHash) return;
  const atIndex = fromHash.at?.index ?? NOW_INDEX;
  if (current && samePoint(current.place.point, fromHash.point)) {
    syncDial(current, atIndex);
    return;
  }
  const mine = ++hashCounter;
  search.setQuery(fromHash.query);
  search.setError(null);
  const place = await placeForHash(fromHash);
  if (mine !== hashCounter) return; // the visitor moved on while we looked
  if (current && samePoint(current.place.point, place.point)) {
    syncDial(current, atIndex);
    return;
  }
  void tellStory(place, atIndex);
}

window.addEventListener('hashchange', () => {
  void openFromHash();
});
void openFromHash();
