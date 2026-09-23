// A small, explainable spaced-review schedule in the shape of Anki's, for a pass-or-fail multiple-choice card.
// One memory per person covers both directions (face to name and name to face); the direction of each ask is
// chosen at ask time and misses are counted per direction, so the weaker direction comes back sooner.
//
// New and learning cards climb two steps (one minute, ten minutes) and graduate to a one-day review.
// A correct review multiplies the interval by the card's ease (2.5 to begin with, never under 1.3), capped at
// half a year. A miss on a review is a lapse: the ease drops by 0.2, the card relearns from a one-minute step
// and returns to a one-day interval. A card missed eight times is a leech, which is how Anki flags the names
// that need a different trick. The server's gsb_review function is the source of truth and applies the same rules.
export const STEPS = [60000, 600000];
export const DAY = 86400000;
export const MAX_INTERVAL = 180 * DAY;
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const LEECH_AT = 8;

/** The memory after one ask. `direction` is what was asked, face or name. */
export function review(previous, correct, now, direction = "face") {
  const p = previous ?? {};
  let ease = p.ease ?? START_EASE, interval = p.interval ?? 0, lapses = p.lapses ?? 0,
    state = p.state ?? "learning", step = p.step ?? 0, dueAt;
  const missed = { face: p.missed?.face ?? 0, name: p.missed?.name ?? 0 };
  if (correct) {
    if (state === "review") {
      interval = Math.min(Math.max(Math.floor(interval * ease), interval + DAY), MAX_INTERVAL);
      dueAt = now + interval;
    } else if (state === "learning" && step < STEPS.length - 1) {
      step += 1;
      dueAt = now + STEPS[step];
    } else {
      state = "review"; step = 0; interval = DAY; dueAt = now + DAY;
    }
  } else {
    if (state === "review") { lapses += 1; ease = Math.max(MIN_EASE, Math.round((ease - 0.2) * 100) / 100); }
    state = state === "learning" ? "learning" : "relearning";
    step = 0; interval = 0; dueAt = now + STEPS[0];
    missed[direction] = (missed[direction] ?? 0) + 1;
  }
  const reviews = (p.reviews ?? 0) + 1, right = (p.correct ?? 0) + Number(correct);
  return {
    state, step, ease, interval, lapses, dueAt, reviews, correct: right, lastAt: now, lastDirection: direction, missed,
    // stage keeps the older meaning of "how far along": 0 and 1 are the learning steps, 2 and up are reviews.
    stage: state === "review" ? Math.min(9, 2 + Math.max(0, Math.round(Math.log(Math.max(1, interval / DAY)) / Math.log(START_EASE)))) : step,
    leech: (missed.face + missed.name) >= LEECH_AT,
  };
}

/** Which way to ask about a person now: the weaker direction, else the other one from last time, else by turn. */
export function pickDirection(memory, turn = 0) {
  if (!memory) return turn % 2 ? "name" : "face";
  const face = memory.missed?.face ?? 0, name = memory.missed?.name ?? 0;
  if (face !== name) return face > name ? "face" : "name";
  return memory.lastDirection === "face" ? "name" : "face";
}

/** Due reviews and unseen cards first, then future reviews, so the entire deck remains accessible. */
export function studyOrder(ids, progress, now) {
  return [...ids].sort((a, b) => {
    const x = progress[a],
      y = progress[b];
    const priority = (p) => (!p ? 1 : p.dueAt <= now ? 0 : 2);
    return (
      priority(x) - priority(y) ||
      (x?.dueAt ?? 0) - (y?.dueAt ?? 0)
    );
  });
}

/** The people missed most, most recent first among equals: the list a learner should look at again. */
export function keepMissing(progress, cards, limit = 6) {
  return cards
    .map((card) => ({ card, memory: progress[card.id] }))
    .filter(({ memory }) => memory && (memory.missed?.face ?? 0) + (memory.missed?.name ?? 0) > 0)
    .map(({ card, memory }) => ({
      id: card.id, name: card.answer, image: card.image,
      misses: (memory.missed?.face ?? 0) + (memory.missed?.name ?? 0),
      missedFace: memory.missed?.face ?? 0, missedName: memory.missed?.name ?? 0,
      leech: !!memory.leech, lastAt: memory.lastAt ?? 0,
    }))
    .sort((a, b) => b.misses - a.misses || b.lastAt - a.lastAt)
    .slice(0, limit);
}

/** How long until the next ask if the next answer is right, and if it is wrong, for the card's current memory. */
export function nextIntervals(memory, direction = "face", now = Date.now()) {
  return { right: review(memory, true, now, direction).dueAt - now, wrong: review(memory, false, now, direction).dueAt - now };
}

/** A span in the shortest honest words: 1 min, 10 min, 3 h, 1 day, 3 days, 2 weeks, 4 months. */
export function describeSpan(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(ms / 3600000);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(ms / DAY);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}
