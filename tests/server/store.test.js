// One contract, three stores. The memory store and the Neon store have to behave
// identically or dev and production disagree in ways nobody notices until a room
// splits in half, so the same suite runs against both: the Neon one over a fake `sql`
// that mirrors the statements the store actually sends, and, when PARLOR_TEST_NEON=1
// and DATABASE_URL are set, against a real database.
//
// The real-database run calls deleteStaleRooms(0), which empties the rooms table.
// Point it at a scratch database, never at the one people are playing on.

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../../server/store/memory.js';
import { createNeonStore } from '../../server/store/neon.js';

const HOUR = 60 * 60 * 1000;
let counter = 0;

/** A room code no other test in this file is using. */
function nextCode() {
  counter += 1;
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `Z${letters[counter % 24]}${letters[(counter * 7) % 24]}${letters[(counter * 13) % 24]}`;
}

/** @returns {any} the smallest thing that passes for a room document. */
function roomDoc(code, extra = {}) {
  const now = Date.now();
  return { code, v: 0, createdAt: now, updatedAt: now, phase: 'lobby', players: [], ...extra };
}

/**
 * @param {string} label
 * @param {() => Promise<any>} makeStore
 * @param {{ skip?: boolean | string }} [options]
 */
function storeContract(label, makeStore, options = {}) {
  describe(label, options, () => {
    /** @type {any} */
    let store;

    before(async () => {
      store = await makeStore();
      await store.init();
      // Safe to call again: both stores memoize the create-if-missing work.
      await store.init();
    });

    test('a room code can only be claimed once', async () => {
      const code = nextCode();
      assert.equal(await store.createRoom(code, roomDoc(code)), true);
      assert.equal(await store.createRoom(code, roomDoc(code)), false);
      await store.deleteRoom(code);
    });

    test('a new room is version 1, inside the document as well as on the row', async () => {
      const code = nextCode();
      await store.createRoom(code, roomDoc(code, { phase: 'lobby' }));
      const row = await store.getRoom(code);
      assert.equal(row.v, 1);
      assert.equal(row.doc.v, 1);
      assert.equal(row.doc.code, code);
      assert.equal(await store.getVersion(code), 1);
      await store.deleteRoom(code);
    });

    test('a room that is not there reads as null', async () => {
      const code = nextCode();
      assert.equal(await store.getVersion(code), null);
      assert.equal(await store.getRoom(code), null);
    });

    test('compare-and-set against the wrong version writes nothing', async () => {
      const code = nextCode();
      await store.createRoom(code, roomDoc(code));
      assert.equal(await store.casRoom(code, 7, roomDoc(code, { phase: 'over' })), null);
      const row = await store.getRoom(code);
      assert.equal(row.v, 1);
      assert.equal(row.doc.phase, 'lobby');
      await store.deleteRoom(code);
    });

    test('compare-and-set bumps the version and stores the document', async () => {
      const code = nextCode();
      await store.createRoom(code, roomDoc(code));
      assert.equal(await store.casRoom(code, 1, roomDoc(code, { phase: 'playing' })), 2);
      const row = await store.getRoom(code);
      assert.equal(row.v, 2);
      assert.equal(row.doc.v, 2, 'the document carries the version it was written with');
      assert.equal(row.doc.phase, 'playing');
      assert.equal(await store.casRoom(code, 1, roomDoc(code)), null, 'the old version is spent');
      await store.deleteRoom(code);
    });

    test('deleteStaleRooms removes old rooms and says how many', async () => {
      const code = nextCode();
      await store.createRoom(code, roomDoc(code));
      assert.equal(await store.deleteStaleRooms(HOUR), 0, 'a fresh room is not stale');
      const removed = await store.deleteStaleRooms(0);
      assert.ok(removed >= 1);
      assert.equal(await store.getVersion(code), null);
    });

    test('a game can be read back by id and by slug', async () => {
      const now = Date.now();
      const row = {
        id: 'game-1',
        slug: 'flags-of-europe-ab12',
        owner: 'ip:198.51.100.7',
        editKeyHash: 'a'.repeat(64),
        v: 1,
        doc: { id: 'game-1', title: 'Flags of Europe', kitId: 'tally', config: { target: 5 } },
        createdAt: now,
        updatedAt: now,
      };
      await store.putGame(row);

      const byId = await store.getGame('game-1');
      assert.equal(byId.slug, row.slug);
      assert.equal(byId.owner, row.owner);
      assert.equal(byId.editKeyHash, row.editKeyHash);
      assert.equal(byId.v, 1);
      assert.deepEqual(byId.doc, row.doc);
      assert.equal(byId.createdAt, now);

      const bySlug = await store.getGame(row.slug);
      assert.equal(bySlug.id, 'game-1');

      await store.putGame({ ...row, v: 2, doc: { ...row.doc, title: 'Flags' }, updatedAt: now + 1 });
      const updated = await store.getGame('game-1');
      assert.equal(updated.v, 2);
      assert.equal(updated.doc.title, 'Flags');

      assert.equal(await store.getGame('nothing-like-this'), null);
    });

    test('a deck can be read back by id', async () => {
      const now = Date.now();
      const row = {
        id: 'deck-1',
        owner: 'ip:198.51.100.7',
        editKeyHash: 'b'.repeat(64),
        v: 1,
        doc: { id: 'deck-1', title: 'Capitals', version: 1, cards: [{ id: 'c1', prompt: 'France', answer: 'Paris' }] },
        createdAt: now,
        updatedAt: now,
      };
      await store.putDeck(row);

      const read = await store.getDeck('deck-1');
      assert.equal(read.owner, row.owner);
      assert.equal(read.v, 1);
      assert.deepEqual(read.doc, row.doc);
      assert.equal(read.updatedAt, now);
      assert.equal(await store.getDeck('deck-2'), null);
    });

    test('bumpLimit counts inside the window and refuses past the cap', async () => {
      const key = `test:${nextCode()}`;
      assert.deepEqual(await store.bumpLimit(key, HOUR, 3), { allowed: true, count: 1 });
      assert.deepEqual(await store.bumpLimit(key, HOUR, 3), { allowed: true, count: 2 });
      assert.deepEqual(await store.bumpLimit(key, HOUR, 3), { allowed: true, count: 3 });
      assert.deepEqual(await store.bumpLimit(key, HOUR, 3), { allowed: false, count: 4 });

      const other = `test:${nextCode()}`;
      assert.deepEqual(await store.bumpLimit(other, HOUR, 3), { allowed: true, count: 1 }, 'keys are counted apart');
    });

    test('bumpLimit starts a new window once the old one has passed', async () => {
      const key = `test:${nextCode()}`;
      await store.bumpLimit(key, HOUR, 1);
      assert.equal((await store.bumpLimit(key, HOUR, 1)).allowed, false);
      // A window of zero has already elapsed, so the count starts over.
      assert.deepEqual(await store.bumpLimit(key, 0, 1), { allowed: true, count: 1 });
    });
  });
}

/**
 * A stand-in for `neon()`'s query function that understands exactly the statements
 * server/store/neon.js sends. It is deliberately literal: if the store starts sending
 * something else, this throws rather than quietly passing.
 * @returns {(text: string, params?: any[]) => Promise<any[]>}
 */
function fakeSql() {
  /** @type {Map<string, { v: number, doc: string, updated_at: number }>} */
  const rooms = new Map();
  /** @type {Map<string, any>} */
  const games = new Map();
  /** @type {Map<string, any>} */
  const decks = new Map();
  /** @type {Map<string, { count: number, window_start: number }>} */
  const limits = new Map();

  return async (text, params = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
    const p = params;

    if (sql.startsWith('create table') || sql.startsWith('create index')) return [];

    if (sql.startsWith('select doc, v from rooms')) {
      const row = rooms.get(p[0]);
      return row ? [{ doc: JSON.parse(row.doc), v: row.v }] : [];
    }
    if (sql.startsWith('select v from rooms')) {
      const row = rooms.get(p[0]);
      return row ? [{ v: row.v }] : [];
    }
    if (sql.startsWith('insert into rooms')) {
      if (rooms.has(p[0])) return [];
      rooms.set(p[0], { v: 1, doc: p[1], updated_at: Date.now() });
      return [{ v: 1 }];
    }
    if (sql.startsWith('update rooms set')) {
      const row = rooms.get(p[1]);
      if (!row || row.v !== p[2]) return [];
      row.v += 1;
      row.doc = p[0];
      row.updated_at = Date.now();
      return [{ v: row.v }];
    }
    if (sql.startsWith('delete from rooms where updated_at')) {
      const cutoff = Date.now() - Number(p[0]);
      const gone = [];
      for (const [code, row] of rooms) {
        if (row.updated_at <= cutoff) { rooms.delete(code); gone.push({ code }); }
      }
      return gone;
    }
    if (sql.startsWith('delete from rooms where code')) {
      return rooms.delete(p[0]) ? [{ code: p[0] }] : [];
    }

    if (sql.startsWith('select id, slug')) {
      for (const row of games.values()) {
        if (row.id === p[0] || row.slug === p[0]) return [row];
      }
      return [];
    }
    if (sql.startsWith('insert into games')) {
      games.set(p[0], {
        id: p[0], slug: p[1], owner: p[2], edit_key_hash: p[3], v: p[4],
        doc: JSON.parse(p[5]), created_at: new Date(p[6]), updated_at: new Date(p[7]),
      });
      return [];
    }

    if (sql.startsWith('select id, owner')) {
      const row = decks.get(p[0]);
      return row ? [row] : [];
    }
    if (sql.startsWith('insert into decks')) {
      decks.set(p[0], {
        id: p[0], owner: p[1], edit_key_hash: p[2], v: p[3],
        doc: JSON.parse(p[4]), created_at: new Date(p[5]), updated_at: new Date(p[6]),
      });
      return [];
    }

    if (sql.startsWith('insert into limits')) {
      const [windowMs, key] = p;
      const now = Date.now();
      const row = limits.get(key);
      if (!row || row.window_start <= now - Number(windowMs)) {
        limits.set(key, { count: 1, window_start: now });
        return [{ count: 1 }];
      }
      row.count += 1;
      return [{ count: row.count }];
    }

    throw new Error(`the fake database was sent a statement it does not know: ${sql}`);
  };
}

storeContract('memory store', async () => createMemoryStore());
storeContract('neon store over a fake sql', async () => createNeonStore({ sql: fakeSql() }));

const realDatabase = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
storeContract(
  'neon store against a real database',
  async () => createNeonStore({ connectionString: realDatabase }),
  { skip: process.env.PARLOR_TEST_NEON === '1' && realDatabase ? false : 'set PARLOR_TEST_NEON=1 and DATABASE_URL to run this' },
);

describe('neon store failures', () => {
  test('a driver error becomes a 503 the player can read', async () => {
    const store = createNeonStore({
      sql: async () => { throw new Error('connection reset'); },
    });
    await assert.rejects(() => store.getVersion('ABCD'), (/** @type {any} */ err) => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'store_unavailable');
      assert.equal(err.message, 'The game store is not responding. Try again in a moment.');
      return true;
    });
  });

  test('it refuses to guess a connection string', async () => {
    const store = createNeonStore({});
    await assert.rejects(() => store.init(), (/** @type {any} */ err) => {
      assert.equal(err.code, 'no_store');
      return true;
    });
  });
});
