import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// In the Claude cloud container a matching Chromium is preinstalled and browser
// downloads are disabled, so point Playwright at it. On GitHub Actions and on a
// laptop, `npx playwright install chromium` provides the browser instead.
const preinstalledChromium = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(preinstalledChromium) ? preinstalledChromium : undefined);

const port = 4173;
const baseURL = `http://127.0.0.1:${port}/sno-ball/`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
