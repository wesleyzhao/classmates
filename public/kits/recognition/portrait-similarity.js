// Neutral portrait-review features rank distractors without retaining annotations at runtime.
import { similarNameDistractors } from "./name-similarity.js";

/** @type {Array<{name:string, values:string[], weight:number}>} */
export const PORTRAIT_FIELDS = [
  {
    name: "hairLength",
    values: ["short", "medium", "long", "bald", "covered", "unknown"],
    weight: 5,
  },
  {
    name: "hairTexture",
    values: ["straight", "wavy", "curly", "unknown"],
    weight: 4,
  },
  {
    name: "eyewear",
    values: ["none", "clear", "sunglasses", "unknown"],
    weight: 5,
  },
  {
    name: "facialHair",
    values: ["none", "stubble", "beard", "mustache", "unknown"],
    weight: 5,
  },
  {
    name: "pose",
    values: ["front", "turned", "profile", "unknown"],
    weight: 1.5,
  },
  {
    name: "framing",
    values: ["head", "upper", "full", "unknown"],
    weight: 1.5,
  },
  {
    name: "background",
    values: ["plain", "indoor", "outdoor", "unknown"],
    weight: 0.35,
  },
  { name: "expression", values: ["smile", "neutral", "unknown"], weight: 0.25 },
];

/** Validate one exact, positional review tuple and reject added fields by construction. */
export function validatePortraitTuple(tuple, where = "portrait") {
  if (!Array.isArray(tuple) || tuple.length !== PORTRAIT_FIELDS.length)
    throw new Error(`${where} must be an eight-value review tuple.`);
  tuple.forEach((value, i) => {
    if (!PORTRAIT_FIELDS[i].values.includes(value))
      throw new Error(`${where} has invalid ${PORTRAIT_FIELDS[i].name}.`);
  });
  return tuple;
}

const adjacent = (field, a, b) => {
  const orders = {
    hairLength: ["bald", "short", "medium", "long"],
    hairTexture: ["straight", "wavy", "curly"],
    facialHair: ["none", "stubble", "mustache", "beard"],
  };
  const order = orders[field];
  const ai = order?.indexOf(a) ?? -1,
    bi = order?.indexOf(b) ?? -1;
  return ai >= 0 && bi >= 0 && Math.abs(ai - bi) === 1;
};

/** Require enough directly visible subject evidence before visual ranking. */
export function hasPortraitEvidence(tuple) {
  validatePortraitTuple(tuple);
  return (
    PORTRAIT_FIELDS.slice(0, 4).reduce(
      (sum, field, i) =>
        sum +
        (tuple[i] === "unknown" ||
        (field.name === "hairLength" && tuple[i] === "covered")
          ? 0
          : field.weight),
      0,
    ) >= 8
  );
}

/** Weighted similarity; unknown removes evidence and lowers confidence rather than matching. */
export function portraitSimilarity(left, right) {
  validatePortraitTuple(left, "left portrait");
  validatePortraitTuple(right, "right portrait");
  let earned = 0,
    available = 0;
  PORTRAIT_FIELDS.forEach(({ name: field, weight }, i) => {
    const a = left[i],
      b = right[i];
    if (
      a === "unknown" ||
      b === "unknown" ||
      (field === "hairLength" && (a === "covered" || b === "covered"))
    )
      return;
    available += weight;
    if (a === b) earned += weight;
    else if (adjacent(field, a, b)) earned += weight * 0.35;
  });
  const total = PORTRAIT_FIELDS.reduce((sum, x) => sum + x.weight, 0);
  return {
    score: available ? earned / available : 0,
    confidence: available / total,
  };
}

/** Build ordered opaque neighbors. Visual score dominates; lexical score only breaks ties. */
export function buildPortraitPeers(
  cards,
  reviews,
  limit = 16,
  nameScore = (/** @type {string} */ _a, /** @type {string} */ _b) => 0,
) {
  return Object.fromEntries(
    cards.map((card) => {
      const own = reviews[card.id];
      if (!own) throw new Error(`Missing portrait review for ${card.id}.`);
      validatePortraitTuple(own, card.id);
      if (!hasPortraitEvidence(own)) return [card.id, []];
      const peers = cards
        .filter((x) => x.id !== card.id)
        .map((candidate) => {
          const review = reviews[candidate.id];
          if (!review)
            throw new Error(`Missing portrait review for ${candidate.id}.`);
          if (!hasPortraitEvidence(review)) return null;
          const visual = portraitSimilarity(own, review);
          return {
            id: candidate.id,
            visual,
            lexical: nameScore(card.answer, candidate.answer),
          };
        })
        .filter(Boolean)
        .sort(
          (a, b) =>
            b.visual.score * b.visual.confidence -
              a.visual.score * a.visual.confidence ||
            b.visual.score - a.visual.score ||
            b.visual.confidence - a.visual.confidence ||
            b.lexical - a.lexical ||
            a.id.localeCompare(b.id),
        );
      return [card.id, peers.slice(0, limit).map((x) => x.id)];
    }),
  );
}

const visibleName = (value) =>
  String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US");

/** Seeded rank-weighted peer sampling with diversity, exclusions, and lexical fallback. */
export function similarPortraitDistractors(
  card,
  cards,
  count,
  rng,
  options = {},
) {
  const byId = new Map(cards.map((x) => [x.id, x]));
  const recent = new Set(options.recentIds ?? []),
    targetName = visibleName(card.answer);
  const peers = [
    ...new Set(Array.isArray(card.portraitPeers) ? card.portraitPeers : []),
  ]
    .map((id, rank) => ({ candidate: byId.get(id), rank }))
    .filter(({ candidate }) => candidate && candidate.id !== card.id);
  const uniqueNames = peers.filter(
    ({ candidate }) => visibleName(candidate.answer) !== targetName,
  );
  let pool = uniqueNames.length >= count ? uniqueNames : peers;
  const chosen = [];
  while (chosen.length < count && pool.length) {
    const weights = pool.map(
      ({ candidate, rank }) =>
        (1 / (2 + rank)) * (recent.has(candidate.id) ? 0.2 : 1),
    );
    let cursor = rng() * weights.reduce((a, b) => a + b, 0),
      at = 0;
    while (at < weights.length - 1 && (cursor -= weights[at]) >= 0) at++;
    chosen.push(pool[at].candidate);
    pool = pool.filter(
      (x) =>
        x.candidate.id !== chosen.at(-1).id &&
        visibleName(x.candidate.answer) !== visibleName(chosen.at(-1).answer),
    );
  }
  if (chosen.length < count) {
    const used = new Set([card.id, ...chosen.map((x) => x.id)]);
    chosen.push(
      ...similarNameDistractors(
        card,
        cards.filter((x) => !used.has(x.id)),
        count - chosen.length,
        rng,
        options,
      ),
    );
  }
  return chosen.slice(0, count);
}
