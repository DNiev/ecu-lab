/**
 * The table editor's operations, as pure functions over a table and a selection so they
 * can be tested without rendering anything.
 *
 * A table is `{x, z}` (a curve) or `{x, y, z}` (a map, `z[row][col]`, rows on `y`). A
 * selection is a rectangle of cells `{r1, c1, r2, c2}`, inclusive, rows first; a curve
 * has one row, row 0.
 */

/**
 * @typedef {{x: number[], y?: number[], z: number[]|number[][]}} Table
 * @typedef {{r1: number, c1: number, r2: number, c2: number}} Rect
 */

/** @param {Table} t @returns {number[][]} */
export const rowsOf = (t) => (Array.isArray(t.y) ? /** @type {number[][]} */ (t.z) : [/** @type {number[]} */ (t.z)]);

/**
 * Rebuilds a table of the same shape from rows.
 * @param {Table} t
 * @param {number[][]} rows
 * @returns {Table}
 */
export function withRows(t, rows) {
  return Array.isArray(t.y) ? { ...t, z: rows } : { ...t, z: rows[0] };
}

/** @param {Rect} s @returns {Rect} */
export const norm = (s) => ({
  r1: Math.min(s.r1, s.r2), r2: Math.max(s.r1, s.r2),
  c1: Math.min(s.c1, s.c2), c2: Math.max(s.c1, s.c2),
});

/** @param {Rect} s @param {number} r @param {number} c */
export const inRect = (s, r, c) => {
  const n = norm(s);
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
};

/**
 * Applies a per-cell function inside the selection, clamping to the field's range and
 * rounding to its step.
 * @param {Table} t
 * @param {Rect} sel
 * @param {(v: number, r: number, c: number) => number} fn
 * @param {{min?: number, max?: number, decimals?: number}} lim
 * @returns {Table}
 */
export function mapCells(t, sel, fn, lim) {
  const n = norm(sel);
  const p = 10 ** (lim.decimals ?? 0);
  const rows = rowsOf(t).map((row, r) => row.map((v, c) => {
    if (r < n.r1 || r > n.r2 || c < n.c1 || c > n.c2) return v;
    const next = fn(v, r, c);
    const clamped = Math.min(lim.max ?? Infinity, Math.max(lim.min ?? -Infinity, next));
    return Math.round(clamped * p) / p;
  }));
  return withRows(t, rows);
}

/**
 * Fills the selection by linear interpolation from its edges: across columns for a one-
 * row selection, down rows for a one-column one, and bilinearly from the four corners
 * for a rectangle. What a tuner does to a region between two cells they trust.
 * @param {Table} t
 * @param {Rect} sel
 * @param {object} lim
 * @returns {Table}
 */
export function interpolate(t, sel, lim) {
  const n = norm(sel);
  const rows = rowsOf(t);
  const tl = rows[n.r1][n.c1], tr = rows[n.r1][n.c2], bl = rows[n.r2][n.c1], br = rows[n.r2][n.c2];
  const w = n.c2 - n.c1, h = n.r2 - n.r1;
  return mapCells(t, sel, (v, r, c) => {
    const fx = w ? (c - n.c1) / w : 0;
    const fy = h ? (r - n.r1) / h : 0;
    if (!h) return tl + (tr - tl) * fx;
    if (!w) return tl + (bl - tl) * fy;
    const top = tl + (tr - tl) * fx;
    const bot = bl + (br - bl) * fx;
    return top + (bot - top) * fy;
  }, lim);
}

/**
 * Smooths the selection: each cell toward the mean of itself and its neighbours inside
 * the table. The step a tuner takes after logging, to take the noise out of a surface.
 * @param {Table} t
 * @param {Rect} sel
 * @param {object} lim
 * @returns {Table}
 */
export function smooth(t, sel, lim) {
  const rows = rowsOf(t);
  return mapCells(t, sel, (v, r, c) => {
    let s = 0, k = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rows[rr] && rows[rr][cc] != null) { s += rows[rr][cc] * (dr === 0 && dc === 0 ? 2 : 1); k += dr === 0 && dc === 0 ? 2 : 1; }
      }
    }
    return s / k;
  }, lim);
}

/**
 * The selected block of values.
 * @param {Table} t
 * @param {Rect} sel
 * @returns {number[][]}
 */
export function copyBlock(t, sel) {
  const n = norm(sel);
  return rowsOf(t).slice(n.r1, n.r2 + 1).map((row) => row.slice(n.c1, n.c2 + 1));
}

/**
 * Pastes a block with its top-left at the selection's top-left, clipped to the table.
 * @param {Table} t
 * @param {Rect} sel
 * @param {number[][]} block
 * @param {object} lim
 * @returns {Table}
 */
export function pasteBlock(t, sel, block, lim) {
  const n = norm(sel);
  const rows = rowsOf(t);
  const area = {
    r1: n.r1, c1: n.c1,
    r2: Math.min(rows.length - 1, n.r1 + block.length - 1),
    c2: Math.min(rows[0].length - 1, n.c1 + block[0].length - 1),
  };
  return mapCells(t, area, (v, r, c) => block[r - n.r1][c - n.c1], lim);
}

/**
 * Replaces one axis breakpoint, keeping the axis strictly ascending — an ECU reads a
 * table by searching its axis, and a breakpoint out of order makes part of the table
 * unreachable.
 * @param {Table} t
 * @param {'x'|'y'} axis
 * @param {number} i
 * @param {number} value
 * @returns {Table|null} the new table, or null when the value would break the order
 */
export function setBreakpoint(t, axis, i, value) {
  const a = [...t[axis]];
  if (!Number.isFinite(value)) return null;
  if (i > 0 && value <= a[i - 1]) return null;
  if (i < a.length - 1 && value >= a[i + 1]) return null;
  a[i] = value;
  return { ...t, [axis]: a };
}

/**
 * Whether two tables hold the same numbers on the same axes.
 * @param {Table} a
 * @param {Table} b
 */
export function sameTable(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Tab-separated text of a block, for the system clipboard — pastes straight into a
 * spreadsheet, and back.
 * @param {number[][]} block
 */
export const blockToText = (block) => block.map((r) => r.join('\t')).join('\n');

/**
 * @param {string} text
 * @returns {number[][]|null}
 */
export function textToBlock(text) {
  const rows = text.trim().split(/\r?\n/).map((l) => l.trim().split(/[\t,; ]+/).map(Number));
  if (!rows.length || rows.some((r) => r.some((v) => !Number.isFinite(v)))) return null;
  const w = rows[0].length;
  return rows.every((r) => r.length === w) ? rows : null;
}
