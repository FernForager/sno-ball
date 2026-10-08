/**
 * Shared data contracts for the site. Every module that fetches or renders
 * data speaks in these shapes, so the pieces can be built and tested apart
 * and still fit together.
 */

export interface LngLat {
  lng: number;
  lat: number;
}

/** Where a fact came from. Shown next to every fact on the page. */
export interface Source {
  name: string;
  url: string;
  /** e.g. "CC BY-SA 4.0", "ODbL", "CC0", "Public domain", "King County Assessor terms" */
  license?: string;
}

/** The nested rings, smallest first. */
export type RingLevel =
  | 'house'
  | 'block'
  | 'street'
  | 'neighborhood'
  | 'city'
  | 'county'
  | 'region'
  | 'state'
  | 'plate';

export const RING_ORDER: readonly RingLevel[] = [
  'house',
  'block',
  'street',
  'neighborhood',
  'city',
  'county',
  'region',
  'state',
  'plate',
];

/** One piece of information attached to a ring. */
export interface Fact {
  /** Machine-readable kind, e.g. 'year-built', 'founded', 'population', 'annexed', 'rock-unit', 'paleo-position', 'summary', 'landmark' */
  kind: string;
  /** Short label shown to the visitor, e.g. "Built in 1926" */
  title: string;
  /** Longer text; for Wikipedia prose this is a quoted excerpt, never rewritten */
  body?: string;
  /** Calendar year the fact refers to, if any (negative = BCE) */
  year?: number;
  /** Years before 2000 CE for deep-time facts */
  yearsAgo?: number;
  source: Source;
  /** 'high' when from an authoritative record, 'medium' when inferred, 'low' when a guess */
  confidence?: 'high' | 'medium' | 'low';
}

export type RingStatus = 'loading' | 'rich' | 'thin' | 'empty';

export interface Ring {
  level: RingLevel;
  /** Display name, e.g. "Lower Queen Anne", "King County", "Washington" */
  name: string;
  altNames?: string[];
  wikidata?: string;
  /** English Wikipedia article title, when known */
  wikipedia?: string;
  osm?: { type: 'node' | 'way' | 'relation'; id: number };
  facts: Fact[];
  status: RingStatus;
  /** One line explaining an empty or thin ring, e.g. "No records for this lot in open data yet." */
  note?: string;
  /**
   * True while a data source still owes this ring an answer after some
   * facts have already landed: the card shows them but stays aria-busy.
   * Absent (or false) once every source has answered. The page sets it
   * (see isRingBusy in rings.ts); the ring helpers leave it alone.
   */
  busy?: boolean;
}

/** The address parts a geocoder gives back, normalised. */
export interface AddressParts {
  houseNumber?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

/** A geocoded place in Washington. */
export interface Place {
  /** What the visitor typed */
  query: string;
  point: LngLat;
  displayName: string;
  address: AddressParts;
  osm?: { type: 'node' | 'way' | 'relation'; id: number };
  /** True when the geocoder matched a specific building or address point */
  precise: boolean;
  source: Source;
}

/** Bedrock or surface geology at a point. */
export interface GeologyUnit {
  symbol: string;
  name: string;
  /** Free-text age as the survey gives it, e.g. "Pleistocene", "Miocene" */
  age: string;
  /** Approximate age range in years before 2000 CE when it can be inferred */
  ageYearsAgo?: { from: number; to: number };
  description?: string;
  source: Source;
}

/** Where a point sat on the globe at a given time. */
export interface PaleoPosition {
  ma: number;
  point: LngLat;
  model: string;
  source: Source;
}

/** The region of Washington a county belongs to, for region-scale stories. */
export type WaRegion =
  | 'Puget Sound'
  | 'Olympic Peninsula'
  | 'Southwest Washington'
  | 'North Cascades'
  | 'South Cascades'
  | 'Columbia Basin'
  | 'Okanogan'
  | 'Northeast Washington'
  | 'Palouse and Blue Mountains'
  | 'Yakima Valley';

/** A dated event that applies to some part of the state. */
export interface HistoryEvent {
  id: string;
  title: string;
  /** Human-readable, e.g. "about 17,000 years ago", "November 11, 1889" */
  when: string;
  startYearsAgo: number;
  endYearsAgo?: number;
  /** Where it applies: 'statewide', a WaRegion, a county name, or a city name */
  region: string;
  point?: LngLat;
  summary: string;
  /** Sentence template relating the event to the visitor's spot */
  atYourSpot?: string;
  sources: Source[];
  confidence: 'high' | 'medium' | 'low';
}

/** Everything the story page needs for one address. */
export interface Story {
  place: Place;
  rings: Ring[];
  geology?: GeologyUnit;
  paleo?: PaleoPosition[];
  events?: HistoryEvent[];
}
