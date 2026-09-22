// The guest entry is the countdown itself, shared with the brief module-loading fallback.
import { html } from "../app/h.js";

/** Show the automatic ten-face countdown without an introduction or start button. */
export function GuestCountdown({ count = 3, waiting = false, onSignIn = null }) {
  return html`<section class="sprint-stage guest-countdown"><div class="cab attract">
    <h1 class="sr-only">Ten-person speed round</h1>
    <div class="guest-count" role="status" aria-live="polite" aria-label=${`Starting in ${count}`}>${count}</div>
    <p class="guest-count-hint">10 faces. Tap a name.</p>
    ${waiting && html`<span class="sr-only" role="status">Preparing photos. Your timer has not started.</span>`}
    ${onSignIn && html`<button class="linkbtn" onClick=${onSignIn}>Sign in instead</button>`}
  </div></section>`;
}
