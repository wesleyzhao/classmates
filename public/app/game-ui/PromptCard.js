// The card itself, on the stage: a big emoji, a picture, or the question set large when
// there is nothing to show. Kits hand it whatever their view calls a card, so it stays
// dumb: it draws what it is given and decides nothing about the game.
//
// The one clever bit is flag emoji. Windows has never drawn them, and a browser that cannot
// draw a flag falls back to the two letters of the country code, which gives the answer away
// on a flags quiz. So we test the canvas once and use the card's picture instead when the
// test fails.

import { html } from '../h.js';

/** @typedef {{ id?: string, prompt?: string, emoji?: string, image?: string, choices?: string[] }} PromptCardData */

/** Regional indicator pairs: the two code points every flag emoji is made of. */
const FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;
/** @type {boolean | null} */
let flagSupport = null;

/**
 * Does this browser draw flag emoji, or does it fall back to letters?
 * Measured once by drawing the French flag and the same two letters held apart: when the
 * browser has no flag glyph, the two drawings come out identical.
 * @returns {boolean}
 */
export function supportsFlagEmoji() {
  if (flagSupport !== null) return flagSupport;
  flagSupport = true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    if (!ctx) return flagSupport;
    ctx.textBaseline = 'top';
    ctx.font = '16px sans-serif';
    const draw = (text) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText(text, 0, 0);
      return canvas.toDataURL();
    };
    // \u{1F1EB}\u{1F1F7} is the flag; the zero width space between them stops it joining up.
    flagSupport = draw('\u{1F1EB}\u{1F1F7}') !== draw('\u{1F1EB}​\u{1F1F7}');
  } catch {
    // A canvas we are not allowed to read is not a reason to hide the card.
    flagSupport = true;
  }
  return flagSupport;
}

/**
 * Is there anything to look at? When there is not, the card puts its question on the stage
 * and the screen leaves out the heading, so the question is never asked twice.
 * @param {PromptCardData} card
 * @returns {boolean}
 */
export function hasMedia(card) {
  if (!card) return false;
  if (card.image) return true;
  return !!card.emoji && (!FLAG.test(card.emoji) || supportsFlagEmoji());
}

/**
 * @param {{ card: PromptCardData, compact?: boolean, size?: 'lg' | 'md' | 'sm' }} props
 *   `compact` shrinks it to a thumbnail for the reveal, where the standings matter more than
 *   the picture. `size: 'md'` is the one in between, for a screen that has to fit a race and
 *   the answers on a phone as well as the card.
 */
export function PromptCard({ card, compact, size = 'lg' }) {
  if (!card) return null;
  const classes = compact || size === 'sm' ? 'stage stage-sm' : size === 'md' ? 'stage stage-md' : 'stage';
  const drawable = !!card.emoji && (!FLAG.test(card.emoji) || supportsFlagEmoji());
  if (drawable) {
    return html`<figure class=${classes}><span class="stage-emoji" role="img" aria-label="">${card.emoji}</span></figure>`;
  }
  if (card.image) {
    // The picture is the question, so describing it would answer it.
    return html`<figure class=${classes}><img class="stage-image" src=${card.image} alt="" loading="eager" /></figure>`;
  }
  return html`<figure class=${`${classes} stage-words`}><span class="stage-text">${card.prompt}</span></figure>`;
}
