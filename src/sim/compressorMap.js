/**
 * The compressor map: efficiency, surge and choke at an operating point. Shared by the
 * turbo's compressor and a centrifugal supercharger's, which are the same machine driven
 * two different ways.
 */

import { COEFF } from './coefficients.js';
import { clamp } from './math.js';

/**
 * Where this operating point sits on the compressor map, and what that costs.
 *
 * The map is a parametric island rather than a digitised one: peak efficiency at a
 * design flow and pressure ratio, falling off elliptically away from it, bounded by a
 * surge line on the low-flow side and a choke line on the high-flow side. That is enough
 * to reproduce the two things a single efficiency number cannot — a big compressor
 * surging on a small engine at low RPM, and a small one choking at the top end — and
 * both are matching failures a tuner has to be able to see.
 *
 * @param {object} compressor a COMPRESSOR_OPTS entry
 * @param {number} flowKgS air the engine is actually drawing
 * @param {number} pressureRatio compressor outlet over inlet
 * @returns {{eff: number, surge: boolean, choke: boolean, margin: number}} `margin` is
 *   the fraction of the flow range between the surge and choke lines that is left, so
 *   0 means hard against a limit and 1 means dead centre
 */
export function compressorMap(compressor, flowKgS, pressureRatio) {
  const pr = Math.max(1, pressureRatio);
  // Surge: below this flow, the pressure ratio cannot be sustained and flow reverses.
  const surgeFlow = compressor.surgeSlope * (pr - 1);
  const surge = pr > COEFF.SURGE_MIN_PR && flowKgS < surgeFlow;
  const choke = flowKgS > compressor.chokeFlowKgS;
  // Elliptical fall-off from the island centre, in normalised flow and pressure ratio.
  const dFlow = flowKgS / compressor.pkFlowKgS - 1;
  const dPr = pr / compressor.pkPr - 1;
  const distance = dFlow * dFlow + COEFF.MAP_PR_WEIGHT * dPr * dPr;
  let eff = compressor.etaMax * (1 - COEFF.MAP_EFF_FALLOFF * distance);
  // Past either limit line the map does not merely get worse, it stops working: a
  // surging compressor is not pumping and a choked one is making heat, not pressure.
  if (surge) eff *= COEFF.SURGE_EFF_PENALTY;
  if (choke) eff *= COEFF.CHOKE_EFF_PENALTY;
  const span = Math.max(1e-6, compressor.chokeFlowKgS - surgeFlow);
  return {
    eff: clamp(eff, COEFF.MAP_EFF_FLOOR, compressor.etaMax),
    surge,
    choke,
    margin: clamp(Math.min(flowKgS - surgeFlow, compressor.chokeFlowKgS - flowKgS) / span, 0, 1),
  };
}
