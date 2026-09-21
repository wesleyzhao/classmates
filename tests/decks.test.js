// Every built-in deck, through the audit. This is the test that keeps a bad card out of a
// game: a question that contains its own answer, a choice that is missing the answer, a
// category that does not exist, an image that is not https, a duplicate id.
//
// Warnings (a category stuck in one opening, an alias the matcher already accepts) are
// printed as diagnostics and do not fail. See scripts/audit-decks.js for why.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditDeck, loadBuiltinDecks } from '../scripts/audit-decks.js';
import { buildDecks as buildCountryDecks } from '../scripts/gen-countries.js';
import { renderDeck } from '../scripts/lib/deck-file.js';
import { getDeck } from '../server/decks.js';
import { BUILTIN_DECKS } from '../public/shared/registry.js';

const decks = await loadBuiltinDecks();
const ids = Object.keys(decks);

test('there are built-in decks to check', () => {
  assert.ok(ids.length > 0, 'BUILTIN_DECKS is empty');
});

for (const id of ids) {
  test(`deck ${id}: passes the audit`, (t) => {
    const deck = decks[id];
    const report = auditDeck(deck);
    for (const warning of report.warnings) t.diagnostic(`${id}: ${warning}`);
    assert.deepEqual(report.errors, [], `${id} has audit errors`);
  });

  test(`deck ${id}: is registered under its own id and loads from the server`, async () => {
    assert.equal(decks[id].id, id, 'the registry key and the deck id must agree');
    const loaded = await getDeck(id);
    assert.ok(loaded, `server/decks.js could not load ${id}`);
    assert.equal(loaded.cards.length, decks[id].cards.length);
  });
}

test('every registered deck path points at a deck', () => {
  for (const [id, path] of Object.entries(BUILTIN_DECKS)) {
    assert.match(path, /^decks\/[a-z0-9-]+\.js$/, `${id}: odd deck path ${path}`);
  }
});

test('countries and capitals match what scripts/gen-countries.js generates', async () => {
  // The two geography decks are generated and committed. If someone edits the deck file
  // instead of the table, the next run of the generator would silently undo their work.
  const built = buildCountryDecks();
  for (const [id, deck] of Object.entries(built)) {
    const committed = decks[id];
    assert.ok(committed, `${id} is generated but not registered`);
    assert.equal(
      renderDeck(deck, '//').split('const deck = {')[1],
      renderDeck(committed, '//').split('const deck = {')[1],
      `public/decks/${id}.js is out of date; run node scripts/gen-countries.js`,
    );
  }
});

test('the flags deck has a picture for every card and the capitals deck has none', () => {
  for (const card of decks.countries.cards) {
    assert.match(card.image, /^https:\/\/flagcdn\.com\/w320\/[a-z]{2}\.png$/, `${card.id}: odd image`);
  }
  for (const card of decks.capitals.cards) {
    assert.equal(card.image, undefined, `${card.id}: a capitals card needs no picture`);
  }
});

test('both geography decks cover the same countries', () => {
  const flags = decks.countries.cards.map((c) => c.id).sort();
  const capitals = decks.capitals.cards.map((c) => c.id.replace(/^cap-/, '')).sort();
  assert.deepEqual(capitals, flags);
});

test('card ids are unique across the geography decks, so recently seen lists do not collide', () => {
  const seen = new Set(decks.countries.cards.map((c) => c.id));
  for (const card of decks.capitals.cards) {
    assert.ok(!seen.has(card.id), `${card.id} is in both decks`);
  }
});

test('the trivia decks keep their source ids', () => {
  for (const deck of [decks.trivia, decks.broadway]) {
    for (const card of deck.cards) {
      assert.match(card.id, /^tp-[a-z]+-\d{3}$/, `${card.id}: not a stable imported id`);
      assert.equal(card.choices.length, 4, `${card.id}: a trivia card offers four answers`);
    }
  }
});
