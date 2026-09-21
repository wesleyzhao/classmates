// The in-memory store: plain Maps behind the Store contract. It backs `npm run dev`,
// `scripts/doctor.js` in dev, and every test, so it has to behave exactly like the Neon
// store. That is why it clones documents on the way in and on the way out: a real
// database hands back a fresh object every read, and code that leans on a shared
// reference would pass here and then fail in production.
//
// server/store/index.js refuses to hand this store out on Vercel. Fluid Compute reuses
// instances, so rooms would land on one instance and be invisible from the next.

/**
 * @typedef {import('../../types/parlor.js').RoomDoc} RoomDoc
 * @typedef {import('../../types/parlor.js').GameRow} GameRow
 * @typedef {import('../../types/parlor.js').DeckRow} DeckRow
 * @typedef {import('../../types/parlor.js').Store & { deleteRoom(code: string): Promise<boolean> }} MemoryStore
 */

/** A deep copy, so nothing a caller keeps can reach into the store's state. */
function clone(value) {
  return structuredClone(value);
}

/**
 * Build a fresh store. Every call is an independent world, which is what tests want.
 * @returns {MemoryStore}
 */
export function createMemoryStore() {
  /** @type {Map<string, { v: number, doc: RoomDoc, updatedAt: number }>} */
  const rooms = new Map();
  /** @type {Map<string, GameRow>} */
  const games = new Map();
  /** @type {Map<string, string>} slug to game id */
  const gameSlugs = new Map();
  /** @type {Map<string, DeckRow>} */
  const decks = new Map();
  /** @type {Map<string, { count: number, windowStart: number }>} */
  const limits = new Map();

  return {
    name: 'memory',

    async init() {
      // Nothing to create; the Maps are the schema.
    },

    async getRoom(code) {
      const row = rooms.get(code);
      return row ? { doc: clone(row.doc), v: row.v } : null;
    },

    async getVersion(code) {
      const row = rooms.get(code);
      return row ? row.v : null;
    },

    /** New rooms start at v 1, and `doc.v` is written to match. */
    async createRoom(code, doc) {
      if (rooms.has(code)) return false;
      rooms.set(code, { v: 1, doc: { ...clone(doc), v: 1 }, updatedAt: Date.now() });
      return true;
    },

    /** On success the row and `doc.v` both become `expectedV + 1`. */
    async casRoom(code, expectedV, doc) {
      const row = rooms.get(code);
      if (!row || row.v !== expectedV) return null;
      const v = expectedV + 1;
      rooms.set(code, { v, doc: { ...clone(doc), v }, updatedAt: Date.now() });
      return v;
    },

    /** `olderThanMs` of 0 means everything, which is how tests clean up. */
    async deleteStaleRooms(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      let removed = 0;
      for (const [code, row] of rooms) {
        if (row.updatedAt <= cutoff) {
          rooms.delete(code);
          removed += 1;
        }
      }
      return removed;
    },

    /** Not part of the Store contract; the doctor uses it to clean up after itself. */
    async deleteRoom(code) {
      return rooms.delete(code);
    },

    async getGame(idOrSlug) {
      const byId = games.get(idOrSlug);
      if (byId) return clone(byId);
      const id = gameSlugs.get(idOrSlug);
      const bySlug = id ? games.get(id) : undefined;
      return bySlug ? clone(bySlug) : null;
    },

    async putGame(row) {
      games.set(row.id, clone(row));
      gameSlugs.set(row.slug, row.id);
    },

    async getDeck(id) {
      const row = decks.get(id);
      return row ? clone(row) : null;
    },

    async putDeck(row) {
      decks.set(row.id, clone(row));
    },

    /** Fixed window: the first call in a window starts it, later calls add to it. */
    async bumpLimit(key, windowMs, max) {
      const now = Date.now();
      const entry = limits.get(key);
      if (!entry || now - entry.windowStart >= windowMs) {
        limits.set(key, { count: 1, windowStart: now });
        return { allowed: 1 <= max, count: 1 };
      }
      entry.count += 1;
      return { allowed: entry.count <= max, count: entry.count };
    },
  };
}
