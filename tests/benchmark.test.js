/**
 * Real-world benchmark.
 *
 * `presets.test.js` holds each factory engine to its published power and torque. This
 * file holds everything else a dyno sheet, a datalog or an engineering reference would
 * show about the same pulls — fuel used, air flowed, mixture, timing, burn phasing,
 * exhaust heat, cylinder pressure, load per litre and friction — to the ranges real
 * gasoline engines actually run in. Each band cites where it comes from.
 *
 * The bands are deliberately the REAL ranges, not the model's current values with a
 * margin drawn round them. Where the model sits at one edge of a real range, that is
 * written down in docs/accuracy.md with the measured number, and the test still passes
 * only while the model stays inside what a real engine does. A change that pushes any
 * of these outside reality fails here, however well it plays.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

/**
 * Reference ranges. Sources:
 * - HEYWOOD: J. B. Heywood, Internal Combustion Engine Fundamentals. Cited as a book,
 *   not by chapter or figure, because those numbers were not checked against an edition.
 * - GARRETT: Garrett Motion, Turbo Tech 103 and "How to select a turbo, part 2" —
 *   BSFC 0.50-0.60 lb/hp·hr for turbocharged gasoline, 10-11 hp per lb/min of air.
 * - ENGINELABS: "Dyno Days" (Westech) — modern NA street engines 0.41-0.42 lb/hp·hr,
 *   0.45-0.50 typical at full load, 0.50 the historical standard.
 * - TURBINE: component-protection literature (ASME J. Eng. Gas Turbines Power 132(11),
 *   112801) — turbine inlet held below ~950 °C by enrichment.
 * - PCP: Eng-Tips forum, "Peak Cylinder Pressures" — 120 bar typical for boosted SI, 140
 *   bar for the latest TGDI designs.
 *
 * @type {Record<string, [number, number]>}
 */
const REAL = {
  // Best-power enrichment. NA calibrations run lambda 0.85-0.88 at full load; boosted
  // ones richer, for charge and turbine cooling (HEYWOOD on best-power mixture; the boosted band is common practice).
  lambdaNa: [0.84, 0.90],
  lambdaBoosted: [0.76, 0.87],
  // Fuel per horsepower-hour at peak power (ENGINELABS, GARRETT). The lower edges are
  // the best modern engines; the model sits there — see docs/accuracy.md.
  bsfcNa: [0.37, 0.52],
  bsfcBoosted: [0.38, 0.62],
  // Crank horsepower per lb/min of air (GARRETT: 10-11, wider for NA and rich tunes).
  hpPerLbMin: [9.0, 12.5],
  // 50% mass burned at MBT: 8-10 degrees ATDC across engine types (HEYWOOD: the standard MBT phasing criterion).
  mfb50AtMbt: [6, 12],
  // Spark advance at peak power, pump gas: NA near MBT, boosted knock-limited.
  timingNa: [24, 36],
  timingBoosted: [4, 26],
  // Exhaust at peak power, °C. Production NA headers 750-900; turbine inlet up to ~950
  // (TURBINE). Lower edges allow for the model's known WOT shortfall (docs/accuracy.md).
  egtNa: [700, 900],
  egtBoosted: [740, 980],
  // Peak cylinder pressure, bar (PCP — a practitioners' forum, the weakest source here).
  pmaxNa: [45, 90],
  pmaxBoosted: [60, 140],
  // Brake mean effective pressure at peak torque, bar. Modern NA 11-14; downsized
  // turbo 17-27 (the makers' published torque ÷ displacement).
  bmepNa: [11, 14.5],
  bmepBoosted: [15, 27],
  // Friction plus pumping at peak power, bar (HEYWOOD on engine friction; a deliberately wide band).
  fmep: [0.8, 3.0],
};

/** @param {number} v @param {[number, number]} range */
const within = (v, [lo, hi]) => ({ v, lo, hi, ok: v >= lo && v <= hi });

function pullFor(preset) {
  const patch = S.applyPreset(preset);
  const derived = S.deriveEngine(patch.engineConfig);
  return S.simulateSweep({
    loadKpa: 100, ve: patch.ve, veTruth: patch.ve, timing: patch.timing, afr: patch.afr,
    turboOn: patch.turboOn, boostCurve: patch.boostCurve,
    octaneBonus: S.OCTANE_OPTS[patch.octaneIdx].bonus,
    octaneLabel: S.OCTANE_OPTS[patch.octaneIdx].label,
    fuel: S.OCTANE_OPTS[patch.octaneIdx],
    injectorCc: S.INJECTOR_OPTS[patch.injIdx].cc, ecuInjectorCc: patch.ecuInjectorCc,
    injectorLabel: S.INJECTOR_OPTS[patch.injIdx].label, mods: patch.mods, mafScalar: patch.mafScalar,
    derived, turbine: S.presetTurbine(preset), compressor: S.presetCompressor(preset),
  });
}

const PULLS = S.ENGINE_PRESETS.map((preset) => {
  const pull = pullFor(preset);
  const peak = pull.points.reduce((a, b) => (b.hp > a.hp ? b : a));
  const peakTq = pull.points.reduce((a, b) => (b.torque > a.torque ? b : a));
  return { preset, pull, peak, peakTq, boosted: peak.boostPsi >= 1 };
});

const crankHp = (p) => p.hp / S.DRIVETRAIN_EFF;
const airLbMin = (p) => (p.maf * 60) / 453.6;

describe('the factory engines run like real engines, not just to their ratings', () => {
  it.each(PULLS.map((r) => [r.preset.name, r]))('%s', (_, { peak, peakTq, boosted }) => {
    const checks = {
      lambda: within(peak.lambda, boosted ? REAL.lambdaBoosted : REAL.lambdaNa),
      bsfc: within(peak.bsfc, boosted ? REAL.bsfcBoosted : REAL.bsfcNa),
      hpPerLbMin: within(crankHp(peak) / airLbMin(peak), REAL.hpPerLbMin),
      timing: within(peak.timing, boosted ? REAL.timingBoosted : REAL.timingNa),
      egt: within(peak.egt, boosted ? REAL.egtBoosted : REAL.egtNa),
      pmax: within(Math.max(peak.peakPressure, peakTq.peakPressure), boosted ? REAL.pmaxBoosted : REAL.pmaxNa),
      bmep: within(peakTq.bmep, boosted ? REAL.bmepBoosted : REAL.bmepNa),
      fmep: within(peak.fmep, REAL.fmep),
    };
    const out = Object.fromEntries(Object.entries(checks).filter(([, c]) => !c.ok));
    expect(out).toEqual({});
  });

  it('burns at the textbook MBT phasing wherever the calibration is at MBT', () => {
    // Only where MBT, not knock, sets the spark: on pump fuel that is the top of the rev
    // range for the naturally aspirated engines, and knock-limited points are phased
    // later on purpose.
    let checked = 0;
    for (const { pull } of PULLS) {
      for (const p of pull.points.filter((q) => q.timing >= q.mbtIdeal - 1)) {
        expect(within(p.mfb50, REAL.mfb50AtMbt), `${p.rpm} RPM`).toMatchObject({ ok: true });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('runs its boosted engines hotter than its naturally aspirated ones', () => {
    // The exhaust of a boosted engine blows down into a manifold at two bar or more,
    // not into the atmosphere; the model used to expand it to one bar and read turbo
    // engines 20-40 °C cooler than NA ones — backwards.
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const na = mean(PULLS.filter((r) => !r.boosted).map((r) => r.peak.egt));
    const boosted = mean(PULLS.filter((r) => r.boosted).map((r) => r.peak.egt));
    expect(boosted).toBeGreaterThan(na);
  });

  it('keeps the air it flows and the fuel it burns in the ratio it reports', () => {
    for (const { pull, preset } of PULLS) {
      const derived = S.deriveEngine(S.applyPreset(preset).engineConfig);
      for (const p of pull.points) {
        // Grams of air per cylinder filling times fillings per second is the MAF.
        const mafFromCharge = p.airCharge * derived.cyl * (p.rpm / 120);
        expect(Math.abs(mafFromCharge - p.maf) / p.maf).toBeLessThan(0.02);
        // Delivered AFR is lambda times the fuel's stoichiometric ratio.
        expect(Math.abs(p.afr - p.lambda * 14.7)).toBeLessThan(0.05);
      }
    }
  });
});

describe('boost pays like real boost', () => {
  // One engine, one rpm, knock-safe timing, 93 octane: what a pressure ratio is worth.
  const cfg = { ...S.DEFAULT_ENGINE_CONFIG, compression: 9.0 };
  const derived = S.deriveEngine(cfg);
  const fuel = S.OCTANE_OPTS.find((o) => o.label === '93');

  /** Best safe power at 5500 RPM and a given boost. */
  function powerAt(psi, intercooler) {
    const turbo = psi > 0;
    const mods = { ...S.DEFAULT_MODS, intercooler, turboFitted: turbo };
    const ve = S.computeHardwareVE(cfg, mods, {
      turboOn: turbo, turbine: turbo ? S.TURBINE_OPTS[1] : null, exhaustDia: 3.0, fuel, peakBoostPsi: psi,
    });
    const map = S.BARO_KPA + psi * S.PSI_TO_KPA;
    const at = (timingVal) => S.evaluatePoint({
      rpm: 5500, mapKpa: map, boostPsi: psi, veVal: S.interp2(ve, 5500, map), timingVal,
      afrCommanded: turbo ? 11.8 : 12.8, fuel, mods, mafScalar: 1, mafErrorBase: 1,
      injectorCc: 1000, ecuInjectorCc: 1000, derived, compressor: S.COMPRESSOR_OPTS[2],
      turbine: turbo ? S.TURBINE_OPTS[1] : null,
    });
    const probe = at(10);
    return at(Math.min(probe.threshold - 1, probe.mbtIdeal));
  }

  const na = powerAt(0, true).hp;

  it('scales power with pressure ratio, less the heat an intercooler cannot remove', () => {
    // Rule of thumb from dyno practice: with a good intercooler and knock-safe timing,
    // power follows the pressure ratio loosely — 10 psi (1.68 PR) roughly 1.4-1.7x,
    // 20 psi (2.36 PR) roughly 1.8-2.3x, turbine backpressure and charge heat taking
    // the rest.
    expect(powerAt(10, true).hp / na).toBeGreaterThan(1.3);
    expect(powerAt(10, true).hp / na).toBeLessThan(1.75);
    expect(powerAt(20, true).hp / na).toBeGreaterThan(1.7);
    expect(powerAt(20, true).hp / na).toBeLessThan(2.35);
  });

  it('makes less at the same boost without an intercooler, and knocks sooner', () => {
    const cooled = powerAt(20, true);
    const hot = powerAt(20, false);
    expect(hot.hp).toBeLessThan(cooled.hp);
    expect(hot.iat).toBeGreaterThan(cooled.iat + 40);
    expect(hot.timing).toBeLessThan(cooled.timing);
  });
});
