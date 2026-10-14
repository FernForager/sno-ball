/**
 * Hand-written types for @openhistoricalmap/maplibre-gl-dates, which ships
 * plain CommonJS and no declarations. Only the one function the site uses
 * is described; see src/lib/map-history.ts for how it is called.
 */
declare module '@openhistoricalmap/maplibre-gl-dates' {
  import type { Map as MapLibreMap } from 'maplibre-gl';

  /**
   * Rewrite the filter of every vector layer on the map so only features
   * alive on `date` (a `YYYY[-MM[-DD]]` string, negative years for BCE, or
   * a Date) are drawn. Features that carry no dates at all are kept.
   */
  export function filterByDate(map: MapLibreMap, date: string | Date): void;
}
