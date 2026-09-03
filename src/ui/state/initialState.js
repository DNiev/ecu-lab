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
 *   the currently selected calibration-grid cell, row or column, or null
 */

/**
 * One pull's scores, exactly as that pull measured them.
 *
 * Banked by BANK_PULL and then left alone. Nothing recomputes these from the current
 * build, which is the whole point: re-grading a finished run against hardware it was
 * never made on reports a number the engine never produced.
 *
 * `wasBest` is a fact about the run — decided against the best as it stood BEFORE this
 * pull was banked — rather than a live `pull >= bestScore` comparison. Read back off
 * `bestScore` afterwards, that comparison is true by construction on every pull,
 * because by then this pull IS the best.
 *
 * `signature` is the setup it was measured on (pullSignature.js). It is what lets the
 * UI say "these are last pull's numbers, from before your latest change" instead of
 * silently presenting them as current.
 *
 * @typedef {object} PullScores
 * @property {{score: number, label: string, deductions: string[], advisories?: string[]}} tuning
 * @property {{score: number, label: string, deductions: string[]}} engineer
 * @property {number} pull the Pull Score this run banked
 * @property {boolean} wasBest whether this run beat the standing best when it landed
 * @property {string} signature the configuration it was measured on
 */

/**
 * Everything about the current run and career progress that is NOT hardware or
 * calibration: dyno results, scores, engine wear, the live-engine model, and
 * onboarding progress.
 *
 * @typedef {object} SessionState
 * @property {boolean} running true while a dyno pull is sweeping
 * @property {object|null} result the most recent dyno pull's result
 * @property {import('./runLog.js').RunRecord[]} runs the last RUN_LIMIT dyno pulls,
 *   newest first. Named `runs` and not "history" because `state.history` is the undo
 *   stack — see HistoryState below.
 * @property {string|null} pinnedRunId the run the ghost curve compares against, or
 *   null to compare against the previous run
 * @property {PullScores|null} pullScores the scores the last pull MEASURED, banked at
 *   pull time and never recomputed — see the typedef, and BANK_PULL in reducer.js
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
 * @property {number|null} logFocusRpm the RPM a chart band was activated at, so the
 *   pull log can highlight every event whose span covers it. Null means no highlight.
 *   Cleared by BANK_PULL — see that case in reducer.js.
 */

/**
 * The undo stack. `past` is oldest-first, so the next thing UNDO reverses is the LAST
 * element; `future` is newest-first, so REDO takes element 0.
 *
 * Each entry holds the state BEFORE its action ran, a `label` naming what would be
 * undone, and the `scope` saying how much of that snapshot goes back. The label is
 * load-bearing twice: it gives the undo buttons a real `aria-label` instead of a bare
 * glyph, and it is how BUILD decides whether the top of the stack is a preset load
 * worth offering to reverse. The scope is what keeps a uniform snapshot from being
 * replayed over fields the recorded action never wrote — see `restore` in history.js.
 *
 * @typedef {{
 *   label: string,
 *   before: import('./history.js').Snapshot,
 *   scope: import('./history.js').RestoreScope,
 * }} HistoryEntry
 *
 * @typedef {object} HistoryState
 * @property {HistoryEntry[]} past
 * @property {HistoryEntry[]} future
 */

/**
 * @typedef {object} StoreState
 * @property {BuildState} build
 * @property {TuneState} tune
 * @property {SessionState} session
 * @property {HistoryState} history
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
    },
    session: {
      running: false,
      result: null,
      runs: [],
      pinnedRunId: null,
      pullScores: null,
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
      logFocusRpm: null,
    },
    history: { past: [], future: [] },
  };
}
