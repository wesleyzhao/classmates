// A ballot: who may vote, what they may choose, and what the table decided. The board kit
// judges answers with it ("did Sam get that right?") and any kit that needs the room to
// agree on something can use the same five functions.
//
// A ballot is a plain object a kit keeps in its own state. Votes are public here; a kit
// that needs them secret keeps the ballot under an underscore key (rule R2) until it is done.
//
//   let ballot = open(['p1', 'p2', 'p3'], ['yes', 'no']);
//   ballot = cast(ballot, 'p1', 'yes');
//   if (quorum(ballot, 0.5)) decide(ballot, { hostChoice: 'yes' });  // -> { choice, reason }

/** @typedef {{ voters: string[], options: string[], votes: Record<string, string> }} Ballot */

/**
 * Start a ballot. Duplicate voters and options are folded together.
 * @param {string[]} voters  who may vote
 * @param {string[]} options  what they may choose
 * @returns {Ballot}
 */
export function open(voters, options) {
  return {
    voters: [...new Set((voters || []).filter(Boolean))],
    options: [...new Set((options || []).filter((option) => option !== undefined && option !== null))].map(String),
    votes: {},
  };
}

/**
 * Record a vote, or hand back the ballot untouched when this voter or this choice is not
 * on it. Voting again replaces the earlier vote: people change their minds out loud.
 * @param {Ballot} ballot
 * @param {string} voter
 * @param {string} choice
 * @returns {Ballot}
 */
export function cast(ballot, voter, choice) {
  if (!ballot.voters.includes(voter) || !ballot.options.includes(String(choice))) return ballot;
  return { ...ballot, votes: { ...ballot.votes, [voter]: String(choice) } };
}

/**
 * Count the ballot.
 * @param {Ballot} ballot
 * @returns {{ counts: Record<string, number>, cast: number, leaders: string[] }}
 *   every option with its count, how many people voted, and who is in front (empty when
 *   nobody has voted, more than one name when it is tied)
 */
export function tally(ballot) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const option of ballot.options) counts[option] = 0;
  let cast = 0;
  for (const voter of ballot.voters) {
    const choice = ballot.votes[voter];
    if (choice === undefined || counts[choice] === undefined) continue;
    counts[choice] += 1;
    cast += 1;
  }
  const top = Math.max(0, ...Object.values(counts));
  const leaders = top === 0 ? [] : ballot.options.filter((option) => counts[option] === top);
  return { counts, cast, leaders };
}

/**
 * Have enough people voted? A fraction of 0.5 means half of them, rounded up.
 * @param {Ballot} ballot
 * @param {number} fraction  0 to 1
 * @returns {boolean}
 */
export function quorum(ballot, fraction) {
  const needed = Math.ceil(ballot.voters.length * Math.min(1, Math.max(0, fraction || 0)));
  return tally(ballot).cast >= Math.max(needed, ballot.voters.length ? 1 : 0);
}

/**
 * What the ballot decided. A clear lead wins; a tie or an empty ballot goes to the host if
 * they said something, and otherwise stays undecided so the kit can wait or ask again.
 * @param {Ballot} ballot
 * @param {{ hostChoice?: string | null }} [opts]
 * @returns {{ choice: string | null, reason: 'votes' | 'host' | 'tie' | 'none' }}
 */
export function decide(ballot, { hostChoice = null } = {}) {
  const { leaders } = tally(ballot);
  if (leaders.length === 1) return { choice: leaders[0], reason: 'votes' };
  const host = hostChoice !== null && ballot.options.includes(String(hostChoice)) ? String(hostChoice) : null;
  if (host) return { choice: host, reason: 'host' };
  return { choice: null, reason: leaders.length ? 'tie' : 'none' };
}
