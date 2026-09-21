// The enabled guest experiment is tested only with fictional people in its own local schema.
import { defineConfig } from "@playwright/test";
const ids = Array.from({ length: 12 }, (_, i) => `fixture-${i}`).join(",");
export default defineConfig({
  testDir: "tests/gsb",
  testMatch: "guest.browser.spec.js",
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  outputDir: "output/gsb-guest-browser",
  use: { baseURL: "http://localhost:3139", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } }],
  webServer: {
    command: `NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_guest node --env-file=.env.local scripts/gsb/test-setup.js && NODE_ENV=test GSB_TEST_SCHEMA=gsb_test_guest CLASSMATES_LANDING=quick GSB_GUEST_PREVIEW=true GSB_GUEST_PERSON_IDS=${ids} GSB_TEST_EMAIL_OUTBOX=/tmp/gsb-guest-mail.jsonl APP_PROFILE=gsb APP_ORIGIN=http://localhost:3139 node --env-file=.env.local scripts/gsb/guest-test-server.js`,
    url: "http://localhost:3139/api/health", reuseExistingServer: false, timeout: 45000,
  },
});
