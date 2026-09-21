// The race kit's own rules, on top of the conformance suite. Cards are shuffled from a seed,
// so the scripted races below read the right choice out of the raw state rather than assuming
// one, which is also how they prove nothing leaks: the tests can see the answer because they
// hold the state, and the views never can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kit from '../../public/kits/race/kit.js';
import demo from '../../public/decks/demo.js';
import { conformance } from '../lib/conformance.js';
import { simulate } from '../lib/sim.js';

const file = import.meta.resolve('../../public/kits/race/kit.js');

/** Twelve cards with four choices each, so a race can run long enough to reach a finish line. */
const WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima'];
const radio = {
  id: 'radio',
  title: 'Spelling alphabet',
  version: 1,
  categories: [{ id: 'letters', name: 'Letters' }],
  cards: WORDS.map((word, i) => ({
    id: `radio-${i}`,
    prompt: `Over the radio, which word stands for the letter ${String.fromCharCode(65 + i)}?`,
    answer: word,
    choices: [word, WORDS[(i + 1) % WORDS.length], WORDS[(i + 2) % WORDS.length], WORDS[(i + 3) % WORDS.length]],
    category: 'letters',
  })),
};

/** A race over the spelling alphabet with the settings a test cares about. */
const race = (config) => ({
  config: { trackLength: 8, seconds: 20, answerMode: 'choices', boost: true, ...config },
  content: { decks: ['radio'] },
  decks: { radio },
});

const rightChoice = (sim) => sim.state.round._card.correctChoice;
const wrongChoice = (sim) => (rightChoice(sim) + 1) % sim.state.round.card.choices.length;
const posOf = (sim, playerId) => sim.state.pos[playerId];
/** An assert.throws matcher for one kit error code. */
const refuses = (want) => (/** @type {any} */ err) => err.code === want;

/** Answer one card for everyone named, in order, then let the reveal run out. */
function card(sim, answers) {
  const n = sim.state.round.n;
  for (const [playerId, how] of answers) {
    const value = how === 'right' ? rightChoice(sim) : wrongChoice(sim);
    sim.do(playerId, 'answer', { n, value });
    if (sim.state.phase !== 'card') break;
  }
  if (sim.state.phase === 'card') sim.wait(sim.state.round.endsAt - sim.now);
  if (sim.state.phase === 'reveal') sim.wait(4000);
  return sim;
}

conformance(kit, {
  file,
  game: { config: kit.demoConfig, content: kit.demoContent, decks: { demo } },
  players: ['p1', 'p2', 'p3'],
  // The cards still to come are nobody's business until they come up.
  secretValues: (sim) => sim.state._order.slice(sim.state.index + 1).map((ref) => ref.cardId),
});

conformance(kit, {
  file,
  game: { config: { trackLength: 8, seconds: 10, answerMode: 'text', boost: false }, content: { decks: ['demo'] }, decks: { demo } },
  players: ['p1', 'p2'],
  // Nobody in this script types the answer, so the answer itself must appear in no view.
  secretValues: (sim) => (sim.state.phase === 'card' && sim.state.round ? [sim.state.round._card.answer] : []),
  script: [
    ['p1', 'answer', { n: 1, value: 'not sure' }],
    ['p2', 'answer', { n: 1, value: 'no idea' }],
    ['@wait', 4100],
    ['p1', 'answer', { n: 2, value: 'a shot in the dark' }],
    ['@wait', 14_100],
    ['p1', 'answer', { n: 3, value: 'one more try' }],
    ['p2', 'answer', { n: 3, value: 'and another' }],
    ['@wait', 120_000],
  ],
});

test('race: the player who keeps getting it right reaches the finish and wins', () => {
  const sim = simulate(kit, race({ trackLength: 8, boost: true }), ['ann', 'ben']);
  for (let guard = 0; guard < 20 && sim.state.phase !== 'over'; guard++) {
    card(sim, [['ann', 'right'], ['ben', 'wrong']]);
  }
  assert.equal(sim.state.phase, 'over');
  assert.equal(posOf(sim, 'ann'), 8, 'four cards at two spaces each is the whole track');
  assert.equal(posOf(sim, 'ben'), 0);
  const summary = sim.summary();
  assert.equal(summary.phase, 'over');
  assert.deepEqual(summary.winnerIds, ['ann']);
  assert.equal(summary.label, 'Finished');
  assert.equal(summary.unit, 'labels');
  assert.deepEqual(summary.scores[0], { playerId: 'ann', score: 8, label: '8 of 8', finish: 'finished on space 8 of 8' });
  assert.equal(sim.state.wakeAt, null, 'a finished race has no clock running');
});

test('race: the fastest right answer moves two, and everyone else who had it moves one', () => {
  const sim = simulate(kit, race({ boost: true }), ['ann', 'ben', 'cat']);
  const n = sim.state.round.n;
  const pick = rightChoice(sim);
  const missed = wrongChoice(sim);
  sim.wait(1000).do('ann', 'answer', { n, value: pick });
  sim.wait(2000).do('ben', 'answer', { n, value: pick });
  sim.do('cat', 'answer', { n, value: missed });

  assert.equal(sim.state.phase, 'reveal', 'everyone answered, so the card turns over');
  assert.equal(posOf(sim, 'ann'), 2);
  assert.equal(posOf(sim, 'ben'), 1);
  assert.equal(posOf(sim, 'cat'), 0);
  const view = sim.view('cat');
  assert.equal(view.round.firstId, 'ann');
  assert.deepEqual(view.round.results.map((r) => [r.playerId, r.correct, r.spaces]), [['ann', true, 2], ['ben', true, 1], ['cat', false, 0]]);
  assert.equal(view.round.mine.correct, false);
  assert.equal(view.round.mine.spaces, 0);
});

test('race: with the boost off, being first is worth nothing extra', () => {
  const sim = simulate(kit, race({ boost: false }), ['ann', 'ben', 'cat']);
  const n = sim.state.round.n;
  const pick = rightChoice(sim);
  sim.wait(500).do('ann', 'answer', { n, value: pick });
  sim.wait(4000).do('ben', 'answer', { n, value: pick });
  sim.do('cat', 'answer', { n, value: wrongChoice(sim) });

  assert.equal(posOf(sim, 'ann'), 1);
  assert.equal(posOf(sim, 'ben'), 1);
  assert.equal(posOf(sim, 'cat'), 0);
  assert.equal(sim.view('ann').round.firstId, 'ann', 'the order is still known, it just buys nothing');
  assert.equal(sim.view('ann').boost, false);
});

test('race: a card nobody answers moves nobody, and the race carries on', () => {
  const sim = simulate(kit, race({ seconds: 20 }), ['ann', 'ben']);
  assert.deepEqual(sim.view('ann').waitingOn, ['ann', 'ben']);
  sim.wait(20_000);
  assert.equal(sim.state.phase, 'reveal');
  assert.deepEqual(sim.state.pos, { ann: 0, ben: 0 });
  assert.deepEqual(sim.view('ann').round.results, []);
  assert.equal(sim.view('ann').round.firstId, null);
  sim.wait(4000);
  assert.equal(sim.state.phase, 'card');
  assert.equal(sim.state.round.n, 2, 'the next card came up by itself');
  assert.equal(sim.summary().label, 'Card 2');
});

test('race: someone who joins mid card starts at the beginning and races from the next one', () => {
  const sim = simulate(kit, race({ seconds: 30 }), ['ann', 'ben']);
  sim.join('cat');
  assert.equal(posOf(sim, 'cat'), 0);
  assert.equal(sim.view('cat').round.canAnswer, false);
  assert.throws(() => sim.do('cat', 'answer', { n: 1, value: 0 }), refuses('wrong_phase'));
  assert.deepEqual(sim.view('ann').waitingOn, ['ann', 'ben'], 'nobody waits for the newcomer');

  sim.do('ann', 'answer', { n: 1, value: rightChoice(sim) });
  sim.do('ben', 'answer', { n: 1, value: wrongChoice(sim) });
  assert.equal(sim.state.phase, 'reveal', 'the newcomer does not hold the card up either');
  sim.wait(4000);
  assert.equal(sim.view('cat').round.canAnswer, true);
  sim.do('cat', 'answer', { n: 2, value: rightChoice(sim) });
  assert.ok(sim.state.round._answers.cat.correct);
});

test('race: a removed player leaves the track, and removing the last holdout turns the card over', () => {
  const sim = simulate(kit, race({ seconds: 60 }), ['ann', 'ben', 'cat']);
  sim.do('ann', 'answer', { n: 1, value: rightChoice(sim) });
  sim.do('ben', 'answer', { n: 1, value: wrongChoice(sim) });
  assert.equal(sim.state.phase, 'card', 'cat has not answered');
  sim.remove('cat');
  assert.equal(posOf(sim, 'cat'), undefined);
  assert.equal(sim.summary().scores.some((s) => s.playerId === 'cat'), false);
  assert.equal(sim.state.phase, 'reveal', 'with cat gone, everyone here has answered');
  assert.equal(posOf(sim, 'ann'), 2);
  assert.equal(sim.view('ann').pos.cat, undefined);
});

test('race: two players over the line together are split by who answered first', () => {
  const sim = simulate(kit, race({ trackLength: 8, boost: false, seconds: 30 }), ['ann', 'ben']);
  for (let guard = 0; guard < 7 && posOf(sim, 'ann') < 7; guard++) {
    card(sim, [['ann', 'right'], ['ben', 'right']]);
  }
  assert.equal(posOf(sim, 'ann'), 7);
  assert.equal(posOf(sim, 'ben'), 7);

  const n = sim.state.round.n;
  const pick = rightChoice(sim);
  sim.wait(1000).do('ann', 'answer', { n, value: pick });
  sim.wait(1500).do('ben', 'answer', { n, value: pick });

  assert.equal(sim.state.phase, 'over');
  assert.equal(posOf(sim, 'ann'), 8);
  assert.equal(posOf(sim, 'ben'), 8);
  assert.deepEqual(sim.summary().winnerIds, ['ann'], 'the faster answer takes the finish alone');
});

test('race: a dead heat at the finish is shared', () => {
  const sim = simulate(kit, race({ trackLength: 8, boost: false, seconds: 30 }), ['ann', 'ben']);
  for (let guard = 0; guard < 7 && posOf(sim, 'ann') < 7; guard++) {
    card(sim, [['ann', 'right'], ['ben', 'right']]);
  }
  const n = sim.state.round.n;
  const pick = rightChoice(sim);
  // Both answers land on the same millisecond, so nothing separates them.
  sim.do('ann', 'answer', { n, value: pick });
  sim.do('ben', 'answer', { n, value: pick });
  assert.equal(sim.state.phase, 'over');
  assert.deepEqual(sim.summary().winnerIds.sort(), ['ann', 'ben']);
});

test('race: when the cards run out the race stops and the leader wins', () => {
  const sim = simulate(kit, race({ trackLength: 40, boost: true, seconds: 20 }), ['ann', 'ben']);
  assert.equal(sim.state._order.length, 12, 'a short deck is all the race gets');
  for (let guard = 0; guard < 20 && sim.state.phase !== 'over'; guard++) {
    card(sim, [['ann', 'right'], ['ben', 'wrong']]);
  }
  assert.equal(sim.state.phase, 'over');
  assert.equal(posOf(sim, 'ann'), 24, 'twelve cards at two spaces each');
  assert.ok(posOf(sim, 'ann') < 40, 'nobody reached the finish');
  assert.deepEqual(sim.summary().winnerIds, ['ann']);
  assert.equal(sim.summary().scores[0].label, '24 of 40');
  assert.equal(sim.state.wakeAt, null);

  const nobody = simulate(kit, race({ trackLength: 40, seconds: 5 }), ['ann', 'ben']);
  nobody.wait(30 * 60 * 1000);
  assert.equal(nobody.summary().phase, 'over');
  assert.deepEqual(nobody.summary().winnerIds, [], 'nobody wins a race nobody ran');
});

test('race: the host can show the answer early, and only the host has the button', () => {
  const sim = simulate(kit, race({ seconds: 60 }), ['ann', 'ben']);
  assert.deepEqual(sim.view('ann').actions.map((a) => [a.type, a.kind, a.host]), [['skip', 'secondary', true]]);
  assert.throws(() => sim.do('ben', 'skip'), refuses('not_host'));
  sim.do('ann', 'skip');
  assert.equal(sim.state.phase, 'reveal');
  assert.deepEqual(sim.view('ann').actions, [], 'there is no button between cards');
  assert.throws(() => sim.do('ann', 'skip'), refuses('wrong_phase'));
  sim.wait(4000);
  assert.equal(sim.state.round.n, 2);
});

test('race: answering twice, answering late, and answering someone else’s card', () => {
  const sim = simulate(kit, race({ seconds: 10 }), ['ann', 'ben']);
  sim.do('ann', 'answer', { n: 1, value: 0 });
  assert.throws(() => sim.do('ann', 'answer', { n: 1, value: 1 }), refuses('already_done'));
  assert.throws(() => sim.do('ann', 'answer', { n: 2, value: 1 }), refuses('stale'));
  assert.throws(() => sim.do('ann', 'answer', { n: 1, value: 99 }), refuses('already_done'));
  sim.wait(10_000);
  assert.equal(sim.state.phase, 'reveal');
  assert.throws(() => sim.do('ben', 'answer', { n: 1, value: 1 }), refuses('wrong_phase'));
});

test('race: no view carries the answer or anyone else’s guess until the reveal', () => {
  const sim = simulate(kit, race({ answerMode: 'text', seconds: 30 }), ['ann', 'ben']);
  const answer = sim.state.round._card.answer;
  const views = () => ['ann', 'ben', null].map((who) => JSON.stringify(sim.view(who)));

  for (const text of views()) assert.ok(!text.includes(answer), 'the answer is not in a view before anyone answers');
  sim.do('ben', 'answer', { n: 1, value: 'Zulu' });
  for (const text of views()) assert.ok(!text.includes('Zulu') || JSON.parse(text).round.mine, 'what someone said is their own business');
  assert.equal(sim.view('ann').round.answeredIds.includes('ben'), true, 'who answered is public');
  assert.equal(sim.view('ann').round.results, undefined, 'what they answered is not');
  assert.deepEqual(sim.view('ann').pos, { ann: 0, ben: 0 }, 'the track only moves at the reveal');

  sim.do('ann', 'answer', { n: 1, value: answer });
  assert.equal(sim.state.phase, 'reveal');
  for (const text of views()) assert.ok(text.includes(answer), 'once it is over, everyone sees it');
  assert.equal(sim.view('ben').round.results.find((r) => r.playerId === 'ben').value, 'Zulu');
});

test('race: a card is copied into the room only when it comes up, and the room stays small', () => {
  const sim = simulate(kit, race({ trackLength: 40 }), ['ann']);
  const text = JSON.stringify(sim.state.round);
  for (const ref of sim.state._order.slice(1)) {
    assert.ok(!text.includes(ref.cardId), 'the cards still to come are not in the round');
  }
  assert.ok(JSON.stringify(sim.state).length < 8 * 1024, 'a room stays small');
});
