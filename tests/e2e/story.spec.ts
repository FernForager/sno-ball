import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The whole story pipeline in a real browser, with every outside service
 * answered from the fixture files captured on 2026-10-07. Nothing here
 * reaches the network: the geocoder, Wikipedia, the geology server, the
 * plate model and Seattle's open data are all stubbed, and the map tiles
 * are blocked. So this runs in CI like the smoke test and still proves
 * that main.ts wires the modules together correctly.
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
      if (pathname.endsWith('/Washington_(state)')) return route.fulfill(json('places/wikipedia-summary-washington.json'));
      if (pathname.endsWith('/King_County,_Washington')) return route.fulfill(json('places/wikipedia-summary-king-county.json'));
      if (pathname.endsWith('/Seattle,_Washington')) return route.fulfill(json('places/wikipedia-summary-seattle.json'));
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"type":"not_found"}' });
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

  // Screen readers are told the story is ready.
  await expect(page.locator('.story__status')).toContainText('Story ready', { timeout: 15_000 });

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

  // When the browser could draw the map, the OpenStreetMap credit is visible
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
    if (viewport && viewport.width >= 640) {
      await expect(attrib).toContainText('OpenStreetMap contributors');
    }
    // The tile worker is a real file of the build, served as JavaScript (not index.html).
    await expect.poll(() => served.find((r) => r.url.includes('maplibre-gl-worker'))?.contentType ?? '', { timeout: 10_000 }).toContain('javascript');
  }

  // Wikimedia requests go one at a time, at least 300 ms apart (the limiter
  // spaces their starts by 350 ms; the route sees each a few ms later, so a
  // little slack is allowed for timing jitter).
  const wikimedia = log.filter((r) => /wikipedia\.org|wikidata\.org/.test(r.url));
  expect(wikimedia.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < wikimedia.length; i += 1) {
    expect(wikimedia[i]!.at - wikimedia[i - 1]!.at).toBeGreaterThanOrEqual(250);
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
