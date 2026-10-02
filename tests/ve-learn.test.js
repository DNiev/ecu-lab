/**
 * The VE table tuned the way a real speed-density table is: log, compare the mixture
 * the engine got with the one the table asked for, correct only the cells with data,
 * and repeat. No step here reads the engine's true VE — only what a wideband and the
 * fuel trims would show a tuner.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine, runLive } from './ecuHarness.js';
import { seedRandomPerTest } from './seededRandom.js';

seedRandomPerTest();

const WOT = S.LOAD.indexOf(100);
/** An engine whose VE table reads `factor` of what it should — a build change nobody retuned for. */
const offBy = (factor, opts = {}) => {
  const eng = makeEngine(opts);
  eng.tables.ve = eng.tables.ve.map((row) => row.map((v) => v * factor));
  return eng;
};
const wotError = (pull) => Math.max(...pull.points.filter((p) => p.openLoop)
  .map((p) => Math.abs(p.sensedLambda / (p.afrCommanded / 14.7) - 1)));

describe('correcting VE from a dyno pull', () => {
  it('reads a table 10% low as 11% too little air in the cells the pull ran through, and nothing elsewhere', () => {
    const eng = offBy(0.9);
    const { ratio, cells } = S.veCorrections(S.veSamplesFromPull(eng.pull(100).points));
    expect(cells).toBeGreaterThan(4);
    for (let ci = 2; ci < S.RPM.length; ci += 1) expect(ratio[WOT][ci]).toBeCloseTo(1 / 0.9, 1);
    // A full-throttle pull says nothing about part-throttle cells.
    expect(ratio[S.LOAD.indexOf(40)].every((r) => r == null)).toBe(true);
  });

  it('applying it brings the full-throttle mixture back within 2%, and leaves unlogged cells alone', () => {
    const eng = offBy(0.9);
    expect(wotError(eng.pull(100))).toBeGreaterThan(0.08);
    const before = eng.tables.ve.map((r) => [...r]);
    const { ratio } = S.veCorrections(S.veSamplesFromPull(eng.pull(100).points));
    eng.tables.ve = S.applyVeCorrections(eng.tables.ve, ratio, 1);
    expect(wotError(eng.pull(100))).toBeLessThan(0.02);
    expect(eng.tables.ve[S.LOAD.indexOf(40)]).toEqual(before[S.LOAD.indexOf(40)]);
  });

  it('a cold air intake on the stock tune: the pull logs the intake\'s VE gain, and keeps the MAF housing\'s error out of it', () => {
    // The case a player hit: fit the intake, pull, and expect the log to have something
    // to say. The bigger housing makes the MAF read about 10% low, so the mixture goes
    // lean by that AND by the extra air the intake flows. Only the second belongs in VE.
    const stock = makeEngine();
    const eng = makeEngine({ build: { mods: { ...S.DEFAULT_MODS, intake: true } } });
    eng.tables.ve = stock.tables.ve.map((r) => [...r]);
    const samples = S.veSamplesFromPull(eng.pull(100).points);
    const { ratio, cell, cells } = S.veCorrections(samples);
    expect(cells).toBeGreaterThan(4);
    expect(S.mafErrorPct(samples)).toBeLessThan(-5);
    for (let ci = 1; ci < S.RPM.length; ci += 1) {
      // The wideband alone says 10-16% more air; the intake really flows 0-5% more.
      expect(cell[WOT][ci].lambdaRatio).toBeGreaterThan(1.08);
      expect(ratio[WOT][ci]).toBeCloseTo(eng.veTruth[WOT][ci] / stock.veTruth[WOT][ci], 1);
    }
  });

  it('applying half at a time converges, the way tuners do it', () => {
    const eng = offBy(0.85);
    const errors = [];
    for (let i = 0; i < 4; i += 1) {
      const pull = eng.pull(100);
      errors.push(wotError(pull));
      eng.tables.ve = S.applyVeCorrections(eng.tables.ve, S.veCorrections(S.veSamplesFromPull(pull.points)).ratio, 0.5);
    }
    for (let i = 1; i < errors.length; i += 1) expect(errors[i]).toBeLessThan(errors[i - 1]);
    expect(errors.at(-1)).toBeLessThan(0.04);
  });

  it('leaves nitrous, injector-limited and protection-enriched points out', () => {
    const points = [
      { rpm: 3000, sensedMap: 100, openLoop: true, sensedLambda: 0.9, afrCommanded: 12.6, nitrousLbMin: 5 },
      { rpm: 3000, sensedMap: 100, openLoop: true, sensedLambda: 0.9, afrCommanded: 12.6, fuelLimited: true },
      { rpm: 3000, sensedMap: 100, openLoop: true, sensedLambda: 0.9, afrCommanded: 12.6, protect: ['egt'] },
      { rpm: 3000, sensedMap: 100, openLoop: false, sensedLambda: 0.9, afrCommanded: 12.6 },
    ];
    expect(S.veSamplesFromPull(points)).toEqual([]);
  });
});

describe('correcting VE from the LIVE datalog', () => {
  const cruise = (eng) => runLive(eng, { seconds: 14, pedal: (t) => (t > 3 ? 30 : 0), coolantC: 90, holdRpm: 3000 });

  it('folds the fuel trims in: log, apply, re-log, and the trims converge on nothing left to do', () => {
    // Real VE tuning is iterative: a cruise between two table rows only half-informs the
    // row it barely touched, so each pass fixes most of what is left.
    const eng = offBy(0.9);
    const trims = [];
    for (let pass = 0; pass < 3; pass += 1) {
      const { rows } = cruise(eng);
      const settled = rows.slice(-40);
      trims.push(settled.reduce((sum, r) => sum + Math.abs(r.stft + r.ltft), 0) / settled.length);
      eng.tables.ve = S.applyVeCorrections(eng.tables.ve, S.veCorrections(S.veSamplesFromLive(rows, eng.tables.ve)).ratio, 1);
    }
    expect(trims[0]).toBeGreaterThan(5);
    expect(trims[1]).toBeLessThan(trims[0] / 2);
    expect(trims[2]).toBeLessThan(2.5);
  });

  it('a log already applied reads as done — the same data cannot correct the table twice', () => {
    const eng = offBy(0.9);
    const { rows } = cruise(eng);
    const first = S.veCorrections(S.veSamplesFromLive(rows, eng.tables.ve));
    eng.tables.ve = S.applyVeCorrections(eng.tables.ve, first.ratio, 1);
    const again = S.veCorrections(S.veSamplesFromLive(rows, eng.tables.ve));
    // Within the 2-3% a wideband and trims can resolve: nothing like the 10% first read.
    for (const row of again.ratio) for (const r of row) if (r != null) expect(Math.abs(r - 1)).toBeLessThan(0.03);
  });

  it('leaves out a cold engine, where warm-up fuel is doing the enriching', () => {
    const eng = offBy(0.9);
    const { rows } = runLive(eng, { seconds: 8, pedal: (t) => (t > 3 ? 30 : 0), coolantC: 20, holdRpm: 3000 });
    expect(S.veSamplesFromLive(rows, eng.tables.ve)).toEqual([]);
  });
});
