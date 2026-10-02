/**
 * Manifold pressure and best-power mixture.
 *
 * Manifold pressure is the real load signal. Throttle sets how much of atmospheric
 * pressure reaches the manifold; boost adds on top of that. Everything downstream
 * indexes off MAP, exactly as a speed-density ECU does.
 */

import { BARO_KPA, PSI_TO_KPA } from './constants.js';
import { COEFF } from './coefficients.js';
import { clamp, interp1 } from './math.js';
import { REACHABLE_SLACK_KPA, RPM } from './tables.js';

/**
 * WHAT USED TO BE HERE
 * `computeManifold` solved boost as `target x spool x throttle^2`, with spool a linear
 * ramp in engine speed. `solveInduction` in turbo.js replaced it: boost now comes from a
 * turbine/compressor power balance, so it responds to exhaust energy rather than to RPM,
 * and the player's target is a wastegate ceiling instead of a promise.
 *
 */

/**
 * Gasoline-equivalent AFR that makes best power at a given boost level.
 *
 * Best-power mixture is NOT a single number. Research and tuner practice put
 * naturally aspirated best torque near lambda 0.85–0.92 (~12.5–13.5:1 on gasoline)
 * and forced induction meaningfully richer, near lambda 0.82–0.85 (~12.0–12.5:1) —
 * the extra fuel under boost is charge cooling, bought deliberately to hold off knock.
 *
 * @param {number} boostPsi gauge boost, psi
 * @returns {number} best-power AFR, gasoline-equivalent
 */
export function bestPowerAfr(boostPsi) {
  return COEFF.BEST_AFR_NA - clamp(boostPsi * COEFF.BEST_AFR_BOOST_SHIFT, 0, COEFF.BEST_AFR_BOOST_CAP);
}

/**
 * Highest manifold pressure the boost controller is even asking for at this speed, kPa.
 *
 * THE ONE DEFINITION OF REACHABLE. `calibrationAdvice` and `factoryCalibration` both
 * decide which row gaps an engine really runs through with it. The advisor passes the
 * player's curve; the generator passes the preset's peak boost at every RPM, which is
 * stricter — see the interpolation pass in `factoryCalibration` for why.
 *
 * @param {object} input
 * @param {boolean} input.turboOn
 * @param {number[]} input.boostCurve boost target per `RPM` breakpoint, psi
 * @param {number} input.rpm
 * @param {number} [input.boostPsi] boost the engine is known to make here, for a
 *   supercharger, whose boost is its own physics rather than a curve anyone asked for
 * @returns {number} kPa absolute
 */
export function reachableKpa({ turboOn, boostCurve, rpm, boostPsi }) {
  const boost = boostPsi ?? (turboOn ? interp1(RPM, boostCurve, rpm) : 0);
  return BARO_KPA + REACHABLE_SLACK_KPA + Math.max(0, boost) * PSI_TO_KPA;
}
