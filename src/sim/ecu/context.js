/**
 * Assembling the ECU's world from the app's state: which parts are fitted, what the day
 * is like, what condition the engine is in.
 *
 * Kept apart from the physics so the dyno, the live engine, the drag strip and the tests
 * all build the same picture the same way.
 */

import { hardwareVeAt } from '../airflow.js';
import { AMBIENT_C, AMBIENT_K, KELVIN_OFFSET } from '../constants.js';
import { FUEL_CHOICES } from '../hardware.js';
import { DYNO_GEAR } from './calibration.js';
import { ECU_COEFF as E } from './ecuCoefficients.js';
import { baroAtAltitude } from './ecuHardware.js';
import { blendFuel } from './fuelBlend.js';
import { clamp } from '../math.js';
import { read2 } from './ecuTables.js';
import { VE_PHASE_SAMPLES, VVT_AUTHORITY, VVT_OPTS, veAtPhase } from './vvt.js';

/**
 * The ECU-side hardware a build starts with. Chosen so that no existing build is
 * short of anything: a pump with room for the biggest injectors the app offers, sensors
 * whose scaling the ECU already knows, an electronic wastegate that can hold any target.
 */
export const DEFAULT_ECU_HW = Object.freeze({
  fuelSystem: Object.freeze({ regulator: 'return', basePressureKpa: 300, pumpIdx: 0 }),
  sensorHw: Object.freeze({ map: '3bar', wideband: 'lambda-0.5-1.5', iat: 'bosch', ect: 'bosch', flex: false }),
  gate: Object.freeze({ type: 'electronic', springPsi: 7 }),
  coil: 'stock',
  plugGapMm: 1.0,
});

/** The dyno cell's air unless the player changes it: sea level, 25 °C. */
export const DEFAULT_ENV = Object.freeze({ ambientC: AMBIENT_C, altitudeM: 0 });

/**
 * @param {{ambientC?: number, altitudeM?: number}} [env]
 * @returns {{ambientK: number, baroKpa: number}}
 */
export function envFrom(env) {
  const c = env?.ambientC ?? AMBIENT_C;
  return {
    // Exactly the model's own ambient when unchanged, so a default day is bit-for-bit
    // the day the rest of the physics was fitted on.
    ambientK: c === AMBIENT_C ? AMBIENT_K : c + KELVIN_OFFSET,
    baroKpa: baroAtAltitude(env?.altitudeM ?? 0),
  };
}

/**
 * The fuel actually in the tank for a build: one of the pump fuels, or a flex tank's blend.
 * @param {{octaneIdx: number, ethanolPct?: number|null}} build
 */
export function tankFuel(build) {
  const opt = FUEL_CHOICES[build.octaneIdx] ?? FUEL_CHOICES[0];
  if (opt.flex) return blendFuel(build.ethanolPct ?? 0);
  return opt;
}

/**
 * The ECU-side hardware of a build, with defaults for anything an older state lacks.
 * @param {object} build
 * @returns {object}
 */
export function ecuHardwareOf(build) {
  const opt = FUEL_CHOICES[build.octaneIdx] ?? FUEL_CHOICES[0];
  return {
    fuel: tankFuel(build),
    /** A flex tank holds whatever blend the last fills left; only a sensor can tell. */
    flexTank: !!opt.flex,
    ethanolPct: opt.flex ? (build.ethanolPct ?? 0) : opt.stoich < 12 ? 85 : 0,
    fuelSystem: { ...DEFAULT_ECU_HW.fuelSystem, ...(build.fuelSystem ?? {}) },
    sensorHw: { ...DEFAULT_ECU_HW.sensorHw, ...(build.sensorHw ?? {}) },
    gate: { ...DEFAULT_ECU_HW.gate, ...(build.wastegate ?? {}) },
    vvt: build.engineConfig?.vvt ?? 'none',
    coil: build.coil ?? DEFAULT_ECU_HW.coil,
    plugGapMm: build.plugGapMm ?? DEFAULT_ECU_HW.plugGapMm,
    cfg: build.engineConfig,
  };
}

/**
 * A warm engine on the dyno.
 * @param {{ambientC?: number, altitudeM?: number}} [env]
 * @param {Record<string, string>} [faults]
 * @param {{armed?: boolean, heater?: boolean, bottleK?: number}|null} [nitrous] a nitrous
 *   kit's arming switch and bottle, when one is fitted
 * @returns {import('./strategy.js').EcuConditions}
 */
export function dynoConditions(env, faults = {}, nitrous = null) {
  const e = envFrom(env);
  return {
    env: e, ectC: 90, oilC: 100, volts: 13.5, gear: DYNO_GEAR,
    faults, pumpHealth: faults.pump === 'weak' ? E.WEAK_PUMP_HEALTH : 1, oilHealth: faults.oil === 'low' ? E.LOW_OIL_HEALTH : 1,
    // A nitrous kit's bottle at the start of the pull: at the heater's set point when one
    // is on, otherwise at the temperature of the day.
    ...(nitrous ? {
      nitrous: {
        armed: nitrous.armed !== false,
        setK: E.N2O_HEATER_SET_K,
        bottleK: nitrous.bottleK ?? (nitrous.heater ? E.N2O_HEATER_SET_K : e.ambientK),
      },
    } : {}),
  };
}

/**
 * The hardware breathing curve at each intake-cam phase the VVT model samples. A fixed-
 * cam engine needs only the parked one.
 *
 * @param {object} cfg engine config
 * @param {object} mods
 * @param {object} hwForVe the `computeHardwareVE` hardware argument
 * @returns {((rpm: number, kpa: number) => number)[]} the engine's breathing at each phase,
 *   at any speed and pressure
 */
export function veTruthByPhaseFor(cfg, mods, hwForVe) {
  const vvt = VVT_OPTS.find((o) => o.id === (cfg?.vvt ?? 'none')) ?? VVT_OPTS[0];
  if (!vvt.intake) return [hardwareVeAt(cfg, mods, hwForVe)];
  return VE_PHASE_SAMPLES.map((deg) => hardwareVeAt(cfg, mods, { ...hwForVe, intakeCamAdvanceDeg: deg }));
}

/**
 * The engine's TRUE breathing with its intake cam where the calibration puts it: the
 * phase-sampled curves (`veTruthByPhaseFor`) read at the intake-advance target for each
 * speed and pressure, exactly as the running ECU positions the phaser. A fixed-cam engine,
 * or no VVT calibration, is its parked curve. Everything that grades or generates tables
 * must use this, not the parked curve: the cylinder fills at the phase the cam is at.
 *
 * @param {object} cfg engine config
 * @param {object} mods
 * @param {object} hwForVe the `computeHardwareVE` hardware argument
 * @param {{intakeTarget: import('./ecuTables.js').Map2D}|null|undefined} vvtCal the ECU's VVT calibration
 * @returns {(rpm: number, kpa: number) => number} VE, percent
 */
export function scheduledVeAt(cfg, mods, hwForVe, vvtCal) {
  const phases = veTruthByPhaseFor(cfg, mods, hwForVe);
  const camAt = intakeCamAt(cfg, vvtCal);
  if (phases.length === 1 || !camAt) return phases[0];
  return (rpm, kpa) => veAtPhase(phases, rpm, kpa, camAt(rpm, kpa));
}

/**
 * Where the calibration puts the intake cam at a speed and pressure, crank degrees of
 * advance, as the ECU positions the phaser in steady state; null for an engine without an
 * intake phaser (whatever its VVT map says, nothing moves).
 *
 * @param {object} cfg engine config
 * @param {{intakeTarget: import('./ecuTables.js').Map2D}|null|undefined} vvtCal
 * @returns {((rpm: number, kpa: number) => number)|null}
 */
export function intakeCamAt(cfg, vvtCal) {
  const vvt = VVT_OPTS.find((o) => o.id === (cfg?.vvt ?? 'none')) ?? VVT_OPTS[0];
  if (!vvt.intake || !vvtCal?.intakeTarget) return null;
  return (rpm, kpa) => clamp(read2(vvtCal.intakeTarget, rpm, kpa), 0, VVT_AUTHORITY.intake);
}

/** Steps a factory phaser schedule is searched in, crank degrees. */
const FACTORY_PHASE_STEP_DEG = 2.5;

/**
 * A factory intake-cam schedule: at every breakpoint, the advance that fills the cylinder
 * best. That is what a production calibration does at full load (best torque); at part load
 * real calibrations also trade some filling for internal EGR and economy, which this model
 * does not reward, so it schedules for filling there too. Null for a fixed-cam engine.
 *
 * @param {object} cfg engine config
 * @param {object} mods
 * @param {object} hwForVe the `computeHardwareVE` hardware argument
 * @param {number[]} rpmAx ascending rpm breakpoints of the ECU's VVT map
 * @param {number[]} mapAx ascending kPa breakpoints of the ECU's VVT map
 * @returns {number[][]|null} advance, crank degrees, indexed [map][rpm]
 */
export function factoryIntakeSchedule(cfg, mods, hwForVe, rpmAx, mapAx) {
  const phases = veTruthByPhaseFor(cfg, mods, hwForVe);
  if (phases.length === 1) return null;
  const steps = [];
  for (let d = 0; d <= VVT_AUTHORITY.intake + 1e-9; d += FACTORY_PHASE_STEP_DEG) steps.push(d);
  return mapAx.map((kpa) => rpmAx.map((rpm) => {
    let best = 0; let bestVe = -Infinity;
    for (const d of steps) {
      const v = veAtPhase(phases, rpm, kpa, d);
      // Ties go to the least advance: the parked cam is the failsafe position.
      if (v > bestVe + 1e-9) { bestVe = v; best = d; }
    }
    return best;
  }));
}
