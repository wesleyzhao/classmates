// Choosing cards from decks. Two jobs, both pure and both seeded by the caller's rng:
// pick the cards a game will use without repeating itself or repeating the last time these
// phones played, and build plausible wrong answers when a card did not ship with any.
//
// The platform hands a kit `ctx.decks` (every deck the game refers to, with its cards) and
// `ctx.recent` (card ids the devices at this table have seen lately). This file knows about
// neither rooms nor players; it takes what it is given.
//
//   pickCards(ctx.decks, { count: 10, recent: ctx.recent, rng: ctx.rng })
//   // -> [{ deckId: 'countries', cardId: 'fr' }, ...]

/** @typedef {import('../../../types/parlor.js').Deck} Deck */
/** @typedef {import('../../../types/parlor.js').Card} Card */
/** @typedef {{ deckId: string, cardId: string }} CardRef */

/**
 * Choose cards to play, newest to these phones first.
 * Cards the table has seen recently are held back and used only when the pool runs dry,
 * so a short deck still fills a long game instead of stopping early.
 * @param {Record<string, Deck>} decks  by id, as `ctx.decks` gives them
 * @param {{ count: number, categories?: string[], recent?: string[], rng: import('../../../types/parlor.js').Rng }} opts
 * @returns {CardRef[]} at most `count` refs, never the same card twice
 */
export function pickCards(decks, { count, categories, recent, rng }) {
  const wanted = Math.max(0, Math.floor(count) || 0);
  const pool = cardsIn(decks, categories);
  const seen = new Set(recent || []);
  const fresh = pool.filter((entry) => !seen.has(entry.cardId));
  const again = pool.filter((entry) => seen.has(entry.cardId));
  const order = [...rng.shuffle(fresh), ...rng.shuffle(again)];
  return order.slice(0, wanted).map(({ deckId, cardId }) => ({ deckId, cardId }));
}

/**
 * Wrong answers for a multiple choice card, drawn from its neighbours. Cards in the same
 * category make the best distractors, because a question about flags should not offer a
 * composer as one of its four choices.
 * @param {Record<string, Deck>} decks
 * @param {Card} card  the card being asked
 * @param {number} n  how many wrong answers to find
 * @param {import('../../../types/parlor.js').Rng} rng
 * @returns {string[]} up to `n` answers, all different from each other and from the card's
 */
export function distractors(decks, card, n, rng) {
  const wanted = Math.max(0, Math.floor(n) || 0);
  const taken = new Set([key(card && card.answer)]);
  /** @type {string[]} */
  const near = [];
  /** @type {string[]} */
  const far = [];
  for (const entry of cardsIn(decks)) {
    const answer = String(entry.card.answer || '').trim();
    if (!answer || taken.has(key(answer))) continue;
    taken.add(key(answer));
    if (card && card.category && entry.card.category === card.category) near.push(answer);
    else far.push(answer);
  }
  const picked = rng.shuffle(near).slice(0, wanted);
  if (picked.length < wanted) picked.push(...rng.shuffle(far).slice(0, wanted - picked.length));
  return picked;
}

/**
 * One card by reference, or null when the deck or the card has gone.
 * @param {Record<string, Deck>} decks
 * @param {CardRef | null | undefined} ref
 * @returns {Card | null}
 */
export function cardAt(decks, ref) {
  const deck = ref && decks ? decks[ref.deckId] : null;
  if (!deck) return null;
  return (deck.cards || []).find((card) => card.id === ref.cardId) || null;
}

/**
 * Every card in every deck, in a stable order, optionally narrowed to categories.
 * An empty or missing category list means the whole deck.
 * @param {Record<string, Deck>} decks
 * @param {string[]} [categories]
 * @returns {Array<{ deckId: string, cardId: string, card: Card }>}
 */
export function cardsIn(decks, categories) {
  const wanted = (categories || []).filter(Boolean);
  /** @type {Array<{ deckId: string, cardId: string, card: Card }>} */
  const out = [];
  for (const deckId of Object.keys(decks || {}).sort()) {
    for (const card of (decks[deckId] && decks[deckId].cards) || []) {
      if (!card || !card.id) continue;
      if (wanted.length && !wanted.includes(card.category)) continue;
      out.push({ deckId, cardId: card.id, card });
    }
  }
  return out;
}

/** Two answers spelled the same way but for case and spacing are one answer. */
function key(answer) {
  return String(answer || '').trim().toLowerCase();
}
