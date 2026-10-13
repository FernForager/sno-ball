# Live check 3: the time dial

Branch `claude/ultra-code-wmnysa` at e532b77, built with `npm run build`, served with `npm run preview` on 127.0.0.1:4173, driven by Playwright Chromium (Pixel 7 emulation and a 1280x900 desktop window). All services were real except where noted. Date: 2026-10-13.

## Test counts

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 598 passed |
| `npm run test:e2e` (offline) | first run: 15 passed, 2 skipped, 1 failed: `[desktop] story.spec.ts:282 the time dial re-tells the story at every stop without asking the services again`. Re-run of that test alone: 2 passed (desktop and phone). The failing run's error text was overwritten by the re-run before I copied it, so it is not quoted here. Treat the test as flaky under load (two workers, software WebGL). |
| `LIVE=1 npm run test:e2e` | 18 passed, 0 failed |

## What the dial did at each stop (Seattle, 400 Broad St)

Readouts, map mode, map note, and what reached the network in the 6 seconds after each stop. Same on phone and desktop unless noted.

| Stop | Readout | Map mode | Note under the postcard | USGS exportImage | OHM tiles | Rings with events |
|---|---|---|---|---|---|---|
| 1980 | May 18, 1980 · Mount St. Helens erupts | historical | USGS Seattle South sheet (1:25,000), surveyed 1983, printed 1983 | 4 x 200 image/jpeg | TileJSON + 4 tiles, 200, 325 KB total | city (Kingdome), county (Microsoft), region (modern volcanoes), state (St. Helens); house and block say "No record for this date"; neighborhood and plate "Nothing recorded for 1980" |
| 1936 | 1936 · The 1936 aerial survey; streetcars at their peak | historical | USGS Seattle South sheet (1:24,000), surveyed 1949, printed 1969 | 4 x 200 image/jpeg | 0 new (cached from 1980) | city (Boeing 1916), county (Coast Salish nations), region, state (subduction "Today" entry) |
| 1909 | 1909 · AYP Exposition, regrades, the 1909 map | historical | USGS Seattle Special sheet (1:62,500), surveyed 1909, printed 1909 | 4 x 200 image/jpeg | 0 new | city (AYP), county, region, state (executive-order reservations) |
| 1897 | July 17, 1897 · Klondike gold; the 1897 map | historical | USGS Seattle sheet (1:62,500), surveyed 1894, printed 1903 | 4 x 200 image/jpeg | 0 new | city (Klondike), county (Renton platted), region, state |
| 1890 (jump) | 1890 | historical | same 1894 sheet | 0 new (same tiles) | 0 new | city: "Nothing recorded for 1890" with ◀ 1889 Great Seattle Fire / 1893 Great Northern ▶; county (Kent incorporates) |
| 1889 | 1889 · Statehood and the great fires | historical | same 1894 sheet | 0 new | 0 new | city (Great Seattle Fire), county, region, state (42nd state) |
| 1855 | 1855 · The treaties, then war | historical | "No historical map here for 1855: today's streets shown faded." | 0 | phone: 4 tiles 72 KB; desktop 0 | neighborhood is **Not yet** ("will become part of the city in 1869, 14 years from now", Jump to 1869); city "Nothing recorded for 1855" with 1853 / 1856 arrows; state (treaties) |
| 1700 | January 26, 1700 · The great Cascadia earthquake | nature | "Coastlines are today's; sea level was lower." | 0 | 0 | **Not yet** on neighborhood, city (1851), county (1852), state (1889); county still lists Coast Salish nations, state lists the 1700 quake under the Not-yet line |
| 15,000 BCE (jump "15000 BCE") | 17,000 years ago · Ice age peak: a mile of ice, the Missoula floods | nature | same | 0 | 0 | Not yet on neighborhood/city/county/state; region: Glacial Lakes Russell and Bretz; state: ice-age giants. Rock card says "The rock under this spot is forming right now." |
| 66 Ma (jump "66 Ma") | 66 million years ago | globe | same note (see copy issues) | 0 | 0 | none; "nothing recorded on the rings. Use ◀ ▶ on a card". Region offers ◀ 100 Ma / 56 Ma ▶. Globe: "Asking the plate model where this spot was 66 million years ago…" and stays there (GPlates unreachable, below) |
| 100 Ma (jump) | 100 million years ago · Exotic terranes weld on | globe | same | 0 | 0 | region (North Cascades terranes) |
| 1.47 Ga (jump) | 1.47 billion years ago · Washington's oldest rocks | globe | "No model position for 1,470 Ma / No plate model reaches back 1,470 million years ago; the globe shows where the spot is today." | 0 | 0 | none. **No GPlates request with time=1470 was made** (checked every logged URL). |
| +50 Ma (▶ from Today) | 50 million years from now | future | globe caption "Your spot, 50 Ma from now. Where this spot may drift to, 50 million years from now. A sketch, not a model." | 0 | 0 | 13 events: every ring shows its latest past event (city: Link light rail 2009), state shows the future projection entry |
| Now | Today | today | none | 0 | 0 | today's facts return; status line shows "Gathering the story…" again because the plate card is still "Looking this up…" (GPlates) |

Ritzville (206 W Main Ave):

| Stop | Readout | Map | Rings |
|---|---|---|---|
| 1909 | 1909 · AYP Exposition, regrades, the 1909 map | historical, "No historical map here for 1909: today's streets shown faded." 3 OHM tiles, 259 KB | city/county "Nothing recorded for 1909"; region: Plateau nations; state: reservations |
| 15,000 BCE | 17,000 years ago · Ice age peak… | nature | city Not yet (1880), county Not yet (1883), region: Okanogan Lobe dams the Columbia, Glacial Lake Columbia, Grand Coulee; state: ice-age giants. Rock card: "The rock under this spot is forming right now." above the Pleistocene outburst flood deposits (Missoula floods) description |
| 16 Ma | 16 million years ago · Lava floods bury a third of Washington | globe | region: The Blue Lake Rhino (15 Ma, basalt flow); state: subduction entry |

Share link `#/story?ll=47.62051,-122.34930&q=400+Broad+St%2C+Seattle%2C+WA&at=1889` in a fresh context: opened directly on "1889 · Statehood and the great fires", historical mode, 1894 USGS sheet (4 JPEG tiles), OHM TileJSON + 12 tiles (397 KB), the same 10 events. Works.

## Specific checks

**(a) USGS.** exportImage answers 200 `image/jpeg` with no token, both from the page and from curl (`size=256,256&f=image&format=jpg` → JFIF 256x256, 10 KB). The sheet caption names the sheet, scale, survey year and print year, and credits "Historical Topographic Map Collection courtesy of the U.S. Geological Survey, Esri". The chooser picks within the 25-year window: 1980 → 1983 sheet, 1936 → 1949 sheet (printed 1969), 1909 → 1909 Seattle Special, 1897/1890/1889 → 1894 Seattle sheet.

**(b) OpenHistoricalMap.** TileJSON `https://vtiles.openhistoricalmap.org/maps/ohm.json` (minzoom 0, maxzoom 20) lists 27 vector layers, and the four the code uses are all there with the fields the filters expect: `water_areas` (type, class), `water_lines` (type, class), `buildings` (class, type, building_use…), `transport_lines` (type, class, railway, highway, service, construction…). The TileJSON lists fields, not values, so I cannot confirm from it that `type` holds `primary`, `residential`, `rail` etc. Tiles load (200, ~65-80 KB each). **Nothing recognisably OHM is visible in the Seattle crops at 1890 or 1936**: at 1980 one thin orange line crosses the crop, otherwise the sheet raster and today's faded streets are all that show. Ritzville at 1909 shows only today's faded streets. The MapLibre filter warnings in the console all come from the OpenFreeMap base style (`boundary_3`, `highway-shield-*`, `road_shield_us`: "Expected value to be of type number, but found null"), none from the `sno-ohm-*` layers.

**(c) GPlates.** Could not be verified from this container: every request to gws.gplates.org failed (98 of 98 across both runs; the page logs "TimeoutError: Timed out after 15000 ms", CORS errors after the tunnel reset, and "Failed to fetch"). curl to the same URLs also times out or gets "Connection reset by peer" through the sandbox proxy, so this may be the proxy rather than the service. The page degrades as designed: the globe shows today's position with a hollow dot and "Asking the plate model…", the plate ring stays "Looking this up…". 1.47 Ga correctly makes no request and shows the "No plate model reaches back" caption. One oddity: in the second desktop pass the Ritzville 16 Ma globe showed a filled dot and "Your spot was here, 16 million years ago (MERDITH2021)" although no logged GPlates response was 200; worth checking whether that comes from a cache or a sketch path.

**(d) Performance, holding ◀ for 3 s from 1900.** No request storm: zero requests during the hold on desktop, one GPlates retry on phone (unrelated, it was already in flight). The dial travelled from 1900 to "the 900s" (through the years, decades and centuries gears) and the final state was consistent: readout, status "As of the 900s: 6 events", hero, Not-yet rings and map mode all matched. Frames over 50 ms: 6 of 475 on desktop (worst 150 ms), 25 of 418 on phone (worst 183 ms), under software WebGL, so real devices will be smoother. Readable jank, no freeze.

**(e) Phone overlap.** At scroll 0 the fixed dial (bottom 97 px) covers the lower part of the postcard: only the caption and the top ~100 px of the map show above it, and the map credit sits below the fold, not under the dial. At the bottom of the page the sources footer and the map credit are both fully above the dial (body has 112 px bottom padding). Nothing is hidden on desktop either. See `seattle-viewport-top-phone.png` and `seattle-viewport-bottom-phone.png`.

**(f) Ice and floods.** At 15,000 BCE the Space Needle page carries "about 3,000 feet of ice" ("3,000 feet (900 m) thick, five times the height of the Space Needle…") and Ritzville carries the Missoula-flood line ("Between about 18,000 and 15,000 years ago an ice dam in Idaho failed again and again…"), but both live in the Deep time section at the bottom and are shown at every stop, not surfaced on a ring at that stop. At 16 Ma Ritzville's basalt line is the Blue Lake Rhino event on the region ring, not a Columbia River Basalt event of its own.

## Top issues (ranked)

1. **Historical sheets are unreadable at the postcard's zoom.** The map stays at street zoom (~z17) in historical mode, so a 1:62,500 sheet from 1894 is a blur of JPEG blocks and the 1:24,000 sheet shows a single letter of "Needle" (`seattle-1897-postcard-desktop.png`, `seattle-1936-postcard-desktop.png`). Fix: when entering historical mode, ease to a zoom that suits the sheet scale (about z13-14 for 1:62,500 and 1:125,000, z15 for 1:24,000/1:25,000), and ease back on "Today's map".
2. **The Chapters panel stays open after you pick a chapter and covers the map.** On both viewports the expanded panel sits over the postcard, so the map you just changed is hidden until you close the chevron (every `seattle-<stop>-<kind>.png` full-page shot shows this). Fix: collapse the panel after a chapter click or a successful Jump, and keep it open only for ▶ ◀.
3. **GPlates failures leave the page waiting forever.** The globe says "Asking the plate model…" and the plate ring "Looking this up…" with no end state, and the status line falls back to "Gathering the story…" on Now. Fix: after the retries fail, settle on "The plate model did not answer; the globe shows today's position" and let the plate ring say the same. (Reachability here was blocked by the sandbox proxy, so verify on a normal network, but the UI should still settle.)
4. **A raw number leaks into the +50 Ma copy.** The state ring shows "Fifty million years from now (a qualitative projection) 50002000 best guess": the event's year (50,002,000) is printed as a date. Fix: format future dates through `time.ts` ("50 million years from now") or hide the date for the future entry. `seattle-plus50Ma-desktop.png`.
5. **"Coastlines are today's; sea level was lower." is shown at globe stops.** At 66 Ma, 100 Ma, 1.47 Ga and 16 Ma the note under the caption still reads the nature-mode text while the globe is up. Fix: clear the note (or say "The map is replaced by the globe at this scale") when `data-map-mode` is globe.
6. **The 1936 chapter shows a 1949 sheet.** The readout promises "the 1936 aerial survey" but the nearest USGS sheet is surveyed 1949 (printed 1969). Either say "nearest sheet: 1949" in the chapter teaser or add the 1936 aerial imagery source the chapter is named after.
7. **The future stop lists past events as if they were news.** "As of 50 million years from now: 13 events on the rings" and the city ring leads with "Link light rail opens 2009". Fix: at the future stop show only the projection entries and say "nothing is recorded yet" for the others.
8. **The Jump field does not understand "+50 Ma" or "50 Ma from now".** It silently keeps the current stop (no error text appeared). Fix: accept "from now"/"+" and show the error line when parsing fails.
9. **The sheet caption and the dial squeeze the phone map.** On the Pixel 7 the three-line USGS caption takes the top half of the postcard and the fixed dial covers its bottom, leaving about 230 px of blurred map between them (`seattle-1897-postcard-phone.png`). Fix: one-line caption ('USGS Seattle 1894 sheet') with the source behind a details toggle.
10. **Attribution covers a third of the postcard in historical mode.** With OHM, USGS and OpenFreeMap credits the attribution box wraps to two or three lines over the map on desktop (`seattle-1980-postcard-desktop.png`). Fix: use MapLibre's compact attribution or move the long credits to the sheet caption.
11. **OHM features are not visibly rendering in Seattle.** Tiles load but no sepia roads or buildings are recognisable at 1890/1936; either coverage is thin here or the `type` filters do not match the data. Fix: temporarily log `map.queryRenderedFeatures({layers:['sno-ohm-roads-major', …]})` at 1890 in Seattle and Spokane, and compare the `type` values in a tile with the filter lists.
12. **Minor copy.** "Not yet. Lower Queen Anne will become part of the city in 1869" reads as if the neighbourhood were annexed; "Seattle will be founded in 1851, 151 years from now" is fine. "The rock under this spot is forming right now." at 15,000 BCE is good but sits above a description that dates the till at 16,000 years, one stop later. "Nothing recorded for 1980" on the plate ring at every stop between Today and deep time is noise; consider hiding the plate ring until a geological stop.

## What works

- The dial itself: ◀ ▶ step through the 27 chapters, the readout, teaser ("Year by year", "Century by century", "A thousand years at a time", "Millions of years ago", "Deep time"), status line, hero prefix ("As of 1889:"), URL `&at=` and the postcard mode all stay in step at every stop, on phone and desktop.
- Jump understands "1890", "15000 BCE", "66 Ma", "100 Ma", "1.47 Ga" and lands on the right stop.
- Not-yet cards appear at the right stops with the right founding years and a working "Jump to <year>" button; county and state keep listing their older events under the Not-yet line.
- The "Nothing recorded for 1890" cards offer the nearest earlier and later events.
- USGS sheets load without a token, the caption names the sheet and the "Today's map"/"Map as it was" swap works.
- OHM TileJSON and tiles load; the maplibre-gl-dates filter produces no console warnings.
- No requests to the story services (Nominatim, Wikidata, DNR, ArcGIS feature services) when moving the dial; only map tiles and GPlates.
- Share links with `&at=1889` open straight on that stop.
- No page errors anywhere; the only console errors are the GPlates network failures.

## Files

`seattle-<stop>-<phone|desktop>.png` full pages (panel open), `seattle-<stop>-postcard-desktop.png` map crops with the panel closed, `seattle-<stop>-viewport-desktop.png` first screen with the panel closed, `seattle-viewport-{top,bottom}-*.png` for the overlap check, `seattle-hold-*.png` after the 3-second hold, `seattle-share-1889-*.png`, `ritzville-*.png`.
