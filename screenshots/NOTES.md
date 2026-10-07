# Live browser check — 2026-10-07

Built site (`npm run build`, commit cc297de) served by `vite preview` at
http://127.0.0.1:4173/sno-ball/ and driven by Playwright against the REAL
services. Phone = Pixel 7 descriptor, desktop = 1280x900. Full-page PNGs.

## Test results

| Step | Result |
|---|---|
| `npm run build` | OK (chunk-size warning only) |
| `npm run typecheck` | OK |
| `npm test` | 8 files, 369 tests passed |
| `npm run test:e2e` (offline) | 12 passed, 2 skipped (the LIVE spec) |
| `LIVE=1 npm run test:e2e` | **14 passed, 0 failed, 0 skipped** (15.8 s) |

## Screenshots

| File | What it shows |
|---|---|
| `home-phone.png` | Untouched home page, phone |
| `seattle-{phone,desktop}.png` | 400 Broad St, Seattle (Space Needle) |
| `walla-walla-{phone,desktop}.png` | 1 E Main St, Walla Walla |
| `spokane-{phone,desktop}.png` | 507 N Howard St, Spokane |
| `console-<slug>.txt` | Browser console errors per page (phone + desktop runs) |
| `network-<slug>.txt` | Third-party requests, `status host/path` |

Every story settled (hero sentence present, rock card not busy) in 3.6–4.2 s.

## What renders correctly

- **Home page**: title, intro, search box, "Tell me its story" button, five
  example chips, Nominatim/OSM/ODbL credit, privacy note and "Forget my
  searches" link. Nothing empty or overlapping. No third-party requests at all
  on the untouched home page (good: nothing is fetched until a search).
- **Map**: OpenFreeMap positron basemap loads with streets, labels and
  buildings; orange pin sits on the right spot (Space Needle lawn by the
  Howard S. Wright fountain; downtown Walla Walla; Riverfront Park by the
  Spokane River). Caption above the map names the address and city.
- **Hero sentences** (all three correct):
  - "400 Broad Street sits in Lower Queen Anne, in Seattle, King County, on Pleistocene continental glacial till."
  - "1 East Main Street sits in Walla Walla, Walla Walla County, on Quaternary alluvium."
  - "507 North Howard Street sits in Riverside, in Spokane, Spokane County, on Pleistocene outburst flood deposits."
- **Ring chips** row (House / Block / Street …) scrolls horizontally on phone;
  no overlap.
- **Ring cards**: every fact carries "From <source> · <licence>" with a link.
  Wikipedia prose is shown as an indented quoted excerpt with "Wikipedia ·
  CC BY-SA 4.0". The Sources list at the bottom repeats every source.
- **Deep time**: rock card (WA DNR 1:100k unit with full description and
  age), ice-age card (editorial fact with USGS / WA DNR source), drifting
  continents card with five GPlates positions (20/50/100/200/300 Ma), plus the
  Plate card ("Carried here on the North American Plate", marked *inferred*).
- Layout on both viewports is clean: single centred column, readable type,
  no clipped or overlapping text found in any screenshot.

## Facts that appeared, per address

**Seattle (400 Broad St)**
- House: Built in 1961; Renovated in 2013; Designated Seattle landmark;
  Building type: Space Needle (King County Assessor via Seattle GeoData,
  parcel 1985200495).
- Block: Space Needle 1998, Seattle Monorail 2003, Horiuchi Mural 2004,
  Seattle Center House-Armory 2010, Pacific Science Center 2010 (City of
  Seattle landmarks, PDDL) with distances.
- Street: "Nothing on record for this yet."
- Neighborhood (Lower Queen Anne): annexation "Became part of Seattle in
  1869 — Area of First Incorporation" (City of Seattle annexation history).
  **No Wikipedia excerpt** (429, see below).
- City (Seattle): **"Nothing on record for this yet."** — Wikipedia 429'd and
  no Wikidata facts (population etc.) were shown for the city, unlike Spokane.
- County (King): Wikipedia excerpt present; Established December 22, 1852;
  County seat Seattle; Named after Martin Luther King Jr.; Population
  2,269,675 in 2020 (Wikidata, CC0).
- Region: Puget Sound (Snowball editorial). State: Wikipedia excerpt +
  Statehood November 11, 1889 (Library of Congress).
- Plate: North American Plate, 300 Ma "near 21° north".
- Rock: Pleistocene continental glacial till (Qgt), full DNR description.
- Ice age: "Under 3,000 feet of ice" — Puget lobe, Vashon Stade, ~16,900
  years ago (USGS OFR 2005-1252).
- Paleo: 20 Ma 50°N; 50 Ma 55°N; 100 Ma 55°N; 200 Ma 24°N; 300 Ma 21°N.

**Walla Walla (1 E Main St)**
- House / Block / Street: "Nothing on record for this yet." (expected: no
  parcel or landmark source outside Seattle). Neighborhood: "The map has no
  named neighborhood for this spot."
- City: Wikipedia excerpt (pop. 34,060 in 2020).
- County: Wikipedia excerpt; Established in 1854 (*inferred*); County seat
  Walla Walla; Named after Walla Walla people; Population 62,584 in 2020.
- Region: Palouse and Blue Mountains (editorial). State as above.
- Rock: Quaternary alluvium (Qa). Ice age: "Floods at the edge of the
  Palouse" (Missoula floods, Touchet Beds). Paleo: 20 Ma 48°N … 300 Ma 18°N.
- Status line still read **"Gathering the story…"** on the desktop
  screenshot even though every card had content; on the phone run it read
  "Story ready: …". So the final status update can lag the last card.

**Spokane (507 N Howard St)**
- House / Block / Street / Neighborhood (Riverside): "Nothing on record for
  this yet."
- City: Wikipedia excerpt; Population 202,900 (2007), 208,916 (2010),
  228,989 (2020) from Wikidata.
- County: **no Wikipedia excerpt** (429); Established in 1858 (*inferred*);
  County seat Spokane; Named after Spokane; Population 539,339 in 2020.
- Region: Northeast Washington (editorial). Rock: Pleistocene outburst flood
  deposits (Qfg). Ice age: "Lobes of ice down every valley" (glacial Lake
  Columbia, ~16,000 years ago). Paleo: 20 Ma 49°N … 300 Ma 19°N.

## What looks wrong

1. **Wikipedia rate-limits us (HTTP 429)**. 6 of 20 requests to
   `en.wikipedia.org/api/rest_v1/page/summary/...` came back 429 (Seattle,
   Lower Queen Anne, Spokane County — both phone and desktop runs). The app
   handles it honestly (status line "Story ready, but some sources did not
   answer (Wikipedia (Seattle, Washington), …)" and the card shows "Nothing on
   record for this yet."), and by design it does not retry a 429. But the
   result is that the **Seattle city card is completely empty** on the
   flagship example. Likely cause: several summary requests fired in parallel
   from one IP (and this container shares an egress proxy). Worth: spacing
   Wikipedia calls, or pre-baking city/county excerpts into `public/data/`
   per the data policy. These are the only console errors on any page
   ("Failed to load resource: … 429").
2. **Map attribution is printed twice**. The corner reads
   "OpenFreeMap © OpenMapTiles Data from OpenStreetMap | OpenFreeMap ©
   OpenMapTiles © OpenStreetMap contributors". The positron style JSON now
   carries its own attribution, so `MAP_ATTRIBUTION` in `src/lib/map.ts`
   duplicates it. On the phone the doubled credit is a three-line white box
   covering ~30% of the map. Fix: drop the custom attribution, or keep only
   the OSM-wording part and let the style supply the rest.
3. **Stale status line** ("Gathering the story…") on Walla Walla desktop
   after all cards were filled (see above). Cosmetic, but it reads as if the
   page hung.
4. **Seattle city card empty while Spokane city card has Wikidata
   populations** — the Wikidata facts for the city seem to depend on the
   Wikipedia lookup succeeding (or on a different code path). If Wikidata is
   fetched independently, the Seattle city card should at least have
   population facts.
5. Minor: the Plate card and the Walla Walla/Spokane county "Established"
   facts are tagged *inferred*; fine, just noting it is visible.

## Third-party request summary (all six story pages + home)

| Host | Statuses |
|---|---|
| tiles.openfreemap.org | 155 × 200; 61 × `net::ERR_ABORTED` (tiles cancelled by MapLibre during zoom — normal, not errors) |
| nominatim.openstreetmap.org | 6 × 200 (one per story page) |
| en.wikipedia.org | 14 × 200, **6 × 429** |
| query.wikidata.org | 3 × 200 |
| gis.dnr.wa.gov | 12 × 200 |
| services.arcgis.com (Seattle GeoData) | 8 × 200 |
| gws.gplates.org | 6 × 200 |

No 5xx from any service. Home page made zero third-party requests.
