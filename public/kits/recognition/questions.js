// Recognition questions reference content rather than copying an entire private deck into a room.
import { similarNameDistractors } from "./name-similarity.js";
import { similarPortraitDistractors } from "./portrait-similarity.js";

/** Build a bounded question sequence using the kit's seeded random source.
 * `options.targets` (card ids, in order) fixes which people are asked about; distractors still draw from every card. */
export function questions(cards, count, direction, rng, options = {}) {
  if (cards.length < 4)
    throw new Error("Recognition needs at least four cards.");
  const recentIds = [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const chosen = Array.isArray(options.targets)
    ? options.targets.map((id) => byId.get(id)).filter(Boolean).slice(0, count)
    : rng.shuffle(cards).slice(0, count);
  return chosen
    .map((card, i) => {
      const question = questionFor(
        card,
        cards,
        direction === "mixed" ? (i % 2 ? "name" : "face") : direction,
        rng,
        String(i),
        { ...options, recentIds },
      );
      recentIds.push(...question.options.filter((id) => id !== card.id));
      const recentLimit = options.recentLimit ?? 12;
      if (recentIds.length > recentLimit)
        recentIds.splice(0, recentIds.length - recentLimit);
      return question;
    });
}

/** Build one recognition question, also used for a selected spaced-review card. */
export function questionFor(
  card,
  cards,
  direction,
  rng,
  prefix = "review",
  options = {},
) {
  const id = `${prefix}-${Math.floor(rng() * 0x100000000).toString(36)}`;
  const distractors =
    options.distractors === "similar-names"
      ? similarNameDistractors(card, cards, 3, rng, options)
      : options.distractors === "similar-portraits"
        ? similarPortraitDistractors(card, cards, 3, rng, options)
        : rng.shuffle(cards.filter((c) => c.id !== card.id)).slice(0, 3);
  return {
    id,
    target: card.id,
    direction,
    options: rng.shuffle([card, ...distractors]).map((c) => c.id),
  };
}

/** Expose a question without its target, correct choice, or content lookup keys. */
export function questionView(q, cards) {
  if (!q) return null;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const target = byId.get(q.target);
  if (!target || q.options.some((id) => !byId.has(id))) return null;
  return {
    id: q.id,
    direction: q.direction,
    prompt:
      q.direction === "face"
        ? "What is their name?"
        : `Which face belongs to ${target.answer}?`,
    image: q.direction === "face" ? target.image : null,
    choices: q.options.map((id, i) => ({
      id: String(i),
      ...(q.direction === "face"
        ? { label: byId.get(id).answer }
        : { image: byId.get(id).image, label: `Photo ${i + 1}` }),
    })),
  };
}

/** Accuracy earns the base; speed adds at most half as much. Server arrival time is authoritative. */
export function speedPoints(elapsed, duration = 15000) {
  return (
    1000 +
    Math.round(
      500 *
        Math.max(
          0,
          1 - (Math.floor(Math.max(0, elapsed) / 250) * 250) / duration,
        ),
    )
  );
}
