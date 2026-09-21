// One room has one `wakeAt` (rule R4), but a kit often runs more than one clock: the card
// timer, the reveal pause, a nudge for whoever has gone quiet. These two functions fold
// those into the single number the platform watches, and tell `tick` which of them fired.
//
//   state.wakeAt = fold({ card: round.endsAt, reveal: null });
//   for (const name of fired({ card: round.endsAt }, ctx.now)) { ... }

/** @typedef {Record<string, number | null | undefined>} Deadlines */

/**
 * The soonest deadline, or null when nothing is running.
 * @param {Deadlines} deadlines  by name, with null for the clocks that are not running
 * @returns {number | null}
 */
export function fold(deadlines) {
  let soonest = null;
  for (const at of Object.values(deadlines || {})) {
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/**
 * Which deadlines have passed, soonest first. `tick` runs with the clock clamped to the
 * deadline that woke it, so a deadline exactly at `at` counts as fired.
 * @param {Deadlines} deadlines
 * @param {number} at  the current time, usually `ctx.now`
 * @returns {string[]} names
 */
export function fired(deadlines, at) {
  return Object.entries(deadlines || {})
    .filter(([, when]) => typeof when === 'number' && Number.isFinite(when) && at >= when)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([name]) => name);
}
