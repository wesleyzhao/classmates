// Pure sprint score tests cover accuracy priority and exact answer logs.
import test from "node:test";
import assert from "node:assert/strict";
import { scoreSprint } from "../../public/kits/recognition/sprint.js";
import { sprintOptions } from "../../server/gsb/sprint.js";

const questions = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, correctChoice: String(i % 4) }));
const answers = questions.map((q) => ({ questionId: q.id, choice: q.correctChoice }));

test("sprint lengths reject inherited keys and non-string JSON values", () => {
  for (const length of ["constructor", "toString", "__proto__", ["quick"], null, {}])
    assert.throws(() => sprintOptions("face", length), error => /** @type {any} */ (error).status === 400);
  for (const length of ["quick", "short", "class"])
    assert.deepEqual(sprintOptions("face", length), { direction: "face", length });
});

test("every additional correct answer outranks the largest possible speed bonus", () => {
  const perfectSlow = scoreSprint(questions, answers, 160000);
  const nearlyPerfectFast = scoreSprint(questions, answers.map((a, i) => i ? a : { ...a, choice: "3" }), 1);
  assert.deepEqual(perfectSlow, { score: 20000, correct: 20, count: 20, elapsedMs: 160000, perfect: true });
  assert.ok(perfectSlow.score > nearlyPerfectFast.score);
  assert.equal(scoreSprint(questions, answers, 1).score, 20999);
  assert.equal(scoreSprint(questions, answers, 320000).score, 20000);
});

test("the result is based on ordered choices and bounded whole-run time", () => {
  assert.equal(scoreSprint(questions, answers.map((a) => ({ ...a, choice: String((Number(a.choice) + 1) % 4) })), 1000).score, 0);
  for (const invalid of [answers.slice(1), [...answers].reverse(), answers.map((a, i) => i === 0 ? { ...a, choice: "4" } : a)])
    assert.throws(() => scoreSprint(questions, invalid, 1000), /not valid/);
  for (const ms of [0, -1, 1.5, Infinity, 3600001])
    assert.throws(() => scoreSprint(questions, answers, ms), /not valid/);
});
