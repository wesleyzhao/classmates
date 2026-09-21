// One handler for the whole API. Vercel's free tier counts functions, and a router this
// small costs less to run and less to reason about than a dozen of them, so api/index.js
// is the only function and everything routes from here.
//
// The rules of the house: JSON in, JSON out; every response carries a Cache-Control;
// errors go through errorBody so a player never sees a stack trace; and rooms work is
// delegated whole to RoomService, which the tests replace with a fake.

import { PlatformError } from '../public/shared/errors.js';
import { normalizeCode } from '../public/shared/codes.js';
import { KITS } from '../public/shared/registry.js';
import { clientIp, errorBody, parsePath, readJsonBody, sendJson } from './http.js';
import { checkLimit, HOUR } from './ratelimit.js';
import { RoomService } from './rooms.js';
import { describeStore, getStore } from './store/index.js';
import * as gamesModule from './games.js';
import * as decksModule from './decks.js';

/**
 * @typedef {import('./http.js').ApiRequest} ApiRequest
 * @typedef {import('./http.js').ApiResponse} ApiResponse
 * @typedef {{ store: import('../types/parlor.js').Store, rooms: RoomService, games: typeof gamesModule, decks: typeof decksModule }} Context
 */

/** How often one address may do each thing. Windows are an hour; counts are per address. */
const LIMITS = {
  createRoom: { windowMs: HOUR, max: 20 },
  joinRoom: { windowMs: HOUR, max: 60 },
  makeGame: { windowMs: HOUR, max: 10 },
};

/** A deck may be 300 KB of cards, so its body needs more room than the default cap. */
const DECK_BODY_BYTES = 320 * 1024;

const NOT_FOUND = { error: 'There is nothing at that address.', code: 'not_found' };
const NO_ROOM = 'No room with that code. Check the four letters you were given.';

/**
 * Build a request handler. Anything left out of `deps` is built the production way on
 * first use, which is how tests hand in a memory store and a fake RoomService.
 * @param {Partial<Context> & { describeStore?: typeof describeStore, now?: () => number }} [deps]
 * @returns {(req: ApiRequest, res: ApiResponse) => Promise<void>}
 */
export function createHandler(deps = {}) {
  const describe = deps.describeStore || describeStore;
  const now = deps.now || (() => Date.now());

  /** @type {Promise<Context> | null} */
  let pending = null;
  function context() {
    if (!pending) {
      pending = build(deps);
      pending.catch(() => { pending = null; });
    }
    return pending;
  }

  return async function handle(req, res) {
    try {
      const { segments } = parsePath(req);
      await route(req, res, segments, { context, describe, now });
    } catch (err) {
      const { status, body } = errorBody(err);
      sendJson(res, status, body);
    }
  };
}

/** The production handler: the real store, the real rooms, the real catalogs. */
export default createHandler();

/** @returns {Promise<Context>} */
async function build(deps) {
  const store = deps.store || (await getStore());
  const games = deps.games || gamesModule;
  const decks = deps.decks || decksModule;
  const rooms = deps.rooms || new RoomService({
    store,
    loadGame: (idOrSlug) => games.getGame(idOrSlug),
    loadDecks: (ids) => decks.getDecks(ids),
  });
  return { store, games, decks, rooms };
}

async function route(req, res, segments, env) {
  const [head, ...rest] = segments;
  const method = String(req.method || 'GET').toUpperCase();

  if (head === 'health' && rest.length === 0) {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    return sendJson(res, 200, {
      ok: true,
      store: env.describe(),
      kits: Object.keys(KITS),
      node: process.version,
      now: env.now(),
    });
  }

  if (head === 'games') return games(req, res, rest, method, env);
  if (head === 'decks') return decks(req, res, rest, method, env);
  if (head === 'rooms') return rooms(req, res, rest, method, env);

  return sendJson(res, 404, NOT_FOUND);
}

async function games(req, res, rest, method, env) {
  const ctx = await env.context();

  if (rest.length === 0) {
    if (method === 'GET') {
      return sendJson(res, 200, { games: await ctx.games.listGames() });
    }
    if (method === 'POST') {
      const ip = clientIp(req);
      await checkLimit(ctx.store, `game:${ip}`, LIMITS.makeGame);
      const body = await readJsonBody(req);
      const { game, editKey } = await ctx.games.createGame(body, { owner: ownerFrom(body), ip });
      return sendJson(res, 201, { game: ctx.games.publicGame(game), editKey });
    }
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  if (rest.length === 1) {
    if (method === 'GET') {
      const game = await ctx.games.getGame(rest[0]);
      if (!game) return sendJson(res, 404, { error: 'No game with that name. Check the link, or pick another game.', code: 'not_found' });
      return sendJson(res, 200, { game: ctx.games.publicGame(game) });
    }
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      const game = await ctx.games.updateGame(rest[0], body, header(req, 'x-edit-key'));
      return sendJson(res, 200, { game: ctx.games.publicGame(game) });
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  return sendJson(res, 404, NOT_FOUND);
}

async function decks(req, res, rest, method, env) {
  const ctx = await env.context();

  if (rest.length === 0) {
    if (method === 'POST') {
      const ip = clientIp(req);
      await checkLimit(ctx.store, `game:${ip}`, LIMITS.makeGame);
      const body = await readJsonBody(req, { maxBytes: DECK_BODY_BYTES });
      const { deck, editKey } = await ctx.decks.createDeck(body, { owner: ownerFrom(body), ip });
      return sendJson(res, 201, { deck, editKey });
    }
    return methodNotAllowed(res, ['POST']);
  }

  if (rest.length === 1) {
    if (method === 'GET') {
      const deck = await ctx.decks.getDeck(rest[0]);
      if (!deck) return sendJson(res, 404, { error: 'No deck with that name.', code: 'not_found' });
      return sendJson(res, 200, { deck });
    }
    if (method === 'PUT') {
      const body = await readJsonBody(req, { maxBytes: DECK_BODY_BYTES });
      const deck = await ctx.decks.updateDeck(rest[0], body, header(req, 'x-edit-key'));
      return sendJson(res, 200, { deck });
    }
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  return sendJson(res, 404, NOT_FOUND);
}

async function rooms(req, res, rest, method, env) {
  const ctx = await env.context();

  if (rest.length === 0) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);
    const ip = clientIp(req);
    await checkLimit(ctx.store, `create:${ip}`, LIMITS.createRoom);
    const body = await readJsonBody(req);
    const room = await ctx.rooms.create({
      gameId: body.gameId,
      name: body.name,
      avatar: body.avatar,
      recent: body.recent,
    });
    return sendJson(res, 201, room);
  }

  const code = requireCode(rest[0]);

  if (rest.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    const snapshot = await ctx.rooms.snapshot(code, authOf(req));
    // A snapshot is one player's redacted view; it must never sit in a shared cache.
    return sendJson(res, 200, snapshot, { cache: 'private, no-store' });
  }

  if (rest.length === 2 && rest[1] === 'v') {
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    const version = await ctx.rooms.version(code);
    if (!version) return sendJson(res, 404, { error: NO_ROOM, code: 'not_found' });
    // Every device polls this one; a second of shared cache is the whole point of it.
    return sendJson(res, 200, version, { cache: 'public, max-age=0, s-maxage=1' });
  }

  if (rest.length === 2 && rest[1] === 'join') {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);
    await checkLimit(ctx.store, `join:${clientIp(req)}`, LIMITS.joinRoom);
    const body = await readJsonBody(req);
    const joined = await ctx.rooms.join(code, { name: body.name, avatar: body.avatar, recent: body.recent });
    return sendJson(res, 201, joined);
  }

  if (rest.length === 2 && rest[1] === 'act') {
    if (method !== 'POST') return methodNotAllowed(res, ['POST']);
    const body = await readJsonBody(req);
    // navigator.sendBeacon (used on pagehide) cannot set headers, so auth may ride in the body.
    const auth = authOf(req).playerId ? authOf(req) : { playerId: str(body.playerId), secret: str(body.secret) };
    const snapshot = await ctx.rooms.act(code, auth, {
      id: body.id,
      type: body.type,
      payload: body.payload,
    });
    return sendJson(res, 200, snapshot, { cache: 'private, no-store' });
  }

  return sendJson(res, 404, NOT_FOUND);
}

/** A code that cannot be a room reads as a room that is not there, not as a bad request. */
function requireCode(raw) {
  const code = normalizeCode(raw);
  if (!code) throw new PlatformError(404, 'not_found', NO_ROOM);
  return code;
}

/** @param {unknown} v @returns {string | null} */
function str(v) {
  return typeof v === 'string' && v ? v : null;
}

/** Who the player says they are. RoomService decides whether to believe it. */
function authOf(req) {
  return { playerId: header(req, 'x-player-id'), secret: header(req, 'x-player-secret') };
}

/** @returns {string | null} */
function header(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] || null;
  return value ? String(value) : null;
}

function ownerFrom(body) {
  return typeof body.owner === 'string' ? body.owner : null;
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return sendJson(res, 405, { error: 'That address does not take this kind of request.', code: 'method_not_allowed' });
}
