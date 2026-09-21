// Real HTTP sprint checks use synthetic cards and a dedicated Postgres schema.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../../server/gsb/db.js";
import { createGsbHandler } from "../../server/gsb/router.js";
import { startDevServer } from "../../server/dev.js";
import { faceSummary } from "../../server/gsb/face-history.js";
import { prepareSprint } from "../../server/gsb/sprint.js";

if (process.env.NODE_ENV !== "test" || process.env.GSB_TEST_SCHEMA !== "gsb_test_sprint_api" || process.env.VERCEL)
  throw new Error("Sprint HTTP tests require gsb_test_sprint_api.");

const db = database();
await db.query("delete from limits");
const previousOrigin = process.env.APP_ORIGIN;
const links = new Map();
const cards = Array.from({ length: 24 }, (_, i) => ({
  id: `fixture-${i}`, answer: `Student ${String.fromCharCode(65 + i)}`, image: `/gsb/fixture.svg?person=${i}`,
}));
const deck = { id: `sprint-synthetic-${randomUUID()}`, cards };
const server = await startDevServer({ port: 0, quiet: true, handler: createGsbHandler({
  db, latestDeck: async () => {
    const excluded = new Set((await db.query("select id from gsb_people where excluded=true and id=any($1::text[])", [cards.map((card) => card.id)])).map((row) => row.id));
    return { ...deck, cards: cards.filter((card) => !excluded.has(card.id)) };
  }, send: async (email, url) => links.set(email, url),
}) });
const base = `http://localhost:${server.port}`;
process.env.APP_ORIGIN = base;
after(async () => {
  await server.close();
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousOrigin;
});

/** @param {string} path @param {{method?:string,cookie?:string,body?:any,ip?:string}} [options] */
async function request(path, { method = "GET", cookie = "", body, ip } = {}) {
  const response = await fetch(base + path, { method, headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(ip ? { "x-forwarded-for": ip } : {}),
    ...(method === "POST" ? { Origin: base, "Content-Type": "application/json" } : {}),
  }, ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function login() {
  const email = `sprint-${randomUUID()}@stanford.edu`;
  const ip = `2001:db8::${randomUUID().slice(0, 4)}`;
  assert.equal((await request("/api/auth/request", { method: "POST", body: { email }, ip })).status, 200);
  const token = new URLSearchParams(new URL(links.get(email)).hash.slice(1)).get("token");
  const verified = await request("/api/auth/verify", { method: "POST", body: { token }, ip });
  assert.equal(verified.status, 200);
  return { cookie: verified.cookie, account: verified.data.account };
}

test("owner-bound short sprint completes once and creates comparable solo records", async () => {
  assert.equal((await request("/api/sprint/records?direction=face&length=short")).status, 401);
  assert.equal((await request("/api/sprint/prepare", { method: "POST", body: { direction: "face", length: "short" } })).status, 401);
  const a = await login(), b = await login();
  const before = await db.query("select (select count(*) from gsb_matches) as matches,(select count(*) from gsb_ratings) as ratings");
  const prepared = await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "face", length: "short" } });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.data.count, 20);
  assert.equal(new Set(prepared.data.questions.map((q) => q.image)).size, 20);
  assert.ok(prepared.data.questions.every((q) => q.choices.length === 4 && /^[0-3]$/.test(q.correctChoice)));
  const id = prepared.data.id;
  assert.equal((await request("/api/sprint/start", { method: "POST", cookie: b.cookie, body: { id } })).status, 404);
  assert.equal((await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id, answers: [], elapsedMs: 1000 } })).status, 409);
  const starts = await Promise.all(Array.from({ length: 2 }, () => request("/api/sprint/start", { method: "POST", cookie: a.cookie, body: { id } })));
  assert.ok(starts.every((x) => x.status === 200));
  assert.equal(starts[0].data.startedAt, starts[1].data.startedAt);
  const answers = prepared.data.questions.map((q) => ({ questionId: q.id, choice: q.correctChoice }));
  assert.equal((await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id, answers: answers.slice(1), elapsedMs: 1000 } })).status, 400);
  const results = await Promise.all([answers, answers.map((x) => ({ ...x, choice: String((Number(x.choice) + 1) % 4) }))].map((log) => request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id, answers: log, elapsedMs: 1 } })));
  assert.ok(results.every((x) => x.status === 200));
  assert.deepEqual(results[0].data, results[1].data);
  const replay = await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id, answers: [], elapsedMs: 0 } });
  assert.deepEqual(replay.data, results[0].data);
  const second = await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "face", length: "short" } });
  assert.equal(second.status, 200);
  await request("/api/sprint/start", { method: "POST", cookie: a.cookie, body: { id: second.data.id } });
  const secondAnswers = second.data.questions.map((q) => ({ questionId: q.id, choice: q.correctChoice }));
  const secondResult = await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id: second.data.id, answers: secondAnswers, elapsedMs: 1 } });
  assert.equal(secondResult.status, 200);
  const records = await request("/api/sprint/records?direction=face&length=short", { cookie: a.cookie });
  assert.equal(records.status, 200);
  assert.equal(records.data.bestScore.score, secondResult.data.score);
  assert.equal(records.data.leaders.length, 1);
  assert.equal(records.data.fastestPerfect.perfect, true);
  assert.equal(records.data.perfectLeaders.length, 1);
  assert.deepEqual(await db.query("select (select count(*) from gsb_matches) as matches,(select count(*) from gsb_ratings) as ratings"), before);
  assert.equal((await request("/api/sprint/records?direction=name&length=short", { cookie: a.cookie })).data.bestScore, null);
  await db.query("update gsb_people set excluded=true where id=$1", [cards[0].id]);
  try {
    assert.equal((await request("/api/sprint/records?direction=face&length=short", { cookie: a.cookie })).data.bestScore, null);
  } finally {
    await db.query("update gsb_people set excluded=false where id=$1", [cards[0].id]);
  }
});

test("a prepared twenty issues two owner-bound tens with separate records and only played history", async () => {
  const a = await login(), b = await login();
  const prepared = await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "mixed", length: "short" } });
  assert.equal(prepared.status, 200);
  const { id, questions, segments } = prepared.data;
  assert.equal(segments.length, 2);
  assert.equal((await faceSummary(db, a.account.id, deck)).seen, 0);
  for (const [i, segment] of segments.entries()) {
    assert.equal(segment.offset, i * 10);
    assert.equal(segment.count, 10);
    assert.notEqual(segment.id, id);
    assert.equal((await request("/api/sprint/start", { method: "POST", cookie: b.cookie, body: { id: segment.id } })).status, 404);
    const starts = await Promise.all([0, 1].map(() => request("/api/sprint/start", { method: "POST", cookie: a.cookie, body: { id: segment.id } })));
    assert.ok(starts.every(s => s.status === 200));
    assert.equal(starts[0].data.startedAt, starts[1].data.startedAt);
    const answers = questions.slice(segment.offset, segment.offset + 10).map(q => ({ questionId: q.id, choice: q.correctChoice }));
    if (i) answers[0].choice = String((Number(answers[0].choice) + 1) % 4);
    const otherHalf = questions.slice(i ? 0 : 10, i ? 10 : 20).map(q => ({ questionId: q.id, choice: q.correctChoice }));
    assert.equal((await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id: segment.id, answers: otherHalf, elapsedMs: 1 } })).status, 400);
    assert.equal((await request("/api/sprint/history", { method: "POST", cookie: a.cookie, body: { id: segment.id, answers: answers.slice(0, 2).map(a => a.choice), seen: 3 } })).status, 200);
    const finished = await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id: segment.id, answers, elapsedMs: 1 } });
    assert.equal(finished.status, 200);
    assert.equal(finished.data.length, "quick");
    assert.equal(finished.data.count, 10);
    assert.equal(finished.data.correct, i ? 9 : 10);
    const stats = await faceSummary(db, a.account.id, deck);
    assert.equal(stats.seen, (i + 1) * 10);
    assert.equal(stats.correct, i ? 19 : 10);
    assert.equal(stats.wrong, i);
  }
  const [parent] = await db.query("select started_at,result from gsb_sprint_runs where id=$1", [id]);
  assert.equal(parent.started_at, null);
  assert.equal(parent.result, null);
  assert.equal((await request("/api/sprint/records?direction=mixed&length=short", { cookie: a.cookie })).data.bestScore, null);
  assert.equal((await request("/api/sprint/records?direction=mixed&length=quick", { cookie: a.cookie })).data.bestScore.score, 10999);
  assert.equal((await db.query("select * from gsb_progress where account_id=$1", [a.account.id])).length, 0, "Speed does not change Practice's spaced repetition");
});

test("small imported decks issue full quick segments without padding, and exclusions still reject them", async () => {
  const a = await login();
  for (const size of [4, 14]) {
    const small = { ...deck, cards: deck.cards.slice(0, size) };
    const full = await prepareSprint(db, a.account, small, "face", "short");
    assert.equal(full.count, size);
    assert.equal(full.segments.length, 1);
    const segment = full.segments[0];
    assert.equal(segment.count, Math.min(10, size));
    const [row] = await db.query("select doc,count from gsb_sprint_runs where id=$1", [segment.id]);
    assert.equal(row.count, segment.count);
    assert.equal(row.doc.questions.length, segment.count);
    assert.equal((await request("/api/sprint/start", { method: "POST", cookie: a.cookie, body: { id: segment.id } })).status, 200);
    const removed = row.doc.questions[0].target;
    await db.query("update gsb_people set excluded=true where id=$1", [removed]);
    try {
      const answers = full.questions.slice(0, segment.count).map(q => ({ questionId: q.id, choice: q.correctChoice }));
      assert.equal((await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id: segment.id, answers, elapsedMs: 1 } })).status, 410);
    } finally { await db.query("update gsb_people set excluded=false where id=$1", [removed]); }
  }
});

test("class length and active exclusions bound results and standings", async () => {
  const a = await login();
  const prepared = await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "name", length: "class" } });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.data.count, cards.length);
  await request("/api/sprint/start", { method: "POST", cookie: a.cookie, body: { id: prepared.data.id } });
  const answers = prepared.data.questions.map((q) => ({ questionId: q.id, choice: q.correctChoice }));
  const excludedId = cards[0].id;
  await db.query("update gsb_people set excluded=true where id=$1", [excludedId]);
  try {
    assert.equal((await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id: prepared.data.id, answers, elapsedMs: 1 } })).status, 410);
    const fresh = await request("/api/sprint/records?direction=name&length=class", { cookie: a.cookie });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.data.bestScore, null);
  } finally {
    await db.query("update gsb_people set excluded=false where id=$1", [excludedId]);
  }
});

test("quick and mixed sprints keep their own records, and consecutive rounds avoid recent faces", async () => {
  const a = await login();
  const seen = (data) => data.questions.map((q) => (q.direction === "face" ? q.image : q.choices[Number(q.correctChoice)].image));
  assert.equal((await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "face", length: "ten" } })).status, 400);
  const first = await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "mixed", length: "quick" } });
  assert.equal(first.status, 200);
  assert.equal(first.data.count, 10);
  assert.deepEqual([...new Set(first.data.questions.map((q) => q.direction))].sort(), ["face", "name"]);
  assert.ok(first.data.questions.every((q) => q.choices.length === 4 && /^[0-3]$/.test(q.correctChoice)));
  assert.ok(first.data.questions.filter((q) => q.direction === "name").every((q) => q.choices.every((c) => c.image) && q.image === null));
  // Only questions actually reached count: preparation alone does not mark the full deck seen.
  const unplayed = await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "mixed", length: "quick" } });
  assert.equal(unplayed.status, 200);
  await request("/api/sprint/start", { method: "POST", cookie: a.cookie, body: { id: first.data.id } });
  await request("/api/sprint/history", { method:"POST",cookie:a.cookie,body:{id:first.data.id,seen:10,answers:first.data.questions.map(q=>q.correctChoice)} });
  const second = await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "mixed", length: "quick" } });
  assert.equal(second.status, 200);
  const firstSeen = new Set(seen(first.data));
  assert.equal(seen(second.data).filter((image) => firstSeen.has(image)).length, 0, "the second quick round asks about ten people the first did not");
  const third = await request("/api/sprint/prepare", { method: "POST", cookie: a.cookie, body: { direction: "face", length: "short" } });
  assert.equal(third.status, 200);
  assert.equal(third.data.count, 20);
  await request("/api/sprint/start", { method: "POST", cookie: a.cookie, body: { id: second.data.id } });
  const answers = second.data.questions.map((q) => ({ questionId: q.id, choice: q.correctChoice }));
  const finished = await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id: second.data.id, answers, elapsedMs: 1 } });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.count, 10);
  assert.equal(finished.data.score, 10999);
  const quick = await request("/api/sprint/records?direction=mixed&length=quick", { cookie: a.cookie });
  assert.equal(quick.data.bestScore.score, 10999);
  assert.equal((await request("/api/sprint/records?direction=mixed&length=short", { cookie: a.cookie })).data.bestScore, null);
  assert.equal((await request("/api/sprint/records?direction=face&length=quick", { cookie: a.cookie })).data.bestScore, null);
});

test("a challenge shares one sequence, ranks finished players by score then time, and keeps each account to one run", async () => {
  const a = await login(), b = await login(), c = await login();
  assert.equal((await request("/api/profile", { method: "POST", cookie: a.cookie, body: { nickname: "Host One" } })).status, 200);
  assert.equal((await request("/api/profile", { method: "POST", cookie: b.cookie, body: { nickname: "Guest Two" } })).status, 200);
  assert.equal((await request("/api/sprint/challenge", { method: "POST", cookie: c.cookie, body: { direction: "face", length: "quick" } })).status, 400, "a nickname is required");
  assert.equal((await request("/api/sprint/challenge/ZZZZ/join", { method: "POST", cookie: a.cookie })).status, 404);
  const created = await request("/api/sprint/challenge", { method: "POST", cookie: a.cookie, body: { direction: "mixed", length: "quick" } });
  assert.equal(created.status, 201);
  const { code } = created.data;
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  assert.equal(created.data.count, 10);
  assert.equal(created.data.hostId, a.account.id);
  assert.equal(created.data.standings.length, 1);
  assert.equal(created.data.standings[0].status, "waiting");
  const joined = await request(`/api/sprint/challenge/${code.toLowerCase()}/join`, { method: "POST", cookie: b.cookie });
  assert.equal(joined.status, 200);
  assert.deepEqual(joined.data.questions.map((q) => q.id), created.data.questions.map((q) => q.id), "everyone plays the same sequence");
  assert.notEqual(joined.data.id, created.data.id);
  const again = await request(`/api/sprint/challenge/${code}/join`, { method: "POST", cookie: b.cookie });
  assert.equal(again.data.id, joined.data.id, "rejoining returns the same run");
  const play = async (who, run, wrong) => {
    assert.equal((await request("/api/sprint/start", { method: "POST", cookie: who.cookie, body: { id: run.id } })).status, 200);
    const answers = run.questions.map((q, i) => ({ questionId: q.id, choice: i < wrong ? String((Number(q.correctChoice) + 1) % 4) : q.correctChoice }));
    return request("/api/sprint/finish", { method: "POST", cookie: who.cookie, body: { id: run.id, answers, elapsedMs: 1 } });
  };
  assert.equal((await play(b, joined.data, 1)).status, 200);
  const view = await request(`/api/sprint/challenge/${code}`, { cookie: a.cookie });
  assert.equal(view.status, 200);
  assert.deepEqual(view.data.standings.map((s) => [s.nickname, s.status]), [["Guest Two", "finished"], ["Host One", "waiting"]]);
  assert.equal((await play(a, created.data, 0)).status, 200);
  const final = await request(`/api/sprint/challenge/${code}`, { cookie: b.cookie });
  assert.deepEqual(final.data.standings.map((s) => [s.nickname, s.result.correct]), [["Host One", 10], ["Guest Two", 9]]);
  const finished = await request(`/api/sprint/challenge/${code}/join`, { method: "POST", cookie: b.cookie });
  assert.equal(finished.data.result.correct, 9, "a finished run comes back with its result");
  assert.equal((await db.query("select count(*)::int as n from gsb_sprint_runs where challenge_code=$1", [code]))[0].n, 2);
  const records = await request("/api/sprint/records?direction=mixed&length=quick", { cookie: a.cookie });
  assert.equal(records.data.bestScore.correct, 10, "challenge runs count toward the normal speed records");
});

test("the test door lets a visitor in without an email only while it is open, and closing it ends every door session", async () => {
  const { closeDoorSwitch, doorAccounts, doorState, openDoorSwitch } = await import("../../server/gsb/auth.js");
  await closeDoorSwitch(db);
  // Door accounts from earlier runs of this schema are cleared so the counts below are exact.
  await db.query("delete from gsb_sprint_runs where account_id in (select id from gsb_accounts where email like 'door-%@door.invalid')");
  await db.query("delete from gsb_sessions where account_id in (select id from gsb_accounts where email like 'door-%@door.invalid')");
  await db.query("delete from gsb_accounts where email like 'door-%@door.invalid'");
  assert.equal((await request("/api/auth/door", { method: "POST", body: { code: "ABC234" } })).status, 404, "a closed door lets nobody in");
  const code = await openDoorSwitch(db);
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal((await doorState(db)).code, code);
  assert.equal((await request("/api/auth/door", { method: "POST", body: { code: "ZZZZZZ" } })).status, 404, "the wrong code is a closed door");
  const entered = await request("/api/auth/door", { method: "POST", body: { code: code.toLowerCase() } });
  assert.equal(entered.status, 200);
  assert.equal(entered.data.account.access, "door");
  assert.equal(entered.data.account.nickname, "");
  assert.ok(entered.cookie);
  const session = await request("/api/session", { cookie: entered.cookie });
  assert.equal(session.data.account.id, entered.data.account.id);
  assert.equal((await request("/api/profile", { method: "POST", cookie: entered.cookie, body: { nickname: "Door tester" } })).status, 200);
  assert.equal((await request("/api/sprint/prepare", { method: "POST", cookie: entered.cookie, body: { direction: "face", length: "quick" } })).status, 200, "a door account plays like any other");
  assert.deepEqual((await doorAccounts(db)).map((p) => p.nickname), ["Door tester"]);
  assert.equal(await closeDoorSwitch(db), 1);
  assert.equal((await request("/api/session", { cookie: entered.cookie })).data.account, null, "closing the door signs door accounts out");
  assert.equal((await request("/api/auth/door", { method: "POST", body: { code } })).status, 404);
  assert.equal(await doorState(db), null);
});

test("a duel has two doors, starts on the host's count for everyone who is in, shows live progress, and offers a rematch", async () => {
  const a = await login(), b = await login();
  for (const p of [a, b]) await request("/api/profile", { method: "POST", cookie: p.cookie, body: { nickname: `Duelist ${p.account.id.slice(0, 4)}` } });
  const created = await request("/api/sprint/challenge", { method: "POST", cookie: a.cookie, body: { direction: "face", length: "quick", mode: "duel" } });
  assert.equal(created.status, 201);
  let duel = created.data;
  assert.equal(duel.mode, "duel"); assert.equal(duel.choices, 2); assert.equal(duel.count, 10); assert.equal(duel.startsAt, null);
  assert.ok(duel.questions.every((q) => q.choices.length === 2 && /^[01]$/.test(q.correctChoice)));
  const joined = await request(`/api/sprint/challenge/${duel.code}/join`, { method: "POST", cookie: b.cookie });
  assert.equal(joined.status, 200);
  duel = (await request(`/api/sprint/challenge/${duel.code}/join`, {method:"POST",cookie:a.cookie})).data;
  assert.deepEqual(joined.data.questions, duel.questions);
  assert.equal((await request(`/api/sprint/challenge/${duel.code}/begin`, { method: "POST", cookie: b.cookie })).status, 403, "only the host starts the count");
  const ready = await request(`/api/sprint/challenge/${duel.code}/ready`, { method: "POST", cookie: b.cookie, body:{version:joined.data.selectionVersion} });
  assert.deepEqual(ready.data.standings.map((s) => [s.accountId === b.account.id, s.ready]).sort(), [[false, false], [true, true]]);
  const before = Date.now();
  const begun = await request(`/api/sprint/challenge/${duel.code}/begin`, { method: "POST", cookie: a.cookie, body:{version:duel.selectionVersion} });
  assert.equal(begun.status, 200);
  assert.ok(begun.data.startsAt >= before + 3000 && begun.data.startsAt <= Date.now() + 4500, "the count gives everyone four seconds");
  assert.ok(begun.data.standings.every((s) => s.status === "playing"), "both runs start on the same instant");
  const again = await request(`/api/sprint/challenge/${duel.code}/begin`, { method: "POST", cookie: a.cookie, body:{version:duel.selectionVersion} });
  assert.equal(again.data.startsAt, begun.data.startsAt, "a second press keeps the same count");
  assert.equal((await request(`/api/sprint/challenge/${duel.code}/progress`, { method: "POST", cookie: b.cookie, body: { index: 3, right: 5 } })).status, 400);
  await new Promise((r) => setTimeout(r, Math.max(0, begun.data.startsAt - Date.now() + 50)));
  await request(`/api/sprint/challenge/${duel.code}/progress`, { method: "POST", cookie: b.cookie, body: { index: 4, right: 3 } });
  // Delayed packets, repeated positions and impossible prefixes cannot regress the counter.
  for (const body of [{index:2,right:1},{index:4,right:2},{index:5,right:1},{index:5,right:5},{index:11,right:4}])
    await request(`/api/sprint/challenge/${duel.code}/progress`, {method:'POST',cookie:b.cookie,body});
  const view = await request(`/api/sprint/challenge/${duel.code}`, { cookie: a.cookie });
  assert.deepEqual(view.data.standings.find((s) => s.accountId === b.account.id).progress, { index: 4, right: 3 });
  const answers = duel.questions.map((q) => ({ questionId: q.id, choice: q.correctChoice }));
  const finished = await request("/api/sprint/finish", { method: "POST", cookie: b.cookie, body: { id: joined.data.id, answers, elapsedMs: 40 } });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.count, 10); assert.equal(finished.data.correct, 10);
  const after = await request(`/api/sprint/challenge/${duel.code}`, { cookie: a.cookie });
  const mine = after.data.standings.find((s) => s.accountId === b.account.id);
  assert.equal(mine.status, "finished"); assert.deepEqual(mine.progress, { index: 10, right: 10 }); assert.deepEqual(mine.missed, []);
  const wrongTwo = duel.questions.map((q, i) => ({ questionId: q.id, choice: i < 2 ? String(1 - Number(q.correctChoice)) : q.correctChoice }));
  assert.equal((await request("/api/sprint/finish", { method: "POST", cookie: a.cookie, body: { id: duel.id, answers: wrongTwo, elapsedMs: 60 } })).status, 200);
  assert.deepEqual((await request(`/api/sprint/challenge/${duel.code}`, { cookie: b.cookie })).data.standings.find((s) => s.accountId === a.account.id).missed, [0, 1], "the others can see which two the host missed");
  const rematch = await request(`/api/sprint/challenge/${duel.code}/rematch`, { method: "POST", cookie: a.cookie });
  assert.equal(rematch.status, 201); assert.equal(rematch.data.mode, "duel"); assert.notEqual(rematch.data.code, duel.code);
  assert.equal((await request(`/api/sprint/challenge/${duel.code}`, { cookie: b.cookie })).data.nextCode, rematch.data.code, "the old duel points at the rematch");
  const follow = await request(`/api/sprint/challenge/${duel.code}/rematch`, { method: "POST", cookie: b.cookie });
  assert.equal(follow.data.code, rematch.data.code, "the other player's rematch lands in the same new duel");
});
