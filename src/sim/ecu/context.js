/**
 * Assembling the ECU's world from the app's state: which parts are fitted, what the day
 * is like, what condition the engine is in.
 *
 * Kept apart from the physics so the dyno, the live engine, the drag strip and the tests
 * all build the same picture the same way.
 */

import { computeHardwareVE } from '../airflow.js';
import { AMBIENT_C, AMBIENT_K, KELVIN_OFFSET } from '../constants.js';
import { FUEL_CHOICES } from '../hardware.js';
import { DYNO_GEAR } from './calibration.js';
import { ECU_COEFF as E } from './ecuCoefficients.js';
import { baroAtAltitude } from './ecuHardware.js';
import { blendFuel } from './fuelBlend.js';
import { VE_PHASE_SAMPLES, VVT_OPTS } from './vvt.js';

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
 * @returns {import('./strategy.js').EcuConditions}
 */
export function dynoConditions(env, faults = {}) {
  return {
    env: envFrom(env), ectC: 90, oilC: 100, volts: 13.5, gear: DYNO_GEAR,
    faults, pumpHealth: faults.pump === 'weak' ? E.WEAK_PUMP_HEALTH : 1, oilHealth: faults.oil === 'low' ? E.LOW_OIL_HEALTH : 1,
  };
}

/**
 * The hardware breathing curve at each intake-cam phase the VVT model samples. A fixed-
 * cam engine needs only the parked one.
 *
 * @param {object} cfg engine config
 * @param {object} mods
 * @param {object} hwForVe the `computeHardwareVE` hardware argument
 * @returns {number[][][]}
 */
export function veTruthByPhaseFor(cfg, mods, hwForVe) {
  const vvt = VVT_OPTS.find((o) => o.id === (cfg?.vvt ?? 'none')) ?? VVT_OPTS[0];
  if (!vvt.intake) return [computeHardwareVE(cfg, mods, hwForVe)];
  return VE_PHASE_SAMPLES.map((deg) => computeHardwareVE(cfg, mods, { ...hwForVe, intakeCamAdvanceDeg: deg }));
}
