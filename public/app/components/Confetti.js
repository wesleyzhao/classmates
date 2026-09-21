// A burst of paper when you win, drawn on a canvas over everything and thrown away when it
// lands. Its colours come from the running theme's tokens, so the playful theme throws
// violet and mint and the editorial theme throws ink and blue.
//
// It does nothing at all when the device asks for reduced motion. A win is already said in
// words on the results screen; the confetti is the flourish, and a flourish is exactly the
// kind of thing that setting is for.

import { html, useEffect, useRef } from '../h.js';

const PIECES = 90;
const LIFETIME = 2200;
const TOKENS = ['--accent', '--good', '--warn', '--ink', '--bad'];

/**
 * @param {{ burst: number }} props  change `burst` (a counter, or a timestamp) to fire it
 */
export function Confetti({ burst }) {
  const canvas = useRef(null);

  useEffect(() => {
    if (!burst) return undefined;
    const element = canvas.current;
    if (!element) return undefined;
    if (globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const ctx = element.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const width = element.clientWidth;
    const height = element.clientHeight;
    element.width = Math.round(width * dpr);
    element.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const styles = getComputedStyle(document.documentElement);
    const colours = TOKENS.map((token) => styles.getPropertyValue(token).trim()).filter(Boolean);
    const pieces = [];
    for (let i = 0; i < PIECES; i += 1) {
      pieces.push({
        x: width / 2 + (Math.random() - 0.5) * width * 0.5,
        y: height * 0.34 + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 7,
        vy: -6 - Math.random() * 7,
        spin: (Math.random() - 0.5) * 0.3,
        angle: Math.random() * Math.PI,
        size: 5 + Math.random() * 6,
        colour: colours[i % colours.length] || '#000000',
      });
    }

    let frame = 0;
    const started = performance.now();
    function draw(time) {
      const age = time - started;
      ctx.clearRect(0, 0, width, height);
      for (const piece of pieces) {
        piece.vy += 0.28;              // gravity
        piece.vx *= 0.995;             // a little drag, so it drifts rather than flies
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.angle += piece.spin;
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.angle);
        ctx.globalAlpha = Math.max(0, 1 - age / LIFETIME);
        ctx.fillStyle = piece.colour;
        ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        ctx.restore();
      }
      if (age < LIFETIME) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, width, height);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [burst]);

  return html`<canvas class="confetti" ref=${canvas} aria-hidden="true"></canvas>`;
}
