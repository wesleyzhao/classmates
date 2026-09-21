// The scoreboard inside a game screen, as the kit ordered it. Between the name and the
// score sits whatever this card just did: the points someone gained, or the answer they
// gave when it was wrong. That is the column people actually read.
//
// The platform has its own Standings in app/components for the lobby and the results
// screen, which works from a summary. This one works from a kit's view, so a kit can show
// the table mid-game without the platform having to know what a round is.

import { html } from '../h.js';
import { Avatar } from '../components/Avatar.js';
import { formatScore, playerName } from '../lib.js';

/** @typedef {{ playerId: string, score: number, delta?: number, label?: string }} StandingsRow */

/**
 * @param {{
 *   rows: StandingsRow[],
 *   players?: import('../../../types/parlor.js').PlayerInfo[],
 *   me?: string | null,
 *   title?: string,
 *   note?: string,
 * }} props
 */
export function Standings({ rows, players = [], me = null, title = 'Standings', note = '' }) {
  if (!rows || !rows.length) return null;
  const byId = new Map(players.map((player) => [player.id, player]));
  return html`
    <section class="stack">
      ${title ? html`
        <div class="section-head">
          <h3>${title}</h3>
          ${note ? html`<span class="num small ink-2">${note}</span>` : null}
        </div>` : null}
      <ul class="list standings">
        ${rows.map((row, index) => {
          const player = byId.get(row.playerId) || null;
          return html`
            <li class="list-row" key=${row.playerId}>
              <span class="rank num">${index + 1}</span>
              <${Avatar} player=${player} size="sm" />
              <span class="strong grow">${playerName(player, me)}</span>
              ${sideNote(row)}
              <span class="score num">${formatScore(row.score)}</span>
            </li>`;
        })}
      </ul>
    </section>`;
}

/** What this card did for this player: the points, or the answer they gave. */
function sideNote(row) {
  if (row.delta > 0) return html`<span class="delta is-up num">+${formatScore(row.delta)}</span>`;
  if (row.label) return html`<span class="delta">${row.label}</span>`;
  return null;
}
