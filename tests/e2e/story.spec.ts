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
 * that the rock card settles honestly instead of shimmering forever.
 */
async function stubServices(page: Page, opts: { geologyDown?: boolean } = {}): Promise<{ url: string; at: number }[]> {
  const log: { url: string; at: number }[] = [];
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
    if (hostname === 'gws.gplates.org') return route.fulfill(json('geology/gplates-space-needle-times.json'));
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
  await page.evaluate(() => window.scrollTo(0, 0));

  // When the browser could draw the map, the credit in the corner is the
  // style's own (OpenFreeMap / OpenMapTiles / OpenStreetMap), printed once
  // and not covered by the caption, and the tile worker is real JavaScript.
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
