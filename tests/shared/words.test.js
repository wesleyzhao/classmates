// Numbers as words, and answers dropped into the middle of a sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberWord, NumberWord, midSentence } from '../../public/shared/words.js';

test('small numbers come out as words and the rest as digits', () => {
  assert.equal(numberWord(0), 'zero');
  assert.equal(numberWord(7), 'seven');
  assert.equal(numberWord(20), 'twenty');
  assert.equal(numberWord(21), '21');
  assert.equal(numberWord(2.5), '2.5');
  assert.equal(NumberWord(3), 'Three');
});

test('an answer in the middle of a sentence loses its capital article and its full stop', () => {
  assert.equal(midSentence('The Seine'), 'the Seine');
  assert.equal(midSentence('A Midsummer Night\'s Dream'), 'a Midsummer Night\'s Dream');
  assert.equal(midSentence('An Inspector Calls.'), 'an Inspector Calls');
  assert.equal(midSentence('Portugal.'), 'Portugal');
  assert.equal(midSentence('Theodore Roosevelt'), 'Theodore Roosevelt');
  assert.equal(midSentence('  Amsterdam  '), 'Amsterdam');
  assert.equal(midSentence(''), '');
  assert.equal(midSentence(null), '');
});
