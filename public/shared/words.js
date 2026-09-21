// Small numbers as words, for sentences a person reads: "ten cards, fifteen seconds each".
// Digits are for tables and scores; prose says the number the way someone would say it.

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/**
 * The word for a whole number up to twenty; larger numbers and anything odd come back as digits.
 * @param {number} n
 * @returns {string}
 */
export function numberWord(n) {
  const whole = Math.round(Number(n));
  if (!Number.isFinite(whole) || whole < 0 || whole !== Number(n)) return String(n);
  return SMALL[whole] || String(whole);
}

/**
 * The same, with a capital letter, for the start of a sentence.
 * @param {number} n
 * @returns {string}
 */
export function NumberWord(n) {
  const word = numberWord(n);
  return word[0].toUpperCase() + word.slice(1);
}

/**
 * An answer dropped into the middle of a sentence: "That's the Seine", not "That's The Seine".
 * A leading article loses its capital and a full stop at the end goes, because the sentence
 * brings its own. Everything else is left exactly as the deck wrote it.
 * @param {string} text
 * @returns {string}
 */
export function midSentence(text) {
  const clean = String(text || '').trim().replace(/\.$/, '');
  return clean.replace(/^(The|A|An)(?=\s)/, (article) => article.toLowerCase());
}
