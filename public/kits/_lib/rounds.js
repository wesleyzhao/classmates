// The shape of a round that asks everyone the same thing at once: put a card up, collect
// answers in secret, reveal. Quiz uses it; any kit where the table answers together can.
//
// A round is a small plain object a kit keeps inside its own state and is free to add to
// (the quiz kit hangs the card itself off it). Answers live under `_answers`, which rule R2
// keeps on the server until the reveal. Nothing here knows about players, decks, or scores.
//
//   let round = start(null, { index: 0, cardRef, seconds: 15, now });
//   round = submit(round, 'p1', 2, now + 1200);
//   if (allIn(round, connectedIds)) round = reveal(round, now + 1300);

/** @typedef {{ value: unknown, at: number }} Answer */
/** @typedef {{
 *   n: number,
 *   index: number,
 *   cardRef: unknown,
 *   startedAt: number,
 *   endsAt: number,
 *   revealedAt: number | null,
 *   answeredIds: string[],
 *   allowChange?: boolean,
 *   _answers: Record<string, Answer>,
 * }} Round */

/** Answers land in buckets this wide, so two phones a moment apart score the same. */
const BUCKET_MS = 250;

/**
 * Begin a round. The previous round is passed in so a kit can carry something forward;
 * nothing is carried by default.
 * @param {Round | null} _previous
 * @param {{ index: number, cardRef?: unknown, seconds: number, now: number, allowChange?: boolean }} opts
 * @returns {Round}
 */
export function start(_previous, { index, cardRef = null, seconds, now, allowChange = false }) {
  return {
    n: index + 1,
    index,
    cardRef,
    startedAt: now,
    endsAt: now + Math.max(0, seconds) * 1000,
    revealedAt: null,
    answeredIds: [],
    ...(allowChange ? { allowChange: true } : {}),
    _answers: {},
  };
}

/**
 * Record one player's answer. The first one counts unless the round allows changes, so a
 * second tap is quietly ignored rather than overwriting a time everyone already scored on.
 * Callers that owe the player an error should ask `hasAnswered` first.
 * @param {Round} round
 * @param {string} playerId
 * @param {unknown} value
 * @param {number} now
 * @returns {Round}
 */
export function submit(round, playerId, value, now) {
  if (!playerId) return round;
  if (hasAnswered(round, playerId) && !round.allowChange) return round;
  const answeredIds = round.answeredIds.includes(playerId) ? round.answeredIds : [...round.answeredIds, playerId];
  return { ...round, answeredIds, _answers: { ...round._answers, [playerId]: { value, at: now } } };
}

/**
 * @param {Round} round
 * @param {string} playerId
 * @returns {boolean}
 */
export function hasAnswered(round, playerId) {
  return !!playerId && Object.prototype.hasOwnProperty.call(round._answers || {}, playerId);
}

/**
 * Is everyone the round is waiting for in? An empty table is never "all in": a round with
 * nobody left at it should end on its timer, not the moment the last player leaves.
 * @param {Round} round
 * @param {string[]} playerIds
 * @returns {boolean}
 */
export function allIn(round, playerIds) {
  const ids = playerIds || [];
  return ids.length > 0 && ids.every((id) => hasAnswered(round, id));
}

/**
 * Who has not answered yet, in the order given.
 * @param {Round} round
 * @param {string[]} playerIds
 * @returns {string[]}
 */
export function waitingOn(round, playerIds) {
  return (playerIds || []).filter((id) => !hasAnswered(round, id));
}

/**
 * Close the round. The reveal time is kept so a kit can hold the answer up for a while.
 * @param {Round} round
 * @param {number} now
 * @returns {Round}
 */
export function reveal(round, now) {
  return round.revealedAt === null ? { ...round, revealedAt: now } : round;
}

/**
 * What a right answer is worth: a flat amount for being right, plus a share of the bonus
 * for being quick. Elapsed time is rounded down to a quarter of a second first, so the
 * winner is whoever knew it, not whoever had the better signal.
 * @param {number} elapsedMs  from the start of the round to the answer
 * @param {number} limitMs  how long the round ran
 * @param {{ base?: number, bonus?: number }} [opts]
 * @returns {number} whole points
 */
export function speedScore(elapsedMs, limitMs, { base = 100, bonus = 100 } = {}) {
  const limit = Math.max(1, limitMs || 0);
  const bucket = Math.floor(Math.max(0, elapsedMs || 0) / BUCKET_MS) * BUCKET_MS;
  const left = Math.min(1, Math.max(0, 1 - bucket / limit));
  return base + Math.round(bonus * left);
}
