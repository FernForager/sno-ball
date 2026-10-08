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
 *      geology map, the plate model, and (in Seattle) the city's open data.
 *      Each answer fills in its ring the moment it arrives; a source that
 *      fails only leaves its ring thin, it never stops the others.
 *   4. The address goes into the URL after a "#", so the story can be
 *      shared. Opening such a link (or reloading, or pressing Back) looks
 *      the typed address up again so every ring gets its real name; in the
 *      same browser that answer comes from the 30-day cache, so the geocoder
 *      is not asked twice. Only when the lookup fails is the story told
 *      from the coordinates alone.
 *
 * Everything here is plain DOM code; the modules under src/lib never touch
 * the page and the modules under src/ui never touch the network.
 */

import type { Fact, GeologyUnit, LngLat, Place, Ring, RingLevel, Source } from './lib/types';
import { RING_ORDER } from './lib/types';
import { maToAgo } from './lib/time';
import { isAbortError } from './lib/http';
import { cacheClear } from './lib/cache';
import { formatLngLat, geocodeWithFallback, parseLngLat } from './lib/geocode';
import { addRingFacts, buildRings, cityName, ringByLevel, setRingFacts, setRingNote, updateRing } from './lib/rings';
import { REGION_BLURB, regionOf } from './data/wa-regions';
import { iceAgeFactFor } from './data/ice-age';
import { countyByName, countyFacts, loadCounties } from './lib/counties';
import { loadPlaces, placeByName, type PlaceRecord } from './lib/places-data';
import { populationHistory, summaryFact, wikidataIdForTitle, wikipediaPage, wikipediaTitleFor } from './lib/places';
import { describeAge, geologyAt } from './lib/geology';
import { describePaleo, paleoPositions } from './lib/paleo';
import { isSeattle, seattleAnnexation, seattleLandmarksNear, seattleNeighborhood, seattleParcel } from './lib/seattle';
import { MapUnavailableError, RING_ZOOM, createStoryMap, type StoryMap } from './lib/map';
import { heroSentence, summariseOutcome } from './ui/format';
import { el } from './ui/ring-card';
import { mountSearch } from './ui/search';
import { RING_EVENT, mountStory } from './ui/story';

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
// The URL hash: #/story?ll=<lat>,<lng>&q=<what was typed>
// ---------------------------------------------------------------------------

interface HashStory {
  point: LngLat;
  query: string;
}

/**
 * The hash for a story, so the page can be shared or reloaded. Written by
 * hand rather than with URLSearchParams so the link stays readable
 * ("ll=47.62051,-122.34928&q=400+Broad+St"); readHash understands both.
 */
function storyHash(point: LngLat, query: string): string {
  const q = encodeURIComponent(query).replace(/%20/g, '+');
  return `#/story?ll=${point.lat.toFixed(5)},${point.lng.toFixed(5)}&q=${q}`;
}

/** Read a story back out of the hash, or null when the hash is not a story link. */
function readHash(hash: string): HashStory | null {
  const m = /^#\/story\?(.*)$/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams(m[1] ?? '');
  const point = parseLngLat(params.get('ll') ?? '');
  if (!point) return null;
  return { point, query: (params.get('q') ?? '').trim() };
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
}

let current: Session | null = null;
let tokenCounter = 0;

/** Is this still the story on screen? */
function live(session: Session): boolean {
  return current === session;
}

/**
 * Replace the rings, re-render, and refresh the hero sentence. The rings
 * that did not change must stay the same objects (the ring helpers see to
 * that), because the page only rebuilds the cards of rings it has not seen.
 */
function setRings(session: Session, rings: Ring[]): void {
  if (!live(session)) return;
  session.rings = rings;
  story.setRings(session.rings);
  story.setHero(heroSentence(session.place, session.rings, session.geology));
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
 * answered: its status then comes from its facts, and a ring left with
 * nothing gets a short note so the card never shows a skeleton forever.
 */
function settleRing(session: Session, level: RingLevel): void {
  const ring = ringByLevel(session.rings, level);
  if (!ring || ring.status !== 'loading') return;
  let rings = setRingFacts(session.rings, level, ring.facts);
  if (ring.facts.length === 0) rings = setRingNote(rings, level, 'Nothing on record for this yet.');
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
 */
async function tellStory(place: Place): Promise<void> {
  const session: Session = {
    token: ++tokenCounter,
    place,
    rings: [],
    geology: undefined,
    pending: new Map(),
  };
  current = session;

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
  story.setStatus('Gathering the story…');
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
      story.setHero(heroSentence(place, session.rings, unit));
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
        if (fact) addFacts(session, 'neighborhood', [fact]);
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
  story.setStatus(status);
  if (status.startsWith('Story ready:')) {
    setTimeout(() => {
      if (live(session)) story.setStatus(null);
    }, READY_STATUS_MS);
  }
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
 * button do). Does nothing when the hash is not a story link or already
 * shows that spot.
 */
async function openFromHash(): Promise<void> {
  const fromHash = readHash(window.location.hash);
  if (!fromHash) return;
  if (current && samePoint(current.place.point, fromHash.point)) return;
  const mine = ++hashCounter;
  search.setQuery(fromHash.query);
  search.setError(null);
  const place = await placeForHash(fromHash);
  if (mine !== hashCounter) return; // the visitor moved on while we looked
  if (current && samePoint(current.place.point, place.point)) return;
  void tellStory(place);
}

window.addEventListener('hashchange', () => {
  void openFromHash();
});
void openFromHash();
