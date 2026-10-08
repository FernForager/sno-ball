// Accessibility scan with axe-core: home page and the Space Needle story,
// at a phone viewport and a desktop viewport. Run with the preview server
// already serving the built site on 127.0.0.1:4173.
//   node qa/axe.mjs > qa/axe-results.json
import { chromium, devices } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = 'http://127.0.0.1:4173/sno-ball/';
const QUERY = '400 Broad St, Seattle, WA';
const executablePath = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const viewports = {
  phone: { ...devices['Pixel 7'] },
  desktop: { ...devices['Desktop Chrome'] },
};

async function settle(page, maxMs = 45_000) {
  const start = Date.now();
  await page.waitForSelector('.hero:not([hidden])', { timeout: maxMs });
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0, null, {
    timeout: Math.max(1000, maxMs - (Date.now() - start)),
  });
  return Date.now() - start;
}

async function outline(page) {
  return page.evaluate(() => ({
    headings: [...document.querySelectorAll('h1, h2, h3')]
      .filter((h) => !h.closest('[hidden]'))
      .map((h) => `${h.tagName.toLowerCase()}: ${h.textContent.trim().replace(/\s+/g, ' ')}`),
    h1Count: document.querySelectorAll('h1').length,
    statusLine: (() => {
      const s = document.querySelector('.story__status');
      return s ? { ariaLive: s.getAttribute('aria-live'), role: s.getAttribute('role'), text: s.textContent } : null;
    })(),
  }));
}

function summarize(results) {
  const byImpact = { critical: [], serious: [], moderate: [], minor: [] };
  for (const v of results.violations) {
    (byImpact[v.impact ?? 'minor'] ??= []).push({
      id: v.id,
      impact: v.impact,
      description: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.length,
      firstTarget: v.nodes[0]?.target?.join(' ') ?? '',
      firstHtml: (v.nodes[0]?.html ?? '').slice(0, 200),
    });
  }
  return { byImpact, passes: results.passes.length, incomplete: results.incomplete.map((i) => ({ id: i.id, nodes: i.nodes.length, targets: i.nodes.slice(0, 5).map((n) => n.target.join(' ')), reason: i.nodes[0]?.any?.[0]?.message ?? i.nodes[0]?.none?.[0]?.message ?? '' })) };
}

const browser = await chromium.launch({ executablePath });
const report = [];
for (const [vpName, device] of Object.entries(viewports)) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  // (a) Home page
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const homeAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  report.push({ viewport: vpName, page: 'home', ...summarize(homeAxe), outline: await outline(page), consoleErrors: [...consoleErrors] });
  consoleErrors.length = 0;

  // (b) Space Needle story
  const form = page.getByRole('search');
  await form.getByRole('searchbox').fill(QUERY);
  await form.getByRole('button', { name: 'Tell me its story' }).click();
  let settleMs = null;
  let settleError = null;
  try {
    settleMs = await settle(page);
  } catch (e) {
    settleError = String(e.message).split('\n')[0];
  }
  await page.waitForTimeout(500);
  const storyAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  report.push({ viewport: vpName, page: 'story', settleMs, settleError, ...summarize(storyAxe), outline: await outline(page), consoleErrors: [...consoleErrors] });
  await page.screenshot({ path: `qa/screens/axe-story-${vpName}.png`, fullPage: true });
  await context.close();
  await new Promise((r) => setTimeout(r, 2500));
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
