/**
 * Tests for the present-day map (map.ts).
 *
 * Nothing here draws a real map: `maplibre-gl` is replaced with a fake that
 * records every call, and the browser globals (window, document, navigator)
 * are stubbed so the tests can pretend to be a touch screen, a browser
 * without WebGL, or a visitor who prefers reduced motion. No network, no
 * fixtures needed: the module never fetches anything itself (MapLibre would,
 * and it is a fake).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LngLat, RingLevel } from '../../src/lib/types';
import { RING_ORDER } from '../../src/lib/types';

// ---------------------------------------------------------------------------
// A fake maplibre-gl. vi.mock is hoisted above the imports, so the fake
// classes must be hoisted too. `factoryCalls` counts how many times the fake
// module was built, which tells us whether map.ts loads MapLibre lazily.
// ---------------------------------------------------------------------------

const fake = vi.hoisted(() => {
  interface Call {
    method: string;
    args: unknown[];
  }
  type Listener = (ev: { error?: { message: string } }) => void;

  class FakeMap {
    static instances: FakeMap[] = [];
    static failConstructWith: Error | null = null;
    readonly options: Record<string, unknown>;
    readonly calls: Call[] = [];
    readonly listeners = new Map<string, Listener[]>();
    zoom: number;
    center: unknown;

    constructor(options: Record<string, unknown>) {
      if (FakeMap.failConstructWith) throw FakeMap.failConstructWith;
      this.options = options;
      this.zoom = typeof options['zoom'] === 'number' ? options['zoom'] : 0;
      this.center = options['center'];
      FakeMap.instances.push(this);
    }
    private record(method: string, args: unknown[]): this {
      this.calls.push({ method, args });
      return this;
    }
    private apply(opts: { center?: unknown; zoom?: number }): void {
      if (opts.center !== undefined) this.center = opts.center;
      if (typeof opts.zoom === 'number') this.zoom = opts.zoom;
    }
    flyTo(opts: { center?: unknown; zoom?: number }): this {
      this.apply(opts);
      return this.record('flyTo', [opts]);
    }
    easeTo(opts: { center?: unknown; zoom?: number }): this {
      this.apply(opts);
      return this.record('easeTo', [opts]);
    }
    jumpTo(opts: { center?: unknown; zoom?: number }): this {
      this.apply(opts);
      return this.record('jumpTo', [opts]);
    }
    getZoom(): number {
      return this.zoom;
    }
    getCenter(): unknown {
      return this.center;
    }
    on(type: string, listener: Listener): { unsubscribe: () => void } {
      this.record('on', [type]);
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
      return {
        unsubscribe: () => {
          this.record('unsubscribe', [type]);
          this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter((l) => l !== listener),
          );
        },
      };
    }
    remove(): void {
      this.record('remove', []);
    }
    /** Test helper: pretend MapLibre raised an event. */
    fire(type: string, ev: { error?: { message: string } }): void {
      for (const l of this.listeners.get(type) ?? []) l(ev);
    }
    /** Test helper: the names of the camera calls made, in order. */
    cameraCalls(): string[] {
      return this.calls.map((c) => c.method).filter((m) => m === 'flyTo' || m === 'easeTo' || m === 'jumpTo');
    }
  }

  class FakeElement {
    title = '';
    readonly attrs = new Map<string, string>();
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    }
    removeAttribute(name: string): void {
      this.attrs.delete(name);
      if (name === 'title') this.title = '';
    }
  }

  class FakeMarker {
    static instances: FakeMarker[] = [];
    readonly options: Record<string, unknown>;
    readonly calls: Call[] = [];
    readonly element = new FakeElement();
    lngLat: unknown;

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      FakeMarker.instances.push(this);
    }
    private record(method: string, args: unknown[]): this {
      this.calls.push({ method, args });
      return this;
    }
    setLngLat(lngLat: unknown): this {
      this.lngLat = lngLat;
      return this.record('setLngLat', [lngLat]);
    }
    addTo(map: unknown): this {
      return this.record('addTo', [map]);
    }
    remove(): this {
      return this.record('remove', []);
    }
    getElement(): FakeElement {
      return this.element;
    }
  }

  const state = { factoryCalls: 0, workerUrl: null as string | null };
  return { FakeMap, FakeMarker, state };
});

vi.mock('maplibre-gl', () => {
  fake.state.factoryCalls += 1;
  return {
    Map: fake.FakeMap,
    Marker: fake.FakeMarker,
    setWorkerUrl: (url: string) => {
      fake.state.workerUrl = url;
    },
  };
});

// The stylesheet import is a side effect only; give it an empty module.
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
// Vite would hand back the bundled worker's address; here it is a fixed string.
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?url', () => ({ default: '/sno-ball/assets/maplibre-gl-worker.mjs' }));

import {
  MAX_EASE_MS,
  MapUnavailableError,
  POSITRON_STYLE_URL,
  RING_ZOOM,
  WASHINGTON_VIEW,
  buildMapOptions,
  createStoryMap,
  easeDurationMs,
  isTouchDevice,
  prefersReducedMotion,
  webglSupported,
  zoomForLevel,
  WIDE_VIEWPORT_PX,
  attributionOptions,
  isWideViewport,
} from '../../src/lib/map';

// ---------------------------------------------------------------------------
// Browser stubs. The unit tests run in plain Node, so window, document and
// navigator do not exist until we create them here.
// ---------------------------------------------------------------------------

interface BrowserStub {
  /** Does `prefers-reduced-motion: reduce` match? */
  reducedMotion?: boolean;
  /** Does `pointer: coarse` match? */
  coarsePointer?: boolean;
  /** navigator.maxTouchPoints */
  touchPoints?: number;
  /** Can a canvas give us a WebGL context? */
  webgl?: boolean;
  /** window.innerWidth in CSS pixels. Default 1024 (a laptop). */
  viewportWidth?: number;
}

function stubBrowser(stub: BrowserStub = {}): void {
  const matchMedia = vi.fn((query: string) => ({
    matches:
      (query.includes('prefers-reduced-motion') && stub.reducedMotion === true) ||
      (query.includes('pointer: coarse') && stub.coarsePointer === true),
  }));
  vi.stubGlobal('window', { matchMedia, innerWidth: stub.viewportWidth ?? 1024 });
  vi.stubGlobal('navigator', { maxTouchPoints: stub.touchPoints ?? 0 });
  const loseContext = vi.fn();
  const gl = { getExtension: vi.fn(() => ({ loseContext })) };
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({ getContext: vi.fn(() => (stub.webgl === false ? null : gl)) })),
  });
}

const SPACE_NEEDLE: LngLat = { lng: -122.3493, lat: 47.6205 };
const SPOKANE: LngLat = { lng: -117.426, lat: 47.6588 };

/** A stand-in for the map's container element. The fake Map never looks inside it. */
const container = { id: 'map' } as unknown as HTMLElement;

beforeEach(() => {
  fake.FakeMap.instances.length = 0;
  fake.FakeMarker.instances.length = 0;
  fake.FakeMap.failConstructWith = null;
  stubBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The zoom table
// ---------------------------------------------------------------------------

describe('RING_ZOOM', () => {
  it('matches the agreed zoom per ring', () => {
    expect(RING_ZOOM).toEqual({
      house: 17,
      block: 16,
      street: 15.5,
      neighborhood: 14,
      city: 11,
      county: 9,
      region: 7.5,
      state: 6,
      plate: 2,
    });
  });

  it('covers every ring and zooms out as the rings get bigger', () => {
    const zooms = RING_ORDER.map((level) => zoomForLevel(level));
    expect(zooms).toHaveLength(RING_ORDER.length);
    for (let i = 1; i < zooms.length; i++) {
      expect(zooms[i]!).toBeLessThan(zooms[i - 1]!);
    }
  });
});

describe('easeDurationMs', () => {
  it('takes longer for a bigger zoom change and never exceeds the cap', () => {
    const oneRing = easeDurationMs(17, 16);
    const toCity = easeDurationMs(17, 11);
    const toPlate = easeDurationMs(17, 2);
    expect(oneRing).toBeGreaterThan(0);
    expect(toCity).toBeGreaterThan(oneRing);
    expect(toPlate).toBe(MAX_EASE_MS);
    // Direction does not matter.
    expect(easeDurationMs(11, 17)).toBe(toCity);
  });
});

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

describe('browser helpers', () => {
  it('report nothing special when there is no browser at all', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    expect(prefersReducedMotion()).toBe(false);
    expect(isTouchDevice()).toBe(false);
    expect(webglSupported()).toBe(false);
    expect(isWideViewport()).toBe(false);
  });

  it('call a window of 640 px or more wide, and keep the map credit open only there', () => {
    expect(WIDE_VIEWPORT_PX).toBe(640);
    stubBrowser({ viewportWidth: 1280 });
    expect(isWideViewport()).toBe(true);
    stubBrowser({ viewportWidth: 640 });
    expect(isWideViewport()).toBe(true);
    stubBrowser({ viewportWidth: 412 }); // a Pixel 7
    expect(isWideViewport()).toBe(false);
    // Wide: the one-line credit is forced open. Narrow: MapLibre's default,
    // which folds it into an (i) button. Never a customAttribution of ours.
    expect(attributionOptions(true)).toEqual({ compact: false });
    expect(attributionOptions(false)).toEqual({});
    expect(buildMapOptions(container, false, false).attributionControl).toEqual({});
    expect(buildMapOptions(container, false).attributionControl).toEqual({});
    stubBrowser({ viewportWidth: 1280 });
    expect(buildMapOptions(container, false).attributionControl).toEqual({ compact: false });
  });

  it('read prefers-reduced-motion from matchMedia', () => {
    stubBrowser({ reducedMotion: true });
    expect(prefersReducedMotion()).toBe(true);
    stubBrowser({ reducedMotion: false });
    expect(prefersReducedMotion()).toBe(false);
  });

  it('treat a touch screen or a coarse pointer as a touch device', () => {
    stubBrowser({ touchPoints: 5 });
    expect(isTouchDevice()).toBe(true);
    stubBrowser({ coarsePointer: true });
    expect(isTouchDevice()).toBe(true);
    stubBrowser();
    expect(isTouchDevice()).toBe(false);
  });

  it('probe a canvas for WebGL and release the context again', () => {
    stubBrowser({ webgl: true });
    expect(webglSupported()).toBe(true);
    const canvas = (document.createElement as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      getContext: ReturnType<typeof vi.fn>;
    };
    const gl = canvas.getContext.mock.results[0]?.value as { getExtension: ReturnType<typeof vi.fn> };
    const ext = gl.getExtension.mock.results[0]?.value as { loseContext: ReturnType<typeof vi.fn> };
    expect(ext.loseContext).toHaveBeenCalledTimes(1);

    stubBrowser({ webgl: false });
    expect(webglSupported()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createStoryMap
// ---------------------------------------------------------------------------

describe('createStoryMap', () => {
  it('does not load MapLibre until a map is asked for', async () => {
    // The module was imported at the top of this file; MapLibre still has
    // not been touched.
    expect(fake.state.factoryCalls).toBe(0);
    expect(fake.FakeMap.instances).toHaveLength(0);
    await createStoryMap(container);
    expect(fake.state.factoryCalls).toBe(1);
    expect(fake.FakeMap.instances).toHaveLength(1);
  });

  it('rejects with a visitor-readable error when WebGL is unavailable', async () => {
    stubBrowser({ webgl: false });
    const err = await createStoryMap(container).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MapUnavailableError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('MapUnavailableError');
    expect((err as Error).message).toMatch(/WebGL/);
    expect(fake.FakeMap.instances).toHaveLength(0);
  });

  it('wraps a failure inside MapLibre itself in the same error', async () => {
    const inner = new Error('Failed to initialize WebGL');
    fake.FakeMap.failConstructWith = inner;
    const err = await createStoryMap(container).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MapUnavailableError);
    expect((err as Error).cause).toBe(inner);
  });

  it('uses the positron style, leaves the credit to the style, and starts on Washington', async () => {
    const story = await createStoryMap(container);
    const opts = fake.FakeMap.instances[0]!.options;
    expect(story.map).toBe(fake.FakeMap.instances[0]);
    expect(opts['container']).toBe(container);
    expect(opts['style']).toBe(POSITRON_STYLE_URL);
    expect(opts['style']).toBe('https://tiles.openfreemap.org/styles/positron');
    // The style's tile source carries the OpenFreeMap / OpenMapTiles /
    // OpenStreetMap credit, so no customAttribution (it was printed twice).
    // The stubbed window is 1024 px wide: the credit is kept open. An
    // explicit object is always passed: leaving the option out would give
    // MapLibre's own default of compact: true plus a "MapLibre" link.
    expect(opts['attributionControl']).toEqual({ compact: false });
    expect('customAttribution' in (opts['attributionControl'] as object)).toBe(false);
    // MapLibre is told where the bundled tile worker lives before any map is made.
    expect(fake.state.workerUrl).toBe('/sno-ball/assets/maplibre-gl-worker.mjs');
    expect(opts['center']).toEqual([WASHINGTON_VIEW.center.lng, WASHINGTON_VIEW.center.lat]);
    expect(opts['zoom']).toBe(WASHINGTON_VIEW.zoom);
    // Somewhere in Washington, not Mapbox's default of the Atlantic.
    expect(WASHINGTON_VIEW.center.lat).toBeGreaterThan(45.5);
    expect(WASHINGTON_VIEW.center.lat).toBeLessThan(49);
    expect(WASHINGTON_VIEW.center.lng).toBeGreaterThan(-124.9);
    expect(WASHINGTON_VIEW.center.lng).toBeLessThan(-116.9);
  });

  it('turns on cooperative gestures only on touch devices', async () => {
    stubBrowser({ touchPoints: 2 });
    await createStoryMap(container);
    expect(fake.FakeMap.instances[0]!.options['cooperativeGestures']).toBe(true);

    stubBrowser();
    await createStoryMap(container);
    expect(fake.FakeMap.instances[1]!.options['cooperativeGestures']).toBe(false);

    // The pure builder says the same thing without any globals.
    expect(buildMapOptions(container, true).cooperativeGestures).toBe(true);
    expect(buildMapOptions(container, false).cooperativeGestures).toBe(false);
  });

  it('listens for map errors and warns once per distinct message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createStoryMap(container);
    const map = fake.FakeMap.instances[0]!;
    map.fire('error', { error: { message: 'tile 1 failed' } });
    map.fire('error', { error: { message: 'tile 1 failed' } });
    map.fire('error', { error: { message: 'style failed' } });
    map.fire('error', {});
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenNthCalledWith(1, 'Map: tile 1 failed');
    expect(warn).toHaveBeenNthCalledWith(2, 'Map: style failed');
    expect(warn).toHaveBeenNthCalledWith(3, 'Map: unknown map error');
  });
});

// ---------------------------------------------------------------------------
// showPlace
// ---------------------------------------------------------------------------

describe('showPlace', () => {
  it('creates one marker, adds it once, and flies to the house zoom by default', async () => {
    const story = await createStoryMap(container);
    const map = fake.FakeMap.instances[0]!;
    expect(fake.FakeMarker.instances).toHaveLength(1);
    const marker = fake.FakeMarker.instances[0]!;
    // Nothing is on the map until a place is shown.
    expect(marker.calls).toHaveLength(0);

    story.showPlace(SPACE_NEEDLE);
    story.showPlace(SPOKANE);

    expect(fake.FakeMarker.instances).toHaveLength(1);
    expect(marker.calls.filter((c) => c.method === 'addTo')).toHaveLength(1);
    expect(marker.calls.filter((c) => c.method === 'addTo')[0]!.args[0]).toBe(map);
    expect(marker.lngLat).toEqual([SPOKANE.lng, SPOKANE.lat]);

    expect(map.cameraCalls()).toEqual(['flyTo', 'flyTo']);
    expect(map.calls.filter((c) => c.method === 'flyTo')[0]!.args[0]).toEqual({
      center: [SPACE_NEEDLE.lng, SPACE_NEEDLE.lat],
      zoom: RING_ZOOM.house,
    });
    expect(map.calls.filter((c) => c.method === 'flyTo')[1]!.args[0]).toEqual({
      center: [SPOKANE.lng, SPOKANE.lat],
      zoom: 17,
    });
  });

  it('honours a one-off zoom override without forgetting the ring', async () => {
    const story = await createStoryMap(container);
    const map = fake.FakeMap.instances[0]!;
    story.showPlace(SPACE_NEEDLE, { zoom: 14 });
    expect(map.calls.at(-1)!.args[0]).toEqual({ center: [SPACE_NEEDLE.lng, SPACE_NEEDLE.lat], zoom: 14 });
    story.showPlace(SPACE_NEEDLE);
    expect(map.calls.at(-1)!.args[0]).toEqual({ center: [SPACE_NEEDLE.lng, SPACE_NEEDLE.lat], zoom: 17 });
  });

  it('labels the marker for tooltips and screen readers, and clears the label again', async () => {
    const story = await createStoryMap(container);
    const el = fake.FakeMarker.instances[0]!.element;
    story.showPlace(SPACE_NEEDLE, { label: 'Space Needle, 400 Broad St' });
    expect(el.title).toBe('Space Needle, 400 Broad St');
    expect(el.attrs.get('aria-label')).toBe('Space Needle, 400 Broad St');
    expect(el.attrs.get('role')).toBe('img');
    story.showPlace(SPOKANE);
    expect(el.title).toBe('');
    expect(el.attrs.has('aria-label')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setRingHighlight
// ---------------------------------------------------------------------------

describe('setRingHighlight', () => {
  it('eases to the ring zoom around the place, with a sensible duration', async () => {
    const story = await createStoryMap(container);
    const map = fake.FakeMap.instances[0]!;
    story.showPlace(SPACE_NEEDLE);

    const expectations: Array<[RingLevel, number]> = [
      ['block', 16],
      ['street', 15.5],
      ['neighborhood', 14],
      ['city', 11],
      ['county', 9],
      ['region', 7.5],
      ['state', 6],
      ['plate', 2],
      ['house', 17],
    ];
    for (const [level, zoom] of expectations) {
      const before = map.getZoom();
      story.setRingHighlight(level);
      const last = map.calls.at(-1)!;
      expect(last.method).toBe('easeTo');
      expect(last.args[0]).toEqual({
        center: [SPACE_NEEDLE.lng, SPACE_NEEDLE.lat],
        zoom,
        duration: easeDurationMs(before, zoom),
      });
      expect(map.getZoom()).toBe(zoom);
    }
  });

  it('only remembers the ring before a place is shown, then uses it for the first flight', async () => {
    const story = await createStoryMap(container);
    const map = fake.FakeMap.instances[0]!;
    story.setRingHighlight('city');
    expect(map.cameraCalls()).toEqual([]);
    story.showPlace(SPACE_NEEDLE);
    expect(map.cameraCalls()).toEqual(['flyTo']);
    expect(map.calls.at(-1)!.args[0]).toEqual({ center: [SPACE_NEEDLE.lng, SPACE_NEEDLE.lat], zoom: 11 });
  });
});

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

describe('prefers-reduced-motion', () => {
  it('jumps instead of flying or easing, and re-checks the setting on every move', async () => {
    stubBrowser({ reducedMotion: true });
    const story = await createStoryMap(container);
    const map = fake.FakeMap.instances[0]!;

    story.showPlace(SPACE_NEEDLE);
    story.setRingHighlight('county');
    expect(map.cameraCalls()).toEqual(['jumpTo', 'jumpTo']);
    expect(map.calls.at(-1)!.args[0]).toEqual({ center: [SPACE_NEEDLE.lng, SPACE_NEEDLE.lat], zoom: 9 });

    // The visitor switches the setting off mid-visit: animations come back.
    stubBrowser({ reducedMotion: false });
    story.setRingHighlight('state');
    story.showPlace(SPOKANE);
    expect(map.cameraCalls()).toEqual(['jumpTo', 'jumpTo', 'easeTo', 'flyTo']);
  });
});

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

describe('destroy', () => {
  it('removes the marker, the map and the error listener, and is safe to call twice', async () => {
    const story = await createStoryMap(container);
    const map = fake.FakeMap.instances[0]!;
    const marker = fake.FakeMarker.instances[0]!;
    story.showPlace(SPACE_NEEDLE);

    story.destroy();
    story.destroy();

    expect(marker.calls.filter((c) => c.method === 'remove')).toHaveLength(1);
    expect(map.calls.filter((c) => c.method === 'remove')).toHaveLength(1);
    expect(map.calls.filter((c) => c.method === 'unsubscribe')).toEqual([{ method: 'unsubscribe', args: ['error'] }]);
    expect(map.listeners.get('error')).toEqual([]);
  });

  it('ignores showPlace and setRingHighlight after destroy', async () => {
    const story = await createStoryMap(container);
    const map = fake.FakeMap.instances[0]!;
    const marker = fake.FakeMarker.instances[0]!;
    story.destroy();
    const mapCalls = map.calls.length;
    const markerCalls = marker.calls.length;

    story.showPlace(SPACE_NEEDLE);
    story.setRingHighlight('city');

    expect(map.calls).toHaveLength(mapCalls);
    expect(marker.calls).toHaveLength(markerCalls);
  });
});
