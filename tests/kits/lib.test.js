// The pure helpers kits are built from: drawing cards, running a round, folding deadlines,
// and counting a ballot. They have no idea what a room is, so every case here is plain data
// in and plain data out, with a seeded rng standing in for chance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../../public/kits/_lib/rng.js';
import { pickCards, distractors, cardAt, cardsIn } from '../../public/kits/_lib/draw.js';
import { start, submit, hasAnswered, allIn, waitingOn, reveal, speedScore } from '../../public/kits/_lib/rounds.js';
import { fold, fired } from '../../public/kits/_lib/timers.js';
import { open, cast, tally, quorum, decide } from '../../public/kits/_lib/vote.js';

const rng = () => makeRng('lib-test', 0);

const flags = {
  id: 'flags',
  title: 'Flags',
  version: 1,
  cards: [
    { id: 'fr', prompt: 'Which country?', answer: 'France', category: 'europe' },
    { id: 'pt', prompt: 'Which country?', answer: 'Portugal', category: 'europe' },
    { id: 'es', prompt: 'Which country?', answer: 'Spain', category: 'europe' },
    { id: 'jp', prompt: 'Which country?', answer: 'Japan', category: 'asia' },
    { id: 'kr', prompt: 'Which country?', answer: 'South Korea', category: 'asia' },
  ],
};
const capitals = {
  id: 'capitals',
  title: 'Capitals',
  version: 1,
  cards: [{ id: 'lis', prompt: 'Which capital?', answer: 'Lisbon', category: 'europe' }],
};
const decks = { flags, capitals };

// ---------------------------------------------------------------------------
// draw.js

test('draw: picks the number asked for and never the same card twice', () => {
  const picked = pickCards(decks, { count: 4, rng: rng() });
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked.map((p) => p.cardId)).size, 4);
  for (const ref of picked) assert.ok(cardAt(decks, ref), `${ref.cardId} is a real card`);
});

test('draw: asking for more than there is gives everything once', () => {
  const picked = pickCards(decks, { count: 50, rng: rng() });
  assert.equal(picked.length, 6);
  assert.equal(new Set(picked.map((p) => p.cardId)).size, 6);
});

test('draw: categories narrow the pool', () => {
  const picked = pickCards(decks, { count: 10, categories: ['asia'], rng: rng() });
  assert.deepEqual(picked.map((p) => p.cardId).sort(), ['jp', 'kr']);
  assert.equal(pickCards(decks, { count: 3, categories: ['nowhere'], rng: rng() }).length, 0);
});

test('draw: cards the table saw recently come last, not never', () => {
  const recent = ['fr', 'pt', 'es', 'lis'];
  const two = pickCards(decks, { count: 2, recent, rng: rng() });
  assert.deepEqual(two.map((p) => p.cardId).sort(), ['jp', 'kr'], 'the fresh cards go first');
  const all = pickCards(decks, { count: 6, recent, rng: rng() });
  assert.deepEqual(all.slice(0, 2).map((p) => p.cardId).sort(), ['jp', 'kr']);
  assert.equal(all.length, 6, 'once the fresh cards run out the seen ones come back');
});

test('draw: the same seed picks the same cards', () => {
  assert.deepEqual(pickCards(decks, { count: 4, rng: rng() }), pickCards(decks, { count: 4, rng: rng() }));
  const other = pickCards(decks, { count: 4, rng: makeRng('another', 0) });
  assert.notDeepEqual(pickCards(decks, { count: 4, rng: rng() }), other);
});

test('draw: distractors come from the same category and never repeat the answer', () => {
  const card = flags.cards[1];
  const wrong = distractors(decks, card, 3, rng());
  assert.equal(wrong.length, 3);
  assert.equal(new Set(wrong).size, 3);
  assert.ok(!wrong.includes('Portugal'));
  assert.deepEqual(wrong.filter((w) => ['France', 'Spain', 'Lisbon'].includes(w)).length, 3, 'europe first');
});

test('draw: distractors fall back to other categories when the neighbourhood is small', () => {
  const card = { id: 'jp', prompt: 'Which country?', answer: 'Japan', category: 'asia' };
  const wrong = distractors(decks, card, 4, rng());
  assert.equal(wrong.length, 4);
  assert.equal(wrong[0], 'South Korea', 'the only other card in asia comes first');
  assert.ok(!wrong.includes('Japan'));
});

test('draw: cardsIn is stable and cardAt survives a missing card', () => {
  assert.deepEqual(cardsIn(decks).map((c) => c.cardId), ['lis', 'fr', 'pt', 'es', 'jp', 'kr']);
  assert.equal(cardAt(decks, { deckId: 'flags', cardId: 'nope' }), null);
  assert.equal(cardAt(decks, { deckId: 'gone', cardId: 'fr' }), null);
  assert.equal(cardAt(decks, null), null);
});

// ---------------------------------------------------------------------------
// rounds.js

test('rounds: a round starts empty and counts from one', () => {
  const round = start(null, { index: 0, cardRef: { deckId: 'flags', cardId: 'pt' }, seconds: 15, now: 1000 });
  assert.equal(round.n, 1);
  assert.equal(round.index, 0);
  assert.equal(round.startedAt, 1000);
  assert.equal(round.endsAt, 16000);
  assert.equal(round.revealedAt, null);
  assert.deepEqual(round.answeredIds, []);
  assert.deepEqual(round._answers, {});
});

test('rounds: the first answer wins unless the round allows changes', () => {
  let round = start(null, { index: 1, seconds: 10, now: 0 });
  round = submit(round, 'ann', 2, 1200);
  round = submit(round, 'ann', 3, 1800);
  assert.deepEqual(round._answers.ann, { value: 2, at: 1200 });
  assert.deepEqual(round.answeredIds, ['ann']);

  let open = start(null, { index: 1, seconds: 10, now: 0, allowChange: true });
  open = submit(open, 'ann', 2, 1200);
  open = submit(open, 'ann', 3, 1800);
  assert.deepEqual(open._answers.ann, { value: 3, at: 1800 });
  assert.deepEqual(open.answeredIds, ['ann'], 'changing your mind does not add you twice');
});

test('rounds: who is in, who is missing, and when everyone is done', () => {
  let round = start(null, { index: 0, seconds: 10, now: 0 });
  assert.equal(allIn(round, ['ann', 'ben']), false);
  assert.equal(allIn(round, []), false, 'an empty table is never all in');
  round = submit(round, 'ann', 'France', 500);
  assert.equal(hasAnswered(round, 'ann'), true);
  assert.equal(hasAnswered(round, 'ben'), false);
  assert.deepEqual(waitingOn(round, ['ann', 'ben']), ['ben']);
  round = submit(round, 'ben', 'Spain', 900);
  assert.equal(allIn(round, ['ann', 'ben']), true);
  assert.deepEqual(waitingOn(round, ['ann', 'ben']), []);
});

test('rounds: reveal is remembered once', () => {
  let round = start(null, { index: 0, seconds: 10, now: 0 });
  round = reveal(round, 4000);
  const again = reveal(round, 9000);
  assert.equal(round.revealedAt, 4000);
  assert.equal(again, round, 'a second reveal changes nothing');
});

test('rounds: speed scoring is bucketed, so a moment apart is the same score', () => {
  assert.equal(speedScore(0, 15000), 200);
  assert.equal(speedScore(15000, 15000), 100);
  assert.equal(speedScore(20000, 15000), 100, 'late is never worth less than being right');
  assert.equal(speedScore(-5, 15000), 200);
  assert.equal(speedScore(2000, 15000), speedScore(2249, 15000));
  assert.notEqual(speedScore(2000, 15000), speedScore(2500, 15000));
  assert.equal(speedScore(3000, 15000), 180);
  assert.equal(speedScore(9000, 15000), 140);
  assert.equal(speedScore(5000, 10000, { base: 0, bonus: 50 }), 25);
});

// ---------------------------------------------------------------------------
// timers.js

test('timers: the earliest deadline wins and nulls are ignored', () => {
  assert.equal(fold({ card: 500, reveal: null }), 500);
  assert.equal(fold({ card: 900, reveal: 400 }), 400);
  assert.equal(fold({ card: null, reveal: undefined }), null);
  assert.equal(fold({}), null);
});

test('timers: fired names what passed, soonest first', () => {
  const deadlines = { card: 1000, nudge: 400, reveal: null };
  assert.deepEqual(fired(deadlines, 399), []);
  assert.deepEqual(fired(deadlines, 400), ['nudge'], 'a deadline exactly now has fired');
  assert.deepEqual(fired(deadlines, 5000), ['nudge', 'card']);
});

// ---------------------------------------------------------------------------
// vote.js

test('vote: only the people on the ballot, only the choices on it', () => {
  let ballot = open(['ann', 'ben', 'ann'], ['yes', 'no']);
  assert.deepEqual(ballot.voters, ['ann', 'ben']);
  ballot = cast(ballot, 'cat', 'yes');
  assert.deepEqual(ballot.votes, {}, 'someone who is not on the ballot cannot vote');
  ballot = cast(ballot, 'ann', 'maybe');
  assert.deepEqual(ballot.votes, {}, 'a choice that is not on the ballot is not a vote');
  ballot = cast(ballot, 'ann', 'yes');
  ballot = cast(ballot, 'ann', 'no');
  assert.deepEqual(ballot.votes, { ann: 'no' }, 'people change their minds');
});

test('vote: the count, the quorum, and the decision', () => {
  let ballot = open(['ann', 'ben', 'cat'], ['yes', 'no']);
  assert.deepEqual(tally(ballot), { counts: { yes: 0, no: 0 }, cast: 0, leaders: [] });
  assert.equal(quorum(ballot, 0.5), false);
  assert.deepEqual(decide(ballot), { choice: null, reason: 'none' });

  ballot = cast(ballot, 'ann', 'yes');
  ballot = cast(ballot, 'ben', 'yes');
  assert.deepEqual(tally(ballot), { counts: { yes: 2, no: 0 }, cast: 2, leaders: ['yes'] });
  assert.equal(quorum(ballot, 0.5), true);
  assert.deepEqual(decide(ballot), { choice: 'yes', reason: 'votes' });
});

test('vote: a tie waits for the host, and the host can settle it', () => {
  let ballot = open(['ann', 'ben'], ['yes', 'no']);
  ballot = cast(ballot, 'ann', 'yes');
  ballot = cast(ballot, 'ben', 'no');
  assert.deepEqual(decide(ballot), { choice: null, reason: 'tie' });
  assert.deepEqual(decide(ballot, { hostChoice: 'no' }), { choice: 'no', reason: 'host' });
  assert.deepEqual(decide(ballot, { hostChoice: 'later' }), { choice: null, reason: 'tie' });
  assert.deepEqual(decide(open([], ['yes']), { hostChoice: 'yes' }), { choice: 'yes', reason: 'host' });
});
