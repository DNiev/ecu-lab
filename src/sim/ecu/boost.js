/**
 * Boost control: the ECU decides what boost it wants, and commands the wastegate
 * actuator to get it. The turbo then makes whatever the physics allows under that
 * ceiling (`solveInduction`).
 *
 * The ECU never sets boost directly — nothing can. It sets a DUTY on a solenoid (or a
 * position on an electronic actuator), the actuator holds the gate shut up to some
 * pressure, and above that pressure the gate opens and bleeds exhaust past the turbine.
 * Everything a tuner calibrates here is on the ECU side of that chain: the target, the
 * open-loop duty that should roughly hold it, and the closed-loop correction that trims
 * the rest.
 */

import { clamp } from '../math.js';
import { ELECTRONIC_GATE_AUTHORITY_PSI, SOLENOID_GAIN } from './ecuHardware.js';
import { read1, read2 } from './ecuTables.js';

/**
 * Boost the gate holds shut up to, at a given solenoid duty / actuator command.
 *
 * Pneumatic: the spring alone opens the gate at its rated pressure; the solenoid bleeds
 * the actuator signal so the gate needs more boost to open. It can raise that pressure,
 * never lower it below the spring — which is why a big spring means you cannot run low
 * boost, whatever the ECU asks for.
 *
 * @param {{type: string, springPsi: number}} gate
 * @param {number} dutyPct 0..100
 * @returns {number} psi
 */
export function gateHoldPsi(gate, dutyPct) {
  const d = clamp(dutyPct, 0, 100) / 100;
  if ((gate?.type ?? 'electronic') === 'pneumatic') return gate.springPsi * (1 + SOLENOID_GAIN * d);
  return ELECTRONIC_GATE_AUTHORITY_PSI * d;
}

/**
 * Duty that makes the gate hold a given boost, and whether that is reachable at all.
 * @param {{type: string, springPsi: number}} gate
 * @param {number} psi
 * @returns {{duty: number, reachable: boolean}}
 */
export function dutyForHold(gate, psi) {
  if ((gate?.type ?? 'electronic') === 'pneumatic') {
    const d = (psi / Math.max(0.1, gate.springPsi) - 1) / SOLENOID_GAIN * 100;
    return { duty: clamp(d, 0, 100), reachable: d >= -0.01 && d <= 100.01 };
  }
  const d = (psi / ELECTRONIC_GATE_AUTHORITY_PSI) * 100;
  return { duty: clamp(d, 0, 100), reachable: d <= 100.01 };
}

/**
 * What boost the ECU is asking for, and why — the correction stack.
 *
 * @param {object} input
 * @param {object} input.cal the calibration's `boost` section
 * @param {number[]} input.baseCurve the BUILD tab's boost target curve
 * @param {number[]} input.rpmAxis
 * @param {number} input.rpm
 * @param {number} input.throttlePct throttle opening as the ECU reads it
 * @param {number} input.gear 1-based gear
 * @param {number} input.iatC intake temperature as the ECU reads it
 * @returns {{target: number, steps: {label: string, value: number}[]}}
 */
export function boostTarget({ cal, baseCurve, rpmAxis, rpm, throttlePct, gear, iatC }) {
  const base = interpCurve(rpmAxis, baseCurve, rpm);
  const steps = [{ label: 'Base target (BUILD curve)', value: base }];
  const scale = read1(cal.throttleScale, throttlePct) / 100;
  let target = base * scale;
  steps.push({ label: `Throttle request (${Math.round(scale * 100)}%)`, value: target });
  const gearCap = read1(cal.gearLimit, gear);
  if (target > gearCap) {
    target = gearCap;
    steps.push({ label: `Gear ${gear} limit`, value: target });
  }
  const iatAdj = read1(cal.iatComp, iatC);
  if (iatAdj) {
    target = Math.max(0, target + iatAdj);
    steps.push({ label: 'Intake temperature compensation', value: target });
  }
  return { target, steps };
}

/**
 * The gate's ceiling at a settled operating point.
 *
 * Closed loop, the controller has had all the time it needs, so it has found the duty
 * that holds the target — unless the actuator cannot: a pneumatic gate cannot hold less
 * than its spring (scaled by the throttle, which closes off the flow before the gate
 * ever sees it), and nothing holds more than full duty does. Open loop, the gate holds
 * whatever the base duty table's number holds, right or wrong.
 *
 * @param {object} input
 * @param {object} input.cal
 * @param {{type: string, springPsi: number}} input.gate
 * @param {number} input.rpm
 * @param {number} input.target
 * @param {number} input.throttleFrac 0..1
 * @returns {{ceiling: number, duty: number, dutyBase: number, limited: 'spring'|'duty'|null}}
 */
export function steadyGate({ cal, gate, rpm, target, throttleFrac }) {
  const dutyBase = clamp(read2(cal.baseDuty, rpm, target), 0, 100);
  const maxDuty = cal.maxDuty ?? 95;
  const tf2 = throttleFrac * throttleFrac;
  if (cal.mode === 'open') {
    const hold = gateHoldPsi(gate, dutyBase);
    return { ceiling: hold * (gate?.type === 'pneumatic' ? tf2 : 1), duty: dutyBase, dutyBase, limited: null };
  }
  const floor = (gate?.type ?? 'electronic') === 'pneumatic' ? gate.springPsi * tf2 : 0;
  const top = gateHoldPsi(gate, maxDuty);
  const ceiling = clamp(target, floor, top);
  const limited = target < floor - 0.05 ? 'spring' : target > top + 0.05 ? 'duty' : null;
  return { ceiling, duty: dutyForHold(gate, Math.max(ceiling, 0)).duty, dutyBase, limited };
}

/**
 * @param {number[]} axis
 * @param {number[]} vals
 * @param {number} x
 * @returns {number}
 */
function interpCurve(axis, vals, x) {
  return read1({ x: axis, z: vals }, x);
}
