// Turn order for kits that take turns: who is up, moving on (with skips and reversals), seats
// joining and leaving mid-game, roles that rotate per round, and balanced teams. Pure functions
// over a small plain object, so a kit keeps it inside its state and stays replayable.
//
//   let t = order(['ann', 'ben', 'cat']);
//   current(t)              // 'ann'
//   t = next(t)             // ben is up
//   t = next(t, { skip: 1 })  // skip cat, ann is up
//   t = drop(t, 'ann')      // ann leaves; ben is up
//   roleFor(t, 3)           // who takes the rotating role in round 3

/**
 * @typedef {{ seats: string[], i: number, dir: 1 | -1 }} Turns
 */

/** @param {string[]} playerIds  @returns {Turns} */
export function order(playerIds) {
  return { seats: [...playerIds], i: 0, dir: 1 };
}

/** @param {Turns} t  @returns {string | null} */
export function current(t) {
  return t.seats.length ? t.seats[t.i % t.seats.length] : null;
}

/**
 * Move to the next seat. `skip` passes over that many seats; `reverse` flips the direction first.
 * @param {Turns} t
 * @param {{ skip?: number, reverse?: boolean }} [opts]
 * @returns {Turns}
 */
export function next(t, opts = {}) {
  if (!t.seats.length) return t;
  const dir = opts.reverse ? /** @type {1 | -1} */ (-t.dir) : t.dir;
  const steps = 1 + Math.max(0, opts.skip || 0);
  const n = t.seats.length;
  return { seats: t.seats, i: (((t.i + dir * steps) % n) + n) % n, dir };
}

/**
 * Seat a player. By default they sit at the end, so they are up after everyone else.
 * @param {Turns} t
 * @param {string} id
 * @param {{ at?: number }} [opts]  index to insert at
 * @returns {Turns}
 */
export function add(t, id, opts = {}) {
  if (t.seats.includes(id)) return t;
  const seats = [...t.seats];
  const at = opts.at === undefined ? seats.length : Math.max(0, Math.min(seats.length, opts.at));
  seats.splice(at, 0, id);
  const i = at <= t.i && seats.length > 1 ? t.i + 1 : t.i;
  return { seats, i, dir: t.dir };
}

/**
 * Remove a player. If they were up, the turn passes to whoever would have been next.
 * @param {Turns} t
 * @param {string} id
 * @returns {Turns}
 */
export function drop(t, id) {
  const at = t.seats.indexOf(id);
  if (at === -1) return t;
  const seats = t.seats.filter((s) => s !== id);
  if (!seats.length) return { seats, i: 0, dir: t.dir };
  let i = t.i;
  if (at < i) i -= 1;
  else if (at === i && t.dir === -1) i -= 1;
  i = ((i % seats.length) + seats.length) % seats.length;
  return { seats, i, dir: t.dir };
}

/**
 * The seat that holds a rotating role in a given round (the guesser, the judge, the dealer).
 * @param {Turns} t
 * @param {number} roundN  1-based round number
 * @param {number} [offset]
 * @returns {string | null}
 */
export function roleFor(t, roundN, offset = 0) {
  if (!t.seats.length) return null;
  const n = t.seats.length;
  return t.seats[(((roundN - 1 + offset) % n) + n) % n];
}

/**
 * Split players into `count` teams as evenly as possible, shuffled with the kit's rng.
 * @param {string[]} playerIds
 * @param {number} count
 * @param {import('../../../types/parlor.js').Rng} rng
 * @returns {string[][]}
 */
export function assignTeams(playerIds, count, rng) {
  const shuffled = rng.shuffle(playerIds);
  const teams = Array.from({ length: Math.max(1, count) }, () => /** @type {string[]} */ ([]));
  shuffled.forEach((id, i) => teams[i % teams.length].push(id));
  return teams;
}
