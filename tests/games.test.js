// Every built-in game, checked the way the server would check one a person submitted: the
// kit exists, the settings and the content pass that kit's schema, and every deck it names
// is really there. A game file that drifts from its kit fails here rather than in a room.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGame, listGames } from '../server/games.js';
import { getDeck } from '../server/decks.js';
import { BUILTIN_GAMES, KITS, getKit } from '../public/shared/registry.js';
import { validate } from '../public/shared/schema.js';

const keys = Object.keys(BUILTIN_GAMES);

test('there are built-in games to check', () => {
  assert.ok(keys.length > 0, 'BUILTIN_GAMES is empty');
});

for (const key of keys) {
  test(`game ${key}: loads, validates, and its decks exist`, async () => {
    const game = await getGame(key);
    assert.ok(game, `server/games.js could not load ${key}`);
    assert.equal(game.builtin, true, 'a built-in game says so');
    assert.ok(game.id === key || game.slug === key, `${key} is registered under neither its id nor its slug`);
    assert.ok(game.title, 'a game needs a title');
    assert.ok(game.description, 'a game needs a description');
    assert.ok(game.emoji, 'a game needs an emoji');
    assert.ok(['editorial', 'playful'].includes(game.theme), `${key}: unknown theme ${game.theme}`);

    const kit = getKit(game.kitId);
    assert.ok(kit, `${key}: kit "${game.kitId}" is not in KITS (${Object.keys(KITS).join(', ')})`);

    const config = validate(kit.config, game.config);
    assert.deepEqual(config.issues, [], `${key}: settings do not fit the ${kit.id} kit`);

    const content = validate(kit.content, game.content, { config: config.value });
    assert.deepEqual(content.issues, [], `${key}: content does not fit the ${kit.id} kit`);

    for (const deckId of deckIdsOf(content.value)) {
      const deck = await getDeck(deckId);
      assert.ok(deck, `${key}: deck "${deckId}" does not exist`);
      assert.ok(deck.cards.length, `${key}: deck "${deckId}" has no cards`);
    }
  });
}

test('a game that filters categories names categories its decks have', async () => {
  for (const key of keys) {
    const game = await getGame(key);
    const wanted = categoryIdsOf(game.content);
    if (!wanted.length) continue;
    const available = new Set();
    for (const deckId of deckIdsOf(game.content)) {
      const deck = await getDeck(deckId);
      for (const category of deck?.categories || []) available.add(category.id);
    }
    for (const category of wanted) {
      assert.ok(available.has(category), `${key}: no deck has a category called "${category}"`);
    }
  }
});

test('a game that filters categories still has cards to draw', async () => {
  for (const key of keys) {
    const game = await getGame(key);
    const wanted = new Set(categoryIdsOf(game.content));
    if (!wanted.size) continue;
    let count = 0;
    for (const deckId of deckIdsOf(game.content)) {
      const deck = await getDeck(deckId);
      count += (deck?.cards || []).filter((card) => wanted.has(card.category)).length;
    }
    const needed = Number(game.config?.cards) || 3;
    assert.ok(count >= needed, `${key}: only ${count} cards match its categories, and it wants ${needed}`);
  }
});

test('the catalog lists the built-ins that are not hidden, each one only once', async () => {
  const listed = await listGames();
  const ids = listed.map((g) => g.id);
  assert.deepEqual(ids, [...new Set(ids)], 'the catalog repeats a game');
  for (const key of keys) {
    const game = await getGame(key);
    if (game.hidden) assert.ok(!ids.includes(game.id), `${game.id} is hidden but listed`);
    else assert.ok(ids.includes(game.id), `${game.id} is missing from the catalog`);
  }
});

test('a game answers to both its id and its slug', async () => {
  for (const [key, path] of Object.entries(BUILTIN_GAMES)) {
    assert.match(path, /^games\/[a-z0-9-]+\.js$/, `${key}: odd game path ${path}`);
    const game = await getGame(key);
    // A game may be registered twice, under its id and under a friendlier slug, and both
    // have to reach the same file or one of the two links quietly stops working.
    assert.equal(BUILTIN_GAMES[game.id], path, `${game.id}: its id does not reach ${path}`);
    assert.equal(BUILTIN_GAMES[game.slug], path, `${game.slug}: its slug does not reach ${path}`);
  }
});

/**
 * Every deck a game's content names, wherever it names them: a quiz game lists them at the
 * top, a board game lists them inside each category.
 * @param {unknown} content
 * @param {string[]} [out]
 * @returns {string[]}
 */
function deckIdsOf(content, out = []) {
  if (Array.isArray(content)) {
    for (const item of content) deckIdsOf(item, out);
    return out;
  }
  if (!content || typeof content !== 'object') return out;
  for (const [key, value] of Object.entries(content)) {
    if (key === 'decks' && Array.isArray(value)) out.push(...value.filter((v) => typeof v === 'string'));
    else deckIdsOf(value, out);
  }
  return [...new Set(out)];
}

/** Category ids a quiz-shaped game filters on. Kits that shape categories differently say so
 * with objects, and this leaves those to the kit's own tests.
 * @param {Record<string, any>} content
 * @returns {string[]}
 */
function categoryIdsOf(content) {
  const given = Array.isArray(content?.categories) ? content.categories : [];
  return given.filter((c) => typeof c === 'string');
}
