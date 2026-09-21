// `npm run doctor`: is this machine, or this deployment, actually able to run Parlor?
// It says which store is configured (never the connection string), creates a throwaway
// room, reads it back, writes it again through compare-and-set, and cleans up. If any
// of that fails it says what to do about it in plain words and exits non-zero, so CI
// and a person reading a terminal get the same answer.

import { randomCode } from '../public/shared/codes.js';
import { describeStore, getStore, resetStore } from '../server/store/index.js';

/** Rooms older than this are swept; the doctor runs the same sweep to prove it works. */
const SWEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Run every check and report. Exits non-zero on the first failure.
 * @returns {Promise<void>}
 */
async function main() {
  console.log(`Node        ${process.version}`);
  if (!process.version.startsWith('v22')) {
    console.log('            (Parlor runs on Node 22; other versions are untested.)');
  }

  const described = describeStore();
  console.log(`Store       ${described.name}${described.configured ? '' : ' (not configured)'}`);
  if (described.name === 'memory') {
    console.log('            In-memory rooms vanish when this process stops. Set DATABASE_URL for a real one.');
  }

  const store = await step('build the store', () => getStore());
  await step('create the tables', () => store.init());

  const code = await step('write a room', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = randomCode();
      if (await store.createRoom(candidate, throwawayDoc(candidate))) return candidate;
    }
    throw new Error('every room code the doctor tried was already taken');
  });

  await step('read it back', async () => {
    const v = await store.getVersion(code);
    if (v !== 1) throw new Error(`expected version 1 for the new room, got ${v}`);
  });

  await step('write it again', async () => {
    const v = await store.casRoom(code, 1, throwawayDoc(code));
    if (v !== 2) throw new Error(`expected version 2 after a compare-and-set, got ${v}`);
    const row = await store.getRoom(code);
    if (!row || row.doc.v !== 2) throw new Error('the stored document does not carry the version it was written with');
  });

  await step('refuse a stale write', async () => {
    const v = await store.casRoom(code, 1, throwawayDoc(code));
    if (v !== null) throw new Error('a write against an old version should not have gone through');
  });

  await step('sweep old rooms', async () => {
    // Deliberately not 0: on a live database that would end every game in progress.
    await store.deleteStaleRooms(SWEEP_MS);
    await store.deleteRoom(code);
    if (await store.getVersion(code)) throw new Error('the throwaway room is still there');
  });

  console.log('\nEverything works.');
  resetStore();
}

/** Run one check, print the result, and turn a failure into a plain-language exit. */
async function step(what, run) {
  try {
    const result = await run();
    console.log(`ok          ${what}`);
    return result;
  } catch (err) {
    console.error(`failed      ${what}`);
    console.error(`            ${err instanceof Error ? err.message : String(err)}`);
    console.error(`\n${hintFor(err)}`);
    process.exit(1);
  }
}

function hintFor(err) {
  const code = err && typeof err === 'object' ? String(/** @type {any} */ (err).code || '') : '';
  if (code === 'no_store') {
    return 'Set DATABASE_URL to a Postgres connection string (Neon works out of the box), or set STORE=memory to run without one.';
  }
  if (code === 'store_unavailable') {
    return 'The database did not answer. Check that DATABASE_URL points at a database that is awake and reachable from here.';
  }
  return 'Check the message above. If it mentions a table or a column, the database may be from an older version of Parlor.';
}

/** The smallest thing the store will accept as a room. It exists for a second. */
function throwawayDoc(code) {
  const now = Date.now();
  return /** @type {import('../types/parlor.js').RoomDoc} */ (/** @type {unknown} */ ({
    code,
    v: 1,
    createdAt: now,
    updatedAt: now,
    game: null,
    hostId: 'doctor',
    players: [],
    secrets: {},
    phase: 'lobby',
    s: null,
    chat: [],
    log: [],
    logN: 0,
    undo: [],
    seen: [],
    limits: {},
    recent: [],
    games: 0,
    hostSeenAt: now,
  }));
}

main().catch((err) => {
  console.error('failed      an unexpected error');
  console.error(`            ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
