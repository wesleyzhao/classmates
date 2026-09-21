// Cards: Crazy Eights. Everyone holds a hidden hand; on your turn play a card that matches the top
// of the discard pile by suit or rank, or an eight (which also names the next suit), or draw one
// and play it if you can. First to empty their hand wins. House rules (twos make the next player
// draw two, queens skip, aces reverse) are settings.
//
// This kit exists to prove hidden information on the platform: the draw pile's order and every
// other hand live under secret keys, and the conformance suite checks that no view ever carries
// them. There are no timers; a quiet player is skipped by the host, or by anyone after a minute.

import { KitError } from '../../shared/errors.js';
import { NumberWord } from '../../shared/words.js';
import { order, current, next, add, drop } from '../_lib/turns.js';
import { standardDeck, parseCard, deal, draw, reshuffle } from '../_lib/deck.js';

const HOST_QUIET_MS = 30 * 1000;   // the host may skip a player who has been quiet this long
const QUIET_MS = 90 * 1000;        // after this, anyone may
const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

/**
 * @typedef {import('../../../types/parlor.js').KitStateBase & {
 *   _draw: string[],
 *   _hands: Record<string, string[]>,
 *   discard: string[],
 *   suit: string,
 *   turns: import('../_lib/turns.js').Turns,
 *   turnAt: number,
 *   drew: string | null,
 *   pendingDraw: number,
 *   winnerId: string | null,
 *   lastPlay: { playerId: string, card: string, suit: string | null } | null,
 *   turnCount: number,
 * }} CardsState
 */

/** @type {import('../../../types/parlor.js').Kit<CardsState>} */
const kit = {
  id: 'cards',
  name: 'Cards',
  tagline: 'Hidden hands, a draw pile, and a race to empty your hand.',
  version: 1,
  minPlayers: 2,
  maxPlayers: 6,
  joinMidGame: 'seat',

  config: {
    handSize: { type: 'number', label: 'Cards in a starting hand', min: 3, max: 8, default: 5 },
    houseRules: { type: 'multi', label: 'House rules', options: [{ value: 'twos', label: 'A two makes the next player draw two' }, { value: 'queens', label: 'A queen skips the next player' }, { value: 'aces', label: 'An ace reverses the direction' }], default: [] },
    maxTurns: { type: 'number', label: 'Turn limit', help: 'The game ends after this many turns with the smallest hand winning.', min: 20, max: 999, default: 300 },
  },
  content: {},

  setup(ctx) {
    const ids = ctx.players.map((p) => p.id);
    const seats = ctx.rng.shuffle(ids);
    let pile = ctx.rng.shuffle(standardDeck());
    const dealt = deal(pile, seats, ctx.config.handSize);
    pile = dealt.rest;
    // The first discard is never an eight, so the opening suit is plain.
    let first = pile.findIndex((id) => parseCard(id).rank !== '8');
    if (first === -1) first = 0;
    const top = pile[first];
    pile = [...pile.slice(0, first), ...pile.slice(first + 1)];
    ctx.log('started', { first: seats[0] });
    return {
      $seed: '', $rng: 0, wakeAt: null,
      _draw: pile,
      _hands: dealt.hands,
      discard: [top],
      suit: parseCard(top).suit,
      turns: order(seats),
      turnAt: ctx.now,
      drew: null,
      pendingDraw: 0,
      winnerId: null,
      lastPlay: null,
      turnCount: 1,
    };
  },

  reduce(state, action, ctx) {
    const type = action.type;
    if (type.startsWith('player/') || type.startsWith('host/') || type.startsWith('game/')) return lifecycle(state, action, ctx);
    if (state.winnerId || !current(state.turns)) throw new KitError('wrong_phase', 'The game is over.');
    const me = ctx.me;
    if (!me || !(me in state._hands)) throw new KitError('not_playing', 'You are not in this game.');
    const active = current(state.turns) === me;
    const p = action.payload || {};
    switch (type) {
      case 'play': {
        requireActive(active);
        const card = String(p.card ?? '');
        const hand = state._hands[me];
        if (!hand.includes(card)) throw new KitError('not_in_hand', 'That card is not in your hand.');
        if (!playable(state, card)) throw new KitError('illegal_play', 'That card does not match the suit or the rank.');
        if (state.pendingDraw > 0 && parseCard(card).rank !== '2') throw new KitError('must_draw', `Draw ${state.pendingDraw} first, or pass it on with a two.`);
        const { rank, suit } = parseCard(card);
        let nextSuit = suit;
        if (rank === '8') {
          const chosen = String(p.suit ?? '');
          if (!(chosen in SUIT_NAMES)) throw new KitError('bad_suit', 'Name a suit for your eight.');
          nextSuit = chosen;
        }
        const hands = { ...state._hands, [me]: hand.filter((c) => c !== card) };
        ctx.log('played', { playerId: me, card, suit: rank === '8' ? nextSuit : null });
        let s = { ...state, _hands: hands, discard: [...state.discard, card], suit: nextSuit, lastPlay: { playerId: me, card, suit: rank === '8' ? nextSuit : null }, drew: null };
        if (!hands[me].length) return finish(s, me, ctx);
        const rules = ctx.config.houseRules || [];
        let pending = 0;
        let skip = 0;
        let reverse = false;
        if (rules.includes('twos') && rank === '2') pending = state.pendingDraw + 2;
        if (rules.includes('queens') && rank === 'Q') skip = 1;
        if (rules.includes('aces') && rank === 'A') reverse = true;
        s = { ...s, pendingDraw: pending };
        return advance(s, ctx, { skip, reverse });
      }
      case 'draw': {
        requireActive(active);
        if (state.drew) throw new KitError('already_done', 'You already drew this turn. Play it or pass.');
        const count = state.pendingDraw > 0 ? state.pendingDraw : 1;
        let s = takeCards(state, me, count, ctx);
        ctx.log('drew', { playerId: me, count });
        if (state.pendingDraw > 0) return advance({ ...s, pendingDraw: 0, drew: null }, ctx, {});
        const taken = s._hands[me].slice(-1)[0] || null;
        return { ...s, drew: taken || 'none' };
      }
      case 'pass': {
        requireActive(active);
        if (!state.drew) throw new KitError('draw_first', 'Draw a card before passing.');
        ctx.log('passed', { playerId: me });
        return advance(state, ctx, {});
      }
      case 'skip': {
        const waited = ctx.now - state.turnAt;
        const may = (ctx.isHost && waited >= HOST_QUIET_MS) || (!active && waited >= QUIET_MS);
        if (!may) throw new KitError('not_yet', 'Give them a moment before skipping.');
        ctx.log('skipped', { playerId: current(state.turns), by: me });
        return advance({ ...state, pendingDraw: 0 }, ctx, {});
      }
      default:
        throw new KitError('unknown_action', `This game does not understand "${type}".`);
    }
  },

  tick(state) {
    return { ...state, wakeAt: null };
  },

  view(state, ctx) {
    const me = ctx.me;
    const turn = current(state.turns);
    const active = !!me && turn === me;
    const hand = me && state._hands[me] ? [...state._hands[me]].sort(bySuitThenRank) : null;
    const mustDraw = state.pendingDraw > 0;
    const playableIds = active ? hand.filter((c) => playable(state, c) && (!mustDraw || parseCard(c).rank === '2')) : [];
    /** @type {import('../../../types/parlor.js').ViewAction[]} */
    const actions = [];
    if (active && !state.winnerId) {
      if (mustDraw) actions.push({ type: 'draw', label: `Draw ${state.pendingDraw}`, kind: 'primary' });
      else if (!state.drew) actions.push({ type: 'draw', label: 'Draw a card', kind: 'secondary' });
      else actions.push({ type: 'pass', label: 'Pass', kind: 'secondary' });
    }
    const waited = ctx.now - state.turnAt;
    const quiet = waited >= QUIET_MS;
    const hostQuiet = ctx.isHost && waited >= HOST_QUIET_MS;
    if (me !== null && !state.winnerId && (hostQuiet || (quiet && !active))) actions.push({ type: 'skip', label: `Skip ${nameOf(ctx, turn)}`, kind: 'danger', host: !quiet, confirm: 'Skip this turn and move on to the next player?' });
    const counts = {};
    for (const [id, cards] of Object.entries(state._hands)) counts[id] = cards.length;
    return {
      phase: state.winnerId ? 'over' : 'playing',
      turn,
      seats: state.turns.seats,
      dir: state.turns.dir,
      top: state.discard[state.discard.length - 1],
      suit: state.suit,
      suitName: SUIT_NAMES[state.suit],
      discardCount: state.discard.length,
      drawCount: state._draw.length,
      handCounts: counts,
      hand,
      playable: playableIds,
      drew: active ? state.drew : null,
      pendingDraw: state.pendingDraw,
      lastPlay: state.lastPlay,
      winnerId: state.winnerId,
      isActive: active,
      wakeAt: null,
      waitingOn: state.winnerId ? [] : [turn],
      actions,
    };
  },

  summary(state) {
    const scores = Object.entries(state._hands).map(([playerId, cards]) => ({ playerId, score: -cards.length, label: cards.length === 0 ? 'went out' : `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} left` }));
    scores.sort((a, b) => b.score - a.score);
    const over = !!state.winnerId || !current(state.turns);
    return {
      phase: over ? 'over' : 'playing',
      scores,
      winnerIds: state.winnerId ? [state.winnerId] : over && scores.length ? scores.filter((s) => s.score === scores[0].score).map((s) => s.playerId) : [],
      label: over ? 'Finished' : `${nameOfSeat(state)}`,
      unit: 'labels',
    };
  },

  blurb(config) {
    const rules = config.houseRules || [];
    const house = [
      rules.includes('twos') && 'twos make the next player draw two',
      rules.includes('queens') && 'queens skip',
      rules.includes('aces') && 'aces reverse',
    ].filter(Boolean);
    const first = `${NumberWord(config.handSize)} cards each, and eights are wild.`;
    if (!house.length) return first;
    const list = house.length === 1 ? house[0] : `${house.slice(0, -1).join(', ')}, and ${house[house.length - 1]}`;
    return `${first} ${list[0].toUpperCase()}${list.slice(1)}.`;
  },

  demoConfig: { handSize: 3, houseRules: ['twos', 'queens', 'aces'] },
  demoScript: [
    ['@check', (sim) => playSomething(sim)], ['@check', (sim) => playSomething(sim)], ['@check', (sim) => playSomething(sim)],
    ['@check', (sim) => playSomething(sim)], ['@check', (sim) => playSomething(sim)], ['@check', (sim) => playSomething(sim)],
    ['@wait', 1000],
  ],
};

/** Demo helper: the active player plays a legal card if they have one, otherwise draws and passes. */
function playSomething(sim) {
  if (sim.summary().phase === 'over') return;
  const who = current(sim.state.turns);
  const v = sim.view(who);
  if (v.pendingDraw > 0) { sim.do(who, 'draw'); return; }
  if (v.playable.length) { const card = v.playable[0]; sim.do(who, 'play', { card, suit: parseCard(card).rank === '8' ? 'H' : undefined }); return; }
  sim.do(who, 'draw');
  const after = sim.view(who);
  if (after.turn === who && after.playable.length) { const card = after.playable[0]; sim.do(who, 'play', { card, suit: parseCard(card).rank === '8' ? 'H' : undefined }); }
  else if (after.turn === who) sim.do(who, 'pass');
}

// ---------------------------------------------------------------------------

function playable(state, card) {
  const { rank, suit } = parseCard(card);
  if (rank === '8') return true;
  const top = parseCard(state.discard[state.discard.length - 1]);
  return suit === state.suit || rank === top.rank;
}

function takeCards(state, playerId, count, ctx) {
  let drawPile = state._draw;
  let discard = state.discard;
  const taken = [];
  for (let i = 0; i < count; i++) {
    if (!drawPile.length) ({ draw: drawPile, discard } = reshuffle(drawPile, discard, ctx.rng));
    if (!drawPile.length) break;
    const [one, rest] = draw(drawPile, 1);
    taken.push(...one);
    drawPile = rest;
  }
  return { ...state, _draw: drawPile, discard, _hands: { ...state._hands, [playerId]: [...state._hands[playerId], ...taken] } };
}

function advance(state, ctx, opts) {
  const turns = next(state.turns, opts);
  const s = { ...state, turns, turnAt: ctx.now, drew: null, turnCount: state.turnCount + 1 };
  if (s.turnCount > ctx.config.maxTurns) return finish(s, null, ctx);
  return s;
}

function finish(state, winnerId, ctx) {
  ctx.log('won', { playerId: winnerId });
  return { ...state, winnerId, wakeAt: null, turns: { ...state.turns, seats: winnerId ? state.turns.seats : [] } };
}

function requireActive(active) {
  if (!active) throw new KitError('not_your_turn', 'It is not your turn.');
}

function nameOf(ctx, playerId) {
  return ctx.players.find((p) => p.id === playerId)?.name || 'them';
}

function nameOfSeat(state) {
  const who = current(state.turns);
  return who ? 'Waiting for a play' : 'Finished';
}

function bySuitThenRank(a, b) {
  const pa = parseCard(a);
  const pb = parseCard(b);
  const s = 'SHDC'.indexOf(pa.suit) - 'SHDC'.indexOf(pb.suit);
  if (s !== 0) return s;
  return ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(pa.rank) - ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(pb.rank);
}

function lifecycle(state, action, ctx) {
  const id = action.payload?.playerId;
  switch (action.type) {
    case 'player/join': {
      if (!id || id in state._hands || state.winnerId) return state;
      const seated = { ...state, turns: add(state.turns, id), _hands: { ...state._hands, [id]: [] } };
      return takeCards(seated, id, ctx.config.handSize, ctx);
    }
    case 'player/remove': {
      if (!id || !(id in state._hands)) return state;
      const hands = { ...state._hands };
      const returned = hands[id];
      delete hands[id];
      const wasActive = current(state.turns) === id;
      const turns = drop(state.turns, id);
      let s = { ...state, _hands: hands, _draw: [...state._draw, ...returned], turns };
      if (s.winnerId === id) s = { ...s, winnerId: null };
      if (Object.keys(hands).length < 2 && !s.winnerId) {
        const last = Object.keys(hands)[0] || null;
        return finish(s, last, ctx);
      }
      if (wasActive) s = { ...s, turnAt: ctx.now, drew: null, pendingDraw: 0 };
      return s;
    }
    default:
      return state;
  }
}

export default kit;
