// identity.js is the only thing in the client that remembers anything between visits, so
// these tests cover the three ways it can go wrong: forgetting what it should keep, keeping
// what it should drop, and throwing when the browser refuses to store anything at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The smallest thing that behaves like Storage, including key(i), which recentRooms uses. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

const store = new MemoryStorage();
globalThis.localStorage = /** @type {any} */ (store);

const identity = await import('../../public/app/identity.js');

function fresh() {
  store.clear();
}

test('a device gets one identity and keeps it', () => {
  fresh();
  const first = identity.me();
  assert.equal(typeof first.id, 'string');
  assert.equal(first.id.length, 21);
  assert.equal(first.name, '', 'a name is asked for, never invented');
  assert.ok(identity.AVATARS.includes(first.avatar));
  assert.equal(identity.me().id, first.id, 'the id survives a second read');
});

test('there are sixteen avatars and no repeats', () => {
  assert.equal(identity.AVATARS.length, 16);
  assert.equal(new Set(identity.AVATARS).size, 16);
});

test('a name is trimmed, capped, and remembered', () => {
  fresh();
  const id = identity.me().id;
  assert.equal(identity.hasName(), false);
  const saved = identity.setMe({ name: '  Wesley  ' });
  assert.equal(saved.name, 'Wesley');
  assert.equal(saved.id, id, 'renaming keeps the id');
  assert.equal(identity.hasName(), true);
  assert.equal(identity.setMe({ name: 'W'.repeat(50) }).name.length, 24);
  assert.equal(identity.setMe({ avatar: '🐝' }).name, 'W'.repeat(24), 'changing one field leaves the other');
});

test('a room is saved, read back, and forgotten', () => {
  fresh();
  identity.saveRoom('mkrt', { playerId: 'p1', secret: 's1', gameTitle: 'Flags of Europe' });
  const room = identity.savedRoom('MKRT');
  assert.equal(room.code, 'MKRT', 'codes are stored upper case whatever case they arrive in');
  assert.equal(room.playerId, 'p1');
  assert.equal(room.secret, 's1');
  assert.equal(room.gameTitle, 'Flags of Europe');
  assert.ok(room.savedAt > 0);
  identity.forgetRoom('MKRT');
  assert.equal(identity.savedRoom('MKRT'), null);
});

test('a half-written room is not a seat', () => {
  fresh();
  localStorage.setItem('parlor:room:ABCD', JSON.stringify({ playerId: 'p1' }));
  assert.equal(identity.savedRoom('ABCD'), null);
  localStorage.setItem('parlor:room:EFGH', 'not json at all');
  assert.equal(identity.savedRoom('EFGH'), null);
});

test('recentRooms gives the newest three', () => {
  fresh();
  const codes = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE'];
  codes.forEach((code, i) => {
    identity.saveRoom(code, { playerId: `p${i}`, secret: `s${i}` });
    // saveRoom stamps Date.now(), so nudge the stored time to make the order unambiguous.
    const raw = JSON.parse(localStorage.getItem(`parlor:room:${code}`));
    raw.savedAt = 1000 + i;
    localStorage.setItem(`parlor:room:${code}`, JSON.stringify(raw));
  });
  const recent = identity.recentRooms();
  assert.equal(recent.length, 3);
  assert.deepEqual(recent.map((room) => room.code), ['EEEE', 'DDDD', 'CCCC']);
});

test('seen cards stay newest first, unique, and capped at 250', () => {
  fresh();
  assert.deepEqual(identity.recentCards(), []);
  identity.rememberCards(['a', 'b']);
  identity.rememberCards(['c']);
  assert.deepEqual(identity.recentCards(), ['c', 'a', 'b']);

  identity.rememberCards(['a']);
  assert.deepEqual(identity.recentCards(), ['a', 'c', 'b'], 'seeing a card again moves it to the front');

  identity.rememberCards(Array.from({ length: 300 }, (_, i) => `card${i}`));
  const cards = identity.recentCards();
  assert.equal(cards.length, 250);
  assert.equal(cards[0], 'card0');
  assert.ok(!cards.includes('b'), 'the oldest fall off the end');

  identity.rememberCards([]);
  assert.equal(identity.recentCards().length, 250, 'remembering nothing changes nothing');
});

test('sound is on until it is turned off, and the choice sticks', () => {
  fresh();
  assert.equal(identity.soundOn(), true);
  identity.setSoundOn(false);
  assert.equal(identity.soundOn(), false);
  identity.setSoundOn(true);
  assert.equal(identity.soundOn(), true);
});

test('a browser that refuses to store anything still plays', () => {
  const angry = {
    get length() { throw new Error('denied'); },
    key() { throw new Error('denied'); },
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  globalThis.localStorage = /** @type {any} */ (angry);
  try {
    const who = identity.me();
    assert.equal(typeof who.id, 'string');
    assert.ok(identity.AVATARS.includes(who.avatar));
    assert.deepEqual(identity.recentRooms(), []);
    assert.deepEqual(identity.recentCards(), []);
    assert.equal(identity.savedRoom('MKRT'), null);
    assert.equal(identity.soundOn(), true);
    identity.saveRoom('MKRT', { playerId: 'p', secret: 's' });
    identity.rememberCards(['a']);
    identity.setSoundOn(true);
  } finally {
    globalThis.localStorage = /** @type {any} */ (store);
  }
});
