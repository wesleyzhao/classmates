// The cards you are holding, fanned the way a hand of cards is actually held: the middle
// rides highest, the ends tilt away, and each card overlaps the one before it.
//
// The overlap is computed from how many cards you hold, not fixed, because a hand grows.
// Five cards sit comfortably apart; twelve close up until the corner of each is still
// showing, which is all you need to read a hand. The geometry is inline styles rather than
// classes because CSS cannot count the cards.
//
// Only a card you may play is a button. The rest are there to be read, not tapped, which is
// also what tells a player why nothing happens when they press one. Arrow keys walk the
// playable cards, Enter plays the one in focus, and a card knows its own name.

import { html, useRef, useState } from '../h.js';
import { Card } from './Card.js';

/** How far apart two cards sit at most, and how wide the whole fan may ever get. */
const MAX_STEP = 48;
const MAX_SPREAD = 210;
/** How far the middle of the fan rides above its ends, how far a playable card rises, and the tilt. */
const ARC = 14;
const LIFT = 12;
const TILT = 14;

/**
 * @param {{
 *   cards: string[],
 *   playable?: string[],
 *   onPlay?: (card: string) => void,
 *   selected?: string | null,
 * }} props
 */
export function Hand({ cards, playable = [], onPlay, selected = null }) {
  const root = useRef(/** @type {any} */ (null));
  const [cursor, setCursor] = useState(0);
  if (!cards || !cards.length) return html`<p class="small muted center">Your hand is empty.</p>`;

  const canTap = !!onPlay && playable.length > 0;
  const count = cards.length;
  const step = count > 1 ? Math.min(MAX_STEP, MAX_SPREAD / (count - 1)) : 0;
  const spread = step * (count - 1);
  // Where the roving tab stop sits, counted among the playable cards in the order they are held.
  const stops = cards.filter((id) => playable.includes(id)).length;
  const at = Math.min(cursor, Math.max(0, stops - 1));

  /** Left and right walk the cards that can be played; up and down do the same, for a thumb. */
  function onKeyDown(event) {
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[event.key];
    if (!move || !root.current) return;
    const buttons = Array.from(root.current.querySelectorAll('button.card'));
    if (buttons.length < 2) return;
    const here = buttons.indexOf(document.activeElement);
    const next = (((here < 0 ? 0 : here + move) % buttons.length) + buttons.length) % buttons.length;
    event.preventDefault();
    setCursor(next);
    /** @type {any} */ (buttons[next]).focus();
  }

  let stop = -1;
  return html`
    <div class="hand" role="group" aria-label="Your hand" ref=${root} onKeyDown=${onKeyDown}>
      ${cards.map((id, index) => {
        const playing = canTap && playable.includes(id);
        if (playing) stop += 1;
        const t = count > 1 ? (index / (count - 1)) * 2 - 1 : 0;
        const rise = ARC * (1 - t * t) + (playing ? LIFT : 0);
        const style = [
          `transform: translateX(calc(-50% + ${round(t * (spread / 2))}px))`,
          `translateY(${round(-rise)}px)`,
          `rotate(${round(t * TILT)}deg);`,
          `z-index: ${id === selected ? 40 : index + 1};`,
        ].join(' ');
        return html`
          <span class="hand-slot" key=${id} style=${style}>
            <${Card}
              id=${id}
              size="md"
              selected=${id === selected}
              dim=${canTap && !playing && id !== selected}
              tabIndex=${playing ? (stop === at ? 0 : -1) : undefined}
              onTap=${playing ? () => onPlay(id) : undefined}
            />
          </span>`;
      })}
    </div>`;
}

/** A transform full of decimals is noise in the DOM, and a tenth of a pixel is plenty. */
function round(value) {
  return Math.round(value * 10) / 10;
}
