// How a generated deck becomes a source file. The generators (gen-countries.js,
// import-trivia.js) and the deck scaffold all write the same shape, so the shape lives
// here: one card per line, keys in a fixed order, no trailing whitespace.
//
// One card per line is deliberate. A deck is a few hundred lines of data, and a diff that
// shows "this one card changed" is worth more than pretty indentation.

/**
 * A deck as the text of public/decks/<id>.js.
 * @param {import('../../types/parlor.js').Deck} deck
 * @param {string} header  the comment that opens the file, including its leading slashes
 * @param {{ comment?: (card: import('../../types/parlor.js').Card) => string }} [opts]
 *   `comment` adds a trailing comment to one card's line, which is how a deliberate voice
 *   exception gets its `voice-ok` marker (see docs/VOICE.md).
 * @returns {string}
 */
export function renderDeck(deck, header, opts = {}) {
  const { cards, categories, ...meta } = deck;
  /** @type {string[]} */
  const lines = [];
  lines.push(header.trimEnd(), '');
  lines.push("/** @type {import('../../types/parlor.js').Deck} */");
  lines.push('const deck = {');
  for (const [key, value] of Object.entries(meta)) lines.push(`  ${key}: ${JSON.stringify(value)},`);
  if (categories) {
    lines.push('  categories: [');
    for (const category of categories) lines.push(`    ${JSON.stringify(category)},`);
    lines.push('  ],');
  }
  lines.push('  cards: [');
  for (const card of cards) {
    const note = opts.comment ? opts.comment(card) : '';
    lines.push(`    ${JSON.stringify(card)},${note ? `  ${note}` : ''}`);
  }
  lines.push('  ],');
  lines.push('};', '', 'export default deck;', '');
  return lines.join('\n');
}
