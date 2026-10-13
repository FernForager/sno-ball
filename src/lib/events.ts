/**
 * The bundled timelines: what happened here, and when.
 *
 * Two pre-baked files in public/data/events/ (built from
 * docs/research/timelines/ by a small script; see the README beside them)
 * hold every dated event the site can tell: deep-time.json for the geology
 * (36 events, Precambrian to a 50-million-year projection) and
 * human-history.json for people (115 events, the first known presence to
 * today). Both use the snake_case EventRecord shape of Plan v2 section 6.
 *
 * This module
 *  - loads the files once per visit (loadEvents) and maps records to the
 *    site's HistoryEvent shape (toHistoryEvent);
 *  - picks the events that apply to a spot (eventsForSpot) and to a stop on
 *    the time dial (eventsAtWindow);
 *  - says which ring an event belongs in (ringFor);
 *  - turns an event's "at your spot" template into a sentence about the
 *    visitor's own address (renderTemplate, storyLine), but only when the
 *    rock under the spot agrees (spotRulePasses): the Missoula-flood line is
 *    not shown for a house on bedrock that the floods never touched.
 *
 * Years are "years before 2000 CE" throughout, the convention of the data
 * files and of time.ts; negative values are after 2000. An end of 0 means
 * "continuing" (still true today). Calendar years appear only where a
 * placeholder needs one, converted with time.ts at that edge.
 */

import { fetchJson } from './http';
import { fromYearsAgo } from './time';
import { regionOf, normaliseCountyName } from '../data/wa-regions';
import { RING_ORDER, type GeologyUnit, type HistoryEvent, type LngLat, type RingLevel, type WaRegion } from './types';

// ---------------------------------------------------------------------------
// The data file shape
// ---------------------------------------------------------------------------

/** Which bundled file an event came from. Decides the rings it may appear in. */
export type EventKind = 'deep' | 'human';

/** A gate on the second-person line: what the ground (or the city's records) must say for it to be true. */
export type SpotRule =
  | 'flood-deposits'
  | 'vashon-ice'
  | 'osceola-lahar'
  | 'electron-lahar'
  | 'crbg'
  | 'seattle-fault-near'
  | 'annexed-in-range'
  | 'incorporated-in-range';

export const SPOT_RULES: readonly SpotRule[] = [
  'flood-deposits',
  'vashon-ice',
  'osceola-lahar',
  'electron-lahar',
  'crbg',
  'seattle-fault-near',
  'annexed-in-range',
  'incorporated-in-range',
];

/** One event as stored in public/data/events/*.json (Plan v2 section 6). */
export interface EventRecord {
  /** Slug, stable across rebuilds, unique across both files. */
  id: string;
  kind: EventKind;
  title: string;
  /** Human readable, e.g. "about 17,000 years ago", "November 11, 1889". */
  when: string;
  /** Years before 2000 CE; negative = after 2000 (or in the future). */
  start_years_ago: number;
  /** Same convention; equals start for a moment; 0 = continuing. */
  end_years_ago: number;
  /** Scope tokens: "statewide", a WaRegion name, "<Name> County", or a city name. */
  region: string[];
  /** Anchor point for {distance}; null when there is no single place. */
  lat: number | null;
  lon: number | null;
  /** The project's own words (facts), never copied prose. */
  summary: string;
  /** Sentence template about the visitor's spot; null when the event has none. */
  at_your_spot: string | null;
  spot_rule?: SpotRule;
  sources: { title: string; url: string }[];
  confidence: 'high' | 'medium' | 'low';
}

/** The shape of each bundled file: a header and the records. */
export interface EventFile {
  v: number;
  kind: EventKind;
  events: EventRecord[];
}

/**
 * A HistoryEvent that remembers what the record knew: its kind, the full
 * list of scope tokens (HistoryEvent.region holds them joined with ", "),
 * and the spot rule. Everything in this module accepts a plain
 * HistoryEvent too, treating it as a human event scoped by its region string.
 */
export interface SpotEvent extends HistoryEvent {
  kind: EventKind;
  regions: string[];
  spotRule?: SpotRule;
}

/** Map a stored record to the site's HistoryEvent shape (a SpotEvent). */
export function toHistoryEvent(r: EventRecord): SpotEvent {
  const regions = r.region.map((t) => t.trim()).filter((t) => t.length > 0);
  const event: SpotEvent = {
    id: r.id,
    kind: r.kind,
    title: r.title,
    when: r.when,
    startYearsAgo: r.start_years_ago,
    endYearsAgo: r.end_years_ago,
    region: regions.join(', '),
    regions,
    summary: r.summary,
    sources: r.sources.map((s) => ({ name: s.title, url: s.url })),
    confidence: r.confidence,
  };
  if (r.lat !== null && r.lon !== null) event.point = { lng: r.lon, lat: r.lat };
  if (r.at_your_spot !== null && r.at_your_spot !== '') event.atYourSpot = r.at_your_spot;
  if (r.spot_rule !== undefined) event.spotRule = r.spot_rule;
  return event;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** The bundled files, relative to the site's base URL, with the kind each one holds. */
export const EVENT_FILES: readonly { file: string; kind: EventKind }[] = [
  { file: 'data/events/deep-time.json', kind: 'deep' },
  { file: 'data/events/human-history.json', kind: 'human' },
];

/** The full URL of one bundled file for this deployment (the site is served under /sno-ball/). */
export function eventsUrl(file: string): string {
  const base = import.meta.env.BASE_URL;
  return (base.endsWith('/') ? base : `${base}/`) + file;
}

let eventsPromise: Promise<HistoryEvent[]> | undefined;

/**
 * Every event from both files, oldest first within each file, deep time
 * before human history. Fetched at most once per visit. If one file fails
 * to load or is malformed, a warning goes to the console and the other
 * file's events are still returned; a failure does not poison later calls,
 * because the result is cached only as the (possibly partial) list.
 */
export function loadEvents(): Promise<HistoryEvent[]> {
  if (!eventsPromise) {
    eventsPromise = Promise.all(
      EVENT_FILES.map(async ({ file, kind }) => {
        const url = eventsUrl(file);
        try {
          return parseEventFile(await fetchJson<unknown>(url), kind).map(toHistoryEvent);
        } catch (err) {
          console.warn(`Could not load the ${kind} timeline from ${url}: ${String(err)}`);
          return [];
        }
      }),
    ).then((lists) => lists.flat());
  }
  return eventsPromise;
}

/** Forget the loaded events so the next loadEvents() fetches again (tests). */
export function resetEvents(): void {
  eventsPromise = undefined;
}

/**
 * Check one bundled file and return its records. Accepts either the full
 * file ({ v, kind, events }) or a bare array. A record missing a required
 * field is skipped with a warning rather than breaking the whole timeline;
 * a body that is not a file at all throws.
 */
export function parseEventFile(data: unknown, fallbackKind: EventKind): EventRecord[] {
  const list = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.events) ? data.events : undefined;
  if (!list) throw new Error('events file is not an array or an object with an events array');
  const fileKind = isObject(data) && isEventKind(data.kind) ? data.kind : fallbackKind;
  const records: EventRecord[] = [];
  for (const raw of list) {
    const record = toEventRecord(raw, fileKind);
    if (record) records.push(record);
    else console.warn(`Skipping a malformed event record: ${JSON.stringify(raw).slice(0, 120)}`);
  }
  return records;
}

function toEventRecord(raw: unknown, fallbackKind: EventKind): EventRecord | undefined {
  if (!isObject(raw)) return undefined;
  const { id, title, when, summary, confidence } = raw;
  if (typeof id !== 'string' || typeof title !== 'string' || typeof when !== 'string' || typeof summary !== 'string') return undefined;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return undefined;
  const start = raw.start_years_ago;
  if (typeof start !== 'number' || !Number.isFinite(start)) return undefined;
  const end = raw.end_years_ago;
  const endYears = typeof end === 'number' && Number.isFinite(end) ? end : start;
  const regionRaw = raw.region;
  const region = Array.isArray(regionRaw)
    ? regionRaw.filter((t): t is string => typeof t === 'string')
    : typeof regionRaw === 'string'
      ? [regionRaw]
      : [];
  const sources = Array.isArray(raw.sources)
    ? raw.sources
        .filter((s): s is { title: string; url: string } => isObject(s) && typeof s.title === 'string' && typeof s.url === 'string')
        .map((s) => ({ title: s.title, url: s.url }))
    : [];
  const record: EventRecord = {
    id,
    kind: isEventKind(raw.kind) ? raw.kind : fallbackKind,
    title,
    when,
    start_years_ago: start,
    end_years_ago: endYears,
    region,
    lat: typeof raw.lat === 'number' ? raw.lat : null,
    lon: typeof raw.lon === 'number' ? raw.lon : null,
    summary,
    at_your_spot: typeof raw.at_your_spot === 'string' ? raw.at_your_spot : null,
    sources,
    confidence,
  };
  if (isSpotRule(raw.spot_rule)) record.spot_rule = raw.spot_rule;
  return record;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEventKind(v: unknown): v is EventKind {
  return v === 'deep' || v === 'human';
}

export function isSpotRule(v: unknown): v is SpotRule {
  return typeof v === 'string' && (SPOT_RULES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The visitor's spot
// ---------------------------------------------------------------------------

/** What the page knows about the address, as far as it knows it. */
export interface SpotContext {
  region?: WaRegion;
  /** County ring name, with or without "County" ("King County", "King"). */
  county?: string;
  city?: string;
  neighborhood?: string;
  point: LngLat;
  geology?: GeologyUnit | null;
  /** Year the spot was annexed into its city (Seattle annexation records). */
  annexYear?: number;
  /** Year the city incorporated. */
  incYear?: number;
  /** The house ring name, or "your spot". */
  placeName: string;
}

/** The scope tokens of an event: the record's list, or the region string split back up. */
export function scopeTokens(event: HistoryEvent): string[] {
  const regions = (event as Partial<SpotEvent>).regions;
  if (Array.isArray(regions)) return regions;
  return event.region
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Deep time or human history; a plain HistoryEvent counts as human. */
export function kindOf(event: HistoryEvent): EventKind {
  const kind = (event as Partial<SpotEvent>).kind;
  return kind === 'deep' ? 'deep' : 'human';
}

/** The spot rule on an event, if it carries one. */
export function spotRuleOf(event: HistoryEvent): SpotRule | undefined {
  const rule = (event as Partial<SpotEvent>).spotRule;
  return isSpotRule(rule) ? rule : undefined;
}

type TokenScope = 'statewide' | 'region' | 'county' | 'city';

/**
 * What kind of place a scope token names. A token ending in "County" is a
 * county, a WaRegion name is a region, "statewide" is the state, and
 * anything else is taken as a city. ("Okanogan" alone is the region; the
 * county is written "Okanogan County".)
 */
export function tokenScope(token: string): TokenScope {
  const t = token.trim();
  if (t.toLowerCase() === 'statewide') return 'statewide';
  if (isWaRegion(t)) return 'region';
  if (/\bcounty$/i.test(t)) return 'county';
  return 'city';
}

const WA_REGION_SET: ReadonlySet<string> = new Set<string>([
  'Puget Sound',
  'Olympic Peninsula',
  'Southwest Washington',
  'North Cascades',
  'South Cascades',
  'Columbia Basin',
  'Okanogan',
  'Northeast Washington',
  'Palouse and Blue Mountains',
  'Yakima Valley',
]);

function isWaRegion(t: string): t is WaRegion {
  return WA_REGION_SET.has(t);
}

/** True when one scope token applies to the spot. */
function tokenMatches(token: string, ctx: SpotContext, region: WaRegion | undefined): boolean {
  switch (tokenScope(token)) {
    case 'statewide':
      return true;
    case 'region':
      return region !== undefined && token === region;
    case 'county':
      return ctx.county !== undefined && normaliseCountyName(token) === normaliseCountyName(ctx.county);
    case 'city':
      return ctx.city !== undefined && token.trim().toLowerCase() === ctx.city.trim().toLowerCase();
  }
}

/** The spot's region: as given, or worked out from the county. */
function regionFor(ctx: SpotContext): WaRegion | undefined {
  if (ctx.region) return ctx.region;
  return ctx.county !== undefined ? regionOf(ctx.county) : undefined;
}

/**
 * The events that apply to a spot: those scoped "statewide", to the spot's
 * region, to its county, or to its city. Order is kept as given (the files
 * are oldest first).
 */
export function eventsForSpot(events: readonly HistoryEvent[], ctx: SpotContext): HistoryEvent[] {
  const region = regionFor(ctx);
  return events.filter((e) => scopeTokens(e).some((t) => tokenMatches(t, ctx, region)));
}

// ---------------------------------------------------------------------------
// The time dial
// ---------------------------------------------------------------------------

/** A stop's window on the dial, in years before 2000 CE; either order is accepted. */
export interface YearsAgoWindow {
  fromYearsAgo: number;
  toYearsAgo: number;
}

/** True when the event is still going on (end 0 by the files' convention). */
export function isContinuing(event: HistoryEvent): boolean {
  return event.endYearsAgo === 0 && event.startYearsAgo !== 0;
}

/**
 * The newest edge of an event: its end, or, when it is continuing, the
 * present (`presentYearsAgo`): "still true today" reaches today, not
 * forever after. The default, -Infinity, lets a caller without a notion
 * of today treat continuing events as open-ended.
 */
function newestEdge(event: HistoryEvent, presentYearsAgo = Number.NEGATIVE_INFINITY): number {
  if (isContinuing(event)) return presentYearsAgo;
  return event.endYearsAgo ?? event.startYearsAgo;
}

/**
 * The events whose span overlaps the window (touching counts), newest
 * first: the most recently begun event leads; when two began together the
 * one that ran longer (ended more recently, or is continuing) goes first.
 * A continuing event overlaps every window between its start and the
 * present, `presentYearsAgo` (years before 2000 CE, so -26 for 2026); left
 * out, it overlaps every window after its start, the future included.
 */
export function eventsAtWindow(
  events: readonly HistoryEvent[],
  window: YearsAgoWindow,
  presentYearsAgo = Number.NEGATIVE_INFINITY,
): HistoryEvent[] {
  const oldest = Math.max(window.fromYearsAgo, window.toYearsAgo);
  const newest = Math.min(window.fromYearsAgo, window.toYearsAgo);
  const edge = (e: HistoryEvent): number => newestEdge(e, presentYearsAgo);
  return events
    .filter((e) => e.startYearsAgo >= newest && edge(e) <= oldest)
    .sort((a, b) => a.startYearsAgo - b.startYearsAgo || edge(a) - edge(b) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

const DEEP_RINGS: readonly RingLevel[] = ['region', 'state', 'plate'];
const HUMAN_RINGS: readonly RingLevel[] = ['city', 'county', 'region', 'state'];

const SCOPE_RING: Readonly<Record<TokenScope, RingLevel>> = {
  city: 'city',
  county: 'county',
  region: 'region',
  statewide: 'state',
};

/**
 * The rings an event may appear in, most specific first. Each scope token
 * names a ring (city token: city ring; county: county; WaRegion: region;
 * statewide: state), then the ring is pushed outward to the smallest one
 * its kind allows: deep-time events live in region, state and plate; human
 * events in city, county, region and state. A statewide deep-time event
 * lists plate too, as the home of the oldest stories. The page shows the
 * event in the first listed ring the spot has.
 */
export function ringFor(event: HistoryEvent): RingLevel[] {
  return ringsForTokens(event, scopeTokens(event));
}

/**
 * Like ringFor, but counting only the scope tokens that apply to the spot:
 * an event scoped "Renton, King County" belongs on the county ring of a
 * Seattle address, not on its city ring, because "Renton" is not its city.
 * (ringFor alone would list the city ring first.) An event none of whose
 * tokens match gives an empty list.
 */
export function ringForSpot(event: HistoryEvent, ctx: SpotContext): RingLevel[] {
  const region = regionFor(ctx);
  return ringsForTokens(
    event,
    scopeTokens(event).filter((t) => tokenMatches(t, ctx, region)),
  );
}

function ringsForTokens(event: HistoryEvent, tokens: readonly string[]): RingLevel[] {
  const allowed = kindOf(event) === 'deep' ? DEEP_RINGS : HUMAN_RINGS;
  const found = new Set<RingLevel>();
  for (const token of tokens) {
    const wanted = SCOPE_RING[tokenScope(token)];
    const level = allowed.find((r) => RING_ORDER.indexOf(r) >= RING_ORDER.indexOf(wanted));
    if (level) found.add(level);
  }
  if (kindOf(event) === 'deep' && found.has('state')) found.add('plate');
  return RING_ORDER.filter((r) => found.has(r));
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const MILES_PER_KM = 0.621371;

/** "a few hundred feet", "less than a mile", "3 miles", "140 miles". */
export function formatDistance(km: number): string {
  const miles = km * MILES_PER_KM;
  if (miles < 0.15) return 'a few hundred feet';
  if (miles < 1) return 'less than a mile';
  const rounded = Math.round(miles);
  return rounded === 1 ? '1 mile' : `${rounded.toLocaleString('en-US')} miles`;
}

/**
 * Thickness of the Puget lobe of the Vashon ice sheet by latitude, from
 * Thorson (1980): about 5,000 ft at Bellingham, 3,000 ft at Seattle,
 * 2,000 ft at Tacoma, 1,000 ft at Olympia and 660 ft at Tenino, where the
 * ice ended. Interpolated between those points, clamped beyond them.
 */
const ICE_PROFILE: readonly { lat: number; feet: number }[] = [
  { lat: 46.86, feet: 660 },
  { lat: 47.04, feet: 1000 },
  { lat: 47.25, feet: 2000 },
  { lat: 47.61, feet: 3000 },
  { lat: 48.75, feet: 5000 },
];

/** Ice thickness in feet at a latitude, interpolated from Thorson (1980). */
export function iceThicknessFeet(lat: number): number {
  const first = ICE_PROFILE[0]!;
  const last = ICE_PROFILE[ICE_PROFILE.length - 1]!;
  if (lat <= first.lat) return first.feet;
  if (lat >= last.lat) return last.feet;
  for (let i = 1; i < ICE_PROFILE.length; i++) {
    const lo = ICE_PROFILE[i - 1]!;
    const hi = ICE_PROFILE[i]!;
    if (lat <= hi.lat) {
      const t = (lat - lo.lat) / (hi.lat - lo.lat);
      return lo.feet + t * (hi.feet - lo.feet);
    }
  }
  return last.feet;
}

/** The five Cascade volcanoes of Washington. */
export const VOLCANOES: readonly { name: string; point: LngLat }[] = [
  { name: 'Mount Baker', point: { lat: 48.777, lng: -121.813 } },
  { name: 'Glacier Peak', point: { lat: 48.112, lng: -121.113 } },
  { name: 'Mount Rainier', point: { lat: 46.853, lng: -121.76 } },
  { name: 'Mount St. Helens', point: { lat: 46.191, lng: -122.194 } },
  { name: 'Mount Adams', point: { lat: 46.202, lng: -121.491 } },
];

/** The nearest of the five volcanoes to a point, with its distance. */
export function nearestVolcano(point: LngLat): { name: string; point: LngLat; km: number } {
  let best = { ...VOLCANOES[0]!, km: distanceKm(point, VOLCANOES[0]!.point) };
  for (const v of VOLCANOES.slice(1)) {
    const km = distanceKm(point, v.point);
    if (km < best.km) best = { ...v, km };
  }
  return best;
}

/** Resolve one placeholder name for a spot and event; undefined when it cannot be. */
function resolvePlaceholder(name: string, ctx: SpotContext, event: HistoryEvent): string | undefined {
  switch (name) {
    case 'place':
      return ctx.placeName.trim() || 'your spot';
    case 'distance':
      return event.point ? formatDistance(distanceKm(ctx.point, event.point)) : undefined;
    case 'county':
      return ctx.county?.trim() || undefined;
    case 'city':
      return ctx.city?.trim() || undefined;
    case 'inc_year':
      return ctx.incYear !== undefined ? String(ctx.incYear) : undefined;
    case 'annex_year':
      return ctx.annexYear !== undefined ? String(ctx.annexYear) : undefined;
    case 'ice_thickness':
      // "3,000 feet": the templates already say "about" in front of it.
      return `${(Math.round(iceThicknessFeet(ctx.point.lat) / 100) * 100).toLocaleString('en-US')} feet`;
    case 'basalt_unit': {
      const unitName = ctx.geology?.name;
      return unitName && /basalt/i.test(unitName) ? unitName : undefined;
    }
    case 'nearest_volcano':
      return nearestVolcano(ctx.point).name;
    case 'flood_depth':
      // Plan v2 section 6: until elevation lookups arrive (Phase 5) the
      // flood line says "hundreds of feet" rather than a number.
      return 'hundreds of feet';
    default:
      return undefined;
  }
}

/**
 * Fill an "at your spot" template. Placeholders: {place}, {distance},
 * {county}, {city}, {inc_year}, {annex_year}, {ice_thickness},
 * {basalt_unit}, {nearest_volcano}, {flood_depth}. Returns null when any
 * placeholder (or an unknown one) cannot be resolved for this spot, so a
 * half-filled sentence is never shown.
 */
export function renderTemplate(template: string, ctx: SpotContext, event: HistoryEvent): string | null {
  let failed = false;
  const text = template.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    const value = resolvePlaceholder(name, ctx, event);
    if (value === undefined) {
      failed = true;
      return '';
    }
    return value;
  });
  return failed ? null : text;
}

// ---------------------------------------------------------------------------
// Spot rules
// ---------------------------------------------------------------------------

/** The centre of the Seattle Fault zone used for the "near" test. */
const SEATTLE_FAULT: LngLat = { lat: 47.58, lng: -122.48 };
const SEATTLE_FAULT_NEAR_KM = 25;

/**
 * Rough extent of the Puget Lowland the Vashon ice covered: north of the
 * Tenino ice limit (46.86 N) and between the Olympic and Cascade foothills
 * (123.3 W to 121.8 W). A spot inside it counts as ice-covered even when
 * its mapped unit is not glacial (fill, alluvium, bedrock); outside it only
 * a glacial unit (symbol Qg...) counts.
 */
const PUGET_LOWLAND = { minLat: 46.86, minLng: -123.3, maxLng: -121.8 };

/** The calendar year of a years-ago value (for the city-records rules). */
function calendarYear(yearsBefore: number): number | undefined {
  const t = fromYearsAgo(yearsBefore);
  return t.kind === 'year' ? t.value : undefined;
}

/** True when `yr` falls inside the event's span, in calendar years. */
function yearInWindow(yr: number | undefined, event: HistoryEvent | undefined): boolean {
  if (yr === undefined || event === undefined) return false;
  const from = calendarYear(event.startYearsAgo);
  const to = isContinuing(event) ? Number.POSITIVE_INFINITY : calendarYear(event.endYearsAgo ?? event.startYearsAgo);
  if (from === undefined || to === undefined) return false;
  return yr >= Math.min(from, to) && yr <= Math.max(from, to);
}

/**
 * Does the ground (or the city's records) back up an event's second-person
 * line at this spot? The geologic rules read the DNR unit in ctx.geology;
 * without one only the ice rule (by location) and the fault rule can pass.
 * The two year rules need the event, to know its window; without it they
 * fail.
 */
export function spotRulePasses(rule: SpotRule, ctx: SpotContext, event?: HistoryEvent): boolean {
  const g = ctx.geology ?? undefined;
  const symbol = g?.symbol ?? '';
  const text = `${g?.name ?? ''} ${g?.description ?? ''}`;
  switch (rule) {
    case 'flood-deposits':
      return symbol.startsWith('Qf');
    case 'vashon-ice': {
      const { lat, lng } = ctx.point;
      const inLowland = lat > PUGET_LOWLAND.minLat && lng >= PUGET_LOWLAND.minLng && lng <= PUGET_LOWLAND.maxLng;
      return symbol.startsWith('Qg') || inLowland;
    }
    case 'crbg':
      return /Columbia River Basalt/i.test(g?.name ?? '') || /^M?v[bgw]/.test(symbol);
    case 'osceola-lahar':
      return /\bOsceola\b/i.test(text);
    case 'electron-lahar':
      return /\bElectron\b/i.test(text);
    case 'seattle-fault-near':
      return distanceKm(ctx.point, SEATTLE_FAULT) <= SEATTLE_FAULT_NEAR_KM;
    case 'annexed-in-range':
      return yearInWindow(ctx.annexYear, event);
    case 'incorporated-in-range':
      return yearInWindow(ctx.incYear, event);
  }
}

/**
 * The event's sentence about this spot, or null when the event has none,
 * its spot rule fails here, or a placeholder cannot be filled. The summary
 * is for everyone in the region; this line is only for spots it is true of.
 */
export function storyLine(event: HistoryEvent, ctx: SpotContext): string | null {
  if (!event.atYourSpot) return null;
  const rule = spotRuleOf(event);
  if (rule !== undefined && !spotRulePasses(rule, ctx, event)) return null;
  return renderTemplate(event.atYourSpot, ctx, event);
}
