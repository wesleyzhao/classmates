// Fixed-window rate limiting on top of the store's one counter statement. The windows
// are generous: this is here to stop a script from filling the rooms table, not to
// police a family playing several games in an evening.
//
// It fails open on purpose. If the store is unwell, players losing their game is a
// worse outcome than an unlimited few minutes, and the store being unwell is already
// reported by /api/health.

import { PlatformError } from '../public/shared/errors.js';

/**
 * @param {import('../types/parlor.js').Store} store
 * @param {string} key  e.g. `create:203.0.113.4`
 * @param {{ windowMs: number, max: number }} limit
 * @returns {Promise<void>}
 */
export async function checkLimit(store, key, limit) {
  let result;
  try {
    result = await store.bumpLimit(key, limit.windowMs, limit.max);
  } catch {
    return;
  }
  if (result && !result.allowed) {
    throw new PlatformError(429, 'rate_limited', 'Slow down a little, then try again.');
  }
}

/** One hour, the window every endpoint here uses. */
export const HOUR = 60 * 60 * 1000;
