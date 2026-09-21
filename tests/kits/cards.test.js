// Tests for the cards kit (Crazy Eights): the conformance suite, then the rules of play, the house
// rules, hidden information, reshuffling, joining and leaving, and the views.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kit from '../../public/kits/cards/kit.js';
import { conformance } from '../lib/conformance.js';
import { simulate } from '../lib/sim.js';
import { KitError } from '../../public/shared/errors.js';
import { standardDeck, deal, draw, reshuffle, parseCard } from '../../public/kits/_lib/deck.js';
import { makeRng } from '../../public/kits/_lib/rng.js';

conformance(kit, {
  file: import.meta.resolve('../../public/kits/cards/kit.js'),
  players: ['p1', 'p2', 'p3'],
  secretValues: (sim) => [sim.state._draw.slice(0, 5)],
});

test('deck helpers build, deal, draw, and reshuffle', () => {
  const deck = standardDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck).size, 52);
  assert.deepEqual(parseCard('10H'), { rank: '10', suit: 'H' });
  const { hands, rest } = deal(deck, ['a', 'b'], 5);
  assert.equal(hands.a.length, 5);
  assert.equal(rest.length, 42);
  assert.equal(hands.a[1], deck[2], 'cards go round the table one at a time');
  const [taken, remaining] = draw(rest, 3);
  assert.equal(taken.length + remaining.length, 42);
  const shuffled = reshuffle([], ['AS', '2S', '3S'], makeRng('x', 0));
  assert.deepEqual(shuffled.discard, ['3S']);
  assert.deepEqual([...shuffled.draw].sort(), ['2S', 'AS']);
  assert.deepEqual(reshuffle(['KH'], ['AS'], makeRng('x', 0)), { draw: ['KH'], discard: ['AS'] });
});

function activeOf(sim) { return sim.state.turns.seats[sim.state.turns.i]; }

test('a play must match suit or rank, eights are wild and name a suit, and emptying your hand wins', () => {
  const sim = simulate(kit, { config: { handSize: 5 } }, ['ann', 'ben']);
  const me = activeOf(sim);
  const other = me === 'ann' ? 'ben' : 'ann';
  const v = sim.view(me);
  assert.equal(v.hand.length, 5);
  assert.equal(sim.view(other).hand.length, 5);
  assert.equal(sim.view(null).hand, null);
  assert.equal(v.handCounts[other], 5);
  assert.throws(() => sim.do(other, 'play', { card: sim.state._hands[other][0] }), (e) => e instanceof KitError && e.code === 'not_your_turn');
  const bad = sim.state._hands[me].find((c) => !v.playable.includes(c));
  if (bad) assert.throws(() => sim.do(me, 'play', { card: bad }), /does not match/);
  assert.throws(() => sim.do(me, 'play', { card: 'ZZ' }), /not in your hand/);
  // Give the active player a hand we control.
  sim.state = Object.freeze({ ...sim.state, _hands: { ...sim.state._hands, [me]: ['8C', '7D'] }, discard: ['9H'], suit: 'H' });
  assert.throws(() => sim.do(me, 'play', { card: '8C' }), /Name a suit/);
  sim.do(me, 'play', { card: '8C', suit: 'D' });
  assert.equal(sim.state.suit, 'D');
  assert.equal(sim.state.discard.at(-1), '8C');
  assert.equal(activeOf(sim), other);
  assert.equal(sim.log.at(-1).type, 'played');
  assert.equal(sim.log.at(-1).suit, 'D');
  sim.state = Object.freeze({ ...sim.state, _hands: { ...sim.state._hands, [other]: ['QD'] } });
  sim.do(other, 'play', { card: 'QD' });
  assert.equal(sim.summary().phase, 'over');
  assert.deepEqual(sim.summary().winnerIds, [other]);
  assert.throws(() => sim.do(me, 'draw'), /over/);
});

test('drawing once per turn, playing the drawn card, and passing', () => {
  const sim = simulate(kit, { config: { handSize: 3 } }, ['ann', 'ben']);
  const me = activeOf(sim);
  sim.state = Object.freeze({ ...sim.state, _hands: { ...sim.state._hands, [me]: ['2C'] }, discard: ['9H'], suit: 'H', _draw: ['9S', 'KD'] });
  assert.throws(() => sim.do(me, 'pass'), /Draw a card before passing/);
  sim.do(me, 'draw');
  assert.equal(sim.view(me).drew, '9S');
  assert.deepEqual(sim.view(me).playable, ['9S']);
  assert.throws(() => sim.do(me, 'draw'), /already drew/);
  assert.ok(sim.view(me).actions.some((a) => a.type === 'pass'));
  sim.do(me, 'play', { card: '9S' });
  assert.equal(activeOf(sim), me === 'ann' ? 'ben' : 'ann');
  const other = activeOf(sim);
  sim.state = Object.freeze({ ...sim.state, _hands: { ...sim.state._hands, [other]: ['2C'] }, _draw: ['3C'] });
  sim.do(other, 'draw');
  sim.do(other, 'pass');
  assert.equal(activeOf(sim), me);
  assert.equal(sim.state._hands[other].length, 2);
});

test('house rules: twos stack a draw, queens skip, aces reverse', () => {
  const sim = simulate(kit, { config: { handSize: 3, houseRules: ['twos', 'queens', 'aces'] } }, ['ann', 'ben', 'cat']);
  const seats = sim.state.turns.seats;
  const a = seats[0];
  const b = seats[1];
  const c = seats[2];
  sim.state = Object.freeze({ ...sim.state, _hands: { [a]: ['2H', 'QH', 'AH', '5H'], [b]: ['2S', '3H'], [c]: ['4H', '6H'] }, discard: ['9H'], suit: 'H', _draw: ['7C', '7D', '7S', '10C', '10D'] });
  sim.do(a, 'play', { card: '2H' });
  assert.equal(sim.state.pendingDraw, 2);
  assert.equal(activeOf(sim), b);
  assert.deepEqual(sim.view(b).playable, ['2S'], 'facing a draw, only a two can be played');
  assert.throws(() => sim.do(b, 'play', { card: '3H' }), /Draw 2 first/);
  sim.do(b, 'play', { card: '2S' });
  assert.equal(sim.state.pendingDraw, 4, 'twos stack');
  assert.equal(activeOf(sim), c);
  assert.deepEqual(sim.view(c).actions.map((x) => x.type).filter((x) => x !== 'skip'), ['draw']);
  sim.do(c, 'draw');
  assert.equal(sim.state._hands[c].length, 6, 'drew four');
  assert.equal(sim.state.pendingDraw, 0);
  assert.equal(activeOf(sim), a, 'and the turn moved on');
  sim.state = Object.freeze({ ...sim.state, turns: { ...sim.state.turns, i: 0 }, _hands: { ...sim.state._hands, [a]: ['QH', 'AH', '5H'] }, discard: ['9H'], suit: 'H' });
  sim.do(a, 'play', { card: 'QH' });
  assert.equal(activeOf(sim), c, 'a queen skips b');
  sim.state = Object.freeze({ ...sim.state, turns: { ...sim.state.turns, i: 0 }, _hands: { ...sim.state._hands, [a]: ['AH', '5H'] } });
  sim.do(a, 'play', { card: 'AH' });
  assert.equal(sim.state.turns.dir, -1);
  assert.equal(activeOf(sim), c, 'an ace reverses, so c is next after a');
});

test('the draw pile reshuffles from the discard pile when it runs out', () => {
  const sim = simulate(kit, { config: { handSize: 3 } }, ['ann', 'ben']);
  const me = activeOf(sim);
  sim.state = Object.freeze({ ...sim.state, _hands: { ...sim.state._hands, [me]: ['2C'] }, discard: ['3S', '4S', '9H'], suit: 'H', _draw: [] });
  sim.do(me, 'draw');
  assert.equal(sim.state.discard.length, 1);
  assert.equal(sim.state.discard[0], '9H');
  assert.equal(sim.state._hands[me].length, 2);
  assert.equal(sim.state._draw.length, 1);
});

test('a late joiner is dealt in; a removed player returns their cards; the last one standing wins', () => {
  const sim = simulate(kit, { config: { handSize: 4 } }, ['ann', 'ben', 'cat']);
  const before = sim.state._draw.length;
  sim.join('dan');
  assert.equal(sim.state._hands.dan.length, 4);
  assert.equal(sim.state._draw.length, before - 4);
  assert.ok(sim.state.turns.seats.includes('dan'));
  const active = activeOf(sim);
  sim.remove(active);
  assert.ok(!(active in sim.state._hands));
  assert.notEqual(activeOf(sim), active);
  assert.equal(sim.state._draw.length, before - 4 + 4);
  sim.remove(activeOf(sim));
  assert.equal(sim.summary().phase, 'playing');
  const [x, y] = Object.keys(sim.state._hands);
  sim.remove(x);
  assert.equal(sim.summary().phase, 'over');
  assert.deepEqual(sim.summary().winnerIds, [y]);
});

test('the host skips after half a minute, others after ninety seconds, and the turn limit ends the game', () => {
  const sim = simulate(kit, { config: { handSize: 3, maxTurns: 20 } }, ['ann', 'ben', 'cat']);
  const active = activeOf(sim);
  const nonHost = sim.players.map((p) => p.id).find((id) => id !== sim.hostId && id !== active);
  if (sim.hostId !== active) {
    assert.throws(() => sim.do(sim.hostId, 'skip'), /moment/);
    sim.wait(31_000);
    sim.do(sim.hostId, 'skip');
    assert.notEqual(activeOf(sim), active);
  } else {
    assert.throws(() => sim.do(nonHost, 'skip'), /moment/);
    sim.wait(91_000);
    sim.do(nonHost, 'skip');
    assert.notEqual(activeOf(sim), active);
  }
  let guard = 0;
  while (sim.summary().phase !== 'over' && guard++ < 40) { sim.wait(31_000); sim.do(sim.hostId, 'skip'); }
  assert.equal(sim.summary().phase, 'over');
  assert.ok(sim.summary().winnerIds.length >= 1);
});
