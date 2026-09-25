/**
 * SUPERCHARGERS: a compressor driven by a belt from the crank.
 *
 * A turbo's boost is whatever its turbine can afford to drive, and a wastegate trims it.
 * A supercharger has no such balance to find — its speed is the crank's times the pulley
 * ratio, so its boost is set by the hardware and the pulley, and the engine pays for
 * every psi out of its own crankshaft. Two families, which make boost in different ways:
 *
 * POSITIVE DISPLACEMENT (Roots, twin-screw). A fixed volume per rotor revolution, so the
 * blower pumps a mass flow and the manifold pressure rises until the engine swallows
 * exactly that much. The engine's appetite and the blower's delivery both scale with
 * crank speed, so there is boost from just off idle — the low-down torque these are known
 * for. What is left follows the engine's own breathing: the boost dips where the engine
 * fills best and climbs toward redline as it starts to choke, and rises with speed as the
 * leakage back through the clearances matters less.
 *
 *     m_blower = ρ_inlet · D_rev · N_blower · η_vol          η_vol = 1 − k·√(PR − 1) / (N/N_max)
 *
 * CENTRIFUGAL (ProCharger, Vortech, Paxton). An impeller throws air outward; the pressure
 * it makes is set by its tip speed, not by the engine, so boost climbs roughly with the
 * square of engine speed and peaks at redline:
 *
 *     PR = (1 + η · σ · U² / (c_p · T_inlet))^(γ/(γ−1))        U = π · D · N_impeller
 *
 * THE COST. Compressing air takes work, and on a supercharger the crank pays it:
 *
 *     W_drive = m · c_p · T_inlet · (PR^((γ−1)/γ) − 1) / η_adiabatic / η_drive
 *
 * The same adiabatic efficiency sets how hot the air leaves, so a Roots blower (about
 * 50%) both costs more power and heats the charge more than a twin-screw (70-78%) or a
 * centrifugal at its best (60-80%) making the same boost.
 *
 * Below wide-open throttle a bypass valve opens and the blower recirculates its own
 * air: no boost, and only its mechanical drag to pay.
 */

import { GAMMA_EXP, PSI_TO_KPA, R_AIR } from './constants.js';
import { COEFF } from './coefficients.js';
import { clamp } from './math.js';
import { compressorMap } from './compressorMap.js';
import { BLOWER_OPTS } from './hardware.js';

/**
 * How closed the bypass valve is. It is held open by manifold vacuum, so it only closes
 * as the throttle approaches wide open.
 *
 * @param {number} throttleFrac 0..1
 * @returns {number} 0 fully bypassed .. 1 all flow through the blower
 */
export function bypassClosedFrac(throttleFrac) {
  return clamp((throttleFrac - COEFF.BLOWER_BYPASS_OPEN_FRAC) / (COEFF.BLOWER_BYPASS_SHUT_FRAC - COEFF.BLOWER_BYPASS_OPEN_FRAC), 0, 1);
}

/**
 * Blower rotor (or impeller) speed.
 *
 * @param {object} blower a BLOWER_OPTS entry
 * @param {number} rpm crank speed
 * @param {number} driveRatio crank pulley ÷ blower pulley
 * @returns {number} rpm
 */
export function blowerSpeedRpm(blower, rpm, driveRatio) {
  return rpm * driveRatio * (blower.stepUp ?? 1);
}

/**
 * Adiabatic efficiency of a positive-displacement blower: best near the pressure ratio it
 * was designed for, falling away either side, and lower at low rotor speed where the air
 * leaking back through the clearances is heated a second time.
 *
 * @param {object} blower
 * @param {number} pr pressure ratio
 * @param {number} speedFrac rotor speed ÷ its rated maximum
 * @returns {number}
 */
export function displacementEfficiency(blower, pr, speedFrac) {
  const dPr = (pr - blower.prBest) / blower.prBest;
  const dN = speedFrac - COEFF.BLOWER_BEST_SPEED_FRAC;
  const eta = blower.etaPeak * (1 - COEFF.BLOWER_EFF_PR_FALLOFF * dPr * dPr) * (1 - COEFF.BLOWER_EFF_SPEED_FALLOFF * dN * dN);
  return clamp(eta, COEFF.BLOWER_EFF_FLOOR, blower.etaPeak);
}

/**
 * Air delivered by a positive-displacement blower, kg/s.
 *
 * @param {object} blower
 * @param {number} blowerRpm
 * @param {number} pr pressure ratio it is working against
 * @param {number} inletDensity kg/m³
 * @returns {number}
 */
export function displacementFlowKgS(blower, blowerRpm, pr, inletDensity) {
  const speedFrac = Math.max(0.05, blowerRpm / blower.maxRpm);
  const volEff = clamp(1 - blower.leak * Math.sqrt(Math.max(0, pr - 1)) / speedFrac, COEFF.BLOWER_MIN_VOL_EFF, 1);
  return inletDensity * (blower.dispL / 1000) * (blowerRpm / 60) * volEff;
}

/**
 * Pressure ratio a centrifugal impeller makes at a tip speed, before its map is applied.
 *
 * @param {object} blower
 * @param {number} impellerRpm
 * @param {number} eta adiabatic efficiency at the operating point
 * @param {number} inletK
 * @returns {number}
 */
export function centrifugalPressureRatio(blower, impellerRpm, eta, inletK) {
  const tipMS = Math.PI * blower.tipDiaM * impellerRpm / 60;
  const head = eta * COEFF.BLOWER_WORK_FACTOR * tipMS * tipMS / (COEFF.CP_AIR * inletK);
  return Math.pow(1 + head, 1 / GAMMA_EXP);
}

/**
 * Power the crank spends turning the blower, W.
 *
 * @param {number} flowKgS air through the blower
 * @param {number} pr
 * @param {number} eta adiabatic efficiency
 * @param {number} inletK
 * @param {object} blower
 * @param {number} blowerRpm
 * @returns {number}
 */
export function blowerDriveW(flowKgS, pr, eta, inletK, blower, blowerRpm) {
  const compression = flowKgS * COEFF.CP_AIR * inletK * (Math.pow(Math.max(1, pr), GAMMA_EXP) - 1) / Math.max(0.05, eta);
  const speedFrac = blowerRpm / (blower.maxRpm ?? blower.maxImpellerRpm);
  const drag = blower.dragWAtMax * speedFrac * speedFrac;
  const driveEff = blower.type === 'centrifugal' ? COEFF.BLOWER_GEAR_DRIVE_EFF : COEFF.BLOWER_BELT_DRIVE_EFF;
  return (compression + drag) / driveEff;
}

/**
 * What a supercharger makes at one operating point: the boost where its delivery and the
 * engine's appetite meet (positive displacement), or the boost its tip speed makes at the
 * flow the engine takes (centrifugal).
 *
 * @param {object} input
 * @param {object} input.blower a BLOWER_OPTS entry
 * @param {number} input.driveRatio crank pulley ÷ blower pulley
 * @param {number} input.rpm
 * @param {number} input.throttleFrac 0..1
 * @param {number} input.throttledKpa manifold pressure the throttle alone would give
 * @param {number} input.baroKpa
 * @param {number} input.inletK air temperature at the blower inlet
 * @param {(mapKpa: number, boostPsi: number, eta: number) => number} input.engineFlowAt
 *   air the engine swallows at a manifold pressure, kg/s, given the blower's efficiency
 *   (which sets how hot, and so how dense, the charge is)
 * @returns {{boostPsi: number, pr: number, eta: number, flowKgS: number, blowerRpm: number,
 *   overspeed: boolean, driveW: number, surge: boolean, choke: boolean, margin: number, bypass: number}}
 */
export function solveBlower({ blower, driveRatio, rpm, throttleFrac, throttledKpa, baroKpa, inletK, engineFlowAt }) {
  const blowerRpm = blowerSpeedRpm(blower, rpm, driveRatio);
  const maxRpm = blower.maxRpm ?? blower.maxImpellerRpm;
  const overspeed = blowerRpm > maxRpm;
  const bypass = bypassClosedFrac(throttleFrac);
  const inletDensity = (baroKpa * 1000) / (R_AIR * inletK);
  const speedFrac = blowerRpm / maxRpm;

  // Boost the hardware can make with every bit of its flow going to the engine.
  let full = { boostPsi: 0, pr: 1, eta: blower.etaPeak ?? blower.etaMax, flowKgS: 0, surge: false, choke: false, margin: 1 };
  const maxBoost = COEFF.BLOWER_SEARCH_MAX_PSI;
  if (blower.type === 'centrifugal') {
    // g(b) = what the impeller makes with the engine at b, minus b: falls with b. Bisect.
    const at = (b) => {
      const mapKpa = baroKpa + b * PSI_TO_KPA;
      const pr = mapKpa / baroKpa;
      let map = compressorMap(blower, 0, pr);
      let flow = engineFlowAt(mapKpa, b, map.eff);
      map = compressorMap(blower, flow, pr);
      flow = engineFlowAt(mapKpa, b, map.eff);
      let made = centrifugalPressureRatio(blower, blowerRpm, map.eff, inletK);
      // Past choke the impeller cannot pass more: pressure falls until the engine takes
      // what the inducer can.
      if (flow > blower.chokeFlowKgS) made = 1 + (made - 1) * Math.pow(blower.chokeFlowKgS / flow, 2);
      return { made: Math.max(0, (made - 1) * baroKpa / PSI_TO_KPA), pr, eta: map.eff, flow, map };
    };
    let lo = 0;
    let hi = maxBoost;
    if (at(0).made <= 0) {
      const s = at(0);
      full = { boostPsi: 0, pr: 1, eta: s.eta, flowKgS: s.flow, surge: false, choke: false, margin: s.map.margin };
    } else {
      for (let i = 0; i < COEFF.BLOWER_SOLVE_PASSES; i += 1) {
        const mid = (lo + hi) / 2;
        if (at(mid).made >= mid) lo = mid; else hi = mid;
      }
      const s = at(lo);
      full = { boostPsi: lo, pr: s.pr, eta: s.eta, flowKgS: s.flow, surge: s.map.surge, choke: s.map.choke, margin: s.map.margin };
    }
  } else {
    // f(b) = blower delivery minus engine appetite at b: delivery falls, appetite rises.
    const at = (b) => {
      const pr = (baroKpa + b * PSI_TO_KPA) / baroKpa;
      const eta = displacementEfficiency(blower, pr, speedFrac);
      const delivered = displacementFlowKgS(blower, blowerRpm, pr, inletDensity);
      const taken = engineFlowAt(baroKpa + b * PSI_TO_KPA, b, eta);
      return { gap: delivered - taken, pr, eta, delivered };
    };
    if (at(0).gap > 0) {
      let lo = 0;
      let hi = maxBoost;
      for (let i = 0; i < COEFF.BLOWER_SOLVE_PASSES; i += 1) {
        const mid = (lo + hi) / 2;
        if (at(mid).gap > 0) lo = mid; else hi = mid;
      }
      const s = at(lo);
      full = { boostPsi: lo, pr: s.pr, eta: s.eta, flowKgS: s.delivered, surge: false, choke: false, margin: 1 };
    } else {
      // A blower too small or turned too slowly to keep up would pull the manifold into
      // vacuum — but the bypass valve is held open by vacuum, so the engine breathes
      // around it instead and sees no boost, not a restriction.
      const s = at(0);
      full = { boostPsi: 0, pr: 1, eta: s.eta, flowKgS: s.delivered, surge: false, choke: false, margin: 1 };
    }
  }

  // The bypass recirculates what the engine does not take: the boost it passes on scales
  // with how shut it is, and so does the compression work.
  const boostPsi = full.boostPsi * bypass;
  const pr = (baroKpa + boostPsi * PSI_TO_KPA) / baroKpa;
  const mapKpa = throttledKpa + boostPsi * PSI_TO_KPA;
  const flowKgS = bypass > 0 ? engineFlowAt(mapKpa, boostPsi, full.eta) : 0;
  const driveW = blowerDriveW(flowKgS, pr, full.eta, inletK, blower, blowerRpm);
  return {
    boostPsi, pr, eta: full.eta, flowKgS, blowerRpm, overspeed, driveW,
    surge: bypass > 0 && full.surge, choke: bypass > 0 && full.choke, margin: full.margin, bypass,
  };
}

/**
 * The supercharger a build carries, or null. A turbo and a supercharger are not fitted
 * together; the turbo wins if both are set.
 *
 * @param {{turboOn?: boolean, blowerId?: string|null}} build
 * @returns {object|null} a BLOWER_OPTS entry
 */
export function blowerOf(build) {
  if (build.turboOn || !build.blowerId) return null;
  return BLOWER_OPTS.find((b) => b.id === build.blowerId) ?? null;
}
