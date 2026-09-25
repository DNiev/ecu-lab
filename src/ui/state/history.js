/**
 * The undo stack's data model: what one snapshot contains, and how it goes back.
 *
 * Deliberately holds NO action types. `reducer.js` imports this, so importing
 * `ACTIONS` back from there would be a cycle — which is also why `labelFor()`
 * lives in the reducer rather than here.
 *
 * CAPTURE is UNIFORM: `snapshot` records the union of every field any undoable
 * action can overwrite, not the subset a particular action happens to touch. That
 * half of the original design is unchanged and stays — one shape means a snapshot
 * cannot be half-taken, and a fourth undoable action added later cannot forget a
 * field.
 *
 * RESTORE is NOT uniform, and the original argument for making it so was wrong. It
 * read "one shape means one restore path", but a single restore path puts back all
 * thirteen build fields regardless of what the undone action actually wrote — so
 * `SET_TABLE ve` -> `SET_BUILD_FIELD turboOn = true` -> UNDO silently took the turbo
 * back off, under a label reading "Undo VE edit". The snapshot was never wrong; the
 * assumption that every entry should be played back in full was. So an entry now
 * carries a SCOPE alongside its snapshot, and `restore` puts back only as much as
 * that scope names — see {@link RESTORE_ALL} and {@link RESTORE_CALIBRATION}.
 *
 * The scope is a plain string on the entry rather than something derived from the
 * action type here, because deriving it would mean importing `ACTIONS` — the cycle
 * this file's header opens by ruling out. `reducer.js` names the scope when it
 * records the entry; this file only knows the two names and what each puts back.
 *
 * The union's rule for membership is: HARDWARE AND CALIBRATION, NEVER UI CURSORS.
 * Two fields an undoable action does write are deliberately excluded even though
 * that might look like a missed field at a glance — `tune.selection` and
 * `build.presetPrompt` — see the comments on TUNE_KEYS and BUILD_KEYS below for why
 * each one specifically is a cursor rather than state worth restoring.
 */

/** @typedef {import('./initialState.js').StoreState} StoreState */
/** @typedef {{build: object, tune: object}} Snapshot */

/**
 * How many undo steps are kept. A snapshot is roughly 1 KB (144 table numbers plus
 * scalars), so the cap is not about memory — it is that an array which only ever
 * grows is a leak with a long fuse.
 */
export const HISTORY_LIMIT = 50;

/**
 * BUILD fields an undoable action can overwrite. APPLY_PRESET actually writes
 * FOURTEEN build fields, not the thirteen listed here — it also sets
 * `presetPrompt: null`, which is deliberately absent from this list. `presetPrompt`
 * is a cursor/UI-state field, not hardware — `reducer.js`'s own typedef for
 * `SET_PRESET_PROMPT` already describes it that way — it tracks whether the
 * overwrite-confirmation modal is open, exactly like `tune.selection` below tracks
 * the grid highlight. Restoring it on undo would re-open a "load this preset?" modal
 * immediately after the player undid loading that preset, which is worse than
 * leaving it closed. RESET_TO_STOCK writes three of the fields below; SET_TABLE
 * writes one. The snapshot carries the union of the hardware/calibration fields so
 * `restore` never has to know which action it is undoing.
 */
const BUILD_KEYS = [
  'engineConfig', 'mods', 'turboOn', 'boostCurve', 'turbineIdx', 'turbineCount',
  'compressorIdx', 'injIdx', 'ecuInjectorCc', 'octaneIdx', 'exhaustDiaIdx',
  'mafScalar', 'presetId', 'fuelSystem', 'sensorHw', 'wastegate', 'coil', 'plugGapMm',
  'ethanolPct',
];

/**
 * TUNE fields an undoable action can overwrite.
 *
 * `selection` is deliberately absent, for the same "hardware and calibration, never UI
 * cursors" reason `presetPrompt` is absent from BUILD_KEYS above: it is a cursor, not
 * calibration. Restoring it would make undo move the player's highlight around, and the
 * grid's dimensions never change, so a selection is always still valid after a restore.
 */
const TUNE_KEYS = ['ve', 'timing', 'afr', 'ecu', 'maps', 'activeMap', 'tablesDirty'];

/**
 * Does a write to `tune.<field>` touch something a snapshot carries?
 *
 * `reducer.js` asks this so `SET_TUNE_FIELD`'s exclusion from the redo-clearing set is
 * STRUCTURAL rather than a fact about who happens to call it. Every production caller
 * passes `field: 'selection'` today — a cursor, outside the snapshot — but nothing stops
 * a future one passing `'ve'`, and that write would then survive alongside a live redo
 * branch that overwrites exactly it. Asking the key list directly closes that by
 * construction, and keeps the list itself private to this module.
 * @param {string} field
 * @returns {boolean}
 */
export function snapshotsTuneField(field) {
  return TUNE_KEYS.includes(field);
}

/**
 * Captures the undoable projection of a state tree.
 * @param {StoreState} state
 * @returns {Snapshot}
 */
export function snapshot(state) {
  /** @type {any} */
  const build = {};
  /** @type {any} */
  const tune = {};
  for (const key of BUILD_KEYS) build[key] = /** @type {any} */ (state.build)[key];
  for (const key of TUNE_KEYS) tune[key] = /** @type {any} */ (state.tune)[key];
  return { build, tune };
}

/**
 * Puts back EVERY snapshotted field — all thirteen build fields and all four tune
 * fields. The scope for an action that replaces the whole calibration and the
 * hardware under it: APPLY_PRESET and RESET_TO_STOCK. Undoing a preset load
 * genuinely means "return to the state before it", so anything the player changed
 * afterwards is meant to go with it.
 */
export const RESTORE_ALL = 'all';

/**
 * Puts back the four tune fields and `build.presetId` ONLY, leaving the other twelve
 * build fields exactly as they are. The scope for SET_TABLE, whose entire build-side
 * write IS `presetId` (a hand edit disowns the preset). Restoring more than that is
 * how a VE edit's undo used to remove a turbo fitted after it.
 *
 * `presetId` is restored rather than left alone for the same reason it is cleared on
 * the way in: put the table back without it and the header goes on disowning a preset
 * the player never actually left.
 */
export const RESTORE_CALIBRATION = 'calibration';

/** @typedef {typeof RESTORE_ALL | typeof RESTORE_CALIBRATION} RestoreScope */

/**
 * Puts a snapshot back, as far as `scope` names, leaving every field it does not
 * touch alone — `session` entirely, `tune.selection`, and under
 * {@link RESTORE_CALIBRATION} every build field except `presetId`.
 * @param {StoreState} state
 * @param {Snapshot} before
 * @param {RestoreScope} scope
 * @returns {StoreState}
 */
export function restore(state, before, scope) {
  // The tune side is the same under both scopes: SET_TABLE writes a table and
  // `tablesDirty`, APPLY_PRESET/RESET_TO_STOCK write all four, and putting back a
  // table the action never touched is a no-op because the snapshot holds the value
  // that is already there.
  const tune = { ...state.tune, ...before.tune };
  switch (scope) {
    case RESTORE_ALL:
      return { ...state, build: { ...state.build, ...before.build }, tune };
    case RESTORE_CALIBRATION:
      return { ...state, build: { ...state.build, presetId: before.build.presetId }, tune };
    default:
      // Same reasoning as `labelFor`'s default branch in reducer.js: an entry
      // recorded with no scope, or with a scope this function does not implement,
      // would otherwise restore some arbitrary subset and look like a physics or
      // state bug somewhere else entirely. Fail here, naming the scope.
      throw new Error(`restore: unknown scope "${scope}"`);
  }
}
