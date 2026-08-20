/**
 * The shared visual language, assembled from the tokens.
 *
 * Every colour in the app resolves to `src/ui/tokens.js`. Screens must not hard-code
 * hex values — `tests/no-hardcoded-colours.test.js` enforces that, because the rule
 * was stated here for a long time and quietly broken 58 times.
 */

import { clamp } from '../sim/index.js';

import { accAlpha, horizonGlowAlpha, shadowAlpha, smokeAlpha, strip, tokens } from './tokens.js';

const T = {
  bg: tokens.bg,
  panel: tokens.panel,
  panel2: tokens.panel2,
  panel3: tokens.panel3,
  panelHi: tokens.panel3,
  line: tokens.line,
  lineHi: tokens.lineHi,

  ink: tokens.ink,
  inkSoft: tokens.inkSoft,
  ink2: tokens.ink2,
  ink3: tokens.ink3,

  acc: tokens.acc,
  accInk: tokens.accInk,
  accBg: tokens.accBg,
  accOn: tokens.accOn,

  ok: tokens.ok,
  okInk: tokens.okInk,
  okBg: tokens.okBg,
  warn: tokens.warn,
  warnInk: tokens.warnInk,
  warnBg: tokens.warnBg,
  danger: tokens.danger,
  dangerInk: tokens.dangerInk,
  dangerBg: tokens.dangerBg,

  okLine: tokens.okLine,
  warnLine: tokens.warnLine,
  dangerLine: tokens.dangerLine,
  violetLine: tokens.violetLine,

  cyan: tokens.cyan,
  cyanBg: tokens.cyanBg,
  violet: tokens.violet,
  violetBg: tokens.violetBg,

  mono: tokens.mono,
  sans: tokens.sans,
};

/** Maps a 0-100 health/quality value onto the green/amber/red status scale. */
export const statusColor = (v) => (v >= 90 ? T.ok : v >= 55 ? T.warn : T.danger);

/**
 * Status colour for a value where HIGH is the dangerous end: injector duty cycle,
 * or any "how much of the available capacity is spent" reading.
 *
 * Deliberately NOT the mirror image of `statusColor`. Health and utilisation are
 * different judgements about different quantities: 55% health is already poor,
 * while 55% duty is an ordinary cruise load. Mirroring the health bands would paint
 * everything above 45% duty as an alarm and could not tell a comfortable 60% from a
 * lean-out-imminent 90%.
 *
 * The bands come from the app's own long-standing duty readout — a real injector is
 * sized so that sustained duty above ~90% has no headroom left for the next
 * enrichment the ECU asks for.
 *
 * These bands are copied exactly — thresholds and comparison operators — from the
 * inline duty preview in `EcuLab.jsx`. That copy is still there because this PR does
 * not migrate screens. When that panel moves onto `Bar`, delete the inline version
 * and call this instead; until then the two must be changed together.
 *
 * @param {number} v 0-100
 * @returns {string} a status colour
 */
export const utilisationColor = (v) => (v > 90 ? T.danger : v > 75 ? T.warn : T.ok);

/**
 * Heat-map colour for a table cell, cool (low) through warm (high).
 *
 * Deliberately its own ramp rather than the status scale: a hot VE cell is not a
 * fault, and it must never compete visually with a real warning.
 *
 * @param {number} value cell value
 * @param {number} min low end of the scale
 * @param {number} max high end of the scale
 * @returns {string} an hsl() colour
 */
function heat(value, min, max) {
  const t = clamp((value - min) / (max - min), 0, 1);
  const hue = 214 - t * 214;
  return `hsl(${hue.toFixed(0)}, 68%, ${26 + t * 12}%)`;
}

/**
 * Diverging colour for a SIGNED delta: warm for positive, cool for negative, with
 * intensity carrying magnitude.
 *
 * Distinct from `heat()`, which is a one-directional ramp for an absolute cell value.
 * A delta has a sign that means something — richer vs leaner, advanced vs retarded —
 * so it needs a scale that reads outward from a neutral middle rather than along a line.
 *
 * @param {number} delta signed difference
 * @param {number} [fullScale] magnitude at which the colour saturates
 * @returns {string} an hsl() colour
 */
function deltaHeat(delta, fullScale = 12) {
  const mag = clamp(Math.abs(delta) / fullScale, 0, 1);
  return `hsl(${delta > 0 ? 8 : 200}, 60%, ${14 + mag * 22}%)`;
}

export { T, accAlpha, deltaHeat, heat, horizonGlowAlpha, shadowAlpha, smokeAlpha, strip };
