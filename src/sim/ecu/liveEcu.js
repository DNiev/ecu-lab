/**
 * The live engine with its engine management running in time.
 *
 * The dyno sweep asks what a settled ECU does at each point. This asks what it does
 * while things are CHANGING — and most of what separates a good calibration from a bad
 * one only shows up here: a boost controller that overshoots when the turbo arrives, an
 * idle that sags when the A/C clutch engages, a tip-in that stumbles because the port
 * walls soaked up the fuel, a knock controller that pulls timing and takes seconds to
 * give it back, a cold start that will not catch.
 *
 * Every controller is a real discrete-time loop running at the step rate, with the
 * states a production ECU keeps. The plant is the same physics as everywhere else:
 * `solveInduction` for the manifold and turbo, `evaluatePoint` for the cycle.
 *
 * Kept apart from `liveStep` so an engine with no ECU context runs the model it always
 * ran, unchanged.
 */

import { BARO_KPA, DRIVETRAIN_EFF, PSI_TO_KPA } from '../constants.js';
import { COEFF } from '../coefficients.js';
import { ENGINE_INERTIA, readSpeedAndAirflow, STALL_RPM, steadyManifoldKpa } from '../live.js';
import { clamp, interp2 } from '../math.js';
import { bottlePressurePsi, stepBottle } from '../nitrous.js';
import { evaluatePoint } from '../point.js';
import { RPM } from '../tables.js';
import { chargeTempK, INDUCTION_REF_EXHAUST_K } from '../thermo.js';
import { solveInduction } from '../turbo.js';
import { boostTarget, gateHoldPsi } from './boost.js';
import { DYNO_GEAR } from './calibration.js';
import { ECU_COEFF as E } from './ecuCoefficients.js';
import { oilPressureKpa } from './ecuHardware.js';
import { read1, read2 } from './ecuTables.js';
import { knockDetection, knockNoiseV, knockSignalPerDegV, knockThresholdAt } from './knockSensor.js';
import { nitrousFraction } from './nitrousControl.js';
import { readSensor, readTps } from './sensors.js';
import { resolveEcuPoint } from './strategy.js';
import { VVT_AUTHORITY, VVT_OPTS, veAtPhase } from './vvt.js';

/**
 * A fresh ECU state for the live engine.
 * @returns {object}
 */
export function makeEcuLiveState() {
  return {
    knockRetard: 0, knockQuiet: 99, boostDuty: 0, boostI: 0, boostTargetRamped: 0,
    overboostT: 0, boostCutPsi: 0, fuelCutProt: false, limp: null,
    camIn: 0, camEx: 0, camInVel: 0, film: 0, aePct: 0, prevTps: 0, sinceStart: 0,
    afterStartPct: 0, volts: 12.6, throttle: 0, extraFuelPct: 0, torqueRetard: 0,
    leanT: 0, oilT: 0, sMap: BARO_KPA, sIat: 25, sLambda: 1, sTps: 0, sEct: 20,
    protect: [], faultsSeen: [], railKpa: 300, oilKpa: 0, log: [],
    afrTargetF: null, highDet: false, launchCut: false, egtK: INDUCTION_REF_EXHAUST_K,
  };
}

/** Wall-film fraction and evaporation time constant by coolant temperature. */
function filmParams(ectC) {
  const cold = clamp((E.FILM_WARM_C - ectC) / E.FILM_COLD_SPAN_C, 0, 1);
  return { X: E.FILM_X_WARM + E.FILM_X_COLD_ADD * cold, tau: E.FILM_TAU_WARM_S + E.FILM_TAU_COLD_ADD_S * cold };
}

/** Log channels, in order, recorded every step. Units in `LOG_CHANNELS` below. */
export const LOG_CHANNELS = [
  { id: 't', label: 'Time', unit: 's' },
  { id: 'rpm', label: 'RPM', unit: 'rpm' },
  { id: 'pedal', label: 'Pedal', unit: '%' },
  { id: 'throttle', label: 'Throttle', unit: '%' },
  { id: 'tps', label: 'TPS (read)', unit: '%' },
  { id: 'map', label: 'MAP', unit: 'kPa' },
  { id: 'sMap', label: 'MAP (read)', unit: 'kPa' },
  { id: 'boost', label: 'Boost', unit: 'psi' },
  { id: 'boostTarget', label: 'Boost target', unit: 'psi' },
  { id: 'wgDuty', label: 'Wastegate duty', unit: '%' },
  { id: 'lambda', label: 'Lambda', unit: 'λ' },
  { id: 'sLambda', label: 'Lambda (wideband)', unit: 'λ' },
  { id: 'lambdaTarget', label: 'Lambda target', unit: 'λ' },
  { id: 'stft', label: 'STFT', unit: '%' },
  { id: 'ltft', label: 'LTFT', unit: '%' },
  { id: 'ae', label: 'Accel enrich', unit: '%' },
  { id: 'filmFactor', label: 'Fuel reaching cylinder', unit: '%' },
  { id: 'pw', label: 'Pulse width', unit: 'ms' },
  { id: 'duty', label: 'Injector duty', unit: '%' },
  { id: 'deadTime', label: 'Dead time', unit: 'ms' },
  { id: 'railDp', label: 'Fuel ΔP', unit: 'kPa' },
  { id: 'timing', label: 'Spark (used)', unit: '°' },
  { id: 'knockRetard', label: 'Knock retard', unit: '°' },
  { id: 'knockV', label: 'Knock signal', unit: 'V' },
  { id: 'camIn', label: 'Intake cam', unit: '°' },
  { id: 'camInTarget', label: 'Intake cam target', unit: '°' },
  { id: 'camEx', label: 'Exhaust cam', unit: '°' },
  { id: 'idleTarget', label: 'Idle target', unit: 'rpm' },
  { id: 'idleAir', label: 'Idle air', unit: '%' },
  { id: 'torque', label: 'Torque (crank)', unit: 'Nm' },
  { id: 'egt', label: 'EGT', unit: '°C' },
  { id: 'iat', label: 'IAT (read)', unit: '°C' },
  { id: 'ect', label: 'Coolant', unit: '°C' },
  { id: 'oil', label: 'Oil pressure', unit: 'kPa' },
  { id: 'volts', label: 'Battery', unit: 'V' },
  { id: 'misfire', label: 'Misfire', unit: '%' },
  { id: 'bfs', label: 'Base fuel schedule', unit: 'ms' },
  { id: 'knockCount', label: 'Knock strength', unit: '' },
  { id: 'highDet', label: 'High-det flag', unit: '' },
  { id: 'launch', label: 'Launch control', unit: '' },
  { id: 'cut', label: 'Cut', unit: '%' },
  { id: 'nitrous', label: 'Nitrous', unit: 'lb/min' },
  { id: 'bottle', label: 'Bottle pressure', unit: 'psi' },
  { id: 'blowerRpm', label: 'Blower speed', unit: 'rpm' },
  { id: 'veTable', label: 'VE (table)', unit: '%' },
];

/** How much log the live engine keeps, steps (60 s at 20 Hz). */
export const LOG_LENGTH = 1200;

/**
 * One step of the live engine and its ECU.
 *
 * @param {object} st previous state (the ECU-less fields plus `ecu`)
 * @param {number} dt seconds
 * @param {{throttle: number, load: number}} input pedal %, external load Nm
 * @param {object} cfg the live config, with `ecu: {cal, hw, cond, aux}`
 * @returns {object}
 */
export function liveStepEcu(st, dt, input, cfg) {
  const s = { ...st };
  const e = { ...(st.ecu ?? makeEcuLiveState()) };
  s.ecu = e;
  const { cal, cond } = cfg.ecu;
  const aux = cfg.ecu.aux ?? {};
  const faults = cond.faults ?? {};
  const env = cond.env;
  const baro = env.baroKpa;
  const { derived, mods, turboOn, boostCurve, turbine, compressor } = cfg;
  const tables = { ve: cfg.ve, timing: cfg.timing, afr: cfg.afr };
  const hw = {
    ...cfg.ecu.hw, derived, mods, turboOn, boostCurve, turbine, compressor,
    blower: cfg.blower ?? null, blowerRatio: cfg.blowerRatio ?? 1, nitrous: cfg.nitrous ?? null,
    injectorCc: cfg.injectorCc, ecuInjectorCc: cfg.ecuInjectorCc, mafScalar: cfg.mafScalar,
    mafErrorBase: cfg.mafErrorBase, fuel: cfg.fuel,
    veTruthByPhase: cfg.ecu.hw.veTruthByPhase ?? [cfg.veTruth ?? cfg.ve],
  };
  const redline = derived.redline ?? 7500;
  // A nitrous bottle, carried between steps. A full one — at the heater's set point or the
  // day's temperature — the first time the engine sees the kit, whenever the driver swaps
  // in a fresh bottle, and when BUILD fits a different size.
  // Fuel trims reset from the tuning software — done after a VE correction takes the
  // error the long-term trim had learned into the table.
  const trimResets = aux.trimResets ?? 0;
  if ((s.trimResets ?? 0) !== trimResets) { s.stft = 0; s.ltft = 0; s.trimResets = trimResets; }
  const bottleLb = hw.nitrous?.bottleLb ?? 10;
  const fills = aux.bottleFills ?? 0;
  if (hw.nitrous && (!s.bottle || s.bottle.fills !== fills || s.bottle.sizeLb !== bottleLb)) {
    s.bottle = {
      massKg: bottleLb * 0.45359237, tempK: hw.nitrous.heater ? E.N2O_HEATER_SET_K : env.ambientK,
      fills, sizeLb: bottleLb,
    };
  }
  s.prevRpm = st.rpm;
  s.elapsed = (s.elapsed ?? 0) + dt;
  e.rpmPrev = st.ecu?.rpmSeen ?? st.rpm;
  e.rpmSeen = st.rpm;

  // ---- starter and stall
  const wasRunning = s.running;
  if (s.cranking && s.rpm > E.RUNNING_RPM) { s.cranking = false; s.running = true; }
  if (s.running && s.rpm < STALL_RPM) { s.running = false; s.fuelCut = false; }
  if (s.running && !wasRunning) {
    e.sinceStart = 0;
    e.afterStartPct = read1(cal.fuel.afterStart, e.sEct);
    s.idleTrim = read1(cal.idle.baseAir, e.sEct);
  }
  if (s.running) e.sinceStart += dt;
  e.afterStartPct *= Math.exp(-dt / Math.max(0.2, cal.fuel.afterStartDecayS));

  // ---- SENSORS: what the ECU reads this step, filtered as calibrated.
  const lastPt = s.live;
  const f = (tau) => (tau > 0 ? clamp(dt / tau, 0, 1) : 1);
  const tps = readTps(e.throttle, { closedV: cal.sensors.tpsClosedV, openV: cal.sensors.tpsOpenV }, faults.tps);
  e.sTps += (tps.value - e.sTps) * f(cal.sensors.tpsFilterS);
  const mapPart = hw.sensorHw?.map ?? '3bar';
  const mapScale = cal.sensors.map === 'auto' ? mapPart : cal.sensors.map;
  // MAP is sampled again once this step's manifold is solved, right before the fuel
  // calculation, the way an ECU samples it just ahead of each injection. This first
  // read, on last step's manifold, is what the boost controller and cam targets use.
  let mapRd = readSensor({ kind: 'map', value: lastPt ? lastPt.map : baro, part: mapPart, scale: mapScale, fault: faults.map, fallback: baro });
  e.sMap += (mapRd.value - e.sMap) * f(cal.sensors.mapFilterS);
  const iatRd = readSensor({ kind: 'iat', value: lastPt ? lastPt.iat : env.ambientK - 273.15, part: hw.sensorHw?.iat ?? 'bosch', scale: cal.sensors.iat, fault: faults.iat, fallback: 40 });
  e.sIat += (iatRd.value - e.sIat) * f(cal.sensors.iatFilterS);
  const ectRd = readSensor({ kind: 'ect', value: s.coolantC, part: hw.sensorHw?.ect ?? 'bosch', scale: cal.sensors.ect, fault: faults.ect, fallback: 90 });
  e.sEct += (ectRd.value - e.sEct) * f(1.0);
  // A fuel cut blows straight air past the wideband; a spark cut still carries its fuel.
  const trueLambda = lastPt && s.running && !(s.fuelCut && e.cutType !== 'spark') ? (lastPt.lambdaExhaust ?? lastPt.lambda) : 1.6;
  const wbRd = readSensor({ kind: 'wideband', value: trueLambda, part: hw.sensorHw?.wideband ?? 'lambda-0.5-1.5', scale: cal.sensors.wideband, fault: faults.wideband, fallback: 1 });
  e.sLambda += (wbRd.value - e.sLambda) * f(cal.sensors.widebandFilterS);
  const faultList = [tps.fault && 'TPS', mapRd.fault && 'MAP', iatRd.fault && 'IAT', ectRd.fault && 'Coolant', wbRd.fault && 'Wideband'].filter(Boolean);
  e.faultsSeen = faultList;

  // ---- BATTERY AND ALTERNATOR.
  const demandA = E.LOAD_BASE_A + (aux.lights ? E.LOAD_LIGHTS_A : 0) + (aux.ac ? E.LOAD_AC_A : 0);
  let altNm = 0;
  if (s.cranking) e.volts = E.BATTERY_CRANKING_V;
  else if (s.running) {
    // A 120 A alternator turns about 2.8 times crank speed. It gives nothing until it
    // passes its cut-in speed, about half its rating at a hot idle, and nearly all of it
    // from 2000 RPM up — so a car at idle with the lights and A/C on runs a deficit and
    // the voltage sags, while one with nothing switched on holds its charge.
    const capA = E.ALT_RATED_A * clamp(1 - Math.exp(-(s.rpm - E.ALT_CUT_IN_RPM) / E.ALT_RISE_RPM), 0, 1);
    const suppliedA = Math.min(demandA, capA);
    e.volts = demandA <= capA
      ? E.ALT_REGULATED_V - E.ALT_DROOP_V_PER_A * demandA
      : E.BATTERY_DEFICIT_V - (demandA - capA) * E.BATTERY_SAG_V_PER_A;
    altNm = (e.volts * suppliedA) / (Math.max(50, s.rpm) * 2 * Math.PI / 60) / E.ALT_EFFICIENCY;
  } else e.volts = E.BATTERY_REST_V;

  // ---- LIMP AND PROTECTION STATE.
  const P = cal.protect;
  e.limp = null;
  if (P.sensorLimp && faultList.length) e.limp = `${faultList.join(', ')} sensor fault`;
  if (P.ectEnabled && e.sEct > P.ectLimitC) e.limp = 'Coolant over temperature';
  const limp = !!e.limp;

  // ---- THROTTLE: pedal map, limp limit, electronic throttle slew.
  const idleZone = e.sTps < cal.idle.tpsIdlePct;
  const pedal = input.throttle;
  let bladeTarget = read1(cal.airflow.pedalMap, pedal);
  if (limp) bladeTarget = Math.min(bladeTarget, P.limpThrottlePct);
  const maxStep = cal.airflow.etbRatePctS * dt;
  e.throttle += clamp(bladeTarget - e.throttle, -maxStep, maxStep);

  // ---- IDLE CONTROL.
  const idleTarget = read1(cal.idle.target, e.sEct) + (aux.ac ? cal.idle.acRpmAdd : 0);
  e.idleTarget = idleTarget;
  // For the first moments after the engine catches it flares on its own, and the idle
  // valve does not chase the flare down — closing the loop on it winds the controller
  // up for the dip that follows. It will still add air if the engine sags.
  if (s.running && idleZone && pedal < 3) {
    const holding = e.sinceStart < cal.idle.startHoldS && s.rpm > idleTarget;
    if (holding) { /* hold base air through the flare */ } else if (s.rpm < E.IDLE_CAPTURE_RPM) {
      const err = idleTarget - s.rpm;
      const gain = err > 0 ? cal.idle.gainUp : cal.idle.gainDown;
      // Damping on the speed change over the last step — the derivative term. (Taken
      // against the step before, not this one: engine speed has not moved yet this step.)
      const damp = (st.rpm - (e.rpmPrev ?? st.rpm)) * cal.idle.damp;
      s.idleTrim = clamp(s.idleTrim + err * gain * (dt / 0.05) - damp, E.IDLE_AIR_MIN_PCT, E.IDLE_AIR_MAX_PCT);
      if (err > cal.idle.antiStallRpm) {
        s.idleTrim = clamp(s.idleTrim + cal.idle.antiStallAir * (dt / 0.05) * E.ANTISTALL_STEP_SHARE, E.IDLE_AIR_MIN_PCT, E.IDLE_AIR_MAX_PCT);
      }
    } else {
      // Coasting down: the idle valve bleeds back toward nearly shut so the engine can
      // actually decelerate; it catches the engine again below 2000 RPM.
      s.idleTrim += (E.IDLE_COAST_AIR_PCT - s.idleTrim) * cal.idle.bleed * (dt / 0.05);
    }
  }
  const idleAir = (s.running ? s.idleTrim : 0) + (aux.ac ? cal.idle.acAirAdd : 0) + (aux.lights ? cal.idle.elecAirAdd : 0);
  e.idleAir = idleAir;
  let effThrottle = clamp(Math.max(e.throttle, idleAir), 0, 100);

  // ---- OVERRUN FUEL CUT AND REV LIMITER.
  const dfco = cal.fuel.dfcoEnabled && s.running && idleZone && pedal < 3
    && s.rpm > (s.dfco ? cal.fuel.dfcoExitRpm : cal.fuel.dfcoEnterRpm) && e.sEct > cal.fuel.dfcoMinEctC;
  s.dfco = dfco;
  let hardCut = limp ? Math.min(P.limpRpm, redline + cal.limiter.offsetRpm) : redline + cal.limiter.offsetRpm;
  if (cal.limiter.coldLimitRpm > 0 && e.sEct < cal.limiter.coldBelowC) hardCut = Math.min(hardCut, cal.limiter.coldLimitRpm);
  // Launch control: a second limiter, armed with the clutch in and the throttle pinned.
  const launchArmed = !!(aux.launch && cal.arc.launchEnabled && s.running && pedal > 80);
  if (launchArmed) {
    if (s.rpm >= cal.arc.launchRpm) e.launchCut = true;
    else if (s.rpm < cal.arc.launchRestoreRpm) e.launchCut = false;
  } else e.launchCut = false;
  // Throttle-cut limiter: the blade closes progressively approaching the fuel cut.
  if (cal.limiter.throttleCutRpm > 0 && s.rpm > hardCut - cal.limiter.throttleCutRpm) {
    const f = clamp(1 - (s.rpm - (hardCut - cal.limiter.throttleCutRpm)) / cal.limiter.throttleCutRpm, 0.05, 1);
    effThrottle = Math.min(effThrottle, Math.max(idleAir, e.throttle * f));
  }
  if (s.running) {
    if (s.rpm >= hardCut) s.limiterCut = true;
    else if (s.rpm < hardCut - cal.limiter.restoreBandRpm) s.limiterCut = false;
  } else s.limiterCut = false;
  const softW = cal.limiter.softWindowRpm;
  const soft = softW > 0 ? clamp((s.rpm - (hardCut - softW)) / softW, 0, 1) : 0;
  let cutFrac = 0;
  let cutType = cal.limiter.mode === 'spark' ? 'spark' : 'fuel';
  let limiterRetard = 0;
  if (s.limiterCut) cutFrac = 1;
  else if (soft > 0) {
    if (cal.limiter.mode === 'retard') limiterRetard = E.LIMITER_RETARD_DEG * soft;
    else cutFrac = soft;
  }
  if (launchArmed && e.launchCut) { cutFrac = 1; cutType = 'spark'; }
  if (dfco) { cutFrac = 1; cutType = 'fuel'; }
  if (e.fuelCutProt) { cutFrac = 1; cutType = 'fuel'; }
  s.fuelCut = cutFrac >= 1 && s.running;
  // On the limiter: the gauges read differently there (cut cylinders pump air past the
  // wideband), and the player should be told why. The event-by-event share is added
  // once the step's torque is known, below.
  s.onLimiter = s.running && (s.limiterCut || (soft > 0 && cal.limiter.mode !== 'retard'));
  e.cutType = cutType;
  e.cutQuiet = cutFrac > 0 ? 0 : (e.cutQuiet ?? 1) + dt;

  // ---- COMBUSTION.
  let crankNm = 0;
  let pt = null;
  let log = null;
  if ((s.running || s.cranking) && s.rpm > 100) {
    const rpmC = clamp(s.rpm, 700, redline);
    const aFrac = effThrottle / 100;
    const nFrac = clamp(rpmC / COEFF.MANIFOLD_VACUUM_RPM_NORM, 0, 1.2);
    const overlap = (derived.overlapDeg || 0) + e.camIn + e.camEx;
    // At cranking speed the engine barely pumps, so the manifold sits close to
    // atmospheric whatever the throttle is doing.
    const loadSteady = s.cranking
      ? BARO_KPA * clamp(E.CRANKING_MAP_FRAC - (s.rpm / 1000) * E.CRANKING_MAP_FALL_PER_KRPM, E.CRANKING_MAP_MIN_FRAC, E.CRANKING_MAP_MAX_FRAC)
      : steadyManifoldKpa(aFrac, nFrac, overlap);
    // MANIFOLD FILLING. The plenum is a volume the throttle fills and the engine empties,
    // so its pressure follows a change with a time constant of roughly the plenum's volume
    // over what the engine swallows per second: about a fifth of a second at idle, a few
    // hundredths at high speed. That lag is why an idle controller with too much gain
    // hunts, and why a tip-in reaches the cylinders a few cycles after the throttle.
    const fillTau = E.PLENUM_TO_DISPLACEMENT * 120 / Math.max(300, s.rpm);
    e.manifold = e.manifold == null ? loadSteady : e.manifold + (loadSteady - e.manifold) * clamp(dt / fillTau, 0, 1);
    const loadKpa = e.manifold;

    // Boost: target, ramp, closed-loop duty, wastegate.
    let target = 0;
    let steps = [];
    if (turboOn) {
      const bt = boostTarget({ cal: cal.boost, baseCurve: boostCurve, rpmAxis: RPM, rpm: rpmC, throttlePct: e.sTps, gear: DYNO_GEAR, iatC: e.sIat });
      target = Math.max(0, bt.target - e.boostCutPsi - (limp ? E.BOOST_CUT_ALL_PSI : 0));
      steps = bt.steps;
    }
    e.boostTargetRamped = Math.min(target, e.boostTargetRamped + cal.boost.rampPsiS * dt);
    if (target < e.boostTargetRamped) e.boostTargetRamped = target;
    const sBoost = (e.sMap - baro) / PSI_TO_KPA;
    const base = read2(cal.boost.baseDuty, rpmC, e.boostTargetRamped);
    let duty = base;
    if (cal.boost.mode === 'closed' && turboOn) {
      const err = e.boostTargetRamped - sBoost;
      if (Math.abs(err) < cal.boost.iWindowPsi) e.boostI = clamp(e.boostI + cal.boost.ki * err * dt, -E.BOOST_INTEGRAL_LIMIT_PCT, E.BOOST_INTEGRAL_LIMIT_PCT);
      duty = base + cal.boost.kp * err + e.boostI;
    }
    if (e.boostTargetRamped <= 0.05) { duty = 0; e.boostI = 0; }
    duty = clamp(duty, 0, cal.boost.maxDuty);
    e.boostDuty = duty;
    const tf = clamp(loadKpa / BARO_KPA, 0, 1);
    const gateHold = gateHoldPsi(hw.gate, duty) * (hw.gate?.type === 'pneumatic' ? tf * tf : 1);

    // Cams: target, then the phaser's own dynamics — rate-limited, oil-driven, and
    // locked on its pin until the oil is warm enough to move it predictably.
    const vvt = VVT_OPTS.find((o) => o.id === hw.vvt) ?? VVT_OPTS[0];
    const inT = vvt.intake ? clamp(read2(cal.vvt.intakeTarget, rpmC, e.sMap), 0, VVT_AUTHORITY.intake) : 0;
    const exT = vvt.exhaust ? clamp(read2(cal.vvt.exhaustTarget, rpmC, e.sMap), 0, VVT_AUTHORITY.exhaust) : 0;
    const oilKpa = oilPressureKpa(s.rpm, s.oilC, cond.oilHealth ?? 1);
    const oilAuth = clamp(oilKpa / E.PHASER_FULL_OIL_KPA, 0, 1);
    const unlocked = s.oilC >= cal.vvt.minOilC && s.running;
    const phase = (pos, tgt, max) => {
      if (!unlocked) return pos + (0 - pos) * clamp(dt * E.PHASER_LOCK_RETURN_PER_S, 0, 1);
      const rate = clamp(cal.vvt.gain * (tgt - pos), -cal.vvt.rateDegS * oilAuth, cal.vvt.rateDegS * oilAuth);
      return clamp(pos + rate * dt, -E.PHASER_OVERTRAVEL_DEG, max + E.PHASER_OVERTRAVEL_DEG);
    };
    e.camIn = phase(e.camIn, inT, VVT_AUTHORITY.intake);
    e.camEx = phase(e.camEx, exT, VVT_AUTHORITY.exhaust);
    e.camInTarget = inT;

    const steady = solveInduction({
      rpm: rpmC, loadKpa, turboOn, boostTargetPsi: gateHold, targetIsFinal: true, turbine, compressor,
      veAt: (m) => veAtPhase(hw.veTruthByPhase, rpmC, m, e.camIn), derived,
      intakeKAt: (b) => chargeTempK(b, mods.intercooler, env),
      // The turbine is priced at the reference full-load exhaust temperature the dyno
      // uses, unless the exhaust is running hotter than that — retarded or afterburning
      // exhaust (a two-step's spark cut) carries more energy to the turbine, which is
      // how anti-lag spools a turbo on the line.
      lambda: 1, exhaustK: Math.max(INDUCTION_REF_EXHAUST_K, e.egtK), baroKpa: baro,
      ...(hw.blower ? { blower: hw.blower, blowerRatio: hw.blowerRatio, intakeKAtEff: (b, eta) => chargeTempK(b, mods.intercooler, env, eta) } : {}),
    });
    const spooling = steady.boostPsi > s.boostPsi;
    const flowFrac = clamp(rpmC / Math.max(1, redline) * aFrac, 0.02, 1);
    const tau = spooling
      ? COEFF.TURBO_SPOOL_TAU_S / Math.max(0.05, flowFrac) * (turbine?.inertiaScale ?? 1)
      : COEFF.TURBO_DECAY_TAU_S;
    // A supercharger is belted to the crank: no wheel to spool, its boost is there the
    // moment the throttle and the bypass let it through.
    s.boostPsi = hw.blower ? steady.boostPsi
      : turboOn ? s.boostPsi + (steady.boostPsi - s.boostPsi) * clamp(dt / Math.max(dt, tau), 0, 1) : 0;
    const mapKpa = Math.min(loadKpa * (baro / BARO_KPA), baro) + s.boostPsi * PSI_TO_KPA;
    const sMapPrev = e.sMap;
    mapRd = readSensor({ kind: 'map', value: mapKpa, part: mapPart, scale: mapScale, fault: faults.map, fallback: baro });
    e.sMap = sMapPrev + (mapRd.value - sMapPrev) * f(cal.sensors.mapFilterS);

    // Overboost protection, on the boost the ECU can see.
    if (turboOn && cal.boost.overboostEnabled && sBoost > target + cal.boost.overboostMarginPsi) e.overboostT += dt;
    else e.overboostT = Math.max(0, e.overboostT - dt);
    if (e.overboostT > cal.boost.overboostDelayS) {
      if (cal.boost.overboostAction === 'fuel-cut') e.fuelCutProt = true;
      else e.boostCutPsi = E.BOOST_CUT_ALL_PSI;
    }
    if (pedal < 3) { e.fuelCutProt = e.fuelCutProt && e.overboostT > 0; if (e.boostCutPsi >= E.BOOST_CUT_ALL_PSI && e.overboostT === 0) e.boostCutPsi = 0; }

    // Transient fuelling: acceleration enrichment on the ECU side, wall film on the
    // physical side. The film is fuel that landed on the port wall instead of going into
    // the cylinder; it evaporates back over τ. In steady running the two flows balance
    // and the cylinder gets exactly what was injected.
    const tpsRate = (e.sTps - e.prevTps) / dt;
    e.prevTps = e.sTps;
    const cold = read1(cal.fuel.accelColdMult, e.sEct);
    const aeWant = tpsRate > 5 ? read1(cal.fuel.accel, tpsRate) * cold
      : tpsRate < -5 ? -read1(cal.fuel.accel, -tpsRate) * cold * cal.fuel.decelEnlean : 0;
    const decayed = e.aePct * Math.exp(-dt / Math.max(0.02, cal.fuel.accelDecayS));
    e.aePct = aeWant > 0 ? Math.max(decayed, aeWant) : aeWant < 0 ? Math.min(decayed, Math.max(-60, aeWant)) : decayed;
    if (Math.abs(e.aePct) < 0.05) e.aePct = 0;
    const { X, tau: filmTau } = filmParams(s.coolantC);
    const injPerCycle = lastPt?.fuelCmd != null && !s.fuelCut ? lastPt.fuelCmd / 1000 : 0;
    const cycles = (s.rpm / 120) * dt;
    const evap = e.film * clamp(dt / filmTau, 0, 1);
    e.film = Math.max(0, e.film + X * injPerCycle * cycles - evap);
    const deliveredPerCycle = injPerCycle > 0 ? (1 - X) * injPerCycle + evap / Math.max(1e-6, cycles) : 0;
    const filmFactor = injPerCycle > 0 ? clamp(deliveredPerCycle / injPerCycle, 0.2, 3) : (s.cranking ? 1 - X : 1);

    // Knock control: retard in steps on each event heard, recover slowly.
    const idleSpark = s.running && idleZone && pedal < 3 && s.rpm < E.IDLE_SPARK_MAX_RPM
      ? clamp((idleTarget - s.rpm) * cal.idle.sparkGain, -cal.idle.sparkLimit, cal.idle.sparkLimit) : 0;
    const veActual = veAtPhase(hw.veTruthByPhase, rpmC, mapKpa, e.camIn);
    const crankingPct = s.cranking ? read1(cal.fuel.cranking, e.sEct) : 0;
    // Target lookup delay: a move to a richer target is eased in over the delay; a move
    // leaner is immediate.
    const afrTable = interp2(tables.afr, rpmC, e.sMap);
    if (e.afrTargetF == null || cal.fuel.targetDelayS <= 0 || afrTable > e.afrTargetF) e.afrTargetF = afrTable;
    else e.afrTargetF += (afrTable - e.afrTargetF) * clamp(dt / cal.fuel.targetDelayS, 0, 1);
    if (cal.ignition.highDetRetard > 0 && e.knockRetard > cal.ignition.highDetTriggerDeg) { e.highDet = true; e.highDetQuiet = 0; }
    if (e.highDet && e.knockRetard === 0) { e.highDetQuiet = (e.highDetQuiet ?? 0) + dt; if (e.highDetQuiet > E.HIGH_DET_QUIET_S) e.highDet = false; }
    // Nitrous: armed from the cockpit, sprayed inside the controller's window, ramped in
    // real seconds on a progressive controller, and shut off by a lean cut until the
    // driver lifts.
    if (pedal < 3) e.nitrousCut = false;
    let nitrousFrac = 0;
    const armed = aux.nitrous !== false;
    if (hw.nitrous && cal.nitrous && armed && s.running && !e.nitrousCut && s.bottle.massKg > 0) {
      nitrousFrac = nitrousFraction({ ncal: cal.nitrous, rpm: s.rpm, throttlePct: e.sTps, ectC: e.sEct, sinceOnS: e.nitrousOnS ?? 0 });
    }
    e.nitrousOnS = nitrousFrac > 0 ? (e.nitrousOnS ?? 0) + dt : 0;
    const condNow = hw.nitrous ? { ...cond, nitrous: { armed, bottleK: s.bottle.tempK } } : cond;
    const res = resolveEcuPoint({
      cal, hw, cond: condNow, tables, rpm: rpmC, mapKpa, boostPsi: s.boostPsi, veActual,
      cam: { intakeAdvDeg: e.camIn, exhaustRetDeg: e.camEx }, empKpa: steady.empKpa,
      dyn: {
        steadyTrims: false, sensedMapKpa: e.sMap, sensedIatC: e.sIat, sensedEctC: e.sEct,
        knockRetardDeg: e.knockRetard, stftPct: s.stft, ltftPct: s.ltft, aePct: e.aePct,
        afterStartPct: s.running ? e.afterStartPct : 0, crankingPct, cylinderFuelFactor: filmFactor,
        cutFrac, cutType, extraRetardDeg: limiterRetard + e.torqueRetard, extraFuelPct: e.extraFuelPct,
        idleSparkDeg: idleSpark, cranking: s.cranking, decel: pedal < 3 && s.rpm > E.IDLE_SPARK_MAX_RPM && !dfco,
        afrTarget: e.afrTargetF, oilC: s.oilC, highDet: e.highDet, launch: launchArmed, nitrousFrac,
      },
      ...(steady.blower ? { blower: steady.blower } : {}),
    });
    pt = evaluatePoint(/** @type {any} */ (res.input));
    e.egtK += (pt.egt + 273.15 - e.egtK) * clamp(dt / E.EGT_FILTER_S, 0, 1);
    // Cranking: the engine turns at a few hundred RPM, not the 700 the cycle is solved
    // at, so friction and pumping are the starter's to overcome; only the combustion
    // that actually lights adds to it.
    crankNm = s.cranking
      ? Math.max(0, (pt.imep * 1e5 * (derived.displacementL / 1000)) / (4 * Math.PI))
      : pt.torque / 0.7376 / DRIVETRAIN_EFF;

    // Knock: what actually happened this step, and whether the sensor heard it.
    const actualKnockDeg = pt.knockUnheard ?? 0;
    const noiseV = knockNoiseV(s.rpm, derived);
    const knockV = noiseV + actualKnockDeg * knockSignalPerDegV(pt.peakPressure);
    const thresholdV = knockThresholdAt(cal.ignition.knockThreshold, s.rpm, derived);
    const det = knockDetection({ rpm: s.rpm, peakBar: pt.peakPressure, thresholdV, derived, maxRetardDeg: cal.ignition.knockMaxRetard });
    const heard = cal.ignition.knockEnabled && s.running && (knockV > thresholdV || det.falseRetardDeg > 0.5 && Math.random() < det.falseRetardDeg / cal.ignition.knockMaxRetard);
    // Timing past what this engine tolerates at this instant — as opposed to retard
    // the controller is still giving back after an earlier event, or noise it
    // mistook for knock. That is what makes a timing gauge worth colouring.
    e.knockNow = pt.margin < 0;
    if (heard) {
      e.knockRetard = Math.min(cal.ignition.knockMaxRetard, e.knockRetard + cal.ignition.knockStep);
      e.knockQuiet = 0;
    } else {
      e.knockQuiet += dt;
      if (e.knockQuiet > cal.ignition.knockRecoveryDelayS) e.knockRetard = Math.max(0, e.knockRetard - cal.ignition.knockRecoveryDegS * dt);
    }
    if (actualKnockDeg > 0) s.knockCount += actualKnockDeg * dt * E.KNOCK_COUNT_PER_DEG_S;
    e.knockV = knockV;

    // Protections that act on the next step.
    const prot = [];
    // Lean protection is disarmed while the ECU itself is cutting fuel: a cut cylinder
    // pumps straight air past the wideband, and that is not a lean mixture.
    if (P.leanEnabled && e.sLambda > P.leanLambda && e.sMap > P.leanMinKpa && s.running && cutFrac === 0 && e.cutQuiet > E.CUT_SETTLE_S) e.leanT += dt; else e.leanT = 0;
    if (e.leanT > E.LEAN_CONFIRM_S) {
      prot.push('lean');
      if (P.leanAction === 'fuel-cut') e.fuelCutProt = true;
      else if (P.leanAction === 'torque') e.torqueRetard = Math.min(E.LEAN_RETARD_MAX_DEG, e.torqueRetard + E.LEAN_RETARD_RATE_DEG_S * dt);
      else e.boostCutPsi = Math.max(e.boostCutPsi, P.boostCutPsi);
    }
    if (nitrousFrac > 0 && cal.nitrous.leanCutEnabled && e.sLambda > cal.nitrous.leanCutLambda) {
      prot.push('nitrous lean');
      e.nitrousCut = true;
    }
    if (P.egtEnabled && pt.egt > P.egtLimitC) { prot.push('egt'); e.extraFuelPct = Math.min(P.egtEnrichMaxPct, e.extraFuelPct + E.EGT_ENRICH_RATE_PCT_S * dt); } else e.extraFuelPct = Math.max(0, e.extraFuelPct - E.EGT_ENRICH_DECAY_PCT_S * dt);
    if (P.iatEnabled && e.sIat > P.iatLimitC) prot.push('iat');
    // Both act by cutting boost, which only a turbo's wastegate can do — as on the dyno, a
    // supercharged or naturally aspirated engine is left to knock control and the limits.
    if (turboOn && P.knockEnabled && e.knockRetard > P.knockRetardDeg) { prot.push('knock'); e.boostCutPsi = Math.max(e.boostCutPsi, P.knockBoostCutPsi); }
    if (turboOn && P.dutyEnabled && pt.duty > P.dutyLimitPct) { prot.push('duty'); e.boostCutPsi = Math.max(e.boostCutPsi, P.boostCutPsi); }
    const rail = res.sensed.rail;
    e.railKpa = rail.railGaugeKpa;
    if (P.fuelPressEnabled && rail.deltaKpa < P.fuelMinDeltaKpa && s.running) { prot.push('fuel pressure'); e.limp = e.limp ?? 'Low fuel pressure'; }
    e.oilKpa = oilKpa;
    if (P.oilEnabled && s.running && oilKpa < read1(P.oilMinKpa, s.rpm)) e.oilT += dt; else e.oilT = 0;
    if (e.oilT > E.OIL_CONFIRM_S) { prot.push('oil pressure'); e.fuelCutProt = true; }
    const limitNm = read1(cal.torque.limitByRpm, s.rpm);
    if (crankNm > limitNm) {
      prot.push('torque');
      e.torqueRetard = Math.min(E.TORQUE_RETARD_MAX_DEG, e.torqueRetard + E.TORQUE_RETARD_RATE_DEG_S * dt);
    } else if (e.leanT === 0) e.torqueRetard = Math.max(0, e.torqueRetard - E.TORQUE_RETARD_RECOVER_DEG_S * dt);
    if (pedal < 3 && e.boostCutPsi > 0 && e.boostCutPsi < E.BOOST_CUT_ALL_PSI) e.boostCutPsi = 0;
    if (e.limp) prot.push('limp');
    if (soft > 0 || s.limiterCut) prot.push('limiter');
    if (e.launchCut) prot.push('launch');
    if (e.highDet) prot.push('high-det');
    e.protect = prot;

    log = {
      map: pt.map, boost: s.boostPsi, boostTarget: e.boostTargetRamped, wgDuty: duty, lambda: pt.lambdaExhaust ?? pt.lambda,
      lambdaTarget: res.input.afrCommanded / 14.7, veTable: res.breakdown.ve[0].value, mafPct: pt.trimPct ?? 0, pw: pt.pw, duty: pt.duty, deadTime: pt.deadTime, railDp: pt.railDp,
      timing: pt.timing, egt: pt.egt, misfire: pt.misfire, filmFactor: filmFactor * 100, bfs: pt.bfs,
      torque: crankNm, breakdown: res.breakdown, boostSteps: steps, closedLoopRegion: res.sensed.closedLoopRegion,
    };
  }

  // ---- ROTATIONAL DYNAMICS.
  const starterNm = s.cranking ? E.STARTER_STALL_NM * clamp(1 - s.rpm / E.STARTER_FREE_RPM, 0, 1) : 0;
  const crankDrag = s.cranking
    ? ((derived.displacementL / 1000) * (E.CRANKING_FMEP_PA + (pt ? (BARO_KPA - pt.map) * 1000 : 0))) / (4 * Math.PI)
    : 0;
  const acNm = s.running && aux.ac ? E.AC_NM : 0;
  const netNm = crankNm + starterNm - crankDrag - altNm - acNm - (s.running ? input.load : 0);
  // A real limiter decides on every firing event, which holds the engine at the cut. This
  // model steps twenty times a second, and a free-revving engine can gain several hundred
  // RPM in one step, so deciding only when the speed has crossed the line lets it sail
  // far past it. Instead: if this step's torque would carry the engine past the cut, cut
  // the share of events that lands it on the line — the per-event limiter, averaged over
  // the step.
  let netNmNow = netNm;
  if (s.running && !s.limiterCut && crankNm > 0 && hardCut > 0) {
    const toCutRadS = (hardCut - s.rpm) * 2 * Math.PI / 60;
    const allowedNet = (toCutRadS * ENGINE_INERTIA) / dt;
    if (netNm > allowedNet) {
      const share = clamp((netNm - Math.max(allowedNet, netNm - crankNm)) / crankNm, 0, 1);
      netNmNow = netNm - crankNm * share;
      crankNm *= 1 - share;
      e.limiterShare = share;
      s.onLimiter = true;
    } else e.limiterShare = 0;
  }
  s.omega = Math.max(0, s.omega + (netNmNow / ENGINE_INERTIA) * dt);
  s.rpm = s.omega * 60 / (2 * Math.PI);
  if (!s.running && !s.cranking) s.rpm = Math.max(0, s.rpm - 900 * dt);
  s.omega = s.rpm * 2 * Math.PI / 60;

  // ---- THERMAL. The thermostat and fan hold coolant at 95 °C unless the fan has failed.
  const coolCap = faults.fan === 'failed' ? E.COOLANT_FAN_FAILED_C : cal.protect.fanOnC;
  if (s.running) {
    const heatIn = 0.9 + (Math.max(0, crankNm) / 200) * 3.2;
    s.coolantC = Math.min(coolCap, s.coolantC + heatIn * dt * (s.coolantC < 88 || faults.fan === 'failed' ? 1 : 0.15));
    s.oilC = Math.min(E.OIL_MAX_C, s.oilC + heatIn * dt * 0.7);
  } else {
    s.coolantC = Math.max(20, s.coolantC - 0.35 * dt);
    s.oilC = Math.max(20, s.oilC - 0.3 * dt);
  }

  // ---- CLOSED-LOOP TRIMS, on the wideband as the ECU reads it.
  const lambdaTarget = log ? log.lambdaTarget : 1;
  const closedLoop = !!(s.running && pt && log?.closedLoopRegion && !dfco && Math.abs(e.aePct) < 1 && e.sinceStart > 2 && cutFrac === 0);
  if (closedLoop) {
    const err = e.sLambda - lambdaTarget;
    s.stft = clamp(s.stft + err * cal.fuel.stftGain * (dt / 0.05) * 0.25, -cal.fuel.stftLimit, cal.fuel.stftLimit);
    // Long-term learning waits for the engine to be on its base fuelling: while an
    // enrichment the ECU added on purpose is still fading (after-start, warm-up), the
    // short-term trim fights it, and learning that would store a correction the tune
    // does not need.
    const enriching = e.afterStartPct > 0.5 || read1(cal.fuel.warmup, e.sEct) > 0.5;
    if (!enriching) s.ltft = clamp(s.ltft + s.stft * cal.fuel.ltftRate * (dt / 0.05), -cal.fuel.ltftLimit, cal.fuel.ltftLimit);
  } else if (s.running) {
    s.stft += (0 - s.stft) * 0.06;
  }

  // ---- DISPLAY SENSORS (the gauges), as the ECU-less model shows them.
  readSpeedAndAirflow(s, pt, dt, (derived.overlapDeg || 0) + e.camIn + e.camEx);
  s.sensedMap = e.sMap;
  s.sensedIat = e.sIat;
  s.sensedLambda = e.sLambda;
  s.sensedCoolant = e.sEct;
  s.live = pt;
  s.effThrottle = effThrottle;
  // What this step sprayed leaves the bottle, and boils off part of what stays.
  if (s.bottle) {
    s.bottle = {
      ...s.bottle,
      ...stepBottle(s.bottle, ((pt?.nitrousLbMin ?? 0) * 0.45359237 / 60) * dt, dt, {
        heater: !!hw.nitrous.heater, setK: E.N2O_HEATER_SET_K, ambientK: env.ambientK,
      }),
    };
  }
  s.closedLoop = closedLoop;

  // ---- LOG.
  const row = {
    t: Number(s.elapsed.toFixed(2)), rpm: Math.round(s.rpm), pedal: Math.round(pedal), throttle: Number(e.throttle.toFixed(1)),
    tps: Number(e.sTps.toFixed(1)), sMap: Math.round(e.sMap), stft: Number(s.stft.toFixed(1)), ltft: Number(s.ltft.toFixed(1)),
    ae: Number(e.aePct.toFixed(1)), knockRetard: Number(e.knockRetard.toFixed(1)), knockV: Number((e.knockV ?? 0).toFixed(3)),
    camIn: Number(e.camIn.toFixed(1)), camInTarget: Number((e.camInTarget ?? 0).toFixed(1)), camEx: Number(e.camEx.toFixed(1)),
    idleTarget: Math.round(e.idleTarget ?? 0), idleAir: Number((e.idleAir ?? 0).toFixed(1)), iat: Math.round(e.sIat), ect: Math.round(e.sEct),
    oil: Math.round(e.oilKpa), volts: Number(e.volts.toFixed(2)), sLambda: Number(e.sLambda.toFixed(3)), cut: Math.round(cutFrac * 100),
    map: log ? Math.round(log.map) : Math.round(baro), boost: log ? Number(log.boost.toFixed(1)) : 0,
    boostTarget: log ? Number(log.boostTarget.toFixed(1)) : 0, wgDuty: log ? Number(log.wgDuty.toFixed(1)) : 0,
    // A cut cylinder passes air, which reads as an infinitely lean mixture; the log
    // clamps it where a wideband's own range ends so the trace stays readable.
    lambda: log ? Number(Math.min(2, log.lambda).toFixed(3)) : 0, lambdaTarget: log ? Number(log.lambdaTarget.toFixed(3)) : 0,
    pw: log ? log.pw : 0, duty: log ? log.duty : 0, deadTime: log ? log.deadTime : 0, railDp: log ? log.railDp : 0,
    timing: log ? log.timing : 0, egt: log ? log.egt : 0, misfire: log ? log.misfire : 0,
    filmFactor: log ? Math.round(log.filmFactor) : 100, torque: Math.round(crankNm),
    bfs: log ? log.bfs : 0, knockCount: Math.round(s.knockCount), highDet: e.highDet ? 1 : 0, launch: launchArmed ? 1 : 0,
    nitrous: pt?.nitrousLbMin ?? 0, bottle: s.bottle && s.bottle.massKg > 0 ? Math.round(bottlePressurePsi(s.bottle.tempK)) : 0,
    blowerRpm: pt?.blowerRpm ?? 0,
    // The VE table's value where the ECU looked it up, so a log can say what the table
    // should have held there — even after the table has changed since.
    veTable: log ? Number(log.veTable.toFixed(2)) : 0,
    // The MAF's error the ECU applied to that fuel, so a VE correction can leave it out.
    mafPct: log ? Number(log.mafPct.toFixed(2)) : 0,
  };
  e.log = [...(st.ecu?.log ?? []), row].slice(-LOG_LENGTH);
  e.breakdown = log?.breakdown ?? null;
  e.boostSteps = log?.boostSteps ?? null;
  return s;
}
