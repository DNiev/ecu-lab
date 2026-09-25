/**
 * Dyno sweep — a full pull, plus the event log that explains it.
 *
 * The event log is the teaching surface of the whole app. Every event carries three
 * things: what happened (`msg`), what physically caused it (`cause`), and what to
 * change (`fix`). When adding a new event type, all three are mandatory — an event
 * that only says something is wrong teaches nothing.
 */

import { COEFF } from './coefficients.js';
import { clamp, groupRuns, interp1, interp2 } from './math.js';
import { solveInduction } from './turbo.js';
import { chargeTempK, INDUCTION_REF_EXHAUST_K } from './thermo.js';
import { evaluatePoint } from './point.js';
import { LOAD, RPM } from './tables.js';
import { ecuSweepEvents } from './ecu/ecuEvents.js';
import { ECU_COEFF } from './ecu/ecuCoefficients.js';
import { ecuSteadyPoint } from './ecu/strategy.js';
import { N2O_AIR_EQUIV, stepBottle, wetKitFuelKgS } from './nitrous.js';

/** Lowest engine speed of a dyno pull, RPM. */
export const SWEEP_START_RPM = 1500;
/** Highest engine speed of a dyno pull, RPM. */
export const SWEEP_END_RPM = 7500;
/** Sweep resolution, RPM. */
export const SWEEP_STEP_RPM = 100;

/**
 * Guards the one input that has already broken this simulation once.
 *
 * The UI builds every boost curve with `RPM.map(...)`, but preset data is a second
 * source of curves. A short array silently interpolates to `undefined` and puts NaN
 * through every downstream formula, so fail loudly at the boundary instead.
 *
 * @param {number[]} boostCurve
 * @throws {Error} if the curve does not match the RPM axis
 */
export function assertBoostCurve(boostCurve) {
  if (!Array.isArray(boostCurve) || boostCurve.length !== RPM.length) {
    throw new Error(
      `boost curve must have ${RPM.length} entries, one per RPM breakpoint — got ${
        Array.isArray(boostCurve) ? boostCurve.length : typeof boostCurve
      }. Build it with RPM.map(...).`,
    );
  }
  const bad = boostCurve.findIndex((v) => !Number.isFinite(v));
  if (bad !== -1) {
    throw new Error(`boost curve entry ${bad} is not a finite number: ${boostCurve[bad]}`);
  }
}

/**
 * Systematic MAF misread introduced by hardware that changes airflow characteristics
 * downstream of the sensor — a bigger intake or turbo plumbing — before the ECU has
 * been recalibrated for it.
 *
 * Exported so the factory calibration generator in `presets.js` can pre-compensate for
 * exactly this error the same way a real ECU's characterized MAF transfer function
 * would, rather than guessing at a second copy of this formula — the same drift risk that
 * keeps the cycle model in one place for the ECU and the calibration generator both.
 *
 * @param {{intake: boolean}} mods bolt-ons fitted
 * @param {boolean} turboOn whether a turbo is fitted
 * @returns {number} multiplier applied to true airflow to get the MAF's reading
 */
export function mafErrorFactor(mods, turboOn) {
  let base = 1.0;
  if (mods.intake) base *= COEFF.MAF_ERROR_INTAKE;
  if (turboOn) base *= COEFF.MAF_ERROR_TURBO;
  return base;
}

/** Knock separated by no more than this much quiet is reported as one band. */
const KNOCK_MERGE_GAP_RPM = 600;

/**
 * Joins runs of points separated by a small gap into one, marking the result
 * `intermittent` — how borderline knock looks on a log: on, off, on again.
 * @param {object[][]} runs
 * @param {number} gapRpm
 * @returns {object[][]}
 */
function mergeNearbyRuns(runs, gapRpm) {
  const out = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (prev && run[0].rpm - prev[prev.length - 1].rpm <= gapRpm) {
      const merged = Object.assign([...prev, ...run], { intermittent: true });
      out[out.length - 1] = merged;
    } else out.push(run);
  }
  return out;
}

/**
 * The spark-table rows in force at a manifold pressure, as a tuner would look for them:
 * one row when the engine sits on it, the two either side (and where between) when it
 * runs between them — which, under boost, it nearly always does.
 * @param {number} mapKpa
 * @returns {string}
 */
function tableRowsAt(mapKpa) {
  const rows = [...LOAD].sort((a, b) => a - b);
  const on = rows.find((r) => Math.abs(r - mapKpa) <= 3);
  if (on !== undefined) return `the ${on} kPa row`;
  if (mapKpa > rows[rows.length - 1]) return `the ${rows[rows.length - 1]} kPa row (the engine ran at ${Math.round(mapKpa)} kPa there)`;
  const hi = rows.find((r) => r > mapKpa);
  const lo = [...rows].reverse().find((r) => r < mapKpa);
  return `the ${lo} and ${hi} kPa rows (the engine ran at ${Math.round(mapKpa)} kPa, between them)`;
}

/**
 * Runs a full dyno pull and produces the datalog, event log, wear and peak figures.
 *
 * With `ecu`, every point is solved with the engine management in the loop — boost
 * control, cam phasing, knock control, sensors, protections — by `ecuSteadyPoint`, and
 * the log gains the ECU's own events. Without it, the ECU is the ideal one the model has
 * always assumed, and the result is exactly what it always was.
 *
 * `input.ecu`, when given, is `{cal, hw, cond}` — the calibration, the
 * `EcuHardware` and the `EcuConditions` of `src/sim/ecu/strategy.js`.
 *
 * @param {object} input
 * @returns {{points: object[], events: object[], wear: object, peakHp: number, peakTq: number, loadKpa: number, needsMafRecal: boolean}}
 */
export function simulateSweep({
  loadKpa, ve, veTruth, timing, afr, turboOn, boostCurve, octaneLabel,
  fuel, injectorCc, ecuInjectorCc, injectorLabel, mods, mafScalar, derived,
  turbine, compressor, ecu = null, blower = null, blowerRatio = 1, nitrous = null,
}) {
  if (turboOn) assertBoostCurve(boostCurve);
  const mafErrorBase = mafErrorFactor(mods, turboOn);
  const needsMafRecal = mods.intake || turboOn;
  const modsWithTurbo = { ...mods, turboFitted: turboOn };

  const points = [];
  const endRpm = derived.redline ?? SWEEP_END_RPM;
  const hardCut = ecu ? (derived.redline ?? SWEEP_END_RPM) + ecu.cal.limiter.offsetRpm : Infinity;
  const ecuHw = ecu ? {
    ...ecu.hw, mafErrorBase, derived, mods, turboOn, boostCurve, turbine, compressor,
    injectorCc, ecuInjectorCc, mafScalar, fuel, blower, blowerRatio, nitrous,
    veTruthByPhase: ecu.hw.veTruthByPhase ?? [veTruth ?? ve],
  } : null;
  // A nitrous bottle through the pull: what each point sprays makes the liquid left boil
  // and cool, and the pressure falls with it — a heater is too slow to hold it mid-pass.
  const nc = ecu && nitrous ? ecu.cond.nitrous : null;
  let bottle = nc ? { massKg: (nitrous.bottleLb ?? 10) * 0.45359237, tempK: nc.bottleK } : null;
  const dtPerPoint = SWEEP_STEP_RPM / ECU_COEFF.DYNO_SWEEP_RPM_PER_S;
  for (let rpm = SWEEP_START_RPM; rpm <= endRpm; rpm += SWEEP_STEP_RPM) {
    if (ecu) {
      // The limiter cuts before the pull gets there: those points are never reached.
      if (rpm >= hardCut) break;
      const cond = bottle
        ? { ...ecu.cond, nitrous: { ...nc, armed: nc.armed && bottle.massKg > 0, bottleK: bottle.tempK } }
        : ecu.cond;
      const pt = ecuSteadyPoint({ cal: ecu.cal, hw: ecuHw, cond, tables: { ve, timing, afr }, rpm, loadKpa });
      points.push(pt);
      if (bottle && pt.nitrousLbMin > 0) {
        bottle = stepBottle(bottle, (pt.nitrousLbMin * 0.45359237 / 60) * dtPerPoint, dtPerPoint, {
          heater: !!nitrous.heater, setK: nc.setK ?? nc.bottleK, ambientK: ecu.cond.env.ambientK,
        });
      }
      continue;
    }
    const boostTarget = turboOn ? interp1(RPM, boostCurve, rpm) : 0;
    // Boost is solved from the turbine/compressor power balance, not ramped in on engine
    // speed. The target is a wastegate ceiling: ask for more than the hardware can make
    // and the log will show what it actually made.
    const man = solveInduction({
      rpm, loadKpa, turboOn, boostTargetPsi: boostTarget, turbine, compressor,
      veAt: (mapKpa) => interp2(veTruth ?? ve, rpm, mapKpa),
      derived,
      intakeKAt: (boostPsi) => chargeTempK(boostPsi, mods.intercooler),
      lambda: 1, exhaustK: INDUCTION_REF_EXHAUST_K,
      ...(blower ? { blower, blowerRatio, intakeKAtEff: (b, eta) => chargeTempK(b, mods.intercooler, undefined, eta) } : {}),
    });
    // Tables are indexed by ACTUAL manifold pressure, so adding boost walks the
    // calibration up into the high-MAP rows automatically.
    const veVal = interp2(ve, rpm, man.mapKpa);
    // `veTruth` is what the hardware actually flows. When it is omitted the ECU's
    // table is taken as correct, which is the "perfectly calibrated" case.
    const veActualVal = veTruth ? interp2(veTruth, rpm, man.mapKpa) : undefined;
    const timingVal = interp2(timing, rpm, man.mapKpa);
    const afrCommanded = interp2(afr, rpm, man.mapKpa);
    points.push(evaluatePoint({
      rpm, mapKpa: man.mapKpa, boostPsi: man.boostPsi,
      veVal, veActualVal, timingVal, afrCommanded, fuel, mods: modsWithTurbo,
      mafScalar, mafErrorBase, injectorCc, ecuInjectorCc, derived, compressor,
      turbine: turboOn ? turbine : null, empKpa: man.empKpa,
      ...(man.blower ? { blower: man.blower } : {}),
    }));
  }

  let pistonWear = 0, valveWear = 0;
  points.forEach((p) => {
    if (p.knock) pistonWear += p.knockPull * COEFF.WEAR_KNOCK;
    if (p.leanRisk) {
      if (p.valveRisk) valveWear += COEFF.WEAR_VALVE_LEAN_BOOST;
      else pistonWear += COEFF.WEAR_LEAN;
    }
    // Bore wash: unburnt fuel stripping the cylinder film is a ring/bore wear mode.
    if (p.richRisk) pistonWear += (COEFF.RICH_DAMAGE_LAMBDA - p.lambda) * COEFF.WEAR_RICH_BORE_WASH;
    // Mechanical overload: past a certain peak cylinder pressure the piston crown, the
    // ring lands and the rod are simply out of strength. This is a SEPARATE failure
    // mode from knock — a tune can be perfectly knock-free and still be pounding the
    // bottom end apart, which is what happens when a high-octane fuel is used to make
    // high static compression survivable under boost.
    if (p.pressureRisk) {
      pistonWear += (p.peakPressure - COEFF.PEAK_PRESSURE_LIMIT_BAR) * COEFF.WEAR_PISTON_PER_BAR;
    }
    // Knock nobody corrected: the ECU could not hear it, so it ran on, and it is charged
    // at twice the rate of knock the controller caught and pulled.
    if (p.knockUnheard > 0) pistonWear += p.knockUnheard * COEFF.WEAR_KNOCK * 2;
  });
  const avgBoost = points.reduce((s, p) => s + p.boostPsi, 0) / points.length;
  const avgPeakPressure = points.reduce((s, p) => s + p.peakPressure, 0) / points.length;
  // Bearings are loaded by peak cylinder pressure on every firing stroke, so they are
  // charged for the pressure the whole pull averaged — not for boost, which was only
  // ever a proxy for it and one that ignored static compression entirely. Block
  // material still modulates it: an iron block holds its main bores rounder under load
  // than an aluminium one, which is `bearingWearMult`'s whole job.
  const bearingWear = Math.max(0, avgPeakPressure - COEFF.BEARING_PRESSURE_FREE_BAR)
    * COEFF.WEAR_BEARING_PER_BAR * derived.bearingWearMult;
  const wear = { piston: pistonWear, bearing: bearingWear, valve: valveWear };

  const events = [];
  const rangeLabel = (run) => (run[0].rpm === run[run.length - 1].rpm
    ? `${run[0].rpm} RPM`
    : `${run[0].rpm}–${run[run.length - 1].rpm} RPM`);
  /** How much of the full sweep this run covers. */
  const rangeFrac = (run) => run.length / points.length;
  // Delivered mixture more than half a ratio from what the AFR table asked for: the
  // table is not the problem, the fuelling is — a tuner reading a wideband against the
  // target makes exactly this call before touching a single AFR cell.
  const missedTarget = (p) => Math.abs(p.afr - p.afrCommanded) > 0.5;

  // WHILE NITROUS SPRAYS the mixture is not the base tune's alone: a wet kit's jet brings
  // fuel of its own, a dry kit's rides on the injectors, and the vapour takes room the air
  // would have had. The fix is the kit's fuel, not VE or the AFR table, which are right
  // the moment the nitrous stops.
  const spraying = (p) => (p.nitrousLbMin ?? 0) > 0;
  /** Change to the injectors' fuel while spraying that brings the mixture to λ 0.80
   *  (11.8:1 on gasoline), the middle of what nitrous tuners aim for; null without an
   *  ECU record to price it from. */
  const nitrousFuelChangePct = (p) => {
    if (!(p.fuelMass > 0) || !nitrous) return null;
    const eventsPerS = derived.cyl * (p.rpm / 2) / 60;
    const kitMg = ((p.nitrousFuelLbMin ?? 0) * 453.59237 / 60 / eventsPerS) * 1000;
    // Both the dry kit's fuel and the correction are shares of the shot's fuel, at the dose
    // the controller is passing, so one number serves either field.
    const shotMg = (wetKitFuelKgS(nitrous.shotHp, fuel) * ((p.nitrousPct ?? 100) / 100) * 1e6) / eventsPerS;
    const changeMg = (p.fuelMass + kitMg) * (p.lambda / COEFF.N2O_TARGET_LAMBDA - 1);
    return Math.round((changeMg / shotMg) * 100);
  };
  const nitrousFuelFix = (p, dir) => {
    const pct = nitrousFuelChangePct(p);
    const field = nitrous?.kit === 'dry' ? 'Dry kit fuel' : 'Fuel correction while spraying';
    const amount = pct != null ? ` by about ${Math.min(Math.abs(pct), nitrous?.kit === 'dry' ? 200 : 100)} points` : '';
    return `On TUNE → NITROUS, ${dir === 'less' ? 'lower' : 'raise'} ${field}${amount}. That changes the fuel only while the nitrous flows — leave VE and the AFR table alone, they are right when it stops. Nitrous tuners aim for about 11.5-12:1 (λ 0.78-0.82) on pump gas.`;
  };

  // Real knock: commanded timing past the knock limit. Without an ECU that is exactly
  // `knock`. With one, the controller can also pull timing for noise it mistook for
  // knock — that has its own entry — and borderline knock comes and goes as the
  // controller steps back and forth, so knock separated by a few hundred RPM of quiet
  // is one problem in one band, not four.
  //
  // Knock while nitrous sprays is the nitrous controller's to answer — its retard while
  // spraying — and has its own entry. Answering it here would take timing out of the base
  // table and cost the engine it the rest of the time.
  const knockRuns = ecu
    ? mergeNearbyRuns(groupRuns(points, (p) => p.margin < 0 && !spraying(p)), KNOCK_MERGE_GAP_RPM)
    : groupRuns(points, (p) => p.knock);
  /** How this build turns its boost down: a turbo's target, a supercharger's pulley. */
  const lessBoost = blower
    ? 'fit a larger blower pulley (a lower ratio) on BUILD → INDUCTION'
    : 'back off boost in that range on BUILD';
  knockRuns.forEach((run) => {
    const peak = ecu
      ? run.reduce((a, b) => (b.margin < a.margin ? b : a))
      : run.reduce((a, b) => (b.knockPull > a.knockPull ? b : a));
    const avgPull = run.reduce((s, p) => s + p.knockPull, 0) / run.length;
    const boosted = run.some((p) => p.boostPsi >= 1);
    const leanContrib = Math.max(0, peak.afr - peak.bestAfr) * 2.5;
    const causes = [];
    if (boosted) causes.push(`boost (up to ${Math.max(...run.map((p) => p.boostPsi)).toFixed(1)} psi here) eating into your margin`);
    if (leanContrib >= 1.5) causes.push(`the mixture running leaner than the ${peak.bestAfr}:1 best-power target here (peak ${peak.afr.toFixed(1)}:1)${peak.fuelLimited ? ', partly from injectors maxing out' : ''}`);
    if (causes.length === 0) causes.push(`the commanded timing itself being too aggressive for ${octaneLabel} octane and this compression ratio at this load`);
    const suggestedTiming = Math.max(-5, Math.round((peak.threshold - 1) * 2) / 2);
    const impact = Math.max(5, Math.round((10 + avgPull * 7) * (0.3 + 0.7 * rangeFrac(run))));
    events.push({
      type: 'knock', severity: 3, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Knock across ${rangeLabel(run)}${/** @type {any} */ (run).intermittent ? ' (on and off)' : ''} — ECU pulled up to ${Math.max(...run.map((p) => p.knockPull)).toFixed(1)}° (peak near ${peak.rpm} RPM)`,
      cause: `Caused by ${causes.join(' and ')}. This spans ${Math.round(rangeFrac(run) * 100)}% of the RPM sweep${avgPull >= 2 ? `, averaging ${avgPull.toFixed(1)}° of retard — a common tuner's rule of thumb treats anything sustained above about 2° as a warning of expensive engine damage, not an acceptable operating point` : ''}.`,
      fix: `On TIMING, take about ${Math.max(1, Math.ceil(-peak.margin + 1))}° out of ${tableRowsAt(peak.map)} around ${peak.rpm} RPM, so the engine runs about ${suggestedTiming}° there.${boosted ? ` Or ${lessBoost}.` : ''}${leanContrib >= 1.5 ? ` Or richen AFR toward ${peak.bestAfr}:1 there.` : ''} Higher octane, lower compression, or an aluminum head on BUILD also buy margin.`,
    });
  });

  // Mechanical overload, reported separately from knock because it is a separate
  // failure and — crucially — because the levers that fix it are different ones. Every
  // other cylinder-pressure event in this log can be answered with octane; this one
  // cannot, and saying so is the entire teaching value of the event.
  groupRuns(points, (p) => p.pressureRisk).forEach((run) => {
    const peak = run.reduce((a, b) => (b.peakPressure > a.peakPressure ? b : a));
    const over = peak.peakPressure - COEFF.PEAK_PRESSURE_LIMIT_BAR;
    const impact = Math.round(clamp(10 + over * 0.7, 10, 34) * (0.35 + 0.65 * rangeFrac(run)));
    events.push({
      type: 'pressure', severity: 3, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Peak cylinder pressure past what the bottom end takes across ${rangeLabel(run)} — up to ${peak.peakPressure.toFixed(0)} bar near ${peak.rpm} RPM`,
      cause: `${derived.compression.toFixed(1)}:1 static compression multiplies whatever the manifold sends it, and it is being sent ${Math.round(peak.map)} kPa at ${peak.ve.toFixed(0)}% VE${peak.boostPsi >= 1 ? ` (${peak.boostPsi.toFixed(1)} psi of boost)` : ''}${spraying(peak) ? `, with a ${nitrous.shotHp} shot of nitrous adding the oxygen for about ${Math.round(peak.nitrousLbMin * N2O_AIR_EQUIV)} lb/min more air on top` : ''} — about ${peak.peakPressure.toFixed(0)} bar at the top of the stroke, against roughly ${COEFF.PEAK_PRESSURE_LIMIT_BAR} bar for stock cast pistons and production rods. This is not detonation: the mixture is burning normally and the ECU has nothing to detect. It is simply more force than the parts are built to pass, on every firing stroke, for ${Math.round(rangeFrac(run) * 100)}% of the sweep.`,
      fix: `Lower static compression on BUILD, or ${spraying(peak) ? `spray a smaller shot, or start it higher in the rev range on TUNE → NITROUS, ` : ''}${peak.boostPsi >= 1 ? `${blower ? 'fit a larger blower pulley' : 'take boost out of this range'} ` : ''}so the same compression has less to multiply. On a real engine, forged pistons and rods are the hardware answer if you want to keep both; this app does not offer them, so here it is compression or ${spraying(peak) ? 'the shot' : 'boost'}. Higher octane will NOT help here — it buys knock margin, not rod strength, so a big-octane fuel just removes the knock that was warning you and leaves the load exactly where it was.`,
    });
  });

  groupRuns(points, (p) => p.fuelLimited).forEach((run) => {
    const peak = run.reduce((a, b) => (b.duty > a.duty ? b : a));
    const impact = Math.max(4, Math.round(10 * (0.3 + 0.7 * rangeFrac(run))));
    events.push({
      type: 'fuel', severity: 2, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Injectors maxed across ${rangeLabel(run)} (up to ${peak.duty}% duty) — mixture leaned to ${peak.afr.toFixed(1)}:1`,
      cause: `Required pulse width (${peak.pw} ms) exceeds 90% of the ${(120000 / peak.rpm).toFixed(1)} ms available per engine cycle at ${peak.rpm} RPM, so the ${injectorLabel} injectors physically cannot deliver the commanded fuel.${fuel.stoich < 12 ? ` ${octaneLabel} needs roughly ${(14.7 / fuel.stoich).toFixed(2)}× the fuel volume of gasoline at the same lambda — a big part of why you ran out here.` : ''}`,
      fix: `On BUILD → FUEL SYSTEM, step up to a larger injector (then set TUNE → INJECTORS to match), or lower VE/boost in this range so demand fits under the current injectors' capacity.${fuel.stoich < 12 ? ' Switching back to a gasoline blend would also cut fuel volume sharply — at the cost of knock margin.' : ''}`,
    });
  });

  groupRuns(points, (p) => p.leanRisk && !p.valveRisk).forEach((run) => {
    const peak = run.reduce((a, b) => (b.afr > a.afr ? b : a));
    const impact = Math.max(4, Math.round(10 * (0.3 + 0.7 * rangeFrac(run))));
    events.push({
      type: 'lean', severity: 2, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Lean mixture (up to ${peak.afr.toFixed(1)}:1) across ${rangeLabel(run)} under load`,
      cause: peak.fuelLimited
        ? `This is the injector-duty limit above showing up as heat risk, not a bad AFR table entry.`
        : spraying(peak)
          ? `This is while the nitrous sprays: it brings oxygen worth about 1.6 times its weight in air, and ${nitrous?.kit === 'dry' ? 'a dry kit relies on the ECU to add the fuel for it through the injectors — too little arrived' : 'the wet kit\'s fuel jet did not bring enough to match it'}. Lean on nitrous is how pistons melt.`
          : peak.afrCommanded <= COEFF.LEAN_DAMAGE_AFR
          ? `The AFR table asked for ${peak.afrCommanded.toFixed(1)}:1 here, but the engine got ${peak.afr.toFixed(1)}:1. The target is fine; the fuelling is not delivering it.`
          : `The AFR target itself (${peak.afrCommanded.toFixed(1)}:1) is set leaner than is safe for ${Math.round(loadKpa)} kPa in this range.${missedTarget(peak) ? ` And the engine got even leaner than that, ${peak.afr.toFixed(1)}:1.` : ''}`,
      fix: peak.fuelLimited
        ? `Upgrade injectors on BUILD → FUEL SYSTEM (and set TUNE → INJECTORS to match), or lower VE/boost so demand fits within current capacity.`
        : spraying(peak)
          ? nitrousFuelFix(peak, 'more')
          : peak.afrCommanded <= COEFF.LEAN_DAMAGE_AFR
          ? `Fix what the ECU is getting wrong rather than asking for a richer number: correct VE on TUNE → AIRFLOW in this range, and check TUNE → INJECTORS and TUNE → SENSORS match the parts on BUILD (the setup warnings there name any mismatch).`
          : `On AFR, richen the cells in this range — best power here is near ${peak.bestAfr}:1${peak.boostPsi > 1 ? ' (richer than the N/A ideal, because boost needs the charge cooling)' : ''}.${missedTarget(peak) ? ' Then correct VE there, so the engine gets what the table asks for.' : ''}`,
    });
  });

  groupRuns(points, (p) => p.valveRisk).forEach((run) => {
    const peak = run.reduce((a, b) => (b.afr > a.afr ? b : a));
    const overage = Math.min(1, Math.max(0, peak.afr - 15.2) / 6);
    const impact = Math.max(6, Math.round(18 * (0.25 + 0.75 * rangeFrac(run)) * (0.4 + 0.6 * overage)));
    events.push({
      type: 'valve', severity: 3, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Lean-under-boost across ${rangeLabel(run)} (up to ${peak.afr.toFixed(1)}:1 at ${peak.boostPsi.toFixed(1)} psi) — elevated EGT, valve risk`,
      cause: `Boost raises cylinder pressure and heat at the same time the mixture goes lean — that combination burns exhaust valves over repeated pulls, separately from detonation. This spans ${Math.round(rangeFrac(run) * 100)}% of the sweep.`,
      fix: `Richen AFR under boost in this range, confirm injectors are not maxed (injector duty on the pull log), or add an intercooler.`,
    });
  });

  groupRuns(points, (p) => p.richRisk).forEach((run) => {
    const peak = run.reduce((a, b) => (b.lambda < a.lambda ? b : a));
    const sev = clamp((0.75 - peak.lambda) / 0.35, 0, 1);
    const impact = Math.max(6, Math.round((12 + sev * 26) * (0.35 + 0.65 * rangeFrac(run))));
    events.push({
      type: 'rich', severity: 3, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Dangerously rich across ${rangeLabel(run)} — down to lambda ${peak.lambda.toFixed(2)} (${peak.afr.toFixed(1)}:1)`,
      cause: spraying(peak)
        ? `This is while the nitrous sprays, and the extra fuel is the nitrous's, not the base tune's. ${nitrous?.kit === 'dry' ? 'The injectors carry the dry kit\'s fuel on top of the fuel for the air' : 'The wet kit\'s own jet adds fuel, jetted rich on purpose, on top of the injectors'} — and the nitrous vapour takes up room the air would have had. A speed-density ECU works out air from MAP and the VE table, so it cannot see that and keeps fuelling for air that is not there. Past about 11:1 the extra fuel washes the cylinder walls, fouls plugs and costs power.`
        : `Far more fuel is being delivered than the available air can burn. Raw fuel washes the oil film off the cylinder walls, fouls plugs, and passes into the exhaust. It also costs a lot of power — the mixture is well past the point where extra fuel helps.`,
      fix: spraying(peak) ? nitrousFuelFix(peak, 'less') : peak.afrCommanded / 14.7 >= COEFF.RICH_DAMAGE_LAMBDA
        ? `The AFR table asked for ${peak.afrCommanded.toFixed(1)}:1 but the engine got ${peak.afr.toFixed(1)}:1, so the fuelling is off, not the target. Correct VE on TUNE → AIRFLOW in this range, and check the injector scaling on TUNE → INJECTORS and the MAF scalar on TUNE → SENSORS match the parts on BUILD.`
        : `The AFR table itself asks for this much fuel. Lean the AFR cells in this range back toward ${peak.bestAfr}:1.${missedTarget(peak) ? ' Then check VE and the injector scaling on TUNE → INJECTORS, because the engine is getting even more than the table asks for.' : ''}`,
    });
  });

  groupRuns(points, (p) => p.mafFlag).forEach((run) => {
    const avgTrim = run.reduce((s, p) => s + p.trimPct, 0) / run.length;
    const direction = avgTrim > 0 ? 'lean' : 'rich';
    const source = mods.intake && turboOn ? 'the bigger intake and turbo plumbing'
      : mods.intake ? 'the bigger intake' : 'the turbo plumbing';
    const impact = Math.round(8 * (0.3 + 0.7 * rangeFrac(run)));
    events.push({
      type: 'maf', severity: 1, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `MAF trim averaging ${avgTrim > 0 ? '+' : ''}${avgTrim.toFixed(0)}% across ${rangeLabel(run)} — running ${direction}`,
      cause: `${source.charAt(0).toUpperCase() + source.slice(1)} changed how much air reads across the MAF sensor at a given flow rate, and the ECU has not been rescaled for it.`,
      fix: `On TUNE → SENSORS, adjust the MAF scalar and re-run the pull — watch the AFR trace (actual vs. commanded) until they line up.`,
    });
  });

  groupRuns(points, (p) => p.compressorOver).forEach((run) => {
    const peak = run.reduce((a, b) => (b.boostPsi > a.boostPsi ? b : a));
    const impact = Math.round(10 * (0.3 + 0.7 * rangeFrac(run)));
    events.push({
      type: 'compressor', severity: 2, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Compressor pushed past its efficient range across ${rangeLabel(run)} (target up to ${peak.boostPsi.toFixed(1)} psi)`,
      cause: `This compressor's practical ceiling is lower than the boost you're asking for here — beyond it, the compressor is working outside its efficient map. On a real turbo that air leaves hotter, less dense and more knock-prone; this app prices the compressor's heat at one fixed efficiency, so here the warning is the main cost (see Learn article 39).`,
      fix: `On BUILD, size up the compressor, or lower the boost target for this RPM range.`,
    });
  });

  // A supercharger turns at a fixed multiple of the crank, so its speed limit is the
  // pulley and the redline together. Past its rating the rotors or impeller and their
  // bearings are outside what they were built for, and the belt is the next thing to go.
  groupRuns(points, (p) => p.blowerOverspeed).forEach((run) => {
    const peak = run.reduce((a, b) => (b.blowerRpm > a.blowerRpm ? b : a));
    const rated = blower.maxRpm ?? blower.maxImpellerRpm;
    const impact = Math.round(10 * (0.4 + 0.6 * rangeFrac(run)));
    // Rounded DOWN: a ratio rounded up to two places can land back over the rating.
    const safeRatio = (Math.floor((rated / (peak.rpm * (blower.stepUp ?? 1))) * 100) / 100).toFixed(2);
    events.push({
      type: 'blower', severity: 3, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Supercharger over its rated speed across ${rangeLabel(run)} (${peak.blowerRpm.toLocaleString('en-US')} rpm, rated ${rated.toLocaleString('en-US')})`,
      cause: `A supercharger is geared to the crank: at ${peak.rpm} RPM the ${blowerRatio.toFixed(2)}:1 pulley${blower.stepUp ? ` and its ${blower.stepUp}:1 internal step-up` : ''} spin the ${blower.label} past what its ${blower.type === 'centrifugal' ? 'impeller and gears' : 'rotors and bearings'} are rated for. Nothing makes more boost for free up there: it is wear, heat and a thrown belt waiting to happen.`,
      fix: `On BUILD → INDUCTION, fit a larger blower pulley (a lower ratio — about ${safeRatio}:1 keeps it inside its rating at this RPM), or lower the rev limit.`,
    });
  });

  const injRatio = injectorCc / ecuInjectorCc;
  if (Math.abs(injRatio - 1) > 0.05) {
    const richLean = injRatio > 1 ? 'rich' : 'lean';
    events.push({
      type: 'injscale', severity: 3, impact: Math.round(clamp(14 + Math.abs(injRatio - 1) * 22, 14, 40)),
      msg: `Injector scaling mismatch — ECU is calibrated for ${ecuInjectorCc}cc but ${injectorCc}cc are fitted`,
      cause: `The ECU calculates pulse width for a ${ecuInjectorCc}cc injector. With ${injectorCc}cc actually fitted, every pulse delivers about ${(injRatio * 100).toFixed(0)}% of the intended fuel, so the whole tune runs ${richLean} no matter what your AFR table asks for.`,
      fix: `On TUNE → INJECTORS, set the ECU injector scaling to ${injectorCc}cc to match the hardware. Real tuning software calls this the injector scaling constant (UpRev's K-fuel multiplier, HP Tuners' injector flow rate) — it must always be updated when injectors change.`,
    });
  }

  // Valve float is a hard mechanical limit — the springs cannot close the valves fast
  // enough, so cylinder filling collapses. No calibration change touches this.
  const floatRpm = derived.floatRpm || 99999;
  if (floatRpm < endRpm) {
    const lost = points.filter((p) => p.rpm > floatRpm);
    events.push({
      type: 'float', severity: 3, impact: Math.round(clamp((endRpm - floatRpm) / 45, 8, 34)),
      rpmStart: Math.round(floatRpm), rpmEnd: endRpm,
      msg: `Valve float above ${Math.round(floatRpm)} RPM — cylinder filling collapsing over the last ${lost.length * SWEEP_STEP_RPM} RPM of the pull`,
      cause: `The camshaft opens the valves but only the springs close them. Above ${Math.round(floatRpm)} RPM the valves stop following the lobe, so the cylinder cannot fill and power falls off a cliff instead of tapering. A ${derived.camDuration}° cam opens further and faster, which is exactly why it demands stiffer springs than stock.`,
      fix: `Raise the valve spring rate on BUILD until float sits above your ${endRpm} RPM redline, or fit a milder cam. No amount of table tuning can fix this — the valvetrain is simply not keeping up.`,
    });
  }

  // A big cam's real cost is rarely peak-power knock — it is everything below the
  // power band: reversion, lost vacuum, lumpy idle, and a much narrower usable range.
  // This is a HARDWARE trade-off, not a calibration fault, so it is flagged as an
  // advisory rather than something the player can tune away.
  const overlap = derived.overlapDeg || 0;
  if (overlap > 10) {
    const lowTq = points.find((p) => p.rpm === 2500)?.torque ?? 0;
    const peakTqPt = points.reduce((a, b) => (b.torque > a.torque ? b : a));
    events.push({
      type: 'cam', severity: 1, impact: Math.round(clamp(overlap * 0.35, 4, 14)),
      msg: `Large camshaft (${derived.camDuration}°, ${overlap.toFixed(0)}° overlap) — powerband moved up, low end given away`,
      cause: `At ${overlap.toFixed(0)}° of overlap both valves are open together long enough that at low RPM exhaust pushes back into the intake (reversion) and fresh charge escapes out the exhaust. Torque at 2500 RPM is down to ${lowTq} lb-ft while peak torque has moved to ${peakTqPt.rpm} RPM. Expect a lumpy idle, weak manifold vacuum and poorer driveability off boost.`,
      fix: `This is a hardware trade-off, not a tuning fault — you cannot calibrate it away. If the low end matters, fit a milder cam. If you want this cam, make sure the valve springs suit it (float at ${Math.round(derived.floatRpm)} RPM) and expect to gear the car for the higher powerband.`,
    });
  }

  // Keyed on the pressure the bearings actually see rather than on boost, so it fires
  // for the reason the wear number now moves. A high-compression naturally aspirated
  // engine can reach this without a turbo, and a knock-limited boosted one can stay
  // under it because the retard the ECU pulled took the pressure peak with it.
  if (avgPeakPressure > COEFF.BEARING_EVENT_BAR) {
    const bearingLevers = [
      turboOn ? 'Back off boost' : blower ? 'Fit a larger blower pulley' : null,
      points.some(spraying) ? `${turboOn || blower ? 'spray' : 'Spray'} a smaller shot` : null,
    ].filter(Boolean);
    const impact = Math.round(clamp((avgPeakPressure - COEFF.BEARING_EVENT_BAR) * 0.25, 3, 9));
    events.push({
      type: 'bearing', severity: 1, impact,
      msg: `Sustained cylinder pressure through the pull (averaging ${avgPeakPressure.toFixed(0)} bar peak) — bottom-end stress accumulating`,
      cause: `Peak cylinder pressure is carried by the rod into the rod and main bearings on every firing stroke, knock or no knock. ${turboOn || blower ? `${avgBoost.toFixed(1)} psi of average boost ${points.some(spraying) ? 'and the nitrous ' : ''}against ` : points.some(spraying) ? 'The nitrous\'s extra charge against ' : 'Running this much load against '}${derived.compression.toFixed(1)}:1 static compression is what puts it there — compression multiplies manifold pressure, so both halves of that pair count.`,
      fix: `${bearingLevers.length ? `${bearingLevers.join(', ')}, or lower` : 'Lower'} static compression — on a real engine, unless the bottom end has been built for it (this app does not offer a built bottom end). An iron block holds its main bores rounder under this load than an aluminium one, and either way there is no calibration change that removes the force — only ones that reduce it.`,
    });
  }

  if (ecu) {
    events.push(...ecuSweepEvents(points, { cal: ecu.cal, hw: ecuHw, hardCut, endRpm }));
  }

  events.sort((a, b) => (b.impact ?? b.severity) - (a.impact ?? a.severity));

  const peakHp = Math.max(...points.map((p) => p.hp));
  const peakTq = Math.max(...points.map((p) => p.torque));
  return { points, events, wear, peakHp, peakTq, loadKpa, needsMafRecal };
}

/**
 * Whether an event happened somewhere in particular, rather than being true of the
 * whole pull.
 *
 * Derived from the data, never from a list of type names. `LogScreen` records what a
 * hand-kept list costs: one there named eleven of the twelve types this file emits and
 * `bearing` fell through to a chart colour. A thirteenth event type added later is
 * classified correctly the day it appears — it carries a span or it does not.
 *
 * @param {{rpmStart?: number}} event
 * @returns {boolean}
 */
export function isLocatable(event) {
  return typeof event.rpmStart === 'number';
}
