import { expect, test } from '@playwright/test';

// A real, end-to-end run against the live data services. It costs the
// shared services a handful of requests, so it only runs when asked:
//
//   LIVE=1 npx playwright test tests/e2e/live.spec.ts
//
// Everything else in CI skips it.
const live = process.env['LIVE'] === '1';

test.describe('live story for the Space Needle', () => {
  test.skip(!live, 'set LIVE=1 to run against the real services');
  test.setTimeout(120_000);

  test('tells the story of 400 Broad St, Seattle', async ({ page }) => {
    const generous = { timeout: 60_000 };

    await page.goto('/sno-ball/');
    const form = page.getByRole('search');
    await form.getByRole('searchbox').fill('400 Broad St, Seattle, WA');
    await form.getByRole('button', { name: 'Tell me its story' }).click();

    // The hero sentence names the city and county.
    const hero = page.locator('.hero');
    await expect(hero).toBeVisible(generous);
    await expect(hero).toContainText('Seattle', generous);
    await expect(hero).toContainText('King County', generous);

    // The county card carries the county's founding year.
    await expect(page.locator('#ring-county')).toContainText('1852', generous);

    // The rock card names the glacial till under Seattle.
    await expect(page.locator('.deep-card--rock')).toContainText(/Pleistocene|glacial/, generous);

    // At least one Wikipedia excerpt arrived, with its source link.
    const wikiLink = page.locator('a[href^="https://en.wikipedia.org/wiki/"]');
    await expect(wikiLink.first()).toBeVisible(generous);

    // The share link in the URL carries the coordinates and the query.
    await expect(page).toHaveURL(/#\/story\?ll=47\.62\d+,-122\.34\d+&q=/);
  });
});
