/**
 * The root reducer: one reducer over three slices (build, tune, session), not three
 * independent ones.
 *
 * Several writes have to cross slices together. Loading a preset replaces hardware,
 * calibration tables and the run result at once. A hand table edit writes a TUNE table,
 * clears `presetId` (BUILD) and sets `tablesDirty` (TUNE), and both slices must change
 * together or the header lies about which preset (if any) is loaded.
 *
 * Three independent contexts could only express that as choreography between
 * providers, with a write order that a later change could break. One reducer computes
 * the next state in a single pass instead: a case either changes a slice or it doesn't,
 * and there is no partial application to observe mid-write.
 *
 * SET_ENGINE_CONFIG_PATCH, LIVE_STEP and LIVE_PATCH stand in for functional `setState`
 * updaters. An action cannot carry a function, so the reducer resolves them against the
 * state it already holds.
 */

import { clamp, clone2D, DEFAULT_AFR, DEFAULT_MODS, DEFAULT_TIMING, ECU_META, liveStep, presetById, setCal } from '../../sim/index.js';

import {
  HISTORY_LIMIT, RESTORE_ALL, RESTORE_CALIBRATION, restore, snapshot, snapshotsTuneField,
} from './history.js';
import { stockEcuParts } from './initialState.js';
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
  SET_ECU: 'SET_ECU',
  SWITCH_MAP: 'SWITCH_MAP',
  COPY_MAP: 'COPY_MAP',
  SWAP_MAPS: 'SWAP_MAPS',
  LIVE_STEP: 'LIVE_STEP',
  LIVE_PATCH: 'LIVE_PATCH',
  UNDO: 'UNDO',
  REDO: 'REDO',
  TAKE_JOB: 'TAKE_JOB',
});

/**
 * Sets one field on the BUILD slice and clears `presetId`: a hand edit to any single
 * hardware/ECU field makes it a different build from the preset's. It does not touch
 * `tune.tablesDirty`, because hardware edits alone don't touch the calibration tables
 * (see SET_TABLE for the write that does).
 * @typedef {{type: 'SET_BUILD_FIELD', field: keyof BuildState, value: *}} SetBuildFieldAction
 */

/**
 * Clears `presetId` alone, with no other side effect. Deliberately narrower than
 * `SET_BUILD_FIELD`, which always pairs a field write with the same invalidation.
 * Its one caller is the preset picker's "Custom build" option: choosing it disowns
 * whatever preset is loaded without touching any other build field, so a generic
 * `{type: SET_BUILD_FIELD, field: 'presetId', value: null}` would only work by
 * coincidence: the reducer's own trailing `presetId: null` happens to overwrite
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
 * `presetId` (BUILD) and sets `tablesDirty` (TUNE). Every hand table edit has to cross
 * the build/tune boundary in one step like this, which is the main reason this is one
 * reducer and not two.
 * `label` is the undo entry's detail, e.g. "scale +5% · 12 cells" — see `labelFor`.
 * @typedef {{type: 'SET_TABLE', table: 've'|'timing'|'afr', value: number[][], label?: string}} SetTableAction
 */

/**
 * Writes the engine management calibration: one field by dotted `path`
 * (`'boost.kp'`, `'fuel.warmup'`), or the whole of it when `path` is absent — a reset
 * to the factory calibration, or a saved one loaded. Undoable, like a table edit, and
 * for the same reason: it is calibration the player cannot otherwise get back.
 * @typedef {{type: 'SET_ECU', path?: string, value: any, label?: string}} SetEcuAction
 */

/**
 * Map switching, as UpRev's map slots and HP Tuners' Switch on the Fly do it: store the
 * running calibration in its slot and run another (SWITCH_MAP); copy the running
 * calibration into another slot (COPY_MAP); exchange two slots (SWAP_MAPS).
 * @typedef {{type: 'SWITCH_MAP', index: number}} SwitchMapAction
 * @typedef {{type: 'COPY_MAP', to: number}} CopyMapAction
 * @typedef {{type: 'SWAP_MAPS', a: number, b: number}} SwapMapsAction
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
 * Moves the boost-curve editor's selected RPM column. A cursor, not hardware (the
 * build-side analogue of `tune.selection`), so unlike `SET_BUILD_FIELD` it must not
 * clear `presetId`. A generic non-invalidating build setter would be an escape hatch a
 * future caller could reach for on an actual hardware field, leaving a stale preset
 * label on a changed build, so this is deliberately its own narrow action.
 * @typedef {{type: 'SET_BOOST_SEL', value: number}} SetBoostSelAction
 */

/**
 * Opens or dismisses the overwrite-confirmation prompt. Also a cursor/UI-state field,
 * not hardware, so like `SET_BOOST_SEL` it must not clear `presetId`.
 * @typedef {{type: 'SET_PRESET_PROMPT', value: object|null}} SetPresetPromptAction
 */

/**
 * Merges a partial `engineConfig` (EngineScreen.jsx's `setCfg`). Actions cannot carry
 * functions, so the merge happens here: the reducer already holds the current
 * `engineConfig` and does the spread itself. Clears `presetId` like every other
 * hardware write.
 *
 * @typedef {{type: 'SET_ENGINE_CONFIG_PATCH', patch: Partial<import('../../sim/index.js').EngineConfig>}} SetEngineConfigPatchAction
 */

/**
 * Loads a factory preset's complete patch (build, tune and session) in one pass.
 * `action.preset` is the already-computed patch object `applyPreset(rawPreset)`
 * returns (`src/sim/presets.js`), not the raw catalogue entry: computing it needs no
 * hardware the reducer doesn't already have in scope, unlike `RESET_TO_STOCK`'s `ve`,
 * but it is still the caller's job to produce it, the same way `SET_TABLE`'s caller
 * produces the table it hands over. This is the one build write that leaves
 * `presetId` set rather than cleared, and every field lands in the same object-literal
 * pass, so there is no write order to get right.
 * @typedef {{type: 'APPLY_PRESET', preset: {
 *   presetId: string, engineConfig: import('../../sim/index.js').EngineConfig,
 *   mods: BuildState['mods'], turboOn: boolean, boostCurve: number[],
 *   turbineIdx: number, turbineCount: number, compressorIdx: number, injIdx: number,
 *   ecuInjectorCc: number, octaneIdx: number, exhaustDiaIdx: number,
 *   ve: number[][], timing: number[][], afr: number[][],
 *   ecu?: object,
 * }}} ApplyPresetAction
 */

/**
 * Wipes the calibration back to a generic stock baseline and drops any preset label
 * (dispatched by `resetToStock` in EcuLab.jsx). `action.ve` is the recomputed stock VE
 * table: producing it needs `computeHardwareVE` fed the current hardware
 * (`engineConfig`, `turboOn`, `exhaustDiaIdx`, `boostCurve`, fuel, turbine) mixed with
 * a hypothetical DEFAULT_MODS, which is exactly the kind of hardware-shaped lookup the
 * reducer should not be reaching for itself, so the caller computes it (the same
 * reasoning as `SET_TABLE`). `timing`/`afr`/`mods`/`mafScalar` reset to fixed constants
 * that need no such lookup, so the reducer sets those itself. `tablesDirty` ends false
 * in the same pass.
 * @typedef {{type: 'RESET_TO_STOCK', ve: number[][], ecu?: object}} ResetToStockAction
 */

/**
 * Restores every worn engine component to full health (the REPAIR button).
 * @typedef {{type: 'REPAIR_ENGINE'}} RepairEngineAction
 */

/**
 * Takes a career job: fits the customer's car and clears the bench, in one pass.
 *
 * A job is a car that arrives with one fault already in it, so taking one has to write
 * across all three slices at once — the hardware the customer turned up with, a stock
 * calibration to diagnose it against, and a bench with no trace of the last job on it.
 * Split into separate writes it would render once per write, and worse, a
 * half-applied job is a car with the fault fitted and the old tables still loaded, which
 * is not any car the player was handed.
 *
 * `build` and `ve` are computed by the caller (`jobCar` in career.js) for the same reason
 * `RESET_TO_STOCK`'s are: they need `computeHardwareVE` fed a hardware description, which
 * is exactly the lookup the reducer should not be reaching for. Everything the reducer can
 * set from constants — the stock timing and fuel tables, full health, an empty result —
 * it sets itself.
 *
 * It also empties the undo stack: see the case below.
 * @typedef {{type: 'TAKE_JOB', index: number, build: BuildState, ve: number[][], ecu?: object}} TakeJobAction
 */

/**
 * Finalises a completed dyno pull: banks the score, wears the engine, installs the
 * new `result`, and pushes a slim record of it to the front of `runs` (`runLog.js`'s
 * `ghostRun` reads that log for the ghost comparison). It covers the end of `doRun` in
 * EcuLab.jsx, not the whole function: `doRun` also flips `running`/`revealCount` for
 * the reveal animation before and after an interval-driven timer runs, which is
 * time-based UI state with no atomicity hazard and stays as plain `SET_SESSION_FIELD`
 * dispatches in the component. `action.result` and `action.pullScore` are precomputed
 * by the caller: `result` comes from `simulateSweep`, and `pullScore` from
 * `computePullScore`, which needs derived hardware objects (`turbine`, `compressor`,
 * `dutyPreview`, `exhaustDiaError`) that are `useMemo` values in the component, not raw
 * state the reducer holds. The same "caller computes, reducer applies" split as
 * `RESET_TO_STOCK`'s `ve`.
 *
 * `scores` arrives the same way and for the same reason, and banking it here rather
 * than deriving it later is the second ordering hazard this action owns. Recomputing
 * the Engineer and Pull scores at render time would grade the last pull's dyno output
 * against whatever hardware is selected now, so changing a turbo after a pull would
 * re-grade that finished run as though it had been made on the new build, and the
 * Pull Score could climb past `bestScore` with nobody having run anything. Banked here,
 * the numbers are what the pull measured.
 *
 * `wasBest` is decided here rather than by the caller because this case is where
 * `bestScore` moves: the comparison has to happen against the value as it stands
 * before this pull is folded in, and this is the only place that still holds it.
 * @typedef {{type: 'BANK_PULL', result: object, pullScore: number, run: import('./runLog.js').RunRecord,
 *   scores: {tuning: object, engineer: object, signature: string}}} BankPullAction
 */

/**
 * Merges a career loaded from storage into the current session, rather than
 * overwriting it. One action rather than five `SET_SESSION_FIELD` dispatches after
 * `await loadCareer()` resolves, for the reason `BANK_PULL` and `APPLY_PRESET` give
 * for why a cross-field write is one action instead of a sequence: separate dispatches
 * have an ordering hazard a single pass does not.
 *
 * Here the hazard is a race, not intra-render ordering: `loadCareer()` is an `await`,
 * so a pull can bank (`BANK_PULL`) between mount and this action landing. On the
 * `artifact` storage backend `window.storage.get` is a real round trip a human
 * interaction can land inside, not just a stray microtask, so this is reachable in
 * practice, not merely in theory. Overwriting the session with the loaded snapshot in
 * that window would roll a real, already-banked pull back to whatever was saved before
 * it, and because career persistence is itself a reactive effect over these same
 * fields, the rollback would not stop at
 * the screen: the persistence effect would write the rolled-back snapshot straight
 * back to disk, destroying the banked pull permanently.
 *
 * The fix is a merge, not a skip. Skipping the restore when something banked first
 * would leave the session holding only this-session values (a `bestScore` from one
 * pull, a `totalScore` from one pull), and the persistence effect would then write
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
 *    here can only mean they pinned it after banking, during the same race window.
 *
 * In the common case (nothing banked before the load resolves) the session is still
 * at its zeroed initial values, so every one of those merges reduces to the loaded
 * value exactly: `max(loaded, 0) === loaded`, `loaded + 0 === loaded`,
 * `[...[], ...loaded] === loaded`-shaped, `null ?? loaded === loaded`. One code path
 * handles both, with no `if (pristine)` branch to fall out of sync with the other.
 *
 * Not idempotent. `bestScore`/`totalScore`/`pullCount` sum and `runs` concatenates, so
 * dispatching this twice with the same `career` double-counts every one of them and
 * duplicates every loaded run. It must be dispatched exactly once per mount. The
 * safety net for that is entirely in `EcuLab.jsx`: the career-restore effect's
 * `cancelled` flag (set on cleanup) stops a second `loadCareer()` from a re-mounted
 * effect from ever reaching `dispatch`, and `careerLoaded.current` gates the separate
 * save effect from writing before a restore has landed. Neither guard lives in this
 * reducer, so a future caller of this action has nothing here stopping it from
 * breaking that invariant.
 *
 * One more edge alongside the `pinnedRunId` one above, and equally rare: a pull banked
 * during the restore window (between mount and `loadCareer()` resolving) gets whatever
 * `n` the session's own pull counter was on (typically a low one, since nothing has
 * been played yet) and can sort oddly next to the restored runs' much higher `n`
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
 * Advances the live engine by one integration step. Dispatched from a 50 ms
 * `setInterval` in EcuLab.jsx.
 *
 * This exists because a `SET_SESSION_FIELD` carrying an already-computed value could
 * not be made correct here. The interval is installed once, with `[]` deps, so its
 * callback closes over the `live` from the first render forever. Computing
 * `liveStep(live, ...)` in that callback would integrate from a state that is frozen
 * at engine-off: the readout would sit dead, or jitter between two adjacent steps,
 * and it would look like a physics bug rather than a stale closure. A functional
 * updater has no reducer equivalent, because actions must not carry functions. So the
 * step happens here, where `prev` comes from the store.
 *
 * `input` and `cfg` are read from refs at dispatch time and carried on the action.
 * They are the only two things the step needs that the reducer does not hold:
 * `cfg` is `liveCfgRef.current`, rebuilt from the build/tune slices on every render
 * (a live table edit must reach the running engine without restarting the interval),
 * and `input.throttle` is `throttleRef.current`. Neither is a function.
 *
 * Both refs are read when the interval dispatches, not when React applies the step.
 * The gap between the two is at most one React render, sub-millisecond against a 50 ms
 * tick, and refs only change from pointer handlers and render, so a step cannot land
 * on inputs older than the tick it belongs to.
 *
 * @typedef {{type: 'LIVE_STEP', dt: number, input: {throttle: number, load: number}, cfg: object}} LiveStepAction
 */

/**
 * Merges a patch into the live-engine state, for the two writes that are a command to
 * the engine rather than a step of it: `startEngine` (`{cranking: true}`) and
 * `stopEngine` (`{running: false, cranking: false}`). Both must land on top of
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
 * no catch-all `{type: string, [key: string]: *}` member: with one, every object
 * shape is assignable to `StoreAction` and the specific typedefs above become
 * decorative, so a typo'd payload key (`presset` instead of `preset`) would typecheck
 * clean. Without the catch-all, `tsc` must reject it.
 * @typedef {SetBuildFieldAction | ClearPresetIdAction | SetTurbineAction | SetTableAction | SetEcuAction |
 *   SwitchMapAction | CopyMapAction | SwapMapsAction |
 *   SetSessionFieldAction | SetTuneFieldAction | SetBoostSelAction |
 *   SetPresetPromptAction | SetEngineConfigPatchAction | ApplyPresetAction |
 *   ResetToStockAction | RepairEngineAction | BankPullAction | RestoreCareerAction |
 *   PinRunAction | UnpinRunAction | LiveStepAction | LivePatchAction | UndoAction |
 *   RedoAction | TakeJobAction
 * } KnownStoreAction
 */

/**
 * The public name, re-exported via `StoreProvider.jsx`'s
 * `@typedef {import('./reducer.js').StoreAction}`. An alias for
 * {@link KnownStoreAction}, not a looser type.
 * @typedef {KnownStoreAction} StoreAction
 */

/**
 * The running calibration as a map-slot entry.
 * @param {TuneState} t
 * @returns {import('./initialState.js').MapSlot}
 */
function mapOf(t) {
  return { ve: t.ve, timing: t.timing, afr: t.afr, ecu: t.ecu };
}

/**
 * Every case except UNDO/REDO. Wrapped by `reducer` below, which adds the undo stack
 * on top and is what callers actually use; see that function's own doc for what the
 * wrapper does and why it stays pure too.
 *
 * No `Date.now()`, no mutation of `state` or any of its slices. Every case that
 * changes a slice returns a new object for that slice only, and every slice it does
 * not touch keeps its existing reference (so `React.memo`/`useMemo` consumers
 * downstream can bail out on an unrelated dispatch).
 *
 * One case is not a pure function of `(state, action)`: `LIVE_STEP` calls `liveStep`,
 * which is itself pure apart from `sensorRead`'s `Math.random()` sensor noise (see
 * src/sim/live.js). That is deliberate and it is contained. What impurity would
 * normally cost is replay-safety: React re-runs a reducer over the same actions when
 * a render is double-invoked under StrictMode, or when an update is rebased behind a
 * higher-priority one. Here a replay re-integrates the same single step from the same
 * `prev`; React never applies an action twice, it recomputes from base, so this is
 * always a single-step replay. For that single step, the only thing that differs
 * between two runs is a fraction of a percent of simulated sensor noise, which is
 * random by design. That framing does not generalise to a multi-step replay, and the
 * reason is not cosmetic: the noise `sensorRead` writes into `sensedLambda` is
 * integrated into `stft`, `stft` into `ltft`, and `ltft` feeds back into `mafScalar`,
 * the airflow the engine actually runs on (all in `liveStep`). Re-integrating several
 * steps in sequence from divergent noise would be a bounded random walk through a
 * learned fuel trim, not a rounding difference. Nothing in this reducer does that, but
 * it bounds what a future caller may safely do with this action. The undo log must
 * exclude LIVE_STEP (it does: see UNDO_SCOPE and CLEARS_REDO). It dispatches at 20 Hz,
 * so one hour of idle alone is 72,000 entries, each pinning a `cfg` that references the
 * full VE/timing/AFR tables, and even setting that cost aside, "undo the last 50 ms of
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

    case ACTIONS.SET_ECU:
      // One calibration field by dotted path, or the whole calibration when `path` is
      // absent (a reset or a loaded calibration). Calibration work, so it disowns a
      // preset and marks the tables dirty exactly as a base-table edit does.
      return {
        ...state,
        build: { ...state.build, presetId: null },
        tune: {
          ...state.tune,
          ecu: action.path ? setCal(state.tune.ecu, action.path, action.value) : action.value,
          tablesDirty: true,
        },
      };

    case ACTIONS.SWITCH_MAP: {
      // Map switching: the running calibration is stored in its slot and the chosen
      // slot's becomes the running one. A slot never written takes a copy of the running
      // calibration, as every map in a freshly flashed ROM starts identical.
      const t = state.tune;
      const to = action.index;
      if (to === t.activeMap) return state;
      const maps = [...t.maps];
      maps[t.activeMap] = mapOf(t);
      const next = maps[to] ?? mapOf(t);
      maps[to] = null;
      return { ...state, tune: { ...t, ...next, maps, activeMap: to } };
    }

    case ACTIONS.COPY_MAP: {
      const t = state.tune;
      if (action.to === t.activeMap) return state;
      const maps = [...t.maps];
      maps[action.to] = mapOf(t);
      return { ...state, tune: { ...t, maps } };
    }

    case ACTIONS.SWAP_MAPS: {
      const t = state.tune;
      const { a, b } = action;
      if (a === b) return state;
      const maps = [...t.maps];
      const read = (i) => (i === t.activeMap ? mapOf(t) : maps[i] ?? mapOf(t));
      const va = read(a);
      const vb = read(b);
      let tune = { ...t };
      const write = (i, v) => { if (i === t.activeMap) tune = { ...tune, ...v }; else maps[i] = v; };
      write(a, vb);
      write(b, va);
      return { ...state, tune: { ...tune, maps, tablesDirty: true } };
    }

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
          // A preset is a factory car: no supercharger or nitrous carried over from the last build.
          blowerId: null,
          nitrous: null,
          // A preset's AFR table already bakes in a correction for the MAF error its
          // mod set implies (factoryCalibration, src/sim/presets.js) — valid only at
          // the neutral scalar, so loading a preset must pin this back to 1.0.
          mafScalar: 1.0,
          // The factory car's fuel system, sensors, wastegate and coil: its calibration
          // (`p.ecu`) is set up for those parts, not for whatever the last car had.
          ...stockEcuParts(),
          presetId: p.presetId,
          presetPrompt: null,
        },
        tune: {
          ...state.tune,
          ve: p.ve,
          timing: p.timing,
          afr: p.afr,
          ...(p.ecu ? { ecu: p.ecu } : {}),
          // A new engine's ROM: every map slot starts as the factory calibration.
          maps: [null, null, null, null],
          activeMap: 0,
          // What the CHANGES view compares against from here on (issue 106).
          baseline: { ve: p.ve, timing: p.timing, afr: p.afr },
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

    case ACTIONS.RESET_TO_STOCK: {
      const timing = clone2D(DEFAULT_TIMING);
      const afr = clone2D(DEFAULT_AFR);
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
          timing,
          afr,
          ...(action.ecu ? { ecu: action.ecu } : {}),
          baseline: { ve: action.ve, timing, afr },
          // A reset baseline is not unsaved player work.
          tablesDirty: false,
        },
      };
    }

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
          ...(action.ecu ? { ecu: action.ecu } : {}),
          maps: [null, null, null, null],
          activeMap: 0,
          // A car handed over for diagnosis carries no unsaved work of the player's.
          tablesDirty: false,
          selection: null,
        },
        session: {
          ...state.session,
          activeJob: action.index,
          jobResult: null,
          // A clear bench: no result, scores or histogram measured on the last car.
          // The run log and its pin stay. They are the player's saved history, written
          // to storage whenever they change, so emptying them here would delete every
          // pull the player had ever banked. A job's pulls are labelled with the job
          // instead.
          result: null,
          pullScores: null,
          histogram: null,
          logFocusRpm: null,
          health: { piston: 100, bearing: 100, valve: 100 },
        },
        // A different car. Every entry on the stack is a snapshot of the last one, so an
        // undo here would put the previous car's tables onto the customer's, and a redo
        // would do the same from the other direction.
        history: { past: [], future: [] },
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
          // holds and runs[1] is the one before it.
          runs: pushRun(state.session.runs, action.run),
          health: {
            piston: clamp(state.session.health.piston - action.result.wear.piston, 0, 100),
            bearing: clamp(state.session.health.bearing - action.result.wear.bearing, 0, 100),
            valve: clamp(state.session.health.valve - action.result.wear.valve, 0, 100),
          },
          // Banked, not derived: see the typedef above for the re-grading bug that
          // recomputing these from current hardware caused. `wasBest` compares against
          // `state.session.bestScore` (the best before this pull), never the
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
      // does have an eager path: when the fiber has no pending lanes, it runs the
      // reducer immediately outside of render and bails out on
      // `Object.is(eagerState, currentState)` without scheduling a render at all. But
      // that path is opportunistic, not guaranteed: it does not fire once a render is
      // already in flight, which a dispatch arriving 20 times a second, racing every
      // other UI action in the app, cannot rely on being clear of. Returning the same
      // state object here is what guarantees the bail-out on every tick regardless:
      // even on the slow path, reconciliation compares the reducer's return value to
      // the fiber's current state by `Object.is` and leaves `didReceiveUpdate` false
      // when they match, so React still bails out of `StoreProvider`'s subtree and no
      // consumer re-renders.
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
      // Unknown action: return the same object by reference so React's useReducer
      // bails out of the re-render instead of scheduling one for a no-op.
      return state;
  }
}

/**
 * The actions that destroy calibration the player cannot otherwise get back, each
 * mapped to how much of its snapshot an undo puts back (history.js).
 *
 * Hardware writes are deliberately absent: every hardware control already displays its
 * own current value, so it is self-reversing, and undo must not become a time machine
 * over banked career progress.
 *
 * The scope is per-action because the snapshot is not: `snapshot()` captures the union
 * of every field any of these can write, so replaying an entry in full would put back
 * fields the recorded action never touched. `SET_TABLE`'s and `SET_ECU`'s entire
 * build-side write is `presetId`, and the map-slot actions write none, so
 * RESTORE_CALIBRATION is exactly their write surface; APPLY_PRESET and RESET_TO_STOCK
 * replace the whole build, so RESTORE_ALL is exactly theirs.
 *
 * A map rather than a Set plus a lookup elsewhere: `UNDOABLE` is derived from its keys
 * below, so another undoable action cannot be added to the membership list without
 * also declaring what its undo restores.
 */
const UNDO_SCOPE = Object.freeze({
  [ACTIONS.SET_TABLE]: RESTORE_CALIBRATION,
  [ACTIONS.SET_ECU]: RESTORE_CALIBRATION,
  [ACTIONS.SWITCH_MAP]: RESTORE_CALIBRATION,
  [ACTIONS.COPY_MAP]: RESTORE_CALIBRATION,
  [ACTIONS.SWAP_MAPS]: RESTORE_CALIBRATION,
  [ACTIONS.APPLY_PRESET]: RESTORE_ALL,
  [ACTIONS.RESET_TO_STOCK]: RESTORE_ALL,
});

const UNDOABLE = new Set(Object.keys(UNDO_SCOPE));

/**
 * Does this action write a field some snapshot carries, and therefore abandon a live
 * redo branch?
 *
 * `SET_TUNE_FIELD` needs the extra question because it is the one action whose write
 * surface depends on its payload rather than its type. Its production callers pass
 * `field: 'selection'` (written by `changeTab` on every tab switch), `'rangeMode'`
 * (issue 105) or `'diffView'` (issue 106): cursors and UI state, all outside the
 * snapshot, so treating any of those writes as new work would mean walking from TUNE to
 * BUILD, or flipping one of those UI toggles, kills the redo the player crossed tabs to
 * reach. But nothing in the type stops a caller passing `'ve'`, and that write would be
 * overwritten by a redo. Asking the snapshot's own key list makes the exclusion
 * structural instead of an observation about today's callers.
 * @param {any} action
 * @returns {boolean}
 */
function clearsRedo(action) {
  if (action.type === ACTIONS.SET_TUNE_FIELD) return snapshotsTuneField(action.field);
  return CLEARS_REDO.has(action.type);
}

/**
 * Every action that counts as new work, and therefore abandons the redo branch.
 *
 * The membership rule is: does this case write a field the snapshot carries (the
 * hardware and calibration in BUILD_KEYS/TUNE_KEYS)? Those are precisely the fields a
 * later REDO would overwrite, so leaving `future` alive across one of them lets redo
 * throw away work the player did after the undo, labelled only with what the redone
 * action was. For example: APPLY_PRESET -> UNDO -> fit a turbo, build a boost curve,
 * pick a fuel -> REDO would put the octane back to the preset's under the label
 * "Redo Preset · Nissan VQ35HR".
 *
 * Excluded, and why each one has to be:
 *  - LIVE_STEP / LIVE_PATCH write `session.live`. LIVE_STEP alone fires at 20 Hz, so
 *    including it would destroy the redo branch within one tick of the engine
 *    running, and undo would be unusable on any tab while the engine idles.
 *  - SET_SESSION_FIELD, BANK_PULL, REPAIR_ENGINE write `session` only, which no
 *    snapshot carries and no restore touches.
 *  - SET_BOOST_SEL, SET_PRESET_PROMPT, SET_TUNE_FIELD are cursors and UI state:
 *    `boostSel`, `presetPrompt`, `selection`, `rangeMode` (issue 105) and `diffView`
 *    (issue 106) are all deliberately outside the snapshot (see history.js).
 *    SET_TUNE_FIELD is the generic tune setter, and its callers write `selection`,
 *    `rangeMode` and `diffView` (cursors and UI state, not calibration), so counting
 *    any of those writes as new work would mean walking from TUNE to BUILD, flipping
 *    the range mode, or toggling the overlay silently kills the redo a player crossed
 *    tabs to reach.
 *  - UNDO/REDO manage `future` themselves.
 *  - TAKE_JOB does write snapshotted fields, but it empties both stacks itself (a
 *    different car makes every entry meaningless). Listing it here would be worse than
 *    redundant: the branch in `reducer` rebuilds `history` from the pre-action `past`.
 *
 * The UNDOABLE actions are listed here too, for one list that answers "is this new
 * work?". They reach `future: []` through the recording branch in `reducer` rather
 * than through this Set, and listing them keeps the two from disagreeing on paper.
 */
const CLEARS_REDO = new Set([
  ACTIONS.SET_BUILD_FIELD, ACTIONS.CLEAR_PRESET_ID, ACTIONS.SET_TURBINE,
  ACTIONS.SET_ENGINE_CONFIG_PATCH, ACTIONS.SET_TABLE, ACTIONS.APPLY_PRESET,
  ACTIONS.RESET_TO_STOCK, ACTIONS.SET_ECU, ACTIONS.SWITCH_MAP, ACTIONS.COPY_MAP, ACTIONS.SWAP_MAPS,
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
      // because the failure this one prevents is worse. Returning `undefined` for an
      // unrecognised table would push it onto the stack as the entry's label, and the
      // crash would come later in EngineScreen.jsx, on BUILD, at
      // `top.label.startsWith(...)`: a TypeError on a different screen, at a stack
      // naming neither the dispatch nor the table. Throwing here names both.
      if (!label) throw new Error(`labelFor: no label defined for table "${action.table}"`);
      // A bulk edit names itself ("VE edit · smooth · 20 cells"); an edit that doesn't
      // (a test's bare dispatch) keeps the table's name.
      return action.label ? `${label} · ${action.label}` : label;
    }
    case ACTIONS.APPLY_PRESET: {
      const preset = presetById(action.preset.presetId);
      return `Preset · ${preset ? preset.name : 'factory calibration'}`;
    }
    case ACTIONS.RESET_TO_STOCK:
      return 'Reset to stock';
    case ACTIONS.SWITCH_MAP:
      return `Switch to Map ${action.index + 1}`;
    case ACTIONS.COPY_MAP:
      return `Copy to Map ${action.to + 1}`;
    case ACTIONS.SWAP_MAPS:
      return `Swap Maps ${action.a + 1} and ${action.b + 1}`;
    case ACTIONS.SET_ECU: {
      if (!action.path) return action.label ?? 'ECU calibration';
      const meta = ECU_META.find((m) => m.path === action.path);
      return `ECU · ${meta ? meta.label : action.path}`;
    }
    default:
      // Every UNDOABLE action type has a case above, and `reducer` below only ever
      // calls `labelFor` for an action already confirmed to be in that set, so this
      // branch is unreachable by construction. It throws instead of quietly
      // returning 'Reset to stock' so that if another action is ever added to
      // UNDOABLE without a matching case here, it fails loudly at the call site
      // instead of mislabelling every undo button for that action "Reset to stock".
      throw new Error(`labelFor: no label defined for undoable action type "${action.type}"`);
  }
}

/**
 * The store's reducer: `baseReducer` plus the undo stack.
 *
 * Recording is a wrapper rather than a line inside each undoable case, so the cases
 * carry no undo bookkeeping and another undoable action is one entry in `UNDO_SCOPE`
 * rather than another place to remember. It stays a pure function of
 * `(state, action)`: no clock, no coalescing keys, no merge logic. The dock's slider
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
