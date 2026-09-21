// A game's look, applied to the page: its theme and its accent colour. The accent is chosen
// by whoever made the game, so it can be anything, including a yellow that vanishes on paper.
// Rather than refuse it, the room keeps the accent where colour is decoration (rings, chips,
// tiles) and derives two safe tokens from it for where colour carries words: `--link` for text
// in the accent, darkened until it reads, and `--accent-ink` for text on top of the accent,
// white or ink depending on which reads.

/** WCAG's floor for ordinary text. */
const MIN_CONTRAST = 4.5;

/**
 * "#rgb" or "#rrggbb" to [r, g, b], or null for anything else.
 * @param {string} hex
 * @returns {[number, number, number] | null}
 */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** @param {[number, number, number]} rgb */
export function toHex(rgb) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Relative luminance, per WCAG.
 * @param {[number, number, number]} rgb
 */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colours, 1 to 21.
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The accent, darkened only as far as it needs to be to read as text on `background`.
 * A colour that already reads comes back unchanged.
 * @param {[number, number, number]} accent
 * @param {[number, number, number]} background
 * @returns {[number, number, number]}
 */
export function readableOn(accent, background) {
  let rgb = accent;
  for (let i = 0; i < 24 && contrast(rgb, background) < MIN_CONTRAST; i += 1) {
    rgb = /** @type {[number, number, number]} */ (rgb.map((v) => v * 0.88));
  }
  return rgb;
}

const WHITE = /** @type {[number, number, number]} */ ([255, 255, 255]);
const INK = /** @type {[number, number, number]} */ ([17, 17, 17]);

/**
 * The tokens to set for an accent on a given page background.
 * @param {string} accent  the game's accent, as hex
 * @param {string} background  the theme's page colour, as hex
 * @returns {{ accent: string, link: string, accentInk: string } | null}  null when the accent is not a colour
 */
export function accentTokens(accent, background) {
  const rgb = parseHex(accent);
  const bg = parseHex(background) || /** @type {[number, number, number]} */ ([251, 250, 246]);
  if (!rgb) return null;
  return {
    accent: toHex(rgb),
    link: toHex(readableOn(rgb, bg)),
    accentInk: contrast(WHITE, rgb) >= contrast(INK, rgb) ? '#ffffff' : '#111111',
  };
}

/**
 * Put a game's look on the page. Home is editorial with the theme's own accent, and a room
 * is the only thing that changes that, so `clearLook` undoes exactly this.
 * @param {HTMLElement} root  the html element
 * @param {{ theme?: string, accent?: string }} game
 */
export function applyLook(root, game) {
  root.dataset.theme = game.theme === 'playful' ? 'playful' : 'editorial';
  const background = getComputedStyle(root).getPropertyValue('--bg').trim() || '#fbfaf6';
  const tokens = game.accent ? accentTokens(game.accent, background) : null;
  if (!tokens) { clearAccent(root); return; }
  root.style.setProperty('--accent', tokens.accent);
  root.style.setProperty('--link', tokens.link);
  root.style.setProperty('--accent-ink', tokens.accentInk);
}

/** @param {HTMLElement} root */
export function clearLook(root) {
  root.dataset.theme = 'editorial';
  clearAccent(root);
}

/** @param {HTMLElement} root */
function clearAccent(root) {
  root.style.removeProperty('--accent');
  root.style.removeProperty('--link');
  root.style.removeProperty('--accent-ink');
}
