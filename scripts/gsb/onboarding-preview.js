// Local-only first-visit rehearsal with fictional people and an in-memory email inbox, never production identity.
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Only loopback requests from our own page can inspect the preview inbox or reset its browser. */
export function previewRequestAllowed(req, origin) {
  const target = new URL(origin);
  return req.headers.host === target.host &&
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) &&
    (!req.headers.origin || req.headers.origin === origin) &&
    !["cross-site", "same-site"].includes(req.headers["sec-fetch-site"]);
}

/** A repeatable preview on its own port and test schema. No real email is sent or account changed. */
export async function startOnboardingPreview(port = 3140) {
  if (process.env.VERCEL) throw new Error("The onboarding preview cannot run on Vercel.");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid preview port.");
  // Cookies ignore ports. A separate host also isolates the user's existing localhost dev session.
  const origin = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    NODE_ENV: "test", GSB_TEST_SCHEMA: "gsb_test_onboarding", APP_PROFILE: "gsb", APP_ORIGIN: origin,
    CLASSMATES_LANDING: "quick", GSB_GUEST_PREVIEW: "true",
    GSB_GUEST_PERSON_IDS: Array.from({ length: 10 }, (_, i) => `fixture-${i}`).join(","),
    CLASSMATES_EMAIL_DOMAINS: "stanford.edu",
    // The preview uses a capture adapter; configured production delivery must never be used here.
    DESCOPE_PROJECT_ID: "", RESEND_API_KEY: "", GSB_TEST_EMAIL_OUTBOX: "preview-memory",
  });
  // Imports follow the test-schema guard so none can initialize the production database first.
  await import("./test-setup.js");
  const [{ startDevServer }, { createGsbHandler }] = await Promise.all([
    import("../../server/dev.js"), import("../../server/gsb/router.js"),
  ]);
  const inbox = [];
  const html = await readFile(new URL("./onboarding-preview.html", import.meta.url));
  const app = createGsbHandler({
    send: async (email, url) => { inbox.unshift({ email, url, receivedAt: new Date().toISOString() }); inbox.length = Math.min(inbox.length, 30); },
    guestOptions: { mediaUrl: card => card.image },
  });
  const server = await startDevServer({ port, host: "127.0.0.1", quiet: true, handler: async (req, res) => {
    // All preview API requests, including normal auth, are loopback-only. Block DNS rebinding too.
    if (!previewRequestAllowed(req, origin)) { res.writeHead(403).end("Local preview only."); return; }
    const path = new URL(req.url, origin).pathname;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.method === "GET" && path === "/api/preview") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html); return;
    }
    if (req.method === "GET" && path === "/api/preview/inbox") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ messages: inbox })); return;
    }
    if (req.method === "POST" && path === "/api/preview/reset" && req.headers.origin === origin) {
      inbox.length = 0;
      // Expire only this isolated origin's cookies. Production sessions and saved data stay intact.
      res.setHeader("Set-Cookie", ["gsb=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0", "gsb-guest=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"]);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ email: `first-visit-${randomUUID().slice(0, 8)}@stanford.edu` })); return;
    }
    // Each preview identity gets its own limiter bucket, so repeated manual rehearsals stay usable.
    // This is confined to the synthetic schema and capture adapter; production rate limits remain unchanged.
    req.headers["x-forwarded-for"] = `preview-${randomUUID()}`;
    await app(req, res);
  } });
  console.log(`First-visit preview and test inbox: ${origin}/api/preview`);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await startOnboardingPreview(Number(process.env.ONBOARDING_PREVIEW_PORT || 3140));
