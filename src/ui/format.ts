/**
 * Small, pure text helpers for the user interface. Nothing in this file
 * touches the DOM or the network, so every function can be unit-tested in
 * plain Node and reused by any part of the page.
 *
 * What lives here:
 *   escapeHtml      make a string safe to drop into HTML
 *   formatNumber    "1234567" -> "1,234,567"
 *   formatYear      a calendar year as the time engine would print it
 *   excerpt         shorten a paragraph at a sentence end, not mid-word
 *   heroSentence    the one-line summary at the top of a story
 *   summariseOutcome the status line once every source has answered
 *   distanceWords   metres -> "90 feet" / "0.3 miles"
 *   ringLabel       the short heading for a ring level ("House", "County")
 *   ringTagline     a few words explaining what each ring is
 */

import type { GeologyUnit, Place, Ring, RingLevel } from '../lib/types';
import { formatReadout, year } from '../lib/time';

// ---------------------------------------------------------------------------
// Escaping and numbers
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Replace the five characters that mean something in HTML (& < > " ') with
 * their entities, so text from a data source can never become markup. The
 * page builds nodes with textContent wherever it can; this is for the few
 * places that must assemble an HTML string, and for anyone who needs it.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * A whole number or decimal with thousands separators, in the en-US style
 * the rest of the site uses: 1234567 -> "1,234,567", 2.5 -> "2.5". Values
 * that are not finite come back as an empty string rather than "NaN", so a
 * missing number never prints as a word.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US');
}

/**
 * A calendar year as the time engine prints it: 1926 -> "1926", 79 ->
 * "79 CE", -500 -> "500 BCE". The time engine refuses year 0 and fractions
 * (there is no year 0 in our calendar), so those fall back to the plain
 * number instead of throwing in the middle of rendering.
 */
export function formatYear(y: number): string {
  if (!Number.isInteger(y) || y === 0) return formatNumber(y);
  return formatReadout(year(y));
}

// ---------------------------------------------------------------------------
// Excerpts
// ---------------------------------------------------------------------------

/** The ellipsis we append when a text had to be cut mid-sentence. */
const ELLIPSIS = '…';

/**
 * Does the text end a sentence at this index? True when the character is
 * a full stop, question mark or exclamation mark (optionally followed by a
 * closing quote or bracket) and the next character is a space or the end.
 * A full stop after a single capital letter ("U.S.", "J. Smith") does not
 * count, which keeps the most common abbreviations in one piece.
 */
function sentenceEndsAt(text: string, i: number): number | null {
  const ch = text[i];
  if (ch !== '.' && ch !== '?' && ch !== '!') return null;
  // "U.S." or "J." -> not an end of sentence.
  if (ch === '.' && i >= 1 && /[A-Z]/.test(text[i - 1] ?? '') && (i < 2 || !/[A-Za-z]/.test(text[i - 2] ?? ''))) {
    return null;
  }
  let end = i + 1;
  while (end < text.length && /["')\]”’]/.test(text[end] ?? '')) end += 1;
  if (end === text.length || /\s/.test(text[end] ?? '')) return end;
  return null;
}

/**
 * Shorten a paragraph to at most `max` characters without leaving a
 * dangling half-sentence. Whitespace is collapsed first. When the text is
 * already short enough it is returned as it is. Otherwise the cut is made
 * at the last sentence end that fits, as long as that keeps at least a
 * third of the budget (so we never shrink a paragraph to one tiny
 * sentence); failing that, at the last space, with an ellipsis added.
 * A budget too small to hold anything gives back an empty string.
 */
export function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (max <= 0) return '';
  if (clean.length <= max) return clean;

  // Prefer a clean sentence end.
  const minimum = Math.floor(max / 3);
  for (let i = max; i >= minimum; i -= 1) {
    const end = sentenceEndsAt(clean, i - 1);
    if (end !== null && end <= max) return clean.slice(0, end);
  }

  // Otherwise cut at a word boundary and say so with an ellipsis.
  const budget = max - ELLIPSIS.length;
  if (budget <= 0) return ELLIPSIS;
  const slice = clean.slice(0, budget + 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : clean.slice(0, budget);
  return cut.replace(/[\s,;:]+$/, '') + ELLIPSIS;
}

// ---------------------------------------------------------------------------
// Ring labels
// ---------------------------------------------------------------------------

const RING_LABEL: Readonly<Record<RingLevel, string>> = {
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

const RING_TAGLINE: Readonly<Record<RingLevel, string>> = {
  house: 'The lot and what stands on it',
  block: 'The few hundred feet around it',
  street: 'The road out front',
  neighborhood: 'The part of town',
  city: 'The city or town',
  county: 'One of thirty-nine counties',
  region: 'The corner of the state',
  state: 'Washington',
  plate: 'The slab of crust it rides on',
};

/** The short heading for a ring level: 'county' -> "County". */
export function ringLabel(level: RingLevel): string {
  return RING_LABEL[level];
}

/**
 * A few words saying what a ring is, for the small line under its heading:
 * 'plate' -> "The slab of crust it rides on".
 */
export function ringTagline(level: RingLevel): string {
  return RING_TAGLINE[level];
}

// ---------------------------------------------------------------------------
// The hero sentence
// ---------------------------------------------------------------------------

/**
 * The names the ring model uses when it has nothing better ("This spot",
 * "This county", "Unincorporated area", and the bare "Neighborhood" of an
 * unnamed neighborhood ring). They are fine as card headings but would read
 * badly in a sentence, so the hero skips them.
 */
function isPlaceholderName(name: string): boolean {
  return /^(this\b|unincorporated\b|neighborhood$)/i.test(name.trim());
}

/** A ring's real name, or undefined when it has none worth printing. */
function ringNameFor(rings: readonly Ring[], level: RingLevel): string | undefined {
  const name = rings.find((r) => r.level === level)?.name.trim();
  return name && !isPlaceholderName(name) ? name : undefined;
}

/** A trimmed address part, or undefined when it is missing or blank. */
function part(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/** Two names are "the same place" when they match ignoring case and spaces. */
function sameName(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Geology map units that are not rock at all but what covers it. The DNR
 * map names them by the bare material ("ice" on Mount Rainier's summit,
 * "water" on a lake), which would read as a glitch ("sits ... on ice"),
 * so each gets its own phrase.
 */
const COVER_PHRASES: Readonly<Record<string, string>> = {
  ice: 'under glacier ice',
  water: 'under open water',
};

/**
 * The closing clause for the rock, from a geology unit: "on" plus the
 * unit's name when it already carries its age ("on Pleistocene continental
 * glacial till"), otherwise the age and the name together ("on Miocene
 * Columbia River Basalt"); for a bare material such as "ice" or "water", a
 * phrase of its own ("under glacier ice"). Undefined when the unit has no
 * name to speak of.
 */
function rockClause(unit: GeologyUnit): string | undefined {
  const name = part(unit.name);
  if (!name) return undefined;
  const cover = COVER_PHRASES[name.toLowerCase()];
  if (cover) return cover;
  const age = part(unit.age);
  if (!age) return `on ${name}`;
  const firstAgeWord = age.split(/[\s,;/]+/)[0] ?? age;
  return name.toLowerCase().includes(firstAgeWord.toLowerCase()) ? `on ${name}` : `on ${age} ${name}`;
}

/**
 * The one sentence at the top of every story, in the shape "407 Broad St
 * sits in Lower Queen Anne, in Seattle, King County, on Pleistocene glacial
 * till." Each part is optional and the sentence stays grammatical without
 * it: the subject falls back from the house to the street to "This spot";
 * the neighborhood, city and county come from the rings when they have real
 * names (placeholder names such as "This county" are skipped) and from the
 * geocoded address otherwise; with no named container at all the spot
 * "sits in Washington"; and the rock clause ("on Pleistocene glacial till",
 * or "under glacier ice" for a unit that is a bare material) appears only
 * when a geology unit is given. A neighborhood that merely repeats the city
 * name is dropped so the sentence never says "in Seattle, in Seattle".
 */
export function heroSentence(place: Place, rings: Ring[], geology?: GeologyUnit | null): string {
  const a = place.address;

  // Subject: the house if we know it, else the street, else a plain "This spot".
  const house = ringNameFor(rings, 'house') ?? (place.precise && part(a.houseNumber) && part(a.road) ? `${part(a.houseNumber)} ${part(a.road)}` : undefined);
  const street = ringNameFor(rings, 'street') ?? part(a.road);
  const subject = house ?? street ?? 'This spot';

  // Containers, from the rings first (they may hold better names than the
  // geocoder gave, e.g. the city's own neighborhood atlas), then the address.
  const neighborhood = ringNameFor(rings, 'neighborhood') ?? part(a.neighbourhood) ?? part(a.suburb);
  const city = ringNameFor(rings, 'city') ?? part(a.city) ?? part(a.town) ?? part(a.village);
  const county = ringNameFor(rings, 'county') ?? part(a.county);

  const clauses: string[] = [];
  if (neighborhood && !sameName(neighborhood, city) && !sameName(neighborhood, subject)) {
    clauses.push(`in ${neighborhood}`);
  }
  if (city && county && !sameName(city, county)) clauses.push(`in ${city}, ${county}`);
  else if (city) clauses.push(`in ${city}`);
  else if (county) clauses.push(`in ${county}`);
  if (clauses.length === 0) clauses.push('in Washington');

  const rock = geology ? rockClause(geology) : undefined;
  const tail = rock ? `, ${rock}` : '';

  return `${subject} sits ${clauses.join(', ')}${tail}.`;
}

// ---------------------------------------------------------------------------
// The status line once every source has answered
// ---------------------------------------------------------------------------

/** What the status line says for a loader that failed in a way nobody named. */
const UNNAMED_FAILURE = 'an unexpected error';

/**
 * The final status line for a story, from the settled results of every
 * loader. Each loader resolves with the names of the sources that did not
 * answer (an empty list when all went well); a loader that rejected
 * outright counts as "an unexpected error". With no failures the line is
 * "Story ready: <hero sentence>" (or just "Story ready." when there is no
 * hero); otherwise it names each failed source once, in the order they
 * were reported, and says the rest of the story is on the page. Pure, so
 * the wording and the de-duplication can be unit-tested.
 */
export function summariseOutcome(results: readonly PromiseSettledResult<readonly string[]>[], hero: string): string {
  const failed: string[] = [];
  for (const result of results) {
    const names = result.status === 'fulfilled' ? result.value : [UNNAMED_FAILURE];
    for (const name of names) {
      const t = name.trim();
      if (t && !failed.includes(t)) failed.push(t);
    }
  }
  if (failed.length === 0) {
    const h = hero.trim();
    return h ? `Story ready: ${h}` : 'Story ready.';
  }
  return `Story ready, but some sources did not answer (${failed.join(', ')}); the rest of the story is here.`;
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

const FEET_PER_METRE = 3.28084;
const FEET_PER_MILE = 5280;

/**
 * A distance in metres as the words a Washington reader expects: under a
 * fifth of a mile in feet rounded to ten ("90 feet", "650 feet"), then
 * miles to one decimal ("0.3 miles", "1 mile", "2.5 miles"), then whole
 * miles with separators ("120 miles"). Anything under ten feet is "a few
 * feet". A negative or non-finite value gives an empty string.
 */
export function distanceWords(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  const feet = m * FEET_PER_METRE;
  if (feet < 10) return 'a few feet';
  if (feet < 1000) return `${formatNumber(Math.round(feet / 10) * 10)} feet`;
  const miles = feet / FEET_PER_MILE;
  if (miles < 10) {
    const rounded = Number(miles.toFixed(1));
    return rounded === 1 ? '1 mile' : `${formatNumber(rounded)} miles`;
  }
  return `${formatNumber(Math.round(miles))} miles`;
}
