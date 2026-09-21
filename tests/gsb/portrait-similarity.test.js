// Neutral portrait distractors remain private, deterministic, varied, and resilient to exclusions.
import test from "node:test";
import assert from "node:assert/strict";
import { makeRng } from "../../public/kits/_lib/rng.js";
import { questionFor } from "../../public/kits/recognition/questions.js";
import {
  buildPortraitPeers,
  portraitSimilarity,
} from "../../public/kits/recognition/portrait-similarity.js";

const a = [
  "short",
  "straight",
  "none",
  "none",
  "front",
  "head",
  "plain",
  "smile",
];
const b = [
  "short",
  "straight",
  "none",
  "none",
  "front",
  "head",
  "indoor",
  "neutral",
];
const u = [
  "unknown",
  "unknown",
  "unknown",
  "unknown",
  "unknown",
  "unknown",
  "unknown",
  "unknown",
];
const cards = Array.from({ length: 24 }, (_, i) => ({
  id: `p${i}`,
  answer: `Person ${i}`,
  image: `/p${i}.jpg`,
  portraitPeers: Array.from({ length: 16 }, (__, j) => `p${(i + j + 1) % 24}`),
}));

test("unknowns add no agreement and lower confidence", () => {
  assert.equal(portraitSimilarity(a, a).score, 1);
  assert.equal(portraitSimilarity(a, u).score, 0);
  assert.equal(portraitSimilarity(a, u).confidence, 0);
  assert.ok(portraitSimilarity(a, b).score > 0.8);
});

test("covered hair adds no evidence against bald and ambiguous portraits use fallback", () => {
  const covered = [
    "covered",
    "unknown",
    "unknown",
    "unknown",
    "front",
    "head",
    "plain",
    "smile",
  ];
  const bald = [
    "bald",
    "unknown",
    "unknown",
    "unknown",
    "front",
    "head",
    "plain",
    "smile",
  ];
  assert.equal(
    portraitSimilarity(covered, bald).confidence,
    portraitSimilarity(covered, covered).confidence,
  );
  const small = cards.slice(0, 4);
  const reviews = Object.fromEntries(
    small.map((card, i) => [card.id, i === 0 ? u : a]),
  );
  const peers = buildPortraitPeers(small, reviews);
  assert.deepEqual(peers.p0, []);
  assert.ok(peers.p1.every((id) => id !== "p0"));
});

test("covered hair supplies no match evidence and facial hair drives its peers", () => {
  const coveredBeard = [
    "covered",
    "unknown",
    "none",
    "beard",
    "front",
    "head",
    "plain",
    "smile",
  ];
  const coveredClean = [
    "covered",
    "unknown",
    "none",
    "none",
    "front",
    "head",
    "plain",
    "smile",
  ];
  const shortBeard = [
    "short",
    "unknown",
    "none",
    "beard",
    "front",
    "head",
    "plain",
    "smile",
  ];
  const sameCovered = portraitSimilarity(coveredBeard, coveredBeard);
  assert.ok(sameCovered.confidence < 1);
  assert.deepEqual(sameCovered, portraitSimilarity(coveredBeard, shortBeard));
  assert.ok(
    portraitSimilarity(coveredBeard, shortBeard).score >
      portraitSimilarity(coveredBeard, coveredClean).score,
  );
  const sample = [
    { id: "target", answer: "Target" },
    { id: "clean", answer: "Clean" },
    { id: "beard", answer: "Beard" },
  ];
  const peers = buildPortraitPeers(
    sample,
    {
      target: coveredBeard,
      clean: coveredClean,
      beard: shortBeard,
    },
    2,
  );
  assert.equal(peers.target[0], "beard");
});

test("visual similarity sorts before lexical tie-breaking", () => {
  const small = cards.slice(0, 3);
  const reviews = {
    p0: a,
    p1: b,
    p2: [
      "long",
      "curly",
      "clear",
      "beard",
      "profile",
      "full",
      "outdoor",
      "neutral",
    ],
  };
  const peers = buildPortraitPeers(small, reviews, 2, () => 1);
  assert.equal(peers.p0[0], "p1");
});

test("portrait questions are deterministic, unique, and keep randomized target position", () => {
  const make = (seed) =>
    questionFor(cards[0], cards, "face", makeRng(seed, 0), "q", {
      distractors: "similar-portraits",
    });
  assert.deepEqual(make("same"), make("same"));
  const positions = new Set(
    Array.from({ length: 20 }, (_, i) => make(String(i)).options.indexOf("p0")),
  );
  assert.ok(positions.size > 1);
  assert.equal(new Set(make("x").options).size, 4);
});

test("rank weighting varies peers and ignores absent or duplicate IDs", () => {
  const target = {
    ...cards[0],
    portraitPeers: ["gone", "p1", "p1", ...cards[0].portraitPeers],
  };
  const seen = new Set(
    Array.from({ length: 30 }, (_, i) =>
      questionFor(target, cards, "face", makeRng(String(i), 0), "q", {
        distractors: "similar-portraits",
      }).options.filter((x) => x !== "p0"),
    ).flat(),
  );
  assert.ok(seen.size > 3);
  assert.ok(!seen.has("gone"));
});

test("missing peers falls back to name selection with full coverage", () => {
  for (const card of cards) {
    const q = questionFor(
      { ...card, portraitPeers: undefined },
      cards,
      "face",
      makeRng(card.id, 0),
      "q",
      { distractors: "similar-portraits" },
    );
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(card.id));
  }
});
