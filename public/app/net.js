// The one place the client talks to the server. Two things live here:
//
//   api(method, path, opts)   a JSON fetch with player auth headers and readable errors
//   createRoomClient(...)     the polling loop that keeps one room's snapshot fresh
//
// The loop is deliberately simple: every ~1 s it asks `GET /api/rooms/CODE/v` (cheap, CDN-cached,
// identical for every player) and only when the version moved does it fetch its own view. It pauses
// while the tab is hidden, backs off on errors, pokes the server right after a deadline so lazy
// timers fire on time, and keeps a server clock offset so countdowns are honest. Nothing here knows
// what game is being played; screens get snapshots and send actions.

import { QUIET_CODES } from '../shared/errors.js';
import { newId } from '../shared/ids.js';

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
  /** True when the request never reached the server. */
  get offline() { return this.status === 0; }
}

/** Server clock minus device clock, in ms; median of the last few samples. */
let offsetSamples = [];
let offset = 0;

/** @returns {number} the current time as the server sees it */
export function serverNow() {
  return Date.now() + offset;
}

/** @returns {string} a fresh action id (the server drops repeats) */
export function newActionId() {
  return newId();
}

function noteServerTime(serverTime, sentAt, receivedAt) {
  if (typeof serverTime !== 'number') return;
  const rtt = receivedAt - sentAt;
  offsetSamples.push(serverTime + rtt / 2 - receivedAt);
  if (offsetSamples.length > 5) offsetSamples = offsetSamples.slice(-5);
  const sorted = [...offsetSamples].sort((a, b) => a - b);
  offset = sorted[Math.floor(sorted.length / 2)];
}

/**
 * Fetch JSON from the API.
 * @param {'GET' | 'POST' | 'PUT' | 'DELETE'} method
 * @param {string} path  e.g. '/api/rooms/ABCD'
 * @param {{ body?: any, auth?: { playerId: string, secret: string } | null, editKey?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<any>}
 */
export async function api(method, path, opts = {}) {
  const headers = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth?.playerId && opts.auth?.secret) {
    headers['X-Player-Id'] = opts.auth.playerId;
    headers['X-Player-Secret'] = opts.auth.secret;
  }
  if (opts.editKey) headers['X-Edit-Key'] = opts.editKey;
  const sentAt = Date.now();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'offline', "Can't reach the room. Check your signal, then try again.");
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (data && typeof data.now === 'number') noteServerTime(data.now, sentAt, Date.now());
  if (!res.ok) {
    const message = (data && data.error) || (res.status >= 500 ? 'Parlor is having trouble. Wait a moment, then try again.' : 'That did not work. Try again.');
    throw new ApiError(res.status, (data && data.code) || 'error', message);
  }
  return data;
}

const INTERVALS = { play: 800, lobby: 1500, quiet: 2500 };
const QUIET_AFTER = 3 * 60 * 1000;
const MAX_BACKOFF = 8000;

/**
 * Keep one room's snapshot fresh and send actions for one player.
 *
 * @param {{
 *   code: string,
 *   auth: { playerId: string, secret: string },
 *   onSnapshot: (snapshot: import('../../types/parlor.js').RoomSnapshot) => void,
 *   onStatus?: (status: 'live' | 'reconnecting' | 'offline' | 'gone' | 'removed') => void,
 *   isHost?: () => boolean,
 * }} opts
 */
export function createRoomClient(opts) {
  const { code, auth } = opts;
  let snapshot = null;
  let v = 0;
  let timer = null;
  let running = false;
  let inflight = false;
  let failures = 0;
  let status = 'live';
  let lastChangeAt = Date.now();
  let pokeTimer = null;

  function setStatus(next) {
    if (status === next) return;
    status = next;
    client.status = next;
    opts.onStatus?.(next);
  }

  function accept(data) {
    if (!data || typeof data.v !== 'number') return;
    if (data.view !== undefined || data.room !== undefined) {
      if (data.v < v) return; // an older response arriving late
      v = data.v;
      snapshot = data;
      lastChangeAt = Date.now();
      schedulePoke();
      opts.onSnapshot(data);
    } else if (data.v !== v) {
      v = data.v;
    }
  }

  function interval() {
    if (document.visibilityState === 'hidden') return null;
    const phase = snapshot?.room?.phase;
    if (Date.now() - lastChangeAt > QUIET_AFTER) return INTERVALS.quiet;
    return phase === 'playing' ? INTERVALS.play : INTERVALS.lobby;
  }

  function schedule(delay) {
    clearTimeout(timer);
    if (!running) return;
    const ms = delay ?? interval();
    if (ms === null) return; // hidden: visibilitychange restarts us
    timer = setTimeout(() => { poll(); }, ms);
  }

  /** Right after a deadline the state may change without any player acting, so ask for it directly. */
  function schedulePoke() {
    clearTimeout(pokeTimer);
    const wakeAt = snapshot?.view?.wakeAt;
    if (typeof wakeAt !== 'number') return;
    const jitter = opts.isHost?.() ? 150 : 400 + Math.random() * 350;
    const delay = Math.max(0, wakeAt - serverNow()) + jitter;
    pokeTimer = setTimeout(() => { fetchState().catch(() => {}); }, delay);
  }

  async function fetchVersion() {
    const data = await api('GET', `/api/rooms/${code}/v`);
    return data.v;
  }

  async function fetchState() {
    const data = await api('GET', `/api/rooms/${code}`, { auth });
    accept(data);
    return data;
  }

  async function poll() {
    if (!running || inflight) return;
    inflight = true;
    try {
      const wakeAt = snapshot?.view?.wakeAt;
      const due = typeof wakeAt === 'number' && serverNow() >= wakeAt;
      if (due || !snapshot) {
        await fetchState();
      } else {
        const remote = await fetchVersion();
        if (remote !== v) await fetchState();
      }
      failures = 0;
      setStatus('live');
      inflight = false;
      schedule();
    } catch (err) {
      inflight = false;
      if (err instanceof ApiError) {
        if (err.status === 404) { stop(); setStatus('gone'); return; }
        if (err.status === 403) { stop(); setStatus('removed'); return; }
      }
      failures += 1;
      setStatus(err instanceof ApiError && err.offline ? 'offline' : 'reconnecting');
      schedule(Math.min(MAX_BACKOFF, 800 * 2 ** failures));
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') poll();
    else clearTimeout(timer);
  }

  function start() {
    if (running) return;
    running = true;
    document.addEventListener('visibilitychange', onVisibility);
    poll();
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    clearTimeout(pokeTimer);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  /**
   * Send an action. Resolves with the fresh snapshot. Quiet errors (someone else got there first)
   * resolve with a refreshed snapshot instead of throwing, so screens rarely need try/catch.
   * @param {string} type
   * @param {any} [payload]
   */
  async function send(type, payload) {
    try {
      const data = await api('POST', `/api/rooms/${code}/act`, { auth, body: { id: newActionId(), type, payload } });
      accept(data);
      return data;
    } catch (err) {
      if (err instanceof ApiError && QUIET_CODES.has(err.code)) return fetchState();
      if (err instanceof ApiError && err.status === 404) { stop(); setStatus('gone'); }
      if (err instanceof ApiError && err.status === 403) { stop(); setStatus('removed'); }
      throw err;
    }
  }

  const client = {
    start,
    stop,
    send,
    /** Fetch the state now, ignoring the version check. */
    refresh: fetchState,
    get snapshot() { return snapshot; },
    status,
  };
  return client;
}
