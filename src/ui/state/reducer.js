/**
 * The root reducer: one reducer over three slices, not three independent ones.
 *
 * `EcuLab.jsx`'s `applyEnginePreset` makes 21 sequential `setState` calls spanning
 * hardware, calibration tables and run results — and its own comment warns that
 * routing those writes through the invalidating setters "would make that order-
 * dependent on React's batching instead of explicit". `resetToStock` makes six writes
 * and documents that "the last call pins tablesDirty back to false". `withTableEdit`
 * writes a TUNE table, then clears `presetId` (BUILD), then sets `tablesDirty` (TUNE)
 * — one hand edit, two slices, and both must land together or the header lies about
 * which preset (if any) is loaded.
 *
 * Three independent contexts cannot express any of that atomically — each cross-slice
 * write would become choreography between providers, preserving the exact ordering
 * hazards these comments warn about. One reducer computes the next state in a single
 * pass instead: a case either changes a slice or it doesn't, there is no partial
 * application to observe mid-write, and "order-dependent" stops being a possible bug.
 *
 * This file implements the SINGLE-slice actions (Task 2 of the state-extraction plan)
 * AND the cross-cutting actions that replace `applyEnginePreset`, `resetToStock`,
 * `repairEngine` and the score-tallying tail of `doRun` — APPLY_PRESET, RESET_TO_STOCK,
 * REPAIR_ENGINE, BANK_PULL (Task 3). Task 6 adds the two live-engine actions,
 * LIVE_STEP and LIVE_PATCH, for the same reason SET_ENGINE_CONFIG_PATCH exists: they
 * replace functional `setState` updaters, which an action cannot carry, so the reducer
 * resolves them against the `live` it already holds.
 */

import { clamp, clone2D, DEFAULT_AFR, DEFAULT_MODS, DEFAULT_TIMING, liveStep } from '../../sim/index.js';

/** @typedef {import('./initialState.js').StoreState} StoreState */
/** @typedef {import('./initialState.js').BuildState} BuildState */
/** @typedef {import('./initialState.js').TuneState} TuneState */
/** @typedef {import('./initialState.js').SessionState} SessionState */

/**
 * Every action type the reducer understands. Frozen so a typo in a dispatch call
 * (`ACTIONS.SET_BULID_FIELD`) fails loudly as `undefined` rather than silently adding
 * a new property.
 */
export const ACTIONS = Object.freeze({
  SET_BUILD_FIELD: 'SET_BUILD_FIELD',
  CLEAR_PRESET_ID: 'CLEAR_PRESET_ID',
  SET_TURBINE: 'SET_TURBINE',
  SET_TABLE: 'SET_TABLE',
  SET_SESSION_FIELD: 'SET_SESSION_FIELD',
  SET_TUNE_FIELD: 'SET_TUNE_FIELD',
  SET_BOOST_SEL: 'SET_BOOST_SEL',
  SET_PRESET_PROMPT: 'SET_PRESET_PROMPT',
  SET_ENGINE_CONFIG_PATCH: 'SET_ENGINE_CONFIG_PATCH',
  APPLY_PRESET: 'APPLY_PRESET',
  RESET_TO_STOCK: 'RESET_TO_STOCK',
  REPAIR_ENGINE: 'REPAIR_ENGINE',
  BANK_PULL: 'BANK_PULL',
  LIVE_STEP: 'LIVE_STEP',
  LIVE_PATCH: 'LIVE_PATCH',
  TAKE_JOB: 'TAKE_JOB',
});

/**
 * Sets one field on the BUILD slice and clears `presetId` — a hand edit to any single
 * hardware/ECU field is no longer that preset's build. This is the reducer's
 * equivalent of `withPresetField`. It does NOT touch `tune.tablesDirty`: hardware
 * edits alone don't touch the calibration tables (see SET_TABLE for the write that
 * does).
 * @typedef {{type: 'SET_BUILD_FIELD', field: keyof BuildState, value: *}} SetBuildFieldAction
 */

/**
 * Clears `presetId` alone, with NO other side effect — deliberately narrower than
 * `SET_BUILD_FIELD`, which always pairs a field write with the same invalidation.
 * Its one caller is the preset picker's "Custom build" option: choosing it disowns
 * whatever preset is loaded without touching any other build field, so a generic
 * `{type: SET_BUILD_FIELD, field: 'presetId', value: null}` would only have worked
 * by coincidence — the reducer's own trailing `presetId: null` happens to overwrite
 * whatever `action.value` said, so a future caller passing a non-null value would
 * silently get `null` back with no error anywhere. This action can never carry a
 * value that lies about what it does.
 * @typedef {{type: 'CLEAR_PRESET_ID'}} ClearPresetIdAction
 */

/**
 * Fits ONE of the chosen turbine housing. A twin-turbo `turbineCount` belongs to a
 * preset, not a hand pick from the turbine list, so this always resets it to 1
 * alongside the new housing — and, like any hardware edit, clears `presetId`.
 * @typedef {{type: 'SET_TURBINE', value: number}} SetTurbineAction
 */

/**
 * Writes a calibration table (`ve`, `timing` or `afr`) and, in the SAME pass, clears
 * `presetId` (BUILD) and sets `tablesDirty` (TUNE). This is the reducer's equivalent
 * of `withTableEdit` — the one write that must cross the build/tune boundary
 * atomically, which is the whole reason this is one reducer and not two.
 * @typedef {{type: 'SET_TABLE', table: 've'|'timing'|'afr', value: number[][]}} SetTableAction
 */

/**
 * Sets one field on the SESSION slice. No cross-slice effects — session is run/career
 * bookkeeping, not hardware or calibration.
 * @typedef {{type: 'SET_SESSION_FIELD', field: keyof SessionState, value: *}} SetSessionFieldAction
 */

/**
 * Sets one field on the TUNE slice WITHOUT the SET_TABLE side effects. This is for
 * tune-slice writes that are not a calibration edit — `selection`, for instance, which
 * changes what grid cell is highlighted and must not clear the preset label or flag
 * unsaved work.
 * @typedef {{type: 'SET_TUNE_FIELD', field: keyof TuneState, value: *}} SetTuneFieldAction
 */

/**
 * Moves the boost-curve editor's selected RPM column. A cursor, not hardware — the
 * build-side analogue of `tune.selection` — so unlike `SET_BUILD_FIELD` it must NOT
 * clear `presetId`. See the Task 3 amendment: a generic non-invalidating build setter
 * would be an escape hatch a future caller could reach for on an actual hardware
 * field, silently reintroducing the stale-preset bug `withPresetField` exists to
 * prevent, so this is deliberately its own narrow action rather than a general one.
 * @typedef {{type: 'SET_BOOST_SEL', value: number}} SetBoostSelAction
 */

/**
 * Opens or dismisses the overwrite-confirmation prompt. Also a cursor/UI-state field,
 * not hardware, so — like `SET_BOOST_SEL` — it must NOT clear `presetId`.
 * @typedef {{type: 'SET_PRESET_PROMPT', value: object|null}} SetPresetPromptAction
 */

/**
 * The reducer's equivalent of `setCfg`, which EcuLab.jsx used to implement as a
 * functional update over local state that also cleared `presetId`. Actions cannot
 * carry functions, so the merge happens here: the reducer already holds the current
 * `engineConfig` and does the spread itself. Invalidates like every other hardware
 * write.
 *
 * @typedef {{type: 'SET_ENGINE_CONFIG_PATCH', patch: Partial<import('../../sim/index.js').EngineConfig>}} SetEngineConfigPatchAction
 */

/**
 * Loads a factory preset's complete patch — build, tune AND session — in one pass.
 * `action.preset` is the ALREADY-COMPUTED patch object `applyPreset(rawPreset)`
 * returns (`src/sim/presets.js`), not the raw catalogue entry: computing it needs no
 * hardware the reducer doesn't already have in scope, unlike `RESET_TO_STOCK`'s `ve`,
 * but it is still the caller's job to produce it, the same way `SET_TABLE`'s caller
 * produces the table it hands over. `EcuLab.jsx`'s `applyEnginePreset` made 21
 * sequential raw `setState` calls across all three slices to land this and its own
 * comment warns that routing them through the invalidating setters "would make that
 * order-dependent" — deliberately bypassing `withPresetField`/`withTableEdit` because
 * IT needs `presetId` to end up SET, the opposite of every other write. One reducer
 * case removes the ordering hazard instead of documenting it: every field lands in the
 * same object-literal pass, so there is no "last call" to get right.
 * @typedef {{type: 'APPLY_PRESET', preset: {
 *   presetId: string, engineConfig: import('../../sim/index.js').EngineConfig,
 *   mods: BuildState['mods'], turboOn: boolean, boostCurve: number[],
 *   turbineIdx: number, turbineCount: number, compressorIdx: number, injIdx: number,
 *   ecuInjectorCc: number, octaneIdx: number, exhaustDiaIdx: number,
 *   ve: number[][], timing: number[][], afr: number[][],
 * }}} ApplyPresetAction
 */

/**
 * Wipes the calibration back to a generic stock baseline and drops any preset label,
 * mirroring `resetToStock` (`EcuLab.jsx:726`). `action.ve` is the recomputed stock VE
 * table: producing it needs `computeHardwareVE` fed the CURRENT hardware
 * (`engineConfig`, `turboOn`, `exhaustDiaIdx`, `boostCurve`, fuel, turbine) mixed with
 * a hypothetical DEFAULT_MODS, which is exactly the kind of hardware-shaped lookup the
 * reducer should not be reaching for itself — so the caller computes it, the same
 * reasoning as `SET_TABLE`. `timing`/`afr`/`mods`/`mafScalar` reset to fixed constants
 * that need no such lookup, so the reducer sets those itself. The original made six
 * `setState` calls and documented that "the last call pins tablesDirty back to false"
 * — three of the five earlier calls set it true via `withTableEdit`/`withPresetField`,
 * so the LAST write had to win. One action has no "last write" to get right: it is
 * simply false in the object literal below.
 * @typedef {{type: 'RESET_TO_STOCK', ve: number[][]}} ResetToStockAction
 */

/**
 * Restores every worn engine component to full health, mirroring `repairEngine`
 * (`EcuLab.jsx:737`).
 * @typedef {{type: 'REPAIR_ENGINE'}} RepairEngineAction
 */

/**
 * Takes a career job: fits the customer's car and clears the bench, in one pass.
 *
 * A job is a car that arrives with one fault already in it, so taking one has to write
 * across all three slices at once — the hardware the customer turned up with, a stock
 * calibration to diagnose it against, and a bench with no trace of the last job on it.
 * Split into fifteen separate writes it would render fifteen times, and worse, a
 * half-applied job is a car with the fault fitted and the old tables still loaded, which
 * is not any car the player was handed.
 *
 * `build` and `ve` are computed by the caller for the same reason `RESET_TO_STOCK`'s are:
 * they need `computeHardwareVE` fed a hardware description, which is exactly the lookup
 * the reducer should not be reaching for. Everything the reducer can set from constants —
 * the stock timing and fuel tables, full health, an empty result — it sets itself.
 * @typedef {{type: 'TAKE_JOB', index: number, build: Partial<BuildState>, ve: number[][]}} TakeJobAction
 */

/**
 * Finalises a completed dyno pull: banks the score, wears the engine, and rotates
 * `result` into `prevResult`. Mirrors the tail of `doRun` (`EcuLab.jsx:868-896`) —
 * NOT the whole function, which also flips `running`/`revealCount` for the reveal
 * animation before and after an interval-driven timer runs; that is time-based UI
 * state with no atomicity hazard and stays as plain `SET_SESSION_FIELD` dispatches in
 * the component (Task 4). The part that DOES have an ordering hazard, and is what this
 * action removes: `doRun` used to call `setPrevResult(result)` (the OLD result)
 * before `setResult(r)` (the new one) — reversing those two lines would silently have
 * made `prevResult` equal the new result instead of the old one. `action.result` and
 * `action.pullScore` are precomputed by the caller: `result` comes from
 * `simulateSweep`, and `pullScore` from `computePullScore`, which needs derived
 * hardware objects (`turbine`, `compressor`, `dutyPreview`, `exhaustDiaError`) that
 * are `useMemo` values in the component, not raw state the reducer holds — the same
 * "caller computes, reducer applies" split as `RESET_TO_STOCK`'s `ve`.
 * @typedef {{type: 'BANK_PULL', result: object, pullScore: number}} BankPullAction
 */

/**
 * Advances the live engine by ONE integration step, replacing `EcuLab.jsx`'s
 * `setLive((prev) => liveStep(prev, ...))` inside a 50 ms `setInterval`.
 *
 * This exists because a `SET_SESSION_FIELD` carrying an already-computed value could
 * not be made correct here. The interval is installed once, with `[]` deps, so its
 * callback closes over the `live` from the FIRST render forever. Computing
 * `liveStep(live, ...)` in that callback would integrate from a state that is frozen
 * at engine-off — the readout would sit dead, or jitter between two adjacent steps,
 * and it would look like a physics bug rather than a stale closure. The functional
 * `setLive(prev => ...)` form has no reducer equivalent, because actions must not
 * carry functions. So the step happens HERE, where `prev` comes from the store.
 *
 * `input` and `cfg` are read from refs at DISPATCH time and carried on the action.
 * They are the only two things the step needs that the reducer does not hold:
 * `cfg` is `liveCfgRef.current`, rebuilt from the build/tune slices on every render
 * (a live table edit must reach the running engine without restarting the interval),
 * and `input.throttle` is `throttleRef.current`. Neither is a function.
 *
 * The one caveat, recorded because it is real rather than because it matters: the old
 * updater read both refs when React RAN it, this reads them when the interval
 * dispatches. The gap between the two is one React render — sub-millisecond against a
 * 50 ms tick, and refs only change from pointer handlers and render, so no step can
 * land on different inputs than it would have before.
 *
 * @typedef {{type: 'LIVE_STEP', dt: number, input: {throttle: number, load: number}, cfg: object}} LiveStepAction
 */

/**
 * Merges a patch into the live-engine state, for the two writes that are a COMMAND to
 * the engine rather than a step of it: `startEngine` (`{cranking: true}`) and
 * `stopEngine` (`{running: false, cranking: false}`). Both were
 * `setLive((p) => ({ ...p, ... }))` — functional, because they must land on top of
 * whatever the 20 Hz interval last wrote, not on the `live` the click handler's render
 * happened to capture. A value-carrying `SET_SESSION_FIELD` would rewind the engine by
 * up to one step (rpm, temperatures, trims) every time the player pressed START or
 * STOP. The reducer holds the current `live`, so the merge happens here.
 * @typedef {{type: 'LIVE_PATCH', patch: object}} LivePatchAction
 */

/**
 * The union of every action shape the reducer actually understands. Deliberately has
 * NO catch-all `{type: string, [key: string]: *}` member: with one, every object
 * shape is assignable to `StoreAction` and the eleven specific typedefs above become
 * decorative — a typo'd payload key (`presset` instead of `preset`) would typecheck
 * clean. Without the catch-all, `tsc` must reject it.
 * @typedef {SetBuildFieldAction | ClearPresetIdAction | SetTurbineAction | SetTableAction |
 *   SetSessionFieldAction | SetTuneFieldAction | SetBoostSelAction |
 *   SetPresetPromptAction | SetEngineConfigPatchAction | ApplyPresetAction |
 *   ResetToStockAction | RepairEngineAction | BankPullAction | TakeJobAction | LiveStepAction |
 *   LivePatchAction
 * } KnownStoreAction
 */

/**
 * Kept as the public name `StoreAction` (re-exported via `StoreProvider.jsx`'s
 * `@typedef {import('./reducer.js').StoreAction}`) so callers outside this file are
 * unaffected — it is simply an alias for {@link KnownStoreAction}, not a looser type.
 * @typedef {KnownStoreAction} StoreAction
 */

/**
 * The root reducer. No `Date.now()`, no mutation of `state` or any of its slices —
 * every case that changes a slice returns a NEW object for that slice only, and every
 * slice it does not touch keeps its existing reference (so `React.memo`/`useMemo`
 * consumers downstream can bail out on an unrelated dispatch).
 *
 * ONE case is not a pure function of `(state, action)`: `LIVE_STEP` calls `liveStep`,
 * which is itself pure apart from `sensorRead`'s `Math.random()` sensor noise (see
 * src/sim/live.js). That is deliberate and it is contained. What impurity would
 * normally cost is replay-safety — React re-runs a reducer over the same actions when
 * a render is double-invoked under StrictMode, or when an update is rebased behind a
 * higher-priority one — and here a replay re-integrates the SAME single step from the
 * SAME `prev`; React never applies an action twice, it recomputes from base, so this
 * is always a SINGLE-step replay. For that single step, the only thing that differs
 * between two runs is a fraction of a percent of simulated sensor noise, which is
 * random by design. That framing does NOT generalise to a multi-step replay, and the
 * reason is not cosmetic: the noise `sensorRead` writes into `sensedLambda`
 * (live.js:253) is integrated into `stft` (live.js:239), `stft` into `ltft`
 * (live.js:240), and `ltft` feeds back into `mafScalar` (live.js:192) — the airflow
 * the engine actually runs on. Re-integrating several steps in sequence from divergent
 * noise would be a bounded random walk through a learned fuel trim, not a rounding
 * difference. Nothing in this reducer does that today — every replay React performs
 * here is single-step — but it bounds what a FUTURE caller may safely do with this
 * action: PR 4's undo log MUST exclude LIVE_STEP. It dispatches at 20 Hz, so one hour
 * of idle alone is 72,000 entries, each pinning a `cfg` that references the full
 * VE/timing/AFR tables — and even setting that cost aside, "undo the last 50 ms of
 * engine idle" is not a thing a player wants. No other case may call `Math.random()`;
 * a second one would be a reason to move the step out of the reducer, not a
 * precedent.
 *
 * @param {StoreState} state
 * @param {StoreAction} action
 * @returns {StoreState}
 */
export function reducer(state, action) {
  switch (action.type) {
    case ACTIONS.SET_BUILD_FIELD:
      return {
        ...state,
        build: { ...state.build, [action.field]: action.value, presetId: null },
      };

    case ACTIONS.CLEAR_PRESET_ID:
      return {
        ...state,
        build: { ...state.build, presetId: null },
      };

    case ACTIONS.SET_TURBINE:
      return {
        ...state,
        build: {
          ...state.build,
          turbineIdx: action.value,
          turbineCount: 1,
          presetId: null,
        },
      };

    case ACTIONS.SET_TABLE:
      return {
        ...state,
        build: { ...state.build, presetId: null },
        tune: { ...state.tune, [action.table]: action.value, tablesDirty: true },
      };

    case ACTIONS.SET_SESSION_FIELD:
      return {
        ...state,
        session: { ...state.session, [action.field]: action.value },
      };

    case ACTIONS.SET_TUNE_FIELD:
      return {
        ...state,
        tune: { ...state.tune, [action.field]: action.value },
      };

    case ACTIONS.SET_BOOST_SEL:
      return {
        ...state,
        build: { ...state.build, boostSel: action.value },
      };

    case ACTIONS.SET_PRESET_PROMPT:
      return {
        ...state,
        build: { ...state.build, presetPrompt: action.value },
      };

    case ACTIONS.SET_ENGINE_CONFIG_PATCH:
      return {
        ...state,
        build: {
          ...state.build,
          engineConfig: { ...state.build.engineConfig, ...action.patch },
          presetId: null,
        },
      };

    case ACTIONS.APPLY_PRESET: {
      const p = action.preset;
      return {
        ...state,
        build: {
          ...state.build,
          engineConfig: p.engineConfig,
          mods: p.mods,
          turboOn: p.turboOn,
          boostCurve: p.boostCurve,
          turbineIdx: p.turbineIdx,
          turbineCount: p.turbineCount,
          compressorIdx: p.compressorIdx,
          injIdx: p.injIdx,
          ecuInjectorCc: p.ecuInjectorCc,
          octaneIdx: p.octaneIdx,
          exhaustDiaIdx: p.exhaustDiaIdx,
          // A preset's AFR table already bakes in a correction for the MAF error its
          // mod set implies (factoryCalibration, src/sim/presets.js) — valid only at
          // the neutral scalar, so loading a preset must pin this back to 1.0.
          mafScalar: 1.0,
          presetId: p.presetId,
          presetPrompt: null,
        },
        tune: {
          ...state.tune,
          ve: p.ve,
          timing: p.timing,
          afr: p.afr,
          // Fresh factory calibration is not unsaved player work.
          tablesDirty: false,
          selection: null,
        },
        session: {
          ...state.session,
          // A factory rating from the newly loaded engine must never sit next to a
          // pull logged on whatever was running before it.
          result: null,
          prevResult: null,
        },
      };
    }

    case ACTIONS.RESET_TO_STOCK:
      return {
        ...state,
        build: {
          ...state.build,
          mods: DEFAULT_MODS,
          mafScalar: 1.0,
          presetId: null,
        },
        tune: {
          ...state.tune,
          ve: action.ve,
          timing: clone2D(DEFAULT_TIMING),
          afr: clone2D(DEFAULT_AFR),
          // A reset baseline is not unsaved player work — no "last call" needed to
          // pin this false, it is simply false in this same pass.
          tablesDirty: false,
        },
      };

    case ACTIONS.TAKE_JOB:
      return {
        ...state,
        build: {
          ...state.build,
          ...action.build,
          // The customer's car is not one of the factory presets, whatever hardware it
          // happens to share with one.
          presetId: null,
          mafScalar: 1.0,
        },
        tune: {
          ...state.tune,
          ve: action.ve,
          timing: clone2D(DEFAULT_TIMING),
          afr: clone2D(DEFAULT_AFR),
          // A car handed over for diagnosis carries no unsaved work of the player's.
          tablesDirty: false,
          selection: null,
        },
        session: {
          ...state.session,
          activeJob: action.index,
          jobResult: null,
          // A fresh bench. A pull logged on the last customer's car next to this one's
          // target is worse than no pull at all.
          result: null,
          prevResult: null,
          histogram: null,
          health: { piston: 100, bearing: 100, valve: 100 },
        },
      };

    case ACTIONS.REPAIR_ENGINE:
      return {
        ...state,
        session: {
          ...state.session,
          health: { piston: 100, bearing: 100, valve: 100 },
        },
      };

    case ACTIONS.BANK_PULL:
      return {
        ...state,
        session: {
          ...state.session,
          // The OLD result becomes prevResult BEFORE the new one overwrites `result` —
          // reversing this order would silently make prevResult equal the new result.
          prevResult: state.session.result,
          result: action.result,
          health: {
            piston: clamp(state.session.health.piston - action.result.wear.piston, 0, 100),
            bearing: clamp(state.session.health.bearing - action.result.wear.bearing, 0, 100),
            valve: clamp(state.session.health.valve - action.result.wear.valve, 0, 100),
          },
          bestScore: Math.max(state.session.bestScore, action.pullScore),
          totalScore: state.session.totalScore + action.pullScore,
          pullCount: state.session.pullCount + 1,
        },
      };

    case ACTIONS.LIVE_STEP: {
      const prev = state.session.live;
      // A stopped engine has nothing to integrate. React 18's `dispatchReducerAction`
      // DOES have an eager path: when the fiber has no pending lanes, it runs the
      // reducer immediately outside of render and bails out on
      // `Object.is(eagerState, currentState)` without scheduling a render at all. But
      // that path is opportunistic, not guaranteed — it does not fire once a render is
      // already in flight, which a dispatch arriving 20 times a second, racing every
      // other UI action in the app, cannot rely on being clear of. Returning the SAME
      // state object here is what GUARANTEES the bail-out on every tick regardless:
      // even on the slow path, reconciliation compares the reducer's return value to
      // the fiber's current state by `Object.is` and leaves `didReceiveUpdate` false
      // when they match, so React still bails out of `StoreProvider`'s subtree and no
      // consumer re-renders. This guard is `setLive`'s `: prev` branch, moved.
      if (!(prev.running || prev.cranking || prev.rpm > 1)) return state;
      return {
        ...state,
        session: {
          ...state.session,
          live: liveStep(prev, action.dt, action.input, action.cfg),
        },
      };
    }

    case ACTIONS.LIVE_PATCH:
      return {
        ...state,
        session: { ...state.session, live: { ...state.session.live, ...action.patch } },
      };

    default:
      // Unknown action: return the SAME object by reference so React's useReducer
      // bails out of the re-render instead of scheduling one for a no-op.
      return state;
  }
}
