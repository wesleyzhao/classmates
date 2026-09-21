// Does what the player typed mean the same thing as the card's answer? Free text is the
// warmest way to answer a quiz and the easiest to get wrong for silly reasons, so this
// module forgives accents, articles, punctuation, abbreviations, number words, and small
// typos, while refusing the near misses that would feel like cheating ("aus" for Austria).
//
// It is pure and shared: the quiz kit grades with it on the server, and the answer box in
// the browser uses `isClose` to say "Close, but not quite" after the reveal. Both sides
// must agree, so nothing here reads a clock, a locale, or a deck.
//
//   normalize("São Tomé")          // 'sao tome'
//   match('portugul', card)        // { ok: true, kind: 'fuzzy', distance: 1 }
//   match('aus', austriaCard)      // { ok: false, kind: 'no', distance: 4 }

/** Words people say instead of the long form. Whole tokens only, after normalization. */
const ABBREVIATIONS = {
  st: 'saint', mt: 'mount', ft: 'fort', dr: 'doctor',
  n: 'north', s: 'south', e: 'east', w: 'west',
};

/** Number words a quizmaster reads out loud, as the digits they stand for. */
const NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, hundred: 100, thousand: 1000,
};

const ARTICLES = new Set(['the', 'a', 'an']);
/** Apostrophes and hyphens close up ("o'brien" is one word); everything else becomes a gap. */
const JOINERS = /['‘’ʼ‐‑‒–—-]/g;
const COMBINING = /\p{M}/gu;
const NOT_WORD = /[^\p{L}\p{N}\s]/gu;
/** A guess this short that only starts the answer is a shot in the dark, not a typo. */
const PREFIX_FLOOR = 6;
/** How near a wrong guess has to be before the UI calls it close. */
const CLOSE_DISTANCE = 2;

/**
 * The comparable form of a piece of text: no accents, no case, no punctuation, no leading
 * article, abbreviations spelled out, numbers written as digits.
 * @param {string} text
 * @returns {string} words separated by single spaces, or '' when nothing is left
 */
export function normalize(text) {
  const flat = String(text ?? '')
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(JOINERS, '')
    .replace(NOT_WORD, ' ');
  let tokens = flat.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && ARTICLES.has(tokens[0])) tokens = tokens.slice(1);
  tokens = tokens.map((token) => ABBREVIATIONS[token] || token);
  return foldNumbers(tokens).join(' ');
}

/**
 * Number words become digits so "seven" and "7" are the same answer. A multiplier follows
 * the number it multiplies, so "two hundred" folds into "200"; unrelated numbers standing
 * next to each other ("7 11") are left alone.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function foldNumbers(tokens) {
  /** @type {string[]} */
  const out = [];
  for (const token of tokens) {
    const value = token in NUMBERS ? NUMBERS[token] : (/^\d+$/.test(token) ? Number(token) : null);
    if (value === null) { out.push(token); continue; }
    const previous = out.length && /^\d+$/.test(out[out.length - 1]) ? Number(out[out.length - 1]) : null;
    if (value >= 100 && previous !== null && previous > 0 && previous < value) {
      out[out.length - 1] = String(previous * value);
      continue;
    }
    out.push(String(value));
  }
  return out;
}

/**
 * Grade a guess against a card.
 * @param {string} guess  what the player typed
 * @param {{ answer?: string, aliases?: string[], reject?: string[] }} card
 * @param {{ fuzzy?: boolean }} [opts]  `fuzzy: false` demands the exact answer or an alias
 * @returns {{ ok: boolean, kind: 'exact' | 'alias' | 'fuzzy' | 'no', distance: number }}
 */
export function match(guess, card, opts = {}) {
  const { ok, kind, distance } = grade(guess, card, opts);
  return { ok, kind, distance };
}

/**
 * Was the guess a near miss? The answer box uses it after the reveal to say so. A guess
 * the card rejects on purpose is never close, however it is spelled.
 * @param {string} guess
 * @param {{ answer?: string, aliases?: string[], reject?: string[] }} card
 * @returns {boolean}
 */
export function isClose(guess, card) {
  const result = grade(guess, card, {});
  if (result.ok || result.rejected) return false;
  return result.distance > 0 && result.distance <= CLOSE_DISTANCE;
}

/**
 * The whole comparison, including whether the card rejected the guess outright.
 * @returns {{ ok: boolean, kind: 'exact' | 'alias' | 'fuzzy' | 'no', distance: number, rejected: boolean }}
 */
function grade(guess, card, opts) {
  const said = normalize(guess);
  const answer = normalize(card && card.answer);
  if (!said) return { ok: false, kind: 'no', distance: answer.length, rejected: false };

  for (const entry of (card && card.reject) || []) {
    if (normalize(entry) === said) return { ok: false, kind: 'no', distance: best(said, card), rejected: true };
  }
  if (said === answer) return { ok: true, kind: 'exact', distance: 0, rejected: false };
  for (const alias of (card && card.aliases) || []) {
    if (normalize(alias) === said) return { ok: true, kind: 'alias', distance: 0, rejected: false };
  }

  const distance = best(said, card);
  // Numbers are exact by nature: one digit out is a different answer, not a typo.
  if (opts.fuzzy === false || isNumeric(answer)) return { ok: false, kind: 'no', distance, rejected: false };

  for (const target of targets(card)) {
    if (!target || isNumeric(target)) continue;
    if (target.startsWith(said) && said.length < target.length && said.length < PREFIX_FLOOR) continue;
    if (compare(said, target).ok) return { ok: true, kind: 'fuzzy', distance, rejected: false };
  }
  return { ok: false, kind: 'no', distance, rejected: false };
}

/** The answer and every alias, normalized. */
function targets(card) {
  return [normalize(card && card.answer), ...((card && card.aliases) || []).map(normalize)];
}

/** The smallest total edit distance to any target, which is what the kit logs. */
function best(said, card) {
  let smallest = Infinity;
  for (const target of targets(card)) {
    if (!target) continue;
    const { distance } = compare(said, target);
    if (distance < smallest) smallest = distance;
  }
  return smallest === Infinity ? said.length : smallest;
}

/**
 * Compare two normalized phrases word by word, ignoring the order they were said in, so
 * "denis saint" still reaches "saint denis". Each word carries its own typo allowance.
 * @returns {{ ok: boolean, distance: number }}
 */
function compare(said, target) {
  const guessWords = said.split(' ');
  const targetWords = target.split(' ');
  if (guessWords.length !== targetWords.length) return { ok: false, distance: editDistance(said, target) };
  // Longest words first: they are the ones a greedy pairing gets wrong if it starts small.
  const order = targetWords.map((word, i) => i).sort((a, b) => targetWords[b].length - targetWords[a].length || a - b);
  const pool = [...guessWords];
  let total = 0;
  let ok = true;
  for (const index of order) {
    const word = targetWords[index];
    let pick = 0;
    let distance = Infinity;
    pool.forEach((candidate, i) => {
      const d = editDistance(candidate, word);
      if (d < distance) { distance = d; pick = i; }
    });
    if (distance > allowance(word)) ok = false;
    total += distance;
    pool.splice(pick, 1);
  }
  return { ok, distance: total };
}

/** How many edits a word of this length may carry and still count as the same word. */
export function allowance(word) {
  if (word.length <= 4) return 0;
  if (word.length <= 8) return 1;
  return 2;
}

/** Digits, and the spaces and separators between them. */
function isNumeric(text) {
  return /\d/.test(text) && !/\p{L}/u.test(text);
}

/**
 * Damerau-Levenshtein distance with adjacent transpositions, so "protugal" is one edit
 * from "portugal" rather than two.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let twoBack = [];
  let previous = [];
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      row[j] = value;
    }
    twoBack = previous;
    previous = row;
  }
  return previous[b.length];
}
