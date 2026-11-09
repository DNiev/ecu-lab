/**
 * Parasitic losses, expressed as mean effective pressures.
 *
 * Engine braking has two separate sources, and modelling only one made coast-down far
 * too slow. RUBBING friction rises with speed. PUMPING loss is the work the engine
 * does dragging air past a closed throttle — proportional to the vacuum it is pulling
 * (barometric minus MAP). On a closed throttle at high RPM the pumping term dominates,
 * which is exactly why a real engine drops revs so briskly.
 *
 * RUBBING FRICTION is built from the engine's own geometry, component by component, after
 * Sandoval and Heywood, "An Improved Friction Model for Spark-Ignition Engines", SAE
 * 2003-01-0725 (the revision of Patton, Nitschke and Heywood, SAE 890836), as restated
 * with its coefficients by Marwaha and Subramanian, Int. J. Automotive Science and
 * Technology 6(1):39-48 (2022). It replaces a straight line in RPM (45 kPa + 6.5 Pa/rpm)
 * that came from the original game with no source, ran at about half of what GM's own
 * friction model for its Gen III and Vortec engines says, and barely rose with speed
 * (the comparison is in docs/accuracy.md).
 */

import { BARO_KPA } from './constants.js';
import { COEFF } from './coefficients.js';
import { clamp } from './math.js';
import { turbineBackPressureKpa } from './turbo.js';

/**
 * Crankshaft journal sizes when the engine does not state them, as shares of the bore.
 * From published GM crankshafts: Gen III small-block mains 64.5 mm and rods 53.3 mm on
 * 96-99 mm bores (0.65-0.67, 0.54-0.56); Vortec 5.7 mains 62.2 mm and rods 53.3 mm on
 * 101.6 mm (0.61, 0.52). Bearing widths as shares of their journal: about 0.37 (mains)
 * and 0.41 (rods) on the same engines. Estimates for any engine that is not one of these.
 */
export const JOURNAL_SHARE = { main: 0.65, rod: 0.55, mainWidth: 0.37, rodWidth: 0.41 };

/**
 * The engine geometry the friction terms need, from a derived engine (engine.js). Any
 * field a caller does not have falls back to the reference V6 the simulator was first
 * built around, so an old call with no geometry still returns a sensible figure.
 *
 * @param {object} [d] a DerivedEngine, or any object with some of its fields
 */
export function frictionGeometry(d = {}) {
  const bore = d.bore ?? 95.5;
  const stroke = d.stroke ?? 81.4;
  const cyl = d.cyl ?? 6;
  const mainD = d.mainJournalMm ?? JOURNAL_SHARE.main * bore;
  const rodD = d.rodJournalMm ?? JOURNAL_SHARE.rod * bore;
  const valvetrain = d.valvetrain ?? 'dohc';
  const valvesPerCyl = d.valvesPerCyl ?? 4;
  // Camshafts and their bearings: one block cam in a pushrod engine; per bank one cam
  // (SOHC) or two (DOHC). A cam runs a bearing between each pair of cylinders it serves
  // plus one: an inline-6 head cam has 7, a V8 block cam 5.
  const banks = String(d.configuration ?? 'V6').startsWith('V') ? 2 : 1;
  const cylPerBank = cyl / banks;
  const camBearings = valvetrain === 'ohv' ? Math.floor(cyl / 2) + 1
    : (valvetrain === 'sohc' ? 1 : 2) * banks * (cylPerBank + 1);
  return {
    bore, stroke, cyl, compression: d.compression ?? 10.3,
    mains: d.mainBearings ?? 4, mainD, mainL: JOURNAL_SHARE.mainWidth * mainD,
    rodD, rodL: JOURNAL_SHARE.rodWidth * rodD,
    valvetrain, follower: d.follower ?? (valvetrain === 'dohc' ? 'flat' : 'roller'),
    valves: valvesPerCyl * cyl, camBearings,
  };
}

/**
 * Valvetrain friction, kPa, from cam bearings and followers (Sandoval and Heywood).
 *
 * The layout counts through the cam bearings (a pushrod V8 runs one block cam on five; a
 * DOHC V8 four head cams on twenty) and the valve count through the follower term.
 * FLAT FOLLOWERS ARE NOT YET PRICED SEPARATELY: the published model has a flat-follower
 * term, but its coefficient table (SAE 890836, SAE 2003-01-0725) could not be obtained
 * for this change, and a guessed coefficient would be an invented number. Until it is,
 * every follower is charged at the published roller rate and the follower type is
 * carried, unpriced. That under-charges a flat-tappet or bucket engine.
 *
 * @param {number} N engine speed, rpm
 * @param {ReturnType<typeof frictionGeometry>} g
 */
export function valvetrainFmepKpa(N, g) {
  const camBearings = COEFF.FRIC_CAM_BEARING * N ** 0.6 * g.camBearings / (g.cyl * g.bore * g.bore * g.stroke);
  const follower = COEFF.FRIC_ROLLER_FOLLOWER * g.valves * N / (g.cyl * g.stroke);
  return { camBearings, follower };
}

/**
 * Rubbing (mechanical) friction as a mean effective pressure, by component.
 *
 * Crankshaft: main bearings (hydrodynamic, ∝ N^0.6 D³ L) and seals. Reciprocating: rod
 * bearings, piston skirt (∝ mean piston speed ÷ bore), rings (∝ (1 + 1000/N) ÷ bore²) and
 * the gas load on the rings (rising with manifold pressure and compression). Valvetrain:
 * cam bearings and followers. Auxiliaries: oil and water pumps. Everything per unit of
 * displacement, so a big-bore engine is not charged twice for being big.
 *
 * @param {number} rpm engine speed
 * @param {number} [springPa] extra FMEP from stiffer-than-stock valve springs, Pa
 * @param {object} [arch] the derived engine (engine.js); `balanceShaftFrac` adds the cost
 *   of balance shafts
 * @param {number} [mapKpa] manifold pressure, for the ring gas-load term
 * @returns {number} rubbing FMEP, Pa
 */
export function rubbingFmepPa(rpm, springPa = 0, arch = {}, mapKpa = BARO_KPA) {
  return rubbingFmepParts(rpm, springPa, arch, mapKpa).totalPa;
}

/**
 * The same, with every component, kPa, for the physics window and the docs.
 * @param {number} rpm
 * @param {number} [springPa]
 * @param {object} [arch]
 * @param {number} [mapKpa]
 */
export function rubbingFmepParts(rpm, springPa = 0, arch = {}, mapKpa = BARO_KPA) {
  const g = frictionGeometry(arch);
  const N = Math.max(rpm, 100);
  const { bore: B, stroke: S, cyl: k } = g;
  const up = 2 * (S / 1000) * N / 60;
  const bearing = (n, D, L) => COEFF.FRIC_BEARING * n * N ** 0.6 * D ** 3 * L / (k * B * B * S);
  const parts = {
    mainBearings: bearing(g.mains, g.mainD, g.mainL),
    seals: COEFF.FRIC_SEALS * g.mainD / (k * B * B * S),
    rodBearings: bearing(k, g.rodD, g.rodL),
    pistonSkirt: COEFF.FRIC_SKIRT * up / B,
    rings: COEFF.FRIC_RINGS * (1 + 1000 / N) / (B * B),
    ringGasLoad: COEFF.FRIC_GAS * (Math.max(mapKpa, 0) / BARO_KPA)
      * (0.088 * g.compression + 0.182 * g.compression ** (1.33 - COEFF.FRIC_GAS_K * up)),
    ...valvetrainFmepKpa(N, g),
    oilPump: 1.28 + 0.0079 * N - 8.4e-7 * N * N,
    waterPump: 0.13 + 0.002 * N + 3e-7 * N * N,
  };
  const rpmShare = (1 - COEFF.SPRING_RPM_BIAS) + COEFF.SPRING_RPM_BIAS * (rpm / 7500);
  const level = arch.frictionLevel === 'older' ? COEFF.FRICTION_SCALE_OLDER : 1;
  const sumKpa = Object.values(parts).reduce((a, b) => a + b, 0) * COEFF.FRICTION_SCALE * level;
  const totalPa = (sumKpa * 1000 + springPa * rpmShare) * (1 + (arch.balanceShaftFrac ?? 0));
  return { totalPa, parts, scale: COEFF.FRICTION_SCALE * level };
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
  const fmep = rubbingFmepPa(rpm, springPa, arch, mapKpa) + pumpingFmepPa(mapKpa);
  return (fmep * (displacementL / 1000)) / (4 * Math.PI);
}
