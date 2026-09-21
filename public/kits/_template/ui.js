// Tally's screen. A kit's ui.js exports Play (the in-game screen) and Editor (the
// creator step). Both are Preact components; both get everything they need as props
// and never talk to the network themselves. The Tap button itself is drawn by the platform from
// `view.actions`; a kit draws only the controls that need a picture (a board, a hand of cards).

import { html } from '../../app/h.js';

/**
 * @param {{ view: any, me: string | null, players: any[], send: (type: string, payload?: any) => void, now: number }} props
 */
export function Play({ view, me, players, send, now }) {
  const secondsLeft = Math.max(0, Math.ceil((view.endsAt - now) / 1000));
  const rows = players.map((p) => html`
    <li class="list-row" key=${p.id}>
      <span class="avatar">${p.avatar}</span>
      <span class="strong grow">${p.name}</span>
      <span class="score num">${view.taps[p.id] ?? 0}</span>
    </li>`);
  return html`
    <div class="stack">
      <p class="lede">${view.phase === 'over' ? 'Time' : `${secondsLeft}s left. First to ${view.target}.`}</p>
      <ul class="list">${rows}</ul>
    </div>`;
}

/** Tally has no content of its own, so the editor is the generated settings form only. */
export function Editor() {
  return null;
}
