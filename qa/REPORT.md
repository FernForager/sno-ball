# QA sweep report — Snowball (sno-ball)

Branch under test: `claude/ultra-code-wmnysa` at commit `efde44a` (built with `npm run build`, served with `npm run preview -- --host 127.0.0.1 --port 4173`). Date: 2026-10-08. All runs used the production build, not the dev server.

Files in this folder:

- `playwright.webkit.config.ts` — Pass 1 config (WebKit phone + desktop).
- `webkit-probe.mjs` — checks what WebKit does with the map (WebGL, fallback note).
- `axe.mjs` — Pass 2 scanner; results in `axe-results.json`.
- `sweep.mjs` — Pass 3 address sweep; results in `sweep-results.json`; `sweep-table.mjs` renders the table below.
- `screens/` — full-page phone screenshots of the three problem cases (JPEG, downscaled). The scripts write every screenshot as PNG when re-run; only these three were kept.

## Pass 1 — Safari engine (WebKit 26.0, Playwright build v2215)

Command: `npx playwright test -c qa/playwright.webkit.config.ts` (offline suite) and `LIVE=1 npx playwright test -c qa/playwright.webkit.config.ts`.

**Result: 12/12 offline tests passed on both projects, then 14/14 with LIVE=1 (the two live tests included). No failures, no retries.**

| Test | webkit-phone (iPhone 14) | webkit-desktop (Desktop Safari) |
|---|---|---|
| smoke › home page renders the search box and example chips | pass (6.8s cold, 0.7s warm) | pass (1.1s) |
| smoke › an empty search shows a hint and makes no request | pass | pass |
| story › a search fills every ring from the stubbed services | pass (9.3s / 3.2s) | pass (3.1s / 2.3s) |
| story › a share link looks the address up once and rebuilds the full story | pass | pass |
| story › the rock card settles honestly when both geology services are down | pass | pass |
| story › the home page has no empty postcard and offers to forget searches | pass | pass |
| live › tells the story of 400 Broad St, Seattle (LIVE=1 only; skipped offline) | pass (3.5s) | pass (2.7s) |

WebGL and the map in headless WebKit: **WebGL was available** (`canvas.getContext('webgl')` returned a context in both profiles), MapLibre created its canvas, and the attribution control read "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". The one-line "map unavailable" note (`.postcard__note`) did **not** appear, so the fallback path was not exercised in this run; the story test's map assertions (credit visible, not covered, worker served as JavaScript, compact (i) button on the phone) all ran and passed under WebKit. The live story rendered fully in WebKit: hero sentence "400 Broad Street sits in Lower Queen Anne, in Seattle, King County, on Pleistocene continental glacial till."; rings house rich(4) · block rich(5) · street empty · neighborhood rich(2) · city rich(3) · county rich(5) · region thin(1) · state rich(2) · plate thin(1); status line "Story ready: …"; zero console errors or page errors. (Full-page WebKit screenshots were taken and inspected but not committed, to keep the folder small; `webkit-probe.mjs` regenerates them.) Raw runner output: `webkit-offline.txt`, `webkit-live.txt`, `webkit-probe.json`.

Notes for the config: Playwright resolves `testDir`, `outputDir` and the web server's `cwd` relative to the config file, so the WebKit config re-anchors them at the repo root; otherwise it would look for tests under `qa/tests/e2e` and run `npm run preview` inside `qa/`.

## Pass 2 — Accessibility (axe-core via @axe-core/playwright, Chromium)

Command: `node qa/axe.mjs > qa/axe-results.json`. Rules: WCAG 2.0/2.1 A + AA plus axe best-practice. Pages: the home page, and the Space Needle story after typing "400 Broad St, Seattle, WA" and waiting until no element was `aria-busy` (the story settled in 2.8 s on the phone and 2.2 s on desktop). Viewports: Pixel 7 (phone) and Desktop Chrome.

**Result: 0 violations at any impact level on all four scans** (home/phone, story/phone, home/desktop, story/desktop). Passed rule counts: 34 / 43 / 34 / 42. No console errors or page errors during the scans.

| Scan | Critical | Serious | Moderate | Minor | Incomplete (needs a human look) |
|---|---|---|---|---|---|
| home, phone | 0 | 0 | 0 | 0 | none |
| story, phone | 0 | 0 | 0 | 0 | color-contrast: 1 node |
| home, desktop | 0 | 0 | 0 | 0 | none |
| story, desktop | 0 | 0 | 0 | 0 | color-contrast: 5 nodes |

"Incomplete" means axe could not decide, not that it failed. (A second run of the same scan also listed `heading-order` on `#ring-city-name` as incomplete on the phone, because the card was being re-rendered at the instant of the scan; it is not a real ordering problem, the outline below is in order.) See `axe-results.json` → `incomplete[].targets` for the exact selectors; these are the text layered over the map postcard (the caption and MapLibre's attribution), which axe cannot measure against a canvas background. Eyeballing the screenshots, the caption sits on a solid card so it is fine; the attribution text is MapLibre's default (small grey on translucent white) and is worth a manual check on a busy map tile.

Heading outline of the story page (identical on phone and desktop; the home page has only the h1):

```
h1  Snowball
h2  400 Broad Street            (house)
h2  the block of Broad Street   (block)
h2  Broad Street                (street)
h2  Lower Queen Anne            (neighborhood)
h2  Seattle                     (city)
h2  King County                 (county)
h2  Puget Sound                 (region)
h2  Washington                  (state)
h2  North American Plate        (plate)
h2  Deep time
h3  The rock under this spot
h3  Under 3,000 feet of ice
h3  Where this spot has been
h2  Sources
```

- Exactly **one h1** on every scan (`h1Count: 1`). ✔
- The status line `.story__status` has `role="status"`, `aria-live="polite"` and `aria-atomic="true"`; after the story settled it read "Story ready: 400 Broad Street sits in Lower Queen Anne, in Seattle, King County, on Pleistocene continental glacial till." ✔
- Small observation (not a violation): the ring h2 "the block of Broad Street" is the only heading that starts lower-case, which reads oddly in a screen-reader headings list next to "Broad Street" and "400 Broad Street".

## Pass 3 — Address sweep (Chromium, Pixel 7 viewport, live services)

Command: `node qa/sweep.mjs > qa/sweep-results.json` (30 queries, a fresh browser context per query, 2.5 s between queries). "Settled" = the hero sentence is visible and no element is `aria-busy`, or an error alert is showing; 45 s cap. Then `STRICT=1 node qa/sweep.mjs <six queries>` re-ran the rows whose status line still read "Gathering the story…" at that moment, this time also waiting for the final status line (`sweep-rerun-strict.json`).

**Headline: 29 of 30 queries produced a story, 1 (the DC address) was correctly rejected. No crash, no blank page, no unhandled promise rejection, no page error, no Oregon/Idaho/other-state result. Every story settled in 2.6–5.8 s. Two expected-behaviour rows need attention (#25 wrong place, #21 Wikipedia 429), and one timing issue showed up in six rows (cards stop being `aria-busy` before all their sources have answered).**

Reading the table: the "Rings" column lists house, block, street, neighborhood, city, county, region, state, plate in that order; R = rich, T = thin, E = empty, L = still loading, and the digit is the number of facts. `tiles.openfreemap.org (net::ERR_ABORTED)` appears on every story row in the raw JSON and is omitted here: MapLibre cancels tile requests it no longer needs, which is normal.

| # | Query | Outcome | Geocoded as | lat,lng | Precise | Rings H/B/S/N/C/Co/R/St/P (status:facts) | Settle | Status line | Console errors | Non-2xx hosts |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 400 Broad St, Seattle, WA | story | Space Needle, 400, Broad Street, South Lake Union, Cascade, Belltown, Seattle, King County, Washington, 98109, United States | 47.62051,-122.3493 | yes | R4 R5 E0 R2 R3 R5 T1 R2 T1 | 3.7s | Story ready: 400 Broad Street sits in Lower Queen Anne, in S | 0 | — |
| 2 | 5400 Ballard Ave NW, Seattle, WA | story | 5400, Ballard Avenue Northwest, Ballard, Seattle, King County, Washington, 98107, United States | 47.66789,-122.38452 | yes | R3 R3 E0 R2 T1 R5 T1 R2 T1 | 3.2s | Gathering the story… | 0 | — |
| 3 | 4727 California Ave SW, Seattle, WA | story | Puerto Vallarta, 4727, California Avenue Southwest, Alaska Junction, West Seattle, Seattle, King County, Washington, 98116, United States | 47.56033,-122.387 | yes | R3 R2 E0 R2 R3 R5 T1 R2 T1 | 3.8s | Story ready: 4727 California Avenue Southwest sits in Genese | 0 | — |
| 4 | 9200 Rainier Ave S, Seattle, WA | story | 9200, Rainier Avenue South, Rainier Beach, Seattle, King County, Washington, 98118, United States | 47.52088,-122.26939 | yes | R3 E0 E0 R2 R3 R5 T1 R2 T1 | 3.7s | Story ready: 9200 Rainier Avenue South sits in Dunlap, in Se | 0 | — |
| 5 | 747 Market St, Tacoma, WA | story | Tacoma Municipal Building, 747, Market Street, New Tacoma, Tacoma, Pierce County, Washington, 98402, United States | 47.25581,-122.44173 | yes | E0 E0 E0 E0 R8 R5 T1 R2 T1 | 5.8s | Story ready: 747 Market Street sits in New Tacoma, in Tacoma | 0 | — |
| 6 | 2930 Wetmore Ave, Everett, WA | story | Everett Municipal Building, 2930, Wetmore Avenue, Port Gardner, Everett, Snohomish County, Washington, 98120, United States | 47.97815,-122.20763 | yes | E0 E0 E0 E0 R9 R5 T1 R2 T1 | 3.2s | Story ready: 2930 Wetmore Avenue sits in Port Gardner, in Ev | 0 | — |
| 7 | 210 Lottie St, Bellingham, WA | story | Bellingham City Hall, 210, Lottie Street, City Center, Bellingham, Whatcom County, Washington, 98225, United States | 48.75525,-122.47894 | yes | E0 E0 E0 E0 R3 R4 T1 R2 T1 | 2.9s | Story ready: 210 Lottie Street sits in City Center, in Belli | 0 | — |
| 8 | 416 Sid Snyder Ave SW, Olympia, WA | story | Washington State Capitol, 416, Sid Snyder Avenue Southwest, Olympia, Thurston County, Washington, 98501, United States | 47.03577,-122.90485 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.1s | Story ready: 416 Sid Snyder Avenue Southwest sits in Olympia | 0 | — |
| 9 | 415 W 6th St, Vancouver, WA | story | Vancouver City Hall, 415, West 6th Street, Esther Short, Vancouver, Clark County, Washington, 98660, United States | 45.62538,-122.67551 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.0s | Story ready: 415 West 6th Street sits in Esther Short, in Va | 0 | — |
| 10 | 129 N 2nd St, Yakima, WA | story | Yakima City Hall, 129, North 2nd Street, Yakima, Yakima County, Washington, 98901, United States | 46.60493,-120.50524 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.2s | Story ready: 129 North 2nd Street sits in Yakima, Yakima Cou | 0 | — |
| 11 | 301 Yakima St, Wenatchee, WA | story | 301, Yakima Street, Wenatchee, Chelan County, Washington, 98801, United States | 47.42064,-120.31207 | yes | E0 E0 E0 E0 T1 R5 T1 R2 T1 | 3.2s | Gathering the story… | 0 | — |
| 12 | 325 SE Paradise St, Pullman, WA | story | 325, Southeast Paradise Street, Downtown, Ward 3, Pullman, Whitman County, Washington, 99163, United States | 46.7288,-117.17964 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.3s | Story ready: 325 Southeast Paradise Street sits in Downtown, | 0 | — |
| 13 | 206 W Main Ave, Ritzville, WA | story | 206, West Main Avenue, Ritzville, Adams County, Washington, 99169, United States | 47.12682,-118.38102 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.2s | Story ready: 206 West Main Avenue sits in Ritzville, Adams C | 0 | — |
| 14 | 15 N Clark Ave, Republic, WA | story | 15, North Clark Avenue, Republic, Ferry County, Washington, 99166, United States | 48.64792,-118.73818 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 2.8s | Story ready: 15 North Clark Avenue sits in Republic, Ferry C | 0 | — |
| 15 | 500 E Division St, Forks, WA | story | 500, East Division Street, Forks, Clallam County, Washington, 98331, United States | 47.95031,-124.3788 | yes | E0 E0 E0 E0 R8 R4 T1 R2 T1 | 2.8s | Story ready: 500 East Division Street sits in Forks, Clallam | 0 | — |
| 16 | 350 Court St, Friday Harbor, WA | story | San Juan County Courthouse, 350, Court Street, Friday Harbor, San Juan County, Washington, 98250, United States | 48.53579,-123.01864 | yes | E0 E0 E0 E0 T1 R5 T1 R2 T1 | 3.1s | Gathering the story… | 0 | — |
| 17 | 115 Bolstad Ave W, Long Beach, WA | story | Long Beach City Hall, 115 Bolstad Avenue East, Long Beach, Pacific, Washington, 98631, United States | 46.35113,-124.05535 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.7s | Story ready: 115 Bolstad Avenue East sits in Long Beach, Pac | 0 | — |
| 18 | 2 N Main St, Omak, WA | story | Main Street South, Omak, Okanogan County, Washington, 98841, United States | 48.40696,-119.52851 | no (area) | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.2s | Story ready: Main Street South sits in Omak, Okanogan County | 0 | — |
| 19 | 170 S Oak St, Colville, WA | story | 170, South Oak Street, Colville, Stevens County, Washington, 99114, United States | 48.54374,-117.90445 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.2s | Story ready: 170 South Oak Street sits in Colville, Stevens  | 0 | — |
| 20 | 21 W 1st Ave, Toppenish, WA | story | West 1st Avenue, Toppenish, Yakima County, Washington, 98948, United States | 46.37508,-120.31556 | no (area) | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 2.7s | Story ready: West 1st Avenue sits in Toppenish, Yakima Count | 0 | — |
| 21 | Neah Bay, WA | story | Neah Bay, Clallam County, Washington, 98357, United States | 48.35917,-124.61081 | no (area) | E0 E0 E0 E0 E0 R4 T1 R2 T1 | 3.1s | Story ready, but some sources did not answer (Wikipedia (Nea | 2 | en.wikipedia.org:429 |
| 22 | 1 Tyee Dr, Point Roberts, WA | story | Tyee Drive, Point Roberts, Whatcom County, Washington, 98281, United States | 48.99979,-123.06786 | no (area) | E0 E0 E0 E0 T1 R4 T1 R2 T1 | 3.0s | Gathering the story… | 0 | — |
| 23 | 7121 E Loop Rd, Stevenson, WA | story | Loop Road, Stevenson, Skamania County, Washington, 98648, United States | 45.70065,-121.89325 | no (area) | E0 E0 E0 E0 R4 R4 T1 R2 T1 | 3.2s | Story ready: Loop Road sits in Stevenson, Skamania County, o | 0 | — |
| 24 | 501 N Anderson St, Ellensburg, WA | story | 501, North Anderson Street, Ellensburg, Kittitas County, Washington, 98926, United States | 46.99679,-120.542 | yes | E0 E0 E0 E0 R3 R4 T1 R2 T1 | 3.2s | Story ready: 501 North Anderson Street sits in Ellensburg, K | 0 | — |
| 25 | Paradise, Mount Rainier National Park, WA | story | National Forest Service - Mount Rainier National Park, 450 Roosevelt Avenue East, Enumclaw, King, Washington, 98022, United States | 47.19891,-121.97422 | yes | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 4.2s | Story ready: 450 Roosevelt Avenue East sits in Enumclaw, Kin | 0 | — |
| 26 | Mount Rainier | story | Mount Rainier, Pierce County, Washington, United States | 46.8522,-121.75752 | no (area) | E0 E0 E0 E0 E0 R5 T1 R2 T1 | 2.6s | Story ready: This spot sits in Pierce County, on ice. | 0 | — |
| 27 | Seatle Space Nedle | story | Space Needle, 400 Broad Street, Belltown, Seattle, King, Washington, 98109, United States | 47.62051,-122.3493 | yes | R4 R5 E0 R2 T1 R5 T1 R2 T1 | 3.9s | Gathering the story… | 0 | — |
| 28 | 1600 Pennsylvania Ave, Washington, DC | not-found | I couldn't find that in Washington. Try adding the city. | — | — | -0 -0 -0 -0 -0 -0 -0 -0 -0 | 3.8s | — | 0 | — |
| 29 | PO Box 1, Spokane, WA | story | Spokane, Spokane County, Washington, United States | 47.65719,-117.42351 | no (area) | E0 E0 E0 E0 R4 R5 T1 R2 T1 | 3.4s | Story ready: This spot sits in Spokane, Spokane County, on P | 0 | — |
| 30 | 98101 | story | 98101, Seattle, King County, Washington, United States | 47.61072,-122.33617 | no (area) | E0 R5 E0 T1 T1 R5 T1 R2 T1 | 3.0s | Gathering the story… | 0 | — |

Ring key: R rich, T thin, E empty, L still loading; the number is the fact count. Order: house, block, street, neighborhood, city, county, region, state, plate.

## Ring names and hero sentences

**1. 400 Broad St, Seattle, WA** → story
- Hero: 400 Broad Street sits in Lower Queen Anne, in Seattle, King County, on Pleistocene continental glacial till.
- Rings: house=“400 Broad Street”; block=“the block of Broad Street”; street=“Broad Street”; neighborhood=“Lower Queen Anne”; city=“Seattle”; county=“King County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial till Qgt Laid down about 16,000 years ago by the ice sheet of the last ic
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**2. 5400 Ballard Ave NW, Seattle, WA** → story
- Hero: 5400 Ballard Avenue Northwest sits in Ballard, in Seattle, King County, on Pleistocene continental glacial till.
- Rings: house=“5400 Ballard Avenue Northwest”; block=“the block of Ballard Avenue Northwest”; street=“Ballard Avenue Northwest”; neighborhood=“Ballard”; city=“Seattle”; county=“King County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial till Qgt Laid down about 16,000 years ago by the ice sheet of the last ic
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**3. 4727 California Ave SW, Seattle, WA** → story
- Hero: 4727 California Avenue Southwest sits in Genesee, in Seattle, King County, on Pleistocene continental glacial drift.
- Rings: house=“4727 California Avenue Southwest”; block=“the block of California Avenue Southwest”; street=“California Avenue Southwest”; neighborhood=“Genesee”; city=“Seattle”; county=“King County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial drift Qga Laid down about 16,000 years ago by the ice sheet of the last i
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**4. 9200 Rainier Ave S, Seattle, WA** → story
- Hero: 9200 Rainier Avenue South sits in Dunlap, in Seattle, King County, on Pleistocene continental glacial till.
- Rings: house=“9200 Rainier Avenue South”; block=“the block of Rainier Avenue South”; street=“Rainier Avenue South”; neighborhood=“Dunlap”; city=“Seattle”; county=“King County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial till Qgt Laid down about 16,000 years ago by the ice sheet of the last ic
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**5. 747 Market St, Tacoma, WA** → story
- Hero: 747 Market Street sits in New Tacoma, in Tacoma, Pierce County, on Pleistocene continental glacial drift.
- Rings: house=“747 Market Street”; block=“the block of Market Street”; street=“Market Street”; neighborhood=“New Tacoma”; city=“Tacoma”; county=“Pierce County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial drift Qgo(i) Laid down about 16,000 years ago by the ice sheet of the las
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**6. 2930 Wetmore Ave, Everett, WA** → story
- Hero: 2930 Wetmore Avenue sits in Port Gardner, in Everett, Snohomish County, on Pleistocene continental glacial till.
- Rings: house=“2930 Wetmore Avenue”; block=“the block of Wetmore Avenue”; street=“Wetmore Avenue”; neighborhood=“Port Gardner”; city=“Everett”; county=“Snohomish County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial till Qgt Laid down about 16,000 years ago by the ice sheet of the last ic
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**7. 210 Lottie St, Bellingham, WA** → story
- Hero: 210 Lottie Street sits in City Center, in Bellingham, Whatcom County, on Pleistocene continental glacial drift.
- Rings: house=“210 Lottie Street”; block=“the block of Lottie Street”; street=“Lottie Street”; neighborhood=“City Center”; city=“Bellingham”; county=“Whatcom County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial drift Qgdm(e) Laid down about 16,000 years ago by the ice sheet of the la
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**8. 416 Sid Snyder Ave SW, Olympia, WA** → story
- Hero: 416 Sid Snyder Avenue Southwest sits in Olympia, Thurston County, on Pleistocene continental glacial drift.
- Rings: house=“416 Sid Snyder Avenue Southwest”; block=“the block of Sid Snyder Avenue Southwest”; street=“Sid Snyder Avenue Southwest”; neighborhood=“This neighborhood”; city=“Olympia”; county=“Thurston County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial drift Qgos Laid down about 16,000 years ago by the ice sheet of the last 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**9. 415 W 6th St, Vancouver, WA** → story
- Hero: 415 West 6th Street sits in Esther Short, in Vancouver, Clark County, on Quaternary alluvium.
- Rings: house=“415 West 6th Street”; block=“the block of West 6th Street”; street=“West 6th Street”; neighborhood=“Esther Short”; city=“Vancouver”; county=“Clark County”; region=“Southwest Washington”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Quaternary alluvium Qa Formed within the last 2.6 million years, in the Quaternary. Unconsolidated clay, 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**10. 129 N 2nd St, Yakima, WA** → story
- Hero: 129 North 2nd Street sits in Yakima, Yakima County, on Quaternary alluvium.
- Rings: house=“129 North 2nd Street”; block=“the block of North 2nd Street”; street=“North 2nd Street”; neighborhood=“This neighborhood”; city=“Yakima”; county=“Yakima County”; region=“Yakima Valley”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Quaternary alluvium Qt Formed within the last 2.6 million years, in the Quaternary. Moderately sorted to 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**11. 301 Yakima St, Wenatchee, WA** → story
- Hero: 301 Yakima Street sits in Wenatchee, Chelan County, on Pleistocene outburst flood deposits.
- Rings: house=“301 Yakima Street”; block=“the block of Yakima Street”; street=“Yakima Street”; neighborhood=“This neighborhood”; city=“Wenatchee”; county=“Chelan County”; region=“North Cascades”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene outburst flood deposits Qfg Laid down between about 18,000 and 15,000 years ago by the Ice Ag
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**12. 325 SE Paradise St, Pullman, WA** → story
- Hero: 325 Southeast Paradise Street sits in Downtown, in Pullman, Whitman County, on Miocene Columbia River Basalt Group, Wanapum Basalt.
- Rings: house=“325 Southeast Paradise Street”; block=“the block of Southeast Paradise Street”; street=“Southeast Paradise Street”; neighborhood=“Downtown”; city=“Pullman”; county=“Whitman County”; region=“Palouse and Blue Mountains”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Miocene Columbia River Basalt Group, Wanapum Basalt Mv(wpr) Formed between 23 and 5.3 million years ago, 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**13. 206 W Main Ave, Ritzville, WA** → story
- Hero: 206 West Main Avenue sits in Ritzville, Adams County, on Pleistocene outburst flood deposits.
- Rings: house=“206 West Main Avenue”; block=“the block of West Main Avenue”; street=“West Main Avenue”; neighborhood=“This neighborhood”; city=“Ritzville”; county=“Adams County”; region=“Columbia Basin”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene outburst flood deposits Qfg Laid down between about 18,000 and 15,000 years ago by the Ice Ag
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**14. 15 N Clark Ave, Republic, WA** → story
- Hero: 15 North Clark Avenue sits in Republic, Ferry County, on Eocene Tertiary sedimentary rocks and deposits.
- Rings: house=“15 North Clark Avenue”; block=“the block of North Clark Avenue”; street=“North Clark Avenue”; neighborhood=“This neighborhood”; city=“Republic”; county=“Ferry County”; region=“Northeast Washington”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Tertiary sedimentary rocks and deposits Ec(k) Formed between 56 and 33.9 million years ago, in the Eocene
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**15. 500 E Division St, Forks, WA** → story
- Hero: 500 East Division Street sits in Forks, Clallam County, on Pleistocene continental glacial drift.
- Rings: house=“500 East Division Street”; block=“the block of East Division Street”; street=“East Division Street”; neighborhood=“This neighborhood”; city=“Forks”; county=“Clallam County”; region=“Olympic Peninsula”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial drift Qgo Laid down about 16,000 years ago by the ice sheet of the last i
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**16. 350 Court St, Friday Harbor, WA** → story
- Hero: 350 Court Street sits in Friday Harbor, San Juan County, on Cretaceous-Jurassic Mesozoic metasedimentary rocks.
- Rings: house=“350 Court Street”; block=“the block of Court Street”; street=“Court Street”; neighborhood=“This neighborhood”; city=“Friday Harbor”; county=“San Juan County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Mesozoic metasedimentary rocks KJmm Formed between 201.4 and 66 million years ago, in the Cretaceous-Jura
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**17. 115 Bolstad Ave W, Long Beach, WA** → story
- Hero: 115 Bolstad Avenue East sits in Long Beach, Pacific County, on Quaternary alluvium.
- Rings: house=“115 Bolstad Avenue East”; block=“the block of Bolstad Avenue East”; street=“Bolstad Avenue East”; neighborhood=“This neighborhood”; city=“Long Beach”; county=“Pacific County”; region=“Southwest Washington”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Quaternary alluvium Qb Laid down about 16,000 years ago by the ice sheet of the last ice age. Moderately 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**18. 2 N Main St, Omak, WA** → story
- Hero: Main Street South sits in Omak, Okanogan County, on Quaternary alluvium.
- Rings: house=“This spot”; block=“the block of Main Street South”; street=“Main Street South”; neighborhood=“This neighborhood”; city=“Omak”; county=“Okanogan County”; region=“Okanogan”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Quaternary alluvium Qa Formed within the last 2.6 million years, in the Quaternary. Unconsolidated clay, 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**19. 170 S Oak St, Colville, WA** → story
- Hero: 170 South Oak Street sits in Colville, Stevens County, on Pleistocene continental glacial drift.
- Rings: house=“170 South Oak Street”; block=“the block of South Oak Street”; street=“South Oak Street”; neighborhood=“This neighborhood”; city=“Colville”; county=“Stevens County”; region=“Northeast Washington”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial drift Qgd Laid down about 16,000 years ago by the ice sheet of the last i
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**20. 21 W 1st Ave, Toppenish, WA** → story
- Hero: West 1st Avenue sits in Toppenish, Yakima County, on Quaternary alluvium.
- Rings: house=“This spot”; block=“the block of West 1st Avenue”; street=“West 1st Avenue”; neighborhood=“This neighborhood”; city=“Toppenish”; county=“Yakima County”; region=“Yakima Valley”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Quaternary alluvium Qa Formed within the last 2.6 million years, in the Quaternary. Unconsolidated clay, 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**21. Neah Bay, WA** → story
- Hero: This spot sits in Neah Bay, Clallam County, on Pleistocene continental glacial drift.
- Rings: house=“This spot”; block=“This block”; street=“This street”; neighborhood=“This neighborhood”; city=“Neah Bay”; county=“Clallam County”; region=“Olympic Peninsula”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial drift Qgd Laid down about 16,000 years ago by the ice sheet of the last i
- Console: Failed to load resource: the server responded with a status of 429 () ‖ Failed to load resource: the server responded with a status of 429 ()
- Non-2xx: en.wikipedia.org/api/rest_v1/page/summary/Neah_Bay%2C_Washington 429; en.wikipedia.org/w/api.php 429
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**22. 1 Tyee Dr, Point Roberts, WA** → story
- Hero: Tyee Drive sits in Point Roberts, Whatcom County, on Pleistocene continental glacial drift.
- Rings: house=“This spot”; block=“the block of Tyee Drive”; street=“Tyee Drive”; neighborhood=“This neighborhood”; city=“Point Roberts”; county=“Whatcom County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial drift Qgog Laid down about 16,000 years ago by the ice sheet of the last 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**23. 7121 E Loop Rd, Stevenson, WA** → story
- Hero: Loop Road sits in Stevenson, Skamania County, on Miocene, lower Tertiary sedimentary rocks and deposits.
- Rings: house=“This spot”; block=“the block of Loop Road”; street=“Loop Road”; neighborhood=“This neighborhood”; city=“Stevenson”; county=“Skamania County”; region=“South Cascades”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Tertiary sedimentary rocks and deposits Mcg(ec) Formed between 23 and 5.3 million years ago, in the Mioce
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**24. 501 N Anderson St, Ellensburg, WA** → story
- Hero: 501 North Anderson Street sits in Ellensburg, Kittitas County, on Quaternary alluvium.
- Rings: house=“501 North Anderson Street”; block=“the block of North Anderson Street”; street=“North Anderson Street”; neighborhood=“This neighborhood”; city=“Ellensburg”; county=“Kittitas County”; region=“Yakima Valley”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Quaternary alluvium Qt Formed within the last 2.6 million years, in the Quaternary. Moderately sorted to 
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**25. Paradise, Mount Rainier National Park, WA** → story
- Hero: 450 Roosevelt Avenue East sits in Enumclaw, King County, on Holocene Quaternary fragmental volcanic rocks and deposits (includes lahars).
- Rings: house=“450 Roosevelt Avenue East”; block=“the block of Roosevelt Avenue East”; street=“Roosevelt Avenue East”; neighborhood=“This neighborhood”; city=“Enumclaw”; county=“King County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Quaternary fragmental volcanic rocks and deposits (includes lahars) Qvl(o) Laid down within the last 11,7
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**26. Mount Rainier** → story
- Hero: This spot sits in Pierce County, on ice.
- Rings: house=“This spot”; block=“This block”; street=“This street”; neighborhood=“This neighborhood”; city=“Unincorporated area”; county=“Pierce County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot ice The survey gives no age for this unit. frozen water From Washington Geological Survey (WA DNR), 1:100
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**27. Seatle Space Nedle** → story
- Hero: 400 Broad Street sits in Lower Queen Anne, in Seattle, King County, on Pleistocene continental glacial till.
- Rings: house=“400 Broad Street”; block=“the block of Broad Street”; street=“Broad Street”; neighborhood=“Lower Queen Anne”; city=“Seattle”; county=“King County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene continental glacial till Qgt Laid down about 16,000 years ago by the ice sheet of the last ic
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**28. 1600 Pennsylvania Ave, Washington, DC** → not-found
- Error: I couldn't find that in Washington. Try adding the city.
- Rock: UnderfootThe rock under this spot

**29. PO Box 1, Spokane, WA** → story
- Hero: This spot sits in Spokane, Spokane County, on Pleistocene outburst flood deposits.
- Rings: house=“This spot”; block=“This block”; street=“This street”; neighborhood=“This neighborhood”; city=“Spokane”; county=“Spokane County”; region=“Northeast Washington”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Pleistocene outburst flood deposits Qfg Laid down between about 18,000 and 15,000 years ago by the Ice Ag
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)

**30. 98101** → story
- Hero: This spot sits in Central Business District, in Seattle, King County, on Holocene artificial fill and modified land.
- Rings: house=“This spot”; block=“This block”; street=“This street”; neighborhood=“Central Business District”; city=“Seattle”; county=“King County”; region=“Puget Sound”; state=“Washington”; plate=“North American Plate”
- Rock: UNDERFOOT The rock under this spot Holocene artificial fill and modified land Qf Laid down within the last 11,700 years, since the ice age e
- Failed requests: tiles.openfreemap.org (net::ERR_ABORTED)


### Strict re-run of the six "Gathering the story…" rows

| # | Query | Rings (strict settle) | Settle | Status line |
|---|---|---|---|---|
| 2 | 5400 Ballard Ave NW, Seattle, WA | R3 R3 E0 R2 R3 R5 T1 R2 T1 | 2.9s | Story ready: 5400 Ballard Avenue Northwest sits in Ballard, in Seattle, King County, on Pleistocene continental glacial till. |
| 11 | 301 Yakima St, Wenatchee, WA | E0 E0 E0 E0 R5 R5 T1 R2 T1 | 2.7s | Story ready: 301 Yakima Street sits in Wenatchee, Chelan County, on Pleistocene outburst flood deposits. |
| 16 | 350 Court St, Friday Harbor, WA | E0 E0 E0 E0 R3 R5 T1 R2 T1 | 3.2s | Story ready: … Friday Harbor, San Juan County, on Cretaceous-Jurassic Mesozoic metasedimentary rocks. |
| 22 | 1 Tyee Dr, Point Roberts, WA | E0 E0 E0 E0 R3 R4 T1 R2 T1 | 3.9s | Story ready: Tyee Drive sits in Point Roberts, Whatcom County, on Pleistocene continental glacial drift. |
| 27 | Seatle Space Nedle | R4 R5 E0 R2 R3 R5 T1 R2 T1 | 4.7s | Story ready: 400 Broad Street sits in Lower Queen Anne, in Seattle, King County, on Pleistocene continental glacial till. |
| 30 | 98101 | E0 R5 E0 R2 R3 R5 T1 R2 T1 | 4.7s | Story ready: This spot sits in Central Business District, in Seattle, King County, on Holocene artificial fill and modified land. |

In every one of these the city card had been shown as "thin, 1 fact" and not busy while its Wikipedia excerpt (queued behind the 1-request-per-second Wikimedia limiter) was still on its way; one or two seconds later it became rich. The data is right; only the busy signal is early. Zero console errors in the re-run.

### Judged against the expectations

- **Washington street addresses (#1–#20, #24)**: all produced a story with sensible ring names: the house ring is the formatted address, the block is "the block of <street>", the street is the street, city/county/region/state/plate are right in every row (Puget Sound, Southwest Washington, Yakima Valley, North Cascades, Palouse and Blue Mountains, Columbia Basin, Northeast Washington, Olympic Peninsula, Okanogan, South Cascades all matched the place). Seattle rows fill house/block/neighborhood from the city's open data; outside Seattle those rings settle as compact "Nothing on record" cards, as designed.
- **#18 Omak, #20 Toppenish, #22 Point Roberts, #23 Stevenson**: Nominatim did not know the house number and returned the street instead. The site handled it well: the house ring is "This spot", the postcard says "a general area, not one building", and the hero names the street. Nothing told the visitor that the number itself was not found, though (see Top issues).
- **#17 Long Beach**: typed "Bolstad Ave W", got "115 Bolstad Avenue East" (Long Beach City Hall). The coordinates (46.351, -124.055) are the right building; the E/W is how OpenStreetMap has tagged that address, not a Snowball bug. Worth knowing when the hero sentence disagrees with what someone typed.
- **#25 "Paradise, Mount Rainier National Park, WA"**: produced a story, but for the wrong place: Nominatim's first hit is the "National Forest Service – Mount Rainier National Park" office at 450 Roosevelt Ave E in Enumclaw (47.199, -121.974), about 50 km from Paradise, and the site treated it as a precise building. The expectation allowed an empty-ringed story or not-found; a confident story about an office in Enumclaw is neither. Screenshot: `screens/problem-1-paradise-geocoded-to-enumclaw-phone.jpg`.
- **#26 "Mount Rainier"**: resolved to the summit (46.852, -121.758), city ring "Unincorporated area", house/block/street/neighborhood empty — acceptable per the expectations. The hero reads "This spot sits in Pierce County, on ice." because the DNR geology unit at the summit is literally "ice"; true, but it reads like a glitch.
- **#27 "Seatle Space Nedle"**: the typo resolved to the Space Needle; identical story to #1. ✔
- **#28 "1600 Pennsylvania Ave, Washington, DC"**: rejected with exactly "I couldn't find that in Washington. Try adding the city." No story, no console errors. ✔
- **#29 "PO Box 1, Spokane, WA"**: fell back to the city of Spokane as "a general area"; graceful, no errors. ✔
- **#30 "98101"**: resolved to the 98101 ZIP centroid in downtown Seattle; neighborhood "Central Business District", landmarks in the block ring; graceful. ✔
- **#21 "Neah Bay, WA"**: Wikipedia answered **HTTP 429** twice (the page-summary call for "Neah Bay, Washington" and the follow-up `w/api.php` lookup for its Wikidata id). The site coped: the city card settled as empty and the status line said "Story ready, but some sources did not answer (Wikipedia (Neah Bay, Washington) …)". The two "console errors" on that row are Chrome's own "Failed to load resource: 429" log lines, not exceptions. This was the only non-2xx third-party response in 30 queries (about 90 outside requests to Wikipedia/Wikidata over 3 minutes). Screenshot: `screens/problem-2-neah-bay-wikipedia-429-phone.jpg`.
- **Ring named "This neighborhood"** (#8, #10, #11, #13–#20, #22–#25): outside Seattle, when the geocoder returns no neighbourhood, the ring keeps its placeholder name. Not wrong, but it is a heading, so screen readers announce "This neighborhood" between a real street and a real city.
- **No ring name was clearly wrong.** Spot checks: Seattle neighbourhoods came from the City Clerk atlas (Lower Queen Anne, Ballard, Genesee, Dunlap, Central Business District); Genesee for 4727 California Ave SW is what the Clerk's atlas says for the Alaska Junction area, even though locals would say "the Junction".

## Top issues (ranked)

1. **Medium — A named natural place can geocode to an office named after it (#25).** "Paradise, Mount Rainier National Park, WA" produced a confident, "precise" story about 450 Roosevelt Ave E, Enumclaw. Suggested fix: in `src/lib/geocode.ts`, when the query has no house number and a result is a POI (`class` = amenity/office/shop/tourism) whose display name does not contain the first comma-separated token of the query ("Paradise"), rank results of class `place`/`natural`/`boundary` first, or fall back to Photon; and never mark a POI "precise" when the typed query had no street number. A unit test with the saved Nominatim answer for this query would pin it.
2. **Medium — Wikipedia 429 is not retried (#21).** One in 30 stories lost its city excerpt and population history to a rate-limit response, even with the 1 req/s limiter. Suggested fix: in `src/lib/http.ts` (or the Wikimedia queue) treat 429 as retryable once after `Retry-After` (or 2 s), and send the `Api-User-Agent` header Wikimedia asks for so the requests are not grouped with anonymous traffic. Keep the honest status note as the second line of defence.
3. **Low/accessibility — Cards drop `aria-busy` after their first fact, not their last (#2, #11, #16, #22, #27, #30).** `addRingFacts` → `setRingFacts` sets the status to thin/rich as soon as any loader lands, so a card stops shimmering (and stops being busy for assistive tech) while another loader for the same ring is still pending; the status line still says "Gathering the story…". Suggested fix: keep `aria-busy="true"` on a card while `session.pending.get(level) > 0` (render facts and a small spinner together), or only set thin/rich in `settleRing`. Screenshot: `screens/problem-3-ballard-card-not-busy-while-gathering-phone.jpg`.
4. **Low — When the house number is unknown, say so (#18, #20, #22, #23).** The postcard hint "a general area, not one building" is good, but the hero sentence names the street as if that were what was asked. Suggested fix: when the geocoder result has no `house_number` but the query did, add one sentence under the hero ("No. 2 wasn't on the map, so this is the street.") or a note in the house ring.
5. **Low/cosmetic — "on ice" and "This neighborhood" wording (#26 and most non-Seattle rows).** Map DNR unit names that are bare materials ("ice", "water") to a phrase ("under glacier ice") in `heroSentence`, and give the unnamed neighborhood ring a neutral heading such as "Neighborhood" with the note "No named neighbourhood here in OpenStreetMap", so the headings outline reads cleanly.
6. **Info — Nothing to fix from Passes 1 and 2.** WebKit passed the full suite twice (offline and live) and drew the map with WebGL; axe found zero violations on four scans. The only manual follow-up is the contrast of MapLibre's default attribution text over busy tiles, which axe cannot measure.
