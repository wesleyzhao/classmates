// The router is one pure function, which is the point: every address Parlor answers to can
// be checked here without a browser, a server, or a rendered screen. Room links are the ones
// people type and mistype, so they get the most cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute } from '../../public/app/main.js';

test('the home screen', () => {
  assert.deepEqual(matchRoute('/'), { name: 'home', params: {} });
  assert.deepEqual(matchRoute(''), { name: 'home', params: {} });
});

test('a game by slug', () => {
  assert.deepEqual(matchRoute('/g/flags-of-europe'), { name: 'game', params: { slug: 'flags-of-europe' } });
  assert.equal(matchRoute('/g').name, 'notFound', 'a game page needs a game');
  assert.equal(matchRoute('/g/a/b').name, 'notFound');
});

test('a room by code', () => {
  assert.deepEqual(matchRoute('/r/MKRT'), { name: 'room', params: { code: 'MKRT' } });
  assert.deepEqual(matchRoute('/r/mkrt'), { name: 'room', params: { code: 'mkrt' } },
    'case is kept here; the room screen decides what a code means');
});

test('the query string and the hash are not part of the address', () => {
  assert.deepEqual(matchRoute('/r/MKRT?from=chat'), { name: 'room', params: { code: 'MKRT' } });
  assert.deepEqual(matchRoute('/r/MKRT#top'), { name: 'room', params: { code: 'MKRT' } });
  assert.deepEqual(matchRoute('/?x=1#y'), { name: 'home', params: {} });
});

test('the screens that are not built yet', () => {
  assert.deepEqual(matchRoute('/create'), { name: 'create', params: {} });
  assert.deepEqual(matchRoute('/edit/abc123'), { name: 'edit', params: { id: 'abc123' } });
  assert.deepEqual(matchRoute('/decks/abc123'), { name: 'decks', params: { id: 'abc123' } });
  assert.deepEqual(matchRoute('/my'), { name: 'my', params: {} });
});

test('trailing slashes and repeated slashes do not make a new address', () => {
  assert.equal(matchRoute('/r/MKRT/').name, 'room');
  assert.equal(matchRoute('//r//MKRT//').name, 'room');
  assert.equal(matchRoute('/create/').name, 'create');
});

test('a fixed segment is matched whatever case it is typed in', () => {
  assert.equal(matchRoute('/G/flags').name, 'game');
  assert.equal(matchRoute('/My').name, 'my');
});

test('anything else is not found', () => {
  assert.equal(matchRoute('/nope').name, 'notFound');
  assert.equal(matchRoute('/r/MKRT/extra').name, 'notFound');
  assert.equal(matchRoute('/api/rooms').name, 'notFound');
  assert.deepEqual(matchRoute('/nope').params, {});
});

test('a path is decoded, and a broken encoding is left alone rather than thrown', () => {
  assert.deepEqual(matchRoute('/g/tea%20party'), { name: 'game', params: { slug: 'tea party' } });
  assert.deepEqual(matchRoute('/g/%E0%A4%A'), { name: 'game', params: { slug: '%E0%A4%A' } });
});

test('nothing at all is the home screen', () => {
  assert.equal(matchRoute(null).name, 'home');
  assert.equal(matchRoute(undefined).name, 'home');
});
