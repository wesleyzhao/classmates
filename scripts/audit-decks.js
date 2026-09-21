// The deck audit: everything that makes a deck unfair, broken or repetitive, checked in one
// place. tests/decks.test.js runs it over every built-in deck, so a bad card fails `npm test`
// rather than turning up mid-game. `npm run new-deck` points here too.
//
//   node scripts/audit-decks.js              every built-in deck
//   node scripts/audit-decks.js countries    just this one
//
// Errors fail. Warnings are printed and do not: a deck of flags asks the same question 197
// times on purpose, and only a person can tell that apart from a deck that got lazy.

import { pathToFileURL } from 'node:url';
import { normalize, promptGivesAnswer } from '../public/shared/audit.js';
import { normalize as asAnswer } from '../public/shared/match.js';
import { BUILTIN_DECKS } from '../public/shared/registry.js';

// The two checks a browser can run as well (a repeated question, a question that gives away
// its answer) live in public/shared/audit.js, so the deck editor flags them while a card is
// being typed and this script and that screen can never disagree about what counts.
export { normalize };

/** A category needs at least this many cards before its openings are worth counting. */
const OPENINGS_MIN_CARDS = 8;
/** Above this share of a category, one opening is a rut. */
const OPENINGS_MAX_SHARE = 0.25;
/** A multiple choice card offers this many answers, at least and at most. */
const CHOICES_MIN = 2;
const CHOICES_MAX = 6;

/** Punctuation docs/VOICE.md rules out of anything a player reads. */
const BAD_PUNCTUATION = [
  { re: /[—–]/, why: 'dash used as punctuation; use a comma, a full stop, or parentheses' },
  { re: /…|\.\.\./, why: 'ellipsis; say the thing' },
];

/** @typedef {import('../types/parlor.js').Deck} Deck */
/** @typedef {import('../types/parlor.js').Card} Card */
/** @typedef {{ errors: string[], warnings: string[] }} Report */

// Two normalizers, on purpose. `normalize`, from public/shared/audit.js, is for the shape of a
// question: what words it uses and in what order. `asAnswer`, from public/shared/match.js, is
// what the game itself uses to decide whether two answers mean the same thing, so anything
// about answers, aliases and choices is judged the way a player at the table would experience it.

/**
 * Check one deck. Never throws: a malformed deck comes back as errors, like any other fault.
 * @param {Deck} deck
 * @returns {Report}
 */
export function auditDeck(deck) {
  /** @type {Report} */
  const report = { errors: [], warnings: [] };
  const fail = (/** @type {string} */ message) => report.errors.push(message);
  const warn = (/** @type {string} */ message) => report.warnings.push(message);

  if (!deck || typeof deck !== 'object') {
    fail('the deck is not an object');
    return report;
  }
  if (!deck.id) fail('the deck needs an id');
  if (!deck.title) fail('the deck needs a title');
  if (!Number.isInteger(deck.version) || deck.version < 1) fail('the deck needs a whole version number, starting at 1');

  const cards = Array.isArray(deck.cards) ? deck.cards : [];
  if (!cards.length) {
    fail('the deck has no cards');
    return report;
  }

  const categoryIds = new Set((deck.categories || []).map((c) => c.id));
  for (const [text, where] of [[deck.title, 'title'], [deck.description, 'description']]) {
    checkVoice(text, `${where}`, fail);
  }
  for (const category of deck.categories || []) {
    if (!category.id) fail('a category has no id');
    if (!category.name) fail(`category ${category.id}: needs a name`);
    checkVoice(category.name, `category ${category.id}`, fail);
    if (category.emoji) {
      const problem = emojiProblem(category.emoji);
      if (problem) fail(`category ${category.id}: ${problem}`);
    }
  }

  /** @type {Map<string, string>} */
  const byId = new Map();
  /** @type {Map<string, string>} */
  const byQuestion = new Map();

  for (const [index, card] of cards.entries()) {
    const where = card && card.id ? `card ${card.id}` : `card ${index + 1}`;
    if (!card || typeof card !== 'object') { fail(`${where}: is not an object`); continue; }

    if (!card.id || typeof card.id !== 'string') fail(`${where}: needs an id`);
    else if (byId.has(card.id)) fail(`${where}: shares its id with card ${byId.get(card.id)}`);
    else byId.set(card.id, String(index + 1));

    const prompt = typeof card.prompt === 'string' ? card.prompt.trim() : '';
    const answer = typeof card.answer === 'string' ? card.answer.trim() : '';
    if (!prompt) fail(`${where}: needs a prompt`);
    if (!answer) fail(`${where}: needs an answer`);

    checkVoice(prompt, where, fail);
    checkVoice(answer, where, fail);
    for (const alias of card.aliases || []) checkVoice(alias, `${where} alias`, fail);
    for (const choice of card.choices || []) checkVoice(choice, `${where} choice`, fail);
    checkVoice(card.note, `${where} note`, fail);

    // Two cards asking the same thing is a duplicate. Two cards asking the same words about
    // different pictures is a flags deck, which is the whole point of it.
    if (prompt) {
      const key = JSON.stringify([normalize(prompt), card.image || '']);
      if (byQuestion.has(key)) fail(`${where}: asks the same question as card ${byQuestion.get(key)}`);
      else byQuestion.set(key, card.id || String(index + 1));
    }

    if (promptGivesAnswer(prompt, answer)) {
      fail(`${where}: the question contains its own answer (${answer})`);
    }
    for (const alias of card.aliases || []) {
      if (asAnswer(alias) === asAnswer(answer)) warn(`${where}: the alias "${alias}" is one the matcher already accepts`);
      else if (prompt && ` ${normalize(prompt)} `.includes(` ${normalize(alias)} `)) {
        warn(`${where}: the question gives away the alias "${alias}"`);
      }
    }

    if (card.choices !== undefined) {
      const choices = Array.isArray(card.choices) ? card.choices : null;
      if (!choices) fail(`${where}: choices must be a list`);
      else {
        if (choices.length < CHOICES_MIN || choices.length > CHOICES_MAX) {
          fail(`${where}: offer between ${CHOICES_MIN} and ${CHOICES_MAX} choices, not ${choices.length}`);
        }
        const seen = new Set();
        for (const choice of choices) {
          const key = asAnswer(choice);
          if (!key) fail(`${where}: one of the choices is empty`);
          else if (seen.has(key)) fail(`${where}: the choice "${choice}" is offered twice`);
          seen.add(key);
        }
        const matches = choices.filter((choice) => asAnswer(choice) === asAnswer(answer)).length;
        if (matches === 0) fail(`${where}: none of the choices is the answer (${answer})`);
        else if (matches > 1) fail(`${where}: the answer is among the choices ${matches} times`);
        // The quiz kit repairs a card whose right choice only nearly matches its answer, by
        // dropping that choice and putting the answer in itself. A deck that ships with the
        // platform should not need repairing: what the player taps is what the reveal says.
        else if (!choices.includes(answer)) fail(`${where}: the choice for the answer must read exactly "${answer}"`);
      }
    }

    if (card.category) {
      if (!categoryIds.size) fail(`${where}: has a category but the deck defines none`);
      else if (!categoryIds.has(card.category)) fail(`${where}: category "${card.category}" is not in the deck`);
    } else if (categoryIds.size) {
      warn(`${where}: has no category, so category filters will never pick it`);
    }

    if (card.image !== undefined) {
      if (typeof card.image !== 'string' || !/^https:\/\/[^\s"'<>]+$/i.test(card.image)) {
        fail(`${where}: the image must be a full https address`);
      }
    }
    if (card.emoji !== undefined) {
      const problem = emojiProblem(card.emoji);
      if (problem) fail(`${where}: ${problem}`);
    }
  }

  report.warnings.push(...openingRuts(cards, categoryIds));
  return report;
}

/**
 * Categories where a quarter or more of the cards open with the same three words. That is
 * a note for whoever writes the next card, not a fault (docs/VOICE.md).
 * @param {Card[]} cards
 * @param {Set<string>} categoryIds
 * @returns {string[]}
 */
function openingRuts(cards, categoryIds) {
  /** @type {Map<string, Card[]>} */
  const groups = new Map();
  for (const card of cards) {
    const key = categoryIds.size ? String(card?.category || '') : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  const out = [];
  for (const [category, group] of groups) {
    if (group.length < OPENINGS_MIN_CARDS) continue;
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const card of group) {
      const opening = normalize(card?.prompt).split(' ').slice(0, 3).join(' ');
      if (!opening) continue;
      counts.set(opening, (counts.get(opening) || 0) + 1);
    }
    for (const [opening, count] of [...counts].sort((a, b) => b[1] - a[1])) {
      const share = count / group.length;
      if (share <= OPENINGS_MAX_SHARE) break;
      const percent = Math.round(share * 100);
      const where = category ? `category ${category}` : 'the deck';
      out.push(`${where}: ${percent}% of the questions open with "${opening}" (${count} of ${group.length})`);
    }
  }
  return out;
}

/** @param {unknown} text @param {string} where @param {(message: string) => void} fail */
function checkVoice(text, where, fail) {
  if (typeof text !== 'string' || !text) return;
  for (const rule of BAD_PUNCTUATION) if (rule.re.test(text)) fail(`${where}: ${rule.why}`);
}

/**
 * Whether a string is one emoji, counting a flag (two regional indicator letters) as one.
 * @param {unknown} value
 * @returns {string | null}  what is wrong with it, or null
 */
export function emojiProblem(value) {
  if (typeof value !== 'string' || !value.trim()) return 'the emoji is empty';
  const points = [...value];
  const isRegionalIndicator = (/** @type {string} */ c) => {
    const cp = c.codePointAt(0);
    return cp >= 0x1f1e6 && cp <= 0x1f1ff;
  };
  if (points.some(isRegionalIndicator)) {
    return points.length === 2 && points.every(isRegionalIndicator) ? null : 'a flag is two regional indicator letters';
  }
  const clusters = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)];
  if (clusters.length !== 1) return 'use a single emoji';
  // Pictographs and the geometric symbols people reach for when no emoji fits (a hexagon,
  // a suit of cards) both count. Letters, digits and ASCII punctuation do not.
  if (!/[\p{Extended_Pictographic}\p{S}]/u.test(value) || /^[ -~]+$/.test(value)) return 'use an emoji, not text';
  return null;
}

/**
 * Every built-in deck, by id, loaded through the registry the way the server loads them.
 * @returns {Promise<Record<string, Deck>>}
 */
export async function loadBuiltinDecks() {
  /** @type {Record<string, Deck>} */
  const out = {};
  for (const [id, path] of Object.entries(BUILTIN_DECKS)) {
    const module = await import(new URL(`../public/${path}`, import.meta.url).href);
    out[id] = module.default;
  }
  return out;
}

/**
 * Audit the named decks, or all of them, and report.
 * @param {string[]} [ids]
 * @returns {Promise<number>}  a process exit code
 */
export async function main(ids = []) {
  const decks = await loadBuiltinDecks();
  const wanted = ids.length ? ids : Object.keys(decks);
  if (!wanted.length) {
    console.log('No built-in decks are registered yet.');
    return 0;
  }
  let errors = 0;
  for (const id of wanted) {
    const deck = decks[id];
    if (!deck) { console.error(`${id}: not a built-in deck`); errors += 1; continue; }
    const report = auditDeck(deck);
    errors += report.errors.length;
    const cards = Array.isArray(deck.cards) ? deck.cards.length : 0;
    console.log(`${id}  ${cards} cards, ${report.errors.length} errors, ${report.warnings.length} warnings`);
    for (const warning of report.warnings) console.log(`  note   ${warning}`);
    for (const error of report.errors) console.error(`  error  ${error}`);
  }
  return errors ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2).filter((a) => !a.startsWith('-'))));
}
