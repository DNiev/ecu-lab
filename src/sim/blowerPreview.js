/**
 * What a supercharger will do on this engine before a pull is run: the boost it makes
 * across the rev range at wide-open throttle, how fast it spins, and what it costs the
 * crank — from the same induction solve the dyno uses. BUILD shows it, and it picks the
 * starter pulley a kit would ship with.
 */

import { computeHardwareVE } from './airflow.js';
import { BARO_KPA } from './constants.js';
import { blowerOf } from './blower.js';
import { deriveEngine } from './engine.js';
import { EXHAUST_DIA_OPTS } from './hardware.js';
import { interp2 } from './math.js';
import { RPM } from './tables.js';
import { chargeTempK, INDUCTION_REF_EXHAUST_K } from './thermo.js';
import { solveInduction } from './turbo.js';

/**
 * Curves already solved, per build: BUILD's induction page, the header and the shell all
 * ask for the same one on every render. Builds are immutable store values, so a build
 * object always describes the same car; a changed build is a new object and misses.
 *
 * @type {WeakMap<object, Map<string, ReturnType<typeof solveCurve>>>}
 */
const solved = new WeakMap();

/**
 * Wide-open-throttle boost, blower speed and drive power at each RPM breakpoint.
 *
 * @param {object} build the BUILD state (engineConfig, mods, exhaustDiaIdx, blowerId, ...)
 * @param {{stoich: number}} fuel the fuel in the tank
 * @param {number} [ratio] a pulley ratio to try instead of the fitted one
 * @returns {{rpm: number, boostPsi: number, blowerRpm: number, driveHp: number, overspeed: boolean}[]}
 *   the same array for the same build, fuel and pulley — read it, do not change it
 */
export function blowerCurve(build, fuel, ratio) {
  const blower = blowerOf(build);
  if (!blower) return [];
  const blowerRatio = ratio ?? build.blowerRatio ?? blower.defaultRatio;
  // The fuel by value: a flex blend is a fresh object on every read of the tank.
  const key = `${blowerRatio}|${JSON.stringify(fuel)}`;
  let byKey = solved.get(build);
  if (!byKey) { byKey = new Map(); solved.set(build, byKey); }
  let curve = byKey.get(key);
  if (!curve) { curve = solveCurve(build, fuel, blower, blowerRatio); byKey.set(key, curve); }
  return curve;
}

/**
 * @param {object} build
 * @param {{stoich: number}} fuel
 * @param {object} blower a BLOWER_OPTS entry
 * @param {number} blowerRatio
 */
function solveCurve(build, fuel, blower, blowerRatio) {
  const derived = deriveEngine(build.engineConfig);
  const ve = computeHardwareVE(build.engineConfig, build.mods, {
    exhaustDia: EXHAUST_DIA_OPTS[build.exhaustDiaIdx]?.dia ?? 3.0, fuel, supercharged: true,
  });
  const top = derived.redline ?? 7000;
  return [...RPM.filter((r) => r < top), top].map((rpm) => {
    const man = solveInduction({
      rpm, loadKpa: BARO_KPA, turboOn: false, boostTargetPsi: 0, turbine: null, compressor: null,
      veAt: (m) => interp2(ve, rpm, m), derived,
      intakeKAt: (b) => chargeTempK(b, build.mods.intercooler),
      intakeKAtEff: (b, eta) => chargeTempK(b, build.mods.intercooler, undefined, eta),
      lambda: 1, exhaustK: INDUCTION_REF_EXHAUST_K, blower, blowerRatio,
    });
    const sc = /** @type {NonNullable<typeof man.blower>} */ (man.blower);
    return {
      rpm, boostPsi: man.boostPsi, blowerRpm: sc.blowerRpm, driveHp: sc.driveW / 745.7, overspeed: sc.overspeed,
    };
  });
}

/**
 * The pulley ratio that makes about `targetPsi` near the top of the rev range — what a kit
 * for this engine would ship with — kept inside the blower's rated speed at redline.
 *
 * @param {object} build
 * @param {{stoich: number}} fuel
 * @param {number} [targetPsi]
 * @returns {number} rounded to 0.05
 */
export function starterRatio(build, fuel, targetPsi = 8) {
  const blower = blowerOf(build);
  if (!blower) return 1;
  const redline = deriveEngine(build.engineConfig).redline ?? 7000;
  const rated = blower.maxRpm ?? blower.maxImpellerRpm;
  const maxRatio = rated / (redline * (blower.stepUp ?? 1));
  const boostNearTop = (ratio) => Math.max(...blowerCurve(build, fuel, ratio).map((p) => p.boostPsi));
  let lo = 0.5;
  let hi = maxRatio;
  if (boostNearTop(hi) < targetPsi) return Math.floor(hi * 20) / 20;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (boostNearTop(mid) < targetPsi) lo = mid; else hi = mid;
  }
  return Math.min(Math.floor(maxRatio * 20) / 20, Math.round(lo * 20) / 20);
}
