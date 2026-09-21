// Tally: the smallest complete kit. Everyone taps; first to the target wins, or the
// most taps when time runs out. It exists for three reasons: `scripts/new-kit.js`
// copies it as the starting point for a new mechanic, the platform tests use it as a
// stand-in for any kit, and it is the worked example in docs/HOW-TO-MAKE-A-KIT.md.
//
// A kit is five pure functions on a plain state object. Read docs/KIT-CONTRACT.md
// before changing the shape of anything here.

import { KitError } from '../../shared/errors.js';

/** @typedef {import('../../../types/parlor.js').KitStateBase & {
 *   phase: 'playing' | 'over',
 *   target: number,
 *   taps: Record<string, number>,
 *   endsAt: number,
 *   winnerId: string | null,
 *   reason: 'target' | 'time' | null,
 * }} TallyState */

/** @type {import('../../../types/parlor.js').Kit<TallyState>} */
const kit = {
  id: 'tally',
  name: 'Tally',
  tagline: 'Tap faster than everyone else.',
  version: 1,
  hidden: true,
  minPlayers: 1,
  maxPlayers: 12,
  joinMidGame: 'seat',

  config: {
    target: { type: 'number', label: 'Taps to win', help: 'The first player to reach it wins on the spot.', min: 3, max: 100, default: 10 },
    seconds: { type: 'number', label: 'Time limit', help: 'When time runs out, the most taps wins.', min: 5, max: 120, default: 30 },
  },
  content: {},

  setup(ctx) {
    /** @type {Record<string, number>} */
    const taps = {};
    for (const p of ctx.players) taps[p.id] = 0;
    ctx.log('started', { seconds: ctx.config.seconds });
    return /** @type {TallyState} */ ({
      $seed: '', $rng: 0,
      phase: 'playing',
      target: ctx.config.target,
      taps,
      endsAt: ctx.now + ctx.config.seconds * 1000,
      wakeAt: ctx.now + ctx.config.seconds * 1000,
      winnerId: null,
      reason: null,
    });
  },

  reduce(state, action, ctx) {
    switch (action.type) {
      case 'player/join':
      case 'player/return': {
        if (state.taps[action.payload.playerId] !== undefined) return state;
        return { ...state, taps: { ...state.taps, [action.payload.playerId]: 0 } };
      }
      case 'player/remove': {
        const taps = { ...state.taps };
        delete taps[action.payload.playerId];
        return { ...state, taps };
      }
      case 'player/leave':
      case 'host/transfer':
        return state;
      case 'tap': {
        if (state.phase !== 'playing') throw new KitError('wrong_phase', 'The game is over.');
        if (!ctx.me || state.taps[ctx.me] === undefined) throw new KitError('not_playing', 'You are not in this game.');
        const count = state.taps[ctx.me] + 1;
        const next = { ...state, taps: { ...state.taps, [ctx.me]: count } };
        if (count >= state.target) {
          ctx.log('won', { playerId: ctx.me, reason: 'target' });
          return { ...next, phase: 'over', winnerId: ctx.me, reason: 'target', wakeAt: null };
        }
        return next;
      }
      default:
        // Platform events this kit does not care about are ignored (rule R6); anything else is a bug.
        if (/^(player|host|game)\//.test(action.type)) return state;
        throw new KitError('unknown_action', `This game does not understand "${action.type}".`);
    }
  },

  tick(state, ctx) {
    if (state.phase !== 'playing') return { ...state, wakeAt: null };
    const winnerId = leader(state.taps);
    ctx.log('won', { playerId: winnerId, reason: 'time' });
    return { ...state, phase: 'over', winnerId, reason: 'time', wakeAt: null };
  },

  view(state, ctx) {
    const mine = ctx.me ? state.taps[ctx.me] ?? null : null;
    return {
      phase: state.phase,
      target: state.target,
      taps: state.taps,
      mine,
      endsAt: state.endsAt,
      wakeAt: state.wakeAt,
      winnerId: state.winnerId,
      reason: state.reason,
      actions: state.phase === 'playing' && mine !== null ? [{ type: 'tap', label: 'Tap', kind: 'primary' }] : [],
    };
  },

  summary(state) {
    const scores = Object.entries(state.taps).map(([playerId, score]) => ({ playerId, score }));
    scores.sort((a, b) => b.score - a.score);
    return {
      phase: state.phase === 'over' ? 'over' : 'playing',
      scores,
      winnerIds: state.winnerId ? [state.winnerId] : [],
      label: state.phase === 'over' ? 'Finished' : `First to ${state.target}`,
    };
  },

  blurb(config) {
    return `First to ${config.target} taps wins, or the most taps after ${config.seconds} seconds.`;
  },

  demoConfig: { target: 3, seconds: 10 },
  demoScript: [
    ['p1', 'tap'], ['p2', 'tap'], ['p1', 'tap'], ['@wait', 500], ['p1', 'tap'],
    ['@check', (sim) => { if (sim.summary().phase !== 'over') throw new Error('expected the game to be over'); }],
  ],
};

/** The player with the most taps; ties go to the earlier seat (object order). */
function leader(taps) {
  let best = null;
  let bestCount = -1;
  for (const [id, count] of Object.entries(taps)) {
    if (count > bestCount) { best = id; bestCount = count; }
  }
  return best;
}

export default kit;
