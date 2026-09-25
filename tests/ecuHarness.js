/**
 * Builds engines for the ECU tests exactly the way the app does (EcuLab.jsx): the true
 * breathing curve from the hardware, the fuel from the tank, the ECU hardware from the
 * build, and a dyno pull or a live engine run with the engine management in the loop.
 */

import * as S from '../src/sim/index.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.preset] a preset id; otherwise the app's default build
 * @param {object} [opts.build] build fields to override
 * @param {Record<string, any>} [opts.cal] calibration paths to override
 * @param {object} [opts.env] ambient conditions
 * @param {Record<string, string>} [opts.faults]
 * @param {boolean} [opts.nitrousArmed] a nitrous kit's arming switch on the dyno (default on)
 * @param {number} [opts.bottleK] the bottle's temperature at the start of the pull
 */
export function makeEngine({ preset, build: patch = {}, cal: calPatch = {}, env, faults, nitrousArmed = true, bottleK } = {}) {
  const p = preset ? S.applyPreset(S.presetById(preset)) : null;
  const build = {
    engineConfig: p?.engineConfig ?? S.DEFAULT_ENGINE_CONFIG,
    mods: p?.mods ?? S.DEFAULT_MODS,
    turboOn: p?.turboOn ?? false,
    boostCurve: p?.boostCurve ?? [...S.DEFAULT_BOOST],
    octaneIdx: p?.octaneIdx ?? 0,
    injIdx: p?.injIdx ?? 0,
    ecuInjectorCc: p?.ecuInjectorCc ?? 315,
    turbineIdx: p?.turbineIdx ?? 1,
    turbineCount: p?.turbineCount ?? 1,
    compressorIdx: p?.compressorIdx ?? 1,
    exhaustDiaIdx: p?.exhaustDiaIdx ?? S.EXHAUST_DIA_OPTS.findIndex((o) => o.dia === 3.0),
    ethanolPct: 0,
    ...patch,
  };
  const turbine = S.turbineWithCount(S.TURBINE_OPTS[build.turbineIdx], build.turbineCount);
  const compressor = S.COMPRESSOR_OPTS[build.compressorIdx];
  const fuel = S.tankFuel(build);
  const hwForVe = {
    turboOn: build.turboOn, turbine: build.turboOn ? turbine : null,
    exhaustDia: S.EXHAUST_DIA_OPTS[build.exhaustDiaIdx].dia, fuel,
    peakBoostPsi: build.turboOn ? Math.max(...build.boostCurve) : 0,
    supercharged: !!S.blowerOf(build),
  };
  const veTruth = S.computeHardwareVE(build.engineConfig, build.mods, hwForVe);
  const derived = S.deriveEngine(build.engineConfig);
  const hw = { ...S.ecuHardwareOf(build), veTruthByPhase: S.veTruthByPhaseFor(build.engineConfig, build.mods, hwForVe) };
  let cal = p?.ecu ?? S.defaultEcuCalibration({ derived, gate: hw.gate });
  for (const [k, v] of Object.entries(calPatch)) cal = S.setCal(cal, k, v);
  const tables = {
    ve: p?.ve ?? veTruth,
    timing: p?.timing ?? S.clone2D(S.DEFAULT_TIMING),
    afr: p?.afr ?? S.clone2D(S.DEFAULT_AFR),
  };
  const sweepArgs = (loadKpa = 100) => ({
    loadKpa, ...tables, veTruth, turboOn: build.turboOn, boostCurve: build.boostCurve,
    octaneLabel: fuel.label, fuel, injectorCc: S.INJECTOR_OPTS[build.injIdx].cc,
    ecuInjectorCc: build.ecuInjectorCc, injectorLabel: 'x', mods: build.mods, mafScalar: 1,
    derived, turbine, compressor,
    ...(S.blowerOf(build) ? { blower: S.blowerOf(build), blowerRatio: build.blowerRatio ?? S.blowerOf(build).defaultRatio } : {}),
    ...(build.nitrous ? { nitrous: build.nitrous } : {}),
  });
  const nitrousCond = build.nitrous ? { armed: nitrousArmed, heater: !!build.nitrous.heater, ...(bottleK ? { bottleK } : {}) } : null;
  const ecu = (cond) => ({ cal, hw: build.nitrous ? { ...hw, nitrous: build.nitrous } : hw, cond: cond ?? S.dynoConditions(env, faults, nitrousCond) });
  return {
    build, derived, cal, hw, tables, veTruth, fuel, turbine, compressor,
    /**
     * A dyno pull with the ECU in the loop (or without it, `legacy`).
     * @param {number} [loadKpa]
     * @param {{legacy?: boolean, gear?: number}} [opts]
     */
    pull: (loadKpa = 100, { legacy = false, gear = undefined } = {}) => S.simulateSweep({
      ...sweepArgs(loadKpa),
      ...(legacy ? {} : { ecu: gear ? { ...ecu(), cond: { ...ecu().cond, gear } } : ecu() }),
    }),
    /** The live engine config, as EcuLab builds it. */
    liveCfg: (aux = {}) => ({
      ...sweepArgs(), ve: tables.ve, timing: tables.timing, afr: tables.afr,
      mafErrorBase: S.mafErrorFactor(build.mods, build.turboOn),
      ecu: { ...ecu(S.dynoConditions(env, faults)), aux },
    }),
  };
}

/**
 * Runs the live engine through a throttle schedule, returning every step's log row.
 * @param {ReturnType<typeof makeEngine>} eng
 * @param {object} opts
 * @param {number} opts.seconds
 * @param {(t: number) => number} [opts.pedal] throttle, percent, against time
 * @param {number} [opts.coolantC] starting coolant and oil temperature
 * @param {object} [opts.aux] cockpit switches (lights, A/C, nitrous arming)
 * @param {object} [opts.from] a state to continue from
 * @param {number} [opts.holdRpm] a brake that holds the engine near this speed under
 *   throttle, the way a load-bearing dyno or a car in gear does; without it the engine
 *   free-revs
 */
export function runLive(eng, { seconds, pedal = () => 0, coolantC = 85, aux = {}, from, holdRpm }) {
  const cfg = eng.liveCfg(aux);
  let s = from ?? { ...S.makeLiveState(), cranking: true, coolantC, oilC: coolantC };
  const rows = [];
  let integ = 0;
  for (let i = 0; i < Math.round(seconds / 0.05); i++) {
    const t = i * 0.05;
    let load = 0;
    if (holdRpm && pedal(t) > 3) {
      const err = s.rpm - holdRpm;
      integ = Math.max(0, integ + err * 0.05);
      load = Math.max(0, 0.4 * err + 0.3 * integ);
    }
    s = S.liveStep(s, 0.05, { throttle: pedal(t), load }, cfg);
    rows.push({ ...s.ecu.log[s.ecu.log.length - 1], running: s.running, protect: s.ecu.protect });
  }
  return { state: s, rows };
}

/** Point of a pull at an RPM. */
export const at = (pull, rpm) => pull.points.find((p) => p.rpm === rpm);
