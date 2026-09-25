/**
 * Fuel as a mixture, for a flex-fuel tank.
 *
 * A tank that has seen both pump gasoline and E85 holds whatever blend the last few fills
 * left, and every property that matters to the engine moves with it: how much air a
 * gram of it needs, how much energy it carries, how dense it is, how hard it resists
 * knock and how much it cools the charge as it evaporates.
 *
 * Mixed from the components the way each property actually combines: stoichiometric
 * ratio, heating value and latent heat by MASS, density by VOLUME. Octane does not mix
 * linearly — ethanol's first few percent buy far more knock resistance than its last —
 * so it follows a concave blend that lands on the E85 pump fuel at 85%.
 *
 * Anchored on the app's own E85 entry, so a flex tank at 85% is that fuel and not a
 * slightly different one.
 */

import { COEFF } from '../coefficients.js';
import { OCTANE_OPTS } from '../hardware.js';
import { clamp } from '../math.js';
import { ECU_COEFF as E } from './ecuCoefficients.js';

/** Pure ethanol's own properties, fitted so an 85% blend reproduces the E85 option. */
const ETHANOL = { stoich: 9.0, density: 0.789, lhv: 26.9e6 };

/**
 * Mass fraction of ethanol in a blend given its volume fraction.
 * @param {number} volFrac 0..1
 * @param {number} gasDensity
 * @returns {number}
 */
function massFraction(volFrac, gasDensity) {
  const e = volFrac * ETHANOL.density;
  return e / Math.max(1e-9, e + (1 - volFrac) * gasDensity);
}

/**
 * The fuel in a flex tank.
 *
 * @param {number} ethanolPct ethanol content by volume, 0..100
 * @param {{octane: number, stoich: number, density: number, lhv: number, bonus?: number}} [gasoline]
 *   the gasoline it is blended with
 * @returns {{label: string, octane: number, stoich: number, density: number, lhv: number,
 *   latentHeat: number, bonus: number, ethanolPct: number}}
 */
export function blendFuel(ethanolPct, gasoline = OCTANE_OPTS[1]) {
  const v = clamp(ethanolPct, 0, 100) / 100;
  const m = massFraction(v, gasoline.density);
  const e85 = OCTANE_OPTS.find((o) => o.label === 'E85');
  const m85 = massFraction(0.85, gasoline.density);
  const x = Math.min(1, v / 0.85);
  // Concave: ethanol's octane gain is front-loaded.
  const octane = v <= 0.85
    ? gasoline.octane + (e85.octane - gasoline.octane) * (1 - (1 - x) * (1 - x))
    : e85.octane + (v - 0.85) / 0.15 * E.ETHANOL_OCTANE_PAST_E85;
  const latentHeat = COEFF.FUEL_LATENT_HEAT_GASOLINE
    + (COEFF.FUEL_LATENT_HEAT_ETHANOL - COEFF.FUEL_LATENT_HEAT_GASOLINE) * (m / m85);
  return {
    label: `E${Math.round(v * 100)}`,
    octane,
    stoich: m * ETHANOL.stoich + (1 - m) * gasoline.stoich,
    density: v * ETHANOL.density + (1 - v) * gasoline.density,
    lhv: m * ETHANOL.lhv + (1 - m) * gasoline.lhv,
    latentHeat,
    bonus: (gasoline.bonus ?? 0) + ((e85.bonus ?? 0) - (gasoline.bonus ?? 0)) * x,
    ethanolPct: v * 100,
  };
}
