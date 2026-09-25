/**
 * The shape every ECU calibration table takes, and how the ECU reads one.
 *
 * The three original tables (VE, spark, AFR) are indexed on the app-wide `RPM` × `LOAD`
 * axes and stay that way. Everything added by the engine management layer carries its
 * OWN axes, as a real ECU's tables do: a warm-up table is indexed on coolant temperature,
 * a dead-time table on battery voltage, and forcing those onto RPM × MAP would be the
 * wrong dimension, not a simplification. Owning the axes is also what lets the table
 * editor let a tuner move breakpoints.
 *
 *   1D: { x: number[], z: number[] }            a curve, z[i] at x[i]
 *   2D: { x: number[], y: number[], z: number[][] }   z[yi][xi], rows are y
 *
 * Axes ascend. Reads clamp at the ends and interpolate between breakpoints, like
 * `interp1`/`interp2` and like every production ECU.
 */

import { clamp, interp1 } from '../math.js';

/**
 * @typedef {{x: number[], z: number[]}} Curve
 * @typedef {{x: number[], y: number[], z: number[][]}} Map2D
 * @typedef {Curve|Map2D} EcuTable
 */

/**
 * Reads a curve at x.
 * @param {Curve} t
 * @param {number} x
 * @returns {number}
 */
export function read1(t, x) {
  return interp1(t.x, t.z, x);
}

/**
 * Reads a 2D map at (x, y).
 * @param {Map2D} t
 * @param {number} x column axis value
 * @param {number} y row axis value
 * @returns {number}
 */
export function read2(t, x, y) {
  const col = t.z.map((row) => interp1(t.x, row, x));
  return interp1(t.y, col, y);
}

/**
 * Where an axis value falls between breakpoints — the cell the ECU is reading and how
 * far across it. Drives the table editor's live operating-point marker.
 *
 * @param {number[]} axis ascending breakpoints
 * @param {number} v
 * @returns {{i: number, f: number}} lower breakpoint index and fraction toward the next
 */
export function axisPosition(axis, v) {
  if (v <= axis[0]) return { i: 0, f: 0 };
  const last = axis.length - 1;
  if (v >= axis[last]) return { i: Math.max(0, last - 1), f: last === 0 ? 0 : 1 };
  for (let i = 0; i < last; i++) {
    if (v >= axis[i] && v <= axis[i + 1]) {
      return { i, f: clamp((v - axis[i]) / (axis[i + 1] - axis[i]), 0, 1) };
    }
  }
  return { i: 0, f: 0 };
}

/**
 * A curve filled from a function of its axis.
 * @param {number[]} x
 * @param {(x: number) => number} fn
 * @returns {Curve}
 */
export function curve(x, fn) {
  return { x: [...x], z: x.map((v) => round4(fn(v))) };
}

/**
 * A 2D map filled from a function of both axes.
 * @param {number[]} x columns
 * @param {number[]} y rows
 * @param {(x: number, y: number) => number} fn
 * @returns {Map2D}
 */
export function map2(x, y, fn) {
  return { x: [...x], y: [...y], z: y.map((yv) => x.map((xv) => round4(fn(xv, yv)))) };
}

/** @param {number} v */
function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}
