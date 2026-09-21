// Nothing lives at this address. Four-letter room codes look enough like typos that the
// most useful thing this screen can do is send people back to the place with the code box.

import { html } from '../h.js';

export function NotFound() {
  return html`
    <main class="page">
      <div class="stack">
        <h1>Nothing here</h1>
        <p class="lede">That link does not lead anywhere in Parlor. Check it, or go back and pick a game.</p>
        <div><a class="btn btn-primary btn-tall" href="/">Back to Parlor</a></div>
      </div>
    </main>`;
}
