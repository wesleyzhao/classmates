// Tests for the template kit (Tally). The conformance suite covers the contract; the tests below
// cover Tally's own rules, and show the shape a kit's test file should take.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kit from '../../public/kits/_template/kit.js';
import { conformance } from '../lib/conformance.js';
import { simulate } from '../lib/sim.js';

conformance(kit, { file: import.meta.resolve('../../public/kits/_template/kit.js') });

test('tally: first to the target wins on the spot', () => {
  const sim = simulate(kit, { config: { target: 3, seconds: 30 } }, ['ann', 'ben']);
  sim.do('ann', 'tap').do('ben', 'tap').do('ann', 'tap');
  assert.equal(sim.summary().phase, 'playing');
  sim.do('ann', 'tap');
  assert.equal(sim.summary().phase, 'over');
  assert.deepEqual(sim.summary().winnerIds, ['ann']);
  assert.equal(sim.state.reason, 'target');
  assert.equal(sim.log.at(-1).type, 'won');
  assert.throws(() => sim.do('ben', 'tap'), /over/);
});

test('tally: when time runs out the most taps wins, ties go to the earlier seat', () => {
  const sim = simulate(kit, { config: { target: 50, seconds: 10 } }, ['ann', 'ben']);
  sim.do('ann', 'tap').do('ben', 'tap').do('ben', 'tap');
  sim.wait(9_999);
  assert.equal(sim.summary().phase, 'playing');
  sim.wait(1);
  assert.equal(sim.summary().phase, 'over');
  assert.deepEqual(sim.summary().winnerIds, ['ben']);
  assert.equal(sim.state.reason, 'time');
  assert.equal(sim.state.wakeAt, null);
  const tie = simulate(kit, { config: { target: 50, seconds: 10 } }, ['ann', 'ben']).do('ann', 'tap').do('ben', 'tap').wait(20_000);
  assert.deepEqual(tie.summary().winnerIds, ['ann']);
});

test('tally: a late joiner gets a seat and a count, a removed player disappears', () => {
  const sim = simulate(kit, { config: { target: 50, seconds: 60 } }, ['ann']);
  sim.join('cat');
  assert.equal(sim.view('cat').taps.cat, 0);
  sim.do('cat', 'tap');
  assert.equal(sim.view('ann').taps.cat, 1);
  sim.remove('cat');
  assert.equal(sim.view('ann').taps.cat, undefined);
});

test('tally: the view offers Tap only while playing and only to players', () => {
  const sim = simulate(kit, { config: { target: 3, seconds: 60 } }, ['ann', 'ben']);
  assert.deepEqual(sim.view('ann').actions.map((a) => a.type), ['tap']);
  assert.deepEqual(sim.view(null).actions, []);
  sim.do('ann', 'tap').do('ann', 'tap').do('ann', 'tap');
  assert.deepEqual(sim.view('ben').actions, []);
});
