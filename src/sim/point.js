/**
 * The simulation core: one operating point, fully solved.
 *
 * `evaluatePoint` is the heart of the whole app — everything else feeds it or
 * displays its output. It is commented step by step in the order an ECU actually
 * works: read load, compute air mass, decide fuel, convert to pulse width, check
 * knock, burn, subtract losses, report torque.
 *
 * It is a pure function with no React dependency, which is what makes the whole
 * physics layer testable in plain Node.
 */

import {
  BARO_KPA, DRIVETRAIN_EFF, INJ_DEADTIME_MS, R_AIR,
} from './constants.js';
import { COEFF } from './coefficients.js';
import { rubbingFmepPa, pumpingFmepPa } from './friction.js';
import { bestPowerAfr } from './manifold.js';
import { clamp, interp1 } from './math.js';
import { BASE_KNOCK_LIMIT_91, RPM } from './tables.js';
import { chargeTempK } from './thermo.js';

/**
 * @typedef {object} PointInput
 * @property {number} rpm engine speed
 * @property {number} mapKpa manifold absolute pressure, kPa
 * @property {number} boostPsi gauge boost, psi
 * @property {number} veVal the ECU's VE table value at this point, percent — what the
 *   ECU BELIEVES the cylinder filling is. Drives the fuel calculation.
 * @property {number} [veActualVal] TRUE cylinder filling at this point, percent — what
 *   the hardware really flows. Drives torque, knock and the measured airflow. Defaults
 *   to `veVal`, which models a perfectly calibrated VE table.
 * @property {number} timingVal commanded spark advance, degrees BTDC
 * @property {number} afrCommanded commanded air:fuel ratio, gasoline-equivalent
 * @property {number} octaneBonus knock margin from fuel octane, degrees
 * @property {{stoich: number, density: number, lhv: number}} fuel
 * @property {object} mods bolt-ons fitted, plus `turboFitted`
 * @property {number} mafScalar player's MAF calibration multiplier
 * @property {number} mafErrorBase physical MAF error introduced by hardware
 * @property {number} injectorCc injector size actually fitted, cc/min
 * @property {number} ecuInjectorCc injector size the ECU believes is fitted, cc/min
 * @property {import('./engine.js').DerivedEngine} derived
 * @property {{boostCeiling: number}} compressor
 */

/**
 * Solves one steady-state operating point.
 *
 * @param {PointInput} input
 * @returns {object} the full datalog record for this point
 */
export function evaluatePoint({
  rpm, mapKpa, boostPsi, veVal, veActualVal, timingVal, afrCommanded,
  octaneBonus, fuel, mods, mafScalar, mafErrorBase,
  injectorCc, ecuInjectorCc, derived, compressor,
}) {
  const compressorOver = boostPsi > compressor.boostCeiling;
  const chargeK = chargeTempK(boostPsi, mods.intercooler);
  const chargeC = chargeK - 273.15;

  // --- AIR CHARGE: ideal gas law. MAP already carries load, so VE is used purely as
  // an efficiency term here — no separate throttle multiplier (that would
  // double-count load, which is exactly the Alpha-N mistake).
  //
  // TWO VE NUMBERS, DOING DIFFERENT JOBS. This distinction is the whole basis of
  // closed-loop VE tuning and it must not be collapsed back into one variable:
  //
  //   veActual   what the hardware genuinely flows. Physics. Sets the air that is
  //              really in the cylinder, so it sets torque, knock and measured MAF.
  //   veVal      what the ECU's table CLAIMS the cylinder flows. Calibration. The ECU
  //              has no airflow oracle — it fuels from this number and nothing else.
  //
  // When the table is wrong, the ECU fuels for air that is not there (or misses air
  // that is), and the mixture comes back off target. That gap is the entire signal a
  // fuel-trim histogram measures, and correcting the table toward the truth is what
  // makes it converge. With a single shared VE the gap is identically zero, the
  // histogram has nothing to read, and no amount of iterating can ever close it.
  const veActual = veActualVal ?? veVal;
  const vCylM3 = (derived.displacementL / derived.cyl) / 1000;
  const airDensity = (mapKpa * 1000) / (R_AIR * chargeK);
  const airChargeG = (veActual / 100) * vCylM3 * airDensity * 1000;
  const airChargeBelievedG = (veVal / 100) * vCylM3 * airDensity * 1000;
  // The MAF reading reports real airflow — a sensor cannot read a table.
  const mafGps = (airChargeG * derived.cyl * (rpm / 2)) / 60;

  // --- MAF error / fuel trim. Open loop above ~85 kPa (near WOT).
  const netFactor = mafErrorBase * mafScalar;
  const openLoop = mapKpa >= 85;
  const effFactor = 1 + (netFactor - 1) * (openLoop ? 1 : 0.25);
  const trimPct = (effFactor - 1) * 100;

  // --- FUEL MASS from lambda and the fuel's own stoichiometric ratio. Computed from
  // the air the ECU BELIEVES it has, because that is all the ECU knows.
  const lambdaCommanded = (afrCommanded / 14.7) / effFactor;
  const fuelMassG = airChargeBelievedG / (lambdaCommanded * fuel.stoich);

  // --- INJECTOR: the ECU computes pulse width for the injector size it has been TOLD
  // it has. Fit bigger injectors without rescaling and every pulse delivers
  // proportionally more fuel than intended — the classic "went rich after upgrading
  // injectors" mistake real tuners fix with a scaling constant.
  const ecuGramsPerMs = (ecuInjectorCc * fuel.density) / 60000;
  const actualGramsPerMs = (injectorCc * fuel.density) / 60000;
  const cycleTimeMs = 120000 / rpm;
  const pulseWidthMs = fuelMassG / ecuGramsPerMs + INJ_DEADTIME_MS;
  const maxPulseMs = cycleTimeMs * 0.9;
  const dutyPct = clamp((pulseWidthMs / cycleTimeMs) * 100, 0, 220);

  const cappedPw = Math.min(pulseWidthMs, maxPulseMs);
  const fuelLimited = pulseWidthMs > maxPulseMs;
  const deliveredFuelG = Math.max(1e-6, (cappedPw - INJ_DEADTIME_MS) * actualGramsPerMs);
  const lambdaActual = airChargeG / (deliveredFuelG * fuel.stoich);
  const actualAfr = lambdaActual * 14.7;

  // --- KNOCK ENVELOPE. MAP drives the load term directly: low manifold pressure
  // means low cylinder pressure and lots of spare timing margin.
  const bestAfr = bestPowerAfr(boostPsi);
  const afrDelta = actualAfr - bestAfr;
  // Knock is driven by how much charge is actually TRAPPED in the cylinder, not by
  // manifold pressure alone. Two engines at the same MAP but different volumetric
  // efficiency see different peak pressures — which is exactly why a big-cam engine
  // that breathes better also needs a few degrees less timing than a stock one.
  // Uses ACTUAL filling: knock is caused by the charge really in the cylinder, and the
  // end gas does not care what the ECU's table claims.
  const chargeIndex = (veActual / 100) * (mapKpa / BARO_KPA);
  // Knock margin is not linear in charge. Doubling the trapped mass roughly doubles
  // peak pressure, so margin scales with the RATIO of charge to the reference, not
  // the difference. At deep vacuum an engine effectively cannot knock at all — which
  // is why factory cruise maps carry 40-50 deg of advance and never complain.
  const loadBonus = chargeIndex >= COEFF.KNOCK_CHARGE_REF
    ? (COEFF.KNOCK_CHARGE_REF - chargeIndex) * COEFF.KNOCK_CHARGE_GAIN
    : (COEFF.KNOCK_CHARGE_REF / Math.max(chargeIndex, 0.04) - 1) * COEFF.KNOCK_CHARGE_RATIO_GAIN;
  const overBoost = Math.max(0, boostPsi - compressor.boostCeiling);
  const iatPenalty = Math.max(0, chargeC - 25) * COEFF.KNOCK_IAT_PER_C;
  const modsThresholdBonus = (mods.headers ? 1.5 : 0) + (mods.exhaust ? 0.5 : 0);
  let threshold = interp1(RPM, BASE_KNOCK_LIMIT_91, rpm) + octaneBonus + loadBonus + modsThresholdBonus
    + derived.configKnockBonus + derived.materialKnockBonus + derived.compressionKnockAdj
    - iatPenalty - overBoost * COEFF.KNOCK_OVERBOOST_PENALTY;
  // A lean mixture only threatens knock when there is real cylinder pressure behind
  // it. At light cruise (low MAP) an engine happily runs 14.7:1 with 40 deg of advance
  // and never knocks — which is exactly why factory cruise maps look like that. Under
  // boost the same leanness is dangerous. So scale the mixture terms by charge
  // pressure rather than applying them flat.
  const pressureFactor = clamp(Math.pow(mapKpa / BARO_KPA, 1.5), 0.05, 2.6);
  threshold -= Math.max(0, afrDelta) * COEFF.KNOCK_LEAN_PENALTY * pressureFactor;
  threshold += Math.min(COEFF.KNOCK_RICH_CAP, Math.max(0, -afrDelta) * COEFF.KNOCK_RICH_BONUS)
    * clamp(pressureFactor, 0.3, 1.5);

  const margin = threshold - timingVal;
  const knockPull = margin < 0 ? Math.min(COEFF.MAX_KNOCK_RETARD, -margin) : 0;
  const usedTiming = timingVal - knockPull;

  // --- COMBUSTION -> TORQUE
  const mbtIdeal = 24 + ((rpm - 1500) / 6000) * 12 - (mapKpa / BARO_KPA) * 6;
  const timingEff = Math.max(COEFF.EFFICIENCY_FLOOR, 1 - COEFF.TIMING_FALLOFF * Math.pow(usedTiming - mbtIdeal, 2));
  const afrEff = Math.max(COEFF.EFFICIENCY_FLOOR, 1 - COEFF.AFR_FALLOFF * Math.pow(actualAfr - bestAfr, 2));
  const burnedFuelG = Math.min(deliveredFuelG, airChargeG / fuel.stoich);
  const energyJ = (burnedFuelG / 1000) * fuel.lhv;

  // INDICATED work on the piston, expressed as a mean effective pressure.
  const indicatedJ = energyJ * derived.thermalEff * timingEff * afrEff;
  const imepPa = indicatedJ / vCylM3;

  // The engine must pay for its own rubbing friction and for pumping air past a
  // partly closed throttle before anything reaches the crank. Pumping loss is the
  // vacuum it is working against — which is precisely why part-throttle running is
  // inefficient and why a throttled engine brakes itself on overrun.
  const fmepPa = rubbingFmepPa(rpm, derived.springPa || 0) + pumpingFmepPa(mapKpa);
  const bmepPa = imepPa - fmepPa;

  // T = BMEP × Vd / (4π) for a four-stroke; power follows from torque.
  const torqueNmCrank = (bmepPa * (derived.displacementL / 1000)) / (4 * Math.PI);
  const powerW = torqueNmCrank * (2 * Math.PI * rpm / 60);
  const hp = (powerW / 745.7) * DRIVETRAIN_EFF;
  const torque = torqueNmCrank * 0.7376 * DRIVETRAIN_EFF;
  const bsfc = powerW > 0 ? (burnedFuelG * derived.cyl * (rpm / 2) * 60 / 453.6) / (powerW / 745.7) : 0;

  const egtProxy = knockPull * 22 + Math.max(0, actualAfr - bestAfr) * 45 + boostPsi * 6;
  const leanRisk = actualAfr > COEFF.LEAN_DAMAGE_AFR && mapKpa >= 85;
  // Excessively rich is its own failure mode, not just "safe". Unburnt fuel washes the
  // oil film off the bores, fouls plugs, dumps raw fuel into the catalyst and costs
  // real power — a genuinely damaging condition, just a slower one than knock.
  const richRisk = lambdaActual < COEFF.RICH_DAMAGE_LAMBDA && mapKpa >= 55;
  const valveRisk = leanRisk && boostPsi > 3;
  const mafFlag = Math.abs(trimPct) > 8 && (mods.intake || mods.turboFitted);
  const injMismatch = Math.abs(injectorCc / ecuInjectorCc - 1) > 0.05;

  return {
    rpm, hp: Math.round(hp), torque: Math.round(torque),
    // `ve` is the measured (true) filling, which is what a datalog and the fuel-trim
    // histogram need; `veTable` is what the ECU was working from.
    ve: Number(veActual.toFixed(1)),
    veTable: Number(veVal.toFixed(1)),
    afr: Number(actualAfr.toFixed(2)), afrCommanded: Number(afrCommanded.toFixed(2)),
    lambda: Number(lambdaActual.toFixed(3)),
    timing: Number(usedTiming.toFixed(1)), commandedTiming: Number(timingVal.toFixed(1)),
    duty: Math.round(dutyPct), pw: Number(pulseWidthMs.toFixed(2)),
    maf: Number(mafGps.toFixed(1)), map: Number(mapKpa.toFixed(0)),
    iat: Number(chargeC.toFixed(0)), airCharge: Number(airChargeG.toFixed(3)),
    boostPsi: Number(boostPsi.toFixed(1)), trimPct: Number(trimPct.toFixed(1)),
    threshold: Number(threshold.toFixed(1)), margin: Number(margin.toFixed(1)),
    chargeIndex: Number(chargeIndex.toFixed(3)),
    mbtIdeal: Number(mbtIdeal.toFixed(1)), timingEff, afrEff, openLoop,
    egt: Math.round(720 + egtProxy),
    imep: Number((imepPa / 100000).toFixed(2)), bmep: Number((bmepPa / 100000).toFixed(2)),
    fmep: Number((fmepPa / 100000).toFixed(2)), bsfc: Number(bsfc.toFixed(3)),
    bestAfr: Number(bestAfr.toFixed(2)),
    knock: knockPull > 0, knockPull, fuelLimited, leanRisk, richRisk, valveRisk,
    mafFlag, compressorOver, injMismatch,
  };
}
