// Guest preview tests use synthetic cards and an in-memory SQL-shaped stub, never class data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  guestConfig,
  getGuestRun,
  startGuestRun,
  scoreGuestRun,
  finishGuestRun,
  claimGuestRun,
  guestBest,
  guestMediaPath,
} from "../../server/gsb/guest.js";

const cards = Array.from({ length: 10 }, (_, index) => ({
  id: `fixture-${index}`,
  answer: `Synthetic Student ${index}`,
  image: `/api/media/asset-${index}`,
}));
const deck = { id: "synthetic-revision", cards };
const previous = {
  flag: process.env.GSB_GUEST_PREVIEW,
  ids: process.env.GSB_GUEST_PERSON_IDS,
};
function enabled() {
  process.env.GSB_GUEST_PREVIEW = "true";
  process.env.GSB_GUEST_PERSON_IDS = cards.map((card) => card.id).join(",");
}
function restore() {
  if (previous.flag === undefined) delete process.env.GSB_GUEST_PREVIEW;
  else process.env.GSB_GUEST_PREVIEW = previous.flag;
  if (previous.ids === undefined) delete process.env.GSB_GUEST_PERSON_IDS;
  else process.env.GSB_GUEST_PERSON_IDS = previous.ids;
}
function stub() {
  const runs = new Map();
  const excluded = new Set();
  const db = {
    async query(sql, params = []) {
      if (sql.startsWith("insert into gsb_guest_runs")) {
        runs.set(params[0], { hash: params[0], doc: JSON.parse(params[1]), expires_at: params[2], claimed_account_id: null, finished_at: null });
        return [];
      }
      if (sql.startsWith("select id from gsb_people"))
        return params[0].filter((id) => !excluded.has(id)).map((id) => ({ id }));
      if (sql.startsWith("select a.path")) {
        const id = String(params[0]).replace(/^asset-(?:old-)?/, "fixture-");
        return excluded.has(id) ? [] : [{ path: `private/${params[0]}.jpg`, person_id: id }];
      }
      const row = runs.get(params[0]);
      if (sql.startsWith("update gsb_guest_runs set doc=")) {
        if (!row || row.doc.result) return [];
        row.doc.result = JSON.parse(params[1]);
        row.finished_at = new Date();
        return [{ result: row.doc.result }];
      }
      if (sql.startsWith("update gsb_guest_runs set claimed")) {
        if (!row || !row.finished_at || row.claimed_account_id) return [];
        row.claimed_account_id = params[1];
        return [{ result: row.doc.result }];
      }
      if (sql.startsWith("select doc from gsb_guest_runs where claimed")) {
        const matching = [...runs.values()].filter((item) => item.claimed_account_id === params[0]);
        matching.sort((a, b) => b.doc.result.score - a.doc.result.score);
        return matching.map((item) => ({ doc: item.doc }));
      }
      if (sql.startsWith("select claimed_account_id"))
        return row ? [{ claimed_account_id: row.claimed_account_id, result: row.doc.result }] : [];
      if (sql.startsWith("select doc->'result' as result")) return row ? [{ result: row.doc.result }] : [];
      if (sql.startsWith("select")) return row ? [row] : [];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { db, runs, excluded };
}
function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
}
function request(res) {
  const cookie = res.headers["Set-Cookie"].split(";")[0];
  return { headers: { cookie } };
}

test("guest feature fails closed without both exact flag and bounded allowlist", async () => {
  try {
    delete process.env.GSB_GUEST_PREVIEW;
    delete process.env.GSB_GUEST_PERSON_IDS;
    assert.equal(guestConfig(), null);
    const { db } = stub();
    await assert.rejects(startGuestRun(db, { headers: {} }, response(), deck), /not available/);
    process.env.GSB_GUEST_PREVIEW = "true";
    assert.equal(guestConfig(), null);
    process.env.GSB_GUEST_PERSON_IDS = "fixture-0,fixture-0";
    assert.equal(guestConfig(), null);
    enabled();
    assert.equal(guestConfig().size, 10);
  } finally { restore(); }
});

test("one cookie gets one ten-face run, even after completion and refresh", async () => {
  enabled();
  try {
    const { db, runs } = stub(), res = response();
    const started = await startGuestRun(db, { headers: {} }, res, deck);
    assert.equal(started.status, "ready");
    assert.equal(started.questions.length, 10);
    assert.ok(started.questions.every(q => q.choices.length === 2));
    const invalid = started.questions.map(q => ({questionId:q.id,choice:"2"}));
    await assert.rejects(finishGuestRun(db, request(res), {answers:invalid, elapsedMs:1000}), /not valid/);
    assert.ok(res.headers["Set-Cookie"].includes("HttpOnly"));
    assert.ok(res.headers["Set-Cookie"].includes("SameSite=Lax"));
    assert.ok(res.headers["Set-Cookie"].includes("Max-Age=31536000"));
    assert.equal(runs.size, 1);
    const req = request(res);
    assert.deepEqual(await startGuestRun(db, req, response(), deck), await getGuestRun(db, req));
    assert.equal(runs.size, 1);
    const row = [...runs.values()][0],
      answers = row.doc.questions.map((question) => ({ questionId: question.id, choice: question.correctChoice }));
    const result = await finishGuestRun(db, req, { answers, elapsedMs: 1000 });
    assert.equal(result.score, 10987, "scored like a speed run: 1,000 a face and up to 999 for a fast round");
    assert.equal(result.elapsedMs, 1000); assert.equal(result.perfect, true);
    assert.equal(result.correct, 10);
    assert.deepEqual(await finishGuestRun(db, req, { answers: [] }), result);
    assert.equal((await getGuestRun(db, req)).status, "complete");
    assert.equal((await startGuestRun(db, req, response(), deck)).status, "complete");
    assert.equal(runs.size, 1);
  } finally { restore(); }
});

test("logs have exact order and offered choices, and the round time is a bounded integer", () => {
  const doc = { questions: Array.from({ length: 10 }, (_, index) => ({ id: String(index), correctChoice: "1", choices: [0,1].map(n => ({id:String(n)})) })) };
  const logs = doc.questions.map((question) => ({ questionId: question.id, choice: "1" }));
  const result = scoreGuestRun(doc, logs, 20000);
  assert.equal(result.score, 10749);
  assert.equal(result.elapsedMs, 20000);
  assert.deepEqual(result.answers, logs.map(() => "1"));
  const missedOne = logs.map((item, index) => index === 0 ? { ...item, choice: "0" } : item);
  assert.equal(scoreGuestRun(doc, missedOne, 20000).correct, 9);
  assert.equal(scoreGuestRun(doc, missedOne, 20000).perfect, false);
  for (const [altered, elapsed] of [
    [logs.slice(0, 7), 20000],
    [logs.map((item, index) => index === 0 ? { ...item, questionId: "7" } : item), 20000],
    [logs.map((item, index) => index === 0 ? { ...item, choice: "2" } : item), 20000],
    [logs.map((item, index) => index === 0 ? { ...item, choice: 1 } : item), 20000],
    [logs.map((item, index) => index === 0 ? { ...item, choice: null } : item), 20000],
    [logs, 0], [logs, 0.5], [logs, 3600001],
  ]) assert.throws(() => scoreGuestRun(doc, altered, elapsed));
});

test("guest media stays assigned and live; claims require verified session scope", async () => {
  enabled();
  try {
    const { db, excluded, runs } = stub(), res = response();
    await startGuestRun(db, { headers: {} }, res, deck);
    const req = request(res);
    assert.equal(await guestMediaPath(db, req, "asset-0"), "private/asset-0.jpg");
    assert.equal(await guestMediaPath(db, req, "asset-old-0"), null);
    assert.equal(await guestMediaPath(db, req, "asset-other"), null);
    assert.equal(await claimGuestRun(db, req, { id: "account", access: "email" }), null);
    // The completed result can be claimed once and never enters a competitive table.
    const run = await getGuestRun(db, req);
    const answers = run.questions.map((question) => ({ questionId: question.id, choice: String(1 - Number(question.correctChoice)) }));
    await finishGuestRun(db, req, { answers, elapsedMs: 500 });
    assert.equal(await claimGuestRun(db, req, { id: "owner", access: "owner-preview" }), null);
    assert.equal((await claimGuestRun(db, req, { id: "account", access: "email" })).score, 0);
    assert.equal((await claimGuestRun(db, req, { id: "account", access: "email" })).score, 0);
    assert.equal(await claimGuestRun(db, req, { id: "other", access: "email" }), null);
    assert.equal((await guestBest(db, { id: "account", access: "email" })).score, 0);
    [...runs.values()][0].expires_at = new Date(Date.now() - 1000).toISOString();
    assert.equal((await guestBest(db, { id: "account", access: "email" })).score, 0);
    excluded.add("fixture-0");
    assert.equal(await guestMediaPath(db, req, "asset-0"), null);
    await assert.rejects(getGuestRun(db, req), /no longer available/);
    assert.equal(await guestBest(db, { id: "account", access: "email" }), null);
    process.env.GSB_GUEST_PREVIEW = "false";
    await assert.rejects(guestMediaPath(db, req, "asset-1"), /not available/);
  } finally { restore(); }
});

test("a spent cookie cannot mint a fresh run even when its database row was cleaned up", async () => {
  enabled();
  try {
    const { db, runs } = stub(), res = response();
    await startGuestRun(db, { headers: {} }, res, deck);
    const req = request(res);
    runs.clear();
    const retry = response();
    assert.deepEqual(await startGuestRun(db, req, retry, deck), { status: "expired" });
    assert.equal(runs.size, 0);
    assert.equal(retry.headers["Set-Cookie"], undefined);
    process.env.GSB_GUEST_PERSON_IDS = cards.slice(0, 8).map(c => c.id).join(",");
    assert.equal(guestConfig(), null);
  } finally { restore(); }
});
