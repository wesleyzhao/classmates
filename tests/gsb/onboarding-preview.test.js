// The developer inbox must never expose credentials to a remote site or run on a deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { previewRequestAllowed, startOnboardingPreview } from "../../scripts/gsb/onboarding-preview.js";
import { appOrigin } from "../../server/gsb/auth.js";
test("preview inbox requires a loopback connection, exact host, and same-origin browser access", () => {
  const origin = "http://127.0.0.1:3140";
  const request = { headers: { host: "127.0.0.1:3140", origin, "sec-fetch-site": "same-origin" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(previewRequestAllowed(request, origin), true);
  for (const headers of [
    { ...request.headers, host: "evil.example:3140" },
    { ...request.headers, origin: "https://evil.example" },
    { ...request.headers, "sec-fetch-site": "cross-site" },
    { ...request.headers, "sec-fetch-site": "same-site" },
  ]) assert.equal(previewRequestAllowed({ ...request, headers }, origin), false);
  assert.equal(previewRequestAllowed({ ...request, socket: { remoteAddress: "10.0.0.2" } }, origin), false);
});
test("onboarding preview and HTTP origins stay unavailable on Vercel", async () => {
  const before = { VERCEL: process.env.VERCEL, APP_ORIGIN: process.env.APP_ORIGIN };
  try {
    delete process.env.VERCEL;
    process.env.APP_ORIGIN = "http://127.0.0.1:3140";
    assert.equal(appOrigin(), process.env.APP_ORIGIN);
    process.env.APP_ORIGIN = "http://192.168.1.2:3140";
    assert.throws(appOrigin, /HTTPS/);
    process.env.VERCEL = "1";
    process.env.APP_ORIGIN = "http://127.0.0.1:3140";
    assert.throws(appOrigin, /HTTPS/);
    await assert.rejects(startOnboardingPreview(), /cannot run on Vercel/);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
