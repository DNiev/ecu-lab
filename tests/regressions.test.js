/**
 * Regression tests for the four defects found in the pre-restructure review.
 *
 * Each test reproduces the original failure as closely as the simulation layer allows,
 * so that if a future change reintroduces the bug, the test says which one and why.
 * The comment above each block records the observed broken behaviour.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine } from './ecuHarness.js';

const STOCK = S.DEFAULT_ENGINE_CONFIG;
const NO_MODS = { ...S.DEFAULT_MODS, turboFitted: false };
const NA_HW = { turboOn: false, turbine: null, exhaustDia: 3.0, fuel: S.OCTANE_OPTS[0] };

/**
 * One point on a stock V6, with the ECU's table and the truth controlled separately.
 *
 * @param {{veVal?: number, veActualVal?: number, mafErrorBase?: number,
 *          afrCommanded?: number} & Record<string, any>} [o]
 */
function point({ veVal = 95, veActualVal, mafErrorBase = 1.0, afrCommanded = 12.6, ...rest } = {}) {
  return S.evaluatePoint({
    rpm: 5500, mapKpa: S.BARO_KPA, boostPsi: 0,
    veVal, veActualVal, timingVal: 32, afrCommanded,
    octaneBonus: 0, fuel: S.OCTANE_OPTS[0], mods: NO_MODS,
    mafScalar: 1.0, mafErrorBase, injectorCc: 315, ecuInjectorCc: 315,
    derived: S.deriveEngine(STOCK), compressor: S.COMPRESSOR_OPTS[1],
    ...rest,
  });
}

/** The correction the fuel-trim histogram applies, as implemented in the UI. */
const histogramErrorPct = (p) => ((p.afr / p.afrCommanded) - 1) * 100;

// ---------------------------------------------------------------------------
// #1 + #2 — the VE histogram
// ---------------------------------------------------------------------------
// WAS BROKEN: air charge and fuel mass were both derived from the same VE number, so
// lambda was mathematically invariant to VE (0.857 at VE 70, 90 and 110 alike). The
// histogram therefore had no signal to read. On top of that its error term was
// inverted, so applying it moved the table the wrong way: iterating the documented
// workflow decayed VE 96 -> 70 and power 206 -> 144 hp while the error sat pinned at
// -10.0% forever.
describe('#1/#2 fuel-trim histogram converges on the true VE table', () => {
  it('makes lambda respond to the gap between the table and reality', () => {
    // Table under-reports: ECU fuels for less air than is really there -> lean.
    const lean = point({ veVal: 85, veActualVal: 100 });
    // Table over-reports: ECU fuels for air that is not there -> rich.
    const rich = point({ veVal: 115, veActualVal: 100 });
    const exact = point({ veVal: 100, veActualVal: 100 });

    expect(lean.lambda).toBeGreaterThan(exact.lambda);
    expect(rich.lambda).toBeLessThan(exact.lambda);
    // A correct table hits the commanded mixture.
    expect(exact.afr).toBeCloseTo(exact.afrCommanded, 1);
  });

  it('does NOT let the ECU table conjure or destroy air', () => {
    // The table is a belief. Editing it must not change what the engine breathes.
    const a = point({ veVal: 70, veActualVal: 100 });
    const b = point({ veVal: 130, veActualVal: 100 });
    expect(a.maf).toBe(b.maf);
    expect(a.airCharge).toBe(b.airCharge);
    expect(a.chargeIndex).toBe(b.chargeIndex);
  });

  it('still lets a wrong table move knock margin — through mixture, not air', () => {
    // A miscalibrated table does not change cylinder filling, but it does change how
    // much fuel goes in, and mixture genuinely affects the knock limit. So the
    // threshold must move, and it must move for the right reason.
    // Knock tendency peaks near stoichiometric, a little rich of it, and falls away on
    // both sides (Al Almaleki et al., Fuel 2023; the classic octane-requirement curve).
    // So the realistic miscalibration is a full-load cell commanded rich, 11.5:1, whose
    // table reads 12% low: the mixture lands at about 13:1, near that peak.
    const lean = point({ veVal: 88, veActualVal: 100, afrCommanded: 11.5 });
    const onTarget = point({ veVal: 100, veActualVal: 100, afrCommanded: 11.5 });

    expect(lean.chargeIndex).toBe(onTarget.chargeIndex);   // same air...
    expect(lean.afr).toBeGreaterThan(onTarget.afr);        // ...leaner mixture...
    expect(lean.threshold).toBeLessThan(onTarget.threshold); // ...so less margin.
  });

  it('reports both the true filling and what the table claimed', () => {
    const p = point({ veVal: 85, veActualVal: 100 });
    expect(p.ve).toBe(100);
    expect(p.veTable).toBe(85);
  });

  it('signs the histogram error so lean-vs-commanded raises the table', () => {
    // Engine pulled more air than the table claimed -> ran lean -> table must go UP.
    const lean = point({ veVal: 85, veActualVal: 100 });
    expect(lean.afr).toBeGreaterThan(lean.afrCommanded);
    expect(histogramErrorPct(lean)).toBeGreaterThan(0);

    // ...and the mirror case must lower it.
    const rich = point({ veVal: 115, veActualVal: 100 });
    expect(rich.afr).toBeLessThan(rich.afrCommanded);
    expect(histogramErrorPct(rich)).toBeLessThan(0);
  });

  it('converges to the truth, rather than diverging as it used to', () => {
    const truth = 100;
    let table = 70;            // badly out of calibration
    const errors = [];

    for (let i = 0; i < 6; i++) {
      const p = point({ veVal: table, veActualVal: truth });
      const err = histogramErrorPct(p);
      errors.push(Math.abs(err));
      table = S.clamp(table * (1 + err / 100), 10, 130);   // exactly what applyHistogram does
    }

    expect(errors[0]).toBeGreaterThan(20);                 // started badly wrong
    // Error never grows. The old code held it pinned at 10% forever while bleeding
    // the table away, so "not increasing" is the property that actually regressed.
    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]).toBeLessThanOrEqual(errors[i - 1]);
    }
    expect(errors[errors.length - 1]).toBeLessThan(0.5);   // ended on target
    expect(table).toBeCloseTo(truth, 0);
  });

  it('is exact in a single pass at one cell', () => {
    // At an individual cell, actualAfr / commandedAfr is exactly trueVE / tableVE, so
    // one multiplication lands on the truth. Across a whole sweep the correction is
    // approximate, because each logged point is interpolated between four cells.
    let table = 70;
    const p = point({ veVal: table, veActualVal: 100 });
    table = table * (1 + histogramErrorPct(p) / 100);
    expect(table).toBeCloseTo(100, 6);
    // ...and a second pass is a no-op rather than an overshoot.
    expect(histogramErrorPct(point({ veVal: table, veActualVal: 100 }))).toBeCloseTo(0, 6);
  });

  it('converges from the rich side too', () => {
    const truth = 90;
    let table = 125;
    for (let i = 0; i < 8; i++) {
      const p = point({ veVal: table, veActualVal: truth });
      table = S.clamp(table * (1 + histogramErrorPct(p) / 100), 10, 130);
    }
    expect(table).toBeCloseTo(truth, 0);
  });

  it('defaults to a perfectly calibrated table when no truth is supplied', () => {
    // Back-compatibility: callers that do not model a miscalibration behave as before.
    const p = point({ veVal: 95, veActualVal: undefined });
    expect(p.ve).toBe(95);
    expect(p.veTable).toBe(95);
    expect(p.afr).toBeCloseTo(p.afrCommanded, 1);
  });

  it('carries the true VE through a full sweep', () => {
    const derived = S.deriveEngine(STOCK);
    const veTruth = S.computeHardwareVE(STOCK, S.DEFAULT_MODS, NA_HW);
    // The ECU's table reads 12% low everywhere.
    const veTable = veTruth.map((row) => row.map((v) => Number((v * 0.88).toFixed(1))));

    const base = {
      loadKpa: 100, timing: S.clone2D(S.DEFAULT_TIMING), afr: S.clone2D(S.DEFAULT_AFR),
      turboOn: false, boostCurve: [...S.DEFAULT_BOOST], octaneBonus: 0, octaneLabel: '91',
      fuel: S.OCTANE_OPTS[0], injectorCc: 315, ecuInjectorCc: 315, injectorLabel: '315cc',
      mods: S.DEFAULT_MODS, mafScalar: 1.0, derived,
      turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
    };

    const miscalibrated = S.simulateSweep({ ...base, ve: veTable, veTruth });
    const calibrated = S.simulateSweep({ ...base, ve: veTruth, veTruth });

    // Under-reporting VE under-fuels, so the pull runs lean of the commanded target.
    const midMis = miscalibrated.points[40];
    const midCal = calibrated.points[40];
    expect(midMis.afr).toBeGreaterThan(midMis.afrCommanded);
    expect(midCal.afr).toBeCloseTo(midCal.afrCommanded, 1);

    // Both breathe the same air — only the fuelling differs.
    expect(midMis.maf).toBeCloseTo(midCal.maf, 1);
  });
});

// ---------------------------------------------------------------------------
// #3 — the ZERO boost button
// ---------------------------------------------------------------------------
// WAS BROKEN: the button wrote a 7-element literal for an 8-column RPM axis. Alone it
// degraded quietly, but the next edit to the 7500 RPM point produced
// [0,0,0,0,0,0,0,NaN], and Math.max/interp1 then put NaN through peak power, torque,
// AFR, MAP and duty with no error boundary and no way back but a reload.
describe('#3 boost curves cannot desynchronise from the RPM axis', () => {
  it('ships a default boost curve matching the axis length', () => {
    expect(S.DEFAULT_BOOST).toHaveLength(S.RPM.length);
    expect(S.DEFAULT_BOOST.every(Number.isFinite)).toBe(true);
  });

  /** The normaliser every boost-curve write in the UI goes through. */
  const setBoostAt = (curve, i, value) =>
    S.RPM.map((_, idx) => S.clamp(Number(idx === i ? value : curve[idx]) || 0, 0, 25));

  it('repairs a short curve rather than propagating undefined', () => {
    const short = [0, 0, 0, 0, 0, 0, 0];            // the exact old ZERO literal
    const fixed = setBoostAt(short, S.RPM.length - 1, 5);
    expect(fixed).toHaveLength(S.RPM.length);
    expect(fixed.every(Number.isFinite)).toBe(true);
    expect(fixed[S.RPM.length - 1]).toBe(5);
    expect(Number.isFinite(Math.max(...fixed))).toBe(true);
  });

  it('keeps the simulation finite through the exact reproduction path', () => {
    // Reproduction: turbo on -> ZERO -> tap the 7500 RPM bar -> +5.
    const curve = setBoostAt([0, 0, 0, 0, 0, 0, 0], 7, 5);
    const derived = S.deriveEngine(STOCK);
    const r = S.simulateSweep({
      loadKpa: 100,
      ve: S.computeHardwareVE(STOCK, S.DEFAULT_MODS, { ...NA_HW, turboOn: true, turbine: S.TURBINE_OPTS[1] }),
      timing: S.clone2D(S.DEFAULT_TIMING), afr: S.clone2D(S.DEFAULT_AFR),
      turboOn: true, boostCurve: curve, octaneBonus: 0, octaneLabel: '91',
      fuel: S.OCTANE_OPTS[0], injectorCc: 315, ecuInjectorCc: 315, injectorLabel: '315cc',
      mods: S.DEFAULT_MODS, mafScalar: 1.0, derived,
      turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
    });

    expect(Number.isFinite(r.peakHp)).toBe(true);
    expect(Number.isFinite(r.peakTq)).toBe(true);
    for (const p of r.points) {
      for (const key of ['hp', 'torque', 'afr', 'map', 'duty', 'lambda', 'boostPsi']) {
        expect(Number.isFinite(p[key]), `${key} at ${p.rpm} RPM is not finite`).toBe(true);
      }
    }
  });

  it('clamps out-of-range edits instead of trusting the input', () => {
    const curve = S.RPM.map(() => 5);
    expect(setBoostAt(curve, 2, 999)[2]).toBe(25);
    expect(setBoostAt(curve, 2, -10)[2]).toBe(0);
    expect(setBoostAt(curve, 2, Number.NaN)[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #4 — exhaust diameter
// ---------------------------------------------------------------------------
// WAS BROKEN: two independent formulas. `idealExhaustDiameter` (power-based, rises
// with boost) drove the on-screen advice and the Engineer Score, while a separate
// displacement-only expression inside computeHardwareVE drove the actual VE physics.
// They diverged badly under boost (3.5 L @ 10 psi: advice 4.82", physics 3.08"), and
// because the advice routinely exceeded the largest purchasable option of 4.0", the
// -8 Engineer Score penalty became permanent and unfixable.
describe('#4 exhaust sizing has one formula and a reachable target', () => {
  it('offers a purchasable option within tolerance for every buildable engine', () => {
    const TOLERANCE = 0.3;   // the Engineer Score's threshold
    const options = S.EXHAUST_DIA_OPTS.map((o) => o.dia);

    for (const displacementL of [1.5, 2.0, 3.5, 5.0, 6.5]) {
      for (const boost of [0, 5, 10, 15, 20, 25]) {
        const ideal = S.idealExhaustDiameter(displacementL, boost);
        const nearest = options.reduce((a, c) => (Math.abs(c - ideal) < Math.abs(a - ideal) ? c : a));
        expect(
          Math.abs(nearest - ideal),
          `${displacementL}L @ ${boost}psi wants ${ideal.toFixed(2)}" but the nearest option is ${nearest}"`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  it('lets a well-matched build score without an exhaust penalty', () => {
    const derived = S.deriveEngine(STOCK);
    const options = S.EXHAUST_DIA_OPTS.map((o) => o.dia);
    const ideal = S.idealExhaustDiameter(derived.displacementL, 10);
    const nearest = options.reduce((a, c) => (Math.abs(c - ideal) < Math.abs(a - ideal) ? c : a));

    const score = S.computeEngineerScore({
      engineConfig: { ...STOCK, compression: 9.5 }, turboOn: true, peakBoostPsi: 10,
      turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
      exhaustDiaError: nearest - ideal, dutyPreview: 80, displacementL: derived.displacementL,
      fuel: S.OCTANE_OPTS[0], mods: S.DEFAULT_MODS,
    });
    expect(score.deductions.join(' ')).not.toMatch(/Exhaust diameter/);
  });

  it('uses the same ideal in the VE physics as in the advice', () => {
    // Sizing correctly must beat sizing badly, judged by the very same target the UI
    // shows. Under the old code the physics preferred a diameter the score punished.
    const cfg = STOCK;
    const derived = S.deriveEngine(cfg);
    const boost = 10;
    const ideal = S.idealExhaustDiameter(derived.displacementL, boost);
    const options = S.EXHAUST_DIA_OPTS.map((o) => o.dia);
    const nearest = options.reduce((a, c) => (Math.abs(c - ideal) < Math.abs(a - ideal) ? c : a));
    const worst = options.reduce((a, c) => (Math.abs(c - ideal) > Math.abs(a - ideal) ? c : a));

    const veAt = (dia) => S.computeHardwareVE(cfg, S.DEFAULT_MODS, {
      turboOn: true, turbine: S.TURBINE_OPTS[1], exhaustDia: dia,
      fuel: S.OCTANE_OPTS[0], peakBoostPsi: boost,
    });
    const wotRow = 2, topCol = S.RPM.length - 1;
    expect(veAt(nearest)[wotRow][topCol]).toBeGreaterThan(veAt(worst)[wotRow][topCol]);
  });

  it('raises the ideal diameter with boost, in the physics as well as the advice', () => {
    const cfg = STOCK;
    const wotRow = 2, topCol = S.RPM.length - 1;
    const veAt = (dia, peakBoostPsi) => S.computeHardwareVE(cfg, S.DEFAULT_MODS, {
      turboOn: true, turbine: S.TURBINE_OPTS[1], exhaustDia: dia,
      fuel: S.OCTANE_OPTS[0], peakBoostPsi,
    })[wotRow][topCol];

    // 3.0" is close to ideal with no boost and far undersized at 20 psi, so the
    // top-end penalty must grow as boost rises.
    expect(S.idealExhaustDiameter(3.5, 20)).toBeGreaterThan(S.idealExhaustDiameter(3.5, 0));
    expect(veAt(3.0, 20)).toBeLessThan(veAt(3.0, 0));
  });

  it('still penalises both undersized and oversized pipe', () => {
    const cfg = STOCK;
    const wotRow = 2;
    const ve = (dia) => S.computeHardwareVE(cfg, S.DEFAULT_MODS, { ...NA_HW, exhaustDia: dia });
    const ideal = S.idealExhaustDiameter(S.deriveEngine(cfg).displacementL, 0);
    const topCol = S.RPM.length - 1;
    const lowCol = S.RPM.indexOf(1500);

    // Undersized chokes the top end.
    expect(ve(ideal - 1.0)[wotRow][topCol]).toBeLessThan(ve(ideal)[wotRow][topCol]);
    // Oversized costs low-RPM scavenging velocity.
    expect(ve(ideal + 1.5)[wotRow][lowCol]).toBeLessThan(ve(ideal)[wotRow][lowCol]);
  });
});

// ---------------------------------------------------------------------------
// #31 — stacking compression on top of boost
// ---------------------------------------------------------------------------
// WAS BROKEN: bearing wear was `avgBoost * WEAR_BEARING_PER_PSI`, so static
// compression cost nothing mechanically and appeared in no wear term at all. On a fuel
// with enough octane to absorb the knock-margin cost, raising compression under boost
// was therefore a pure gain: more power, identical wear, empty pull log. On 91 the same
// change taught the right lesson (less knock margin -> less timing -> less torque),
// which is what made the E85 case so misleading — the model looked like it was
// modelling the trade-off, and on the one fuel where the trade-off is mechanical rather
// than thermal, it was not.
describe('#31 compression under boost costs the bottom end, not just knock margin', () => {
  /** A dyno pull with a factory-quality calibration generated for the hardware. */
  function tunedPull(compression, octaneIdx) {
    const base = S.presetById('n54');
    const preset = {
      ...base,
      engine: { ...base.engine, compression },
      parts: { ...base.parts, octaneIdx },
    };
    const patch = S.applyPreset(preset);
    return S.simulateSweep({
      loadKpa: 100,
      ve: patch.ve, veTruth: patch.ve, timing: patch.timing, afr: patch.afr,
      turboOn: patch.turboOn, boostCurve: patch.boostCurve,
      octaneBonus: S.OCTANE_OPTS[octaneIdx].bonus,
      octaneLabel: S.OCTANE_OPTS[octaneIdx].label,
      fuel: S.OCTANE_OPTS[octaneIdx],
      injectorCc: S.INJECTOR_OPTS[patch.injIdx].cc,
      ecuInjectorCc: patch.ecuInjectorCc,
      injectorLabel: S.INJECTOR_OPTS[patch.injIdx].label,
      mods: patch.mods, mafScalar: patch.mafScalar, derived: S.deriveEngine(patch.engineConfig),
      // The N54 is twin-turbo: backpressure depends on total turbine flow area and the
      // air supply on total compressor flow, so the count has to come along for both or
      // this models a choked engine.
      turbine: S.presetTurbine(preset),
      compressor: S.presetCompressor(preset),
    });
  }

  const E85 = S.OCTANE_OPTS.findIndex((o) => o.label === 'E85');

  it('still hands the power gain over — the point is that it is no longer free', () => {
    const low = tunedPull(9.5, E85);
    const high = tunedPull(12.5, E85);
    expect(high.peakHp).toBeGreaterThan(low.peakHp);
    // And it really is knock-free on both, which is the condition that used to make
    // the compression decision cost nothing at all.
    expect(low.events.some((e) => e.type === 'knock')).toBe(false);
    expect(high.events.some((e) => e.type === 'knock')).toBe(false);
  });

  it('charges the same knock-free build more bearing life for more compression', () => {
    const low = tunedPull(9.5, E85);
    const high = tunedPull(12.5, E85);
    // Direction, not magnitude — which is the rule in this repo, and here it is also the
    // honest limit of what can be claimed. The gap is real but modest, because the
    // factory calibration this test generates RETARDS as compression rises (about 23
    // degrees average at 9.5:1 against 17 at 12.5:1), and retard pulls peak pressure
    // back down. A knock-limited tune is a partial defence against its own compression.
    //
    // The earlier version of this test demanded a 1.5x gap, which the empirical
    // peak-pressure estimate of the time produced because it had no way to let the tune
    // back off. The crank-angle cycle does, so the effect is smaller and better founded.
    expect(high.wear.bearing).toBeGreaterThan(low.wear.bearing);
    expect(high.peakHp).toBeGreaterThan(low.peakHp);
  });

  it('leaves the Tuning Score alone — the calibration is not what is wrong', () => {
    const r = tunedPull(12.5, E85);
    const tuning = S.computeTuningScore(r);
    for (const e of r.events) {
      expect(tuning.deductions.join(' '), `${e.type} should not deduct`).not.toContain(e.msg);
    }
    expect(tuning.score).toBe(100);
  });
});

describe('preset-readiness hardening', () => {
  it('freezes the shared default engine config so callers cannot corrupt it', () => {
    expect(Object.isFrozen(S.DEFAULT_ENGINE_CONFIG)).toBe(true);
    expect(Object.isFrozen(S.DEFAULT_MODS)).toBe(true);
  });

  it('rejects a boost curve that does not match the RPM axis', () => {
    const cfg = S.DEFAULT_ENGINE_CONFIG;
    const derived = S.deriveEngine(cfg);
    const run = (boostCurve) => S.simulateSweep({
      loadKpa: 100,
      ve: S.computeHardwareVE(cfg, S.DEFAULT_MODS, {}),
      timing: S.clone2D(S.DEFAULT_TIMING),
      afr: S.clone2D(S.DEFAULT_AFR),
      turboOn: true, boostCurve,
      octaneBonus: 0, octaneLabel: '91', fuel: S.OCTANE_OPTS[0],
      injectorCc: 550, ecuInjectorCc: 550, injectorLabel: '550cc',
      mods: S.DEFAULT_MODS, mafScalar: 1, derived,
      turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
    });
    // Seven entries for an eight-point axis is the exact bug that once shipped.
    expect(() => run([0, 0, 3, 6, 8, 8, 8])).toThrow(/boost curve/i);
    expect(() => run(S.RPM.map(() => 8))).not.toThrow();
  });
});

describe('twin turbos pass twice the air', () => {
  it('a 7 L V8 holds its boost to redline on two Large turbos where one runs out', () => {
    // Twins used to double only the turbine: the air side stayed one compressor, so a
    // pair choked where it should not. Each turbo carries its own compressor.
    const top = (count) => {
      const eng = makeEngine({
        build: {
          engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, configuration: 'V8', bore: 105, stroke: 100, compression: 9.0 },
          mods: { ...S.DEFAULT_MODS, intercooler: true, exhaust: true, headers: true },
          turboOn: true, boostCurve: [0, 2, 6, 10, 10, 10, 10, 10],
          turbineIdx: 2, compressorIdx: 2, turbineCount: count,
          injIdx: S.INJECTOR_OPTS.length - 1, ecuInjectorCc: S.INJECTOR_OPTS.at(-1).cc, octaneIdx: 3,
          fuelSystem: { regulator: 'return', basePressureKpa: 300, pumpIdx: S.PUMP_OPTS.length - 1 },
        },
      });
      return eng.pull(100).points.find((p) => p.rpm === 7000);
    };
    const single = top(1);
    const twin = top(2);
    expect(single.boostPsi).toBeLessThan(single.boostTarget - 2);
    expect(twin.boostPsi).toBeGreaterThan(twin.boostTarget - 0.5);
    expect(twin.hp).toBeGreaterThan(single.hp * 1.2);
  });
});
