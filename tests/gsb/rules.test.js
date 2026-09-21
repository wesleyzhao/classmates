// Recognition, spaced learning, and tilt tests exercise fairness and retry boundaries without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import kit, { ranked } from "../../public/kits/recognition/kit.js";
import {
  questions,
  questionView,
  speedPoints,
} from "../../public/kits/recognition/questions.js";
import { makeRng } from "../../public/kits/_lib/rng.js";
import { keepMissing, pickDirection, review, studyOrder } from "../../public/gsb/learning.js";
import { createTiltDetector } from "../../public/gsb/tilt.js";
import { stanfordEmail } from "../../server/gsb/auth.js";
import { conformance } from "../lib/conformance.js";
const cards = Array.from({ length: 24 }, (_, i) => ({
  id: `person-${i}`,
  prompt: "Who is this?",
  answer: `Fictional Student ${i}`,
  image: `/test/photo-${i}.jpg`,
}));
const deck = { id: "synthetic", title: "Synthetic", version: 1, cards };
const game = {
  config: { mode: "together", direction: "mixed", cards: 10 },
  content: { decks: ["synthetic"] },
  decks: { synthetic: deck },
};
conformance(kit, {
  game,
  file: new URL("../../public/kits/recognition/kit.js", import.meta.url).href,
  script: [["@wait", 600000]],
});
function start(mode = "together") {
  const ctx = {
    ...game,
    config: { ...game.config, mode },
    rng: makeRng("fixed", 0),
    now: 10000,
    players: ["p1", "p2", "p3"].map((id, seat) => ({
      id,
      name: id,
      seat,
      avatar: "",
      connected: true,
      isHost: seat === 0,
      joinedAt: 0,
      lastSeen: 0,
    })),
    isHost: true,
    me: "p1",
    log() {},
    recent: [],
  };
  let state = kit.setup(ctx);
  ctx.now = state.wakeAt;
  state = kit.tick(state, ctx);
  return { ctx, state };
}
const answer = (state, ctx, who, correct = true) => {
  const p = state.players[who],
    q = state._order[state.mode === "race" ? p.index : state.index];
  return kit.reduce(
    state,
    {
      id: "test-action",
      playerId: ctx.me,
      type: "answer",
      payload: {
        questionId: q.id,
        choice: String(
          correct
            ? q.options.indexOf(q.target)
            : (q.options.indexOf(q.target) + 1) % 4,
        ),
      },
    },
    { ...ctx, me: who },
  );
};
test("recognition draws unique targets and exactly four unique options", () => {
  for (let seed = 0; seed < 100; seed++) {
    const q = questions(cards, 20, "mixed", makeRng(String(seed), 0));
    assert.equal(new Set(q.map((x) => x.target)).size, 20);
    for (const x of q) {
      assert.equal(new Set(x.options).size, 4);
      assert.ok(x.options.includes(x.target));
    }
  }
});
test("recognition can be told whom to ask about, in order, while distractors still draw from every card", () => {
  const wanted = cards.slice(3, 6).map((c) => c.id);
  const q = questions(cards, 3, "face", makeRng("t", 0), { targets: wanted });
  assert.deepEqual(q.map((x) => x.target), wanted);
  for (const x of q) {
    assert.equal(new Set(x.options).size, 4);
    assert.ok(x.options.includes(x.target));
  }
  assert.equal(questions(cards, 5, "name", makeRng("t", 0), { targets: wanted.concat(["missing-card"]) }).length, 3);
});
test("public question exposes only positional choice IDs, never target references", () => {
  const q = questions(cards, 1, "face", makeRng("s", 0))[0],
    v = questionView(q, cards);
  assert.deepEqual(
    v.choices.map((c) => c.id),
    ["0", "1", "2", "3"],
  );
  assert.ok(!("target" in v));
  assert.ok(!("options" in v));
  assert.ok(!JSON.stringify(v).includes("person-"));
});
test("shared answers stay private until everyone answers", () => {
  let { state, ctx } = start();
  ctx.now += 1000;
  state = answer(state, ctx, "p1");
  const text = JSON.stringify(kit.view(state, { ...ctx, me: "p2" }));
  assert.ok(!text.includes("points"));
  assert.equal(state.players.p1.score, 0);
  state = answer(state, ctx, "p2", false);
  state = answer(state, ctx, "p3");
  assert.equal(state.phase, "reveal");
  assert.ok(state.players.p1.score > 1000);
  assert.equal(state.players.p2.score, 0);
});
test("a shared answer is final and retrying cannot award additional points", () => {
  let { state, ctx } = start();
  state = answer(state, ctx, "p1");
  const copy = JSON.stringify(state);
  state = answer(state, ctx, "p1", false);
  assert.equal(JSON.stringify(state), copy);
});
test("speed rewards are bounded and monotonic, including clock extremes", () => {
  assert.equal(speedPoints(-1), 1500);
  assert.equal(speedPoints(15000), 1000);
  assert.equal(speedPoints(999999), 1000);
  for (let t = 0; t < 15000; t += 137)
    assert.ok(speedPoints(t) >= speedPoints(t + 137));
});
test("wrong race answers never advance, and guessed choices cannot be retried", () => {
  let { state, ctx } = start("race");
  state = answer(state, ctx, "p1", false);
  assert.equal(state.players.p1.index, 0);
  assert.throws(() => answer(state, ctx, "p1"), /moment/);
  ctx.now += 1501;
  assert.throws(() => answer(state, ctx, "p1", false), /moment/);
  state = answer(state, ctx, "p1");
  assert.equal(state.players.p1.index, 1);
  assert.equal(state.players.p2.index, 0);
});
test("stale question actions cannot answer the next race question", () => {
  let { state, ctx } = start("race");
  const q = state._order[0];
  state = answer(state, ctx, "p1");
  ctx.now += 2000;
  assert.throws(
    () =>
      kit.reduce(
        state,
        {
          id: "test-action",
          playerId: ctx.me,
          type: "answer",
          payload: { questionId: q.id, choice: "0" },
        },
        ctx,
      ),
    /moved on/,
  );
});
test("race finishers precede unfinished players and equal finish times tie", () => {
  let { state, ctx } = start("race");
  for (let i = 0; i < 10; i++) {
    ctx.now += 2000;
    state = answer(state, ctx, "p1");
    state = answer(state, ctx, "p2");
  }
  const results = ranked(state);
  assert.equal(results[0].rank, 1);
  assert.equal(results[1].rank, 1);
  assert.equal(results[2].rank, 3);
  assert.equal(state.endsAt, ctx.now + 30000);
  ctx.now = state.endsAt;
  state = kit.tick(state, ctx);
  assert.equal(state.phase, "over");
});
test("shared deadlines close answers and eventually complete an idle game", () => {
  let { state, ctx } = start();
  let ticks = 0;
  while (state.wakeAt !== null) {
    ctx.now = state.wakeAt;
    state = kit.tick(state, ctx);
    assert.ok(++ticks < 50);
  }
  assert.equal(state.phase, "over");
  assert.deepEqual(kit.summary(state).winnerIds, []);
});
test("late or unknown participants cannot submit answers", () => {
  const { state, ctx } = start();
  assert.throws(
    () =>
      kit.reduce(
        state,
        { id: "test-action", playerId: ctx.me, type: "answer", payload: {} },
        { ...ctx, me: "outsider" },
      ),
    /not in/,
  );
});
test("spaced repetition climbs two learning steps, graduates to a day, then grows by the ease", () => {
  const DAY = 86400000;
  let p = review(null, true, 100, "face");
  assert.equal(p.state, "learning"); assert.equal(p.step, 1); assert.equal(p.dueAt, 100 + 600000);
  p = review(p, true, 200, "name");
  assert.equal(p.state, "review"); assert.equal(p.interval, DAY); assert.equal(p.dueAt, 200 + DAY); assert.equal(p.stage, 2);
  p = review(p, true, 300);
  assert.equal(p.interval, Math.floor(DAY * 2.5)); assert.equal(p.ease, 2.5);
  for (let i = 0; i < 12; i++) p = review(p, true, 400 + i);
  assert.equal(p.interval, 180 * DAY, "half a year is the longest wait");
  assert.equal(p.reviews, 15); assert.equal(p.correct, 15); assert.equal(p.lapses, 0);
});
test("a missed review is a lapse: the ease drops, the card relearns from a minute and comes back at a day", () => {
  const DAY = 86400000;
  let p = review(review(null, true, 0), true, 1);
  p = review(p, true, 2);
  p = review(p, false, 200, "name");
  assert.equal(p.state, "relearning"); assert.equal(p.lapses, 1); assert.equal(p.ease, 2.3);
  assert.equal(p.dueAt, 60200); assert.equal(p.stage, 0); assert.equal(p.correct, 3); assert.equal(p.reviews, 4);
  assert.deepEqual(p.missed, { face: 0, name: 1 });
  p = review(p, true, 300, "name");
  assert.equal(p.state, "review"); assert.equal(p.interval, DAY);
  p = review(p, true, 400);
  assert.equal(p.interval, Math.floor(DAY * 2.3), "the lowered ease slows the card down for good");
  let leech = null;
  for (let i = 0; i < 8; i++) leech = review(leech, false, i, i % 2 ? "face" : "name");
  assert.equal(leech.leech, true);
  assert.equal(leech.ease, 2.5, "misses in learning never touch the ease");
});
test("each ask goes the weaker way, otherwise the other way from last time, and new cards take turns", () => {
  assert.equal(pickDirection(null, 0), "face");
  assert.equal(pickDirection(null, 1), "name");
  assert.equal(pickDirection({ lastDirection: "face", missed: { face: 0, name: 0 } }), "name");
  assert.equal(pickDirection({ lastDirection: "name", missed: { face: 0, name: 0 } }), "face");
  assert.equal(pickDirection({ lastDirection: "name", missed: { face: 2, name: 1 } }), "face");
  assert.equal(pickDirection({ lastDirection: "face", missed: { face: 0, name: 3 } }), "name");
  const cards = [{ id: "a", answer: "A", image: "a.svg" }, { id: "b", answer: "B", image: "b.svg" }, { id: "c", answer: "C", image: "c.svg" }];
  const list = keepMissing({ a: { missed: { face: 1, name: 0 }, lastAt: 5 }, b: { missed: { face: 4, name: 4 }, leech: true, lastAt: 1 }, c: { missed: { face: 0, name: 0 } } }, cards);
  assert.deepEqual(list.map((m) => [m.name, m.misses, m.leech]), [["B", 8, true], ["A", 1, false]]);
});
test("full-deck traversal includes every card, prioritizing due and unseen cards", () => {
  assert.deepEqual(
    studyOrder(
      ["future", "new", "due"],
      { future: { dueAt: 300 }, due: { dueAt: 1 } },
      100,
    ),
    ["due", "new", "future"],
  );
});

test("study order preserves the input shuffle within equal-priority cards", () => {
  assert.deepEqual(studyOrder(["z", "a", "m"], {}, 100), ["z", "a", "m"]);
  assert.deepEqual(
    studyOrder(["z", "a", "m"], {
      z: { dueAt: 200 }, a: { dueAt: 200 }, m: { dueAt: 200 },
    }, 100),
    ["z", "a", "m"],
  );
});
test("tilt requires calibration, a neutral position, and a dwell", () => {
  const t = createTiltDetector();
  assert.equal(t.sample(0, 0, 0), null);
  assert.equal(t.sample(0, 0, 10), null);
  assert.equal(t.sample(0, 30, 20), null);
  assert.equal(t.sample(0, 30, 369), null);
  assert.equal(t.sample(0, 30, 370), 1);
  assert.equal(t.sample(0, 30, 800), null);
  t.sample(0, 0, 810);
  t.sample(-30, 0, 820);
  assert.equal(t.sample(-30, 0, 1170), 2);
});
test("sensor gaps and unavailable readings do not cause accidental selections", () => {
  const t = createTiltDetector();
  t.sample(0, 0, 0);
  t.sample(0, 0, 1);
  t.sample(0, 30, 10);
  assert.equal(t.sample(0, 30, 2000), null);
  assert.equal(t.sample(null, null, 2300), null);
  t.reset();
  assert.equal(t.sample(0, 30, 4000), null);
});
test("new questions retain the neutral calibration and require recentering", () => {
  const t = createTiltDetector();
  t.sample(40, 0, 0);
  t.sample(40, 0, 1);
  t.sample(40, 30, 10);
  assert.equal(t.sample(40, 30, 360), 1);
  t.rearm();
  assert.equal(t.sample(40, 30, 400), null);
  assert.equal(t.sample(40, 30, 800), null);
  t.sample(40, 0, 900);
  t.sample(40, -30, 1000);
  assert.equal(t.sample(40, -30, 1350), 0);
});
test("invalid sensor readings break dwell and beta wrapping stays near neutral", () => {
  const t = createTiltDetector();
  t.sample(179, 0, 0);
  t.sample(-179, 0, 1);
  assert.equal(t.sample(-179, 0, 400), null);
  t.sample(179, 30, 410);
  t.sample(null, null, 600);
  assert.equal(t.sample(179, 30, 800), null);
  assert.equal(t.sample(179, 30, 1150), 1);
});
test("exact Stanford domain accepts aliases and rejects lookalikes or multiple addresses", () => {
  assert.equal(
    stanfordEmail(" Person+game@STANFORD.EDU "),
    "person+game@stanford.edu",
  );
  for (const x of [
    "person@gsb.stanford.edu",
    "person@stanford.edu.evil.com",
    "person@stanford.com",
    "a@stanford.edu,b@stanford.edu",
    "a\n@stanford.edu",
    ".a@stanford.edu",
    "a..b@stanford.edu",
  ])
    assert.throws(() => stanfordEmail(x));
});
test("room summaries do not leak another racer's wrong choices or cooldown", () => {
  let { state, ctx } = start("race");
  state = answer(state, ctx, "p1", false);
  for (const row of kit.summary(state).scores)
    assert.deepEqual(Object.keys(row).sort(), [
      "correct",
      "playerId",
      "rank",
      "score",
    ]);
  assert.deepEqual(kit.view(state, { ...ctx, me: "p2" }).mine["wrong"], []);
});
test("production never enables the local email outbox and uses a secure host-only cookie", async () => {
  const { emailReady, sessionCookie } = await import(
    "../../server/gsb/auth.js"
  );
  const keys = [
    "VERCEL",
    "NODE_ENV",
    "GSB_TEST_EMAIL_OUTBOX",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "DESCOPE_PROJECT_ID",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.VERCEL = "1";
    process.env.NODE_ENV = "test";
    process.env.GSB_TEST_EMAIL_OUTBOX = "/tmp/never-use";
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.DESCOPE_PROJECT_ID;
    assert.equal(emailReady(), false);
    let cookie = "";
    sessionCookie(
      {
        setHeader(key, value) {
          cookie = value;
        },
      },
      "opaque",
    );
    for (const part of [
      "__Host-gsb=",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
    ])
      assert.ok(cookie.includes(part));
    assert.ok(!cookie.includes("Domain="));
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
