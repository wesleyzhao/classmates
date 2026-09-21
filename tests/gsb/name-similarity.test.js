// Name-aware recognition distractors stay deterministic, varied, and based only on lexical cues.
import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../../public/kits/_lib/rng.js";
import {
  nameSimilarity,
  normalizeName,
  similarNameDistractors,
} from "../../public/kits/recognition/name-similarity.js";
import {
  questionFor,
  questions,
} from "../../public/kits/recognition/questions.js";

const names = [
  "Mara Lin",
  "Maria Lin",
  "Mira Linn",
  "Maya Ling",
  "Marco Lim",
  "Tobias Grant",
  "Evelyn Stone",
  "Quentin Brooks",
  "Zoe Patel",
  "Noah Williams",
  "Iris Chen",
  "Felix Carter",
];
const cards = names.map((answer, index) => ({
  id: `card-${index}`,
  answer,
  image: `/photo-${index}.jpg`,
}));
const enabled = { distractors: "similar-names" };

test("normalization handles Unicode equivalence and punctuation variants", () => {
  assert.equal(normalizeName("  José O’Neil–Smith "), "jose o'neil-smith");
  assert.equal(normalizeName("Jose\u0301 O'Neil-Smith"), "jose o'neil-smith");
  assert.equal(
    nameSimilarity("José O’Neil–Smith", "Jose\u0301 O'Neil-Smith"),
    1,
  );
  assert.ok(
    nameSimilarity("Anne-Marie O'Neil", "Ana-Marie O’Neal") >
      nameSimilarity("Anne-Marie O'Neil", "Quentin Brooks"),
  );
});

test("near first names outrank weak full-name initial matches", () => {
  assert.ok(
    nameSimilarity("Alessa Karbel", "Alissa Jones") >
      nameSimilarity("Alessa Karbel", "Avery Knight"),
  );
  assert.ok(
    nameSimilarity("Taylor Flint", "Taylor Grove") >
      nameSimilarity("Taylor Flint", "Tyson Ford"),
  );
});

test("first and last tokens contribute directly to similarity", () => {
  const target = "Mara Lindell";
  assert.ok(
    nameSimilarity(target, "Mara Stone") >
      nameSimilarity(target, "Marco Lowell"),
  );
  assert.ok(
    nameSimilarity(target, "Tara Lindel") >
      nameSimilarity(target, "Tara Brooks"),
  );
});

test("identical normalized names score exactly one", () => {
  assert.equal(nameSimilarity("  Ana-María O’Neil ", "Ana-Maria O'Neil"), 1);
});

test("similar-name mode strongly favors the lexical neighborhood", () => {
  const close = new Set(["card-1", "card-2", "card-3", "card-4"]);
  let closePicks = 0;
  for (let seed = 0; seed < 100; seed++) {
    const picked = similarNameDistractors(
      cards[0],
      cards,
      3,
      makeRng(String(seed), 0),
    );
    closePicks += picked.filter((card) => close.has(card.id)).length;
  }
  assert.ok(
    closePicks >= 240,
    `${closePicks}/300 choices came from close names`,
  );
});

test("low-confidence names use a broader seeded fallback", () => {
  const sparse = [
    "Qzxv Plmn",
    "Arthur Stone",
    "Bianca Reed",
    "Carlos Young",
    "Daphne Brooks",
    "Emilio Grant",
    "Farah Chen",
    "Gavin Price",
    "Helena Woods",
  ].map((answer, index) => ({ id: `sparse-${index}`, answer }));
  const sets = new Set(
    Array.from({ length: 24 }, (_, seed) =>
      similarNameDistractors(sparse[0], sparse, 3, makeRng(`sparse-${seed}`, 0))
        .map((card) => card.id)
        .sort()
        .join(","),
    ),
  );
  assert.ok(sets.size >= 4);
  assert.deepEqual(
    similarNameDistractors(sparse[0], sparse, 3, makeRng("repeat", 0)),
    similarNameDistractors(sparse[0], sparse, 3, makeRng("repeat", 0)),
  );
});

test("same seed is deterministic and different seeds vary the candidate set", () => {
  const run = (seed) =>
    questions(cards, 12, "mixed", makeRng(seed, 0), enabled);
  assert.deepEqual(run("repeatable"), run("repeatable"));
  const neighborhoods = new Set(
    Array.from({ length: 30 }, (_, i) =>
      questionFor(
        cards[0],
        cards,
        "face",
        makeRng(`vary-${i}`, 0),
        "q",
        enabled,
      )
        .options.filter((id) => id !== cards[0].id)
        .sort()
        .join(","),
    ),
  );
  assert.ok(neighborhoods.size >= 3);
});

test("every target remains covered with unique choices and bounded output", () => {
  const result = questions(cards, 100, "face", makeRng("coverage", 0), enabled);
  assert.equal(result.length, cards.length);
  assert.deepEqual(
    new Set(result.map((question) => question.target)),
    new Set(cards.map((card) => card.id)),
  );
  for (const question of result) {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.ok(question.options.includes(question.target));
  }
});

test("answer position is randomized across seeds", () => {
  const positions = new Set(
    Array.from({ length: 80 }, (_, seed) => {
      const question = questionFor(
        cards[0],
        cards,
        "face",
        makeRng(String(seed), 0),
        "q",
        enabled,
      );
      return question.options.indexOf(question.target);
    }),
  );
  assert.deepEqual(positions, new Set([0, 1, 2, 3]));
});

test("the minimum four-card deck produces four unique choices", () => {
  const tiny = cards.slice(0, 4);
  for (let seed = 0; seed < 20; seed++) {
    const result = questions(
      tiny,
      10,
      "mixed",
      makeRng(String(seed), 0),
      enabled,
    );
    assert.equal(result.length, 4);
    for (const question of result)
      assert.deepEqual(
        new Set(question.options),
        new Set(tiny.map((card) => card.id)),
      );
  }
});

test("visible answer labels stay unique when duplicate names have alternatives", () => {
  const duplicate = { ...cards[1], id: "duplicate", answer: cards[0].answer };
  const question = questionFor(
    cards[0],
    [...cards, duplicate],
    "face",
    makeRng("duplicates", 0),
    "q",
    enabled,
  );
  const byId = new Map(
    [...cards, duplicate].map((card) => [card.id, card.answer]),
  );
  assert.equal(
    new Set(question.options.map((id) => normalizeName(byId.get(id)))).size,
    4,
  );
});

test("default mode retains the existing seeded random selection", () => {
  const seed = "legacy";
  const rng = makeRng(seed, 0);
  const expectedId = `review-${Math.floor(rng() * 0x100000000).toString(36)}`;
  const expected = {
    id: expectedId,
    target: cards[0].id,
    direction: "face",
    options: rng
      .shuffle([cards[0], ...rng.shuffle(cards.slice(1)).slice(0, 3)])
      .map((card) => card.id),
  };
  assert.deepEqual(
    questionFor(cards[0], cards, "face", makeRng(seed, 0)),
    expected,
  );
});
