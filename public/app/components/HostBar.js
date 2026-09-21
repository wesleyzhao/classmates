// The kit says what can be done right now (`view.actions`); this draws it. Keeping the
// buttons out of the kit means every game's primary action lands in the same place, at the
// bottom of the screen, at the same size, whichever kit is running.
//
// Everything goes in the action bar, in one row: secondary actions first, the primary one
// last and widest. An action marked `host` is only drawn for the host, and one with
// `confirm` opens a sheet first, because some of them cannot be taken back.
//
// One exception: an action with `kind: 'canvas'` is drawn by the kit on its own screen (a
// card, a board space, a choice tile) and skipped here. It is still in `view.actions` so the
// conformance suite can check that `reduce` accepts it, but only one of us ever draws it, so
// nothing can appear twice.
//
// It returns its nodes without a wrapper, because `.actionbar` has to be a direct child of
// `.page` for its sticky bottom and its edge-to-edge background to work.

import { html, useState } from '../h.js';
import { Sheet } from './Sheet.js';
import { barActions } from '../lib.js';

/**
 * @param {{
 *   actions?: import('../../../types/parlor.js').ViewAction[],
 *   isHost?: boolean,
 *   send: (type: string, payload?: any) => void,
 *   note?: string,
 *   extra?: any,
 * }} props
 */
export function HostBar({ actions, isHost, send, note, extra }) {
  const [pending, setPending] = useState(/** @type {import('../../../types/parlor.js').ViewAction | null} */ (null));

  const mine = barActions(actions, isHost);
  // A view should carry at most one primary. If it carries two, both are drawn wide rather
  // than one being dropped silently: two big buttons is a visible bug, a missing one is not.
  const primary = mine.filter((action) => action.kind === 'primary');
  const rest = mine.filter((action) => action.kind !== 'primary');
  if (!mine.length && !extra && !note) return null;

  /** @param {import('../../../types/parlor.js').ViewAction} action */
  function run(action) {
    if (action.disabled) return;
    if (action.confirm) { setPending(action); return; }
    send(action.type, action.payload);
  }

  function confirmPending() {
    const action = pending;
    setPending(null);
    if (action) send(action.type, action.payload);
  }

  const alone = !rest.length && !extra;
  const buttons = [
    extra,
    ...rest.map((action) => html`
      <button key=${action.type + (action.label || '')}
              class=${action.kind === 'danger' ? 'btn btn-danger' : 'btn btn-secondary'}
              disabled=${Boolean(action.disabled)}
              onClick=${() => run(action)}>${action.label}</button>`),
    ...primary.map((action) => html`
      <button key=${action.type + (action.label || '')}
              class=${alone ? 'btn btn-primary btn-block btn-tall' : 'btn btn-primary btn-tall'}
              disabled=${Boolean(action.disabled)}
              onClick=${() => run(action)}>${action.label}</button>`),
  ].filter(Boolean);

  return html`
    <div class="actionbar">
      ${alone ? buttons : html`<div class="btn-group row-wrap">${buttons}</div>`}
      ${note ? html`<p class="actionbar-note">${note}</p>` : null}
    </div>
    ${pending
      ? html`<${Sheet} title=${pending.label} onClose=${() => setPending(null)}>
          <p class="lede">${pending.confirm}</p>
          <button class="btn btn-primary btn-block btn-tall" onClick=${confirmPending}>${pending.label}</button>
          <button class="btn btn-ghost btn-block" onClick=${() => setPending(null)}>Cancel</button>
        <//>`
      : null}`;
}
