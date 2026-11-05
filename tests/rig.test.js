/**
 * `buildRig` is the app's dyno pull, taken out of React so the Discord bot and the tests
 * run what the app runs.
 *
 * The first block pins it to a copy of EcuLab.jsx's own assembly (the `hwForVe`, `veTruth`,
 * `ecuHw`, `ecuBundle` and `sweepArgs` it builds from state), written out here on purpose
 * rather than imported. If `buildRig` drifts from the app, this fails. It cannot notice
 * EcuLab.jsx changing on its own — moving the app onto `buildRig` is what closes that.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

/**
 * A preset's dyno pull, assembled the way EcuLab.jsx assembles it from its state, after
 * the user has changed any of `change` (the parts and fuel `/dyno` can change) in the UI.
 * @param {string} presetId
 * @param {{ mods?: object, octaneIdx?: number }} [change]
 */
function appPull(presetId, change = {}) {
  const p = S.applyPreset(S.presetById(presetId));
  const build = {
    engineConfig: p.engineConfig, mods: change.mods ?? p.mods, turboOn: p.turboOn, boostCurve: p.boostCurve,
    octaneIdx: change.octaneIdx ?? p.octaneIdx, injIdx: p.injIdx, ecuInjectorCc: p.ecuInjectorCc,
    turbineIdx: p.turbineIdx, turbineCount: p.turbineCount, compressorIdx: p.compressorIdx,
    exhaustDiaIdx: p.exhaustDiaIdx, ethanolPct: 0,
  };
  const fuel = S.tankFuel(build);
  const turbine = S.turbineWithCount(S.TURBINE_OPTS[build.turbineIdx], build.turbineCount);
  const blower = S.blowerOf(build);
  const hwForVe = {
    turboOn: build.turboOn,
    turbine: build.turboOn ? turbine : null,
    exhaustDia: S.EXHAUST_DIA_OPTS[build.exhaustDiaIdx].dia,
    fuel,
    peakBoostPsi: build.turboOn ? Math.max(...build.boostCurve) : 0,
    supercharged: !!blower,
  };
  // The breathing with the cam where the calibration holds it, as EcuLab's `veTruth` is.
  const veTruth = S.scheduledVeAt(build.engineConfig, build.mods, hwForVe, p.ecu.vvt);
  const ecuHw = { ...S.ecuHardwareOf(build), veTruthByPhase: S.veTruthByPhaseFor(build.engineConfig, build.mods, hwForVe) };
  const ecuBundle = { cal: p.ecu, hw: ecuHw, cond: S.dynoConditions({ ...S.DEFAULT_ENV }, {}, null) };
  return S.simulateSweep({
    loadKpa: 100, ve: p.ve, veTruth, timing: p.timing, afr: p.afr,
    turboOn: build.turboOn, boostCurve: build.boostCurve, octaneBonus: fuel.bonus, octaneLabel: fuel.label,
    fuel, injectorCc: S.INJECTOR_OPTS[build.injIdx].cc, ecuInjectorCc: build.ecuInjectorCc,
    injectorLabel: S.INJECTOR_OPTS[build.injIdx].label, mods: build.mods, mafScalar: p.mafScalar ?? 1,
    derived: S.deriveEngine(build.engineConfig),
    turbine, compressor: S.compressorWithCount(S.COMPRESSOR_OPTS[build.compressorIdx], build.turbineCount),
    ecu: ecuBundle, layout: p.layout ?? null,
  });
}

describe('buildRig', () => {
  S.ENGINE_PRESETS.forEach((preset) => {
    it(`pulls ${preset.name} exactly as the app does`, () => {
      expect(S.buildRig({ preset: preset.id }).pull()).toEqual(appPull(preset.id));
    });

    // What `/dyno` mostly runs: the factory tune with parts and fuel changed. Stock parity
    // alone would miss a change that reaches one part of the assembly but not another.
    it(`pulls ${preset.name} with bolt-ons and another fuel exactly as the app does`, () => {
      const change = {
        mods: { ...preset.mods, intake: true, exhaust: true, headers: true },
        octaneIdx: preset.parts.octaneIdx === 2 ? 1 : 2,
      };
      expect(S.buildRig({ preset: preset.id, build: change }).pull()).toEqual(appPull(preset.id, change));
    });
  });

  it('feeds bolt-ons into the true airflow, not just the label', () => {
    // The trap this guards: passing a preset's own VE table as `veTruth` ignores every
    // part, so intake + headers came out at exactly the stock figures.
    const preset = S.presetById('vq35hr');
    const stock = S.buildRig({ preset: preset.id });
    const modded = S.buildRig({ preset: preset.id, build: { mods: { ...preset.mods, intake: true, headers: true } } });
    expect(modded.veTruth(5000, 100)).not.toBe(stock.veTruth(5000, 100));
    expect(modded.pull().peakTq).not.toBe(stock.pull().peakTq);
  });

  it('is what the ECU test harness hands out', async () => {
    const { makeEngine } = await import('./ecuHarness.js');
    expect(makeEngine).toBe(S.buildRig);
  });
});
