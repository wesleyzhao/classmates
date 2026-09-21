// The Neon store: the same Store contract over Postgres, spoken in HTTP rather than
// TCP. Every method is one statement, because each statement is one fetch and there is
// no session to hold open between them; `casRoom` is the whole concurrency story
// (compare-and-set on the row's version) and `bumpLimit` counts in a single upsert.
//
// Driver: @neondatabase/serverless v1. `neon(connectionString)` returns a tagged-template
// function that also carries `.query(text, params)` for numbered placeholders, which is
// what this file uses. `sql` can be injected so tests can run the contract without a
// network.

import { neon } from '@neondatabase/serverless';
import { PlatformError } from '../../public/shared/errors.js';

/**
 * @typedef {import('../../types/parlor.js').GameRow} GameRow
 * @typedef {import('../../types/parlor.js').DeckRow} DeckRow
 * @typedef {import('../../types/parlor.js').Store & { deleteRoom(code: string): Promise<boolean> }} NeonStore
 * @typedef {(text: string, params?: any[]) => Promise<any>} SqlExecutor
 */

const CREATE_ROOMS = `create table if not exists rooms (
  code text primary key,
  v integer not null,
  doc jsonb not null,
  updated_at timestamptz not null default now()
)`;
const CREATE_ROOMS_INDEX = 'create index if not exists rooms_updated_at_idx on rooms (updated_at)';

const CREATE_GAMES = `create table if not exists games (
  id text primary key,
  slug text unique not null,
  owner text not null,
  edit_key_hash text not null,
  v integer not null,
  doc jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)`;
const CREATE_GAMES_INDEX = 'create index if not exists games_owner_updated_at_idx on games (owner, updated_at desc)';

const CREATE_DECKS = `create table if not exists decks (
  id text primary key,
  owner text not null,
  edit_key_hash text not null,
  v integer not null,
  doc jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)`;

const CREATE_LIMITS = `create table if not exists limits (
  key text primary key,
  count integer not null,
  window_start timestamptz not null
)`;

/** Interval arithmetic in milliseconds, the unit the rest of the platform speaks. */
const MS = `($1::double precision * interval '1 millisecond')`;

/**
 * @param {{ connectionString?: string, sql?: SqlExecutor | { query: SqlExecutor } }} [options]
 *   `sql` accepts either a plain `(text, params) => rows` function or anything with a
 *   `.query` of that shape, which is what `neon()` returns.
 * @returns {NeonStore}
 */
export function createNeonStore({ connectionString, sql } = {}) {
  const exec = executor(sql, connectionString);

  /** @type {Promise<void> | null} */
  let ready = null;
  /** Tables are created on first use and never again for the life of the instance. */
  function ensure() {
    if (!ready) {
      ready = (async () => {
        await run(exec, CREATE_ROOMS);
        await run(exec, CREATE_ROOMS_INDEX);
        await run(exec, CREATE_GAMES);
        await run(exec, CREATE_GAMES_INDEX);
        await run(exec, CREATE_DECKS);
        await run(exec, CREATE_LIMITS);
      })();
      // A failed init must not poison the instance forever; the next request retries.
      ready.catch(() => { ready = null; });
    }
    return ready;
  }

  /** @type {(text: string, params?: any[]) => Promise<any[]>} */
  async function query(text, params) {
    await ensure();
    return run(exec, text, params);
  }

  return {
    name: 'neon',

    async init() {
      await ensure();
    },

    async getRoom(code) {
      const rows = await query('select doc, v from rooms where code = $1', [code]);
      if (!rows.length) return null;
      return { doc: asJson(rows[0].doc), v: Number(rows[0].v) };
    },

    async getVersion(code) {
      const rows = await query('select v from rooms where code = $1', [code]);
      return rows.length ? Number(rows[0].v) : null;
    },

    /** New rooms start at v 1; `doc.v` is written to match the row. */
    async createRoom(code, doc) {
      const rows = await query(
        'insert into rooms (code, v, doc) values ($1, 1, $2::jsonb) on conflict (code) do nothing returning v',
        [code, JSON.stringify({ ...doc, v: 1 })],
      );
      return rows.length > 0;
    },

    /** On success the row and `doc.v` both become `expectedV + 1`; a lost race returns null. */
    async casRoom(code, expectedV, doc) {
      const rows = await query(
        'update rooms set doc = $1::jsonb, v = v + 1, updated_at = now() where code = $2 and v = $3 returning v',
        [JSON.stringify({ ...doc, v: expectedV + 1 }), code, expectedV],
      );
      return rows.length ? Number(rows[0].v) : null;
    },

    /** `olderThanMs` of 0 means every room, so only the sweeper and tests should pass it. */
    async deleteStaleRooms(olderThanMs) {
      const rows = await query(`delete from rooms where updated_at <= now() - ${MS} returning code`, [olderThanMs]);
      return rows.length;
    },

    /** Not part of the Store contract; the doctor uses it to clean up after itself. */
    async deleteRoom(code) {
      const rows = await query('delete from rooms where code = $1 returning code', [code]);
      return rows.length > 0;
    },

    async getGame(idOrSlug) {
      const rows = await query(
        'select id, slug, owner, edit_key_hash, v, doc, created_at, updated_at from games where id = $1 or slug = $1',
        [idOrSlug],
      );
      return rows.length ? gameRow(rows[0]) : null;
    },

    async putGame(row) {
      await query(
        `insert into games (id, slug, owner, edit_key_hash, v, doc, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))
         on conflict (id) do update set slug = excluded.slug, owner = excluded.owner,
           edit_key_hash = excluded.edit_key_hash, v = excluded.v, doc = excluded.doc,
           updated_at = excluded.updated_at`,
        [row.id, row.slug, row.owner, row.editKeyHash, row.v, JSON.stringify(row.doc), row.createdAt, row.updatedAt],
      );
    },

    async getDeck(id) {
      const rows = await query(
        'select id, owner, edit_key_hash, v, doc, created_at, updated_at from decks where id = $1',
        [id],
      );
      return rows.length ? deckRow(rows[0]) : null;
    },

    async putDeck(row) {
      await query(
        `insert into decks (id, owner, edit_key_hash, v, doc, created_at, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0))
         on conflict (id) do update set owner = excluded.owner, edit_key_hash = excluded.edit_key_hash,
           v = excluded.v, doc = excluded.doc, updated_at = excluded.updated_at`,
        [row.id, row.owner, row.editKeyHash, row.v, JSON.stringify(row.doc), row.createdAt, row.updatedAt],
      );
    },

    /**
     * One statement so two requests in the same second cannot both read a stale count:
     * the row is inserted, or the window is restarted, or the count goes up.
     */
    async bumpLimit(key, windowMs, max) {
      const rows = await query(
        `insert into limits (key, count, window_start) values ($2, 1, now())
         on conflict (key) do update set
           count = case when limits.window_start <= now() - ${MS} then 1 else limits.count + 1 end,
           window_start = case when limits.window_start <= now() - ${MS} then now() else limits.window_start end
         returning count`,
        [windowMs, key],
      );
      const count = rows.length ? Number(rows[0].count) : 1;
      return { allowed: count <= max, count };
    },
  };
}

/** Normalize the three shapes a caller might hand us into one `(text, params) => rows`. */
function executor(sql, connectionString) {
  if (typeof sql === 'function') {
    const withQuery = /** @type {any} */ (sql);
    if (typeof withQuery.query === 'function') return (text, params) => withQuery.query(text, params);
    return (text, params) => sql(text, params);
  }
  if (sql && typeof sql.query === 'function') return (text, params) => sql.query(text, params);

  /** @type {SqlExecutor | null} */
  let made = null;
  return (text, params) => {
    if (!made) {
      if (!connectionString) {
        throw new PlatformError(500, 'no_store', 'The game store is not configured. Set DATABASE_URL to a Postgres connection string.');
      }
      const client = neon(connectionString);
      made = (t, p) => client.query(t, p);
    }
    return made(text, params);
  };
}

/** Run one statement and turn anything the driver throws into a plain 503. */
async function run(exec, text, params) {
  try {
    const result = await exec(text, params);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.rows)) return result.rows;
    return [];
  } catch (err) {
    if (err instanceof PlatformError) throw err;
    const wrapped = new PlatformError(503, 'store_unavailable', 'The game store is not responding. Try again in a moment.');
    wrapped.cause = err;
    throw wrapped;
  }
}

/** jsonb arrives parsed, but a driver or a mock may hand back the text instead. */
function asJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/** timestamptz arrives as a Date; the rest of the platform counts in epoch ms. */
function asMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

/** @returns {GameRow} */
function gameRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    owner: row.owner,
    editKeyHash: row.edit_key_hash,
    v: Number(row.v),
    doc: asJson(row.doc),
    createdAt: asMs(row.created_at),
    updatedAt: asMs(row.updated_at),
  };
}

/** @returns {DeckRow} */
function deckRow(row) {
  return {
    id: row.id,
    owner: row.owner,
    editKeyHash: row.edit_key_hash,
    v: Number(row.v),
    doc: asJson(row.doc),
    createdAt: asMs(row.created_at),
    updatedAt: asMs(row.updated_at),
  };
}
