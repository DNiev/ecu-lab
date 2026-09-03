/**
 * Reducer tests — pure, no DOM.
 *
 * The reducer exists so that operations spanning several slices happen in ONE pass.
 * EcuLab's applyEnginePreset makes 21 sequential setState calls and its own comment
 * warns the order matters; resetToStock documents that "the last call pins tablesDirty
 * back to false". Those hazards are what this file exists to make impossible.
 */

import { describe, expect, it } from 'vitest';

import {
  clone2D, COMPRESSOR_OPTS, computeHardwareVE, DEFAULT_AFR, DEFAULT_BOOST,
  DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, DEFAULT_TIMING, deriveEngine, INJECTOR_OPTS,
  OCTANE_OPTS,
} from '../../../src/sim/index.js';
import { applyPreset, ENGINE_PRESETS } from '../../../src/sim/presets.js';
import {
  RESTORE_ALL, RESTORE_CALIBRATION, restore, snapshot,
} from '../../../src/ui/state/history.js';
import { makeInitialState } from '../../../src/ui/state/initialState.js';
import { ACTIONS, reducer } from '../../../src/ui/state/reducer.js';
import { RUN_LIMIT } from '../../../src/ui/state/runLog.js';

/**
 * A state where EVERY field of EVERY slice holds a value no real APPLY_PRESET write
 * could ever produce: a string built from the field's own `slice.field` name. The
 * field list comes from `makeInitialState()`'s own output keys, not a hand-maintained
 * list, so a field added to a slice in a later PR is swept automatically.
 *
 * Because each sentinel is a fresh string unique to its own field, no real preset
 * value — a number, an array, a plain object, `null`, a boolean, ANY type the 21 real
 * writes use — can ever equal it. That makes a single strict `!==` check exact for
 * "did the reducer touch this field", for every field type in play, with no deep-
 * equality helper needed: the starting value is never deep-equal to a real written
 * value by construction, and a field the reducer does not touch keeps the identical
 * string reference through the object spread, so `!==` cannot false-positive either.
 * @returns {any} an object shaped like StoreState, but not typed as one — every field
 *   deliberately holds a sentinel string instead of a value of its real type.
 */
function makeSentinelState() {
  const init = makeInitialState();
  const state = /** @type {any} */ ({});
  for (const slice of Object.keys(init)) {
    // `history` is structural, not scalar: the reducer spreads `past`, and
    // `[...'SENTINEL::history.past']` would silently become 24 single characters.
    // A real empty stack still starts unequal to anything a write produces, which is
    // all `changedFieldKeys` needs.
    if (slice === 'history') {
      state[slice] = { past: [], future: [] };
      continue;
    }
    const sliceState = /** @type {any} */ ({});
    for (const field of Object.keys(/** @type {any} */ (init)[slice])) {
      sliceState[field] = `SENTINEL::${slice}.${field}`;
    }
    state[slice] = sliceState;
  }
  return state;
}

/**
 * The `slice.field` keys whose value differs between two sentinel-seeded state trees,
 * via strict `!==`. See {@link makeSentinelState} for why reference/value inequality
 * alone is exact here for every field type.
 * @param {any} before
 * @param {any} after
 * @returns {Set<string>}
 */
function changedFieldKeys(before, after) {
  const changed = new Set();
  for (const slice of Object.keys(before)) {
    for (const field of Object.keys(before[slice])) {
      if (before[slice][field] !== after[slice][field]) {
        changed.add(`${slice}.${field}`);
      }
    }
  }
  return changed;
}

/**
 * A complete, real engineConfig (BMW N54 figures — src/sim/presets.js) so this file's
 * APPLY_PRESET fixtures typecheck as a genuine EngineConfig, not just a configuration
 * stub. Declared with an explicit type annotation below (not an "as" cast) so
 * `configuration` narrows to the engine-layout literal union instead of widening to
 * plain string.
 * @type {import('../../../src/sim/index.js').EngineConfig}
 */
const N54_ENGINE_CONFIG = {
  configuration: 'I6', bore: 84.0, stroke: 89.6, compression: 10.2,
  blockMaterial: 'Aluminum', headMaterial: 'Aluminum',
};

/** Shared APPLY_PRESET fixture: every field the action's `preset` payload carries. */
const N54_PRESET = {
  presetId: 'n54', engineConfig: N54_ENGINE_CONFIG,
  mods: { intake: false, exhaust: false, headers: false, intercooler: true },
  turboOn: true, boostCurve: [8, 8, 8, 8, 8, 8, 8, 8], turbineIdx: 1,
  turbineCount: 2, compressorIdx: 1, injIdx: 2, ecuInjectorCc: 440,
  octaneIdx: 1, exhaustDiaIdx: 2, ve: [[80]], timing: [[20]], afr: [[12]],
};

describe('makeInitialState', () => {
  it('returns the four slices', () => {
    const s = makeInitialState();
    expect(Object.keys(s).sort()).toEqual(['build', 'history', 'session', 'tune']);
  });

  it('starts with no preset loaded and clean tables', () => {
    const s = makeInitialState();
    expect(s.build.presetId).toBeNull();
    expect(s.tune.tablesDirty).toBe(false);
  });

  it('returns a fresh object each call, not a shared reference', () => {
    // A shared initial state would let one test's mutation leak into the next, and
    // one player's reset leak into their next build.
    const a = makeInitialState();
    const b = makeInitialState();
    expect(a).not.toBe(b);
    expect(a.tune.ve).not.toBe(b.tune.ve);
  });
});

describe('SET_BUILD_FIELD', () => {
  it('sets the field', () => {
    const s = reducer(makeInitialState(), {
      type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true,
    });
    expect(s.build.turboOn).toBe(true);
  });

  it('clears the preset label, because a hand edit is no longer that preset', () => {
    const loaded = { ...makeInitialState() };
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const s = reducer(loaded, {
      type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true,
    });
    expect(s.build.presetId).toBeNull();
  });

  it('does not flag the calibration tables as dirty', () => {
    // Hardware edits invalidate the preset LABEL only. tablesDirty means unsaved
    // player work on the calibration, and is what the overwrite prompt keys off.
    const s = reducer(makeInitialState(), {
      type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true,
    });
    expect(s.tune.tablesDirty).toBe(false);
  });

  it('leaves the other slices untouched by reference', () => {
    const before = makeInitialState();
    const after = reducer(before, {
      type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true,
    });
    expect(after.session).toBe(before.session);
  });
});

describe('CLEAR_PRESET_ID', () => {
  it('clears the preset label', () => {
    const loaded = { ...makeInitialState() };
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const s = reducer(loaded, { type: ACTIONS.CLEAR_PRESET_ID });
    expect(s.build.presetId).toBeNull();
  });

  it('does not flag the calibration tables as dirty', () => {
    // Unlike SET_TABLE, choosing "Custom build" is not itself a calibration edit.
    const s = reducer(makeInitialState(), { type: ACTIONS.CLEAR_PRESET_ID });
    expect(s.tune.tablesDirty).toBe(false);
  });

  it('touches ONLY presetId — a value the action cannot even carry proves the point', () => {
    // The bug this action exists to fix: the old call site dispatched
    // `{type: SET_BUILD_FIELD, field: 'presetId', value: null}`, which only worked
    // because the reducer's OWN trailing `presetId: null` clobbered whatever value the
    // action carried — so a hypothetical caller passing a non-null value would have
    // silently gotten null back anyway. CLEAR_PRESET_ID has no `value` field in its
    // shape at all, so there is no payload for a future caller to get wrong here; this
    // test instead pins that every OTHER build field survives the dispatch untouched,
    // which is the property SET_BUILD_FIELD could never have offered (it invalidates
    // every write, by design).
    const loaded = { ...makeInitialState() };
    loaded.build = { ...loaded.build, presetId: 'n54', turboOn: true, mafScalar: 0.9 };
    const s = reducer(loaded, { type: ACTIONS.CLEAR_PRESET_ID });
    expect(s.build.presetId).toBeNull();
    expect(s.build.turboOn).toBe(true);
    expect(s.build.mafScalar).toBe(0.9);
  });

  it('leaves the other slices untouched by reference', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.CLEAR_PRESET_ID });
    expect(after.tune).toBe(before.tune);
    expect(after.session).toBe(before.session);
  });
});

describe('SET_TURBINE', () => {
  it('fits one of the chosen housing, because a twin-turbo count belongs to a preset', () => {
    const twin = { ...makeInitialState() };
    twin.build = { ...twin.build, turbineIdx: 2, turbineCount: 2 };
    const s = reducer(twin, { type: ACTIONS.SET_TURBINE, value: 1 });
    expect(s.build.turbineIdx).toBe(1);
    expect(s.build.turbineCount).toBe(1);
  });
});

describe('SET_TABLE', () => {
  it('sets the table', () => {
    const next = [[1, 2], [3, 4]];
    const s = reducer(makeInitialState(), {
      type: ACTIONS.SET_TABLE, table: 'timing', value: next,
    });
    expect(s.tune.timing).toBe(next);
  });

  it('clears the preset AND flags the tables dirty, in one pass', () => {
    // This is the cross-slice write that three independent contexts could not express
    // atomically: a table edit invalidates a BUILD field and a TUNE field together.
    const loaded = { ...makeInitialState() };
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const s = reducer(loaded, {
      type: ACTIONS.SET_TABLE, table: 'timing', value: [[1]],
    });
    expect(s.build.presetId).toBeNull();
    expect(s.tune.tablesDirty).toBe(true);
  });
});

describe('unknown actions', () => {
  it('returns the same state object, so React skips the re-render', () => {
    const before = makeInitialState();
    // Deliberately outside the known-action union (see the StoreAction JSDoc in
    // reducer.js) — this test exercises the default branch's fallback for an action
    // shape the reducer does not recognize, so the cast is intentional, not a leak of
    // the removed catch-all.
    const bogus = /** @type {any} */ ({ type: 'NOT_A_REAL_ACTION' });
    expect(reducer(before, bogus)).toBe(before);
  });
});

// The two cases below are not in the plan's verbatim test listing, but SET_SESSION_FIELD
// and SET_TUNE_FIELD are both part of the "implement at minimum" set for this task and
// need their own coverage — a test suite that only exercises three of five action types
// would not catch a broken fourth.
describe('SET_SESSION_FIELD', () => {
  it('sets the field', () => {
    const s = reducer(makeInitialState(), {
      type: ACTIONS.SET_SESSION_FIELD, field: 'running', value: true,
    });
    expect(s.session.running).toBe(true);
  });

  it('leaves build and tune untouched by reference', () => {
    const before = makeInitialState();
    const after = reducer(before, {
      type: ACTIONS.SET_SESSION_FIELD, field: 'running', value: true,
    });
    expect(after.build).toBe(before.build);
    expect(after.tune).toBe(before.tune);
  });
});

describe('SET_TUNE_FIELD', () => {
  it('sets the field', () => {
    const s = reducer(makeInitialState(), {
      type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'cell', row: 1, col: 2 },
    });
    expect(s.tune.selection).toEqual({ type: 'cell', row: 1, col: 2 });
  });

  it('does NOT clear the preset or flag the tables dirty', () => {
    // Unlike SET_TABLE, a plain tune-slice write (e.g. changing which cell is
    // selected) is not a calibration edit and must not invalidate anything.
    const loaded = { ...makeInitialState() };
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const s = reducer(loaded, {
      type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'row', row: 0 },
    });
    expect(s.build.presetId).toBe('n54');
    expect(s.tune.tablesDirty).toBe(false);
  });

  it('leaves the other slices untouched by reference', () => {
    const before = makeInitialState();
    const after = reducer(before, {
      type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: null,
    });
    expect(after.build).toBe(before.build);
    expect(after.session).toBe(before.session);
  });
});

describe('every write produces a fresh slice reference', () => {
  it('SET_SESSION_FIELD replaces the changed slice rather than mutating it', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.SET_SESSION_FIELD, field: 'pullCount', value: 3 });
    expect(after.session).not.toBe(before.session);
    expect(before.session.pullCount).toBe(0); // the input state is untouched
  });

  it('SET_BUILD_FIELD replaces the changed slice rather than mutating it', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true });
    expect(after.build).not.toBe(before.build);
    expect(before.build.turboOn).toBe(false); // the input state is untouched
  });

  it('SET_TUNE_FIELD replaces the changed slice rather than mutating it', () => {
    const before = makeInitialState();
    const after = reducer(before, {
      type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'cell', row: 0, col: 0 },
    });
    expect(after.tune).not.toBe(before.tune);
    expect(before.tune.selection).toBeNull(); // the input state is untouched
  });

  // Finding 7: the tests above only ever assert `toBe` on slices an action LEAVES
  // ALONE — the inverse property. None of the cross-cutting actions asserted a fresh
  // reference for the slice(s) they actually WRITE, so an action that mutated a slice
  // in place instead of replacing it would pass every existing test here.
  it('APPLY_PRESET replaces build, tune AND session rather than mutating them', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    expect(after.build).not.toBe(before.build);
    expect(after.tune).not.toBe(before.tune);
    expect(after.session).not.toBe(before.session);
  });

  it('RESET_TO_STOCK replaces build and tune rather than mutating them', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(after.build).not.toBe(before.build);
    expect(after.tune).not.toBe(before.tune);
  });

  it('REPAIR_ENGINE replaces session rather than mutating it', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.REPAIR_ENGINE });
    expect(after.session).not.toBe(before.session);
  });

  it('BANK_PULL replaces session rather than mutating it', () => {
    const before = makeInitialState();
    const after = reducer(before, {
      type: ACTIONS.BANK_PULL,
      result: { peakHp: 410, wear: { piston: 3, bearing: 2, valve: 1 } },
      pullScore: 50,
      scores: { tuning: {}, engineer: {}, signature: 'x' },
    });
    expect(after.session).not.toBe(before.session);
  });
});

describe('non-invalidating build writes', () => {
  it('moving the boost-curve cursor does not disown the preset', () => {
    const loaded = makeInitialState();
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const s = reducer(loaded, { type: ACTIONS.SET_BOOST_SEL, value: 6 });
    expect(s.build.boostSel).toBe(6);
    expect(s.build.presetId).toBe('n54');
  });

  it('opening the overwrite prompt does not disown the preset', () => {
    const loaded = makeInitialState();
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const s = reducer(loaded, { type: ACTIONS.SET_PRESET_PROMPT, value: { presetId: 'k20' } });
    expect(s.build.presetPrompt).toEqual({ presetId: 'k20' });
    expect(s.build.presetId).toBe('n54');
  });
});

describe('SET_ENGINE_CONFIG_PATCH', () => {
  it('patching the engine config merges and invalidates', () => {
    const loaded = makeInitialState();
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const s = reducer(loaded, { type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { compression: 11.5 } });
    expect(s.build.engineConfig.compression).toBe(11.5);
    expect(s.build.presetId).toBeNull();
  });

  it('preserves the config fields the patch does not mention', () => {
    // A patch that REPLACES rather than merges would silently drop bore, stroke and
    // every other untouched field — the app would still render, just wrongly.
    const loaded = makeInitialState();
    const before = loaded.build.engineConfig;
    const s = reducer(loaded, { type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { compression: 11.5 } });
    const after = s.build.engineConfig;
    expect(after.bore).toBe(before.bore);
    expect(after.stroke).toBe(before.stroke);
    expect(after.configuration).toBe(before.configuration);
    expect(after.redline).toBe(before.redline);
  });
});

describe('APPLY_PRESET', () => {
  const preset = N54_PRESET;

  // Finding 1: every field the preset carries must land in the RIGHT slice. Deleting
  // any one of these from the reducer's APPLY_PRESET case must fail this test by
  // naming the missing field — that is the point of iterating rather than spot-
  // checking a handful of fields. The key-set assertion at the end means a 22nd field
  // added to the fixture without a matching map entry fails LOUDLY too, so this table
  // cannot silently drift out of date the way the hand-picked assertions above did.
  const presetFieldSlice = {
    presetId: 'build',
    engineConfig: 'build',
    mods: 'build',
    turboOn: 'build',
    boostCurve: 'build',
    turbineIdx: 'build',
    turbineCount: 'build',
    compressorIdx: 'build',
    injIdx: 'build',
    ecuInjectorCc: 'build',
    octaneIdx: 'build',
    exhaustDiaIdx: 'build',
    ve: 'tune',
    timing: 'tune',
    afr: 'tune',
  };

  it('maps every fixture field to a slice — the map cannot drift out of date', () => {
    expect(Object.keys(presetFieldSlice).sort()).toEqual(Object.keys(preset).sort());
  });

  it.each(Object.entries(presetFieldSlice))(
    'lands preset field %s in the %s slice',
    (field, slice) => {
      const s = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset });
      expect(s[slice][field]).toEqual(preset[field]);
    },
  );

  it('ends with the preset LOADED, not invalidated', () => {
    // The ordering hazard this whole design removes: applying a preset writes the same
    // fields a hand edit would, and a hand edit clears presetId. Done as 21 separate
    // setState calls that is order-dependent; done as one action it cannot race.
    const s = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset });
    expect(s.build.presetId).toBe('n54');
  });

  it('loads the preset\'s own calibration, not a recomputed one', () => {
    const s = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset });
    expect(s.tune.timing).toEqual([[20]]);
  });

  it('leaves the tables clean — a freshly loaded preset is not unsaved work', () => {
    const dirty = { ...makeInitialState() };
    dirty.tune = { ...dirty.tune, tablesDirty: true };
    const s = reducer(dirty, { type: ACTIONS.APPLY_PRESET, preset });
    expect(s.tune.tablesDirty).toBe(false);
  });

  it('clears the previous run, which measured a different engine', () => {
    const ran = { ...makeInitialState() };
    ran.session = {
      ...ran.session,
      result: { peakHp: 400 },
      pullScores: {
        pull: 400, wasBest: true, signature: 'x',
        tuning: { score: 90, label: 'CLEAN', deductions: [] },
        engineer: { score: 80, label: 'SOLID', deductions: [] },
      },
    };
    const s = reducer(ran, { type: ACTIONS.APPLY_PRESET, preset });
    expect(s.session.result).toBeNull();
    // The scores go with the result they grade. Left behind, they would put a
    // scorecard on screen with no dyno curve under it — and one measured on an engine
    // the player has just replaced wholesale.
    expect(s.session.pullScores).toBeNull();
  });

  it('carries the twin-turbo count a preset owns', () => {
    const s = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset });
    expect(s.build.turbineCount).toBe(2);
  });

  it('clears any pending overwrite prompt and cell selection', () => {
    // Finding 2: makeInitialState() already starts with both fields null, so
    // dispatching against a bare initial state proves nothing — the reducer could
    // drop these two writes entirely and this would still pass. Seed non-null
    // starting values so the assertions below have something to actually clear.
    const seeded = { ...makeInitialState() };
    seeded.build = { ...seeded.build, presetPrompt: { id: 'k20' } };
    seeded.tune = { ...seeded.tune, selection: { type: 'cell', row: 0, col: 0 } };
    const s = reducer(seeded, { type: ACTIONS.APPLY_PRESET, preset });
    expect(s.build.presetPrompt).toBeNull();
    expect(s.tune.selection).toBeNull();
  });

  it('pins the MAF scalar back to neutral, because the preset\'s AFR already bakes in its own correction', () => {
    const dragged = { ...makeInitialState() };
    dragged.build = { ...dragged.build, mafScalar: 0.8 };
    const s = reducer(dragged, { type: ACTIONS.APPLY_PRESET, preset });
    expect(s.build.mafScalar).toBe(1.0);
  });
});

describe('APPLY_PRESET — exact write surface (catches drift in both directions)', () => {
  // Round 1 found 14/21 fields deletable with the suite green; round 2's hardcoded
  // `boostSel: 3` sailed through the table-driven fix at 65/65. Both survived because
  // the old test only compared a hand-built map against the local fixture's own key
  // set — never against what the reducer actually writes. This test instead seeds
  // EVERY field of EVERY slice with a sentinel a real write can never produce, dispatches
  // for real, and asserts the walked set of changed fields against the 21-field
  // contract this action documents: a stray write grows the changed set past 21, a
  // dropped write shrinks it below 21, and the failure message names the field either
  // way.
  it('changes exactly the 21 documented fields, plus the two history fields', () => {
    const before = makeSentinelState();
    const after = reducer(before, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    const changed = changedFieldKeys(before, after);

    const expected = [
      'build.engineConfig', 'build.mods', 'build.turboOn', 'build.boostCurve',
      'build.turbineIdx', 'build.turbineCount', 'build.compressorIdx', 'build.injIdx',
      'build.ecuInjectorCc', 'build.octaneIdx', 'build.exhaustDiaIdx', 'build.mafScalar',
      'build.presetId', 'build.presetPrompt',
      'tune.ve', 'tune.timing', 'tune.afr', 'tune.tablesDirty', 'tune.selection',
      'session.result', 'session.pullScores',
      // APPLY_PRESET is undoable, so it records a snapshot in the same pass. These two
      // belong in the exact-write-surface contract like any other field it touches.
      'history.past', 'history.future',
    ];

    expect([...changed].sort()).toEqual([...expected].sort());
  });
});

describe('APPLY_PRESET — payload contract stays in sync with sim/presets.js', () => {
  // The 15 payload-carried fields must be read from applyPreset()'s REAL return value,
  // not the local fixture: if presets.js grows a 16th field tomorrow and the reducer
  // is not updated to copy it into the store, nothing before this test would notice —
  // the fixture and the map would happily agree with each other while both silently
  // ignore the new field.
  it('copies every key the real applyPreset() returns into the store', () => {
    const rawPreset = ENGINE_PRESETS[0];
    const payload = applyPreset(rawPreset);
    const payloadKeys = Object.keys(payload);
    // Sanity: fail loudly (not with a vacuous pass) if applyPreset()'s shape ever
    // collapses to nothing.
    expect(payloadKeys.length).toBeGreaterThan(0);

    const before = makeSentinelState();
    const after = reducer(before, {
      type: ACTIONS.APPLY_PRESET, preset: /** @type {any} */ (payload),
    });

    // A key is "copied" if it landed, BY THE SAME NAME, in whichever slice actually
    // received it — we don't hardcode which slice each key belongs to, we just look
    // for the exact value applyPreset() produced. Starting from an all-sentinel state
    // means there is no way for this to pass by coincidence: a field the reducer
    // doesn't copy is still sitting at its sentinel, which can never equal a real
    // payload value.
    const missing = payloadKeys.filter((key) => (
      after.build[key] !== /** @type {any} */ (payload)[key]
      && after.tune[key] !== /** @type {any} */ (payload)[key]
    ));

    expect(missing).toEqual([]);
  });
});

describe('RESET_TO_STOCK', () => {
  it('clears the preset label, because a reset is not that preset\'s calibration', () => {
    const loaded = { ...makeInitialState() };
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const s = reducer(loaded, { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(s.build.presetId).toBeNull();
  });

  it('ends with the tables CLEAN — a reset baseline is not unsaved player work', () => {
    // The old code achieved this by ordering setTablesDirty(false) last, after three
    // invalidating setters that each set it true. As one action there is no order to get
    // wrong.
    const dirty = { ...makeInitialState() };
    dirty.tune = { ...dirty.tune, tablesDirty: true };
    const s = reducer(dirty, { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(s.tune.tablesDirty).toBe(false);
  });

  it('uses the caller-supplied VE rather than recomputing one', () => {
    const s = reducer(makeInitialState(), { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(s.tune.ve).toEqual([[70]]);
  });

  it('strips mods and MAF trim back to stock', () => {
    const modded = { ...makeInitialState() };
    modded.build = { ...modded.build, mods: { intake: true, exhaust: true, headers: false, intercooler: false }, mafScalar: 0.85 };
    const s = reducer(modded, { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(s.build.mods).toEqual({ intake: false, exhaust: false, headers: false, intercooler: false });
    expect(s.build.mafScalar).toBe(1.0);
  });

  it('leaves session untouched by reference — a reset is not a dyno result', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(after.session).toBe(before.session);
  });

  // Finding 3: DEFAULT_TIMING/DEFAULT_AFR are NOT Object.freeze'd (unlike DEFAULT_MODS
  // and DEFAULT_ENGINE_CONFIG — see src/sim/tables.js). clone2D is load-bearing here:
  // handing back the module-level constant directly would let any future in-place
  // table edit corrupt the shared default for the rest of the session, and every later
  // reset would then return the already-corrupted table. toEqual alone cannot catch
  // that regression because a bare DEFAULT_TIMING is also toEqual DEFAULT_TIMING.
  it('clones timing and afr rather than returning the shared module-level defaults', () => {
    const s = reducer(makeInitialState(), { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(s.tune.timing).toEqual(DEFAULT_TIMING);
    expect(s.tune.timing).not.toBe(DEFAULT_TIMING);
    expect(s.tune.afr).toEqual(DEFAULT_AFR);
    expect(s.tune.afr).not.toBe(DEFAULT_AFR);
  });

  // Finding 1's table-driven approach applied here too: the reviewer found that
  // deleting `timing`/`afr` from this case entirely still left the suite green,
  // because no test started from a value that differed from the reset target. Every
  // field below is seeded to a WRONG value first, same fix as Finding 2's
  // presetPrompt/selection seeding — RESET_TO_STOCK does not touch presetPrompt or
  // selection at all (only EcuLab's hand-edit setters do), so there is nothing
  // "equivalent" to clear there; this is the field-coverage analogue instead. One
  // seeded starting state, one assertion per field RESET_TO_STOCK owns — deleting any
  // one of these from the reducer case leaves that field at its seeded WRONG value and
  // fails this test by naming it.
  it('resets every field it owns, starting from values that all differ from the target', () => {
    const dirty = { ...makeInitialState() };
    dirty.build = {
      ...dirty.build,
      mods: { intake: true, exhaust: true, headers: true, intercooler: true },
      mafScalar: 0.7,
      presetId: 'n54',
    };
    dirty.tune = {
      ...dirty.tune,
      ve: [[999]],
      timing: [[999]],
      afr: [[999]],
      tablesDirty: true,
    };
    const s = reducer(dirty, { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(s.build.mods).toEqual(DEFAULT_MODS);
    expect(s.build.mafScalar).toBe(1.0);
    expect(s.build.presetId).toBeNull();
    expect(s.tune.ve).toEqual([[70]]);
    expect(s.tune.timing).toEqual(DEFAULT_TIMING);
    expect(s.tune.afr).toEqual(DEFAULT_AFR);
    expect(s.tune.tablesDirty).toBe(false);
  });
});

describe('REPAIR_ENGINE', () => {
  it('restores every component to full health', () => {
    const worn = { ...makeInitialState() };
    worn.session = { ...worn.session, health: { piston: 40, bearing: 55, valve: 70 } };
    const s = reducer(worn, { type: ACTIONS.REPAIR_ENGINE });
    expect(s.session.health).toEqual({ piston: 100, bearing: 100, valve: 100 });
  });

  it('leaves build and tune untouched by reference', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.REPAIR_ENGINE });
    expect(after.build).toBe(before.build);
    expect(after.tune).toBe(before.tune);
  });
});

describe('LIVE_STEP and LIVE_PATCH', () => {
  // These were the only two actions with no reducer-level tests. `session-store.test.jsx`
  // covers them through the running engine, which is the coverage that matters most, but
  // it cannot express the reference-identity contract precisely — and that contract is
  // the whole reason LIVE_STEP has an early return.

  /** @returns {*} a state whose engine is running, so LIVE_STEP has something to do */
  function running() {
    const s = makeInitialState();
    s.session = { ...s.session, live: { ...s.session.live, running: true, rpm: 900 } };
    return s;
  }

  /**
   * The live config the app feeds the loop, built from the same sim exports EcuLab
   * uses. Assembled from real values rather than stubbed: `liveStep` destructures
   * fourteen fields off it and asserts the boost curve's shape, so a hand-made stub
   * would be testing a shape the app never passes.
   * @returns {*}
   */
  function liveCfg() {
    const cfg = DEFAULT_ENGINE_CONFIG;
    const derived = deriveEngine(cfg);
    const ve = computeHardwareVE(cfg, DEFAULT_MODS);
    return {
      ve, veTruth: ve, timing: clone2D(DEFAULT_TIMING), afr: clone2D(DEFAULT_AFR),
      derived, fuel: OCTANE_OPTS[0], injectorCc: INJECTOR_OPTS[0].cc,
      ecuInjectorCc: INJECTOR_OPTS[0].cc, mods: DEFAULT_MODS, mafScalar: 1.0,
      mafErrorBase: 1.0, turboOn: false, boostCurve: [...DEFAULT_BOOST],
      octaneBonus: 0, turbine: null, compressor: COMPRESSOR_OPTS[0],
      exhaustDiaError: 0,
    };
  }

  const step = {
    type: ACTIONS.LIVE_STEP, dt: 0.05,
    input: { throttle: 0, load: 0 }, cfg: liveCfg(),
  };

  it('returns the IDENTICAL state object when the engine is stopped', () => {
    // Not "an equal object" — the same one. This action arrives 20 times a second for
    // as long as the app is open, engine running or not. Object.is equality is what
    // makes React bail out of the whole StoreProvider subtree; return a fresh object
    // and every one of those ticks re-renders the entire app for nothing.
    const before = makeInitialState();
    expect(reducer(before, step)).toBe(before);
  });

  it('integrates the engine when it is running', () => {
    const before = running();
    const after = reducer(before, step);
    expect(after.session.live).not.toBe(before.session.live);
    expect(after.session.live.elapsed).toBeGreaterThan(before.session.live.elapsed);
  });

  it('leaves build and tune untouched while integrating', () => {
    // The live engine reads the calibration but must never write it.
    const before = running();
    const after = reducer(before, step);
    expect(after.build).toBe(before.build);
    expect(after.tune).toBe(before.tune);
  });

  it('LIVE_PATCH merges rather than replacing', () => {
    // START/STOP were `setLive((p) => ({ ...p, running: X }))`. Carrying a whole new
    // live object instead would rewind every field the patch omits — coolant, trims,
    // knock count — back to whatever the caller happened to capture.
    const before = running();
    const after = reducer(before, { type: ACTIONS.LIVE_PATCH, patch: { running: false } });
    expect(after.session.live.running).toBe(false);
    expect(after.session.live.rpm).toBe(before.session.live.rpm);
    expect(after.session.live.coolantC).toBe(before.session.live.coolantC);
  });

  it('LIVE_STEP does not abandon the redo branch', () => {
    // B2's one hard exclusion. This action arrives 20 times a second for as long as
    // the app is open, so counting an engine tick as new work would destroy any redo
    // branch within 50 ms of the player creating one — undo/redo would look broken on
    // every tab while the engine idles. Driven with the engine RUNNING, so the
    // early-return path is not what makes this pass.
    const loaded = reducer(running(), { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    const undone = reducer(loaded, { type: ACTIONS.UNDO });
    expect(undone.history.future).toHaveLength(1);

    let s = undone;
    for (let i = 0; i < 20; i += 1) s = reducer(s, step);
    expect(s.session.live.rpm).not.toBe(undone.session.live.rpm); // it really did integrate
    expect(s.history.future).toHaveLength(1);
  });

  it('LIVE_PATCH does not abandon the redo branch either', () => {
    const loaded = reducer(running(), { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    const undone = reducer(loaded, { type: ACTIONS.UNDO });
    const stopped = reducer(undone, { type: ACTIONS.LIVE_PATCH, patch: { running: false } });
    expect(stopped.session.live.running).toBe(false);
    expect(stopped.history.future).toHaveLength(1);
  });

  it('neither action disowns a loaded preset', () => {
    // Running the engine is not a build edit.
    const before = running();
    before.build = { ...before.build, presetId: 'n54' };
    expect(reducer(before, step).build.presetId).toBe('n54');
    expect(reducer(before, { type: ACTIONS.LIVE_PATCH, patch: { running: false } })
      .build.presetId).toBe('n54');
  });
});

describe('BANK_PULL', () => {
  // Mirrors the tail of doRun (EcuLab.jsx:868-896): a completed dyno pull's result
  // installs as the current one, the engine wears by the pull's own wear figures, and
  // the career score/pull count advance — all in one pass instead of several ordered
  // setState calls.
  const result = { peakHp: 410, wear: { piston: 3, bearing: 2, valve: 1 } };
  // What `doRun` computes and hands over: the two score breakdowns and the signature
  // of the car they were measured on. `pull` and `wasBest` are the reducer's to add.
  const scores = {
    tuning: { score: 88, label: 'CLEAN', deductions: [] },
    engineer: { score: 71, label: 'SOLID', deductions: [] },
    signature: 'FABRICATED-BUILD-SIGNATURE',
  };
  /** A minimal RunRecord — this describe block predates the run log and never asserts on it. */
  const run = /** @type {import('../../../src/ui/state/runLog.js').RunRecord} */ ({
    id: 'x', n: 1, at: 1000, label: 'VQ35DE', peakHp: 410, peakTq: 280, knocks: 0,
    scores: { tuning: 88, engineer: 71, pull: 50 },
    points: [], inputs: { build: {}, tune: {}, loadKpa: 100 },
  });

  /**
   * @param {number} pullScore
   * @returns {import('../../../src/ui/state/reducer.js').StoreAction}
   */
  const bank = (pullScore) => ({ type: ACTIONS.BANK_PULL, result, pullScore, scores, run });

  it('installs the new result', () => {
    const ran = { ...makeInitialState() };
    ran.session = { ...ran.session, result: { peakHp: 380 } };
    const s = reducer(ran, bank(50));
    expect(s.session.result).toBe(result);
  });

  it('wears the engine by the pull\'s own wear figures', () => {
    const s = reducer(makeInitialState(), bank(50));
    expect(s.session.health).toEqual({ piston: 97, bearing: 98, valve: 99 });
  });

  it('does not wear health below zero', () => {
    const worn = { ...makeInitialState() };
    worn.session = { ...worn.session, health: { piston: 2, bearing: 100, valve: 100 } };
    const s = reducer(worn, bank(50));
    expect(s.session.health.piston).toBe(0);
  });

  it('raises bestScore only when the new pull beats it', () => {
    const withBest = { ...makeInitialState() };
    withBest.session = { ...withBest.session, bestScore: 80 };
    const lower = reducer(withBest, bank(50));
    expect(lower.session.bestScore).toBe(80);
    const higher = reducer(withBest, bank(95));
    expect(higher.session.bestScore).toBe(95);
  });

  it('accumulates totalScore and increments pullCount', () => {
    const withHistory = { ...makeInitialState() };
    withHistory.session = { ...withHistory.session, totalScore: 100, pullCount: 2 };
    const s = reducer(withHistory, bank(50));
    expect(s.session.totalScore).toBe(150);
    expect(s.session.pullCount).toBe(3);
  });

  it('leaves build and tune untouched by reference', () => {
    const before = makeInitialState();
    const after = reducer(before, bank(50));
    expect(after.build).toBe(before.build);
    expect(after.tune).toBe(before.tune);
  });

  it('banks the scores the pull measured, with the build it measured them on', () => {
    // Issue #29: these used to be recomputed at RENDER time from whatever hardware was
    // selected then, and graded against this pull's dyno output — so a turbo fitted
    // afterwards re-graded a finished run as though it had been made on the new build.
    // Banking them here is what makes a score a measurement rather than a live view.
    const s = reducer(makeInitialState(), bank(50));
    expect(s.session.pullScores).toEqual({
      tuning: scores.tuning,
      engineer: scores.engineer,
      signature: 'FABRICATED-BUILD-SIGNATURE',
      pull: 50,
      wasBest: true,
    });
  });

  it('decides wasBest against the best BEFORE this pull, not the one it just set', () => {
    // The second, independent half of the same bug. The badge used to test
    // `scores.pull >= bestScore` after banking had already folded this pull into
    // `bestScore` — true by construction, every pull, tie or not. Here 50 loses to a
    // standing 80 and 95 beats it, and in the winning case `bestScore` is 95 in the
    // very same state object: a `>=` against the POST-update figure would call both
    // of these a new best.
    const withBest = { ...makeInitialState() };
    withBest.session = { ...withBest.session, bestScore: 80 };
    expect(reducer(withBest, bank(50)).session.pullScores.wasBest).toBe(false);
    const won = reducer(withBest, bank(95));
    expect(won.session.pullScores.wasBest).toBe(true);
    expect(won.session.bestScore).toBe(95);
  });

  it('does not call a tie a new best', () => {
    // Matching the standing best is not beating it, and the strict `>` is the only
    // thing that says so. This is the case the old `>=` comparison got wrong even
    // before the ordering bug — running the identical build twice announced NEW BEST
    // on the second pull.
    const withBest = { ...makeInitialState() };
    withBest.session = { ...withBest.session, bestScore: 80 };
    expect(reducer(withBest, bank(80)).session.pullScores.wasBest).toBe(false);
  });

  it('starts with no log focus', () => {
    expect(makeInitialState().session.logFocusRpm).toBe(null);
  });

  it('clears the log focus when a new pull is banked', () => {
    // A focus RPM belongs to the log of the pull it was clicked on. Carried forward it
    // would highlight whichever new events happen to span that RPM — wrong, and
    // indistinguishable from right.
    const focused = reducer(makeInitialState(), { type: ACTIONS.SET_SESSION_FIELD, field: 'logFocusRpm', value: 4800 });
    expect(focused.session.logFocusRpm).toBe(4800);
    expect(reducer(focused, bank(1)).session.logFocusRpm).toBe(null);
  });

  it('does not clear the log focus on an unrelated session write', () => {
    // The other half. A BANK_PULL that cleared it is right; a reducer that cleared it
    // on every session write would also pass the test above while destroying the
    // focus the moment anything else changed.
    const focused = reducer(makeInitialState(), { type: ACTIONS.SET_SESSION_FIELD, field: 'logFocusRpm', value: 4800 });
    const after = reducer(focused, { type: ACTIONS.SET_SESSION_FIELD, field: 'running', value: true });
    expect(after.session.logFocusRpm).toBe(4800);
  });
});

describe('RESTORE_CAREER', () => {
  // `EcuLab.jsx`'s career-restore effect is `await loadCareer()` followed by a single
  // dispatch of this action. `loadCareer()` is async, so a pull can bank
  // (`BANK_PULL`) — and, on the `artifact` storage backend, a real round trip means a
  // human interaction genuinely can land inside that window. Overwriting the session
  // with the loaded snapshot in that case would roll a real, already-banked pull back
  // to whatever was saved before it. RESTORE_CAREER exists to merge instead.

  /** A loaded run, distinct from anything a pull banked this session. */
  const loadedRun = /** @type {import('../../../src/ui/state/runLog.js').RunRecord} */ ({
    id: 'loaded', n: 4, at: 500, label: 'VQ35DE', peakHp: 300, peakTq: 260, knocks: 0,
    scores: { tuning: 70, engineer: 65, pull: 400 },
    points: [], inputs: { build: {}, tune: {}, loadKpa: 100 },
  });

  /** BANK_PULL's minimum viable payload — mirrors the 'run log' describe block above. */
  const bank = (id, pullScore) => ({
    type: ACTIONS.BANK_PULL,
    run: /** @type {import('../../../src/ui/state/runLog.js').RunRecord} */ ({
      id, n: Number(id), at: 1000, label: 'VQ35DE', peakHp: 320, peakTq: 300, knocks: 0,
      scores: { tuning: 90, engineer: 85, pull: pullScore },
      points: [], inputs: { build: {}, tune: {}, loadKpa: 100 },
    }),
    result: { peakHp: 320, peakTq: 300, points: [], events: [], wear: { piston: 1, bearing: 1, valve: 1 } },
    pullScore,
    scores: { tuning: { score: 90 }, engineer: { score: 85 }, signature: 'sig' },
  });

  it('into a pristine session, yields exactly the loaded values', () => {
    const career = {
      best: 812, total: 3405, pulls: 7, runs: [loadedRun], pinnedRunId: 'loaded',
    };
    const s = reducer(makeInitialState(), { type: ACTIONS.RESTORE_CAREER, career });
    expect(s.session.bestScore).toBe(812);
    expect(s.session.totalScore).toBe(3405);
    expect(s.session.pullCount).toBe(7);
    expect(s.session.runs).toEqual([loadedRun]);
    expect(s.session.pinnedRunId).toBe('loaded');
  });

  it('merges, rather than overwrites, a career banked between mount and load — the race', () => {
    // Bank a pull FIRST — simulating a pull landing before loadCareer() resolves —
    // then pin it, then restore. A restore that overwrites instead of merges fails
    // every assertion below.
    const banked = reducer(makeInitialState(), bank('new', 900));
    const pinned = reducer(banked, { type: ACTIONS.PIN_RUN, id: 'new' });

    const career = {
      best: 700, total: 1000, pulls: 5, runs: [loadedRun], pinnedRunId: 'loaded',
    };
    const s = reducer(pinned, { type: ACTIONS.RESTORE_CAREER, career });

    // bestScore: the max of the two, not the loaded value replacing the banked one.
    expect(s.session.bestScore).toBe(900);
    // totalScore / pullCount: summed, not replaced.
    expect(s.session.totalScore).toBe(1900);
    expect(s.session.pullCount).toBe(6);
    // The banked run survives the restore AND stays at index 0 — it is newer than
    // anything loaded from storage.
    expect(s.session.runs.map((r) => r.id)).toEqual(['new', 'loaded']);
    // A pin set this session survives a restore that names a different run.
    expect(s.session.pinnedRunId).toBe('new');
  });

  it('caps total runs at RUN_LIMIT during merge, evicting oldest loaded runs', () => {
    // Session holds 1 banked run; loaded career holds RUN_LIMIT runs. The merge
    // should cap at RUN_LIMIT total, evicting only from the LOADED side (the older
    // runs), not from the banked side. This test proves the merge respects the cap
    // and evicts from the correct end.
    const banked = reducer(makeInitialState(), bank('session', 500));

    // Build a career with exactly RUN_LIMIT runs (20), with IDs like 'loaded-0' through
    // 'loaded-19', in newest-first order (most recent at index 0).
    const loadedRuns = [];
    for (let i = 0; i < RUN_LIMIT; i += 1) {
      loadedRuns.push({
        id: `loaded-${i}`, n: i + 100, at: 1000 + i, label: 'VQ35DE',
        peakHp: 300 + i, peakTq: 260 + i, knocks: 0,
        scores: { tuning: 70, engineer: 65, pull: 400 + i },
        points: [], inputs: { build: {}, tune: {}, loadKpa: 100 },
      });
    }

    const career = {
      best: 500, total: 5000, pulls: 50, runs: loadedRuns, pinnedRunId: null,
    };
    const s = reducer(banked, { type: ACTIONS.RESTORE_CAREER, career });

    // Total runs should be capped at RUN_LIMIT (20).
    expect(s.session.runs).toHaveLength(RUN_LIMIT);
    // The banked run is newest and should survive, always at index 0.
    expect(s.session.runs[0].id).toBe('session');
    // The oldest loaded run ('loaded-19') should be evicted because it's the least recent.
    expect(s.session.runs.map((r) => r.id)).not.toContain('loaded-19');
    // The second-oldest loaded run ('loaded-18') should survive.
    expect(s.session.runs.map((r) => r.id)).toContain('loaded-18');
  });

  it('caps an over-length loaded runs array at RUN_LIMIT even into a pristine session', () => {
    // Every other cap test here has a banked session run present, so `s.runs.length`
    // is always truthy in them. A merge written as
    // `s.runs.length ? [...s.runs, ...c.runs].slice(0, RUN_LIMIT) : c.runs` passes
    // all of them while letting an over-length loaded array through UNSLICED into a
    // pristine session — and back out to disk on the next save. This restores
    // RUN_LIMIT + 5 loaded runs into makeInitialState() (no banked pull at all) to
    // catch exactly that.
    const loadedRuns = [];
    for (let i = 0; i < RUN_LIMIT + 5; i += 1) {
      loadedRuns.push({
        id: `loaded-${i}`, n: 100 - i, at: 2000 - i, label: 'VQ35DE',
        peakHp: 300, peakTq: 260, knocks: 0,
        scores: { tuning: 70, engineer: 65, pull: 400 },
        points: [], inputs: { build: {}, tune: {}, loadKpa: 100 },
      });
    }
    const career = { best: 0, total: 0, pulls: 0, runs: loadedRuns, pinnedRunId: null };
    const s = reducer(makeInitialState(), { type: ACTIONS.RESTORE_CAREER, career });

    expect(s.session.runs).toHaveLength(RUN_LIMIT);
    // The newest RUN_LIMIT survive, in order...
    expect(s.session.runs.map((r) => r.id)).toEqual(loadedRuns.slice(0, RUN_LIMIT).map((r) => r.id));
    // ...and every one of the oldest 5 is gone, not some other 5.
    for (let i = RUN_LIMIT; i < RUN_LIMIT + 5; i += 1) {
      expect(s.session.runs.some((r) => r.id === `loaded-${i}`)).toBe(false);
    }
  });
});

describe('UNDO / REDO', () => {
  /** A state with one hand VE edit already applied. */
  const edited = () => reducer(
    makeInitialState(),
    { type: ACTIONS.SET_TABLE, table: 've', value: [[42]] },
  );

  it('records the state BEFORE an edit, not after', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.SET_TABLE, table: 've', value: [[42]] });
    expect(after.history.past).toHaveLength(1);
    expect(after.history.past[0].before.tune.ve).toBe(before.tune.ve);
    expect(after.history.past[0].label).toBe('VE edit');
  });

  it('puts the table back', () => {
    // One `start`, threaded through both dispatches, so this can assert reference
    // equality: restore must hand back the SAME array the snapshot captured, not a
    // recomputed one that merely looks equal. Two independent `makeInitialState()`
    // calls would defeat that — the function's own header documents that it returns a
    // fresh object graph every time, and `ve` is recomputed by `computeHardwareVE`.
    const start = makeInitialState();
    const edit = reducer(start, { type: ACTIONS.SET_TABLE, table: 've', value: [[42]] });
    const s = reducer(edit, { type: ACTIONS.UNDO });
    expect(s.tune.ve).toBe(start.tune.ve);
    expect(s.history.past).toHaveLength(0);
    expect(s.history.future).toHaveLength(1);
  });

  it('restores tablesDirty, not just the numbers', () => {
    // A history that carried only the table would leave the player's unsaved-work flag
    // stuck true after undoing their only edit.
    expect(edited().tune.tablesDirty).toBe(true);
    expect(reducer(edited(), { type: ACTIONS.UNDO }).tune.tablesDirty).toBe(false);
  });

  it('restores presetId, because SET_TABLE cleared it', () => {
    // The reason the snapshot is a projection of BOTH slices. SET_TABLE clears
    // presetId in the same pass it writes the table; undo has to put the label back or
    // the header goes on disowning a preset the player never actually left.
    const loaded = { ...makeInitialState() };
    loaded.build = { ...loaded.build, presetId: 'n54' };
    const dirty = reducer(loaded, { type: ACTIONS.SET_TABLE, table: 'timing', value: [[9]] });
    expect(dirty.build.presetId).toBeNull();
    expect(reducer(dirty, { type: ACTIONS.UNDO }).build.presetId).toBe('n54');
  });

  it('restores the build fields APPLY_PRESET overwrote', () => {
    const before = makeInitialState();
    const after = reducer(before, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    expect(after.build.turboOn).toBe(true);
    const undone = reducer(after, { type: ACTIONS.UNDO });
    expect(undone.build.turboOn).toBe(false);
    expect(undone.build.engineConfig).toBe(before.build.engineConfig);
    expect(undone.build.presetId).toBeNull();
  });

  it('labels a preset load with the preset name', () => {
    const after = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    expect(after.history.past[0].label).toBe('Preset · BMW N54');
  });

  it('labels a reset', () => {
    const after = reducer(makeInitialState(), { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(after.history.past[0].label).toBe('Reset to stock');
  });

  it('redo puts the edit back', () => {
    const undone = reducer(edited(), { type: ACTIONS.UNDO });
    const redone = reducer(undone, { type: ACTIONS.REDO });
    expect(redone.tune.ve).toEqual([[42]]);
    expect(redone.history.past).toHaveLength(1);
    expect(redone.history.future).toHaveLength(0);
  });

  it('a new edit clears the redo stack', () => {
    // Otherwise redo would jump the player onto a branch they had already left.
    const undone = reducer(edited(), { type: ACTIONS.UNDO });
    expect(undone.history.future).toHaveLength(1);
    const branched = reducer(undone, { type: ACTIONS.SET_TABLE, table: 've', value: [[7]] });
    expect(branched.history.future).toHaveLength(0);
  });

  it('caps the stack at 50 and drops the OLDEST entry', () => {
    let s = makeInitialState();
    for (let i = 0; i < 60; i += 1) {
      s = reducer(s, { type: ACTIONS.SET_TABLE, table: 've', value: [[i]] });
    }
    expect(s.history.past).toHaveLength(50);
    // Entry 0 must be the snapshot taken before edit #10 — i.e. holding edit #9's
    // value. Asserting the LENGTH alone would pass just as well for a cap that
    // discarded the newest entries, which is the opposite of what undo needs.
    expect(s.history.past[0].before.tune.ve).toEqual([[9]]);
  });

  it('undo and redo on an empty stack return the SAME object', () => {
    // Reference equality, not deep equality: React's useReducer bails out of the
    // re-render only when the reducer returns the identical object.
    const s = makeInitialState();
    expect(reducer(s, { type: ACTIONS.UNDO })).toBe(s);
    expect(reducer(s, { type: ACTIONS.REDO })).toBe(s);
  });

  it('does not record actions that are not undoable', () => {
    const s = reducer(makeInitialState(), { type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true });
    expect(s.history.past).toHaveLength(0);
  });

  it('does not restore dyno results', () => {
    // A deliberate asymmetry, spec'd: undo brings back hardware and calibration, but
    // re-showing a banked score beside a build that was just reverted would state
    // something false.
    const withResult = { ...makeInitialState() };
    withResult.session = {
      ...withResult.session,
      result: { peakHp: 400 },
    };
    const loaded = reducer(withResult, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    expect(loaded.session.result).toBeNull();
    const undone = reducer(loaded, { type: ACTIONS.UNDO });
    expect(undone.session.result).toBeNull();
  });

  it('preserves the entry label when moving it between past and future', () => {
    // Task 2 uses history.future[0].label for the redo button's accessible name, so a
    // relabel on the way through UNDO or REDO would silently mislabel it. The existing
    // ordering tests above only assert stack LENGTHS, which a hardcoded label could
    // still pass.
    const after = reducer(
      makeInitialState(),
      { type: ACTIONS.SET_TABLE, table: 'timing', value: [[9]] },
    );
    expect(after.history.past[0].label).toBe('Spark edit');

    const undone = reducer(after, { type: ACTIONS.UNDO });
    expect(undone.history.future[0].label).toBe('Spark edit');

    const redone = reducer(undone, { type: ACTIONS.REDO });
    expect(redone.history.past[0].label).toBe('Spark edit');
  });

  it('refuses to record a table it has no label for, AT the dispatch', () => {
    // F5. The lookup used to hand back `undefined` for an unrecognised table and the
    // entry was pushed with `label: undefined`; the failure then surfaced as a
    // TypeError inside EngineScreen's `top.label.startsWith(...)` — on BUILD, a
    // different screen entirely, at a stack naming neither the dispatch nor the table.
    // Unreachable from the UI today, exactly like the `default` branch beside it, and
    // held for the same reason that branch is documented at length.
    expect(() => reducer(
      makeInitialState(),
      /** @type {*} */ ({ type: ACTIONS.SET_TABLE, table: 'boost', value: [[1]] }),
    )).toThrow(/no label defined for table "boost"/);
  });

  it('labels each table edit distinctly', () => {
    const timing = reducer(
      makeInitialState(),
      { type: ACTIONS.SET_TABLE, table: 'timing', value: [[9]] },
    );
    expect(timing.history.past[0].label).toBe('Spark edit');

    const afr = reducer(
      makeInitialState(),
      { type: ACTIONS.SET_TABLE, table: 'afr', value: [[9]] },
    );
    expect(afr.history.past[0].label).toBe('Fuel edit');
  });

  it('falls back to a generic label for an unknown preset id', () => {
    // presetById() finds nothing for an id not in the catalogue — the label must not
    // blow up or fall through to some OTHER action's label, it names the calibration
    // generically instead.
    const unknownPreset = { ...N54_PRESET, presetId: 'not-a-real-preset-id' };
    const after = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset: unknownPreset });
    expect(after.history.past[0].label).toBe('Preset · factory calibration');
  });

  it('walks the stack in order across three edits: undo unwinds newest-first, redo replays oldest-first', () => {
    // The two plausible wrong implementations this guards against:
    //   (1) undo reading `past[0]`/slicing `past.slice(1)` instead of the LAST entry —
    //       that would make undo FIFO and reverse the OLDEST edit first;
    //   (2) redo pushing onto the END of `future` instead of the front — that would
    //       replay edits in the wrong order.
    // Every other test in this file operates on a stack of depth <= 1, so none of them
    // can tell those implementations apart from a correct one.
    const s0 = makeInitialState();
    const s1 = reducer(s0, { type: ACTIONS.SET_TABLE, table: 've', value: [[1]] });
    const s2 = reducer(s1, { type: ACTIONS.SET_TABLE, table: 've', value: [[2]] });
    const s3 = reducer(s2, { type: ACTIONS.SET_TABLE, table: 've', value: [[3]] });
    expect(s3.tune.ve).toEqual([[3]]);

    const u1 = reducer(s3, { type: ACTIONS.UNDO });
    expect(u1.tune.ve).toEqual([[2]]);
    const u2 = reducer(u1, { type: ACTIONS.UNDO });
    expect(u2.tune.ve).toEqual([[1]]);
    const u3 = reducer(u2, { type: ACTIONS.UNDO });
    // Reference equality against the ORIGINAL table, not merely `toEqual([[...]])` —
    // proves undo #3 walked all the way back to s0, not just to some equal-looking
    // value.
    expect(u3.tune.ve).toBe(s0.tune.ve);
    expect(u3.history.past).toHaveLength(0);
    expect(u3.history.future).toHaveLength(3);

    const r1 = reducer(u3, { type: ACTIONS.REDO });
    expect(r1.tune.ve).toEqual([[1]]);
    const r2 = reducer(r1, { type: ACTIONS.REDO });
    expect(r2.tune.ve).toEqual([[2]]);
    const r3 = reducer(r2, { type: ACTIONS.REDO });
    expect(r3.tune.ve).toEqual([[3]]);
    expect(r3.history.past).toHaveLength(3);
    expect(r3.history.future).toHaveLength(0);
  });
});

describe('undo scope — an entry restores only what its action wrote', () => {
  /**
   * A build with every hardware field moved off its default, so a restore that
   * overreaches has something visible to overwrite. Literals throughout; none of these
   * is the makeInitialState() default and none is what N54_PRESET writes.
   * @param {*} state
   * @returns {*}
   */
  function withHandBuiltHardware(state) {
    const next = { ...state };
    next.build = {
      ...next.build,
      turboOn: true, octaneIdx: 2, exhaustDiaIdx: 5, injIdx: 4, mafScalar: 0.88,
    };
    return next;
  }

  it('undoing a table edit leaves hardware fitted AFTER the edit alone', () => {
    // B1. SET_TABLE's entire build-side write is `presetId`, but the snapshot carries
    // all thirteen build fields — so a restore that replayed the whole snapshot took
    // a turbo fitted after the edit back off, under the label "Undo VE edit".
    const start = makeInitialState();
    const edit = reducer(start, { type: ACTIONS.SET_TABLE, table: 've', value: [[42]] });
    const built = withHandBuiltHardware(edit);

    const undone = reducer(built, { type: ACTIONS.UNDO });

    // The calibration side IS reversed: the table goes back to the exact array the
    // snapshot captured, and the unsaved-work flag with it.
    expect(undone.tune.ve).toBe(start.tune.ve);
    expect(undone.tune.tablesDirty).toBe(false);
    // ...and every hardware field built afterwards survives, as literals.
    expect(undone.build.turboOn).toBe(true);
    expect(undone.build.octaneIdx).toBe(2);
    expect(undone.build.exhaustDiaIdx).toBe(5);
    expect(undone.build.injIdx).toBe(4);
    expect(undone.build.mafScalar).toBe(0.88);
  });

  it('undoing a table edit still puts the preset label back, the one build field it wrote', () => {
    // The other side of the same scope: narrowing the restore must not narrow it to
    // nothing. SET_TABLE clears `presetId` in the pass that writes the table, so undo
    // has to hand it back or the header goes on disowning a preset the player never
    // left — while the twelve fields around it stay untouched.
    const loaded = { ...makeInitialState() };
    loaded.build = { ...loaded.build, presetId: 'n54', turboOn: true, octaneIdx: 2 };
    const edit = reducer(loaded, { type: ACTIONS.SET_TABLE, table: 'timing', value: [[9]] });
    expect(edit.build.presetId).toBeNull();

    const undone = reducer(edit, { type: ACTIONS.UNDO });

    expect(undone.build.presetId).toBe('n54');
    expect(undone.build.turboOn).toBe(true);
    expect(undone.build.octaneIdx).toBe(2);
  });

  it('undoing a PRESET LOAD reverts the hardware too — the scopes are not the same', () => {
    // The exclusivity between the two scopes, driven through the reducer rather than
    // read off the entry. APPLY_PRESET replaces the whole build, so "return to the
    // state before it" has to include hardware changed since; the test above says the
    // opposite for SET_TABLE, and only both together pin the distinction.
    const start = makeInitialState();
    const loaded = reducer(start, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    const built = withHandBuiltHardware(loaded);
    expect(built.build.octaneIdx).toBe(2);

    const undone = reducer(built, { type: ACTIONS.UNDO });

    // Back to the pre-preset defaults, not to the hand-built values above.
    expect(undone.build.turboOn).toBe(false);
    expect(undone.build.octaneIdx).toBe(0);
    expect(undone.build.exhaustDiaIdx).toBe(start.build.exhaustDiaIdx);
    expect(undone.build.injIdx).toBe(0);
    expect(undone.build.mafScalar).toBe(1.0);
    expect(undone.build.engineConfig).toBe(start.build.engineConfig);
  });

  it('carries the scope on the entry, in both directions', () => {
    // The scope lives on the entry rather than being re-derived from the action,
    // because history.js may not import ACTIONS. If UNDO or REDO dropped it while
    // moving the entry between the stacks, `restore` would have nothing to go on.
    const edit = reducer(makeInitialState(), { type: ACTIONS.SET_TABLE, table: 've', value: [[42]] });
    expect(edit.history.past[0].scope).toBe('calibration');

    const undone = reducer(edit, { type: ACTIONS.UNDO });
    expect(undone.history.future[0].scope).toBe('calibration');

    const redone = reducer(undone, { type: ACTIONS.REDO });
    expect(redone.history.past[0].scope).toBe('calibration');
  });

  it('records the wider scope for the two actions that replace the whole build', () => {
    const loaded = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    expect(loaded.history.past[0].scope).toBe('all');

    const reset = reducer(makeInitialState(), { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(reset.history.past[0].scope).toBe('all');
  });
});

describe('restore scopes, on their own', () => {
  // The reducer tests above pin the scopes through real sequences. These pin `restore`
  // itself, which is where the exclusivity actually lives — and where a REDO's scope
  // is observable at all: between an undo and its redo, nothing may write a snapshotted
  // build field without abandoning the redo branch (see below), so no reducer sequence
  // can tell the two scopes apart on the redo side.

  /** A snapshot whose every value is distinguishable from the state it goes back into. */
  const before = {
    build: {
      engineConfig: { configuration: 'V8' }, mods: { intake: true }, turboOn: true,
      boostCurve: [9], turbineIdx: 7, turbineCount: 2, compressorIdx: 7, injIdx: 7,
      ecuInjectorCc: 777, octaneIdx: 7, exhaustDiaIdx: 7, mafScalar: 0.77,
      presetId: 'snapshotted-preset',
    },
    tune: { ve: [[55]], timing: [[33]], afr: [[7]], tablesDirty: true },
  };

  /** The live state the snapshot is restored into — no field shared with `before`. */
  const live = () => ({
    build: {
      engineConfig: { configuration: 'I4' }, mods: { intake: false }, turboOn: false,
      boostCurve: [1], turbineIdx: 1, turbineCount: 1, compressorIdx: 1, injIdx: 1,
      ecuInjectorCc: 111, octaneIdx: 1, exhaustDiaIdx: 1, mafScalar: 1.0,
      presetId: 'live-preset', boostSel: 4, presetPrompt: null,
    },
    tune: { ve: [[1]], timing: [[1]], afr: [[1]], tablesDirty: false, selection: 'live-selection' },
    session: 'live-session',
  });

  it('the wide scope puts every snapshotted build field back', () => {
    const out = /** @type {*} */ (restore(/** @type {*} */ (live()), /** @type {*} */ (before), RESTORE_ALL));
    expect(out.build.turboOn).toBe(true);
    expect(out.build.turbineIdx).toBe(7);
    expect(out.build.ecuInjectorCc).toBe(777);
    expect(out.build.mafScalar).toBe(0.77);
    expect(out.build.presetId).toBe('snapshotted-preset');
  });

  it('the narrow scope puts back presetId and NOTHING else on the build side', () => {
    const out = /** @type {*} */ (restore(/** @type {*} */ (live()), /** @type {*} */ (before), RESTORE_CALIBRATION));
    expect(out.build.presetId).toBe('snapshotted-preset');
    // The other twelve stay as the live state had them — literals, not `not.toBe`,
    // which would pass for any wrong value including a third one.
    expect(out.build.turboOn).toBe(false);
    expect(out.build.turbineIdx).toBe(1);
    expect(out.build.turbineCount).toBe(1);
    expect(out.build.compressorIdx).toBe(1);
    expect(out.build.injIdx).toBe(1);
    expect(out.build.ecuInjectorCc).toBe(111);
    expect(out.build.octaneIdx).toBe(1);
    expect(out.build.exhaustDiaIdx).toBe(1);
    expect(out.build.mafScalar).toBe(1.0);
    expect(out.build.boostCurve).toEqual([1]);
    expect(out.build.engineConfig).toEqual({ configuration: 'I4' });
    expect(out.build.mods).toEqual({ intake: false });
  });

  it('both scopes put the whole tune projection back, and leave the cursors alone', () => {
    for (const scope of [RESTORE_ALL, RESTORE_CALIBRATION]) {
      const out = /** @type {*} */ (
        restore(/** @type {*} */ (live()), /** @type {*} */ (before), /** @type {*} */ (scope))
      );
      expect(out.tune.ve).toEqual([[55]]);
      expect(out.tune.timing).toEqual([[33]]);
      expect(out.tune.afr).toEqual([[7]]);
      expect(out.tune.tablesDirty).toBe(true);
      // Outside the snapshot, so untouched under either scope.
      expect(out.tune.selection).toBe('live-selection');
      expect(out.build.boostSel).toBe(4);
      expect(out.session).toBe('live-session');
    }
  });

  it('throws on a scope it does not implement, rather than restoring some arbitrary subset', () => {
    // The same choice `labelFor`'s default branch makes: an entry recorded with no
    // scope would otherwise put back a half-state and look like a bug elsewhere.
    expect(() => restore(/** @type {*} */ (live()), /** @type {*} */ (before), /** @type {*} */ (undefined)))
      .toThrow(/unknown scope/);
    expect(() => restore(/** @type {*} */ (live()), /** @type {*} */ (before), /** @type {*} */ ('tables')))
      .toThrow(/unknown scope/);
  });
});

describe('new work abandons the redo branch', () => {
  /** A state with a preset load undone, so `future` holds exactly one entry. */
  function undoneLoad() {
    const loaded = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    const undone = reducer(loaded, { type: ACTIONS.UNDO });
    expect(undone.history.future).toHaveLength(1);
    return undone;
  }

  it('a hardware write clears future, even though it records no undo entry', () => {
    // B2. Only UNDOABLE actions used to clear `future`, so hardware built after an
    // undo sat alongside a live redo branch that would overwrite exactly those
    // fields — REDO then replaced a hand-picked octane with the preset's, under a
    // label naming only the preset.
    const built = reducer(undoneLoad(), { type: ACTIONS.SET_BUILD_FIELD, field: 'octaneIdx', value: 2 });
    expect(built.history.future).toHaveLength(0);
    // ...and it is still not undoable: clearing the branch is not the same as
    // recording one.
    expect(built.history.past).toHaveLength(0);
  });

  it('every other write to a snapshotted field clears it too', () => {
    // SET_BUILD_FIELD above is one of four. Each is checked from its own fresh
    // `undoneLoad()` so no one of them can pass on another's account.
    expect(reducer(undoneLoad(), { type: ACTIONS.SET_TURBINE, value: 2 })
      .history.future).toHaveLength(0);
    expect(reducer(undoneLoad(), { type: ACTIONS.CLEAR_PRESET_ID })
      .history.future).toHaveLength(0);
    expect(reducer(undoneLoad(), { type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { bore: 90 } })
      .history.future).toHaveLength(0);
    expect(reducer(undoneLoad(), { type: ACTIONS.SET_TABLE, table: 've', value: [[7]] })
      .history.future).toHaveLength(0);
  });

  it('moving the grid selection does NOT clear it', () => {
    // `selection` is a cursor, outside the snapshot — and `changeTab` writes it on
    // every tab switch, so counting it as new work would mean walking from TUNE to
    // BUILD silently killed the redo the player crossed tabs to reach.
    const moved = reducer(undoneLoad(), {
      type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'cell', row: 1, col: 1 },
    });
    expect(moved.history.future).toHaveLength(1);
  });

  it('session-only and cursor writes do NOT clear it', () => {
    // None of these touches a field any snapshot carries, so a redo cannot overwrite
    // anything they did.
    expect(reducer(undoneLoad(), { type: ACTIONS.SET_BOOST_SEL, value: 6 })
      .history.future).toHaveLength(1);
    expect(reducer(undoneLoad(), { type: ACTIONS.SET_PRESET_PROMPT, value: { id: 'x' } })
      .history.future).toHaveLength(1);
    expect(reducer(undoneLoad(), { type: ACTIONS.SET_SESSION_FIELD, field: 'pullCount', value: 3 })
      .history.future).toHaveLength(1);
    expect(reducer(undoneLoad(), { type: ACTIONS.REPAIR_ENGINE })
      .history.future).toHaveLength(1);
    // BANK_PULL is the excluded action a player fires most often between an undo and a
    // redo — a dyno pull is the obvious thing to do to check whether the undo helped.
    // It writes only session bookkeeping, so a redo cannot overwrite any of it.
    expect(reducer(undoneLoad(), {
      type: ACTIONS.BANK_PULL,
      result: { peakHp: 410, wear: { piston: 3, bearing: 2, valve: 1 } },
      pullScore: 50,
      scores: { tuning: {}, engineer: {}, signature: 'x' },
    }).history.future).toHaveLength(1);
  });

  it('abandons the redo branch WITHOUT discarding the undo stack', () => {
    // The clear rebuilds `history`, so it has to carry `past` across explicitly. Every
    // other test here starts from a stack whose `past` is already empty, which is why
    // `past: []` in that branch passed the whole suite: fitting a turbo after an undo
    // would have thrown away every undo step the player still had.
    let s = reducer(makeInitialState(), { type: ACTIONS.SET_TABLE, table: 've', value: [[1]] });
    s = reducer(s, { type: ACTIONS.SET_TABLE, table: 'timing', value: [[2]] });
    s = reducer(s, { type: ACTIONS.UNDO });
    expect(s.history.past).toHaveLength(1);
    expect(s.history.future).toHaveLength(1);

    const built = reducer(s, { type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true });

    expect(built.history.future).toHaveLength(0);
    // The surviving entry is still the FIRST edit's, so undo still walks back correctly.
    expect(built.history.past).toHaveLength(1);
    expect(built.history.past[0].label).toBe('VE edit');
  });

  it('a tune write to a SNAPSHOTTED field clears it, unlike a cursor write', () => {
    // The exclusion above is structural, not a fact about today's callers: SET_TUNE_FIELD
    // is the one action whose write surface depends on its payload. `selection` is a
    // cursor and must not clear; `ve` is in the snapshot and must, or a redo would
    // overwrite it.
    const wrote = reducer(undoneLoad(), { type: ACTIONS.SET_TUNE_FIELD, field: 've', value: [[3]] });
    expect(wrote.history.future).toHaveLength(0);
  });

  it('leaves the history object itself alone when there is nothing to abandon', () => {
    // The clear allocates a new history only when `future` is non-empty, so the
    // ordinary case — a hardware write with no redo branch live — keeps the same
    // object and React's bail-out machinery downstream sees no change.
    const start = makeInitialState();
    const built = reducer(start, { type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true });
    expect(built.history).toBe(start.history);
  });
});

describe('restore leaves deliberately-excluded cursor fields alone', () => {
  // Both `build.presetPrompt` and `tune.selection` are cursor/UI-state fields,
  // deliberately absent from BUILD_KEYS/TUNE_KEYS in history.js — see that file's own
  // comments for why each one specifically is excluded. APPLY_PRESET itself SETS
  // presetPrompt: null and selection: null as part of its own write (reducer.js), so
  // this test does not expect undo to bring back their pre-APPLY_PRESET seeded
  // values — they were never captured in the snapshot to begin with, so they must
  // stay null through UNDO too. `boostSel`, which APPLY_PRESET never touches at all,
  // is the control: it must survive both the preset load and the undo completely
  // untouched.
  it('keeps boostSel untouched and presetPrompt/selection excluded, through APPLY_PRESET and UNDO', () => {
    const seeded = { ...makeInitialState() };
    seeded.build = { ...seeded.build, boostSel: 7, presetPrompt: { id: 'seed-prompt' } };
    seeded.tune = { ...seeded.tune, selection: { type: 'cell', row: 9, col: 9 } };

    const applied = reducer(seeded, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    // Sanity: confirm APPLY_PRESET's own write really did null these two, and left
    // boostSel alone, so a failure below can only mean UNDO got it wrong, not the setup.
    expect(applied.build.presetPrompt).toBeNull();
    expect(applied.tune.selection).toBeNull();
    expect(applied.build.boostSel).toBe(7);

    const undone = reducer(applied, { type: ACTIONS.UNDO });
    // boostSel was never part of the snapshot at all, so it must ride through
    // untouched — this is the field a `build: { ...before.build }` restore bug would
    // silently drop to undefined.
    expect(undone.build.boostSel).toBe(7);
    // Deliberately excluded from the snapshot: undo must NOT resurrect the
    // pre-APPLY_PRESET seeded values here, or it would re-open the
    // overwrite-confirmation modal / move the grid highlight right after the player
    // undid loading the preset.
    expect(undone.build.presetPrompt).toBeNull();
    expect(undone.tune.selection).toBeNull();
  });
});

describe('snapshot field coverage', () => {
  // Literal, not derived from BUILD_KEYS/TUNE_KEYS: importing the same list the
  // module iterates over would let a key deleted from both the list AND this
  // expectation pass vacuously. That is exactly the vulnerability a reviewer found —
  // cutting BUILD_KEYS to 3 entries and TUNE_KEYS to 2 left all 871 tests green.
  it('snapshots exactly the documented 13 build and 4 tune fields', () => {
    const snap = snapshot(makeInitialState());
    expect(Object.keys(snap.build).sort()).toEqual([
      'boostCurve', 'compressorIdx', 'ecuInjectorCc', 'engineConfig', 'exhaustDiaIdx',
      'injIdx', 'mafScalar', 'mods', 'octaneIdx', 'presetId', 'turbineCount',
      'turbineIdx', 'turboOn',
    ]);
    expect(Object.keys(snap.tune).sort()).toEqual(['afr', 'tablesDirty', 'timing', 've']);
  });

  // Every field below is seeded to a value that differs from BOTH its
  // makeInitialState() default AND the value APPLY_PRESET's N54_PRESET fixture writes.
  // That double difference is load-bearing: turbineIdx, compressorIdx and
  // exhaustDiaIdx all happen to share the SAME value between the default state and
  // this particular preset (1, 1 and 2 respectively), and mafScalar/tablesDirty are
  // 1.0/false on both sides too — a seed that collapsed onto either value would let a
  // dropped BUILD_KEYS/TUNE_KEYS entry go completely unnoticed here.
  it('round-trips every snapshotted field through APPLY_PRESET + UNDO', () => {
    /** @type {import('../../../src/sim/index.js').EngineConfig} */
    const beforeEngineConfig = {
      configuration: 'V8', bore: 101.1, stroke: 92.2, compression: 8.8,
      blockMaterial: 'Cast Iron', headMaterial: 'Cast Iron',
    };
    const beforeMods = { intake: true, exhaust: true, headers: true, intercooler: true };
    const beforeBoostCurve = [3, 3, 3, 3, 3, 3, 3, 3];
    const beforeVe = [[55]];
    const beforeTiming = [[33]];
    const beforeAfr = [[7]];

    const start = { ...makeInitialState() };
    start.build = {
      ...start.build,
      engineConfig: beforeEngineConfig,
      mods: beforeMods,
      turboOn: false,
      boostCurve: beforeBoostCurve,
      turbineIdx: 3,
      turbineCount: 4,
      compressorIdx: 3,
      injIdx: 9,
      ecuInjectorCc: 999,
      octaneIdx: 9,
      exhaustDiaIdx: 6,
      mafScalar: 0.77,
      presetId: 'placeholder-preset',
    };
    start.tune = {
      ...start.tune,
      ve: beforeVe,
      timing: beforeTiming,
      afr: beforeAfr,
      tablesDirty: true,
    };

    const applied = reducer(start, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    // Sanity: confirm the preset really did overwrite every one of these fields, so a
    // failure below can only mean undo did not restore them — not that they were
    // never touched in the first place.
    expect(applied.build.turboOn).toBe(true);
    expect(applied.build.turbineIdx).toBe(1);
    expect(applied.build.compressorIdx).toBe(1);
    expect(applied.build.exhaustDiaIdx).toBe(2);
    expect(applied.build.mafScalar).toBe(1.0);
    expect(applied.tune.tablesDirty).toBe(false);

    const undone = reducer(applied, { type: ACTIONS.UNDO });

    expect(undone.build.engineConfig).toBe(beforeEngineConfig);
    expect(undone.build.mods).toBe(beforeMods);
    expect(undone.build.turboOn).toBe(false);
    expect(undone.build.boostCurve).toBe(beforeBoostCurve);
    expect(undone.build.turbineIdx).toBe(3);
    expect(undone.build.turbineCount).toBe(4);
    expect(undone.build.compressorIdx).toBe(3);
    expect(undone.build.injIdx).toBe(9);
    expect(undone.build.ecuInjectorCc).toBe(999);
    expect(undone.build.octaneIdx).toBe(9);
    expect(undone.build.exhaustDiaIdx).toBe(6);
    expect(undone.build.mafScalar).toBe(0.77);
    expect(undone.build.presetId).toBe('placeholder-preset');
    expect(undone.tune.ve).toBe(beforeVe);
    expect(undone.tune.timing).toBe(beforeTiming);
    expect(undone.tune.afr).toBe(beforeAfr);
    expect(undone.tune.tablesDirty).toBe(true);
  });
});

describe('run log', () => {
  /** @returns {import('../../../src/ui/state/runLog.js').RunRecord} */
  const rec = (id) => ({
    id, n: Number(id), at: 1000 + Number(id), label: 'VQ35DE',
    peakHp: 300, peakTq: 280, knocks: 0,
    scores: { tuning: 80, engineer: 70, pull: 640 },
    points: [{ rpm: 1500, hp: 100, torque: 200 }],
    inputs: { build: {}, tune: {}, loadKpa: 100 },
  });

  /** BANK_PULL's minimum viable payload. */
  const bank = (id) => ({
    type: ACTIONS.BANK_PULL,
    run: rec(id),
    result: { peakHp: 300, peakTq: 280, points: [], events: [], wear: { piston: 1, bearing: 1, valve: 1 } },
    pullScore: 640,
    scores: { tuning: { score: 80 }, engineer: { score: 70 }, signature: 'sig' },
  });

  it('records the banked run at the front of the log', () => {
    const s = reducer(reducer(makeInitialState(), bank('1')), bank('2'));
    expect(s.session.runs.map((r) => r.id)).toEqual(['2', '1']);
  });

  it('starts with an empty log and no pin', () => {
    const s = makeInitialState();
    expect(s.session.runs).toEqual([]);
    expect(s.session.pinnedRunId).toBe(null);
  });

  it('pins and unpins a run', () => {
    const pinned = reducer(makeInitialState(), { type: ACTIONS.PIN_RUN, id: '7' });
    expect(pinned.session.pinnedRunId).toBe('7');

    // A second PIN_RUN overwrites the pin rather than stacking — there is only
    // ever one, per the UNPIN_RUN typedef's "no payload" note.
    const repinned = reducer(pinned, { type: ACTIONS.PIN_RUN, id: '9' });
    expect(repinned.session.pinnedRunId).toBe('9');

    // Pinning is bookkeeping over the log, not a write to it.
    expect(repinned.session.runs).toBe(pinned.session.runs);

    expect(reducer(pinned, { type: ACTIONS.UNPIN_RUN }).session.pinnedRunId).toBe(null);
  });

  it('leaves the run log and the pin standing when a preset is loaded', () => {
    // BOTH halves of the pair. Asserting only that the scorecard clears would pass
    // against an APPLY_PRESET that also wipes twenty runs of persisted history —
    // which undo does not cover and the player cannot get back.
    const withRun = reducer(reducer(makeInitialState(), bank('1')), { type: ACTIONS.PIN_RUN, id: '1' });
    const after = reducer(withRun, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    expect(after.session.result).toBe(null);
    expect(after.session.pullScores).toBe(null);
    expect(after.session.runs.map((r) => r.id)).toEqual(['1']);
    expect(after.session.pinnedRunId).toBe('1');
  });

  it('leaves the whole session slice alone on RESET_TO_STOCK', () => {
    // Pins today's behaviour so the natural-but-wrong pairing with APPLY_PRESET
    // cannot be introduced by someone "making them consistent". RESET_TO_STOCK has
    // never touched session, including result and pullScores.
    const withRun = reducer(makeInitialState(), bank('1'));
    const after = reducer(withRun, { type: ACTIONS.RESET_TO_STOCK, ve: withRun.tune.ve });
    expect(after.session).toBe(withRun.session);
  });
});
