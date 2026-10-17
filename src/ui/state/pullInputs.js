/**
 * Everything a dyno pull (or a LIVE run) is solved from, derived from a store-shaped
 * state exactly as EcuLab.jsx derives it. Shared by the tutorial's demo engines and the
 * career's job grading, so both run the same simulation the player's own screens do.
 */

import {
  COMPRESSOR_OPTS, EXHAUST_DIA_OPTS, INJECTOR_OPTS, TURBINE_OPTS, compressorWithCount,
  blowerOf, computeHardwareVE, deriveEngine, dynoConditions,
  ecuHardwareOf, tankFuel, turbineWithCount, veTruthByPhaseFor,
} from '../../sim/index.js';

/** @typedef {import('./initialState.js').StoreState} StoreState */

/**
 * Everything a pull is solved from, derived from the store exactly as EcuLab.jsx does
 * (`fuel`, `hwForVe`, `veTruth`, `ecuHw`, `ecuBundle`, `sweepArgs`).
 *
 * @param {StoreState} state
 */
export function pullInputs(state) {
  const { build, tune, session } = state;
  const {
    engineConfig, mods, turboOn, boostCurve, injIdx, mafScalar, turbineIdx, turbineCount,
    compressorIdx, exhaustDiaIdx, ecuInjectorCc, blowerRatio, nitrous,
  } = build;
  const fuel = tankFuel(build);
  const derived = deriveEngine(engineConfig);
  const turbine = turbineWithCount(TURBINE_OPTS[turbineIdx], turbineCount);
  const blower = blowerOf(build);
  const hwForVe = {
    turboOn, turbine: turboOn ? turbine : null, exhaustDia: EXHAUST_DIA_OPTS[exhaustDiaIdx].dia, fuel,
    peakBoostPsi: turboOn ? Math.max(...boostCurve) : 0, supercharged: !!blower,
  };
  const veTruth = computeHardwareVE(engineConfig, mods, hwForVe);
  const ecuHw = { ...ecuHardwareOf(build), veTruthByPhase: veTruthByPhaseFor(engineConfig, mods, hwForVe) };
  const armed = session.liveAux?.nitrous !== false;
  const ecu = {
    cal: tune.ecu, hw: nitrous ? { ...ecuHw, nitrous } : ecuHw,
    cond: dynoConditions(session.env, session.faults, nitrous ? { armed, heater: !!nitrous.heater } : null),
  };
  const args = {
    loadKpa: session.loadKpa, ve: tune.ve, veTruth, timing: tune.timing, afr: tune.afr, turboOn, boostCurve,
    octaneBonus: fuel.bonus, octaneLabel: fuel.label, fuel, injectorCc: INJECTOR_OPTS[injIdx].cc, ecuInjectorCc,
    injectorLabel: INJECTOR_OPTS[injIdx].label, mods, mafScalar, derived, turbine,
    compressor: compressorWithCount(COMPRESSOR_OPTS[compressorIdx], turbineCount), ecu,
    ...(blower ? { blower, blowerRatio } : {}), ...(nitrous ? { nitrous } : {}),
  };
  let mafErrorBase = 1;
  if (mods.intake) mafErrorBase *= 0.90;
  if (turboOn) mafErrorBase *= 0.92;
  return { args, derived, veTruth, fuel, mafErrorBase };
}

