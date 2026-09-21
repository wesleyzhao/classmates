// Picks the store once per instance and hands the same one to everybody: the router,
// the rooms service, games and decks. The interesting part is the refusal. Vercel's
// Fluid Compute reuses instances and runs several of them, so an in-memory store there
// would quietly split a room across instances: the host would see one game and their
// friends another. Better to fail loudly at the first request than to ship that.

import { PlatformError } from '../../public/shared/errors.js';
import { createMemoryStore } from './memory.js';
import { createNeonStore } from './neon.js';

/**
 * The Store contract plus the one extra method both built-in stores provide.
 * @typedef {import('../../types/parlor.js').Store & { deleteRoom(code: string): Promise<boolean> }} ParlorStore
 */

/** @type {Promise<ParlorStore> | null} */
let pending = null;

/** @returns {string} 'memory', 'neon', or '' when nothing is forced. */
function forced() {
  return String(process.env.STORE || '').trim().toLowerCase();
}

/** @returns {string} the first connection string that is set, or ''. */
function connectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

/** True when this process is running on Vercel, where memory is not a safe store. */
function onVercel() {
  return process.env.VERCEL === '1';
}

/** @returns {'neon' | 'memory'} which store the current environment asks for. */
function chosen() {
  const force = forced();
  if (force === 'neon') return 'neon';
  if (force === 'memory') return 'memory';
  return connectionString() ? 'neon' : 'memory';
}

/**
 * The store for this instance, built on first use and reused after that.
 * @returns {Promise<ParlorStore>}
 */
export async function getStore() {
  if (!pending) {
    pending = build();
    // A store that failed to build should not be cached as a permanent failure.
    pending.catch(() => { pending = null; });
  }
  return pending;
}

/** @returns {Promise<ParlorStore>} */
async function build() {
  const force = forced();
  if (force && force !== 'memory' && force !== 'neon') {
    throw new PlatformError(500, 'no_store', `STORE is set to "${force}", which is not a store this server knows. Use memory or neon.`);
  }
  if (chosen() === 'neon') {
    const url = connectionString();
    if (!url) {
      throw new PlatformError(500, 'no_store', 'STORE is set to neon but no connection string is configured. Set DATABASE_URL and try again.');
    }
    return createNeonStore({ connectionString: url });
  }
  if (onVercel()) {
    throw new PlatformError(500, 'no_store', 'The game store is not configured. Set DATABASE_URL to a Postgres connection string and deploy again, because an in-memory store would lose rooms between requests here.');
  }
  return createMemoryStore();
}

/** Forget the built store. Tests call this between cases; nothing else should. */
export function resetStore() {
  pending = null;
}

/**
 * What /api/health and scripts/doctor.js report. Never includes the connection string.
 * @returns {{ name: 'neon' | 'memory', configured: boolean }}
 */
export function describeStore() {
  const name = chosen();
  if (name === 'neon') return { name, configured: Boolean(connectionString()) };
  return { name, configured: !onVercel() };
}
