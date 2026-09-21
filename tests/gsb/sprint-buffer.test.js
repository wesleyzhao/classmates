// A prepared set is reusable until play starts; overlapping alternatives never become the next round.
import test from "node:test";
import assert from "node:assert/strict";
import { createSprintBuffer } from "../../public/gsb/sprint-buffer.js";

const source = () => ({
  id: "whole", direction: "mixed", length: "short", count: 20, revision: "fixture",
  questions: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, choices: [] })),
  records: { bestScore: { score: 20999 } }, quickRecords: { bestScore: { score: 10999, elapsedMs: 1000 } },
  segments: [0, 10].map((offset, i) => ({ id: `half${i}`, length: "quick", count: 10, offset })),
});
test("20 to 10 to 20 changes only the selection, preserving both ready halves", () => {
  const data = source(), buffer = createSprintBuffer(data);
  assert.equal(buffer.get("short").id, "whole");
  const first = buffer.get("quick");
  assert.equal(first.id, "half0");
  assert.equal(first.mediaOffset, 0);
  assert.deepEqual(first.questions, data.questions.slice(0, 10));
  assert.equal(first.records.bestScore.score, 10999);
  assert.equal(buffer.get("short").records.bestScore.score, 20999);
  assert.equal(buffer.get("quick"), first);
  buffer.consume(first.id);
  assert.equal(buffer.get("short"), null);
  const second = buffer.get("quick");
  assert.equal(second.id, "half1");
  assert.equal(second.mediaOffset, 10);
  assert.deepEqual(second.questions, data.questions.slice(10));
  buffer.consume(second.id);
  assert.equal(buffer.get("quick"), null);
});
test("playing all 20 consumes both overlapping alternatives; a plain quick run is supported", () => {
  const buffer = createSprintBuffer(source());
  buffer.consume("whole");
  assert.equal(buffer.get("quick"), null);
  assert.equal(buffer.get("short"), null);
  const quick = createSprintBuffer({ id: "quick", length: "quick", count: 4, questions: source().questions.slice(0, 4) });
  assert.equal(quick.get("short"), null);
  assert.equal(quick.get("quick").count, 4);
  quick.consume("quick");
  assert.equal(quick.get("quick"), null);
});

test("a ready second half keeps newly confirmed personal records and refreshed class standings", () => {
  const buffer = createSprintBuffer(source());
  const result = { score: 10999, perfect: true, elapsedMs: 900 };
  buffer.consume("half0");
  buffer.record("half0", result);
  assert.equal(buffer.get("quick").records.bestScore, result);
  assert.equal(buffer.get("quick").records.fastestPerfect, result);
  assert.equal(buffer.get("short"), null);
  buffer.record("half1", { score: 9900, perfect: false, elapsedMs: 100 });
  assert.equal(buffer.get("quick").records.bestScore, result);
  const fresh = { bestScore: result, fastestPerfect: result, leaders: [{ nickname: "A" }] };
  buffer.updateRecords("quick", fresh);
  assert.equal(buffer.get("quick").records, fresh);
});
