/**
 * What counts as "a different car" — pure, no DOM.
 *
 * The banked scores from a pull are only honest if something notices when the build
 * they were measured on stops being the build on screen. This is that something, and
 * the tests below are about its two failure directions, which are NOT symmetric:
 *
 * - Missing a real change is the serious one. It puts a stale score on screen with no
 *   warning, which is the whole bug (#29) wearing a different hat.
 * - Reporting a change that did not happen is merely annoying: a "build has changed"
 *   banner over numbers that are in fact current, cleared by running a pull.
 *
 * So the coverage is asymmetric on purpose: every measured input gets a test that it
 * is NOT ignored, and the fields that must not trigger it get one test between them.
 */

import { describe, expect, it } from 'vitest';

import { clone2D } from '../../../src/sim/index.js';
import { makeInitialState } from '../../../src/ui/state/initialState.js';
import { diffMeasuredInputs, measuredInputs, pullSignature } from '../../../src/ui/state/pullSignature.js';

/**
 * Signs a state tree, optionally with one slice patched.
 * @param {object} [patch] `{build?, tune?, session?}` fields to override
 * @returns {string}
 */
function sign(patch = {}) {
  const s = makeInitialState();
  const build = { ...s.build, ...(/** @type {any} */ (patch).build ?? {}) };
  const tune = { ...s.tune, ...(/** @type {any} */ (patch).tune ?? {}) };
  const session = { ...s.session, ...(/** @type {any} */ (patch).session ?? {}) };
  return pullSignature(build, tune, session.loadKpa);
}

describe('pullSignature', () => {
  it('is stable for a configuration that has not moved', () => {
    expect(sign()).toBe(sign());
  });

  // Every field the sweep or the Engineer Score reads. A `.forEach` rather than one
  // test with twelve assertions so a regression names the field it dropped.
  /** @type {Array<[string, object]>} */
  const measuredBuildChanges = [
    ['engineConfig', { engineConfig: { ...makeInitialState().build.engineConfig, bore: 90 } }],
    ['mods', { mods: { intake: true, exhaust: false, headers: false, intercooler: false } }],
    ['turboOn', { turboOn: true }],
    ['boostCurve', { boostCurve: makeInitialState().build.boostCurve.map((b) => b + 1) }],
    ['octaneIdx', { octaneIdx: 1 }],
    ['injIdx', { injIdx: 1 }],
    ['mafScalar', { mafScalar: 0.9 }],
    ['turbineIdx', { turbineIdx: 0 }],
    ['turbineCount', { turbineCount: 2 }],
    ['compressorIdx', { compressorIdx: 0 }],
    ['exhaustDiaIdx', { exhaustDiaIdx: 0 }],
    ['ecuInjectorCc', { ecuInjectorCc: 550 }],
  ];
  for (const [field, build] of measuredBuildChanges) {
    it(`changes when ${field} does`, () => {
      expect(sign({ build })).not.toBe(sign());
    });
  }

  // The tables are the reason this exists as a module rather than a list of hardware
  // fields. In a tuning simulator, editing a table IS the change a player makes
  // between two pulls — a signature that watched hardware alone would report the
  // scorecard as current on the one screen it matters most.
  for (const table of ['ve', 'timing', 'afr']) {
    it(`changes when the ${table} table is edited`, () => {
      const base = makeInitialState().tune;
      const edited = clone2D(/** @type {any} */ (base)[table]);
      edited[0][0] += 1;
      expect(sign({ tune: { [table]: edited } })).not.toBe(sign());
    });
  }

  it('changes when the dyno is run at a different manifold load', () => {
    // `loadKpa` is fed straight into simulateSweep, so 40 kPa and 100 kPa are two
    // different measurements of the same car — and the scores from one are not the
    // scores of the other.
    expect(sign({ session: { loadKpa: 40 } })).not.toBe(sign());
  });

  it('ignores labels and cursors, which cannot change a number', () => {
    // A signature that moved on any of these would put a "build has changed" banner up
    // for clicking a grid cell or opening a dialog. None of them reaches the
    // simulation: `presetId` names a build rather than being part of one, and the
    // other four are UI state.
    expect(sign({
      build: { presetId: 'n54', presetPrompt: { id: 'k20' }, boostSel: 7 },
      tune: { tablesDirty: true, selection: { type: 'cell', row: 1, col: 1 } },
    })).toBe(sign());
  });

  it('ignores the pull\'s own output, so banking a result cannot invalidate it', () => {
    // The trap this closes: sign the whole session slice and every banked pull would
    // instantly stale ITSELF, because BANK_PULL writes result/health/career totals in
    // the same pass the scores are banked in.
    expect(sign({
      session: {
        result: { peakHp: 410 }, revealCount: 40,
        bestScore: 500, totalScore: 900, pullCount: 3,
        health: { piston: 90, bearing: 95, valve: 99 },
      },
    })).toBe(sign());
  });

  it('ignores the live engine, which runs at 20 Hz beside the dyno', () => {
    // `session.live` changes twenty times a second while the engine idles. Signing it
    // would make a banked score go stale within one tick of pressing START, on a car
    // nobody had touched.
    expect(sign({ session: { live: { rpm: 3200, running: true }, throttleInput: 100 } }))
      .toBe(sign());
  });
});

describe('measuredInputs', () => {
  it('keeps the measured build fields and drops the label-only ones', () => {
    const s = makeInitialState();
    const projected = measuredInputs(
      { ...s.build, presetId: 'n54', presetPrompt: { open: true }, boostSel: 2 },
      s.tune,
      100,
    );
    expect(projected.build).toHaveProperty('engineConfig');
    expect(projected.build).toHaveProperty('boostCurve');
    // Mutation caught: projecting the whole slice. presetId/presetPrompt/boostSel
    // reach no simulation, and storing them would make two runs on the same car
    // diff as different because a dialog was open during one of them.
    expect(projected.build).not.toHaveProperty('presetId');
    expect(projected.build).not.toHaveProperty('presetPrompt');
    expect(projected.build).not.toHaveProperty('boostSel');
  });

  it('keeps the three tables and the ECU calibration, and drops the tune slice cursors', () => {
    const s = makeInitialState();
    const projected = measuredInputs(s.build, { ...s.tune, selection: { type: 'cell', row: 1, col: 1 }, tablesDirty: true }, 100);
    expect(Object.keys(projected.tune).sort()).toEqual(['afr', 'ecu', 'timing', 've']);
  });

  it('carries loadKpa', () => {
    const s = makeInitialState();
    expect(measuredInputs(s.build, s.tune, 140).loadKpa).toBe(140);
  });
});

describe('diffMeasuredInputs', () => {
  /** @returns {ReturnType<typeof measuredInputs>} */
  const project = (patch = {}) => {
    const s = makeInitialState();
    return measuredInputs(
      { ...s.build, ...(patch.build ?? {}) },
      { ...s.tune, ...(patch.tune ?? {}) },
      patch.loadKpa ?? 100,
    );
  };

  it('reports nothing for two identical configurations', () => {
    // Mutation caught: returning every label unconditionally.
    expect(diffMeasuredInputs(project(), project())).toEqual([]);
  });

  it('names the one field that moved and nothing else', () => {
    // Both halves in one assertion: 'boost curve' present AND every other label
    // absent. Asserting only `toContain('boost curve')` would pass against an
    // implementation that returns all sixteen labels every time.
    expect(diffMeasuredInputs(project(), project({ build: { boostCurve: [1, 2, 3, 4, 5, 6, 7, 8] } })))
      .toEqual(['boost curve']);
  });

  it('sees a change inside a calibration table', () => {
    // Mutation caught: comparing tables by reference (`a !== b`) reports a change on
    // every call because clone2D makes a fresh array; comparing with `===` on the
    // outer array misses a changed CELL entirely. Only a value compare gets both.
    const s = makeInitialState();
    const edited = clone2D(s.tune.ve);
    edited[0][0] += 5;
    expect(diffMeasuredInputs(project(), project({ tune: { ve: edited } }))).toEqual(['VE table']);
  });

  it('reports a table as unchanged when an equal copy is passed', () => {
    // The other half of the reference-compare pair.
    const s = makeInitialState();
    expect(diffMeasuredInputs(project(), project({ tune: { ve: clone2D(s.tune.ve) } }))).toEqual([]);
  });

  it('does not call an input changed when an older saved run never recorded it', () => {
    // A run banked before #112 has no fuel system, sensors or ECU calibration in its
    // inputs. Mutation caught: comparing undefined against the current value, which
    // listed all seven as changed on the first run after an update.
    const old = project();
    for (const k of ['fuelSystem', 'sensorHw', 'wastegate', 'coil', 'plugGapMm', 'ethanolPct']) delete old.build[k];
    delete old.tune.ecu;
    const saved = JSON.parse(JSON.stringify(old));
    expect(diffMeasuredInputs(saved, project())).toEqual([]);
    expect(diffMeasuredInputs(saved, project({ build: { turboOn: true } }))).toEqual(['turbo']);
  });

  it('names several fields when several moved', () => {
    expect(diffMeasuredInputs(project(), project({ build: { turboOn: true, octaneIdx: 3 }, loadKpa: 140 })))
      .toEqual(['turbo', 'fuel', 'dyno load']);
  });

  it('does not throw when a projection is missing entirely, not just a key inside it', () => {
    // storage.js validates that `runs` is an array but not that its elements are
    // records, so a hand-edited save's `runs: [1, 2, 3]` can reach this function with
    // an operand that has no `.build`/`.tune` at all — not merely a missing key
    // inside them. `a.build?.[k]` guards the missing KEY but still throws reading
    // `.build` off an `a` that is itself undefined.
    expect(() => diffMeasuredInputs(undefined, project())).not.toThrow();
    expect(() => diffMeasuredInputs(project(), undefined)).not.toThrow();
  });

  it('reports the same fields the signature reports as a change', () => {
    // The two functions must never disagree about WHETHER anything moved. This is the
    // property that justifies them living in one file over one private key list.
    const s = makeInitialState();
    const other = { ...s.build, mafScalar: 1.15 };
    expect(pullSignature(s.build, s.tune, 100)).not.toBe(pullSignature(other, s.tune, 100));
    expect(diffMeasuredInputs(measuredInputs(s.build, s.tune, 100), measuredInputs(other, s.tune, 100)))
      .not.toEqual([]);
  });
});
