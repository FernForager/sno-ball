/**
 * The time dial: a bottom sheet that lets the visitor move the story
 * through time, one stop at a time.
 *
 * Collapsed (96 px) it shows the current stop's readout in large type with
 * ◀ and ▶ on either side, a line under it (the chapter's teaser, or the
 * name of the gear we are in), a "Now" button and a chevron that opens
 * the sheet. Expanded, it adds the "Chapters" list (one button per named
 * stop) and a "Jump to a time" box that understands "1889", "15,000 BCE",
 * "17,000 years ago" or "16 Ma".
 *
 * The dial owns no time logic. The page hands it the full list of stops,
 * the named stops (the chapters), a function that gives each gear its
 * tint, and a parser for the jump box; it reports every move through
 * `onChange`. The stop model is the sibling module `src/lib/stops.ts`; the
 * interfaces below describe the shapes this file needs from it, so it
 * typechecks on its own.
 *
 *   ◀ / ▶ (and ← / →)   step to the previous or next chapter
 *   long press           keeps stepping every 350 ms
 *   Now (and Home)       back to the 'now' stop
 *   Escape               closes the sheet
 *
 * The readout is an aria-live region, so a screen reader hears each move.
 * When a move crosses from one gear into another the phone buzzes for
 * 10 ms (where the browser allows), and the page's `--era-tint` variable
 * changes to the new gear's colour. Everything is built with DOM nodes
 * and text, never innerHTML.
 */

import { el } from './ring-card';
import './dial.css';

// ---------------------------------------------------------------------------
// Shapes shared with src/lib/stops.ts
// ---------------------------------------------------------------------------

/** The gears of the dial, from the present back to the deep past, plus one step forward. */
export type Gear = 'now' | 'years' | 'decades' | 'centuries' | 'millennia' | 'ice-ages' | 'millions' | 'eons' | 'future';

/** One position of the dial. `index` is its place in the full list. */
export interface Stop {
  index: number;
  gear: Gear;
  /** The long readout, e.g. "15,000 BCE (about 17,000 years ago)". */
  readout: string;
  /** The short readout, e.g. "15,000 BCE". */
  short: string;
}

/** A chapter: a named stop that ◀ ▶ step between. Always one of the stops. */
export interface NamedStop {
  index: number;
  /** A few words naming the chapter, e.g. "Statehood". */
  label: string;
  /** The readout to show while on it, e.g. "1889 · Statehood and the great fires". */
  readout: string;
  /** One line of context under the readout. */
  teaser: string;
}

/** A gear's background colour in each theme. Any CSS colour value. */
export interface GearTint {
  light: string;
  dark: string;
}

/** Where a change came from, so the page can decide what to animate. */
export type DialSource = 'step' | 'named' | 'jump' | 'keyboard' | 'init';

export interface DialOptions {
  /** Every stop, in index order. */
  stops: readonly Stop[];
  /** The chapters, each a member of `stops`. */
  namedStops: readonly NamedStop[];
  /** The tint for a gear, in both themes. */
  gearTint(gear: Gear): GearTint;
  /** Understand typed text ("1889", "66 Ma"); null when it makes no sense. */
  parseAt(text: string): Stop | null;
  /** Called on every move, including once at mount with source 'init'. */
  onChange(stop: Stop, source: DialSource): void;
  /** The stop to start on; defaults to the 'now' stop. */
  initialIndex?: number;
}

export interface DialHandle {
  /** Move to a stop. With `silent` the page is not told (for restoring a URL). */
  setIndex(i: number, silent?: boolean): void;
  /** The index of the current stop. */
  getIndex(): number;
  /** Remove the sheet and every listener; the page's tint variables are cleared. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in plain Node)
// ---------------------------------------------------------------------------

/**
 * The chapter on one side of the current position: with `dir` +1 the
 * named stop with the smallest index above `currentIndex`, with -1 the
 * one with the largest index below it. Past the last chapter in that
 * direction the answer is that last chapter itself, so stepping at the
 * end of the dial stays put instead of wrapping. The current index need
 * not be a chapter: from a stop between two chapters, +1 and -1 give the
 * two neighbours. The list may be in any order. Throws when there are no
 * named stops at all, since there is then nothing to answer with.
 */
export function namedNeighbour(namedStops: readonly NamedStop[], currentIndex: number, dir: -1 | 1): NamedStop {
  if (namedStops.length === 0) throw new RangeError('namedNeighbour needs at least one named stop');
  const sorted = [...namedStops].sort((a, b) => a.index - b.index);
  if (dir > 0) {
    const next = sorted.find((s) => s.index > currentIndex);
    return next ?? sorted[sorted.length - 1]!;
  }
  const previous = [...sorted].reverse().find((s) => s.index < currentIndex);
  return previous ?? sorted[0]!;
}

/** Does moving from `a` to `b` cross into another gear? */
export function isGearChange(a: Stop, b: Stop): boolean {
  return a.gear !== b.gear;
}

/**
 * The text to show for a stop: the chapter's own readout when `named` is
 * that very stop (same index), otherwise the stop's readout.
 */
export function readoutFor(stop: Stop, named?: NamedStop): string {
  return named !== undefined && named.index === stop.index ? named.readout : stop.readout;
}

// ---------------------------------------------------------------------------
// Bits of wording
// ---------------------------------------------------------------------------

/** What the line under the readout says while not on a chapter. */
const GEAR_WORDS: Readonly<Record<Gear, string>> = {
  now: 'The present day',
  years: 'Year by year',
  decades: 'Decade by decade',
  centuries: 'Century by century',
  millennia: 'A thousand years at a time',
  'ice-ages': 'The ice ages',
  millions: 'Millions of years ago',
  eons: 'Deep time',
  future: 'The future',
};

export const JUMP_ERROR = "I don't understand that time";
const REPEAT_MS = 350;
const EXPAND_LABEL = 'Show chapters';
const COLLAPSE_LABEL = 'Hide chapters';

let mountCount = 0;

/** Does the visitor want instant moves instead of animation? */
function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** A short buzz on phones that support it; silently nothing elsewhere. */
function buzz(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10);
  } catch {
    // Some browsers throw when vibration is blocked; the buzz is a nicety.
  }
}

/** The chevron on the expand button, drawn in the text colour. */
function chevron(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'dial__chevron');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 15 L12 7 L20 15');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/**
 * Mount the dial into `root` (the sheet is fixed to the bottom of the
 * viewport wherever `root` sits) and return its handle. `onChange` is
 * called once straight away with source 'init' so the page can draw the
 * starting stop.
 */
export function mountDial(root: HTMLElement, opts: DialOptions): DialHandle {
  const { stops, namedStops, gearTint, parseAt, onChange } = opts;
  if (stops.length === 0) throw new RangeError('mountDial needs at least one stop');

  mountCount += 1;
  const uid = `dial-${mountCount}`;
  const panelId = `${uid}-panel`;
  const chaptersTitleId = `${uid}-chapters`;
  const inputId = `${uid}-jump`;
  const errorId = `${uid}-error`;

  // --- The stop model, read-only from here --------------------------------
  const byIndex = new Map<number, Stop>();
  for (const stop of stops) byIndex.set(stop.index, stop);
  const namedByIndex = new Map<number, NamedStop>();
  for (const named of namedStops) namedByIndex.set(named.index, named);
  const sortedNamed = [...namedStops].sort((a, b) => a.index - b.index);

  const nowStop = stops.find((s) => s.gear === 'now') ?? stops[0]!;
  // Which way is the past? The stop list may run either way, so look at
  // where a past stop sits relative to 'now'. ◀ always means earlier.
  const somePast = stops.find((s) => s.gear !== 'now' && s.gear !== 'future');
  const pastDir: -1 | 1 = somePast !== undefined && somePast.index < nowStop.index ? -1 : 1;
  const futureDir: -1 | 1 = pastDir === 1 ? -1 : 1;

  /** The stop at an index, or the nearest one when that index is not a stop. */
  const stopAt = (i: number): Stop => {
    const exact = byIndex.get(i);
    if (exact) return exact;
    let best = stops[0]!;
    for (const s of stops) if (Math.abs(s.index - i) < Math.abs(best.index - i)) best = s;
    return best;
  };

  let current: Stop = stopAt(opts.initialIndex ?? nowStop.index);

  // --- The collapsed bar ---------------------------------------------------
  const readoutText = el('span', { class: 'dial__readout-text' });
  const readout = el('div', { class: 'dial__readout', 'aria-live': 'polite', 'aria-atomic': 'true' }, [readoutText]);
  const earlier = el('button', { type: 'button', class: 'dial__step dial__step--earlier', 'aria-label': 'Earlier chapter' }, ['◀']);
  const later = el('button', { type: 'button', class: 'dial__step dial__step--later', 'aria-label': 'Later chapter' }, ['▶']);
  const topRow = el('div', { class: 'dial__row dial__row--readout' }, [earlier, readout, later]);

  const teaser = el('p', { class: 'dial__teaser muted' });
  const nowButton = el('button', { type: 'button', class: 'dial__now', 'aria-label': 'Back to now' }, ['Now']);
  const toggle = el('button', { type: 'button', class: 'dial__toggle', 'aria-expanded': 'false', 'aria-controls': panelId, 'aria-label': EXPAND_LABEL }, [chevron()]);
  const bottomRow = el('div', { class: 'dial__row dial__row--meta' }, [teaser, nowButton, toggle]);

  const bar = el('div', { class: 'dial__bar' }, [topRow, bottomRow]);

  // --- The expanded panel --------------------------------------------------
  const chapterButtons = new Map<number, HTMLButtonElement>();
  const chapterList = el('ol', { class: 'dial__chapters', 'aria-labelledby': chaptersTitleId });
  for (const named of sortedNamed) {
    // The headline readout usually already holds the teaser ("1889 ·
    // Statehood and the great fires"), so each row prints each part once:
    // the label, then the teaser (or the readout when it says more), and
    // the teaser on its own only when the readout left it out.
    const body = named.teaser && named.readout.includes(named.teaser) ? named.teaser : named.readout;
    const extra = named.teaser && body !== named.teaser && !body.includes(named.teaser) ? named.teaser : null;
    const button = el('button', { type: 'button', class: 'dial__chapter', 'data-index': String(named.index) }, [
      el('span', { class: 'dial__chapter-label' }, [named.label]),
      body !== named.label ? el('span', { class: 'dial__chapter-readout' }, [body]) : null,
      extra ? el('span', { class: 'dial__chapter-teaser muted' }, [extra]) : null,
    ]);
    button.addEventListener('click', () => {
      moveTo(named.index, 'named');
    });
    chapterButtons.set(named.index, button);
    chapterList.append(el('li', {}, [button]));
  }

  const input = el('input', {
    id: inputId,
    class: 'dial__input',
    type: 'text',
    name: 'at',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    placeholder: '1889, 15,000 BCE, 16 Ma',
    'aria-describedby': errorId,
  });
  const go = el('button', { type: 'submit', class: 'button dial__go' }, ['Go']);
  const error = el('p', { id: errorId, class: 'dial__error', 'aria-live': 'polite', hidden: '' });
  const jump = el('form', { class: 'dial__jump' }, [
    el('label', { for: inputId, class: 'dial__jump-label' }, ['Jump to a time']),
    el('div', { class: 'dial__jump-row' }, [input, go]),
    error,
  ]);

  const panel = el('div', { id: panelId, class: 'dial__panel', hidden: '' }, [
    el('h2', { id: chaptersTitleId, class: 'dial__title' }, ['Chapters']),
    chapterList,
    jump,
  ]);

  const sheet = el('section', { class: 'dial', role: 'region', 'aria-label': 'Time' }, [bar, panel]);

  // --- Rendering -----------------------------------------------------------
  const setError = (msg: string | null): void => {
    if (msg) {
      error.textContent = msg;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else {
      error.textContent = '';
      error.hidden = true;
      input.removeAttribute('aria-invalid');
    }
  };

  /** Hand the page's root the current gear's colours. */
  const applyTint = (gear: Gear): void => {
    const tint = gearTint(gear);
    const html = document.documentElement;
    html.style.setProperty('--era-tint-light', tint.light);
    html.style.setProperty('--era-tint-dark', tint.dark);
    html.setAttribute('data-era-gear', gear);
    sheet.setAttribute('data-gear', gear);
  };

  const render = (): void => {
    const named = namedByIndex.get(current.index);
    const text = readoutFor(current, named);
    readoutText.textContent = text;
    // The line under the readout: the chapter's teaser, unless the readout
    // already says it, in which case the gear we are in.
    teaser.textContent = named?.teaser && !text.includes(named.teaser) ? named.teaser : GEAR_WORDS[current.gear];
    sheet.setAttribute('data-named', named ? 'true' : 'false');

    for (const [index, button] of chapterButtons) {
      if (index === current.index) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }

    // Grey out an arrow with nothing beyond it.
    const atEarliest = sortedNamed.length === 0 || namedNeighbour(sortedNamed, current.index, pastDir).index === current.index;
    const atLatest = sortedNamed.length === 0 || namedNeighbour(sortedNamed, current.index, futureDir).index === current.index;
    if (atEarliest) earlier.setAttribute('aria-disabled', 'true');
    else earlier.removeAttribute('aria-disabled');
    if (atLatest) later.setAttribute('aria-disabled', 'true');
    else later.removeAttribute('aria-disabled');
    if (current.index === nowStop.index) nowButton.setAttribute('aria-disabled', 'true');
    else nowButton.removeAttribute('aria-disabled');
  };

  /** Move the dial, then tell the page (unless silent). */
  const moveTo = (index: number, source: DialSource, silent = false): void => {
    const next = stopAt(index);
    const changedGear = isGearChange(current, next);
    const moved = next.index !== current.index;
    current = next;
    if (changedGear) {
      applyTint(next.gear);
      if (moved && source !== 'init') buzz();
    }
    render();
    if (!silent) onChange(next, source);
  };

  /** Step one chapter earlier (dir -1 on the ◀ side) or later. */
  const step = (side: 'earlier' | 'later', source: DialSource): void => {
    if (sortedNamed.length === 0) return;
    const next = namedNeighbour(sortedNamed, current.index, side === 'earlier' ? pastDir : futureDir);
    if (next.index !== current.index) moveTo(next.index, source);
  };

  // --- Expand / collapse ---------------------------------------------------
  let expanded = false;
  const setExpanded = (open: boolean): void => {
    expanded = open;
    panel.hidden = !open;
    sheet.classList.toggle('is-expanded', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? COLLAPSE_LABEL : EXPAND_LABEL);
    if (open) {
      const row = chapterButtons.get(current.index);
      if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  };

  // --- Listeners -----------------------------------------------------------
  type Off = () => void;
  const offs: Off[] = [];
  const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (ev: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
    target.addEventListener(type, fn as EventListener, options);
    offs.push(() => target.removeEventListener(type, fn as EventListener, options));
  };

  /**
   * ◀ ▶: a tap steps once; holding the button down keeps stepping every
   * 350 ms. The pointer handlers do the stepping for mouse and touch, and
   * swallow the click the browser fires afterwards; keyboard activation
   * (Enter, Space) has no pointer events, so its click steps as normal.
   */
  const wireStepper = (button: HTMLButtonElement, side: 'earlier' | 'later'): void => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let repeat: ReturnType<typeof setInterval> | null = null;
    let swallowClick = false;

    const stopRepeating = (): void => {
      if (timer !== null) clearTimeout(timer);
      if (repeat !== null) clearInterval(repeat);
      timer = null;
      repeat = null;
      button.classList.remove('is-pressed');
    };

    on(button, 'pointerdown', (ev) => {
      if (ev.button !== 0) return;
      swallowClick = true;
      button.classList.add('is-pressed');
      step(side, 'step');
      timer = setTimeout(() => {
        repeat = setInterval(() => step(side, 'step'), REPEAT_MS);
      }, REPEAT_MS);
    });
    const release = (): void => {
      stopRepeating();
      // The click (if any) lands in this same task; after that, forget it.
      setTimeout(() => {
        swallowClick = false;
      }, 0);
    };
    on(button, 'pointerup', release);
    on(button, 'pointercancel', release);
    on(button, 'pointerleave', release);
    on(button, 'click', () => {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      step(side, 'step');
    });
    // A long press on a phone would otherwise open the text-selection menu.
    on(button, 'contextmenu', (ev) => ev.preventDefault());
    offs.push(stopRepeating);
  };
  wireStepper(earlier, 'earlier');
  wireStepper(later, 'later');

  on(nowButton, 'click', () => moveTo(nowStop.index, 'step'));
  on(toggle, 'click', () => setExpanded(!expanded));

  on(jump, 'submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) {
      setError(JUMP_ERROR);
      input.focus();
      return;
    }
    const stop = parseAt(text);
    if (!stop) {
      setError(JUMP_ERROR);
      input.focus();
      return;
    }
    setError(null);
    moveTo(stop.index, 'jump');
    setExpanded(false);
    toggle.focus();
  });
  on(input, 'input', () => {
    if (!error.hidden) setError(null);
  });

  // Keys work anywhere inside the sheet, except that the text box keeps
  // its own arrows and Home (they move the caret there).
  on(sheet, 'keydown', (ev) => {
    const inText = ev.target === input;
    switch (ev.key) {
      case 'ArrowLeft':
        if (inText) return;
        ev.preventDefault();
        step('earlier', 'keyboard');
        break;
      case 'ArrowRight':
        if (inText) return;
        ev.preventDefault();
        step('later', 'keyboard');
        break;
      case 'Home':
        if (inText) return;
        ev.preventDefault();
        moveTo(nowStop.index, 'keyboard');
        break;
      case 'Escape':
        if (!expanded) return;
        ev.preventDefault();
        setExpanded(false);
        toggle.focus();
        break;
      default:
        return;
    }
  });

  // --- Mount ---------------------------------------------------------------
  root.replaceChildren(sheet);
  document.body.classList.add('has-dial');
  applyTint(current.gear);
  render();
  onChange(current, 'init');

  return {
    setIndex(i, silent = false) {
      moveTo(i, 'jump', silent);
    },
    getIndex() {
      return current.index;
    },
    destroy() {
      for (const off of offs) off();
      offs.length = 0;
      sheet.remove();
      document.body.classList.remove('has-dial');
      const html = document.documentElement;
      html.style.removeProperty('--era-tint-light');
      html.style.removeProperty('--era-tint-dark');
      html.removeAttribute('data-era-gear');
    },
  };
}
