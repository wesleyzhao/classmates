// Decks: lists of cards that games draw from. Built-in decks ship with the platform and
// are immutable, so their modules are imported once and kept. Decks people make live in
// the store under the same ownership scheme as games: an owner string and the SHA-256 of
// an edit key that only the maker ever sees.
//
// Rooms load decks by id when they start and remember the version they started with, so
// editing a deck never changes a game already in progress.

import { createHash, timingSafeEqual } from 'node:crypto';
import { PlatformError } from '../public/shared/errors.js';
import { newId } from '../public/shared/ids.js';
import { BUILTIN_DECKS } from '../public/shared/registry.js';
import { getStore } from './store/index.js';

/** @typedef {import('../types/parlor.js').Deck} Deck */
/** @typedef {import('../types/parlor.js').Card} Card */

/** A deck is mostly text, so the cap is larger than a game's. */
const MAX_BYTES = 300 * 1024;
const MAX_CARDS = 2000;

/** @type {Map<string, Deck | null>} */
const builtins = new Map();

/**
 * One deck by id, built-in or not.
 * @param {string} id
 * @returns {Promise<Deck | null>}
 */
export async function getDeck(id) {
  const key = String(id || '');
  if (!key) return null;
  const builtin = await loadBuiltin(key);
  if (builtin) return builtin;
  const store = await getStore();
  const row = await store.getDeck(key);
  return row ? row.doc : null;
}

/**
 * Every deck a game refers to, by id. Ids that do not exist are simply absent, which
 * lets a room start with the decks that are still there.
 * @param {string[]} ids
 * @returns {Promise<Record<string, Deck>>}
 */
export async function getDecks(ids) {
  /** @type {Record<string, Deck>} */
  const out = {};
  for (const id of Array.isArray(ids) ? ids : []) {
    if (out[id]) continue;
    const deck = await getDeck(id);
    if (deck) out[id] = deck;
  }
  return out;
}

/**
 * Save a new deck and hand back the key that lets its maker edit it later.
 * @param {Record<string, any>} def
 * @param {{ owner?: string | null, ip?: string }} [who]
 * @returns {Promise<{ deck: Deck, editKey: string }>}
 */
export async function createDeck(def, who = {}) {
  const store = await getStore();
  checkSize(def);
  const now = Date.now();
  const id = newId();
  const deck = buildDeck(def, { id, version: 1 });
  const editKey = newId();
  await store.putDeck({
    id,
    owner: ownerOf(who),
    editKeyHash: sha256(editKey),
    v: 1,
    doc: deck,
    createdAt: now,
    updatedAt: now,
  });
  return { deck, editKey };
}

/**
 * Replace a deck's contents. The id and owner stay put and the version goes up, which
 * is how rooms notice that a deck moved on.
 * @param {string} id
 * @param {Record<string, any>} def
 * @param {string | null} editKey  from the X-Edit-Key header
 * @returns {Promise<Deck>}
 */
export async function updateDeck(id, def, editKey) {
  const store = await getStore();
  if (await loadBuiltin(String(id || ''))) {
    throw new PlatformError(403, 'builtin', 'Built-in decks cannot be edited. Make a copy instead.');
  }
  const row = await store.getDeck(String(id || ''));
  if (!row) throw new PlatformError(404, 'not_found', 'No deck with that link.');
  if (!keyMatches(editKey, row.editKeyHash)) {
    throw new PlatformError(403, 'forbidden', 'That edit link is not valid for this deck.');
  }
  const v = row.v + 1;
  const merged = { ...row.doc, ...def };
  checkSize(merged);
  const deck = buildDeck(merged, { id: row.id, version: v });
  await store.putDeck({ ...row, v, doc: deck, updatedAt: Date.now() });
  return deck;
}

/** @param {string} key an id registered in BUILTIN_DECKS */
async function loadBuiltin(key) {
  if (builtins.has(key)) return builtins.get(key) || null;
  const path = BUILTIN_DECKS[key];
  if (!path) return null;
  const module = await import(new URL(`../public/${path}`, import.meta.url).href);
  const deck = /** @type {Deck} */ (module.default);
  builtins.set(key, deck);
  return deck;
}

/**
 * Check what the maker sent and return a clean deck. Cards keep only the fields the
 * card shape names, and every card comes out with an id.
 * @returns {Deck}
 */
function buildDeck(def, fixed) {
  const title = String(def.title ?? '').trim();
  if (!title) throw new PlatformError(400, 'invalid', 'That deck needs a title.');

  const given = Array.isArray(def.cards) ? def.cards : [];
  if (!given.length) throw new PlatformError(400, 'invalid', 'That deck needs at least one card.');
  if (given.length > MAX_CARDS) {
    throw new PlatformError(400, 'invalid', `That deck has too many cards. Keep it to ${MAX_CARDS} or fewer.`);
  }

  const cards = given.map((card, index) => buildCard(card, index));

  /** @type {Deck} */
  const deck = {
    id: fixed.id,
    title: title.slice(0, 80),
    ...(def.description ? { description: String(def.description).trim().slice(0, 300) } : {}),
    ...(def.language ? { language: String(def.language).trim().slice(0, 16) } : {}),
    version: fixed.version,
    ...(Array.isArray(def.categories) ? { categories: def.categories.map(buildCategory) } : {}),
    cards,
  };

  checkSize(deck);
  return deck;
}

/**
 * The cap is checked on what was sent as well as on what is about to be stored, so a
 * huge payload is refused before any of it is copied into a new deck.
 */
function checkSize(value) {
  if (Buffer.byteLength(JSON.stringify(value) || '') > MAX_BYTES) {
    throw new PlatformError(413, 'too_large', 'That deck is too big to save. Trim the content and try again.');
  }
}

/** @returns {Card} */
function buildCard(card, index) {
  const source = card && typeof card === 'object' ? card : {};
  const prompt = String(source.prompt ?? '').trim();
  const answer = String(source.answer ?? '').trim();
  if (!prompt || !answer) {
    throw new PlatformError(400, 'invalid', `Card ${index + 1} needs both a prompt and an answer.`);
  }
  return {
    id: String(source.id || newId()),
    prompt,
    answer,
    ...(Array.isArray(source.aliases) ? { aliases: source.aliases.map(String) } : {}),
    ...(Array.isArray(source.choices) ? { choices: source.choices.map(String) } : {}),
    ...(Array.isArray(source.reject) ? { reject: source.reject.map(String) } : {}),
    ...(source.image ? { image: String(source.image) } : {}),
    ...(source.emoji ? { emoji: String(source.emoji) } : {}),
    ...(source.category ? { category: String(source.category) } : {}),
    ...(source.note ? { note: String(source.note) } : {}),
  };
}

function buildCategory(category) {
  const source = category && typeof category === 'object' ? category : {};
  return {
    id: String(source.id || newId()),
    name: String(source.name ?? '').trim() || 'Category',
    ...(source.color ? { color: String(source.color) } : {}),
    ...(source.emoji ? { emoji: String(source.emoji) } : {}),
  };
}

/** Decks made without a sign-in are owned by the device that made them, or by its address. */
function ownerOf(who) {
  const owner = typeof who.owner === 'string' ? who.owner.trim().slice(0, 64) : '';
  if (owner) return owner;
  return `ip:${who.ip || 'unknown'}`;
}

function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

/** Constant time, so the wrong key cannot be found one character at a time. */
function keyMatches(editKey, hash) {
  if (!editKey || !hash) return false;
  const a = Buffer.from(sha256(editKey), 'hex');
  const b = Buffer.from(String(hash), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
