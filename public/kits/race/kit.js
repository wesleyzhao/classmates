// Race: everyone answers the same card at once, and a right answer carries you down a track.
// It is the quiz turned into a footrace. Where the quiz pays you points for being quick, this
// pays you ground: one space for knowing it, two for knowing it first. The first player to the
// finish line ends the game there and then.
//
// Three things are worth knowing before changing anything here.
//
// Secrets (rule R2). While a card is up nobody may learn the answer, and nobody may learn
// whether anyone else has it right. So the answer lives in `round._card`, every submission in
// `round._answers`, and `pos` only moves at the reveal. What leaves the server before then is
// the list of who has answered, and nothing else.
//
// Time (rule R4). A card ends at `round.endsAt`, and the reveal holds for four seconds before
// the next card comes by itself. There is no host button between cards; the race keeps moving.
// Both deadlines are folded into the one `wakeAt` the platform watches.
//
// Ties. Being first is decided by when the server received the answer, the way the quiz decides
// who was quickest. Two answers stamped at the very same millisecond are a dead heat: they share
// the finish rather than being split by something arbitrary like a player id.

import { KitError } from '../../shared/errors.js';
import { numberWord } from '../../shared/words.js';
import { match } from '../../shared/match.js';
import { pickCards, distractors, cardAt } from '../_lib/draw.js';
import * as rounds from '../_lib/rounds.js';
import { fold } from '../_lib/timers.js';

/** How long the answer stays up before the next card comes by itself. */
const REVEAL_MS = 4000;
/** How many choices a card offers when the kit builds them itself. */
const CHOICE_COUNT = 4;
/** Cards drawn for a race: three a space, which is slack enough for a table that misses half of them. */
const CARDS_PER_SPACE = 3;
/** However long the track, a race is capped here, so a room never holds a deck-sized order. */
const CARD_LIMIT = 60;

/** @typedef {import('../../../types/parlor.js').Card} Card */
/** @typedef {{ deckId: string, cardId: string }} CardRef */
/** @typedef {{ value: unknown, at: number, correct: boolean }} RaceAnswer */
/** @typedef {Omit<import('../_lib/rounds.js').Round, '_answers'> & {
 *   card: { id: string, prompt: string, image?: string, emoji?: string, choices?: string[] },
 *   mode: 'choices' | 'text' | 'both',
 *   moves: Record<string, number>,
 *   firstId: string | null,
 *   _card: { answer: string, aliases: string[], reject: string[], correctChoice: number },
 *   _late: string[],
 *   _answers: Record<string, RaceAnswer>,
 * }} RaceRound */
/** @typedef {import('../../../types/parlor.js').KitStateBase & {
 *   phase: 'card' | 'reveal' | 'over',
 *   index: number,
 *   trackLength: number,
 *   round: RaceRound | null,
 *   pos: Record<string, number>,
 *   winnerIds: string[],
 *   _order: CardRef[],
 * }} RaceState */

/** @type {import('../../../types/parlor.js').Kit<RaceState>} */
const kit = {
  id: 'race',
  name: 'Race',
  tagline: 'Everyone answers at once, and right answers move you down the track.',
  version: 1,
  minPlayers: 1,
  maxPlayers: 12,
  joinMidGame: 'next-round',

  config: {
    trackLength: { type: 'number', label: 'Track length', help: 'Spaces to the finish.', min: 8, max: 40, default: 15 },
    seconds: { type: 'number', label: 'Seconds per card', min: 5, max: 60, default: 10 },
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
    boost: { type: 'bool', label: 'Fastest moves two', help: 'The first right answer moves two spaces instead of one.', default: true },
  },

  content: {
    decks: { type: 'decks', label: 'Where the cards come from', min: 1, cardFields: ['prompt', 'answer'] },
    categories: { type: 'list', label: 'Categories', help: 'Leave empty to use the whole deck.', of: { type: 'text' }, required: false },
  },

  setup(ctx) {
    const trackLength = ctx.config.trackLength;
    const order = pickCards(ctx.decks, {
      count: Math.min(CARD_LIMIT, trackLength * CARDS_PER_SPACE),
      categories: ctx.content.categories,
      recent: ctx.recent,
      rng: ctx.rng,
    });
    /** @type {Record<string, number>} */
    const pos = {};
    for (const player of ctx.players) pos[player.id] = 0;

    /** @type {RaceState} */
    const state = {
      $seed: '', $rng: 0, wakeAt: null,
      phase: 'card',
      index: 0,
      trackLength,
      round: null,
      pos,
      winnerIds: [],
      _order: order,
    };
    ctx.log('started', { trackLength, cards: order.length });
    return openCard(state, ctx, 0);
  },

  reduce(state, action, ctx) {
    const payload = action.payload || {};
    switch (action.type) {
      case 'answer': return answer(state, ctx, payload);

      case 'skip': {
        if (!ctx.isHost) throw new KitError('not_host', 'Only the host can do that.');
        if (state.phase !== 'card') throw new KitError('wrong_phase', 'The answer is already up.');
        return revealCard(state, ctx, ctx.now);
      }

      case 'player/join': {
        const id = String(payload.playerId || '');
        if (!id || state.pos[id] !== undefined) return state;
        // They start at the beginning and watch this card out; the next one is their first.
        const next = { ...state, pos: { ...state.pos, [id]: 0 } };
        if (state.phase !== 'card' || !state.round) return next;
        return { ...next, round: { ...state.round, _late: [...state.round._late, id] } };
      }

      case 'player/remove': {
        const id = String(payload.playerId || '');
        const pos = { ...state.pos };
        delete pos[id];
        let next = { ...state, pos, winnerIds: state.winnerIds.filter((x) => x !== id) };
        if (state.round) {
          const answers = { ...state.round._answers };
          delete answers[id];
          next = {
            ...next,
            round: {
              ...state.round,
              _answers: answers,
              answeredIds: state.round.answeredIds.filter((x) => x !== id),
              _late: state.round._late.filter((x) => x !== id),
            },
          };
        }
        return maybeRevealEarly(next, ctx);
      }

      // A closed tab keeps its seat and its place on the track (rule R7). It does stop being
      // waited for: if everyone still here has answered, the card turns over now rather than
      // at its timer. Coming back changes nothing: the race is the same race they left.
      case 'player/leave':
        return maybeRevealEarly(state, ctx);
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
    const waiting = round && state.phase === 'card' ? rounds.waitingOn(round, running(state, ctx.players)) : [];
    /** @type {import('../../../types/parlor.js').ViewAction[]} */
    const actions = [];
    if (state.phase === 'card') {
      actions.push({ type: 'skip', label: 'Show the answer', kind: 'secondary', host: true });
    }
    return {
      phase: state.phase,
      answerMode: round ? round.mode : ctx.config.answerMode,
      seconds: ctx.config.seconds,
      boost: !!ctx.config.boost,
      trackLength: state.trackLength,
      round: round ? publicRound(state, round, ctx, revealed) : null,
      pos: state.pos,
      wakeAt: state.wakeAt,
      waitingOn: waiting,
      actions,
    };
  },

  summary(state) {
    const scores = Object.entries(state.pos).map(([playerId, pos]) => ({
      playerId,
      score: pos,
      label: `${pos} of ${state.trackLength}`,
      finish: `finished on space ${pos} of ${state.trackLength}`,
    }));
    scores.sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
    return {
      phase: state.phase === 'over' ? 'over' : 'playing',
      scores,
      // A winner who has left the table is no winner the results screen can name.
      winnerIds: state.winnerIds.filter((id) => state.pos[id] !== undefined),
      label: state.phase === 'over' ? 'Finished' : `Card ${Math.min(state.index + 1, state._order.length)}`,
      unit: 'labels',
    };
  },

  demoDecks: ['demo'],
  blurb(config) {
    const how = config.boost
      ? 'A right answer moves one space, and the fastest right answer moves two.'
      : 'Every right answer moves you one space.';
    return `First to space ${numberWord(config.trackLength)} wins. ${how}`;
  },

  demoConfig: { trackLength: 8, seconds: 10, boost: true },
  demoContent: { decks: ['demo'] },
  demoScript: [
    ['p1', 'answer', { n: 1, value: 0 }],
    ['p2', 'answer', { n: 1, value: 1 }],
    ['p3', 'answer', { n: 1, value: 2 }],
    ['@wait', 4100],
    ['p1', 'answer', { n: 2, value: 0 }],
    ['@wait', 14_100],
    ['@join', 'p4'],
    ['p1', 'answer', { n: 3, value: 1 }],
    ['p2', 'answer', { n: 3, value: 1 }],
    ['p3', 'answer', { n: 3, value: 1 }],
    ['@wait', 4100],
    ['p4', 'answer', { n: 4, value: 0 }],
    ['p1', 'answer', { n: 4, value: 0 }],
    // Long enough that every card has been up and the race is over one way or the other.
    ['@wait', 120_000],
    ['@check', (sim) => { if (sim.summary().phase !== 'over') throw new Error('expected the race to be over'); }],
  ],
};

// ---------------------------------------------------------------------------
// actions

/**
 * Take one answer and put it away until the reveal. The player learns only that it landed.
 * @param {RaceState} state
 * @param {import('../../../types/parlor.js').KitContext} ctx
 * @param {{ n?: number, value?: unknown }} payload
 * @returns {RaceState}
 */
function answer(state, ctx, payload) {
  const round = state.round;
  if (state.phase !== 'card' || !round) throw new KitError('wrong_phase', 'That card is not up any more.');
  if (!ctx.me || state.pos[ctx.me] === undefined) throw new KitError('not_playing', 'You are not in this race.');
  if (round._late.includes(ctx.me)) throw new KitError('wrong_phase', 'You joined while this card was up, so the next one is your first.');
  if (payload.n !== round.n) throw new KitError('stale', 'That card has moved on.');
  if (rounds.hasAnswered(round, ctx.me)) throw new KitError('already_done', 'You have already answered this one.');

  const value = cleanValue(payload.value, round);
  const correct = isCorrect(value, round);
  const withAnswer = rounds.submit(round, ctx.me, value, ctx.now);
  const graded = /** @type {RaceRound} */ ({
    ...withAnswer,
    _answers: { ...withAnswer._answers, [ctx.me]: { ...withAnswer._answers[ctx.me], correct } },
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

/** Everyone still at the table is in, so there is nothing left to wait for. */
function maybeRevealEarly(state, ctx) {
  if (state.phase !== 'card' || !state.round) return state;
  const here = running(state, ctx.players.filter((p) => p.connected));
  if (!rounds.allIn(state.round, here)) return state;
  return revealCard(state, ctx, ctx.now);
}

// ---------------------------------------------------------------------------
// the round loop

/**
 * Put up the card at `index`. When there are none left the race stops where it is and the
 * player who got furthest wins. Cards whose deck changed under the room are stepped over.
 * @param {RaceState} state
 * @param {import('../../../types/parlor.js').KitContext} ctx
 * @param {number} index
 * @returns {RaceState}
 */
function openCard(state, ctx, index) {
  let at = index;
  let card = null;
  while (at < state._order.length && !card) {
    card = cardAt(ctx.decks, state._order[at]);
    if (!card) at += 1;
  }
  if (!card) return outOfCards(state, ctx);

  const built = ctx.config.answerMode === 'text' ? { choices: null, correctChoice: -1 } : buildChoices(card, ctx);
  const base = rounds.start(state.round, { index: at, cardRef: state._order[at], seconds: ctx.config.seconds, now: ctx.now });
  /** @type {RaceRound} */
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
    mode: built.choices ? (ctx.config.answerMode === 'both' ? 'both' : 'choices') : 'text',
    moves: {},
    firstId: null,
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
 * Show the answer and move everyone who had it. One space each, two for whoever was first
 * when the boost is on, and nothing at all for a wrong answer or no answer.
 * @param {RaceState} state
 * @param {import('../../../types/parlor.js').KitContext} ctx
 * @param {number} now
 * @returns {RaceState}
 */
function revealCard(state, ctx, now) {
  const round = /** @type {RaceRound} */ (rounds.reveal(state.round, now));
  const right = Object.entries(round._answers)
    .filter(([playerId, given]) => given.correct && state.pos[playerId] !== undefined)
    .map(([playerId, given]) => ({ playerId, at: given.at }))
    .sort((a, b) => a.at - b.at || a.playerId.localeCompare(b.playerId));

  const firstId = right.length ? right[0].playerId : null;
  /** @type {Record<string, number>} */
  const moves = {};
  for (const entry of right) moves[entry.playerId] = ctx.config.boost && entry.playerId === firstId ? 2 : 1;

  const pos = { ...state.pos };
  for (const [playerId, spaces] of Object.entries(moves)) {
    pos[playerId] = Math.min(state.trackLength, pos[playerId] + spaces);
  }
  const moved = /** @type {RaceRound} */ ({ ...round, moves, firstId });
  ctx.log('revealed', { n: round.n, answer: round._card.answer, moved: Object.keys(moves) });

  const home = Object.keys(pos).filter((playerId) => pos[playerId] >= state.trackLength);
  if (home.length) {
    // Several over the line together are split by who answered first, and a dead heat shares it.
    const timeOf = (playerId) => {
      const given = round._answers[playerId];
      return given && given.correct ? given.at : Infinity;
    };
    const best = Math.min(...home.map(timeOf));
    const winnerIds = home.filter((playerId) => timeOf(playerId) === best);
    ctx.log('finished', { winnerIds, space: state.trackLength });
    return { ...state, phase: 'over', round: moved, pos, winnerIds, wakeAt: null };
  }

  return { ...state, phase: 'reveal', round: moved, pos, wakeAt: fold({ reveal: now + REVEAL_MS }) };
}

/** The deck ran dry before anyone crossed the line, so the race is won from where people stand. */
function outOfCards(state, ctx) {
  const places = Object.values(state.pos);
  const top = places.length ? Math.max(...places) : 0;
  // Nobody wins a race nobody ran.
  const winnerIds = top > 0 ? Object.keys(state.pos).filter((playerId) => state.pos[playerId] === top) : [];
  ctx.log('finished', { winnerIds, space: top });
  return { ...state, phase: 'over', index: state._order.length, winnerIds, wakeAt: null };
}

// ---------------------------------------------------------------------------
// cards and choices

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

/** Who this card is waiting for: everyone on the track who did not arrive halfway through it. */
function running(state, players) {
  const late = state.round ? state.round._late : [];
  return players.filter((p) => state.pos[p.id] !== undefined && !late.includes(p.id)).map((p) => p.id);
}

/**
 * The round as a player may see it. Before the reveal that is the card, the choices, and who
 * has answered. After it, the answer, who moved and how far, and what everyone else said.
 */
function publicRound(state, round, ctx, revealed) {
  const mine = ctx.me ? round._answers[ctx.me] : null;
  const base = {
    n: round.n,
    card: round.card,
    startedAt: round.startedAt,
    endsAt: round.endsAt,
    answeredIds: round.answeredIds,
    canAnswer: !!ctx.me && state.pos[ctx.me] !== undefined && !round._late.includes(ctx.me),
  };
  if (!revealed) {
    return { ...base, mine: mine ? { value: mine.value, at: mine.at } : null };
  }
  return {
    ...base,
    answer: round._card.answer,
    correctChoice: round._card.correctChoice,
    firstId: round.firstId,
    results: resultsOf(round),
    mine: mine
      ? {
        value: answerText(round, mine.value),
        pick: typeof mine.value === 'number' ? mine.value : -1,
        correct: !!mine.correct,
        spaces: round.moves[ctx.me] || 0,
        ms: mine.at - round.startedAt,
      }
      : null,
  };
}

/** Everyone who answered: the movers first and fastest, then the ones who missed. */
function resultsOf(round) {
  return Object.entries(round._answers)
    .map(([playerId, given]) => ({
      playerId,
      correct: !!given.correct,
      value: answerText(round, given.value),
      spaces: round.moves[playerId] || 0,
      ms: given.at - round.startedAt,
    }))
    .sort((a, b) => Number(b.correct) - Number(a.correct) || a.ms - b.ms || a.playerId.localeCompare(b.playerId));
}

/** What a player said, in words: a tapped choice reads as the choice, not as its number. */
function answerText(round, value) {
  if (typeof value !== 'number') return String(value);
  return (round.card.choices || [])[value] ?? '';
}

export default kit;
