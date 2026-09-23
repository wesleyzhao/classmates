// Real HTTP guest-route checks against synthetic content in one isolated Postgres schema.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../../server/gsb/db.js";
import { hash } from "../../server/gsb/auth.js";
import { createGsbHandler } from "../../server/gsb/router.js";
import { startDevServer } from "../../server/dev.js";

if (process.env.NODE_ENV !== "test" || process.env.GSB_TEST_SCHEMA !== "gsb_test_guest_api" || process.env.VERCEL)
  throw new Error("Guest HTTP tests require the gsb_test_guest_api schema.");

const db = database();
const old = Object.fromEntries(["APP_ORIGIN", "GSB_GUEST_PREVIEW", "GSB_GUEST_PERSON_IDS"].map((key) => [key, process.env[key]]));
const cards = Array.from({ length: 12 }, (_, i) => ({
  id: `fixture-${i}`, answer: `Student ${i}`, image: `/api/media/asset-${i}`,
}));
const deck = { id: "guest-http-synthetic", cards };
const blobReads = [];
const links = new Map();
const server = await startDevServer({
  port: 0,
  quiet: true,
  handler: createGsbHandler({
    db,
    latestDeck: async () => deck,
    guestOptions: { mediaUrl: (card) => `/api/guest/media/asset-${card.id.split("-")[1]}` },
    getBlob: async (path) => {
      blobReads.push(path);
      return { statusCode: 200, stream: new Blob(["synthetic portrait"]).stream() };
    },
    send: async (email, url) => links.set(email, url),
  }),
});
const base = `http://localhost:${server.port}`;
process.env.APP_ORIGIN = base;
process.env.GSB_GUEST_PERSON_IDS = cards.slice(0, 10).map((card) => card.id).join(",");
delete process.env.GSB_GUEST_PREVIEW;
after(async () => {
  await server.close();
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** @param {string} path @param {{method?:string,cookie?:string,body?:any}} [options] */
async function request(path, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === "POST" ? { Origin: base, "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json() : await response.text();
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function login() {
  const email = `guest-http-${randomUUID()}@stanford.edu`;
  assert.equal((await request("/api/auth/request", { method: "POST", body: { email } })).status, 200);
  const token = new URLSearchParams(new URL(links.get(email)).hash.slice(1)).get("token");
  const verified = await request("/api/auth/verify", { method: "POST", body: { token } });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.account.access, "email");
  return verified.cookie;
}

test("off by default, including spoofed URL flags; private routes remain gated", async () => {
  for (const path of ["/api/guest", "/api/guest?flag=true", "/api/guest/media/asset-0"])
    assert.equal((await request(path)).status, 404);
  const spoof = await request("/api/guest/start?GSB_GUEST_PREVIEW=true", { method: "POST" });
  assert.equal(spoof.status, 404);
  assert.equal(spoof.cookie, "");
  for (const path of ["/api/deck", "/api/progress", "/api/media/asset-0"])
    assert.equal((await request(path)).status, 401);
});

test("fixed subset, exact assigned media, completion, claim and expiry through HTTP", async () => {
  for (let i = 0; i < 12; i++)
    await db.query("insert into gsb_assets(id,person_id,path) values($1,$2,$3) on conflict(id) do update set person_id=excluded.person_id,path=excluded.path", [`asset-${i}`, `fixture-${i}`, `synthetic/asset-${i}`]);
  await db.query("insert into gsb_assets(id,person_id,path) values('historical-0','fixture-0','synthetic/historical-0') on conflict do nothing");
  process.env.GSB_GUEST_PREVIEW = "true";
  assert.deepEqual((await request("/api/guest")).data, { status: "new" });
  const started = await request("/api/guest/start", { method: "POST" });
  assert.equal(started.status, 200);
  assert.match(started.cookie, /^gsb-guest=[A-Za-z0-9_-]{43}$/);
  assert.equal(started.data.status, "ready");
  assert.equal(started.data.questions.length, 10);
  assert.equal(new Set(started.data.questions.map((q) => q.image )).size, 10);
  assert.ok(started.data.questions.every((q) => q.choices.length === 2 && q.choices.every((c) => /^Student [0-9]$/.test(c.label))));
  const guestCookie = started.cookie;
  const secret = guestCookie.split("=")[1];
  const [row] = await db.query("select doc from gsb_guest_runs where hash=$1", [hash(secret)]);
  assert.ok(row.doc.questions.every((q) => /^fixture-[0-9]$/.test(q.target)));
  assert.equal((await request("/api/guest/start", { method: "POST", cookie: guestCookie })).data.id, started.data.id);
  for (const path of ["/api/deck", "/api/progress", "/api/media/asset-0"])
    assert.equal((await request(path, { cookie: guestCookie })).status, 401);
  const assigned = started.data.questions[0].image;
  assert.equal((await request(assigned)).status, 404);
  const beforeReads = blobReads.length;
  assert.equal((await request(assigned, { cookie: guestCookie })).status, 200);
  assert.equal(blobReads.length, beforeReads + 1);
  for (const path of ["/api/guest/media/asset-10", "/api/guest/media/historical-0"])
    assert.equal((await request(path, { cookie: guestCookie })).status, 404);
  assert.equal(blobReads.length, beforeReads + 1);

  const before = await db.query("select (select count(*) from gsb_matches) as matches,(select count(*) from gsb_ratings) as ratings");
  const answers = started.data.questions.map((q) => ({ questionId: q.id, choice: q.correctChoice }));
  const wrong = answers.map((a) => ({ ...a, choice: String((Number(a.choice) + 1) % 2) }));
  const results = await Promise.all([answers, wrong].map((a) => request("/api/guest/finish", { method: "POST", cookie: guestCookie, body: { answers: a, elapsedMs: 500 } })));
  assert.ok(results.every((r) => r.status === 200));
  assert.deepEqual(results[0].data, results[1].data);
  assert.ok([0, 10].includes(results[0].data.correct));
  assert.deepEqual(await db.query("select (select count(*) from gsb_matches) as matches,(select count(*) from gsb_ratings) as ratings"), before);
  assert.equal((await request("/api/guest/claim", { method: "POST", cookie: guestCookie })).status, 401);
  const sessionA = await login();
  // Model a provider-verified session in the isolated ledger. Public access must stay provider-independent.
  await db.query("update gsb_sessions set purpose='descope' where hash=$1", [hash(sessionA.split("=")[1])]);
  assert.equal((await request("/api/session", { cookie: sessionA })).data.account.access, "email");
  const claimed = await request("/api/guest/claim", { method: "POST", cookie: `${guestCookie}; ${sessionA}` });
  assert.deepEqual(claimed.data.result, results[0].data);
  // The claim also records the round as a two-choice quick speed run, so it sits in the speed records.
  assert.equal((await db.query("select count(*)::int as n from gsb_sprint_runs where id=$1 and result is not null and (doc->>'guest')::boolean", [`guest-${hash(secret)}`]))[0].n, 1);
  assert.deepEqual((await request("/api/guest/claim", { method: "POST", cookie: `${guestCookie}; ${sessionA}` })).data, claimed.data);
  const sessionB = await login();
  assert.equal((await request("/api/guest/claim", { method: "POST", cookie: `${guestCookie}; ${sessionB}` })).data.result, null);
  await db.query("update gsb_guest_runs set expires_at=now()-interval '1 minute' where hash=$1", [hash(secret)]);
  assert.deepEqual((await request("/api/guest/best", { cookie: sessionA })).data.result, results[0].data);
  assert.deepEqual((await request("/api/guest", { cookie: guestCookie })).data, { status: "expired" });
  const blocked = await request("/api/guest/start", { method: "POST", cookie: guestCookie });
  assert.deepEqual(blocked.data, { status: "expired" });
  assert.equal(blocked.cookie, "");

  const next = await request("/api/guest/start", { method: "POST" });
  assert.equal(next.status, 200);
  const nextCookie = next.cookie;
  const nextTarget = next.data.questions[0].image;
  const targetId = `fixture-${nextTarget.match(/asset-(\d+)$/)[1]}`;
  await db.query("update gsb_people set excluded=true where id=$1", [targetId]);
  try {
    assert.notEqual((await request(nextTarget, { cookie: nextCookie })).status, 200);
  } finally {
    await db.query("update gsb_people set excluded=false where id=$1", [targetId]);
  }
  process.env.GSB_GUEST_PREVIEW = "false";
  assert.equal((await request("/api/guest", { cookie: nextCookie })).status, 404);
  assert.equal((await request(nextTarget, { cookie: nextCookie })).status, 404);
  assert.equal((await request("/api/guest/finish", { method: "POST", cookie: nextCookie, body: { answers } })).status, 404);
});
