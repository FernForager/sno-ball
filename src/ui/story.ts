/**
 * The story page: everything under the search box once an address is
 * chosen. From the top:
 *
 *   1. the "postcard": a sticky map area the page draws the map into
 *   2. the status line (aria-live, so screen readers hear progress)
 *   3. the hero sentence ("407 Broad St sits in Lower Queen Anne, ...")
 *   4. a horizontal strip of ring chips; tapping one scrolls to its card
 *   5. one card per ring, house first, plate last
 *   6. "Deep time": the rock under the spot, the ice-age card, and the
 *      list of where the spot sat on the globe millions of years ago
 *   7. a footer listing every distinct source the page used
 *
 * The page talks to this module only through the handle mountStory returns:
 * it sets the place, the rings, the geology and so on, and the module
 * re-renders just the part that changed. The map itself is not made here;
 * `mapContainer` is handed to the map module, which draws into it. That
 * element is created once and never replaced, so the map survives every
 * re-render and every clear().
 *
 * When the visitor moves from ring to ring (by tapping a chip or scrolling
 * a card into view) the root element dispatches a bubbling CustomEvent
 * named 'sno-ball:ring' with `detail: { level }`. The page may listen for
 * it to zoom the map; nothing here depends on anyone doing so.
 */

import type { GeologyUnit, Place, Ring, RingLevel, Source } from '../lib/types';
import { RING_ORDER } from '../lib/types';
import { ringLabel } from './format';
import { cardId, el, renderRingCard, renderSkeleton, renderSourceLink, ringGlyph } from './ring-card';

export interface PaleoItem {
  text: string;
  source: Source;
}

export interface IceAgeCard {
  title: string;
  body: string;
  source: Source;
}

export interface StoryHandle {
  /** The geocoded place: shows its name under the map and reveals the page. */
  setPlace(place: Place): void;
  /** Replace the ring chips and cards with these rings (any order; shown in RING_ORDER). */
  setRings(rings: Ring[]): void;
  /** The rock card: a unit, or null for "nothing found". `ageSentence` is the readable age line. */
  setGeology(unit: GeologyUnit | null, ageSentence?: string): void;
  /** The "where this spot has been" list; an empty list shows a muted note. */
  setPaleo(items: PaleoItem[]): void;
  /** The ice-age card, or nothing to hide it. */
  setIceAge(fact?: IceAgeCard): void;
  /** The one-sentence summary above the rings; empty text hides it. */
  setHero(text: string): void;
  /** Progress or error text for the live status line; null clears it. */
  setStatus(text: string | null): void;
  /** Back to the empty state, keeping the map container in place. */
  clear(): void;
  /** The element the map module draws into. Stable for the life of the page. */
  mapContainer: HTMLElement;
}

/** The name of the event dispatched when the visitor's attention moves to a ring. */
export const RING_EVENT = 'sno-ball:ring';

/** Sort rings into RING_ORDER, dropping any level that appears twice. */
function inRingOrder(rings: readonly Ring[]): Ring[] {
  const byLevel = new Map<RingLevel, Ring>();
  for (const ring of rings) if (!byLevel.has(ring.level)) byLevel.set(ring.level, ring);
  return RING_ORDER.flatMap((level) => {
    const ring = byLevel.get(level);
    return ring ? [ring] : [];
  });
}

/** Does the visitor want instant moves instead of animation? */
function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Mount the story layout into `root` and return its handle. Nothing is
 * shown except the map area until setPlace is called; clear() returns to
 * that state. See the file comment for the layout and the ring event.
 */
export function mountStory(root: HTMLElement): StoryHandle {
  // --- 1. The postcard ----------------------------------------------------
  const mapContainer = el('div', { class: 'postcard__map', role: 'region', 'aria-label': 'Map of this place' });
  const caption = el('p', { class: 'postcard__caption' });
  const postcard = el('div', { class: 'postcard' }, [mapContainer, caption]);

  // --- 2 and 3. Status line and hero --------------------------------------
  const status = el('p', { class: 'story__status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const hero = el('p', { class: 'hero', hidden: '' });
  const head = el('header', { class: 'story__head' }, [status, hero]);

  // --- 4 and 5. Ring strip and cards --------------------------------------
  const stripList = el('ul', { class: 'ring-strip__list' });
  const strip = el('nav', { class: 'ring-strip', 'aria-label': 'Rings, from the house outward', hidden: '' }, [stripList]);
  const cards = el('section', { class: 'rings', 'aria-label': 'The rings', hidden: '' });

  // --- 6. Deep time -------------------------------------------------------
  const rockBody = el('div', { class: 'deep-card__body' });
  const rockCard = el('article', { class: 'card deep-card deep-card--rock', 'aria-labelledby': 'deep-rock-title' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'eyebrow__level' }, ['Underfoot'])]),
    el('h3', { class: 'deep-card__title', id: 'deep-rock-title' }, ['The rock under this spot']),
    rockBody,
  ]);
  const iceBody = el('div', { class: 'deep-card__body' });
  const iceTitle = el('h3', { class: 'deep-card__title', id: 'deep-ice-title' });
  const iceCard = el('article', { class: 'card deep-card deep-card--ice', 'aria-labelledby': 'deep-ice-title', hidden: '' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'eyebrow__level' }, ['The last ice age'])]),
    iceTitle,
    iceBody,
  ]);
  const paleoBody = el('div', { class: 'deep-card__body' });
  const paleoCard = el('article', { class: 'card deep-card deep-card--paleo', 'aria-labelledby': 'deep-paleo-title' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'eyebrow__level' }, ['Drifting continents'])]),
    el('h3', { class: 'deep-card__title', id: 'deep-paleo-title' }, ['Where this spot has been']),
    paleoBody,
  ]);
  const deepTime = el('section', { class: 'deep-time', 'aria-labelledby': 'deep-time-title', hidden: '' }, [
    el('h2', { class: 'section-title', id: 'deep-time-title' }, ['Deep time']),
    el('p', { class: 'section-lede muted' }, ['The ground itself has a history that runs far past any street.']),
    rockCard,
    iceCard,
    paleoCard,
  ]);

  // --- 7. Sources ---------------------------------------------------------
  const sourcesList = el('ul', { class: 'sources__list' });
  const sources = el('footer', { class: 'sources', 'aria-labelledby': 'sources-title', hidden: '' }, [
    el('h2', { class: 'section-title', id: 'sources-title' }, ['Sources']),
    el('p', { class: 'section-lede muted' }, ['Every fact on this page links back to where it came from.']),
    sourcesList,
  ]);

  root.replaceChildren(el('div', { class: 'story' }, [postcard, head, strip, cards, deepTime, sources]));

  // --- State the renderers read from ---------------------------------------
  let place: Place | null = null;
  let rings: Ring[] = [];
  let geologySource: Source | null = null;
  let paleoSources: Source[] = [];
  let iceSource: Source | null = null;
  const cardByLevel = new Map<RingLevel, HTMLElement>();
  const chipByLevel = new Map<RingLevel, HTMLButtonElement>();
  let activeLevel: RingLevel | null = null;

  /** Tell the page which ring the visitor is looking at, and mark its chip. */
  const announceRing = (level: RingLevel): void => {
    if (activeLevel === level) return;
    activeLevel = level;
    for (const [lvl, chip] of chipByLevel) {
      if (lvl === level) chip.setAttribute('aria-current', 'true');
      else chip.removeAttribute('aria-current');
    }
    chipByLevel.get(level)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    root.dispatchEvent(new CustomEvent(RING_EVENT, { detail: { level }, bubbles: true }));
  };

  // As the visitor scrolls, the card nearest the top (just under the sticky
  // map) becomes the active ring. Older browsers without IntersectionObserver
  // simply keep the chip-tap behaviour.
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            const visible = entries
              .filter((e) => e.isIntersecting)
              .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
            const level = visible?.target.getAttribute('data-level') as RingLevel | null | undefined;
            if (level && RING_ORDER.includes(level)) announceRing(level);
          },
          { rootMargin: '-40% 0px -45% 0px' },
        )
      : null;

  /** Scroll a ring's card under the map and move keyboard focus to it. */
  const goToRing = (level: RingLevel): void => {
    const card = cardByLevel.get(level);
    if (!card) return;
    card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    card.focus({ preventScroll: true });
    announceRing(level);
  };

  const renderStrip = (): void => {
    stripList.replaceChildren();
    chipByLevel.clear();
    for (const ring of rings) {
      const chip = el('button', { type: 'button', class: 'ring-chip', 'data-level': ring.level, 'aria-controls': cardId(ring.level) }, [
        ringGlyph(ring.level),
        el('span', { class: 'ring-chip__label' }, [ringLabel(ring.level)]),
        el('span', { class: 'ring-chip__name' }, [ring.name]),
      ]);
      if (ring.level === activeLevel) chip.setAttribute('aria-current', 'true');
      chip.addEventListener('click', () => goToRing(ring.level));
      chipByLevel.set(ring.level, chip);
      stripList.append(el('li', {}, [chip]));
    }
    strip.hidden = rings.length === 0;
  };

  const renderCards = (): void => {
    // Replace each card in place so the page does not jump while reading.
    const wanted = new Set<RingLevel>();
    let previous: HTMLElement | null = null;
    for (const ring of rings) {
      wanted.add(ring.level);
      const fresh = renderRingCard(ring);
      const old = cardByLevel.get(ring.level);
      if (old) {
        observer?.unobserve(old);
        old.replaceWith(fresh);
      } else if (previous) {
        previous.after(fresh);
      } else {
        cards.prepend(fresh);
      }
      observer?.observe(fresh);
      cardByLevel.set(ring.level, fresh);
      previous = fresh;
    }
    for (const [level, node] of cardByLevel) {
      if (!wanted.has(level)) {
        observer?.unobserve(node);
        node.remove();
        cardByLevel.delete(level);
      }
    }
    cards.hidden = rings.length === 0;
  };

  /** Every distinct source on the page, in the order it first appears. */
  const collectSources = (): Source[] => {
    const seen = new Map<string, Source>();
    const add = (s: Source | null | undefined): void => {
      if (!s) return;
      const key = `${s.url}\n${s.name}`;
      if (!seen.has(key)) seen.set(key, s);
    };
    add(place?.source);
    for (const ring of rings) for (const fact of ring.facts) add(fact.source);
    add(geologySource);
    add(iceSource);
    for (const s of paleoSources) add(s);
    return [...seen.values()];
  };

  const renderSources = (): void => {
    const list = collectSources();
    sourcesList.replaceChildren(...list.map((s) => el('li', {}, [renderSourceLink(s)])));
    sources.hidden = list.length === 0;
  };

  // --- The handle ---------------------------------------------------------
  const setPlace: StoryHandle['setPlace'] = (next) => {
    place = next;
    caption.replaceChildren(
      el('span', { class: 'postcard__name' }, [next.displayName]),
      ...(next.precise ? [] : [el('span', { class: 'postcard__hint muted' }, [' · matched a general area, not one building'])]),
    );
    // The deep-time cards start loading as soon as there is a place.
    deepTime.hidden = false;
    rockCard.setAttribute('aria-busy', 'true');
    rockBody.replaceChildren(renderSkeleton(2, 'Checking the geological map…'));
    paleoCard.setAttribute('aria-busy', 'true');
    paleoBody.replaceChildren(renderSkeleton(3, 'Asking the plate model…'));
    renderSources();
  };

  const setRings: StoryHandle['setRings'] = (next) => {
    rings = inRingOrder(next);
    renderStrip();
    renderCards();
    renderSources();
  };

  const setGeology: StoryHandle['setGeology'] = (unit, ageSentence) => {
    rockCard.removeAttribute('aria-busy');
    if (!unit) {
      geologySource = null;
      rockBody.replaceChildren(el('p', { class: 'muted' }, ['No geological map unit covers this exact spot.']));
      renderSources();
      return;
    }
    geologySource = unit.source;
    const title = el('p', { class: 'deep-card__lead' }, [
      el('strong', {}, [unit.name]),
      unit.symbol && unit.symbol !== unit.name ? el('span', { class: 'badge badge--mono' }, [unit.symbol]) : null,
    ]);
    const age = ageSentence ?? (unit.age ? `The survey dates it as ${unit.age}.` : undefined);
    rockBody.replaceChildren(
      title,
      ...(age ? [el('p', { class: 'deep-card__age' }, [age])] : []),
      ...(unit.description ? [el('p', { class: 'deep-card__text' }, [unit.description])] : []),
      el('p', { class: 'fact__source' }, ['From ', renderSourceLink(unit.source)]),
    );
    renderSources();
  };

  const setPaleo: StoryHandle['setPaleo'] = (items) => {
    paleoCard.removeAttribute('aria-busy');
    paleoSources = items.map((i) => i.source);
    if (items.length === 0) {
      paleoBody.replaceChildren(el('p', { class: 'muted' }, ['The plate model had nothing to say about this spot.']));
    } else {
      const list = el('ol', { class: 'paleo' });
      for (const item of items) {
        list.append(el('li', { class: 'paleo__item' }, [el('p', { class: 'paleo__text' }, [item.text]), el('p', { class: 'fact__source' }, ['From ', renderSourceLink(item.source)])]));
      }
      paleoBody.replaceChildren(list);
    }
    renderSources();
  };

  const setIceAge: StoryHandle['setIceAge'] = (fact) => {
    if (!fact) {
      iceSource = null;
      iceCard.hidden = true;
      iceBody.replaceChildren();
      iceTitle.textContent = '';
    } else {
      iceSource = fact.source;
      iceTitle.textContent = fact.title;
      iceBody.replaceChildren(el('p', { class: 'deep-card__text' }, [fact.body]), el('p', { class: 'fact__source' }, ['From ', renderSourceLink(fact.source)]));
      iceCard.hidden = false;
    }
    renderSources();
  };

  const setHero: StoryHandle['setHero'] = (text) => {
    hero.textContent = text;
    hero.hidden = text.trim().length === 0;
  };

  const setStatus: StoryHandle['setStatus'] = (text) => {
    // The live region stays in the DOM (hiding it would silence it); it is
    // just emptied, and CSS collapses it when it has no text.
    status.textContent = text ?? '';
  };

  const clear: StoryHandle['clear'] = () => {
    place = null;
    rings = [];
    geologySource = null;
    paleoSources = [];
    iceSource = null;
    activeLevel = null;
    for (const node of cardByLevel.values()) observer?.unobserve(node);
    cardByLevel.clear();
    chipByLevel.clear();
    caption.replaceChildren();
    setHero('');
    setStatus(null);
    stripList.replaceChildren();
    strip.hidden = true;
    cards.replaceChildren();
    cards.hidden = true;
    rockBody.replaceChildren();
    rockCard.removeAttribute('aria-busy');
    paleoBody.replaceChildren();
    paleoCard.removeAttribute('aria-busy');
    setIceAge(undefined);
    deepTime.hidden = true;
    sourcesList.replaceChildren();
    sources.hidden = true;
  };

  return { setPlace, setRings, setGeology, setPaleo, setIceAge, setHero, setStatus, clear, mapContainer };
}
