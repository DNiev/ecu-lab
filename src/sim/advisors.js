/**
 * Advisors — compare what the hardware now wants against what the player's tables
 * actually say.
 *
 * These NEVER edit anything. That is the central design rule of the app: hardware
 * changes invalidate a calibration but do not rewrite it, exactly as in a real shop.
 * The advisors report the gap; closing it is the player's job.
 */

import { BARO_KPA, PSI_TO_KPA } from './constants.js';
import { computeHardwareVE } from './airflow.js';
import { interp1 } from './math.js';
import { computeManifold } from './manifold.js';
import { evaluatePoint } from './point.js';
import { LOAD, RPM } from './tables.js';

/** The ~100 kPa row — wide-open throttle, naturally aspirated. */
const WOT_ROW = 2;

/** A cell delta below this (percent) is not worth reporting. */
const VE_NOTABLE_PCT = 2.5;

/**
 * Compares the player's VE table against what the current hardware would flow, and
 * turns the gap into specific, cell-level tuning advice — the same thing a tuner
 * would conclude after re-logging airflow following a parts change.
 *
 * @param {number[][]} currentVe the player's VE table
 * @param {import('./engine.js').EngineConfig} cfg
 * @param {object} mods
 * @param {object} hw induction hardware, as passed to {@link computeHardwareVE}
 * @returns {{inSync: boolean, recs: object[], deltas: object[], maxAbs: number}}
 */
export function veRecommendations(currentVe, cfg, mods, hw) {
  const target = computeHardwareVE(cfg, mods, hw);
  const recs = [];
  const deltas = RPM.map((rpm, ci) => ({
    rpm,
    pct: ((target[WOT_ROW][ci] - currentVe[WOT_ROW][ci]) / Math.max(1, currentVe[WOT_ROW][ci])) * 100,
    from: currentVe[WOT_ROW][ci],
    to: target[WOT_ROW][ci],
  }));

  const notable = deltas.filter((d) => Math.abs(d.pct) >= VE_NOTABLE_PCT);
  if (notable.length === 0) {
    return { inSync: true, recs: [], deltas, maxAbs: Math.max(...deltas.map((d) => Math.abs(d.pct))) };
  }

  const low = notable.filter((d) => d.rpm <= 3500);
  const mid = notable.filter((d) => d.rpm > 3500 && d.rpm < 6500);
  const high = notable.filter((d) => d.rpm >= 6500);

  const band = (arr, name) => {
    if (!arr.length) return;
    const avg = arr.reduce((a, b) => a + b.pct, 0) / arr.length;
    const dir = avg > 0 ? 'raise' : 'lower';
    recs.push({
      band: name,
      rpmText: arr.length === 1 ? `${arr[0].rpm} RPM` : `${arr[0].rpm}–${arr[arr.length - 1].rpm} RPM`,
      pct: avg,
      text: `${dir === 'raise' ? 'Raise' : 'Lower'} the ${name} cells by about ${Math.abs(avg).toFixed(0)}% — your hardware ${avg > 0 ? 'now flows more air here than your table assumes' : 'flows less air here than your table assumes'}.`,
      cells: arr.map((d) => `${d.rpm} RPM: ${d.from} → ${d.to}`),
    });
  };
  band(low, 'low-RPM');
  band(mid, 'mid-range');
  band(high, 'top-end');

  return { inSync: false, recs, deltas, maxAbs: Math.max(...deltas.map((d) => Math.abs(d.pct))) };
}

/**
 * Reports, cell by cell, what the current hardware would actually tolerate for spark
 * and mixture — so the player can see where their tune has gone stale and fix it
 * themselves. Spark and fuel are never auto-changed.
 *
 * @param {object} input
 * @returns {{spark: object[], fuelAdv: object[], overAdvanced: object[], underAdvanced: object[], wrongMix: object[]}}
 */
export function calibrationAdvice({
  ve, veTruth, timing, afr, derived, octaneBonus, fuel, mods, turboOn, boostCurve,
  compressor, turbine, injectorCc, ecuInjectorCc, mafScalar, mafErrorBase,
}) {
  const spark = [], fuelAdv = [];
  // Only advise on load the engine can actually reach. A naturally aspirated build
  // never sees 150 or 200 kPa, so flagging those rows would be pure noise.
  const maxReachable = BARO_KPA + (turboOn ? Math.max(...boostCurve) * PSI_TO_KPA : 0) + 2;
  LOAD.forEach((mapRow, ri) => {
    if (mapRow > maxReachable) return;
    RPM.forEach((rpm, ci) => {
      const boostTarget = turboOn ? interp1(RPM, boostCurve, rpm) : 0;
      const man = computeManifold(rpm, Math.min(mapRow, BARO_KPA), turboOn, boostTarget, turbine, compressor);
      const useMap = mapRow > BARO_KPA ? mapRow : man.mapKpa;
      const boostPsi = Math.max(0, (useMap - BARO_KPA) / PSI_TO_KPA);
      const pt = evaluatePoint({
        rpm, mapKpa: useMap, boostPsi,
        veVal: ve[ri][ci], veActualVal: veTruth?.[ri]?.[ci],
        timingVal: timing[ri][ci], afrCommanded: afr[ri][ci],
        octaneBonus, fuel, mods: { ...mods, turboFitted: turboOn }, mafScalar, mafErrorBase,
        injectorCc, ecuInjectorCc, derived, compressor,
      });
      // Leave ~1.5 deg of safety under the calculated knock limit, as a tuner would.
      const safeTiming = Math.round((pt.threshold - 1.5) * 2) / 2;
      spark.push({
        ri, ci, rpm, map: mapRow, current: timing[ri][ci], suggested: safeTiming,
        delta: Number((safeTiming - timing[ri][ci]).toFixed(1)), knocking: pt.knock,
      });
      fuelAdv.push({
        ri, ci, rpm, map: mapRow, current: afr[ri][ci], suggested: Number(pt.bestAfr.toFixed(1)),
        delta: Number((pt.bestAfr - afr[ri][ci]).toFixed(1)), duty: pt.duty,
      });
    });
  });
  const overAdvanced = spark.filter((c) => c.delta < -1.0);
  const underAdvanced = spark.filter((c) => c.delta > 3.0);
  const wrongMix = fuelAdv.filter((c) => c.map >= 85 && Math.abs(c.delta) > 0.45);
  return { spark, fuelAdv, overAdvanced, underAdvanced, wrongMix };
}
