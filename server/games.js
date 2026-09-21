// Games: the built-in ones that ship with the platform and the ones people make.
//
// Built-ins come from public/shared/registry.js and are immutable, so their modules are
// imported once and cached forever. User games live in the store, owned by whoever made
// them and edited with a key we only ever keep the SHA-256 of: losing the edit link
// means losing edit rights, which is the trade for not asking anyone to make an account.

import { createHash, timingSafeEqual } from 'node:crypto';
import { PlatformError } from '../public/shared/errors.js';
import { newId, slugify } from '../public/shared/ids.js';
import { BUILTIN_GAMES, getKit } from '../public/shared/registry.js';
import { validate } from '../public/shared/schema.js';
import { getStore } from './store/index.js';
import { blurbFor } from './rooms.js';

/**
 * @typedef {import('../types/parlor.js').GameDefinition} GameDefinition
 * @typedef {import('../types/parlor.js').Kit} Kit
 */

/** Everything a game holds, as JSON. Generous for text, small enough to stay cheap. */
const MAX_BYTES = 200 * 1024;

/** Built-in modules never change while the process lives, so one import each is enough. */
/** @type {Map<string, GameDefinition | null>} */
const builtins = new Map();

/**
 * The catalog: built-in games only, with hidden ones left out.
 * @returns {Promise<GameDefinition[]>}
 */
export async function listGames() {
  const seen = new Set();
  /** @type {GameDefinition[]} */
  const out = [];
  for (const key of Object.keys(BUILTIN_GAMES)) {
    const game = await loadBuiltin(key);
    if (!game || game.hidden || seen.has(game.id)) continue;
    seen.add(game.id);
    out.push(summaryGame(game));
  }
  return out;
}

/**
 * A game by id or slug. Built-ins win, so a user game can never shadow one.
 * @param {string} idOrSlug
 * @returns {Promise<GameDefinition | null>}
 */
export async function getGame(idOrSlug) {
  const key = String(idOrSlug || '');
  if (!key) return null;
  const builtin = await loadBuiltin(key);
  if (builtin) return builtin;
  const store = await getStore();
  const row = await store.getGame(key);
  return row ? row.doc : null;
}

/**
 * Save a new game and hand back the key that lets its maker edit it later.
 * @param {Record<string, any>} def  what the creator sent
 * @param {{ owner?: string | null, ip?: string }} [who]
 * @returns {Promise<{ game: GameDefinition, editKey: string }>}
 */
export async function createGame(def, who = {}) {
  const store = await getStore();
  checkSize(def);
  const kit = requireKit(def.kitId);
  const now = Date.now();
  const id = newId();
  const slug = await freeSlug(store, def.title);
  const game = buildDefinition(def, kit, { id, slug, createdAt: now, updatedAt: now, version: 1 });
  const editKey = newId();
  await store.putGame({
    id,
    slug,
    owner: ownerOf(who),
    editKeyHash: sha256(editKey),
    v: 1,
    doc: game,
    createdAt: now,
    updatedAt: now,
  });
  return { game, editKey };
}

/**
 * Replace a user game's contents. The id, slug, owner and creation time stay put.
 * @param {string} id
 * @param {Record<string, any>} def
 * @param {string | null} editKey  from the X-Edit-Key header
 * @returns {Promise<GameDefinition>}
 */
export async function updateGame(id, def, editKey) {
  const store = await getStore();
  if (await loadBuiltin(String(id || ''))) {
    throw new PlatformError(403, 'builtin', 'Built-in games cannot be edited. Make a copy instead.');
  }
  const row = await store.getGame(String(id || ''));
  if (!row) throw new PlatformError(404, 'not_found', 'No game with that link.');
  if (!keyMatches(editKey, row.editKeyHash)) {
    throw new PlatformError(403, 'forbidden', 'That edit link is not valid for this game.');
  }
  const merged = { ...row.doc, ...def };
  checkSize(merged);
  const kit = requireKit(merged.kitId);
  const v = row.v + 1;
  const now = Date.now();
  const game = buildDefinition(merged, kit, {
    id: row.id,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: now,
    version: v,
  });
  await store.putGame({ ...row, v, doc: game, updatedAt: now });
  return game;
}

/**
 * The fields anyone may see. User games carry no owner or key in the document, but
 * this is the one place that decides that, so it stays true if that ever changes.
 *
 * It is an allowlist, so a field added to GameDefinition and not added here is dropped
 * on the way out without anyone noticing. `blurb` is listed for exactly that reason:
 * the client prefers it over the line it assembles from schema labels, and a blurb that
 * never arrives is invisible rather than wrong. `hidden` is left off on purpose.
 * @param {GameDefinition} game
 * @returns {GameDefinition}
 */
export function publicGame(game) {
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    description: game.description,
    emoji: game.emoji,
    kitId: game.kitId,
    config: game.config,
    content: game.content,
    theme: game.theme,
    ...(game.accent ? { accent: game.accent } : {}),
    ...(blurbOf(game) ? { blurb: blurbOf(game) } : {}),
    ...(game.builtin ? { builtin: true } : {}),
    ...(game.createdAt ? { createdAt: game.createdAt } : {}),
    ...(game.updatedAt ? { updatedAt: game.updatedAt } : {}),
    ...(game.version ? { version: game.version } : {}),
  };
}

/**
 * The game's settings sentence: stored on the game when it has one, otherwise asked of the kit
 * with the validated settings, so built-in games read the same way as rooms do.
 * @param {GameDefinition} game
 * @returns {string | undefined}
 */
function blurbOf(game) {
  if (typeof game.blurb === 'string' && game.blurb.trim()) return game.blurb.trim();
  const kit = getKit(game.kitId);
  if (!kit) return undefined;
  const config = validate(kit.config, game.config || {}).value;
  const content = validate(kit.content, game.content || {}, { config }).value;
  return blurbFor(kit, config, content);
}

/**
 * A catalog row: enough to draw a card in the lobby, without the settings and content.
 * @param {GameDefinition} game
 * @returns {GameDefinition}
 */
export function summaryGame(game) {
  const { config, content, ...rest } = publicGame(game);
  return /** @type {GameDefinition} */ (/** @type {unknown} */ (rest));
}

/** @param {string} key an id or a slug registered in BUILTIN_GAMES */
async function loadBuiltin(key) {
  if (builtins.has(key)) return builtins.get(key) || null;
  const path = BUILTIN_GAMES[key];
  if (!path) return null;
  const module = await import(new URL(`../public/${path}`, import.meta.url).href);
  const game = /** @type {GameDefinition} */ (module.default);
  builtins.set(key, game);
  return game;
}

/** @returns {Kit} */
function requireKit(kitId) {
  const kit = getKit(String(kitId || ''));
  if (!kit) throw new PlatformError(400, 'unknown_kit', 'That game is built on a kit this server does not have.');
  return kit;
}

/**
 * Check what the creator sent and return a clean definition. Anything the shape does
 * not name is dropped rather than stored.
 * @returns {GameDefinition}
 */
function buildDefinition(def, kit, fixed) {
  const title = String(def.title ?? '').trim();
  if (!title) throw new PlatformError(400, 'invalid', 'That game needs a title.');

  // Settings first, because a content field may only apply when a setting has a value
  // ($config.x in a field's `when`), and that is resolved from the config passed here.
  const raw = def.config && typeof def.config === 'object' ? def.config : {};
  const config = checkAgainst(kit.config, raw, raw);
  const content = checkAgainst(kit.content, def.content, config);

  /** @type {GameDefinition} */
  const game = {
    id: fixed.id,
    slug: fixed.slug,
    title: title.slice(0, 80),
    description: String(def.description ?? '').trim().slice(0, 200),
    emoji: firstEmoji(def.emoji),
    kitId: kit.id,
    config,
    content,
    theme: def.theme === 'editorial' ? 'editorial' : 'playful',
    ...(typeof def.accent === 'string' && def.accent ? { accent: def.accent.slice(0, 32) } : {}),
    createdAt: fixed.createdAt,
    updatedAt: fixed.updatedAt,
    version: fixed.version,
  };

  checkSize(game);
  return game;
}

/**
 * The cap is checked on what was sent as well as on what is about to be stored, so a
 * huge payload is refused even when validation would have thrown most of it away.
 */
function checkSize(value) {
  if (Buffer.byteLength(JSON.stringify(value) || '') > MAX_BYTES) {
    throw new PlatformError(413, 'too_large', 'That game is too big to save. Trim the content and try again.');
  }
}

/** Validate one half of a game against the kit's schema, using the shared schema DSL. */
function checkAgainst(schema, value, config) {
  const given = value && typeof value === 'object' ? value : {};
  const result = validate(schema || {}, given, { config });
  if (!result.ok) {
    const issue = result.issues && result.issues[0];
    const where = issue ? `${issue.path ? `${issue.path}: ` : ''}${issue.message}` : 'something is missing';
    throw new PlatformError(400, 'invalid', `That game is not ready to save. ${where}`);
  }
  return result.value;
}

/** A slug nobody is using yet: the title, plus a short suffix when it is taken. */
async function freeSlug(store, title) {
  const base = slugify(title);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = `${base}-${newId().slice(0, 4).toLowerCase()}`;
    if (BUILTIN_GAMES[slug]) continue;
    const taken = await store.getGame(slug);
    if (!taken) return slug;
  }
  return `${base}-${newId().toLowerCase()}`;
}

/** Games made without a sign-in are owned by the device that made them, or by its address. */
function ownerOf(who) {
  const owner = typeof who.owner === 'string' ? who.owner.trim().slice(0, 64) : '';
  if (owner) return owner;
  return `ip:${who.ip || 'unknown'}`;
}

function firstEmoji(value) {
  const text = String(value ?? '').trim();
  if (!text) return '🎲';
  return Array.from(text)[0];
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
