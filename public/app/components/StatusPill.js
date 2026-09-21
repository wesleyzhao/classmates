// The little pulsing pill that says the connection is not well. It appears in the topbar
// of a room and nowhere else, and it says what is happening rather than apologising for it.

import { html } from '../h.js';

/** What each connection state reads as. 'live' says nothing at all. */
const WORDS = {
  reconnecting: 'Reconnecting',
  offline: 'No connection',
};

/**
 * @param {{ status: 'live' | 'reconnecting' | 'offline' | 'gone' | 'removed' }} props
 */
export function StatusPill({ status }) {
  const word = WORDS[status];
  if (!word) return null;
  return html`<span class="pill-status" role="status" aria-live="polite">${word}</span>`;
}
