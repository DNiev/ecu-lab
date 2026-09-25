/**
 * The knock sensor: an accelerometer bolted to the block, which hears detonation AND
 * everything else the engine does mechanically.
 *
 * Detonation rings the cylinder at its acoustic resonance, and the ring's amplitude
 * grows with how hard the end gas went off — here, with how far past the knock limit the
 * spark is, scaled by cylinder pressure. The valvetrain makes noise in the same band,
 * growing with the square of engine speed and with how hard the valves are slammed
 * shut: stiffer springs and bigger cams are louder.
 *
 * The ECU compares the band-passed signal against a threshold per RPM. Set it too low
 * and valve noise at high RPM is "knock" — the ECU retards for nothing and the engine
 * goes flat at the top end. Set it too high and real knock runs unheard. The factory sets
 * it just above the noise of the engine as built, which is why changing the cam or the
 * springs without re-learning the threshold produces false knock.
 */

import { clamp } from '../math.js';
import { ECU_COEFF as E } from './ecuCoefficients.js';
import { read1 } from './ecuTables.js';

/**
 * Background mechanical noise in the knock band, volts.
 * @param {number} rpm
 * @param {{springRate?: number, camDuration?: number}} derived
 * @returns {number}
 */
export function knockNoiseV(rpm, derived) {
  const valvetrain = Math.sqrt((derived.springRate ?? E.KNOCK_NOISE_REF_SPRING) / E.KNOCK_NOISE_REF_SPRING)
    * (1 + Math.max(0, (derived.camDuration ?? E.KNOCK_NOISE_REF_CAM_DEG) - E.KNOCK_NOISE_REF_CAM_DEG) / E.KNOCK_NOISE_CAM_SPAN_DEG);
  return E.KNOCK_NOISE_FLOOR_V + E.KNOCK_NOISE_V * Math.pow(Math.max(0, rpm) / E.KNOCK_NOISE_REF_RPM, 2) * valvetrain;
}

/**
 * Knock signal per degree past the knock limit, volts. Pressure scales the ring.
 * @param {number} peakBar cylinder pressure the knock happens at
 * @returns {number}
 */
export function knockSignalPerDegV(peakBar) {
  return E.KNOCK_SIGNAL_V_PER_BAR * Math.max(E.KNOCK_SIGNAL_MIN_BAR, peakBar);
}

/**
 * The factory threshold: just above the peaks of this engine's own noise.
 * @param {number} rpm
 * @param {{springRate?: number, camDuration?: number}} derived
 * @returns {number} volts
 */
export function factoryKnockThresholdV(rpm, derived) {
  return E.KNOCK_FACTORY_MARGIN * knockNoiseV(rpm, derived) + E.KNOCK_FACTORY_OFFSET_V;
}

/**
 * What a steady knock controller can and cannot do at one point.
 *
 * @param {object} input
 * @param {number} input.rpm
 * @param {number} input.peakBar estimated peak cylinder pressure
 * @param {number} input.thresholdV the ECU's threshold here
 * @param {{springRate?: number, camDuration?: number}} input.derived
 * @param {number} input.maxRetardDeg
 * @returns {{deadbandDeg: number, falseRetardDeg: number, noiseV: number}}
 *   `deadbandDeg`: how far past the limit knock can go before it is heard.
 *   `falseRetardDeg`: retard the controller settles at from noise alone.
 */
export function knockDetection({ rpm, peakBar, thresholdV, derived, maxRetardDeg }) {
  const noise = knockNoiseV(rpm, derived);
  const perDeg = knockSignalPerDegV(peakBar);
  const deadbandDeg = Math.max(0, thresholdV - noise) / perDeg;
  // Fraction of the time noise peaks cross the threshold. Each crossing is a retard step
  // and recovery is slow, so even a modest crossing rate pins the retard near its limit.
  const cross = clamp((E.KNOCK_NOISE_PEAK * noise - thresholdV) / (E.KNOCK_NOISE_SPREAD * noise), 0, 1);
  return { deadbandDeg, falseRetardDeg: maxRetardDeg * Math.sqrt(cross), noiseV: noise };
}

/**
 * The knock threshold the ECU applies at an engine speed.
 *
 * Inside the table's RPM range it is the table. Past its last breakpoint a real ECU
 * holds the last value — but the valvetrain keeps getting louder with speed, so a flat
 * threshold there calls the engine's own noise knock and pulls timing from an engine
 * that is not knocking. That is an artefact of where the axis happens to stop, not a
 * calibration decision, so past the end the table's margin over the noise is carried on
 * along this engine's own noise curve.
 *
 * @param {{x: number[], z: number[]}} table the calibrated threshold by RPM
 * @param {number} rpm
 * @param {{springRate?: number, camDuration?: number}} derived
 * @returns {number} volts
 */
export function knockThresholdAt(table, rpm, derived) {
  const last = table.x[table.x.length - 1];
  const v = read1(table, rpm);
  if (rpm <= last) return v;
  return v * (knockNoiseV(rpm, derived) / knockNoiseV(last, derived));
}
