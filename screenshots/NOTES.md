# Live browser check 2 — 2026-10-08

Built site (`npm run build`, commit 1779d2e) served by `vite preview` at
http://127.0.0.1:4173/sno-ball/ and driven by Playwright against the REAL
services. Phone = Pixel 7 descriptor, desktop = 1280x900. Full-page PNGs.
Each address was searched from a fresh browser context (empty cache and
IndexedDB), phone run first, then desktop, 2 s between searches.

## Test results

| Step | Result |
|---|---|
| `npm run build` | OK (chunk-size warning only) |
| `npm run typecheck` | OK |
| `npm test` | 10 files, 396 tests passed |
| `npm run test:e2e` (offline) | 12 passed, 2 skipped (the LIVE spec) |
| `LIVE=1 npm run test:e2e` | **14 passed, 0 failed, 0 skipped** (19.5 s) |

## Screenshots

| File | What it shows |
|---|---|
| `seattle-{phone,desktop}.png` | 400 Broad St, Seattle (Space Needle) |
| `spokane-{phone,desktop}.png` | 507 N Howard St, Spokane |
| `port-townsend-{phone,desktop}.png` | 1820 Jefferson St, Port Townsend |
| `pike-place-{phone,desktop}.png` | 85 Pike St, Seattle (Pike Place Market) |
| `seattle-map-{phone,desktop}.png` | The `.postcard` map area only, for the credit |
| `console-<slug>.txt` | Console errors + warnings per address (phone + desktop runs) |
| `network-<slug>.txt` | Third-party requests, `[viewport] status host/path` |

## Settle times

"Settled" = hero names the city and no card is `aria-busy`. "Ready" = the
status line reads "Story ready" (measured from the submit click).

| Story | Phone settled / ready | Desktop settled / ready |
|---|---|---|
| Seattle (400 Broad) | 2.3 s / 5.0 s | 1.9 s / 1.9 s |
| Spokane | 2.4 s / 2.4 s | 1.9 s / 1.9 s |
| Port Townsend | 2.5 s / 2.6 s | 2.4 s / 2.4 s |
| Pike Place | 2.8 s / 4.2 s | 2.4 s / 3.6 s |

The 1–2.6 s gap between settle and ready on three runs is the Wikidata
population query (query.wikidata.org) finishing after the ring cards: the
status line waits for every loader, as intended.

## The five things to verify

**(i) Seattle CITY card: FIXED.** On both viewports the card shows the
Wikipedia excerpt ("Seattle (see-AT-əl) is the most populous city in the
U.S. state of Washington and the Pacific Northwest region of North
America." From Wikipedia · CC BY-SA 4.0) followed by "Population 608,660 in
2010" and "Population 737,015 in 2020" (From Wikidata · CC0). The same card
appears on the Pike Place story. No request to Wikipedia was made for it:
the excerpt came from `public/data/wiki-summaries.json`.

**(ii) Lower Queen Anne neighborhood card: FIXED.** Shows the excerpt
"Lower Queen Anne is a neighborhood in northwestern Seattle, Washington, at
the base of Queen Anne Hill. While its boundaries are not precise, the
toponym usually refers to the shopping, office, and residential districts
to the north and west of Seattle Center." (Wikipedia · CC BY-SA 4.0) plus
the annexation fact "Became part of Seattle in 1869". Also served from the
pre-baked file, zero Wikipedia requests.

**(iii) Requests to en.wikipedia.org per story:**

| Story | Phone | Desktop |
|---|---|---|
| Seattle (400 Broad) | 0 | 0 |
| Spokane | 0 | 0 |
| Port Townsend | 0 | 0 |
| Pike Place | 1 (**429**) | 1 (404) |

Seattle, Lower Queen Anne, Spokane, Riverside (no article; shown as "Nothing
on record"), Port Townsend and all three counties plus Washington state were
all answered from the pre-baked file. The only live call was for the
neighborhood "Pike-Market, Seattle", which is not in the file, and it is a
title Wikipedia does not have (the desktop run got a clean 404, which the
app treats as "no article": the status line reads plain "Story ready").

The phone run got a **429** for that same title. Wikimedia is currently
rate-limiting this container's shared egress IP (a plain `curl` from the
container also got 429 with `x-envoy-ratelimited: true`, intermittently).
The response carried `Retry-After: 30`, which is over the app's 15 s cap
(`MAX_RETRY_AFTER_MS`), so by design the app gave up at once without a
retry (confirmed with a second probe run: one request, the console warning
fires 0.1 s after the 429, and the status line reads "Story ready, but some
sources did not answer (Wikipedia (Pike-Market, Seattle)); the rest of the
story is here."). The page is otherwise complete: this neighborhood has no
Wikipedia article anyway, so nothing was lost. The 1 s spacing could not be
observed because no story made more than one Wikipedia call. It would be
worth adding "Pike-Market, Seattle" (or mapping it to "Pike Place Market")
to the pre-baked file so the flagship example chip never touches Wikipedia.

**(iv) Map credit: FIXED, printed once.** On every story the DOM has
exactly one `.maplibregl-ctrl-attrib` and its text is
"OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (no duplicate).
- Desktop: `compact: false`, a single open line (342 x 20 px) in the
  bottom-right corner of the 638 x 318 px map. It overlaps only the usual
  sliver of map (a street label at the very bottom edge). See
  `seattle-map-desktop.png`.
- Phone: compact mode with the (i) button. Note it is **open on load**
  (MapLibre's default: the text is shown until the first drag, then folds
  into the (i) button), so the phone screenshots show a two-line white
  pill 358 x 44 px across the bottom of the 378 x 317 px map, i.e. ~14% of
  the map height, with the (i) button at its right end. The pin and the
  street names remain visible. See `seattle-map-phone.png`. This is one
  box, not three lines, so the covering reported in check 1 is gone; if
  the owner wants it collapsed from the start, MapLibre would need
  `compact: true` plus removing `maplibregl-compact-show` after load.

**(v) Status line: FIXED.** On all eight runs the status line read "Story
ready: <hero sentence>" (or, on the phone Pike Place run, "Story ready, but
some sources did not answer (Wikipedia (Pike-Market, Seattle)); the rest of
the story is here.") within 0–2.6 s of the last card settling (table
above). No run was left on "Gathering the story…".

**(vi) Anything else:**
- Nothing overlapping or clipped on any of the eight full-page
  screenshots. Layout is the same clean single column as check 1.
- The status line now repeats the hero sentence word for word right above
  the hero ("Story ready: 400 Broad Street sits in…" then the big "400
  Broad Street sits in…"). Correct, just redundant on screen; a shorter
  "Story ready." would read better, since the live region is mainly for
  screen readers.
- Pike Place HOUSE card differs between the two runs: phone got
  "Built in 1908, Main Arcade, 1501 Pike Pl (parcel 1976200205), Renovated
  in 1970", desktop got "Built in 1910, Triangle Bldg, 1534 Pike Pl (parcel
  1976200165), Renovated in 1985". Nominatim placed 85 Pike St at slightly
  different coordinates in the two runs (both inside the Market block), so
  the parcel lookup hit two different parcels. Not wrong, but shows the
  parcel ring is sensitive to geocoder jitter.
- Rings that are empty for good reason: Street everywhere ("Nothing on
  record for this yet"); House/Block outside Seattle (no parcel or landmark
  source); Riverside, Spokane neighborhood (no Wikipedia article, no
  Seattle-style annexation data); Port Townsend neighborhood ("The map has
  no named neighborhood for this spot"). None of these rings should have
  data given the current sources.
- Facts spot-checked and correct: King County established December 22,
  1852; Jefferson County seat Port Townsend, named after Thomas Jefferson,
  pop. 32,977 in 2020; Spokane County pop. 539,339 in 2020; Port Townsend
  pop. 10,148 in 2020; Seattle 737,015 in 2020. Spokane County and Jefferson
  County "Established in 1858 / 1852" are tagged *inferred*, as before.
- Rock units: Seattle = Pleistocene continental glacial till; Pike Place =
  Holocene artificial fill and modified land (plausible for the waterfront
  regrade); Spokane = Pleistocene outburst flood deposits; Port Townsend =
  Pleistocene continental glacial till.
- Console: the only errors are the one 429 (phone Pike Place) and the one
  404 (desktop Pike Place) described above. The remaining warnings are
  MapLibre style warnings from the OpenFreeMap positron style
  ("layers[boundary_3].filter[1]: Expected value to be of type number, but
  found null") and headless-Chromium software-WebGL notices; none are ours.

## What renders correctly

- Home page: title, intro, search box, "Tell me its story" button, five
  example chips, Nominatim/OSM/ODbL credit, privacy note, "Forget my
  searches".
- Postcard map with caption, OpenFreeMap positron basemap, orange pin on
  the right spot (Space Needle lawn, Pike Place Market block, Riverfront
  Park, a house lot on Jefferson St in Port Townsend), single map credit.
- Status line then hero sentence, all four correct:
  - "400 Broad Street sits in Lower Queen Anne, in Seattle, King County, on Pleistocene continental glacial till."
  - "507 North Howard Street sits in Riverside, in Spokane, Spokane County, on Pleistocene outburst flood deposits."
  - "1820 Jefferson Street sits in Port Townsend, Jefferson County, on Pleistocene continental glacial till."
  - "85 Pike Street sits in Pike-Market, in Seattle, King County, on Holocene artificial fill and modified land."
- Ring chip strip (scrolls horizontally on phone), ring cards House →
  State with "From <source> · <licence>" on every fact, Wikipedia prose
  as an indented quoted excerpt with CC BY-SA 4.0 attribution.
- Deep time: rock card with the DNR unit description, ice-age card, five
  GPlates positions (20/50/100/200/300 Ma), Plate card (*inferred*).
- Sources list at the bottom.

## Third-party request summary (all eight story runs + the one probe)

| Host | Statuses |
|---|---|
| tiles.openfreemap.org | 243 × 200; 49 × `net::ERR_ABORTED` (tiles cancelled by MapLibre during the zoom; normal) |
| nominatim.openstreetmap.org | 8 × 200 (one per run) |
| services.arcgis.com (Seattle GeoData) | 16 × 200 (Seattle addresses only) |
| gis.dnr.wa.gov | 16 × 200 |
| gws.gplates.org | 8 × 200 |
| query.wikidata.org | 8 × 200 |
| en.wikipedia.org | 1 × 404, **1 × 429** (both for "Pike-Market, Seattle"; probe run: 1 × 429 more) |

No 5xx from any service. No request at all to Wikipedia for the 400 Broad
St, Spokane and Port Townsend stories.
