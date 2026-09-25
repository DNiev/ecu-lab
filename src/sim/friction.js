/**
 * Parasitic losses, expressed as mean effective pressures.
 *
 * Engine braking has two separate sources, and modelling only one made coast-down far
 * too slow. RUBBING friction rises with speed. PUMPING loss is the work the engine
 * does dragging air past a closed throttle — proportional to the vacuum it is pulling
 * (barometric minus MAP). On a closed throttle at high RPM the pumping term dominates,
 * which is exactly why a real engine drops revs so briskly.
 */

import { BARO_KPA } from './constants.js';
import { COEFF } from './coefficients.js';
import { clamp } from './math.js';
import { turbineBackPressureKpa } from './turbo.js';

/**
 * Rubbing (mechanical) friction as a mean effective pressure.
 *
 * Rises with engine speed, with valve spring load if stiffer springs are fitted, and
 * with the engine's architecture — main bearing count and any balance shafts.
 *
 * @param {number} rpm engine speed
 * @param {number} [springPa] extra FMEP from valve springs, Pa
 * @param {{bearingFmepPa?: number, balanceShaftFrac?: number}} [arch] architecture friction
 * @returns {number} rubbing FMEP, Pa
 */
export function rubbingFmepPa(rpm, springPa = 0, arch = {}) {
  const { bearingFmepPa = 0, balanceShaftFrac = 0 } = arch;
  const rpmShare = (1 - COEFF.SPRING_RPM_BIAS) + COEFF.SPRING_RPM_BIAS * (rpm / 7500);
  const base = COEFF.RUBBING_BASE_PA + rpm * COEFF.RUBBING_PER_RPM + springPa * rpmShare
    + bearingFmepPa;
  return base * (1 + balanceShaftFrac);
}

/**
 * Exhaust manifold pressure — what the piston has to push against.
 *
 * Naturally aspirated this is barometric plus system backpressure, which grows with
 * flow. With a turbine in the stream it is set by the turbine treated as a nozzle: see
 * `turbineBackPressureKpa` in turbo.js. It scales with FLOW, not with boost, which is
 * the correction that makes housing size a real trade — a small housing needs more
 * pressure upstream to pass the same exhaust, so it spools early and costs pumping work
 * at high flow.
 *
 * @param {object} input
 * @param {boolean} input.turboOn whether a turbine is in the stream
 * @param {number} input.exhaustFlowKgS mass flow leaving the cylinder
 * @param {number} input.exhaustK turbine inlet temperature
 * @param {{effectiveAreaM2: number}|null} [input.turbine]
 * @param {number} [input.wastegateRelief] fraction of turbine backpressure the gate bleeds
 * @param {number} [input.baroKpa] the pressure the tailpipe exhausts to
 * @returns {number} exhaust manifold pressure, kPa
 */
export function exhaustManifoldKpa({
  turboOn, exhaustFlowKgS, exhaustK, turbine = null, wastegateRelief = 0, baroKpa = BARO_KPA,
}) {
  const systemKpa = COEFF.EXHAUST_SYSTEM_KPA_PER_KGS * Math.max(0, exhaustFlowKgS);
  if (!turboOn || !turbine) return baroKpa + systemKpa;
  const turbineKpa = turbineBackPressureKpa(exhaustFlowKgS, exhaustK, turbine.effectiveAreaM2, baroKpa)
    - baroKpa;
  return baroKpa + systemKpa + turbineKpa * (1 - clamp(wastegateRelief, 0, 1));
}

/**
 * Pumping mean effective pressure — the gas-exchange loop, with its real sign.
 *
 * PMEP is exhaust manifold pressure minus intake manifold pressure. Throttled, that is
 * a loss and it dominates engine braking on overrun. Under boost with a well-matched
 * turbine it can go NEGATIVE, meaning the gas exchange loop does net positive work on
 * the piston — a real effect and one of the reasons a good turbo match is worth power
 * beyond what the extra airflow alone explains.
 *
 * The previous version clamped this at zero, so a boosted engine paid nothing for its
 * own backpressure and gained nothing from a well-sized turbine.
 *
 * @param {number} mapKpa manifold absolute pressure, kPa
 * @param {number} [empKpa] exhaust manifold pressure, kPa; defaults to barometric
 * @returns {number} pumping MEP, Pa — positive is a loss
 */
export function pumpingFmepPa(mapKpa, empKpa = BARO_KPA) {
  return (empKpa - mapKpa) * 1000;
}

/**
 * Total parasitic torque, used for the live engine's cranking drag.
 *
 * T = MEP × Vd / (4π) for a four-stroke.
 *
 * @param {number} rpm engine speed
 * @param {number} displacementL displacement, litres
 * @param {number} [mapKpa] manifold absolute pressure, kPa
 * @param {number} [springPa] extra FMEP from valve springs, Pa
 * @param {{bearingFmepPa?: number, balanceShaftFrac?: number}} [arch] architecture friction
 * @returns {number} friction torque, Nm
 */
export function frictionTorqueNm(rpm, displacementL, mapKpa = BARO_KPA, springPa = 0, arch = {}) {
  const fmep = rubbingFmepPa(rpm, springPa, arch) + pumpingFmepPa(mapKpa);
  return (fmep * (displacementL / 1000)) / (4 * Math.PI);
}
