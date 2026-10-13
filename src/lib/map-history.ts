/**
 * The map as it was: historical layers laid over the present-day map.
 *
 * map.ts draws today's streets (OpenFreeMap positron) and the one marker.
 * This module adds what the time dial needs on top of that map, following
 * Plan v2 §5 ("Map strategy"):
 *
 *  - USGS historical topographic sheets (1890s onward), one sheet at a
 *    time, as a raster layer from the USGS/Esri ImageServer;
 *  - OpenHistoricalMap's dated vector features (roads, railways, buildings,
 *    water), filtered to the selected date with maplibre-gl-dates;
 *  - fading today's streets as the dial goes back (an "opacity ramp"), and
 *    hiding them altogether, keeping only water and land, for the gears
 *    where streets make no sense (centuries, millennia, ice ages).
 *
 * Pure helpers (sheet choice, URLs, captions, the ramp, the gear-to-mode
 * table) are exported on their own so they can be unit-tested without a
 * map. attachHistoryLayers wraps a live MapLibre map and does the adding
 * and removing. Nothing here loads MapLibre: it only receives a map that
 * map.ts already built, and imports MapLibre's types alone.
 *
 * Sources and credit:
 *  - USGS sheets are public domain; the collection asks to be credited as
 *    "Historical Topographic Map Collection courtesy of the U.S. Geological
 *    Survey, Esri". The raster source carries that line so MapLibre shows
 *    it in the corner whenever a sheet is on screen.
 *  - OpenHistoricalMap features: the vector source carries the OHM credit
 *    the same way.
 */

import type { LngLat, Source } from './types';
import { fetchJson } from './http';
import { limiterFor } from './queue';
import { cached } from './cache';
import type {
  FilterSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  RasterSourceSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl';
// The plugin is plain CommonJS and ships no type declarations; the one
// function we use is declared by hand in src/types/maplibre-gl-dates.d.ts.
import * as ohmDates from '@openhistoricalmap/maplibre-gl-dates';

// ---------------------------------------------------------------------------
// Constants: services, credit lines, layer ids
// ---------------------------------------------------------------------------

/** The USGS Historical Topographic Maps image service (hosted by Esri, public domain scans). */
export const TOPO_IMAGE_SERVER =
  'https://historical1.arcgis.com/arcgis/rest/services/USGS_Historical_Topographic_Maps/ImageServer';

/** The credit line the collection asks for. Shown in the map corner and under the caption. */
export const TOPO_ATTRIBUTION = 'Historical Topographic Map Collection courtesy of the U.S. Geological Survey, Esri';

export const TOPO_SOURCE: Readonly<Source> = {
  name: 'USGS Historical Topographic Map Collection (via Esri)',
  url: TOPO_IMAGE_SERVER,
  license: 'Public domain',
};

/** The catalog fields we ask for. Asking for `*` returns ~45 attributes per row (360 KB for 31 rows). */
export const TOPO_OUT_FIELDS: readonly string[] = [
  'OBJECTID',
  'Map_Name',
  'Map_Scale',
  'Date_On_Map',
  'Imprint_Year',
  'Year',
  'Download_GeoPDF',
  'Citation',
];

/** Catalog answers are kept for 30 days: old maps do not change. */
export const TOPO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Catalog answers are shared by every point in the same 0.01° cell (about 1 km). */
export const TOPO_CELL_DEG = 0.01;

/** A sheet counts for a year only when its survey year is within this many years. */
export const TOPO_YEAR_WINDOW = 25;

/** How strongly the sheet is painted over the faded base. */
export const TOPO_OPACITY = 0.85;

/** OpenHistoricalMap's vector tiles (TileJSON) and the style the curated layers are drawn from. */
export const OHM_TILEJSON_URL = 'https://vtiles.openhistoricalmap.org/maps/ohm.json';
export const OHM_TILE_URL = 'https://vtiles.openhistoricalmap.org/maps/ohm/{z}/{x}/{y}.pbf';
export const OHM_STYLE_URL = 'https://www.openhistoricalmap.org/map-styles/main/main.json';
/** OpenHistoricalMap's data is dedicated to the public domain (CC0); the project asks only to be named. */
export const OHM_ATTRIBUTION = '© OpenHistoricalMap contributors, CC0';

export const OHM_SOURCE: Readonly<Source> = {
  name: 'OpenHistoricalMap contributors',
  url: 'https://www.openhistoricalmap.org',
  license: 'CC0',
};

/** Ids of everything this module adds start with this, so they are easy to tell from the base style's. */
export const HISTORY_ID_PREFIX = 'sno-';
export const TOPO_SOURCE_ID = 'sno-topo';
export const TOPO_LAYER_ID = 'sno-topo';
export const OHM_SOURCE_ID = 'sno-ohm';

// ---------------------------------------------------------------------------
// USGS topographic sheets: catalog, choice, tiles, caption
// ---------------------------------------------------------------------------

/** One scanned sheet from the USGS catalog. Several rows can share a sheet: one per printing. */
export interface TopoSheet {
  objectId: number;
  /** The quadrangle name, e.g. "Seattle", "Seattle South", "Snohomish". */
  name: string;
  /** The denominator of the map scale: 24000 for 1:24,000. */
  scale: number;
  /** The year printed on the map (the survey or edition year). */
  dateOnMap: number;
  /** The year this copy was printed; a sheet surveyed in 1897 was reprinted as late as 1909. */
  imprintYear: number;
  /** The year the catalog files the sheet under; what the chooser compares with the dial. */
  year: number;
  /** The original scan (GeoPDF) for "download the original". */
  downloadUrl?: string;
  citation?: string;
}

/** The shape of an ImageServer `query` answer (only the parts we read). */
export interface TopoCatalogResponse {
  features?: Array<{ attributes?: Record<string, unknown> }>;
  /** ArcGIS reports problems inside a 200 response. */
  error?: { code?: number; message?: string };
}

/** The 0.01° cell a point falls in, as a cache-key fragment. */
export function topoCellKey(p: LngLat): string {
  const col = Math.floor(p.lng / TOPO_CELL_DEG);
  const row = Math.floor(p.lat / TOPO_CELL_DEG);
  return `${col}:${row}`;
}

/** The catalog query: which sheets cover this point? */
export function topoCatalogUrl(p: LngLat): string {
  const params = new URLSearchParams({
    geometry: `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: TOPO_OUT_FIELDS.join(','),
    returnGeometry: 'false',
    f: 'json',
  });
  return `${TOPO_IMAGE_SERVER}/query?${params.toString()}`;
}

/** A number from a catalog attribute that may arrive as a number or a numeric string. */
function numberField(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function stringField(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * The sheets in a catalog answer, oldest first (then finest scale, then
 * earliest printing). Rows missing an id, a year or a scale are skipped.
 * Throws when ArcGIS reports an error, so a bad answer is never cached.
 */
export function sheetsFromCatalog(res: TopoCatalogResponse): TopoSheet[] {
  if (res.error) {
    throw new Error(`USGS topo catalog error ${res.error.code ?? ''}: ${res.error.message ?? 'unknown'}`.trim());
  }
  const out: TopoSheet[] = [];
  for (const feature of res.features ?? []) {
    const a = feature.attributes ?? {};
    const objectId = numberField(a['OBJECTID']);
    const scale = numberField(a['Map_Scale']);
    const year = numberField(a['Year']) ?? numberField(a['Date_On_Map']);
    const name = stringField(a['Map_Name']);
    if (objectId === undefined || scale === undefined || year === undefined || name === undefined) continue;
    const dateOnMap = numberField(a['Date_On_Map']) ?? year;
    const imprintYear = numberField(a['Imprint_Year']) ?? dateOnMap;
    const sheet: TopoSheet = { objectId, name, scale, dateOnMap, imprintYear, year };
    const downloadUrl = stringField(a['Download_GeoPDF']);
    if (downloadUrl) sheet.downloadUrl = downloadUrl;
    const citation = stringField(a['Citation']);
    if (citation) sheet.citation = citation;
    out.push(sheet);
  }
  out.sort((x, y) => x.year - y.year || x.scale - y.scale || x.imprintYear - y.imprintYear || x.objectId - y.objectId);
  return out;
}

/**
 * Every USGS sheet that covers a point, oldest first. One catalog request
 * per 0.01° cell, cached for 30 days, through the shared rate limiter for
 * the Esri host. Errors reach the caller (nothing is cached), so the UI
 * can fall back to "no historical map here".
 */
export async function topoSheetsAt(p: LngLat): Promise<TopoSheet[]> {
  const url = topoCatalogUrl(p);
  return cached(`topo:catalog:${topoCellKey(p)}`, { ttlMs: TOPO_TTL_MS }, async () => {
    const res = await limiterFor('historical1.arcgis.com').run(() => fetchJson<TopoCatalogResponse>(url));
    return sheetsFromCatalog(res);
  });
}

/**
 * Which map scales to prefer at a zoom, best first (Plan v2 §5). A sheet
 * at any other scale is still allowed, but only when none of these fit.
 */
export function scalePreference(zoom: number): readonly number[] {
  if (zoom >= 12) return [24000, 62500];
  if (zoom >= 9) return [62500, 125000];
  return [125000, 250000];
}

/**
 * The one sheet to show for a year at a zoom, or null when no sheet was
 * surveyed within 25 years of it. The rule, in order:
 *
 *  1. only sheets with |Year − year| ≤ 25;
 *  2. the preferred scale for the zoom wins (24,000 then 62,500 when zoomed
 *     into a neighbourhood, 62,500 then 125,000 for a city, 125,000 then
 *     250,000 for a region), then any other scale;
 *  3. within that, the nearest survey year; a tie goes to the older sheet;
 *  4. of several printings of the same sheet, the earliest printing (the
 *     one closest to the survey), then the lowest id, so the choice is stable.
 */
export function chooseTopoSheet(sheets: readonly TopoSheet[], year: number, zoom: number): TopoSheet | null {
  const candidates = sheets.filter((s) => Math.abs(s.year - year) <= TOPO_YEAR_WINDOW);
  if (candidates.length === 0) return null;

  const preferred = scalePreference(zoom);
  const tiers: TopoSheet[][] = preferred.map((scale) => candidates.filter((s) => s.scale === scale));
  tiers.push(candidates.filter((s) => !preferred.includes(s.scale)));

  const tier = tiers.find((t) => t.length > 0);
  if (!tier) return null;
  const best = [...tier].sort(
    (a, b) =>
      Math.abs(a.year - year) - Math.abs(b.year - year) ||
      a.year - b.year ||
      a.scale - b.scale ||
      a.imprintYear - b.imprintYear ||
      a.objectId - b.objectId,
  );
  return best[0] ?? null;
}

/** The mosaic rule that pins the image service to one sheet. */
export function topoMosaicRule(sheet: TopoSheet): { mosaicMethod: string; lockRasterIds: number[] } {
  return { mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [sheet.objectId] };
}

/**
 * The tile template for one sheet, for a MapLibre raster source. MapLibre
 * fills in `{bbox-epsg-3857}` per tile, so that token must stay literal;
 * the mosaic rule is JSON, URL-encoded. 256 px JPEG tiles in Web Mercator.
 */
export function topoTileUrl(sheet: TopoSheet): string {
  const rule = encodeURIComponent(JSON.stringify(topoMosaicRule(sheet)));
  return (
    `${TOPO_IMAGE_SERVER}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857` +
    `&size=256,256&format=jpg&mosaicRule=${rule}&f=image`
  );
}

/** The map note for a sheet: what it is on the first line, the credit on the second. */
export function topoCaption(sheet: TopoSheet): string {
  const scale = `1:${sheet.scale.toLocaleString('en-US')}`;
  return (
    `USGS ${sheet.name} sheet (${scale}), surveyed ${sheet.dateOnMap}, printed ${sheet.imprintYear}\n` +
    `Source: ${TOPO_ATTRIBUTION}`
  );
}

// ---------------------------------------------------------------------------
// The ramp and the gear table
// ---------------------------------------------------------------------------

/** The plan's opacity ramp for today's streets, as (year, opacity) points. */
export const BASE_OPACITY_RAMP: ReadonlyArray<readonly [number, number]> = [
  [1800, 0.12],
  [1850, 0.25],
  [1900, 0.4],
  [1950, 0.55],
  [2000, 1],
];

/**
 * How visible today's streets should be at a year: fully at 2000 and
 * after, 0.55 at 1950, 0.4 at 1900, 0.25 at 1850, 0.12 at 1800, straight
 * lines between, and the 1800 value for anything earlier (a faint ghost,
 * never nothing, so the visitor can still find their spot).
 */
export function baseOpacityFor(year: number): number {
  const first = BASE_OPACITY_RAMP[0];
  const last = BASE_OPACITY_RAMP[BASE_OPACITY_RAMP.length - 1];
  if (!first || !last) return 1;
  if (!Number.isFinite(year)) return 1;
  if (year >= last[0]) return last[1];
  if (year <= first[0]) return first[1];
  for (let i = 1; i < BASE_OPACITY_RAMP.length; i++) {
    const a = BASE_OPACITY_RAMP[i - 1];
    const b = BASE_OPACITY_RAMP[i];
    if (!a || !b) break;
    if (year <= b[0]) {
      const t = (year - a[0]) / (b[0] - a[0]);
      return round3(a[1] + t * (b[1] - a[1]));
    }
  }
  return last[1];
}

export type MapMode = 'today' | 'historical' | 'nature' | 'globe' | 'future';

/**
 * Which kind of map a gear of the dial wants (Plan v2 §5): today's map,
 * the historical layers, nature only (water and land, no streets), the
 * paleo globe, or the future sketch. Unknown gears get today's map.
 */
export function mapModeFor(gear: string): MapMode {
  switch (gear.trim().toLowerCase()) {
    case 'now':
      return 'today';
    case 'years':
    case 'decades':
      return 'historical';
    case 'centuries':
    case 'millennia':
    case 'ice-ages':
    case 'ice ages':
      return 'nature';
    case 'millions':
    case 'eons':
      return 'globe';
    case 'future':
      return 'future';
    default:
      return 'today';
  }
}

// ---------------------------------------------------------------------------
// OpenHistoricalMap layers (a curated subset of the OHM "historical" style)
// ---------------------------------------------------------------------------

/** OHM's transport_lines `type` values we draw as major roads. */
const OHM_MAJOR_ROADS = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'];
/** ...as minor roads. */
const OHM_MINOR_ROADS = ['tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'road', 'pedestrian', 'service'];
/** ...as railways (abandoned lines included: a 1900 map should show the 1900 line). */
const OHM_RAILWAYS = ['rail', 'light_rail', 'tram', 'narrow_gauge', 'subway', 'monorail', 'funicular', 'preserved', 'disused', 'abandoned'];

function typeIn(values: readonly string[]): FilterSpecification {
  return ['in', ['get', 'type'], ['literal', [...values]]] as unknown as FilterSpecification;
}

/**
 * The OHM layers we draw, bottom first: water areas and lines, buildings,
 * minor and major roads, railways. Drawn in a warm sepia so they read as
 * "then" against the grey "now". Source-layer names follow OHM's vector
 * tileset (water_areas, water_lines, buildings, transport_lines) and the
 * `type` property carries the OSM-style highway/railway value. Labels are
 * left out on purpose: the glyphs would need OHM's font server.
 */
export const OHM_LAYERS: readonly LayerSpecification[] = [
  {
    id: 'sno-ohm-water-areas',
    type: 'fill',
    source: OHM_SOURCE_ID,
    'source-layer': 'water_areas',
    paint: { 'fill-color': '#9fc0dc', 'fill-opacity': 0.55 },
  },
  {
    id: 'sno-ohm-water-lines',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'water_lines',
    paint: { 'line-color': '#7fa9cc', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2] },
  },
  {
    id: 'sno-ohm-buildings',
    type: 'fill',
    source: OHM_SOURCE_ID,
    'source-layer': 'buildings',
    minzoom: 12,
    paint: { 'fill-color': '#b8946e', 'fill-opacity': 0.6, 'fill-outline-color': '#8f6a48' },
  },
  {
    id: 'sno-ohm-roads-minor',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'transport_lines',
    minzoom: 11,
    filter: typeIn(OHM_MINOR_ROADS),
    paint: { 'line-color': '#a8865f', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 2.5] },
  },
  {
    id: 'sno-ohm-roads-major',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'transport_lines',
    filter: typeIn(OHM_MAJOR_ROADS),
    paint: { 'line-color': '#8c6239', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 16, 4] },
  },
  {
    id: 'sno-ohm-railways',
    type: 'line',
    source: OHM_SOURCE_ID,
    'source-layer': 'transport_lines',
    filter: typeIn(OHM_RAILWAYS),
    paint: {
      'line-color': '#5b4a3a',
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 16, 2.2],
      'line-dasharray': [4, 2],
    },
  },
];

/** The ids of the OHM layers, in drawing order. */
export const OHM_LAYER_IDS: readonly string[] = OHM_LAYERS.map((l) => l.id);

/**
 * The date string maplibre-gl-dates expects (`YYYY`, `YYYY-MM` or
 * `YYYY-MM-DD`, a negative year for BCE) from a year number or a string
 * that is already in that form. There is no year 0; 0 is read as 1 BCE.
 */
export function ohmDateString(isoOrYear: string | number): string {
  if (typeof isoOrYear === 'number') {
    const y = Math.trunc(isoOrYear);
    return String(y === 0 ? -1 : y);
  }
  return isoOrYear.trim();
}

// ---------------------------------------------------------------------------
// The live layers on a map
// ---------------------------------------------------------------------------

export interface HistoryLayers {
  /** Paint one USGS sheet under the marker (replacing any sheet already shown). */
  showTopo(sheet: TopoSheet): void;
  /** Take the sheet away again. Safe when none is shown. */
  hideTopo(): void;
  /**
   * Show OpenHistoricalMap's features as they were on a date (a year number
   * or a `YYYY[-MM[-DD]]` string), adding the source and layers on first
   * use; null removes them.
   */
  setOhmDate(isoOrYear: string | number | null): void;
  /** Fade today's streets: 1 is normal, 0 invisible. Keeps each layer's own opacity in proportion. */
  setBaseOpacity(o: number): void;
  /** true hides today's roads, buildings, labels and boundaries, keeping water and land; false brings them back. */
  setGhost(nature: boolean): void;
  /** Remove everything this module added and restore the base layers. Safe to call twice. */
  destroy(): void;
}

/** The paint properties that control how visible a layer of each type is. */
export function opacityPropertiesFor(type: string): readonly string[] {
  switch (type) {
    case 'background':
      return ['background-opacity'];
    case 'fill':
      return ['fill-opacity'];
    case 'line':
      return ['line-opacity'];
    case 'raster':
      return ['raster-opacity'];
    case 'symbol':
      return ['text-opacity', 'icon-opacity'];
    case 'circle':
      return ['circle-opacity', 'circle-stroke-opacity'];
    case 'fill-extrusion':
      return ['fill-extrusion-opacity'];
    case 'heatmap':
      return ['heatmap-opacity'];
    default:
      return [];
  }
}

/**
 * A layer's own opacity value scaled by `o`, whatever form the style gave
 * it: a number, nothing (defaults to 1), a zoom "stops" function (each stop
 * is scaled) or an expression (wrapped in a multiplication).
 */
export function scaleOpacity(original: unknown, o: number): unknown {
  if (original === undefined || original === null) return round3(o);
  if (typeof original === 'number') return round3(original * o);
  if (Array.isArray(original)) return ['*', original, round3(o)];
  if (typeof original === 'object' && 'stops' in original) {
    const fn = original as { stops?: unknown };
    if (Array.isArray(fn.stops)) {
      const stops = fn.stops.map((stop: unknown) => {
        if (Array.isArray(stop) && stop.length === 2 && typeof stop[1] === 'number') {
          return [stop[0], round3(stop[1] * o)];
        }
        return stop;
      });
      return { ...fn, stops };
    }
  }
  return round3(o);
}

/**
 * Is this one of the base style's "nature" layers, the ones that stay when
 * streets are hidden? The background, any raster (positron's shaded
 * relief) and the water, waterway and land-cover layers.
 */
export function isNatureLayer(layer: { type: string; 'source-layer'?: string }): boolean {
  if (layer.type === 'background' || layer.type === 'raster' || layer.type === 'hillshade') return true;
  const sl = layer['source-layer'];
  return sl === 'water' || sl === 'waterway' || sl === 'landcover';
}

/**
 * The small slice of maplibregl.Map this module touches, so a test can pass
 * a fake. Written as methods (not function-typed properties) so MapLibre's
 * own, more precisely typed methods still count as implementing it; see
 * asHistoryMap, which is the compile-time proof that a real map fits.
 */
export interface HistoryMap {
  getStyle(): { layers?: LayerSpecification[] } | undefined;
  getLayer(id: string): unknown;
  getSource(id: string): unknown;
  addSource(id: string, source: RasterSourceSpecification | VectorSourceSpecification): unknown;
  removeSource(id: string): unknown;
  addLayer(layer: LayerSpecification, beforeId?: string): unknown;
  removeLayer(id: string): unknown;
  getPaintProperty(layerId: string, name: string): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): unknown;
  getLayoutProperty(layerId: string, name: string): unknown;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
}

/** A real MapLibre map as a HistoryMap (it already is one; this only says so to the compiler). */
export function asHistoryMap(map: MapLibreMap): HistoryMap {
  return map;
}

/**
 * Wrap a live map (from createStoryMap) with the historical layers. The
 * map's own style, whatever it has loaded when each method is first used,
 * counts as "the base": its layers are faded or hidden, never removed.
 * Everything added sits below the first label layer of the base (so
 * place names stay readable over an old sheet) and, being map layers, below
 * the marker, which is an HTML element above the whole canvas.
 */
export function attachHistoryLayers(map: HistoryMap): HistoryLayers {
  /** Base layer ids, snapshotted the first time the style has any. */
  let baseIds: string[] | null = null;
  const originalOpacity = new Map<string, unknown>();
  const originalVisibility = new Map<string, unknown>();
  let topoShown: TopoSheet | null = null;
  let ohmAdded = false;
  let destroyed = false;

  const styleLayers = (): LayerSpecification[] => {
    try {
      return map.getStyle()?.layers ?? [];
    } catch {
      return [];
    }
  };

  const hasLayer = (id: string): boolean => {
    try {
      return map.getLayer(id) !== undefined;
    } catch {
      return false;
    }
  };

  const hasSource = (id: string): boolean => {
    try {
      return map.getSource(id) !== undefined;
    } catch {
      return false;
    }
  };

  /** The base layers, as they are right now (ones the style dropped since are skipped). */
  const baseLayers = (): LayerSpecification[] => {
    const all = styleLayers();
    if (baseIds === null) {
      const ours = all.filter((l) => !l.id.startsWith(HISTORY_ID_PREFIX)).map((l) => l.id);
      if (ours.length === 0) return [];
      baseIds = ours;
    }
    const ids = new Set(baseIds);
    return all.filter((l) => ids.has(l.id));
  };

  /** The first label layer of the base: our layers go just under it. */
  const firstSymbolId = (): string | undefined => baseLayers().find((l) => l.type === 'symbol')?.id;

  /** Where the topo sheet goes: under our OHM layers if present, else under the labels. */
  const topoBeforeId = (): string | undefined => {
    const firstOhm = OHM_LAYER_IDS.find((id) => hasLayer(id));
    return firstOhm ?? firstSymbolId();
  };

  const hideTopo: HistoryLayers['hideTopo'] = () => {
    if (hasLayer(TOPO_LAYER_ID)) map.removeLayer(TOPO_LAYER_ID);
    if (hasSource(TOPO_SOURCE_ID)) map.removeSource(TOPO_SOURCE_ID);
    topoShown = null;
  };

  const showTopo: HistoryLayers['showTopo'] = (sheet) => {
    if (destroyed) return;
    if (topoShown && topoShown.objectId === sheet.objectId && hasLayer(TOPO_LAYER_ID)) return;
    hideTopo();
    const source: RasterSourceSpecification = {
      type: 'raster',
      tiles: [topoTileUrl(sheet)],
      tileSize: 256,
      minzoom: 5,
      maxzoom: 17,
      attribution: TOPO_ATTRIBUTION,
    };
    map.addSource(TOPO_SOURCE_ID, source);
    map.addLayer(
      { id: TOPO_LAYER_ID, type: 'raster', source: TOPO_SOURCE_ID, paint: { 'raster-opacity': TOPO_OPACITY } },
      topoBeforeId(),
    );
    topoShown = sheet;
  };

  const removeOhm = (): void => {
    for (const id of [...OHM_LAYER_IDS].reverse()) {
      if (hasLayer(id)) map.removeLayer(id);
    }
    if (hasSource(OHM_SOURCE_ID)) map.removeSource(OHM_SOURCE_ID);
    ohmAdded = false;
  };

  const addOhm = (): void => {
    if (!hasSource(OHM_SOURCE_ID)) {
      const source: VectorSourceSpecification = { type: 'vector', url: OHM_TILEJSON_URL, attribution: OHM_ATTRIBUTION };
      map.addSource(OHM_SOURCE_ID, source);
    }
    const before = firstSymbolId();
    for (const layer of OHM_LAYERS) {
      if (!hasLayer(layer.id)) map.addLayer(structuredClone(layer), before);
    }
    ohmAdded = true;
  };

  const setOhmDate: HistoryLayers['setOhmDate'] = (isoOrYear) => {
    if (destroyed) return;
    if (isoOrYear === null) {
      removeOhm();
      return;
    }
    if (!ohmAdded || !hasSource(OHM_SOURCE_ID)) addOhm();
    // The plugin rewrites the filter of every vector layer on the map and
    // keeps features that carry no dates at all, so today's (undated)
    // streets are untouched; calling it again only updates the date.
    ohmDates.filterByDate(map as MapLibreMap, ohmDateString(isoOrYear));
  };

  const setBaseOpacity: HistoryLayers['setBaseOpacity'] = (o) => {
    if (destroyed) return;
    const level = Math.min(1, Math.max(0, Number.isFinite(o) ? o : 1));
    for (const layer of baseLayers()) {
      for (const prop of opacityPropertiesFor(layer.type)) {
        const key = `${layer.id}\u0000${prop}`;
        if (!originalOpacity.has(key)) originalOpacity.set(key, map.getPaintProperty(layer.id, prop));
        const original = originalOpacity.get(key);
        const value = level === 1 ? original : scaleOpacity(original, level);
        map.setPaintProperty(layer.id, prop, value);
      }
    }
  };

  const setGhost: HistoryLayers['setGhost'] = (nature) => {
    if (destroyed) return;
    for (const layer of baseLayers()) {
      if (isNatureLayer(layer)) continue;
      if (!originalVisibility.has(layer.id)) originalVisibility.set(layer.id, map.getLayoutProperty(layer.id, 'visibility'));
      const value = nature ? 'none' : (originalVisibility.get(layer.id) ?? 'visible');
      map.setLayoutProperty(layer.id, 'visibility', value);
    }
  };

  const destroy: HistoryLayers['destroy'] = () => {
    if (destroyed) return;
    try {
      hideTopo();
      removeOhm();
      setBaseOpacity(1);
      setGhost(false);
    } finally {
      destroyed = true;
      originalOpacity.clear();
      originalVisibility.clear();
    }
  };

  return { showTopo, hideTopo, setOhmDate, setBaseOpacity, setGhost, destroy };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
