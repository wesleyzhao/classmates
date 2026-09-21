// Board: take turns, roll, move along a board, answer a question where you land. Correct answers
// keep your turn; headquarters spaces award a wedge; collect the wedges (or reach the finish) and
// answer one last question to win. Trivial Pursuit is this kit on the wheel layout with six trivia
// categories; a race with one deck is the same kit on the track layout.
//
// The rules were ported from Wesley's earlier Trivial Pursuit engine and generalised: the board is
// data (public/kits/board/layouts/*), the categories and their decks are content, and the win
// condition, the answer style, and the relaxed-finish house rule are settings.
//
// State keeps only what a turn needs: positions, wedges, the current turn (with the drawn card's
// answer under a secret key), and the ids of cards already used. There are no timers; a quiet
// player is handled by the `skip` action, which the host may use at any time and anyone after a minute.

import { KitError } from '../../shared/errors.js';
import { numberWord } from '../../shared/words.js';
import { match } from '../../shared/match.js';
import { order, current, next, add, drop } from '../_lib/turns.js';
import { reachable } from './graph.js';
import * as wheel from './layouts/wheel.js';
import * as track from './layouts/track.js';

const HOST_QUIET_MS = 30 * 1000;   // the host may skip a player who has been quiet this long
const QUIET_MS = 90 * 1000;        // after this, anyone may
const USED_LIMIT = 900;
const CHOICE_COUNT = 4;

/**
 * @typedef {import('../../../types/parlor.js').KitStateBase & {
 *   layout: 'wheel' | 'track',
 *   trackLength: number,
 *   cats: Array<{ id: string, name: string, color: string, emoji: string }>,
 *   turns: import('../_lib/turns.js').Turns,
 *   turnCount: number,
 *   pos: Record<string, string>,
 *   wedges: Record<string, boolean[]>,
 *   turn: Turn | null,
 *   winnerId: string | null,
 *   _used: string[],
 * }} BoardState
 * @typedef {{
 *   seq: number, playerId: string, step: 'roll' | 'move' | 'pick' | 'final-pick' | 'ask' | 'judge' | 'result' | 'done',
 *   stepAt: number, roll: number | null, options: Array<{ to: string, path: string[], type: string, cat: number | null }> | null,
 *   lastMove: { from: string, to: string, path: string[] } | null, landed: string | null,
 *   cat: number | null, forWedge: boolean, final: boolean,
 *   card: { id: string, prompt: string, image?: string, emoji?: string, choices?: string[] } | null,
 *   _answer: { answer: string, aliases: string[], reject: string[], correctIndex: number | null } | null,
 *   typed: string | null, submitted: boolean, chosen: number | null, judgedBy: string | null,
 *   result: { correct: boolean, wedge: number | null, win: boolean, answer: string, correctIndex: number | null, typed: string | null } | null,
 * }} Turn
 */

/** @type {import('../../../types/parlor.js').Kit<BoardState>} */
const kit = {
  id: 'board',
  name: 'Board',
  tagline: 'Take turns, roll, move, and answer where you land.',
  version: 1,
  minPlayers: 1,
  maxPlayers: 6,
  joinMidGame: 'seat',

  config: {
    win: { type: 'choice', label: 'How to win', options: [{ value: 'collect', label: 'Collect a wedge from every category, then reach the middle' }, { value: 'reach', label: 'Reach the finish line' }], default: 'collect' },
    wedgesToWin: { type: 'number', label: 'Wedges to win', help: 'Fewer wedges makes a shorter game.', min: 1, max: 12, default: 6, when: { field: 'win', eq: 'collect' } },
    answerStyle: { type: 'choice', label: 'How people answer', options: [{ value: 'choices', label: 'Tap one of four choices' }, { value: 'open', label: 'Say it out loud, the others mark it' }, { value: 'typed', label: 'Type it, the game marks it' }], default: 'choices' },
    relaxedFinish: { type: 'bool', label: 'No exact roll needed to finish', help: 'Reach the middle or the finish line with any roll that gets you there.', default: true },
    maxTurns: { type: 'number', label: 'Turn limit', help: 'The game ends after this many turns with the most wedges winning.', min: 20, max: 999, default: 300 },
  },
  content: {
    layout: { type: 'choice', label: 'Board', options: [{ value: 'wheel', label: 'The wheel' }, { value: 'track', label: 'A race track' }], default: 'wheel' },
    trackLength: { type: 'number', label: 'Track length', min: 12, max: 60, default: 30, when: { field: 'layout', eq: 'track' } },
    categories: {
      type: 'list', label: 'Categories', min: 1, max: 12,
      of: { type: 'object', fields: {
        id: { type: 'text', label: 'Id', help: 'A short word with no spaces. Players never see it.', maxLength: 24 },
        name: { type: 'text', label: 'Name', maxLength: 32 },
        color: { type: 'color', label: 'Color', required: false },
        emoji: { type: 'emoji', label: 'Emoji', required: false },
        decks: { type: 'decks', label: 'Decks', min: 1, cardFields: ['prompt', 'answer'] },
        filter: { type: 'text', label: 'Only cards in this deck category', required: false, maxLength: 32 },
      } },
    },
  },

  setup(ctx) {
    const layout = layoutFor(ctx.content);
    if (ctx.content.layout === 'wheel' && ctx.content.categories.length !== 6) throw new KitError('bad_content', 'The wheel needs exactly six categories.');
    const cats = ctx.content.categories.map((c, i) => ({ id: c.id, name: c.name, color: c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length], emoji: c.emoji || '' }));
    const ids = ctx.players.map((p) => p.id);
    /** @type {Record<string, string>} */
    const pos = {};
    /** @type {Record<string, boolean[]>} */
    const wedges = {};
    for (const id of ids) { pos[id] = layout.start; wedges[id] = cats.map(() => false); }
    const seats = ctx.rng.shuffle(ids);
    /** @type {BoardState} */
    const state = {
      $seed: '', $rng: 0, wakeAt: null,
      layout: ctx.content.layout, trackLength: ctx.content.trackLength ?? 30, cats,
      turns: order(seats), turnCount: 0, pos, wedges, turn: null, winnerId: null,
      _used: (ctx.recent || []).slice(-USED_LIMIT),
    };
    ctx.log('started', { first: seats[0] });
    return newTurn(state, seats[0], ctx);
  },

  reduce(state, action, ctx) {
    const type = action.type;
    if (type.startsWith('player/') || type.startsWith('host/') || type.startsWith('game/')) return lifecycle(state, action, ctx);
    const t = state.turn;
    if (!t || t.step === 'done') throw new KitError('wrong_phase', 'The game is over.');
    const me = ctx.me;
    if (!me || !(me in state.pos)) throw new KitError('not_playing', 'You are not in this game.');
    const active = t.playerId === me;
    const isHost = ctx.isHost;
    const layout = layoutFor(contentOf(state));
    const p = action.payload || {};
    switch (type) {
      case 'roll': {
        requireActive(active); requireStep(t, 'roll');
        const roll = 1 + ctx.rng.int(6);
        const stopAtEnd = ctx.config.relaxedFinish && (ctx.config.win === 'reach' || hasAllWedges(state, me, ctx.config));
        const options = reachable(layout, state.pos[me], roll, { stopAtEnd }).map((o) => ({ to: o.to, path: o.path, type: layout.spaces[o.to].type, cat: layout.spaces[o.to].cat }));
        ctx.log('rolled', { playerId: me, roll });
        let s = setTurn(state, { roll, options, landed: null, step: 'move', stepAt: ctx.now });
        if (options.length === 0) { ctx.log('stuck', { playerId: me }); return endTurn(s, false, ctx); }
        if (options.length === 1) s = doMove(s, options[0].to, ctx);
        return s;
      }
      case 'move': {
        requireActive(active); requireStep(t, 'move');
        return doMove(state, String(p.to ?? ''), ctx);
      }
      case 'pick': {
        requireStep(t, 'pick', 'final-pick');
        const cat = Number(p.cat);
        if (!Number.isInteger(cat) || cat < 0 || cat >= state.cats.length) throw new KitError('bad_pick', 'Choose one of the categories.');
        const solo = Object.keys(state.pos).length === 1;
        if (t.step === 'pick') {
          requireActive(active);
          return ask(setTurn(state, { forWedge: false, final: false }), cat, ctx);
        }
        if (active && !solo) throw new KitError('not_your_turn', 'The other players choose the final category.');
        ctx.log('picked', { playerId: me, cat });
        return ask(setTurn(state, { forWedge: false, final: true }), cat, ctx);
      }
      case 'answer': {
        requireActive(active); requireStep(t, 'ask');
        if (ctx.config.answerStyle !== 'choices') throw new KitError('wrong_style', 'This game takes typed or spoken answers.');
        const index = Number(p.index);
        if (!Number.isInteger(index) || index < 0 || index >= (t.card.choices || []).length) throw new KitError('bad_answer', 'Pick one of the choices.');
        return setResult(setTurn(state, { chosen: index }), index === t._answer.correctIndex, ctx);
      }
      case 'submit': {
        requireActive(active); requireStep(t, 'ask');
        if (ctx.config.answerStyle === 'choices') throw new KitError('wrong_style', 'Tap one of the choices.');
        if (t.submitted) throw new KitError('already_done', 'You already locked in an answer.');
        const typed = cleanText(p.text);
        if (ctx.config.answerStyle === 'typed') {
          const ok = typed ? match(typed, { answer: t._answer.answer, aliases: t._answer.aliases, reject: t._answer.reject }).ok : false;
          return setResult(setTurn(state, { typed, submitted: true }), ok, ctx);
        }
        ctx.log(typed ? 'submitted' : 'passed', { playerId: me });
        return setTurn(state, { typed, submitted: true, step: 'judge', stepAt: ctx.now });
      }
      case 'judge': {
        requireStep(t, 'judge');
        const solo = Object.keys(state.pos).length === 1;
        if (active && !solo) throw new KitError('not_your_turn', 'The other players mark your answer.');
        return setResult(setTurn(state, { judgedBy: me }), Boolean(p.correct), ctx);
      }
      case 'continue': {
        requireStep(t, 'result');
        return endTurn(state, t.result.correct, ctx);
      }
      case 'skip': {
        const waited = ctx.now - t.stepAt;
        const may = (isHost && waited >= HOST_QUIET_MS) || (!active && waited >= QUIET_MS);
        if (!may) throw new KitError('not_yet', 'Give them a moment before skipping.');
        if (t.step === 'result') return endTurn(state, t.result.correct, ctx);
        ctx.log('skipped', { playerId: t.playerId, by: me });
        return endTurn(state, false, ctx);
      }
      default:
        throw new KitError('unknown_action', `This game does not understand "${type}".`);
    }
  },

  tick(state) {
    return { ...state, wakeAt: null };
  },

  view(state, ctx) {
    const t = state.turn;
    const me = ctx.me;
    const layout = layoutFor(contentOf(state));
    const active = !!t && t.playerId === me;
    const solo = Object.keys(state.pos).length === 1;
    const showAnswer = !!t && !!t._answer && (t.step === 'result' || (ctx.config.answerStyle === 'open' && (t.step === 'judge' || (t.step === 'ask' && !active && me !== null && me in state.pos))));
    /** @type {import('../../../types/parlor.js').ViewAction[]} */
    const actions = [];
    /** @type {string[]} */
    let waitingOn = [];
    if (t && t.step !== 'done') {
      if (t.step === 'roll' && active) actions.push({ type: 'roll', label: 'Roll', kind: 'primary' });
      if (t.step === 'result') actions.push({ type: 'continue', label: t.result?.win ? 'See the results' : t.result?.correct ? 'Go again' : 'Next player', kind: 'primary' });
      if (t.step === 'judge' && me !== null && (!active || solo)) {
        actions.push({ type: 'judge', payload: { correct: true }, label: 'Right', kind: 'primary' });
        actions.push({ type: 'judge', payload: { correct: false }, label: 'Wrong', kind: 'secondary' });
      }
      const waited = ctx.now - t.stepAt;
      const quiet = waited >= QUIET_MS;
      const hostQuiet = ctx.isHost && waited >= HOST_QUIET_MS;
      if (me !== null && t.step !== 'result' && (hostQuiet || (quiet && !active))) actions.push({ type: 'skip', label: `Skip ${nameOf(ctx, t.playerId)}`, kind: 'danger', host: !quiet, confirm: 'Skip this turn and move on to the next player?' });
      if (t.step === 'judge' || t.step === 'final-pick') waitingOn = Object.keys(state.pos).filter((id) => id !== t.playerId);
      else if (t.step !== 'result') waitingOn = [t.playerId];
    }
    return {
      phase: t && t.step === 'done' ? 'over' : 'playing',
      layout: state.layout,
      trackLength: state.trackLength,
      viewBox: layout.viewBox,
      cats: state.cats,
      pos: state.pos,
      wedges: state.wedges,
      wedgesToWin: ctx.config.win === 'collect' ? Math.min(ctx.config.wedgesToWin, state.cats.length) : null,
      win: ctx.config.win,
      answerStyle: ctx.config.answerStyle,
      turnCount: state.turnCount,
      winnerId: state.winnerId,
      turn: t ? {
        seq: t.seq, playerId: t.playerId, step: t.step, stepAt: t.stepAt, roll: t.roll, options: t.options, lastMove: t.lastMove,
        landed: t.landed, cat: t.cat, forWedge: t.forWedge, final: t.final, card: t.card, submitted: t.submitted,
        typed: t.step === 'judge' || t.step === 'result' || active ? t.typed : null, chosen: t.chosen, judgedBy: t.judgedBy,
        result: t.result, answer: showAnswer ? t._answer.answer : null, correctIndex: showAnswer ? t._answer.correctIndex : null,
        // Who is up once the result is dismissed, so the screen can name them: nobody after a win,
        // the same player after a right answer, the next seat after a wrong one.
        nextId: t.step === 'result' && t.result ? (t.result.win ? null : t.result.correct ? t.playerId : current(next(state.turns))) : null,
      } : null,
      isActive: active,
      // The screen draws category chips for these; they are not in `actions` so the action bar stays clean.
      canPick: !!t && ((t.step === 'pick' && active) || (t.step === 'final-pick' && me !== null && (!active || solo))),
      canJudge: !!t && t.step === 'judge' && me !== null && (!active || solo),
      wakeAt: null,
      waitingOn,
      actions,
    };
  },

  summary(state) {
    const ids = Object.keys(state.pos);
    const layout = layoutFor(contentOf(state));
    const scores = ids.map((playerId) => {
      const won = state.wedges[playerId].filter(Boolean).length;
      if (state.layout === 'track') {
        const at = (layout.spaces[state.pos[playerId]].index ?? 0) + 1;
        return { playerId, score: at, label: `${at} of ${state.trackLength}`, finish: `finished on space ${at} of ${state.trackLength}` };
      }
      return { playerId, score: won, label: `${won} ${won === 1 ? 'wedge' : 'wedges'}` };
    });
    scores.sort((a, b) => b.score - a.score);
    const over = !state.turn || state.turn.step === 'done';
    return {
      phase: over ? 'over' : 'playing',
      scores,
      winnerIds: state.winnerId ? [state.winnerId] : over && scores.length ? scores.filter((s) => s.score === scores[0].score).map((s) => s.playerId) : [],
      label: over ? 'Finished' : `Turn ${state.turnCount}`,
      unit: 'labels',
    };
  },

  blurb(config, content) {
    const how = config.answerStyle === 'open' ? 'Answer out loud and let the table mark it.' : config.answerStyle === 'typed' ? 'Type your answers.' : 'Tap one of four answers.';
    const need = Math.min(config.wedgesToWin, (content.categories || []).length || config.wedgesToWin);
    const goal = config.win === 'reach' ? 'First to the finish line wins.' : `Collect ${numberWord(need)} ${need === 1 ? 'wedge' : 'wedges'}, then make for the middle.`;
    return `${goal} ${how}`;
  },

  demoConfig: { win: 'collect', wedgesToWin: 2, answerStyle: 'choices', relaxedFinish: true },
  demoContent: {
    layout: 'track', trackLength: 14,
    categories: [
      { id: 'a', name: 'Odd', color: '#22c55e', decks: ['demo'] },
      { id: 'b', name: 'Even', color: '#2f6bff', decks: ['demo'] },
    ],
  },
  demoDecks: ['demo'],
  demoScript: [
    ['p1', 'roll'], ['@check', (sim) => { const t = sim.state.turn; if (t.step === 'move') sim.do('p1', 'move', { to: t.options[0].to }); }],
    ['@check', (sim) => { const t = sim.state.turn; if (t.step === 'ask') sim.do('p1', t.card.choices ? 'answer' : 'submit', t.card.choices ? { index: 0 } : { text: 'a guess' }); }],
    ['@check', (sim) => { if (sim.state.turn.step === 'judge') sim.do('p2', 'judge', { correct: true }); }],
    ['@check', (sim) => { if (sim.state.turn.step === 'result') sim.do('p2', 'continue'); }],
    ['@wait', 1000],
  ],
};

/** The colours a category falls back to, in order. The editor offers the same twelve. */
export const DEFAULT_COLORS = ['#2f6bff', '#ff3d9a', '#ffc233', '#8b5cf6', '#22c55e', '#ff7a1a', '#0ea5e9', '#f43f5e', '#84cc16', '#a855f7', '#f59e0b', '#14b8a6'];

// ---------------------------------------------------------------------------
// turn flow

function newTurn(state, playerId, ctx) {
  const seq = (state.turn?.seq ?? 0) + 1;
  /** @type {Turn} */
  const turn = {
    seq, playerId, step: 'roll', stepAt: ctx.now, roll: null, options: null, lastMove: null, landed: null,
    cat: null, forWedge: false, final: false, card: null, _answer: null, typed: null, submitted: false, chosen: null, judgedBy: null, result: null,
  };
  const s = { ...state, turn, turnCount: state.turnCount + 1 };
  if (s.turnCount > ctx.config.maxTurns) return finish(s, null, ctx);
  return s;
}

/** After a result: the same player goes again when right, the next one when wrong; a win ends the game. */
function endTurn(state, again, ctx) {
  const t = state.turn;
  if (t.result?.win) return finish(state, t.playerId, ctx);
  if (again) return newTurn(state, t.playerId, ctx);
  const turns = next(state.turns);
  return newTurn({ ...state, turns }, current(turns), ctx);
}

function finish(state, winnerId, ctx) {
  ctx.log('won', { playerId: winnerId });
  return { ...state, winnerId, turn: { ...state.turn, step: 'done', stepAt: ctx.now }, wakeAt: null };
}

function doMove(state, to, ctx) {
  const t = state.turn;
  const opt = (t.options || []).find((o) => o.to === to);
  if (!opt) throw new KitError('illegal_move', 'You cannot move there.');
  const me = t.playerId;
  const from = state.pos[me];
  ctx.log('moved', { playerId: me, from, to });
  const moved = setTurn({ ...state, pos: { ...state.pos, [me]: to } }, { lastMove: { from, to, path: opt.path }, options: null });
  return land(moved, to, ctx);
}

function land(state, spaceId, ctx) {
  const layout = layoutFor(contentOf(state));
  const space = layout.spaces[spaceId];
  const me = state.turn.playerId;
  const s = setTurn(state, { landed: space.type, forWedge: false, final: false });
  if (space.type === 'again') { ctx.log('again', { playerId: me }); return setTurn(s, { step: 'roll', stepAt: ctx.now }); }
  if (space.type === 'hub' || space.type === 'finish') {
    const ready = ctx.config.win === 'reach' || hasAllWedges(s, me, ctx.config);
    if (ready) {
      ctx.log('final', { playerId: me });
      const solo = Object.keys(s.pos).length === 1;
      if (solo) return ask(setTurn(s, { final: true }), ctx.rng.int(s.cats.length), ctx);
      return setTurn(s, { final: true, step: 'final-pick', stepAt: ctx.now });
    }
    return setTurn(s, { step: 'pick', stepAt: ctx.now });
  }
  if (space.type === 'start') return setTurn(s, { step: 'roll', stepAt: ctx.now });
  const cat = space.cat ?? 0;
  const forWedge = ctx.config.win === 'collect' && space.type === 'hq' && !s.wedges[me][cat];
  return ask(setTurn(s, { forWedge }), cat, ctx);
}

/** Draw a card for a category and put the question in front of the active player. */
function ask(state, cat, ctx) {
  const content = contentOf(state);
  const category = ctx.content.categories[cat];
  const drawn = drawCard(state, category, ctx);
  if (!drawn) throw new KitError('no_cards', `There are no cards left for ${state.cats[cat].name}.`);
  const { card, deckId } = drawn;
  let choices = null;
  let correctIndex = null;
  if (ctx.config.answerStyle === 'choices') {
    const others = Array.isArray(card.choices) && card.choices.includes(card.answer)
      ? card.choices.filter((c) => c !== card.answer).slice(0, CHOICE_COUNT - 1)
      : distractors(ctx.decks[deckId], card, CHOICE_COUNT - 1, ctx.rng);
    choices = ctx.rng.shuffle([card.answer, ...others]);
    correctIndex = choices.indexOf(card.answer);
  }
  ctx.log('asked', { playerId: state.turn.playerId, cat });
  return setTurn({ ...state, _used: [...state._used, card.id].slice(-USED_LIMIT) }, {
    step: 'ask', stepAt: ctx.now, cat,
    card: publicCard(card, choices),
    _answer: { answer: card.answer, aliases: card.aliases || [], reject: card.reject || [], correctIndex },
    typed: null, submitted: false, chosen: null, judgedBy: null, result: null,
  });
}

function setResult(state, correct, ctx) {
  const t = state.turn;
  const me = t.playerId;
  let wedges = state.wedges;
  let wedge = null;
  if (correct && t.forWedge && t.cat !== null && !wedges[me][t.cat]) {
    wedges = { ...wedges, [me]: wedges[me].map((w, i) => (i === t.cat ? true : w)) };
    wedge = t.cat;
    ctx.log('wedge', { playerId: me, cat: t.cat });
  }
  const win = correct && t.final;
  ctx.log(correct ? 'right' : 'wrong', { playerId: me });
  return setTurn({ ...state, wedges }, {
    step: 'result', stepAt: ctx.now,
    result: { correct, wedge, win, answer: t._answer.answer, correctIndex: t._answer.correctIndex, typed: t.typed },
  });
}

// ---------------------------------------------------------------------------
// lifecycle

function lifecycle(state, action, ctx) {
  const layout = layoutFor(contentOf(state));
  const id = action.payload?.playerId;
  switch (action.type) {
    case 'player/join': {
      if (!id || id in state.pos) return state;
      return {
        ...state,
        turns: add(state.turns, id),
        pos: { ...state.pos, [id]: layout.start },
        wedges: { ...state.wedges, [id]: state.cats.map(() => false) },
      };
    }
    case 'player/remove': {
      if (!id || !(id in state.pos)) return state;
      const pos = { ...state.pos };
      const wedges = { ...state.wedges };
      delete pos[id];
      delete wedges[id];
      const turns = drop(state.turns, id);
      let s = { ...state, pos, wedges, turns };
      if (!Object.keys(pos).length) return { ...s, turn: s.turn ? { ...s.turn, step: 'done', stepAt: ctx.now } : null };
      if (s.turn && s.turn.step !== 'done' && s.turn.playerId === id) {
        if (s.turn.result?.win) return finish(s, id, ctx);
        s = newTurn(s, current(turns), ctx);
      }
      if (s.winnerId === id) s = { ...s, winnerId: null };
      return s;
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// helpers

function requireActive(active) {
  if (!active) throw new KitError('not_your_turn', 'It is not your turn.');
}

function requireStep(t, ...steps) {
  if (!steps.includes(t.step)) throw new KitError('wrong_phase', 'You cannot do that right now.');
}

function setTurn(state, patch) {
  return { ...state, turn: { ...state.turn, ...patch } };
}

function hasAllWedges(state, playerId, config) {
  const need = Math.min(config.wedgesToWin, state.cats.length);
  return state.wedges[playerId].filter(Boolean).length >= need;
}

function nameOf(ctx, playerId) {
  return ctx.players.find((p) => p.id === playerId)?.name || 'them';
}

function cleanText(raw) {
  return [...String(raw ?? '').replace(/[^\P{Cc}\n]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, 80).join('');
}

/** The content a layout needs, reconstructed from state (state never stores the layout object). */
function contentOf(state) {
  return { layout: state.layout, trackLength: state.trackLength, categories: state.cats };
}

/** @returns {import('./graph.js').Layout} */
function layoutFor(content) {
  if (content.layout === 'track') return track.build({ length: content.trackLength, categories: content.categories.length });
  return wheel.build();
}

/**
 * A card from the category's decks that this room has not used yet; when every card has been used,
 * the oldest ones come back first.
 * @returns {{ card: import('../../../types/parlor.js').Card, deckId: string } | null}
 */
function drawCard(state, category, ctx) {
  const pool = [];
  for (const deckId of category.decks) {
    const deck = ctx.decks[deckId];
    if (!deck) continue;
    for (const card of deck.cards) {
      if (category.filter && card.category !== category.filter) continue;
      pool.push({ card, deckId });
    }
  }
  if (!pool.length) return null;
  const used = new Set(state._used);
  let fresh = pool.filter((p) => !used.has(p.card.id));
  if (!fresh.length) {
    const order = new Map(state._used.map((id, i) => [id, i]));
    fresh = [...pool].sort((a, b) => (order.get(a.card.id) ?? -1) - (order.get(b.card.id) ?? -1)).slice(0, Math.max(1, Math.ceil(pool.length / 4)));
  }
  return fresh[ctx.rng.int(fresh.length)];
}

/** The part of a card a player may see, with no undefined keys so state survives JSON untouched. */
function publicCard(card, choices) {
  const out = { id: card.id, prompt: card.prompt };
  if (card.image) out.image = card.image;
  if (card.emoji) out.emoji = card.emoji;
  if (choices) out.choices = choices;
  return out;
}

/** Other answers from the same deck (same category when possible), for multiple choice. */
function distractors(deck, card, n, rng) {
  const same = deck.cards.filter((c) => c.id !== card.id && c.answer !== card.answer && c.category === card.category);
  const any = deck.cards.filter((c) => c.id !== card.id && c.answer !== card.answer);
  const pool = same.length >= n ? same : any;
  const seen = new Set();
  const out = [];
  for (const c of rng.shuffle(pool)) {
    if (seen.has(c.answer)) continue;
    seen.add(c.answer);
    out.push(c.answer);
    if (out.length === n) break;
  }
  return out;
}

export default kit;
