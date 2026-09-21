// Four emoji and the little things that float up when someone taps one. Reactions are the
// cheapest way for a table to make noise at each other without typing, and they are the
// only part of the platform that animates for its own sake.
//
// Which ones have already flown is decided by the log's `n`, not by a local counter, so a
// device that missed three polls shows the three it missed and not thirty from an hour ago.

import { html, useEffect, useRef, useState } from '../h.js';
import { ACTIONS, lastLogN, logSince } from '../lib.js';

/** The four. Enough to agree, disagree, be surprised, and be impressed. */
export const REACTIONS = ['👏', '😂', '😮', '🔥'];

/** How long a floating emoji lives, matching the float-up animation in base.css. */
const FLOAT_MS = 1900;

/**
 * @param {{
 *   log?: import('../../../types/parlor.js').LogEntry[],
 *   send: (type: string, payload?: any) => void,
 * }} props
 */
export function Reactions({ log, send }) {
  const [floats, setFloats] = useState(/** @type {Array<{ id: string, emoji: string, left: number }>} */ ([]));
  const seen = useRef(/** @type {number | null} */ (null));
  const highest = lastLogN(log);

  useEffect(() => {
    // The first log we see is history, not news: note where it got to and fly nothing.
    if (seen.current === null) { seen.current = highest; return undefined; }
    const fresh = logSince(log, seen.current).filter((entry) => entry.type === 'react');
    seen.current = highest;
    if (!fresh.length) return undefined;
    const added = fresh.map((entry) => ({
      id: `r${entry.n}`,
      emoji: String(entry.emoji || REACTIONS[0]),
      left: Math.round(Math.random() * 120),
    }));
    setFloats((current) => [...current, ...added]);
    const timer = setTimeout(() => {
      setFloats((current) => current.filter((item) => !added.some((one) => one.id === item.id)));
    }, FLOAT_MS);
    return () => clearTimeout(timer);
  }, [highest]);

  return html`
    <div class="reactions" role="group" aria-label="Reactions">
      ${REACTIONS.map((emoji) => html`
        <button class="reaction-btn" key=${emoji} aria-label=${`React with ${emoji}`}
                onClick=${() => send(ACTIONS.react, { emoji })}>${emoji}</button>`)}
      ${floats.map((item) => html`
        <span class="reaction-float" key=${item.id} style=${`left: ${item.left}px; bottom: 4px`} aria-hidden="true">${item.emoji}</span>`)}
    </div>`;
}
