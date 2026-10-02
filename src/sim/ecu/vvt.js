/**
 * Variable valve timing: cam phasers, and what moving a camshaft does.
 *
 * A phaser rotates the camshaft relative to the crank, so every event on that cam moves
 * together by the same angle. Advancing the INTAKE cam closes the intake valve earlier —
 * better trapping at low speed, where the charge has no momentum to keep filling after
 * BDC, and worse at high speed, where it does — and opens it earlier, into the exhaust
 * stroke, which adds overlap. Retarding the EXHAUST cam holds the exhaust valve open
 * later, also adding overlap, and opens it later on the power stroke, so the gas does
 * more work on the piston before it leaves.
 *
 * Those effects are modelled where they physically live: IVC and overlap in the cycle
 * (`cycleInputsFor`'s `cam`), the breathing curve in `computeHardwareVE`'s phase
 * inputs. Nothing here adds torque — the phaser only moves valve events.
 */

import { clamp, interp1, interp2 } from '../math.js';
import { read2 } from './ecuTables.js';

/** Most a phaser can move each cam from its parked position, crank degrees. */
export const VVT_AUTHORITY = { intake: 50, exhaust: 30 };

/** Intake phases the breathing curve is solved at; points between interpolate. */
export const VE_PHASE_SAMPLES = [0, 10, 20, 30, 40, 50];

/** Which cams a VVT option can move. */
export const VVT_OPTS = [
  { id: 'none', label: 'Fixed cams', intake: false, exhaust: false },
  { id: 'intake', label: 'Inlet cam phaser', intake: true, exhaust: false },
  { id: 'dual', label: 'Inlet + exhaust phasers', intake: true, exhaust: true },
];

/**
 * Where the ECU wants the cams, clamped to what the hardware has.
 *
 * @param {object} input
 * @param {{intakeTarget: import('./ecuTables.js').Map2D, exhaustTarget: import('./ecuTables.js').Map2D}} input.cal
 * @param {string} [input.vvt] VVT hardware id
 * @param {number} input.rpm
 * @param {number} input.mapKpa manifold pressure as the ECU reads it
 * @returns {{intakeAdvDeg: number, exhaustRetDeg: number}}
 */
export function camTargets({ cal, vvt, rpm, mapKpa }) {
  const hw = VVT_OPTS.find((o) => o.id === vvt) ?? VVT_OPTS[0];
  return {
    intakeAdvDeg: hw.intake ? clamp(read2(cal.intakeTarget, rpm, mapKpa), 0, VVT_AUTHORITY.intake) : 0,
    exhaustRetDeg: hw.exhaust ? clamp(read2(cal.exhaustTarget, rpm, mapKpa), 0, VVT_AUTHORITY.exhaust) : 0,
  };
}

/**
 * True cylinder filling at an intake cam phase, from breathing curves solved at the
 * sample phases.
 *
 * @param {number[][][]} tables one hardware VE table per {@link VE_PHASE_SAMPLES} entry
 * @param {number} rpm
 * @param {number} mapKpa
 * @param {number} intakeAdvDeg
 * @returns {number} VE, percent
 */
export function veAtPhase(tables, rpm, mapKpa, intakeAdvDeg) {
  if (!tables || tables.length === 1 || !intakeAdvDeg) return interp2(tables[0], rpm, mapKpa);
  const vals = tables.map((t) => interp2(t, rpm, mapKpa));
  return interp1(VE_PHASE_SAMPLES.slice(0, vals.length), vals, intakeAdvDeg);
}
