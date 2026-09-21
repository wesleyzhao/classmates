// Tests for the board layouts and movement: the wheel's shape, the track's shape, and the
// no-doubling-back reachability rule with and without the relaxed finish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachable } from '../../public/kits/board/graph.js';
import * as wheel from '../../public/kits/board/layouts/wheel.js';
import * as track from '../../public/kits/board/layouts/track.js';

test('the wheel has 42 ring spaces, 30 spoke spaces, a hub, and six headquarters', () => {
  const w = wheel.build();
  const all = Object.values(w.spaces);
  assert.equal(all.length, 42 + 30 + 1);
  assert.equal(all.filter((s) => s.type === 'hq').length, 6);
  assert.equal(all.filter((s) => s.type === 'again').length, 12);
  assert.equal(all.filter((s) => s.kind === 'ring' && s.type === 'cat').length, 24);
  for (let c = 0; c < 6; c++) assert.equal(w.spaces[wheel.hqOf(c)].cat, c);
  for (const s of all) for (const nb of w.adj[s.id]) assert.ok(w.adj[nb].includes(s.id), 'wheel links are symmetric');
  assert.equal(w.adj.hub.length, 6);
  assert.equal(wheel.build(), w, 'built once');
});

test('wheel moves never double back, branch at headquarters and the hub, and may stop at the hub when relaxed', () => {
  const w = wheel.build();
  const fromHub = reachable(w, 'hub', 6);
  assert.deepEqual(fromHub.map((o) => o.to).sort(), ['r0', 'r14', 'r21', 'r28', 'r35', 'r7'].sort(), 'six steps out of the hub reach every HQ');
  assert.deepEqual(reachable(w, 'hub', 5).map((o) => o.to), ['s0_1', 's1_1', 's2_1', 's3_1', 's4_1', 's5_1']);
  const back = reachable(w, 'r0', 2).map((o) => o.to);
  assert.ok(back.includes('r2') && back.includes('r40') && back.includes('s0_2'));
  assert.ok(!back.includes('r0'));
  const strict = reachable(w, 's0_4', 3).map((o) => o.to);
  assert.ok(!strict.includes('hub'), 'the hub needs an exact count by default');
  const relaxed = reachable(w, 's0_4', 3, { stopAtEnd: true }).map((o) => o.to);
  assert.ok(relaxed.includes('hub'));
  assert.equal(relaxed[0], 'hub', 'the hub is offered first');
  for (const o of fromHub) assert.equal(o.path[0], 'hub');
});

test('the track snakes through rows, moves one way, and lands on the finish when relaxed', () => {
  const t = track.build({ length: 20, categories: 3 });
  assert.equal(Object.keys(t.spaces).length, 20);
  assert.equal(t.spaces.t0.type, 'start');
  assert.equal(t.spaces.t19.type, 'finish');
  assert.equal(t.spaces.t7.type, 'again');
  assert.deepEqual(t.adj.t19, []);
  assert.ok(t.spaces.t1.x < t.spaces.t2.x, 'first row runs left to right');
  assert.ok(t.spaces.t6.x > t.spaces.t7.x, 'second row runs right to left');
  const cats = new Set(Object.values(t.spaces).filter((s) => s.type === 'cat').map((s) => s.cat));
  assert.deepEqual([...cats].sort(), [0, 1, 2]);
  assert.deepEqual(reachable(t, 't3', 4).map((o) => o.to), ['t7']);
  assert.deepEqual(reachable(t, 't17', 4), []);
  assert.deepEqual(reachable(t, 't17', 4, { stopAtEnd: true }).map((o) => o.to), ['t19']);
  assert.deepEqual(reachable(t, 't17', 2, { stopAtEnd: true }).map((o) => o.to), ['t19']);
  assert.equal(track.build({ length: 20, categories: 3 }), t, 'cached per size');
  assert.equal(Object.keys(track.build({ length: 5 }).spaces).length, 12, 'lengths are clamped');
});
