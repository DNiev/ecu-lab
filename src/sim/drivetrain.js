/**
 * Drivetrain and drag strip — longitudinal vehicle dynamics.
 *
 * A torque curve is only half of acceleration. What reaches the ground depends on
 * gearing, tyre size, grip and weight transfer; what the car does with it depends on
 * mass, rotating inertia and aerodynamic drag. This module puts the engine the player
 * built into a car and runs it down a quarter mile.
 *
 * THE SAME RULE APPLIES HERE
 * Nothing adds speed. Every option below changes a term in Newton's second law —
 * mass, a friction coefficient, a frontal area, a gear ratio — and the elapsed time
 * is whatever falls out. A van is slow because it is heavy, tall and boxy, not
 * because it carries a penalty.
 *
 * THE FOUR EQUATIONS
 *   wheelTorque = engineTorque × gearRatio × finalDrive     gearing multiplies torque
 *   F_max       = μ × N                                     grip is a hard ceiling
 *   ΔN          = m × a × h / L                             weight transfer
 *   F_aero      = ½ × ρ × Cd × A × v²                       drag, rising as v²
 *
 * Verified grip figures: street tyres measure 0.8-0.9 from braking distance, good
 * summer road tyres reach about 1.0, and racing slicks are quoted at 1.7-1.9.
 * Prepared drag surfaces with slicks go higher again.
 */

import {
  EIGHTH_MILE_M, G, MPH_PER_MS, M_PER_INCH, QUARTER_MILE_M, RHO_AIR, SIXTY_FEET_M,
  SIXTY_MPH_MS,
} from './constants.js';
import { COEFF } from './coefficients.js';
import { frictionTorqueNm } from './friction.js';
import { ENGINE_INERTIA } from './live.js';
import { clamp } from './math.js';

/** Integration step for the drag run, seconds. */
export const DRAG_STEP_S = 0.005;

/** A run is abandoned after this long — a car too slow to finish would loop forever. */
export const DRAG_TIMEOUT_S = 40;

/** Minimum spacing between trace samples handed to the UI, seconds. */
export const DRAG_TRACE_INTERVAL_S = 0.02;

/**
 * Road speed below which rolling resistance is not applied, m/s.
 *
 * A stationary tyre has no rolling resistance to speak of, and applying the full
 * coefficient at v = 0 would have the car fighting a force before it has moved. This is
 * a numerical guard on the launch step, not a physical threshold — it is well under
 * walking pace, and the term is at full value everywhere the number matters.
 */
const ROLLING_START_MS = 0.1;

/**
 * Tyre compounds, by coefficient of friction.
 *
 * μ is the whole model — since F = μ·N and F = m·a, μ is directly a ceiling on
 * acceleration in g. Everything else about a tyre is out of scope here.
 */
export const TIRE_GRIP = [
  { label: 'Street', grade: 'street', mu: 0.85, note: 'All-season road tyre' },
  { label: 'Sport', grade: 'sport', mu: 1.05, note: 'Summer performance tyre' },
  { label: 'Race', grade: 'race', mu: 1.75, note: 'Racing slick' },
  { label: 'Drag', grade: 'drag', mu: 2.40, note: 'Drag radial on a prepped surface' },
];

/**
 * Body styles.
 *
 * Mass, drag coefficient, frontal area, centre-of-gravity height, wheelbase and
 * static rear weight fraction are all real levers, and each one appears verbatim in
 * one of the four equations above.
 */
export const CAR_BODIES = [
  {
    label: 'Sports Coupe', body: 'coupe',
    massKg: 1610, cd: 0.30, frontalAreaM2: 2.00, cgHeightM: 0.50,
    wheelbaseM: 2.65, rearFrac: 0.47,
    note: 'Balanced, low and slippery. The reference car.',
  },
  {
    label: 'Supercar', body: 'supercar',
    massKg: 1450, cd: 0.32, frontalAreaM2: 1.90, cgHeightM: 0.42,
    wheelbaseM: 2.70, rearFrac: 0.57,
    note: 'Light, very low, and mid-engined so most of the weight already sits over the driven axle.',
  },
  {
    label: 'Sedan', body: 'sedan',
    massKg: 1560, cd: 0.29, frontalAreaM2: 2.20, cgHeightM: 0.56,
    wheelbaseM: 2.85, rearFrac: 0.45,
    note: 'Slippery but taller and nose-heavy. Long wheelbase resists weight transfer.',
  },
  {
    label: 'Van', body: 'van',
    massKg: 2100, cd: 0.36, frontalAreaM2: 3.20, cgHeightM: 0.78,
    wheelbaseM: 3.10, rearFrac: 0.42,
    note: 'Heavy, tall and a big flat face. High centre of gravity does help it hook up.',
  },
  {
    label: 'Truck', body: 'truck',
    massKg: 2350, cd: 0.42, frontalAreaM2: 3.40, cgHeightM: 0.75,
    wheelbaseM: 3.55, rearFrac: 0.38,
    note: 'Heaviest and least aerodynamic, with little static weight over the rear axle.',
  },
];

/**
 * Which wheels are driven.
 *
 * `driveFrac` is the share of static weight sitting over the driven axle. Rear drive
 * omits it deliberately: its share is whatever the BODY's rear weight fraction is, so
 * a mid-engined supercar and a pickup get genuinely different launches out of the same
 * drivetrain choice.
 *
 * `transferGain` is how much of the load that accelerating shifts rearward actually
 * helps — all of it for rear drive, none of it for all-wheel drive. That zero is not a
 * penalty: all-wheel drive already has every kilogram over a driven wheel, so what the
 * rear axle gains the front axle loses and the total is unchanged.
 */
export const DRIVETRAIN_OPTS = [
  { label: 'RWD', drive: 'rwd', transferGain: 1.0, note: 'Rear drive — launches on weight transfer' },
  { label: 'AWD', drive: 'awd', driveFrac: 1.00, transferGain: 0.0, note: 'All four wheels driven' },
];

/**
 * Gearbox types.
 *
 * `torqueMult` is real torque converter multiplication, not a bonus: a fluid coupling
 * at high slip genuinely multiplies input torque, typically 1.8-2.2:1 at stall,
 * falling to 1.0 once it couples up at `couplingSpeedMs`. A manual has no such stage,
 * so its multiplier is 1.0 and its clutch simply takes up over `engageSec`.
 *
 * `launchRpm` is where the engine sits as the car leaves: a converter holds near its
 * stall speed, a clutch is slipped from a chosen launch speed.
 */
export const GEARBOX_OPTS = [
  {
    label: 'Manual', box: 'manual', shiftSec: 0.35,
    torqueMult: 1.0, launchRpm: 3200, engageSec: 1.25, couplingSpeedMs: 0,
    note: 'You shift it; slower changes, no converter',
  },
  {
    label: 'Automatic', box: 'auto', shiftSec: 0.15,
    torqueMult: 1.9, launchRpm: 2200, engageSec: 0, couplingSpeedMs: 8,
    note: 'Faster shifts, and the converter multiplies torque off the line',
  },
];

/**
 * The starting car — sized like a rear-drive sports coupe, driver included.
 *
 * @type {DragCar}
 */
export const DEFAULT_CAR = {
  bodyIdx: 0,
  massKg: CAR_BODIES[0].massKg,
  cd: CAR_BODIES[0].cd,
  frontalAreaM2: CAR_BODIES[0].frontalAreaM2,
  cgHeightM: CAR_BODIES[0].cgHeightM,
  wheelbaseM: CAR_BODIES[0].wheelbaseM,
  rearFrac: CAR_BODIES[0].rearFrac,
  crr: 0.013,          // rolling resistance coefficient, typical for a road tyre
  tireDiameterIn: 26,  // overall rolling diameter
  finalDrive: 3.54,
  gears: [3.79, 2.32, 1.62, 1.27, 1.00, 0.79],
  gearCount: 6,
  gripIdx: 0,
  driveIdx: 0,
  boxIdx: 0,
};

/**
 * @typedef {object} DragCar
 * @property {number} bodyIdx index into {@link CAR_BODIES}
 * @property {number} massKg kerb mass including driver, kg
 * @property {number} cd drag coefficient
 * @property {number} frontalAreaM2 frontal area, m²
 * @property {number} cgHeightM centre of gravity height, m
 * @property {number} wheelbaseM wheelbase, m
 * @property {number} rearFrac static fraction of weight over the rear axle
 * @property {number} crr rolling resistance coefficient
 * @property {number} tireDiameterIn overall rolling diameter, inches
 * @property {number} finalDrive final drive ratio
 * @property {number[]} gears gear ratios, first to top
 * @property {number} gearCount how many of those gears the box actually has
 * @property {number} gripIdx index into {@link TIRE_GRIP}
 * @property {number} driveIdx index into {@link DRIVETRAIN_OPTS}
 * @property {number} boxIdx index into {@link GEARBOX_OPTS}
 */

/**
 * Rolling radius of the tyre, metres.
 *
 * @param {DragCar} car
 * @returns {number}
 */
export function tireRadiusM(car) {
  return (car.tireDiameterIn * M_PER_INCH) / 2;
}

/**
 * Road speed the gearing implies at a given engine speed, m/s.
 *
 * @param {number} rpm engine speed
 * @param {number} gearRatio the ratio currently engaged
 * @param {DragCar} car
 * @returns {number} road speed, m/s
 */
export function roadSpeedMs(rpm, gearRatio, car) {
  return (rpm / 60) * 2 * Math.PI * tireRadiusM(car) / (gearRatio * car.finalDrive);
}

/**
 * Engine speed the gearing implies at a given road speed, RPM.
 *
 * The inverse of {@link roadSpeedMs}. This is what the tacho reads whenever the tyre
 * is actually gripping — the moment it breaks loose, engine speed is free of it,
 * which is why a car that is spinning bounces off the limiter instead of tracking
 * the speedometer.
 *
 * @param {number} vMs road speed, m/s
 * @param {number} gearRatio the ratio currently engaged
 * @param {DragCar} car
 * @returns {number} engine speed, RPM
 */
export function gearedRpm(vMs, gearRatio, car) {
  return (vMs / (2 * Math.PI * tireRadiusM(car))) * gearRatio * car.finalDrive * 60;
}

/**
 * Builds a crank-torque lookup, in newton-metres, from a completed dyno pull.
 *
 * There is deliberately no drag run without a pull behind it: until the engine has
 * been measured there is no torque curve to drive with, exactly as in real life.
 *
 * The sweep reports torque in lb-ft with {@link DRIVETRAIN_EFF} already applied, so
 * this converts back to newton-metres and leaves the transmission loss in — the
 * result is torque at the input to the gearing, which is what the ratios below
 * multiply. Values are linearly interpolated between sweep points and held flat
 * outside the measured range.
 *
 * @param {{points: {rpm: number, torque: number}[]}} result a `simulateSweep` result
 * @returns {(rpm: number) => number} torque, Nm
 */
export function torqueCurveFromSweep(result) {
  const pts = result.points;
  const LBFT_PER_NM = 0.7376;
  const nm = pts.map((p) => p.torque / LBFT_PER_NM);
  return (rpm) => {
    if (rpm <= pts[0].rpm) return nm[0];
    if (rpm >= pts[pts.length - 1].rpm) return nm[nm.length - 1];
    for (let i = 0; i < pts.length - 1; i++) {
      if (rpm >= pts[i].rpm && rpm <= pts[i + 1].rpm) {
        const f = (rpm - pts[i].rpm) / (pts[i + 1].rpm - pts[i].rpm);
        return nm[i] + (nm[i + 1] - nm[i]) * f;
      }
    }
    return nm[0];
  };
}

/**
 * Effective mass added by the parts that must be spun up as well as pushed along.
 *
 * Rotating inertia behaves exactly like extra mass, but only while it is geared to
 * the road. Referred to the contact patch, an inertia `I` turning at `ratio` times
 * wheel speed contributes `I × (ratio / r)²` kilograms — which is why the penalty is
 * worst in first gear, where the engine spins fastest relative to road speed, and why
 * lighter wheels help more than the same weight taken out of the boot.
 *
 * @param {DragCar} car
 * @param {number} overallRatio gear ratio × final drive
 * @param {boolean} coupled whether the engine is currently geared to the wheels
 * @returns {number} added effective mass, kg
 */
export function rotatingMassKg(car, overallRatio, coupled) {
  const r = tireRadiusM(car);
  // A wheel modelled as I = frac·m·r² contributes frac·m kg regardless of its size,
  // because the r² in the inertia and the r² in the referral cancel exactly.
  const wheels = 4 * COEFF.WHEEL_ASSEMBLY_MASS_KG * COEFF.WHEEL_RING_FRACTION;
  if (!coupled) return wheels;
  return wheels + ENGINE_INERTIA * Math.pow(overallRatio / r, 2);
}

/**
 * @typedef {object} DragResult
 * @property {number} et elapsed time over the quarter mile, seconds
 * @property {number} trapMph speed at the quarter-mile stripe, mph
 * @property {number|null} sixtyFootT 60-foot time, seconds
 * @property {number|null} zeroToSixty 0-60 mph, seconds
 * @property {number|null} eighthET eighth-mile elapsed time, seconds
 * @property {number} eighthMph speed at the eighth-mile stripe, mph
 * @property {object[]} trace sampled telemetry for playback
 * @property {boolean} wheelspun whether the tyres ever broke loose
 * @property {boolean} finished whether the car covered the full quarter mile
 * @property {number} topGearUsed highest gear reached
 * @property {number} peakHp peak power of the pull that drove this run, whp
 */

/**
 * Runs a full quarter mile.
 *
 * Integrates Newton's second law forward in time with traction, aerodynamic drag,
 * rolling resistance, gear changes, dynamic weight transfer and a driver who feathers
 * the throttle rather than sitting in a burnout.
 *
 * Engine speed is tracked SEPARATELY from road speed and the two are only locked
 * together while the tyre grips. Once it breaks loose the engine is free to climb
 * against its own inertia, which is what puts a spinning car on the limiter while the
 * speedometer barely moves.
 *
 * @param {object} input
 * @param {DragCar} input.car the vehicle
 * @param {(rpm: number) => number} input.torqueCurveNm crank torque lookup, Nm
 * @param {number} input.redline rev limit, RPM
 * @param {number} [input.displacementL] displacement, for engine braking off throttle
 * @param {number} [input.peakHp] peak power of the pull, carried through for display
 * @returns {DragResult}
 */
export function simulateDragRun({ car, torqueCurveNm, redline, displacementL = 3.5, peakHp = 0 }) {
  const grip = TIRE_GRIP[car.gripIdx];
  const drive = DRIVETRAIN_OPTS[car.driveIdx];
  const box = GEARBOX_OPTS[car.boxIdx];
  const gears = car.gears.slice(0, car.gearCount);
  const r = tireRadiusM(car);
  const dt = DRAG_STEP_S;
  const rpmPerRadPerSec = 60 / (2 * Math.PI);

  // The engine starts at the launch speed the gearbox implies — a converter sitting
  // on its stall speed, or a clutch slipped from the driver's chosen launch RPM.
  let engineRpm = box.launchRpm;
  let limiterCut = false;
  let driverThrottle = 1;
  let v = 0, x = 0, t = 0, gearIdx = 0, shiftUntil = -1;
  let sixty = null, sixtyFtT = null, eighthT = null, eighthV = null;
  let aPrev = 0, wheelspun = false;
  const trace = [];

  while (x < QUARTER_MILE_M && t < DRAG_TIMEOUT_S) {
    const gearRatio = gears[gearIdx];
    const overall = gearRatio * car.finalDrive;
    const shifting = t < shiftUntil;
    // What the engine would be turning if the tyre were fully hooked up.
    const geared = gearedRpm(v, gearRatio, car);

    // --- Weight transfer -----------------------------------------------------
    // Accelerating shifts load rearward by ΔN = m·a·h/L, so grip GROWS with the very
    // acceleration it enables. That is why a rear-drive car out-launches its static
    // weight distribution. Evaluated on the previous step's acceleration, which is
    // the standard explicit treatment of a term that depends on its own result.
    const transfer = drive.transferGain * (car.massKg * aPrev * car.cgHeightM) / car.wheelbaseM;
    const driveFrac = drive.driveFrac ?? car.rearFrac;
    const normalN = Math.max(0, car.massKg * G * driveFrac + transfer);
    const gripLimitN = grip.mu * normalN;

    // --- What the engine is asking for --------------------------------------
    // Off the line the engine is not yet coupled to road speed: a manual slips the
    // clutch, an automatic multiplies torque through the converter until it couples.
    const converterMult = box.torqueMult > 1
      ? box.torqueMult - (box.torqueMult - 1) * clamp(v / box.couplingSpeedMs, 0, 1)
      : 1;
    const crankNm = (shifting || limiterCut)
      ? 0
      : torqueCurveNm(clamp(engineRpm, 1000, redline)) * converterMult * driverThrottle;
    const commandedN = (crankNm * overall) / r;

    // --- Longitudinal dynamics ----------------------------------------------
    const dragN = 0.5 * RHO_AIR * car.cd * car.frontalAreaM2 * v * v;
    const rollN = v > ROLLING_START_MS ? car.crr * car.massKg * G : 0;
    const resistN = dragN + rollN;

    // Two regimes, and it matters which one the car is in.
    //
    // ENGINE-LIMITED, tyre gripping. The engine, gearbox and wheels are rigidly geared
    // to the road, so they must be spun up as well as pushed along and they behave as
    // extra mass: a = (F_commanded − resistance) ÷ (m + m_rotating). The force actually
    // arriving at the contact patch is then whatever is left after accelerating those
    // rotating parts, which is m·a + resistance — always less than what the engine
    // asked for, and the reason a short first gear feels heavier than it is.
    //
    // TRACTION-LIMITED, tyre slipping. The contact patch cannot pass more than μN
    // however much torque is behind it, so the car simply gets a = (μN − resistance) ÷ m.
    // The rotating parts do NOT slow the car here — they are on the far side of a
    // slipping tyre, free to spin up on the surplus torque, which is exactly what the
    // engine-speed integration below does with it.
    const aEngine = (commandedN - resistN) / (car.massKg + rotatingMassKg(car, overall, !shifting));
    const contactN = car.massKg * aEngine + resistN;
    const spinning = contactN > gripLimitN;
    const tractiveN = spinning ? gripLimitN * COEFF.TIRE_SLIDING_FRACTION : contactN;
    if (spinning) wheelspun = true;
    const a = spinning ? (tractiveN - resistN) / car.massKg : aEngine;

    // --- Driver model --------------------------------------------------------
    if (t > COEFF.DRIVER_REACTION_S && contactN > gripLimitN) {
      driverThrottle = Math.max(COEFF.DRIVER_MIN_THROTTLE, driverThrottle - COEFF.DRIVER_LIFT_RATE * dt);
    } else if (contactN < gripLimitN * COEFF.DRIVER_REAPPLY_MARGIN) {
      driverThrottle = Math.min(1, driverThrottle + COEFF.DRIVER_REAPPLY_RATE * dt);
    }

    v = Math.max(0, v + a * dt);
    x += v * dt;
    t += dt;
    aPrev = a;

    // --- Engine speed --------------------------------------------------------
    if (spinning || shifting) {
      // Free of the road (or of the clutch), the engine obeys its own torque balance:
      // whatever it is making, less the torque the slipping tyre reflects back up the
      // gearing, less its own friction. No invented rev-rate — this is why a torquey
      // engine flares harder on a spinning tyre and why the limiter bounces.
      const reflectedNm = shifting ? 0 : (tractiveN * r) / overall;
      const brakingNm = frictionTorqueNm(
        clamp(engineRpm, 800, redline), displacementL, COEFF.SHIFT_MANIFOLD_KPA,
      );
      const alphaRad = (crankNm - reflectedNm - brakingNm) / ENGINE_INERTIA;
      engineRpm = Math.max(1000, engineRpm + alphaRad * rpmPerRadPerSec * dt);
      // Once the road has caught up with a slipping engine the clutch or tyre stops
      // slipping, so engine speed can never fall below what the gearing dictates.
      if (!shifting) engineRpm = Math.max(engineRpm, gearedRpm(v, gearRatio, car));
    } else {
      // Hooked up: the engine is tied to road speed through the gearing. Below the
      // launch speed the clutch or converter is still slipping, so it blends in
      // rather than snapping to the geared value.
      const engaged = box.engageSec > 0
        ? clamp(t / box.engageSec, 0, 1)                       // a clutch, taking up
        : clamp(v / box.couplingSpeedMs, 0, 1);                // a converter, coupling
      engineRpm = Math.max(geared, box.launchRpm * (1 - engaged) + geared * engaged);
    }

    // --- Rev limiter ---------------------------------------------------------
    // Hysteresis, not a ceiling: fuel is cut at the limit, revs fall, fuel comes back
    // a few hundred RPM lower. That cut-restore cycle is the bounce you hear.
    if (engineRpm >= redline) limiterCut = true;
    else if (engineRpm < redline - COEFF.LIMITER_RESTORE_BAND_RPM) limiterCut = false;

    if (sixty === null && v >= SIXTY_MPH_MS) sixty = t;
    // The 60-foot time is dominated almost entirely by traction and launch quality
    // rather than by power, which is exactly why racers judge a launch by it.
    if (sixtyFtT === null && x >= SIXTY_FEET_M) sixtyFtT = t;
    if (eighthT === null && x >= EIGHTH_MILE_M) { eighthT = t; eighthV = v; }

    // --- Shift ---------------------------------------------------------------
    // The driver upshifts when the CAR has the speed for the next gear, not because a
    // spinning tyre has sent the tacho to the limiter. Shifting off wheelspin would
    // drop it into second at walking pace.
    if (!shifting && geared >= redline - COEFF.UPSHIFT_MARGIN_RPM && gearIdx < gears.length - 1) {
      gearIdx++;
      shiftUntil = t + box.shiftSec;
      limiterCut = false;
    }

    if (trace.length === 0 || t - trace[trace.length - 1].t > DRAG_TRACE_INTERVAL_S) {
      trace.push({
        t, x, v, rpm: engineRpm, gear: gearIdx + 1, a,
        spinning, limiter: limiterCut, throttle: driverThrottle,
      });
    }
  }

  return {
    et: t,
    trapMph: v * MPH_PER_MS,
    sixtyFootT: sixtyFtT,
    zeroToSixty: sixty,
    eighthET: eighthT,
    eighthMph: eighthV ? eighthV * MPH_PER_MS : 0,
    trace,
    wheelspun,
    finished: x >= QUARTER_MILE_M,
    topGearUsed: gearIdx + 1,
    peakHp,
  };
}
