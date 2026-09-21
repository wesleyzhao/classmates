// The classic wheel: 42 spaces on the outer ring (six category headquarters, twelve roll-again
// spaces, twenty-four category spaces), six spokes of five spaces each, and the hub in the middle.
// Coordinates live in a 1000 by 1000 box centred at (500, 500); the screen draws from the same
// numbers the rules use, so what you see is what you can move to. Needs exactly six categories.

import { polar } from '../graph.js';

export const RING_COUNT = 42;
export const SPOKE_LEN = 5;
export const CX = 500;
export const CY = 500;

export const GEOM = {
  ringOuter: 468,
  ringInner: 392,
  hqOuter: 498,
  tokenRing: 430,
  hubR: 104,
  spokeCenters: [352, 300, 248, 196, 144],
  spokeW: 62,
};

// Space types around the ring after each headquarters: category offsets from that HQ's category, or roll again.
const SEGMENT = [3, 'again', 5, 2, 'again', 4];

/** @type {import('../graph.js').Layout | null} */
let cached = null;

/**
 * Build (once) the wheel layout.
 * @returns {import('../graph.js').Layout}
 */
export function build() {
  if (cached) return cached;
  /** @type {Record<string, import('../graph.js').Space>} */
  const spaces = {};
  /** @type {Record<string, string[]>} */
  const adj = {};
  const add = (space) => { spaces[space.id] = space; adj[space.id] = []; };
  const link = (a, b) => { adj[a].push(b); adj[b].push(a); };

  for (let i = 0; i < RING_COUNT; i++) {
    const k = Math.floor(i / 7);
    const off = i % 7;
    const angle = -90 + i * (360 / RING_COUNT);
    const p = polar(CX, CY, GEOM.tokenRing, angle);
    /** @type {import('../graph.js').Space['type']} */
    let type;
    /** @type {number | null} */
    let cat = null;
    if (off === 0) { type = 'hq'; cat = k; }
    else {
      const s = SEGMENT[off - 1];
      if (s === 'again') type = 'again';
      else { type = 'cat'; cat = (k + /** @type {number} */ (s)) % 6; }
    }
    add({ id: `r${i}`, kind: 'ring', index: i, type, cat, angle, x: p.x, y: p.y });
  }
  for (let i = 0; i < RING_COUNT; i++) link(`r${i}`, `r${(i + 1) % RING_COUNT}`);

  add({ id: 'hub', kind: 'hub', type: 'hub', cat: null, angle: 0, x: CX, y: CY });

  for (let k = 0; k < 6; k++) {
    const angle = -90 + 60 * k;
    let prev = `r${7 * k}`;
    for (let i = 1; i <= SPOKE_LEN; i++) {
      const p = polar(CX, CY, GEOM.spokeCenters[i - 1], angle);
      const id = `s${k}_${i}`;
      add({ id, kind: 'spoke', index: i, type: 'cat', cat: (k + i) % 6, angle, x: p.x, y: p.y });
      link(prev, id);
      prev = id;
    }
    link(prev, 'hub');
  }

  cached = { id: 'wheel', viewBox: '0 0 1000 1000', spaces, adj, start: 'hub', end: 'hub', categoriesNeeded: 6 };
  return cached;
}

/** The headquarters space for a category index. */
export function hqOf(cat) {
  return `r${7 * cat}`;
}
