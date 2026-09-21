// Room core: the platform reducer that wraps every kit. Everything that is not a game rule lives
// here so kits stay small: creating and joining rooms, players and hosts, chat and reactions,
// starting and restarting, undo, action de-duplication, per-player rate limits, presence, the
// host-timeout takeover, lazy timers (the tick loop), compare-and-set writes, and redaction of
// what each player may see. The router calls the five methods of RoomService and nothing else.
//
// One room is one JSON document (see RoomDoc in types/parlor.d.ts) plus an integer version.
// Every change is read -> apply -> compare-and-set; on a version conflict we re-read and re-apply,
// so two phones acting in the same second both land, in order.

import { KitError, PlatformError } from '../public/shared/errors.js';
import { randomCode } from '../public/shared/codes.js';
import { newId } from '../public/shared/ids.js';
import { validate } from '../public/shared/schema.js';
import { getKit } from '../public/shared/registry.js';
import { makeRng, randomSeed } from '../public/kits/_lib/rng.js';

/**
 * @typedef {import('../types/parlor.js').RoomDoc} RoomDoc
 * @typedef {import('../types/parlor.js').RoomSnapshot} RoomSnapshot
 * @typedef {import('../types/parlor.js').Store} Store
 * @typedef {import('../types/parlor.js').Kit} Kit
 * @typedef {import('../types/parlor.js').Deck} Deck
 * @typedef {import('../types/parlor.js').PlayerInfo} PlayerInfo
 */

const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a game can span evenings
const LOG_LIMIT = 30;
const CHAT_LIMIT = 100;
const UNDO_LIMIT = 5;
const SEEN_LIMIT = 32;
const RECENT_LIMIT = 400;
const CAS_TRIES = 8;
const CODE_TRIES = 8;
const TICK_GUARD = 50;
const HOST_QUIET_MS = 60 * 1000;
/** How long the host must be away from the page before anyone may take over. */
const HOST_AWAY_MS = 20 * 1000;
const NAME_MAX = 16;
const CHAT_MAX = 280;
const LIMITS = { action: { windowMs: 60_000, max: 60 }, chat: { windowMs: 60_000, max: 20 } };
const PLATFORM_PREFIXES = ['room/', 'chat/', 'player/', 'host/', 'game/'];

const notFound = () => new PlatformError(404, 'not_found', 'No room with that code. Check the four letters you were given.');
const forbidden = () => new PlatformError(403, 'forbidden', 'You are no longer in that room.');
const hostOnly = () => new PlatformError(403, 'host_only', 'Only the host can do that.');

/** Strip a name to something friendly and short. @param {unknown} raw @param {number} maxLength */
export function cleanName(raw, maxLength = NAME_MAX) {
  const s = String(raw ?? '').replace(/[^\P{Cc}\t]/gu, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, maxLength).join('').trim() || 'Player';
}

/** Keep avatars to a short emoji; fall back to a friendly default. */
export function cleanAvatar(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 16 || /^[ -~]+$/.test(s) || /[<>&"'`\\]/.test(s)) return '🙂';
  return s;
}

export class RoomService {
  /**
   * @param {{
   *   store: Store,
   *   loadGame: (idOrSlug: string) => Promise<import('../types/parlor.js').GameDefinition | null>,
   *   loadDecks: (ids: string[]) => Promise<Record<string, Deck>>,
   *   now?: () => number,
   *   strict?: boolean,
   *   nameMaxLength?: number,
   *   identity?: (body: any) => {playerId: string, secret: string},
   *   guard?: (doc: RoomDoc, type: string, me: string | null) => void,
   * }} deps  `strict` makes a leaked secret throw instead of being stripped (tests)
   */
  constructor(deps) {
    this.identity = deps.identity || (() => ({playerId:newId(),secret:newId()}));
    this.guard = deps.guard || (() => {});
    this.store = deps.store;
    this.loadGame = deps.loadGame;
    this.loadDecks = deps.loadDecks;
    this.now = deps.now || (() => Date.now());
    this.strict = deps.strict ?? false;
    this.nameMaxLength = deps.nameMaxLength ?? NAME_MAX;
  }

  // ---------------------------------------------------------------------------
  // create / join / version / snapshot / act

  /**
   * Open a room for a game. The creator becomes the host.
   * @param {{ gameId: string, name?: string, avatar?: string, recent?: string[] } & Record<string, unknown>} body
   * @returns {Promise<RoomSnapshot & { code: string, playerId: string, secret: string }>}
   */
  async create(body) {
    const game = await this.loadGame(String(body?.gameId ?? ''));
    if (!game) throw new PlatformError(404, 'no_game', 'That game does not exist.');
    const kit = getKit(game.kitId);
    if (!kit) throw new PlatformError(500, 'no_kit', 'Parlor cannot run this game any more. Try another one.');
    const config = validate(kit.config, game.config).value;
    const content = validate(kit.content, game.content, { config }).value;
    const deckIds = collectDeckIds(kit.content, content);
    const decks = await this.loadDecks(deckIds);
    for (const id of deckIds) if (!decks[id]) throw new PlatformError(404, 'no_deck', 'This game needs a set of cards that is missing, so the room will not open.');

    const now = this.now();
    const {playerId, secret} = this.identity(body);
    /** @type {RoomDoc} */
    const doc = {
      code: '',
      v: 1,
      createdAt: now,
      updatedAt: now,
      game: {
        id: game.id, slug: game.slug, title: game.title, emoji: game.emoji, kitId: kit.id, kitVersion: kit.version,
        config, content, theme: game.theme, accent: game.accent, blurb: blurbFor(kit, config, content),
        deckIds, deckVersions: Object.fromEntries(deckIds.map((id) => [id, decks[id].version])),
      },
      hostId: playerId,
      players: [makePlayer(playerId, body, now, 0, true, this.nameMaxLength)],
      secrets: { [playerId]: secret },
      phase: 'lobby',
      s: null,
      chat: [],
      log: [],
      logN: 0,
      undo: [],
      seen: [],
      limits: {},
      recent: cleanRecent(body?.recent),
      games: 0,
      hostSeenAt: now,
    };
    appendLog(doc, now, [{ type: 'joined', playerId }]);

    for (let i = 0; i < CODE_TRIES; i++) {
      doc.code = randomCode();
      if (await this.store.createRoom(doc.code, doc)) {
        this.store.deleteStaleRooms(ROOM_TTL_MS).catch(() => {});
        return { code: doc.code, playerId, secret, ...this.buildSnapshot(doc, kit, decks, playerId) };
      }
    }
    throw new PlatformError(503, 'no_codes', 'Could not find a free room code. Try again.');
  }

  /**
   * Join an existing room. Late joiners are handed to the kit as `player/join`.
   * @param {string} code
   * @param {{ name?: string, avatar?: string, recent?: string[] } & Record<string, unknown>} body
   * @returns {Promise<RoomSnapshot & { playerId: string, secret: string }>}
   */
  async join(code, body) {
    const {playerId, secret} = this.identity(body);
    const result = await this.mutate(code, null, (doc, kit, decks, now) => {
      if (doc.players.some(p=>p.id===playerId)) return playerId;
      this.guard(doc,'join',playerId);
      if (doc.players.length >= kit.maxPlayers) throw new PlatformError(409, 'room_full', `This table seats ${kit.maxPlayers}, and it is full.`);
      const seat = doc.players.length ? Math.max(...doc.players.map((p) => p.seat)) + 1 : 0;
      doc.players.push(makePlayer(playerId, body, now, seat, false, this.nameMaxLength));
      doc.secrets[playerId] = secret;
      mergeRecent(doc, body?.recent);
      const pending = [{ type: 'joined', playerId }];
      if (doc.phase === 'playing' && doc.s) this.applyKit(doc, kit, decks, now, { id: newId(), type: 'player/join', payload: { playerId }, playerId: null }, pending);
      appendLog(doc, now, pending);
      return playerId;
    });
    return { playerId, secret, ...result.snapshot };
  }

  /** The cheap poll. @param {string} code @returns {Promise<{ v: number, now: number } | null>} */
  async version(code) {
    const v = await this.store.getVersion(code);
    return v === null ? null : { v, now: this.now() };
  }

  /**
   * One player's (or a spectator's) view of the room. Runs due timers first.
   * @param {string} code
   * @param {{ playerId?: string | null, secret?: string | null } | null} auth
   * @returns {Promise<RoomSnapshot>}
   */
  async snapshot(code, auth) {
    const me = auth?.playerId ? String(auth.playerId) : null;
    const result = await this.mutate(code, me, (doc) => {
      if (me) this.authenticate(doc, me, auth?.secret);
      return null;
    }, { readOnly: true });
    return result.snapshot;
  }

  /**
   * Apply one action for one player.
   * @param {string} code
   * @param {{ playerId?: string | null, secret?: string | null } | null} auth
   * @param {{ id?: string, type?: string, payload?: any }} action
   * @returns {Promise<RoomSnapshot>}
   */
  async act(code, auth, action) {
    const me = auth?.playerId ? String(auth.playerId) : '';
    const type = String(action?.type ?? '');
    const id = String(action?.id ?? '') || newId();
    if (!type || type.length > 64) throw new PlatformError(400, 'bad_action', 'That does not work in this room.');
    const result = await this.mutate(code, me, async (doc, kit, decks, now) => {
      this.authenticate(doc, me, auth?.secret);
      this.guard(doc,type,me);
      if (doc.seen.includes(id)) return null; // a retry of something we already did
      doc.seen.push(id);
      if (doc.seen.length > SEEN_LIMIT) doc.seen.splice(0, doc.seen.length - SEEN_LIMIT);
      checkLimit(doc, me, now, type.startsWith('chat/') ? 'chat' : 'action');
      const player = doc.players.find((p) => p.id === me);
      player.lastSeen = now;
      if (me === doc.hostId) doc.hostSeenAt = now;
      const pending = [];
      const full = { id, type, payload: action?.payload, playerId: me };
      if (isPlatformAction(type)) await this.applyPlatform(doc, kit, decks, now, full, pending);
      else {
        if (doc.phase !== 'playing' || !doc.s) throw new KitError('wrong_phase', 'The game is not running right now.');
        this.pushUndo(doc, now);
        this.applyKit(doc, kit, decks, now, full, pending);
      }
      appendLog(doc, now, pending);
      return null;
    });
    return result.snapshot;
  }

  // ---------------------------------------------------------------------------
  // the read-apply-write loop

  /**
   * Load a room, run due timers, apply `fn`, and write back with compare-and-set.
   * @param {string} code
   * @param {string | null} me  the player the returned snapshot is for
   * @param {(doc: RoomDoc, kit: Kit, decks: Record<string, Deck>, now: number) => any} fn
   * @param {{ readOnly?: boolean }} [opts]  readOnly means only ticks may change the doc
   */
  async mutate(code, me, fn, opts = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < CAS_TRIES; attempt++) {
      const row = await this.store.getRoom(code);
      if (!row) throw notFound();
      const doc = row.doc;
      const kit = getKit(doc.game.kitId);
      if (!kit) throw new PlatformError(500, 'no_kit', 'Parlor cannot run this room any more. Start a new one and share the code again.');
      const decks = doc.game.deckIds.length ? await this.loadDecks(doc.game.deckIds) : {};
      const now = this.now();
      const before = JSON.stringify(doc);
      if (doc.phase === 'playing' && kit.version !== doc.game.kitVersion) freezeForUpgrade(doc, now);
      this.runTicks(doc, kit, decks, now);
      const value = await fn(doc, kit, decks, now);
      const changed = JSON.stringify(doc) !== before;
      if (!changed) return { value, snapshot: this.buildSnapshot(doc, kit, decks, me) };
      doc.updatedAt = now;
      doc.v = row.v + 1;
      const newV = await this.store.casRoom(code, row.v, doc);
      if (newV !== null) {
        doc.v = newV;
        return { value, snapshot: this.buildSnapshot(doc, kit, decks, me) };
      }
      lastError = new PlatformError(409, 'busy', 'The table is busy. Try again.');
    }
    if (opts.readOnly) {
      // Ticks raced with someone else's write; their version already carries them.
      const row = await this.store.getRoom(code);
      if (!row) throw notFound();
      const kit = getKit(row.doc.game.kitId);
      const decks = row.doc.game.deckIds.length ? await this.loadDecks(row.doc.game.deckIds) : {};
      return { value: null, snapshot: this.buildSnapshot(row.doc, kit, decks, me) };
    }
    throw lastError;
  }

  authenticate(doc, playerId, secret) {
    if (!playerId || !secret || doc.secrets[playerId] !== String(secret)) throw forbidden();
    if (!doc.players.some((p) => p.id === playerId)) throw forbidden();
  }

  // ---------------------------------------------------------------------------
  // kit calls

  /** @returns {import('../types/parlor.js').KitContext} */
  makeCtx(doc, decks, now, me, pending) {
    const s = doc.s;
    const rng = makeRng(s ? s.$seed : '', s ? s.$rng : 0);
    return {
      config: doc.game.config,
      content: doc.game.content,
      decks,
      players: doc.players.map(publicPlayer),
      rng,
      now,
      log: (type, data) => { if (pending) pending.push({ type, ...(data || {}) }); },
      me,
      isHost: !!me && me === doc.hostId,
      recent: doc.recent,
    };
  }

  /** Run the kit reducer on the live state and persist the rng counter. */
  applyKit(doc, kit, decks, now, action, pending) {
    const ctx = this.makeCtx(doc, decks, now, action.playerId, pending);
    const next = kit.reduce(doc.s, action, ctx);
    if (!next || typeof next !== 'object') throw new Error(`kit ${kit.id} returned no state`);
    doc.s = withRng(next, ctx.rng.count());
    this.afterKitChange(doc, kit, now, pending);
  }

  /** Apply every due deadline, clamping the clock to the deadline so replays are exact. */
  runTicks(doc, kit, decks, now) {
    let guard = 0;
    while (doc.phase === 'playing' && doc.s && typeof doc.s.wakeAt === 'number' && now >= doc.s.wakeAt && guard++ < TICK_GUARD) {
      const at = doc.s.wakeAt;
      const pending = [];
      const ctx = this.makeCtx(doc, decks, at, null, pending);
      const next = kit.tick(doc.s, ctx);
      if (!next || typeof next !== 'object') throw new Error(`kit ${kit.id} tick returned no state`);
      doc.s = withRng(next, ctx.rng.count());
      if (doc.s.wakeAt === at) doc.s = { ...doc.s, wakeAt: null }; // a tick must move time forward
      this.afterKitChange(doc, kit, at, pending);
      appendLog(doc, at, pending); // stamped with the deadline, not the request that noticed it
    }
  }

  /** After any kit change: notice the end of the game. */
  afterKitChange(doc, kit, now, pending) {
    if (doc.phase === 'playing' && kit.summary(doc.s).phase === 'over') {
      doc.phase = 'over';
      pending.push({ type: 'over', winnerIds: kit.summary(doc.s).winnerIds });
    }
  }

  pushUndo(doc, now) {
    doc.undo.push({ savedAt: now, s: doc.s });
    if (doc.undo.length > UNDO_LIMIT) doc.undo.splice(0, doc.undo.length - UNDO_LIMIT);
  }

  /** Optional server-side context prepared once per start attempt, never persisted in public config. */
  async prepareSetup(doc, decks, ctx) { return {}; }

  async startGame(doc, kit, decks, now, pending, restart) {
    if (doc.players.length < kit.minPlayers) throw new PlatformError(409, 'too_few', `This game needs at least ${kit.minPlayers} ${kit.minPlayers === 1 ? 'player' : 'players'}.`);
    const seed = randomSeed();
    doc.s = { $seed: seed, $rng: 0, wakeAt: null };
    const ctx = this.makeCtx(doc, decks, now, null, pending);
    const state = kit.setup({ ...ctx, ...await this.prepareSetup(doc, decks, ctx) });
    doc.s = { ...state, $seed: seed, $rng: ctx.rng.count(), wakeAt: state.wakeAt ?? null };
    doc.phase = 'playing';
    doc.undo = [];
    doc.games += restart ? 1 : 0;
    pending.push({ type: restart ? 'restarted' : 'started' });
    this.afterKitChange(doc, kit, now, pending);
  }

  // ---------------------------------------------------------------------------
  // platform actions

  async applyPlatform(doc, kit, decks, now, action, pending) {
    const me = action.playerId;
    const isHost = me === doc.hostId;
    const player = doc.players.find((p) => p.id === me);
    const payload = action.payload || {};
    switch (action.type) {
      case 'room/hello': {
        if (!player.connected) {
          player.connected = true;
          if (doc.phase === 'playing' && doc.s) this.applyKit(doc, kit, decks, now, sys('player/return', { playerId: me }), pending);
        }
        return;
      }
      case 'room/away': {
        player.connected = false;
        if (doc.phase === 'playing' && doc.s) this.applyKit(doc, kit, decks, now, sys('player/leave', { playerId: me }), pending);
        return;
      }
      case 'room/leave': {
        // Leaving is a choice, so the seat goes with it (a dropped connection is `room/away`,
        // which keeps it). The kit sees a removal, and a rejoin gets a fresh seat.
        if (isHost) this.transferHost(doc, kit, decks, now, pending, null);
        doc.players = doc.players.filter((p) => p.id !== me);
        delete doc.secrets[me];
        delete doc.limits[me];
        pending.push({ type: 'left', playerId: me });
        if (doc.phase === 'playing' && doc.s) this.applyKit(doc, kit, decks, now, sys('player/remove', { playerId: me }), pending);
        return;
      }
      case 'room/kick': {
        if (!isHost) throw hostOnly();
        const target = String(payload.playerId ?? '');
        if (target === me || !doc.players.some((p) => p.id === target)) throw new PlatformError(400, 'bad_player', 'That player is not at the table.');
        doc.players = doc.players.filter((p) => p.id !== target);
        delete doc.secrets[target];
        delete doc.limits[target];
        pending.push({ type: 'removed', playerId: target, by: me });
        if (doc.phase === 'playing' && doc.s) this.applyKit(doc, kit, decks, now, sys('player/remove', { playerId: target }), pending);
        return;
      }
      case 'room/takeover': {
        if (isHost) return;
        if (!this.canTakeOver(doc, kit, decks, now)) throw new PlatformError(409, 'host_present', 'The host is still here.');
        this.transferHost(doc, kit, decks, now, pending, me);
        return;
      }
      case 'room/start': {
        if (!isHost) throw hostOnly();
        if (doc.phase !== 'lobby') throw new KitError('wrong_phase', 'The game has already started.');
        await this.startGame(doc, kit, decks, now, pending, false);
        return;
      }
      case 'room/restart': {
        if (!isHost) throw hostOnly();
        if (doc.phase === 'lobby') throw new KitError('wrong_phase', 'The game has not started yet.');
        await this.startGame(doc, kit, decks, now, pending, true);
        return;
      }
      case 'room/undo': {
        if (!isHost) throw hostOnly();
        const snap = doc.undo.pop();
        if (!snap) throw new PlatformError(409, 'nothing_to_undo', 'There is nothing to undo.');
        const elapsed = now - snap.savedAt;
        doc.s = { ...snap.s, wakeAt: typeof snap.s.wakeAt === 'number' ? snap.s.wakeAt + elapsed : null };
        doc.phase = kit.summary(doc.s).phase === 'over' ? 'over' : 'playing';
        pending.push({ type: 'undo', by: me });
        return;
      }
      case 'room/rename': {
        player.name = cleanName(payload.name, this.nameMaxLength);
        return;
      }
      case 'room/avatar': {
        player.avatar = cleanAvatar(payload.avatar);
        return;
      }
      case 'room/settings': {
        if (!isHost) throw hostOnly();
        if (doc.phase !== 'lobby') throw new KitError('wrong_phase', 'Settings can only change before the game starts.');
        const result = validate(kit.config, { ...doc.game.config, ...(payload.config || {}) });
        if (!result.ok) throw new PlatformError(400, 'bad_settings', result.issues[0].message);
        doc.game.config = result.value;
        doc.game.blurb = blurbFor(kit, doc.game.config, doc.game.content);
        pending.push({ type: 'settings', by: me });
        return;
      }
      case 'chat/send': {
        const text = String(payload.text ?? '').replace(/[^\P{Cc}\n]/gu, '').replace(/\s+/g, ' ').trim();
        if (!text) throw new PlatformError(400, 'empty', 'Type something first.');
        doc.chat.push({ id: newId(), t: now, playerId: me, text: [...text].slice(0, CHAT_MAX).join('') });
        if (doc.chat.length > CHAT_LIMIT) doc.chat.splice(0, doc.chat.length - CHAT_LIMIT);
        return;
      }
      case 'chat/react': {
        const emoji = cleanAvatar(payload.emoji);
        pending.push({ type: 'react', playerId: me, emoji });
        return;
      }
      default:
        throw new PlatformError(400, 'bad_action', 'That does not work in this room.');
    }
  }

  transferHost(doc, kit, decks, now, pending, to) {
    const from = doc.hostId;
    const next = to || (doc.players.find((p) => p.id !== from && p.connected) || doc.players.find((p) => p.id !== from))?.id;
    if (!next) return; // the host was the last one here
    doc.hostId = next;
    doc.hostSeenAt = now;
    for (const p of doc.players) p.isHost = p.id === next;
    pending.push({ type: 'host', playerId: next, from });
    if (doc.phase === 'playing' && doc.s) this.applyKit(doc, kit, decks, now, sys('host/transfer', { from, to: next }), pending);
  }

  /**
   * The host has gone: away from the page for a short while (a quick look at a message is not
   * an invitation to take their seat), or silent for a minute while the game waits on them.
   */
  canTakeOver(doc, kit, decks, now) {
    if (doc.phase !== 'playing' || !doc.s) return false;
    const host = doc.players.find((p) => p.id === doc.hostId);
    if (!host) return true;
    if (!host.connected) return now - doc.hostSeenAt >= HOST_AWAY_MS;
    if (now - doc.hostSeenAt < HOST_QUIET_MS) return false;
    const view = kit.view(doc.s, this.makeCtx(doc, decks, now, null, null));
    return Array.isArray(view.waitingOn) && view.waitingOn.includes(doc.hostId);
  }

  // ---------------------------------------------------------------------------
  // what a player receives

  /** @returns {RoomSnapshot} */
  buildSnapshot(doc, kit, decks, me) {
    const now = this.now();
    let view = null;
    let summary = null;
    if (doc.s && doc.phase !== 'lobby') {
      const raw = kit.view(doc.s, this.makeCtx(doc, decks, now, me, null));
      view = this.redact(raw, kit.id);
      if (view.wakeAt === undefined) view.wakeAt = doc.s.wakeAt ?? null;
      if (!Array.isArray(view.actions)) view.actions = [];
      summary = kit.summary(doc.s);
    }
    return {
      v: doc.v,
      now,
      room: {
        code: doc.code,
        phase: doc.phase,
        hostId: doc.hostId,
        players: doc.players.map(publicPlayer),
        game: doc.game,
        chat: doc.chat,
        log: doc.log,
        logN: doc.logN,
        games: doc.games,
        canUndo: doc.phase !== 'lobby' && doc.undo.length > 0,
        canTakeOver: !!me && me !== doc.hostId && this.canTakeOver(doc, kit, decks, now),
      },
      view,
      summary,
    };
  }

  /** Rule R2: nothing under an underscore key ever leaves the server. */
  redact(view, kitId) {
    const leaks = [];
    const clean = stripSecrets(view, '', leaks);
    if (leaks.length) {
      if (this.strict) throw new Error(`kit ${kitId} leaked ${leaks.join(', ')} in its view`);
      console.error(`kit ${kitId} leaked ${leaks.join(', ')} in its view; stripped`);
    }
    return clean;
  }
}

// -----------------------------------------------------------------------------
// helpers

/** The kit's one-line description of these settings, or undefined when it has none or it misbehaves. */
export function blurbFor(kit, config, content) {
  if (typeof kit.blurb !== 'function') return undefined;
  try {
    const text = String(kit.blurb(config, content) ?? '').trim();
    return text && text.length <= 120 ? text : undefined;
  } catch {
    return undefined;
  }
}

function makePlayer(id, body, now, seat, isHost, nameMaxLength) {
  return { id, name: cleanName(body?.name, nameMaxLength), avatar: cleanAvatar(body?.avatar), seat, connected: true, isHost, joinedAt: now, lastSeen: now };
}

/** @returns {PlayerInfo} */
function publicPlayer(p) {
  return { id: p.id, name: p.name, avatar: p.avatar, seat: p.seat, connected: p.connected, isHost: p.isHost, joinedAt: p.joinedAt, lastSeen: p.lastSeen };
}

function sys(type, payload) {
  return { id: newId(), type, payload, playerId: null };
}

function isPlatformAction(type) {
  return PLATFORM_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function withRng(state, count) {
  return state.$rng === count ? state : { ...state, $rng: count };
}

function appendLog(doc, now, pending) {
  for (const entry of pending) {
    doc.logN += 1;
    doc.log.push({ n: doc.logN, t: now, ...entry });
  }
  if (doc.log.length > LOG_LIMIT) doc.log.splice(0, doc.log.length - LOG_LIMIT);
}

function checkLimit(doc, playerId, now, kind) {
  const key = kind === 'chat' ? `chat:${playerId}` : playerId;
  const rule = LIMITS[kind];
  const window = doc.limits[key];
  if (!window || now - window.w >= rule.windowMs) {
    doc.limits[key] = { w: now, c: 1 };
    return;
  }
  window.c += 1;
  if (window.c > rule.max) throw new PlatformError(429, 'rate_limited', 'Slow down a little, then try again.');
}

function cleanRecent(recent) {
  if (!Array.isArray(recent)) return [];
  return recent.filter((id) => typeof id === 'string' && id.length <= 64).slice(-RECENT_LIMIT);
}

function mergeRecent(doc, recent) {
  const merged = [...new Set([...doc.recent, ...cleanRecent(recent)])];
  doc.recent = merged.slice(-RECENT_LIMIT);
}

/** Deck ids referenced anywhere in content, found through the schema's `decks` fields. */
export function collectDeckIds(schema, value, out = []) {
  for (const [name, field] of Object.entries(schema || {})) {
    const v = value?.[name];
    if (v === undefined || v === null) continue;
    if (field.type === 'decks' && Array.isArray(v)) {
      for (const id of v) if (!out.includes(id)) out.push(id);
    } else if (field.type === 'object' && field.fields) {
      collectDeckIds(field.fields, v, out);
    } else if (field.type === 'list' && field.of && Array.isArray(v)) {
      if (field.of.type === 'object' && field.of.fields) for (const item of v) collectDeckIds(field.of.fields, item, out);
      else if (field.of.type === 'decks') for (const ids of v) if (Array.isArray(ids)) for (const id of ids) if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

function freezeForUpgrade(doc, now) {
  doc.phase = 'over';
  appendLog(doc, now, [{ type: 'upgraded' }]);
}

function stripSecrets(value, path, leaks) {
  if (Array.isArray(value)) return value.map((item, i) => stripSecrets(item, `${path}[${i}]`, leaks));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) { leaks.push(path ? `${path}.${k}` : k); continue; }
      out[k] = stripSecrets(v, path ? `${path}.${k}` : k, leaks);
    }
    return out;
  }
  return value;
}
