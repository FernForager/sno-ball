import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The whole story pipeline in a real browser, with every outside service
 * answered from the fixture files captured on 2026-10-07. Nothing here
 * reaches the network: the geocoder, Wikipedia, the geology server, the
 * plate model and Seattle's open data are all stubbed; the map gets the
 * captured positron style and a stand-in TileJSON (which carries the
 * credit line) while the tiles themselves are blocked. So this runs in CI
 * like the smoke test and still proves that main.ts wires the modules
 * together correctly. The site's own files (public/data/*.json, the
 * pre-baked excerpts among them) are served by the preview server as is.
 */

const fixture = (path: string): string => readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8');

const json = (path: string) => ({ status: 200, contentType: 'application/json', body: fixture(path) });

/**
 * Stub every outside host. Returns the log of outside requests, in order.
 * With `geologyDown`, the two geology services answer HTTP 500, to check
 * that the rock card settles honestly instead of shimmering forever. With
 * `gplatesDown`, the plate model answers HTTP 500 to every request. With
 * `cityFoundedIn`, the site's own place file is served with Seattle's
 * founding moved to that year, so the dial's "not yet" state can be seen
 * at a stop the real city already existed at. With `ohmDelayMs`, the
 * OpenHistoricalMap TileJSON takes that long to answer, which keeps the
 * map "not fully loaded" in MapLibre's eyes for as long: the window in
 * which a dial move must still be drawn.
 */
async function stubServices(
  page: Page,
  opts: { geologyDown?: boolean; gplatesDown?: boolean; cityFoundedIn?: number; ohmDelayMs?: number } = {},
): Promise<{ url: string; at: number }[]> {
  const log: { url: string; at: number }[] = [];
  if (opts.cityFoundedIn !== undefined) {
    const year = opts.cityFoundedIn;
    await page.route('**/sno-ball/data/wa-places.json', async (route) => {
      const places = JSON.parse(readFileSync(new URL('../../public/data/wa-places.json', import.meta.url), 'utf8')) as { name: string; inception?: string }[];
      for (const p of places) if (p.name === 'Seattle') p.inception = `${year}-01-01`;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(places) });
    });
  }
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = route.request().url();
    log.push({ url, at: Date.now() });
    const { hostname, pathname: rawPath } = new URL(url);
    // Article titles arrive percent-encoded ("King_County%2C_Washington").
    const pathname = decodeURIComponent(rawPath);

    if (hostname === 'nominatim.openstreetmap.org' && pathname === '/search') return route.fulfill(json('geocode/nominatim-space-needle.json'));
    if (opts.geologyDown && (hostname === 'gis.dnr.wa.gov' || hostname === 'macrostrat.org')) {
      return route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
    }
    if (hostname === 'gis.dnr.wa.gov' && pathname.endsWith('/11/query')) return route.fulfill(json('geology/dnr-unit-space-needle.json'));
    if (hostname === 'gis.dnr.wa.gov' && pathname.endsWith('/13/query')) return route.fulfill(json('geology/dnr-dmu-space-needle.json'));
    if (hostname === 'gws.gplates.org') {
      if (opts.gplatesDown) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
      return route.fulfill(json('geology/gplates-space-needle-times.json'));
    }
    if (hostname === 'query.wikidata.org') return route.fulfill(json('places/wikidata-seattle-population.json'));
    if (hostname === 'en.wikipedia.org') {
      // The state, county and city excerpts are pre-baked in
      // public/data/wiki-summaries.json, so these three answer only if the
      // page asks anyway (the test below checks that it does not).
      if (pathname.endsWith('/Washington_(state)')) return route.fulfill(json('places/wikipedia-summary-washington.json'));
      if (pathname.endsWith('/King_County,_Washington')) return route.fulfill(json('places/wikipedia-summary-king-county.json'));
      if (pathname.endsWith('/Seattle')) return route.fulfill(json('places/wikipedia-summary-seattle.json'));
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"type":"not_found"}' });
    }
    if (hostname === 'tiles.openfreemap.org') {
      // The real style (captured) and a synthetic TileJSON that carries the
      // same credit line the live one does; tiles, sprites and fonts are blocked.
      if (pathname === '/styles/positron') return route.fulfill(json('live/openfreemap-positron-style.json'));
      if (pathname === '/planet') return route.fulfill(json('map/openfreemap-planet-tilejson.json'));
      return route.abort();
    }
    // The dial's map layers: the USGS sheet catalog (captured) and a
    // stand-in OpenHistoricalMap TileJSON; the sheet images and the vector
    // tiles themselves are blocked like every other tile.
    if (hostname === 'historical1.arcgis.com' && pathname.endsWith('/query')) return route.fulfill(json('map/usgs-topo-catalog.json'));
    if (hostname === 'vtiles.openhistoricalmap.org' && pathname === '/maps/ohm.json') {
      if (opts.ohmDelayMs) await new Promise((resolve) => setTimeout(resolve, opts.ohmDelayMs));
      return route.fulfill(json('map/ohm-tilejson.json'));
    }
    if (hostname === 'services.arcgis.com') {
      if (pathname.includes('/nma_nhoods_sub/')) return route.fulfill(json('rings/seattle-nhood-space-needle.json'));
      if (pathname.includes('/Annexation/')) return route.fulfill(json('rings/seattle-annexation-space-needle.json'));
      if (pathname.includes('/PARCEL_GEO/')) return route.fulfill(json('rings/seattle-parcel-space-needle.json'));
      if (pathname.includes('/Landmarks/')) return route.fulfill(json('rings/seattle-landmarks-near-space-needle.json'));
    }
    // Map tiles, fonts and anything unexpected: blocked, never fetched.
    return route.abort();
  });
  return log;
}

test('a search fills every ring from the stubbed services', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Every response the page's own origin served, to check the tile worker.
  const served: { url: string; contentType: string }[] = [];
  page.on('response', (res) => served.push({ url: res.url(), contentType: res.headers()['content-type'] ?? '' }));
  const log = await stubServices(page);

  await page.goto('/sno-ball/');
  await page.getByRole('search').locator('.chip', { hasText: 'Space Needle' }).click();

  // The URL becomes a share link as soon as the geocoder answers.
  await expect(page).toHaveURL(/#\/story\?ll=47\.62051,-122\.34928&q=400\+Broad\+St/);

  // The hero names the place, then gains the rock once geology answers.
  const hero = page.locator('.hero');
  await expect(hero).toContainText('Seattle, King County');
  await expect(hero).toContainText('glacial till');

  // Rings: county (file + Wikipedia), city (Wikipedia + population), state.
  const county = page.locator('#ring-county');
  await expect(county).toContainText('Established December 22, 1852');
  await expect(county.locator('blockquote')).toContainText('King County');
  const city = page.locator('#ring-city');
  await expect(city.locator('blockquote')).toContainText('Seattle');
  await expect(city).toContainText('Population');
  await expect(page.locator('#ring-state')).toContainText('Statehood November 11, 1889');
  await expect(page.locator('#ring-region')).toContainText('Puget Sound');

  // Seattle extras: the atlas renames the neighborhood, the parcel and landmarks land.
  await expect(page.locator('#ring-neighborhood h2')).toHaveText('Lower Queen Anne');
  await expect(page.locator('#ring-neighborhood')).toContainText('Became part of Seattle in 1869');
  await expect(page.locator('#ring-house')).toContainText('Built in 1961');
  await expect(page.locator('#ring-block')).toContainText('Space Needle');

  // Deep time: the rock, the ice age and the drifting positions.
  await expect(page.locator('.deep-card--rock')).toContainText('Pleistocene');
  await expect(page.locator('.deep-card--ice')).toBeVisible();
  await expect(page.locator('.paleo__item')).toHaveCount(5);
  await expect(page.locator('#ring-plate')).toContainText('million years ago');

  // The street has no source yet, so it settles with a compact note, not a skeleton.
  await expect(page.locator('#ring-street')).toContainText('Nothing on record');
  await expect(page.locator('#ring-street')).toHaveClass(/ring-card--compact/);
  await expect(page.locator('.ring-card.is-loading')).toHaveCount(0, { timeout: 15_000 });

  // The plate ring carries one summary, not the whole list again.
  await expect(page.locator('#ring-plate .fact')).toHaveCount(1);

  // A dated fact whose title already says the year shows no duplicate badge.
  const built = page.locator('#ring-house .fact', { hasText: 'Built in 1961' });
  await expect(built.locator('.badge')).toHaveCount(0);

  // Every Wikipedia excerpt links to its article; the sources footer lists
  // Wikipedia, and its CC BY-SA licence is a link to the licence text.
  await expect(page.locator('.sources').getByRole('link', { name: 'Wikipedia' }).first()).toBeVisible();
  await expect(page.locator('.sources a[href="https://creativecommons.org/licenses/by-sa/4.0/"]').first()).toBeVisible();

  // The caption is a short label at the top of the postcard, not the geocoder's long comma list.
  await expect(page.locator('.postcard__name')).toHaveText('400 Broad Street, Seattle');

  // Screen readers are told the story is ready, and by then no card is
  // still marked busy or says it is gathering: a card drops aria-busy only
  // when its LAST source has answered, not its first.
  await expect(page.locator('.story__status')).toContainText('Story ready', { timeout: 15_000 });
  await expect(page.locator('.ring-card[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('.ring-card__gathering')).toHaveCount(0);
  await expect(page.locator('.ring-card.is-busy')).toHaveCount(0);

  // The postcard has a real map area (MapLibre's own CSS must not collapse it).
  const mapBox = await page.locator('.postcard__map').boundingBox();
  expect(mapBox?.height ?? 0).toBeGreaterThan(100);

  // The postcard stays stuck under the top of the viewport while the story scrolls,
  // except on short screens, where it is deliberately not sticky.
  await page.evaluate(() => window.scrollTo(0, 1500));
  const viewport = page.viewportSize();
  if (viewport && viewport.height > 560) {
    const postcardTop = await page.locator('.postcard').evaluate((node) => Math.round(node.getBoundingClientRect().top));
    expect(postcardTop).toBe(8);
  }

  // When the browser could draw the map, the credit in the corner is the
  // style's own (OpenFreeMap / OpenMapTiles / OpenStreetMap), printed once
  // and not covered by the caption or the map note, and the tile worker is
  // real JavaScript. Checked in this reading position: at the very top of
  // a short window the time dial, fixed to the foot of the screen, can
  // overlap the bottom of a map that has not yet scrolled up under the
  // top edge.
  if ((await page.locator('.postcard__note').count()) === 0) {
    const attrib = page.locator('.maplibregl-ctrl-attrib');
    await expect(attrib).toBeVisible();
    const covered = await attrib.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && !node.contains(hit);
    });
    expect(covered).toBe(false);
    const inner = attrib.locator('.maplibregl-ctrl-attrib-inner');
    await expect(inner).toContainText('OpenStreetMap', { timeout: 10_000 });
    const credit = (await inner.textContent()) ?? '';
    expect(credit).toContain('OpenFreeMap');
    // Once, not twice: no " | " joining a second copy, and the old custom wording is gone.
    expect(credit).not.toContain('|');
    expect(credit).not.toContain('OpenStreetMap contributors');
    expect(credit.match(/OpenMapTiles/g)?.length ?? 0).toBe(1);
    if (viewport && viewport.width >= 640) {
      // Desktop: the credit is written out, kept open, readable without a click.
      await expect(inner).toBeVisible();
      await expect(attrib).not.toHaveClass(/maplibregl-compact/);
    } else {
      // Phone: MapLibre folds it into the (i) button (open at first, closed on the first drag).
      await expect(attrib).toHaveClass(/maplibregl-compact/);
      await expect(attrib.locator('.maplibregl-ctrl-attrib-button')).toBeVisible();
    }
    // The tile worker is a real file of the build, served as JavaScript (not index.html).
    await expect.poll(() => served.find((r) => r.url.includes('maplibre-gl-worker'))?.contentType ?? '', { timeout: 10_000 }).toContain('javascript');
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  // The state, county and city excerpts came from the pre-baked file, so
  // Wikipedia was at most asked for the neighborhood (the four-entry
  // placeholder lacks it; the full bake has it and asks for nothing); the
  // city's population came from Wikidata by the id in wa-places.json.
  const wikipedia = log.filter((r) => r.url.includes('en.wikipedia.org')).map((r) => decodeURIComponent(new URL(r.url).pathname));
  for (const path of wikipedia) expect(path).toBe('/api/rest_v1/page/summary/Lower_Queen_Anne,_Seattle');
  expect(wikipedia.length).toBeLessThanOrEqual(1);
  expect(served.some((r) => r.url.endsWith('/sno-ball/data/wiki-summaries.json'))).toBe(true);
  expect(served.some((r) => r.url.endsWith('/sno-ball/data/wa-places.json'))).toBe(true);
  // Wikimedia requests go one at a time, at least a second apart (the
  // limiter spaces their starts by 1000 ms; the route sees each a few ms
  // later, so a little slack is allowed for timing jitter).
  const wikimedia = log.filter((r) => /wikipedia\.org|wikidata\.org/.test(r.url));
  expect(wikimedia.length).toBeGreaterThanOrEqual(1);
  expect(wikimedia.length).toBeLessThanOrEqual(2);
  for (let i = 1; i < wikimedia.length; i += 1) {
    expect(wikimedia[i]!.at - wikimedia[i - 1]!.at).toBeGreaterThanOrEqual(900);
  }
  // Population history is asked for last.
  expect(wikimedia[wikimedia.length - 1]!.url).toContain('query.wikidata.org');

  expect(errors).toEqual([]);
});

test('a share link looks the address up once and rebuilds the full story', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const log = await stubServices(page);

  await page.goto('/sno-ball/#/story?ll=47.62051,-122.34928&q=Space%20Needle');

  await expect(page.getByRole('search').getByRole('searchbox')).toHaveValue('Space Needle');
  // The rings get their real names, not placeholders: the link is the canonical URL of a story.
  await expect(page.locator('#ring-city h2')).toHaveText('Seattle');
  await expect(page.locator('#ring-county h2')).toHaveText('King County');
  await expect(page.locator('.hero')).toContainText('Seattle, King County');
  await expect(page.locator('.hero')).toContainText('glacial till');
  await expect(page.locator('.deep-card--rock')).toContainText('Pleistocene');
  await expect(page.locator('.deep-card--ice')).toBeVisible();
  await expect(page.locator('#ring-state')).toContainText('Statehood');
  await expect(page.locator('.ring-card.is-loading')).toHaveCount(0, { timeout: 15_000 });

  // Exactly the one geocoder request that typing the address would have cost.
  expect(log.filter((r) => r.url.includes('nominatim.openstreetmap.org')).length).toBe(1);
  expect(log.some((r) => r.url.includes('photon.komoot.io'))).toBe(false);
  expect(errors).toEqual([]);
});

test('the rock card settles honestly when both geology services are down', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubServices(page, { geologyDown: true });

  await page.goto('/sno-ball/');
  await page.getByRole('search').locator('.chip', { hasText: 'Space Needle' }).click();

  const rock = page.locator('.deep-card--rock');
  await expect(rock).toContainText('The geological map did not answer', { timeout: 15_000 });
  await expect(rock).not.toHaveAttribute('aria-busy', 'true');
  await expect(rock.locator('.skeleton')).toHaveCount(0);
  await expect(page.locator('.story__status')).toContainText('geology', { timeout: 15_000 });
  // The rest of the story is unaffected.
  await expect(page.locator('#ring-county')).toContainText('Established December 22, 1852');
  expect(errors).toEqual([]);
});

test('the home page has no empty postcard and offers to forget searches', async ({ page }) => {
  await page.goto('/sno-ball/');
  await expect(page.locator('.postcard')).toBeHidden();
  await expect(page.getByRole('search')).toContainText('OpenStreetMap contributors');
  await expect(page.getByRole('button', { name: 'Forget my searches' })).toBeVisible();
});

/** The hosts the dial may ask once a story is loaded: map layers and the plate model, nothing else. */
const DIAL_HOSTS = ['historical1.arcgis.com', 'vtiles.openhistoricalmap.org', 'gws.gplates.org', 'tiles.openfreemap.org'];

/**
 * Type a time into the dial's jump box and go. The panel is opened first
 * (a successful jump folds it away again) and the move is confirmed by
 * waiting for `readoutText` on the readout, with a generous timeout: under
 * load, with software WebGL, a dial move can take a few seconds to draw.
 */
async function jumpTo(page: Page, text: string, readoutText: string | RegExp): Promise<void> {
  const dial = page.locator('.dial');
  await dial.getByRole('button', { name: 'Show chapters' }).click();
  await expect(dial.locator('.dial__panel')).toBeVisible();
  await dial.getByLabel('Jump to a time').fill(text);
  await dial.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(dial.locator('.dial__readout')).toContainText(readoutText, { timeout: SLOW_MS });
  // The panel folds away after a successful jump, with focus on the chevron.
  await expect(dial.locator('.dial__panel')).toBeHidden();
}

/** The timeout for a dial move, a sheet fetch or a status line under load. */
const SLOW_MS = 15_000;

test('the time dial re-tells the story at every stop without asking the services again', async ({ page }) => {
  // Many dial moves in one story: the per-test clock needs room for them under load.
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Seattle "founded" in 1900, so the 1889 stop can show the "not yet" state.
  const log = await stubServices(page, { cityFoundedIn: 1900 });

  await page.goto('/sno-ball/');
  await page.getByRole('search').locator('.chip', { hasText: 'Space Needle' }).click();
  await expect(page.locator('.story__status')).toContainText('Story ready', { timeout: SLOW_MS });
  const outsideBefore = log.length;

  // The dial is on the page once the story is, sitting on Today.
  const dial = page.locator('.dial');
  await expect(dial).toBeVisible();
  const readout = dial.locator('.dial__readout');
  await expect(readout).toHaveText('Today');
  await expect(page.locator('body')).toHaveClass(/has-dial/);
  const hasMap = (await page.locator('.postcard__note').count()) === 0;

  // ◀ once: the 1980 chapter. The readout, the link, the hero and the state ring all follow.
  await dial.getByRole('button', { name: 'Earlier chapter' }).click();
  await expect(readout).toContainText('Mount St. Helens erupts', { timeout: SLOW_MS });
  await expect(page).toHaveURL(/&at=1980$/);
  await expect(page.locator('.hero')).toContainText('As of 1980:');
  await expect(page.locator('#ring-state')).toContainText('Mount St. Helens erupts');
  await expect(page.locator('.story__status')).toContainText('As of 1980', { timeout: SLOW_MS });
  await expect(page.locator('.postcard')).toHaveAttribute('data-map-mode', 'historical');
  // The house has no record for 1980; the card says so instead of showing today's facts.
  await expect(page.locator('#ring-house')).toContainText('No record for this date');
  await expect(page.locator('#ring-house')).not.toContainText('Built in 1961');
  // The plate ring does not claim "nothing recorded" about 1980: it points at the globe stops.
  await expect(page.locator('#ring-plate')).toContainText('The plate story starts at 1 million years ago');
  await expect(page.locator('#ring-plate').getByRole('button', { name: 'Jump to 1 million years ago' })).toBeVisible();

  // Jump to 1889: statehood on the state ring, "not yet" on the city ring
  // (founded 1900 in this test) with the fire still listed under it.
  await jumpTo(page, '1889', 'Statehood');
  await expect(page).toHaveURL(/&at=1889$/);
  await expect(page.locator('#ring-state')).toContainText('Washington becomes the 42nd state');
  const city = page.locator('#ring-city');
  await expect(city).toHaveClass(/is-not-yet/);
  await expect(city).toContainText('Not yet. Seattle will be founded in 1900, 11 years from now.');
  await expect(city).toContainText('Great Seattle Fire');
  await expect(city.getByRole('button', { name: 'Jump to 1900' })).toBeVisible();
  // The county existed in 1889, so it shows events, not a countdown.
  await expect(page.locator('#ring-county')).not.toHaveClass(/is-not-yet/);
  // The map note names the USGS sheet chosen from the catalog (1894, five
  // years off: still "the" sheet) in one line, with the scale and the
  // credit behind "About this map"; the credit control in the map corner
  // folds into its (i) button meanwhile. The OHM tiles are blocked here,
  // so once the map has drawn, the note says OHM has nothing mapped.
  // The button swaps the sheet for today's map and back.
  const note = page.locator('.postcard__era');
  const noteLine = note.locator('.postcard__era-text');
  const attrib = page.locator('.maplibregl-ctrl-attrib');
  if (hasMap) {
    await expect(noteLine).toContainText('USGS Seattle 1894 sheet', { timeout: SLOW_MS });
    await expect(noteLine).not.toContainText('Geological Survey');
    const details = note.locator('details');
    await expect(details).toBeVisible();
    await expect(details).not.toHaveAttribute('open', /.*/);
    await details.locator('summary').click();
    await expect(details.locator('.postcard__era-details-text')).toContainText('USGS Seattle sheet (1:62,500), surveyed 1894');
    await expect(details.locator('.postcard__era-details-text')).toContainText('U.S. Geological Survey');
    await expect(noteLine).toContainText('OpenHistoricalMap has nothing mapped here for 1889 yet', { timeout: SLOW_MS });
    await expect(details.locator('.postcard__era-details-text')).not.toContainText('OpenHistoricalMap');
    await expect(attrib).toHaveClass(/maplibregl-compact/, { timeout: SLOW_MS });
    await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);
    await expect(attrib.locator('.maplibregl-ctrl-attrib-button')).toBeVisible();
    await note.getByRole('button', { name: "Today's map" }).click();
    await expect(noteLine).toContainText("Today's map.", { timeout: SLOW_MS });
    await expect(note.locator('details')).toBeHidden();
    await note.getByRole('button', { name: 'Map as it was' }).click();
    await expect(noteLine).toContainText('USGS Seattle 1894 sheet', { timeout: SLOW_MS });
  }

  // 1880: still "not yet" for this test's Seattle; Renton's platting (scoped
  // to Renton and King County) belongs on the county ring, not the city's.
  await jumpTo(page, '1880', '1880');
  await expect(city).toContainText('20 years from now');
  await expect(city).not.toContainText('Renton');
  await expect(page.locator('#ring-county')).toContainText('Renton platted');
  // The card's own jump link turns the dial.
  await city.getByRole('button', { name: 'Jump to 1900' }).click();
  await expect(readout).toHaveText('1900', { timeout: SLOW_MS });
  await expect(city).not.toHaveClass(/is-not-yet/);

  // Picking a chapter from the list folds the sheet away and moves focus to
  // the chevron. The 1936 chapter has no sheet of its own year: the nearest
  // (1949) is named honestly.
  await dial.getByRole('button', { name: 'Show chapters' }).click();
  await dial.locator('.dial__chapter', { hasText: '1936' }).click();
  await expect(readout).toContainText('Streetcars at their peak', { timeout: SLOW_MS });
  await expect(dial.locator('.dial__panel')).toBeHidden();
  await expect(dial.getByRole('button', { name: 'Show chapters' })).toBeFocused();
  if (hasMap) {
    await expect(noteLine).toContainText('Nearest USGS sheet: Seattle South, surveyed 1949', { timeout: SLOW_MS });
  }

  // 15,000 BCE: the ice-age chapter lights the ice card, the map keeps only water and land.
  await jumpTo(page, '15,000 BCE', 'Ice age peak');
  await expect(page.locator('.deep-card--ice')).toBeVisible();
  await expect(page.locator('.deep-card--ice')).toHaveClass(/is-now/);
  // (The "forming right now" line is always in the card, shown or hidden, so visibility is what counts.)
  await expect(page.locator('.deep-card--rock .deep-card__now')).toBeVisible();
  await expect(page.locator('.deep-card--rock')).toHaveClass(/is-now/);
  await expect(page.locator('.postcard')).toHaveAttribute('data-map-mode', 'nature');
  await expect(note).toContainText("Coastlines are today's", { timeout: SLOW_MS });
  await expect(page.locator('#ring-region')).toContainText('Vashon ice sheet');
  await expect(page.locator('#ring-region')).toContainText('of ice');

  // 1 million years ago: the ice had long gone, so the till is not "forming right now".
  await jumpTo(page, '1 Ma', '1 million years ago');
  await expect(page.locator('.deep-card--rock .deep-card__now')).toBeHidden();
  await expect(page.locator('.deep-card--rock')).not.toHaveClass(/is-now/);

  // 66 Ma: the globe stands in for the map, and the map note says so.
  await jumpTo(page, '66 Ma', '66 million years ago');
  await expect(page.locator('.postcard')).toHaveAttribute('data-map-mode', 'globe');
  await expect(page.locator('.postcard__globe .globe')).toBeVisible();
  await expect(page.locator('.postcard__map')).toBeHidden();
  // 66 Ma is not in the (stubbed) model answer: the caption says so and the drawing names the stop.
  await expect(page.locator('.globe-caption')).toContainText("The plate model did not answer; the globe shows today's position.", { timeout: SLOW_MS });
  await expect(page.locator('.postcard__globe')).toContainText('66 Ma');
  await expect(page.locator('#ring-city')).toContainText('No people yet here');
  await expect(page).toHaveURL(/&at=66Ma$/);
  if (hasMap) {
    await expect(note).toContainText('the map gives way to the globe', { timeout: SLOW_MS });
    await expect(note).not.toContainText("Coastlines are today's");
  }

  // 100 Ma is in the plate model's (stubbed) answer: the dot and the plate ring get it.
  await jumpTo(page, '100 Ma', '100 million years ago');
  await expect(page.locator('.globe-caption')).toContainText('Your spot was here, 100 million years ago', { timeout: SLOW_MS });
  await expect(page.locator('#ring-plate')).toContainText('Where this spot sat 100 million years ago');

  // A time the dial cannot read keeps the panel open with an error line;
  // the future is reachable in words.
  await dial.getByRole('button', { name: 'Show chapters' }).click();
  await dial.getByLabel('Jump to a time').fill('yesterday');
  await dial.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(dial.locator('.dial__error')).toBeVisible();
  await expect(dial.locator('.dial__error')).toHaveText("I don't understand that time");
  await expect(dial.locator('.dial__panel')).toBeVisible();
  await dial.getByLabel('Jump to a time').fill('50 Ma from now');
  await dial.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(readout).toContainText('50 million years from now', { timeout: SLOW_MS });
  await expect(dial.locator('.dial__error')).toBeHidden();
  await expect(page.locator('.postcard')).toHaveAttribute('data-map-mode', 'future');
  await expect(page).toHaveURL(/&at=%2B50Ma$/);
  await jumpTo(page, '+50 Ma', '50 million years from now');

  // Now: the map is back, the rings are today's, the link has no stop.
  await dial.getByRole('button', { name: 'Back to now' }).click();
  await expect(readout).toHaveText('Today', { timeout: SLOW_MS });
  await expect(page.locator('.postcard')).toHaveAttribute('data-map-mode', 'today');
  await expect(page.locator('.postcard__globe')).toBeHidden();
  await expect(page.locator('.postcard__map')).toBeVisible();
  await expect(page).toHaveURL(/#\/story\?ll=47\.62051,-122\.34928&q=400\+Broad\+St%2C\+Seattle%2C\+WA$/);
  await expect(page.locator('#ring-house')).toContainText('Built in 1961');
  await expect(page.locator('#ring-plate .fact')).toHaveCount(1);
  await expect(page.locator('.hero')).not.toContainText('As of');
  // Back at Now the credit control is the viewport's usual one again.
  if (hasMap && (page.viewportSize()?.width ?? 0) >= 640) {
    await expect(attrib).not.toHaveClass(/maplibregl-compact/, { timeout: SLOW_MS });
  }

  // Nothing but map layers and the plate model was asked for while turning the dial.
  const asked = log.slice(outsideBefore).map((r) => new URL(r.url).hostname);
  expect(asked.filter((h) => !DIAL_HOSTS.includes(h))).toEqual([]);
  expect(errors).toEqual([]);
});

test('the map follows the dial while tiles are still loading, and the dial speaks once it rests', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The OHM TileJSON takes fifteen seconds (nothing else waits on it), so
  // from the first historical stop the map counts as "still loading" in
  // MapLibre's eyes for the rest of the test.
  const log = await stubServices(page, { ohmDelayMs: 15_000 });

  await page.goto('/sno-ball/');
  await page.getByRole('search').locator('.chip', { hasText: 'Space Needle' }).click();
  await expect(page.locator('.story__status')).toContainText('Story ready', { timeout: 15_000 });

  const dial = page.locator('.dial');
  const readout = dial.locator('.dial__readout');
  const announcer = dial.locator('.dial__announcer');
  const note = page.locator('.postcard__era');
  // The visible readout is not a live region; the hidden announcer is, and
  // it says nothing at mount.
  await expect(readout).not.toHaveAttribute('aria-live', /.*/);
  await expect(announcer).toHaveAttribute('aria-live', 'polite');
  await expect(announcer).toHaveText('');

  // Four quick steps back: the announcer and the status line report only
  // where the dial came to rest, not every stop on the way.
  const earlier = dial.getByRole('button', { name: 'Earlier chapter' });
  await earlier.focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
  await expect(readout).toContainText('Lake Washington drops nine feet');
  await expect(announcer).toHaveText(/Lake Washington drops nine feet/);
  await expect(page.locator('.story__status')).toContainText('As of 1916');
  expect(await page.locator('.story__status').textContent()).not.toContain('1980');

  if ((await page.locator('.postcard__note').count()) === 0) {
    await expect(page.locator('.postcard')).toHaveAttribute('data-map-mode', 'historical');
    // Only the stop the dial rested on had its USGS sheet fetched: at most
    // one sheet's tiles (plus one for a zoom change) were asked for.
    await expect(note).toContainText('USGS', { timeout: 10_000 });
    const sheetIds = new Set(
      log
        .map((r) => /lockRasterIds%22%3A%5B(\d+)%5D/.exec(r.url)?.[1] ?? /lockRasterIds":\[(\d+)\]/.exec(decodeURIComponent(r.url))?.[1])
        .filter((id): id is string => id !== undefined),
    );
    expect(sheetIds.size).toBeLessThanOrEqual(2);

    // Straight back to Now while the OHM TileJSON is still on its way: the
    // map must be today's again (the note gone), not stuck in 1916.
    await dial.getByRole('button', { name: 'Back to now' }).click();
    await expect(readout).toHaveText('Today');
    await expect(page.locator('.postcard')).toHaveAttribute('data-map-mode', 'today');
    await expect(note).toBeHidden();
    await expect(announcer).toHaveText('Today');
  }
  expect(errors).toEqual([]);
});

test('the globe, the plate ring and the status line settle when the plate model is down', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubServices(page, { gplatesDown: true });

  // Straight to a globe stop, so the stop's own lookup and the story's
  // six-stop lookup both fail (one request a second, so this takes a while).
  await page.goto('/sno-ball/#/story?ll=47.62051,-122.34928&q=Space%20Needle&at=100Ma');
  await expect(page.locator('.dial__readout')).toContainText('100 million years ago');
  await expect(page.locator('.postcard')).toHaveAttribute('data-map-mode', 'globe');
  const caption = page.locator('.globe-caption');
  await expect(caption).toContainText("The plate model did not answer; the globe shows today's position.", { timeout: 25_000 });
  await expect(caption).not.toContainText('Asking the plate model');
  // The plate ring at the stop is settled too, not "looking this up".
  const plate = page.locator('#ring-plate');
  await expect(plate).toContainText('Nothing recorded for 100 million years ago');
  await expect(plate.locator('.skeleton')).toHaveCount(0);

  // Back at Now: the story is ready, naming the plate model as the source
  // that did not answer; the plate ring and the deep-time card say so too.
  await page.locator('.dial').getByRole('button', { name: 'Back to now' }).click();
  await expect(page.locator('.dial__readout')).toHaveText('Today');
  const status = page.locator('.story__status');
  await expect(status).toContainText('Story ready', { timeout: 25_000 });
  await expect(status).toContainText('plate model');
  await expect(status).not.toContainText('Gathering');
  await expect(plate).toContainText('The plate model did not answer');
  await expect(plate).not.toHaveAttribute('aria-busy', 'true');
  await expect(plate.locator('.skeleton')).toHaveCount(0);
  await expect(page.locator('.deep-card--paleo')).toContainText("We couldn't trace where this spot was");
  await expect(page.locator('.deep-card--paleo .skeleton')).toHaveCount(0);
  // The rest of the story is unaffected.
  await expect(page.locator('#ring-county')).toContainText('Established December 22, 1852');
  expect(errors).toEqual([]);
});

test('a share link with at=1889 opens the story on that stop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubServices(page);

  await page.goto('/sno-ball/#/story?ll=47.62051,-122.34928&q=Space%20Needle&at=1889');

  await expect(page.locator('.dial__readout')).toContainText('Statehood');
  await expect(page.locator('.hero')).toContainText('As of 1889:');
  await expect(page.locator('#ring-state')).toContainText('Washington becomes the 42nd state');
  await expect(page.locator('#ring-city')).toContainText('Great Seattle Fire');
  await expect(page.locator('.ring-card.is-loading')).toHaveCount(0, { timeout: 15_000 });

  // A quiet ring links to its nearest events: 1875 has nothing on the city
  // ring, so it offers the 1866 and 1886 events, and ▶ turns the dial.
  await jumpTo(page, '1875', '1875');
  const city = page.locator('#ring-city');
  await expect(city).toHaveClass(/is-quiet/);
  await expect(city).toContainText('Nothing recorded for 1875');
  await expect(city.locator('.ring-card__jump--earlier')).toContainText('1866 · Chief Seattle dies');
  const later = city.locator('.ring-card__jump--later');
  await expect(later).toContainText('1886 · Seattle anti-Chinese riot');
  await later.click();
  await expect(page.locator('.dial__readout')).toHaveText('1886');
  await expect(city).toContainText('Seattle anti-Chinese riot');
  await expect(page).toHaveURL(/&at=1886$/);

  // Moving the stop in the address bar moves the dial without reloading the story.
  await page.evaluate(() => {
    window.location.hash = '#/story?ll=47.62051,-122.34928&q=Space%20Needle&at=1980';
  });
  await expect(page.locator('.dial__readout')).toContainText('Mount St. Helens');
  await expect(page.locator('#ring-state')).toContainText('Mount St. Helens erupts');
  expect(errors).toEqual([]);
});
