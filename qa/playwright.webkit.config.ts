import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config';

// Runs the existing e2e suite under WebKit (the Safari engine), on a phone
// and a desktop profile. Paths are re-anchored at the repo root because
// Playwright resolves them relative to this file, which lives in qa/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  ...base,
  testDir: path.join(root, 'tests/e2e'),
  outputDir: path.join(root, 'qa/test-results'),
  reporter: 'list',
  use: {
    ...base.use,
    launchOptions: {},
  },
  webServer: base.webServer ? { ...(base.webServer as object), cwd: root } : undefined,
  projects: [
    { name: 'webkit-phone', use: { ...devices['iPhone 14'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
  ],
});
