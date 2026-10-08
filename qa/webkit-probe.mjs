// What WebKit does with the map: does headless WebKit have WebGL, does the
// story show the one-line "map unavailable" note, and does it still render.
import { webkit, devices } from '@playwright/test';
const BASE = 'http://127.0.0.1:4173/sno-ball/';
const browser = await webkit.launch();
const out = [];
for (const [name, device] of [['phone', devices['iPhone 14']], ['desktop', devices['Desktop Safari']]]) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE + '#/story?ll=47.62051,-122.34928&q=400%20Broad%20St%2C%20Seattle%2C%20WA');
  await page.waitForFunction(() => {
    const hero = document.querySelector('.hero');
    return hero && !hero.hidden && document.querySelectorAll('[aria-busy="true"]').length === 0 && document.querySelectorAll('.ring-card').length > 0;
  }, null, { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return {
      webgl: !!(c.getContext('webgl') || c.getContext('webgl2')),
      mapNote: document.querySelector('.postcard__note')?.textContent.trim() ?? null,
      canvas: !!document.querySelector('.postcard__map canvas'),
      attribution: document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent.trim() ?? null,
      hero: document.querySelector('.hero')?.textContent.trim(),
      rings: [...document.querySelectorAll('.ring-card')].map((r) => `${r.dataset.level}:${r.className.match(/is-(\w+)/)?.[1]}:${r.querySelectorAll('.fact').length}`),
      status: document.querySelector('.story__status')?.textContent,
    };
  });
  await page.screenshot({ path: `qa/screens/webkit-story-${name}.png`, fullPage: true });
  out.push({ name, ...info, errors });
  await context.close();
  await new Promise((r) => setTimeout(r, 1500));
}
await browser.close();
console.log(JSON.stringify(out, null, 2));
