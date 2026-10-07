/**
 * The present-day map: a small MapLibre map that shows where the visitor's
 * spot is, and zooms in or out as they move between rings (house, block,
 * street, ... state, plate).
 *
 * What this module promises the rest of the site:
 *
 *   createStoryMap(container)  builds the map inside an element and resolves
 *                              with a StoryMap; rejects with MapUnavailableError
 *                              when the browser cannot draw it (no WebGL)
 *   storyMap.showPlace(p)      drops the one marker on the place and flies there
 *   storyMap.setRingHighlight  eases the camera to the zoom that fits a ring
 *   storyMap.destroy()         tears everything down (for a new search or page)
 *
 * Design notes, in plain words:
 *
 *  - The map tiles come from OpenFreeMap (free, no API key). The style we use
 *    is "positron", a quiet grey basemap that lets our marker and rings stand
 *    out. OpenFreeMap and OpenStreetMap must stay credited, so we add the
 *    credit line ourselves (the style file does not carry one).
 *  - MapLibre is big (hundreds of kilobytes). We load it only when
 *    createStoryMap is called, with a dynamic import, so the search box and
 *    the story text never wait for it. Nothing in this file runs MapLibre
 *    code at import time.
 *  - People who ask their system for less motion (prefers-reduced-motion)
 *    get an instant jump instead of a flight or an ease.
 *  - On touch screens the map uses "cooperative gestures": one finger scrolls
 *    the page, two fingers move the map. Otherwise a tall map would trap the
 *    visitor's thumb and they could never scroll past it.
 */

import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre parses tiles in a Web Worker. It normally finds that worker file
// next to its own script, but a bundled site has no such file, so Vite is
// asked for the worker's URL here (the `?url` suffix makes Vite copy the
// file into the build and hand back its address) and MapLibre is told it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Map as MapLibreMap, Marker, MapOptions, Subscription } from 'maplibre-gl';
import type { LngLat, RingLevel } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** OpenFreeMap's "positron" style: light grey basemap, no key needed. */
export const POSITRON_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/**
 * Credit line shown in the map's corner. The positron style JSON carries no
 * attribution of its own, so without this the map would be silent about
 * where its data comes from. OpenFreeMap asks for these three links, and the
 * OpenStreetMap one uses the wording the OSM Foundation asks for.
 */
export const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

/**
 * How far in to zoom for each ring. Smaller rings need a closer view:
 * 17 shows one lot, 11 shows a whole city, 2 shows the continent.
 */
export const RING_ZOOM: Readonly<Record<RingLevel, number>> = {
  house: 17,
  block: 16,
  street: 15.5,
  neighborhood: 14,
  city: 11,
  county: 9,
  region: 7.5,
  state: 6,
  plate: 2,
};

/** Where the map looks before any address is searched: the whole of Washington. */
export const WASHINGTON_VIEW: { readonly center: LngLat; readonly zoom: number } = {
  center: { lng: -120.6, lat: 47.4 },
  zoom: 5.5,
};

/** Marker colour: a warm orange that reads well on the grey positron style. */
export const MARKER_COLOR = '#c2410c';

/** Timing for the ring-to-ring ease, in milliseconds. */
export const BASE_EASE_MS = 500;
export const PER_ZOOM_LEVEL_EASE_MS = 120;
export const MAX_EASE_MS = 1800;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StoryMap {
  /** The raw MapLibre map, for anything this wrapper does not cover. */
  map: MapLibreMap;
  /**
   * Put the marker on a place and move the camera there. `zoom` overrides
   * the zoom for this one move (for example, zoom out when the geocoder was
   * not sure of the exact building); `label` becomes the marker's tooltip
   * and its name for screen readers.
   */
  showPlace(p: LngLat, opts?: { zoom?: number; label?: string }): void;
  /**
   * The visitor is now reading this ring: ease the camera to the zoom that
   * fits it, centred on the place. Before any place is shown, this only
   * remembers the ring, so the first showPlace lands at the right zoom.
   */
  setRingHighlight(level: RingLevel): void;
  /** Remove the marker, the map and its listeners. Safe to call twice. */
  destroy(): void;
}

/**
 * Thrown (as a rejected promise) by createStoryMap when the map cannot be
 * drawn: usually WebGL is unsupported or switched off in this browser. The
 * message is written for the visitor, so the page can show it as it is.
 */
export class MapUnavailableError extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(
      message ??
        'This browser cannot draw the map (WebGL is missing or turned off). ' +
          'The story below still works without it.',
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'MapUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers (exported so they can be tested on their own)
// ---------------------------------------------------------------------------

/** The zoom that fits a ring, from the RING_ZOOM table. */
export function zoomForLevel(level: RingLevel): number {
  return RING_ZOOM[level];
}

/**
 * How long the camera should take to ease from one zoom to another. A short
 * hop (one ring) takes about half a second; a long one (house to plate) is
 * capped so nobody waits on an animation.
 */
export function easeDurationMs(fromZoom: number, toZoom: number): number {
  const levels = Math.abs(toZoom - fromZoom);
  return Math.min(MAX_EASE_MS, BASE_EASE_MS + PER_ZOOM_LEVEL_EASE_MS * levels);
}

/**
 * True when the visitor has asked their operating system for less motion.
 * Checked at every camera move, so changing the setting mid-visit counts.
 * Returns false outside a browser (e.g. in unit tests without a window).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * True when the primary way of pointing is a finger: a touch screen is
 * present (maxTouchPoints) or the pointer is "coarse". Used to switch on
 * cooperative gestures so the page can still be scrolled past the map.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const touchPoints =
    typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number'
      ? navigator.maxTouchPoints
      : 0;
  if (touchPoints > 0) return true;
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Can this browser make a WebGL context at all? MapLibre needs one. We ask a
 * throw-away canvas, then release the context straight away so it does not
 * count against the browser's small limit of live contexts.
 */
export function webglSupported(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** The MapLibre options we always use, given the container and the device. */
export function buildMapOptions(container: HTMLElement, touch: boolean): MapOptions {
  return {
    container,
    style: POSITRON_STYLE_URL,
    center: [WASHINGTON_VIEW.center.lng, WASHINGTON_VIEW.center.lat],
    zoom: WASHINGTON_VIEW.zoom,
    minZoom: 1,
    // The credit line stays written out wherever it fits (MapLibre folds it
    // into an (i) button only on maps narrower than 640 px), which is what
    // the OpenStreetMap and OpenFreeMap attribution rules ask for. The page's
    // own CSS keeps the caption away from this corner.
    attributionControl: { customAttribution: MAP_ATTRIBUTION },
    cooperativeGestures: touch,
  };
}

// ---------------------------------------------------------------------------
// The map itself
// ---------------------------------------------------------------------------

/**
 * Build the present-day map inside `container` (an element that is already
 * on the page and has a size). Loads MapLibre on demand, checks that WebGL
 * works, and resolves with a StoryMap whose camera starts on the whole of
 * Washington. Rejects with MapUnavailableError when the map cannot be drawn,
 * so the page can show the message and carry on with the text-only story.
 */
export async function createStoryMap(container: HTMLElement): Promise<StoryMap> {
  if (!webglSupported()) throw new MapUnavailableError();

  // Loaded here, not at the top of the file, so the rest of the site does
  // not pay for MapLibre until a map is actually wanted.
  const maplibre = await import('maplibre-gl');
  // Without this MapLibre would look for its worker next to the bundled
  // script, where it does not exist, and no tile could ever be drawn.
  maplibre.setWorkerUrl(workerUrl);

  let map: MapLibreMap;
  try {
    map = new maplibre.Map(buildMapOptions(container, isTouchDevice()));
  } catch (cause) {
    throw new MapUnavailableError(undefined, { cause });
  }

  // MapLibre reports problems (a tile that would not load, a bad style) as
  // 'error' events. Without a listener they land in console.error; we turn
  // them into one console.warn per distinct message, because a missing tile
  // is recoverable and should never look like the site is broken.
  const seen = new Set<string>();
  const errorSub: Subscription = map.on('error', (ev) => {
    const message = ev.error?.message ?? 'unknown map error';
    if (seen.has(message)) return;
    seen.add(message);
    console.warn(`Map: ${message}`);
  });

  // One marker for the whole life of the map. It is created now but only
  // added to the map on the first showPlace, so an empty map has no pin.
  const marker: Marker = new maplibre.Marker({ color: MARKER_COLOR });
  let markerOnMap = false;

  let place: LngLat | null = null;
  let level: RingLevel = 'house';
  let destroyed = false;

  /** Move the camera; instantly when the visitor prefers reduced motion. */
  const moveCamera = (how: 'fly' | 'ease', center: LngLat, zoom: number): void => {
    const target = { center: [center.lng, center.lat] as [number, number], zoom };
    if (prefersReducedMotion()) {
      map.jumpTo(target);
    } else if (how === 'fly') {
      map.flyTo(target);
    } else {
      map.easeTo({ ...target, duration: easeDurationMs(map.getZoom(), zoom) });
    }
  };

  const showPlace: StoryMap['showPlace'] = (p, opts) => {
    if (destroyed) return;
    place = p;
    marker.setLngLat([p.lng, p.lat]);
    if (!markerOnMap) {
      marker.addTo(map);
      markerOnMap = true;
    }
    labelMarker(marker, opts?.label);
    moveCamera('fly', p, opts?.zoom ?? zoomForLevel(level));
  };

  const setRingHighlight: StoryMap['setRingHighlight'] = (next) => {
    if (destroyed) return;
    level = next;
    if (place) moveCamera('ease', place, zoomForLevel(next));
  };

  const destroy: StoryMap['destroy'] = () => {
    if (destroyed) return;
    destroyed = true;
    errorSub.unsubscribe();
    marker.remove();
    map.remove();
  };

  return { map, showPlace, setRingHighlight, destroy };
}

/** Give the marker a tooltip and a screen-reader name, or clear both. */
function labelMarker(marker: Marker, label: string | undefined): void {
  const el = marker.getElement();
  if (label) {
    el.title = label;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else {
    el.removeAttribute('title');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  }
}
