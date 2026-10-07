# Helper 3 findings (live fixtures + county data), 2026-10-07 22:10 UTC

Branch `helper/fixtures-1` @ 03f7ec3: 31 fixtures in tests/fixtures/live/ (README lists URL + capture time), public/data/wa-counties.json (39 counties, all fields 39/39 except namedAfter 34/39), public/data/wa-places.json (288 incorporated places; inception 54%, population 281, coords 287, wikipedia 285), public/data/README.md (queries, CC0, date).

## Must-apply in code
- GPlates batched form works: `reconstruct_points/?points=lon,lat&times=20,50,100,200,300,500&model=MERDITH2021` returns an object keyed by time as STRINGS ("20", "50", ...), each a GeoJSON MultiPoint. Single-time form returns a bare MultiPoint. At 500 Ma MERDITH2021 returns the sentinel [999.99, 999.99] (point not on any plate): filter |lon| > 180 or |lat| > 90.
- Wikimedia rate limits are severe when calls are parallel: Wikipedia action API returned 429 for minutes after 5 quick requests; query.wikidata.org said "Aggressively rate-limiting to 1 req / min" (rule created during a WDQS outage). Keep ALL Wikimedia calls sequential through one limiter (en.wikipedia.org + commons + wikidata API: >= 300 ms apart, concurrency 1), cache long, and do NOT depend on SPARQL at runtime (pre-bake populations at build time; at most one SPARQL call per visit, last in the queue, failure tolerated).
- PARCEL_GEO: ADDRESS has multiple spaces between number and street ("400   BROAD ST"): collapse whitespace. YR_BUILT_MAX / YR_RENOV_MAX are strings. LANDMARK is "Y" or null.
- DNR table 13: DMU_100K_FULL_NAME can be null (Walla Walla: unit Qa, age "Quaternary"): fall back to layer-11 MAP_UNIT_100K_SYMBOL / label. Join key value looks like "Compiled | Qgt".
- Seattle Annexation point-in-polygon returns cumulative polygons at the Space Needle (1869, 1883, 1886): min Year is right. Wedgwood point returns one polygon: 1953 (Ord. 81655), not 1945 as WA-PROBES said for a different point.
- Landmarks envelope query: EFF_DATE can be null.
- Nominatim: a POI can outrank the address (Spokane: "Numerica Skate Ribbon" first, the house way second); prefer results whose class/addresstype is building/house/address, else the first. extratags is null on plain address hits. Reverse at the Space Needle returns a bar node.
- Photon county is "King" (no "County" suffix): countyByName must accept both forms.
- USGS catalog rows are ~45 attributes (360 KB for 31 rows): restrict outFields in production.
- Seattle population SPARQL has only 3 dated statements (2010, 2018, 2020): population history will often be thin from Wikidata; consider Wikipedia infobox/census tables at build time later.
