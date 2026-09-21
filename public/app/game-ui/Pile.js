// The two piles in the middle of a card game: the one you draw from, face down, and the one
// you play onto, face up. Between them they say everything about the state of the table that
// is not in somebody's hand.
//
// Drawing is an action in the platform's action bar (docs/KIT-CONTRACT.md, rule R3), so the
// draw pile here is a picture by default. A kit that wants a tappable pile passes onDraw and
// gets a button with a label, and the bar still carries the same action for everyone else.
//
// When an eight named a suit, the top card is no longer the whole truth: the discard says
// eight of clubs and the game is playing hearts. That is the one moment the suit gets a
// badge of its own, in the accent, so nobody plays the wrong colour.

import { html } from '../h.js';
import { Card, suitOf } from './Card.js';
import { parseCard } from '../../kits/_lib/deck.js';

/**
 * @param {{
 *   drawCount: number,
 *   top?: string | null,
 *   suit?: string,
 *   suitName?: string,
 *   onDraw?: () => void,
 * }} props
 * `suit` is the letter the game is playing on now, `suitName` the word for it from the kit.
 */
export function Piles({ drawCount, top, suit, suitName, onDraw }) {
  const named = !!(top && suit && parseCard(top).suit !== suit);
  const face = suitOf(suit || (top ? parseCard(top).suit : 'S'));
  const word = capital(suitName || face.name);
  return html`
    <div class="piles">
      <div class="pile">
        ${drawCount > 0
          ? html`<${Card} faceDown size="lg" label="The draw pile" onTap=${onDraw} />`
          : html`<div class="pile-gap card-lg"></div>`}
        <span class="pile-note num">${drawCount > 0 ? `${drawCount} left` : 'Empty'}</span>
      </div>
      <div class="pile">
        ${top
          ? html`<${Card} id=${top} size="lg" />`
          : html`<div class="pile-gap card-lg"></div>`}
        <span class="pile-note">
          <span class=${named ? 'tag tag-accent' : ''}>
            <span class=${!named && face.red ? 'suit-glyph is-red' : 'suit-glyph'} aria-hidden="true">${face.glyph}</span>
            ${' '}${word}
          </span>
        </span>
      </div>
    </div>`;
}

/** "hearts" as the kit says it, "Hearts" as a label reads it. */
function capital(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}
