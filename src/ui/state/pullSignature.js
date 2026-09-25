/**
 * The identity of a dyno pull's configuration, and the difference between two of them.
 *
 * A score is a MEASUREMENT. It is taken once, on one specific car, and it stays what
 * it was — so the app banks the scores a pull produced (see BANK_PULL) instead of
 * recomputing them from whatever is selected later. That leaves one question the
 * banked numbers cannot answer by themselves: is the car on screen still the car they
 * were measured on? {@link pullSignature} answers exactly that.
 *
 * WHY THIS FILE NOW ANSWERS "WHICH ONE" TOO
 * This header used to state that the module answers "has any measured input moved?"
 * and never "which one", on the grounds that a hand-written field-by-field comparison
 * would drift out of sync with the signature as fields were added. That reasoning was
 * right about the hazard and wrong about the conclusion. The run-history timeline needs
 * "which one" — it reports what changed between one pull and the one before it — and
 * the drift is avoided by keeping BOTH answers here, over ONE private key list, rather
 * than by refusing to answer. Add a field to MEASURED_BUILD_KEYS and it is signed and
 * diffed in the same edit. The alternative that was rejected — exporting the key arrays
 * so another module could diff — would have let a test derive its expectations from the
 * thing under test, which is the trap `history.js` keeps its own key lists private to
 * avoid.
 *
 * WHAT COUNTS AS "THE SAME CAR"
 * Every input the pull was actually computed from — everything `simulateSweep` reads
 * and everything `computeEngineerScore` reads. That is deliberately WIDER than the
 * hardware list: the calibration tables are inputs too, and in a tuning simulator they
 * are the thing the player changes most often between pulls. A signature over hardware
 * alone would let "edit the VE table, look at the scorecard" claim the numbers were
 * measured on the tables now on screen, which is the same lie the banked scores exist
 * to stop, one level down.
 *
 * WHAT DOES NOT COUNT
 * Labels and cursors: `presetId` (a name for a build, not a part of it),
 * `presetPrompt`, `boostSel`, `selection`, `tablesDirty`. None of them reaches the
 * simulation, so none of them can change a number.
 *
 * WHY A SIGNATURE AND NOT A DEEP COMPARE
 * The only question asked of `pullSignature` itself is "has any measured input moved?",
 * never "which one" — {@link diffMeasuredInputs} answers that separately, and over the
 * same key lists so the two can never disagree. A string compare answers the "has it
 * moved" question in one operation and cannot drift out of sync with a hand-written
 * field-by-field comparison as fields are added.
 *
 * THE ERROR IT IS ALLOWED TO MAKE, AND THE ONE IT IS NOT
 * `JSON.stringify` serialises object keys in insertion order, so two `engineConfig`
 * objects holding equal values in different key orders would sign differently and
 * report a change that did not happen. That direction is safe: the worst outcome is a
 * "build has changed" banner over numbers that are in fact still current, and the
 * player's fix is to run a pull. The opposite error is impossible, which is the half
 * that matters — different values ALWAYS produce different JSON, so this can never
 * report a changed build as unchanged and let a stale score pass as a live one.
 *
 * Related but not the same list: `history.js`'s snapshot keys. That projection is
 * "what an undo puts back" — it includes `presetId` and `tablesDirty` (bookkeeping an
 * undo must restore) and excludes `loadKpa` (nothing undoable writes it). This one is
 * "what the engine was run with". Neither list is derivable from the other, so they
 * are kept separately and each documents its own rule for membership.
 */

/**
 * BUILD fields the sweep and the Engineer Score read. `presetId`, `presetPrompt` and
 * `boostSel` are the three the slice holds that they do not — see the file header.
 */
const MEASURED_BUILD_KEYS = [
  'engineConfig', 'mods', 'turboOn', 'boostCurve', 'octaneIdx', 'injIdx', 'mafScalar',
  'turbineIdx', 'turbineCount', 'compressorIdx', 'exhaustDiaIdx', 'ecuInjectorCc',
  'fuelSystem', 'sensorHw', 'wastegate', 'coil', 'plugGapMm', 'ethanolPct',
  'blowerId', 'blowerRatio', 'nitrous',
];

/**
 * The three calibration tables. `tablesDirty` and `selection` are the TUNE slice's
 * other two fields and neither reaches the simulation.
 */
const MEASURED_TUNE_KEYS = ['ve', 'timing', 'afr', 'ecu'];

/**
 * Display names for every measured input, for the run-history timeline's "what
 * changed" line. A key with no label throws rather than rendering a blank row — the
 * same call `labelFor` makes in reducer.js, and for the same reason: a silently
 * missing label is a field the player is never told about.
 */
const INPUT_LABELS = {
  engineConfig: 'engine',
  mods: 'bolt-ons',
  turboOn: 'turbo',
  boostCurve: 'boost curve',
  octaneIdx: 'fuel',
  injIdx: 'injectors',
  mafScalar: 'MAF scaling',
  turbineIdx: 'turbine',
  turbineCount: 'turbine count',
  compressorIdx: 'compressor',
  exhaustDiaIdx: 'exhaust',
  ecuInjectorCc: 'ECU injector size',
  fuelSystem: 'fuel system',
  sensorHw: 'sensors fitted',
  wastegate: 'wastegate',
  coil: 'ignition coils',
  plugGapMm: 'plug gap',
  ethanolPct: 'ethanol content',
  blowerId: 'supercharger',
  blowerRatio: 'blower pulley',
  nitrous: 'nitrous kit',
  ecu: 'ECU calibration',
  ve: 'VE table',
  timing: 'timing table',
  afr: 'AFR table',
  loadKpa: 'dyno load',
};

/**
 * Signs the configuration a pull would be — or was — run on.
 *
 * `loadKpa` is passed as a bare value rather than the SESSION slice it lives on, and
 * that is deliberate rather than an inconsistency with the two slices above it. It is
 * the ONLY session field a pull is a function of — everything else in that slice is
 * the pull's own output (result, scores, wear, career totals) or belongs to the live
 * engine, not the dyno — and `session` is the slice the 20 Hz LIVE_STEP replaces on
 * every tick. Taking the slice would give this a dependency that changes twenty times
 * a second while the engine idles, for a value that has not moved.
 *
 * @param {import('./initialState.js').BuildState} build
 * @param {import('./initialState.js').TuneState} tune
 * @param {number} loadKpa the manifold pressure the sweep is run at
 * @param {object} [conditions] ambient conditions and injected faults
 * @returns {string} equal for two configurations iff every measured input is equal
 */
export function pullSignature(build, tune, loadKpa, conditions) {
  return JSON.stringify([
    MEASURED_BUILD_KEYS.map((k) => /** @type {any} */ (build)[k]),
    MEASURED_TUNE_KEYS.map((k) => /** @type {any} */ (tune)[k]),
    loadKpa,
    // The day and any injected fault change what the dyno measures as surely as the
    // build does. Only appended when given, so a signature taken without them is the
    // one it always was.
    ...(conditions ? [conditions] : []),
  ]);
}

/**
 * Projects a configuration down to exactly the inputs a pull is a function of.
 *
 * This is the form a {@link import('./runLog.js').RunRecord} stores, so that two runs
 * can be compared later without keeping the whole build and tune slices — and without
 * a second list of "what matters" that could disagree with this one.
 *
 * @param {import('./initialState.js').BuildState} build
 * @param {import('./initialState.js').TuneState} tune
 * @param {number} loadKpa
 * @returns {{build: object, tune: object, loadKpa: number}}
 */
export function measuredInputs(build, tune, loadKpa) {
  /** @type {Record<string, *>} */
  const b = {};
  for (const k of MEASURED_BUILD_KEYS) b[k] = /** @type {any} */ (build)[k];
  /** @type {Record<string, *>} */
  const t = {};
  for (const k of MEASURED_TUNE_KEYS) t[k] = /** @type {any} */ (tune)[k];
  return { build: b, tune: t, loadKpa };
}

/**
 * Names every measured input that differs between two projections.
 *
 * Values are compared by their JSON, not by reference: the calibration tables are
 * cloned on almost every write, so a reference compare would report all three as
 * changed on every pull, and an `===` on the outer array would miss a changed cell
 * entirely. This inherits {@link pullSignature}'s documented and acceptable error in
 * the same direction — two equal objects whose keys were inserted in different orders
 * compare as different — and, like the signature, it can never report a real change as
 * no change.
 *
 * An input one side does not record at all is left out. A run saved before that input
 * existed (the fuel system, sensors and ECU calibration came with engine management) holds no
 * value for it, which says "not recorded", not "changed": listing it would put seven
 * phantom changes on the first run after an update.
 *
 * @param {ReturnType<typeof measuredInputs>} a
 * @param {ReturnType<typeof measuredInputs>} b
 * @returns {string[]} display labels, empty when every measured input is equal
 */
export function diffMeasuredInputs(a, b) {
  const changed = [];
  const differs = (x, y) => x !== undefined && y !== undefined && JSON.stringify(x) !== JSON.stringify(y);
  for (const k of MEASURED_BUILD_KEYS) {
    if (differs(a?.build?.[k], b?.build?.[k])) changed.push(k);
  }
  for (const k of MEASURED_TUNE_KEYS) {
    if (differs(a?.tune?.[k], b?.tune?.[k])) changed.push(k);
  }
  if (a?.loadKpa !== b?.loadKpa) changed.push('loadKpa');
  return changed.map((k) => {
    const label = INPUT_LABELS[k];
    if (!label) throw new Error(`diffMeasuredInputs: no label defined for measured input "${k}"`);
    return label;
  });
}
