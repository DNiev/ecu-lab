/**
 * Engine architecture — turns the player's short-block design into the derived
 * properties the physics needs.
 *
 * Bore, stroke, compression, materials, camshaft and valve springs are all
 * player-editable and feed real physics downstream.
 */

import { AMBIENT_K, CHAR_SCALE, GAMMA_AIR, R_AIR, SONIC_AMBIENT_MS } from './constants.js';
import { COEFF } from './coefficients.js';
import { BASELINE_MAIN_BEARINGS, CYL_COUNT, MAIN_BEARINGS, hasBalanceShafts } from './hardware.js';

/** Stock camshaft duration, crank degrees. */
export const CAM_BASE_DURATION = 210;

/** Rev limit assumed when an engine does not state one. */
export const DEFAULT_REDLINE_RPM = 7500;

/**
 * How far the VE peak moves for a given cam duration.
 *
 * Duration is how long (in crank degrees) a valve stays open. A longer cam holds the
 * intake valve open later into the compression stroke, so at low RPM some charge is
 * pushed back out — but at high RPM the extra open time is exactly what lets the
 * cylinder keep filling. That is why a big cam trades bottom end for top end.
 *
 * @param {number} camDuration crank degrees
 * @returns {number} RPM the VE peak shifts by
 */
export function camPeakShiftRpm(camDuration) {
  return (camDuration - CAM_BASE_DURATION) * COEFF.CAM_PEAK_SHIFT_PER_DEG;
}

/**
 * Valve overlap — both valves open together around TDC.
 *
 * Scales with duration, and is what makes a big cam idle rough and lose manifold
 * vacuum.
 *
 * @param {number} camDuration crank degrees
 * @returns {number} overlap, crank degrees
 */
export function camOverlapDeg(camDuration) {
  return Math.max(0, (camDuration - CAM_BASE_DURATION) * COEFF.CAM_OVERLAP_PER_DEG);
}

/**
 * The engine speed above which the valves stop following the cam lobe.
 *
 * Springs must close the valve faster than the cam ramp as RPM climbs. Past their
 * limit the valve "floats" — it stops following the lobe, so the cylinder cannot fill
 * and power falls off a cliff. Bigger cams need stiffer springs.
 *
 * @param {number} springRate valve spring rate
 * @param {number} camDuration crank degrees
 * @returns {number} float speed, RPM
 */
export function valveFloatRpm(springRate, camDuration) {
  return COEFF.FLOAT_BASE_RPM
    + (springRate - 50) * COEFF.FLOAT_PER_SPRING_RATE
    - (camDuration - CAM_BASE_DURATION) * COEFF.FLOAT_PER_CAM_DEG;
}

/**
 * Parasitic loss from compressing stiffer valve springs, every cycle.
 *
 * @param {number} springRate valve spring rate
 * @returns {number} extra FMEP, Pa
 */
export function springFrictionPa(springRate) {
  return Math.max(0, (springRate - 50) * COEFF.SPRING_FMEP_PER_RATE);
}

/**
 * Mean piston speed, m/s.
 *
 * The speed that actually limits an engine, more than RPM does. A long-stroke engine
 * reaches a given piston speed at fewer revolutions, which is why it cannot rev as far.
 *
 * @param {number} strokeMm stroke, mm
 * @param {number} rpm engine speed
 * @returns {number} mean piston speed, m/s
 */
export function meanPistonSpeedMs(strokeMm, rpm) {
  return 2 * (strokeMm / 1000) * (rpm / 60);
}

/**
 * Inlet Mach index — how close the charge is to choking on its way past the valve.
 *
 * Taylor's index: the gas velocity through the inlet valve, as a fraction of the speed
 * of sound. Velocity through the valve is the piston speed scaled by how much smaller
 * the valve is than the bore, so
 *
 *     Z = (bore / D_valve)^2 * meanPistonSpeed / sonicVelocity
 *
 * Past a critical value the flow chokes, the cylinder stops filling, and VE falls away
 * however hard the engine is turning. This is the term the model was missing: without it
 * VE kept climbing at the limiter and no naturally aspirated engine had a power peak
 * before its redline (issue #15).
 *
 * The bore-to-valve factor is lumped into a coefficient because the model has no valve
 * geometry — see COEFF.MACH_BORE_VALVE_FACTOR for what it is worth on a real head, and
 * for the honest note on which parts of this are derived and which are fitted.
 *
 * @param {number} boreMm bore, mm — unused directly; kept for the geometry it represents
 * @param {number} strokeMm stroke, mm
 * @param {number} rpm engine speed
 * @param {number} [sonicMs] speed of sound in the intake charge, m/s
 * @returns {number} Mach index, dimensionless
 */
export function inletMachIndex(boreMm, strokeMm, rpm, sonicMs = SONIC_AMBIENT_MS) {
  return COEFF.MACH_BORE_VALVE_FACTOR * meanPistonSpeedMs(strokeMm, rpm) / sonicMs;
}

/**
 * How much volumetric efficiency the inlet Mach index costs at this speed.
 *
 * Flat until the flow starts to choke, then falling quadratically — the shape of
 * Taylor's measured VE-against-Z curves. Floored, because a real engine still breathes
 * something at the limiter.
 *
 * @param {number} boreMm bore, mm
 * @param {number} strokeMm stroke, mm
 * @param {number} rpm engine speed
 * @returns {number} multiplier on VE, 0..1
 */
export function machVeMultiplier(boreMm, strokeMm, rpm, chargeK = AMBIENT_K) {
  // Sonic velocity in the charge as it actually is, not as ambient. A boosted engine
  // runs a hotter intake, sound travels faster in it, and it therefore chokes LATER —
  // a real effect, and one of the reasons forced induction tolerates more piston speed.
  const sonicMs = Math.sqrt(GAMMA_AIR * R_AIR * chargeK);
  const over = Math.max(0, inletMachIndex(boreMm, strokeMm, rpm, sonicMs) - COEFF.MACH_Z_CRIT);
  return Math.max(COEFF.MACH_VE_FLOOR, 1 - COEFF.MACH_VE_LOSS * over * over);
}

/**
 * Bore/stroke ratio bias — oversquare engines favour high RPM, undersquare favour low.
 *
 * @param {number} rpm engine speed
 * @param {number} ratio bore ÷ stroke
 * @returns {number} multiplier
 */
export function charMultiplier(rpm, ratio) {
  const norm = (rpm - 4500) / 3000; // -1 at 1500 rpm, +1 at 7500 rpm
  return 1 + (ratio - 1) * CHAR_SCALE * norm;
}

/**
 * @typedef {object} EngineConfig
 * @property {'I4'|'I6'|'V6'|'V8'} configuration
 * @property {number} bore mm
 * @property {number} stroke mm
 * @property {number} compression static compression ratio
 * @property {'Cast Iron'|'Aluminum'} blockMaterial
 * @property {'Cast Iron'|'Aluminum'} headMaterial
 * @property {number} [camDuration] crank degrees
 * @property {number} [springRate] valve spring rate
 * @property {number} [redline] rev limit, RPM
 */

/**
 * @typedef {object} DerivedEngine
 * @property {number} cyl cylinder count
 * @property {number} displacementL total displacement, litres
 * @property {number} ratio bore ÷ stroke
 * @property {number} compression static compression ratio, carried through unchanged
 * @property {number} bore cylinder bore, mm
 * @property {number} stroke stroke, mm
 * @property {number} boreFlameFactor flame-travel scaling from bore, 1 at the reference
 * @property {number} chamberOffsetK chamber heat added to the charge by head material, K
 * @property {number} torqueScale displacement relative to the 3.5 L baseline
 * @property {number} bearingWearMult block material wear multiplier
 * @property {string} character human-readable bore/stroke description
 * @property {number} perCylL per-cylinder displacement, litres
 * @property {number} camDuration crank degrees
 * @property {number} springRate valve spring rate
 * @property {number} overlapDeg valve overlap, crank degrees
 * @property {number} floatRpm valve float speed, RPM
 * @property {number} springPa spring friction FMEP, Pa
 * @property {number} bearingFmepPa extra rubbing FMEP from main bearing count, Pa
 * @property {number} balanceShaftFrac fraction of rubbing friction added by balance shafts
 * @property {number} redline rev limit, RPM
 */

/**
 * Turns bore/stroke/compression/materials/configuration into the physics deltas used
 * by {@link evaluatePoint}. This is the whole "engine designer" payoff.
 *
 * @param {EngineConfig} cfg
 * @returns {DerivedEngine}
 */
export function deriveEngine(cfg) {
  const cyl = CYL_COUNT[cfg.configuration];
  const boreCm = cfg.bore / 10, strokeCm = cfg.stroke / 10;
  const displacementL = (Math.PI / 4 * boreCm * boreCm * strokeCm * cyl) / 1000;
  const ratio = cfg.bore / cfg.stroke;
  const perCylL = displacementL / cyl;
  // What the ARCHITECTURE contributes to combustion, expressed as the two physical
  // quantities the cycle model reads rather than as bonuses in degrees. Compression
  // needs no term at all any more: it changes the clearance volume, and the cycle
  // integrates what follows.
  //
  // Flame travel scales with bore, so a big cylinder burns slower.
  const boreFlameFactor = cfg.bore / COEFF.BORE_FLAME_REF_MM;
  // An iron head runs a hotter chamber, so the charge in it starts compression hotter.
  const chamberOffsetK = cfg.headMaterial === 'Cast Iron' ? COEFF.IRON_HEAD_CHAMBER_K : 0;
  // No thermal-efficiency term any more. Indicated efficiency used to be an ideal
  // Otto-cycle number scaled by a realisation factor, multiplied into fuel energy to get
  // work. The cycle model produces it instead: compression changes the clearance volume,
  // which changes the expansion the integration runs over, and efficiency is whatever
  // comes out. Two fitted constants became a consequence of the geometry.
  const torqueScale = displacementL / 3.5;
  const bearingWearMult = cfg.blockMaterial === 'Cast Iron' ? 0.85 : 1.0;
  // Architecture friction. Zeroed at the V6 baseline so existing builds do not move:
  // an inline six pays for its seven mains, a large four pays for its balance shafts,
  // and the inline six's real advantage is over the four, not over the V6.
  const bearingFmepPa = (MAIN_BEARINGS[cfg.configuration] - BASELINE_MAIN_BEARINGS)
    * COEFF.FMEP_PER_MAIN_BEARING_PA;
  const balanceShaftFrac = hasBalanceShafts(cfg.configuration, displacementL)
    ? COEFF.FMEP_BALANCE_SHAFT_FRAC : 0;
  const camDuration = cfg.camDuration ?? CAM_BASE_DURATION;
  const springRate = cfg.springRate ?? 50;
  const overlapDeg = camOverlapDeg(camDuration);
  const floatRpm = valveFloatRpm(springRate, camDuration);
  const springPa = springFrictionPa(springRate);
  const redline = cfg.redline ?? DEFAULT_REDLINE_RPM;
  const character = ratio > 1.08
    ? 'Oversquare — revs and breathes higher'
    : ratio < 0.95 ? 'Undersquare — stronger low-end torque' : 'Square — balanced';
  // Compression is passed through rather than only being folded into the two terms
  // derived from it above. The cycle model needs the ratio itself, to size the clearance
  // volume it integrates over, and every call site already hands
  // `evaluatePoint` a `derived`, so carrying it here keeps the config object out of
  // the per-point signature.
  return {
    cyl, displacementL, ratio, compression: cfg.compression,
    bore: cfg.bore, stroke: cfg.stroke,
    boreFlameFactor, chamberOffsetK,
    torqueScale, bearingWearMult, character, perCylL,
    camDuration, springRate, overlapDeg, floatRpm, springPa,
    bearingFmepPa, balanceShaftFrac, redline,
  };
}
