// One playing card, drawn in CSS rather than fetched as an image: 52 pictures would be 52
// requests, and a card that has to load is a card that flickers on a phone on a train.
//
// A card is a rank and a suit in the top left, the same again upside down in the bottom
// right, and one large suit in the middle. Red suits take --bad, black suits take --ink, so
// the same component is right in both themes without knowing which one is on.
//
// A card that can be played is a <button> with a real label ("Seven of hearts"); a card that
// is only there to be looked at, like the top of the discard, is an image with the same label.
// The `data-card` attribute is the card's id, which is what the end to end test reads.

import { html } from '../h.js';
import { parseCard } from '../../kits/_lib/deck.js';

/** The four suits: the letter a card id ends with, the character to draw, and the words for it. */
export const SUITS = [
  { letter: 'S', glyph: '♠', name: 'Spades', one: 'spade', red: false },
  { letter: 'H', glyph: '♥', name: 'Hearts', one: 'heart', red: true },
  { letter: 'D', glyph: '♦', name: 'Diamonds', one: 'diamond', red: true },
  { letter: 'C', glyph: '♣', name: 'Clubs', one: 'club', red: false },
];

/** How each rank is said out loud. The face of the card still shows A, 10, J, Q, K. */
export const RANK_WORDS = {
  A: 'ace', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven',
  8: 'eight', 9: 'nine', 10: 'ten', J: 'jack', Q: 'queen', K: 'king',
};

/**
 * The suit a letter names, or a spade when the letter is nonsense. Falling back keeps a
 * malformed id on screen as a card rather than taking the hand down with it.
 * @param {string} letter  one of S, H, D, C
 */
export function suitOf(letter) {
  return SUITS.find((suit) => suit.letter === letter) || SUITS[0];
}

/**
 * A card the way a person says it, for sentences: "the eight of clubs".
 * @param {string} id  a card id like '8C'
 * @returns {string} lower case, so it can sit anywhere in a sentence
 */
export function cardWords(id) {
  const { rank, suit } = parseCard(String(id || ''));
  return `${RANK_WORDS[rank] || rank} of ${suitOf(suit).name.toLowerCase()}`;
}

/**
 * @param {{
 *   id?: string,
 *   faceDown?: boolean,
 *   size?: 'sm' | 'md' | 'lg',
 *   selected?: boolean,
 *   dim?: boolean,
 *   onTap?: () => void,
 *   label?: string,
 *   tabIndex?: number,
 * }} props
 * `label` replaces the spoken name, for a card whose job needs saying ("Play the eight of
 * clubs"). `tabIndex` is how Hand keeps one card in the tab order and moves focus itself.
 */
export function Card({ id, faceDown = false, size = 'md', selected = false, dim = false, onTap, label, tabIndex }) {
  const { rank, suit } = parseCard(String(id || ''));
  const face = suitOf(suit);
  const classes = ['card', `card-${size}`];
  if (faceDown) classes.push('card-back');
  else if (face.red) classes.push('is-red');
  if (selected) classes.push('is-selected');
  if (dim) classes.push('is-dim');

  const spoken = label || (faceDown ? 'A face down card' : sentence(cardWords(id)));
  // The pips are decoration: the card carries the name, so a screen reader hears it once.
  const front = faceDown ? null : html`
    <span aria-hidden="true">
      <span class="card-corner">${rank}<span class="suit-glyph">${face.glyph}</span></span>
      <span class="card-middle suit-glyph">${face.glyph}</span>
      <span class="card-corner card-corner-end">${rank}<span class="suit-glyph">${face.glyph}</span></span>
    </span>`;

  if (onTap) {
    return html`
      <button type="button" class=${classes.join(' ')} data-card=${id} aria-label=${spoken}
              tabindex=${tabIndex} onClick=${onTap}>${front}</button>`;
  }
  return html`
    <div class=${classes.join(' ')} data-card=${id} role="img" aria-label=${spoken}>${front}</div>`;
}

/** "seven of hearts" as the start of a label. */
function sentence(words) {
  return words ? words[0].toUpperCase() + words.slice(1) : words;
}
