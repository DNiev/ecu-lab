/**
 * Physics intent tests.
 *
 * The fingerprint test catches *that* something changed. These catch *what* — they
 * state, in readable form, the physical relationships the model is supposed to
 * honour. If one of these fails, a real modelling assumption has broken.
 *
 * Rule of thumb for adding to this file: assert on DIRECTION and RELATIONSHIP
 * ("more compression makes more torque"), not on exact magnitudes ("makes 237 hp").
 * Magnitudes belong to the fingerprint.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

const STOCK = S.DEFAULT_ENGINE_CONFIG;
const NO_MODS = { ...S.DEFAULT_MODS, turboFitted: false };

/** Evaluates one point on a stock V6 with sensible defaults, overridable per test. */
function point(overrides = {}) {
  const {
    cfg = STOCK, fuel = S.OCTANE_OPTS[0], mods = NO_MODS,
    injectorCc = 315, ecuInjectorCc = 315,
    rpm = 5500, mapKpa = S.BARO_KPA, veVal = 95, timingVal = 32, afrCommanded = 12.6,
    mafScalar = 1.0, mafErrorBase = 1.0, compressor = S.COMPRESSOR_OPTS[1],
  } = overrides;
  return S.evaluatePoint({
    rpm, mapKpa,
    boostPsi: Math.max(0, (mapKpa - S.BARO_KPA) / S.PSI_TO_KPA),
    veVal, timingVal, afrCommanded,
    octaneBonus: fuel.bonus, fuel, mods,
    mafScalar, mafErrorBase, injectorCc, ecuInjectorCc,
    derived: S.deriveEngine(cfg), compressor,
  });
}

describe('engine architecture', () => {
  it('computes displacement from bore, stroke and cylinder count', () => {
    // π/4 × 9.55² × 8.14 × 6 ≈ 3498 cc
    expect(S.deriveEngine(STOCK).displacementL).toBeCloseTo(3.5, 1);
  });

  it('makes a bigger bore displace more', () => {
    const small = S.deriveEngine({ ...STOCK, bore: 85 }).displacementL;
    const big = S.deriveEngine({ ...STOCK, bore: 100 }).displacementL;
    expect(big).toBeGreaterThan(small);
  });

  it('extracts more work from the same fuel at higher compression', () => {
    // This used to assert an `ottoIdeal × realisation` field on the derived engine.
    // Nothing computes efficiency that way any more — a smaller clearance volume means a
    // longer expansion, and the cycle integrates what follows — so assert the thing that
    // actually matters: more compression, more indicated work per unit of fuel burned.
    const efficiency = (compression) => {
      const p = point({ cfg: { ...STOCK, compression }, fuel: S.OCTANE_OPTS[2], timingVal: 20 });
      return p.imep / p.airCharge;
    };
    expect(efficiency(13.0)).toBeGreaterThan(efficiency(8.5));
  });

  it('classifies bore/stroke character', () => {
    expect(S.deriveEngine({ ...STOCK, bore: 100, stroke: 80 }).character).toMatch(/Oversquare/);
    expect(S.deriveEngine({ ...STOCK, bore: 80, stroke: 100 }).character).toMatch(/Undersquare/);
  });

  it('runs a hotter chamber with a cast iron head, and pays for it in knock margin', () => {
    const alu = S.deriveEngine({ ...STOCK, headMaterial: 'Aluminum' });
    const iron = S.deriveEngine({ ...STOCK, headMaterial: 'Cast Iron' });
    expect(iron.chamberOffsetK).toBeGreaterThan(alu.chamberOffsetK);
    // And it reaches knock the way it does in reality — through charge temperature,
    // not through a bonus subtracted after the fact.
    const boosted = {
      mapKpa: 190, boostPsi: 13, veVal: 100,
      mods: { ...NO_MODS, intercooler: true, turboFitted: true },
    };
    expect(point({ ...boosted, cfg: { ...STOCK, headMaterial: 'Cast Iron' } }).threshold)
      .toBeLessThan(point({ ...boosted, cfg: { ...STOCK, headMaterial: 'Aluminum' } }).threshold);
  });

  it('lowers valve float speed with a bigger cam, and raises it with stiffer springs', () => {
    const base = S.valveFloatRpm(50, 210);
    expect(S.valveFloatRpm(50, 280)).toBeLessThan(base);
    expect(S.valveFloatRpm(90, 210)).toBeGreaterThan(base);
  });

  it('gives a stock cam zero overlap and a big cam a lot', () => {
    expect(S.camOverlapDeg(210)).toBe(0);
    expect(S.camOverlapDeg(280)).toBeGreaterThan(30);
  });
});

describe('airflow', () => {
  it('moves the VE peak up the RPM range with a longer cam', () => {
    const hw = { turboOn: false, turbine: null, exhaustDia: 3.0, fuel: S.OCTANE_OPTS[0] };
    const mild = S.computeHardwareVE({ ...STOCK, camDuration: 200 }, S.DEFAULT_MODS, hw);
    const wild = S.computeHardwareVE({ ...STOCK, camDuration: 280, springRate: 95 }, S.DEFAULT_MODS, hw);
    const wotRow = 2;
    const lowCol = S.RPM.indexOf(2500);
    const highCol = S.RPM.indexOf(7500);
    // Bottom end given away, top end gained — the defining cam trade-off.
    expect(wild[wotRow][lowCol]).toBeLessThan(mild[wotRow][lowCol]);
    expect(wild[wotRow][highCol]).toBeGreaterThan(mild[wotRow][highCol]);
  });

  it('collapses cylinder filling above valve float', () => {
    const hw = { turboOn: false, turbine: null, exhaustDia: 3.0, fuel: S.OCTANE_OPTS[0] };
    const floaty = { ...STOCK, camDuration: 290, springRate: 20 };
    const ve = S.computeHardwareVE(floaty, S.DEFAULT_MODS, hw);
    const floatRpm = S.deriveEngine(floaty).floatRpm;
    expect(floatRpm).toBeLessThan(7500);
    const wotRow = 2;
    const belowCol = S.RPM.findIndex((r) => r > floatRpm) - 1;
    const topCol = S.RPM.length - 1;
    expect(ve[wotRow][topCol]).toBeLessThan(ve[wotRow][belowCol]);
  });

  it('adds airflow when bolt-ons are fitted', () => {
    const hw = { turboOn: false, turbine: null, exhaustDia: 3.0, fuel: S.OCTANE_OPTS[0] };
    const stock = S.computeHardwareVE(STOCK, S.DEFAULT_MODS, hw);
    const built = S.computeHardwareVE(STOCK, { intake: true, exhaust: true, headers: true, intercooler: false }, hw);
    const wotRow = 2, highCol = S.RPM.indexOf(6500);
    expect(built[wotRow][highCol]).toBeGreaterThan(stock[wotRow][highCol]);
  });

  it('keeps every VE cell inside physically sane bounds', () => {
    for (const cfg of [STOCK, { ...STOCK, compression: 13, camDuration: 300, springRate: 20 }]) {
      const ve = S.computeHardwareVE(cfg, { intake: true, exhaust: true, headers: true, intercooler: true }, {
        turboOn: true, turbine: S.TURBINE_OPTS[2], exhaustDia: 4.0, fuel: S.OCTANE_OPTS[3],
      });
      for (const row of ve) {
        for (const v of row) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(10);
          expect(v).toBeLessThanOrEqual(130);
        }
      }
    }
  });
});

describe('air charge and fuelling', () => {
  it('follows the ideal gas law — more manifold pressure means more air', () => {
    const low = point({ mapKpa: 50 }).airCharge;
    const high = point({ mapKpa: 100 }).airCharge;
    expect(high / low).toBeCloseTo(2, 1);
  });

  it('traps less air when the charge is hot', () => {
    const cool = point({ mapKpa: 200, mods: { ...NO_MODS, intercooler: true } });
    const hot = point({ mapKpa: 200, mods: { ...NO_MODS, intercooler: false } });
    expect(hot.iat).toBeGreaterThan(cool.iat);
    expect(hot.airCharge).toBeLessThan(cool.airCharge);
  });

  it('measures charge heat from the one ambient the whole model uses', () => {
    // The knock model charges for charge temperature "above ambient". Ambient has to
    // mean the same thing here as it does in `chargeTempK`, or a boosted engine is
    // graded against a datum the rest of the physics does not share — which is exactly
    // what a stray `25` in knock.js used to do against AMBIENT_K's 24.85 °C.
    expect(S.AMBIENT_C).toBe(S.AMBIENT_K - S.KELVIN_OFFSET);
    // Off boost the charge sits exactly at ambient, so the penalty is exactly nothing.
    expect(point({ mapKpa: S.BARO_KPA }).iat).toBe(Math.round(S.AMBIENT_C));
    // And a hotter charge costs knock margin, measured through the cycle: charge heat
    // now reaches knock by raising the temperature the end gas starts compression from,
    // not by subtracting a fitted number of degrees.
    const hot = point({ mapKpa: 190, boostPsi: 13, veVal: 100, mods: { ...NO_MODS, intercooler: false, turboFitted: true } });
    const cool = point({ mapKpa: 190, boostPsi: 13, veVal: 100, mods: { ...NO_MODS, intercooler: true, turboFitted: true } });
    expect(cool.iat).toBeLessThan(hot.iat);
    expect(cool.threshold).toBeGreaterThan(hot.threshold);
  });

  it('needs roughly 1.5x the fuel volume on E85 at the same lambda', () => {
    const gas = point({ fuel: S.OCTANE_OPTS[0] });
    const e85 = point({ fuel: S.OCTANE_OPTS[3] });
    // Same commanded AFR is the same relative richness only after dividing by stoich,
    // so compare pulse widths — the fuel system demand a tuner actually feels.
    const ratio = e85.pw / gas.pw;
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(1.7);
  });

  it('runs rich when bigger injectors are fitted without rescaling the ECU', () => {
    const matched = point({ injectorCc: 315, ecuInjectorCc: 315 });
    const mismatched = point({ injectorCc: 850, ecuInjectorCc: 315 });
    expect(mismatched.lambda).toBeLessThan(matched.lambda);
    expect(mismatched.injMismatch).toBe(true);
    expect(matched.injMismatch).toBe(false);
  });

  it('leans out on its own once the injectors run out of time', () => {
    // Small injectors, huge airflow, high RPM: physically cannot deliver the fuel.
    const p = point({ rpm: 7500, mapKpa: 200, veVal: 120, injectorCc: 315, ecuInjectorCc: 315 });
    expect(p.fuelLimited).toBe(true);
    expect(p.afr).toBeGreaterThan(p.afrCommanded);
  });

  it('reports duty cycle as pulse width against the time available per cycle', () => {
    const p = point({ rpm: 6000 });
    const cycleMs = 120000 / 6000;
    expect(p.duty).toBeCloseTo((p.pw / cycleMs) * 100, 0);
  });

  it('runs open loop near wide-open throttle and closed loop at cruise', () => {
    expect(point({ mapKpa: 100 }).openLoop).toBe(true);
    expect(point({ mapKpa: 40 }).openLoop).toBe(false);
  });
});

describe('knock', () => {
  it('retards timing once commanded advance passes the threshold', () => {
    const safe = point({ timingVal: 10 });
    const wild = point({ timingVal: 50 });
    expect(safe.knock).toBe(false);
    expect(safe.timing).toBe(safe.commandedTiming);
    expect(wild.knock).toBe(true);
    expect(wild.timing).toBeLessThan(wild.commandedTiming);
  });

  it('tolerates far more advance at cruise than at wide-open throttle', () => {
    expect(point({ mapKpa: 20 }).threshold).toBeGreaterThan(point({ mapKpa: 101.325 }).threshold);
  });

  it('buys margin with higher octane', () => {
    const low = point({ fuel: S.OCTANE_OPTS[0] }).threshold;
    const high = point({ fuel: S.OCTANE_OPTS[3] }).threshold;
    expect(high).toBeGreaterThan(low);
  });

  it('loses margin as compression rises', () => {
    const lowCr = point({ cfg: { ...STOCK, compression: 9.0 } }).threshold;
    const highCr = point({ cfg: { ...STOCK, compression: 12.5 } }).threshold;
    expect(highCr).toBeLessThan(lowCr);
  });

  // KNOCK MARGIN IS U-SHAPED IN LAMBDA, worst near best-torque mixture. That is where
  // cylinder pressure peaks, so it is where the end gas is worked hardest; enriching past
  // it buys margin through charge cooling, and going lean of it buys margin because there
  // is simply less fuel energy released.
  //
  // This assertion used to be monotonic — lean always worse than rich — which the old
  // single-zone model produced only because a fitted Gaussian ASSERTED peak flame
  // temperature just lean of stoichiometric. The two-zone model derives burned-gas
  // temperature instead and disagrees, as does published knock-limited-advance data.
  //
  // Lean under load IS dangerous. It is dangerous through TEMPERATURE and mixture, which
  // the test below this one covers, not through detonation.
  it('is worst near best-torque mixture, and eases either side of it', () => {
    const at = (afr) => point({ mapKpa: 101.325, afrCommanded: afr }).threshold;
    const worst = at(12.85);
    expect(at(12.0), 'enrichment must buy margin').toBeGreaterThan(worst);
    expect(at(15.5), 'lean of best torque releases less energy').toBeGreaterThan(worst);
  });

  it('does not punish a lean mixture at cruise', () => {
    // At deep vacuum a lean mixture is normal and must not be punished — this is why
    // factory cruise maps carry 40+ degrees of advance at 14.7:1.
    const richCruise = point({ mapKpa: 20, afrCommanded: 12.0 }).threshold;
    const leanCruise = point({ mapKpa: 20, afrCommanded: 15.5 }).threshold;
    expect(richCruise - leanCruise).toBeLessThan(1.0);
  });

  it('still calls lean-under-load dangerous — through heat, not detonation', () => {
    // The lesson the monotonic test above was protecting is real and must survive the
    // model change: a lean mixture at load is one of the fastest ways to hole a piston or
    // burn a valve. In this model that arrives as a mixture and temperature risk rather
    // than as a knock limit, and under boost it escalates to the valve.
    const leanWot = point({ mapKpa: 101.325, afrCommanded: 15.5 });
    expect(leanWot.leanRisk).toBe(true);
    const leanBoosted = point({
      mapKpa: 200, afrCommanded: 15.5, veVal: 95,
      mods: { ...NO_MODS, turboFitted: true, intercooler: true },
    });
    expect(leanBoosted.leanRisk).toBe(true);
    expect(leanBoosted.valveRisk).toBe(true);
    // And it costs power, which is the other half of why nobody runs it deliberately.
    expect(leanWot.hp).toBeLessThan(point({ mapKpa: 101.325, afrCommanded: 12.85 }).hp);
  });

  it('never retards more than a real ECU would accumulate', () => {
    const p = point({ timingVal: 50, mapKpa: 200, cfg: { ...STOCK, compression: 13 } });
    expect(p.knockPull).toBeLessThanOrEqual(S.COEFF.MAX_KNOCK_RETARD);
  });
});

describe('torque production', () => {
  it('makes peak torque at MBT and less either side', () => {
    const atMbt = point({ timingVal: point().mbtIdeal });
    const retarded = point({ timingVal: point().mbtIdeal - 12 });
    expect(retarded.torque).toBeLessThan(atMbt.torque);
  });

  it('makes more torque with more air', () => {
    expect(point({ veVal: 110 }).torque).toBeGreaterThan(point({ veVal: 70 }).torque);
  });

  it('subtracts friction and pumping from indicated work', () => {
    const p = point();
    expect(p.bmep).toBeLessThan(p.imep);
    expect(p.fmep).toBeGreaterThan(0);
  });

  it('pays a large pumping penalty at closed throttle', () => {
    expect(point({ mapKpa: 20 }).fmep).toBeGreaterThan(point({ mapKpa: 101.325 }).fmep);
  });

  it('produces negative brake torque when motored at closed throttle', () => {
    // Engine braking: the engine cannot make positive torque pumping against vacuum.
    expect(point({ mapKpa: 20, veVal: 30, rpm: 6000 }).torque).toBeLessThan(0);
  });

  it('makes more power from more displacement, all else equal', () => {
    const small = point({ cfg: { ...STOCK, bore: 85 } }).hp;
    const big = point({ cfg: { ...STOCK, bore: 100 } }).hp;
    expect(big).toBeGreaterThan(small);
  });
});

describe('peak cylinder pressure', () => {
  it('rises with static compression at identical manifold pressure', () => {
    const low = point({ cfg: { ...STOCK, compression: 9.0 } }).peakPressure;
    const high = point({ cfg: { ...STOCK, compression: 12.5 }, fuel: S.OCTANE_OPTS[2] }).peakPressure;
    expect(high).toBeGreaterThan(low);
  });

  it('rises with manifold pressure and with trapped charge separately', () => {
    // Held at a timing both points can actually run, on a fuel with margin — otherwise
    // the boosted point is knock-limited and the comparison measures spark retard
    // instead of manifold pressure.
    const at = (o) => point({ timingVal: 12, fuel: S.OCTANE_OPTS[2], ...o }).peakPressure;
    expect(at({ mapKpa: 190, boostPsi: 13, mods: { ...NO_MODS, intercooler: true, turboFitted: true } }))
      .toBeGreaterThan(at({}));
    expect(at({ veVal: 115 })).toBeGreaterThan(at({ veVal: 85 }));
  });

  it('falls when spark is retarded, and peaks later in the stroke', () => {
    const advanced = point({ timingVal: 24, fuel: S.OCTANE_OPTS[2] });
    const retarded = point({ timingVal: 10, fuel: S.OCTANE_OPTS[2] });
    expect(retarded.peakPressure).toBeLessThan(advanced.peakPressure);
    expect(retarded.peakPressureDeg).toBeGreaterThan(advanced.peakPressureDeg);
  });

  it('lands in the range real engines measure', () => {
    // Not a magnitude lock — a plausibility band. A naturally aspirated engine at
    // wide-open throttle peaks near 50-80 bar.
    const na = point().peakPressure;
    expect(na).toBeGreaterThan(40);
    expect(na).toBeLessThan(95);
  });

  it('reports itself in the datalog, with the overload flag', () => {
    const mild = point({ cfg: { ...STOCK, compression: 9.5 } });
    expect(mild.peakPressure).toBeGreaterThan(0);
    expect(mild.pressureRisk).toBe(false);
    const brutal = point({
      cfg: { ...STOCK, compression: 12.5 }, fuel: S.OCTANE_OPTS[3],
      mapKpa: S.BARO_KPA + 14 * S.PSI_TO_KPA, veVal: 110, timingVal: 20,
      mods: { ...NO_MODS, intercooler: true, turboFitted: true },
      // E85 at this airflow needs real injectors; the stock 315s would run out of pulse
      // width and lean the mixture out, which would make this a fuelling test instead.
      injectorCc: 850, ecuInjectorCc: 850,
    });
    expect(brutal.peakPressure).toBeGreaterThan(mild.peakPressure);
    expect(brutal.pressureRisk).toBe(true);
  });
});

describe('dyno sweep', () => {
  /** Runs a stock naturally-aspirated pull. */
  function stockPull(overrides = {}) {
    const cfg = overrides.cfg ?? STOCK;
    const derived = S.deriveEngine(cfg);
    const mods = overrides.mods ?? S.DEFAULT_MODS;
    const turboOn = overrides.turboOn ?? false;
    return S.simulateSweep({
      loadKpa: 100,
      ve: S.computeHardwareVE(cfg, mods, {
        turboOn, turbine: turboOn ? S.TURBINE_OPTS[1] : null, exhaustDia: 3.0, fuel: S.OCTANE_OPTS[0],
      }),
      timing: S.clone2D(S.DEFAULT_TIMING),
      afr: S.clone2D(S.DEFAULT_AFR),
      turboOn,
      boostCurve: overrides.boostCurve ?? [...S.DEFAULT_BOOST],
      octaneBonus: 0, octaneLabel: '91', fuel: S.OCTANE_OPTS[0],
      injectorCc: overrides.injectorCc ?? 315,
      ecuInjectorCc: overrides.ecuInjectorCc ?? 315,
      injectorLabel: '315cc', mods, mafScalar: 1.0, derived,
      turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
      ...overrides.sweep,
    });
  }

  it('produces a believable stock baseline with a clean log', () => {
    const r = stockPull();
    expect(r.peakHp).toBeGreaterThan(180);
    expect(r.peakHp).toBeLessThan(300);
    expect(r.peakTq).toBeGreaterThan(150);
    expect(r.events).toHaveLength(0);
  });

  it('sweeps the full RPM range at the declared resolution', () => {
    const r = stockPull();
    expect(r.points[0].rpm).toBe(S.SWEEP_START_RPM);
    expect(r.points[r.points.length - 1].rpm).toBe(S.SWEEP_END_RPM);
    expect(r.points).toHaveLength((S.SWEEP_END_RPM - S.SWEEP_START_RPM) / S.SWEEP_STEP_RPM + 1);
  });

  it('knocks when boost is added to a stock naturally-aspirated calibration', () => {
    const r = stockPull({ turboOn: true, boostCurve: [0, 2, 8, 12, 14, 14, 14, 14] });
    expect(r.events.some((e) => e.type === 'knock')).toBe(true);
  });

  it('flags an injector scaling mismatch', () => {
    const r = stockPull({ injectorCc: 850, ecuInjectorCc: 315 });
    expect(r.events.some((e) => e.type === 'injscale')).toBe(true);
  });

  it('flags valve float as a hardware limit', () => {
    const r = stockPull({ cfg: { ...STOCK, camDuration: 290, springRate: 20 } });
    expect(r.events.some((e) => e.type === 'float')).toBe(true);
  });

  it('gives every event a cause and a fix, not just a complaint', () => {
    const r = stockPull({
      cfg: { ...STOCK, camDuration: 290, springRate: 20, compression: 12.5 },
      turboOn: true, boostCurve: [0, 4, 12, 20, 24, 25, 25, 25],
      injectorCc: 850, ecuInjectorCc: 315,
    });
    expect(r.events.length).toBeGreaterThan(0);
    for (const e of r.events) {
      expect(e.msg, `event ${e.type} has no msg`).toBeTruthy();
      expect(e.cause, `event ${e.type} has no cause`).toBeTruthy();
      expect(e.fix, `event ${e.type} has no fix`).toBeTruthy();
      expect(typeof e.impact).toBe('number');
    }
  });

  it('accumulates wear only when something damaging happened', () => {
    expect(stockPull().wear.piston).toBe(0);
    const nasty = stockPull({ turboOn: true, boostCurve: [0, 4, 12, 20, 24, 25, 25, 25] });
    expect(nasty.wear.piston).toBeGreaterThan(0);
  });

  it('charges the bearings for compression, not only for boost', () => {
    const boostCurve = [0, 2, 8, 12, 14, 14, 14, 14];
    const low = stockPull({ cfg: { ...STOCK, compression: 9.0 }, turboOn: true, boostCurve });
    const high = stockPull({ cfg: { ...STOCK, compression: 12.5 }, turboOn: true, boostCurve });
    expect(high.wear.bearing).toBeGreaterThan(low.wear.bearing);
  });

  it('leaves a stock naturally aspirated pull essentially free of bearing wear', () => {
    // Below the pressure a stock bottom end carries indefinitely, nothing accumulates —
    // an engine driven hard once is not spending bearing life in any measurable way.
    expect(stockPull({ cfg: { ...STOCK, compression: 9.0 } }).wear.bearing).toBe(0);
  });

  it('raises the overload event only once the parts are actually over their limit', () => {
    // Both builds run E85 through big injectors with an intercooler, so KNOCK is held
    // roughly constant and compression-on-boost is the only variable. Without that the
    // comparison is meaningless: the "sane" build on 91 octane knocks so hard that knock
    // wear swamps the pressure wear this test is about.
    const common = {
      mods: { ...S.DEFAULT_MODS, intercooler: true },
      turboOn: true, injectorCc: 850, ecuInjectorCc: 850,
      sweep: { fuel: S.OCTANE_OPTS[3], octaneLabel: 'E85' },
    };
    const sane = stockPull({ ...common, boostCurve: [0, 2, 6, 8, 8, 8, 8, 8] });
    expect(sane.events.some((e) => e.type === 'pressure')).toBe(false);
    const overloaded = stockPull({
      ...common,
      cfg: { ...STOCK, compression: 12.5 },
      boostCurve: [0, 4, 12, 16, 18, 18, 18, 18],
    });
    expect(overloaded.events.some((e) => e.type === 'pressure')).toBe(true);
    expect(overloaded.wear.piston).toBeGreaterThan(sane.wear.piston);
  });
});

describe('scoring', () => {
  it('gives a clean pull full marks', () => {
    expect(S.computeTuningScore({ events: [] }).score).toBe(100);
  });

  it('deducts each event impact and never goes below zero', () => {
    expect(S.computeTuningScore({ events: [{ impact: 30, msg: 'a' }, { impact: 10, msg: 'b' }] }).score).toBe(60);
    expect(S.computeTuningScore({ events: Array(20).fill({ impact: 30, msg: 'x' }) }).score).toBe(0);
  });

  it('rewards output but scales it by cleanliness', () => {
    const clean = S.computePullScore({ peakHp: 300, peakTq: 300, tuningScore: 100, engineerScore: 100 });
    const dirty = S.computePullScore({ peakHp: 300, peakTq: 300, tuningScore: 20, engineerScore: 100 });
    expect(clean).toBeGreaterThan(dirty);
  });

  it('lets a big dirty pull out-score a small spotless one', () => {
    const big = S.computePullScore({ peakHp: 600, peakTq: 550, tuningScore: 60, engineerScore: 80 });
    const small = S.computePullScore({ peakHp: 180, peakTq: 170, tuningScore: 100, engineerScore: 100 });
    expect(big).toBeGreaterThan(small);
  });
});

describe('advisors never mutate the tables they inspect', () => {
  it('leaves VE, timing and AFR untouched', () => {
    const ve = S.computeHardwareVE(STOCK, S.DEFAULT_MODS, {
      turboOn: false, turbine: null, exhaustDia: 3.0, fuel: S.OCTANE_OPTS[0],
    });
    const timing = S.clone2D(S.DEFAULT_TIMING);
    const afr = S.clone2D(S.DEFAULT_AFR);
    const before = JSON.stringify({ ve, timing, afr });

    S.veRecommendations(ve, STOCK, S.DEFAULT_MODS, {
      turboOn: false, turbine: null, exhaustDia: 3.0, fuel: S.OCTANE_OPTS[0],
    });
    S.calibrationAdvice({
      ve, timing, afr, derived: S.deriveEngine(STOCK), octaneBonus: 0,
      fuel: S.OCTANE_OPTS[0], mods: S.DEFAULT_MODS, turboOn: false,
      boostCurve: [...S.DEFAULT_BOOST], compressor: S.COMPRESSOR_OPTS[1],
      turbine: S.TURBINE_OPTS[1], injectorCc: 315, ecuInjectorCc: 315,
      mafScalar: 1.0, mafErrorBase: 1.0,
    });

    expect(JSON.stringify({ ve, timing, afr })).toBe(before);
  });
});

describe('table axes stay consistent', () => {
  it('gives every calibration table the same shape as its axes', () => {
    for (const table of [S.DEFAULT_VE, S.DEFAULT_TIMING, S.DEFAULT_AFR]) {
      expect(table).toHaveLength(S.LOAD.length);
      for (const row of table) expect(row).toHaveLength(S.RPM.length);
    }
  });

  it('gives the boost curve one entry per RPM breakpoint', () => {
    // Guards the class of bug where a hand-written array literal drifts out of sync
    // with the RPM axis and puts `undefined` into the physics.
    expect(S.DEFAULT_BOOST).toHaveLength(S.RPM.length);
    expect(S.DEFAULT_BOOST.every((v) => typeof v === 'number')).toBe(true);
  });

  it('keeps the RPM and LOAD axes monotonic', () => {
    for (let i = 1; i < S.RPM.length; i++) expect(S.RPM[i]).toBeGreaterThan(S.RPM[i - 1]);
    for (let i = 1; i < S.LOAD.length; i++) expect(S.LOAD[i]).toBeLessThan(S.LOAD[i - 1]);
  });
});

describe('the engine cycle', () => {
  const cyc = (o = {}) => S.cycleInputsFor({
    rpm: 5500, mapKpa: S.BARO_KPA, empKpa: 110, intakeK: 320,
    airChargeG: 0.65, burnedFuelG: 0.05, lambda: 0.88,
    fuel: S.OCTANE_OPTS[0], derived: S.deriveEngine(STOCK), ...o,
  });

  it('computes an effective compression ratio below the static one', () => {
    // The piston does not start compressing until the intake valve shuts, so trapped
    // volume is larger than swept-plus-clearance and effective compression is lower.
    const c = cyc();
    expect(c.effectiveCr).toBeLessThan(STOCK.compression);
    expect(c.effectiveCr).toBeGreaterThan(STOCK.compression * 0.8);
  });

  it('shuts the intake valve later with a longer camshaft, dropping effective compression', () => {
    const mild = cyc({ derived: S.deriveEngine({ ...STOCK, camDuration: 200 }) });
    const wild = cyc({ derived: S.deriveEngine({ ...STOCK, camDuration: 280 }) });
    expect(S.ivcAfterBdcDeg(280)).toBeGreaterThan(S.ivcAfterBdcDeg(200));
    expect(wild.effectiveCr).toBeLessThan(mild.effectiveCr);
  });

  it('puts the pressure peak after TDC, and moves it with spark', () => {
    const early = S.runCycle({ ...cyc(), sparkBtdc: 30 });
    const late = S.runCycle({ ...cyc(), sparkBtdc: 12 });
    expect(early.peakPressureDeg).toBeGreaterThan(0);
    expect(early.peakPressureDeg).toBeLessThan(late.peakPressureDeg);
    expect(early.peakPressurePa).toBeGreaterThan(late.peakPressurePa);
  });

  it('produces best work near MBT and less either side — the whole point of a trace', () => {
    const work = (t) => S.runCycle({ ...cyc(), sparkBtdc: t }).imepGrossPa;
    const mbt = S.mbtFromBurn(cyc().burnDeg);
    expect(work(mbt)).toBeGreaterThan(work(mbt - 12));
    expect(work(mbt)).toBeGreaterThan(work(mbt + 12));
  });

  it('burns slower when the charge is diluted or the mixture is off best', () => {
    const base = S.burnDurationDeg({ rpm: 4000, lambda: 0.9, residualFrac: 0.05 });
    expect(S.burnDurationDeg({ rpm: 4000, lambda: 0.9, residualFrac: 0.25 })).toBeGreaterThan(base);
    expect(S.burnDurationDeg({ rpm: 4000, lambda: 1.3, residualFrac: 0.05 })).toBeGreaterThan(base);
    expect(S.burnDurationDeg({ rpm: 4000, lambda: 0.65, residualFrac: 0.05 })).toBeGreaterThan(base);
  });

  it('burns slower across a bigger bore', () => {
    const small = S.deriveEngine({ ...STOCK, bore: 80 }).boreFlameFactor;
    const big = S.deriveEngine({ ...STOCK, bore: 104 }).boreFlameFactor;
    expect(big).toBeGreaterThan(small);
    expect(cyc({ derived: S.deriveEngine({ ...STOCK, bore: 104 }) }).burnDeg)
      .toBeGreaterThan(cyc({ derived: S.deriveEngine({ ...STOCK, bore: 80 }) }).burnDeg);
  });

  it('finds a knock limit that falls as compression rises', () => {
    const low = S.knockLimitedSpark(cyc({ derived: S.deriveEngine({ ...STOCK, compression: 9.0 }) }));
    const high = S.knockLimitedSpark(cyc({ derived: S.deriveEngine({ ...STOCK, compression: 12.5 }) }));
    expect(high).toBeLessThan(low);
  });

  it('cools the end gas against the wall, and more so the slower it turns', () => {
    // The autoignition integral accumulates in MILLISECONDS, so a low-speed cycle gives
    // the end gas far more dwell under pressure. It also gives it far more time to shed
    // heat into a 450 K head. Modelling only the first half collapsed the knock limit at
    // low speed. Same charge, same spark, speed the only variable.
    const boosted = { mapKpa: 200, empKpa: 240, airChargeG: 1.25, burnedFuelG: 0.1 };
    const endGasAt = (rpm) => S.runCycle({ ...cyc({ rpm, ...boosted }), sparkBtdc: 10 }).peakEndGasK;
    // Slow turning still runs the hotter end gas — compression dominates — but the wall
    // term has to hold the gap down, or the low-speed limit falls off a cliff.
    const spread = endGasAt(1900) - endGasAt(6500);
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThan(120);
  });

  it('tracks a burned-gas temperature, and peaks it near stoichiometric', () => {
    // The two-zone balance derives flame temperature instead of asserting it. Peak lands
    // near stoichiometric, where there is exactly enough oxygen and no surplus of either
    // reactant left over to warm. Rich runs cooler because the extra fuel is mass to heat
    // without extra oxygen to burn it; lean runs cooler because there is less fuel.
    const flameAt = (lambda) => S.runCycle({
      ...cyc({
        lambda,
        burnedFuelG: Math.min(0.65 / 14.7, 0.65 / (14.7 * lambda)),
        fuelMassG: 0.65 / (14.7 * lambda),
      }),
      sparkBtdc: 28,
    }).peakBurnedK;
    const peak = flameAt(1.0);
    expect(peak).toBeGreaterThan(2200);
    expect(peak).toBeLessThan(S.COEFF.BURNED_GAS_MAX_K);
    expect(flameAt(0.78)).toBeLessThan(peak);
    expect(flameAt(1.15)).toBeLessThan(peak);
  });

  it('finds a knock limit that rises with octane', () => {
    const boosted = { mapKpa: 190, empKpa: 250, airChargeG: 1.2, burnedFuelG: 0.095 };
    const pump = S.knockLimitedSpark(cyc({ ...boosted, fuel: S.OCTANE_OPTS[0] }));
    const race = S.knockLimitedSpark(cyc({ ...boosted, fuel: S.OCTANE_OPTS[2] }));
    expect(race).toBeGreaterThan(pump);
  });

  it('reports the limit as the FIRST onset of knock, not a later one', () => {
    // The autoignition integral is not monotonic at extreme advance, so a naive search
    // can land past a knocking region. Everything at or below the reported limit must
    // actually be knock-free.
    const c = cyc({ mapKpa: 190, empKpa: 250, airChargeG: 1.2, burnedFuelG: 0.095 });
    const limit = S.knockLimitedSpark(c);
    for (let t = S.COEFF.KNOCK_SEARCH_MIN_BTDC; t <= limit; t += 2) {
      expect(S.runCycle({ ...c, sparkBtdc: t }).knockIntegral, `knocks at ${t} deg`).toBeLessThan(1);
    }
  });
});

describe('MBT timing', () => {
  it('is the timing that centres the burn just after TDC', () => {
    const burnDeg = 45;
    const mbt = S.mbtFromBurn(burnDeg);
    const c = {
      rpm: 4000, trappedPa: 100000, trappedK: 330, heatJ: 1400,
      clearanceM3: 6.3e-5, sweptM3: 5.8e-4, rodRatio: S.COEFF.ROD_RATIO,
      boreM: 0.0955, strokeM: 0.0814, trappedMassKg: 7.0e-4,
      ivcAbdc: 45, burnDeg, octaneNumber: 100, sparkBtdc: mbt,
    };
    // Within one integration step of the target — the trace is sampled every
    // CYCLE_STEP_DEG degrees, so it cannot land closer than that by construction.
    expect(Math.abs(S.runCycle(c).mfb50Deg - S.COEFF.MFB50_ATDC_DEG))
      .toBeLessThanOrEqual(S.COEFF.CYCLE_STEP_DEG);
  });

  it('needs more advance when the burn is slower', () => {
    expect(S.mbtFromBurn(60)).toBeGreaterThan(S.mbtFromBurn(40));
  });

  // The defect the light-load MBT work was written to fix: the old linear term spanned
  // only 6 degrees across the whole load range, so it put cruise MBT around 25 deg. Real
  // factory cruise maps carry 40-50, because a thin, heavily diluted charge burns slowly
  // and must be lit much earlier.
  //
  // That conclusion is unchanged by the crank-angle cycle — these tests assert exactly
  // what they always did — but the burn behind it is now integrated rather than
  // correlated, so MBT comes from the operating point rather than from (rpm, map).
  const mbtAt = (rpm, mapKpa) => point({ rpm, mapKpa, veVal: mapKpa < 60 ? 55 : 95 }).mbtIdeal;

  it('puts cruise MBT in the 40-50 deg band real calibrations use', () => {
    const cruise = mbtAt(2500, 20);
    expect(cruise).toBeGreaterThan(40);
    expect(cruise).toBeLessThanOrEqual(50);
  });

  it('spans far more than the old six degrees between cruise and wide-open throttle', () => {
    expect(mbtAt(2500, 20) - mbtAt(2500, S.BARO_KPA)).toBeGreaterThan(15);
  });

  it('never leaves the range a production calibration could use', () => {
    for (const rpm of [800, 2500, 5500, 7500]) {
      for (const map of [20, 40, 101.325, 150, 200]) {
        const mbt = mbtAt(rpm, map);
        expect(mbt).toBeGreaterThanOrEqual(S.COEFF.MBT_MIN_DEG);
        expect(mbt).toBeLessThanOrEqual(S.COEFF.MBT_MAX_DEG);
      }
    }
  });

  it('asks for more advance as the burn slows, whatever slowed it', () => {
    // The correlation could only respond to RPM and pressure. The integrated burn also
    // responds to dilution and mixture, which is what actually stretches a burn out.
    expect(S.mbtFromBurn(60)).toBeGreaterThan(S.mbtFromBurn(40));
  });
});

describe('engine configuration and friction', () => {
  const at = (configuration, over = {}) => S.deriveEngine({ ...STOCK, configuration, ...over });

  it('knows an inline six has six cylinders', () => {
    expect(S.CYL_COUNT.I6).toBe(6);
    expect(S.CONFIG_OPTS).toContain('I6');
  });

  it('charges an inline six for its seven main bearings against a V6 four', () => {
    // Architectural fact, not a preference: I6 = 7 mains, V6 = 4.
    expect(S.MAIN_BEARINGS.I6).toBe(7);
    expect(S.MAIN_BEARINGS.V6).toBe(4);
    expect(at('I6').bearingFmepPa).toBeGreaterThan(at('V6').bearingFmepPa);
  });

  it('leaves the V6 baseline at zero so existing builds do not move', () => {
    expect(at('V6').bearingFmepPa).toBe(0);
    expect(at('V6').balanceShaftFrac).toBe(0);
  });

  it('charges a large four for its balance shafts, and a six for none', () => {
    // A 2.0 L I4 carries balance shafts; the EA888.3 has two. An I6 is inherently
    // balanced and needs none.
    expect(S.hasBalanceShafts('I4', 2.0)).toBe(true);
    expect(S.hasBalanceShafts('I6', 3.0)).toBe(false);
    expect(S.hasBalanceShafts('V6', 3.5)).toBe(false);
    // A small four does not need them either.
    expect(S.hasBalanceShafts('I4', 1.2)).toBe(false);
  });

  it('makes an inline six cost slightly more friction than a V6 of equal size', () => {
    const i6 = at('I6');
    const v6 = at('V6');
    const arch = (d) => ({ bearingFmepPa: d.bearingFmepPa, balanceShaftFrac: d.balanceShaftFrac });
    expect(S.rubbingFmepPa(6000, 0, arch(i6))).toBeGreaterThan(S.rubbingFmepPa(6000, 0, arch(v6)));
  });

  it('keeps the friction penalty small enough to be a trade-off, not a verdict', () => {
    const i6 = at('I6');
    const arch = { bearingFmepPa: i6.bearingFmepPa, balanceShaftFrac: i6.balanceShaftFrac };
    const penalty = S.rubbingFmepPa(6000, 0, arch) / S.rubbingFmepPa(6000, 0) - 1;
    expect(penalty).toBeGreaterThan(0.02);
    expect(penalty).toBeLessThan(0.20);
  });

  it('defaults to no architecture penalty when none is supplied', () => {
    expect(S.rubbingFmepPa(6000, 0)).toBe(S.rubbingFmepPa(6000, 0, { bearingFmepPa: 0, balanceShaftFrac: 0 }));
  });
});

/**
 * THE HIGH-SPEED BREATHING LIMIT — issue #15.
 *
 * The app teaches that power "rises with RPM, then falls as the valves cannot flow fast
 * enough", and the model then contradicted it: nothing made VE fall at speed, so every
 * naturally aspirated engine climbed monotonically into its limiter and had no power peak
 * at all. Two presets carried a written exception saying exactly that.
 *
 * The missing term is the inlet Mach index — how close the charge is to choking on its
 * way past the valve. What makes it worth doing as physics rather than as a curve fit
 * against RPM is the dependence it brings for free: it keys on MEAN PISTON SPEED against
 * the speed of sound, so a long-stroke engine chokes at fewer revolutions, and a hotter
 * charge chokes later.
 */
describe('the inlet Mach index', () => {
  const STROKE = S.DEFAULT_ENGINE_CONFIG.stroke;
  const BORE = S.DEFAULT_ENGINE_CONFIG.bore;

  it('is mean piston speed against the speed of sound', () => {
    // 2 x stroke x rev/s, the standard definition.
    expect(S.meanPistonSpeedMs(81.4, 6000)).toBeCloseTo(2 * 0.0814 * 100, 6);
    // And the index is that, scaled by the bore-to-valve geometry.
    const z = S.inletMachIndex(BORE, 81.4, 6000);
    expect(z).toBeCloseTo(
      S.COEFF.MACH_BORE_VALVE_FACTOR * S.meanPistonSpeedMs(81.4, 6000) / S.SONIC_AMBIENT_MS, 6,
    );
  });

  it('costs nothing through the mid-range and bites at the top', () => {
    expect(S.machVeMultiplier(BORE, STROKE, 3000)).toBe(1);
    expect(S.machVeMultiplier(BORE, STROKE, 7500)).toBeLessThan(1);
    // Monotonic once it starts, so there is no speed at which revving harder helps.
    const at = (rpm) => S.machVeMultiplier(BORE, STROKE, rpm);
    expect(at(7500)).toBeLessThan(at(6500));
    expect(at(6500)).toBeLessThanOrEqual(at(5500));
  });

  it('chokes a long-stroke engine at fewer revolutions than a short-stroke one', () => {
    // The payoff for keying on piston speed rather than RPM: this is why an undersquare
    // engine cannot rev, and it now falls out of the model instead of being asserted.
    const longStroke = S.machVeMultiplier(BORE, 100, 6500);
    const shortStroke = S.machVeMultiplier(BORE, 70, 6500);
    expect(longStroke).toBeLessThan(shortStroke);
  });

  it('chokes later on a hot charge, because sound travels faster in it', () => {
    const cold = S.machVeMultiplier(BORE, STROKE, 7500, 298);
    const hot = S.machVeMultiplier(BORE, STROKE, 7500, 400);
    expect(hot).toBeGreaterThan(cold);
  });

  it('never starves the engine completely', () => {
    expect(S.machVeMultiplier(BORE, 120, 9000)).toBeGreaterThanOrEqual(S.COEFF.MACH_VE_FLOOR);
  });

  it('gives a naturally aspirated engine a power peak before its redline', () => {
    // The headline of the issue, asserted on the shipped engines rather than in the
    // abstract: both naturally aspirated presets used to climb into the limiter.
    for (const preset of S.ENGINE_PRESETS) {
      const p = S.applyPreset(preset);
      if (p.turboOn) continue;                       // a boost curve places these itself
      const derived = S.deriveEngine(p.engineConfig);
      const r = S.simulateSweep({
        loadKpa: 100, ve: p.ve, veTruth: p.ve, timing: p.timing, afr: p.afr,
        turboOn: false, boostCurve: p.boostCurve,
        octaneBonus: S.OCTANE_OPTS[p.octaneIdx].bonus, octaneLabel: 'x',
        fuel: S.OCTANE_OPTS[p.octaneIdx], injectorCc: S.INJECTOR_OPTS[p.injIdx].cc,
        ecuInjectorCc: p.ecuInjectorCc, injectorLabel: 'x', mods: p.mods, mafScalar: 1,
        derived, turbine: S.presetTurbine(preset),
        compressor: S.COMPRESSOR_OPTS[p.compressorIdx],
      });
      const peakHp = Math.max(...r.points.map((x) => x.hp));
      const peakRpm = Math.max(...r.points.filter((x) => x.hp === peakHp).map((x) => x.rpm));
      const atRedline = r.points[r.points.length - 1].hp;
      expect(peakRpm, `${preset.id} still peaks at its limiter`).toBeLessThan(derived.redline);
      expect(atRedline, `${preset.id} does not fall away after its peak`).toBeLessThan(peakHp);
    }
  });
});

describe('per-engine redline', () => {
  const sweepTo = (redline) => {
    const cfg = { ...STOCK, redline };
    const derived = S.deriveEngine(cfg);
    return S.simulateSweep({
      loadKpa: 100,
      ve: S.computeHardwareVE(cfg, S.DEFAULT_MODS, {}),
      timing: S.clone2D(S.DEFAULT_TIMING), afr: S.clone2D(S.DEFAULT_AFR),
      turboOn: false, boostCurve: S.RPM.map(() => 0),
      octaneBonus: 0, octaneLabel: '91', fuel: S.OCTANE_OPTS[0],
      injectorCc: 550, ecuInjectorCc: 550, injectorLabel: '550cc',
      mods: S.DEFAULT_MODS, mafScalar: 1, derived,
      turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
    });
  };

  it('defaults to 7500 so existing builds are unaffected', () => {
    expect(S.deriveEngine(STOCK).redline).toBe(7500);
    expect(sweepTo(undefined).points.at(-1).rpm).toBe(7500);
  });

  it('ends the pull at the engine redline', () => {
    const r = sweepTo(6500);
    expect(r.points.at(-1).rpm).toBe(6500);
    expect(r.points.every((p) => p.rpm <= 6500)).toBe(true);
  });

  it("reports valve float against the engine's own redline, not a fixed 7500", () => {
    // springRate: 53 (not 25 — a 25 rate here drops floatRpm to ~5380, well below 6500,
    // which would defeat the point of this test) puts float just above 7000.
    const cfg = { ...STOCK, redline: 6500, camDuration: 290, springRate: 53 };
    const derived = S.deriveEngine(cfg);
    // Float sits near 7000 here — above a 6500 redline, so it must NOT be reported.
    expect(derived.floatRpm).toBeGreaterThan(6500);
    const r = S.simulateSweep({
      loadKpa: 100, ve: S.computeHardwareVE(cfg, S.DEFAULT_MODS, {}),
      timing: S.clone2D(S.DEFAULT_TIMING), afr: S.clone2D(S.DEFAULT_AFR),
      turboOn: false, boostCurve: S.RPM.map(() => 0),
      octaneBonus: 0, octaneLabel: '91', fuel: S.OCTANE_OPTS[0],
      injectorCc: 550, ecuInjectorCc: 550, injectorLabel: '550cc',
      mods: S.DEFAULT_MODS, mafScalar: 1, derived,
      turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
    });
    expect(r.events.some((e) => e.type === 'float')).toBe(false);
  });
});

describe('hardware option catalogues', () => {
  const SIZES = ['small', 'medium', 'large'];

  // The Engineer Score branches on `size`, never on `label` — labels are display copy
  // and must stay free to reword. A newly added option that forgot `size` would drop
  // silently out of the sizing checks, so assert the field is always there.
  it.each([['TURBINE_OPTS'], ['COMPRESSOR_OPTS']])('gives every %s entry a valid size', (name) => {
    for (const opt of S[name]) {
      expect(SIZES, `${name} entry "${opt.label}" has size ${String(opt.size)}`).toContain(opt.size);
    }
  });
});

describe('the spark advisor', () => {
  /** Advice for a stock, naturally aspirated build on its own factory tables. */
  function advice(overrides = {}) {
    return S.calibrationAdvice({
      ve: S.DEFAULT_VE, veTruth: S.DEFAULT_VE, timing: S.DEFAULT_TIMING, afr: S.DEFAULT_AFR,
      derived: S.deriveEngine(STOCK), octaneBonus: S.OCTANE_OPTS[0].bonus,
      fuel: S.OCTANE_OPTS[0], mods: NO_MODS, turboOn: false, boostCurve: S.DEFAULT_BOOST,
      compressor: S.COMPRESSOR_OPTS[1], turbine: S.TURBINE_OPTS[1],
      injectorCc: 315, ecuInjectorCc: 315, mafScalar: 1, mafErrorBase: 1,
      ...overrides,
    });
  }

  // The defect from issue #4: at 20 kPa the knock limit runs past 160 deg, and the
  // advisor was handing that straight to the player as a spark recommendation.
  it('never recommends more advance than the charge can actually use', () => {
    for (const c of advice().spark) {
      expect(c.suggested).toBeLessThanOrEqual(c.mbt + 0.5);
    }
  });

  it('never recommends more advance than a production table could hold', () => {
    for (const c of advice().spark) {
      expect(c.suggested).toBeLessThanOrEqual(50);
      expect(c.suggested).toBeGreaterThanOrEqual(5);
    }
  });

  it('still respects the knock limit where knock is what binds', () => {
    // Under boost the knock limit falls below MBT, and it must be the one that wins.
    const boosted = advice({ turboOn: true, boostCurve: S.RPM.map(() => 12) });
    const knockBound = boosted.spark.filter((c) => c.knockLimited);
    expect(knockBound.length).toBeGreaterThan(0);
    // `suggested` is rounded to the nearest half degree, so a cell whose knock ceiling
    // lands within that rounding of MBT can tie rather than fall below it.
    for (const c of knockBound) expect(c.suggested).toBeLessThanOrEqual(c.mbt);
  });

  it('does not call a stock calibration dangerous', () => {
    // The red panel means "your hardware will not tolerate this". A factory tune on
    // factory hardware must never trip it.
    expect(advice().overAdvanced).toHaveLength(0);
  });

  it('separates advance that is dangerous from advance that is merely wasted', () => {
    const a = advice();
    // A cell past the knock limit is reported as dangerous only, never as both.
    const ids = (arr) => new Set(arr.map((c) => `${c.ri}:${c.ci}`));
    const over = ids(a.overAdvanced), past = ids(a.pastMbt);
    for (const id of over) expect(past.has(id)).toBe(false);
    // And every cell the advisor says has too much advance lands in exactly one of
    // them, so nothing over a ceiling can go unreported.
    const tooMuch = a.spark.filter((c) => c.delta < -1.0);
    expect(over.size + past.size).toBe(tooMuch.length);
  });

  it('reports the stock light-load cells as past peak torque, not as knock risk', () => {
    // The stock table runs 40-47 deg at 20 kPa where MBT is in the low 40s, so a few
    // of those cells genuinely are past MBT — but the knock limit there is over 100,
    // so none of them are dangerous.
    //
    // Assert on `knocking`, which comes from the physics, NOT on how pastMbt was
    // built. An earlier version of this test asserted the classification flag against
    // itself and so could never fail, which hid a real inversion.
    const a = advice();
    expect(a.pastMbt.length).toBeGreaterThan(0);
    for (const c of a.pastMbt) expect(c.knocking).toBe(false);
  });

  // The inversion the tautology hid: a cell can sit past BOTH ceilings with MBT the
  // lower of the two. Classifying on which ceiling is lower filed those as merely
  // wasteful and told the player they were safe, while the dyno logged knock on the
  // very same build. Danger is where the player's own number sits.
  it('never calls a detonating cell safe', () => {
    const boosted = advice({ turboOn: true, boostCurve: S.RPM.map(() => 5) });
    const knocking = boosted.spark.filter((c) => c.knocking);
    expect(knocking.length).toBeGreaterThan(0);
    expect(boosted.overAdvanced.length).toBeGreaterThan(0);
    const pastIds = new Set(boosted.pastMbt.map((c) => `${c.ri}:${c.ci}`));
    for (const c of knocking) expect(pastIds.has(`${c.ri}:${c.ci}`)).toBe(false);
  });

  /** The advice the app itself would show for a preset, wired exactly as EcuLab wires it. */
  function factoryAdvice(preset) {
    const p = S.applyPreset(preset);
    return S.calibrationAdvice({
      ve: p.ve, veTruth: p.ve, timing: p.timing, afr: p.afr,
      derived: S.deriveEngine(p.engineConfig), fuel: S.OCTANE_OPTS[p.octaneIdx],
      mods: p.mods, turboOn: p.turboOn, boostCurve: p.boostCurve,
      compressor: S.COMPRESSOR_OPTS[p.compressorIdx],
      turbine: S.presetTurbine(preset),
      injectorCc: S.INJECTOR_OPTS[p.injIdx].cc, ecuInjectorCc: p.ecuInjectorCc,
      mafScalar: 1, mafErrorBase: S.mafErrorFactor(p.mods, p.turboOn),
    });
  }

  // The single most important property this advisor has: it must not contradict a
  // calibration the app itself generated. `factoryCalibration` and `calibrationAdvice`
  // are two consumers of one physics model, and if they disagree the player is told the
  // shipped engine is mistuned before they have touched anything.
  //
  // All three categories are asserted, because all three broke separately:
  //   pastMbt        needed both sides to take MBT at the row's own pressure
  //   overAdvanced   needed the knock half to use the row pressure too, instead of the
  //                  manifold pressure the induction solve produced — on the Golf R that
  //                  meant judging the 100 kPa row at 200 kPa
  //   wrongMix       needed mixture judged on what was DELIVERED, since a factory fuel
  //                  table is written pre-corrected for its own MAF error
  it('never contradicts the factory calibration the app generated', () => {
    for (const preset of S.ENGINE_PRESETS) {
      const a = factoryAdvice(preset);
      expect(a.spark.length, `${preset.id} advised on no cells at all`).toBeGreaterThan(0);
      expect(a.pastMbt, `${preset.id}: own spark table called wasteful`).toHaveLength(0);
      expect(a.overAdvanced, `${preset.id}: own spark table called dangerous`).toHaveLength(0);
      expect(a.wrongMix, `${preset.id}: own fuel table called off-target`).toHaveLength(0);
    }
  });

  it('does not judge cells the engine cannot reach at that engine speed', () => {
    // A turbo build never sees 200 kPa at 800 RPM. Those cells sit at the spark table's
    // 5 degree floor and their knock ceiling at idle speed is near zero, so judging them
    // reported the factory table as detonating at an impossible operating point.
    const golfR = S.ENGINE_PRESETS.find((p) => p.id === 'ea888-r');
    const p = S.applyPreset(golfR);
    const idleAtFullBoost = factoryAdvice(golfR).spark
      .filter((c) => c.rpm === 800 && c.map > S.BARO_KPA + Math.min(...p.boostCurve) * S.PSI_TO_KPA);
    expect(idleAtFullBoost).toHaveLength(0);
  });

  it('still catches a fuel table that is genuinely off, and by the right amount', () => {
    // The delivered-not-commanded fix must not have made the mixture check blind. A
    // table leaned by a known offset has to come back asking for exactly that offset.
    const preset = S.ENGINE_PRESETS.find((p) => p.id === 'vq35hr');
    const p = S.applyPreset(preset);
    const a = S.calibrationAdvice({
      ve: p.ve, veTruth: p.ve, timing: p.timing,
      afr: p.afr.map((row) => row.map((v) => v + 1.5)),
      derived: S.deriveEngine(p.engineConfig), fuel: S.OCTANE_OPTS[p.octaneIdx],
      mods: p.mods, turboOn: p.turboOn, boostCurve: p.boostCurve,
      compressor: S.COMPRESSOR_OPTS[p.compressorIdx], turbine: S.presetTurbine(preset),
      injectorCc: S.INJECTOR_OPTS[p.injIdx].cc, ecuInjectorCc: p.ecuInjectorCc,
      mafScalar: 1, mafErrorBase: S.mafErrorFactor(p.mods, p.turboOn),
    });
    expect(a.wrongMix.length).toBeGreaterThan(0);
    for (const c of a.wrongMix) expect(c.delta).toBeCloseTo(-1.5, 1);
  });

  it('is self-consistent — taking its own advice leaves nothing left to complain about', () => {
    // The advisor exists to be acted on. If applying every suggestion still produced
    // complaints, the advice would be chasing its own tail and no player could ever
    // reach a clean table.
    const before = advice();
    const tuned = S.DEFAULT_TIMING.map((row) => [...row]);
    for (const c of before.spark) tuned[c.ri][c.ci] = c.suggested;
    const after = advice({ timing: tuned });
    expect(after.overAdvanced).toHaveLength(0);
    expect(after.pastMbt).toHaveLength(0);
    expect(after.underAdvanced).toHaveLength(0);
  });
});

describe('exhaust gas temperature', () => {
  it('rises with load but saturates, instead of climbing without limit', () => {
    const at = (chargeIndex) => S.exhaustTempK({ chargeIndex, lambda: 1 });
    // Steep early: a throttled engine to a full charge is hundreds of degrees.
    const earlyRise = at(1.0) - at(0.25);
    // Nearly flat late: past a full charge, extra air also brings extra expansion work.
    const lateRise = at(2.0) - at(1.25);
    expect(earlyRise).toBeGreaterThan(200);
    expect(lateRise).toBeLessThan(earlyRise / 4);
  });

  it('runs hotter with retard and cooler with a rich mixture', () => {
    const base = S.exhaustTempK({ chargeIndex: 1.2, lambda: 1 });
    expect(S.exhaustTempK({ chargeIndex: 1.2, lambda: 1, knockRetardDeg: 8 }))
      .toBeGreaterThan(base);
    expect(S.exhaustTempK({ chargeIndex: 1.2, lambda: 0.82 })).toBeLessThan(base);
  });

  it('does not cook a turbine on a factory calibration', () => {
    // Every shipped preset must sit under the limit on its own factory tune, for the
    // same reason the spark advisor must not call a stock table dangerous: an app that
    // cries wolf on the engine as sold has taught the player nothing.
    for (const preset of S.ENGINE_PRESETS) {
      const p = S.applyPreset(preset);
      const r = S.simulateSweep({
        loadKpa: 100, ve: p.ve, veTruth: p.ve, timing: p.timing, afr: p.afr,
        turboOn: p.turboOn, boostCurve: p.boostCurve, fuel: S.OCTANE_OPTS[p.octaneIdx],
        injectorCc: S.INJECTOR_OPTS[p.injIdx].cc, ecuInjectorCc: p.ecuInjectorCc,
        mods: p.mods, mafScalar: 1, derived: S.deriveEngine(p.engineConfig),
        turbine: S.presetTurbine(preset), compressor: S.COMPRESSOR_OPTS[p.compressorIdx],
      });
      for (const pt of r.points) {
        expect(pt.egtRisk, `${preset.name} at ${pt.rpm} RPM reads ${pt.egt} C`).toBe(false);
      }
    }
  });

  it('is read off the cycle, not from the correlation', () => {
    // The datalog's EGT is the burned zone at exhaust valve open, blown down to the
    // manifold. `exhaustTempK` survives only for the turbine balance, which has to run
    // BEFORE the cycle it feeds. If these two ever agree exactly, someone has quietly
    // wired the gauge back to the correlation.
    const p = point({ rpm: 5500, mapKpa: S.BARO_KPA });
    expect(p.egt).toBeGreaterThan(600);
    expect(p.egt).toBeLessThan(S.COEFF.EGT_LIMIT_C);
  });

  it('runs hotter with retarded spark, because the burn finishes later', () => {
    // Retard shows up in EGT for the real reason now: less of the heat release is
    // converted to work before the valve opens, so more of it leaves through the port.
    const advanced = point({ rpm: 5500, timingVal: 30 }).egt;
    const retarded = point({ rpm: 5500, timingVal: 10 }).egt;
    expect(retarded).toBeGreaterThan(advanced);
  });
});

describe('the spark table bounds', () => {
  it('are one definition, not three that can drift apart', () => {
    // The UI grid, `factoryCalibration` and the advisor all have to agree on what a
    // spark cell can hold. They did not: the grid allowed -5 while the other two floored
    // at 5, so the generator wrote timing the engine could not take in the low-speed
    // high-load corner. Everything reads SPARK_MIN_DEG / SPARK_MAX_DEG now.
    expect(S.SPARK_MIN_DEG).toBeLessThan(0);
    for (const preset of S.ENGINE_PRESETS) {
      for (const row of S.applyPreset(preset).timing) {
        for (const cell of row) {
          expect(cell).toBeGreaterThanOrEqual(S.SPARK_MIN_DEG);
          expect(cell).toBeLessThanOrEqual(S.SPARK_MAX_DEG);
        }
      }
    }
  });

  it('let a high-boost engine retard as far as the physics asks at low speed', () => {
    // A boosted engine at 11:1 and 16 psi genuinely cannot take much advance at 1900 RPM
    // — that is the most knock-limited corner any turbo car operates in, and why torque
    // is tapered below ~1800. The generator must be able to write that, rather than
    // being clamped above it and shipping a table that detonates.
    const b58 = S.ENGINE_PRESETS.find((p) => p.id === 'b58-m1');
    const timing = S.applyPreset(b58).timing;
    const lowSpeedHighLoad = timing[0][S.RPM.indexOf(1500)];
    expect(lowSpeedHighLoad).toBeLessThan(5);
  });
});

describe('residual gas', () => {
  it('traps less exhaust as compression rises, because the clearance volume shrinks', () => {
    const at = (compression) => S.residualFraction({
      mapKpa: 60, empKpa: 105, overlapDeg: 20, compression,
    });
    expect(at(12.5)).toBeLessThan(at(9.0));
  });

  it('carries that through to a faster burn and less required advance', () => {
    // The point of modelling the clearance volume rather than asserting a flat floor:
    // a high-compression engine re-breathes less, so its charge is less diluted, so the
    // flame crosses it faster and MBT comes in.
    const cycFor = (compression) => S.cycleInputsFor({
      rpm: 2500, mapKpa: 50, empKpa: 104, intakeK: 300,
      airChargeG: 0.3, burnedFuelG: 0.02, lambda: 1.0,
      fuel: S.OCTANE_OPTS[0], derived: S.deriveEngine({ ...STOCK, compression }),
    });
    expect(cycFor(12.5).residualFrac).toBeLessThan(cycFor(9.0).residualFrac);
    expect(cycFor(12.5).burnDeg).toBeLessThan(cycFor(9.0).burnDeg);
    expect(S.mbtFromBurn(cycFor(12.5).burnDeg))
      .toBeLessThan(S.mbtFromBurn(cycFor(9.0).burnDeg));
  });
});

describe('BSFC reporting', () => {
  it('reports a real figure whenever the engine is making power', () => {
    const p = point({ rpm: 5500, mapKpa: S.BARO_KPA });
    expect(p.hp).toBeGreaterThan(0);
    expect(p.bsfc).toBeGreaterThan(0);
  });

  // BSFC prices what leaves the TANK. Past stoichiometric the extra fuel finds no oxygen
  // and goes out of the exhaust unburnt, and the driver still bought it — so a richer
  // mixture must cost more per unit of work, even where it makes more power. Counting
  // only the fuel that burned hid that entirely, on the one gauge meant to show it.
  it('charges for fuel delivered, not just fuel burned', () => {
    const stoich = point({ rpm: 5500, afrCommanded: 14.7 });
    const rich = point({ rpm: 5500, afrCommanded: 11.0 });
    expect(rich.lambda).toBeLessThan(0.8);
    expect(rich.bsfc).toBeGreaterThan(stoich.bsfc);
  });

  // A BSFC of 0.000 lb/hr/hp would be an engine making power from no fuel. On overrun
  // and at deep vacuum the engine is being motored, and there is no such thing as a
  // brake-specific figure there — the honest answer is "no reading", not zero.
  it('reports no reading at all when the engine is not making power', () => {
    const motoring = point({ rpm: 2500, mapKpa: 20, veVal: 42, timingVal: 40, afrCommanded: 14.7 });
    expect(motoring.hp).toBeLessThanOrEqual(0);
    expect(motoring.bsfc).toBeNull();
  });
});
