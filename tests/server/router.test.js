// The API surface: what every endpoint answers, what it refuses, and what a player
// reads when something goes wrong. Rooms are delegated to a fake RoomService, because
// what belongs here is the wiring (codes, auth headers, cache headers, status codes)
// and not the room rules, which have their own tests.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { KitError, PlatformError } from '../../public/shared/errors.js';
import { createHandler } from '../../server/router.js';
import { getStore, resetStore } from '../../server/store/index.js';
import { call } from '../lib/http.js';

// Never reach for a real database from here, whatever the machine has in its environment.
process.env.STORE = 'memory';

/** A game the tally kit accepts, as a creator would send it. */
const NEW_GAME = {
  title: 'Tap Race',
  description: 'Who is quickest.',
  emoji: '⚡',
  kitId: 'tally',
  config: { target: 5, seconds: 20 },
  content: {},
  theme: 'playful',
};

/** A stand-in for RoomService that records what the router handed it. */
function fakeRooms(overrides = {}) {
  /** @type {any[][]} */
  const calls = [];
  return /** @type {any} */ (Object.assign({
    calls,
    async create(input) {
      calls.push(['create', input]);
      return { code: 'ABCD', v: 1, now: 10, playerId: 'p1', secret: 's1', room: { code: 'ABCD' } };
    },
    async join(code, input) {
      calls.push(['join', code, input]);
      return { v: 2, now: 10, playerId: 'p2', secret: 's2', room: { code } };
    },
    async version(code) {
      calls.push(['version', code]);
      return code === 'ABCD' ? { v: 3, now: 10 } : null;
    },
    async snapshot(code, auth) {
      calls.push(['snapshot', code, auth]);
      return { v: 3, now: 10, room: { code }, view: null, summary: null };
    },
    async act(code, auth, action) {
      calls.push(['act', code, auth, action]);
      return { v: 4, now: 10, room: { code }, view: null, summary: null };
    },
  }, overrides));
}

/** A fresh store and a fresh handler per test, so limits and games never leak sideways. */
async function setup(overrides = {}) {
  resetStore();
  const store = await getStore();
  const rooms = fakeRooms(overrides);
  return { store, rooms, handler: createHandler({ store, rooms }) };
}

describe('health', () => {
  test('says what this instance is running', async () => {
    const { handler } = await setup();
    const res = await call(handler, { url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.store, { name: 'memory', configured: true });
    assert.ok(res.json.kits.includes('tally'));
    assert.equal(res.json.node, process.version);
    assert.equal(typeof res.json.now, 'number');
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('is a GET', async () => {
    const { handler } = await setup();
    const res = await call(handler, { method: 'POST', url: '/api/health' });
    assert.equal(res.statusCode, 405);
    assert.equal(res.json.code, 'method_not_allowed');
    assert.equal(res.headers.allow, 'GET');
  });
});

describe('endpoints that are not there', () => {
  test('an unknown path is a 404', async () => {
    const { handler } = await setup();
    const res = await call(handler, { url: '/api/nothing/here' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json, { error: 'There is nothing at that address.', code: 'not_found' });
  });

  test('the bare api path is a 404 too', async () => {
    const { handler } = await setup();
    assert.equal((await call(handler, { url: '/api' })).statusCode, 404);
  });
});

describe('games', () => {
  test('the catalog leaves hidden games out', async () => {
    const { handler } = await setup();
    const res = await call(handler, { url: '/api/games' });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json.games));
    assert.equal(res.json.games.some((game) => game.id === 'tally'), false, 'tally is hidden');
  });

  test('a built-in game can still be fetched by slug', async () => {
    const { handler } = await setup();
    const res = await call(handler, { url: '/api/games/tally' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.game.id, 'tally');
    assert.equal(res.json.game.kitId, 'tally');
    assert.equal(res.json.game.builtin, true);
    assert.equal('hidden' in res.json.game, false, 'the hidden flag stays on the server');
  });

  test('a game nobody has made is a 404', async () => {
    const { handler } = await setup();
    const res = await call(handler, { url: '/api/games/no-such-game' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json.code, 'not_found');
  });

  test('a game can be made, read back, and edited with its key', async () => {
    const { handler } = await setup();

    const made = await call(handler, { method: 'POST', url: '/api/games', body: NEW_GAME });
    assert.equal(made.statusCode, 201);
    assert.equal(typeof made.json.editKey, 'string');
    assert.equal(made.json.game.title, 'Tap Race');
    assert.ok(made.json.game.slug.startsWith('tap-race-'));
    assert.equal(made.json.game.version, 1);

    const fetched = await call(handler, { url: `/api/games/${made.json.game.slug}` });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json.game.id, made.json.game.id);

    const edited = await call(handler, {
      method: 'PUT',
      url: `/api/games/${made.json.game.id}`,
      headers: { 'X-Edit-Key': made.json.editKey },
      body: { ...NEW_GAME, title: 'Tap Race Two' },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json.game.title, 'Tap Race Two');
    assert.equal(edited.json.game.version, 2);
    assert.equal(edited.json.game.slug, made.json.game.slug, 'the link people shared still works');
  });

  test('editing without the right key is refused', async () => {
    const { handler } = await setup();
    const made = await call(handler, { method: 'POST', url: '/api/games', body: NEW_GAME });
    const id = made.json.game.id;

    const wrong = await call(handler, {
      method: 'PUT',
      url: `/api/games/${id}`,
      headers: { 'X-Edit-Key': 'not-the-key' },
      body: { title: 'Mine now' },
    });
    assert.equal(wrong.statusCode, 403);
    assert.deepEqual(wrong.json, { error: 'That edit link is not valid for this game.', code: 'forbidden' });

    const missing = await call(handler, { method: 'PUT', url: `/api/games/${id}`, body: { title: 'Mine now' } });
    assert.equal(missing.statusCode, 403);
  });

  test('a game without a title is refused in plain words', async () => {
    const { handler } = await setup();
    const res = await call(handler, { method: 'POST', url: '/api/games', body: { ...NEW_GAME, title: '  ' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json.error, 'That game needs a title.');
  });

  test('a game built on an unknown kit is refused', async () => {
    const { handler } = await setup();
    const res = await call(handler, { method: 'POST', url: '/api/games', body: { ...NEW_GAME, kitId: 'chess' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json.code, 'unknown_kit');
  });

  test('a game over the size cap is refused', async () => {
    const { handler } = await setup();
    const res = await call(handler, {
      method: 'POST',
      url: '/api/games',
      body: { ...NEW_GAME, content: { blurb: 'x'.repeat(210 * 1024) } },
    });
    assert.equal(res.statusCode, 413);
    assert.deepEqual(res.json, { error: 'That game is too big to save. Trim the content and try again.', code: 'too_large' });
  });

  test('the eleventh game from one address in an hour is refused', async () => {
    const { handler } = await setup();
    for (let i = 0; i < 10; i += 1) {
      const ok = await call(handler, { method: 'POST', url: '/api/games', body: NEW_GAME, ip: '198.51.100.2' });
      assert.equal(ok.statusCode, 201, `game ${i + 1} should have been saved`);
    }
    const res = await call(handler, { method: 'POST', url: '/api/games', body: NEW_GAME, ip: '198.51.100.2' });
    assert.equal(res.statusCode, 429);
    assert.deepEqual(res.json, { error: 'Slow down a little, then try again.', code: 'rate_limited' });

    const elsewhere = await call(handler, { method: 'POST', url: '/api/games', body: NEW_GAME, ip: '198.51.100.3' });
    assert.equal(elsewhere.statusCode, 201, 'another address is counted separately');
  });
});

describe('decks', () => {
  test('a deck can be made, read back, and edited with its key', async () => {
    const { handler } = await setup();
    const body = { title: 'Capitals', cards: [{ prompt: 'France', answer: 'Paris' }] };

    const made = await call(handler, { method: 'POST', url: '/api/decks', body });
    assert.equal(made.statusCode, 201);
    assert.equal(made.json.deck.cards.length, 1);
    assert.equal(typeof made.json.deck.cards[0].id, 'string');
    assert.equal(made.json.deck.version, 1);

    const fetched = await call(handler, { url: `/api/decks/${made.json.deck.id}` });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json.deck.title, 'Capitals');

    const edited = await call(handler, {
      method: 'PUT',
      url: `/api/decks/${made.json.deck.id}`,
      headers: { 'X-Edit-Key': made.json.editKey },
      body: { ...body, cards: [...body.cards, { prompt: 'Japan', answer: 'Tokyo' }] },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json.deck.cards.length, 2);
    assert.equal(edited.json.deck.version, 2);

    const wrong = await call(handler, {
      method: 'PUT',
      url: `/api/decks/${made.json.deck.id}`,
      headers: { 'X-Edit-Key': 'nope' },
      body,
    });
    assert.equal(wrong.statusCode, 403);
    assert.equal(wrong.json.error, 'That edit link is not valid for this deck.');
  });

  test('a deck with no cards is refused', async () => {
    const { handler } = await setup();
    const res = await call(handler, { method: 'POST', url: '/api/decks', body: { title: 'Empty', cards: [] } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json.error, 'That deck needs at least one card.');
  });

  test('a card missing its answer is refused, and says which card', async () => {
    const { handler } = await setup();
    const res = await call(handler, {
      method: 'POST',
      url: '/api/decks',
      body: { title: 'Half', cards: [{ prompt: 'France', answer: 'Paris' }, { prompt: 'Japan' }] },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json.error, 'Card 2 needs both a prompt and an answer.');
  });

  test('a deck nobody has made is a 404', async () => {
    const { handler } = await setup();
    assert.equal((await call(handler, { url: '/api/decks/nothing' })).statusCode, 404);
  });
});

describe('rooms', () => {
  test('a room is created through the rooms service', async () => {
    const { handler, rooms } = await setup();
    const res = await call(handler, {
      method: 'POST',
      url: '/api/rooms',
      body: { gameId: 'tally', name: 'Wes', avatar: '🦊', recent: ['c1'] },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json.code, 'ABCD');
    assert.deepEqual(rooms.calls[0], ['create', { gameId: 'tally', name: 'Wes', avatar: '🦊', recent: ['c1'] }]);
  });

  test('the version endpoint is cacheable for a second and normalizes the code', async () => {
    const { handler, rooms } = await setup();
    const res = await call(handler, { url: '/api/rooms/ab-cd/v' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json, { v: 3, now: 10 });
    assert.equal(res.headers['cache-control'], 'public, max-age=0, s-maxage=1');
    assert.deepEqual(rooms.calls[0], ['version', 'ABCD']);
  });

  test('a room that is gone is a 404 from the version endpoint', async () => {
    const { handler } = await setup();
    const res = await call(handler, { url: '/api/rooms/ZZZZ/v' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json, { error: 'No room with that code. Check the four letters you were given.', code: 'not_found' });
  });

  test('a snapshot carries the player auth headers and is never shared-cached', async () => {
    const { handler, rooms } = await setup();
    const res = await call(handler, {
      url: '/api/rooms/ABCD',
      headers: { 'X-Player-Id': 'p1', 'X-Player-Secret': 'shh' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.deepEqual(rooms.calls[0], ['snapshot', 'ABCD', { playerId: 'p1', secret: 'shh' }]);
  });

  test('a spectator with no headers reads as nobody', async () => {
    const { handler, rooms } = await setup();
    await call(handler, { url: '/api/rooms/ABCD' });
    assert.deepEqual(rooms.calls[0][2], { playerId: null, secret: null });
  });

  test('joining is a 201 and goes through the join limit', async () => {
    const { handler, rooms } = await setup();
    const res = await call(handler, {
      method: 'POST',
      url: '/api/rooms/ABCD/join',
      body: { name: 'Sam', avatar: '🐙', recent: [] },
    });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(rooms.calls[0], ['join', 'ABCD', { name: 'Sam', avatar: '🐙', recent: [] }]);
  });

  test('an action carries id, type and payload through', async () => {
    const { handler, rooms } = await setup();
    const res = await call(handler, {
      method: 'POST',
      url: '/api/rooms/ABCD/act',
      headers: { 'X-Player-Id': 'p1', 'X-Player-Secret': 'shh' },
      body: { id: 'a1', type: 'tap', payload: { n: 1 }, extra: 'ignored' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.deepEqual(rooms.calls[0], [
      'act',
      'ABCD',
      { playerId: 'p1', secret: 'shh' },
      { id: 'a1', type: 'tap', payload: { n: 1 } },
    ]);
  });

  test('a code that cannot be a code reads as no room', async () => {
    const { handler, rooms } = await setup();
    const res = await call(handler, { url: '/api/rooms/AB/v' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json, { error: 'No room with that code. Check the four letters you were given.', code: 'not_found' });
    assert.equal(rooms.calls.length, 0, 'the rooms service is never troubled with it');
  });

  test('the wrong method on a room endpoint is a 405', async () => {
    const { handler } = await setup();
    const res = await call(handler, { method: 'DELETE', url: '/api/rooms/ABCD' });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET');
  });
});

describe('errors on the way out', () => {
  test('a kit error reaches the player with its own words', async () => {
    const { handler } = await setup({
      async act() { throw new KitError('not_your_turn', 'It is not your turn yet.'); },
    });
    const res = await call(handler, { method: 'POST', url: '/api/rooms/ABCD/act', body: { id: 'a1', type: 'tap' } });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json, { error: 'It is not your turn yet.', code: 'not_your_turn' });
  });

  test('a platform error keeps its status', async () => {
    const { handler } = await setup({
      async snapshot() { throw new PlatformError(404, 'not_found', 'No room with that code.'); },
    });
    const res = await call(handler, { url: '/api/rooms/ABCD' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json, { error: 'No room with that code.', code: 'not_found' });
  });

  test('a bug is a 500 that leaks nothing', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { handler } = await setup({
      async snapshot() { throw new TypeError('cannot read properties of null (reading "players")'); },
    });
    const res = await call(handler, { url: '/api/rooms/ABCD' });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json, { error: 'Something went wrong on our side. Try again.', code: 'internal' });
    assert.equal(res.body.includes('players'), false);
    assert.equal(res.body.includes('at '), false, 'no stack trace');
  });

  test('a body that is not JSON is a 400', async () => {
    const { handler } = await setup();
    const res = await call(handler, { method: 'POST', url: '/api/rooms', body: 'not json at all' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json.code, 'bad_json');
  });
});
