// The colour math behind a game's accent: a light accent is darkened for text and gets ink
// on top of it, a dark one is left alone and gets white.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accentTokens, contrast, parseHex, readableOn, toHex } from '../../public/app/look.js';

const PAPER = '#fbfaf6';

test('hex parsing takes both lengths and refuses anything else', () => {
  assert.deepEqual(parseHex('#2456f5'), [36, 86, 245]);
  assert.deepEqual(parseHex('fff'), [255, 255, 255]);
  assert.equal(parseHex('blue'), null);
  assert.equal(parseHex('#12345'), null);
  assert.equal(toHex([36, 86, 245]), '#2456f5');
});

test('contrast matches the published ratios', () => {
  assert.equal(Math.round(contrast([0, 0, 0], [255, 255, 255])), 21);
  assert.ok(Math.abs(contrast([255, 255, 255], [255, 255, 255]) - 1) < 1e-9);
});

test('a dark accent keeps its colour for links and takes white on top', () => {
  const tokens = accentTokens('#2456f5', PAPER);
  assert.ok(tokens);
  assert.equal(tokens.link, '#2456f5');
  assert.equal(tokens.accentInk, '#ffffff');
});

test('a light accent is darkened until it reads, and takes ink on top', () => {
  const tokens = accentTokens('#e0a81a', PAPER);
  assert.ok(tokens);
  assert.notEqual(tokens.link, '#e0a81a');
  assert.ok(contrast(parseHex(tokens.link), parseHex(PAPER)) >= 4.5, 'the link reads on paper');
  assert.equal(tokens.accent, '#e0a81a', 'the accent itself is untouched');
  assert.equal(tokens.accentInk, '#111111');
});

test('darkening stops as soon as the colour reads', () => {
  const dark = readableOn([31, 122, 77], parseHex(PAPER));
  assert.deepEqual(dark, [31, 122, 77]);
  const yellow = readableOn([255, 201, 60], parseHex(PAPER));
  assert.ok(contrast(yellow, parseHex(PAPER)) >= 4.5);
  assert.ok(contrast(yellow, parseHex(PAPER)) < 6, 'and not far past it');
});

test('a bad accent yields no tokens rather than a broken page', () => {
  assert.equal(accentTokens('sunset', PAPER), null);
});
