// What the answer matcher must forgive and what it must refuse. Every case here is a real
// way people type an answer into a phone at a table, so a change that breaks one of them
// is a change a player would feel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, match, isClose, editDistance, allowance } from '../../public/shared/match.js';

const card = (answer, extra = {}) => ({ id: 'c', prompt: 'p', answer, ...extra });

test('normalize: accents, case, and punctuation come off', () => {
  assert.equal(normalize('São Tomé'), 'sao tome');
  assert.equal(normalize('  CÔTE   D’IVOIRE '), 'cote divoire');
  assert.equal(normalize("O'Brien"), 'obrien');
  assert.equal(normalize('Saint-Denis'), 'saintdenis');
  assert.equal(normalize('Who? What!'), 'who what');
  assert.equal(normalize(''), '');
  assert.equal(normalize(null), '');
});

test('normalize: a leading article goes, a lone article stays', () => {
  assert.equal(normalize('The Netherlands'), 'netherlands');
  assert.equal(normalize('A Tale of Two Cities'), 'tale of 2 cities');
  assert.equal(normalize('An Officer'), 'officer');
  assert.equal(normalize('The'), 'the');
  assert.equal(normalize('Bath of the Sun'), 'bath of the sun');
});

test('normalize: abbreviations spell themselves out', () => {
  assert.equal(normalize('St Louis'), 'saint louis');
  assert.equal(normalize('Mt. Fuji'), 'mount fuji');
  assert.equal(normalize('Ft Worth'), 'fort worth');
  assert.equal(normalize('Dr Who'), 'doctor who');
  assert.equal(normalize('N Korea'), 'north korea');
  assert.equal(normalize('S Africa'), 'south africa');
  assert.equal(normalize('E Timor'), 'east timor');
  assert.equal(normalize('W Virginia'), 'west virginia');
  assert.equal(normalize('Ben & Jerry'), 'ben and jerry');
  assert.equal(normalize('Sandra'), 'sandra', 'a word that merely starts with an abbreviation is untouched');
});

test('normalize: number words and digits meet in the middle', () => {
  assert.equal(normalize('seven'), '7');
  assert.equal(normalize('Twenty'), '20');
  assert.equal(normalize('two hundred'), '200');
  assert.equal(normalize('three thousand'), '3000');
  assert.equal(normalize('1984'), '1984');
  assert.equal(normalize('Catch twenty two'), 'catch 20 2');
  assert.equal(normalize('seven eleven'), '7 11', 'numbers side by side are not added together');
});

test('match: the answer itself, an alias, and nothing else', () => {
  const portugal = card('Portugal', { aliases: ['Portuguese Republic'] });
  assert.deepEqual(match('Portugal', portugal), { ok: true, kind: 'exact', distance: 0 });
  assert.deepEqual(match('  portugal  ', portugal), { ok: true, kind: 'exact', distance: 0 });
  assert.deepEqual(match('Portuguese Republic', portugal), { ok: true, kind: 'alias', distance: 0 });
  assert.equal(match('Spain', portugal).ok, false);
  assert.equal(match('Spain', portugal).kind, 'no');
});

test('match: a typo is forgiven in proportion to the word', () => {
  assert.equal(match('portugual', card('Portugal')).ok, true);
  assert.equal(match('protugal', card('Portugal')).kind, 'fuzzy', 'two letters swapped is one edit');
  assert.equal(match('netherlnads', card('Netherlands')).ok, true);
  assert.equal(match('Sao Tome', card('São Tomé')).kind, 'exact', 'an accent is never the difference');
  assert.equal(match('sao pualo', card('São Paulo')).ok, true);
  assert.equal(match('sao tomay', card('São Tomé')).ok, false, 'two edits into a four letter word is another word');
  assert.equal(match('chile', card('China')).ok, false, 'a five letter word gets one edit, not two');
  assert.equal(match('mali', card('Bali')).ok, false, 'short words get no slack at all');
  assert.equal(match('denis saint', card('Saint Denis')).ok, true, 'word order does not matter');
});

test('match: an empty guess is never right', () => {
  assert.deepEqual(match('', card('Portugal')), { ok: false, kind: 'no', distance: 8 });
  assert.equal(match('   ', card('Portugal')).ok, false);
  assert.equal(match('!!', card('Portugal')).ok, false);
  assert.equal(isClose('', card('Portugal')), false);
});

test('match: a short prefix is a guess, not an answer', () => {
  const austria = card('Austria');
  assert.equal(match('aus', austria).ok, false);
  assert.equal(match('austr', austria).ok, false);
  assert.equal(match('austri', austria).ok, true, 'six characters in, a missing letter reads as a typo');
  assert.equal(match('franc', card('France')).ok, false);
});

test('match: numbers are never fuzzy', () => {
  const year = card('1969');
  assert.equal(match('1969', year).ok, true);
  assert.equal(match('1968', year).ok, false);
  assert.equal(match('nineteen', card('19')).ok, true, 'the word for the number still counts');
  assert.equal(match('8', card('7')).ok, false);
});

test('match: a rejected guess always fails, and never reads as close', () => {
  const holland = card('Netherlands', { reject: ['Holland'] });
  assert.equal(match('Holland', holland).ok, false);
  assert.equal(match('holland', holland).kind, 'no');
  assert.equal(isClose('Holland', holland), false);
  const near = card('Sweden', { reject: ['Swedan'] });
  assert.equal(match('Swedan', near).ok, false, 'a rejected guess wins over the typo allowance');
});

test('match: fuzzy can be turned off', () => {
  assert.equal(match('portugual', card('Portugal'), { fuzzy: false }).ok, false);
  assert.equal(match('Portugal', card('Portugal'), { fuzzy: false }).ok, true);
});

test('isClose: a near miss reads as close, a different answer does not', () => {
  assert.equal(isClose('portugall', card('Portugal')), false, 'a guess that counts is not a near miss');
  assert.equal(isClose('portucal', card('Argentina')), false);
  assert.equal(isClose('chile', card('China')), true);
  assert.equal(isClose('Spain', card('Portugal')), false);
});

test('editDistance and allowance are the small pieces the rest rests on', () => {
  assert.equal(editDistance('', ''), 0);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('abc', ''), 3);
  assert.equal(editDistance('ab', 'ba'), 1, 'a transposition is one edit');
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(allowance('bali'), 0);
  assert.equal(allowance('france'), 1);
  assert.equal(allowance('argentina'), 2);
});
