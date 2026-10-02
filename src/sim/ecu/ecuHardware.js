/**
 * The hardware the engine management talks to: fuel pump and regulator, injectors'
 * electrical behaviour, ignition coils, wastegate actuator, sensors, oil pump.
 *
 * Physical parts, not calibration. The calibration in `calibration.js` is what the ECU
 * BELIEVES about these; this file is what they actually do. Every lesson the ECU layer
 * teaches is a gap between the two.
 */

import { BARO_KPA } from '../constants.js';
import { clamp } from '../math.js';
import { ECU_COEFF as E } from './ecuCoefficients.js';

/** Pressure an injector's flow rating is stated at, kPa across the injector (3 bar). */
export const INJECTOR_RATED_DP_KPA = 300;

/**
 * Fuel pumps, rated flow at 3 bar and 13.5 V, litres per hour.
 *
 * A pump is a positive-displacement machine behind a motor: flow falls as the pressure it
 * works against rises, and with the voltage that spins it.
 */
export const PUMP_OPTS = [
  { id: 'stock', label: 'Stock in-tank (190 L/h)', lph: 190 },
  { id: '255', label: '255 L/h high-flow', lph: 255 },
  { id: '340', label: '340 L/h', lph: 340 },
  { id: '450', label: '450 L/h', lph: 450 },
  { id: 'dual', label: 'Twin 255 L/h', lph: 510 },
];

/**
 * Fuel pressure regulation.
 *
 * `return`: a manifold-referenced regulator on a return line holds rail pressure a fixed
 * amount ABOVE MANIFOLD pressure, so the pressure across the injector never changes and
 * its flow rating holds at every load. `returnless`: the rail is held at a fixed pressure
 * above ATMOSPHERE, so the pressure across the injector rises in vacuum and falls under
 * boost — at 20 psi of boost a 43 psi rail has only 23 psi left to push fuel through.
 */
export const REGULATOR_OPTS = [
  { id: 'return', label: 'Return, manifold-referenced' },
  { id: 'returnless', label: 'Returnless, fixed rail' },
];

/** Wastegate actuators. */
export const WASTEGATE_OPTS = [
  { id: 'electronic', label: 'Electronic actuator' },
  { id: 'pneumatic', label: 'Pneumatic, spring + boost solenoid' },
];

/** Most boost an electronic actuator can hold with the gate fully shut, psi. */
export const ELECTRONIC_GATE_AUTHORITY_PSI = 32;

/**
 * How much a boost-control solenoid can raise a pneumatic gate's opening pressure: at
 * 100% duty it bleeds the actuator so hard the gate holds this multiple of its spring
 * pressure on top of the spring itself.
 */
export const SOLENOID_GAIN = 1.6;

/**
 * Ignition coils. `kvMax` is the secondary voltage the coil can reach with a full charge;
 * `mjFull` the stored energy that takes; `resistanceOhm`/`inductanceMh` set how fast the
 * primary current, and therefore the stored energy, builds during dwell.
 */
export const COIL_OPTS = [
  { id: 'stock', label: 'Stock coil-on-plug', kvMax: 40, mjFull: 70, resistanceOhm: 0.55, inductanceMh: 3.2, currentLimitA: 8 },
  { id: 'high', label: 'High-output coil', kvMax: 48, mjFull: 105, resistanceOhm: 0.45, inductanceMh: 3.8, currentLimitA: 10 },
];

/**
 * Injector dead time — the delay between the driver switching on and fuel actually
 * flowing, while the coil's current builds enough force to lift the needle against the
 * fuel pressure behind it. Lower voltage builds current slower; more pressure takes more
 * force. At 13.5 V and rated pressure it is exactly the 1.0 ms the rest of the model has
 * always used.
 *
 * @param {number} volts battery voltage at the injector
 * @param {number} [dpKpa] pressure across the injector
 * @returns {number} dead time, ms
 */
export function injectorDeadTimeMs(volts, dpKpa = INJECTOR_RATED_DP_KPA) {
  const v = Math.max(E.INJECTOR_MIN_V, volts);
  return Math.pow(13.5 / v, E.DEADTIME_VOLT_EXP) * (1 + E.DEADTIME_PER_KPA * (dpKpa - INJECTOR_RATED_DP_KPA));
}

/**
 * Flow of an injector relative to its rating: an orifice passes flow as the square root
 * of the pressure across it.
 * @param {number} dpKpa
 * @returns {number}
 */
export function injectorFlowScale(dpKpa) {
  return Math.sqrt(Math.max(0, dpKpa) / INJECTOR_RATED_DP_KPA);
}

/**
 * The fuel rail at one operating point: what the pump can supply, what the regulator
 * holds, and what that leaves across the injectors.
 *
 * @param {object} input
 * @param {{regulator: string, basePressureKpa: number, pumpIdx: number}} input.fuelSystem
 * @param {number} input.mapKpa true manifold pressure
 * @param {number} [input.baroKpa]
 * @param {number} input.demandLph fuel the injectors are asking for at this pulse width,
 *   litres per hour, at nominal pressure
 * @param {number} [input.volts] pump supply voltage
 * @param {number} [input.pumpHealth] 1 is a healthy pump; a fault injection lowers it
 * @returns {{railGaugeKpa: number, deltaKpa: number, flowScale: number, pumpLph: number,
 *   starved: boolean}}
 */
export function fuelRail({ fuelSystem, mapKpa, baroKpa = BARO_KPA, demandLph, volts = 13.5, pumpHealth = 1 }) {
  const pump = PUMP_OPTS[fuelSystem?.pumpIdx ?? 0] ?? PUMP_OPTS[0];
  const base = fuelSystem?.basePressureKpa ?? INJECTOR_RATED_DP_KPA;
  const returnStyle = (fuelSystem?.regulator ?? 'return') === 'return';
  // Regulated pressure: gauge rail pressure above atmosphere.
  const railGauge = returnStyle ? base + (mapKpa - baroKpa) : base;
  // Pump capacity falls with the pressure it is working against and with voltage.
  const pumpLph = pump.lph
    * clamp(1 - (railGauge - INJECTOR_RATED_DP_KPA) / E.PUMP_PRESSURE_SPAN_KPA, E.PUMP_FLOW_MIN, E.PUMP_FLOW_MAX)
    * clamp(volts / 13.5, E.PUMP_VOLT_MIN, E.PUMP_VOLT_MAX) * pumpHealth;
  let deltaKpa = railGauge + baroKpa - mapKpa;
  let flowScale = injectorFlowScale(deltaKpa);
  // More demand than the pump can meet: the rail sags until the injectors' flow at the
  // pressure that is left matches what the pump delivers.
  const demandAtDelta = demandLph * flowScale;
  const starved = demandAtDelta > pumpLph;
  if (starved) {
    flowScale *= pumpLph / Math.max(1e-6, demandAtDelta);
    deltaKpa = INJECTOR_RATED_DP_KPA * flowScale * flowScale;
  }
  return { railGaugeKpa: deltaKpa + mapKpa - baroKpa, deltaKpa, flowScale, pumpLph, starved };
}

/**
 * Secondary voltage a coil can deliver after a given dwell at a given supply voltage.
 *
 * Primary current rises as I = (V/R)(1 − e^(−t·R/L)), up to the driver's current limit,
 * and the coil stores ½·L·I². The voltage it can reach scales with the square root of
 * the energy stored.
 *
 * @param {number} dwellMs
 * @param {number} volts
 * @param {typeof COIL_OPTS[number]} [coil]
 * @returns {{kv: number, mj: number, ampsPeak: number}}
 */
export function coilOutput(dwellMs, volts, coil = COIL_OPTS[0]) {
  const L = coil.inductanceMh / 1000;
  const R = coil.resistanceOhm + E.COIL_HARNESS_OHM;
  const iSteady = Math.max(0, volts) / R;
  const i = Math.min(coil.currentLimitA, iSteady * (1 - Math.exp(-(dwellMs / 1000) * R / L)));
  const mj = 0.5 * L * i * i * 1000;
  return { kv: coil.kvMax * Math.sqrt(clamp(mj / coil.mjFull, 0, E.COIL_OVERCHARGE_MAX)), mj, ampsPeak: i };
}

/**
 * Oil pressure. A gear pump's output is proportional to speed until the relief valve
 * opens; the pressure that flow produces rises with the oil's viscosity, which falls
 * steeply as it warms. Cold oil reads high, hot idle reads low — that low number is what
 * an oil-pressure protection has to be calibrated around.
 *
 * @param {number} rpm
 * @param {number} oilC
 * @param {number} [pumpHealth] 1 healthy; a worn pump or low level lowers it
 * @returns {number} kPa gauge
 */
export function oilPressureKpa(rpm, oilC, pumpHealth = 1) {
  if (rpm < 50) return 0;
  const viscosity = clamp(Math.exp(-(oilC - E.OIL_VISCOSITY_REF_C) / E.OIL_VISCOSITY_SPAN_C), E.OIL_VISCOSITY_MIN, E.OIL_VISCOSITY_MAX);
  return Math.min(E.OIL_RELIEF_KPA, (rpm / 1000) * E.OIL_KPA_PER_KRPM * Math.pow(viscosity, E.OIL_VISCOSITY_EXP) * pumpHealth + E.OIL_BASE_KPA);
}

/**
 * Barometric pressure at an altitude, standard atmosphere.
 * @param {number} altitudeM
 * @returns {number} kPa
 */
export function baroAtAltitude(altitudeM) {
  if (!altitudeM) return BARO_KPA;
  return BARO_KPA * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
}
