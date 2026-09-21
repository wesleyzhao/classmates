// Wedges: the six dots that say how close someone is to winning, and the strip of everyone's
// counts under the board. A dot is filled in its category's colour once that wedge is won and
// hollow before then, so a glance across the table tells you who is nearly there.
//
// The colours come from the game's categories, which means they are content and not tokens. The
// shape, the size, and the hollow state are all CSS, so both themes get them right.

import { html } from '../h.js';
import { playerName, plural } from '../lib.js';

/** The face a player wears when we were told nothing about them. */
const FACE = '\u{1F642}';

/**
 * @typedef {{ id: string, name: string, color: string, emoji: string }} Cat
 */

/**
 * @param {{ cats: Cat[], owned?: boolean[], pop?: number | null, size?: 'sm' | 'md' }} props
 *   `pop` is the category that was just won, which gets the little bounce.
 */
export function Wedges({ cats = [], owned = [], pop = null, size = 'md' }) {
  if (!cats.length) return null;
  const count = owned.filter(Boolean).length;
  return html`
    <span class=${size === 'sm' ? 'wedges wedges-sm' : 'wedges'} role="img"
          aria-label=${`${plural(count, 'wedge', 'wedges')} of ${cats.length}`}>
      ${cats.map((cat, index) => html`
        <i
          key=${cat.id || index}
          class=${wedgeClass(!!owned[index], pop === index)}
          style=${owned[index] && cat.color ? `background:${cat.color};border-color:${cat.color}` : ''}
        ></i>`)}
    </span>`;
}

/**
 * Everyone's wedges in a row of chips, the player looking at it first.
 * @param {{
 *   players: import('../../../types/parlor.js').PlayerInfo[],
 *   wedges: Record<string, boolean[]>,
 *   cats: Cat[],
 *   meId?: string | null,
 *   pop?: { playerId: string, cat: number } | null,
 * }} props
 */
export function WedgeStrip({ players = [], wedges = {}, cats = [], meId = null, pop = null }) {
  const seated = players.filter((player) => wedges[player.id]);
  if (!seated.length) return null;
  return html`
    <div class="chip-strip">
      ${seated.map((player) => {
        const owned = wedges[player.id] || [];
        const count = owned.filter(Boolean).length;
        return html`
          <span class=${meId && player.id === meId ? 'chip is-mine' : 'chip'} key=${player.id}>
            <span class="chip-face" aria-hidden="true">${player.avatar || FACE}</span>
            <span class="sr-only">${playerName(player, meId)}</span>
            <span class="num">${plural(count, 'wedge', 'wedges')}</span>
            <${Wedges} cats=${cats} owned=${owned} size="sm"
                       pop=${pop && pop.playerId === player.id ? pop.cat : null} />
          </span>`;
      })}
    </div>`;
}

/**
 * Everyone's place on the track, which is what a race has instead of wedges.
 * @param {{
 *   players: import('../../../types/parlor.js').PlayerInfo[],
 *   positions: Record<string, string>,
 *   spaces: Record<string, import('../../kits/board/graph.js').Space>,
 *   length: number,
 *   meId?: string | null,
 * }} props
 */
export function TrackStrip({ players = [], positions = {}, spaces = {}, length = 0, meId = null }) {
  const seated = players.filter((player) => positions[player.id]);
  if (!seated.length) return null;
  return html`
    <div class="chip-strip">
      ${seated.map((player) => {
        const space = spaces[positions[player.id]];
        const at = (space && space.index) || 0;
        return html`
          <span class=${meId && player.id === meId ? 'chip is-mine' : 'chip'} key=${player.id}>
            <span class="chip-face" aria-hidden="true">${player.avatar || FACE}</span>
            <span class="sr-only">${playerName(player, meId)}</span>
            <span class="num">${at + 1} of ${length}</span>
          </span>`;
      })}
    </div>`;
}

function wedgeClass(owned, popping) {
  const classes = ['wedge'];
  if (owned) classes.push('is-owned');
  if (popping) classes.push('pop');
  return classes.join(' ');
}
