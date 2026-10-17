/**
 * Moving the three main tables onto another engine computer's breakpoints.
 *
 * A factory engine whose tables have not been touched gets its factory calibration
 * generated afresh on the new breakpoints (`factoryCalibrationOn`): the same physics at
 * every cell the computer has, not a resample of the 8 × 6. Anything else is the
 * player's own work, so it is carried across cell by cell: every new cell is read off the
 * old table. Where one axis is manifold pressure and the other air per cylinder, the
 * conversion is the ECU's own: the air its VE table traps at that pressure.
 */

import {
  BARO_KPA, ECU_LAYOUTS, PSI_TO_KPA, blowerCurve, chargeTempK, deriveEngine, engineLayout,
  factoryCalibrationOn, layoutById, oemLayout, peakMapKpaOf, presetById, readTable, resampleTable,
  sameLayout, tankFuel, trappedAirGrams,
} from '../../sim/index.js';

/**
 * The breakpoints sized to the engine as built: from cranking to just past its limiter,
 * from overrun to just past the most manifold pressure it makes (sim/layouts.js
 * `engineLayout`), 16 × 16 like most standalone and factory computers.
 *
 * @param {StoreState['build']} build
 */
export function buildLayout(build) {
  const wot = build.blowerId ? blowerCurve(build, tankFuel(build)) : [];
  return engineLayout({
    redline: build.engineConfig.redline ?? 7000,
    peakMapKpa: peakMapKpaOf({
      turboOn: build.turboOn, boostCurve: build.boostCurve,
      blowerPeakPsi: wot.length ? Math.max(...wot.map((p) => p.boostPsi)) : 0,
    }),
  });
}

/**
 * The layout a TUNE layout choice names, for this build: `engine` for breakpoints sized to
 * it, or an engine computer's own (an ECU_LAYOUTS id), whose tables it gives no
 * breakpoints for sit on the engine's.
 *
 * @param {StoreState['build']} build
 * @param {string} choice
 */
export function layoutFor(build, choice) {
  const engine = buildLayout(build);
  return ECU_LAYOUTS[choice] ? oemLayout(choice, engine.ve) : engine;
}

/**
 * The tune after a BUILD change, on breakpoints that still span the engine: when the
 * engine reaches further (a higher limiter, more boost) or less far than its tables, they
 * are carried onto new axes cell by cell, as tuning software's rescale-axis does — new
 * cells past the old edge take the edge's values, for the player (and the advisor) to
 * work out. Untouched for an engine computer's own breakpoints, which do not move, and
 * when the new axes come out the same.
 *
 * @param {Pick<StoreState, 'build'|'tune'>} state the state AFTER the build change
 * @returns {StoreState['tune']}
 */
export function respanTune(state) {
  const { build, tune } = state;
  if (!tune.layout || typeof tune.layout !== 'object' || tune.layout.id !== 'engine') return tune;
  const to = buildLayout(build);
  if (sameLayout(to, tune.layout)) return tune;
  const from = tune.layout;
  const conv = airmassConversion(state);
  return {
    ...tune,
    layout: to,
    ...moveTables(tune, from, to, conv),
    baseline: moveTables(tune.baseline, from, to, conv),
  };
}

/** @typedef {import('./initialState.js').StoreState} StoreState */

/**
 * The air the ECU believes one cylinder holds at a speed and pressure, from its own VE
 * table, and the inverse. Boost heats the charge as the dyno heats it.
 * @param {Pick<StoreState, 'build'|'tune'>} state
 */
export function airmassConversion(state) {
  const { build, tune } = state;
  const axes = layoutById(tune.layout).ve;
  const derived = deriveEngine(build.engineConfig);
  const sweptM3 = derived.displacementL / derived.cyl / 1000;
  const airmassAt = (rpm, kpa) => trappedAirGrams({
    veActual: readTable(tune.ve, axes, rpm, kpa),
    mapKpa: kpa,
    chargeK: chargeTempK(Math.max(0, (kpa - BARO_KPA) / PSI_TO_KPA), !!build.mods?.intercooler),
    sweptM3,
  });
  const kpaFor = (rpm, g) => {
    let lo = 5; let hi = 600;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (airmassAt(rpm, mid) < g) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { airmassAt, kpaFor };
}

/**
 * The SET_LAYOUT payload that puts the tune on `layoutId`'s breakpoints.
 * @param {Pick<StoreState, 'build'|'tune'>} state
 * @param {string|null} layoutId an ECU_LAYOUTS id, or `engine` (or null) for breakpoints sized to the engine
 * @returns {{type: 'SET_LAYOUT', layout: import('../../sim/layouts.js').Layout, ve: number[][], timing: number[][], afr: number[][], baseline: {ve: number[][], timing: number[][], afr: number[][]}}}
 */
export function layoutSwitch(state, layoutId) {
  const { build, tune } = state;
  const to = layoutFor(build, layoutId ?? 'engine');
  const preset = build.presetId ? presetById(build.presetId) : null;
  if (preset && !tune.tablesDirty) {
    const f = factoryCalibrationOn(preset, to);
    const tables = { ve: f.ve, timing: f.timing, afr: f.afr };
    return { type: 'SET_LAYOUT', layout: to, ...tables, baseline: tables };
  }
  const from = layoutById(tune.layout);
  const conv = airmassConversion(state);
  return { type: 'SET_LAYOUT', layout: to, ...moveTables(tune, from, to, conv), baseline: moveTables(tune.baseline, from, to, conv) };
}

/**
 * The three tables carried from one layout's breakpoints to another's.
 * @param {{ve: number[][], timing: number[][], afr: number[][]}} t
 * @param {import('../../sim/layouts.js').Layout} from
 * @param {import('../../sim/layouts.js').Layout} to
 * @param {ReturnType<typeof airmassConversion>} conv
 */
export function moveTables(t, from, to, conv) {
  return {
    ve: resampleTable(t.ve, from.ve, to.ve, conv, 1),
    timing: resampleTable(t.timing, from.timing, to.timing, conv, 1),
    afr: resampleTable(t.afr, from.afr, to.afr, conv, 2),
  };
}
