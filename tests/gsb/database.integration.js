// Real Postgres integration tests run only in a dedicated schema with synthetic content.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, latestDeck, loadDecks } from "../../server/gsb/db.js";
import {
  requestLink,
  issueLink,
  consumeLink,
  roomIdentity,
} from "../../server/gsb/auth.js";
import { classRooms } from "../../server/gsb/rooms.js";
import { saveNickname } from "../../server/gsb/profile.js";
if (process.env.NODE_ENV !== "test" || !process.env.GSB_TEST_SCHEMA)
  throw new Error("Use the isolated test schema.");
const db = database(),
  { query } = db;
const accounts = [];
for (let i = 0; i < 3; i++) {
  let link;
  await requestLink(
    db,
    `gsb-test-${randomUUID()}@stanford.edu`,
    async (email, url) => {
      link = new URLSearchParams(new URL(url).hash.slice(1)).get("token");
    },
  );
  const [a, b] = await Promise.allSettled([
    consumeLink(db, link),
    consumeLink(db, link),
  ]);
  assert.equal(
    [a, b].filter((r) => r.status === "fulfilled").length,
    1,
    "one-use login must survive concurrent clicks",
  );
  const result = [a, b].find((r) => r.status === "fulfilled");
  accounts.push(result.value.account);
  await query("update gsb_accounts set nickname=$2 where id=$1", [
    result.value.account.id,
    `Tester ${i}`,
  ]);
}
const service = classRooms(db.store);
let now = Date.now();
service.now = () => now;
const me = accounts[0],
  identity = roomIdentity(me);
const create = async () => {
  const room = await service.create({
    gameId: "together:mixed",
    account: me,
    name: "Tester 0",
  });
  await Promise.all(
    accounts
      .slice(1)
      .map((a, i) =>
        service.join(room.code, { account: a, name: `Tester ${i + 1}` }),
      ),
  );
  return room.code;
};
async function complete(code) {
  await service.act(code, identity, { id: randomUUID(), type: "room/start" });
  let row = await db.store.getRoom(code);
  now = row.doc.s.wakeAt;
  await service.snapshot(code, identity);
  for (let i = 0; i < 10; i++) {
    row = await db.store.getRoom(code);
    const q = row.doc.s._order[i];
    now += 1000;
    await Promise.all(
      accounts.map((a, n) =>
        service.act(code, roomIdentity(a), {
          id: randomUUID(),
          type: "answer",
          payload: {
            questionId: q.id,
            choice: String(
              n === 2
                ? (q.options.indexOf(q.target) + 1) % 4
                : q.options.indexOf(q.target),
            ),
          },
        }),
      ),
    );
    row = await db.store.getRoom(code);
    now = row.doc.s.wakeAt;
    await service.snapshot(code, identity);
    row = await db.store.getRoom(code);
    if (row.doc.phase === "playing") {
      now = row.doc.s.wakeAt;
      await service.snapshot(code, identity);
    }
  }
  return service.snapshot(code, identity);
}
test("nickname edits preserve identity and ratings while updating room versions and names", async () => {
  const code = await create();
  const before = await db.store.getRoom(code);
  await query("insert into gsb_ratings(account_id,mode,rating,games,wins) values($1,'race:name',1120,12,7)", [me.id]);
  const ratings = await query("select * from gsb_ratings where account_id=$1 order by mode", [me.id]);
  const nickname = "alexandra-finlay-jones";
  await saveNickname(db, me.id, nickname);
  const after = await db.store.getRoom(code);
  assert.equal(after.v, before.v + 1);
  assert.equal(after.doc.v, after.v);
  assert.deepEqual(after.doc.players, before.doc.players.map(p => p.id === me.id ? { ...p, name: nickname } : p));
  for (const key of ["secrets", "s", "chat", "hostId", "phase"])
    assert.deepEqual(after.doc[key], before.doc[key]);
  assert.equal((await query("select nickname from gsb_accounts where id=$1", [me.id]))[0].nickname, nickname);
  assert.deepEqual(await query("select * from gsb_ratings where account_id=$1 order by mode", [me.id]), ratings);
  assert.equal(await db.store.casRoom(code, before.v, before.doc), null, "stale writes cannot restore the old name");
  await service.join(code, { account: me, name: "Old name" });
  assert.equal((await db.store.getRoom(code)).doc.players.find(p => p.id === me.id).name, nickname);
  const newRoom = await service.create({ gameId: "together:mixed", account: me, name: nickname });
  const joined = await service.join(newRoom.code, { account: accounts[1], name: "another-long-classmate-name" });
  assert.equal(joined.room.players.find(p => p.id === me.id).name, nickname);
  assert.equal(joined.room.players.find(p => p.id === accounts[1].id).name, "another-long-classmate-name");
  await saveNickname(db, me.id, "Tester 0");
});
test("fixed seats and room policies prevent duplicate accounts and competitive rewinds", async () => {
  const code = await create();
  const outsider = roomIdentity({ id: "outsider" });
  await assert.rejects(service.snapshot(code, outsider), /Join this room/);
  await assert.rejects(service.act(code, outsider, {
    id: randomUUID(), type: "chat/send", payload: { text: "Uninvited" },
  }), /Join this room/);
  await service.join(code, { account: me, name: "Duplicate" });
  assert.equal((await db.store.getRoom(code)).doc.players.length, 3);
  await assert.rejects(
    service.act(code, identity, { type: "room/undo" }),
    /fixed rules/,
  );
  await service.act(code, identity, { type: "room/start" });
  await assert.rejects(
    service.join(code, { account: { id: "outsider" }, name: "Outsider" }),
    /started/,
  );
  await assert.rejects(
    service.act(code, identity, { type: "room/restart" }),
    /fixed rules/,
  );
});
test("concurrent completion atomically persists once and multiplayer Elo sums to zero", async () => {
  const code = await create(),
    snap = await complete(code);
  assert.equal(snap.room.phase, "over");
  await Promise.all(
    Array.from({ length: 5 }, () => service.snapshot(code, identity)),
  );
  const row = await db.store.getRoom(code),
    matches = await query("select * from gsb_matches where id=$1", [
      row.doc.s.$seed,
    ]);
  assert.equal(matches.length, 1);
  const ratings = await query(
    "select rating,games from gsb_ratings where account_id=any($1::text[]) and mode=$2",
    [accounts.map((a) => a.id), "together:mixed"],
  );
  assert.equal(ratings.length, 3);
  assert.ok(
    Math.abs(ratings.reduce((sum, r) => sum + r.rating, 0) - 3000) < 1e-7,
  );
  assert.ok(ratings.every((r) => r.games === 1));
  const before = ratings.map((r) => r.rating).sort();
  const again = await create();
  await complete(again);
  const next = await query(
    "select rating,games from gsb_ratings where account_id=any($1::text[]) and mode=$2",
    [accounts.map((a) => a.id), "together:mixed"],
  );
  assert.deepEqual(
    next.map((r) => r.rating).sort(),
    before,
    "same-day pairs must not rate twice",
  );
  assert.ok(next.every((r) => r.games === 2));
});
test("review retries are idempotent across simultaneous requests", async () => {
  const args = [
    `${me.id}:${randomUUID()}`,
    me.id,
    "fixture-0",
    "face",
    true,
    now,
  ];
  const rows = await Promise.all(
    Array.from({ length: 4 }, () =>
      query("select gsb_review($1,$2,$3,$4,$5,$6) as doc", args),
    ),
  );
  assert.ok(rows.every((r) => r[0].doc.reviews === 1));
});
test("misses persist and lapse the card, one memory per person covers both directions, and accounts stay separate", async () => {
  const person = "fixture-1", DAY = 86400000;
  const save = async (correct, time, direction = "face", account = me.id, id = randomUUID()) =>
    (await query("select gsb_review($1,$2,$3,$4,$5,$6) as doc", [`${account}:${id}`, account, person, direction, correct, time]))[0].doc;
  assert.equal((await save(true, now)).step, 1, "a new card climbs to the ten-minute step");
  const graduated = await save(true, now + 1, "name");
  assert.equal(graduated.state, "review"); assert.equal(graduated.interval, DAY); assert.equal(graduated.lastDirection, "name");
  assert.equal((await save(true, now + 2)).interval, Math.floor(DAY * 2.5));
  const id = randomUUID();
  const retries = await Promise.all(Array.from({ length: 4 }, () => save(false, now + 3, "name", me.id, id)));
  assert.ok(retries.every(p => p.stage === 0 && p.state === "relearning" && p.lapses === 1 && p.reviews === 4 && p.correct === 3), "a retried miss counts once");
  const [stored] = await query("select doc from gsb_progress where account_id=$1 and person_id=$2 and direction='both'", [me.id, person]);
  assert.equal(stored.doc.reviews - stored.doc.correct, 1);
  assert.deepEqual(stored.doc.missed, { face: 0, name: 1 });
  assert.equal(Number(stored.doc.ease), 2.3);
  assert.equal(stored.doc.dueAt, now + 60003);
  assert.equal(stored.doc.lastAt, now + 3);
  assert.equal((await query("select count(*)::int as n from gsb_progress where account_id=$1 and person_id=$2", [me.id, person]))[0].n, 1, "both directions share one row");
  const other = await save(false, now + 5, "face", accounts[1].id);
  assert.equal(other.reviews, 1);
  assert.equal(other.correct, 0);
  const recovered = await save(true, now + 6);
  assert.equal(recovered.reviews - recovered.correct, 1, "a later success must not erase the lifetime miss");
  assert.equal(recovered.state, "review"); assert.equal(recovered.interval, DAY);
  // Older per-direction rows seed the lifetime counts of a person's first shared review.
  await query("insert into gsb_progress values($1,'fixture-2','face',$2::jsonb),($1,'fixture-2','name',$3::jsonb)", [me.id, JSON.stringify({ reviews: 3, correct: 2 }), JSON.stringify({ reviews: 2, correct: 2 })]);
  const seeded = (await query("select gsb_review($1,$2,$3,$4,$5,$6) as doc", [`${me.id}:${randomUUID()}`, me.id, "fixture-2", "face", true, now + 7]))[0].doc;
  assert.equal(seeded.reviews, 6); assert.equal(seeded.correct, 5); assert.deepEqual(seeded.missed, { face: 1, name: 0 }); assert.equal(seeded.step, 1);
});
test("a live opt-out overrides the pinned revision and voids an active match", async () => {
  const code = await create();
  await service.act(code, identity, { type: "room/start" });
  const row = await db.store.getRoom(code),
    id = row.doc.s._order[0].target;
  await query("update gsb_people set excluded=true where id=$1", [id]);
  try {
    const snap = await service.snapshot(code, identity);
    assert.equal(snap.room.phase, "over");
    assert.equal(snap.view.void, true);
    const decks = await loadDecks(row.doc.game.deckIds);
    assert.ok(!Object.values(decks)[0].cards.some((c) => c.id === id));
    const matches = await query("select void from gsb_matches where id=$1", [
      row.doc.s.$seed,
    ]);
    assert.equal(matches[0].void, true);
  } finally {
    await query("update gsb_people set excluded=false where id=$1", [id]);
  }
});
test("eight concurrent participants join and answer without lost seats or scores", async () => {
  const extra = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    await query(
      "insert into gsb_accounts(id,email,nickname) values($1,$2,$3)",
      [id, `${id}@stanford.edu`, `Extra ${i}`],
    );
    extra.push({ id });
  }
  const all = [...accounts, ...extra],
    created = await service.create({
      gameId: "together:face",
      account: me,
      name: "Tester",
    });
  await Promise.all(
    all
      .slice(1)
      .map((a) => service.join(created.code, { account: a, name: "Tester" })),
  );
  await service.act(created.code, identity, { type: "room/start" });
  let row = await db.store.getRoom(created.code);
  assert.equal(row.doc.players.length, 8);
  now = row.doc.s.wakeAt;
  await service.snapshot(created.code, identity);
  row = await db.store.getRoom(created.code);
  const q = row.doc.s._order[0];
  now += 1000;
  await Promise.all(
    all.map((a) =>
      service.act(created.code, roomIdentity(a), {
        id: randomUUID(),
        type: "answer",
        payload: {
          questionId: q.id,
          choice: String(q.options.indexOf(q.target)),
        },
      }),
    ),
  );
  const snap = await service.snapshot(created.code, identity);
  assert.equal(snap.view.phase, "reveal");
  assert.ok(Array.isArray(snap.view.standings));
  assert.ok(snap.view.standings.every((p) => p.score > 1000));
  assert.equal(snap.view.answeredCount, 8);
});
test("expired email links cannot create accounts or sessions", async () => {
  const { hash } = await import("../../server/gsb/auth.js");
  const secret = "e".repeat(43),
    email = `expired-${randomUUID()}@stanford.edu`;
  await query(
    "insert into gsb_links(hash,email,expires_at,origin) values($1,$2,now()-interval '1 minute',$3) on conflict(hash) do update set expires_at=excluded.expires_at,origin=excluded.origin",
    [hash(secret), email, process.env.APP_ORIGIN],
  );
  await assert.rejects(consumeLink(db, secret), /expired/);
  assert.equal(
    (await query("select id from gsb_accounts where email=$1", [email])).length,
    0,
  );
});
test("links are origin-bound and an incorrect origin does not consume them", async () => {
  const origin = process.env.APP_ORIGIN;
  const link = await issueLink(db, `origin-${randomUUID()}@stanford.edu`);
  const secret = new URLSearchParams(new URL(link.url).hash.slice(1)).get(
    "token",
  );
  try {
    process.env.APP_ORIGIN = "https://unrelated.example";
    await assert.rejects(consumeLink(db, secret), /expired/);
  } finally {
    process.env.APP_ORIGIN = origin;
  }
  const result = await consumeLink(db, secret);
  assert.equal(result.account.access, "email");
});
test("owner preview is one-use, expires in a day, and does not verify an email", async () => {
  const { hash } = await import("../../server/gsb/auth.js");
  const email = `owner-${randomUUID()}@stanford.edu`;
  const link = await issueLink(db, email, "owner-preview");
  const secret = new URLSearchParams(new URL(link.url).hash.slice(1)).get(
    "token",
  );
  const result = await consumeLink(db, secret);
  assert.equal(result.account.access, "owner-preview");
  await assert.rejects(consumeLink(db, secret), /already used/);
  const [account] = await query(
    "select email_verified_at from gsb_accounts where id=$1",
    [result.account.id],
  );
  assert.equal(account.email_verified_at, null);
  const [session] = await query(
    "select purpose,extract(epoch from (expires_at-now())) as remaining from gsb_sessions where hash=$1",
    [hash(result.session)],
  );
  assert.equal(session.purpose, "owner-preview");
  assert.ok(
    Number(session.remaining) <= 86400 && Number(session.remaining) > 86000,
  );
  const emailLink = await issueLink(db, email);
  await consumeLink(
    db,
    new URLSearchParams(new URL(emailLink.url).hash.slice(1)).get("token"),
  );
  const [verified] = await query(
    "select email_verified_at from gsb_accounts where id=$1",
    [result.account.id],
  );
  assert.ok(verified.email_verified_at);
});
