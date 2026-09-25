/**
 * Sensors as an ECU sees them: a physical quantity turned into a voltage by the part that
 * is fitted, and turned back into a number by the scaling the ECU was told that part has.
 *
 * The two conversions are independent, which is the point. A 3-bar MAP sensor read with
 * 1-bar scaling reports a third of the pressure; a 1-bar sensor on a turbo engine
 * saturates at atmospheric and the ECU never sees boost at all. A wideband read with the
 * wrong transfer function drives closed loop to the wrong mixture while every gauge says
 * it is on target. None of that needs a special case here — it falls out of the
 * voltage in the middle.
 *
 * Plausibility: a signal outside the band a working sensor can produce means a broken
 * wire or a dead sensor, and the ECU substitutes a default and flags a fault.
 */

import { KELVIN_OFFSET } from '../constants.js';
import { clamp } from '../math.js';

/** Supply rail the sensors run from, volts. */
const VREF = 5;
/** Where a linear sensor's output starts and ends inside the 0-5 V window. */
const V_LO = 0.4;
const V_HI = 4.65;

/**
 * Linear transfer functions, physical range mapped onto V_LO..V_HI.
 * `short` is the name a picker shows where space is tight; `label` is the full one.
 * @type {Record<string, Record<string, {label: string, short?: string, min: number, max: number}>>}
 */
export const LINEAR_SCALES = {
  map: {
    '1bar': { label: '1 bar (10–105 kPa)', min: 10, max: 105 },
    '2.5bar': { label: '2.5 bar (10–250 kPa)', min: 10, max: 250 },
    '3bar': { label: '3 bar (10–315 kPa)', min: 10, max: 315 },
    '4bar': { label: '4 bar (20–400 kPa)', min: 20, max: 400 },
  },
  // Wideband controllers' analogue outputs. Each maker picks its own line, and the ECU
  // has to be told which. The last two are real published lines: Innovate's LC-2
  // (AFR = 7.35 + 3.008·V over 0–5 V) and AEM's X-series (AFR = 7.3125 + 2.375·V,
  // used over 0.5–4.5 V).
  wideband: {
    'lambda-0.5-1.5': { label: 'λ 0.50–1.50 (0–5 V)', short: 'λ 0.5–1.5', min: 0.5, max: 1.5 },
    'afr-10-20': { label: 'AFR 10–20 gasoline (0–5 V)', short: 'AFR 10–20', min: 10 / 14.7, max: 20 / 14.7 },
    'afr-7.3-22.4': { label: 'AFR 7.35–22.39 gasoline (0–5 V)', short: 'AFR 7.35–22.4', min: 7.35 / 14.7, max: 22.39 / 14.7 },
    'afr-8.5-18': { label: 'AFR 8.5–18.0 gasoline (0.5–4.5 V)', short: 'AFR 8.5–18', min: 8.5 / 14.7, max: 18.0 / 14.7 },
  },
  fuelPressure: {
    '100psi': { label: '0–100 psi', min: 0, max: 689 },
    '150psi': { label: '0–150 psi', min: 0, max: 1034 },
  },
  oilPressure: {
    '100psi': { label: '0–100 psi', min: 0, max: 689 },
    '150psi': { label: '0–150 psi', min: 0, max: 1034 },
  },
  egt: {
    'k-1250': { label: 'K-type amp 0–1250 °C', min: 0, max: 1250 },
    'k-1000': { label: 'K-type amp 0–1000 °C', min: 0, max: 1000 },
  },
  ethanol: {
    'std': { label: 'Continental 50–150 Hz', min: 0, max: 100 },
  },
};

/**
 * Wideband outputs whose voltage window is not the generic V_LO..V_HI: the three
 * controllers' published lines, 0-5 V or 0.5-4.5 V.
 */
const WIDEBAND_WINDOW = {
  'lambda-0.5-1.5': [0, 5],
  'afr-10-20': [0, 5],
  'afr-7.3-22.4': [0, 5],
  'afr-8.5-18': [0.5, 4.5],
};

/**
 * NTC thermistors, beta model: R(T) = R25 · exp(B · (1/T − 1/298.15)), read through a
 * 2.49 kΩ pull-up. Two common curves with genuinely different resistance at the same
 * temperature, so using one's table for the other reads tens of degrees off.
 */
export const THERMISTORS = {
  bosch: { label: 'Bosch NTC (2.5 kΩ @ 20 °C)', r25: 2057, beta: 3500 },
  gm: { label: 'GM open-element (3.5 kΩ @ 20 °C)', r25: 2796, beta: 3950 },
};
const PULLUP_OHM = 2490;

/**
 * @typedef {'ok'|'open'|'short'|'stuck'|'bias'} SensorFault
 */

/**
 * Voltage a linear sensor produces for a physical value.
 * @param {{min: number, max: number}} scale
 * @param {number} value
 * @param {[number, number]} [win]
 * @returns {number}
 */
function linearVolts(scale, value, win = [V_LO, V_HI]) {
  const f = (value - scale.min) / (scale.max - scale.min);
  // A real sensor saturates at the ends of its range, inside the band a healthy one can
  // produce — a reading at full scale is a saturated sensor, not a broken one.
  return clamp(win[0] + f * (win[1] - win[0]), Math.max(0.1, win[0]), Math.min(4.9, win[1]));
}

/**
 * @param {{min: number, max: number}} scale
 * @param {number} volts
 * @param {[number, number]} [win]
 * @returns {number}
 */
function linearValue(scale, volts, win = [V_LO, V_HI]) {
  return scale.min + ((volts - win[0]) / (win[1] - win[0])) * (scale.max - scale.min);
}

/**
 * @param {keyof typeof THERMISTORS} id
 * @param {number} tempC
 * @returns {number}
 */
function thermistorVolts(id, tempC) {
  const t = THERMISTORS[id] ?? THERMISTORS.bosch;
  const r = t.r25 * Math.exp(t.beta * (1 / (tempC + KELVIN_OFFSET) - 1 / 298.15));
  return (VREF * r) / (r + PULLUP_OHM);
}

/**
 * @param {keyof typeof THERMISTORS} id
 * @param {number} volts
 * @returns {number}
 */
function thermistorValue(id, volts) {
  const t = THERMISTORS[id] ?? THERMISTORS.bosch;
  const v = clamp(volts, 0.02, VREF - 0.02);
  const r = (PULLUP_OHM * v) / (VREF - v);
  return 1 / (1 / 298.15 + Math.log(r / t.r25) / t.beta) - KELVIN_OFFSET;
}

/** Signal band a healthy sensor stays inside, volts. Outside it the ECU calls a fault. */
export const PLAUSIBLE_V = [0.08, 4.92];

/**
 * One sensor channel end to end: physical value → fitted part → wire → ECU scaling.
 *
 * @param {object} input
 * @param {'map'|'wideband'|'fuelPressure'|'oilPressure'|'egt'|'ethanol'|'iat'|'ect'} input.kind
 * @param {number} input.value the true physical value
 * @param {string} input.part the part fitted (scale or thermistor id)
 * @param {string} input.scale the scaling the ECU is configured with
 * @param {SensorFault} [input.fault]
 * @param {number} [input.fallback] what the ECU substitutes when it detects a fault
 * @returns {{volts: number, value: number, fault: boolean}}
 */
export function readSensor({ kind, value, part, scale, fault = 'ok', fallback }) {
  const thermal = kind === 'iat' || kind === 'ect';
  const table = LINEAR_SCALES[kind];
  const win = kind === 'wideband' ? WIDEBAND_WINDOW[part] : undefined;
  const ecuWin = kind === 'wideband' ? WIDEBAND_WINDOW[scale] : undefined;
  let volts = thermal
    ? thermistorVolts(/** @type {any} */ (part), value)
    : linearVolts(table[part] ?? Object.values(table)[0], value, win);
  if (fault === 'open') volts = VREF;
  else if (fault === 'short') volts = 0;
  else if (fault === 'bias') volts = clamp(volts + 0.35, 0, VREF);
  const faulted = volts < PLAUSIBLE_V[0] || volts > PLAUSIBLE_V[1];
  if (faulted && fallback != null) return { volts, value: fallback, fault: true };
  const read = thermal
    ? thermistorValue(/** @type {any} */ (scale), volts)
    : linearValue(table[scale] ?? Object.values(table)[0], volts, ecuWin);
  return { volts, value: read, fault: faulted };
}

/**
 * Throttle position as the ECU reads it: the pot's voltage at closed and wide open, as
 * installed, against the voltages the ECU was taught. A TPS that was never re-zeroed
 * after the throttle stop was touched reads a few percent open at idle — and an ECU that
 * does not believe the throttle is closed never enters idle control or overrun fuel cut.
 *
 * @param {number} throttlePct true throttle opening
 * @param {{closedV: number, openV: number}} ecuCal what the ECU was taught
 * @param {SensorFault} [fault]
 * @returns {{volts: number, value: number, fault: boolean}}
 */
export function readTps(throttlePct, ecuCal, fault = 'ok') {
  let volts = TPS_HW.closedV + (TPS_HW.openV - TPS_HW.closedV) * clamp(throttlePct, 0, 100) / 100;
  if (fault === 'open') volts = VREF;
  else if (fault === 'short') volts = 0;
  else if (fault === 'bias') volts += 0.35;
  const faulted = volts < PLAUSIBLE_V[0] || volts > PLAUSIBLE_V[1];
  const pct = ((volts - ecuCal.closedV) / Math.max(0.1, ecuCal.openV - ecuCal.closedV)) * 100;
  return { volts, value: faulted ? 0 : clamp(pct, 0, 100), fault: faulted };
}

/** The throttle pot as installed on the engine: volts at the stop and wide open. */
export const TPS_HW = { closedV: 0.62, openV: 4.38 };

/**
 * Every sensor fault the LIVE engine can inject, for the fault panel.
 */
export const FAULTABLE_SENSORS = [
  { id: 'map', label: 'MAP' },
  { id: 'iat', label: 'IAT' },
  { id: 'ect', label: 'Coolant' },
  { id: 'tps', label: 'TPS' },
  { id: 'wideband', label: 'Wideband' },
  { id: 'fuelPressure', label: 'Fuel pressure' },
  { id: 'oilPressure', label: 'Oil pressure' },
];

/**
 * The true lambda at which a wideband, read through the ECU's scaling, reports a given
 * value. Closed loop trims until the READING is on target, so this is where the mixture
 * actually settles.
 *
 * @param {number} readLambda what closed loop is aiming the reading at
 * @param {string} part the controller fitted
 * @param {string} scale the scaling the ECU applies
 * @returns {number} true lambda
 */
export function widebandTrueFor(readLambda, part, scale) {
  if (part === scale) return readLambda;
  const t = LINEAR_SCALES.wideband;
  const ecu = t[scale] ?? t['lambda-0.5-1.5'];
  const hw = t[part] ?? t['lambda-0.5-1.5'];
  const [e0, e1] = WIDEBAND_WINDOW[scale] ?? [0, 5];
  const [h0, h1] = WIDEBAND_WINDOW[part] ?? [0, 5];
  const volts = e0 + ((readLambda - ecu.min) / (ecu.max - ecu.min)) * (e1 - e0);
  return hw.min + ((volts - h0) / (h1 - h0)) * (hw.max - hw.min);
}

/**
 * Every place the ECU's sensor settings disagree with the parts fitted on BUILD — the
 * silent mistake behind most of what the sensor lesson teaches, listed so the player
 * can see it and fix it in one move instead of discovering it on the dyno.
 *
 * @param {{map?: string, wideband?: string, iat?: string, ect?: string}} fitted the
 *   sensors on BUILD
 * @param {{sensors: Record<string, any>}} cal
 * @returns {{path: string, what: string, fitted: string, told: string, value: any}[]}
 *   one entry per mismatch; `value` is the setting that matches the part
 */
export function sensorMismatches(fitted, cal) {
  const out = [];
  const sc = cal.sensors;
  const name = (table, id) => table[id]?.label ?? id;
  const mapPart = fitted.map ?? '3bar';
  if (sc.map !== 'auto' && sc.map !== mapPart) {
    out.push({ path: 'sensors.map', what: 'MAP sensor', fitted: name(LINEAR_SCALES.map, mapPart), told: name(LINEAR_SCALES.map, sc.map), value: mapPart });
  }
  const wb = fitted.wideband ?? 'lambda-0.5-1.5';
  if (sc.wideband !== wb) {
    out.push({ path: 'sensors.wideband', what: 'Wideband', fitted: name(LINEAR_SCALES.wideband, wb), told: name(LINEAR_SCALES.wideband, sc.wideband), value: wb });
  }
  for (const [key, what] of [['iat', 'Intake air temperature sensor'], ['ect', 'Coolant temperature sensor']]) {
    const part = fitted[key] ?? 'bosch';
    if (sc[key] !== part) out.push({ path: `sensors.${key}`, what, fitted: name(THERMISTORS, part), told: name(THERMISTORS, sc[key]), value: part });
  }
  if (Math.abs(sc.tpsClosedV - TPS_HW.closedV) > 0.02) {
    out.push({ path: 'sensors.tpsClosedV', what: 'Throttle closed voltage', fitted: `${TPS_HW.closedV.toFixed(2)} V`, told: `${Number(sc.tpsClosedV).toFixed(2)} V`, value: TPS_HW.closedV });
  }
  if (Math.abs(sc.tpsOpenV - TPS_HW.openV) > 0.02) {
    out.push({ path: 'sensors.tpsOpenV', what: 'Throttle open voltage', fitted: `${TPS_HW.openV.toFixed(2)} V`, told: `${Number(sc.tpsOpenV).toFixed(2)} V`, value: TPS_HW.openV });
  }
  return out;
}
