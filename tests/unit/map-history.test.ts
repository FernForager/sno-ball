/**
 * Tests for the historical map layers (map-history.ts) and the paleo globe
 * (ui/globe.ts).
 *
 * No network, no real map: `maplibre-gl` and `@openhistoricalmap/
 * maplibre-gl-dates` are replaced with fakes, the USGS catalog answer is
 * the captured fixture (31 real rows at the Space Needle, trimmed to the
 * fields production asks for), and attachHistoryLayers gets a fake map
 * that records every source, layer, paint and layout call.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../../src/lib/types';

// ---------------------------------------------------------------------------
// Mocks (hoisted above the imports by vitest)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const fetchJson = vi.fn();
  const run = vi.fn((task: () => Promise<unknown>) => task());
  const limiterFor = vi.fn(() => ({ run }));
  const store = new Map<string, unknown>();
  const cached = vi.fn(async (key: string, _opts: { ttlMs: number }, loader: () => Promise<unknown>) => {
    if (store.has(key)) return store.get(key);
    const value = await loader();
    store.set(key, value);
    return value;
  });
  const filterByDate = vi.fn();
  return { fetchJson, run, limiterFor, cached, store, filterByDate };
});

vi.mock('../../src/lib/http', () => ({ fetchJson: mocks.fetchJson }));
vi.mock('../../src/lib/queue', () => ({ limiterFor: mocks.limiterFor }));
vi.mock('../../src/lib/cache', () => ({ cached: mocks.cached }));
vi.mock('@openhistoricalmap/maplibre-gl-dates', () => ({ filterByDate: mocks.filterByDate }));
// map-history.ts only imports MapLibre's types, but a fake keeps the test
// honest if that ever changes: nothing here may build a real map.
vi.mock('maplibre-gl', () => ({
  Map: class {
    constructor() {
      throw new Error('a real maplibregl.Map must never be built in this test');
    }
  },
}));

import {
  OHM_ATTRIBUTION,
  OHM_LAYER_IDS,
  OHM_SOURCE_ID,
  TOPO_ATTRIBUTION,
  TOPO_LAYER_ID,
  TOPO_SOURCE_ID,
  attachHistoryLayers,
  baseOpacityFor,
  chooseTopoSheet,
  isNatureLayer,
  mapModeFor,
  ohmDateString,
  scaleOpacity,
  scalePreference,
  sheetsFromCatalog,
  topoCaption,
  topoDetails,
  historicalMapNote,
  topoCatalogUrl,
  topoCellKey,
  topoSheetsAt,
  topoTileUrl,
  type HistoryMap,
  type TopoCatalogResponse,
  type TopoSheet,
} from '../../src/lib/map-history';
import {
  GLOBE_CENTER_X,
  GLOBE_CENTER_Y,
  GLOBE_RADIUS,
  globeCenterFor,
  globeLabel,
  pathOnGlobe,
  projectOrthographic,
  sketchPoint,
} from '../../src/ui/globe';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const catalog = JSON.parse(
  readFileSync(new URL('../fixtures/map/usgs-topo-catalog.json', import.meta.url), 'utf8'),
) as TopoCatalogResponse;
const sheets = sheetsFromCatalog(catalog);

const SPACE_NEEDLE: LngLat = { lng: -122.3493, lat: 47.6205 };

/** A short description of a sheet for readable assertions. */
function describeSheet(s: TopoSheet | null): string | null {
  return s ? `${s.name} 1:${s.scale} ${s.year} (printed ${s.imprintYear})` : null;
}

// ---------------------------------------------------------------------------
// A fake MapLibre map that records every call
// ---------------------------------------------------------------------------

interface FakeLayer {
  id: string;
  type: string;
  source?: string;
  'source-layer'?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: unknown;
}

class FakeMap {
  readonly layers: FakeLayer[];
  readonly sources = new Map<string, unknown>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly filters = new Map<string, unknown>();

  constructor(layers: FakeLayer[]) {
    this.layers = layers.map((l) => ({ ...l, paint: { ...(l.paint ?? {}) }, layout: { ...(l.layout ?? {}) } }));
  }
  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
  getStyle() {
    return { version: 8, sources: Object.fromEntries(this.sources), layers: this.layers };
  }
  getLayer(id: string) {
    return this.layers.find((l) => l.id === id);
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: unknown) {
    this.record('addSource', id, spec);
    if (this.sources.has(id)) throw new Error(`source ${id} already exists`);
    this.sources.set(id, spec);
  }
  removeSource(id: string) {
    this.record('removeSource', id);
    if (this.layers.some((l) => l.source === id)) throw new Error(`source ${id} is still in use`);
    this.sources.delete(id);
  }
  addLayer(spec: FakeLayer, beforeId?: string) {
    this.record('addLayer', spec, beforeId);
    if (this.getLayer(spec.id)) throw new Error(`layer ${spec.id} already exists`);
    if (spec.source && !this.sources.has(spec.source)) throw new Error(`layer ${spec.id} uses missing source ${spec.source}`);
    const layer = { ...spec, paint: { ...(spec.paint ?? {}) }, layout: { ...(spec.layout ?? {}) } };
    const at = beforeId ? this.layers.findIndex((l) => l.id === beforeId) : -1;
    if (beforeId && at === -1) throw new Error(`beforeId ${beforeId} not found`);
    if (at === -1) this.layers.push(layer);
    else this.layers.splice(at, 0, layer);
  }
  removeLayer(id: string) {
    this.record('removeLayer', id);
    const at = this.layers.findIndex((l) => l.id === id);
    if (at === -1) throw new Error(`layer ${id} not found`);
    this.layers.splice(at, 1);
  }
  getPaintProperty(id: string, prop: string) {
    return this.getLayer(id)?.paint?.[prop];
  }
  setPaintProperty(id: string, prop: string, value: unknown) {
    this.record('setPaintProperty', id, prop, value);
    const layer = this.getLayer(id);
    if (!layer) throw new Error(`layer ${id} not found`);
    (layer.paint ??= {})[prop] = value;
  }
  getLayoutProperty(id: string, prop: string) {
    return this.getLayer(id)?.layout?.[prop];
  }
  setLayoutProperty(id: string, prop: string, value: unknown) {
    this.record('setLayoutProperty', id, prop, value);
    const layer = this.getLayer(id);
    if (!layer) throw new Error(`layer ${id} not found`);
    (layer.layout ??= {})[prop] = value;
  }
  setFilter(id: string, filter: unknown) {
    this.record('setFilter', id, filter);
    this.filters.set(id, filter);
  }
  getFilter(id: string) {
    return this.filters.get(id);
  }
  ids(): string[] {
    return this.layers.map((l) => l.id);
  }
  methods(name: string) {
    return this.calls.filter((c) => c.method === name);
  }
}

/** A slice of OpenFreeMap's positron style, in its real order. */
function positronLike(): FakeLayer[] {
  return [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#cad2d3' } },
    {
      id: 'landcover_wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      paint: { 'fill-color': '#dfdbd7', 'fill-opacity': { base: 1, stops: [[8, 0], [10, 0.4]] } },
    },
    { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', paint: { 'line-color': '#bbb' } },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: { 'fill-color': '#ddd' } },
    {
      id: 'highway_minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      paint: { 'line-color': '#fff', 'line-opacity': 0.9 },
    },
    { id: 'boundary_2', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 8, 1] } },
    { id: 'label_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': '{name}' }, paint: { 'text-color': '#333' } },
    { id: 'label_state', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { visibility: 'none' } },
  ];
}

/** The first assigned (not undefined) history map: the fake satisfies the slice map-history uses. */
function asHistoryMap(fake: FakeMap): HistoryMap {
  return fake as unknown as HistoryMap;
}

beforeEach(() => {
  mocks.fetchJson.mockReset();
  mocks.limiterFor.mockClear();
  mocks.cached.mockClear();
  mocks.filterByDate.mockClear();
  mocks.store.clear();
});

// ---------------------------------------------------------------------------
// Catalog parsing and the request
// ---------------------------------------------------------------------------

describe('sheetsFromCatalog', () => {
  it('reads the 31 Space Needle rows, oldest first', () => {
    expect(sheets).toHaveLength(31);
    expect(sheets[0]).toMatchObject({ name: 'Seattle', scale: 62500, year: 1894, dateOnMap: 1894, imprintYear: 1903 });
    expect(sheets.at(-1)).toMatchObject({ name: 'Seattle', scale: 100000, year: 1992 });
    for (let i = 1; i < sheets.length; i++) expect(sheets[i]!.year).toBeGreaterThanOrEqual(sheets[i - 1]!.year);
  });

  it('keeps the download link and citation when present', () => {
    const s = sheets.find((x) => x.objectId === 165595)!;
    expect(s.downloadUrl).toBe('http://ims.er.usgs.gov/gda_services/download?item_id=5411318');
    expect(s.citation).toContain('U.S. Geological Survey, Seattle [map], 1:125000');
  });

  it('skips rows without the fields that matter and tolerates numeric strings', () => {
    const out = sheetsFromCatalog({
      features: [
        { attributes: { OBJECTID: '7', Map_Name: 'Test', Map_Scale: '24000', Year: '1950' } },
        { attributes: { OBJECTID: 8, Map_Name: 'No scale', Year: 1950 } },
        { attributes: {} },
      ],
    });
    expect(out).toEqual([{ objectId: 7, name: 'Test', scale: 24000, dateOnMap: 1950, imprintYear: 1950, year: 1950 }]);
  });

  it('throws on an ArcGIS error body so nothing bad is cached', () => {
    expect(() => sheetsFromCatalog({ error: { code: 400, message: 'Invalid geometry' } })).toThrow(/400.*Invalid geometry/);
  });
});

describe('topoSheetsAt', () => {
  it('queries the ImageServer catalog at the point with the documented fields, through the limiter, cached per 0.01° cell', async () => {
    mocks.fetchJson.mockResolvedValue(catalog);
    const a = await topoSheetsAt(SPACE_NEEDLE);
    const b = await topoSheetsAt({ lng: -122.3451, lat: 47.6249 }); // same 0.01° cell
    expect(a).toHaveLength(31);
    expect(b).toBe(a);
    expect(mocks.fetchJson).toHaveBeenCalledTimes(1);
    expect(mocks.limiterFor).toHaveBeenCalledWith('historical1.arcgis.com');
    const url = mocks.fetchJson.mock.calls[0]![0] as string;
    expect(url.startsWith('https://historical1.arcgis.com/arcgis/rest/services/USGS_Historical_Topographic_Maps/ImageServer/query?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('geometry')).toBe('-122.34930,47.62050');
    expect(params.get('geometryType')).toBe('esriGeometryPoint');
    expect(params.get('inSR')).toBe('4326');
    expect(params.get('spatialRel')).toBe('esriSpatialRelIntersects');
    expect(params.get('outFields')).toBe('OBJECTID,Map_Name,Map_Scale,Date_On_Map,Imprint_Year,Year,Download_GeoPDF,Citation');
    expect(params.get('returnGeometry')).toBe('false');
    expect(params.get('f')).toBe('json');
    expect(mocks.cached).toHaveBeenCalledWith(
      `topo:catalog:${topoCellKey(SPACE_NEEDLE)}`,
      { ttlMs: 30 * 24 * 60 * 60 * 1000 },
      expect.any(Function),
    );
  });

  it('uses a different cache key for the next cell', () => {
    expect(topoCellKey(SPACE_NEEDLE)).toBe('-12235:4762');
    expect(topoCellKey({ lng: -122.3393, lat: 47.6205 })).toBe('-12234:4762');
    expect(topoCatalogUrl(SPACE_NEEDLE)).toContain('geometry=-122.34930%2C47.62050');
  });

  it('lets a failed request through (nothing cached)', async () => {
    mocks.fetchJson.mockRejectedValue(new Error('offline'));
    await expect(topoSheetsAt(SPACE_NEEDLE)).rejects.toThrow('offline');
    expect(mocks.store.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Choosing a sheet
// ---------------------------------------------------------------------------

describe('chooseTopoSheet', () => {
  it('1897 at region zoom: the 1897 Seattle 1:125,000 sheet, earliest printing', () => {
    const s = chooseTopoSheet(sheets, 1897, 7);
    expect(describeSheet(s)).toBe('Seattle 1:125000 1897 (printed 1897)');
    expect(s?.objectId).toBe(165595);
  });

  it('1897 at city zoom: the 1894 Seattle 1:62,500 sheet (finer scale, 3 years off)', () => {
    expect(describeSheet(chooseTopoSheet(sheets, 1897, 11))).toBe('Seattle 1:62500 1894 (printed 1903)');
  });

  it('1909: a 1909 1:62,500 sheet; of the four printings the one printed in 1909 itself', () => {
    const s = chooseTopoSheet(sheets, 1909, 13);
    expect(describeSheet(s)).toBe('Seattle Special 1:62500 1909 (printed 1909)');
    expect(s?.objectId).toBe(165210);
  });

  it('1949 at neighbourhood zoom: the Seattle South 1:24,000 sheet, 1969 printing', () => {
    expect(describeSheet(chooseTopoSheet(sheets, 1949, 15))).toBe('Seattle South 1:24000 1949 (printed 1969)');
  });

  it('1983: the 1:25,000 sheet (no preferred scale within 25 years)', () => {
    const s = chooseTopoSheet(sheets, 1983, 14);
    expect(describeSheet(s)).toBe('Seattle South 1:25000 1983 (printed 1983)');
    expect(s?.objectId).toBe(164573);
  });

  it('1700: nothing within 25 years', () => {
    expect(chooseTopoSheet(sheets, 1700, 12)).toBeNull();
    expect(chooseTopoSheet(sheets, 1868, 12)).toBeNull();
    expect(chooseTopoSheet(sheets, 1869, 12)?.year).toBe(1894);
    expect(chooseTopoSheet([], 1900, 12)).toBeNull();
  });

  it('prefers scale by zoom: 24,000 then 62,500 at z12+, 62,500 then 125,000 at z9-11, 125,000 then 250,000 below', () => {
    expect(scalePreference(16)).toEqual([24000, 62500]);
    expect(scalePreference(12)).toEqual([24000, 62500]);
    expect(scalePreference(11.9)).toEqual([62500, 125000]);
    expect(scalePreference(9)).toEqual([62500, 125000]);
    expect(scalePreference(8.9)).toEqual([125000, 250000]);
    expect(scalePreference(2)).toEqual([125000, 250000]);
    // 1930: the 24,000 sheet (19 years off) wins at z14; the 62,500 sheet (21 off) wins at z10;
    // at z6 the 250,000 sheet of 1958 is out of the window, so 125,000 (1897) is also out: fall back to others.
    expect(chooseTopoSheet(sheets, 1930, 14)?.scale).toBe(24000);
    expect(chooseTopoSheet(sheets, 1930, 10)?.scale).toBe(62500);
    expect(chooseTopoSheet(sheets, 1960, 6)?.scale).toBe(250000);
  });

  it('breaks a tie between equally distant years toward the older sheet', () => {
    // 1960 at z6: 1958 and 1962 (both 1:250,000) are each 2 years away -> 1958.
    expect(chooseTopoSheet(sheets, 1960, 6)?.year).toBe(1958);
    const synth: TopoSheet[] = [
      { objectId: 2, name: 'B', scale: 24000, dateOnMap: 1950, imprintYear: 1950, year: 1950 },
      { objectId: 1, name: 'A', scale: 24000, dateOnMap: 1940, imprintYear: 1940, year: 1940 },
    ];
    expect(chooseTopoSheet(synth, 1945, 14)?.year).toBe(1940);
  });
});

// ---------------------------------------------------------------------------
// Tile template and caption
// ---------------------------------------------------------------------------

describe('topoTileUrl', () => {
  const sheet = sheets.find((s) => s.objectId === 165595)!;

  it('is the exportImage template with a literal bbox token and an encoded lockRaster mosaic rule', () => {
    const url = topoTileUrl(sheet);
    expect(url).toBe(
      'https://historical1.arcgis.com/arcgis/rest/services/USGS_Historical_Topographic_Maps/ImageServer/exportImage' +
        '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg' +
        '&mosaicRule=%7B%22mosaicMethod%22%3A%22esriMosaicLockRaster%22%2C%22lockRasterIds%22%3A%5B165595%5D%7D&f=image',
    );
    const rule = new URL(url.replace('{bbox-epsg-3857}', '0,0,1,1')).searchParams.get('mosaicRule');
    expect(JSON.parse(rule!)).toEqual({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [165595] });
  });

  it('captions the sheet in one line, honest about a survey far from the stop, and credits the collection in the details', () => {
    expect(topoCaption(sheet)).toBe('USGS Seattle 1897 sheet');
    expect(topoCaption(sheet, 1897)).toBe('USGS Seattle 1897 sheet');
    expect(topoCaption(sheet, 1892)).toBe('USGS Seattle 1897 sheet'); // five years: still "the" sheet
    expect(topoCaption(sheet, 1889)).toBe('Nearest USGS sheet: Seattle, surveyed 1897');
    const south1949 = sheets.find((s) => s.name === 'Seattle South' && s.year === 1949)!;
    expect(topoCaption(south1949, 1936)).toBe('Nearest USGS sheet: Seattle South, surveyed 1949');
    const details = topoDetails(sheet);
    expect(details).toContain('USGS Seattle sheet (1:125,000), surveyed 1897, printed 1897');
    expect(details).toContain('Historical Topographic Map Collection courtesy of the U.S. Geological Survey, Esri');
    expect(topoDetails(sheets.find((s) => s.objectId === 165207)!)).toContain('surveyed 1909, printed 1936');
  });

  it('builds the map note with what OpenHistoricalMap drew, crediting it only when it drew something', () => {
    const unknown = historicalMapNote(1897, sheet, 'unknown');
    expect(unknown.text).toBe('USGS Seattle 1897 sheet');
    expect(unknown.details).toBe(topoDetails(sheet));
    const none = historicalMapNote(1889, sheet, 'none');
    expect(none.text).toBe('Nearest USGS sheet: Seattle, surveyed 1897. OpenHistoricalMap has nothing mapped here for 1889 yet.');
    expect(none.details).not.toContain('OpenHistoricalMap');
    const some = historicalMapNote(1897, sheet, 'some');
    expect(some.text).toBe('USGS Seattle 1897 sheet. Old streets from OpenHistoricalMap.');
    expect(some.details).toContain(OHM_ATTRIBUTION);
    // Without a sheet the note still names the OHM features (where mapped), or says there are none.
    expect(historicalMapNote(1850, null, 'unknown')).toEqual({ text: "No USGS map here for 1850. OpenHistoricalMap's 1850 features (where mapped) over today's streets, faded." });
    expect(historicalMapNote(1850, null, 'none')).toEqual({ text: 'No USGS map here for 1850. OpenHistoricalMap has nothing mapped here for 1850 yet.' });
    expect(historicalMapNote(1850, null, 'some')).toEqual({ text: 'No USGS map here for 1850. Old streets from OpenHistoricalMap.', details: `Old streets: ${OHM_ATTRIBUTION}.` });
  });
});

// ---------------------------------------------------------------------------
// The ramp and the gear table
// ---------------------------------------------------------------------------

describe('baseOpacityFor', () => {
  it('matches the plan at the ramp points', () => {
    expect(baseOpacityFor(2026)).toBe(1);
    expect(baseOpacityFor(2000)).toBe(1);
    expect(baseOpacityFor(1950)).toBe(0.55);
    expect(baseOpacityFor(1900)).toBe(0.4);
    expect(baseOpacityFor(1850)).toBe(0.25);
    expect(baseOpacityFor(1800)).toBe(0.12);
  });

  it('is linear between points and flat beyond the ends', () => {
    expect(baseOpacityFor(1975)).toBeCloseTo(0.775, 3);
    expect(baseOpacityFor(1925)).toBeCloseTo(0.475, 3);
    expect(baseOpacityFor(1875)).toBeCloseTo(0.325, 3);
    expect(baseOpacityFor(1825)).toBeCloseTo(0.185, 3);
    expect(baseOpacityFor(1700)).toBe(0.12);
    expect(baseOpacityFor(-15000)).toBe(0.12);
    expect(baseOpacityFor(Number.NaN)).toBe(1);
  });

  it('never rises as the year goes back', () => {
    let prev = 1;
    for (let y = 2000; y >= 1790; y--) {
      const o = baseOpacityFor(y);
      expect(o).toBeLessThanOrEqual(prev);
      prev = o;
    }
  });
});

describe('mapModeFor', () => {
  it('maps each gear to the plan', () => {
    expect(mapModeFor('now')).toBe('today');
    expect(mapModeFor('years')).toBe('historical');
    expect(mapModeFor('decades')).toBe('historical');
    expect(mapModeFor('centuries')).toBe('nature');
    expect(mapModeFor('millennia')).toBe('nature');
    expect(mapModeFor('ice-ages')).toBe('nature');
    expect(mapModeFor('millions')).toBe('globe');
    expect(mapModeFor('eons')).toBe('globe');
    expect(mapModeFor('future')).toBe('future');
  });

  it('is forgiving about case and falls back to today', () => {
    expect(mapModeFor(' Decades ')).toBe('historical');
    expect(mapModeFor('nonsense')).toBe('today');
    expect(mapModeFor('')).toBe('today');
  });
});

describe('ohmDateString', () => {
  it('turns years into the plugin date form, with no year 0', () => {
    expect(ohmDateString(1889)).toBe('1889');
    expect(ohmDateString(1889.7)).toBe('1889');
    expect(ohmDateString(-500)).toBe('-500');
    expect(ohmDateString(0)).toBe('-1');
    expect(ohmDateString(' 1889-06-06 ')).toBe('1889-06-06');
  });
});

// ---------------------------------------------------------------------------
// Small style helpers
// ---------------------------------------------------------------------------

describe('scaleOpacity and isNatureLayer', () => {
  it('scales numbers, defaults, stops functions and expressions', () => {
    expect(scaleOpacity(undefined, 0.4)).toBe(0.4);
    expect(scaleOpacity(0.9, 0.5)).toBe(0.45);
    expect(scaleOpacity({ base: 1, stops: [[8, 0], [10, 0.4]] }, 0.5)).toEqual({ base: 1, stops: [[8, 0], [10, 0.2]] });
    expect(scaleOpacity(['interpolate', ['linear'], ['zoom'], 4, 0.5, 8, 1], 0.25)).toEqual([
      '*',
      ['interpolate', ['linear'], ['zoom'], 4, 0.5, 8, 1],
      0.25,
    ]);
  });

  it('keeps background, raster, water, waterway and landcover as nature', () => {
    expect(isNatureLayer({ type: 'background' })).toBe(true);
    expect(isNatureLayer({ type: 'raster' })).toBe(true);
    expect(isNatureLayer({ type: 'fill', 'source-layer': 'water' })).toBe(true);
    expect(isNatureLayer({ type: 'line', 'source-layer': 'waterway' })).toBe(true);
    expect(isNatureLayer({ type: 'fill', 'source-layer': 'landcover' })).toBe(true);
    expect(isNatureLayer({ type: 'fill', 'source-layer': 'building' })).toBe(false);
    expect(isNatureLayer({ type: 'line', 'source-layer': 'transportation' })).toBe(false);
    expect(isNatureLayer({ type: 'symbol', 'source-layer': 'place' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attachHistoryLayers on a fake map
// ---------------------------------------------------------------------------

describe('attachHistoryLayers', () => {
  const sheet1897 = sheets.find((s) => s.objectId === 165595)!;
  const sheet1909 = sheets.find((s) => s.objectId === 165208)!;

  it('showTopo adds a raster source and layer under the first label layer, with the USGS credit', () => {
    const fake = new FakeMap(positronLike());
    const layers = attachHistoryLayers(asHistoryMap(fake));
    layers.showTopo(sheet1897);

    expect(fake.sources.get(TOPO_SOURCE_ID)).toEqual({
      type: 'raster',
      tiles: [topoTileUrl(sheet1897)],
      tileSize: 256,
      minzoom: 5,
      maxzoom: 17,
      attribution: TOPO_ATTRIBUTION,
    });
    const added = fake.methods('addLayer');
    expect(added).toHaveLength(1);
    expect(added[0]!.args[0]).toMatchObject({ id: TOPO_LAYER_ID, type: 'raster', source: TOPO_SOURCE_ID, paint: { 'raster-opacity': 0.85 } });
    expect(added[0]!.args[1]).toBe('label_city');
    const ids = fake.ids();
    expect(ids.indexOf(TOPO_LAYER_ID)).toBe(ids.indexOf('label_city') - 1);
    expect(ids.indexOf(TOPO_LAYER_ID)).toBeGreaterThan(ids.indexOf('highway_minor'));
  });

  it('showTopo with another sheet replaces it; the same sheet again is a no-op; hideTopo removes both', () => {
    const fake = new FakeMap(positronLike());
    const layers = attachHistoryLayers(asHistoryMap(fake));
    layers.showTopo(sheet1897);
    layers.showTopo(sheet1897);
    expect(fake.methods('addSource')).toHaveLength(1);

    layers.showTopo(sheet1909);
    expect(fake.methods('removeLayer').map((c) => c.args[0])).toEqual([TOPO_LAYER_ID]);
    expect(fake.methods('removeSource').map((c) => c.args[0])).toEqual([TOPO_SOURCE_ID]);
    expect((fake.sources.get(TOPO_SOURCE_ID) as { tiles: string[] }).tiles[0]).toContain('%5B165208%5D');

    layers.hideTopo();
    expect(fake.getLayer(TOPO_LAYER_ID)).toBeUndefined();
    expect(fake.sources.has(TOPO_SOURCE_ID)).toBe(false);
    expect(fake.ids()).toEqual(positronLike().map((l) => l.id));
    layers.hideTopo(); // safe twice
  });

  it('setOhmDate adds the OHM vector source and the curated layers once, then filters with filterByDate', () => {
    const fake = new FakeMap(positronLike());
    const layers = attachHistoryLayers(asHistoryMap(fake));
    layers.setOhmDate(1889);

    expect(fake.sources.get(OHM_SOURCE_ID)).toEqual({
      type: 'vector',
      url: 'https://vtiles.openhistoricalmap.org/maps/ohm.json',
      attribution: OHM_ATTRIBUTION,
    });
    expect(OHM_ATTRIBUTION).toContain('OpenHistoricalMap contributors');
    const ids = fake.ids();
    for (const id of OHM_LAYER_IDS) {
      expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf('boundary_2'));
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf('label_city'));
    }
    const kinds = new Set(fake.layers.filter((l) => l.source === OHM_SOURCE_ID).map((l) => l['source-layer']));
    expect(kinds).toEqual(new Set(['water_areas', 'water_lines', 'buildings', 'transport_lines']));
    expect(mocks.filterByDate).toHaveBeenCalledTimes(1);
    expect(mocks.filterByDate).toHaveBeenCalledWith(fake, '1889');

    layers.setOhmDate('1889-06-06');
    expect(fake.methods('addSource')).toHaveLength(1);
    expect(fake.methods('addLayer')).toHaveLength(OHM_LAYER_IDS.length);
    expect(mocks.filterByDate).toHaveBeenLastCalledWith(fake, '1889-06-06');

    layers.setOhmDate(null);
    expect(fake.sources.has(OHM_SOURCE_ID)).toBe(false);
    expect(fake.ids()).toEqual(positronLike().map((l) => l.id));
    expect(mocks.filterByDate).toHaveBeenCalledTimes(2);
  });

  it('keeps the topo sheet under the OHM features whichever is added first', () => {
    const fake = new FakeMap(positronLike());
    const layers = attachHistoryLayers(asHistoryMap(fake));
    layers.setOhmDate(1909);
    layers.showTopo(sheet1909);
    let ids = fake.ids();
    expect(ids.indexOf(TOPO_LAYER_ID)).toBeLessThan(ids.indexOf(OHM_LAYER_IDS[0]!));
    expect(ids.indexOf(TOPO_LAYER_ID)).toBeGreaterThan(ids.indexOf('boundary_2'));

    layers.setOhmDate(null);
    layers.setOhmDate(1909);
    ids = fake.ids();
    expect(ids.indexOf(TOPO_LAYER_ID)).toBeLessThan(ids.indexOf(OHM_LAYER_IDS[0]!));
  });

  it('setBaseOpacity fades every base layer in proportion and leaves our own layers alone', () => {
    const fake = new FakeMap(positronLike());
    const layers = attachHistoryLayers(asHistoryMap(fake));
    layers.showTopo(sheet1897);
    layers.setBaseOpacity(0.4);

    const touched = fake.methods('setPaintProperty');
    const byLayer = new Map<string, Array<[string, unknown]>>();
    for (const c of touched) {
      const [id, prop, value] = c.args as [string, string, unknown];
      byLayer.set(id, [...(byLayer.get(id) ?? []), [prop, value]]);
    }
    expect(byLayer.get('background')).toEqual([['background-opacity', 0.4]]);
    expect(byLayer.get('water')).toEqual([['fill-opacity', 0.4]]);
    expect(byLayer.get('highway_minor')).toEqual([['line-opacity', 0.36]]);
    expect(byLayer.get('landcover_wood')).toEqual([['fill-opacity', { base: 1, stops: [[8, 0], [10, 0.16]] }]]);
    expect(byLayer.get('boundary_2')).toEqual([['line-opacity', ['*', ['interpolate', ['linear'], ['zoom'], 4, 0.5, 8, 1], 0.4]]]);
    expect(byLayer.get('label_city')).toEqual([
      ['text-opacity', 0.4],
      ['icon-opacity', 0.4],
    ]);
    expect(byLayer.has(TOPO_LAYER_ID)).toBe(false);
    expect(fake.getPaintProperty(TOPO_LAYER_ID, 'raster-opacity')).toBe(0.85);

    // A second call scales the ORIGINAL value, not the already faded one.
    layers.setBaseOpacity(0.5);
    expect(fake.getPaintProperty('highway_minor', 'line-opacity')).toBe(0.45);
    // Back to 1 restores exactly what the style had.
    layers.setBaseOpacity(1);
    expect(fake.getPaintProperty('highway_minor', 'line-opacity')).toBe(0.9);
    expect(fake.getPaintProperty('water', 'fill-opacity')).toBeUndefined();
    expect(fake.getPaintProperty('landcover_wood', 'fill-opacity')).toEqual({ base: 1, stops: [[8, 0], [10, 0.4]] });
  });

  it('setGhost hides roads, buildings, boundaries and labels, keeps water and land, and restores what was hidden before', () => {
    const fake = new FakeMap(positronLike());
    const layers = attachHistoryLayers(asHistoryMap(fake));
    layers.setGhost(true);

    const vis = (id: string) => fake.getLayoutProperty(id, 'visibility');
    expect(vis('building')).toBe('none');
    expect(vis('highway_minor')).toBe('none');
    expect(vis('boundary_2')).toBe('none');
    expect(vis('label_city')).toBe('none');
    expect(vis('label_state')).toBe('none');
    expect(vis('background')).toBeUndefined();
    expect(vis('water')).toBeUndefined();
    expect(vis('waterway')).toBeUndefined();
    expect(vis('landcover_wood')).toBeUndefined();

    layers.setGhost(false);
    expect(vis('building')).toBe('visible');
    expect(vis('label_city')).toBe('visible');
    expect(vis('label_state')).toBe('none'); // was hidden by the style itself
  });

  it('destroy removes everything it added, restores the base, and is safe to call twice', () => {
    const fake = new FakeMap(positronLike());
    const layers = attachHistoryLayers(asHistoryMap(fake));
    layers.showTopo(sheet1897);
    layers.setOhmDate(1897);
    layers.setBaseOpacity(0.25);
    layers.setGhost(true);
    layers.destroy();
    layers.destroy();

    expect(fake.ids()).toEqual(positronLike().map((l) => l.id));
    expect(fake.sources.size).toBe(0);
    expect(fake.getPaintProperty('highway_minor', 'line-opacity')).toBe(0.9);
    expect(fake.getLayoutProperty('building', 'visibility')).toBe('visible');

    // After destroy, nothing is added any more.
    layers.showTopo(sheet1897);
    layers.setOhmDate(1900);
    expect(fake.sources.size).toBe(0);
  });

  it('copes with a style that has not loaded yet', () => {
    const fake = new FakeMap([]);
    const layers = attachHistoryLayers(asHistoryMap(fake));
    expect(() => layers.setBaseOpacity(0.5)).not.toThrow();
    expect(() => layers.setGhost(true)).not.toThrow();
    layers.showTopo(sheet1897); // no label layer: goes on top
    expect(fake.ids()).toEqual([TOPO_LAYER_ID]);
    expect(fake.methods('addLayer')[0]!.args[1]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The globe projection
// ---------------------------------------------------------------------------

describe('projectOrthographic', () => {
  const center: LngLat = { lng: -122, lat: 0 };

  it('puts the equator point at the centre longitude in the middle of the drawing', () => {
    const p = projectOrthographic({ lng: -122, lat: 0 }, center);
    expect(p.x).toBeCloseTo(GLOBE_CENTER_X, 6);
    expect(p.y).toBeCloseTo(GLOBE_CENTER_Y, 6);
    expect(p.visible).toBe(true);
  });

  it('puts north up and east right', () => {
    const north = projectOrthographic({ lng: -122, lat: 45 }, center);
    expect(north.x).toBeCloseTo(GLOBE_CENTER_X, 6);
    expect(north.y).toBeLessThan(GLOBE_CENTER_Y);
    expect(north.y).toBeCloseTo(GLOBE_CENTER_Y - GLOBE_RADIUS * Math.SQRT1_2, 6);
    const east = projectOrthographic({ lng: -92, lat: 0 }, center);
    expect(east.x).toBeGreaterThan(GLOBE_CENTER_X);
    expect(east.y).toBeCloseTo(GLOBE_CENTER_Y, 6);
    const pole = projectOrthographic({ lng: 10, lat: 90 }, center);
    expect(pole.y).toBeCloseTo(GLOBE_CENTER_Y - GLOBE_RADIUS, 6);
    expect(pole.visible).toBe(true);
  });

  it('marks the far side of the globe invisible', () => {
    const back = projectOrthographic({ lng: 58, lat: 0 }, center); // 180° away
    expect(back.visible).toBe(false);
    const almostBack = projectOrthographic({ lng: 0, lat: 20 }, center); // 122° away
    expect(almostBack.visible).toBe(false);
    const rim = projectOrthographic({ lng: -32, lat: 0 }, center); // exactly 90° away
    expect(rim.visible).toBe(true);
    expect(rim.x).toBeCloseTo(GLOBE_CENTER_X + GLOBE_RADIUS, 6);
  });

  it('honours a custom radius and centre', () => {
    const p = projectOrthographic({ lng: 0, lat: 0 }, { lng: -90, lat: 0 }, 10, 100, 50);
    expect(p.x).toBeCloseTo(110, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });
});

describe('globe helpers', () => {
  it('centres on the paleo longitude when there is one, else on today', () => {
    const today: LngLat = { lng: -122.3, lat: 47.6 };
    expect(globeCenterFor({ todayPoint: today, paleoPoint: { lng: -60, lat: 12 } })).toEqual({ lng: -60, lat: 0 });
    expect(globeCenterFor({ todayPoint: today, paleoPoint: null })).toEqual({ lng: -122.3, lat: 0 });
    expect(globeCenterFor({ todayPoint: today, paleoPoint: { lng: -60, lat: 12 }, sketch: true })).toEqual({ lng: -122.3, lat: 0 });
  });

  it('nudges the future sketch about 9° west and 1° south, folding across the date line', () => {
    expect(sketchPoint({ lng: -122.3, lat: 47.6 })).toEqual({ lng: -131.3, lat: 46.6 });
    const folded = sketchPoint({ lng: -176, lat: 0 });
    expect(folded.lng).toBeCloseTo(175, 6);
  });

  it('labels the dot', () => {
    expect(globeLabel(100, false)).toBe('Your spot, 100 Ma ago');
    expect(globeLabel(1000, false)).toBe('Your spot, 1,000 Ma ago');
    expect(globeLabel(50, true)).toBe('Your spot, 50 Ma from now');
  });

  it('draws a graticule path that breaks where it goes behind the globe', () => {
    const d = pathOnGlobe(
      [
        { lng: -122, lat: 0 },
        { lng: -92, lat: 0 },
        { lng: 58, lat: 0 }, // hidden
        { lng: -152, lat: 0 },
      ],
      { lng: -122, lat: 0 },
    );
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(1);
  });
});
