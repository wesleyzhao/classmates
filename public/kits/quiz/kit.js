// Quiz: everyone answers the same card at once, faster is worth more, and the answer goes
// up together. It is the first real mechanic on the platform and the one most games will
// use, so it is written to be read: five pure functions over a small state object, with the
// fiddly parts (drawing cards, running a round, grading free text) borrowed from helpers.
//
// Two things are worth knowing before changing anything here.
//
// Secrets (rule R2). While a card is up, nobody may learn the answer, and nobody may learn
// whether anyone else got it. So the answer lives in `round._card`, every submission lives
// in `round._answers` with the points it earned, and `scores` only moves at the reveal.
// What leaves the server before the reveal is a list of who has answered, and nothing else.
//
// Time (rule R4). A card ends at `round.endsAt`; a reveal ends five seconds later when the
// game is moving on by itself. Both are folded into the one `wakeAt` the platform watches,
// and `tick` runs with the clock clamped to whichever deadline it was.

import { KitError } from '../../shared/errors.js';
import { NumberWord, numberWord } from '../../shared/words.js';
import { match } from '../../shared/match.js';
import { pickCards, distractors, cardAt } from '../_lib/draw.js';
import * as rounds from '../_lib/rounds.js';
import { fold } from '../_lib/timers.js';

/** How long the answer stays up before the next card, when the game moves on by itself. */
const REVEAL_MS = 5000;
/** Points for each correct answer in a row after the first. */
const STREAK_BONUS = 25;
/** How many choices a card offers when the kit builds them itself. */
const CHOICE_COUNT = 4;
/** Rounds kept in `history`; a game is capped at 50 cards, so this holds a whole game. */
const HISTORY_LIMIT = 50;

/** @typedef {import('../../../types/parlor.js').Card} Card */
/** @typedef {{ deckId: string, cardId: string }} CardRef */
/** @typedef {{ value: unknown, at: number, correct: boolean, points: number }} QuizAnswer */
/** @typedef {Omit<import('../_lib/rounds.js').Round, '_answers'> & {
 *   card: { id: string, prompt: string, image?: string, emoji?: string, choices?: string[] },
 *   mode: 'choices' | 'text' | 'both',
 *   _card: { answer: string, aliases: string[], reject: string[], correctChoice: number },
 *   _late: string[],
 *   _answers: Record<string, QuizAnswer>,
 * }} QuizRound */
/** @typedef {import('../../../types/parlor.js').KitStateBase & {
 *   phase: 'card' | 'reveal' | 'over',
 *   index: number,
 *   round: QuizRound | null,
 *   scores: Record<string, number>,
 *   streaks: Record<string, number>,
 *   history: Array<{ n: number, answer: string, correctIds: string[] }>,
 *   _order: CardRef[],
 * }} QuizState */

/** @type {import('../../../types/parlor.js').Kit<QuizState>} */
const kit = {
  id: 'quiz',
  name: 'Quiz',
  tagline: 'Everyone answers the same card at once.',
  version: 1,
  minPlayers: 1,
  maxPlayers: 12,
  joinMidGame: 'next-round',

  config: {
    cards: { type: 'number', label: 'Cards per game', help: 'How many cards a game runs for.', min: 3, max: 50, default: 10 },
    seconds: { type: 'number', label: 'Seconds per card', help: 'Answering sooner is worth more.', min: 5, max: 90, default: 15 },
    answerMode: {
      type: 'choice',
      label: 'How people answer',
      options: [
        { value: 'choices', label: 'Tap a choice' },
        { value: 'text', label: 'Type it' },
        { value: 'both', label: 'Either way' },
      ],
      default: 'choices',
    },
    autoAdvance: { type: 'bool', label: 'Move on automatically', help: 'The answer stays up for five seconds. Turn this off to let the host set the pace.', default: true },
    choicesFrom: {
      type: 'choice',
      label: 'Where the choices come from',
      options: [
        { value: 'card', label: 'Only the card' },
        { value: 'deck', label: 'The card, then the deck' },
      ],
      default: 'deck',
    },
  },

  content: {
    decks: { type: 'decks', label: 'Where the cards come from', min: 1, cardFields: ['prompt', 'answer'] },
    categories: { type: 'list', label: 'Categories', help: 'Leave empty to use the whole deck.', of: { type: 'text' }, required: false },
  },

  setup(ctx) {
    const order = pickCards(ctx.decks, {
      count: ctx.config.cards,
      categories: ctx.content.categories,
      recent: ctx.recent,
      rng: ctx.rng,
    });
    /** @type {Record<string, number>} */
    const scores = {};
    /** @type {Record<string, number>} */
    const streaks = {};
    for (const player of ctx.players) { scores[player.id] = 0; streaks[player.id] = 0; }

    /** @type {QuizState} */
    const state = {
      $seed: '', $rng: 0, wakeAt: null,
      phase: 'card',
      index: 0,
      round: null,
      scores,
      streaks,
      history: [],
      _order: order,
    };
    ctx.log('started', { cards: order.length });
    return openCard(state, ctx, 0);
  },

  reduce(state, action, ctx) {
    const payload = action.payload || {};
    switch (action.type) {
      case 'answer': return answer(state, ctx, payload);

      case 'next': {
        requireHost(ctx);
        if (state.phase !== 'reveal') throw new KitError('wrong_phase', 'There is nothing to move on from yet.');
        return openCard(state, ctx, state.index + 1);
      }

      case 'skip': {
        requireHost(ctx);
        if (state.phase !== 'card') throw new KitError('wrong_phase', 'The answer is already up.');
        return revealCard(state, ctx, ctx.now);
      }

      case 'player/join': {
        const id = String(payload.playerId || '');
        if (!id || state.scores[id] !== undefined) return state;
        // They start on zero and watch this card out; the next one is theirs (joinMidGame).
        const next = {
          ...state,
          scores: { ...state.scores, [id]: 0 },
          streaks: { ...state.streaks, [id]: 0 },
        };
        if (state.phase !== 'card' || !state.round) return next;
        return { ...next, round: { ...state.round, _late: [...state.round._late, id] } };
      }

      case 'player/remove': {
        const id = String(payload.playerId || '');
        const scores = { ...state.scores };
        const streaks = { ...state.streaks };
        delete scores[id];
        delete streaks[id];
        let next = { ...state, scores, streaks };
        if (state.round) {
          const answers = { ...state.round._answers };
          delete answers[id];
          next = { ...next, round: { ...state.round, _answers: answers, answeredIds: state.round.answeredIds.filter((x) => x !== id) } };
        }
        return maybeRevealEarly(next, ctx);
      }

      // Someone closing their tab should not hold up the table; the rest may already be in.
      case 'player/leave': return maybeRevealEarly(state, ctx);

      case 'player/return':
      case 'host/transfer':
        return state;

      default:
        if (/^(player|host|game)\//.test(action.type)) return state;
        throw new KitError('unknown_action', `This game does not understand "${action.type}".`);
    }
  },

  tick(state, ctx) {
    if (state.phase === 'card' && state.round) return revealCard(state, ctx, ctx.now);
    if (state.phase === 'reveal') return openCard(state, ctx, state.index + 1);
    return { ...state, wakeAt: null };
  },

  view(state, ctx) {
    const revealed = state.phase !== 'card';
    const round = state.round;
    const waiting = round && state.phase === 'card' ? rounds.waitingOn(round, playing(state, ctx.players)) : [];
    const host = ctx.players.find((p) => p.isHost);
    /** @type {import('../../../types/parlor.js').ViewAction[]} */
    const actions = [];
    if (state.phase === 'reveal') {
      actions.push({ type: 'next', label: state.index + 1 >= state._order.length ? 'See the results' : 'Next card', kind: 'primary', host: true });
    } else if (state.phase === 'card') {
      actions.push({ type: 'skip', label: 'Show the answer', kind: 'secondary', host: true });
    }
    return {
      phase: state.phase,
      answerMode: round ? round.mode : ctx.config.answerMode,
      autoAdvance: !!ctx.config.autoAdvance,
      seconds: ctx.config.seconds,
      progress: { n: Math.min(state.index + 1, state._order.length), total: state._order.length },
      round: round ? publicRound(state, round, ctx, revealed) : null,
      scores: state.scores,
      standings: standings(state, revealed),
      wakeAt: state.wakeAt,
      waitingOn: state.phase === 'reveal' && !ctx.config.autoAdvance && host ? [host.id] : waiting,
      actions,
    };
  },

  summary(state) {
    const scores = Object.entries(state.scores).map(([playerId, score]) => ({ playerId, score }));
    scores.sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
    const top = scores.length ? scores[0].score : 0;
    return {
      phase: state.phase === 'over' ? 'over' : 'playing',
      scores,
      // Nobody wins a game nobody scored in.
      winnerIds: top > 0 ? scores.filter((entry) => entry.score === top).map((entry) => entry.playerId) : [],
      label: state.phase === 'over' ? 'Finished' : `Card ${Math.min(state.index + 1, state._order.length)} of ${state._order.length}`,
    };
  },

  demoDecks: ['demo'],
  blurb(config) {
    const how = config.answerMode === 'text' ? 'Type your answers.' : config.answerMode === 'both' ? 'Tap an answer or type it.' : 'Tap one of four answers.';
    return `${NumberWord(config.cards)} cards, ${numberWord(config.seconds)} seconds each. ${how}`;
  },

  demoConfig: { cards: 3, seconds: 10, answerMode: 'both', autoAdvance: true },
  demoContent: { decks: ['demo'] },
  demoScript: [
    ['p1', 'answer', { n: 1, value: 0 }],
    ['p2', 'answer', { n: 1, value: 1 }],
    ['p3', 'answer', { n: 1, value: 'the sun' }],
    ['@wait', 5100],
    ['p1', 'answer', { n: 2, value: 2 }],
    ['@wait', 20_000],
    ['p1', 'answer', { n: 3, value: 0 }],
    ['p2', 'answer', { n: 3, value: 0 }],
    ['p3', 'answer', { n: 3, value: 0 }],
    // Long enough that the game is over even when nobody answered and every card ran out.
    ['@wait', 60_000],
    ['@check', (sim) => { if (sim.summary().phase !== 'over') throw new Error('expected the game to be over'); }],
  ],
};

// ---------------------------------------------------------------------------
// actions

/**
 * Grade one answer and put it away until the reveal. The player learns only that it landed.
 * @param {QuizState} state
 * @param {import('../../../types/parlor.js').KitContext} ctx
 * @param {{ n?: number, value?: unknown }} payload
 * @returns {QuizState}
 */
function answer(state, ctx, payload) {
  const round = state.round;
  if (state.phase !== 'card' || !round) throw new KitError('wrong_phase', 'That card is not up any more.');
  if (!ctx.me || state.scores[ctx.me] === undefined) throw new KitError('not_playing', 'You are not in this game.');
  if (round._late.includes(ctx.me)) throw new KitError('wrong_phase', 'You joined while this card was up, so the next one is your first.');
  if (payload.n !== round.n) throw new KitError('stale', 'That card has moved on.');
  if (rounds.hasAnswered(round, ctx.me)) throw new KitError('already_done', 'You have already answered this one.');

  const value = cleanValue(payload.value, round);
  const correct = isCorrect(value, round);
  const streak = state.streaks[ctx.me] || 0;
  const points = correct ? rounds.speedScore(ctx.now - round.startedAt, ctx.config.seconds * 1000) + streak * STREAK_BONUS : 0;

  const withAnswer = rounds.submit(round, ctx.me, value, ctx.now);
  const graded = /** @type {QuizRound} */ ({
    ...withAnswer,
    _answers: { ...withAnswer._answers, [ctx.me]: { ...withAnswer._answers[ctx.me], correct, points } },
  });
  ctx.log('answered', { playerId: ctx.me });
  return maybeRevealEarly({ ...state, round: graded }, ctx);
}

/** A choice index or a line of text, and nothing else. */
function cleanValue(value, round) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (round.mode === 'text') throw new KitError('bad_answer', 'Type your answer for this one.');
    const choices = round.card.choices || [];
    if (value < 0 || value >= choices.length) throw new KitError('bad_answer', 'That choice is not on the card.');
    return value;
  }
  if (typeof value === 'string') {
    if (round.mode === 'choices') throw new KitError('bad_answer', 'Tap one of the choices for this one.');
    const text = value.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) throw new KitError('bad_answer', 'Type something first.');
    return text;
  }
  throw new KitError('bad_answer', 'That is not an answer.');
}

/** @returns {boolean} */
function isCorrect(value, round) {
  if (typeof value === 'number') return value === round._card.correctChoice;
  return match(value, round._card).ok;
}

/** Everyone connected is in, so there is nothing left to wait for. */
function maybeRevealEarly(state, ctx) {
  if (state.phase !== 'card' || !state.round) return state;
  const here = playing(state, ctx.players.filter((p) => p.connected));
  if (!rounds.allIn(state.round, here)) return state;
  return revealCard(state, ctx, ctx.now);
}

// ---------------------------------------------------------------------------
// the round loop

/**
 * Put up the card at `index`, or end the game when there are none left. Cards whose deck
 * changed under the room are stepped over rather than shown as a blank.
 * @param {QuizState} state
 * @param {import('../../../types/parlor.js').KitContext} ctx
 * @param {number} index
 * @returns {QuizState}
 */
function openCard(state, ctx, index) {
  let at = index;
  let card = null;
  while (at < state._order.length && !card) {
    card = cardAt(ctx.decks, state._order[at]);
    if (!card) at += 1;
  }
  if (!card) {
    ctx.log('finished', { cards: state.history.length });
    return { ...state, phase: 'over', index: state._order.length, wakeAt: null };
  }

  const mode = modeFor(card, ctx);
  const built = mode === 'text' ? { choices: null, correctChoice: -1 } : buildChoices(card, ctx);
  const base = rounds.start(state.round, { index: at, cardRef: state._order[at], seconds: ctx.config.seconds, now: ctx.now });
  /** @type {QuizRound} */
  const round = {
    ...base,
    _answers: {},
    // Rule R8: the card is copied into the room only now, when it goes up.
    card: {
      id: card.id,
      prompt: card.prompt,
      ...(card.emoji ? { emoji: card.emoji } : {}),
      ...(card.image ? { image: card.image } : {}),
      ...(built.choices ? { choices: built.choices } : {}),
    },
    mode: built.choices ? mode : 'text',
    _card: {
      answer: card.answer,
      aliases: card.aliases || [],
      reject: card.reject || [],
      correctChoice: built.correctChoice,
    },
    _late: [],
  };
  ctx.log('card', { n: round.n, cardId: card.id });
  return { ...state, phase: 'card', index: at, round, wakeAt: fold({ card: round.endsAt }) };
}

/**
 * Show the answer: fold the points people earned into the scores, move the streaks, and
 * remember who had it.
 * @param {QuizState} state
 * @param {import('../../../types/parlor.js').KitContext} ctx
 * @param {number} now
 * @returns {QuizState}
 */
function revealCard(state, ctx, now) {
  const round = /** @type {QuizRound} */ (rounds.reveal(state.round, now));
  const scores = { ...state.scores };
  const streaks = { ...state.streaks };
  /** @type {string[]} */
  const correctIds = [];
  for (const playerId of Object.keys(scores)) {
    const given = round._answers[playerId];
    if (given && given.correct) {
      scores[playerId] += given.points || 0;
      streaks[playerId] = (streaks[playerId] || 0) + 1;
      correctIds.push(playerId);
    } else {
      streaks[playerId] = 0;
    }
  }
  const history = [...state.history, { n: round.n, answer: round._card.answer, correctIds }].slice(-HISTORY_LIMIT);
  ctx.log('revealed', { n: round.n, answer: round._card.answer, correctIds });
  return {
    ...state,
    phase: 'reveal',
    round,
    scores,
    streaks,
    history,
    wakeAt: fold({ reveal: ctx.config.autoAdvance ? now + REVEAL_MS : null }),
  };
}

// ---------------------------------------------------------------------------
// cards and choices

/** A card with no choices to offer is typed, whatever the game asked for. */
function modeFor(card, ctx) {
  const mode = ctx.config.answerMode;
  if (mode === 'text') return 'text';
  const own = (card.choices || []).filter(Boolean);
  if (own.length >= 2) return mode;
  return ctx.config.choicesFrom === 'card' ? 'text' : mode;
}

/**
 * Four choices with the answer among them: the card's own when it has them, otherwise other
 * answers from the same corner of the deck.
 * @returns {{ choices: string[] | null, correctChoice: number }}
 */
function buildChoices(card, ctx) {
  const own = [...new Set((card.choices || []).filter(Boolean).map(String))];
  // The right choice always comes from the answer field, so a card whose own choices spell it
  // differently ("lisbon" against "Lisbon") offers it once rather than twice with one of them wrong.
  const same = (text) => String(text).trim().toLowerCase() === String(card.answer).trim().toLowerCase();
  const others = own.length >= 2
    ? own.filter((choice) => !same(choice))
    : distractors(ctx.decks, card, CHOICE_COUNT - 1, ctx.rng);
  const wrong = ctx.rng.shuffle(others).slice(0, CHOICE_COUNT - 1);
  if (!wrong.length) return { choices: null, correctChoice: -1 };
  const choices = ctx.rng.shuffle([card.answer, ...wrong]);
  return { choices, correctChoice: choices.indexOf(card.answer) };
}

// ---------------------------------------------------------------------------
// views

/** Who this card is waiting for: everyone with a score who did not join halfway through it. */
function playing(state, players) {
  const late = state.round ? state.round._late : [];
  return players.filter((p) => state.scores[p.id] !== undefined && !late.includes(p.id)).map((p) => p.id);
}

/**
 * The round as a player may see it. Before the reveal that is the card, the choices, and who
 * has answered. After it, the answer and what everyone said.
 */
function publicRound(state, round, ctx, revealed) {
  const mine = ctx.me ? round._answers[ctx.me] : null;
  const base = {
    n: round.n,
    card: round.card,
    startedAt: round.startedAt,
    endsAt: round.endsAt,
    answeredIds: round.answeredIds,
    canAnswer: !!ctx.me && state.scores[ctx.me] !== undefined && !round._late.includes(ctx.me),
  };
  if (!revealed) {
    return { ...base, mine: mine ? { value: mine.value, at: mine.at } : null };
  }
  const results = resultsOf(round);
  return {
    ...base,
    answer: round._card.answer,
    correctChoice: round._card.correctChoice,
    results,
    mine: mine ? { value: answerText(round, mine.value), pick: typeof mine.value === 'number' ? mine.value : -1, correct: !!mine.correct, points: mine.points || 0, ms: mine.at - round.startedAt } : null,
  };
}

/** Everyone who answered, the ones who had it first. */
function resultsOf(round) {
  return Object.entries(round._answers)
    .map(([playerId, given]) => ({
      playerId,
      correct: !!given.correct,
      value: answerText(round, given.value),
      points: given.points || 0,
      ms: given.at - round.startedAt,
    }))
    .sort((a, b) => Number(b.correct) - Number(a.correct) || a.ms - b.ms || a.playerId.localeCompare(b.playerId));
}

/** What a player said, in words: a tapped choice reads as the choice, not as its number. */
function answerText(round, value) {
  if (typeof value !== 'number') return String(value);
  return (round.card.choices || [])[value] ?? '';
}

/**
 * The scoreboard the play screen draws: in order, with what this card just changed, and with
 * a wrong answer shown beside the player who gave it.
 */
function standings(state, revealed) {
  const round = state.round;
  return Object.entries(state.scores)
    .map(([playerId, score]) => {
      const given = revealed && round ? round._answers[playerId] : null;
      const label = given && !given.correct ? answerText(round, given.value) : '';
      return {
        playerId,
        score,
        delta: given && given.correct ? given.points || 0 : 0,
        ...(label ? { label } : {}),
      };
    })
    .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
}

function requireHost(ctx) {
  if (!ctx.isHost) throw new KitError('not_host', 'Only the host can do that.');
}

export default kit;
