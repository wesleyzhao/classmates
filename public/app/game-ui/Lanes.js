// A race as lanes: one line per player, a token that slides along it, and a checkered flag at
// the end. It is the whole standings at a glance, which a snake of squares is not: on a
// track with forty spaces two tokens three rows apart look far apart when they are one space
// apart, and the board takes half a phone. Lanes take thirty pixels each however long the
// race is, so the card underneath stays where a thumb can reach it.
//
// A token moves with a CSS transition on its place along the lane, so when the answer goes
// up and the positions change, the runners are seen to run. The count at the end of each lane
// is the exact number, because two tokens a space apart look much alike.

import { html } from '../h.js';
import { playerName } from '../lib.js';

/** The face a player wears when we were told nothing about them. */
const FACE = '\u{1F642}';

/**
 * @param {{
 *   players: import('../../../types/parlor.js').PlayerInfo[],
 *   positions: Record<string, number>,
 *   length: number,
 *   meId?: string | null,
 * }} props
 *   `positions` is the space each player has reached, from 0 at the start to `length` at the
 *   finish. Players without a position are not in the race and get no lane.
 */
export function Lanes({ players = [], positions = {}, length, meId = null }) {
  const span = Math.max(1, Math.round(Number(length) || 0));
  const seated = players.filter((player) => positions[player.id] !== undefined);
  if (!seated.length) return null;
  const ticks = Array.from({ length: span + 1 }, (_, i) => i);
  return html`
    <div class="lanes" role="list" aria-label="The race">
      ${seated.map((player) => {
        const at = Math.max(0, Math.min(span, Number(positions[player.id]) || 0));
        const home = at >= span;
        return html`
          <div class=${laneClass(meId !== null && player.id === meId, home)} role="listitem" key=${player.id}
               aria-label=${`${playerName(player, meId)}, ${home ? 'finished' : `${at} of ${span}`}`}>
            <div class="lane-rail" aria-hidden="true">
              ${ticks.map((i) => html`
                <i key=${i} class=${i === span ? 'lane-tick is-finish' : i === 0 ? 'lane-tick is-start' : 'lane-tick'}
                   style=${`left:${(i / span) * 100}%`}></i>`)}
              <span class="lane-token" style=${`left:${(at / span) * 100}%`}>${player.avatar || FACE}</span>
            </div>
            <span class="lane-count num" aria-hidden="true">${at} of ${span}</span>
          </div>`;
      })}
    </div>`;
}

function laneClass(mine, home) {
  const classes = ['lane'];
  if (mine) classes.push('is-mine');
  if (home) classes.push('is-home');
  return classes.join(' ');
}
