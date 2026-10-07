# sno-ball — project plan

Site name proposals (repo stays `sno-ball`): **Snowball** (recommended: it matches the repo, the story goes small-to-big like a rolling snowball, and the site has a built-in "Snowball Earth" chapter), **Here Before**, **Underfoot**.

---

# PART 1 — The plan in plain English

**What the site does.** You type a street address. The page becomes a short story you read by scrolling, about that exact spot, told from the smallest thing outward: the house, the street, the neighborhood, the city, the county, the state, the country, the continent, and finally the rock under the floor and where that rock has travelled across the planet. At the bottom is a time control. Flip it to 1890, to the year 1000, to the last ice age, to 66 million years ago, and the story is re-told for that date. Places that did not exist yet say so plainly ("Not yet. Portland will be founded in 1851, 61 years from now"). A small map at the top pulls back from your front door to the whole globe as you scroll, and shows the streets as they were on the chosen date wherever such a map exists.

**What the visitor sees.** One address box (no suggestions dropdown: the free address service forbids that), three example addresses to tap, and a "use my location" button. Then a one-sentence biography of the spot, one chapter card per ring, the small map, and the time dial. Every card says where its facts came from.

**What is behind each ring.** House: the map's own record of the building (outline, floors, year built when someone recorded it). Street: its name and, where known, what it is named after. Neighborhood, city, county, state, country: Wikipedia text and photos, plus dated facts from Wikidata (founded, population by year). Continent/plate: a geology database says what rock is mapped at the spot and how old it is; a plate-motion service says where the spot sat on the globe at any time in the last billion years; a fossil database lists what lived nearby.

**What is behind each stretch of time.** The last ~150 years: historical street maps where volunteers have drawn them (OpenHistoricalMap), old photos, Wikipedia's history sections. 1500 to 1870: the same, thinner. Before 1500: mostly Wikipedia prose and "founded in" dates; the map shows land and water only. Ice ages: short texts written for the site plus the rock card. Millions of years: a globe with the continents in their old positions and a dot for your spot. Beyond a billion years: names, ages, and honest "no map exists for this time" captions.

**Rich versus thin, and why.** Cities, states and countries will be rich because Wikipedia has written a lot about them. Houses, blocks and ordinary streets will be thin because almost nobody has written about them; that is normal, not a bug. The design makes thin rings look thin (a hairline in the tree-ring graphic), says what it does know, and points you outward. Historical street maps exist for some big cities and not for most suburbs; where they are missing, the map shows today's streets faded with a caption saying so. It never shows a fake 1890.

**What it costs.** $0. The site is a folder of files hosted free by GitHub Pages (GitHub serving your code folder as a website). No server, no accounts, no API keys (passwords for data services), no credit card. All data comes live from free public services straight into the visitor's browser.

**What you have to do yourself.**
1. Flip one switch in the repo: Settings → Pages → Build and deployment → Source → "GitHub Actions". That is the only manual step.
2. Open network access in your Claude environment for the hosts listed in Appendix section 11, so the assistant can test every service live before building on it.
3. Read and tick `docs/POLICIES.md` once. The address service's rules say the developer must knowingly accept them; that is you.
4. Pick the name, pick three example addresses (not your own home), and skim the 20 short era blurbs the assistant drafts.

**Build order, and what you will see after each phase.**
- Phase 0: scaffold, policy sign-off, live checks of every service, a "hello" page live at https://fernforager.github.io/sno-ball/.
- Phase 1: type an address, get the rings with names and Wikipedia summaries, and a link you can share.
- Phase 2: dated facts, the time control with 20 named stops, "not yet" countdowns, the rock card, the one-sentence biography.
- Phase 3: the map: streets appearing and vanishing by date, ring outlines, the globe with your dot.
- Phase 4: photos, nearby stories, street-name origins, the full chapter view, the About page. This is the public launch.
- Phase 5: the fine-grained time dial (every year, decade, century, and so on), fossils, polish.
- Phase 6 (optional): the block ring, county and country borders over time, US-only extras (old newspapers, historic registers).

---

# PART 2 — Technical appendix

## 1. Decisions (one line each)

| Decision | Choice |
|---|---|
| UX concept | STORY-FIRST (concept 0), winner in both judgements, with the grafts in section 2 |
| Framework | Vanilla TypeScript + Vite (resolves the build/no-build split; one `npm run build`, one Action) |
| Map library | `maplibre-gl` 5.24.x (the only version OHM itself ships with `maplibre-gl-dates`); upgrade gate to 6.x in Phase 5 |
| Globe | d3-geo orthographic, inline SVG, bundled coastlines; no MapLibre globe projection |
| Geocoder | Nominatim (search + 3-4 reverse + 1 lookup per new address, cached per city); Photon as a one-file swap-in, not called in MVP |
| Overpass | Removed from the per-address path entirely (policy ≈100 queries/day for a public app; both fallbacks dead) |
| OpenCage / Mapbox / Google / geocode.earth | Out |
| Wikidata SPARQL | Not in MVP (Blazegraph endpoint sunsets 2027; `wikibase:around` not in QLever). "Items near the point" comes from Wikipedia geosearch + `ppprop=wikibase_item` |
| Wikidata entities | One `wbgetentities` batch for city/county/state items; country facts pre-baked into `data/countries.json` (CC0) because country entity JSON is multi-MB |
| Wikimedia headers | No `Api-User-Agent`, no custom headers anywhere; every request is a CORS-simple GET with `credentials: 'omit'`; default referrer policy kept |
| Basemap / ghost | OpenFreeMap positron (vector) merged with the OHM style at build time; OSM raster tiles never used |
| OHM | Canonical `/maps/ohm/` tiles + pinned `@openhistoricalmap/map-styles@0.9.19` dist style (not the stale GitHub Pages style, not `/maps/osm/`) |
| Plate model | MERDITH2021 only (CC BY 4.0, 0-1000 Ma); one batched `times=` call per address; no `gplates` npm (GPL); nothing from PALEOMAP/Ancient Earth (non-commercial) |
| Geology | Macrostrat map unit + column (oldest unit = bedrock); card wording "ground mapped at this spot" |
| Cache | IndexedDB via `idb-keyval` with explicit TTL + stale-while-revalidate; Cache API only for our own bundles |
| Routing | Hash: `#/story?ll=38.89770,-77.03650&q=<label>&at=1890&ring=city` (shared links reverse-geocode once; no re-search) |
| Proxy / keys / accounts | None. A Cloudflare Worker is added only if a must-have source loses CORS |
| Native Land, LOC, NRHP, Internet Archive, Pleiades | Not in MVP (Native Land excluded outright: key in client, non-commercial, undated polygons on a time slider) |

## 2. Winning UX concept and grafts

Winner: **STORY-FIRST** (scrollable biography; map as a sticky "postcard"; time dial re-tells the story). Grafted from the judges:

From TIMELINE-FIRST: (1) normalised event model (`{ring, tStart, tEnd, kind: event|birth|bedrock|fossil|position, title, body, image?, sourceName, sourceUrl, license}`) behind `story.ts` so re-telling for a new date is a local filter, never a refetch; (2) QUIET card state with neighbour links ("Nothing recorded for the 1740s · ◀ 1720: French fort built · 1763: ceded to Britain ▶") and NOT-YET "jump to 1851" link; (3) per-ring event dots / thickness bar on the dial and on each Chapters row; (4) era background tint per gear; (5) time-aware breadcrumb in the sticky header ("12 Elm St · Springfield · Illinois · USA" → "Illinois Territory" → "North America" → "Laurentia") and the focus rule (when the ring you are reading goes NOT YET, scroll to the next living ring and pulse its glyph ring); (6) the Phase 5 gearbox implemented as a native scroll-snap ribbon with a hidden `<input type=range>` mirror; (7) outside-in load order (country/state/city first); (8) the "We found the town but not the exact house; rings start at Neighborhood" note; (9) "Fix this" links to Wikipedia/OSM/OHM edit pages in About.

From MAP-FIRST: (10) "Nearest stories" with distances (Wikipedia geosearch 100 m / 300 m / 1 km) as the thin-ring empty state, each tappable to zoom the postcard; (11) Commons photos nearest the chosen year with distance and date; (12) tap-the-map to drop a pin and "Use my location" on the Front Door; (13) hand-written `data/context.json` (climate, people, animals per time band + 20 chapter blurbs) as the floor for "The land" and "Life here then"; (14) always-on ghost base with a date-driven opacity ramp plus a persistent Map Note chip (replaces threshold switching); (15) house footprint vanishes at its build year ("Not built yet"), ring outline goes dashed with "border as of today" before inception; (16) free-text "Jump to a time" field ("1924", "3000 BCE", "66M", "4.5B"); (17) merge rings that resolve to the same entity ("City · County"); (18) per-card 8 s skeleton timeout with "tap to retry"; (19) one-tap "how sure is this?" line on deep-time cards; (20) explicit map fallback ladder (OHM → ghost today → nature-only → plain globe) driving the caption.

From the critique: hero sentence assembled only from CC0 (Wikidata) and CC BY (Macrostrat, GPlates) facts and OSM tags, never paraphrased Wikipedia prose; 1-line credit (Artist · License · link) under every Commons image wherever it appears; `limit=5` on search; contact identifier is the repo URL, never a personal email.

## 3. Stack (versions checked on npm 2026-10-07)

| Package | Version | Role |
|---|---|---|
| Node | 24 LTS (`lts/*`) | CI and local |
| vite | 8.3.3 | dev server, build (`base` from configure-pages) |
| typescript | ~6.0.3 | type-check only (`tsc --noEmit`); 7.x deferred until typescript-eslint supports it |
| maplibre-gl | ^5.24.0 (pinned minor) | postcard map; one instance |
| @openhistoricalmap/maplibre-gl-dates | 1.4.0 | `filterByDate` on OHM layers |
| d3-geo | ^3.1 | SVG globe (lazy-loaded) |
| idb-keyval | 6.3.0 | IndexedDB cache |
| p-queue | 9.3.3 | per-host pacing |
| p-retry | 8.0.1 | jittered backoff |
| @turf/simplify, @turf/boolean-point-in-polygon | latest 7.x | build scripts; plate polygon lookup |
| vitest | 5.0.3 | unit tests (fake timers) |
| @playwright/test | 1.63.0 | smoke test (chromium) |
| eslint 10 + typescript-eslint 8.71 | | lint |
| Actions | checkout@v7, setup-node@v7, configure-pages@v6, upload-pages-artifact@v5, deploy-pages@v5 | deploy |

No service worker, no PWA, no framework, no CDN scripts (everything via npm so versions are pinned in the lockfile). Dependabot version bumps disabled; security alerts on.

## 4. Data-source table

Status key: confirmed / contested / refuted / unverified (from the research verification). "Live" = still to be checked from a real browser or `curl -H 'Origin: https://fernforager.github.io'` once network is open. Nothing except the ICS chart has been fetched live yet.

### 4a. Used in the MVP (Phases 0-4)

| Source | Endpoint (exact) | Serves | CORS mechanism | Key | Policy / attribution | Status | Verify live |
|---|---|---|---|---|---|---|---|
| Nominatim `/search` | `https://nominatim.openstreetmap.org/search?q=…&format=jsonv2&addressdetails=1&extratags=1&namedetails=1&polygon_geojson=1&limit=5` | lat/lon, address parts for every ring name, house footprint + `extratags` (`building:levels`, `start_date`, `historic`, `heritage`), `wikidata` of the matched object, 5 candidates for disambiguation | `Access-Control-Allow-Origin: *` from Nominatim default (`NOMINATIM_CORS_NOACCESSCONTROL=yes`) and OSMF nginx; since Jun 2026 also on 403/429 pages | none | OSMF policy: max 1 req/s **per site**, Referer identifies the app, no autocomplete, cache results, be able to switch endpoint on request, "Usage in LLMs" clause → owner sign-off in `docs/POLICIES.md`; "© OpenStreetMap contributors" (ODbL) linked | confirmed (2 votes) | ACAO on 200 and on a forced 4xx; `extratags`/`polygon_geojson` present for a building match; Referer from a GitHub Pages origin accepted |
| Nominatim `/reverse` | `…/reverse?lat&lon&format=jsonv2&zoom={10\|12\|13,8,5,3}&extratags=1&addressdetails=1` (zoom 18 when opening a shared `ll=` link; zoom 17 in Phase 4 for the road way id) | osm_type/osm_id + `wikidata` QID + name for city/town, county, state, country | same | none | same; cached per city so most visitors make 0-1 reverse calls | confirmed | zoom-10 result is the city relation with a `wikidata` tag; name matches the search's address part |
| Nominatim `/lookup` | `…/lookup?osm_ids=R…,R…,R…&format=geojson&polygon_geojson=1&polygon_threshold=0.001` | simplified outlines for all outer rings in one call (≤50 ids) | same | none | same | confirmed | payload size with threshold 0.001 (<300 KB target) |
| Photon (fallback only) | `https://photon.komoot.io/api/?q=…&limit=5` | drop-in geocoder behind `config/sources.ts` if Nominatim blocks the site; not called in MVP | ACAO:* observed by a third party 2026-09-20; komoot's own leaflet.photon calls it cross-origin | none | "reasonable use"; OSM attribution; no uptime guarantee | confirmed | ACAO; result shape |
| Wikipedia REST summary | `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` | lead paragraph, thumbnail, description, `wikibase_item`, coordinates for each ring card | REST gateway overwrites `access-control-allow-origin: *` on all `/api/rest_v1` routes | none | CC BY-SA 4.0: name + link article on every card; 200 req/min browser tier | confirmed | ACAO; `api_urls` field removal irrelevant |
| Wikipedia Action API | `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&generator=geosearch&ggscoord={lat}\|{lon}&ggsradius={100\|300\|1000}&ggslimit=20&prop=coordinates\|pageprops\|extracts&colimit=20&codistancefrompoint={lat}\|{lon}&ppprop=wikibase_item&exintro=1&explaintext=1&exlimit=20` (nearest stories); `action=parse&page={t}&prop=tocdata` then `&section=N&prop=text` (History section); `list=search&srsearch="{road}" {city}` (street article) | nearest articles with distance + QIDs; History section; street/neighborhood article lookup | `origin=*` → `ApiMain::handleCORS` emits ACAO:* | none | CC BY-SA 4.0 quoted verbatim with link; serial requests; honour 429 | confirmed (example corrected: `colimit`, `codistancefrompoint`, `exlimit=20`, `tocdata` not `sections`) | ACAO; `dist` present for all 20 hits |
| Wikidata entities | `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q…\|Q…&props=labels\|descriptions\|claims\|sitelinks&languages=en&sitefilter=enwiki\|commonswiki&format=json&formatversion=2&origin=*` (city, county, state items); `data/countries.json` pre-baked at build for country items | P571 inception, P1082 population + P585, P17 country with P580/P582, P1448 official name with dates, P18 image, P373 Commons category, P2184 history-of, enwiki title | `origin=*` (same ApiMain) | none | CC0 ("Data from Wikidata" link) | **unverified** (no votes) | ACAO; payload size for a large US state item; `Special:EntityData/Q61.json` redirect chain as backup |
| Wikimedia Commons | `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&generator=geosearch&ggscoord={lat}\|{lon}&ggsradius={60\|300\|1000}&ggslimit=30&ggsnamespace=6&ggsprimary=all&prop=imageinfo\|coordinates&iiprop=url\|extmetadata&iiurlwidth=640&iiextmetadatafilter=DateTimeOriginal\|Artist\|Credit\|LicenseShortName\|LicenseUrl\|ImageDescription`; thumbnails hotlinked from `upload.wikimedia.org` as plain `<img>` | dated photos near the point for House/Street/Neighborhood; city photos via P373 decade categories (`generator=categorymembers`) | `origin=*` | none | per-file licence; caption "Artist · Licence · file link" under every image; fixed `iiurlwidth` only | **unverified** | ACAO; `extmetadata` keys present; thumb URLs load |
| OpenHistoricalMap | tiles `https://vtiles.openhistoricalmap.org/maps/ohm/{z}/{x}/{y}.pbf`, TileJSON `…/maps/ohm.json`; style `https://unpkg.com/@openhistoricalmap/map-styles@0.9.19/dist/historical/historical.json` (sprites/glyphs on `www.openhistoricalmap.org`, hillshade on `static-tiles.openhistoricalmap.org`) | date-filtered historical streets, buildings, rail, boundaries, labels (years → centuries) | Varnish sets ACAO:* on every tile response; `www` `/map-styles/` and unpkg send ACAO:* | none | CC0; credit "OpenHistoricalMap" linked to /copyright | confirmed (medium; `/maps/osm/` alias and GH-Pages style are stale/broken and are not used) | ACAO on tile and style; every `source-layer` in the style exists in `/maps/ohm.json` `vector_layers`; `filterByDate` runs under maplibre-gl 5.24; stack migrated 2026-10-05/06 so expect downtime |
| OpenFreeMap | style `https://tiles.openfreemap.org/styles/positron`, TileJSON `…/planet`, tiles `…/planet/{version}/{z}/{x}/{y}.pbf` (z0-14), fonts `…/fonts/{fontstack}/{range}.pbf`, sprites `…/sprites/ofm_f384/ofm` | present-day base ("Now") and the fading ghost under OHM; water/landcover-only base for pre-1500 | nginx `add_header 'Access-Control-Allow-Origin' '*' always` on every public location | none | free, no limits, ToS: no automated bulk collection, may be discontinued; "© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap" | confirmed | ACAO; z14 tile; style loads in MapLibre |
| Macrostrat | `https://macrostrat.org/api/v2/geologic_units/map?lat&lng&format=json`; `…/columns?lat&lng`; `…/units?col_id={id}&response=long`; build-time `…/defs/intervals?timescale_id=11` | mapped surface unit; column with oldest (bedrock) unit; ICS interval colours | `v2/api.ts` sets ACAO:* on all `/api/v2` | none | CC BY 4.0: cite Macrostrat + map `source_id` | confirmed | ACAO; field names (`b_age`,`t_age`,`lith`,`scale`); `/columns` coverage for the three example addresses |
| GPlates Web Service | `https://gws.gplates.org/reconstruct/reconstruct_points/?lons={lon}&lats={lat}&times=1,2.6,5.3,23,34,56,66,100,145,201,252,299,359,419,444,485,539,635,720,1000&model=MERDITH2021&fmt=simple` (one call per address); build-time `…/reconstruct/coastlines_low/?time={t}&model=MERDITH2021` for the same 20 ages | paleo-position + plate id per stop; bundled coastlines | explicit `Access-Control-Allow-Origin: *` on success responses only (400s are opaque to the browser) | none | software GPL-2.0; MERDITH2021 data CC BY 4.0 (Zenodo 10.5281/zenodo.10346399), cite in About; "welcome to use", unpublished optional throttle | confirmed | `times=` list accepted with 20 values; `fmt=simple` returns `lons,lats,pids`; ACAO; `/earth/get_plate_names` for plate names |
| ICS chart | `https://raw.githubusercontent.com/i-c-stratigraphy/chart/main/chart.ttl` → `scripts/build-ics.mjs` → `data/ics.json` (build-time only) | eon/era/period/epoch names, ages, colours | n/a at runtime | none | CC BY 4.0 | **live-fetched** (the only one) | nothing at runtime |
| Natural Earth 110m land | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson` (build-time, ~100 KB) | ghost of modern continents on the globe | n/a | none | public domain | unverified | file exists |
| GitHub Pages | `https://fernforager.github.io/sno-ball/` | hosting; our own `data/*.json` served with ACAO:* and Range support | GitHub sends ACAO:* on public sites | none | 1 GB site, 100 GB/month soft bandwidth; shared origin with the owner's other project sites | unverified | `curl -sI -H 'Origin: https://example.org' …/data/ics.json` |

### 4b. Added in Phases 4-6

| Source | Endpoint | Serves | CORS | Key | Policy | Status | Verify live |
|---|---|---|---|---|---|---|---|
| OSM API 0.6 | `https://api.openstreetmap.org/api/0.6/way/{id}.json` (road id from `/reverse?zoom=17`) | `name:etymology:wikidata`, `name:etymology`, `old_name` for the Street ring (Phase 4) | cgimap sends ACAO:* (believed) | none | ODbL; light use | **unverified** (added by the critique, not researched) | ACAO + tags |
| PBDB | `https://paleobiodb.org/data1.2/occs/list.json?lngmin&lngmax&latmin&latmax&show=coords,class,strat&vocab=pbdb&limit=200` | "Life here then" (Phase 5) | `Execute.pm` ACAO:* for public nodes | none | CC BY 4.0 | confirmed | ACAO; `max_ma`/`min_ma` field names (not `early_age`) |
| Open-Meteo archive + elevation | `https://archive-api.open-meteo.com/v1/archive?…`, `https://api.open-meteo.com/v1/elevation?latitude&longitude` | "summer of 1976 hit 38 °C"; elevation for the sea-level line (Phase 6) | documented CORS | none | CC BY 4.0 | unverified | ACAO |
| loc.gov JSON (US) | `https://www.loc.gov/collections/chronicling-america/?q=…&dates=1880/1899&fa=location_state:…&dl=page&fo=json&c=10&at=results,pagination` (or `searchType=advanced&ops=PHRASE&qs=`) | newspapers, HABS, photos (Phase 6) | ACAO:* on JSON; Cloudflare challenge pages lack it | none | per-item rights; 20 req/min collections endpoint | confirmed (medium; example fixed) | ACAO; `qs` honoured only with `searchType=advanced` |
| NPS NRHP ArcGIS (US) | `https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer/{0,1}/query?…&where=STATUS='Listed'&f=geojson` (union both layers) | listed buildings / districts (Phase 6) | ArcGIS default ACAO:* (inferred from browser callers) | none | public domain | confirmed (medium) | ACAO header actually present; `CertDate` format |
| Newberry county atlas / `aourednik/historical-basemaps` / CShapes | GitHub/Newberry downloads, bundled per state/date | county and polity "then part of" (Phase 6) | n/a (bundled) | none | **licence must be read first** (believed CC BY-NC / CC BY-NC-SA / academic) | unverified | licence text |
| Dyke 2003 ice margins | `https://github.com/awickert/North-American-Ice-Sheets` (WGS84 shapefiles → GeoJSON, 20 ka only) | LGM ice overlay, North America only (Phase 6) | n/a | none | GSC copyright, study/teaching use; cite Dyke et al. 2003 | unverified | licence |

### 4c. Evaluated and rejected (with the reason, so nobody re-litigates)

Overpass (contested; public-app fair use ≈100 queries/day aggregate, main-server 406/429/bans, `private.coffee` frozen since May 2026 and not answering, `kumi.systems` is the same host; the one job it had, street etymology, moves to OSM API 0.6). OpenCage (free trial is "not for production", key cannot be origin-restricted). Mapbox and Google (results may only be shown on their own maps, caching forbidden, Google has no CORS). Wikidata SPARQL (sunset path: degrade Feb 2027, decommission ~Jun 2027; `wikibase:around`/`label` not in QLever; replaced by Wikipedia geosearch + `ppprop`). OSM raster tiles (policy-limited; not needed once OpenFreeMap is the ghost). Allmaps / USGS topo / LOC maps / NYPL Map Warper (no verified point lookup, US-only or archived; curated overlays are a post-v1 idea). Protomaps (plan B only if OpenFreeMap is discontinued). PALEOMAP PaleoDEMs / Ancient Earth (non-commercial terms, no API). `gplates` npm (GPL-2.0-only and unnecessary with the batched call). Native Land (key in client, non-commercial, undated polygons would misrepresent on a time slider). WDQS Commons service (needs OAuth). Cloudflare Worker / Vercel / Netlify (no source currently needs a proxy).

## 5. Time-scale design (exact stops)

**Internal representation.** `time.ts` is written and tested first. One canonical type: `{ kind: 'year', value: number }` (proleptic Gregorian, negative = BCE, no year 0) or `{ kind: 'ago', value: number }` (years before 2000 CE, for ≥20,000). Conversions, each table-tested: Wikidata time (`+1790-07-16T00:00:00Z`, `-0001…`, precision 7/8/9/11) → `year`; OHM decimal date (1.0 = 1 Jan 1 CE, 0.0 = 1 BCE, no year 0) ← `year`; Ma (float) ↔ `ago`; PBDB `max_ma/min_ma` and Macrostrat `b_age/t_age` → `ago` ranges; ICS boundaries → `ago`. URL encoding: `at=now`, `at=1890`, `at=-8000` (8000 BCE), `at=20ka`, `at=66Ma`, `at=2.5Ga`.

**Gears and stops (266 total).** Every position is a discrete, named stop; the dial always snaps.

1. YEARS: 2026 → 1870, step 1 (157). Readout "1890".
2. DECADES: 1860 → 1500, step 10 (37). Readout "1860s".
3. CENTURIES: 1400, 1300, …, 100, 1 CE, 100 BCE, …, 1000 BCE (25). Readout "the 1300s" / "500 BCE".
4. MILLENNIA: 2000 BCE, 3000 BCE, …, 12,000 BCE (11). Readout "8000 BCE (about 10,000 years ago)".
5. ICE AGES: 20,000; 30,000; 50,000; 75,000; 100,000; 150,000; 200,000; 300,000; 500,000; 750,000 years ago (10). Readout "20,000 years ago · ice age peak".
6. MILLIONS (ICS period boundaries): 1, 2.6, 5.3, 23, 34, 56, 66, 100, 145, 201, 252, 299, 359, 419, 444, 485, 539 Ma (17). Readout "66 million years ago · end of the Cretaceous".
7. EONS: 635, 720, 1000, 1600, 2500, 3000, 3500, 4000, 4567 Ma (9). Readout "2.5 billion years ago".

**Named stops (the MVP dial; all are members of the gear stops above, so there is one state model):** Now (2026); Living memory 1975; Grandparents' time 1925; Boom years 1875; Early modern 1600; Medieval / pre-contact 1000; Antiquity 1 CE; Farming begins 8000 BCE; Ice age peak 20,000 ya; First humans 300,000 ya; Age of mammals 34 Ma; Last day of the dinosaurs 66 Ma; Age of dinosaurs 145 Ma; Pangaea and the Great Dying 252 Ma; Coal forests 299 Ma; Life comes ashore 419 Ma; Cambrian seas 539 Ma; Snowball Earth 720 Ma; First continents 3 Ga; Birth of the Earth 4.567 Ga. Each row shows an address-specific teaser when the event array has one ("Your city is 24 years old", "Your spot is under a shallow sea at 12° S") and a thickness bar from the per-ring event dots.

**MVP control (Phase 2).** Collapsed bottom sheet (96 px): big readout, ◀ ▶ stepping through the 20 named stops (long-press repeats), "Now". Expanded: the Chapters list and a free-text "Jump to a time" field (`parseTime('1924' | '800 BC' | '20,000 years ago' | '66 Ma' | '2.4 billion years ago')` snaps to the nearest gear stop and selects its gear). Keyboard: ←/→ step, Home = Now. `aria-live="polite"` readout; `navigator.vibrate(10)` on gear crossings where supported; `prefers-reduced-motion` disables animations.

**Phase 5 gearbox.** The slider is a native horizontal scroll container (`overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; touch-action: pan-x`) with a fixed centre playhead; stops are 28 px (phone) / 36 px (desktop) wide, gears are thick labelled dividers on the same ribbon, so there is no custom gesture code; the stop index is derived from `scrollLeft` on `scrollend` (120 ms idle-timer polyfill). A gear chip row jumps to the youngest stop of a gear. A visually hidden `<input type="range" min=0 max=265>` mirrors the ribbon with `aria-valuetext` = readout. Background tint per gear: warm white, sepia, parchment, ice blue, deep green-blue, red-to-black.

**Story coupling.** Changing the date never resets scroll: `story.ts` re-renders chapters in place; the renderer measures the current card's `offsetTop` before and after and compensates `scrollTop`. Crossing the bedrock's age range flashes "The rock under your house is forming right now" and highlights the Rock chapter. Crossing 1 Ma in either direction cross-fades the postcard to/from the Globe.

## 6. Ring model and resolution

Rings are chapters, small to big, each `{ ring, exists: 'yes'|'notyet'|'quiet'|'unknown'|'never'|'folded', title, factsThen[], events[], paragraphs[], image?, sources[], richness }`. `richness` = paragraphs + events, drives glyph thickness.

| # | Ring | Resolved from | Polygon | Wikidata / Wikipedia key | Existence rule at date T | Thin / empty copy |
|---|---|---|---|---|---|---|
| 1 | House / lot | `/search` match: `house_number`+`road`; if `osm_type` is way/relation with `building`, its `extratags` + `polygon_geojson` | footprint from search | none (NRHP-style buildings may carry `wikidata` in extratags → Wikipedia summary) | `start_date` if present else inherits city inception as a hedge ("Probably not yet…") | "No written history found for this exact house: that's normal. Here's what the map knows: …" + Nearest stories (100 m) + "The street has more below". No footprint: "The map doesn't have this building drawn yet. Lot location only." |
| 2 | Block | Phase 6: `map.querySourceFeatures` on OpenFreeMap `transportation` at z16 + `@turf/polygonize` → enclosing block; named `building`/`poi` features inside | derived locally | none | as city | "A quiet block: nothing named within a minute's walk on the map." |
| 3 | Street | `road` from search; Phase 4: `/reverse?zoom=17` → way id → OSM API 0.6 tags | none (300 m circle labelled "approx.") | `name:etymology:wikidata` → `wbgetentities` label/description → "Named after …"; `list=search "\"{road}\" {city}"` → article if any | as city | "We couldn't find who or what this street is named after." + Nearest stories (300 m) |
| 4 | Neighborhood | `neighbourhood`/`suburb`/`quarter` from search (name only) | 1 km circle "approx." | Wikipedia `list=search "{name}, {city}"` → summary; QID via `ppprop` | city rule | ring skipped silently when the geocoder returns no neighbourhood; Hero summary line says so |
| 5 | City / town | `/reverse` zoom 10 (city) / 12 (town) / 13 (village), chosen from which address part exists; cross-checked against the search's name | `/lookup` | `extratags.wikidata` → `wbgetentities` → P571, P1082+P585, P17, P1448, P18, P373, P2184, enwiki sitelink → REST summary + History section | `notyet` if T < P571; `quiet` if no events in window; neighbour links from the event array | QUIET card with ◀ ▶ neighbour links |
| 6 | County / region | `/reverse` zoom 8 if `county` present | `/lookup` | same | same | merged into "City · County" when same entity |
| 7 | State / province | `/reverse` zoom 5 if `state` present | `/lookup` | same | same | skipped where the hierarchy has none |
| 8 | Country | `/reverse` zoom 3 | `/lookup` | `data/countries.json` (pre-baked CC0 facts: QID, inception, continent P30, population series, enwiki title) | same | always present |
| 9 | Continent / plate | country's P30; plate from bundled `data/plates.json` (PB2002 boundaries, point-in-polygon) and GPlates `pids` for the historical plate name | bundled | hand-written blurbs | always | — |
| D | Deep-time chapters | "The land" (context.json + Natural Earth caption), "The rock under your house" (Macrostrat map unit + column bedrock), "Where this spot was" (GPlates dot + paleolatitude), "Life here then" (Phase 5 PBDB) | — | — | shown for ≥20 ka; all human rings fold into "The land" | "No fossil collections within 50 km from this period"; "how sure is this?" line |

**Resolution order (outside-in for the Hero, Nominatim strictly serial at 1.1 s):** `/search` → reverse zoom 10/12/13 (city) → [in parallel, other hosts: Macrostrat, GPlates batch, `wbgetentities` city, REST summaries, countries.json] → reverse 5 → reverse 3 → reverse 8 → `/lookup`. Hero target: ~2.5 s. The outer-ring reverse set is cached under key `sno-ball:v1:rings:{country_code}|{state}|{county}|{city}` so a second address in the same city costs one `/search` only. Opening a shared `ll=` link does one `/reverse?zoom=18` instead of `/search`.

**Time-aware breadcrumb and names.** P1448 (official name with dates) and P17 (country with dates) from the entity feed "Then called" / "Then part of"; when absent the breadcrumb simply drops names as rings go `notyet` ("…Illinois Territory" needs Phase 6 bundles; MVP shows "North America" then "Laurentia" from GPlates plate names).

**Navigation.** Tree-ring glyph (nine concentric circles; thickness = richness; dashed = folded; hollow = not yet) in the 56 px sticky header; IntersectionObserver marks the current ring and drives the postcard zoom (house 18, block 17, street 16, neighbourhood 14, city 11, county 9, state 6, country 4, continent 2, deep time = globe); focus rule on date change.

## 7. Map strategy per time scale

One MapLibre instance in the sticky postcard (180 px → 96 px after the Hero scrolls away), lazy-loaded after the first chapter renders and not at all under `Save-Data`; `cooperativeGestures: true`; expands to Big Map. The style is **merged at build time** by `scripts/build-style.mjs`: sources = OpenFreeMap `planet` TileJSON + all OHM sources; layers = OpenFreeMap positron layers (ids prefixed `ofm-`, grouped into `ofm-water`, `ofm-land`, `ofm-roads`, `ofm-buildings`, `ofm-labels`, `ofm-boundaries`) then OHM historical layers (prefixed `ohm-`); `glyphs` = OpenFreeMap fonts with OHM `text-font` values remapped to `Noto Sans Regular/Bold/Italic`; `sprite` = array of both sprites. A unit test asserts every `ohm-*` `source-layer` exists in `/maps/ohm.json` `vector_layers` (fixture). Three app layers on top: `pin`, `ring-outline` (solid when the entity exists at T, dashed with Map Note "border as of today" otherwise), `house-footprint` (hidden with a "Not built yet" label when T < `start_date`).

| Gear | Base | Historical layer | Map Note (always visible) |
|---|---|---|---|
| Now | OpenFreeMap positron, full opacity | OHM hidden | "Today · OpenStreetMap" |
| Years / Decades (2026-1500) | positron roads/buildings/labels/boundaries at opacity `ramp(T)`: 0.55 at 1950, 0.4 at 1900, 0.25 at 1800, 0.12 at 1000 CE, 0 at 10,000 BCE; water/land kept | OHM layers visible, `filterByDate(map, T)` on every change (debounced 250 ms; on release during drag) | After `idle`, `queryRenderedFeatures` on `ohm-*` layers chooses the wording only: ≥10 features → "Historical map · 1890 · OpenHistoricalMap"; fewer → "No historical map for this area in 1890: today's streets shown faded". Never toggles layers. |
| Centuries (1400-1000 BCE) | positron with only `ofm-water`, `ofm-land`(cover); no roads/buildings/labels/boundaries | OHM boundaries + settlements for T if any | "Land and water as today; borders and towns only where recorded" |
| Millennia / Ice ages | same nature-only base | none | "Coastlines shown are today's; sea level was ~120 m lower at 20,000 years ago" (+ Phase 6 Dyke ice overlay, NA only, at the 20 ka stop) |
| Millions (1-539 Ma) | SVG Globe (d3-geo orthographic, lazy-loaded): bundled `data/coast/{age}.json` for the stop, ghost `ne_110m_land` outline, glowing dot from the GPlates batch result, drag to rotate | — | "Your spot was here, at 12° S (MERDITH2021 model)"; on failed batch: globe without dot + "Couldn't place your spot for this era right now: try again" |
| Eons 635-1000 Ma | Globe with bundled coastlines | — | "Reconstruction · {age} Ma" |
| Eons >1000 Ma | plain globe, no land | — | "No reliable map of the continents this far back"; 4000/4567 Ma: CSS molten orb, "No oceans yet" / "The Earth is forming"; no GPlates call |

Fallback ladder for the caption and the layers, in order: OHM features → ghost of today → nature-only → plain globe. Cross-fade between postcard and Globe at the 1 Ma boundary (cut under reduced motion). Dark mode: positron dark variant not needed in MVP; keep light map with dark UI chrome.

## 8. Caching and rate-limiting rules

**`cachedFetch(url, {ttlMs, host, signal})`** is the only way to reach the network.
- L0: in-memory `Map` + in-flight promise dedupe.
- L1: IndexedDB via `idb-keyval`, record `{fetchedAt, ttlMs, status, body}`; key = `sno-ball:v1:` + canonical URL (sorted params, lat/lon rounded to 5 decimals). Stale-while-revalidate: stale hit is returned immediately and refreshed in the background. The `v1` prefix is bumped to invalidate; the origin `fernforager.github.io` is shared with the owner's other Pages sites, so every key and store name carries the prefix.
- TTLs: Nominatim 30 d (policy requires caching); Wikipedia/Wikidata/Commons 7 d; Macrostrat/GPlates/PBDB 90 d; bundled data forever (keyed by app version). Negative cache 60 s for failures.
- L2: Cache API / HTTP cache only for our own hashed bundles. Never `mode: 'no-cors'`, never opaque responses in any store.
- localStorage: UI prefs and the last 10 searches; "clear cached data" button in About.

**Per-host queues (`p-queue`)**, `strict: true`:
- `nominatim.openstreetmap.org`: concurrency 1, interval 1100 ms, intervalCap 1; search only on explicit submit (Enter/Go); identical queries deduped.
- `en.wikipedia.org`, `www.wikidata.org`, `commons.wikimedia.org`: concurrency 2, 250 ms spacing each.
- `macrostrat.org`, `gws.gplates.org`, `paleobiodb.org`, `api.openstreetmap.org`: concurrency 1.
- Tiles: MapLibre's own loader (no app queue).

**Backoff (`p-retry`)**: retries 3, factor 2, minTimeout 1000, maxTimeout 15000, `randomize: true`; retry on `TypeError` (CORS-less 429/5xx look like network errors), 429, 500, 502, 503; never on 400/403/404; honour `Retry-After` when exposed; after 3 consecutive failures on a host open a 60 s circuit breaker and show "source busy, using cached data". Every request carries an `AbortSignal`; superseded slider work is cancelled.

**Request budget per new address (MVP):** Nominatim 1 (+3-4 reverse +1 lookup on the first address per city per browser), Wikipedia 6-9 (summaries ×4-5, geosearch ×2, street search ×1, History section on demand), Wikidata 1, Commons 2-3, Macrostrat 2, GPlates 1 → **≈15-20 requests, zero Overpass, zero SPARQL**. Scrubbing the dial costs 0 requests (local filtering) except the first visit to each Globe stop (one static coastline file from our own origin).

**Identification:** browsers send `Referer: https://fernforager.github.io/` under the default policy; never set `no-referrer`; no custom headers; `credentials: 'omit'`; contact identifier anywhere it appears (About page, health-check UA) is `https://github.com/FernForager/sno-ball`.

## 9. Repo layout

```
sno-ball/
  .github/workflows/deploy.yml        # build + deploy to Pages (section 10)
  .github/workflows/ci.yml            # typecheck, vitest, playwright smoke on PRs
  .github/workflows/health.yml        # weekly curl of every endpoint with Origin header; opens an issue on failure
  index.html
  vite.config.ts  tsconfig.json  package.json  package-lock.json
  playwright.config.ts  vitest.config.ts
  public/
    data/ics.json  countries.json  plates.json  ne_110m_land.json  context.json  chapters.json
    data/coast/{1,2.6,…,1000}.json  # 20 files, ≤40 KB each
    style/merged.json               # OpenFreeMap + OHM merged style
    og.png  favicon.svg
  src/
    config/sources.ts                 # every endpoint URL in one file (switchable on request)
    time/time.ts  time/parse.ts  time/stops.ts
    net/cachedFetch.ts  net/queues.ts  net/idb.ts
    adapters/nominatim.ts  photon.ts  wikipedia.ts  wikidata.ts  commons.ts  macrostrat.ts  gplates.ts  pbdb.ts  osmapi.ts
    model/events.ts  model/rings.ts  model/story.ts  model/hero.ts
    ui/frontDoor.ts  header.ts  glyph.ts  postcard.ts  globe.ts  chapterCard.ts  chapterSheet.ts  timeDial.ts  chapters.ts  about.ts  share.ts
    map/style.ts  map/layers.ts  map/caption.ts
    router.ts  store.ts  main.ts  styles.css
  scripts/                            # run once by Claude; outputs committed
    build-ics.mjs  build-countries.mjs  build-coastlines.mjs  build-style.mjs  build-plates.mjs
  tests/
    unit/*.test.ts  fixtures/{nominatim,wikipedia,wikidata,commons,macrostrat,gplates,ohm}/*.json
    e2e/smoke.spec.ts
  docs/POLICIES.md  docs/SOURCES.md  docs/ARCHITECTURE.md  README.md  LICENSE (MIT for code)
```

## 10. GitHub Actions deploy workflow

Owner's one manual step: Settings → Pages → Source → "GitHub Actions" (or `gh api -X POST repos/FernForager/sno-ball/pages -f build_type=workflow`). Do not use configure-pages `enablement: true` (needs a PAT).

```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: lts/*, cache: npm }
      - run: npm ci
      - run: npm run typecheck && npm run test:unit
      - id: pages
        uses: actions/configure-pages@v6
      - run: npm run build -- --base "${{ steps.pages.outputs.base_path }}/"
      - uses: actions/upload-pages-artifact@v5
        with: { path: ./dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

`ci.yml` (pull requests): same build steps, then `npx playwright install --with-deps chromium` and `npx playwright test` against `vite preview --base /sno-ball/`. `health.yml` (weekly `cron`): for each URL in `scripts/health-urls.txt`, `curl -sS -D - -o /dev/null -H 'Origin: https://fernforager.github.io'` and assert status 200 + `access-control-allow-origin`; on failure `gh issue create` (deduped by title). Actions minutes are free on the public repo.

## 11. Test strategy

**Unit (Vitest 5, node environment, fake timers).**
- `time.ts`: table-driven round trips for every representation (Wikidata precision 7/8/9/11 and BCE, OHM decdate around year 1, Ma ↔ `ago`), `parseTime` inputs, nearest-stop snapping, gear membership of all 20 named stops.
- `stops.ts`: exactly 266 stops, monotonic, no duplicates.
- Adapters: each parser runs against a real response saved to `tests/fixtures/` in Phase 0 (one per source, re-saved by the health workflow on demand); asserts ring names, QIDs, `start_date`, extmetadata keys, `max_ma/min_ma`, `lons/lats/pids`.
- `story.ts`: chapter states (`notyet`/`quiet`/`never`/`folded`) for a fixture address at 2026, 1890, 1700, 8000 BCE, 66 Ma; neighbour links; hero sentence contains no Wikipedia prose.
- `cachedFetch`/queues: with fake timers, 10 Nominatim calls take ≥9.9 s; dedupe; stale-while-revalidate; negative cache expiry; circuit breaker.
- `build-style`: every `ohm-*` source-layer exists in the `/maps/ohm.json` fixture; fonts remapped; `filterByDate` from the real plugin runs against the merged style under the pinned MapLibre (jsdom + minimal map stub, or Vitest browser mode for this single test).

**Smoke (Playwright 1.63, chromium, CI on every PR).** `page.route` intercepts every third-party host and serves fixtures, so CI never hits live APIs. Scenario: open `/sno-ball/`, type the example address, press Enter, expect the Hero sentence and ≥6 chapter cards, click "Last day of the dinosaurs", expect the date chip "66 million years ago", the URL hash `at=66Ma`, the Globe `<svg>` visible, and the Not-yet city card. A second, `workflow_dispatch`-only job runs the same spec without routes against the live services for one address and uploads a trace.

## 12. Hosts to allow in the Claude environment network policy

Runtime data (needed to verify and to run the live Playwright job):
`nominatim.openstreetmap.org`, `api.openstreetmap.org`, `photon.komoot.io`, `en.wikipedia.org`, `www.wikidata.org`, `commons.wikimedia.org`, `upload.wikimedia.org`, `vtiles.openhistoricalmap.org`, `www.openhistoricalmap.org`, `static-tiles.openhistoricalmap.org`, `unpkg.com`, `tiles.openfreemap.org`, `macrostrat.org`, `gws.gplates.org`, `paleobiodb.org`

Build-time data and tooling:
`raw.githubusercontent.com`, `github.com`, `api.github.com`, `objects.githubusercontent.com`, `registry.npmjs.org`, `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, `zenodo.org` (licence check), `fernforager.github.io` (post-deploy check)

Optional, Phase 5-6 only: `archive-api.open-meteo.com`, `api.open-meteo.com`, `www.loc.gov`, `tile.loc.gov`, `mapservices.nps.gov`, `archive.org`, `pleiades.stoa.org`

Everything should be allowed with `GET` only; nothing needs credentials.

## 13. Phases (engineering detail and exit criteria)

| Phase | Work | Exit criterion (what the owner sees) |
|---|---|---|
| 0 | Vite scaffold, pinned deps, `time.ts` + tests, `docs/POLICIES.md`, run the five live verification commands from the critique (with `OWNER=FernForager`), save fixtures, build scripts for `ics.json`, `countries.json`, `plates.json`, `coast/*.json`, `ne_110m_land.json`, `style/merged.json`; deploy workflow; health workflow | "Hello" page live at the Pages URL; green CI; `docs/SOURCES.md` lists each source as verified/failed |
| 1 | Front Door (search, disambiguation, example chips, use-my-location, tap-to-pin), Nominatim adapter + queue, ring resolution (search + reverse + lookup, cached), Wikipedia REST summaries, chapter cards, share URL | Type an address → ring list with names, summaries, photos' placeholders; link reopens the same view |
| 2 | Wikidata adapter + countries.json, event model, `story.ts` states, Hero sentence, Chapters dial (20 stops, stepper, jump field), breadcrumb, tint, focus rule, Macrostrat rock card, GPlates batch call, `context.json` + 20 blurbs | Flip to 1800: city shows "Not yet · founded 1851 · 51 years from now"; rock card and paleolatitude text present without a map |
| 3 | Postcard map with merged style, OHM date filter, ghost ramp, captions, ring outlines, footprint vanish, per-ring zoom, Big Map; SVG Globe with bundled coastlines + dot; cross-fade at 1 Ma | Streets appear/vanish by date where OHM has them; faded-today caption elsewhere; glowing dot on a 252 Ma globe |
| 4 | Commons photos with captions, Nearest stories, Street named-after (reverse z17 + OSM API), expanded Chapter sheet with History section, glyph thickness/dots, About & Sources, privacy copy, Playwright smoke | **Public launch** |
| 5 | Full gearbox ribbon (266 stops), PBDB "Life here then", MapLibre 6 upgrade gate, performance pass (Save-Data, image sizes), polish | Every year/decade/century reachable; fossils card |
| 6 (optional, owner's choice) | Block ring (polygonize), county/polity-over-time bundles after licence check, Dyke LGM overlay, US extras (loc.gov, NRHP), Open-Meteo weather/elevation lines | Only if the owner wants US-specific depth |

## 14. Top open risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Nominatim blocks the site (1 req/s is per site; LLM clause; Fastly-era thresholds unpublished) | Submit-only search, serial 1.1 s queue, per-city ring cache, `ll=` links skip search, endpoint in `config/sources.ts`, Photon swap-in, owner sign-off; health workflow catches 403/429 |
| 2 | OHM instability (stack migrated 2026-10-05/06; tileset renamed once already; style/tileset drift) | Pinned style version, canonical `/maps/ohm/`, style/TileJSON consistency test, ghost base keeps the map usable when OHM is down, health workflow |
| 3 | `maplibre-gl-dates` vs MapLibre version | Pin 5.24 now; upgrade gate test in Phase 5; check whether GHSA-jrc7-96c5-q579 affects 5.x (site renders no untrusted HTML in popups) |
| 4 | Thin House/Block/Street rings disappoint | Thin-ring treatment, Nearest stories with distances, hero sentence from outer rings, glyph thickness; never cut these |
| 5 | Wikidata/Commons/GitHub Pages headers are unverified | Phase 0 live checks before any adapter is written; fixtures saved |
| 6 | Multi-MB Wikidata entities on phones | Country facts pre-baked; `languages=en`, `sitefilter`; cached 7 d |
| 7 | Deep-time services slow/down (GPlates 400s are opaque; unpublished throttle) | One batched call per address, coastlines bundled, globe without dot on failure, `context.json` floor |
| 8 | Macrostrat surface unit is Quaternary alluvium, so "rock forming now" fires at 10 ka | Use column's oldest unit for the bracket; wording "ground mapped at this spot"; "how sure is this?" line |
| 9 | Licensing slips (CC BY-SA prose in the hero, image credits only in the sheet, NC models in the repo) | Hero built from CC0/CC BY facts only (unit test); caption under every image; MERDITH2021 only; `docs/SOURCES.md` per-source licence |
| 10 | Page weight and jank on mid-range phones | Lazy map (after first chapter, not under Save-Data), one 640 px image per card with dimensions, SVG globe not WebGL globe, rAF-coalesced slider updates, DPR cap 2 |
| 11 | Shared `fernforager.github.io` origin storage and 100 GB/month soft bandwidth | `sno-ball:v1:` prefixes; ~2 MB first load ≈ 50k visits/month; no heavy rasters in the repo |
| 12 | Privacy (addresses sent to third parties; coordinates in share links; owner doxxing) | About page states it; share sheet says the link contains coordinates; example chips are public landmarks; no analytics; contact = repo URL |
| 13 | Beginner-owner maintenance | One build command, one Action, pinned lockfile, `config/sources.ts`, health issues with the failing URL, every adapter fails independently |

## 15. Choices left to the owner

1. Site name: Snowball (recommended), Here Before, or Underfoot.
2. Three example addresses (public landmarks, one on another continent).
3. Whether Phase 6's US-only extras are wanted at all.
4. Whether to add "Use my location" (recommended yes; it is opt-in and stores nothing).

Everything else above is decided.