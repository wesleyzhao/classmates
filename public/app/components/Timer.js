// Countdowns. Both shapes read the same two things: `wakeAt`, the epoch millisecond the
// kit put in its view, and serverNow(), the clock corrected for this device's drift. A
// phone whose clock is two minutes fast must not show two minutes less than everyone else.
//
// They re-render four times a second, and only while something is actually counting: an
// idle screen with a timer on it should cost nothing.

import { html, useEffect, useRef, useState } from '../h.js';
import { serverNow } from '../net.js';

/** Four frames a second is smooth enough for a number that changes once a second. */
const TICK = 250;
/** Under this, the timer turns red and people start tapping. */
const LOW = 4000;
/** The ring is drawn on a 44 unit box with a radius of 19. */
const CIRCUMFERENCE = 2 * Math.PI * 19;

/**
 * The server's clock, ticking, but only while `active`. When it stops the last value stays
 * put, so a screen that has finished counting does not flicker back to zero.
 * @param {boolean} active
 * @returns {number} epoch ms as the server sees it
 */
export function useNow(active) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!active) return undefined;
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), TICK);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * How much of a deadline is left, and how much there was to begin with. The full span is
 * remembered from the first time we saw this deadline, because the view says when a round
 * ends but not how long it was.
 */
function useSpan(wakeAt, total, now) {
  const seen = useRef({ wakeAt: /** @type {number | null} */ (null), total: 0 });
  const remaining = Math.max(0, (Number(wakeAt) || 0) - now);
  if (seen.current.wakeAt !== wakeAt) seen.current = { wakeAt: wakeAt ?? null, total: remaining };
  const full = Number(total) || seen.current.total || remaining || 1;
  return { remaining, full, fraction: Math.min(1, Math.max(0, remaining / full)) };
}

/**
 * The ring with the seconds inside it, for the corner of a play screen.
 * @param {{ wakeAt?: number | null, total?: number, now?: number, label?: string }} props
 */
export function TimerRing({ wakeAt, total, now }) {
  const running = typeof wakeAt === 'number' && wakeAt > 0;
  const ticking = useNow(running);
  const at = typeof now === 'number' ? now : ticking;
  const { remaining, fraction } = useSpan(wakeAt, total, at);
  if (!running) return null;
  const seconds = Math.ceil(remaining / 1000);
  const low = remaining < LOW;
  return html`
    <div class=${low ? 'timer-ring is-low' : 'timer-ring'} role="timer" aria-label=${`${seconds} seconds left`}>
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
        <circle class="track" cx="22" cy="22" r="19" fill="none" stroke-width="3"></circle>
        <circle class="arc" cx="22" cy="22" r="19" fill="none" stroke-width="3" stroke-linecap="round"
                stroke-dasharray=${CIRCUMFERENCE.toFixed(1)}
                stroke-dashoffset=${(CIRCUMFERENCE * (1 - fraction)).toFixed(1)}
                transform="rotate(-90 22 22)"></circle>
      </svg>
      <span class="label num" aria-hidden="true">${seconds}</span>
    </div>`;
}

/**
 * The bar, for a screen that wants the time across the top rather than in a corner.
 * @param {{ wakeAt?: number | null, total?: number, now?: number }} props
 */
export function TimerBar({ wakeAt, total, now }) {
  const running = typeof wakeAt === 'number' && wakeAt > 0;
  const ticking = useNow(running);
  const at = typeof now === 'number' ? now : ticking;
  const { remaining, fraction } = useSpan(wakeAt, total, at);
  if (!running) return null;
  const seconds = Math.ceil(remaining / 1000);
  return html`
    <div class=${remaining < LOW ? 'timer-bar is-low' : 'timer-bar'} role="timer" aria-label=${`${seconds} seconds left`}>
      <i style=${`width: ${(fraction * 100).toFixed(1)}%`}></i>
    </div>`;
}
