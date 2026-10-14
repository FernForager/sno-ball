/**
 * The paleo globe: where the visitor's spot sat millions of years ago.
 *
 * For the Millions and Eons gears (and the Future stop) a street map means
 * nothing, so the map panel shows a small globe instead: a sphere drawn in
 * SVG with a graticule every 30°, the equator a little bolder, today's
 * position as a hollow dot and the reconstructed position (from GPlates,
 * see paleo.ts) as a filled dot. The globe is turned so the past position
 * is in the middle.
 *
 * The Future stop has no model behind it, only the trend (the Pacific plate
 * carries the coast north-west a few centimetres a year). For that we draw
 * today's dot nudged about 9° west and 1° south with a dashed arrow and
 * say in words that it is a sketch, not a model.
 *
 * No library: an orthographic projection is a few lines of trigonometry,
 * and the whole thing is plain DOM so it works wherever the page does.
 * The projection helper is exported so it can be tested without a browser.
 */

import type { LngLat } from '../lib/types';

export interface GlobeOptions {
  /** The present-day position of the spot. */
  todayPoint: LngLat;
  /**
   * Where the spot sat `ma` million years ago. `null` when the model was
   * asked and had no answer (the drawing then says so); left out while the
   * answer is still on its way, so nothing is claimed either way.
   */
  paleoPoint?: LngLat | null;
  /** Millions of years ago (or ahead, for the sketch). */
  ma: number;
  /** One line under the globe, e.g. "Your spot was here, at 12° N (MERDITH2021)". */
  caption: string;
  /** true for the Future stop: a sketch of the trend instead of a model. */
  sketch?: boolean;
}

/** A point on the drawing: `visible` is false when it is on the far side of the globe. */
export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

/** The size of the drawing. The globe fills the top square; text sits below. */
export const GLOBE_SIZE = 320;
export const GLOBE_RADIUS = 140;
export const GLOBE_CENTER_X = GLOBE_SIZE / 2;
export const GLOBE_CENTER_Y = GLOBE_SIZE / 2;

/** How far the Future sketch nudges today's point: about 9° west and 1° south. */
export const SKETCH_SHIFT: Readonly<LngLat> = { lng: -9, lat: -1 };

const SVG_NS = 'http://www.w3.org/2000/svg';

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Orthographic projection: the view of a globe from far away, turned so
 * `center` is in the middle. Returns drawing coordinates (y grows
 * downward, as in SVG) and whether the point faces the viewer. A point
 * exactly on the rim counts as visible.
 */
export function projectOrthographic(
  point: LngLat,
  center: LngLat,
  radius: number = GLOBE_RADIUS,
  cx: number = GLOBE_CENTER_X,
  cy: number = GLOBE_CENTER_Y,
): Projected {
  const lambda = rad(point.lng);
  const phi = rad(point.lat);
  const lambda0 = rad(center.lng);
  const phi0 = rad(center.lat);
  const dl = lambda - lambda0;
  const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(dl);
  const x = radius * Math.cos(phi) * Math.sin(dl);
  const y = radius * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(dl));
  return { x: cx + x, y: cy - y, visible: cosc >= -1e-9 };
}

/**
 * The centre of the view: the paleo point's longitude when there is one,
 * today's otherwise, always on the equator so the globe reads upright.
 */
export function globeCenterFor(opts: Pick<GlobeOptions, 'todayPoint' | 'paleoPoint' | 'sketch'>): LngLat {
  const lng = !opts.sketch && opts.paleoPoint ? opts.paleoPoint.lng : opts.todayPoint.lng;
  return { lng, lat: 0 };
}

/** Today's point nudged for the Future sketch, longitude folded into -180..180. */
export function sketchPoint(today: LngLat): LngLat {
  let lng = today.lng + SKETCH_SHIFT.lng;
  if (lng < -180) lng += 360;
  if (lng > 180) lng -= 360;
  const lat = Math.max(-90, Math.min(90, today.lat + SKETCH_SHIFT.lat));
  return { lng, lat };
}

/** The label over the dot: "Your spot, 100 Ma ago" or, for the sketch, "Your spot, 50 Ma from now". */
export function globeLabel(ma: number, sketch: boolean): string {
  const n = Math.abs(ma).toLocaleString('en-US');
  return sketch ? `Your spot, ${n} Ma from now` : `Your spot, ${n} Ma ago`;
}

/**
 * An SVG path along a line of points, broken wherever it passes behind the
 * globe. Points are projected one by one; a visible point after a hidden
 * one starts a new sub-path.
 */
export function pathOnGlobe(points: readonly LngLat[], center: LngLat): string {
  let d = '';
  let drawing = false;
  for (const p of points) {
    const q = projectOrthographic(p, center);
    if (!q.visible) {
      drawing = false;
      continue;
    }
    d += `${drawing ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    drawing = true;
  }
  return d;
}

/** The points of a meridian (constant longitude), pole to pole, every `step` degrees. */
function meridian(lng: number, step = 5): LngLat[] {
  const out: LngLat[] = [];
  for (let lat = -90; lat <= 90; lat += step) out.push({ lng, lat });
  return out;
}

/** The points of a parallel (constant latitude), all the way round, every `step` degrees. */
function parallel(lat: number, step = 5): LngLat[] {
  const out: LngLat[] = [];
  for (let lng = -180; lng <= 180; lng += step) out.push({ lng, lat });
  return out;
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function text(x: number, y: number, content: string, attrs: Record<string, string> = {}): SVGTextElement {
  const el = svgEl('text', { x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': 'middle', ...attrs });
  el.textContent = content;
  return el;
}

/** Place a label above a dot, kept inside the drawing. */
function labelAbove(p: Projected, content: string, cls: string): SVGTextElement {
  const x = Math.max(60, Math.min(GLOBE_SIZE - 60, p.x));
  const y = p.y < 28 ? p.y + 20 : p.y - 12;
  return text(x, y, content, { class: cls, 'font-size': '12', fill: 'currentColor' });
}

/**
 * Draw the globe into `container`, replacing whatever was there. The
 * drawing is an `<svg role="img">` with a spoken description, followed by
 * a `<p>` with the caption (and, for the sketch, the "not a model" note).
 */
export function renderGlobe(container: HTMLElement, opts: GlobeOptions): void {
  const sketch = opts.sketch === true;
  const center = globeCenterFor(opts);
  const label = globeLabel(opts.ma, sketch);

  const svg = svgEl('svg', {
    class: 'globe',
    viewBox: `0 0 ${GLOBE_SIZE} ${GLOBE_SIZE}`,
    width: '100%',
    role: 'img',
    'aria-label': `${label}. ${opts.caption}`,
  });

  // The sphere.
  svg.appendChild(
    svgEl('circle', {
      class: 'globe-sphere',
      cx: String(GLOBE_CENTER_X),
      cy: String(GLOBE_CENTER_Y),
      r: String(GLOBE_RADIUS),
      fill: '#eef3f7',
      stroke: 'currentColor',
      'stroke-width': '1',
    }),
  );

  // The graticule: meridians every 30°, parallels every 30°, equator bolder.
  const grat = svgEl('g', { class: 'globe-graticule', fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.25', 'stroke-width': '0.6' });
  for (let lng = -180; lng < 180; lng += 30) {
    grat.appendChild(svgEl('path', { d: pathOnGlobe(meridian(lng), center) }));
  }
  for (const lat of [-60, -30, 30, 60]) {
    grat.appendChild(svgEl('path', { d: pathOnGlobe(parallel(lat), center) }));
  }
  svg.appendChild(grat);
  svg.appendChild(
    svgEl('path', {
      class: 'globe-equator',
      d: pathOnGlobe(parallel(0), center),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-opacity': '0.6',
      'stroke-width': '1.2',
    }),
  );

  const today = projectOrthographic(opts.todayPoint, center);

  if (sketch) {
    // The Future sketch: today's dot, a dashed arrow, and the nudged dot.
    const future = projectOrthographic(sketchPoint(opts.todayPoint), center);
    const defs = svgEl('defs', {});
    const marker = svgEl('marker', {
      id: 'globe-arrowhead',
      viewBox: '0 0 10 10',
      refX: '8',
      refY: '5',
      markerWidth: '6',
      markerHeight: '6',
      orient: 'auto-start-reverse',
    });
    marker.appendChild(svgEl('path', { d: 'M0 0L10 5L0 10z', fill: 'currentColor' }));
    defs.appendChild(marker);
    svg.appendChild(defs);
    if (today.visible && future.visible) {
      svg.appendChild(
        svgEl('line', {
          class: 'globe-arrow',
          x1: today.x.toFixed(1),
          y1: today.y.toFixed(1),
          x2: future.x.toFixed(1),
          y2: future.y.toFixed(1),
          stroke: 'currentColor',
          'stroke-width': '1.5',
          'stroke-dasharray': '4 3',
          'marker-end': 'url(#globe-arrowhead)',
        }),
      );
    }
    if (today.visible) svg.appendChild(hollowDot(today));
    if (future.visible) {
      svg.appendChild(filledDot(future));
      svg.appendChild(labelAbove(future, label, 'globe-label'));
    }
  } else {
    const paleo = opts.paleoPoint ? projectOrthographic(opts.paleoPoint, center) : null;
    if (today.visible) svg.appendChild(hollowDot(today));
    if (paleo && paleo.visible) {
      svg.appendChild(filledDot(paleo));
      svg.appendChild(labelAbove(paleo, label, 'globe-label'));
    } else if (opts.paleoPoint === null) {
      svg.appendChild(
        text(GLOBE_CENTER_X, GLOBE_SIZE - 12, `No model position for ${Math.abs(opts.ma).toLocaleString('en-US')} Ma`, {
          class: 'globe-label',
          'font-size': '12',
          fill: 'currentColor',
        }),
      );
    }
  }

  const caption = document.createElement('p');
  caption.className = 'globe-caption';
  caption.textContent = opts.caption;
  if (sketch) {
    const note = document.createElement('span');
    note.className = 'globe-note';
    note.textContent = ' A sketch, not a model.';
    caption.appendChild(note);
  }

  container.replaceChildren(svg, caption);
}

/** Today's position: a hollow ring. */
function hollowDot(p: Projected): SVGCircleElement {
  return svgEl('circle', {
    class: 'globe-dot-today',
    cx: p.x.toFixed(1),
    cy: p.y.toFixed(1),
    r: '5',
    fill: 'none',
    stroke: '#c2410c',
    'stroke-width': '2',
  });
}

/** The reconstructed (or sketched) position: a solid dot. */
function filledDot(p: Projected): SVGCircleElement {
  return svgEl('circle', {
    class: 'globe-dot-then',
    cx: p.x.toFixed(1),
    cy: p.y.toFixed(1),
    r: '5.5',
    fill: '#c2410c',
    stroke: '#fff',
    'stroke-width': '1.5',
  });
}
