// Play a kit without a server. The simulator does exactly what server/rooms.js does around a kit
// (seeded rng, clamped tick loop, per-player views, secret scanning) but with a clock you control,
// so a whole game runs in milliseconds inside `node --test`.
//
//   const sim = simulate(kit, { config: { target: 3 } }, ['ann', 'ben']);
//   sim.do('ann', 'tap');            // an action by a player (throws KitError when illegal)
//   sim.wait(5000);                  // advance the clock and fire due deadlines
//   sim.view('ben').actions          // what Ben may do now
//   sim.summary().phase              // 'playing' | 'over'
//   sim.run(kit.demoScript)          // a scripted game, see ScriptStep in types/parlor.d.ts

import { validate } from '../../public/shared/schema.js';
import { makeRng } from '../../public/kits/_lib/rng.js';

const START = 1_700_000_000_000;
const TICK_GUARD = 50;

/**
 * @param {import('../../types/parlor.js').Kit} kit
 * @param {{ config?: Record<string, any>, content?: Record<string, any>, decks?: Record<string, import('../../types/parlor.js').Deck>, recent?: string[] }} [game]
 * @param {string[]} [playerIds]
 * @param {{ seed?: string, now?: number }} [opts]
 */
export function simulate(kit, game = {}, playerIds = ['p1', 'p2'], opts = {}) {
  const configResult = validate(kit.config, game.config || {});
  if (!configResult.ok) throw new Error(`bad config for ${kit.id}: ${configResult.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  const contentResult = validate(kit.content, game.content || {}, { config: configResult.value });
  if (!contentResult.ok) throw new Error(`bad content for ${kit.id}: ${contentResult.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);

  const sim = {
    kit,
    config: configResult.value,
    content: contentResult.value,
    decks: game.decks || {},
    recent: game.recent || [],
    now: opts.now ?? START,
    seed: opts.seed ?? 'sim-seed',
    /** @type {any} */
    state: null,
    /** @type {Array<{ id: string, name: string, avatar: string, seat: number, connected: boolean, isHost: boolean, joinedAt: number, lastSeen: number }>} */
    players: [],
    /** @type {Array<{ n: number, t: number, type: string, [k: string]: any }>} */
    log: [],
    logN: 0,
    hostId: playerIds[0],
    actionCount: 0,

    ctx(me, pending) {
      const s = sim.state;
      const rng = makeRng(sim.seed, s ? s.$rng : 0);
      return {
        config: sim.config,
        content: sim.content,
        decks: sim.decks,
        players: sim.players.map((p) => ({ ...p })),
        rng,
        now: sim.now,
        log: (type, data) => { if (pending) pending.push({ type, ...(data || {}) }); },
        me,
        isHost: !!me && me === sim.hostId,
        recent: sim.recent,
      };
    },

    commit(next, rng, pending) {
      if (!next || typeof next !== 'object') throw new Error(`kit ${kit.id} returned no state`);
      sim.state = deepFreeze({ ...next, $seed: sim.seed, $rng: rng.count(), wakeAt: next.wakeAt ?? null });
      for (const entry of pending) sim.log.push({ n: ++sim.logN, t: sim.now, ...entry });
      if (sim.log.length > 30) sim.log.splice(0, sim.log.length - 30);
    },

    start() {
      sim.state = { $seed: sim.seed, $rng: 0, wakeAt: null };
      const pending = [];
      const ctx = sim.ctx(null, pending);
      sim.commit(kit.setup(ctx), ctx.rng, pending);
      return sim;
    },

    /** A player acts. Throws whatever the kit throws; state is untouched then. */
    do(playerId, type, payload) {
      sim.actionCount += 1;
      const pending = [];
      const ctx = sim.ctx(playerId, pending);
      const action = { id: `a${sim.actionCount}`, type, payload, playerId };
      const next = kit.reduce(sim.state, action, ctx);
      sim.commit(next, ctx.rng, pending);
      sim.runTicks();
      return sim;
    },

    /** A platform event (player/join, player/leave, player/return, player/remove, host/transfer, game/restart). */
    system(type, payload) {
      const pending = [];
      const ctx = sim.ctx(null, pending);
      const next = kit.reduce(sim.state, { id: `s${++sim.actionCount}`, type, payload, playerId: null }, ctx);
      sim.commit(next, ctx.rng, pending);
      return sim;
    },

    join(playerId) {
      if (sim.players.some((p) => p.id === playerId)) throw new Error(`${playerId} is already at the table`);
      sim.players.push(makePlayer(playerId, sim.players.length, sim.now, false));
      return sim.system('player/join', { playerId });
    },
    leave(playerId) {
      const p = sim.players.find((x) => x.id === playerId);
      if (p) p.connected = false;
      return sim.system('player/leave', { playerId });
    },
    return(playerId) {
      const p = sim.players.find((x) => x.id === playerId);
      if (p) p.connected = true;
      return sim.system('player/return', { playerId });
    },
    remove(playerId) {
      sim.players = sim.players.filter((x) => x.id !== playerId);
      return sim.system('player/remove', { playerId });
    },
    transferHost(to) {
      const from = sim.hostId;
      sim.hostId = to;
      for (const p of sim.players) p.isHost = p.id === to;
      return sim.system('host/transfer', { from, to });
    },

    /** Advance the clock and fire every deadline that passed, each with the clock clamped to it. */
    wait(ms) {
      sim.now += ms;
      sim.runTicks();
      return sim;
    },

    runTicks() {
      let guard = 0;
      while (sim.state && typeof sim.state.wakeAt === 'number' && sim.now >= sim.state.wakeAt && guard++ < TICK_GUARD) {
        const at = sim.state.wakeAt;
        const saved = sim.now;
        sim.now = at;
        const pending = [];
        const ctx = sim.ctx(null, pending);
        const next = kit.tick(sim.state, ctx);
        sim.now = saved;
        if (!next || typeof next !== 'object') throw new Error(`kit ${kit.id} tick returned no state`);
        if (next.wakeAt === at) throw new Error(`kit ${kit.id} tick left wakeAt at ${at}; a tick must move time forward or clear it`);
        sim.commit(next, ctx.rng, pending);
      }
      if (guard >= TICK_GUARD) throw new Error(`kit ${kit.id} ticked ${TICK_GUARD} times in a row`);
    },

    /** One player's view (null = spectator), scanned for leaked secrets. @returns {any} */
    view(playerId = null) {
      const raw = kit.view(sim.state, sim.ctx(playerId, null));
      const leaks = findSecrets(raw, '');
      if (leaks.length) throw new Error(`kit ${kit.id} leaked ${leaks.join(', ')} in the view for ${playerId ?? 'a spectator'}`);
      if (!Array.isArray(raw.actions)) throw new Error(`kit ${kit.id} view has no actions array`);
      return raw;
    },

    summary() {
      return kit.summary(sim.state);
    },

    /** Run a script (see ScriptStep). */
    run(script) {
      for (const step of script || []) {
        const [head, ...rest] = step;
        if (head === '@wait') sim.wait(rest[0]);
        else if (head === '@join') sim.join(rest[0]);
        else if (head === '@leave') sim.leave(rest[0]);
        else if (head === '@return') sim.return(rest[0]);
        else if (head === '@remove') sim.remove(rest[0]);
        else if (head === '@check') rest[0](sim);
        else sim.do(head, rest[0], rest[1]);
      }
      return sim;
    },
  };

  sim.players = playerIds.map((id, i) => makePlayer(id, i, sim.now, i === 0));
  return sim.start();
}

function makePlayer(id, seat, now, isHost) {
  return { id, name: id[0].toUpperCase() + id.slice(1), avatar: '🙂', seat, connected: true, isHost, joinedAt: now, lastSeen: now };
}

/** Keys starting with an underscore anywhere in a view, as dotted paths. */
export function findSecrets(value, path, out = []) {
  if (Array.isArray(value)) value.forEach((item, i) => findSecrets(item, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (k.startsWith('_')) out.push(p);
      else findSecrets(v, p, out);
    }
  }
  return out;
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
