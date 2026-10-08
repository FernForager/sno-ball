/**
 * The ring model: the nested places a spot belongs to, from the house out to
 * the tectonic plate.
 *
 * A geocoded Place (see geocode.ts) gives us address parts such as the house
 * number, road, neighbourhood, city and county. buildRings turns those into
 * one Ring per level in RING_ORDER, with a display name and an empty list of
 * facts. The rest of the site then fills the rings in, one data source at a
 * time, with setRingFacts / addRingFacts. Each of those returns a NEW array
 * (the old one is never changed), so the UI can simply re-render whatever it
 * is handed and never worry about stale references.
 *
 * Status of a ring:
 *   'loading'  we know its name and are still looking for facts
 *   'rich'     two or more facts
 *   'thin'     exactly one fact
 *   'empty'    no facts, or no name to look up (then `note` says why)
 *
 * A ring's `busy` flag is separate from its status: a 'thin' or 'rich' ring
 * is still busy while another source owes it an answer (isRingBusy).
 */

import type { AddressParts, Fact, Place, Ring, RingLevel, RingStatus } from './types';
import { RING_ORDER } from './types';
import { regionOf } from '../data/wa-regions';
import { streetNumberIn } from './geocode';

/** Short headings for each ring level, for the page. */
export const RING_LABELS: Readonly<Record<RingLevel, string>> = {
  house: 'House',
  block: 'Block',
  street: 'Street',
  neighborhood: 'Neighborhood',
  city: 'City',
  county: 'County',
  region: 'Region',
  state: 'State',
  plate: 'Plate',
};

/** The name a ring shows when the geocoder gave us nothing to call it. */
const PLACEHOLDER_NAME: Readonly<Record<RingLevel, string>> = {
  house: 'This spot',
  block: 'This block',
  street: 'This street',
  // A plain heading, not "This neighborhood": it is read out as an h2 between
  // a real street and a real city (format.ts knows to skip it in the hero).
  neighborhood: 'Neighborhood',
  city: 'Unincorporated area',
  county: 'This county',
  region: 'This region',
  state: 'Washington',
  plate: 'North American Plate',
};

/** One friendly line explaining why a ring has no name to look up. */
const EMPTY_NOTE: Readonly<Record<RingLevel, string>> = {
  house: 'This search matched a general area, not a specific lot.',
  block: 'We could not tell which street this spot is on, so there is no block to describe.',
  street: 'We could not tell which street this spot is on.',
  neighborhood: 'No named neighborhood here in OpenStreetMap.',
  city: 'This spot is not inside a city or town, as far as the map knows.',
  county: "We couldn't tell which county this spot is in.",
  region: "We couldn't tell which corner of Washington this spot is in.",
  state: 'Every spot on this site is in Washington.',
  plate: 'Every spot on this site is on the North American Plate.',
};

/** A trimmed string, or undefined when it is missing or blank. */
function text(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/** The city-like name a geocoder gave: city, else town, else village. */
export function cityName(address: AddressParts): string | undefined {
  return text(address.city) ?? text(address.town) ?? text(address.village);
}

/**
 * The display name for one ring level, derived from the place's address
 * parts, or undefined when there is nothing to call it. The rules:
 *   house         "<number> <road>" when the match is precise (or "This lot"
 *                 when precise but the parts are missing); nothing otherwise
 *   block         "The block of <road>"
 *   street        the road
 *   neighborhood  neighbourhood, else suburb
 *   city          city, else town, else village
 *   county        the county as given, e.g. "King County"
 *   region        the county's region from src/data/wa-regions.ts
 *   state         always "Washington"
 *   plate         always "North American Plate"
 */
export function ringName(level: RingLevel, place: Place): string | undefined {
  const a = place.address;
  const road = text(a.road);
  switch (level) {
    case 'house': {
      if (!place.precise) return undefined;
      const number = text(a.houseNumber);
      return number && road ? `${number} ${road}` : 'This lot';
    }
    case 'block':
      return road ? `The block of ${road}` : undefined;
    case 'street':
      return road;
    case 'neighborhood':
      return text(a.neighbourhood) ?? text(a.suburb);
    case 'city':
      return cityName(a);
    case 'county':
      return text(a.county);
    case 'region': {
      const county = text(a.county);
      return county ? regionOf(county) : undefined;
    }
    case 'state':
      return 'Washington';
    case 'plate':
      return 'North American Plate';
  }
}

/**
 * The note for the house ring when the visitor typed a street number the
 * geocoder could not find, so it fell back to the street ("2 N Main St,
 * Omak" -> Main Street South). The ring keeps its placeholder name; this
 * line says that the number itself is missing rather than letting the
 * street pass for what was asked. Undefined when the query had no number,
 * the result does carry a house number, or there is no street to speak of.
 */
export function missingNumberNote(place: Place): string | undefined {
  const typed = streetNumberIn(place.query);
  if (!typed || text(place.address.houseNumber) || !text(place.address.road)) return undefined;
  return `Number ${typed} isn't on the map yet, so this is the street.`;
}

/**
 * One Ring per level in RING_ORDER for a geocoded place. Rings with a name
 * start as 'loading' with no facts; rings the address cannot name start as
 * 'empty' with a placeholder name and a note saying why (for example the
 * house ring when the geocoder matched a whole street rather than one lot;
 * when the visitor had typed a number, the note names it, see
 * missingNumberNote). The result is a fresh array of fresh objects, safe
 * to hand to the UI.
 */
export function buildRings(place: Place): Ring[] {
  return RING_ORDER.map((level): Ring => {
    const name = ringName(level, place);
    if (name !== undefined) {
      return { level, name, facts: [], status: 'loading' };
    }
    const note = (level === 'house' ? missingNumberNote(place) : undefined) ?? EMPTY_NOTE[level];
    return { level, name: PLACEHOLDER_NAME[level], facts: [], status: 'empty', note };
  });
}

/**
 * Should a ring's card be marked busy (aria-busy, with a "still gathering"
 * hint)? Yes while it is 'loading', and yes while it already shows facts
 * ('thin' or 'rich') but `pending` sources still owe it an answer, so a
 * card never looks settled while the status line says the story is still
 * being gathered. An 'empty' ring is never busy: its note is final, and a
 * source that later names it sets the ring 'loading' first.
 */
export function isRingBusy(status: RingStatus, pending: number): boolean {
  if (status === 'loading') return true;
  return status !== 'empty' && pending > 0;
}

/**
 * The ring with its `busy` flag set or cleared. Returns the SAME object
 * when the flag already matches, so the UI (which rebuilds only the cards
 * whose ring object changed) leaves the card alone.
 */
export function markRingBusy(ring: Ring, busy: boolean): Ring {
  if ((ring.busy ?? false) === busy) return ring;
  const { busy: _old, ...rest } = ring;
  return busy ? { ...rest, busy: true } : rest;
}

/** The status a ring deserves for a given number of facts: 2+ rich, 1 thin, 0 empty. */
export function statusForFacts(facts: readonly Fact[]): RingStatus {
  if (facts.length >= 2) return 'rich';
  if (facts.length === 1) return 'thin';
  return 'empty';
}

/**
 * Replace a ring's facts and return a new array. Nothing in `rings` is
 * modified: untouched rings are the same objects, the changed ring is a new
 * one. The status defaults to statusForFacts (rich / thin / empty) unless a
 * status is given. The ring's note is kept only while the ring stays
 * 'empty'; once it has facts, a note such as "no records for this lot" no
 * longer applies and is dropped (use setRingNote to add a new one).
 */
export function setRingFacts(rings: Ring[], level: RingLevel, facts: Fact[], status?: RingStatus): Ring[] {
  const nextStatus = status ?? statusForFacts(facts);
  return updateRing(rings, level, (ring) => {
    const { note, ...rest } = ring;
    return {
      ...rest,
      facts: [...facts],
      status: nextStatus,
      ...(nextStatus === 'empty' && note !== undefined ? { note } : {}),
    };
  });
}

/**
 * Append facts to a ring (keeping the ones it already has) and return a new
 * array, recomputing the status from the combined total. This is what the
 * page uses as each data source answers: the house ring, for example,
 * collects the parcel's year built first and nearby landmarks later.
 */
export function addRingFacts(rings: Ring[], level: RingLevel, facts: Fact[]): Ring[] {
  const existing = ringByLevel(rings, level)?.facts ?? [];
  return setRingFacts(rings, level, [...existing, ...facts]);
}

/**
 * Set (or, with undefined, remove) the one-line note on a ring and return a
 * new array. Use it to explain a thin or empty ring, e.g. "No records for
 * this lot in open data yet."
 */
export function setRingNote(rings: Ring[], level: RingLevel, note: string | undefined): Ring[] {
  return updateRing(rings, level, (ring) => {
    const { note: _old, ...rest } = ring;
    return note === undefined ? rest : { ...rest, note };
  });
}

/**
 * Apply a change to the ring at one level and return a new array. The
 * `change` function receives the current ring and returns the replacement;
 * every other ring is passed through untouched. All the other updaters in
 * this file are built on this one.
 */
export function updateRing(rings: Ring[], level: RingLevel, change: (ring: Ring) => Ring): Ring[] {
  return rings.map((ring) => (ring.level === level ? change(ring) : ring));
}

/** The ring at a level, or undefined when the array does not have one. */
export function ringByLevel(rings: readonly Ring[], level: RingLevel): Ring | undefined {
  return rings.find((ring) => ring.level === level);
}
