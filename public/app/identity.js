// What this device remembers between visits: who you are, which rooms you are in, which
// cards you have seen lately, and whether sound is on. All of it lives in localStorage
// and none of it is an account: there is no sign-in anywhere in Parlor, so the browser
// holding a room's player id and secret is the only thing that proves you are you.
//
// Every read and write goes through a try/catch. Private windows, full disks, and browsers
// with storage switched off all throw on plain property access, and a game night should
// not end because of it: a device that cannot remember anything still plays fine, it just
// asks for your name again.

import { newId } from '../shared/ids.js';

const ME_KEY = 'parlor:me';
const ROOM_PREFIX = 'parlor:room:';
const SEEN_KEY = 'parlor:seen';
const SOUND_KEY = 'parlor:sound';
const GAMES_KEY = 'parlor:games';
const DECKS_KEY = 'parlor:decks';

/** Card ids to keep, so a deck does not repeat itself across a few games. */
const SEEN_MAX = 250;
/** How many rooms Home offers to take you back into. */
const RECENT_ROOMS = 3;
/** How many games or decks this device lists as its own. */
const MADE_MAX = 50;

/** The avatars a new player can be. Animals, friendly, legible at 32 px, no faces of people. */
export const AVATARS = [
  '🦊', '🐙', '🐼', '🦉', '🐢', '🦔', '🐝', '🐳',
  '🦩', '🐧', '🦌', '🐰', '🦚', '🐨', '🦆', '🐸',
];

/**
 * @typedef {{ id: string, name: string, avatar: string }} Me
 * @typedef {{ code: string, playerId: string, secret: string, gameTitle: string, gameEmoji: string, gameAccent: string, savedAt: number }} SavedRoom
 * @typedef {{ id: string, slug: string, title: string, editKey: string, savedAt: number }} Made
 */

/**
 * This device's identity, made on first use. The name starts empty; screens that need one
 * ask for it (NameSheet) rather than inventing a name nobody chose.
 * @returns {Me}
 */
export function me() {
  const saved = readJson(ME_KEY, null);
  if (saved && typeof saved.id === 'string' && saved.id) {
    return { id: saved.id, name: String(saved.name || ''), avatar: String(saved.avatar || pickAvatar()) };
  }
  const fresh = { id: newId(), name: '', avatar: pickAvatar() };
  writeJson(ME_KEY, fresh);
  return fresh;
}

/**
 * Change the name or the avatar and keep the id.
 * @param {{ name?: string, avatar?: string }} patch
 * @returns {Me}
 */
export function setMe(patch) {
  const current = me();
  const next = {
    id: current.id,
    name: patch.name === undefined ? current.name : String(patch.name).trim().slice(0, 24),
    avatar: patch.avatar === undefined ? current.avatar : String(patch.avatar),
  };
  writeJson(ME_KEY, next);
  return next;
}

/** True once this device has chosen a name, so we only ask the first time. */
export function hasName() {
  return me().name.trim().length > 0;
}

/** One of the sixteen, at random. */
export function pickAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

/**
 * Remember that this device is a player in a room, so closing the tab is not leaving.
 * @param {string} code
 * @param {{ playerId: string, secret: string, gameTitle?: string, gameEmoji?: string, gameAccent?: string }} seat
 */
export function saveRoom(code, seat) {
  const key = ROOM_PREFIX + String(code).toUpperCase();
  writeJson(key, {
    playerId: seat.playerId,
    secret: seat.secret,
    gameTitle: String(seat.gameTitle || ''),
    gameEmoji: String(seat.gameEmoji || ''),
    gameAccent: String(seat.gameAccent || ''),
    savedAt: Date.now(),
  });
}

/**
 * The seat this device holds in a room, or null when it has never been in one.
 * @param {string} code
 * @returns {SavedRoom | null}
 */
export function savedRoom(code) {
  const upper = String(code || '').toUpperCase();
  const saved = readJson(ROOM_PREFIX + upper, null);
  if (!saved || !saved.playerId || !saved.secret) return null;
  return {
    code: upper,
    playerId: saved.playerId,
    secret: saved.secret,
    gameTitle: String(saved.gameTitle || ''),
    gameEmoji: String(saved.gameEmoji || ''),
    gameAccent: String(saved.gameAccent || ''),
    savedAt: Number(saved.savedAt) || 0,
  };
}

/** Forget a room after leaving it, so Home stops offering to take you back. */
export function forgetRoom(code) {
  remove(ROOM_PREFIX + String(code || '').toUpperCase());
}

/**
 * The rooms this device was in most recently, newest first.
 * @returns {SavedRoom[]}
 */
export function recentRooms() {
  /** @type {SavedRoom[]} */
  const rooms = [];
  for (const key of keys()) {
    if (!key.startsWith(ROOM_PREFIX)) continue;
    const room = savedRoom(key.slice(ROOM_PREFIX.length));
    if (room) rooms.push(room);
  }
  rooms.sort((a, b) => b.savedAt - a.savedAt);
  return rooms.slice(0, RECENT_ROOMS);
}

/**
 * Note cards this device has just seen. Rooms send the list when they open so kits can
 * deal something else; it is per device on purpose, because the person holding the phone
 * is the one who would recognise the question.
 * @param {string[]} ids
 */
export function rememberCards(ids) {
  const fresh = (ids || []).map(String).filter(Boolean);
  if (!fresh.length) return;
  const merged = [...fresh, ...recentCards().filter((id) => !fresh.includes(id))];
  writeJson(SEEN_KEY, merged.slice(0, SEEN_MAX));
}

/** @returns {string[]} the card ids this device has seen lately, newest first */
export function recentCards() {
  const saved = readJson(SEEN_KEY, []);
  return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string').slice(0, SEEN_MAX) : [];
}

/** Sound is on unless this device turned it off; the room menu has the switch. */
export function soundOn() {
  return readRaw(SOUND_KEY) !== 'off';
}

/** @param {boolean} on */
export function setSoundOn(on) {
  writeRaw(SOUND_KEY, on ? 'on' : 'off');
}

/**
 * The games and decks this device made, newest first. They are kept here and nowhere else:
 * a game made in the browser has no account behind it, so the edit key in this list is the
 * only thing that can change it again. Clearing site data loses edit rights, which is the
 * trade for never asking anyone to sign up.
 * @returns {Made[]}
 */
export function myGames() {
  return readMade(GAMES_KEY);
}

/**
 * Remember a game this device just published or edited.
 * @param {{ id: string, slug?: string, title?: string, editKey?: string }} game
 * @returns {Made[]}  the list, as it now stands
 */
export function addMyGame(game) {
  return addMade(GAMES_KEY, game);
}

/** The decks this device made, newest first. @returns {Made[]} */
export function myDecks() {
  return readMade(DECKS_KEY);
}

/**
 * Remember a deck this device just published or edited.
 * @param {{ id: string, slug?: string, title?: string, editKey?: string }} deck
 * @returns {Made[]}
 */
export function addMyDeck(deck) {
  return addMade(DECKS_KEY, deck);
}

/**
 * Drop a game or a deck from the list. It does not delete anything on the server; the link
 * still works for anyone holding it. This is only the list on this device.
 * @param {'game' | 'deck'} what
 * @param {string} id
 */
export function forgetMade(what, id) {
  const key = what === 'deck' ? DECKS_KEY : GAMES_KEY;
  writeJson(key, readMade(key).filter((item) => item.id !== String(id)));
}

/** @param {string} key @returns {Made[]} */
function readMade(key) {
  const saved = readJson(key, []);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((item) => item && typeof item.id === 'string' && item.id)
    .map((item) => ({
      id: item.id,
      slug: String(item.slug || item.id),
      title: String(item.title || ''),
      editKey: String(item.editKey || ''),
      savedAt: Number(item.savedAt) || 0,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Put one at the front. Saving the same id twice updates the row rather than adding a second,
 * because editing a game is not making another one.
 * @param {string} key
 * @param {{ id: string, slug?: string, title?: string, editKey?: string }} item
 * @returns {Made[]}
 */
function addMade(key, item) {
  const id = String((item && item.id) || '');
  if (!id) return readMade(key);
  const older = readMade(key).filter((row) => row.id !== id);
  const previous = readMade(key).find((row) => row.id === id);
  const next = {
    id,
    slug: String(item.slug || (previous && previous.slug) || id),
    title: String(item.title || (previous && previous.title) || ''),
    // An edit key is never overwritten with nothing: editing from a saved key must not lose it.
    editKey: String(item.editKey || (previous && previous.editKey) || ''),
    savedAt: Date.now(),
  };
  const list = [next, ...older].slice(0, MADE_MAX);
  writeJson(key, list);
  return list;
}

// ---------------------------------------------------------------------------
// Storage, wrapped. Nothing below throws.

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readRaw(key) {
  try {
    const store = storage();
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    const store = storage();
    if (store) store.setItem(key, value);
  } catch {
    // A full or disabled store is not worth interrupting a game for.
  }
}

function remove(key) {
  try {
    const store = storage();
    if (store) store.removeItem(key);
  } catch {
    // As above.
  }
}

function readJson(key, fallback) {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    // As above.
  }
}

/** @returns {string[]} every key in the store, or none when there is no store. */
function keys() {
  try {
    const store = storage();
    if (!store) return [];
    const out = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (typeof key === 'string') out.push(key);
    }
    return out;
  } catch {
    return [];
  }
}
