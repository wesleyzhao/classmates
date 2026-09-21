// Exercise practice durability and ordering without a browser or real class data.
import test from "node:test";
import assert from "node:assert/strict";
import { createPracticeReviews, mergePracticeProgress } from "../../public/gsb/practice-reviews.js";
const makeStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
};
const missed = { id: "12345678-1234-1234-1234-123456789abc", personId: "fixture-0", direction: "face", correct: false };

test("a missed review survives reload with the same id and no private content", async () => {
  const storage = makeStorage();
  const first = createPracticeReviews("account-a", { storage, send: async () => { throw new Error("offline"); } });
  first.add({ ...missed, questionId: "question-1", choice: "2" });
  await first.retry();
  assert.deepEqual(JSON.parse(storage.getItem("gsb-practice-pending:account-a")), [missed]);
  first.suspend();
  const calls = [];
  const restored = createPracticeReviews("account-a", { storage, send: async review => { calls.push(review); return {}; } });
  await restored.retry();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, missed.id);
  assert.equal(calls[0].correct, false);
  assert.equal(restored.pending.size, 0);
  assert.equal(storage.getItem("gsb-practice-pending:account-a"), null);
});

test("queued wrong and correct reviews save in order without blocking input", async () => {
  /** @type {() => void} */
  let finish = () => assert.fail("The first review must start before it can finish.");
  const calls = [];
  const queue = createPracticeReviews("a", { send: async review => {
    calls.push(review.correct);
    if (calls.length === 1) await new Promise(resolve => { finish = () => resolve(); });
    return {};
  } });
  queue.add({ ...missed });
  queue.add({ ...missed, id: "22345678-1234-1234-1234-123456789abc", correct: true });
  assert.equal(queue.pending.size, 2);
  assert.deepEqual(calls, [false]);
  finish();
  await queue.retry();
  assert.deepEqual(calls, [false, true]);
  assert.equal(queue.pending.size, 0);
});

test("sign-out stops queued sends and late updates; another account cannot restore them", async () => {
  const storage = makeStorage(), changes = [];
  /** @type {(value: any) => void} */
  let finish = () => assert.fail("The review must start before sign-out.");
  const queue = createPracticeReviews("a", { storage, onChange: event => changes.push(event),
    send: () => new Promise(resolve => { finish = resolve; }),
  });
  queue.add({ ...missed });
  const saving = queue.retry();
  queue.suspend();
  finish({ progress: {} });
  await saving;
  assert.equal(changes.length, 1, "only the initial saving event, no late result");
  const otherCalls = [];
  const other = createPracticeReviews("b", { storage, send: async review => otherCalls.push(review) });
  await other.retry();
  assert.deepEqual(otherCalls, []);
  assert.equal(JSON.parse(storage.getItem("gsb-practice-pending:a"))[0].correct, false);
});

test("invalid storage and storage denial cannot prevent a review saving", async () => {
  const calls = [];
  const queue = createPracticeReviews("a", { storage: {
    getItem: () => JSON.stringify([null, { ...missed, correct: "false" }, { ...missed, direction: "unknown" }]),
    setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("denied"); },
  }, send: async review => calls.push(review.correct) });
  assert.equal(queue.pending.size, 0);
  queue.add({ ...missed });
  await queue.retry();
  assert.deepEqual(calls, [false]);
});

test("an excluded card cannot block the next queued review", async () => {
  const calls = [];
  const queue = createPracticeReviews("a", { send: async review => {
    calls.push(review.personId);
    if (review.personId === "fixture-0") throw Object.assign(new Error("excluded"), { status: 404 });
    return {};
  } });
  queue.add({ ...missed });
  queue.add({ ...missed, id: "22345678-1234-1234-1234-123456789abc", personId: "fixture-1" });
  await queue.retry();
  assert.deepEqual(calls, ["fixture-0", "fixture-1"]);
  assert.equal(queue.pending.size, 0);
});

test("late progress fetches cannot erase a saved miss or progress in the other direction", () => {
  const current = { "face:fixture-0": { reviews: 2, correct: 1 }, "name:fixture-0": { reviews: 1, correct: 1 } };
  const merged = mergePracticeProgress(current, { "face:fixture-0": { reviews: 1, correct: 1 } });
  assert.deepEqual(merged, current);
  assert.deepEqual(mergePracticeProgress(current, { "face:fixture-0": { reviews: 3, correct: 2 } })["face:fixture-0"], { reviews: 3, correct: 2 });
});
