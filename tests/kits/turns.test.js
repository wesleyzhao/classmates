// Tests for the turn-order helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { order, current, next, add, drop, roleFor, assignTeams } from '../../public/kits/_lib/turns.js';
import { makeRng } from '../../public/kits/_lib/rng.js';

test('turns go round the table, with skips and reversals', () => {
  let t = order(['ann', 'ben', 'cat']);
  assert.equal(current(t), 'ann');
  t = next(t);
  assert.equal(current(t), 'ben');
  t = next(t, { skip: 1 });
  assert.equal(current(t), 'ann');
  t = next(t, { reverse: true });
  assert.equal(current(t), 'cat');
  assert.equal(t.dir, -1);
  t = next(t);
  assert.equal(current(t), 'ben');
  assert.equal(current(order([])), null);
  assert.deepEqual(next(order([]), {}), order([]));
});

test('adding seats keeps the current player up; dropping hands the turn on', () => {
  let t = next(order(['ann', 'ben', 'cat']));
  t = add(t, 'dan');
  assert.equal(current(t), 'ben');
  assert.deepEqual(t.seats, ['ann', 'ben', 'cat', 'dan']);
  t = add(t, 'eve', { at: 0 });
  assert.equal(current(t), 'ben');
  assert.equal(add(t, 'ben'), t, 'a seated player is not seated twice');
  t = drop(t, 'ben');
  assert.equal(current(t), 'cat');
  t = drop(t, 'eve');
  assert.equal(current(t), 'cat');
  const last = drop(order(['solo']), 'solo');
  assert.equal(current(last), null);
  let r = next(next(order(['a', 'b', 'c']), { reverse: true }));
  assert.equal(current(r), 'b');
  r = drop(r, 'b');
  assert.equal(current(r), 'a', 'going backwards, dropping the current seat passes to the previous one');
});

test('roles rotate by round and teams come out balanced', () => {
  const t = order(['ann', 'ben', 'cat']);
  assert.equal(roleFor(t, 1), 'ann');
  assert.equal(roleFor(t, 2), 'ben');
  assert.equal(roleFor(t, 4), 'ann');
  assert.equal(roleFor(t, 1, 1), 'ben');
  const teams = assignTeams(['a', 'b', 'c', 'd', 'e'], 2, makeRng('teams', 0));
  assert.equal(teams.length, 2);
  assert.deepEqual([...teams[0], ...teams[1]].sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.ok(Math.abs(teams[0].length - teams[1].length) <= 1);
  assert.deepEqual(assignTeams(['a', 'b', 'c', 'd', 'e'], 2, makeRng('teams', 0)), teams, 'same seed, same teams');
});
