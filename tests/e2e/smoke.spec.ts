import { expect, test } from '@playwright/test';

test('home page renders with the time engine wired in', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/sno-ball/');
  await expect(page).toHaveTitle(/Snowball/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Snowball');
  await expect(page.locator('#readouts li')).toHaveCount(4);
  await expect(page.locator('#readouts')).toContainText('66 million years ago');
  expect(errors).toEqual([]);
});
