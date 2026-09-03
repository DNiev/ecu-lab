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

import { clamp, clone2D, DEFAULT_AFR, DEFAULT_MODS, DEFAULT_TIMING, liveStep, presetById } from '../../sim/index.js';

import {
  HISTORY_LIMIT, RESTORE_ALL, RESTORE_CALIBRATION, restore, snapshot, snapshotsTuneField,
} from './history.js';
import { pushRun, RUN_LIMIT } from './runLog.js';

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
  RESTORE_CAREER: 'RESTORE_CAREER',
  PIN_RUN: 'PIN_RUN',
  UNPIN_RUN: 'UNPIN_RUN',
  LIVE_STEP: 'LIVE_STEP',
  LIVE_PATCH: 'LIVE_PATCH',
  UNDO: 'UNDO',
  REDO: 'REDO',
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
 * Finalises a completed dyno pull: banks the score, wears the engine, installs the
 * new `result`, and pushes a slim record of it to the front of `runs` (Task 4;
 * `runLog.js`'s `ghostRun` reads that log for the comparison the old `prevResult`
 * field used to hold directly). Mirrors the tail of `doRun` (`EcuLab.jsx:868-896`) —
 * NOT the whole function, which also flips `running`/`revealCount` for the reveal
 * animation before and after an interval-driven timer runs; that is time-based UI
 * state with no atomicity hazard and stays as plain `SET_SESSION_FIELD` dispatches in
 * the component. `action.result` and `action.pullScore` are precomputed by the
 * caller: `result` comes from
 * `simulateSweep`, and `pullScore` from `computePullScore`, which needs derived
 * hardware objects (`turbine`, `compressor`, `dutyPreview`, `exhaustDiaError`) that
 * are `useMemo` values in the component, not raw state the reducer holds — the same
 * "caller computes, reducer applies" split as `RESET_TO_STOCK`'s `ve`.
 *
 * `scores` arrives the same way and for the same reason, and banking it here rather
 * than deriving it later is the second ordering hazard this action owns. The score
 * panels used to recompute the Engineer and Pull scores from whatever hardware was
 * selected at RENDER time, against the last pull's dyno output — so changing a turbo
 * after a pull re-graded that finished run as though it had been made on the new
 * build, and the Pull Score could climb past `bestScore` with nobody having run
 * anything. Banked here, the numbers are what the pull measured, permanently.
 *
 * `wasBest` is decided HERE rather than by the caller because this case is where
 * `bestScore` moves: the comparison has to happen against the value as it stands
 * BEFORE this pull is folded in, and this is the only place that still holds it.
 * @typedef {{type: 'BANK_PULL', result: object, pullScore: number, run: import('./runLog.js').RunRecord,
 *   scores: {tuning: object, engineer: object, signature: string}}} BankPullAction
 */

/**
 * Merges a career loaded from storage into the CURRENT session, rather than
 * overwriting it. Replaces five `SET_SESSION_FIELD` dispatches EcuLab.jsx used to fire
 * after `await loadCareer()` resolved — the same reasoning `BANK_PULL` and
 * `APPLY_PRESET` already document for why a cross-field write is one action instead of
 * a sequence: five separate dispatches have an ordering hazard a single pass does not.
 *
 * Here the hazard is a race, not intra-render ordering: `loadCareer()` is an `await`,
 * so a pull can bank (`BANK_PULL`) between mount and this action landing. On the
 * `artifact` storage backend `window.storage.get` is a real round trip a human
 * interaction can land inside, not just a stray microtask, so this is reachable in
 * practice, not merely in theory. Overwriting the session with the loaded snapshot in
 * that window would roll a real, already-banked pull back to whatever was saved before
 * it — and because career persistence is itself a reactive effect over these same
 * fields (not the old imperative call inside `doRun`), the rollback would not stop at
 * the screen: the persistence effect would write the rolled-back snapshot straight
 * back to disk, destroying the banked pull permanently.
 *
 * The fix is a merge, not a skip. Skipping the restore when something banked first
 * would leave the session holding ONLY this-session values — a `bestScore` from one
 * pull, a `totalScore` from one pull — and the persistence effect would then write
 * that truncated career over the real saved one, which is the same data loss by a
 * different door. Merging instead means every term below combines "what was saved"
 * with "what happened this session since mount":
 *  - `bestScore`: the higher of the two.
 *  - `totalScore` / `pullCount`: summed — the session started at zero, so its value
 *    IS what happened since mount.
 *  - `runs`: the session's own runs (newer) in front of the loaded ones, capped at
 *    {@link RUN_LIMIT} the same way `pushRun` caps `BANK_PULL`'s write.
 *  - `pinnedRunId`: a pin the player set this session wins over a restored one — they
 *    cannot have pinned anything before the restore lands, so a non-null session value
 *    here can only mean they pinned it AFTER banking, during the same race window.
 *
 * In the common case — nothing banked before the load resolves — the session is still
 * at its zeroed initial values, so every one of those merges reduces to the loaded
 * value exactly: `max(loaded, 0) === loaded`, `loaded + 0 === loaded`,
 * `[...[], ...loaded] === loaded`-shaped, `null ?? loaded === loaded`. One code path
 * handles both, with no `if (pristine)` branch to fall out of sync with the other.
 *
 * NOT IDEMPOTENT. `bestScore`/`totalScore`/`pullCount` SUM, and `runs` concatenates —
 * dispatching this twice with the same `career` double-counts every one of them and
 * duplicates every loaded run. It must be dispatched exactly once per mount. The
 * safety net for that today is entirely in `EcuLab.jsx`: the career-restore effect's
 * `cancelled` flag (set on cleanup) stops a second `loadCareer()` from a re-mounted
 * effect from ever reaching `dispatch`, and `careerLoaded.current` gates the SEPARATE
 * save effect from writing before a restore has landed. Neither guard lives in this
 * reducer, so a future caller of this action has nothing here stopping it from
 * breaking that invariant.
 *
 * One more edge alongside the `pinnedRunId` one above, and equally rare: a pull banked
 * DURING the restore window (between mount and `loadCareer()` resolving) gets whatever
 * `n` the session's own pull counter was on — typically a low one, since nothing has
 * been played yet — and can sort oddly next to the restored runs' much higher `n`
 * values once merged. Cosmetic; the run itself is correct and in the right position
 * (newest-first, at index 0), only its ordinal can look out of sequence.
 * @typedef {{type: 'RESTORE_CAREER', career: import('../../storage.js').Career}} RestoreCareerAction
 */

/**
 * Pins one banked run as the ghost curve's comparison. Holds the run's `id` rather
 * than its index: eviction shifts every index, so an index-based pin would silently
 * repoint at a run the player never chose.
 * @typedef {{type: 'PIN_RUN', id: string}} PinRunAction
 */

/**
 * Drops the pin, returning the ghost to the previous run. No payload — there is only
 * ever one pin.
 * @typedef {{type: 'UNPIN_RUN'}} UnpinRunAction
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
 * Steps the undo stack back one entry, restoring the snapshot `past[past.length - 1]`
 * carries and pushing the pre-undo state onto `future`. No payload: the reducer reads
 * everything it needs off `state.history` itself.
 * @typedef {{type: 'UNDO'}} UndoAction
 */

/**
 * Steps the redo stack forward one entry, replaying the snapshot `future[0]` carries.
 * The mirror of `UndoAction` — see there for why no payload travels on the action.
 * @typedef {{type: 'REDO'}} RedoAction
 */

/**
 * The union of every action shape the reducer actually understands. Deliberately has
 * NO catch-all `{type: string, [key: string]: *}` member: with one, every object
 * shape is assignable to `StoreAction` and the twenty specific typedefs above become
 * decorative — a typo'd payload key (`presset` instead of `preset`) would typecheck
 * clean. Without the catch-all, `tsc` must reject it.
 * @typedef {SetBuildFieldAction | ClearPresetIdAction | SetTurbineAction | SetTableAction |
 *   SetSessionFieldAction | SetTuneFieldAction | SetBoostSelAction |
 *   SetPresetPromptAction | SetEngineConfigPatchAction | ApplyPresetAction |
 *   ResetToStockAction | RepairEngineAction | BankPullAction | RestoreCareerAction |
 *   PinRunAction | UnpinRunAction | LiveStepAction | LivePatchAction | UndoAction |
 *   RedoAction
 * } KnownStoreAction
 */

/**
 * Kept as the public name `StoreAction` (re-exported via `StoreProvider.jsx`'s
 * `@typedef {import('./reducer.js').StoreAction}`) so callers outside this file are
 * unaffected — it is simply an alias for {@link KnownStoreAction}, not a looser type.
 * @typedef {KnownStoreAction} StoreAction
 */

/**
 * Every case except UNDO/REDO. Wrapped by `reducer` below, which adds the undo stack
 * on top and is what callers actually use — see that function's own doc for what the
 * wrapper does and why it stays pure too.
 *
 * No `Date.now()`, no mutation of `state` or any of its slices — every case that
 * changes a slice returns a NEW object for that slice only, and every
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
function baseReducer(state, action) {
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
          // pull logged on whatever was running before it. The scores go with the
          // result they belong to — leaving them behind would put a scorecard on
          // screen with no dyno curve under it.
          result: null,
          pullScores: null,
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
          result: action.result,
          // The record is built by the caller, not here: it needs `Date.now()` for its
          // id and timestamp, and this reducer is documented as calling no clock.
          //
          // The banked run goes in front, so runs[0] is always the pull `result` now
          // holds and runs[1] is the one before it — the ordering the old
          // prevResult-before-result rotation existed to get right.
          runs: pushRun(state.session.runs, action.run),
          health: {
            piston: clamp(state.session.health.piston - action.result.wear.piston, 0, 100),
            bearing: clamp(state.session.health.bearing - action.result.wear.bearing, 0, 100),
            valve: clamp(state.session.health.valve - action.result.wear.valve, 0, 100),
          },
          // Banked, not derived: see the typedef above for the re-grading bug that
          // recomputing these from current hardware caused. `wasBest` compares against
          // `state.session.bestScore` — the best BEFORE this pull — never the
          // `bestScore` line below, which already includes it and would say yes on
          // every pull, tie or not.
          pullScores: {
            ...action.scores,
            pull: action.pullScore,
            wasBest: action.pullScore > state.session.bestScore,
          },
          bestScore: Math.max(state.session.bestScore, action.pullScore),
          totalScore: state.session.totalScore + action.pullScore,
          pullCount: state.session.pullCount + 1,
          // The focus belongs to the log of the pull it was clicked on. Carried into
          // this new pull it would highlight whichever events happen to span that RPM.
          logFocusRpm: null,
        },
      };

    case ACTIONS.RESTORE_CAREER: {
      const c = action.career;
      const s = state.session;
      return {
        ...state,
        session: {
          ...s,
          bestScore: Math.max(c.best, s.bestScore),
          totalScore: c.total + s.totalScore,
          pullCount: c.pulls + s.pullCount,
          // Anything banked this session is newer than anything loaded, so it goes in
          // front — same newest-first convention `pushRun` keeps for BANK_PULL.
          runs: [...s.runs, ...c.runs].slice(0, RUN_LIMIT),
          // A pin set THIS session (impossible before the restore lands, except during
          // the very race this action exists to survive) wins over a restored one. NOTE:
          // null means both "never touched" and "deliberately cleared", so an unpin
          // performed between BANK_PULL and RESTORE_CAREER is indistinguishable from no
          // pin ever being set, and a stale saved pin will resurface. This edge is
          // accepted rather than fixed with a tri-state; the restore race is rare and
          // the workaround (clicking the pin again) is trivial.
          pinnedRunId: s.pinnedRunId ?? c.pinnedRunId,
        },
      };
    }

    case ACTIONS.PIN_RUN:
      return { ...state, session: { ...state.session, pinnedRunId: action.id } };

    case ACTIONS.UNPIN_RUN:
      return { ...state, session: { ...state.session, pinnedRunId: null } };

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

/**
 * The three actions that destroy calibration the player cannot otherwise get back,
 * each mapped to HOW MUCH of its snapshot an undo puts back (history.js).
 *
 * Hardware writes are deliberately absent: every hardware control already displays its
 * own current value, so it is self-reversing, and undo must not become a time machine
 * over banked career progress.
 *
 * The scope is per-action because the snapshot is not: `snapshot()` captures the union
 * of every field ANY of these three can write, so replaying an entry in full would put
 * back fields the recorded action never touched. `SET_TABLE`'s entire build-side write
 * is `presetId`, so RESTORE_CALIBRATION is exactly its write surface; the other two
 * replace the whole build, so RESTORE_ALL is exactly theirs.
 *
 * A map rather than a Set plus a lookup elsewhere: `UNDOABLE` is derived from its keys
 * below, so a fourth undoable action cannot be added to the membership list without
 * also declaring what its undo restores.
 */
const UNDO_SCOPE = Object.freeze({
  [ACTIONS.SET_TABLE]: RESTORE_CALIBRATION,
  [ACTIONS.APPLY_PRESET]: RESTORE_ALL,
  [ACTIONS.RESET_TO_STOCK]: RESTORE_ALL,
});

const UNDOABLE = new Set(Object.keys(UNDO_SCOPE));

/**
 * Every action that counts as NEW WORK, and therefore abandons the redo branch.
 *
 * The membership rule is: does this case write a field the snapshot carries — the
 * hardware and calibration in BUILD_KEYS/TUNE_KEYS? Those are precisely the fields a
 * later REDO would overwrite, so leaving `future` alive across one of them lets redo
 * throw away work the player did after the undo, labelled only with what the redone
 * action was. That was reachable: APPLY_PRESET -> UNDO -> fit a turbo, build a boost
 * curve, pick a fuel -> REDO, and the octane goes back to the preset's under the
 * label "Redo Preset · Nissan VQ35HR".
 *
 * Excluded, and why each one has to be:
 *  - LIVE_STEP / LIVE_PATCH write `session.live`. LIVE_STEP alone fires at 20 Hz, so
 *    including it would destroy the redo branch within one tick of the engine
 *    running — undo would be unusable on any tab while the engine idles.
 *  - SET_SESSION_FIELD, BANK_PULL, REPAIR_ENGINE write `session` only, which no
 *    snapshot carries and no restore touches.
 *  - SET_BOOST_SEL, SET_PRESET_PROMPT, SET_TUNE_FIELD are cursors and UI state:
 *    `boostSel`, `presetPrompt` and `selection` are all deliberately outside the
 *    snapshot (see history.js). SET_TUNE_FIELD is the generic tune setter, but its
 *    only callers pass `selection` — and one of them is the tab switch, so counting
 *    it as new work would mean walking from TUNE to BUILD silently killed the redo
 *    a player crossed tabs to reach.
 *  - UNDO/REDO manage `future` themselves.
 *
 * The three UNDOABLE actions are listed here too, for one list that answers "is this
 * new work?" — they reach `future: []` through the recording branch below rather than
 * through this Set, and listing them keeps the two from disagreeing on paper.
 */
/**
 * Does this action write a field some snapshot carries, and therefore abandon a live
 * redo branch?
 *
 * `SET_TUNE_FIELD` needs the extra question because it is the one action whose write
 * surface depends on its payload rather than its type. Its five production callers all
 * pass `field: 'selection'` — a cursor, outside the snapshot, and written by `changeTab`
 * on every tab switch, so treating it as new work would mean walking from TUNE to BUILD
 * killed the redo the player crossed tabs to reach. But nothing in the type stops a
 * caller passing `'ve'`, and that write WOULD be overwritten by a redo. Asking the
 * snapshot's own key list makes the exclusion structural instead of an observation about
 * today's callers.
 * @param {any} action
 * @returns {boolean}
 */
function clearsRedo(action) {
  if (action.type === ACTIONS.SET_TUNE_FIELD) return snapshotsTuneField(action.field);
  return CLEARS_REDO.has(action.type);
}

const CLEARS_REDO = new Set([
  ACTIONS.SET_BUILD_FIELD, ACTIONS.CLEAR_PRESET_ID, ACTIONS.SET_TURBINE,
  ACTIONS.SET_ENGINE_CONFIG_PATCH, ACTIONS.SET_TABLE, ACTIONS.APPLY_PRESET,
  ACTIONS.RESET_TO_STOCK,
]);

/**
 * Names what an undoable action did, for the undo button's `aria-label` and BUILD's
 * post-load offer. Lives here rather than in history.js because it needs `ACTIONS` and
 * the preset catalogue, and history.js must not import this module.
 * @param {any} action
 * @returns {string}
 */
function labelFor(action) {
  switch (action.type) {
    case ACTIONS.SET_TABLE: {
      const label = { ve: 'VE edit', timing: 'Spark edit', afr: 'Fuel edit' }[action.table];
      // Same reasoning as the `default` branch below, and it needs stating twice
      // because the failure this one prevents is worse. An unrecognised table used to
      // return `undefined`, which was pushed onto the stack as the entry's label; the
      // crash then happened in EngineScreen.jsx, on BUILD, at `top.label.startsWith(...)`
      // — a TypeError on a different screen, at a stack naming neither the dispatch nor
      // the table. Throwing here names both.
      if (!label) throw new Error(`labelFor: no label defined for table "${action.table}"`);
      return label;
    }
    case ACTIONS.APPLY_PRESET: {
      const preset = presetById(action.preset.presetId);
      return `Preset · ${preset ? preset.name : 'factory calibration'}`;
    }
    case ACTIONS.RESET_TO_STOCK:
      return 'Reset to stock';
    default:
      // UNDOABLE lists exactly three action types, and `reducer` below only ever
      // calls `labelFor` for an action already confirmed to be in that set — so this
      // branch is unreachable BY CONSTRUCTION today. It throws instead of quietly
      // returning 'Reset to stock' so that if a fourth action is ever added to
      // UNDOABLE without a matching case here, it fails loudly at the call site
      // instead of mislabelling every undo button for that action "Reset to stock".
      throw new Error(`labelFor: no label defined for undoable action type "${action.type}"`);
  }
}

/**
 * The store's reducer: `baseReducer` plus the undo stack.
 *
 * Recording is a WRAPPER rather than a line inside each undoable case, so the three
 * existing cases stay exactly as they were and a fourth undoable action is one entry in
 * `UNDOABLE` rather than a fourth place to remember. It stays a pure function of
 * `(state, action)` — no clock, no coalescing keys, no merge logic. The dock's slider
 * commits once on release instead (see SelectionDock.jsx), which is what keeps a drag
 * from becoming eighteen undo steps without any of that machinery.
 *
 * @param {StoreState} state
 * @param {any} action
 * @returns {StoreState}
 */
export function reducer(state, action) {
  if (action.type === ACTIONS.UNDO) {
    const { past, future } = state.history;
    if (past.length === 0) return state;
    const entry = past[past.length - 1];
    return {
      ...restore(state, entry.before, entry.scope),
      history: {
        past: past.slice(0, -1),
        // The scope rides along with the entry in both directions, so a redo puts
        // back exactly as much as the undo took away.
        future: [{ label: entry.label, before: snapshot(state), scope: entry.scope }, ...future],
      },
    };
  }

  if (action.type === ACTIONS.REDO) {
    const { past, future } = state.history;
    if (future.length === 0) return state;
    const entry = future[0];
    return {
      ...restore(state, entry.before, entry.scope),
      history: {
        past: [...past, { label: entry.label, before: snapshot(state), scope: entry.scope }]
          .slice(-HISTORY_LIMIT),
        future: future.slice(1),
      },
    };
  }

  const next = baseReducer(state, action);
  if (UNDOABLE.has(action.type)) {
    return {
      ...next,
      history: {
        past: [...state.history.past, {
          label: labelFor(action),
          before: snapshot(state),
          scope: UNDO_SCOPE[action.type],
        }].slice(-HISTORY_LIMIT),
        // A new edit abandons the redo branch: keeping it would let redo jump the
        // player onto a timeline they had already left.
        future: [],
      },
    };
  }

  // Not recordable, but still new work: a hardware write is not undoable (the control
  // shows its own value) yet it changes fields a redo would overwrite, so it abandons
  // the redo branch just the same. See CLEARS_REDO for what counts and what must not.
  if (!clearsRedo(action) || state.history.future.length === 0) return next;
  return {
    ...next,
    history: { past: state.history.past, future: [] },
  };
}
