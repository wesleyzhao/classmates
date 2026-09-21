// A seeded random source for kits. Kits never call Math.random (rule R1); they draw from
// `ctx.rng`, which the platform builds from the room's seed and a draw counter it persists in
// `state.$rng`. Replaying the same seed and counter gives the same numbers, which is what makes
// whole games reproducible in tests and lets two racing requests derive identical results.
//
//   const rng = makeRng('seed', 0);
//   rng()            // 0.734...
//   rng.int(6)       // 0..5
//   rng.pick(list)   // one item
//   rng.shuffle(list) // a new array
//   rng.count()      // how many numbers were drawn so far

/**
 * @param {string} seed
 * @param {number} [count]  draws already made; the generator is fast-forwarded past them
 * @returns {import('../../../types/parlor.js').Rng}
 */
export function makeRng(seed, count = 0) {
  let [a, b, c, d] = hashSeed(String(seed));
  let drawn = 0;
  const next = () => {
    // sfc32: small, fast, and good enough for shuffling cards.
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    drawn += 1;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) next();

  const rng = /** @type {import('../../../types/parlor.js').Rng} */ (() => next());
  rng.int = (n) => Math.floor(next() * n);
  rng.pick = (items) => items[Math.floor(next() * items.length)];
  rng.shuffle = (items) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  rng.count = () => drawn;
  return rng;
}

/** Four 32-bit words from a string (a cyrb128-style hash), so any seed text works. */
function hashSeed(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** A random seed string for a new game, from the platform's crypto. */
export function randomSeed() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
