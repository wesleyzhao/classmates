// The board itself, drawn from the same geometry the rules use: a space a finger can reach here is
// exactly a space `reachable()` handed to the view, so what you see is what the kit will accept.
// Everything arrives as props. This file computes no rules and never talks to the server.
//
// The wheel is a paper disc, a ring band, six spokes and a hub, with each category's headquarters
// as a thick coloured arc across the ring. The track is a snake of rounded squares threaded on a
// line. Both are drawn in the layout's own 1000 by 1000 box, so tokens, dashed rings and labels
// work the same on either one.
//
// The last move walks the token along its path one space at a time, which is the one moment where
// the board says something the numbers do not: you see where someone came from.

import { html, Fragment, useEffect, useRef, useState } from '../h.js';
import { polar } from '../../kits/board/graph.js';
import { GEOM } from '../../kits/board/layouts/wheel.js';

/** The face a player wears when we were told nothing about them. */
const FACE = '\u{1F642}';

/** How long a token spends on each space of a move. The CSS transition matches it. */
const STEP_MS = 220;
/** The token's circle on the wheel, and how far apart two tokens sit when they share a space. */
const TOKEN_R = 30;
const SPREAD = 21;

/**
 * @typedef {import('../../kits/board/graph.js').Space} Space
 * @typedef {import('../../kits/board/graph.js').Layout} Layout
 * @typedef {{ id: string, name: string, color: string, emoji: string }} Cat
 * @typedef {{ to: string, path?: string[], type?: string, cat?: number | null }} MoveOption
 */

/**
 * @param {{
 *   layout: Layout,
 *   cats?: Cat[],
 *   positions?: Record<string, string>,
 *   players?: import('../../../types/parlor.js').PlayerInfo[],
 *   options?: MoveOption[],
 *   lastMove?: { from: string, to: string, path: string[], playerId?: string } | null,
 *   onPick?: (to: string) => void,
 *   highlightSpace?: string | null,
 * }} props
 */
export function Board({ layout, cats = [], positions = {}, players = [], options = [], lastMove = null, onPick, highlightSpace = null }) {
  const walkingAt = useWalk(lastMove);
  if (!layout || !layout.spaces) return null;
  const spaces = layout.spaces;
  const wheel = layout.id === 'wheel';
  const size = wheel ? 0 : cellOf(spaces);
  // A token is sized to its space, so a track square is not a saucer with a pea on it.
  const tokenR = wheel ? TOKEN_R : Math.max(TOKEN_R, size * 0.27);
  const moverId = moverOf(lastMove, players, positions);

  /** Where each player's token is drawn right now, which is not their position mid walk. */
  /** @type {Record<string, string>} */
  const where = {};
  for (const player of players) {
    const at = walkingAt && player.id === moverId ? walkingAt : positions[player.id];
    if (at && spaces[at]) where[player.id] = at;
  }
  /** @type {Map<string, string[]>} */
  const sharing = new Map();
  for (const player of players) {
    const at = where[player.id];
    if (!at) continue;
    if (!sharing.has(at)) sharing.set(at, []);
    sharing.get(at).push(player.id);
  }

  return html`
    <svg class="board" viewBox=${wheel ? layout.viewBox || '0 0 1000 1000' : fitBox(spaces, size)}
         role="group" aria-label="The board">
      ${wheel ? wheelBase(spaces, cats) : trackBase(spaces, cats, size)}
      ${(options || []).map((option, index) => spaces[option.to] ? html`
        <${Destination}
          key=${option.to}
          space=${spaces[option.to]}
          cats=${cats}
          wheel=${wheel}
          size=${size}
          radius=${tokenR}
          number=${options.length > 1 ? index + 1 : null}
          onPick=${onPick}
        />` : null)}
      ${highlightSpace && spaces[highlightSpace] ? here(spaces[highlightSpace], wheel, size, tokenR) : null}
      ${players.map((player) => {
        const at = where[player.id];
        if (!at) return null;
        const mates = sharing.get(at) || [];
        const spot = spread(spaces[at], mates.indexOf(player.id), mates.length);
        return html`
          <g class="board-token" key=${player.id} style=${`transform:translate(${round(spot.x)}px,${round(spot.y)}px)`}>
            <circle r=${round(tokenR)} />
            <text y="1" text-anchor="middle" dominant-baseline="central"
                  font-size=${round(tokenR * 1.1)}>${player.avatar || FACE}</text>
          </g>`;
      })}
    </svg>`;
}

/** The name a player would say for a space: "Geography HQ", "Roll again", "The middle". */
export function spaceLabel(space, cats = []) {
  if (!space) return 'A space';
  const cat = space.cat === null || space.cat === undefined ? null : cats[space.cat];
  if (space.type === 'hub') return 'The middle';
  if (space.type === 'finish') return 'Finish';
  if (space.type === 'start') return 'The start';
  if (space.type === 'again') return 'Roll again';
  if (space.type === 'hq') return cat ? `${cat.name} HQ` : 'Headquarters';
  return cat ? cat.name : 'A space';
}

/** The colour a space wears, or null when it belongs to no category. */
export function spaceColor(space, cats = []) {
  if (!space || space.cat === null || space.cat === undefined) return null;
  const cat = cats[space.cat];
  return (cat && cat.color) || null;
}

// ---------------------------------------------------------------------------
// the wheel

function wheelBase(spaces, cats) {
  const step = 360 / 42;
  const ring = [];
  const hqs = [];
  for (const space of Object.values(spaces)) {
    if (space.kind === 'hub') continue;
    if (space.type === 'hq') {
      const mid = (GEOM.ringInner + GEOM.hqOuter) / 2;
      hqs.push(html`
        <path
          key=${space.id}
          class="board-hq"
          d=${arcPath(500, 500, mid, space.angle - step * 0.46, space.angle + step * 0.46)}
          stroke=${spaceColor(space, cats) || 'var(--rule-strong)'}
          stroke-width=${GEOM.hqOuter - GEOM.ringInner}
        ><title>${spaceLabel(space, cats)}</title></path>`);
      continue;
    }
    const color = spaceColor(space, cats);
    ring.push(html`
      <circle
        key=${space.id}
        class=${color ? 'board-pip' : 'board-pip is-again'}
        cx=${round(space.x)} cy=${round(space.y)}
        r=${space.kind === 'spoke' ? 13 : 11}
        fill=${color || 'var(--rule)'}
      />`);
  }
  return html`
    <g>
      <circle class="board-paper" cx="500" cy="500" r=${GEOM.hqOuter} />
      <circle class="board-band" cx="500" cy="500" r=${(GEOM.ringInner + GEOM.ringOuter) / 2}
              fill="none" stroke-width=${GEOM.ringOuter - GEOM.ringInner} />
      ${[0, 1, 2, 3, 4, 5].map((k) => {
        const angle = -90 + 60 * k;
        const a = polar(500, 500, (GEOM.ringInner + GEOM.ringOuter) / 2, angle);
        const b = polar(500, 500, GEOM.hubR, angle);
        return html`<line key=${k} class="board-band" x1=${round(a.x)} y1=${round(a.y)} x2=${round(b.x)} y2=${round(b.y)} stroke-width=${GEOM.spokeW} />`;
      })}
      ${hqs}
      ${ring}
      <circle class="board-paper" cx="500" cy="500" r=${GEOM.hubR} />
      <path class="board-star" d=${starPath(500, 500, 48, 20)} />
    </g>`;
}

// ---------------------------------------------------------------------------
// the track

function trackBase(spaces, cats, size) {
  const list = Object.values(spaces).sort((a, b) => (a.index || 0) - (b.index || 0));
  const line = list.map((space, i) => `${i ? 'L' : 'M'}${round(space.x)} ${round(space.y)}`).join(' ');
  return html`
    <g>
      <path class="board-thread" d=${line} fill="none" stroke-width=${Math.max(10, size * 0.12)} />
      ${list.map((space) => {
        const color = spaceColor(space, cats);
        const end = space.type === 'start' || space.type === 'finish';
        return html`
          <g key=${space.id}>
            <rect
              class="board-square-back"
              x=${round(space.x - size / 2)} y=${round(space.y - size / 2)}
              width=${round(size)} height=${round(size)} rx=${round(size * 0.26)}
            />
            <rect
              class=${end ? 'board-square is-end' : color ? 'board-square' : 'board-square is-again'}
              x=${round(space.x - size / 2)} y=${round(space.y - size / 2)}
              width=${round(size)} height=${round(size)} rx=${round(size * 0.26)}
              fill=${color || (end ? 'var(--stage)' : 'var(--rule)')}
              fill-opacity=${color ? 0.24 : 1}
              stroke=${color || 'var(--rule-strong)'}
            ><title>${spaceLabel(space, cats)}</title></rect>
            ${end ? html`
              <text class="board-end-label" x=${round(space.x)} y=${round(space.y)} text-anchor="middle"
                    dominant-baseline="central" font-size=${round(size * 0.24)}>${space.type === 'start' ? 'Start' : 'Finish'}</text>` : null}
          </g>`;
      })}
    </g>`;
}

/**
 * The box a track fills. The layout centres its rows in a 1000 by 1000 square, which leaves a
 * band of empty paper above and below on a phone, so the board is cropped to what it draws.
 */
function fitBox(spaces, size) {
  const list = Object.values(spaces);
  if (!list.length) return '0 0 1000 1000';
  const pad = size * 0.25 + size / 2;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const space of list) {
    minX = Math.min(minX, space.x - pad);
    minY = Math.min(minY, space.y - pad);
    maxX = Math.max(maxX, space.x + pad);
    maxY = Math.max(maxY, space.y + pad);
  }
  return `${round(minX)} ${round(minY)} ${round(maxX - minX)} ${round(maxY - minY)}`;
}

/** The square a track space gets: the gap between two neighbours, less a margin. */
function cellOf(spaces) {
  const a = spaces.t0;
  const b = spaces.t1;
  if (!a || !b) return 120;
  return Math.abs(b.x - a.x) * 0.78 || 120;
}

// ---------------------------------------------------------------------------
// destinations and tokens

/**
 * A legal destination: a dashed ring you can tap, or a dashed square on the track. When there
 * is more than one, each wears the same number as its chip, so three spaces of one colour
 * can still be told apart.
 */
function Destination({ space, cats, wheel, size, radius, number = null, onPick }) {
  const pick = () => onPick && onPick(space.id);
  const keyed = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    pick();
  };
  const big = space.type === 'hub';
  // A headquarters is drawn as an arc across the ring, so its ring is centred on the arc.
  const at = wheel && space.type === 'hq'
    ? polar(500, 500, (GEOM.ringInner + GEOM.hqOuter) / 2, space.angle)
    : space;
  const mark = wheel
    ? html`
      <${Fragment}>
        ${big ? null : html`
          <circle class="board-target" cx=${round(at.x)} cy=${round(at.y)} r=${round(radius * 0.66)}
                  fill=${spaceColor(space, cats) || 'var(--rule-strong)'} />`}
        <circle class="board-ring" cx=${round(at.x)} cy=${round(at.y)} r=${big ? GEOM.hubR + 12 : radius + 9} fill="none" />
      <//>`
    : html`<rect class="board-ring" x=${round(space.x - size / 2 - 9)} y=${round(space.y - size / 2 - 9)}
                 width=${round(size + 18)} height=${round(size + 18)} rx=${round(size * 0.3)} fill="none" />`;
  const ringR = wheel ? (big ? GEOM.hubR + 12 : radius + 9) : Math.hypot(size / 2 + 9, size / 2 + 9);
  const tag = number === null ? null : html`
    <${Fragment}>
      <circle class="board-num" cx=${round(at.x + ringR * 0.72)} cy=${round(at.y - ringR * 0.72)} r=${round(radius * 0.62)} />
      <text class="board-num-text" x=${round(at.x + ringR * 0.72)} y=${round(at.y - ringR * 0.72)}
            text-anchor="middle" dominant-baseline="central" font-size=${round(radius * 0.8)}>${number}</text>
    <//>`;
  return html`
    <g class="board-pick" role="button" tabindex="0" aria-label=${`Move to ${number === null ? '' : `${number}, `}${spaceLabel(space, cats)}`}
       onClick=${pick} onKeyDown=${keyed}>
      <circle cx=${round(at.x)} cy=${round(at.y)} r=${big ? GEOM.hubR : radius + 20} fill="transparent" />
      ${mark}
      ${tag}
    </g>`;
}

/** The ring round the space someone landed on, so the question has somewhere to point. */
function here(space, wheel, size, radius) {
  if (wheel) {
    return html`<circle class="board-here" cx=${round(space.x)} cy=${round(space.y)} r=${round(radius + 13)} fill="none" />`;
  }
  return html`
    <rect class="board-here" x=${round(space.x - size / 2 - 7)} y=${round(space.y - size / 2 - 7)}
          width=${round(size + 14)} height=${round(size + 14)} rx=${round(size * 0.3)} fill="none" />`;
}

/** Two tokens on one space sit either side of it; three or more take a small circle. */
function spread(space, index, count) {
  if (!space) return { x: 0, y: 0 };
  if (count < 2) return { x: space.x, y: space.y };
  const angle = -90 + (360 / count) * index;
  const at = polar(space.x, space.y, SPREAD, angle);
  return at;
}

/** The player whose token is walking, named by the move or found at its end. */
function moverOf(lastMove, players, positions) {
  if (!lastMove) return null;
  if (lastMove.playerId) return lastMove.playerId;
  const found = players.find((player) => positions[player.id] === lastMove.to);
  return found ? found.id : null;
}

/**
 * Walk the token along the last move, one space every 220 ms, and hand back the space it is
 * standing on right now. A move is walked once: the key remembers which one, so a poll that
 * brings the same move again does not replay it. Reduced motion goes straight to the end.
 * @param {{ from: string, to: string, path: string[] } | null} lastMove
 * @returns {string | null}
 */
function useWalk(lastMove) {
  const reduced = reducedMotion();
  const seen = useRef('');
  const [step, setStep] = useState(0);
  const path = (lastMove && lastMove.path) || [];
  const key = lastMove ? `${lastMove.from}>${lastMove.to}:${path.length}` : '';

  useEffect(() => {
    if (!key || seen.current === key) return undefined;
    seen.current = key;
    if (reduced || path.length < 2) { setStep(Math.max(0, path.length - 1)); return undefined; }
    setStep(0);
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= path.length - 1) clearInterval(timer);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [key, reduced]);

  if (!path.length) return null;
  // Before the effect has run, the token belongs at the start of the move, not at its end.
  const index = seen.current === key ? Math.min(step, path.length - 1) : 0;
  return path[index];
}

/** Whether this device has asked for less movement. Read once, when a board is first drawn. */
function reducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// geometry

/** An arc of a circle, as a path, going clockwise from one angle to another. */
function arcPath(cx, cy, r, from, to) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M${round(a.x)} ${round(a.y)}A${r} ${r} 0 ${large} 1 ${round(b.x)} ${round(b.y)}`;
}

/** A five pointed star, for the middle of the wheel. */
function starPath(cx, cy, outer, inner) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const at = polar(cx, cy, i % 2 ? inner : outer, -90 + i * 36);
    points.push(`${round(at.x)} ${round(at.y)}`);
  }
  return `M${points.join('L')}Z`;
}

/** Coordinates to two decimals: enough for a 1000 unit box, and shorter markup. */
function round(n) {
  return Math.round(n * 100) / 100;
}
