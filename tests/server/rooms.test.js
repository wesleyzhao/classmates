// Tests for the room core (server/rooms.js) against the memory store and the Tally kit:
// lifecycle, actions, timers, undo, hosts, chat, limits, de-duplication, redaction, and conflicts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomService, collectDeckIds } from '../../server/rooms.js';
import { createMemoryStore } from '../../server/store/memory.js';
import { PlatformError, KitError } from '../../public/shared/errors.js';
import tallyGame from '../../public/games/tally.js';

const START = 1_700_000_000_000;

function setup(opts = {}) {
  const store = createMemoryStore();
  let now = START;
  const clock = { now: () => now, advance: (ms) => { now += ms; } };
  const rooms = new RoomService({
    store,
    loadGame: async (id) => (id === 'tally' ? { ...tallyGame, config: opts.config || { target: 3, seconds: 30 } } : null),
    loadDecks: async () => ({}),
    now: clock.now,
    strict: opts.strict,
  });
  return { store, rooms, clock };
}

async function table(opts) {
  const t = setup(opts);
  const host = await t.rooms.create({ gameId: 'tally', name: 'Ann', avatar: '🦊' });
  const code = host.code;
  const guest = await t.rooms.join(code, { name: 'Ben', avatar: '🐙' });
  const auth = (p) => ({ playerId: p.playerId, secret: p.secret });
  return { ...t, code, host, guest, hostAuth: auth(host), guestAuth: auth(guest) };
}

let n = 0;
const act = (rooms, code, auth, type, payload) => rooms.act(code, auth, { id: `t${++n}`, type, payload });

test('create opens a lobby with the creator as host and a four-letter code', async () => {
  const { rooms, code, host } = await table();
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  assert.equal(host.room.phase, 'lobby');
  assert.equal(host.room.hostId, host.playerId);
  assert.equal(host.view, null);
  assert.equal(host.room.players[0].isHost, true);
  assert.equal((await rooms.version(code)).v >= 1, true);
  assert.equal(await rooms.version('ZZZZ'), null);
  await assert.rejects(rooms.create({ gameId: 'nope', name: 'x' }), (e) => e instanceof PlatformError && e.status === 404);
});

test('join adds a seat, auth is required for state, spectators still get a view', async () => {
  const { rooms, code, hostAuth, guest, guestAuth } = await table();
  assert.equal(guest.room.players.length, 2);
  assert.equal(guest.room.players[1].seat, 1);
  const snap = await rooms.snapshot(code, hostAuth);
  assert.equal(snap.room.players.length, 2);
  assert.ok(!('secrets' in snap.room));
  await assert.rejects(rooms.snapshot(code, { playerId: guestAuth.playerId, secret: 'wrong' }), (/** @type {any} */ e) => e.status === 403);
  const spectator = await rooms.snapshot(code, null);
  assert.equal(spectator.room.code, code);
  await assert.rejects(rooms.snapshot('QQQQ', hostAuth), (/** @type {any} */ e) => e.status === 404);
});

test('only the host starts; then players act and the view carries affordances', async () => {
  const { rooms, code, hostAuth, guestAuth } = await table();
  await assert.rejects(act(rooms, code, guestAuth, 'room/start'), (/** @type {any} */ e) => e.code === 'host_only');
  await assert.rejects(act(rooms, code, guestAuth, 'tap'), (e) => e instanceof KitError && e.code === 'wrong_phase');
  const started = await act(rooms, code, hostAuth, 'room/start');
  assert.equal(started.room.phase, 'playing');
  assert.deepEqual(started.view.actions.map((a) => a.type), ['tap']);
  assert.equal(started.summary.phase, 'playing');
  const tapped = await act(rooms, code, guestAuth, 'tap');
  assert.equal(tapped.view.taps[guestAuth.playerId], 1);
  assert.equal(tapped.view.mine, 1);
  assert.ok(tapped.room.log.some((e) => e.type === 'started'));
});

test('the same action id is applied once, and versions only move on change', async () => {
  const { rooms, code, hostAuth } = await table();
  await act(rooms, code, hostAuth, 'room/start');
  const before = (await rooms.version(code)).v;
  const a = await rooms.act(code, hostAuth, { id: 'same', type: 'tap' });
  const b = await rooms.act(code, hostAuth, { id: 'same', type: 'tap' });
  assert.equal(a.view.taps[hostAuth.playerId], 1);
  assert.equal(b.view.taps[hostAuth.playerId], 1);
  const after = (await rooms.version(code)).v;
  assert.equal(after, before + 1, 'the repeat must not write a new version');
  const same = await rooms.snapshot(code, hostAuth);
  assert.equal(same.v, after, 'a read with nothing due does not write');
});

test('deadlines fire lazily when the next request arrives, clamped to the deadline', async () => {
  const { rooms, code, hostAuth, guestAuth, clock } = await table({ config: { target: 50, seconds: 10 } });
  await act(rooms, code, hostAuth, 'room/start');
  await act(rooms, code, guestAuth, 'tap');
  clock.advance(9_000);
  let snap = await rooms.snapshot(code, hostAuth);
  assert.equal(snap.room.phase, 'playing');
  clock.advance(60_000);
  snap = await rooms.snapshot(code, hostAuth);
  assert.equal(snap.room.phase, 'over');
  assert.deepEqual(snap.summary.winnerIds, [guestAuth.playerId]);
  const won = snap.room.log.find((e) => e.type === 'won');
  assert.equal(won.t, START + 10_000, 'the tick ran at the deadline, not at request time');
  assert.ok(snap.room.log.some((e) => e.type === 'over'));
  await assert.rejects(act(rooms, code, hostAuth, 'tap'), (e) => e instanceof KitError);
  const again = await act(rooms, code, hostAuth, 'room/restart');
  assert.equal(again.room.phase, 'playing');
  assert.equal(again.room.games, 1);
});

test('undo restores the previous state and shifts the deadline by the elapsed time', async () => {
  const { rooms, code, hostAuth, guestAuth, clock } = await table({ config: { target: 3, seconds: 30 } });
  await act(rooms, code, hostAuth, 'room/start');
  const started = await rooms.snapshot(code, hostAuth);
  await act(rooms, code, guestAuth, 'tap');
  await act(rooms, code, guestAuth, 'tap');
  const third = await act(rooms, code, guestAuth, 'tap');
  assert.equal(third.room.phase, 'over');
  assert.equal(third.room.canUndo, true);
  await assert.rejects(act(rooms, code, guestAuth, 'room/undo'), (/** @type {any} */ e) => e.code === 'host_only');
  clock.advance(5_000);
  const undone = await act(rooms, code, hostAuth, 'room/undo');
  assert.equal(undone.room.phase, 'playing');
  assert.equal(undone.view.taps[guestAuth.playerId], 2);
  assert.equal(undone.view.wakeAt, started.view.wakeAt + 5_000);
  assert.ok(undone.room.log.some((e) => e.type === 'undo'));
});

test('kick removes a player and their access; leave hands the host role on', async () => {
  const { rooms, code, hostAuth, guestAuth } = await table();
  await assert.rejects(act(rooms, code, guestAuth, 'room/kick', { playerId: hostAuth.playerId }), (/** @type {any} */ e) => e.code === 'host_only');
  const third = await rooms.join(code, { name: 'Cat', avatar: '🐱' });
  const thirdAuth = { playerId: third.playerId, secret: third.secret };
  const kicked = await act(rooms, code, hostAuth, 'room/kick', { playerId: guestAuth.playerId });
  assert.equal(kicked.room.players.length, 2);
  await assert.rejects(rooms.snapshot(code, guestAuth), (/** @type {any} */ e) => e.status === 403);
  const left = await act(rooms, code, hostAuth, 'room/leave');
  assert.equal(left.room.hostId, thirdAuth.playerId);
  assert.ok(left.room.log.some((e) => e.type === 'host'));
  const view = await rooms.snapshot(code, thirdAuth);
  assert.equal(view.room.players.length, 1, 'leaving gives up the seat');
  assert.equal(view.room.players.find((p) => p.id === hostAuth.playerId), undefined);
  await assert.rejects(rooms.snapshot(code, hostAuth), (/** @type {any} */ e) => e.status === 403, 'the old seat is gone');
  const again = await rooms.join(code, { name: 'Ann', avatar: '🦊' });
  const after = await rooms.snapshot(code, { playerId: again.playerId, secret: again.secret });
  assert.equal(after.room.players.length, 2, 'a rejoin takes one fresh seat, not a second one');
});

test('a guest can take over when the host has gone away, but not while the host is present', async () => {
  const { rooms, code, hostAuth, guestAuth, clock } = await table({ config: { target: 50, seconds: 600 } });
  await act(rooms, code, hostAuth, 'room/start');
  let snap = await rooms.snapshot(code, guestAuth);
  assert.equal(snap.room.canTakeOver, false);
  await assert.rejects(act(rooms, code, guestAuth, 'room/takeover'), (/** @type {any} */ e) => e.code === 'host_present');
  await act(rooms, code, hostAuth, 'room/away');
  snap = await rooms.snapshot(code, guestAuth);
  assert.equal(snap.room.canTakeOver, false, 'a moment away is not an invitation');
  clock.advance(20 * 1000);
  snap = await rooms.snapshot(code, guestAuth);
  assert.equal(snap.room.canTakeOver, true, 'twenty seconds away is');
  const took = await act(rooms, code, guestAuth, 'room/takeover');
  assert.equal(took.room.hostId, guestAuth.playerId);
  const back = await act(rooms, code, hostAuth, 'room/hello');
  assert.equal(back.room.players.find((p) => p.id === hostAuth.playerId).connected, true);
  clock.advance(1);
});

test('chat is stored and capped, reactions go to the log, both are rate limited', async () => {
  const { rooms, code, hostAuth, guestAuth } = await table();
  await assert.rejects(act(rooms, code, hostAuth, 'chat/send', { text: '   ' }), (/** @type {any} */ e) => e.code === 'empty');
  const sent = await act(rooms, code, hostAuth, 'chat/send', { text: '  hello   there ' });
  assert.equal(sent.room.chat[0].text, 'hello there');
  assert.equal(sent.room.chat[0].playerId, hostAuth.playerId);
  const reacted = await act(rooms, code, guestAuth, 'chat/react', { emoji: '👏' });
  assert.ok(reacted.room.log.some((e) => e.type === 'react' && e.emoji === '👏'));
  for (let i = 0; i < 19; i++) await act(rooms, code, hostAuth, 'chat/send', { text: `m${i}` });
  await assert.rejects(act(rooms, code, hostAuth, 'chat/send', { text: 'one too many' }), (/** @type {any} */ e) => e.code === 'rate_limited');
  for (let i = 0; i < 100; i++) await act(rooms, code, guestAuth, 'chat/send', { text: `g${i}` }).catch(() => {});
  const snap = await rooms.snapshot(code, hostAuth);
  assert.ok(snap.room.chat.length <= 100);
});

test('per-player action limits stop a runaway client', async () => {
  const { rooms, code, hostAuth } = await table({ config: { target: 1000, seconds: 600 } });
  await act(rooms, code, hostAuth, 'room/start');
  let refused = null;
  for (let i = 0; i < 70; i++) {
    try { await act(rooms, code, hostAuth, 'tap'); } catch (e) { refused = e; break; }
  }
  assert.ok(refused && refused.code === 'rate_limited');
});

test('settings change in the lobby only, through the schema', async () => {
  const { rooms, code, hostAuth, guestAuth } = await table();
  await assert.rejects(act(rooms, code, guestAuth, 'room/settings', { config: { target: 5 } }), (/** @type {any} */ e) => e.code === 'host_only');
  await assert.rejects(act(rooms, code, hostAuth, 'room/settings', { config: { target: 9999 } }), (/** @type {any} */ e) => e.code === 'bad_settings');
  const changed = await act(rooms, code, hostAuth, 'room/settings', { config: { target: 5 } });
  assert.equal(changed.room.game.config.target, 5);
  assert.equal(changed.room.game.config.seconds, 30);
  await act(rooms, code, hostAuth, 'room/start');
  await assert.rejects(act(rooms, code, hostAuth, 'room/settings', { config: { target: 6 } }), (/** @type {any} */ e) => e.code === 'wrong_phase');
});

test('names and avatars are cleaned', async () => {
  const { rooms, code, hostAuth } = await table();
  const renamed = await act(rooms, code, hostAuth, 'room/rename', { name: '  <b>Annabel Leigh Sanderson</b>  ' });
  assert.equal(renamed.room.players[0].name, '<b>Annabel Leigh');
  const avatar = await act(rooms, code, hostAuth, 'room/avatar', { avatar: 'not an emoji' });
  assert.equal(avatar.room.players[0].avatar, '🙂');
});

test('a write conflict is retried and still lands', async () => {
  const { rooms, store, code, hostAuth } = await table();
  await act(rooms, code, hostAuth, 'room/start');
  const real = store.casRoom.bind(store);
  let failed = false;
  store.casRoom = async (c, expected, doc) => {
    if (!failed) { failed = true; return null; }
    return real(c, expected, doc);
  };
  const snap = await act(rooms, code, hostAuth, 'tap');
  assert.equal(snap.view.taps[hostAuth.playerId], 1);
  assert.equal(failed, true);
});

test('a view that leaks an underscore key is stripped, or throws in strict mode', async () => {
  const leaky = {
    ...(await import('../../public/kits/_template/kit.js')).default,
    id: 'tally',
    view(state, ctx) { return { phase: state.phase, actions: [], _hidden: 'x', nested: { _also: 1, ok: 2 } }; },
  };
  const { KITS } = await import('../../public/shared/registry.js');
  const original = KITS.tally;
  KITS.tally = leaky;
  try {
    const lenient = await table();
    await act(lenient.rooms, lenient.code, lenient.hostAuth, 'room/start');
    const snap = await lenient.rooms.snapshot(lenient.code, lenient.hostAuth);
    assert.deepEqual(snap.view, { phase: 'playing', actions: [], nested: { ok: 2 }, wakeAt: snap.view.wakeAt });
    const strict = await table({ strict: true });
    await assert.rejects(act(strict.rooms, strict.code, strict.hostAuth, 'room/start'), /leaked/);
  } finally {
    KITS.tally = original;
  }
});

test('deck ids are collected at the top level, inside objects, and inside lists of objects', () => {
  const schema = {
    decks: { type: 'decks' },
    extra: { type: 'object', fields: { decks: { type: 'decks' } } },
    categories: { type: 'list', of: { type: 'object', fields: { name: { type: 'text' }, decks: { type: 'decks' } } } },
    piles: { type: 'list', of: { type: 'decks' } },
  };
  const ids = collectDeckIds(schema, {
    decks: ['a', 'b'],
    extra: { decks: ['c', 'a'] },
    categories: [{ name: 'x', decks: ['d'] }, { name: 'y', decks: ['b', 'e'] }],
    piles: [['f'], ['a']],
  });
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(collectDeckIds(schema, {}), []);
});
