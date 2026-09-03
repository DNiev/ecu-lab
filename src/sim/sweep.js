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
import { RPM } from './tables.js';

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

/**
 * Runs a full dyno pull and produces the datalog, event log, wear and peak figures.
 *
 * @param {object} input
 * @returns {{points: object[], events: object[], wear: object, peakHp: number, peakTq: number, loadKpa: number, needsMafRecal: boolean}}
 */
export function simulateSweep({
  loadKpa, ve, veTruth, timing, afr, turboOn, boostCurve, octaneLabel,
  fuel, injectorCc, ecuInjectorCc, injectorLabel, mods, mafScalar, derived,
  turbine, compressor,
}) {
  if (turboOn) assertBoostCurve(boostCurve);
  const mafErrorBase = mafErrorFactor(mods, turboOn);
  const needsMafRecal = mods.intake || turboOn;
  const modsWithTurbo = { ...mods, turboFitted: turboOn };

  const points = [];
  const endRpm = derived.redline ?? SWEEP_END_RPM;
  for (let rpm = SWEEP_START_RPM; rpm <= endRpm; rpm += SWEEP_STEP_RPM) {
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

  groupRuns(points, (p) => p.knock).forEach((run) => {
    const peak = run.reduce((a, b) => (b.knockPull > a.knockPull ? b : a));
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
      msg: `Knock across ${rangeLabel(run)} — ECU pulled up to ${peak.knockPull.toFixed(1)}° (peak near ${peak.rpm} RPM)`,
      cause: `Caused by ${causes.join(' and ')}. This spans ${Math.round(rangeFrac(run) * 100)}% of the RPM sweep${avgPull >= 2 ? `, averaging ${avgPull.toFixed(1)}° of retard — tuners treat anything sustained above about 2° as a prelude to expensive engine damage, not an acceptable operating point` : ''}.`,
      fix: `On TIMING, pull the cells around ${peak.rpm} RPM / ${Math.round(loadKpa)} kPa toward ${suggestedTiming}° or less.${boosted ? ' Or back off boost in that range on BUILD.' : ''}${leanContrib >= 1.5 ? ` Or richen AFR toward ${peak.bestAfr}:1 there.` : ''} Higher octane, lower compression, or an aluminum head on BUILD also buy margin.`,
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
      cause: `${derived.compression.toFixed(1)}:1 static compression multiplies whatever the manifold sends it, and it is being sent ${Math.round(peak.map)} kPa at ${peak.ve.toFixed(0)}% VE${peak.boostPsi >= 1 ? ` (${peak.boostPsi.toFixed(1)} psi of boost)` : ''} — about ${peak.peakPressure.toFixed(0)} bar at the top of the stroke, against roughly ${COEFF.PEAK_PRESSURE_LIMIT_BAR} bar for stock cast pistons and production rods. This is not detonation: the mixture is burning normally and the ECU has nothing to detect. It is simply more force than the parts are built to pass, on every firing stroke, for ${Math.round(rangeFrac(run) * 100)}% of the sweep.`,
      fix: `Lower static compression on BUILD, or take boost out of this range so the same compression has less to multiply. Forged pistons and rods are the hardware answer if you want to keep both. Higher octane will NOT help here — it buys knock margin, not rod strength, so a big-octane fuel just removes the knock that was warning you and leaves the load exactly where it was.`,
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
      fix: `On FUEL, step up to a larger injector, or lower VE/boost in this range so demand fits under the current injectors' capacity.${fuel.stoich < 12 ? ' Switching back to a gasoline blend would also cut fuel volume sharply — at the cost of knock margin.' : ''}`,
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
        : `The AFR target itself is set leaner than is safe for ${Math.round(loadKpa)} kPa in this range.`,
      fix: peak.fuelLimited
        ? `Upgrade injectors on FUEL, or lower VE/boost so demand fits within current capacity.`
        : `On AFR, richen the cells in this range — best power here is near ${peak.bestAfr}:1${peak.boostPsi > 1 ? ' (richer than the N/A ideal, because boost needs the charge cooling)' : ''}.`,
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
      fix: `Richen AFR under boost in this range, confirm injectors are not maxed (FUEL tab), or add an intercooler.`,
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
      cause: `Far more fuel is being delivered than the available air can burn. Raw fuel washes the oil film off the cylinder walls, fouls plugs, and passes into the exhaust. It also costs a lot of power — the mixture is well past the point where extra fuel helps.`,
      fix: `Check the ECU Injector Size on FUEL matches the injectors actually fitted, verify the MAF scalar, then lean the AFR cells in this range back toward ${peak.bestAfr}:1.`,
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
      fix: `On ECU, adjust the MAF Scalar and re-run the pull — watch the AFR trace (actual vs. commanded) until they line up.`,
    });
  });

  groupRuns(points, (p) => p.compressorOver).forEach((run) => {
    const peak = run.reduce((a, b) => (b.boostPsi > a.boostPsi ? b : a));
    const impact = Math.round(10 * (0.3 + 0.7 * rangeFrac(run)));
    events.push({
      type: 'compressor', severity: 2, impact,
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
      msg: `Compressor pushed past its efficient range across ${rangeLabel(run)} (target up to ${peak.boostPsi.toFixed(1)} psi)`,
      cause: `This compressor's practical ceiling is lower than the boost you're asking for here — beyond it, the compressor is working outside its efficient map, making hotter, less dense, more knock-prone air.`,
      fix: `On BUILD, size up the compressor, or lower the boost target for this RPM range.`,
    });
  });

  const injRatio = injectorCc / ecuInjectorCc;
  if (Math.abs(injRatio - 1) > 0.05) {
    const richLean = injRatio > 1 ? 'rich' : 'lean';
    events.push({
      type: 'injscale', severity: 3, impact: Math.round(clamp(14 + Math.abs(injRatio - 1) * 22, 14, 40)),
      msg: `Injector scaling mismatch — ECU is calibrated for ${ecuInjectorCc}cc but ${injectorCc}cc are fitted`,
      cause: `The ECU calculates pulse width for a ${ecuInjectorCc}cc injector. With ${injectorCc}cc actually fitted, every pulse delivers about ${(injRatio * 100).toFixed(0)}% of the intended fuel, so the whole tune runs ${richLean} no matter what your AFR table asks for.`,
      fix: `On FUEL, set the ECU Injector Size to ${injectorCc}cc to match the hardware. Real tuning software calls this the injector scaling constant (UpRev's K-fuel multiplier, HP Tuners' injector flow rate) — it must always be updated when injectors change.`,
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
    const impact = Math.round(clamp((avgPeakPressure - COEFF.BEARING_EVENT_BAR) * 0.25, 3, 9));
    events.push({
      type: 'bearing', severity: 1, impact,
      msg: `Sustained cylinder pressure through the pull (averaging ${avgPeakPressure.toFixed(0)} bar peak) — bottom-end stress accumulating`,
      cause: `Peak cylinder pressure is carried by the rod into the rod and main bearings on every firing stroke, knock or no knock. ${turboOn ? `${avgBoost.toFixed(1)} psi of average boost against ` : `Running this much load against `}${derived.compression.toFixed(1)}:1 static compression is what puts it there — compression multiplies manifold pressure, so both halves of that pair count.`,
      fix: `Back off boost, or lower static compression, unless the bottom end has been built for it. An iron block holds its main bores rounder under this load than an aluminium one, and either way there is no calibration change that removes the force — only ones that reduce it.`,
    });
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
