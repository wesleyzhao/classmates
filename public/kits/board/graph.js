// Movement on a board graph, shared by the rules (which spaces are legal) and the screen (which
// spaces to highlight). A layout provides `spaces` (id -> space) and `adj` (id -> neighbour ids;
// directed for one-way tracks, symmetric for the wheel). Everything here is pure.

/**
 * @typedef {{ id: string, kind: string, type: 'start' | 'cat' | 'hq' | 'again' | 'hub' | 'finish', cat: number | null, x: number, y: number, angle?: number, index?: number }} Space
 * @typedef {{ id: string, viewBox: string, spaces: Record<string, Space>, adj: Record<string, string[]>, start: string, categoriesNeeded: number, end: string | null }} Layout
 */

/**
 * Every space reachable in exactly `n` steps without visiting a space twice within the move
 * ("no doubling back"). Branching happens where the graph branches. With `stopAtEnd`, the layout's
 * end space (the hub, the finish line) is also offered when it is reached in fewer steps, which is
 * the relaxed house rule that keeps endgames short.
 * @param {Layout} layout
 * @param {string} from
 * @param {number} n
 * @param {{ stopAtEnd?: boolean }} [opts]
 * @returns {Array<{ to: string, path: string[] }>}  path starts with `from` and ends with `to`
 */
export function reachable(layout, from, n, opts = {}) {
  if (!layout.spaces[from]) throw new Error(`Unknown space ${from}`);
  const results = new Map();
  const path = [from];
  const visited = new Set([from]);
  const end = layout.end;
  const walk = (node, depth) => {
    if (depth === n) { if (!results.has(node)) results.set(node, path.slice()); return; }
    if (opts.stopAtEnd && end && node === end && depth > 0 && !results.has(end)) results.set(end, path.slice());
    const nexts = layout.adj[node] || [];
    if (!nexts.length && opts.stopAtEnd && end && node === end && !results.has(end)) results.set(end, path.slice());
    for (const nb of nexts) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      path.push(nb);
      walk(nb, depth + 1);
      path.pop();
      visited.delete(nb);
    }
  };
  walk(from, 0);
  const rank = (id) => (id === end ? -1 : layout.spaces[id].kind === 'spoke' ? 1 : 2);
  return [...results].map(([to, p]) => ({ to, path: p })).sort((a, b) => rank(a.to) - rank(b.to) || a.to.localeCompare(b.to));
}

/** Polar helper for layouts: a point at radius r and angle deg around the centre. */
export function polar(cx, cy, r, deg) {
  const t = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
}
