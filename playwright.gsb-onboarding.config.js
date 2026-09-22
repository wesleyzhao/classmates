// Rehearse first visits and invitations against the same local-only inbox operators can use.
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/gsb", testMatch: "onboarding.browser.spec.js", timeout: 90000,
  expect: { timeout: 15000 }, workers: 1, reporter: "list", outputDir: "output/gsb-onboarding-browser",
  use: { baseURL: "http://127.0.0.1:3141", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit" } }],
  webServer: { command: "ONBOARDING_PREVIEW_PORT=3141 npm run preview:onboarding",
    url: "http://127.0.0.1:3141/api/health", reuseExistingServer: false, timeout: 60000 },
});
