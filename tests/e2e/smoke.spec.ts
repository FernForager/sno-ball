import { expect, test } from '@playwright/test';

// The smoke test checks that the home page builds and renders. It never
// submits a search, so it needs no network and never touches the geocoder.
test('home page renders the search box and example chips', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/sno-ball/');
  await expect(page).toHaveTitle(/Snowball/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Snowball');

  const form = page.getByRole('search');
  await expect(form).toBeVisible();
  await expect(form.getByRole('searchbox')).toHaveAttribute('placeholder', 'Any address in Washington');
  await expect(form.getByRole('button', { name: 'Tell me its story' })).toBeVisible();
  await expect(form.locator('.chip')).toHaveCount(5);
  await expect(form.locator('.chip').first()).toHaveText('Space Needle');

  // The story area exists but shows nothing until a search is made.
  await expect(page.locator('.rings')).toBeHidden();
  await expect(page.locator('.hero')).toBeHidden();
  await expect(page.locator('.postcard')).toBeHidden();

  expect(errors).toEqual([]);
});

test('an empty search shows a hint and makes no request', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://127.0.0.1')) requests.push(req.url());
  });

  await page.goto('/sno-ball/');
  await page.getByRole('search').getByRole('button', { name: 'Tell me its story' }).click();
  await expect(page.getByRole('alert')).toHaveText('Type an address to begin.');
  expect(requests).toEqual([]);
});
