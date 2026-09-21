// Turns the question bank from Wesley's earlier trivia game into two Parlor decks:
// public/decks/trivia.js (general knowledge, six categories) and public/decks/broadway.js
// (the musicals pack). Both are committed, because they are what ships.
//
// The bank lives in another repo (data/questions.js there), where every question was written
// by one model and fact-checked by another. Nothing here changes a fact. It renames fields,
// keeps the four choices and the accepted alternatives, gives every card a stable id
// (`tp-<original id>`), drops alternatives the question already gives away, and rewrites the
// punctuation that docs/VOICE.md rules out.
//
//   node scripts/import-trivia.js --source ../trivia-party
//   TRIVIA_REPO=../trivia-party node scripts/import-trivia.js
//   node scripts/import-trivia.js --source ../trivia-party --check   fail if the decks are stale

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { makeRng } from '../public/kits/_lib/rng.js';
import { normalize as asAnswer } from '../public/shared/match.js';
import { renderDeck } from './lib/deck-file.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} SourceQuestion
 * @property {string} id
 * @property {string} cat
 * @property {string} [pack]
 * @property {number} difficulty
 * @property {string} q
 * @property {string} a
 * @property {string[]} alt
 * @property {string[]} distractors
 * @property {string} [reviewed]
 */

/** The six categories of the general knowledge deck, in the order a quiz would run them. */
const CATEGORIES = [
  { id: 'geo', name: 'Geography', emoji: '🌍', color: '#2f6bff' },
  { id: 'ent', name: 'Entertainment', emoji: '🎬', color: '#ff3d9a' },
  { id: 'hist', name: 'History', emoji: '📜', color: '#ffc233' },
  { id: 'arts', name: 'Arts and Literature', emoji: '🎨', color: '#8b5cf6' },
  { id: 'sci', name: 'Science and Nature', emoji: '🔬', color: '#22c55e' },
  { id: 'sport', name: 'Sports and Leisure', emoji: '⚽', color: '#ff7a1a' },
];

/**
 * Questions that trip the copy linter for a good reason, with the reason. Each one gets a
 * `voice-ok` comment on its line in the generated file (docs/VOICE.md).
 * @type {Record<string, string>}
 */
const VOICE_OK = {
  'tp-arts-010': 'Journey to the West is the title of the book',
};

/** Only questions that were reviewed ship; the merge script in the source repo drops the rest. */
const REVIEWED = new Set(['pass', 'fixed']);

/** Lowercase, unaccented, punctuation-free. Two strings that normalize alike mean the same thing. */
function normalize(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Punctuation the house voice does not use, rewritten without touching the facts: a dash
 * between numbers becomes "to", any other dash becomes a comma, an ellipsis becomes a full
 * stop. The bank is clean today; this keeps it clean when it grows.
 * @param {string} text
 * @returns {string}
 */
export function fixPunctuation(text) {
  return String(text)
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/…/g, '.')
    .replace(/\.\.\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One source question as a Parlor card. The answer leads the choices before they are
 * shuffled, so a card with no distractors simply has no choices.
 * @param {SourceQuestion} question
 * @returns {import('../types/parlor.js').Card}
 */
export function toCard(question) {
  const id = `tp-${question.id}`;
  const prompt = fixPunctuation(question.q);
  const answer = fixPunctuation(question.a);
  const spoken = ` ${normalize(prompt)} `;

  // Two kinds of alternative are dropped. One the question already says out loud is a
  // freebie, not an alternative. One the answer matcher would accept anyway ("the Nile" for
  // "Nile", "four" for "4") is weight the deck does not need to carry.
  const aliases = (question.alt || [])
    .map(fixPunctuation)
    .filter((alias) => alias && asAnswer(alias) !== asAnswer(answer) && !spoken.includes(` ${normalize(alias)} `));

  const distractors = (question.distractors || []).map(fixPunctuation);
  // Shuffled from the card's own id, so the right answer sits in a different place on every
  // card and in the same place every time this script runs.
  const choices = distractors.length ? makeRng(id).shuffle([answer, ...distractors]) : [];

  return {
    id,
    prompt,
    answer,
    ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
    ...(choices.length ? { choices } : {}),
    category: question.cat,
  };
}

/**
 * Read the bank and split it into the two decks.
 * @param {SourceQuestion[]} questions
 * @returns {{ trivia: import('../types/parlor.js').Deck, broadway: import('../types/parlor.js').Deck }}
 */
export function buildDecks(questions) {
  const known = new Set(CATEGORIES.map((c) => c.id));
  const shipped = questions.filter((q) => REVIEWED.has(String(q.reviewed)));
  const order = CATEGORIES.map((c) => c.id);
  const general = shipped
    .filter((q) => !q.pack)
    .sort((a, b) => (order.indexOf(a.cat) - order.indexOf(b.cat)) || a.id.localeCompare(b.id));
  const broadway = shipped.filter((q) => q.pack === 'broadway').sort((a, b) => a.id.localeCompare(b.id));

  for (const q of general) {
    if (!known.has(q.cat)) throw new Error(`${q.id}: unknown category "${q.cat}"`);
  }

  return {
    trivia: {
      id: 'trivia',
      title: 'General knowledge',
      description: 'Six categories of general knowledge, from geography to sport, each question with four answers.',
      language: 'en',
      version: 1,
      categories: CATEGORIES,
      cards: general.map(toCard),
    },
    broadway: {
      id: 'broadway',
      title: 'Broadway',
      description: 'Musicals, the songs in them, and the people who wrote them.',
      language: 'en',
      version: 1,
      categories: [CATEGORIES.find((c) => c.id === 'arts')],
      cards: broadway.map((q) => ({ ...toCard(q), category: 'arts' })),
    },
  };
}

const TRIVIA_HEADER = `// The general knowledge deck: six categories, four answers a question. Generated by
// scripts/import-trivia.js from the question bank of Wesley's earlier trivia game, where
// every question was written by one model and fact-checked by another.
//
// Do not edit by hand. Change the bank, then re-run the script.`;

const BROADWAY_HEADER = `// The Broadway deck: musicals, their songs, and the people who made them. Generated by
// scripts/import-trivia.js from the broadway pack of the same question bank, so it carries
// the same fact-checking. Every card sits in the one category, arts.
//
// Do not edit by hand. Change the bank, then re-run the script.`;

/**
 * Where the question bank lives. It is a separate repo, so the path is an argument.
 * @param {string[]} argv
 * @returns {string}
 */
function sourceDir(argv) {
  const flag = argv.indexOf('--source');
  const given = flag >= 0 ? argv[flag + 1] : process.env.TRIVIA_REPO;
  return resolve(ROOT, given || '../trivia-party');
}

/**
 * Read the bank, write both decks. With --check, compare instead of writing.
 * @param {string[]} [argv]
 * @returns {Promise<number>}  a process exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const dir = sourceDir(argv);
  const bank = join(dir, 'data/questions.js');
  /** @type {SourceQuestion[]} */
  let questions;
  try {
    questions = (await import(pathToFileURL(bank).href)).default;
  } catch (err) {
    console.error(`Cannot read the question bank at ${bank}.`);
    console.error('Point the script at a checkout of the trivia game: --source <dir>, or TRIVIA_REPO=<dir>.');
    return 1;
  }

  const decks = buildDecks(questions);
  const comment = (/** @type {import('../types/parlor.js').Card} */ card) =>
    (VOICE_OK[card.id] ? `// voice-ok: ${VOICE_OK[card.id]}` : ''); // voice-ok: the marker itself

  const files = [
    { path: join(ROOT, 'public/decks/trivia.js'), text: renderDeck(decks.trivia, TRIVIA_HEADER, { comment }) },
    { path: join(ROOT, 'public/decks/broadway.js'), text: renderDeck(decks.broadway, BROADWAY_HEADER, { comment }) },
  ];

  let stale = 0;
  for (const file of files) {
    const current = readOr(file.path);
    if (argv.includes('--check')) {
      if (current !== file.text) { stale += 1; console.error(`stale: ${file.path}`); }
      continue;
    }
    if (current === file.text) console.log(`unchanged  ${file.path}`);
    else { writeFileSync(file.path, file.text); console.log(`written    ${file.path}`); }
  }
  if (!argv.includes('--check')) {
    console.log(`${decks.trivia.cards.length} general knowledge cards, ${decks.broadway.cards.length} Broadway cards.`);
  }
  return stale ? 1 : 0;
}

function readOr(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
