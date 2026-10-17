/**
 * What a player sees first must agree with itself: a stock calibration must not be flagged
 * by TUNE's advisor as past the knock limit anywhere on the table, whatever load the dyno
 * happens to pull at.
 */
import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine } from './ecuHarness.js';

const advise = (eng, octaneIdx) => {
  const build = { ...eng.build, octaneIdx };
  const cc = S.INJECTOR_OPTS[build.injIdx].cc;
  return S.calibrationAdvice({
    ve: eng.tables.ve, veTruth: eng.veTruth, timing: eng.tables.timing, afr: eng.tables.afr, layout: eng.tables.layout, camAt: eng.camAt,
    derived: eng.derived, fuel: S.OCTANE_OPTS[octaneIdx], mods: build.mods, turboOn: build.turboOn,
    boostCurve: build.boostCurve, compressor: eng.compressor, turbine: eng.turbine,
    injectorCc: cc, ecuInjectorCc: cc, mafScalar: build.mafScalar ?? 1,
    mafErrorBase: S.mafErrorFactor(build.mods, build.turboOn),
  });
};

describe('stock calibrations against TUNE\'s advisor', () => {
  it('the default engine is clean on every table cell at every pump octane it can be given', () => {
    const eng = makeEngine({});
    for (let oi = 0; oi < S.OCTANE_OPTS.length; oi += 1) {
      const over = advise(eng, oi).overAdvanced.map((c) => `${c.map} kPa / ${c.rpm} rpm`);
      expect(over, `octane option ${oi}`).toEqual([]);
    }
  });

  it.each(S.ENGINE_PRESETS.map((p) => p.id))('%s is clean at the pump fuel its preset names', (id) => {
    const eng = makeEngine({ preset: id });
    const over = advise(eng, eng.build.octaneIdx).overAdvanced.map((c) => `${c.map} kPa / ${c.rpm} rpm`);
    expect(over).toEqual([]);
  });
});

/** TUNE's advice as the app gives it: judged against its own 100 kPa pull. */
const adviseWithPull = (eng, tables = eng.tables, mafScalar = eng.build.mafScalar ?? 1) => {
  const cc = S.INJECTOR_OPTS[eng.build.injIdx].cc;
  return S.calibrationAdvice({
    ve: tables.ve, veTruth: eng.veTruth, timing: tables.timing, afr: tables.afr, layout: tables.layout ?? eng.tables.layout, camAt: eng.camAt,
    derived: eng.derived, fuel: eng.fuel, mods: eng.build.mods, turboOn: eng.build.turboOn,
    boostCurve: eng.build.boostCurve, compressor: eng.compressor, turbine: eng.turbine,
    injectorCc: cc, ecuInjectorCc: eng.build.ecuInjectorCc, mafScalar,
    mafErrorBase: S.mafErrorFactor(eng.build.mods, eng.build.turboOn), pull: eng.pull(100),
  });
};
const where = (cells) => cells.map((c) => `${c.map} kPa / ${c.rpm} rpm`);
const logged = (eng) => [100, 70, 40].flatMap((k) => eng.pull(k).events.map((e) => `${k} kPa: ${e.type}`));

describe('a stock engine tells one story on every screen', () => {
  // Past MBT is not dangerous, but TUNE says so, and a factory table that TUNE marks up is a
  // stock tune two screens disagree about.
  it('the default engine: nothing past MBT or the knock limit on TUNE, nothing in the log at 100, 70 or 40 kPa', () => {
    const eng = makeEngine({});
    const a = adviseWithPull(eng);
    expect(where(a.overAdvanced)).toEqual([]);
    expect(where(a.pastMbt)).toEqual([]);
    expect(logged(eng)).toEqual([]);
  });

  it.each(S.ENGINE_PRESETS.map((p) => p.id))('%s: the same', (id) => {
    const eng = makeEngine({ preset: id });
    const a = adviseWithPull(eng, eng.tables, S.applyPreset(S.presetById(id)).mafScalar ?? 1);
    expect(where(a.overAdvanced)).toEqual([]);
    expect(where(a.pastMbt)).toEqual([]);
    expect(logged(eng)).toEqual([]);
  });
});

describe('RESET ALL TO STOCK', () => {
  /** The engine as RESET leaves it, the way EcuLab and the reducer do it. */
  const reset = (id, modsBefore) => {
    const p = S.applyPreset(S.presetById(id));
    const before = { ...p, mods: modsBefore ?? p.mods };
    const eng = makeEngine({ preset: id, build: { mods: S.stockModsOf(before) } });
    const stock = S.stockCalibrationFor({ ...eng.build });
    eng.tables.timing = stock.timing;
    eng.tables.afr = stock.afr;
    eng.tables.ve = stock.ve;
    eng.tables.layout = stock.layout;
    eng.build.mafScalar = stock.mafScalar;
    return { eng, stock, preset: p };
  };

  it.each(S.ENGINE_PRESETS.map((p) => p.id))('%s: gives back the preset\'s own tables, clean on TUNE and in the log', (id) => {
    const { eng, stock, preset } = reset(id);
    expect(stock.timing).toEqual(preset.timing);
    expect(stock.afr).toEqual(preset.afr);
    const a = adviseWithPull(eng, eng.tables, stock.mafScalar);
    expect(where(a.overAdvanced)).toEqual([]);
    expect(where(a.pastMbt)).toEqual([]);
    expect(logged(eng)).toEqual([]);
  });

  it('takes the bolt-ons off but leaves a turbo engine its intercooler', () => {
    const all = { intake: true, exhaust: true, headers: true, intercooler: true };
    expect(S.stockModsOf({ mods: all, turboOn: true })).toEqual({ intake: false, exhaust: false, headers: false, intercooler: true });
    expect(S.stockModsOf({ mods: all, turboOn: false, blowerId: 'tvs1900' })).toEqual({ intake: false, exhaust: false, headers: false, intercooler: true });
    expect(S.stockModsOf({ mods: all, turboOn: false, blowerId: null })).toEqual({ intake: false, exhaust: false, headers: false, intercooler: false });
    // An N54 with every bolt-on fitted resets to the factory car, not one with no intercooler.
    const { stock, preset } = reset('n54', all);
    expect(stock.timing).toEqual(preset.timing);
  });
});

describe('cells the pull did not run', () => {
  // The default table with its 40 kPa row 18° advanced: past the knock limit there (at
  // 40 kPa there is little end-gas pressure to knock with, so it takes more than it did
  // before the rod length was corrected, and more again once an uneven stoichiometric
  // mixture stopped releasing all of its heat: thermo.js, heatReleasedShare).
  const knockingAt40 = () => {
    const eng = makeEngine({});
    eng.tables.timing = eng.tables.timing.map((row, ri) => ((eng.tables.layout?.timing.load ?? S.LOAD)[ri] === 40 ? row.map((v, ci) => (ci === 0 ? v : Math.min(S.SPARK_MAX_DEG, v + 18))) : row));
    return eng;
  };

  it('are judged against the player\'s own pull: a 40 kPa pull runs the 40 kPa row, a 100 kPa pull does not', () => {
    const eng = knockingAt40();
    const flagged = adviseWithPull(eng).overAdvanced.filter((c) => c.map === 40);
    expect(flagged.length).toBeGreaterThan(0);
    expect(S.cellsNotRunBy(flagged, eng.pull(100))).toEqual(flagged);
    const at40 = eng.pull(40);
    const notRun = S.cellsNotRunBy(flagged, at40);
    expect(notRun.length).toBeLessThan(flagged.length);
    // The 40 kPa pull's own log charges what it ran; the score charges the rest once each.
    const charged = S.computeTuningScore(at40, notRun);
    expect(charged.deductions.filter((d) => /did not run/.test(d))).toHaveLength(notRun.length ? 1 : 0);
  });
});
