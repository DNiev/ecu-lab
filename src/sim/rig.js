/**
 * A whole engine on the dyno, assembled exactly the way the app assembles it.
 *
 * EcuLab.jsx builds a dyno pull out of React state: the true breathing curve from the
 * hardware as fitted, the fuel from the tank, the engine management's hardware from the
 * build, and the ECU in the loop. This is that assembly as a pure function, so code outside
 * the UI — the ECU tests, the Discord bot — runs the pull the app runs rather than an
 * approximation of it.
 *
 * The approximation is easy to fall into. Passing a preset's own VE table as `veTruth`
 * looks right and runs, but the true airflow then never sees the parts: bolt an intake and
 * headers on and the pull comes out at exactly the stock figures. Here `veTruth` always
 * comes from `computeHardwareVE` for the parts actually fitted, and the VE table stays the
 * ECU's (possibly wrong) belief about it, which is the whole lesson of the app.
 *
 * EcuLab.jsx still has its own copy. `tests/rig.test.js` pins this one to it.
 */

import { computeHardwareVE } from './airflow.js';
import { blowerOf } from './blower.js';
import { defaultEcuCalibration, setCal } from './ecu/calibration.js';
import { dynoConditions, ecuHardwareOf, intakeCamAt, scheduledVeAt, tankFuel, veTruthByPhaseFor } from './ecu/context.js';
import { deriveEngine } from './engine.js';
import { COMPRESSOR_OPTS, EXHAUST_DIA_OPTS, INJECTOR_OPTS, TURBINE_OPTS, compressorWithCount, turbineWithCount } from './hardware.js';
import { clone2D } from './math.js';
import { applyPreset, presetById } from './presets.js';
import { dutyPreviewRpm, injectorDutyPreview, mafErrorFactor, simulateSweep } from './sweep.js';
import { DEFAULT_AFR, DEFAULT_BOOST, DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, DEFAULT_TIMING } from './tables.js';

/**
 * Builds an engine on the dyno, from a preset or the app's default build.
 *
 * @param {object} [opts]
 * @param {string} [opts.preset] a preset id; otherwise the app's default build
 * @param {object} [opts.build] build fields to override (e.g. `mods`, `octaneIdx`)
 * @param {Record<string, any>} [opts.cal] calibration paths to override, as `setCal` takes them
 * @param {object} [opts.env] ambient conditions
 * @param {Record<string, string>} [opts.faults]
 * @param {boolean} [opts.nitrousArmed] a nitrous kit's arming switch on the dyno (default on)
 * @param {number} [opts.bottleK] the bottle's temperature at the start of the pull
 */
export function buildRig({ preset, build: patch = {}, cal: calPatch = {}, env, faults, nitrousArmed = true, bottleK } = {}) {
  const p = preset ? applyPreset(presetById(preset)) : null;
  const build = {
    engineConfig: p?.engineConfig ?? DEFAULT_ENGINE_CONFIG,
    mods: p?.mods ?? DEFAULT_MODS,
    turboOn: p?.turboOn ?? false,
    boostCurve: p?.boostCurve ?? [...DEFAULT_BOOST],
    octaneIdx: p?.octaneIdx ?? 0,
    injIdx: p?.injIdx ?? 0,
    ecuInjectorCc: p?.ecuInjectorCc ?? 315,
    turbineIdx: p?.turbineIdx ?? 1,
    turbineCount: p?.turbineCount ?? 1,
    compressorIdx: p?.compressorIdx ?? 1,
    exhaustDiaIdx: p?.exhaustDiaIdx ?? EXHAUST_DIA_OPTS.findIndex((o) => o.dia === 3.0),
    // The preset's own MAF scalar, as APPLY_PRESET puts it in the app's BUILD slice. Left
    // out, a turbo preset is graded with its MAF error uncorrected: 8% lean of the mixture
    // its tables were written for, which matters once a rich flame's heat depends on how
    // rich it is (thermo.js, heatReleasedShare).
    mafScalar: p?.mafScalar ?? 1,
    ethanolPct: p?.ethanolPct ?? 0,
    ...patch,
  };
  const turbine = turbineWithCount(TURBINE_OPTS[build.turbineIdx], build.turbineCount);
  const compressor = compressorWithCount(COMPRESSOR_OPTS[build.compressorIdx], build.turbineCount);
  const fuel = tankFuel(build);
  const hwForVe = {
    turboOn: build.turboOn, turbine: build.turboOn ? turbine : null,
    exhaustDia: EXHAUST_DIA_OPTS[build.exhaustDiaIdx].dia, fuel,
    peakBoostPsi: build.turboOn ? Math.max(...build.boostCurve) : 0,
    supercharged: !!blowerOf(build),
  };
  const derived = deriveEngine(build.engineConfig);
  const hw = { ...ecuHardwareOf(build), veTruthByPhase: veTruthByPhaseFor(build.engineConfig, build.mods, hwForVe) };
  let cal = p?.ecu ?? defaultEcuCalibration({ derived, gate: hw.gate });
  for (const [k, v] of Object.entries(calPatch)) cal = setCal(cal, k, v);
  // The engine's breathing with its cam where the calibration holds it, as the app has it.
  const veTruth = scheduledVeAt(build.engineConfig, build.mods, hwForVe, cal.vvt);
  const camAt = intakeCamAt(build.engineConfig, cal.vvt);
  const tables = {
    ve: p?.ve ?? computeHardwareVE(build.engineConfig, build.mods, hwForVe),
    timing: p?.timing ?? clone2D(DEFAULT_TIMING),
    afr: p?.afr ?? clone2D(DEFAULT_AFR),
    // A preset's tables are on its own engine-sized breakpoints; the default engine's on the legacy grid.
    layout: p?.layout ?? null,
  };
  const blower = blowerOf(build);
  const sweepArgs = (loadKpa = 100) => ({
    loadKpa, ...tables, veTruth, turboOn: build.turboOn, boostCurve: build.boostCurve,
    octaneLabel: fuel.label, fuel, injectorCc: INJECTOR_OPTS[build.injIdx].cc,
    ecuInjectorCc: build.ecuInjectorCc, injectorLabel: INJECTOR_OPTS[build.injIdx].label,
    mods: build.mods, mafScalar: build.mafScalar, derived, turbine, compressor,
    ...(blower ? { blower, blowerRatio: build.blowerRatio ?? blower.defaultRatio } : {}),
    ...(build.nitrous ? { nitrous: build.nitrous } : {}),
  });
  const nitrousCond = build.nitrous ? { armed: nitrousArmed, heater: !!build.nitrous.heater, ...(bottleK ? { bottleK } : {}) } : null;
  const ecu = (cond) => ({ cal, hw: build.nitrous ? { ...hw, nitrous: build.nitrous } : hw, cond: cond ?? dynoConditions(env, faults, nitrousCond) });
  return {
    build, derived, cal, hw, tables, veTruth, camAt, fuel, turbine, compressor,
    /**
     * A dyno pull with the ECU in the loop (or without it, `legacy`).
     * @param {number} [loadKpa]
     * @param {{legacy?: boolean, gear?: number}} [opts]
     */
    pull: (loadKpa = 100, { legacy = false, gear = undefined } = {}) => simulateSweep({
      ...sweepArgs(loadKpa),
      ...(legacy ? {} : { ecu: gear ? { ...ecu(), cond: { ...ecu().cond, gear } } : ecu() }),
    }),
    /** TUNE → INJECTORS' duty at an RPM of a full-throttle pull, as EcuLab asks for it. */
    dutyPreview: (rpm = dutyPreviewRpm(derived)) => injectorDutyPreview({ ...sweepArgs(100), ecu: ecu(), rpm }),
    /** The live engine config, as EcuLab builds it. */
    liveCfg: (aux = {}) => ({
      ...sweepArgs(), ve: tables.ve, timing: tables.timing, afr: tables.afr, layout: tables.layout,
      mafErrorBase: mafErrorFactor(build.mods, build.turboOn),
      ecu: { ...ecu(dynoConditions(env, faults)), aux },
    }),
  };
}
