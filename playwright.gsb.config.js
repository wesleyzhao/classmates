// Real browser coverage of the GSB profile against an isolated Postgres schema and local email outbox.
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/gsb",
  testMatch: "**/*.browser.spec.js",
  testIgnore: "guest.browser.spec.js",
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  outputDir: "output/gsb-browser",
  use: {
    baseURL: "http://localhost:3138",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command:
      "NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_browser node --env-file=.env.local scripts/gsb/test-setup.js && NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_browser GSB_TEST_EMAIL_OUTBOX=/tmp/gsb-test-mail.jsonl APP_PROFILE=gsb APP_ORIGIN=http://localhost:3138 node --env-file=.env.local server/dev.js 3138",
    url: "http://localhost:3138/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
