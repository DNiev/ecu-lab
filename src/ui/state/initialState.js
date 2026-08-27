/**
 * The store's starting values, sliced into `build`, `tune`, and `session`.
 *
 * Every default below began as a verbatim copy of an EcuLab.jsx `useState`
 * initialiser. Those `useState` calls are gone, so this file is now the SOLE
 * definition of what a fresh session starts with, not a second copy of one: change a
 * default here and you have changed the app. See reducer.js for why the three slices
 * below are combined into ONE state tree rather than three independent ones.
 *
 * `makeInitialState()` must return a fresh object graph on every call — a shared
 * initial state would let one test's mutation leak into the next, or one player's
 * reset leak into their next build. The DEFAULT_* imports below are safe to reference
 * directly without cloning: they are `Object.freeze`d at their definition in
 * `src/sim/tables.js` and never written to. The calibration tables are NOT shared —
 * `ve` comes from a fresh `computeHardwareVE` call and `timing`/`afr` are cloned with
 * `clone2D` — because those get edited in place by table writes.
 */

import {
  DEFAULT_AFR, DEFAULT_BOOST, DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, DEFAULT_TIMING,
  EXHAUST_DIA_OPTS, clone2D, computeHardwareVE, makeLiveState,
} from '../../sim/index.js';

/**
 * Hardware and ECU configuration a factory preset owns. A hand edit to any field here
 * clears `presetId` (the preset label), because it is no longer that preset's build.
 * It does NOT by itself flag `tune.tablesDirty` — that flag means unsaved calibration
 * work, and hardware edits alone don't touch the calibration tables.
 *
 * @typedef {object} BuildState
 * @property {import('../../sim/index.js').EngineConfig} engineConfig short-block design
 * @property {{intake: boolean, exhaust: boolean, headers: boolean, intercooler: boolean}} mods bolt-ons fitted
 * @property {boolean} turboOn
 * @property {number[]} boostCurve psi, indexed by RPM
 * @property {number} octaneIdx index into OCTANE_OPTS
 * @property {number} injIdx index into INJECTOR_OPTS
 * @property {number} mafScalar ECU's MAF correction scalar
 * @property {number} turbineIdx index into TURBINE_OPTS
 * @property {number} turbineCount how many of that housing are fitted (only a preset sets this above 1)
 * @property {number} compressorIdx index into COMPRESSOR_OPTS
 * @property {number} exhaustDiaIdx index into EXHAUST_DIA_OPTS
 * @property {number} ecuInjectorCc injector size the ECU is calibrated for, cc/min
 * @property {string|null} presetId which factory preset (if any) is currently loaded stock
 * @property {object|null} presetPrompt the preset pending an overwrite-confirmation prompt, or null
 * @property {number} boostSel which RPM column the boost-curve editor has selected
 */

/**
 * The calibration tables and the player's unsaved-work flag. `tablesDirty` — not pull
 * count — is what the overwrite-confirmation prompt keys off: pull count is restored
 * from career storage on load (so it would nag a returning player on an untouched
 * default engine) and misses a player who edited every table but never pulled.
 *
 * @typedef {object} TuneState
 * @property {number[][]} ve volumetric efficiency table, percent, indexed [LOAD][RPM]
 * @property {number[][]} timing spark advance table, degrees, indexed [LOAD][RPM]
 * @property {number[][]} afr target air/fuel ratio table, indexed [LOAD][RPM]
 * @property {boolean} tablesDirty true once VE/spark/fuel has been hand-edited since
 *   the last preset load or reset-to-stock
 * @property {{type: 'cell'|'row'|'col', row?: number, col?: number}|null} selection
 *   the currently selected calibration-grid cell, row, column or range, or null
 * @property {boolean} rangeMode whether a tap on the grid starts or extends a RECTANGLE
 *   rather than selecting one cell. Beside `selection` because it is the mode that
 *   selection is taken in, and one flag rather than three: AIR, SPARK and FUEL all
 *   render the same grid and a tuner switching between them means the same thing by it.
 */

/**
 * Everything about the current run and career progress that is NOT hardware or
 * calibration: dyno results, scores, engine wear, the live-engine model, and
 * onboarding progress.
 *
 * @typedef {object} SessionState
 * @property {boolean} running true while a dyno pull is sweeping
 * @property {object|null} result the most recent dyno pull's result
 * @property {object|null} prevResult the dyno pull before that, for comparison
 * @property {number} revealCount how much of the current result has been revealed
 * @property {number} bestScore highest engineer score achieved this career
 * @property {number} totalScore cumulative score across all pulls this career
 * @property {number} pullCount how many dyno pulls have been logged this career
 * @property {{piston: number, bearing: number, valve: number}} health component wear, percent
 * @property {object|null} histogram the fuel-trim histogram from the last pull
 * @property {object} live the running live-engine model's state
 * @property {number} throttleInput the driver's current throttle input, PERCENT
 *   (0..100), not a 0..1 fraction: the throttle pad writes 0 or 100 and `liveStep`
 *   compares it against 3 and clamps it to 0..100 (`src/sim/live.js`)
 * @property {number} loadKpa the dyno sweep's fixed manifold load, kPa
 * @property {boolean} soundOn whether the engine-note synth is enabled
 * @property {number} journeyStep guided-onboarding progress: BUILD -> TUNE -> LIVE ->
 *   DYNO, then free play (step 4). Survives navigation, so it lives here rather than
 *   as view state.
 * @property {number|null} activeJob index into CAREER_JOBS of the customer car being
 *   worked on, or null in free play. Career progress, which is what this slice holds:
 *   taking a job resets the build and applies that job's fault, and it has to survive
 *   every screen the player visits while diagnosing it.
 * @property {number[]} completedJobs indices of the jobs already passed
 * @property {'pass'|'fail'|null} jobResult how the last pull graded against the active
 *   job's target, or null before one has been run against it
 */

/**
 * @typedef {object} StoreState
 * @property {BuildState} build
 * @property {TuneState} tune
 * @property {SessionState} session
 */

/**
 * Builds a fresh starting state for a new session.
 * @returns {StoreState}
 */
export function makeInitialState() {
  return {
    build: {
      engineConfig: DEFAULT_ENGINE_CONFIG,
      mods: DEFAULT_MODS,
      turboOn: false,
      boostCurve: [...DEFAULT_BOOST],
      octaneIdx: 0,
      injIdx: 0,
      mafScalar: 1.0,
      turbineIdx: 1,
      turbineCount: 1,
      compressorIdx: 1,
      // Pinned by diameter, not by position: adding sizes to the catalogue must not
      // silently change which pipe a new build starts with.
      exhaustDiaIdx: EXHAUST_DIA_OPTS.findIndex((o) => o.dia === 3.0),
      ecuInjectorCc: 315,
      presetId: null,
      presetPrompt: null,
      boostSel: 4,
    },
    tune: {
      ve: computeHardwareVE(DEFAULT_ENGINE_CONFIG, DEFAULT_MODS),
      timing: clone2D(DEFAULT_TIMING),
      afr: clone2D(DEFAULT_AFR),
      tablesDirty: false,
      selection: null,
      rangeMode: false,
    },
    session: {
      running: false,
      result: null,
      prevResult: null,
      revealCount: 0,
      bestScore: 0,
      totalScore: 0,
      pullCount: 0,
      health: { piston: 100, bearing: 100, valve: 100 },
      histogram: null,
      live: makeLiveState(),
      throttleInput: 0,
      loadKpa: 100,
      soundOn: true,
      journeyStep: 0,
      activeJob: null,
      completedJobs: [],
      jobResult: null,
    },
  };
}
