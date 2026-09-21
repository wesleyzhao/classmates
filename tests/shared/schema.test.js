// Tests for the schema language: defaults, validation, nesting, conditions, and messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, defaults, describe } from '../../public/shared/schema.js';

/** @type {import('../../types/parlor.js').Schema} */
const quizConfig = {
  seconds: { type: 'number', label: 'Seconds per card', min: 5, max: 90, default: 15 },
  answerMode: { type: 'choice', options: ['choices', 'text', 'both'], default: 'choices' },
  autoAdvance: { type: 'bool', default: true },
  accent: { type: 'color', required: false },
};

/** @type {import('../../types/parlor.js').Schema} */
const quizContent = {
  title: { type: 'text', maxLength: 40 },
  items: {
    type: 'list', min: 1, max: 3,
    of: { type: 'object', fields: {
      prompt: { type: 'text' },
      answer: { type: 'text' },
      choices: { type: 'list', of: { type: 'text' }, min: 2, when: { field: '$config.answerMode', eq: 'choices' } },
    } },
  },
  decks: { type: 'decks', min: 1, required: false },
};

test('defaults fill scalars, lists, objects, and bools', () => {
  assert.deepEqual(defaults(quizConfig), { seconds: 15, answerMode: 'choices', autoAdvance: true });
  assert.deepEqual(defaults(quizContent), { items: [], decks: [] });
  assert.deepEqual(defaults({ o: { type: 'object', fields: { n: { type: 'number', default: 2 } } } }), { o: { n: 2 } });
});

test('validate applies defaults and accepts good input', () => {
  const r = validate(quizConfig, { seconds: 20 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { seconds: 20, answerMode: 'choices', autoAdvance: true });
});

test('validate reports bounds, types, unknown keys, and choices with readable messages', () => {
  const r = validate(quizConfig, { seconds: 200, answerMode: 'shout', autoAdvance: 'yes', extra: 1, accent: 'blue' });
  assert.equal(r.ok, false);
  const byPath = Object.fromEntries(r.issues.map((i) => [i.path, i.message]));
  assert.match(byPath.seconds, /90 or less/);
  assert.match(byPath.answerMode, /Choose one of/);
  assert.match(byPath.autoAdvance, /true or false/);
  assert.match(byPath.extra, /not part of the schema/);
  assert.match(byPath.accent, /color like/);
});

test('required text is reported and trimmed text is returned', () => {
  const r = validate(quizContent, { title: '  Flags  ', items: [{ prompt: 'Which flag?', answer: 'France', choices: ['France', 'Spain'] }] }, { config: { answerMode: 'choices' } });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.value.title, 'Flags');
  assert.equal(r.value.items[0].answer, 'France');
  const missing = validate(quizContent, { items: [{ prompt: 'x', answer: '' }] }, { config: { answerMode: 'text' } });
  assert.equal(missing.ok, false);
  assert.ok(missing.issues.some((i) => i.path === 'title'));
  assert.ok(missing.issues.some((i) => i.path === 'items[0].answer'));
});

test('when conditions skip fields that do not apply and enforce the ones that do', () => {
  const textMode = validate(quizContent, { title: 'T', items: [{ prompt: 'p', answer: 'a' }] }, { config: { answerMode: 'text' } });
  assert.equal(textMode.ok, true, JSON.stringify(textMode.issues));
  const choiceMode = validate(quizContent, { title: 'T', items: [{ prompt: 'p', answer: 'a', choices: ['a'] }] }, { config: { answerMode: 'choices' } });
  assert.equal(choiceMode.ok, false);
  assert.match(choiceMode.issues[0].message, /at least 2/);
});

test('list bounds, decks, emoji, image, and multi are checked', () => {
  assert.equal(validate(quizContent, { title: 'T', items: [] }).ok, false);
  const many = validate(quizContent, { title: 'T', items: [1, 2, 3, 4].map((n) => ({ prompt: 'p' + n, answer: 'a' })) }, { config: { answerMode: 'text' } });
  assert.match(many.issues[0].message, /3 items or fewer/);
  assert.equal(validate({ d: { type: 'decks', min: 1 } }, { d: ['countries'] }).ok, true);
  assert.equal(validate({ d: { type: 'decks', min: 1 } }, { d: [] }).ok, false);
  assert.equal(validate({ e: { type: 'emoji' } }, { e: '🦊' }).ok, true);
  assert.equal(validate({ e: { type: 'emoji' } }, { e: 'fox' }).ok, false);
  assert.equal(validate({ i: { type: 'image' } }, { i: 'https://flagcdn.com/w320/fr.png' }).ok, true);
  assert.equal(validate({ i: { type: 'image' } }, { i: 'javascript:alert(1)' }).ok, false);
  const m = validate({ m: { type: 'multi', options: ['a', 'b'] } }, { m: ['a', 'a', 'b'] });
  assert.deepEqual(m.value.m, ['a', 'b']);
});

test('non-object input is rejected without throwing', () => {
  assert.equal(validate(quizConfig, 'nope').ok, false);
  assert.equal(validate(quizConfig, [1]).ok, false);
  assert.equal(validate(quizConfig, undefined).ok, true);
});

test('describe prints one line per field', () => {
  const text = describe(quizContent);
  assert.match(text, /items: list, 1\.\.3/);
  assert.match(text, /choices: list, 2\.\., when \$config\.answerMode = "choices"/);
});
