/**
 * Live engine — a continuously running rotational-dynamics model.
 *
 * Unlike the dyno sweep (which evaluates steady-state points), this integrates real
 * crankshaft physics in time: the engine accelerates because combustion torque
 * exceeds friction torque, idles because the ECU trims air to hold a target, and
 * stalls if it does not.
 *
 * `liveStep` is pure apart from `sensorRead`, which uses `Math.random()` to simulate
 * sensor noise. Tests that need determinism should stub `Math.random`.
 */

import { BARO_KPA, DRIVETRAIN_EFF } from './constants.js';
import { COEFF } from './coefficients.js';
import { frictionTorqueNm } from './friction.js';
import { clamp, interp1, interp2 } from './math.js';
import { computeManifold } from './manifold.js';
import { evaluatePoint } from './point.js';
import { RPM } from './tables.js';

/** Crank + flywheel + damper rotational inertia, kg·m². */
export const ENGINE_INERTIA = 0.18;
/** Idle speed the ECU holds, RPM. */
export const IDLE_TARGET_RPM = 800;
/** Starter cranking speed, RPM. */
export const CRANK_RPM = 260;
/** Below this the engine has stalled, RPM. */
export const STALL_RPM = 380;
/** Rev limiter fuel cut, RPM. */
export const REDLINE_CUT = 7600;

/**
 * A simulated sensor: real ones are noisy and lag behind the true value.
 *
 * @param {number} prev previous reading
 * @param {number} trueVal actual underlying value
 * @param {number} lagFactor 0..1, how fast the reading catches up
 * @param {number} noiseAmp peak noise amplitude
 * @returns {number}
 */
export function sensorRead(prev, trueVal, lagFactor, noiseAmp) {
  const lagged = prev + (trueVal - prev) * lagFactor;
  return lagged + (Math.random() - 0.5) * 2 * noiseAmp;
}

/**
 * A fresh live-engine state: stopped, cold, untrimmed.
 * @returns {object}
 */
export function makeLiveState() {
  return {
    running: false, cranking: false, rpm: 0, omega: 0,
    idleTrim: 5, stft: 0, ltft: 0,
    coolantC: 20, oilC: 20, knockCount: 0, fuelCut: false, dfco: false, limiterCut: false,
    sensedRpm: 0, sensedMaf: 0, sensedMap: 101, sensedIat: 25,
    sensedLambda: 1.0, sensedCoolant: 20, elapsed: 0,
  };
}

/**
 * One integration step of the live engine plus one pass of the ECU control loop.
 *
 * @param {object} st previous state
 * @param {number} dt timestep, seconds
 * @param {{throttle: number, load: number}} input driver input
 * @param {object} cfg current tune and hardware
 * @returns {object} next state
 */
export function liveStep(st, dt, input, cfg) {
  const s = { ...st };
  const {
    ve, veTruth, timing, afr, derived, fuel, injectorCc, ecuInjectorCc, mods, mafScalar,
    mafErrorBase, turboOn, boostCurve, octaneBonus, turbine, compressor,
  } = cfg;

  s.prevRpm = st.rpm;
  s.elapsed += dt;

  // ---- starter / stall handling ----
  if (s.cranking && s.rpm > 450) { s.cranking = false; s.running = true; }
  if (s.running && s.rpm < STALL_RPM) { s.running = false; s.fuelCut = false; }

  // ---- ECU idle air control (PI holding target idle) ----
  const userThrottle = input.throttle;
  if (s.running && userThrottle < 3) {
    if (s.rpm < 2000) {
      // Near idle: closed-loop control. Air is added far faster than it is removed
      // (a dashpot), so the engine catches itself instead of stalling.
      const err = IDLE_TARGET_RPM - s.rpm;
      const gain = err > 0 ? COEFF.IDLE_AIR_GAIN_UP : COEFF.IDLE_AIR_GAIN_DOWN;
      const damp = (s.rpm - (s.prevRpm ?? s.rpm)) * COEFF.IDLE_AIR_DAMP;
      s.idleTrim = clamp(s.idleTrim + err * gain * (dt / 0.05) - damp, 1, 34);
    } else {
      // Coasting down off-idle: bleed the idle valve back toward its base position so
      // the engine can actually decelerate.
      s.idleTrim += (3 - s.idleTrim) * COEFF.IDLE_BLEED_RATE * (dt / 0.05);
    }
  }
  const coldEnrich = s.coolantC < 80 ? 1 + (80 - s.coolantC) * 0.004 : 1;
  const effThrottle = clamp(Math.max(userThrottle, s.running ? s.idleTrim : 0), 0, 100);

  // ---- rev limiter + deceleration fuel cut-off (DFCO) ----
  // Real ECUs shut the injectors off completely on a closed throttle above idle: the
  // engine is being driven by its own inertia, so burning fuel there is pure waste.
  // It is also why a real engine drops back to idle briskly instead of hanging. Fuel
  // is restored with hysteresis before the engine can stall.
  const overrun = s.running && userThrottle < 3 && s.rpm > (s.dfco ? 1600 : 1850) && s.coolantC > 45;
  s.dfco = overrun;
  // A real rev limiter is a hysteresis loop, not a ceiling: fuel is cut at the limit,
  // revs fall, fuel is restored a few hundred RPM lower, and the engine climbs back
  // into the cut. That rapid cut-restore cycle IS the bounce you hear.
  if (s.running) {
    if (s.rpm >= REDLINE_CUT) s.limiterCut = true;
    else if (s.rpm < REDLINE_CUT - 320) s.limiterCut = false;
  } else s.limiterCut = false;
  s.fuelCut = (s.running && s.limiterCut) || overrun;

  // ---- combustion torque from the same physics the dyno uses ----
  let crankNm = 0, pt = null;
  if ((s.running || s.cranking) && s.rpm > 100) {
    const rpmClamped = clamp(s.rpm, 700, 7500);
    // Throttle opening sets manifold pressure — but so does ENGINE SPEED. A nearly
    // closed throttle at high RPM pulls far harder vacuum than the same opening at
    // idle, because the engine is trying to pump much more air through the same
    // restriction. That rpm term is what lets the engine decelerate on a closed
    // throttle instead of sustaining itself at redline.
    const aFrac = clamp(effThrottle, 0, 100) / 100;
    const nFrac = clamp(rpmClamped / 7500, 0, 1.2);
    // Valve overlap lets exhaust back into the intake at low speed, so a big cam
    // simply cannot pull strong manifold vacuum at idle. That lost vacuum is why
    // cammed engines idle high and lumpy.
    const overlapBleed = (derived.overlapDeg || 0) * 0.0042;
    const loadKpa = BARO_KPA * clamp(
      0.18 + overlapBleed + 0.82 * Math.pow(aFrac, 0.75) - 0.28 * nFrac * Math.pow(1 - aFrac, 2),
      0.12, 1,
    );
    const boostTarget = turboOn ? interp1(RPM, boostCurve, rpmClamped) : 0;
    const man = computeManifold(rpmClamped, loadKpa, turboOn, boostTarget, turbine, compressor);
    const veVal = interp2(ve, rpmClamped, man.mapKpa);
    const veActualVal = veTruth ? interp2(veTruth, rpmClamped, man.mapKpa) : undefined;
    // Spark-based idle stabilisation: the air path is slow (throttle -> manifold ->
    // cylinder takes several cycles), so real ECUs hold idle with IGNITION timing,
    // which changes torque on the very next firing event. Air trim handles the slow
    // drift; spark handles the fast corrections.
    let idleSpark = 0;
    if (s.running && userThrottle < 3 && s.rpm < 1600) {
      idleSpark = clamp((IDLE_TARGET_RPM - s.rpm) * COEFF.IDLE_SPARK_GAIN, -COEFF.IDLE_SPARK_LIMIT, COEFF.IDLE_SPARK_LIMIT);
    }
    const timingVal = interp2(timing, rpmClamped, man.mapKpa) + idleSpark;
    const afrCmd = interp2(afr, rpmClamped, man.mapKpa) / coldEnrich;
    pt = evaluatePoint({
      rpm: rpmClamped, mapKpa: man.mapKpa, boostPsi: man.boostPsi,
      veVal, veActualVal, timingVal, afrCommanded: afrCmd, octaneBonus, fuel,
      mods: { ...mods, turboFitted: turboOn },
      mafScalar: mafScalar * (1 + s.ltft / 100 + s.stft / 100),
      mafErrorBase, injectorCc, ecuInjectorCc, derived, compressor,
    });
    // evaluatePoint already returns BRAKE torque — friction and pumping are subtracted
    // inside it — so we must not deduct them again here.
    if (!s.fuelCut && !s.cranking) {
      crankNm = pt.torque / 0.7376 / DRIVETRAIN_EFF;
    } else if (!s.cranking) {
      // Fuel cut: no combustion at all, so the engine is being motored against its own
      // friction and pumping losses. That is engine braking, for real.
      crankNm = -(pt.fmep * 100000 * (derived.displacementL / 1000)) / (4 * Math.PI);
    }
    if (pt.knock) s.knockCount += pt.knockPull * dt * 8;
  }

  // ---- rotational dynamics ----
  const starterNm = s.cranking ? 180 : 0;
  // Cranking has no combustion, so the starter works against motoring friction.
  const crankingDrag = s.cranking
    ? frictionTorqueNm(Math.max(s.rpm, 0), derived.displacementL, pt ? pt.map : BARO_KPA)
    : 0;
  const netNm = crankNm + starterNm - crankingDrag - (s.running ? input.load : 0);
  const alpha = netNm / ENGINE_INERTIA;
  s.omega = Math.max(0, s.omega + alpha * dt);
  s.rpm = s.omega * 60 / (2 * Math.PI);
  if (!s.running && !s.cranking) s.rpm = Math.max(0, s.rpm - 900 * dt);
  s.omega = s.rpm * 2 * Math.PI / 60;

  // ---- thermal model ----
  if (s.running) {
    const heatIn = 0.9 + (crankNm / 200) * 3.2;
    s.coolantC = Math.min(95, s.coolantC + heatIn * dt * (s.coolantC < 88 ? 1 : 0.15));
    s.oilC = Math.min(110, s.oilC + heatIn * dt * 0.7);
  } else {
    s.coolantC = Math.max(20, s.coolantC - 0.35 * dt);
    s.oilC = Math.max(20, s.oilC - 0.3 * dt);
  }

  // ---- ECU closed-loop fuel trims ----
  // Only at part throttle: at WOT the ECU goes open-loop and stops correcting, which
  // is exactly when MAF scaling errors bite.
  const closedLoop = s.running && pt && !pt.openLoop && s.coolantC > 45;
  if (closedLoop && pt) {
    const lambdaErr = pt.lambda - 1.0;
    s.stft = clamp(s.stft + lambdaErr * COEFF.STFT_GAIN * (dt / 0.05) * 0.25, -COEFF.TRIM_LIMIT, COEFF.TRIM_LIMIT);
    s.ltft = clamp(s.ltft + s.stft * COEFF.LTFT_LEARN_RATE * (dt / 0.05), -COEFF.TRIM_LIMIT, COEFF.TRIM_LIMIT);
  } else if (s.running) {
    s.stft += (0 - s.stft) * 0.06;
  }

  // ---- simulated sensors: lag + noise ----
  const lag = clamp(dt / 0.09, 0, 1);
  const lopeAmp = s.running && s.rpm < 1500 ? (derived.overlapDeg || 0) * 0.9 : 0;
  s.lope = lopeAmp;
  s.sensedRpm = sensorRead(s.sensedRpm, s.rpm, lag, 14 + lopeAmp);
  s.sensedMaf = sensorRead(s.sensedMaf, pt ? pt.maf : 0, lag * 0.8, 1.4);
  s.sensedMap = sensorRead(s.sensedMap, pt ? pt.map : BARO_KPA, lag, 0.7);
  s.sensedIat = sensorRead(s.sensedIat, pt ? pt.iat : 25, 0.05, 0.3);
  s.sensedLambda = sensorRead(s.sensedLambda, pt && s.running && !s.fuelCut ? pt.lambda : 1.6, lag * 0.5, 0.008);
  s.sensedCoolant = sensorRead(s.sensedCoolant, s.coolantC, 0.08, 0.25);
  s.live = pt;
  s.effThrottle = effThrottle;
  s.closedLoop = closedLoop;
  return s;
}
