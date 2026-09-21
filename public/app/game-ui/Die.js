// One die, and a real one: six faces on a cube that turns in three dimensions, so a roll is
// seen rolling and not swapped in. A number that simply appears reads as a number someone
// typed; a cube that tumbles for a second and comes to rest on four reads as a four.
//
// The cube is CSS: each face is pushed out from the middle with translateZ, and the whole
// thing turns with one transform. A new number sets that transform to the face's own angle
// plus a few whole turns, and a transition does the rest, slowing to a stop. While a roll is
// on its way to the server the die keeps turning at a steady pace, so the tap and the
// tumble are one motion. A device that has asked for less movement gets the face at once
// (base.css cuts every transition short under prefers-reduced-motion).

import { html, useEffect, useRef, useState } from '../h.js';

/** How long a landing takes. Board screens hold the sentence about the number until then. */
export const TUMBLE_MS = 1100;
/** How long the die keeps turning while a roll is on its way, before it is told the number. */
const SPIN_MS = 1800;

/** Which of the nine cells carry a pip, for each face. */
const FACES = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/**
 * The turn that brings each face to the front, in degrees around X and then Y. The faces
 * sit where base.css puts them: one in front, six behind, two on the right, five on the
 * left, three on top and four underneath, so opposite faces add up to seven as on any die.
 */
const FACING = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

/** A roll as people say it out loud: "Sam rolled a four." */
export function rollWord(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(value);
}

/**
 * @param {{ value: number | null, rolling?: boolean, roll?: string | number | null }} props
 *   `rolling` keeps it turning while the table waits for the number to come back.
 *   `roll` is anything that changes with every roll, so a four after a four still tumbles;
 *   without it, the die tumbles when the number changes.
 */
export function Die({ value, rolling = false, roll = null }) {
  const face = Number(value);
  const shown = FACES[face] ? face : 1;
  const motion = useTumble(shown, roll === null || roll === undefined ? shown : roll, rolling);
  const classes = ['die'];
  if (motion.landing) classes.push('is-tumbling');
  const label = rolling || motion.landing ? 'A die rolling' : `A die showing ${rollWord(shown)}`;
  return html`
    <div class=${classes.join(' ')} role="img" aria-label=${label}>
      <div class="die-cube" style=${motion.style}>
        ${[1, 2, 3, 4, 5, 6].map((n) => html`
          <div key=${n} class=${`die-face die-face-${n}`} aria-hidden="true">
            ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((cell) => html`
              <span key=${cell} class=${FACES[n].includes(cell) ? 'pip' : 'pip is-blank'}></span>`)}
          </div>`)}
      </div>
    </div>`;
}

/**
 * The cube's transform, and whether it is in the middle of landing. Angles only ever grow,
 * so every roll turns the same way and never unwinds; a face is reached by adding whatever
 * brings the angle round to it, plus whole turns for the show. The first number a screen
 * ever sees is set without moving: it was rolled before this device was looking.
 * @param {number} face
 * @param {string | number} roll
 * @param {boolean} rolling
 * @returns {{ style: string, landing: boolean }}
 */
function useTumble(face, roll, rolling) {
  const angles = useRef(/** @type {{ x: number, y: number } | null} */ (null));
  const [motion, setMotion] = useState(() => ({ style: still(FACING[face]), landing: false }));
  const first = useRef(true);

  if (angles.current === null) {
    const [x, y] = FACING[face];
    angles.current = { x, y };
  }

  // A new roll: turn to the face, with two extra turns, and slow to a stop.
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const [fx, fy] = FACING[face];
    const next = { x: onward(angles.current.x, fx) + 360, y: onward(angles.current.y, fy) + 720 };
    angles.current = next;
    setMotion({ style: turning(next, TUMBLE_MS, 'cubic-bezier(0.15, 0.7, 0.2, 1)'), landing: true });
    const timer = setTimeout(() => setMotion((m) => ({ ...m, landing: false })), TUMBLE_MS);
    return () => clearTimeout(timer);
  }, [roll]);

  // Waiting for the number: keep turning at a steady pace, and settle back if it never comes.
  useEffect(() => {
    if (first.current) return;
    const [fx, fy] = FACING[face];
    if (rolling) {
      const next = { x: angles.current.x + 540, y: angles.current.y + 360 };
      angles.current = next;
      setMotion((m) => (m.landing ? m : { style: turning(next, SPIN_MS, 'linear'), landing: false }));
    } else {
      const next = { x: onward(angles.current.x, fx), y: onward(angles.current.y, fy) };
      if (next.x === angles.current.x && next.y === angles.current.y) return;
      angles.current = next;
      setMotion((m) => (m.landing ? m : { style: turning(next, TUMBLE_MS, 'cubic-bezier(0.15, 0.7, 0.2, 1)'), landing: false }));
    }
  }, [rolling]);

  return motion;
}

/** The smallest angle at or past `from` that lands on `want`, going round the same way. */
function onward(from, want) {
  return from + (((want - from) % 360) + 360) % 360;
}

function still([x, y]) {
  return `transform: rotateX(${x}deg) rotateY(${y}deg)`;
}

function turning({ x, y }, ms, ease) {
  return `transform: rotateX(${x}deg) rotateY(${y}deg); transition: transform ${ms}ms ${ease}`;
}
