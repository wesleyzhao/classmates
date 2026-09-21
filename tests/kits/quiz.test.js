// The quiz kit's own rules, on top of the conformance suite. The cards are shuffled from a
// seed, so the scripted games below read the card that is actually up out of the state
// rather than assuming one, which is also how they prove that nothing leaks: the tests can
// see the answer because they hold the raw state, and the views never can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kit from '../../public/kits/quiz/kit.js';
import demo from '../../public/decks/demo.js';
import { conformance } from '../lib/conformance.js';
import { simulate } from '../lib/sim.js';

const file = import.meta.resolve('../../public/kits/quiz/kit.js');

/** A game of the demo deck with the settings a test cares about. */
const game = (config, categories) => ({
  config: { cards: 3, seconds: 20, ...config },
  content: { decks: ['demo'], ...(categories ? { categories } : {}) },
  decks: { demo },
});

/** Only the colours card, so a test knows exactly which answer is coming. */
const colours = (config) => game(config, ['colours']);

const answerOf = (sim) => sim.state.round._card.answer;
const rightChoice = (sim) => sim.state.round._card.correctChoice;
const wrongChoice = (sim) => (rightChoice(sim) + 1) % sim.state.round.card.choices.length;
const scoreOf = (sim, playerId) => sim.summary().scores.find((s) => s.playerId === playerId).score;
/** An assert.throws matcher for one kit error code. */
const refuses = (want) => (/** @type {any} */ err) => err.code === want;

conformance(kit, {
  file,
  game: { config: kit.demoConfig, content: kit.demoContent, decks: { demo } },
  players: ['p1', 'p2', 'p3'],
  // The cards still to come are nobody's business until they come up.
  secretValues: (sim) => sim.state._order.slice(sim.state.index + 1).map((ref) => ref.cardId),
});

conformance(kit, {
  file,
  game: { config: { cards: 3, seconds: 10, answerMode: 'text' }, content: { decks: ['demo'] }, decks: { demo } },
  players: ['p1', 'p2'],
  // Nobody in this script types the answer, so the answer itself must appear in no view.
  secretValues: (sim) => (sim.state.phase === 'card' && sim.state.round ? [sim.state.round._card.answer] : []),
  script: [
    ['p1', 'answer', { n: 1, value: 'not sure' }],
    ['p2', 'answer', { n: 1, value: 'no idea' }],
    ['@wait', 5100],
    ['p1', 'answer', { n: 2, value: 'a shot in the dark' }],
    ['@wait', 16_000],
    ['p1', 'answer', { n: 3, value: 'one more try' }],
    ['p2', 'answer', { n: 3, value: 'and another' }],
    ['@wait', 6000],
  ],
});

test('quiz: answering sooner is worth more, and a quarter of a second apart is the same', () => {
  const sim = simulate(kit, game({ answerMode: 'choices' }), ['ann', 'ben']);
  const pick = rightChoice(sim);
  sim.wait(1000).do('ann', 'answer', { n: 1, value: pick });
  sim.wait(5000).do('ben', 'answer', { n: 1, value: pick });

  assert.equal(sim.state.phase, 'reveal', 'both answered, so the card turns over');
  assert.equal(scoreOf(sim, 'ann'), 195);
  assert.equal(scoreOf(sim, 'ben'), 170);
  assert.ok(scoreOf(sim, 'ann') > scoreOf(sim, 'ben'));

  const bucket = (ms) => {
    const s = simulate(kit, game({ answerMode: 'choices' }), ['ann', 'ben']);
    s.wait(ms).do('ann', 'answer', { n: 1, value: rightChoice(s) });
    s.do('ben', 'answer', { n: 1, value: wrongChoice(s) });
    return scoreOf(s, 'ann');
  };
  assert.equal(bucket(1000), bucket(1249), 'network jitter never decides a winner');
  assert.notEqual(bucket(1000), bucket(1250));
});

test('quiz: a streak is worth 25 a card after the first', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 20, autoAdvance: false }), ['ann', 'ben']);
  const play = () => {
    sim.do('ann', 'answer', { n: sim.state.round.n, value: rightChoice(sim) });
    sim.do('ben', 'answer', { n: sim.state.round.n, value: wrongChoice(sim) });
    if (sim.state.phase === 'reveal' && sim.state.index + 1 < sim.state._order.length) sim.do('ann', 'next');
  };
  play();
  assert.equal(scoreOf(sim, 'ann'), 200, 'the first one in a row is worth the card alone');
  play();
  assert.equal(scoreOf(sim, 'ann'), 425, 'the second adds 25');
  play();
  assert.equal(scoreOf(sim, 'ann'), 675, 'the third adds 50');
  assert.equal(scoreOf(sim, 'ben'), 0);
  assert.equal(sim.state.streaks.ben, 0);
});

test('quiz: typed answers are matched, not compared', () => {
  const sim = simulate(kit, colours({ answerMode: 'text' }), ['ann', 'ben']);
  assert.equal(answerOf(sim), 'Green');
  assert.equal(sim.view('ann').answerMode, 'text');
  sim.do('ann', 'answer', { n: 1, value: 'grean' });
  sim.do('ben', 'answer', { n: 1, value: 'blue' });

  assert.equal(sim.state.phase, 'reveal');
  assert.ok(scoreOf(sim, 'ann') > 0, 'a typo still counts');
  assert.equal(scoreOf(sim, 'ben'), 0);
  const results = sim.view('ann').round.results;
  assert.deepEqual(results.map((r) => [r.playerId, r.correct]), [['ann', true], ['ben', false]]);
  assert.equal(sim.view('ben').round.mine.correct, false);
  assert.equal(sim.view('ben').round.mine.value, 'blue');
});

test('quiz: each answer mode refuses the other kind of answer', () => {
  const typed = simulate(kit, colours({ answerMode: 'text' }), ['ann']);
  assert.throws(() => typed.do('ann', 'answer', { n: 1, value: 0 }), refuses('bad_answer'));

  const tapped = simulate(kit, game({ answerMode: 'choices' }), ['ann']);
  assert.throws(() => tapped.do('ann', 'answer', { n: 1, value: 'Green' }), refuses('bad_answer'));
  assert.throws(() => tapped.do('ann', 'answer', { n: 1, value: 99 }), refuses('bad_answer'));

  const either = simulate(kit, game({ answerMode: 'both' }), ['ann', 'ben']);
  assert.doesNotThrow(() => either.do('ann', 'answer', { n: 1, value: 0 }));
  assert.doesNotThrow(() => either.do('ben', 'answer', { n: 1, value: 'a typed guess' }));
});

test('quiz: answering twice, answering late, and answering someone else’s card', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 10 }), ['ann', 'ben']);
  sim.do('ann', 'answer', { n: 1, value: 0 });
  assert.throws(() => sim.do('ann', 'answer', { n: 1, value: 1 }), refuses('already_done'));
  assert.throws(() => sim.do('ann', 'answer', { n: 2, value: 1 }), refuses('stale'));

  sim.wait(10_000);
  assert.equal(sim.state.phase, 'reveal');
  assert.throws(() => sim.do('ben', 'answer', { n: 1, value: 1 }), refuses('wrong_phase'));
  sim.wait(5000);
  assert.equal(sim.state.phase, 'card');
  assert.equal(sim.state.round.n, 2, 'the next card came up by itself');
  assert.throws(() => sim.do('ben', 'answer', { n: 1, value: 1 }), refuses('stale'));
});

test('quiz: the card turns over as soon as everyone who is here has answered', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 60 }), ['ann', 'ben', 'cat']);
  sim.do('ann', 'answer', { n: 1, value: 0 });
  sim.do('ben', 'answer', { n: 1, value: 1 });
  assert.equal(sim.state.phase, 'card', 'cat has not answered');
  sim.do('cat', 'answer', { n: 1, value: 2 });
  assert.equal(sim.state.phase, 'reveal');
  assert.equal(sim.state.wakeAt, sim.now + 5000);

  const dropped = simulate(kit, game({ answerMode: 'choices', seconds: 60 }), ['ann', 'ben', 'cat']);
  dropped.do('ann', 'answer', { n: 1, value: 0 });
  dropped.leave('cat');
  assert.equal(dropped.state.phase, 'card');
  dropped.do('ben', 'answer', { n: 1, value: 1 });
  assert.equal(dropped.state.phase, 'reveal', 'a closed tab does not hold up the table');
});

test('quiz: with automatic advancing off, the reveal waits for the host', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 10, autoAdvance: false }), ['ann', 'ben']);
  sim.do('ann', 'answer', { n: 1, value: 0 }).do('ben', 'answer', { n: 1, value: 1 });
  assert.equal(sim.state.phase, 'reveal');
  assert.equal(sim.state.wakeAt, null);
  sim.wait(10 * 60 * 1000);
  assert.equal(sim.state.phase, 'reveal', 'it stays up until someone moves it on');
  assert.deepEqual(sim.view('ben').waitingOn, ['ann'], 'the table is waiting on the host');

  assert.throws(() => sim.do('ben', 'answer', { n: 2, value: 0 }), refuses('wrong_phase'));
  assert.throws(() => sim.do('ben', 'next'), refuses('not_host'));
  sim.do('ann', 'next');
  assert.equal(sim.state.phase, 'card');
  assert.equal(sim.state.round.n, 2);
});

test('quiz: the host can show the answer early, and only the host sees the buttons', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 60 }), ['ann', 'ben']);
  assert.deepEqual(sim.view('ann').actions.map((a) => a.type), ['skip']);
  assert.equal(sim.view('ann').actions[0].host, true);
  assert.throws(() => sim.do('ben', 'skip'), refuses('not_host'));
  sim.do('ann', 'skip');
  assert.equal(sim.state.phase, 'reveal');
  assert.deepEqual(sim.view('ann').actions.map((a) => a.label), ['Next card']);
  assert.throws(() => sim.do('ann', 'skip'), refuses('wrong_phase'));
});

test('quiz: someone who joins mid card plays from the next one', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 20 }), ['ann', 'ben']);
  sim.join('cat');
  assert.equal(sim.state.scores.cat, 0);
  assert.equal(sim.view('cat').round.canAnswer, false);
  assert.throws(() => sim.do('cat', 'answer', { n: 1, value: 0 }), refuses('wrong_phase'));
  assert.deepEqual(sim.view('ann').waitingOn, ['ann', 'ben'], 'nobody waits for the newcomer');

  sim.do('ann', 'answer', { n: 1, value: 0 }).do('ben', 'answer', { n: 1, value: 1 });
  assert.equal(sim.state.phase, 'reveal', 'the newcomer does not hold the card up either');
  sim.wait(5000);
  assert.equal(sim.view('cat').round.canAnswer, true);
  sim.do('cat', 'answer', { n: 2, value: rightChoice(sim) });
  assert.ok(sim.state.round._answers.cat.correct);
});

test('quiz: a removed player leaves the scoreboard', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 60 }), ['ann', 'ben', 'cat']);
  sim.do('ann', 'answer', { n: 1, value: 0 }).do('cat', 'answer', { n: 1, value: 1 });
  sim.remove('cat');
  assert.equal(sim.state.scores.cat, undefined);
  assert.equal(sim.summary().scores.some((s) => s.playerId === 'cat'), false);
  assert.equal(sim.view('ann').standings.some((row) => row.playerId === 'cat'), false);
  sim.do('ben', 'answer', { n: 1, value: 2 });
  assert.equal(sim.state.phase, 'reveal', 'removing the last holdout lets the card turn over');
});

test('quiz: two people on the same score both win', () => {
  const sim = simulate(kit, colours({ answerMode: 'choices' }), ['ann', 'ben']);
  const pick = rightChoice(sim);
  sim.do('ann', 'answer', { n: 1, value: pick }).do('ben', 'answer', { n: 1, value: pick });
  sim.wait(6000);
  assert.equal(sim.summary().phase, 'over');
  assert.equal(scoreOf(sim, 'ann'), scoreOf(sim, 'ben'));
  assert.deepEqual(sim.summary().winnerIds.sort(), ['ann', 'ben']);
  assert.equal(sim.summary().label, 'Finished');

  const nobody = simulate(kit, colours({ answerMode: 'choices' }), ['ann', 'ben']);
  nobody.do('ann', 'answer', { n: 1, value: wrongChoice(nobody) });
  nobody.wait(60_000);
  assert.deepEqual(nobody.summary().winnerIds, [], 'nobody wins a game nobody scored in');
});

test('quiz: no view carries the answer until the reveal', () => {
  const sim = simulate(kit, colours({ answerMode: 'text', seconds: 20 }), ['ann', 'ben']);
  const answer = answerOf(sim);
  const views = () => ['ann', 'ben', null].map((who) => JSON.stringify(sim.view(who)));

  for (const text of views()) assert.ok(!text.includes(answer), 'the answer is not in a view before anyone answers');
  sim.do('ben', 'answer', { n: 1, value: 'blue' });
  for (const text of views()) assert.ok(!text.includes(answer));
  assert.equal(sim.view('ann').round.answeredIds.includes('ben'), true, 'who answered is public');
  assert.equal(sim.view('ann').round.results, undefined, 'what they answered is not');
  assert.deepEqual(sim.log.filter((e) => e.type === 'answered'), [{ n: 3, t: sim.now, type: 'answered', playerId: 'ben' }]);
  assert.equal(sim.view('ann').scores.ben, 0, 'scores only move at the reveal');

  sim.do('ann', 'answer', { n: 1, value: answer });
  assert.equal(sim.state.phase, 'reveal');
  for (const text of views()) assert.ok(text.includes(answer), 'once it is over, everyone sees it');
});

test('quiz: a card is copied into the room only when it comes up', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 10 }), ['ann']);
  const first = sim.state.round.card.id;
  assert.equal(sim.state._order.length, 3);
  assert.equal(sim.state.round.card.prompt, demo.cards.find((c) => c.id === first).prompt);
  const text = JSON.stringify(sim.state.round);
  for (const ref of sim.state._order.slice(1)) {
    assert.ok(!text.includes(ref.cardId), 'the cards still to come are not in the round');
  }
  assert.ok(JSON.stringify(sim.state).length < 8 * 1024, 'a room stays small');
});

test('quiz: the progress line counts cards, and the game ends on the last one', () => {
  const sim = simulate(kit, game({ answerMode: 'choices', seconds: 10 }), ['ann']);
  assert.deepEqual(sim.view('ann').progress, { n: 1, total: 3 });
  assert.equal(sim.summary().label, 'Card 1 of 3');
  sim.wait(10_000);
  assert.equal(sim.state.phase, 'reveal', 'the card ran out of time');
  assert.equal(sim.view('ann').actions[0].label, 'Next card');
  sim.wait(5000);
  assert.deepEqual(sim.view('ann').progress, { n: 2, total: 3 });
  assert.equal(sim.summary().label, 'Card 2 of 3');
  sim.wait(15_000);
  assert.deepEqual(sim.view('ann').progress, { n: 3, total: 3 });
  sim.wait(10_000);
  assert.equal(sim.view('ann').actions[0].label, 'See the results', 'the last card says where it goes');
  sim.wait(5000);
  assert.equal(sim.state.phase, 'over');
  assert.equal(sim.state.wakeAt, null);
  assert.deepEqual(sim.view('ann').actions, []);
  assert.equal(sim.summary().phase, 'over');
});

test('quiz: a card with no choices of its own borrows them from the deck', () => {
  const sim = simulate(kit, game({ answerMode: 'choices' }, ['sky']), ['ann']);
  const choices = sim.state.round.card.choices;
  assert.equal(choices.length, 4);
  assert.equal(new Set(choices).size, 4);
  assert.ok(choices.includes(answerOf(sim)));
  assert.equal(choices[rightChoice(sim)], answerOf(sim));

  const own = simulate(kit, game({ answerMode: 'choices', choicesFrom: 'card' }, ['sky']), ['ann']);
  const round = own.state.round;
  assert.equal(round.mode, round.card.choices ? 'choices' : 'text', 'a card with none of its own is typed instead');
});

test('quiz: the right choice is always the answer, however the card spelled it', () => {
  const odd = {
    id: 'odd',
    title: 'Odd',
    version: 1,
    cards: [{
      id: 'odd-lisbon',
      prompt: 'Which city sits at the mouth of the Tagus?',
      answer: 'Lisbon',
      // A deck made in the browser can spell a choice differently from its answer.
      choices: ['lisbon ', 'Madrid', 'Rome', 'Paris'],
      category: 'europe',
    }],
  };
  const sim = simulate(kit, { config: { cards: 3, seconds: 20, answerMode: 'choices' }, content: { decks: ['odd'] }, decks: { odd } }, ['ann']);
  const round = sim.state.round;
  assert.equal(round.card.choices.length, 4);
  assert.equal(round.card.choices[round._card.correctChoice], 'Lisbon');
  assert.equal(round.card.choices.filter((c) => c.trim().toLowerCase() === 'lisbon').length, 1, 'the answer is on the card once');
  sim.do('ann', 'answer', { n: 1, value: round._card.correctChoice });
  assert.ok(sim.state.round._answers.ann.correct);
});
