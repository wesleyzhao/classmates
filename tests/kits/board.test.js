// Tests for the board kit: the conformance suite plus scripted games on both layouts and all
// three answer styles, wedges and the final question, skipping quiet players, removals, and views.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kit from '../../public/kits/board/kit.js';
import { conformance } from '../lib/conformance.js';
import { simulate } from '../lib/sim.js';
import { KitError } from '../../public/shared/errors.js';

/** A small deck with two categories, enough cards for a full game, and choices on some cards. */
const deck = {
  id: 'demo', title: 'Demo', version: 1,
  categories: [{ id: 'animals', name: 'Animals' }, { id: 'places', name: 'Places' }],
  cards: [
    ...['Lion', 'Tiger', 'Bear', 'Wolf', 'Fox', 'Owl', 'Hare', 'Seal', 'Goat', 'Crab'].map((a, i) => ({ id: `a${i}`, prompt: `Which animal is number ${i + 1}?`, answer: a, category: 'animals' })),
    ...['Paris', 'Rome', 'Oslo', 'Lima', 'Cairo', 'Tokyo', 'Perth', 'Quito', 'Doha', 'Bern'].map((a, i) => ({ id: `p${i}`, prompt: `Which city is number ${i + 1}?`, answer: a, aliases: i === 0 ? ['Paree'] : [], category: 'places', choices: i % 2 ? [a, 'Nowhere', 'Anywhere', 'Somewhere'] : undefined })),
  ],
};
const decks = { demo: deck };
const six = ['geo', 'ent', 'hist', 'arts', 'sci', 'sport'].map((id, i) => ({ id, name: id, decks: ['demo'], filter: i % 2 ? 'places' : 'animals' }));
const wheelGame = (config = {}) => ({ config: { win: 'collect', wedgesToWin: 6, answerStyle: 'choices', relaxedFinish: true, ...config }, content: { layout: 'wheel', categories: six }, decks });
const trackGame = (config = {}) => ({ config: { win: 'reach', answerStyle: 'choices', relaxedFinish: true, ...config }, content: { layout: 'track', trackLength: 16, categories: [{ id: 'a', name: 'Animals', decks: ['demo'], filter: 'animals' }, { id: 'p', name: 'Places', decks: ['demo'], filter: 'places' }] }, decks });

conformance(kit, { file: import.meta.resolve('../../public/kits/board/kit.js'), game: trackGame({ answerStyle: 'typed', maxTurns: 40 }), players: ['p1', 'p2', 'p3'], secretValues: (sim) => (sim.state.turn?._answer && sim.state.turn.step === 'ask' ? [sim.state.turn._answer.answer] : []) });
conformance(kit, { file: import.meta.resolve('../../public/kits/board/kit.js'), game: trackGame({ answerStyle: 'open', maxTurns: 40 }), players: ['p1', 'p2'] });
conformance(kit, { file: import.meta.resolve('../../public/kits/board/kit.js'), game: wheelGame({ wedgesToWin: 1 }), players: ['p1', 'p2'] });

/** Play the active player's turn correctly (or wrongly) through to the result step. */
function playTurn(sim, { correct = true, pick = 0 } = {}) {
  const active = () => sim.state.turn.playerId;
  const step = () => sim.state.turn.step;
  let guard = 0;
  while (!['result', 'done'].includes(step()) && guard++ < 20) {
    const t = sim.state.turn;
    if (t.step === 'roll') sim.do(active(), 'roll');
    else if (t.step === 'move') sim.do(active(), 'move', { to: t.options[0].to });
    else if (t.step === 'pick') sim.do(active(), 'pick', { cat: pick });
    else if (t.step === 'final-pick') sim.do(sim.players.find((p) => p.id !== active()).id, 'pick', { cat: pick });
    else if (t.step === 'ask') {
      if (sim.config.answerStyle === 'choices') sim.do(active(), 'answer', { index: correct ? t._answer.correctIndex : (t._answer.correctIndex + 1) % t.card.choices.length });
      else sim.do(active(), 'submit', { text: correct ? t._answer.answer : 'no idea' });
    } else if (t.step === 'judge') sim.do(sim.players.find((p) => p.id !== active()).id, 'judge', { correct });
  }
  return sim;
}

test('a race on the track: correct answers keep the turn, wrong ones pass it, the finish needs one last question', () => {
  const sim = simulate(kit, trackGame(), ['ann', 'ben']);
  assert.equal(sim.state.turn.step, 'roll');
  const first = sim.state.turn.playerId;
  playTurn(sim, { correct: false });
  assert.equal(sim.state.turn.result.correct, false);
  const promised = sim.view(first).turn.nextId;
  assert.notEqual(promised, first, 'the view names the player who is up next');
  sim.do(first, 'continue');
  assert.notEqual(sim.state.turn.playerId, first, 'a miss passes the turn');
  assert.equal(sim.state.turn.playerId, promised, 'and it is the player the view promised');
  let guard = 0;
  while (sim.summary().phase !== 'over' && guard++ < 200) {
    playTurn(sim, { correct: true });
    if (sim.state.turn.step === 'result') sim.do(sim.state.turn.playerId, 'continue');
  }
  assert.equal(sim.summary().phase, 'over');
  assert.equal(sim.summary().winnerIds.length, 1);
  const winner = sim.summary().winnerIds[0];
  assert.equal(sim.state.pos[winner], 't15', 'the winner stands on the finish line');
  assert.ok(sim.log.some((e) => e.type === 'final'));
  assert.ok(sim.log.some((e) => e.type === 'won' && e.playerId === winner));
  assert.throws(() => sim.do(winner, 'roll'), (e) => e instanceof KitError && e.code === 'wrong_phase');
});

test('on the wheel, headquarters award wedges and the middle asks the final question', () => {
  const sim = simulate(kit, wheelGame({ wedgesToWin: 1 }), ['ann', 'ben']);
  let guard = 0;
  while (sim.summary().phase !== 'over' && guard++ < 400) {
    const t = sim.state.turn;
    if (t.step === 'roll') sim.do(t.playerId, 'roll');
    else if (t.step === 'move') {
      const hq = t.options.find((o) => o.type === 'hq' && !sim.state.wedges[t.playerId][o.cat]);
      const hub = t.options.find((o) => o.type === 'hub');
      sim.do(t.playerId, 'move', { to: (hub || hq || t.options[0]).to });
    } else if (t.step === 'pick') sim.do(t.playerId, 'pick', { cat: 0 });
    else if (t.step === 'final-pick') {
      assert.throws(() => sim.do(t.playerId, 'pick', { cat: 0 }), /other players/);
      sim.do(sim.players.find((p) => p.id !== t.playerId).id, 'pick', { cat: 2 });
    } else if (t.step === 'ask') sim.do(t.playerId, 'answer', { index: t._answer.correctIndex });
    else if (t.step === 'result') sim.do('ben', 'continue');
  }
  assert.equal(sim.summary().phase, 'over');
  const winner = sim.summary().winnerIds[0];
  assert.equal(sim.state.pos[winner], 'hub');
  assert.ok(sim.state.wedges[winner].filter(Boolean).length >= 1);
  assert.ok(sim.log.some((e) => e.type === 'wedge'));
  assert.ok(sim.log.some((e) => e.type === 'picked'));
});

test('open answers are marked by an opponent, and solo players mark their own', () => {
  const sim = simulate(kit, trackGame({ answerStyle: 'open' }), ['ann', 'ben']);
  const t0 = sim.state.turn;
  const active = t0.playerId;
  const other = active === 'ann' ? 'ben' : 'ann';
  sim.do(active, 'roll');
  if (sim.state.turn.step === 'move') sim.do(active, 'move', { to: sim.state.turn.options[0].to });
  assert.equal(sim.state.turn.step, 'ask');
  assert.equal(sim.view(other).turn.answer, sim.state.turn._answer.answer, 'opponents may peek');
  assert.equal(sim.view(active).turn.answer, null, 'the answering player may not');
  assert.equal(sim.view(null).turn.answer, null, 'spectators may not');
  assert.throws(() => sim.do(active, 'answer', { index: 0 }), /typed or spoken/);
  assert.throws(() => sim.do(active, 'judge', { correct: true }), /cannot do that right now/);
  sim.do(active, 'submit', { text: 'a guess' });
  assert.equal(sim.state.turn.step, 'judge');
  assert.deepEqual(sim.view(other).waitingOn, [other]);
  assert.ok(sim.view(other).actions.some((a) => a.type === 'judge'));
  assert.ok(!sim.view(active).actions.some((a) => a.type === 'judge'));
  assert.throws(() => sim.do(active, 'judge', { correct: true }), /other players/);
  sim.do(other, 'judge', { correct: true });
  assert.equal(sim.state.turn.result.correct, true);
  assert.equal(sim.state.turn.result.typed, 'a guess');
  const solo = simulate(kit, trackGame({ answerStyle: 'open' }), ['ann']);
  solo.do('ann', 'roll');
  if (solo.state.turn.step === 'move') solo.do('ann', 'move', { to: solo.state.turn.options[0].to });
  solo.do('ann', 'submit', { text: '' });
  assert.equal(solo.log.at(-1).type, 'passed');
  solo.do('ann', 'judge', { correct: false });
  assert.equal(solo.state.turn.result.correct, false);
});

test('typed answers are marked by the game, with aliases and typos allowed', () => {
  const sim = simulate(kit, trackGame({ answerStyle: 'typed' }), ['ann', 'ben']);
  const active = sim.state.turn.playerId;
  sim.do(active, 'roll');
  if (sim.state.turn.step === 'move') sim.do(active, 'move', { to: sim.state.turn.options[0].to });
  const answer = sim.state.turn._answer.answer;
  sim.do(active, 'submit', { text: answer.toUpperCase() + ' ' });
  assert.equal(sim.state.turn.result.correct, true);
  sim.do(active, 'continue');
  const again = sim.state.turn.playerId;
  assert.equal(again, active, 'a right answer keeps the turn');
  sim.do(again, 'roll');
  if (sim.state.turn.step === 'move') sim.do(again, 'move', { to: sim.state.turn.options[0].to });
  sim.do(again, 'submit', { text: 'definitely not it' });
  assert.equal(sim.state.turn.result.correct, false);
});

test('the host may skip a quiet player after half a minute; anyone else after ninety seconds', () => {
  const sim = simulate(kit, trackGame(), ['ann', 'ben', 'cat']);
  const active = sim.state.turn.playerId;
  const others = sim.players.map((p) => p.id).filter((id) => id !== active);
  const nonHost = others.find((id) => id !== sim.hostId) || others[0];
  if (sim.hostId !== active) {
    assert.throws(() => sim.do(sim.hostId, 'skip'), /moment/);
    sim.wait(31_000);
    sim.do(sim.hostId, 'skip');
    assert.notEqual(sim.state.turn.playerId, active);
    assert.ok(sim.log.some((e) => e.type === 'skipped'));
  } else {
    assert.throws(() => sim.do(nonHost, 'skip'), /moment/);
    sim.wait(91_000);
    assert.ok(sim.view(nonHost).actions.some((a) => a.type === 'skip'));
    sim.do(nonHost, 'skip');
    assert.notEqual(sim.state.turn.playerId, active);
  }
  assert.throws(() => sim.do(sim.state.turn.playerId, 'skip'), (e) => e instanceof KitError);
});

test('a removed player on their turn hands the turn on, and the turn limit ends the game', () => {
  const sim = simulate(kit, trackGame({ maxTurns: 20 }), ['ann', 'ben', 'cat']);
  const active = sim.state.turn.playerId;
  sim.remove(active);
  assert.notEqual(sim.state.turn.playerId, active);
  assert.ok(!(active in sim.state.pos));
  assert.equal(sim.summary().scores.length, 2);
  let guard = 0;
  while (sim.summary().phase !== 'over' && guard++ < 60) {
    playTurn(sim, { correct: false });
    if (sim.state.turn.step === 'result') sim.do(sim.state.turn.playerId, 'continue');
  }
  assert.equal(sim.summary().phase, 'over');
  assert.equal(sim.state.winnerId, null, 'nobody won outright');
  assert.ok(sim.summary().winnerIds.length >= 1, 'the leaders share the win');
});

test('views carry legal moves, hide the answer until the result, and offer the right actions', () => {
  const sim = simulate(kit, trackGame(), ['ann', 'ben']);
  const active = sim.state.turn.playerId;
  const other = active === 'ann' ? 'ben' : 'ann';
  assert.deepEqual(sim.view(active).actions.map((a) => a.type).filter((t) => t !== 'skip'), ['roll']);
  assert.deepEqual(sim.view(other).actions.filter((a) => a.type === 'roll'), []);
  assert.deepEqual(sim.view(active).waitingOn, [active]);
  sim.do(active, 'roll');
  const v = sim.view(active);
  assert.equal(v.turn.roll >= 1 && v.turn.roll <= 6, true);
  if (v.turn.step === 'move') {
    assert.ok(v.turn.options.length >= 1);
    assert.ok(v.turn.options.every((o) => o.path[0] === sim.state.pos[active]));
    sim.do(active, 'move', { to: v.turn.options[0].to });
  }
  const asking = sim.view(active);
  assert.equal(asking.turn.card.choices.length, 4);
  assert.equal(asking.turn.answer, null);
  assert.equal(asking.turn.correctIndex, null);
  assert.equal(JSON.stringify(asking).includes(sim.state.turn._answer.answer), asking.turn.card.choices.includes(sim.state.turn._answer.answer), 'the answer shows only as one of the choices');
  sim.do(active, 'answer', { index: sim.state.turn._answer.correctIndex });
  const done = sim.view(other);
  assert.equal(done.turn.result.correct, true);
  assert.equal(done.turn.answer, sim.state.turn._answer.answer);
  assert.equal(done.turn.nextId, active, 'a right answer keeps the turn');
  assert.ok(done.actions.some((a) => a.type === 'continue'));
});
