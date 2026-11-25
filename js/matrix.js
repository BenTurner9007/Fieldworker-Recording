// Stratigraphic checks: missing contexts, loops (A above B above A), and a
// simple phasing of contexts into levels from latest (top) to earliest (bottom).
import { LATER_THAN, RECIPROCAL } from './schema.js';

/** Build "later -> earlier" edges from every context's relationships. */
function edges(contexts) {
  const out = new Map(contexts.map((c) => [String(c.number), new Set()]));
  const add = (later, earlier) => {
    if (!out.has(later)) out.set(later, new Set());
    if (!out.has(earlier)) out.set(earlier, new Set());
    out.get(later).add(earlier);
  };
  for (const c of contexts) {
    const me = String(c.number);
    for (const { rel, target } of c.relationships || []) {
      const t = String(target);
      if (LATER_THAN.includes(rel)) add(me, t);
      else if (LATER_THAN.includes(RECIPROCAL[rel])) add(t, me);
    }
  }
  return out;
}

export function checkMatrix(contexts) {
  const known = new Set(contexts.map((c) => String(c.number)));
  const graph = edges(contexts);

  const missing = [...graph.keys()].filter((n) => !known.has(n)).sort((a, b) => a - b);

  // Cycle detection (DFS with colours)
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (n) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n)) {
      if (state.get(m) === 1) {
        cycles.push([...stack.slice(stack.indexOf(m)), m]);
      } else if (!state.get(m)) {
        visit(m);
      }
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of graph.keys()) if (!state.get(n)) visit(n);

  // Levels: longest path from any top context (only meaningful with no cycles)
  let levels = [];
  if (!cycles.length) {
    const depth = new Map();
    const d = (n) => {
      if (depth.has(n)) return depth.get(n);
      depth.set(n, 0);
      let best = 0;
      for (const [k, kids] of graph) if (kids.has(n)) best = Math.max(best, d(k) + 1);
      depth.set(n, best);
      return best;
    };
    for (const n of graph.keys()) d(n);
    for (const [n, lv] of depth) (levels[lv] ||= []).push(n);
    levels = levels.map((l) => (l || []).sort((a, b) => a - b));
  }

  const isolated = contexts
    .filter((c) => !(c.relationships || []).length)
    .map((c) => String(c.number))
    .filter((n) => ![...graph.values()].some((s) => s.has(n)));

  return { missing, cycles, levels, isolated };
}
