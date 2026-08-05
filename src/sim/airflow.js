/**
 * Airflow model — hardware in, VE table out.
 *
 * This is the ONLY place hardware is allowed to change how the engine breathes. If
 * you are adding a part, it belongs here (or in the knock/fuel terms of
 * `point.js`) — never as a bonus multiplier on power.
 */

import { BARO_KPA } from './constants.js';
import { COEFF } from './coefficients.js';
import { CYL_COUNT, MOD_BONUS, idealExhaustDiameter } from './hardware.js';
import { CAM_BASE_DURATION, camPeakShiftRpm, charMultiplier, valveFloatRpm } from './engine.js';
import { clamp, interp1 } from './math.js';
import { DEFAULT_VE, LOAD, RPM } from './tables.js';

/**
 * Computes the volumetric efficiency table this hardware would actually flow.
 *
 * Bore/stroke bias is baked directly into the VISIBLE VE table rather than applied as
 * a hidden multiplier at simulation time — so changing bore/stroke on BUILD actually
 * moves the numbers you see and edit, the way a real hardware change would show up
 * the next time a tuner logs airflow.
 *
 * @param {import('./engine.js').EngineConfig} cfg short-block design
 * @param {{intake: boolean, exhaust: boolean, headers: boolean, intercooler: boolean}} mods bolt-ons
 * @param {object} [hw] induction hardware
 * @param {boolean} [hw.turboOn]
 * @param {{topEndMult: number}|null} [hw.turbine]
 * @param {number|null} [hw.exhaustDia] exhaust diameter, inches
 * @param {{stoich: number}|null} [hw.fuel]
 * @param {number} [hw.peakBoostPsi] peak boost target, psi — raises the ideal exhaust
 *   diameter, because sizing follows power and boost makes power
 * @returns {number[][]} VE table, percent, indexed [LOAD][RPM]
 */
export function computeHardwareVE(cfg, mods, hw = {}) {
  const { turboOn = false, turbine = null, exhaustDia = null, fuel = null, peakBoostPsi = 0 } = hw;
  const ratio = cfg.bore / cfg.stroke;
  const cyl = CYL_COUNT[cfg.configuration];
  const displacementL = (Math.PI / 4 * Math.pow(cfg.bore / 10, 2) * (cfg.stroke / 10) * cyl) / 1000;
  const perCylL = displacementL / cyl;
  // Shared with the advisory and the Engineer Score, so the physics and the advice
  // can no longer disagree about what "correctly sized" means.
  const idealDia = idealExhaustDiameter(displacementL, turboOn ? peakBoostPsi : 0);
  const diaError = exhaustDia != null ? exhaustDia - idealDia : 0;

  // Smaller individual cylinders carry proportionally more valve area for their
  // volume, so they keep filling better at high RPM. Big single cylinders fall off.
  const cylBreathing = clamp((0.62 - perCylL) * 0.10, -0.05, 0.05);

  // Higher compression means less clearance volume, so less burnt gas is left behind
  // to dilute the incoming charge — a small but real VE gain.
  const crFactor = 1 + (cfg.compression - 10.3) * COEFF.VE_PER_COMPRESSION_POINT;

  // An aluminium head runs cooler, so the incoming charge picks up less heat on the
  // way in and stays denser.
  const headFactor = cfg.headMaterial === 'Aluminum' ? COEFF.VE_ALUMINIUM_HEAD_GAIN : 1.0;

  // Fuels with high latent heat of vaporisation cool the charge as they evaporate,
  // which raises density. E85 is markedly better at this than gasoline.
  const fuelFactor = fuel
    ? (fuel.stoich < 12 ? COEFF.VE_E85_CHARGE_COOLING : fuel.stoich < 14.7 ? 1.005 : 1.0)
    : 1.0;

  // Camshaft: shifting where the VE peak sits is the honest way to model duration. A
  // longer cam is evaluated as if the engine were running SLOWER than it is, so the
  // whole breathing curve slides up the RPM range — top end gained, bottom lost.
  const camDuration = cfg.camDuration ?? CAM_BASE_DURATION;
  const springRate = cfg.springRate ?? 50;
  const camShift = camPeakShiftRpm(camDuration);
  // More open time = more flow area-seconds.
  const flowGain = 1 + (camDuration - CAM_BASE_DURATION) * COEFF.CAM_FLOW_GAIN_PER_DEG;
  const floatRpm = valveFloatRpm(springRate, camDuration);

  return DEFAULT_VE.map((row, ri) => row.map((v, ci) => {
    const rpm = RPM[ci];
    const norm = (rpm - 4500) / 3000;      // -1 at 1500, +1 at 7500
    const loadScale = clamp(LOAD[ri] / BARO_KPA, 0, 1);

    // Sample the baseline breathing curve at the cam-shifted engine speed.
    const camRpm = clamp(rpm - camShift, 1200, 8200);
    const baseVe = interp1(RPM, row, camRpm);
    let val = baseVe * flowGain * charMultiplier(rpm, ratio);

    // Valve float: past the spring's limit the valve stops following the lobe and
    // cylinder filling collapses. This is the cliff you feel at the top of an
    // over-cammed, under-sprung engine.
    if (rpm > floatRpm) {
      val *= clamp(1 - (rpm - floatRpm) / COEFF.FLOAT_COLLAPSE_RPM, COEFF.FLOAT_COLLAPSE_FLOOR, 1);
    }
    val *= 1 + cylBreathing * Math.max(0, norm);
    val *= crFactor * headFactor * fuelFactor;

    // Bolt-ons: measured airflow gains, weighted toward the RPM where they work.
    if (mods.intake) val += MOD_BONUS.intake[ci] * loadScale;
    if (mods.exhaust) val += MOD_BONUS.exhaust[ci] * loadScale;
    if (mods.headers) val += MOD_BONUS.headers[ci] * loadScale;

    // Exhaust diameter: undersized chokes the top end, oversized kills low-RPM
    // scavenging velocity. Both directions cost VE, in different places.
    if (diaError < 0) val *= 1 + diaError * COEFF.VE_EXHAUST_UNDERSIZE * Math.max(0, norm);
    else if (diaError > 0) val *= 1 - diaError * COEFF.VE_EXHAUST_OVERSIZE * Math.max(0, -norm);

    // A turbine in the exhaust stream is a restriction. Small housings choke the top
    // end; large ones flow better up high but hurt low-RPM scavenging.
    if (turboOn && turbine) {
      val *= 1 + turbine.topEndMult * Math.max(0, norm);
      val *= COEFF.VE_TURBINE_BACKPRESSURE;
    }

    return Number(clamp(val, 10, 130).toFixed(1));
  }));
}
