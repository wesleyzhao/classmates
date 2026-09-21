// Lexical name similarity helps recognition games choose plausible wrong answers without identity data.

const MARKS = /\p{M}/gu;
const LETTERS = /[^\p{L}\p{N}\x27-]+/gu;

/** Return a comparison form that treats canonically equivalent spelling alike. */
export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(MARKS, "")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019\x60]/g, "\u0027")
    .replace(/[\u2010-\u2014]/g, "-")
    .replace(LETTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (value) => normalizeName(value).split(" ").filter(Boolean);
const compact = (value) => normalizeName(value).replace(/[^\p{L}\p{N}]/gu, "");
const shape = (value) =>
  normalizeName(value)
    .replace(/[\p{L}\p{N}]+/gu, "x")
    .replace(/ +/g, " ");
const phonetic = (value) =>
  compact(value)
    .replace(/ph/g, "f")
    .replace(/(?:ck|qu)/g, "k")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/(.)\1+/g, "$1")
    .replace(/[aeiouy]/g, "");
const profileCache = new Map();

function profile(value) {
  const key = String(value ?? "");
  let found = profileCache.get(key);
  if (found) return found;
  const parts = tokens(key),
    text = compact(key);
  found = {
    text,
    parts,
    shape: shape(key),
    phonetic: phonetic(key),
    bigrams: bigrams(text),
  };
  if (profileCache.size >= 2000) profileCache.clear();
  profileCache.set(key, found);
  return found;
}

function editSimilarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function bigrams(value) {
  const text = `^${value}$`;
  return new Set(
    Array.from({ length: Math.max(0, text.length - 1) }, (_, i) =>
      text.slice(i, i + 2),
    ),
  );
}

function overlap(a, b) {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** Score two names from 0 to 1 using spelling, sound-like text, initials, and structure only. */
export function nameSimilarity(left, right) {
  const ap = profile(left),
    bp = profile(right),
    a = ap.text,
    b = bp.text;
  if (!a || !b) return 0;
  const at = ap.parts,
    bt = bp.parts;
  const firstA = at[0] ?? "",
    firstB = bt[0] ?? "",
    lastA = at.at(-1) ?? "",
    lastB = bt.at(-1) ?? "";
  const length =
    1 -
    Math.min(1, Math.abs(a.length - b.length) / Math.max(a.length, b.length));
  const tokenLength =
    1 -
    Math.min(
      1,
      Math.abs(at.length - bt.length) / Math.max(at.length, bt.length),
    );
  const structure = ap.shape === bp.shape ? 1 : 0;
  const score =
    0.2 * editSimilarity(a, b) +
    0.12 * overlap(ap.bigrams, bp.bigrams) +
    0.1 * editSimilarity(ap.phonetic, bp.phonetic) +
    0.18 * editSimilarity(firstA, firstB) +
    0.1 * overlap(bigrams(firstA), bigrams(firstB)) +
    0.1 * editSimilarity(phonetic(firstA), phonetic(firstB)) +
    0.08 * editSimilarity(lastA, lastB) +
    0.04 * overlap(bigrams(lastA), bigrams(lastB)) +
    0.04 * editSimilarity(phonetic(lastA), phonetic(lastB)) +
    0.02 * length +
    0.01 * tokenLength +
    0.01 * structure;
  return Math.max(0, Math.min(1, score));
}

/** Pick distinct, seeded distractors from a strong-candidate pool, with a recent-use penalty. */
export function similarNameDistractors(card, cards, count, rng, options = {}) {
  const recent = new Set(options.recentIds ?? []);
  const targetLabel = normalizeName(card.answer);
  const all = cards
    .filter((candidate) => candidate.id !== card.id)
    .map((candidate, index) => ({
      card: candidate,
      index,
      score: nameSimilarity(card.answer, candidate.answer),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const labels = new Set([targetLabel]);
  const distinct = all.filter(({ card: candidate }) => {
    const label = normalizeName(candidate.answer);
    if (labels.has(label)) return false;
    labels.add(label);
    return true;
  });
  const minimumScore = options.minimumScore ?? 0.36;
  const confident = distinct.filter(({ score }) => score >= minimumScore);
  const candidates =
    confident.length >= count
      ? confident
      : [
          ...confident,
          ...rng.shuffle(distinct.filter(({ score }) => score < minimumScore)),
        ];
  const poolSize = Math.min(
    candidates.length,
    Math.max(count, options.poolSize ?? 8),
  );
  const pool = candidates.slice(0, poolSize);
  const chosen = [];
  while (chosen.length < count && pool.length) {
    const weights = pool.map(({ card: candidate, score }) =>
      Math.max(
        0.01,
        (0.08 + score) ** 3 * (recent.has(candidate.id) ? 0.18 : 1),
      ),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let draw = rng() * total;
    let pick = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      draw -= weights[i];
      if (draw < 0) {
        pick = i;
        break;
      }
    }
    chosen.push(pool.splice(pick, 1)[0].card);
  }
  return chosen;
}
