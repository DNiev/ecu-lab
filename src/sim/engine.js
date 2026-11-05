/**
 * Engine architecture — turns the player's short-block design into the derived
 * properties the physics needs.
 *
 * Bore, stroke, compression, materials, camshaft and valve springs are all
 * player-editable and feed real physics downstream.
 */

import { AMBIENT_K, CHAR_SCALE, GAMMA_AIR, R_AIR, SONIC_AMBIENT_MS } from './constants.js';
import { COEFF } from './coefficients.js';
import { bottomEndLimit } from './bottomEnd.js';
import {
  CYL_COUNT, MAIN_BEARINGS, TYPICAL_INTAKE_VALVE_SHARE, hasBalanceShafts, intakeValvesFor,
} from './hardware.js';

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
export function inletMachIndex(boreMm, strokeMm, rpm, sonicMs = SONIC_AMBIENT_MS, valveAreaRatio = 1) {
  return (COEFF.MACH_BORE_VALVE_FACTOR / valveAreaRatio) * meanPistonSpeedMs(strokeMm, rpm) / sonicMs;
}

/** The four-valve head the Mach coefficients were fitted with: two intakes at 0.36 of the bore. */
export const REFERENCE_INTAKE_AREA_SHARE = 2 * 0.36 * 0.36;

/**
 * Intake valve area against the reference four-valve head, on the same bore: the part of
 * Taylor's (bore / valve)² that is geometry. 1 for a four-valve head with typical valves;
 * a typical two-valve wedge (one valve at 0.445 of the bore) has 0.78 of it and chokes at
 * a lower piston speed; a GM LS head (one 50.8 mm valve in a 99 mm bore) has 0.98.
 *
 * @param {{bore: number, valvesPerCyl?: number, intakeValveMm?: number|null}} cfg
 * @returns {{ratio: number, intakeValves: number, intakeValveMm: number, typical: boolean}}
 */
export function intakeValveAreaRatio(cfg) {
  const valvesPerCyl = cfg.valvesPerCyl ?? 4;
  const intakeValves = intakeValvesFor(valvesPerCyl);
  const typical = cfg.intakeValveMm == null;
  const intakeValveMm = typical ? TYPICAL_INTAKE_VALVE_SHARE[valvesPerCyl] * cfg.bore : cfg.intakeValveMm;
  const share = intakeValveMm / cfg.bore;
  return { ratio: (intakeValves * share * share) / REFERENCE_INTAKE_AREA_SHARE, intakeValves, intakeValveMm, typical };
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
export function machVeMultiplier(boreMm, strokeMm, rpm, chargeK = AMBIENT_K, valveAreaRatio = 1) {
  // Sonic velocity in the charge as it actually is, not as ambient. A boosted engine
  // runs a hotter intake, sound travels faster in it, and it therefore chokes LATER —
  // a real effect, and one of the reasons forced induction tolerates more piston speed.
  const sonicMs = Math.sqrt(GAMMA_AIR * R_AIR * chargeK);
  const over = Math.max(0, inletMachIndex(boreMm, strokeMm, rpm, sonicMs, valveAreaRatio) - COEFF.MACH_Z_CRIT);
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
  // Fitted between 1500 and 7500 RPM. Past 7500 an oversquare engine's credit is held
  // where it was measured rather than extrapolated; an undersquare engine's deficit keeps
  // growing (its long stroke is also what the Mach term charges, in the same direction).
  const n = ratio > 1 ? Math.min(norm, 1) : norm;
  return 1 + (ratio - 1) * CHAR_SCALE * n;
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
 * @property {string} [vvt] cam phasers fitted: 'none', 'intake' or 'dual'. Hardware, like
 *   the cam itself; absent means fixed cams
 * @property {'port'|'direct'} [injection] where the injectors spray: into each intake port
 *   (multi-point manifold injection) or into the cylinder. Absent means port
 * @property {string} [bottomEnd] what the pistons and rods are built from: a
 *   BOTTOM_END_OPTS id (bottomEnd.js). Absent means production parts
 * @property {number} [bottomEndRatedRpm] a catalogue engine's factory assembly is rated to
 *   this speed, its own factory limiter; set when the preset is loaded
 * @property {boolean} [boostRatedBottomEnd] a factory turbo engine's bottom end, designed
 *   for boosted cylinder pressure; absent on a naturally aspirated one
 * @property {1|2} [sparkPlugs] spark plugs per cylinder, both firing together (the
 *   modern Hemi, Mercedes M112, Alfa Twin Spark). Absent means one
 * @property {'ohv'|'sohc'|'dohc'} [valvetrain] how the cams work the valves; absent means
 *   DOHC, the layout every factory preset here has
 * @property {2|3|4|5} [valvesPerCyl] valves per cylinder; absent means 4
 * @property {'roller'|'flat'} [follower] cam followers; absent means the layout's usual one
 *   (roller for pushrod and SOHC, flat bucket for DOHC)
 * @property {number|null} [intakeValveMm] intake valve head diameter, mm; absent means the
 *   typical size for the layout (TYPICAL_INTAKE_VALVE_SHARE)
 * @property {number} [mainJournalMm] crankshaft main journal diameter, mm; absent means
 *   estimated from the bore (see crankGeometry in friction.js)
 * @property {number} [rodJournalMm] connecting rod journal diameter, mm
 * @property {'modern'|'older'} [frictionLevel] the engine's friction technology (see
 *   FRICTION_LEVEL_OPTS); absent means modern
 */

/**
 * @typedef {object} DerivedEngine
 * @property {number} cyl cylinder count
 * @property {number} displacementL total displacement, litres
 * @property {number} ratio bore ÷ stroke
 * @property {number} compression static compression ratio, carried through unchanged
 * @property {number} bore cylinder bore, mm
 * @property {number} stroke stroke, mm
 * @property {number} boreFlameFactor flame-travel scaling from bore and plug count, 1 at
 *   the reference bore with one plug
 * @property {1|2} sparkPlugs spark plugs per cylinder
 * @property {number} chamberOffsetK chamber heat added to the charge by head material, K
 * @property {'port'|'direct'} injection where the fuel is sprayed
 * @property {number} evapInCylinder share of the fuel's latent heat drawn from the charge
 * @property {number} torqueScale displacement relative to the 3.5 L baseline
 * @property {number} bearingWearMult block material wear multiplier
 * @property {number} bearingFreeBar average peak pressure the bottom end carries for free, bar
 * @property {number} bearingEventBar average peak pressure that raises the bottom-end advisory, bar
 * @property {string} character human-readable bore/stroke description
 * @property {number} perCylL per-cylinder displacement, litres
 * @property {number} camDuration crank degrees
 * @property {number} springRate valve spring rate
 * @property {number} overlapDeg valve overlap, crank degrees
 * @property {number} floatRpm valve float speed, RPM
 * @property {ReturnType<typeof bottomEndLimit>} bottomEnd what the pistons and rods are
 *   rated to: mean piston speed and the engine speed it is reached at (bottomEnd.js)
 * @property {number} springPa spring friction FMEP, Pa
 * @property {number} balanceShaftFrac fraction of rubbing friction added by balance shafts
 * @property {number} redline rev limit, RPM
 * @property {string} configuration cylinder layout id, as in the config
 * @property {'ohv'|'sohc'|'dohc'} valvetrain how the cams work the valves
 * @property {number} valvesPerCyl valves per cylinder
 * @property {'roller'|'flat'} follower cam follower type
 * @property {number} intakeValves intake valves per cylinder
 * @property {number} intakeValveMm intake valve head diameter, mm (typical for the bore when not given)
 * @property {number} valveAreaRatio intake valve area relative to the reference 4-valve head
 * @property {number} mainBearings crankshaft main bearings
 * @property {number|null} mainJournalMm main journal diameter, mm; null means the bore's typical share
 * @property {number|null} rodJournalMm rod journal diameter, mm; null means the bore's typical share
 * @property {'modern'|'older'} frictionLevel the engine's friction technology (friction.js)
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
  // What the architecture contributes to combustion, expressed as the two physical
  // quantities the cycle model reads rather than as bonuses in degrees. Compression
  // needs no term at all: it changes the clearance volume, and the cycle integrates
  // what follows.
  //
  // Flame travel scales with bore, so a big cylinder burns slower.
  //
  // A second plug shortens the travel. Two kernels lit together each have half the
  // chamber to cross, so the distance a flame front runs scales as one over the square
  // root of the plug count: a burn 29% shorter with two. Published reductions bracket
  // that: 11-15% measured on a 125 cc twin- vs single-plug engine (University of Danang,
  // 2023, scv.udn.vn/vdqui/BBao/37172) and about 35-40% as reported from Chandra, "A
  // Critical Study of the Dual Versus Single Plug Systems in S.I. Engines" (SAE 940452).
  // Chrysler fitted the modern Hemi with two "to get the burn rate we needed" (Ward's
  // Auto, Bob Lee). The flame-development delay is untouched: each kernel still forms.
  //
  // Not fitted. Checked afterwards against a stock 2015 6.4 L Hemi calibration (Pro's
  // docs/STOCK-TUNE-REFERENCE.md): with one plug the model's best-torque spark ran up
  // to 12 degrees past the factory table at part load; with two, within about 2.
  const sparkPlugs = cfg.sparkPlugs === 2 ? 2 : 1;
  const boreFlameFactor = (cfg.bore / COEFF.BORE_FLAME_REF_MM) / Math.sqrt(sparkPlugs);
  // An iron head runs a hotter chamber, so the charge in it starts compression hotter.
  const chamberOffsetK = cfg.headMaterial === 'Cast Iron' ? COEFF.IRON_HEAD_CHAMBER_K : 0;
  // Where the injector sprays decides how much of the fuel's evaporation cools the air
  // rather than the metal around it (see FUEL_EVAP_IN_CYLINDER_*).
  const injection = cfg.injection === 'direct' ? 'direct' : 'port';
  const evapInCylinder = injection === 'direct' ? COEFF.FUEL_EVAP_IN_CYLINDER_DIRECT : COEFF.FUEL_EVAP_IN_CYLINDER_PORT;
  // No thermal-efficiency term. The cycle model produces indicated efficiency:
  // compression changes the clearance volume, which changes the expansion the
  // integration runs over, and efficiency is whatever comes out. It is a consequence of
  // the geometry, not a fitted constant.
  const torqueScale = displacementL / 3.5;
  const bearingWearMult = cfg.blockMaterial === 'Cast Iron' ? 0.85 : 1.0;
  // What average peak pressure the bottom end carries for free, and where the advisory
  // starts: see BEARING_PRESSURE_FREE_BAR.
  const bearingFreeBar = cfg.boostRatedBottomEnd ? COEFF.BEARING_PRESSURE_FREE_BAR_BOOST_RATED : COEFF.BEARING_PRESSURE_FREE_BAR;
  const bearingEventBar = cfg.boostRatedBottomEnd ? COEFF.BEARING_EVENT_BAR_BOOST_RATED : COEFF.BEARING_EVENT_BAR;
  // Architecture friction. Main bearings are counted in the friction model itself
  // (friction.js: an inline six pays for its seven mains); balance shafts are a share on
  // top of it.
  const balanceShaftFrac = hasBalanceShafts(cfg.configuration, displacementL)
    ? COEFF.FMEP_BALANCE_SHAFT_FRAC : 0;
  const camDuration = cfg.camDuration ?? CAM_BASE_DURATION;
  const springRate = cfg.springRate ?? 50;
  const overlapDeg = camOverlapDeg(camDuration);
  const floatRpm = valveFloatRpm(springRate, camDuration);
  const springPa = springFrictionPa(springRate);
  const redline = cfg.redline ?? DEFAULT_REDLINE_RPM;
  // What the pistons and rods are good for (bottomEnd.js).
  const bottomEnd = bottomEndLimit(cfg);
  // The valvetrain: layout, valve count and followers. They decide valvetrain friction
  // (friction.js) and, through the intake valve area, where breathing chokes.
  const valvetrain = cfg.valvetrain ?? 'dohc';
  const valvesPerCyl = cfg.valvesPerCyl ?? 4;
  const follower = cfg.follower ?? (valvetrain === 'dohc' ? 'flat' : 'roller');
  const valves = intakeValveAreaRatio({ bore: cfg.bore, valvesPerCyl, intakeValveMm: cfg.intakeValveMm });
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
    boreFlameFactor, sparkPlugs, chamberOffsetK, injection, evapInCylinder,
    torqueScale, bearingWearMult, bearingFreeBar, bearingEventBar, character, perCylL,
    camDuration, springRate, overlapDeg, floatRpm, springPa, bottomEnd,
    balanceShaftFrac, redline,
    configuration: cfg.configuration, valvetrain, valvesPerCyl, follower,
    intakeValves: valves.intakeValves, intakeValveMm: valves.intakeValveMm, valveAreaRatio: valves.ratio,
    mainBearings: MAIN_BEARINGS[cfg.configuration],
    mainJournalMm: cfg.mainJournalMm ?? null, rodJournalMm: cfg.rodJournalMm ?? null,
    frictionLevel: cfg.frictionLevel === 'older' ? 'older' : 'modern',
  };
}
