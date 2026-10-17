/**
 * Small math helpers shared across the simulation.
 *
 * Depends only on `tables.js` (for the table axes), which itself imports nothing —
 * so this sits at the bottom of the dependency graph and every other module can
 * import from it without creating a cycle.
 */

import { LOAD, RPM } from './tables.js';

/**
 * Deep-copies a 2D array of numbers.
 * @param {number[][]} arr
 * @returns {number[][]}
 */
export const clone2D = (arr) => arr.map((r) => [...r]);

/**
 * Constrains a value to an inclusive range.
 * @param {number} v value
 * @param {number} lo lower bound
 * @param {number} hi upper bound
 * @returns {number}
 */
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Linear interpolation across a set of breakpoints, clamped at both ends.
 *
 * Real ECUs interpolate between table breakpoints rather than snapping to the
 * nearest cell, which is why this is used everywhere a table is read.
 *
 * @param {number[]} bp ascending breakpoints
 * @param {number[]} vals values at each breakpoint (same length as `bp`)
 * @param {number} x point to evaluate
 * @returns {number}
 */
export function interp1(bp, vals, x) {
  if (x <= bp[0]) return vals[0];
  if (x >= bp[bp.length - 1]) return vals[vals.length - 1];
  for (let i = 0; i < bp.length - 1; i++) {
    if (x >= bp[i] && x <= bp[i + 1]) {
      const t = (x - bp[i]) / (bp[i + 1] - bp[i]);
      return vals[i] + t * (vals[i + 1] - vals[i]);
    }
  }
  return vals[vals.length - 1];
}

// LOAD descends (200 -> 20) but interp1 needs ascending breakpoints. Hoisted to
// module scope because interp2 sits on the hottest path in the app — the dyno sweep
// calls it three times per RPM step — and rebuilding these arrays per call was pure
// garbage-collector pressure.
const LOAD_ASC = [...LOAD].reverse();

/**
 * 2D interpolation across both RPM and load.
 *
 * @param {number[][]} table rows indexed by LOAD, columns by RPM
 * @param {number} rpm engine speed
 * @param {number} loadKpa manifold absolute pressure, kPa
 * @returns {number}
 */
export function interp2(table, rpm, loadKpa) {
  const rowVals = LOAD.map((_, ri) => interp1(RPM, table[ri], rpm));
  return interp1(LOAD_ASC, rowVals.reverse(), loadKpa);
}

/**
 * Groups consecutive points matching a predicate into runs.
 *
 * Used by the pull log so that "knock from 4200–5600 RPM" is reported as one event
 * rather than fifteen separate ones.
 *
 * @template T
 * @param {T[]} points
 * @param {(p: T) => boolean} predicate
 * @returns {T[][]} one array per contiguous run
 */
export function groupRuns(points, predicate) {
  const runs = [];
  let current = null;
  points.forEach((p, i) => {
    if (predicate(p)) { if (!current) current = { start: i, end: i }; else current.end = i; }
    else if (current) { runs.push(current); current = null; }
  });
  if (current) runs.push(current);
  return runs.map((r) => points.slice(r.start, r.end + 1));
}

/**
 * Joins runs of points separated by a small gap into one, marking the result
 * `intermittent` — how borderline knock looks on a log: on, off, on again.
 * @param {object[][]} runs
 * @param {number} gapRpm
 * @returns {object[][]}
 */
export function mergeNearbyRuns(runs, gapRpm) {
  const out = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (prev && run[0].rpm - prev[prev.length - 1].rpm <= gapRpm) {
      const merged = Object.assign([...prev, ...run], { intermittent: true });
      out[out.length - 1] = merged;
    } else out.push(run);
  }
  return out;
}
