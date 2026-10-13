import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '../tests/e2e',
  forbidOnly: true,
  retries: 0,
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: resolve('evidence/bootstrap/browser-results.json') },
    ],
  ],
  outputDir: '../test-results',
  use: { headless: true },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
