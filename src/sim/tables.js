/**
 * The calibration data the player edits, and the axes it is indexed by.
 *
 * These are starting points, not physics. A stock calibration is deliberately a
 * mediocre one — the whole exercise is improving on it.
 */

/** RPM axis (table columns). 800 is the idle breakpoint. */
export const RPM = [800, 1500, 2500, 3500, 4500, 5500, 6500, 7500];

/**
 * Load axis (table rows) = MANIFOLD ABSOLUTE PRESSURE in kPa.
 *
 * This is the axis real speed-density ECUs actually use — HP Tuners indexes VE by
 * RPM × MAP. Throttle-percentage indexing is "Alpha-N", the uncommon older method.
 * ~101 kPa is atmospheric, so the top two rows are only reached under boost, and the
 * low rows are part-throttle vacuum.
 */
export const LOAD = [200, 150, 100, 70, 40, 20];

/** Stock volumetric efficiency table, percent. */
export const DEFAULT_VE = [
  [60, 70, 84, 95, 104, 101, 94, 84],
  [58, 68, 82, 93, 102, 99, 92, 82],
  [55, 65, 78, 88, 96, 92, 85, 75],
  [49, 58, 70, 80, 87, 84, 77, 68],
  [38, 45, 55, 63, 69, 66, 61, 53],
  [29, 34, 42, 48, 52, 50, 46, 40],
];

/**
 * The range a spark table cell can hold, degrees BTDC.
 *
 * Defined here, next to the table itself, because THREE places need to agree on it and
 * two of them used to be wrong. The editable grid in the UI has always allowed −5 to 50;
 * `factoryCalibration` clamped what it generated to 5 as a floor, and the spark advisor
 * refused to suggest below 5 for the same reason. That disagreement was not cosmetic.
 *
 * A production boosted calibration genuinely commands retarded, even after-TDC, timing in
 * the low-speed high-load corner — it is the most knock-limited place any turbo engine
 * operates, which is why manufacturers taper torque below about 1800 RPM and enrich hard
 * there. Flooring the generator at 5 meant it wrote spark the engine could not take: the
 * B58B30M1 at 11:1 and 16.6 psi came out detonating on its own factory table from 1700 to
 * 2600 RPM, not because the tune was wrong but because the generator was not allowed to
 * write the number the physics asked for.
 */
export const SPARK_MIN_DEG = -5;
export const SPARK_MAX_DEG = 50;

/** Stock ignition timing table, degrees BTDC. */
export const DEFAULT_TIMING = [
  [10, 14, 20, 26, 30, 32, 33, 34],
  [10, 14, 20, 26, 30, 32, 33, 34],
  [10, 14, 20, 26, 30, 32, 33, 34],
  [14, 22, 28, 33, 36, 37, 38, 39],
  [16, 30, 36, 40, 42, 43, 43, 43],
  [14, 34, 40, 44, 46, 47, 47, 47],
];

/** Stock commanded air:fuel ratio table, gasoline-equivalent. */
export const DEFAULT_AFR = [
  [13.2, 12.8, 12.6, 12.6, 12.6, 12.8, 13.0, 13.2],
  [13.2, 12.8, 12.6, 12.6, 12.6, 12.8, 13.0, 13.2],
  [13.2, 12.8, 12.6, 12.6, 12.6, 12.8, 13.0, 13.2],
  [14.5, 14.0, 13.8, 13.6, 13.6, 13.8, 14.0, 14.2],
  [14.7, 14.7, 14.7, 14.7, 14.7, 14.7, 14.7, 14.7],
  [14.7, 14.7, 14.7, 14.7, 14.7, 14.7, 14.7, 14.7],
];

/**
 * Stock boost target curve, psi — one entry per RPM breakpoint.
 *
 * Must stay the same length as {@link RPM}. Build boost curves with
 * `RPM.map(...)` rather than array literals so the two cannot drift apart.
 */
export const DEFAULT_BOOST = RPM.map(() => 0);

/**
 * Stock short-block design, calibrated around the Nissan VQ35DE Rev-Up baseline.
 *
 * The geometry, compression and materials below are that engine's published figures, and
 * the `vq35de-revup` preset carries the same ones. The three values that differ are the
 * three this default does NOT take from Nissan: `camDuration` and `springRate` are round
 * generic starting points for a custom build, where the preset fits them to the published
 * power, and `redline` is a deliberately generic 7500 ceiling, where the preset carries
 * the production 7000 limit. Retuning any of the three here is a custom-build decision and
 * should not move the preset — see `presets.js`.
 *
 * Frozen: this object is handed straight to React state, and a caller doing
 * `Object.assign(cfg, patch)` — exactly what preset code reaches for — would
 * otherwise corrupt the module-level default for the whole session.
 * @type {Readonly<import('./engine.js').EngineConfig>}
 */
export const DEFAULT_ENGINE_CONFIG = Object.freeze({
  configuration: 'V6',
  bore: 95.5,
  stroke: 81.4,
  compression: 10.3,
  blockMaterial: 'Aluminum',
  headMaterial: 'Aluminum',
  camDuration: 210,
  springRate: 50,
  redline: 7500,
});

/** No bolt-ons fitted. Frozen for the same reason as the engine config above. */
export const DEFAULT_MODS = Object.freeze({ intake: false, exhaust: false, headers: false, intercooler: false });

/**
 * Fractions across a row gap at which the interpolated surface is checked.
 *
 * Three points, not one: the knock ceiling is not linear in pressure, so the binding
 * point is not reliably halfway.
 */
export const INTERP_SAMPLE_FRACTIONS = [0.25, 0.5, 0.75];

/**
 * Slack above barometric counted as reachable, kPa. A manifold never sits exactly at
 * ambient, and a row a hair above it is still a row the engine runs on.
 */
export const REACHABLE_SLACK_KPA = 2;

/**
 * MAP above which the ECU leaves closed loop and enriches for power, kPa. Below it the
 * target is stoichiometric and the trims own the mixture, which is also why mixture
 * advice is limited to the rows above it.
 */
export const OPEN_LOOP_KPA = 85;

/**
 * How much of the MAF error survives into the mixture the cylinder actually gets.
 *
 * Open loop, all of it: nothing is watching. Closed loop, a quarter: the O2 sensor and
 * the trims pull most of it back. `evaluatePoint` runs the engine with this and
 * `factoryCalibration` writes the tables with it, so they have to share it.
 *
 * @param {number} netFactor MAF error times the player's MAF scalar
 * @param {number} mapKpa
 * @returns {number} factor the commanded lambda is divided by
 */
export function effectiveMafFactor(netFactor, mapKpa) {
  return 1 + (netFactor - 1) * (mapKpa >= OPEN_LOOP_KPA ? 1 : 0.25);
}

/**
 * The most advance a row may carry so that the value the ECU actually hands back
 * BETWEEN this row and the one above it still clears the knock ceiling.
 *
 * An ECU does not run on breakpoints. It reads the table with `interp2`, so at a
 * fraction f of the way from this row up to the next the cylinder sees
 * `(1 - f) * T_here + f * T_above` at a pressure no row sits on — and the ceiling there
 * can be lower than at either end. Solving that inequality for T_here:
 *
 *     (1 - f) * T_here + f * T_above  <=  ceiling(p_f)
 *     T_here <= (ceiling(p_f) - f * T_above) / (1 - f)
 *
 * THE ONE DEFINITION OF THIS CONSTRAINT. `calibrationAdvice` uses it to keep its advice
 * honest on the dyno (#43), and `factoryCalibration` uses it so the tables the app ships
 * are safe at the pressures the app itself runs them at. When those two disagreed about
 * what a cell means, the generator's own spark table read as dangerous to its own
 * advisor — which is the failure this shared definition exists to prevent.
 *
 * @param {object} input
 * @param {(f: number) => number} input.ceilingAtFrac knock ceiling a fraction f into the
 *   gap, safety margin already subtracted
 * @param {number} input.aboveDeg advance the row above carries
 * @param {number} input.entered how much of the gap the engine actually reaches, 0..1
 * @returns {number} advance ceiling for this row, degrees
 */
export function interpolationRoomDeg({ ceilingAtFrac, aboveDeg, entered }) {
  let room = Infinity;
  for (const frac of INTERP_SAMPLE_FRACTIONS) {
    const f = frac * entered;
    room = Math.min(room, (ceilingAtFrac(f) - f * aboveDeg) / (1 - f));
  }
  return room;
}

// ---------------------------------------------------------------------------
// Bulk edits over a rectangle of a calibration table.
//
// These are the operations TUNE's grids apply to a selection. They live here, next to
// the tables and their clamps, so they are tested without a DOM and the UI only decides
// WHICH cells and WHICH op. Every one returns a new table and writes only inside the
// rectangle. Written values are clamped and rounded to 2 dp — the storage precision the
// dock's steppers have always used, not the display precision (VE carries decimals from
// the logged corrections, and rounding those away would change cells nobody meant to move).
//
// Clamping is local rather than `math.js`'s `clamp`: `math.js` imports this module's
// axes, and importing back would make the two a cycle.

/** @typedef {{r1: number, c1: number, r2: number, c2: number}} Rect */
/** @typedef {{min: number, max: number}} Bounds */

/**
 * @param {number} v
 * @param {Bounds} bounds
 * @returns {number}
 */
const fit = (v, { min, max }) => Number(Math.min(Math.max(v, min), max).toFixed(2));

/**
 * A rectangle with its corners in order, whichever two corners it was given by.
 * @param {Rect} rect
 * @returns {Rect}
 */
export function orderRect({ r1, c1, r2, c2 }) {
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}

/**
 * @param {number[][]} table
 * @param {Rect} rect
 * @param {(v: number, ri: number, ci: number) => number} fn
 * @returns {number[][]}
 */
function mapRect(table, rect, fn) {
  const { r1, c1, r2, c2 } = orderRect(rect);
  return table.map((row, ri) => row.map((v, ci) => (
    ri >= r1 && ri <= r2 && ci >= c1 && ci <= c2 ? fn(v, ri, ci) : v
  )));
}

/**
 * @param {number[][]} table
 * @param {Rect} rect
 * @param {number} delta
 * @param {Bounds} bounds
 * @returns {number[][]}
 */
export const addRect = (table, rect, delta, bounds) => mapRect(table, rect, (v) => fit(v + delta, bounds));

/**
 * Percent scaling: the edit that answers a VE histogram correction, which IS a percentage.
 * @param {number[][]} table
 * @param {Rect} rect
 * @param {number} pct
 * @param {Bounds} bounds
 * @returns {number[][]}
 */
export const scaleRect = (table, rect, pct, bounds) => mapRect(table, rect, (v) => fit(v * (1 + pct / 100), bounds));

/**
 * @param {number[][]} table
 * @param {Rect} rect
 * @param {number} value
 * @param {Bounds} bounds
 * @returns {number[][]}
 */
export const setRect = (table, rect, value, bounds) => mapRect(table, rect, () => fit(value, bounds));

/**
 * Bilinear fill from the rectangle's four corners, which keep their values exactly. By
 * cell index, not axis value: the axes are unevenly spaced, but a tuner reads and
 * blends the grid by cell. One row or column reduces to a straight line; one cell is
 * left alone.
 * @param {number[][]} table
 * @param {Rect} rect
 * @param {Bounds} bounds
 * @returns {number[][]}
 */
export function interpolateRect(table, rect, bounds) {
  const { r1, c1, r2, c2 } = orderRect(rect);
  const tl = table[r1][c1], tr = table[r1][c2], bl = table[r2][c1], br = table[r2][c2];
  return mapRect(table, rect, (v, ri, ci) => {
    if ((ri === r1 || ri === r2) && (ci === c1 || ci === c2)) return v;
    const u = (ci - c1) / (c2 - c1 || 1);
    const w = (ri - r1) / (r2 - r1 || 1);
    const top = tl + (tr - tl) * u;
    const bottom = bl + (br - bl) * u;
    return fit(top + (bottom - top) * w, bounds);
  });
}

/**
 * One pass of a 3x3 box average. Neighbours are read from the ORIGINAL table, including
 * cells outside the rectangle, so a range blends into what surrounds it and the result
 * does not depend on the order cells are visited. The neighbourhood is clipped at the
 * table's edges.
 * @param {number[][]} table
 * @param {Rect} rect
 * @param {Bounds} bounds
 * @returns {number[][]}
 */
export function smoothRect(table, rect, bounds) {
  return mapRect(table, rect, (v, ri, ci) => {
    let sum = 0, n = 0;
    for (let r = ri - 1; r <= ri + 1; r++) {
      for (let c = ci - 1; c <= ci + 1; c++) {
        if (r < 0 || r >= table.length || c < 0 || c >= table[r].length) continue;
        sum += table[r][c];
        n++;
      }
    }
    return fit(sum / n, bounds);
  });
}
