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

/**
 * The NAME of the band a 0-100 health/quality value falls into, for consumers that
 * take a semantic tone rather than a colour — `StatTile`, and anything else with a
 * token-driven variant.
 *
 * The single source of truth for where the bands sit. `statusColor` below maps this
 * tone onto a colour rather than repeating the thresholds, because two copies of a
 * band drift apart and then disagree about whether the same number is a warning.
 *
 * @param {number} v 0-100
 * @returns {'ok'|'warn'|'danger'}
 */
export const statusTone = (v) => (v >= 90 ? 'ok' : v >= 55 ? 'warn' : 'danger');

/** Maps a 0-100 health/quality value onto the green/amber/red status scale. */
export const statusColor = (v) => T[statusTone(v)];

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
 * The bands live here alone — the injector duty preview and the tachometer's redline
 * zone in `EcuLab.jsx` both call this instead of re-testing the thresholds inline. Do
 * not let a new inline copy creep back in; change the bands here.
 *
 * Returns the NAME rather than the colour, because a caller may need either and only
 * one of the two can be derived from the other. `StatTile` takes a tone name, and the
 * alternative was comparing a returned colour against `T.danger` — which `DataScreen`
 * actually did. Same shape as `statusTone`/`statusColor` above.
 *
 * @param {number} v 0-100, percent of the available capacity spent
 * @returns {'ok'|'warn'|'danger'}
 */
export const utilisationTone = (v) => (v > 90 ? 'danger' : v > 75 ? 'warn' : 'ok');

/** The same judgement as `utilisationTone`, as a colour. See it for the bands. */
export const utilisationColor = (v) => T[utilisationTone(v)];

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

// The hues of T.violet and T.cyan, so the overlay reads as the app's secondary data
// colours. Neither is near a status hue (ok ~150, warn ~39, danger 0) or the accent
// (~213); tests/theme.test.js holds them to that.
const DIFF_UP_HUE = 255;
const DIFF_DOWN_HUE = 188;

/**
 * Tint for a cell's change from the loaded calibration (issue 106): violet up, cyan down,
 * brighter with magnitude up to `fullScale`.
 *
 * Not `deltaHeat`: that one's warm half sits on red, and a table the player has simply
 * edited must never look like a fault. The floor keeps the smallest change distinct
 * from an unchanged cell, which is drawn on `T.panel2` instead of through this.
 *
 * @param {number} delta signed change, non-zero
 * @param {number} fullScale magnitude at which the colour stops brightening
 * @returns {string} an hsl() colour
 */
function diffTint(delta, fullScale) {
  const mag = clamp(Math.abs(delta) / fullScale, 0, 1);
  return `hsl(${delta > 0 ? DIFF_UP_HUE : DIFF_DOWN_HUE}, 55%, ${(20 + mag * 20).toFixed(0)}%)`;
}

export { T, accAlpha, deltaHeat, diffTint, heat, horizonGlowAlpha, shadowAlpha, smokeAlpha, strip };
