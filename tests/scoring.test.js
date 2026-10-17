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

  it('judges too small by airflow, so a twin setup passes where one of the pair would not', () => {
    // A 7 L V8 at 10 psi and 7500 RPM needs about 0.60 kg/s; one Medium compressor
    // chokes at 0.32 and one Large at 0.50. Two Larges pass 1.0.
    const v8 = { displacementL: 6.9 };
    const one = build({ ...v8, turbine: S.TURBINE_OPTS[2], compressor: LARGE_COMPRESSOR });
    const two = build({
      ...v8,
      turbine: S.turbineWithCount(S.TURBINE_OPTS[2], 2),
      compressor: S.compressorWithCount(LARGE_COMPRESSOR, 2),
    });
    expect(one.deductions.join(' ')).toMatch(/Turbo too small/);
    expect(two.deductions.join(' ')).not.toMatch(/Turbo too small/);
    expect(build({ ...v8, compressor: S.COMPRESSOR_OPTS[1] }).deductions.join(' ')).toMatch(/Turbo too small/);
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
  /**
   * Looked up by label, never by position. The old positional destructure
   * (`const [P91, P93, , E85] = ...`) stepped over index 2 with a hole, so inserting a
   * fuel into OCTANE_OPTS silently rebound `E85` to its neighbour and every test here
   * kept passing while grading the wrong fuel. This is the same hazard the exhaust
   * diameter note in tests/fingerprint.js warns about — pin the physical quantity, not
   * its index — and it throws rather than yielding `undefined` so a renamed fuel fails
   * loudly instead of as a confusing property access later.
   */
  const fuelByLabel = (label) => {
    const fuel = S.OCTANE_OPTS.find((o) => o.label === label);
    if (!fuel) throw new Error(`no fuel labelled "${label}" in OCTANE_OPTS`);
    return fuel;
  };
  const P91 = fuelByLabel('91');
  const P93 = fuelByLabel('93');
  const P100 = fuelByLabel('100');
  const E85 = fuelByLabel('E85');
  const NO_COOLER = { ...S.DEFAULT_MODS, intercooler: false };
  const COOLED = { ...S.DEFAULT_MODS, intercooler: true };

  /**
   * A boosted build that is coherent in every respect EXCEPT the one under test, so the
   * only deduction that can appear is the compression one. Aluminium head throughout,
   * because a high-compression build on a cast iron head trips the separate heat-load
   * rule and would muddy every assertion below.
   */
  const build = (over = {}) => S.computeEngineerScore({
    engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression: 9.5, headMaterial: 'Aluminum', injection: 'direct' },
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
    engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression, headMaterial: 'Aluminum', injection: 'direct' }, ...over,
  });
  const hit = (r) => r.deductions.find((d) => /static compression/.test(d));
  /** Safe because `build()` is otherwise clean — nothing else deducts. */
  const cost = (r) => 100 - r.score;

  // The regression this whole change exists for. A B58 or a Toyota/BMW 2.0 T is
  // 11.0:1 from the factory, and the old rule called that a 15-point mistake.
  it('leaves a factory-shaped DI turbo build unpenalised', () => {
    expect(hit(at(11.0, { fuel: P93, mods: COOLED }))).toBeUndefined();
  });

  // The same compression on a PORT-injected engine has not earned it: its fuel boils off
  // the intake valve rather than cooling the charge, which is why factory port-injected
  // turbo engines (EJ257, 2JZ-GTE, SR20DET) sit at 8.2-8.5:1.
  it('charges the same 11.0:1 on port injection, and names direct injection as the fix', () => {
    const port = build({
      engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression: 11.0, headMaterial: 'Aluminum', injection: 'port' },
      fuel: P93, mods: COOLED,
    });
    expect(hit(port)).toMatch(/direct injection/);
    expect(hit(at(10.0, { fuel: P93, mods: COOLED }))).toBeUndefined();
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

  // Issue #27. This used to assert the asymmetry: a turbo build at 10.9:1 on 91 was
  // charged a point while an NA build at 13.0:1 on the same fuel was charged nothing,
  // even though the cycle pulls ~9 degrees out of that engine at 2000 RPM. Both ends of
  // the slider are judged now.
  it('judges static compression on a naturally-aspirated build too', () => {
    expect(hit(at(13.0, { turboOn: false, peakBoostPsi: 0 }))).toBeDefined();
  });

  it('leaves a normal naturally-aspirated compression ratio alone', () => {
    expect(hit(at(11.0, { turboOn: false, peakBoostPsi: 0 }))).toBeUndefined();
  });

  // The NA ceiling sits above the boosted one: there is no boost pressure stacked on
  // top of the static ratio, so the same build tolerates more without a turbo.
  it('allows more static compression without boost than with it', () => {
    expect(cost(at(12.5, { turboOn: false, peakBoostPsi: 0 })))
      .toBeLessThan(cost(at(12.5, { turboOn: true, peakBoostPsi: 10 })));
  });

  // A port-injected NA engine stops at about 11-11.5:1 on 91; direct injection's charge
  // cooling earns it about a point more.
  it('credits direct injection on the naturally-aspirated side', () => {
    const na = (injection) => build({
      engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression: 12.0, headMaterial: 'Aluminum', injection },
      turboOn: false, peakBoostPsi: 0,
    });
    expect(hit(na('port'))).toMatch(/direct injection/);
    expect(hit(na('direct'))).toBeUndefined();
  });

  // Octane and injection are the levers an NA engine has here — no intercooler, no boost.
  it('credits octane on the naturally-aspirated side', () => {
    expect(cost(at(13.0, { turboOn: false, peakBoostPsi: 0, fuel: P93 })))
      .toBeLessThan(cost(at(13.0, { turboOn: false, peakBoostPsi: 0 })));
  });

  it('still calls out compression that is too LOW for a naturally-aspirated build', () => {
    const r = at(8.5, { turboOn: false, peakBoostPsi: 0 });
    expect(r.deductions.find((d) => /Low compression/.test(d))).toBeDefined();
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

  // Issue #28: 100 octane sat between 93 and E85 in OCTANE_OPTS and was exercised by
  // neither layer — the destructure above skipped it and the fingerprint matrix ran
  // only [0, 3]. Its bonus of 8 is not a scaled copy of any other entry, so nothing
  // else constrained the two headroom values it produces.
  it('gives 100 octane its own headroom, clean at it and deducted one step past it', () => {
    expect(hit(at(11.6, { fuel: P100, mods: NO_COOLER }))).toBeUndefined();
    expect(hit(at(11.7, { fuel: P100, mods: NO_COOLER }))).toBeDefined();
    expect(hit(at(12.0, { fuel: P100, mods: COOLED }))).toBeUndefined();
    expect(hit(at(12.1, { fuel: P100, mods: COOLED }))).toBeDefined();
  });

  // Written as a sweep over OCTANE_OPTS rather than four hand-named fuels, so that a
  // fuel added to the catalogue is graded by this test the day it lands instead of
  // slipping through the gap #28 documents.
  it('orders every fuel on the headroom ladder by its octane bonus', () => {
    const onset = (fuel) => {
      for (let tenths = 85; tenths <= 130; tenths += 1) {
        if (hit(at(tenths / 10, { fuel, mods: NO_COOLER }))) return tenths / 10;
      }
      return Infinity;
    };
    const ladder = [...S.OCTANE_OPTS].sort((a, b) => a.bonus - b.bonus);
    const onsets = ladder.map(onset);
    expect(onsets.every(Number.isFinite), `a fuel never trips the rule: ${onsets}`).toBe(true);
    for (let i = 1; i < onsets.length; i += 1) {
      expect(
        onsets[i],
        `${ladder[i].label} (bonus ${ladder[i].bonus}) must buy at least as much `
        + `headroom as ${ladder[i - 1].label} (bonus ${ladder[i - 1].bonus})`,
      ).toBeGreaterThan(onsets[i - 1]);
    }
  });

  // The cap is reachable on 91 and not on 100 with charge cooling: it would take 13.5:1
  // and the slider stops at 13.0. Worth pinning in both directions, because a rule that
  // silently saturated for every fuel would lose the gradient the `scales the deduction`
  // test above exists to protect.
  it('leaves the penalty cap out of reach on 100 octane with an intercooler', () => {
    expect(hit(at(13.0, { fuel: P100, mods: COOLED }))).toBeDefined();
    expect(cost(at(13.0, { fuel: P100, mods: COOLED }))).toBeLessThan(15);
    expect(cost(at(13.0, { fuel: P91, mods: COOLED }))).toBe(15);
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
    engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, compression, headMaterial: 'Aluminum', injection: 'direct' },
    turboOn: true, peakBoostPsi: psi,
    // A Large compressor passes this 3.5 L's air at every boost here, so the turbo-sizing
    // rule stays out of a block that is about compression.
    turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[2],
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
        turbine: S.presetTurbine(preset), compressor: S.presetCompressor(preset),
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

  it('does not offer less boost to a build the boost term is not charging', () => {
    // The term is one-sided, so at or under the reference turning the boost down buys
    // back exactly nothing. Offering it there is the same fault as telling an E85 build
    // to find higher octane: a lever that moves and changes no number.
    const under = at(10, 13.0).deductions.find((x) => /static compression/.test(x));
    expect(under).toBeDefined();
    expect(under).not.toMatch(/less boost/);
    expect(under).toMatch(/less static compression/);
    // And it IS offered once the build is past the reference and being charged for it.
    expect(at(25, 13.0).deductions.find((x) => /static compression/.test(x)))
      .toMatch(/less boost than 25 psi/);
  });
});
