/**
 * The nitrous controller: when the solenoids open, how much of the shot they pass, and
 * what that means in nitrous, fuel and spark.
 *
 * A real controller is a window (RPM, throttle, coolant) and, on a progressive one, a
 * pulse-width ramp from a starting percentage to the full shot. The physics of what the
 * nitrous then does lives in src/sim/nitrous.js and the cycle; this only decides the dose.
 */

import { BARO_KPA, PSI_TO_KPA } from '../constants.js';
import { clamp } from '../math.js';
import { bottlePressurePsi, nitrousFlowKgS, wetKitFuelKgS } from '../nitrous.js';

/**
 * Share of the shot the controller is passing, 0..1.
 *
 * @param {object} input
 * @param {object} input.ncal the calibration's `nitrous` section
 * @param {number} input.rpm
 * @param {number} input.throttlePct
 * @param {number} input.ectC coolant temperature
 * @param {number} input.sinceOnS seconds since the window opened, for the progressive ramp
 * @returns {number}
 */
export function nitrousFraction({ ncal, rpm, throttlePct, ectC, sinceOnS }) {
  if (rpm < ncal.minRpm || rpm > ncal.maxRpm || throttlePct < ncal.minTpsPct || ectC < ncal.minEctC) return 0;
  const start = clamp(ncal.startPct / 100, 0, 1);
  const ramp = ncal.rampS > 0 ? clamp(sinceOnS / ncal.rampS, 0, 1) : 1;
  return start + (1 - start) * ramp;
}

/**
 * What the kit delivers at a dose: nitrous through its jet from the bottle, a wet kit's
 * fuel through its own jet, and the fuel the ECU adds or takes out through the injectors —
 * a dry kit's fuel, plus the tuner's correction. Both ECU amounts are shares of the fuel the
 * shot needs, so they scale with the nitrous: its share of the charge, and so the error
 * the correction answers, is largest low in the rev range.
 *
 * @param {object} input
 * @param {{kit: 'wet'|'dry', shotHp: number}} input.kit
 * @param {number} input.frac share of the shot, 0..1
 * @param {number} input.bottleK bottle temperature
 * @param {number} input.mapKpa manifold pressure the nozzle sprays into
 * @param {number} [input.baroKpa]
 * @param {{stoich: number}} input.fuel
 * @param {number} input.dryFuelPct the calibration's dry-kit fuel, percent of what the kit needs
 * @param {number} [input.fuelTrimPct] the tuner's correction while spraying, percent of the
 *   shot's fuel, either sign
 * @returns {{n2oKgS: number, wetFuelKgS: number, injFuelKgS: number, bottlePsi: number}}
 *   `injFuelKgS` is what the ECU adds through the injectors; negative takes fuel out
 */
export function nitrousDelivery({ kit, frac, bottleK, mapKpa, baroKpa = BARO_KPA, fuel, dryFuelPct, fuelTrimPct = 0 }) {
  const bottlePsi = bottlePressurePsi(bottleK);
  if (!(frac > 0)) return { n2oKgS: 0, wetFuelKgS: 0, injFuelKgS: 0, bottlePsi };
  const manifoldPsi = Math.max(0, (mapKpa - baroKpa) / PSI_TO_KPA);
  const n2oKgS = nitrousFlowKgS({ shotHp: kit.shotHp, bottlePsi, bottleK, manifoldPsi }) * frac;
  const kitFuelKgS = wetKitFuelKgS(kit.shotHp, fuel) * frac;
  return {
    n2oKgS,
    wetFuelKgS: kit.kit === 'wet' ? kitFuelKgS : 0,
    injFuelKgS: kitFuelKgS * (((kit.kit === 'dry' ? dryFuelPct : 0) + fuelTrimPct) / 100),
    bottlePsi,
  };
}
