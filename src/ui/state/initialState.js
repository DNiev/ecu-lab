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
  DEFAULT_AFR, DEFAULT_BOOST, DEFAULT_CAR, DEFAULT_ECU_HW, DEFAULT_ENGINE_CONFIG, DEFAULT_ENV,
  DEFAULT_MODS, DEFAULT_TIMING, EXHAUST_DIA_OPTS, clone2D, computeHardwareVE, defaultEcuCalibration,
  deriveEngine, makeLiveState,
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
 * @property {string|null} [blowerId] the supercharger fitted (a BLOWER_OPTS id), or none
 * @property {number} [blowerRatio] crank pulley ÷ blower pulley
 * @property {{kit: 'wet'|'dry', shotHp: number, heater: boolean, bottleLb: number}|null} [nitrous]
 *   the nitrous kit fitted, or none
 * @property {number} octaneIdx index into FUEL_CHOICES (the pump fuels, then Flex)
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
 * @property {{regulator: string, basePressureKpa: number, pumpIdx: number}} fuelSystem
 *   pump and pressure regulation
 * @property {{map: string, wideband: string, iat: string, ect: string, flex: boolean}} sensorHw
 *   the sensors physically fitted — the ECU's scaling of them is calibration, in `tune.ecu`
 * @property {{type: string, springPsi: number}} wastegate the wastegate actuator
 * @property {string} coil ignition coil fitted
 * @property {number} plugGapMm spark plug gap
 * @property {number} ethanolPct what a flex-fuel tank actually holds
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
 * @property {import('../components/selection.js').Selection|null} selection
 *   the currently selected calibration-grid cell, row, column or range, or null
 * @property {object} ecu the engine management calibration beyond the three base tables
 *   (`src/sim/ecu/calibration.js`) — undoable like them
 * @property {(MapSlot|null)[]} maps the ECU's switchable map slots. The ACTIVE slot's
 *   calibration is the working `ve`/`timing`/`afr`/`ecu` above, so its entry here is
 *   always null; every other entry is a stored calibration, or null for a slot never
 *   written — which, like a fresh ROM's, holds a copy of whatever is active when first
 *   switched to
 * @property {number} activeMap which slot the engine is running
 * @property {boolean} rangeMode true while TUNE's grids take two taps as a range (the
 *   touch path; a mouse drags). One flag for AIR, SPARK and FUEL, and outside the undo
 *   snapshot like `selection`
 */

/**
 * A stored calibration in a map slot.
 * @typedef {{ve: number[][], timing: number[][], afr: number[][], ecu: object}} MapSlot
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
 * @property {'ok'|'blocked'|'unavailable'|null} audioStatus what the last press of TEST
 *   found, or null before one. Here rather than as local state because the shell owns
 *   the audio context that produces it and the live screen is what displays it, so it
 *   would otherwise be a prop threaded between them for no other reason.
 * @property {number} volume engine-note output trim, 0..2, 1 being unity. A setting
 *   that sits beside `soundOn` rather than view state, because it survives navigation
 *   and is the same knob whichever screen the engine is heard on.
 * @property {'settle'|'sweep'|'spooldown'|'rest'|null} dynoPhase which part of the pull
 *   SEQUENCE is playing, or null when no pull is running. A pull is not just a sweep:
 *   it settles at idle, loads and sweeps to redline, comes back down on engine braking
 *   and settles again. The phase decides both the RUN button's label and, through
 *   `acousticDrive`, the throttle position the engine note is rendered at.
 * @property {number} dynoRpm engine speed the pull is currently at, RPM. Run state, not
 *   view state, for the same reason `revealCount` is: it is produced by the pull's own
 *   clock and read by both the tachometer and the audio.
 * @property {number} journeyStep guided-onboarding progress: BUILD -> TUNE -> LIVE ->
 *   DYNO, then free play (step 4). Survives navigation, so it lives here rather than
 *   as view state.
 * @property {number|null} logFocusRpm the RPM a chart band was activated at, so the
 *   pull log can highlight every event whose span covers it. Null means no highlight.
 *   Cleared by BANK_PULL — see that case in reducer.js.
 * @property {import('../../sim/index.js').DragCar} car the vehicle the engine is
 *   dropped into on DRAG. Session state rather than build state on purpose: it is not
 *   part of the engine, so it must not clear the preset label or flag unsaved
 *   calibration work when it changes.
 * @property {import('../../sim/index.js').DragResult|null} dragResult the last quarter
 *   mile the car actually ran, solved in full before playback starts. The strip
 *   animation reads this rather than integrating alongside it, so what is drawn can
 *   never disagree with the time slip.
 * @property {boolean} dragRunning true while that solved run is being played back
 * @property {number} dragT playback clock, seconds into the run
 * @property {number} treePhase christmas tree: 0 dark, 1 staged, 2-4 the three ambers,
 *   5 green. The one piece of drag state with no physics behind it — the tree runs on
 *   a real sportsman timer, and the car does not move until it goes green.
 * @property {string|null} dragSetup the car and torque curve `dragResult` was actually
 *   run on (`dragSignature` in DragScreen.jsx). What lets the time slip say "these are
 *   last run's numbers, from before your change" instead of presenting a time the
 *   current car cannot run — the same rule `pullScores.signature` follows.
 * @property {'sandbox'|'career'} mode which door the player came in by. CAREER is a
 *   run of customer cars, so HOME leads with the jobs board; SANDBOX is free play with
 *   no objectives, so it has no jobs board at all — the split the reference build (v4.8)
 *   made at its start screen.
 * @property {number|null} activeJob index into CAREER_JOBS of the customer car being
 *   worked on, or null in free play. Career progress, which is what this slice holds:
 *   taking a job resets the build and applies that job's fault, and it has to survive
 *   every screen the player visits while diagnosing it.
 * @property {number[]} completedJobs indices of the jobs already passed
 * @property {'pass'|'fail'|null} jobResult how the last pull graded against the active
 *   job's target, or null before one has been run against it
 * @property {{ambientC: number, altitudeM: number}} env the air the engine breathes, on
 *   the dyno and in LIVE. Session state: it is the day, not the build
 * @property {{ac: boolean, lights: boolean, launch?: boolean, nitrous?: boolean, bottleFills?: number, trimResets?: number}} liveAux accessory loads switched
 *   on in LIVE, whether the clutch is in with launch control armed, the nitrous arming
 *   switch, how many fresh bottles the driver has fitted (each one starts full), and how
 *   many times the fuel trims have been reset from TUNE
 * @property {Record<string, string>} faults injected faults, keyed by sensor or system
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
      // A supercharger (a BLOWER_OPTS id) and its pulley ratio, and a nitrous kit. None
      // fitted to start; a turbo and a supercharger are never fitted together.
      blowerId: null,
      blowerRatio: 1.2,
      nitrous: null,
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
      fuelSystem: { ...DEFAULT_ECU_HW.fuelSystem },
      sensorHw: { ...DEFAULT_ECU_HW.sensorHw },
      wastegate: { ...DEFAULT_ECU_HW.gate },
      coil: DEFAULT_ECU_HW.coil,
      plugGapMm: DEFAULT_ECU_HW.plugGapMm,
      ethanolPct: 10,
    },
    tune: {
      ve: computeHardwareVE(DEFAULT_ENGINE_CONFIG, DEFAULT_MODS),
      timing: clone2D(DEFAULT_TIMING),
      afr: clone2D(DEFAULT_AFR),
      ecu: defaultEcuCalibration({ derived: deriveEngine(DEFAULT_ENGINE_CONFIG), gate: DEFAULT_ECU_HW.gate }),
      maps: [null, null, null, null],
      activeMap: 0,
      tablesDirty: false,
      selection: null,
      rangeMode: false,
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
      audioStatus: null,
      volume: 1,
      dynoPhase: null,
      dynoRpm: 820,
      journeyStep: 0,
      logFocusRpm: null,
      // A fresh object graph, like every other default here: DEFAULT_CAR is not frozen
      // and the DRAG screen writes to a copy of it on every control change.
      car: { ...DEFAULT_CAR },
      dragResult: null,
      dragSetup: null,
      dragRunning: false,
      dragT: 0,
      treePhase: 0,
      mode: 'sandbox',
      activeJob: null,
      completedJobs: [],
      jobResult: null,
      env: { ...DEFAULT_ENV },
      liveAux: { ac: false, lights: false, nitrous: true },
      faults: {},
    },
    history: { past: [], future: [] },
  };
}
