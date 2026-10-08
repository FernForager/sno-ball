// Address sweep: one fresh page per query, phone viewport, real services.
// Records the outcome, the geocode, ring statuses and fact counts, the status
// line, console errors, settle time and third-party hosts that answered non-2xx.
//   node qa/sweep.mjs > qa/sweep-results.json
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4173/sno-ball/';
const SETTLE_MS = 45_000;
const STRICT = process.env.STRICT === '1';
const GAP_MS = 2_500;
const executablePath = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const RINGS = ['house', 'block', 'street', 'neighborhood', 'city', 'county', 'region', 'state', 'plate'];

const QUERIES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '400 Broad St, Seattle, WA',
      '5400 Ballard Ave NW, Seattle, WA',
      '4727 California Ave SW, Seattle, WA',
      '9200 Rainier Ave S, Seattle, WA',
      '747 Market St, Tacoma, WA',
      '2930 Wetmore Ave, Everett, WA',
      '210 Lottie St, Bellingham, WA',
      '416 Sid Snyder Ave SW, Olympia, WA',
      '415 W 6th St, Vancouver, WA',
      '129 N 2nd St, Yakima, WA',
      '301 Yakima St, Wenatchee, WA',
      '325 SE Paradise St, Pullman, WA',
      '206 W Main Ave, Ritzville, WA',
      '15 N Clark Ave, Republic, WA',
      '500 E Division St, Forks, WA',
      '350 Court St, Friday Harbor, WA',
      '115 Bolstad Ave W, Long Beach, WA',
      '2 N Main St, Omak, WA',
      '170 S Oak St, Colville, WA',
      '21 W 1st Ave, Toppenish, WA',
      'Neah Bay, WA',
      '1 Tyee Dr, Point Roberts, WA',
      '7121 E Loop Rd, Stevenson, WA',
      '501 N Anderson St, Ellensburg, WA',
      'Paradise, Mount Rainier National Park, WA',
      'Mount Rainier',
      'Seatle Space Nedle',
      '1600 Pennsylvania Ave, Washington, DC',
      'PO Box 1, Spokane, WA',
      '98101',
    ];

mkdirSync('qa/screens', { recursive: true });
const browser = await chromium.launch({ executablePath });
const results = [];
let index = 0;
for (const query of QUERIES) {
  index += 1;
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const badResponses = [];
  const failedRequests = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.startsWith('http://127.0.0.1')) return;
    const status = res.status();
    if (status < 200 || status >= 300) badResponses.push({ host: new URL(url).hostname, status, path: new URL(url).pathname.slice(0, 80) });
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.startsWith('http://127.0.0.1')) return;
    failedRequests.push({ host: new URL(url).hostname, error: req.failure()?.errorText ?? '?' });
  });

  const record = { n: index, query, outcome: 'timeout', settleMs: null };
  const start = Date.now();
  try {
    if (STRICT) await page.addInitScript(() => { window.__strict = true; });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const form = page.getByRole('search');
    await form.getByRole('searchbox').fill(query);
    await form.getByRole('button', { name: 'Tell me its story' }).click();

    // Settle: hero visible and nothing aria-busy, or an error alert visible.
    await page.waitForFunction(
      () => {
        const alert = document.querySelector('.search__error');
        const errShown = alert && !alert.hidden && alert.textContent.trim().length > 0;
        if (errShown) return true;
        const hero = document.querySelector('.hero');
        const heroShown = hero && !hero.hidden && hero.textContent.trim().length > 0;
        const busy = document.querySelectorAll('[aria-busy="true"]').length;
        const rings = document.querySelectorAll('.ring-card').length;
        // STRICT=1: also wait for the final status line ("Story ready…" or a
        // "…did not answer" note), because a card drops aria-busy as soon as
        // its first fact lands, before its other loaders have answered.
        if (window.__strict) {
          const st = document.querySelector('.story__status')?.textContent ?? '';
          if (st.startsWith('Gathering') || st.startsWith('Finding')) return false;
        }
        return heroShown && rings > 0 && busy === 0;
      },
      null,
      { timeout: SETTLE_MS, polling: 250 },
    );
    record.settleMs = Date.now() - start;
  } catch (e) {
    record.settleMs = Date.now() - start;
    record.settleError = String(e.message).split('\n')[0];
  }

  const snap = await page.evaluate((RINGS) => {
    const alert = document.querySelector('.search__error');
    const error = alert && !alert.hidden ? alert.textContent.trim() : null;
    const hero = document.querySelector('.hero');
    const heroText = hero && !hero.hidden ? hero.textContent.trim() : null;
    const status = document.querySelector('.story__status')?.textContent.trim() ?? '';
    const hint = document.querySelector('.postcard__hint')?.textContent.trim() ?? null;
    const name = document.querySelector('.postcard__name');
    const rings = RINGS.map((level) => {
      const card = document.getElementById(`ring-${level}`);
      if (!card) return { level, status: 'missing', name: '', facts: 0 };
      const m = card.className.match(/\bis-(\w+)/);
      return {
        level,
        status: m ? m[1] : (card.getAttribute('aria-busy') === 'true' ? 'loading' : '?'),
        name: card.querySelector('h2')?.textContent.trim() ?? '',
        facts: card.querySelectorAll('.fact').length,
        note: card.querySelector('.ring-card__note')?.textContent.trim().slice(0, 120) ?? null,
      };
    });
    return {
      error,
      heroText,
      status,
      hint,
      displayName: name?.getAttribute('title') ?? name?.textContent.trim() ?? null,
      caption: name?.textContent.trim() ?? null,
      rings,
      busyCount: document.querySelectorAll('[aria-busy="true"]').length,
      bodyTextLength: document.body.innerText.length,
      mapNote: document.querySelector('.postcard__note')?.textContent.trim() ?? null,
      rock: document.querySelector('.deep-card--rock')?.innerText.trim().slice(0, 160) ?? null,
    };
  }, RINGS);

  const hash = new URL(page.url()).hash;
  const ll = hash.match(/ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  record.hash = hash;
  record.lat = ll ? Number(ll[1]) : null;
  record.lng = ll ? Number(ll[2]) : null;
  if (snap.error) record.outcome = snap.error.includes("couldn't find") ? 'not-found' : 'error';
  else if (snap.heroText) record.outcome = record.settleError ? 'story-unsettled' : 'story';
  Object.assign(record, {
    displayName: snap.displayName,
    caption: snap.caption,
    precise: snap.hint ? false : snap.heroText ? true : null,
    hint: snap.hint,
    hero: snap.heroText,
    errorMessage: snap.error,
    statusLine: snap.status,
    rings: snap.rings,
    busyCount: snap.busyCount,
    mapNote: snap.mapNote,
    rock: snap.rock,
    consoleErrors,
    pageErrors,
    badResponses,
    failedRequests,
    blank: snap.bodyTextLength < 50,
  });

  const slug = `${String(index).padStart(2, '0')}-${query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  await page.screenshot({ path: `qa/screens/sweep-${slug}.png`, fullPage: true });
  record.screenshot = `qa/screens/sweep-${slug}.png`;
  results.push(record);
  console.error(`[${index}/${QUERIES.length}] ${record.outcome.padEnd(14)} ${record.settleMs}ms  ${query}  -> ${snap.caption ?? snap.error ?? ''}`);
  await context.close();
  await new Promise((r) => setTimeout(r, GAP_MS));
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
