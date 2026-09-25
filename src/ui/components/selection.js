/**
 * What a `TuningGrid` selection covers, and the words for what an edit did to it.
 *
 * Every selection type — a cell, a row, a column or a range — resolves to one ordered
 * rectangle, and everything that EDITS works on that rectangle through the ops in
 * `src/sim/tables.js`. Only the grid's highlight, the dock's title and the advisor care
 * which type it was.
 *
 * Shared by `TuningGrid`, `SelectionDock` and `advisorReports.js`, so it lives beside
 * them rather than inside any one.
 */

import { LOAD, RPM, orderRect } from '../../sim/index.js';

/**
 * @typedef {{type: 'cell', row: number, col: number}
 *   | {type: 'row', row: number}
 *   | {type: 'col', col: number}
 *   | {type: 'range', r1: number, c1: number, r2: number, c2: number}} Selection
 *   A range's (r1, c1) is its anchor — the corner a drag or shift-click started from —
 *   so its corners are NOT necessarily ordered. `rectOf` orders them.
 */
/** @typedef {import('../../sim/tables.js').Rect} Rect */

/**
 * @param {Selection} selection
 * @returns {Rect}
 */
export function rectOf(selection) {
  if (selection.type === 'cell') return { r1: selection.row, c1: selection.col, r2: selection.row, c2: selection.col };
  if (selection.type === 'row') return { r1: selection.row, c1: 0, r2: selection.row, c2: RPM.length - 1 };
  if (selection.type === 'col') return { r1: 0, c1: selection.col, r2: LOAD.length - 1, c2: selection.col };
  return orderRect(selection);
}

/**
 * @param {Rect} rect ordered
 * @param {number} ri
 * @param {number} ci
 * @returns {boolean}
 */
export const inRect = (rect, ri, ci) => ri >= rect.r1 && ri <= rect.r2 && ci >= rect.c1 && ci <= rect.c2;

/**
 * @param {Rect} rect ordered
 * @returns {number}
 */
export const cellCount = (rect) => (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);

/**
 * The corner a shift-click or shift+arrow extends FROM.
 * @param {Selection} selection
 * @returns {{r: number, c: number}}
 */
export function anchorOf(selection) {
  if (selection.type === 'cell') return { r: selection.row, c: selection.col };
  if (selection.type === 'range') return { r: selection.r1, c: selection.c1 };
  if (selection.type === 'row') return { r: selection.row, c: 0 };
  return { r: 0, c: selection.col };
}

/**
 * The selection running from `anchor` to `end`. A plain cell when the two coincide —
 * unless `forceRange`, which SELECT RANGE mode uses so its first tap reads as the start
 * of a range rather than an ordinary cell.
 * @param {{r: number, c: number}} anchor
 * @param {{r: number, c: number}} end
 * @param {boolean} [forceRange]
 * @returns {Selection}
 */
export function spanSelection(anchor, end, forceRange = false) {
  if (!forceRange && anchor.r === end.r && anchor.c === end.c) return { type: 'cell', row: end.r, col: end.c };
  return { type: 'range', r1: anchor.r, c1: anchor.c, r2: end.r, c2: end.c };
}

/**
 * A string that changes whenever the selection does — the dock's "is this a new
 * selection?" test, and why a new rectangle drops a stale slider draft.
 * @param {Selection|null} selection
 * @returns {string}
 */
export function selectionKey(selection) {
  if (!selection) return '';
  if (selection.type === 'range') return `range:${selection.r1}:${selection.c1}:${selection.r2}:${selection.c2}`;
  return `${selection.type}:${selection.type === 'col' ? '' : selection.row}:${selection.type === 'row' ? '' : selection.col}`;
}

/**
 * The fine and coarse nudge for a table, shared by the dock's steppers and the grid's
 * `+`/`-` keys so the two can never disagree.
 * @param {number} decimals
 * @returns {{small: number, big: number}}
 */
export const stepsFor = (decimals) => (decimals ? { small: 0.1, big: 1 } : { small: 1, big: 5 });

/**
 * @param {number} n
 * @returns {string}
 */
export const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

/**
 * An undo label for an op that changed `n` cells — which, for REVERT, is fewer than
 * the selection holds: only the cells that differed moved.
 * @param {string} desc
 * @param {number} n
 * @returns {string}
 */
export const countLabel = (desc, n) => `${desc} · ${n} ${n === 1 ? 'cell' : 'cells'}`;

/**
 * The undo label's detail: what was done, and to how many cells.
 * @param {string} desc
 * @param {Rect} rect ordered
 * @returns {string}
 */
export function opLabel(desc, rect) {
  return countLabel(desc, cellCount(rect));
}

/**
 * A cell's change as the CHANGES view prints it, at the grid's precision. A real change
 * that rounds away (a VE cell off by 0.3 at 0 dp) reads "~0" rather than "+0", so it is
 * never mistaken for no change at all.
 * @param {number} delta from `diffTable`, so exactly 0 when unchanged
 * @param {number} decimals the grid's display precision
 * @returns {string}
 */
export function formatDelta(delta, decimals) {
  if (delta === 0) return '·';
  const s = delta.toFixed(decimals);
  if (Number(s) === 0) return '~0';
  return delta > 0 ? `+${s}` : s;
}
