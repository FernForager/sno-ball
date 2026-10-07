/**
 * One card per ring: the heading ("House", "407 Broad Street"), the
 * concentric-rings glyph with this ring drawn bold, and then whatever the
 * ring's status calls for:
 *
 *   loading     a shimmering skeleton while the data sources answer
 *   rich/thin   the list of facts (title, year badge, body, source link)
 *   empty       one muted line saying why there is nothing to show
 *
 * Everything is built with DOM nodes and textContent, never innerHTML, so a
 * fact's text can hold any characters without becoming markup. The small
 * builders at the bottom (el, ringGlyph, renderFact, renderSourceLink,
 * renderSkeleton) are exported because the story page reuses them for the
 * deep-time cards and the sources footer.
 */

import type { Fact, Ring, RingLevel, Source } from '../lib/types';
import { RING_ORDER } from '../lib/types';
import { ago, formatReadout } from '../lib/time';
import { formatYear, ringLabel, ringTagline } from './format';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

type Child = Node | string | null | undefined;

/**
 * Make an element in one call: `el('p', { class: 'muted' }, 'Hello')`.
 * Attributes are set with setAttribute (so `class`, `aria-*` and `data-*`
 * all work); children may be nodes or strings, and strings become text
 * nodes, never HTML. Null or undefined children are skipped, which keeps
 * optional parts tidy at the call site.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string>> = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** The id the page gives each ring's card, so chips can scroll to it. */
export function cardId(level: RingLevel): string {
  return `ring-${level}`;
}

// ---------------------------------------------------------------------------
// The rings glyph
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const GLYPH_SIZE = 40;
const GLYPH_STEP = 2;

/**
 * Nine concentric circles, one per ring level from the house (innermost)
 * out to the plate, with the active level drawn bold and the rest faint.
 * It is decorative (aria-hidden) and uses currentColor, so it takes the
 * text colour of wherever it is placed and works in both themes. Width and
 * height come from CSS; the default is one line of text.
 */
export function ringGlyph(level: RingLevel): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`);
  svg.setAttribute('class', 'ring-glyph');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const active = RING_ORDER.indexOf(level);
  const centre = GLYPH_SIZE / 2;
  RING_ORDER.forEach((_, i) => {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(centre));
    circle.setAttribute('cy', String(centre));
    circle.setAttribute('r', String(GLYPH_STEP * (i + 1)));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('class', i === active ? 'ring-glyph__ring is-active' : 'ring-glyph__ring');
    circle.setAttribute('stroke-width', i === active ? '2.25' : '0.75');
    svg.append(circle);
  });
  return svg;
}

// ---------------------------------------------------------------------------
// Pieces of a card
// ---------------------------------------------------------------------------

/**
 * Where the text of each licence lives. The Creative Commons and Open Data
 * Commons licences all require a link to their terms next to the credit, so
 * the licence name becomes a link whenever we know the address.
 */
const LICENSE_URLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^cc\s*by-sa\s*4/i, 'https://creativecommons.org/licenses/by-sa/4.0/'],
  [/^cc\s*by-sa\s*3/i, 'https://creativecommons.org/licenses/by-sa/3.0/'],
  [/^cc\s*by\s*4/i, 'https://creativecommons.org/licenses/by/4.0/'],
  [/^cc\s*by\s*3/i, 'https://creativecommons.org/licenses/by/3.0/'],
  [/^cc0/i, 'https://creativecommons.org/publicdomain/zero/1.0/'],
  [/^odbl/i, 'https://opendatacommons.org/licenses/odbl/1-0/'],
  [/^pddl/i, 'https://opendatacommons.org/licenses/pddl/1-0/'],
];

/** The address of a licence's terms, or undefined for ones we do not know (e.g. "Public record"). */
export function licenseUrl(license: string): string | undefined {
  const text = license.trim();
  return LICENSE_URLS.find(([pattern]) => pattern.test(text))?.[1];
}

/**
 * A link to where a fact came from: the source name linked to its URL,
 * with the licence after it when one is given, itself linked to the
 * licence text when it is a Creative Commons or Open Data Commons one.
 * Opens in a new tab with rel="noopener" so the story page keeps its place.
 */
export function renderSourceLink(source: Source): HTMLElement {
  const link = el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, [source.name]);
  const children: Child[] = [link];
  if (source.license) {
    const terms = licenseUrl(source.license);
    const name: Child = terms
      ? el('a', { href: terms, target: '_blank', rel: 'license noopener noreferrer' }, [source.license])
      : source.license;
    children.push(el('span', { class: 'source__license' }, [' · ', name]));
  }
  return el('span', { class: 'source' }, children);
}

/** True when the licence asks for share-alike attribution (Wikipedia prose). */
function isShareAlike(source: Source): boolean {
  return /by-sa/i.test(source.license ?? '');
}

/** The small badge text for a fact's date, or undefined when it has none. */
function badgeText(fact: Fact): string | undefined {
  if (typeof fact.year === 'number' && Number.isFinite(fact.year)) return formatYear(fact.year);
  if (typeof fact.yearsAgo === 'number' && Number.isFinite(fact.yearsAgo) && fact.yearsAgo >= 0) {
    return formatReadout(ago(fact.yearsAgo));
  }
  return undefined;
}

const CONFIDENCE_WORD: Readonly<Record<'medium' | 'low', string>> = {
  medium: 'inferred',
  low: 'best guess',
};

/**
 * One fact as a list item: the title and its year badge on the first line,
 * then the body, then the source. The badge is left out when the title
 * already says the year ("Built in 1961" needs no "1961" beside it). A body
 * under a share-alike licence (Wikipedia) is rendered as a quotation so the
 * excerpt is visibly theirs, not ours. Facts that are inferred or guessed
 * carry a small word saying so.
 */
export function renderFact(fact: Fact): HTMLElement {
  const head = el('div', { class: 'fact__head' }, [el('span', { class: 'fact__title' }, [fact.title])]);
  const badge = badgeText(fact);
  if (badge && !fact.title.includes(badge)) head.append(el('span', { class: 'badge' }, [badge]));
  if (fact.confidence === 'medium' || fact.confidence === 'low') {
    head.append(el('span', { class: 'fact__confidence' }, [CONFIDENCE_WORD[fact.confidence]]));
  }

  const item = el('li', { class: 'fact', 'data-kind': fact.kind }, [head]);
  if (fact.body) {
    item.append(
      isShareAlike(fact.source)
        ? el('blockquote', { class: 'fact__quote', cite: fact.source.url }, [el('p', {}, [fact.body])])
        : el('p', { class: 'fact__body' }, [fact.body]),
    );
  }
  item.append(el('p', { class: 'fact__source' }, ['From ', renderSourceLink(fact.source)]));
  return item;
}

/**
 * A shimmering placeholder of `lines` grey bars for a card that is still
 * loading. The bars are decorative; screen readers get the `label` text
 * instead, and the card itself is marked aria-busy by its caller.
 */
export function renderSkeleton(lines = 3, label = 'Looking this up…'): HTMLElement {
  const bars = el('div', { class: 'skeleton', 'aria-hidden': 'true' });
  for (let i = 0; i < lines; i += 1) bars.append(el('span', { class: 'skeleton__line' }));
  return el('div', { class: 'skeleton-wrap' }, [bars, el('span', { class: 'visually-hidden' }, [label])]);
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/**
 * Build the card for one ring. The card is an <article> with the id
 * `ring-<level>` and tabindex -1 so the ring strip can scroll to it and
 * move focus there; its heading is the ring's name. The body follows the
 * ring's status: a skeleton while loading, the facts when there are any,
 * and the ring's note (or a generic line) when it is empty. A note on a
 * ring that does have facts is shown under them. An empty ring gets a
 * compact card (class `ring-card--compact`): outside Seattle the house,
 * block and street have no data source yet, and three tall empty cards
 * would push the real story off the screen.
 */
export function renderRingCard(ring: Ring): HTMLElement {
  const nameId = `${cardId(ring.level)}-name`;
  const card = el('article', {
    class: `ring-card is-${ring.status}${ring.status === 'empty' ? ' ring-card--compact' : ''}`,
    id: cardId(ring.level),
    'data-level': ring.level,
    tabindex: '-1',
    'aria-labelledby': nameId,
  });

  const eyebrow = el('p', { class: 'eyebrow' }, [
    el('span', { class: 'eyebrow__level' }, [ringLabel(ring.level)]),
    el('span', { class: 'eyebrow__tag' }, [ringTagline(ring.level)]),
  ]);
  const heading = el('h2', { class: 'ring-card__name', id: nameId }, [ring.name]);
  card.append(el('header', { class: 'ring-card__head' }, [ringGlyph(ring.level), el('div', {}, [eyebrow, heading])]));

  const body = el('div', { class: 'ring-card__body' });
  switch (ring.status) {
    case 'loading':
      card.setAttribute('aria-busy', 'true');
      body.append(renderSkeleton());
      break;
    case 'rich':
    case 'thin': {
      const list = el('ul', { class: 'facts' });
      for (const fact of ring.facts) list.append(renderFact(fact));
      body.append(list);
      if (ring.note) body.append(el('p', { class: 'ring-card__note muted' }, [ring.note]));
      break;
    }
    case 'empty':
      body.append(el('p', { class: 'ring-card__note muted' }, [ring.note ?? 'Nothing on record for this yet.']));
      break;
  }
  card.append(body);
  return card;
}
