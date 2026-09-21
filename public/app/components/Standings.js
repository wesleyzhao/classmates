// The scoreboard, in the order the kit put its scores in. Two things sit between the name
// and the score: whatever the kit labelled the row with ("Spain", "8 of 10"), or, when it
// labelled nothing, how much this player moved since the last snapshot. The delta is what
// makes a mid-game standings list worth looking at.

import { html } from '../h.js';
import { Avatar } from './Avatar.js';
import { formatScore, standingsRows } from '../lib.js';

/**
 * @param {{
 *   summary: import('../../../types/parlor.js').Summary | null,
 *   players: import('../../../types/parlor.js').PlayerInfo[],
 *   previous?: Record<string, number> | null,
 *   meId?: string | null,
 *   title?: string,
 *   note?: string,
 *   showScores?: boolean,
 * }} props
 *   `showScores` is false when the kit's labels are the whole story (cards left, wedges).
 */
export function Standings({ summary, players, previous, meId, title = 'Standings', note = '', showScores = true }) {
  const rows = standingsRows(summary, players, previous || null, meId || null);
  if (!rows.length) return null;
  return html`
    <section class="stack">
      ${title
        ? html`<div class="section-head"><h3>${title}</h3>${note ? html`<span class="num small ink-2">${note}</span>` : null}</div>`
        : null}
      <ul class="list standings">
        ${rows.map((row) => html`
          <li class="list-row" key=${row.playerId}>
            <span class="rank num">${row.rank}</span>
            <${Avatar} avatar=${row.avatar} size="sm" away=${false} />
            <span class="strong grow">${row.name}</span>
            ${showScores ? sideNote(row) : null}
            ${showScores
              ? html`<span class="score num">${formatScore(row.score)}</span>`
              : html`<span class="score-label">${row.label}</span>`}
          </li>`)}
      </ul>
    </section>`;
}

/** The kit's own label wins; otherwise show the move, and show nothing when nothing moved. */
function sideNote(row) {
  if (row.label) return html`<span class="delta">${row.label}</span>`;
  if (row.delta > 0) return html`<span class="delta is-up num">+${formatScore(row.delta)}</span>`;
  if (row.delta < 0) return html`<span class="delta is-down num">${formatScore(row.delta)}</span>`;
  return null;
}
