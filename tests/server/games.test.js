// The catalog: what a built-in game has to look like, and what leaves the server.
//
// Built-in games are module files nobody validates at runtime, so this is the gate.
// A built-in that is wrong in any of these ways does not throw; it produces a lobby
// that is quietly missing something, which is the hardest kind of thing to notice.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_GAMES, KITS } from '../../public/shared/registry.js';
import { listGames, publicGame, summaryGame } from '../../server/games.js';
import { defaults, validate } from '../../public/shared/schema.js';

// The same length settingsLine() in public/app/lib.js accepts. A blurb longer than this
// is silently replaced there by the line it assembles from schema labels, so a built-in
// must never ship one: it would look fine in review and never reach a player.
const BLURB_MAX = 120;

describe('built-in games', () => {
  for (const [key, path] of Object.entries(BUILTIN_GAMES)) {
    test(`${key} is a game the platform can actually open a room with`, async () => {
      const module = await import(new URL(`../../public/${path}`, import.meta.url).href);
      const game = module.default;
      const where = `public/${path}`;

      assert.ok(game && typeof game === 'object', `${where} has no default export`);
      assert.equal(typeof game.id, 'string');
      assert.ok(game.id, `${where} needs an id`);
      assert.equal(typeof game.slug, 'string');
      assert.ok(game.slug, `${where} needs a slug`);
      // getGame() looks built-ins up by the registry key alone, so a key that is neither
      // the id nor the slug makes the game unreachable by one of its own names.
      assert.ok(key === game.id || key === game.slug, `${where} is registered as "${key}", which is neither its id nor its slug`);

      assert.ok(game.title, `${where} needs a title`);
      assert.equal(typeof game.description, 'string');
      assert.ok(game.emoji, `${where} needs an emoji`);
      assert.ok(['editorial', 'playful'].includes(game.theme), `${where} has an unknown theme`);
      assert.equal(game.builtin, true, `${where} should say it is built in`);
      assert.ok(game.config && typeof game.config === 'object', `${where} needs a config object`);
      assert.ok(game.content && typeof game.content === 'object', `${where} needs a content object`);

      const kit = KITS[game.kitId];
      assert.ok(kit, `${where} is built on the kit "${game.kitId}", which is not in KITS`);

      // A built-in may leave settings out and lean on the kit's defaults, but what the
      // defaults leave behind still has to be complete, or setup() runs on undefined.
      const config = validate(kit.config, { ...defaults(kit.config), ...game.config });
      assert.ok(config.ok, `${where} settings do not fit the ${kit.id} kit: ${config.issues.map((i) => `${i.path} ${i.message}`).join(', ')}`);
      const content = validate(kit.content, { ...defaults(kit.content), ...game.content }, { config: config.value });
      assert.ok(content.ok, `${where} content does not fit the ${kit.id} kit: ${content.issues.map((i) => `${i.path} ${i.message}`).join(', ')}`);

      if (game.blurb !== undefined) {
        assert.equal(typeof game.blurb, 'string', `${where} has a blurb that is not a string`);
        assert.ok(game.blurb.trim(), `${where} has an empty blurb`);
        assert.ok(game.blurb.trim().length <= BLURB_MAX, `${where} has a blurb over ${BLURB_MAX} characters, which the client would silently drop`);
      }
    });
  }

  test('the catalog hides what is meant to be hidden', async () => {
    const games = await listGames();
    for (const game of games) {
      assert.equal(game.hidden, undefined, `${game.id} should not carry the hidden flag out`);
    }
    assert.equal(games.some((game) => game.id === 'tally'), false, 'tally is hidden');
  });
});

describe('what leaves the server', () => {
  /** @returns {any} a game with every optional field set, to see which ones survive. */
  const full = () => ({
    id: 'g1',
    slug: 'g1',
    title: 'Tap Race',
    description: 'Who is quickest.',
    emoji: '⚡',
    kitId: 'tally',
    config: { target: 5 },
    content: {},
    theme: 'playful',
    accent: '#ff0055',
    blurb: '  Five taps to win, twenty seconds.  ',
    hidden: true,
    builtin: true,
    version: 3,
  });

  test('a blurb survives the projection, trimmed', () => {
    // publicGame is an allowlist, so a field added to GameDefinition and not added there
    // is dropped on the way out with nothing looking broken: the client prefers a blurb
    // over the line it builds from schema labels, and would fall back forever.
    assert.equal(publicGame(full()).blurb, 'Five taps to win, twenty seconds.');
    assert.equal(summaryGame(full()).blurb, 'Five taps to win, twenty seconds.');
  });

  test('a blurb that is not one falls back to the kit\'s own sentence, or is left off when the kit has none', () => {
    for (const bad of ['   ', 42, undefined]) {
      const out = publicGame({ ...full(), blurb: bad });
      assert.equal(typeof out.blurb, 'string', 'the kit supplies the sentence');
      assert.match(out.blurb, /taps/);
    }
    assert.equal('blurb' in publicGame({ ...full(), kitId: 'no-such-kit', blurb: '   ' }), false);
  });

  test('the hidden flag never leaves', () => {
    assert.equal('hidden' in publicGame(full()), false);
    assert.equal('hidden' in summaryGame(full()), false);
  });

  test('the catalog row leaves settings and content behind', () => {
    const row = summaryGame(full());
    assert.equal('config' in row, false);
    assert.equal('content' in row, false);
    assert.equal(row.title, 'Tap Race');
    assert.equal(row.accent, '#ff0055');
  });
});
