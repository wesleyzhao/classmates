// Piles of cards for kits with hidden hands: build a deck, deal, draw, and reshuffle. Pure
// functions over arrays of card ids; the kit keeps the piles under secret keys (`_draw`, `_hands`)
// and exposes only what a player may see (their own hand, everyone's counts, the discard).
//
//   const deck = standardDeck();                 // ['AS', '2S', ... 'KH'], 52 ids
//   const { hands, rest } = deal(rng.shuffle(deck), ['ann', 'ben'], 5);
//   const [taken, remaining] = draw(rest, 1);
//   const { draw: fresh, discard: top } = reshuffle(remaining, discardPile, rng);

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A standard 52-card deck as ids like 'AS' (ace of spades) and '10H' (ten of hearts). */
export function standardDeck() {
  const out = [];
  for (const s of SUITS) for (const r of RANKS) out.push(r + s);
  return out;
}

/** Split an id into rank and suit: '10H' -> { rank: '10', suit: 'H' }. */
export function parseCard(id) {
  return { rank: id.slice(0, -1), suit: id.slice(-1) };
}

/**
 * Deal `n` cards to each seat in order, one at a time round the table.
 * @param {string[]} pile
 * @param {string[]} seats
 * @param {number} n
 * @returns {{ hands: Record<string, string[]>, rest: string[] }}
 */
export function deal(pile, seats, n) {
  /** @type {Record<string, string[]>} */
  const hands = {};
  for (const id of seats) hands[id] = [];
  let i = 0;
  for (let round = 0; round < n; round++) {
    for (const id of seats) {
      if (i >= pile.length) break;
      hands[id].push(pile[i++]);
    }
  }
  return { hands, rest: pile.slice(i) };
}

/**
 * Take up to `n` cards off the top of a pile.
 * @param {string[]} pile
 * @param {number} n
 * @returns {[string[], string[]]}  the cards taken, and the pile that remains
 */
export function draw(pile, n) {
  return [pile.slice(0, n), pile.slice(n)];
}

/**
 * When the draw pile runs out, shuffle the discard pile (minus its top card) into a new draw pile.
 * @param {string[]} drawPile
 * @param {string[]} discard  top card last
 * @param {import('../../../types/parlor.js').Rng} rng
 * @returns {{ draw: string[], discard: string[] }}
 */
export function reshuffle(drawPile, discard, rng) {
  if (drawPile.length || discard.length < 2) return { draw: drawPile, discard };
  const top = discard[discard.length - 1];
  return { draw: rng.shuffle(discard.slice(0, -1)), discard: [top] };
}
