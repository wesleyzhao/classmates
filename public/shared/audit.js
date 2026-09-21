// The deck checks that are pure arithmetic over a list of cards: no file system, no registry,
// no process, no network. Two callers share them. `scripts/audit-decks.js` runs the primitives
// over every built-in deck so a bad card fails `npm test`, and the deck editor in the browser
// runs `cardHints` over the cards someone is typing, so the note arrives while the card is
// still on screen rather than at the end of a test run.
//
// Anything that needs to read a file, reach the registry, or print a report stays in the script.

/** @typedef {import('../../types/parlor.js').Card} Card */

/**
 * Lowercase, unaccented, punctuation-free. Two strings that normalize alike use the same
 * words in the same order, which is how a repeated question is spotted.
 * @param {unknown} text
 * @returns {string}
 */
export function normalize(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * True when a question hands over its own answer. The spaces on both sides keep "Rome" out
 * of "Romeo": a whole word has to match, not a fragment of one.
 * @param {unknown} prompt
 * @param {unknown} answer
 * @returns {boolean}
 */
export function promptGivesAnswer(prompt, answer) {
  const asked = normalize(prompt);
  const said = normalize(answer);
  if (!asked || !said) return false;
  return ` ${asked} `.includes(` ${said} `);
}

/**
 * Cards that ask what an earlier card already asked. Two cards asking the same words about
 * different pictures are not duplicates, which is what makes a deck of flags legal, so the
 * image counts as part of the question.
 * @param {Array<Partial<Card>>} cards
 * @returns {Array<{ index: number, first: number }>}  both zero based
 */
export function duplicatePrompts(cards) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {Array<{ index: number, first: number }>} */
  const out = [];
  (cards || []).forEach((card, index) => {
    const asked = normalize(card && card.prompt);
    if (!asked) return;
    const key = JSON.stringify([asked, (card && card.image) || '']);
    if (seen.has(key)) out.push({ index, first: seen.get(key) });
    else seen.set(key, index);
  });
  return out;
}

/**
 * The notes the deck editor shows under the cards, as sentences a person can act on. It only
 * covers the two faults that are worth interrupting typing for; the full audit in
 * `scripts/audit-decks.js` has the rest and runs before a deck ships.
 * @param {Array<Partial<Card>>} cards
 * @returns {string[]}
 */
export function cardHints(cards) {
  const list = cards || [];
  /** @type {string[]} */
  const out = [];
  for (const { index, first } of duplicatePrompts(list)) {
    out.push(`Card ${index + 1} asks the same question as card ${first + 1}.`);
  }
  list.forEach((card, index) => {
    if (!card) return;
    if (promptGivesAnswer(card.prompt, card.answer)) {
      out.push(`Card ${index + 1} contains its own answer, so nobody has to think.`);
    }
  });
  return out;
}
