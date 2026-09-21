// The creator's pure half: the links it hands out, the lines its summary card reads, the
// parser behind "paste a list of cards", the draft it mirrors so a reload costs nothing, and
// the two deck checks that run in the browser. Everything a maker depends on that does not
// need a DOM is decided here rather than inside a screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The smallest thing that behaves like Storage. sessionStorage is loaded at import time. */
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
globalThis.sessionStorage = /** @type {any} */ (store);

const creator = await import('../../public/app/creator.js');
const audit = await import('../../public/shared/audit.js');
const { KITS } = await import('../../public/shared/registry.js');
const { defaults } = await import('../../public/shared/schema.js');

/** A draft on the quiz kit, with its settings and content at their defaults. */
function quizDraft(bits = {}) {
  return {
    ...creator.emptyDraft(),
    kitId: 'quiz',
    config: defaults(KITS.quiz.config),
    content: defaults(KITS.quiz.content),
    ...bits,
  };
}

// ---------------------------------------------------------------------------
// Pasting cards

test('a pasted line becomes a card, with the answer among its choices', () => {
  const card = creator.parseCardLine('Which city has the Colosseum? | Rome | Athens; Cairo; Lisbon');
  assert.deepEqual(card, {
    prompt: 'Which city has the Colosseum?',
    answer: 'Rome',
    // The answer goes first and the kit shuffles; a card whose choices leave out its own
    // answer has no right answer at all.
    choices: ['Rome', 'Athens', 'Cairo', 'Lisbon'],
  });
});

test('a line with only a question and an answer gets no choices', () => {
  assert.deepEqual(creator.parseCardLine('Who wrote Beloved | Toni Morrison'), {
    prompt: 'Who wrote Beloved',
    answer: 'Toni Morrison',
  });
});

test('a wrong answer that repeats the right one is not offered twice', () => {
  const card = creator.parseCardLine('Capital of Peru | Lima | Lima; Quito');
  assert.deepEqual(card.choices, ['Lima', 'Quito']);
});

test('a line that is not a card is skipped rather than guessed at', () => {
  assert.equal(creator.parseCardLine(''), null);
  assert.equal(creator.parseCardLine('   '), null);
  assert.equal(creator.parseCardLine('a question with no answer'), null);
  assert.equal(creator.parseCardLine('| just an answer'), null);
});

test('a pasted block reports what it could not use', () => {
  const { cards, skipped } = creator.parsePaste('One | 1\n\nnot a card\nTwo | 2 | 3; 4\n');
  assert.equal(cards.length, 2);
  assert.equal(skipped, 1);
  assert.deepEqual(cards[1].choices, ['2', '3', '4']);
});

// ---------------------------------------------------------------------------
// Links

test('the edit link carries the key, and survives an id that needs escaping', () => {
  assert.equal(creator.editPath('abc123', 'k-e-y'), '/edit/abc123?key=k-e-y');
  assert.equal(creator.editPath('abc123'), '/edit/abc123');
  assert.equal(creator.editPath('a b', 'x y'), '/edit/a%20b?key=x%20y');
});

test('a game and a deck each have one address', () => {
  assert.equal(creator.gamePath('flags-of-europe'), '/g/flags-of-europe');
  assert.equal(creator.deckPath('d1'), '/decks/d1');
  assert.equal(creator.deckPath(''), '/decks/new');
});

test('a link to share is the whole address with a sentence beside it', () => {
  const share = creator.gameShareText({ slug: 'my-quiz', title: 'My quiz', origin: 'https://parlor.test' });
  assert.equal(share.url, 'https://parlor.test/g/my-quiz');
  assert.equal(share.title, 'Parlor: My quiz');
  assert.match(share.text, /^Play My quiz on Parlor\./);
  assert.equal(creator.absolute('/my', 'https://parlor.test'), 'https://parlor.test/my');
});

// ---------------------------------------------------------------------------
// Steps

test('a kit with nothing to choose content for skips the second step', () => {
  assert.deepEqual(creator.stepList(KITS.quiz), ['kind', 'cards', 'look', 'publish']);
  assert.deepEqual(creator.stepList(KITS.cards), ['kind', 'look', 'publish']);
  // Before a kit is chosen the line shows all four, so it never grows under anyone.
  assert.deepEqual(creator.stepList(null), ['kind', 'cards', 'look', 'publish']);
});

test('the button at the bottom names the step it goes to', () => {
  const four = creator.stepList(KITS.quiz);
  assert.equal(creator.nextLabel(four, 0), 'Next, choose the cards');
  assert.equal(creator.nextLabel(four, 1), 'Next, settings and look');
  assert.equal(creator.nextLabel(four, 2), 'Next, publish it');
  assert.equal(creator.nextLabel(four, 3), 'Publish game');
  // The kit that skips the cards step never offers to go there.
  assert.equal(creator.nextLabel(creator.stepList(KITS.cards), 0), 'Next, settings and look');
});

test('a step is finished only when the kit would accept it', () => {
  const empty = quizDraft();
  assert.deepEqual(creator.stepIssues('kind', null, creator.emptyDraft()), [
    { path: 'kitId', message: 'Pick how this game plays.' },
  ]);
  assert.deepEqual(creator.stepIssues('cards', KITS.quiz, empty), [
    { path: 'decks', message: 'Choose at least 1 deck.' },
  ]);
  assert.equal(creator.stepIssues('look', KITS.quiz, empty)[0].path, 'title');

  const ready = quizDraft({ title: 'Capitals', content: { decks: ['capitals'], categories: [] } });
  assert.deepEqual(creator.stepIssues('cards', KITS.quiz, ready), []);
  assert.deepEqual(creator.stepIssues('look', KITS.quiz, ready), []);
});

// ---------------------------------------------------------------------------
// The summary card

test('decks are found wherever a kit keeps them', () => {
  assert.deepEqual(creator.deckIdsIn({ decks: ['capitals', 'trivia'] }), ['capitals', 'trivia']);
  // A board game keeps its decks inside its categories, one list per wedge.
  assert.deepEqual(creator.deckIdsIn({
    layout: 'wheel',
    categories: [{ id: 'geo', decks: ['trivia'] }, { id: 'art', decks: ['trivia', 'broadway'] }],
  }), ['trivia', 'broadway']);
  assert.deepEqual(creator.deckIdsIn({}), []);
});

test('the summary says what the game is, in the words the kit used', () => {
  const decks = /** @type {any} */ ({
    capitals: { id: 'capitals', title: 'Capitals', version: 1, cards: [{}, {}, {}] },
    trivia: { id: 'trivia', title: 'Trivia', version: 1, cards: [{}, {}] },
  });
  const draft = quizDraft({ title: 'Two decks', content: { decks: ['capitals', 'trivia'], categories: [] } });
  const rows = creator.summaryRows(draft, KITS.quiz, decks);
  assert.deepEqual(rows[0], { label: 'How it plays', value: 'Quiz' });
  assert.deepEqual(rows[1], { label: 'Decks', value: 'Capitals and Trivia, 5 cards in all' });
  assert.equal(rows[2].label, 'Settings');
  assert.deepEqual(rows[rows.length - 1], { label: 'Look', value: 'Editorial' });
});

test('a deck that has not loaded yet is named by its id rather than by nothing', () => {
  assert.equal(creator.deckNames(['capitals'], {}), 'capitals');
  assert.equal(creator.cardTotal(['capitals'], {}), 0);
});

test('a copy takes everything but the name', () => {
  const copy = creator.draftFromGame(
    { kitId: 'quiz', title: 'Capitals', description: 'Cities.', emoji: '\u{1F3EF}', theme: 'playful', config: { cards: 5 }, content: { decks: ['capitals'] } },
    { copy: true },
  );
  assert.equal(copy.title, 'Copy of Capitals');
  assert.equal(copy.theme, 'playful');
  assert.deepEqual(copy.content, { decks: ['capitals'] });
  assert.equal(creator.draftFromGame(null).kitId, '');
});

test('what is sent to the server is only what the server names', () => {
  const body = creator.gameBody(quizDraft({ title: '  Spaced  ', accent: '' }), 'device-1');
  assert.equal(body.title, 'Spaced');
  assert.equal(body.owner, 'device-1');
  assert.ok(!('accent' in body), 'an empty accent is left out rather than sent blank');
  assert.ok(!('id' in body) && !('slug' in body), 'the server owns the id and the slug');
});

// ---------------------------------------------------------------------------
// Decks

test('a category is named once and its id follows, taking its cards with it', () => {
  const cards = [
    { id: 'a', prompt: 'One', answer: '1', category: 'eu' },
    { id: 'b', prompt: 'Two', answer: '2', category: 'gone' },
  ];
  const synced = creator.syncCategories([{ id: 'eu', name: 'Europe' }], cards);
  assert.deepEqual(synced.categories, [{ id: 'europe', name: 'Europe' }]);
  assert.equal(synced.cards[0].category, 'europe', 'a renamed category keeps its cards');
  assert.ok(!('category' in synced.cards[1]), 'a category that is gone leaves its cards untagged');
});

test('two categories never share an id', () => {
  const synced = creator.syncCategories([{ name: 'Art' }, { name: 'Art' }], []);
  assert.notEqual(synced.categories[0].id, synced.categories[1].id);
});

test('a deck says what is missing before anyone presses the button', () => {
  assert.deepEqual(creator.deckIssues({ title: '', cards: [] }), [
    { path: 'title', message: 'That deck needs a title.' },
    { path: 'cards', message: 'A deck needs at least one card.' },
  ]);
  const half = creator.deckIssues({ title: 'Cats', cards: [{ prompt: 'Who', answer: '' }] });
  assert.deepEqual(half, [{ path: 'cards[0]', message: 'Card 1 needs both a question and an answer.' }]);
  assert.deepEqual(creator.deckIssues({ title: 'Cats', cards: [{ prompt: 'Who', answer: 'Me' }] }), []);
});

test('a card keeps its id and drops its empty fields on the way out', () => {
  const body = creator.deckBody({
    title: 'Cats',
    description: '',
    cards: [{ id: 'c1', prompt: ' Who ', answer: ' Me ', aliases: [], choices: ['Me', 'You'], emoji: '', category: 'x' }],
  });
  assert.deepEqual(body.cards[0], { id: 'c1', prompt: 'Who', answer: 'Me', choices: ['Me', 'You'], category: 'x' });
  assert.ok(!('description' in body));
  assert.ok(!('categories' in body));
});

test('a new card arrives with an id, because rows and the server both want one', () => {
  const card = creator.newCard({ prompt: 'Who' });
  assert.equal(typeof card.id, 'string');
  assert.ok(card.id.length > 8);
  assert.equal(card.answer, '');
  assert.notEqual(creator.newCard().id, creator.newCard().id);
});

// ---------------------------------------------------------------------------
// The checks the deck editor runs while somebody types

test('the browser finds the two faults that would fail the deck audit', () => {
  const hints = audit.cardHints([
    { prompt: 'What is the capital of France?', answer: 'Paris' },
    { prompt: 'What is the capital of France?', answer: 'Paris' },
    { prompt: 'Which country is Norway in Europe?', answer: 'Norway' },
  ]);
  assert.deepEqual(hints, [
    'Card 2 asks the same question as card 1.',
    'Card 3 contains its own answer, so nobody has to think.',
  ]);
});

test('the same question about two pictures is a flags deck, not a duplicate', () => {
  const cards = [
    { prompt: 'Which country is this?', answer: 'Norway', image: 'https://example.test/no.png' },
    { prompt: 'Which country is this?', answer: 'Sweden', image: 'https://example.test/se.png' },
  ];
  assert.deepEqual(audit.duplicatePrompts(cards), []);
  assert.deepEqual(audit.cardHints(cards), []);
});

test('an answer inside a longer word is not the question giving itself away', () => {
  assert.equal(audit.promptGivesAnswer('Who loved Juliet?', 'Romeo'), false);
  assert.equal(audit.promptGivesAnswer('Which city is Rome?', 'Rome'), true);
  assert.equal(audit.promptGivesAnswer('', 'Rome'), false);
});

// ---------------------------------------------------------------------------
// The draft mirror

test('a draft survives a reload, and a step goes with it', () => {
  store.clear();
  assert.equal(creator.loadDraft(), null);
  assert.equal(creator.loadStep(), '');

  const draft = quizDraft({ title: 'Halfway' });
  creator.saveDraft(draft);
  creator.saveStep('look');
  assert.equal(creator.loadDraft().title, 'Halfway');
  assert.equal(creator.loadDraft().kitId, 'quiz');
  assert.equal(creator.loadStep(), 'look');

  creator.clearDraft();
  assert.equal(creator.loadDraft(), null);
  assert.equal(creator.loadStep(), '');
});

test('a draft saved by an older version of the screen reads as no draft', () => {
  store.clear();
  store.setItem(creator.DRAFT_KEY, 'not json');
  assert.equal(creator.loadDraft(), null);
  store.setItem(creator.DRAFT_KEY, JSON.stringify({ nothing: true }));
  assert.equal(creator.loadDraft(), null);
  store.setItem(creator.STEP_KEY, 'somewhere else');
  assert.equal(creator.loadStep(), '', 'a step that is not a step is no step');
});

test('a draft fills in anything the saved one was missing', () => {
  store.clear();
  store.setItem(creator.DRAFT_KEY, JSON.stringify({ kitId: 'quiz', title: 'Partial' }));
  const loaded = creator.loadDraft();
  assert.equal(loaded.title, 'Partial');
  assert.equal(loaded.theme, 'editorial');
  assert.deepEqual(loaded.config, {});
});

test('a browser that refuses to remember anything is not an error', () => {
  const real = globalThis.sessionStorage;
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new Error('storage is off'); },
  });
  assert.doesNotThrow(() => creator.saveDraft(quizDraft()));
  assert.equal(creator.loadDraft(), null);
  assert.equal(creator.loadStep(), '');
  assert.doesNotThrow(() => creator.clearDraft());
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: real });
});
