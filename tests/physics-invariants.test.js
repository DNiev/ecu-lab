/**
 * Rules the physics may never break, checked across thousands of random builds.
 *
 * The rest of the suite checks the behaviour someone thought to check, on the engines
 * someone thought to build. These are laws — energy, mass, units, and the direction
 * every lever pulls in — asserted on seeded random builds and operating points across
 * the whole range the BUILD and TUNE screens allow. A failure prints its seed; `seed`
 * in `randomBuild(seed)` rebuilds that exact engine.
 *
 * Tolerances are the reporting precision of the fields involved (hp and torque are
 * whole numbers, lambda three decimals), never a fudge.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine } from './ecuHarness.js';
import { randomBuild, rng } from './randomBuilds.js';

const POINTS = 1500;
const BUILDS = 120;

/**
 * A random operating point on a random build, with everything evaluatePoint needs.
 * Timing sits on the safe side of both ceilings unless a test asks otherwise.
 * @param {number} seed
 */
function randomPoint(seed) {
  const build = randomBuild(seed);
  const eng = makeEngine({ build });
  const r = rng(seed * 7919 + 1);
  const peakBoost = build.turboOn ? Math.max(...build.boostCurve) : 0;
  const rpm = Math.round(1200 + r() * (build.engineConfig.redline - 1200));
  const mapKpa = Math.round(35 + r() * (S.BARO_KPA - 35 + peakBoost * S.PSI_TO_KPA));
  const boostPsi = Math.max(0, (mapKpa - S.BARO_KPA) / S.PSI_TO_KPA);
  const injectorCc = S.INJECTOR_OPTS[build.injIdx].cc;
  const base = {
    rpm, mapKpa, boostPsi,
    veVal: S.interp2(eng.veTruth, rpm, mapKpa),
    afrCommanded: boostPsi > 1 ? 11.8 : 12.9,
    fuel: eng.fuel, mods: { ...build.mods, turboFitted: build.turboOn }, mafScalar: 1, mafErrorBase: 1,
    injectorCc, ecuInjectorCc: injectorCc, derived: eng.derived, compressor: eng.compressor,
    turbine: build.turboOn ? eng.turbine : null,
  };
  const at = (patch = {}) => S.evaluatePoint({ ...base, timingVal: 10, ...patch });
  const probe = at();
  // Safe: under the knock limit by a degree and no further than MBT.
  const safe = Math.max(-5, Math.min(probe.threshold - 1, probe.mbtIdeal));
  return { seed, build, eng, base, at, probe, safe };
}

const SEEDS = Array.from({ length: POINTS }, (_, i) => i + 1);

/** Runs a property over every seed and reports every seed it fails on. */
function forAll(property) {
  const failures = [];
  for (const seed of SEEDS) {
    const msg = property(randomPoint(seed));
    if (msg) failures.push(`seed ${seed}: ${msg}`);
    if (failures.length >= 5) break;
  }
  return failures;
}

describe('energy: nothing makes power from nowhere', () => {
  it('never turns more of the fuel into work than an ideal engine could', () => {
    expect(forAll(({ at, safe, eng }) => {
      const p = at({ timingVal: safe });
      if (!(p.imep > 0)) return null;
      const fuelGs = p.maf / (p.lambda * eng.fuel.stoich);
      const fuelW = fuelGs / 1000 * eng.fuel.lhv;
      const vdM3 = eng.derived.displacementL / 1000;
      const indicatedW = p.imep * 1e5 * vdM3 * (p.rpm / 120);
      const brakeW = (p.hp / S.DRIVETRAIN_EFF) * 745.7;
      // Air-standard Otto (gamma 1.4) is the ceiling no real cycle reaches.
      const otto = 1 - Math.pow(eng.derived.compression, -0.4);
      if (indicatedW / fuelW >= otto) return `indicated efficiency ${(indicatedW / fuelW).toFixed(3)} ≥ Otto ${otto.toFixed(3)}`;
      if (brakeW / fuelW >= 0.45) return `brake efficiency ${(brakeW / fuelW).toFixed(3)} ≥ 0.45`;
      // Brake CAN exceed gross indicated work — boost above backpressure pushes the piston
      // down on the intake stroke — but rubbing friction can never give work back.
      if (p.fmep - p.pmep < -0.01) return `negative rubbing friction ${(p.fmep - p.pmep).toFixed(2)} bar`;
      return null;
    })).toEqual([]);
  });
});

describe('units balance', () => {
  it('reports horsepower, torque, airflow, mixture and mean pressures that agree', () => {
    expect(forAll(({ at, safe, eng }) => {
      const p = at({ timingVal: safe });
      if (Math.abs(p.hp - (p.torque * p.rpm) / 5252) > 1 + p.hp * 0.005) return `hp ${p.hp} vs tq×rpm/5252 ${(p.torque * p.rpm / 5252).toFixed(1)}`;
      const maf = p.airCharge * eng.derived.cyl * (p.rpm / 120);
      if (Math.abs(maf - p.maf) > 0.02 * p.maf + 0.1) return `maf ${p.maf} vs charge×cyl×rpm/120 ${maf.toFixed(1)}`;
      if (Math.abs(p.afr - p.lambda * 14.7) > 0.03) return `afr ${p.afr} vs λ×14.7 ${(p.lambda * 14.7).toFixed(2)}`;
      if (Math.abs(p.bmep - (p.imep - p.fmep)) > 0.02) return `bmep ${p.bmep} ≠ imep ${p.imep} − fmep ${p.fmep}`;
      const tqFromBmep = (p.bmep * 1e5 * (eng.derived.displacementL / 1000)) / (4 * Math.PI) * 0.7376 * S.DRIVETRAIN_EFF;
      if (Math.abs(tqFromBmep - p.torque) > 1) return `torque ${p.torque} vs bmep ${tqFromBmep.toFixed(1)}`;
      const cycleMs = 120000 / p.rpm;
      if (p.duty > 0 && Math.abs(p.duty - (p.pw / cycleMs) * 100) > 1) return `duty ${p.duty} vs pw/cycle ${(p.pw / cycleMs * 100).toFixed(1)}`;
      return null;
    })).toEqual([]);
  });

  it('never reports a non-finite number', () => {
    expect(forAll(({ at, safe }) => {
      const p = at({ timingVal: safe });
      const bad = Object.entries(p).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => k);
      return bad.length ? `non-finite: ${bad.join(', ')}` : null;
    })).toEqual([]);
  });
});

describe('every lever pulls the way it does on a real engine', () => {
  it('more octane never lowers the knock limit', () => {
    expect(forAll(({ at, safe }) => {
      const lim = S.OCTANE_OPTS.slice(0, 3).map((fuel) => at({ fuel, timingVal: safe }).threshold);
      return lim[1] < lim[0] - 0.05 || lim[2] < lim[1] - 0.05 ? `limits ${lim.join(' / ')} (91/93/100)` : null;
    })).toEqual([]);
  });

  it('more manifold pressure always flows more air, and brings the knock limit down', () => {
    expect(forAll(({ at, safe, base }) => {
      const map = base.mapKpa + 20;
      const up = { mapKpa: map, boostPsi: Math.max(0, (map - S.BARO_KPA) / S.PSI_TO_KPA) };
      const probeHi = at(up);
      // Same mixture both sides: an injector that runs out of time leans the mixture as
      // pressure rises, and a lean enough mixture genuinely resists knock.
      if (probeHi.fuelLimited || Math.abs(probeHi.lambda - at().lambda) > 0.02) return null;
      // And timing safe at BOTH pressures, or knock control changes the comparison.
      const t = Math.min(safe, probeHi.threshold - 1, probeHi.mbtIdeal);
      const lo = at({ timingVal: t });
      const hi = at({ timingVal: t, ...up });
      if (!(hi.maf > lo.maf)) return `maf ${lo.maf} → ${hi.maf} at +20 kPa`;
      if (hi.threshold > lo.threshold + 0.05) return `knock limit rose ${lo.threshold} → ${hi.threshold} at +20 kPa`;
      if (!(hi.peakPressure > lo.peakPressure)) return `peak pressure ${lo.peakPressure} → ${hi.peakPressure} at +20 kPa`;
      return null;
    })).toEqual([]);
  });

  it('an intercooler cools the charge and buys knock margin under boost', () => {
    expect(forAll(({ at, safe, base }) => {
      if (base.boostPsi < 3) return null;
      // Backpressure held where the uncooled engine had it, so this measures the charge
      // temperature alone. (Let it float and a cooler, denser charge drives more flow
      // through a small turbine, more backpressure and more hot residual — a real
      // effect, but a turbine-sizing one, not the intercooler's.)
      const hot = at({ timingVal: safe, mods: { ...base.mods, intercooler: false } });
      const cool = at({ timingVal: safe, mods: { ...base.mods, intercooler: true }, empKpa: hot.emp });
      if (cool.fuelLimited || hot.fuelLimited) return null;
      // A turbine so small that a fifth of the cylinder is last cycle's exhaust is excluded:
      // the hot residual then sets the end-gas temperature, the intercooler barely moves it,
      // and the denser charge's higher pressure genuinely wins in the knock correlation.
      if (hot.residualFrac > 0.15) return null;
      if (!(cool.iat < hot.iat)) return `IAT ${hot.iat} → ${cool.iat} with intercooler`;
      // At the same timing the cooled end gas is further from lighting itself.
      if (cool.knockIntegral > hot.knockIntegral + 0.002) return `knock integral ${hot.knockIntegral} → ${cool.knockIntegral} with intercooler`;
      // And where the knock limit actually binds — near MBT, where a tune runs — the
      // cooler charge allows at least as much advance. (Far past MBT the denser charge's
      // extra heat release can outweigh its lower temperature; docs/accuracy.md.)
      if (hot.threshold <= hot.mbtIdeal + 2 && cool.threshold < hot.threshold - 0.05) return `binding knock limit ${hot.threshold} → ${cool.threshold} with intercooler`;
      return null;
    })).toEqual([]);
  });

  it('more compression lowers the knock limit and raises the efficiency', () => {
    expect(forAll(({ at, eng, safe }) => {
      if (eng.derived.compression > 12.5) return null;
      const derivedHi = S.deriveEngine({ ...eng.build.engineConfig, compression: eng.derived.compression + 1 });
      const lo = at({ timingVal: safe - 2 });
      const hi = at({ timingVal: safe - 2, derived: derivedHi });
      if (hi.threshold > lo.threshold + 0.05) return `knock limit ${lo.threshold} → ${hi.threshold} at +1 CR`;
      if (hi.imep < lo.imep - 0.005) return `imep ${lo.imep} → ${hi.imep} at +1 CR, same air and fuel`;
      return null;
    })).toEqual([]);
  });

  it('makes within 3% of its best torque at the MBT the advisors teach, and less well either side', () => {
    // The advisors use the textbook MBT (50% burned 8-10° after TDC). At low RPM the
    // model's own cycle peaks a few degrees later than that (docs/accuracy.md); what
    // must hold is that following the advice costs next to nothing, and that torque
    // falls away well to either side of the true best, as on any engine.
    expect(forAll(({ at, probe }) => {
      const mbt = probe.mbtIdeal;
      const hiT = Math.min(probe.threshold - 0.5, mbt + 12);
      // A burn so slow that MBT lands on the table's ceiling cannot be followed anyway.
      if (probe.imep < 1 || mbt - 15 < -5 || hiT <= mbt || mbt >= S.COEFF.MBT_MAX_DEG) return null;
      let best = { imep: -Infinity, t: mbt };
      for (let t = mbt - 15; t <= hiT; t += 1) {
        const q = at({ timingVal: t });
        if (q.imep > best.imep) best = { imep: q.imep, t };
      }
      const atMbt = at({ timingVal: mbt }).imep;
      if (atMbt < best.imep * 0.97) return `imep ${atMbt} at MBT ${mbt}° vs ${best.imep} at ${best.t}°`;
      const far = at({ timingVal: best.t - 12 }).imep;
      if (!(far < best.imep)) return `imep ${far} twelve degrees retarded from best ${best.imep}`;
      return null;
    })).toEqual([]);
  });

  it('retarding the spark sends more heat out of the exhaust', () => {
    expect(forAll(({ at, safe }) => {
      const a = at({ timingVal: safe });
      const b = at({ timingVal: safe - 8 });
      return b.egt < a.egt - 2 ? `EGT ${a.egt} → ${b.egt} with 8° retard` : null;
    })).toEqual([]);
  });

  it('makes more power near best-power mixture than lean, and no more going far rich', () => {
    // A rich burn is air-limited: the extra fuel finds no oxygen. So going richer than
    // best power can never ADD power. (A real engine also loses a few percent there
    // from a slower, cooler flame that the model does not charge; docs/accuracy.md.)
    expect(forAll(({ at, safe }) => {
      const [best, lean, rich] = [12.9, 16.2, 10.3].map((afrCommanded) => at({ timingVal: safe - 2, afrCommanded }));
      if (best.fuelLimited || lean.fuelLimited || rich.fuelLimited || best.imep < 1) return null;
      if (!(lean.imep < best.imep)) return `imep ${best.imep} → ${lean.imep} going lean to 16.2`;
      if (rich.imep > best.imep * 1.01) return `imep ${best.imep} → ${rich.imep} going rich to 10.3`;
      return null;
    })).toEqual([]);
  });

  it('burns more fuel per horsepower well rich of best power, and runs the exhaust cooler', () => {
    expect(forAll(({ at, safe }) => {
      const mid = at({ timingVal: safe - 2, afrCommanded: 13.5 });
      const rich = at({ timingVal: safe - 2, afrCommanded: 11.0 });
      if (mid.bsfc === null || rich.bsfc === null || mid.fuelLimited || rich.fuelLimited) return null;
      if (!(rich.bsfc > mid.bsfc)) return `bsfc ${mid.bsfc} → ${rich.bsfc} going from 13.5 to 11.0 AFR`;
      // Under load, where enrichment is used to cool the exhaust. (At part throttle the
      // cooled, piston-pushed part of the charge dominates and the effect is flat to a
      // degree or two either way; docs/accuracy.md.)
      if (mid.map >= 75 && rich.egt > mid.egt) return `EGT ${mid.egt} → ${rich.egt} going richer at ${mid.map} kPa`;
      if (mid.map >= 95 && !(rich.egt < mid.egt)) return `EGT ${mid.egt} → ${rich.egt} going richer at full load`;
      return null;
    })).toEqual([]);
  });

  it('never makes less boost for asking for more, and never more than it asked for', () => {
    // The turbo spools up from nothing and stops at the first pressure it cannot hold.
    // The solve used to start at the target and relax down, which past the surge line
    // cycled between answers — asking for 16 psi gave less than asking for 5.
    expect(forAll(({ build, eng, base }) => {
      if (!build.turboOn) return null;
      const solve = (target) => S.solveInduction({
        rpm: base.rpm, loadKpa: 100, turboOn: true, boostTargetPsi: target, targetIsFinal: true,
        turbine: eng.turbine, compressor: eng.compressor, derived: eng.derived,
        veAt: (m) => S.interp2(eng.veTruth, base.rpm, m), intakeKAt: (b) => S.chargeTempK(b, build.mods.intercooler),
        lambda: 1, exhaustK: S.INDUCTION_REF_EXHAUST_K,
      }).boostPsi;
      let last = 0;
      for (const target of [2, 5, 8, 12, 16, 20, 25]) {
        const got = solve(target);
        if (got > target + 1e-6) return `${got.toFixed(2)} psi made for a ${target} psi target`;
        if (got < last - 0.01) return `${last.toFixed(2)} psi for less, ${got.toFixed(2)} psi for a ${target} psi target at ${base.rpm} RPM`;
        last = got;
      }
      return null;
    })).toEqual([]);
  });

  it('knocks past the knock limit and not before it', () => {
    expect(forAll(({ at, probe }) => {
      const under = at({ timingVal: probe.threshold - 1 });
      const over = at({ timingVal: probe.threshold + 2 });
      if (under.knock) return `knock at ${probe.threshold - 1}° with the limit at ${probe.threshold}°`;
      if (!over.knock) return `no knock at ${probe.threshold + 2}° with the limit at ${probe.threshold}°`;
      return null;
    })).toEqual([]);
  });
});

describe('whole pulls on random builds', () => {
  const builds = Array.from({ length: BUILDS }, (_, i) => randomBuild(10000 + i));

  it('with the factory ECU calibration, pull exactly as the original model wherever the ECU did nothing of its own', () => {
    // The neutrality contract, beyond the seven presets. The ECU adds things the original
    // model does not have — protections, knock control that steps, misfire — and where one
    // of those acts the numbers are SUPPOSED to differ. Everywhere else, switching the
    // engine management on with nothing changed must not move a single horsepower.
    const failures = [];
    for (const build of builds) {
      const eng = makeEngine({ build });
      const legacy = eng.pull(100, { legacy: true });
      const ecu = eng.pull(100);
      ecu.points.forEach((p, i) => {
        const l = legacy.points[i];
        const ecuActed = (p.protect?.length ?? 0) > 0 || p.knockPull > 0 || l.knockPull > 0
          || p.misfire > 0 || p.cutPct > 0;
        // One unit of rounding: the ECU prices the injector pulse through its own dead time,
        // which on a mis-scaled injector moves the charge by a hundredth of a percent.
        const off = (a, b) => Math.abs(a - b) > Math.max(1, 0.005 * b);
        if (!ecuActed && (off(p.hp, l.hp) || off(p.torque, l.torque))) {
          failures.push(`seed ${build.seed} at ${p.rpm} RPM: legacy ${l.hp} hp / ${l.torque} lb-ft, ECU ${p.hp} / ${p.torque}`);
        }
      });
      if (failures.length >= 5) break;
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('log every problem with what, why and how to fix it, and score within 0-100', () => {
    const failures = [];
    for (const build of builds) {
      const pull = makeEngine({ build }).pull(100);
      for (const e of pull.events) {
        if (!e.msg || !e.cause || !e.fix) failures.push(`seed ${build.seed}: ${e.type} event missing msg/cause/fix`);
      }
      const score = S.computeTuningScore(pull).score;
      if (!(score >= 0 && score <= 100)) failures.push(`seed ${build.seed}: score ${score}`);
      if (pull.peakHp !== Math.max(...pull.points.map((p) => p.hp))) failures.push(`seed ${build.seed}: peakHp is not the highest point`);
      const wear = Object.values(pull.wear);
      if (!wear.every((w) => Number.isFinite(w) && w >= 0)) failures.push(`seed ${build.seed}: wear ${JSON.stringify(pull.wear)}`);
      if (failures.length >= 5) break;
    }
    expect(failures).toEqual([]);
  });
});
