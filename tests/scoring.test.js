/**
 * Scoring intent tests.
 *
 * The Tuning Score grades the CALIBRATION. Hardware trade-offs belong to the
 * Engineer Score and to the advisory list — never to this number, because the
 * player cannot edit a camshaft from the TUNE tab.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

const ev = (type, impact, msg = `${type} event`) => ({ type, impact, severity: 2, msg });

describe('computeTuningScore', () => {
  it('scores a clean pull at 100', () => {
    expect(S.computeTuningScore({ events: [] }).score).toBe(100);
  });

  it('deducts for calibration faults', () => {
    const r = S.computeTuningScore({ events: [ev('knock', 20)] });
    expect(r.score).toBe(80);
    expect(r.deductions).toHaveLength(1);
  });

  it('does NOT deduct for hardware trade-offs the player cannot tune away', () => {
    // A big cam, valve float and bottom-end stress are all hardware consequences.
    // The cam event's own `fix` text says "you cannot calibrate it away".
    const events = [ev('cam', 14), ev('float', 34), ev('bearing', 9)];
    const r = S.computeTuningScore({ events });
    expect(r.score).toBe(100);
    expect(r.deductions).toHaveLength(0);
  });

  it('still surfaces hardware trade-offs as advisories rather than hiding them', () => {
    const r = S.computeTuningScore({ events: [ev('cam', 14, 'Large camshaft')] });
    expect(r.advisories).toEqual(['Large camshaft']);
  });

  it('separates the two classes within one pull', () => {
    const r = S.computeTuningScore({ events: [ev('knock', 20), ev('float', 34)] });
    expect(r.score).toBe(80);
    expect(r.deductions).toHaveLength(1);
    expect(r.advisories).toHaveLength(1);
  });

  it('treats an unknown event type as a calibration fault, so new faults are never silently free', () => {
    expect(S.computeTuningScore({ events: [ev('brand_new_fault', 10)] }).score).toBe(90);
  });
});

describe('computeEngineerScore turbo sizing', () => {
  const [SMALL_TURBINE, , LARGE_TURBINE] = S.TURBINE_OPTS;
  const [SMALL_COMPRESSOR, , LARGE_COMPRESSOR] = S.COMPRESSOR_OPTS;

  /** A deliberately coherent boosted build, so any deduction seen is the one under test. */
  const build = (over = {}) => S.computeEngineerScore({
    engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression: 9.5, headMaterial: 'Aluminum' },
    turboOn: true,
    peakBoostPsi: 10,
    turbine: S.TURBINE_OPTS[1],
    compressor: S.COMPRESSOR_OPTS[1],
    exhaustDiaError: 0,
    dutyPreview: 50,
    displacementL: 3.5,
    // 9.5:1 sits well under the base headroom (10.8) on any fuel, so 91 octane and no
    // intercooler keep this block's builds "otherwise clean" without engaging the rule
    // this block is not testing.
    fuel: S.OCTANE_OPTS[0],
    mods: S.DEFAULT_MODS,
    ...over,
  });

  it('leaves a coherently matched build unpenalised', () => {
    expect(build().score).toBe(100);
    expect(build().deductions).toHaveLength(0);
  });

  it('penalises a turbo sized large for a small displacement', () => {
    expect(build({ displacementL: 2.0, turbine: LARGE_TURBINE }).score).toBe(92);
    expect(build({ displacementL: 2.0, compressor: LARGE_COMPRESSOR }).score).toBe(92);
  });

  it('penalises a turbo sized small for a big displacement', () => {
    expect(build({ displacementL: 5.0, turbine: SMALL_TURBINE }).score).toBe(92);
    expect(build({ displacementL: 5.0, compressor: SMALL_COMPRESSOR }).score).toBe(92);
  });

  it('says nothing about turbo sizing on a naturally aspirated build', () => {
    const na = build({ turboOn: false, displacementL: 2.0, turbine: LARGE_TURBINE });
    expect(na.deductions.join(' ')).not.toMatch(/Turbo sized/);
  });

  // The regression this exists to prevent: labels are display copy. Before the options
  // carried a `size`, renaming the compressor 'Large' to 'Large — high flow' silently
  // switched the mismatch deduction off and no test noticed.
  it('keeps sizing deductions when the display labels are reworded', () => {
    const bigOnSmall = build({
      displacementL: 2.0,
      turbine: { ...LARGE_TURBINE, label: 'XL — screamer' },
      compressor: { ...LARGE_COMPRESSOR, label: 'Large — high flow' },
    });
    expect(bigOnSmall.score).toBe(92);

    const smallOnBig = build({
      displacementL: 5.0,
      turbine: { ...SMALL_TURBINE, label: 'Tiny — instant' },
      compressor: { ...SMALL_COMPRESSOR, label: 'Compact — fast spool' },
    });
    expect(smallOnBig.score).toBe(92);
  });
});

describe('computeEngineerScore static compression under boost', () => {
  const [P91, P93, , E85] = S.OCTANE_OPTS;
  const NO_COOLER = { ...S.DEFAULT_MODS, intercooler: false };
  const COOLED = { ...S.DEFAULT_MODS, intercooler: true };

  /**
   * A boosted build that is coherent in every respect EXCEPT the one under test, so the
   * only deduction that can appear is the compression one. Aluminium head throughout,
   * because a high-compression build on a cast iron head trips the separate heat-load
   * rule and would muddy every assertion below.
   */
  const build = (over = {}) => S.computeEngineerScore({
    engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression: 9.5, headMaterial: 'Aluminum' },
    turboOn: true,
    peakBoostPsi: 10,
    turbine: S.TURBINE_OPTS[1],
    compressor: S.COMPRESSOR_OPTS[1],
    exhaustDiaError: 0,
    dutyPreview: 50,
    displacementL: 3.5,
    fuel: P91,
    mods: NO_COOLER,
    ...over,
  });

  const at = (compression, over = {}) => build({
    engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression, headMaterial: 'Aluminum' }, ...over,
  });
  const hit = (r) => r.deductions.find((d) => /static compression/.test(d));
  /** Safe because `build()` is otherwise clean — nothing else deducts. */
  const cost = (r) => 100 - r.score;

  // The regression this whole change exists for. A B58 or a Toyota/BMW 2.0 T is
  // 11.0:1 from the factory, and the old rule called that a 15-point mistake.
  it('leaves a factory-shaped DI turbo build unpenalised', () => {
    expect(hit(at(11.0, { fuel: P93, mods: COOLED }))).toBeUndefined();
  });

  // Guards the shipped presets specifically, from the preset data itself rather than
  // from hand-copied numbers, so a preset edit cannot quietly walk back into the rule.
  it('keeps the N54 preset clear of the compression deduction', () => {
    const n54 = S.presetById('n54');
    const r = build({
      engineConfig: n54.engine,
      fuel: S.OCTANE_OPTS[n54.parts.octaneIdx],
      mods: n54.mods,
    });
    expect(hit(r)).toBeUndefined();
  });

  it('lets fuel octane buy compression headroom', () => {
    expect(hit(at(11.5, { fuel: P91 }))).toBeDefined();
    expect(hit(at(11.5, { fuel: E85 }))).toBeUndefined();
  });

  it('lets charge cooling buy compression headroom', () => {
    expect(hit(at(11.3, { fuel: P93, mods: NO_COOLER }))).toBeDefined();
    expect(hit(at(11.3, { fuel: P93, mods: COOLED }))).toBeUndefined();
  });

  // The property the old cliff lacked entirely: 10.51:1 and 13.0:1 were charged the same.
  it('scales the deduction with how far over the build sits', () => {
    expect(cost(at(12.0))).toBeGreaterThan(cost(at(11.5)));
    expect(cost(at(11.5))).toBeGreaterThan(cost(at(11.0)));
  });

  it('never deducts more than the flat penalty it replaced, even at the slider maximum', () => {
    expect(cost(at(13.0))).toBeLessThanOrEqual(15);
  });

  it('says nothing about static compression on a naturally-aspirated build', () => {
    expect(hit(at(13.0, { turboOn: false }))).toBeUndefined();
  });

  // `chargeTempK` does nothing at zero boost, and a turbo kit with the boost curve
  // zeroed out (the UI's "ZERO" button) makes none — so there is no boosted cylinder
  // pressure for compression to fight and no charge cooling to credit, and this rule
  // has nothing to judge. That is narrower than "runs like an N/A engine": the
  // naturally-aspirated low-compression rule is still skipped, and the heat-load and
  // turbo-sizing rules still apply to a zeroed-boost turbo build.
  it('takes no compression deduction on a turbocharged build making zero peak boost', () => {
    expect(hit(at(13.0, { peakBoostPsi: 0 }))).toBeUndefined();
  });

  // Pins the outer boundary, not the `d > 0` guard: `10.8 + 0.3 + 0.4` evaluates to
  // 11.500000000000002 in floating point, so this build computes `over` as a tiny
  // negative number and is rejected by `over > 0` before the guard is ever reached.
  // This would fail if the intercooler credit were removed or a constant moved enough
  // to push `over` positive.
  it('keeps a build exactly at the 93-plus-intercooler boundary clear of the deduction', () => {
    expect(hit(at(11.5, { fuel: P93, mods: COOLED }))).toBeUndefined();
  });
});

/**
 * Issue #25: the compression rule gated on WHETHER there was boost but ignored HOW MUCH.
 * Boost level is the single largest determinant of whether high static compression
 * survives, and the rule was responding only to octane and charge cooling — the second
 * and third most important variables. A 5 psi build and a 25 psi build scored identically.
 */
describe('computeEngineerScore compression headroom vs boost level', () => {
  const cooled = { ...S.DEFAULT_MODS, intercooler: true };

  const at = (psi, compression, fuel = S.OCTANE_OPTS[3]) => S.computeEngineerScore({
    engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression, headMaterial: 'Aluminum' },
    turboOn: true, peakBoostPsi: psi,
    turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
    exhaustDiaError: 0, dutyPreview: 80, displacementL: 3.5, fuel, mods: cooled,
  });

  it('charges more for the same compression as boost rises past the reference', () => {
    const low = at(5, 13.0).score;
    const mid = at(18, 13.0).score;
    const high = at(25, 13.0).score;
    expect(mid).toBeLessThan(low);
    expect(high).toBeLessThan(mid);
  });

  it('never makes a below-reference build more permissive than it was', () => {
    // The term is one-sided on purpose. Everything at or under the factory band is judged
    // exactly as before, so this change can only ever tighten a verdict, never loosen one.
    for (const psi of [1, 5, 10, 14]) {
      expect(at(psi, 13.0).score).toBe(at(14, 13.0).score);
    }
  });

  it('is the issue\'s own example: 13.0:1 on E85 no longer grades the same at 5 and 25 psi', () => {
    const penalty = (psi) => at(psi, 13.0).deductions
      .find((d) => /static compression/.test(d));
    // Both are charged — 13.0:1 is a lot even on E85 — but the 25 psi build is charged
    // far more, where before the two were graded identically.
    expect(at(5, 13.0).score).toBeGreaterThan(at(25, 13.0).score);
    expect(penalty(5)).toBeDefined();
    expect(penalty(25)).toBeDefined();
  });

  it('leaves every shipped factory engine unpenalised', () => {
    // The constraint that fixes the coefficient. These are real engines sold with these
    // compression ratios at these boost levels, so the rule must not call any of them
    // incoherent — the tightest is the B58 at 11.0:1 and 17 psi.
    for (const preset of S.ENGINE_PRESETS) {
      const p = S.applyPreset(preset);
      if (!p.turboOn) continue;
      const r = S.computeEngineerScore({
        engineConfig: p.engineConfig, turboOn: true,
        peakBoostPsi: Math.max(...p.boostCurve),
        turbine: S.presetTurbine(preset), compressor: S.COMPRESSOR_OPTS[p.compressorIdx],
        exhaustDiaError: 0, dutyPreview: 80,
        displacementL: S.deriveEngine(p.engineConfig).displacementL,
        fuel: S.OCTANE_OPTS[p.octaneIdx], mods: p.mods,
      });
      expect(
        r.deductions.filter((d) => /static compression/.test(d)),
        `${preset.id} was penalised for its factory compression`,
      ).toHaveLength(0);
    }
  });

  it('only suggests levers the build has not already pulled', () => {
    // On E85 with an intercooler there is no more octane and no more charge cooling to
    // buy, so saying otherwise is advice nobody can act on.
    const d = at(25, 13.0).deductions.find((x) => /static compression/.test(x));
    expect(d).not.toMatch(/higher octane/);
    expect(d).not.toMatch(/charge cooling/);
    expect(d).toMatch(/less boost/);
  });

  it('still offers octane when the build is on pump fuel', () => {
    const d = at(25, 13.0, S.OCTANE_OPTS[0]).deductions.find((x) => /static compression/.test(x));
    expect(d).toMatch(/higher octane/);
  });
});
