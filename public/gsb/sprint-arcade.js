// Arcade presentation helpers for the speed round: the flick gesture, the dealt piece that flies into a
// corner, corner flashes and floating labels, and the answer summary for the strip and the result.
// Nothing here decides an answer or touches the controller; the view calls choose() itself.
import { useEffect } from "../app/h.js";
import { visibleQuestionPrompt } from "./components.js";

const TARGET_AT = 26, COMMIT_AT = 70, FLICK_SPEED = 0.55, FLICK_MIN = 34;
export const FLY_MS = 240, LAND_OK_MS = 460, LAND_MISS_MS = 300;

/** Corner index for a drag vector: 0 top left, 1 top right, 2 bottom left, 3 bottom right. */
export function cornerOf(dx, dy) {
  if (Math.hypot(dx, dy) < TARGET_AT) return null;
  return (dy < 0 ? 0 : 2) + (dx < 0 ? 0 : 1);
}

/** Where an element currently sits, from its computed transform: a docked piece is picked up where it is. */
function offsetOf(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none" || typeof DOMMatrixReadOnly !== "function") return { x: 0, y: 0 };
  try { const m = new DOMMatrixReadOnly(t); return { x: m.e, y: m.f }; } catch { return { x: 0, y: 0 }; }
}

/**
 * Drag the piece toward a corner. The direction of the drag picks the corner, so a short flick is enough.
 * Corner buttons get data-state="target" while the drag points at them, without a re-render.
 * @param {{ current: HTMLElement | null }} pieceRef
 * @param {{ current: HTMLElement | null }} arenaRef
 * @param {(corner: number) => void} onCommit
 * @param {string} dep re-bind when this changes (the question id)
 * @param {{ canStart?: () => boolean, onRelease?: () => void, map?: (k: number) => number }} [options] a guard before a drag
 *   begins, what to do when one ends without a corner, and a corner-to-zone map (two doors take 0 or 1 from a side)
 */
export function useFlick(pieceRef, arenaRef, onCommit, dep, { canStart, onRelease, map = (k) => k } = {}) {
  useEffect(() => {
    const el = pieceRef.current;
    if (!el) return undefined;
    let drag = null;
    const zones = () => (arenaRef.current ? [...arenaRef.current.querySelectorAll(".zone")] : []);
    const paint = (k) => zones().forEach((z) => z.setAttribute("data-state", k !== null && Number(z.getAttribute("data-k")) === map(k) ? "target" : "idle"));
    const down = (e) => {
      if (e.button || (canStart && !canStart())) return;
      el.classList.remove("is-back", "is-fresh", "is-enter");
      const base = offsetOf(el);
      drag = { x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, bx: base.x, by: base.y, t0: performance.now(), id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      el.style.transition = "";
      el.classList.add("is-dragging");
      e.preventDefault();
    };
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dx = e.clientX - drag.x0; drag.dy = e.clientY - drag.y0;
      // Four-pixel steps keep the sprite on its grid.
      el.style.transform = `translate(${Math.round((drag.bx + drag.dx) / 4) * 4}px, ${Math.round((drag.by + drag.dy) / 4) * 4}px)`;
      paint(cornerOf(drag.dx, drag.dy));
    };
    const up = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      el.classList.remove("is-dragging");
      const dist = Math.hypot(d.dx, d.dy), speed = dist / Math.max(1, performance.now() - d.t0);
      const k = cornerOf(d.dx, d.dy);
      paint(null);
      if (k !== null && (dist >= COMMIT_AT || (speed > FLICK_SPEED && dist >= FLICK_MIN))) { onCommit(map(k)); return; }
      el.classList.add("is-back");
      el.style.transform = "";
      onRelease?.();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      paint(null);
    };
  }, [dep]);
}

const rel = (el, root) => {
  const p = root.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height };
};

/**
 * A copy of the piece flies from where it is into the corner, shrinks to fit it, then hops twice and fades
 * (a hit) or shakes and fades (a miss). Lives in the fx layer, so the next question renders underneath at once.
 * @param {HTMLElement} fx the fx layer, positioned over the arena
 * @param {HTMLElement} piece the current piece element
 * @param {HTMLElement} zone the corner button
 * @param {boolean} right
 */
export function dealPiece(fx, piece, zone, right) {
  const from = rel(piece, fx), to = rel(zone, fx);
  const ghost = piece.cloneNode(true);
  if (!(ghost instanceof HTMLElement)) return;
  ghost.className = "dealt";
  ghost.style.cssText = `left:${from.x}px;top:${from.y}px;width:${from.w}px;height:${from.h}px;transform:none`;
  fx.appendChild(ghost);
  const s = Math.min(1, to.w / from.w, to.h / from.h);
  const dx = to.x + to.w / 2 - (from.x + from.w / 2), dy = to.y + to.h / 2 - (from.y + from.h / 2);
  requestAnimationFrame(() => requestAnimationFrame(() => { ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`; }));
  setTimeout(() => ghost.classList.add(right ? "landed-ok" : "landed-no"), FLY_MS - 40);
  setTimeout(() => ghost.remove(), FLY_MS - 40 + (right ? LAND_OK_MS : LAND_MISS_MS));
}

/** The corner lights green or red under whatever it holds next. */
export function flashZone(zone, right) {
  zone.setAttribute("data-flash", right ? "right" : "wrong");
  setTimeout(() => { if (zone.getAttribute("data-flash")) zone.removeAttribute("data-flash"); }, 720);
}

/** A short label rises from the corner: a tick with the name, or a cross. */
export function floater(fx, zone, text, right) {
  const c = rel(zone, fx);
  const el = document.createElement("div");
  el.className = `floater ${right ? "ok" : "no"}`;
  el.textContent = text;
  el.style.left = `${c.x + c.w / 2}px`;
  el.style.top = `${c.y + c.h / 2}px`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 820);
}

export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

/** The correct person's name and portrait source for a question in either direction. */
export function targetOf(question) {
  const correct = question.choices[Number(question.correctChoice)];
  if (question.direction === "face") return { name: correct?.label || "", image: question.image };
  return { name: visibleQuestionPrompt(question), image: correct?.image || null };
}

/**
 * What happened on each answered question, newest first, with what was picked on a miss.
 * @param {{ questions: any[] }} round
 * @param {{ questionId: string, choice: string }[]} answers
 * @param {Map<string, string> | undefined} photoUrls
 */
export function answerSummary(round, answers, photoUrls) {
  const url = (src) => (photoUrls && src ? photoUrls.get(src) || null : null);
  return answers.map((a, i) => {
    const q = round.questions[i], t = targetOf(q), pick = q.choices[Number(a.choice)], ok = a.choice === q.correctChoice;
    return {
      id: q.id, ok, name: t.name, thumb: url(t.image),
      pickedName: !ok && q.direction === "face" ? pick?.label || "" : "",
      pickedThumb: !ok && q.direction === "name" ? url(pick?.image) : null,
    };
  }).reverse();
}

const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

/**
 * The opening tour: the piece glides a little toward each corner in turn and that corner lights up,
 * so the first question shows what a flick does. Returns a cancel function; skipped under reduced motion.
 * @param {HTMLElement} piece
 * @param {HTMLElement[]} zones
 */
export function introTour(piece, zones) {
  if (!zones.length || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return () => {};
  const timers = [];
  let cancelled = false, i = 0;
  const order = [0, 1, 3, 2];
  const light = (k) => zones.forEach((z) => z.setAttribute("data-state", Number(z.getAttribute("data-k")) === k ? "target" : "idle"));
  const reset = () => { piece.style.transition = ""; piece.style.transform = ""; light(null); };
  const step = () => {
    if (cancelled) return;
    piece.classList.remove("is-enter");
    if (i >= order.length) { piece.style.transform = ""; light(null); timers.push(setTimeout(() => { piece.style.transition = ""; }, 300)); return; }
    const k = order[i++], [sx, sy] = CORNERS[k];
    // A springy hop toward each corner in turn: quick, with an overshoot, so it reads as "this moves".
    piece.style.transition = "transform 230ms cubic-bezier(0.34, 1.65, 0.5, 1)";
    piece.style.transform = `translate(${sx * 44}px, ${sy * 36}px)`;
    light(k);
    timers.push(setTimeout(step, 300));
  };
  timers.push(setTimeout(step, 220));
  return () => { if (cancelled) return; cancelled = true; timers.forEach(clearTimeout); reset(); };
}
