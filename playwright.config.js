// Playwright configuration: real browsers against the dev server with the in-memory store.
// `npm run test:e2e` runs every spec in tests/e2e on Chromium at phone size; set
// BROWSER=webkit to use WebKit (closest to iOS Safari). Screenshots and traces of failures land
// in test-results/.
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 3123);
const engine = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.e2e\.js/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results/e2e',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(engine === 'webkit' ? devices['iPhone 14'] : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }),
  },
  projects: [{ name: engine, use: { browserName: engine } }],
  webServer: {
    command: `QUIET=1 STORE=memory PORT=${port} node server/dev.js`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
