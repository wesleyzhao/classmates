// A race track: one path from start to finish, drawn as a snake of rows so it fits a phone.
// Category spaces cycle through however many categories the game has; every seventh space is a
// roll-again. Movement is one way. Works with one category or ten, and with any length from 12 to 60.

/** @type {Map<string, import('../graph.js').Layout>} */
const cache = new Map();

/**
 * @param {{ length?: number, categories?: number }} [opts]  spaces including start and finish; number of categories
 * @returns {import('../graph.js').Layout}
 */
export function build(opts = {}) {
  const length = Math.max(12, Math.min(60, Math.round(opts.length ?? 30)));
  const categories = Math.max(1, Math.min(12, Math.round(opts.categories ?? 3)));
  const key = `${length}:${categories}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const perRow = 6;
  const rows = Math.ceil(length / perRow);
  const cell = 1000 / perRow;
  const rowH = Math.min(cell, 1000 / rows);
  const top = (1000 - rows * rowH) / 2;
  /** @type {Record<string, import('../graph.js').Space>} */
  const spaces = {};
  /** @type {Record<string, string[]>} */
  const adj = {};
  let catIndex = 0;
  for (let i = 0; i < length; i++) {
    const row = Math.floor(i / perRow);
    const col = row % 2 === 0 ? i % perRow : perRow - 1 - (i % perRow);
    const id = `t${i}`;
    /** @type {import('../graph.js').Space['type']} */
    let type;
    /** @type {number | null} */
    let cat = null;
    if (i === 0) type = 'start';
    else if (i === length - 1) type = 'finish';
    else if (i % 7 === 0) type = 'again';
    else { type = 'cat'; cat = catIndex % categories; catIndex += 1; }
    spaces[id] = { id, kind: 'track', index: i, type, cat, x: cell * col + cell / 2, y: top + rowH * row + rowH / 2 };
    adj[id] = i < length - 1 ? [`t${i + 1}`] : [];
  }
  const layout = { id: 'track', viewBox: '0 0 1000 1000', spaces, adj, start: 't0', end: `t${length - 1}`, categoriesNeeded: 1 };
  cache.set(key, layout);
  return layout;
}
