/**
 * Table layouts: the breakpoints the VE, spark and mixture tables are written on.
 *
 * The game's own grid is 8 RPM columns by 6 MAP rows (tables.js). A real engine computer
 * uses its own breakpoints, packed where the engine spends its time, and does not always
 * index spark by manifold pressure: GM's Gen III computers read spark against the grams of
 * air the ECU believes are in each cylinder, and so does Chrysler's GPEC2 (in milligrams).
 * A layout here is those breakpoints, as read from the factory's own files, so a table can
 * be edited, simulated and exported exactly as the car's computer holds it.
 *
 * Only layouts whose breakpoint VALUES were read from a real calibration are listed.
 * Definitions for other computers (BMW MSD80 and MG1, VW Simos18) give each table's size
 * and units but keep the breakpoints in the car's flash, so without a stock image of that
 * car they are not here; ECU Lab Pro reads them from the customer's own file.
 *
 * Every axis lists its load rows from the highest load down, as the game's LOAD does.
 */

import { LOAD, RPM } from './tables.js';
import { interp1, interp2 } from './math.js';

/**
 * @typedef {object} TableAxes
 * @property {number[]} rpm column breakpoints, ascending
 * @property {number[]} load row breakpoints, descending
 * @property {'kPa'|'g/cyl'|'mg/cyl'} loadUnit what the load axis measures: manifold
 *   pressure, or the air the ECU believes is in one cylinder per cycle
 */

/**
 * @typedef {object} Layout
 * @property {string} id
 * @property {string} label
 * @property {string} [ecu] the engine computer it comes from
 * @property {string} [source] where its breakpoints were read
 * @property {string} [note] what is not the computer's own
 * @property {TableAxes} ve
 * @property {TableAxes} timing
 * @property {TableAxes} afr
 */

const GAME_AXES = Object.freeze({ rpm: RPM, load: LOAD, loadUnit: /** @type {'kPa'} */ ('kPa') });

/** The game's own 8 × 6 grid. Tutorials, missions and the career always use it. */
export const GAME_LAYOUT = Object.freeze({
  id: 'game',
  label: 'ECU Lab grid (8 × 6)',
  ve: GAME_AXES,
  timing: GAME_AXES,
  afr: GAME_AXES,
});

const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => Number((from + i * step).toFixed(3)));
const desc = (xs) => [...xs].reverse();

// GM P01/P59 (Gen III small-block V8). Read from 44 stock images of six operating systems
// in the LS_Based_Engine_Repository through their own TunerPro definitions; every one
// carries these axes (B0101 main VE, B5913/B5914 high/low-octane spark).
const GM_VE = Object.freeze({ rpm: range(400, 8000, 400), load: desc(range(15, 105, 5)), loadUnit: /** @type {'kPa'} */ ('kPa') });
const GM_SPARK = Object.freeze({
  rpm: [400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2800, 3200, 3600, 4000, 4400, 4800, 5200, 5600, 6000, 6400, 6800, 7200, 7600, 8000],
  load: desc(range(0.08, 1.2, 0.04)),
  loadUnit: /** @type {'g/cyl'} */ ('g/cyl'),
});

// Chrysler GPEC2 (the 2015 SRT 6.4 Hemi). Spark grids are 17 × 17 on engine speed and air
// charge per cylinder, read from a stock image by disassembling the controller's own
// lookup code (ECU Lab Pro docs/STOCK-TUNE-REFERENCE.md). Its airflow tables were not
// identified, so VE and mixture stay on the game's grid for this layout.
const GPEC2_SPARK = Object.freeze({
  rpm: [512, 704, 928, 1088, 1344, 1504, 1760, 1952, 2208, 2496, 2688, 3040, 3776, 4256, 4896, 5248, 5792],
  load: desc([75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 775, 900]),
  loadUnit: /** @type {'mg/cyl'} */ ('mg/cyl'),
});

/** Engine computers whose breakpoints were read from real calibrations. */
export const ECU_LAYOUTS = Object.freeze({
  'gm-gen3': Object.freeze({
    id: 'gm-gen3',
    label: 'GM P01/P59 (VE 19 × 20, spark 29 × 25)',
    ecu: 'GM P01 / P59, Gen III V8 (1999-2007)',
    source: '44 stock images, six operating systems, LS_Based_Engine_Repository',
    note: 'GM has no 2-D target-mixture table (it runs closed loop and enriches by RPM); mixture here sits on the VE table\'s axes.',
    ve: GM_VE,
    timing: GM_SPARK,
    afr: GM_VE,
  }),
  'chrysler-gpec2': Object.freeze({
    id: 'chrysler-gpec2',
    label: 'Chrysler GPEC2 (spark 17 × 17)',
    ecu: 'Chrysler GPEC2, 2015 SRT 6.4 Hemi',
    source: 'one stock image, axes read from the controller\'s own lookup code',
    note: 'Only the spark grids were identified: VE and mixture stay on the ECU Lab grid.',
    ve: GAME_AXES,
    timing: GPEC2_SPARK,
    afr: GAME_AXES,
  }),
});

/** Which computer each factory engine came with, where its layout is known. */
export const PRESET_ECU_LAYOUT = Object.freeze({
  ls1: 'gm-gen3', ls6: 'gm-gen3', lq4: 'gm-gen3', lm7: 'gm-gen3', lr4: 'gm-gen3', 'hemi-392': 'chrysler-gpec2',
});

/**
 * A layout by id; the game's grid for null, undefined or anything unknown. A layout
 * object (an engine-sized or standalone layout, whose breakpoints were generated for
 * one engine and are kept with its tables) is returned as it is.
 * @param {string|Layout|null|undefined} id
 * @returns {Layout}
 */
export function layoutById(id) {
  if (id && typeof id === 'object') return id;
  return (typeof id === 'string' && ECU_LAYOUTS[id]) || GAME_LAYOUT;
}

/** Smallest of the round steps an ECU's breakpoints are usually written in that is at least `x`. */
const NICE_STEPS = [5, 6, 7.5, 8, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 100];
const niceUp = (x) => NICE_STEPS.find((s) => s >= x - 1e-9) ?? Math.ceil(x / 25) * 25;
/** The round step that takes `intervals` rows down from 100 kPa closest to the overrun floor (never under 10 kPa). */
const vacuumStep = (intervals) => NICE_STEPS
  .filter((s) => 100 - s * intervals >= 10)
  .reduce((best, s) => (Math.abs(100 - s * intervals - AXIS_FLOOR_KPA) < Math.abs(100 - best * intervals - AXIS_FLOOR_KPA) ? s : best), NICE_STEPS[0]);

/** The lowest manifold pressure a table needs to reach: closed-throttle overrun. */
export const AXIS_FLOOR_KPA = 20;

/** How far past the rev limit the RPM axis reaches, so the limiter's overshoot reads a real column. */
export const AXIS_RPM_PAST_LIMIT = 250;

/**
 * Breakpoints sized to one engine, as a tuner sets up a standalone: engine speed from
 * cranking to just past the rev limit, manifold pressure from closed-throttle overrun to
 * just past the most the engine makes, `rpmCount` × `loadCount` cells like the target
 * computer's own tables.
 *
 * RPM: 500 (cranking), 750 and 1000 (idle and just off it), then even steps of a
 * round 50 RPM up past the limit. MAP: naturally aspirated, even round steps down
 * from 100 kPa; boosted, the rows split between vacuum (20 to 100 kPa) and boost (100 kPa
 * up past peak) in proportion to the range each covers, so a 2-bar engine is not left
 * with one row of vacuum. 100 kPa is always a row: it is where a naturally aspirated
 * engine runs at full throttle and where boost begins.
 *
 * @param {{redline: number, peakMapKpa: number, rpmCount?: number, loadCount?: number}} spec
 * @returns {TableAxes}
 */
export function engineAxes({ redline, peakMapKpa, rpmCount = 16, loadCount = 16 }) {
  const low = [500, 750, 1000].slice(0, Math.max(1, Math.min(3, rpmCount - 2)));
  const n = rpmCount - low.length;
  const from = low[low.length - 1];
  const step = Math.ceil((redline + AXIS_RPM_PAST_LIMIT - from) / n / 50) * 50;
  const rpm = [...low, ...Array.from({ length: n }, (_, i) => from + step * (i + 1))];

  const boosted = peakMapKpa > 105;
  /** @type {number[]} */
  let load;
  if (!boosted) {
    const s = vacuumStep(loadCount - 1);
    load = Array.from({ length: loadCount }, (_, k) => 100 - s * k);
  } else {
    const top = peakMapKpa * 1.05;
    const intervals = loadCount - 1;
    const b = clampInt(Math.round(intervals * (top - 100) / (top - AXIS_FLOOR_KPA)), 1, intervals - 3);
    const v = intervals - b;
    const s = vacuumStep(v);
    const sb = niceUp((top - 100) / b);
    load = [
      ...Array.from({ length: b }, (_, k) => 100 + sb * (b - k)),
      ...Array.from({ length: v + 1 }, (_, k) => 100 - s * k),
    ];
  }
  return { rpm, load, loadUnit: 'kPa' };
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * A layout on breakpoints sized to one engine (`engineAxes`), the same axes for all
 * three tables: the default when the car's own computer's breakpoints are not known.
 *
 * @param {{redline: number, peakMapKpa: number, rpmCount?: number, loadCount?: number}} spec
 * @returns {Layout}
 */
export function engineLayout(spec) {
  const axes = engineAxes(spec);
  const size = `${axes.rpm.length} × ${axes.load.length}`;
  return {
    id: 'engine',
    label: `Sized to this engine (${size})`,
    note: `${axes.rpm[0]}–${axes.rpm[axes.rpm.length - 1]} RPM, ${axes.load[axes.load.length - 1]}–${axes.load[0]} kPa.`,
    ve: axes,
    timing: axes,
    afr: axes,
  };
}

/**
 * An engine computer's own layout, with any table it does not give breakpoints for put on
 * the engine's own axes rather than the old fixed grid.
 *
 * @param {string} id an ECU_LAYOUTS id
 * @param {TableAxes} engine axes for the tables the computer's file did not give
 * @returns {Layout}
 */
export function oemLayout(id, engine) {
  const base = ECU_LAYOUTS[id];
  if (!base) throw new Error(`No ECU layout "${id}"`);
  const pick = (axes) => (axes === GAME_AXES ? engine : axes);
  return { ...base, ve: pick(base.ve), timing: pick(base.timing), afr: pick(base.afr) };
}

/**
 * Whether two layouts put the tables on the same breakpoints.
 * @param {Layout} a
 * @param {Layout} b
 */
export function sameLayout(a, b) {
  const same = (x, y) => x.loadUnit === y.loadUnit && x.rpm.join() === y.rpm.join() && x.load.join() === y.load.join();
  return same(a.ve, b.ve) && same(a.timing, b.timing) && same(a.afr, b.afr);
}

/**
 * The value to read a table's load axis with.
 *
 * @param {TableAxes} axes
 * @param {{mapKpa: number, airmassG?: number}} at what the ECU believes: manifold
 *   pressure, and the air per cylinder its own VE table works out
 */
export function loadFor(axes, { mapKpa, airmassG = 0 }) {
  if (axes.loadUnit === 'g/cyl') return airmassG;
  if (axes.loadUnit === 'mg/cyl') return airmassG * 1000;
  return mapKpa;
}

/**
 * Bilinear read of a table on its own axes (rows descending), held flat past the ends,
 * as an engine computer reads one.
 *
 * @param {number[][]} table
 * @param {TableAxes} axes
 * @param {number} rpm
 * @param {number} load in the axis's own unit
 */
export function readTable(table, axes, rpm, load) {
  const rows = axes.load.map((_, ri) => interp1(axes.rpm, table[ri], rpm));
  return interp1([...axes.load].reverse(), rows.reverse(), load);
}

/**
 * A table moved onto other axes: every new cell is read off the old table. Where the two
 * axes measure load differently (MAP and air per cylinder), `toKpa` gives the manifold
 * pressure that traps a given air charge at an RPM, from the ECU's own VE table.
 *
 * @param {number[][]} table
 * @param {TableAxes} from
 * @param {TableAxes} to
 * @param {{airmassAt?: (rpm: number, mapKpa: number) => number, kpaFor?: (rpm: number, airmassG: number) => number}} [convert]
 * @param {number} [digits] decimals to keep
 * @returns {number[][]}
 */
export function resampleTable(table, from, to, convert = {}, digits = 1) {
  const toG = (u, v) => (u === 'mg/cyl' ? v / 1000 : v);
  return to.load.map((load) => to.rpm.map((rpm) => {
    let at = load;
    if (from.loadUnit !== to.loadUnit) {
      if (from.loadUnit === 'kPa') at = convert.kpaFor ? convert.kpaFor(rpm, toG(to.loadUnit, load)) : load;
      else if (to.loadUnit === 'kPa') at = convert.airmassAt ? convert.airmassAt(rpm, load) * (from.loadUnit === 'mg/cyl' ? 1000 : 1) : load;
      else at = from.loadUnit === 'mg/cyl' ? load * 1000 : load / 1000;
    }
    return Number(readTable(table, from, rpm, at).toFixed(digits));
  }));
}

/**
 * One of the three main tables, read the way the engine computer reads it: on the
 * layout's axes when the tables carry one, on the game's grid by MAP when they do not.
 *
 * @param {{ve: number[][], timing: number[][], afr: number[][], layout?: Layout|string|null}} tables
 *   `layout` as a tune carries it: a layout, or an older save's layout id
 * @param {'ve'|'timing'|'afr'} name
 * @param {number} rpm
 * @param {{mapKpa: number, airmassG?: number}} at what the ECU believes
 */
export function readEcuTable(tables, name, rpm, at) {
  const layout = typeof tables.layout === 'string' ? layoutById(tables.layout) : tables.layout;
  if (!layout) return interp2(legacyGrid(tables[name], name), rpm, at.mapKpa);
  const axes = layout[name];
  return readTable(tables[name], axes, rpm, loadFor(axes, at));
}

/**
 * The engine's true breathing as a function of speed and pressure, from either a function
 * (`hardwareVeAt`: exact at every speed) or a table on the old 8 × 6 grid. Null when
 * there is none.
 * @param {((rpm: number, kpa: number) => number)|number[][]|null|undefined} veTruth
 * @param {TableAxes|null} [axes] the MAP breakpoints a truth TABLE is on, when not the legacy grid
 * @returns {((rpm: number, kpa: number) => number)|null}
 */
export function truthReader(veTruth, axes = null) {
  if (!veTruth) return null;
  if (typeof veTruth === 'function') return veTruth;
  // A truth table generated on an engine's own MAP breakpoints (a factory VE table used as
  // a perfectly calibrated engine's truth) is read on them.
  if (axes && axes.loadUnit === 'kPa' && veTruth.length === axes.load.length && veTruth[0]?.length === axes.rpm.length) {
    return (rpm, kpa) => readTable(veTruth, axes, rpm, kpa);
  }
  const grid = legacyGrid(veTruth, 'veTruth');
  return (rpm, kpa) => interp2(grid, rpm, kpa);
}

/**
 * A table read with no layout is on the old 8 × 6 grid, or it is a mistake: a table sized
 * to an engine read on that grid returns numbers from the wrong cells without complaint.
 * Refused loudly instead.
 *
 * @param {number[][]} grid
 * @param {string} name for the message
 * @returns {number[][]}
 */
function legacyGrid(grid, name) {
  if (grid.length !== LOAD.length || grid[0]?.length !== RPM.length) {
    throw new Error(`${name} is ${grid.length} × ${grid[0]?.length ?? 0}, not on the ${LOAD.length} × ${RPM.length} legacy grid: pass the layout its axes belong to`);
  }
  return grid;
}

/** Whether two axes are the same breakpoints in the same unit. */
export function sameAxes(a, b) {
  return a === b || (a.loadUnit === b.loadUnit && a.rpm.join() === b.rpm.join() && a.load.join() === b.load.join());
}

/**
 * The manifold pressure a load-axis value stands for: itself on a MAP axis; on an
 * air-per-cylinder axis, the pressure at which `airAt` (the ECU's own VE table, usually)
 * traps that much air at that speed.
 * @param {TableAxes} axes
 * @param {number} rpm
 * @param {number} v load, in the axis's own unit
 * @param {(rpm: number, kpa: number) => number} airAt grams per cylinder at a pressure
 * @returns {number} kPa
 */
export function kpaForLoad(axes, rpm, v, airAt) {
  if (axes.loadUnit === 'kPa') return v;
  const g = axes.loadUnit === 'mg/cyl' ? v / 1000 : v;
  let lo = 5; let hi = 600;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (airAt(rpm, mid) < g) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A manifold pressure in a load axis's own unit (the inverse of `kpaForLoad`).
 * @param {TableAxes} axes
 * @param {number} rpm
 * @param {number} kpa
 * @param {(rpm: number, kpa: number) => number} airAt grams per cylinder at a pressure
 */
export function loadForKpa(axes, rpm, kpa, airAt) {
  if (axes.loadUnit === 'kPa') return kpa;
  return airAt(rpm, kpa) * (axes.loadUnit === 'mg/cyl' ? 1000 : 1);
}

/** Whether a layout reads any table by air per cylinder, so the ECU's airmass is needed. */
export function needsAirmass(layout) {
  return !!layout && ['ve', 'timing', 'afr'].some((k) => layout[k].loadUnit !== 'kPa');
}
