/**
 * The bottom end's speed limit: how fast the pistons and rods can be swung before they are
 * outside what they were built for.
 *
 * Mean piston speed is the figure engine designers rate a reciprocating assembly by, because
 * the inertia load on a rod, the ring's grip on the bore and the piston's skirt loads all
 * grow with it. Published practice (Wikipedia, "Mean piston speed", from its cited sources):
 *
 *   ~16 m/s          medium-speed petrol car engines
 *   ~20-25 m/s       high-speed petrol engines, sports cars and motorcycles
 *   ~25 m/s          NASCAR Cup and Formula One
 *   26.9 m/s         Audi R8 5.2 V10, the highest of any production car
 *   ~30 m/s          Top Fuel and MotoGP
 *
 * These are PRACTICE BANDS, not failure points: an engine past its band does not explode
 * at the next RPM, it wears its rod bearings, rings and pins out of all proportion, and the
 * risk of a thrown rod climbs with the square of the speed (the inertia load does). The
 * simulator flags the band, in BUILD and in the pull log; it does not model the failure.
 */

import { COEFF } from './coefficients.js';

/** Mean piston speed, m/s (as engine.js's `meanPistonSpeedMs`, kept here so the two modules do not import each other). */
const meanPistonSpeedMs = (strokeMm, rpm) => 2 * (strokeMm / 1000) * (rpm / 60);

/**
 * What a player can build the bottom end from. `limitMs` is the mean piston speed each is
 * good for, from the bands above:
 *  - production: cast pistons and production rods, the top of the medium-speed band and
 *    where this app's own factory engines sit at their limiters (18-20.5 m/s);
 *  - forged: forged pistons and forged steel rods, the top of the high-speed band;
 *  - race: lightweight race assemblies (titanium or premium steel rods, short-skirt forged
 *    pistons), the production record and the NASCAR / F1 figure with margin; past it is
 *    Top Fuel and MotoGP territory, which no street assembly reaches.
 */
export const BOTTOM_END_OPTS = Object.freeze([
  { id: 'production', label: 'Production (cast pistons, production rods)', limitMs: 21 },
  { id: 'forged', label: 'Forged pistons and rods', limitMs: 25 },
  { id: 'race', label: 'Race (lightweight pistons, titanium or premium rods)', limitMs: 27 },
]);

/** The assembly a player's own engine is assumed to have when they do not say. */
export const DEFAULT_BOTTOM_END = 'production';

/**
 * The bottom end's limit for an engine as built.
 *
 * A catalogue engine carries its maker's assembly, rated to its own factory limiter
 * (`bottomEndRatedRpm`, set when the preset is loaded): that IS the speed its parts were
 * validated to, so raising the redline past it is past the rating whatever the band says.
 *
 * @param {{stroke: number, bottomEnd?: string, bottomEndRatedRpm?: number}} cfg
 * @returns {{id: string, label: string, limitMs: number, ratedRpm: number}} `ratedRpm` is
 *   the engine speed at which this stroke reaches the limit
 */
export function bottomEndLimit(cfg) {
  if (cfg.bottomEndRatedRpm) {
    return {
      id: 'factory', label: 'Factory assembly',
      limitMs: meanPistonSpeedMs(cfg.stroke, cfg.bottomEndRatedRpm), ratedRpm: cfg.bottomEndRatedRpm,
    };
  }
  const opt = BOTTOM_END_OPTS.find((o) => o.id === cfg.bottomEnd) ?? BOTTOM_END_OPTS.find((o) => o.id === DEFAULT_BOTTOM_END);
  return { id: opt.id, label: opt.label, limitMs: opt.limitMs, ratedRpm: Math.floor(opt.limitMs * 60 / (2 * cfg.stroke / 1000) + 1e-6) };
}

/**
 * Piston motion at an engine speed: mean speed, and peak acceleration at TDC from the
 * slider-crank, a = r ω² (1 + r / l) — the inertia load per gram of reciprocating mass.
 *
 * @param {number} strokeMm
 * @param {number} rpm
 * @returns {{meanSpeedMs: number, peakAccelMs2: number}}
 */
export function pistonMotion(strokeMm, rpm) {
  const r = strokeMm / 2000;
  const omega = (rpm * 2 * Math.PI) / 60;
  return { meanSpeedMs: meanPistonSpeedMs(strokeMm, rpm), peakAccelMs2: r * omega * omega * (1 + 1 / COEFF.ROD_RATIO) };
}
