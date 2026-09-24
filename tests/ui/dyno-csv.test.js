/**
 * The dyno sheet export.
 *
 * `sweepToCsv` is deliberately a pure string function so the part worth pinning can be
 * tested without a DOM: the download half is four lines of browser API with no logic
 * in it.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../../src/sim/index.js';
import { DYNO_COLUMNS, dynoSheetFilename, sweepToCsv } from '../../src/ui/components/dynoCsv.js';

/** A real pull, so the columns are asserted against what the sim actually emits. */
function realPull() {
  const preset = S.ENGINE_PRESETS.find((p) => p.id === 'n54');
  const patch = S.applyPreset(preset);
  const derived = S.deriveEngine(patch.engineConfig);
  return S.simulateSweep({
    loadKpa: 100, ve: patch.ve, veTruth: patch.ve, timing: patch.timing, afr: patch.afr,
    turboOn: patch.turboOn, boostCurve: patch.boostCurve,
    octaneBonus: S.OCTANE_OPTS[patch.octaneIdx].bonus,
    octaneLabel: S.OCTANE_OPTS[patch.octaneIdx].label, fuel: S.OCTANE_OPTS[patch.octaneIdx],
    injectorCc: S.INJECTOR_OPTS[patch.injIdx].cc, ecuInjectorCc: patch.ecuInjectorCc,
    injectorLabel: 'stock', mods: patch.mods, mafScalar: 1, derived,
    turbine: S.presetTurbine(preset), compressor: S.COMPRESSOR_OPTS[patch.compressorIdx],
  });
}

describe('dyno sheet export', () => {
  const result = realPull();

  it('writes a header row and one row per sweep point', () => {
    const lines = sweepToCsv(result.points).trimEnd().split('\n');
    expect(lines).toHaveLength(result.points.length + 1);
    expect(lines[0]).toBe(DYNO_COLUMNS.map(([name]) => name).join(','));
  });

  // The failure this guards is a column that silently exports nothing because the
  // datalog renamed a field. An empty column is worse than a missing one: it looks
  // like the engine did not do the thing.
  it('reads a real field for every column it declares', () => {
    const p = result.points[Math.floor(result.points.length / 2)];
    const missing = DYNO_COLUMNS.filter(([, key]) => p[key] === undefined);
    expect(missing, `columns reading nothing: ${missing.map(([n]) => n).join(', ')}`).toEqual([]);
  });

  it('carries the cycle quantities a power graph cannot show', () => {
    const names = DYNO_COLUMNS.map(([n]) => n);
    for (const n of ['knock_integral', 'mfb50_deg_atdc', 'peak_pressure_bar', 'emp_kpa', 'residual_fraction']) {
      expect(names).toContain(n);
    }
  });

  // Booleans as 0/1 so a spreadsheet can sum them — counting knocking points in a pull
  // is a thing people do.
  it('writes booleans as summable numbers and blanks what is absent', () => {
    const csv = sweepToCsv([{ a: true, b: false, c: null, d: undefined }],
      [['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd']]);
    expect(csv).toBe('a,b,c,d\n1,0,,\n');
  });

  it('quotes a value carrying a comma rather than splitting the row', () => {
    const csv = sweepToCsv([{ note: 'knock, then retard' }], [['note', 'note']]);
    expect(csv).toBe('note\n"knock, then retard"\n');
  });

  it('ends with a newline, because a file without one reads as malformed', () => {
    expect(sweepToCsv(result.points).endsWith('\n')).toBe(true);
  });

  // The flag beside the retard: it is `knockPull > 0`, so it adds no information, but
  // it makes "how many points knocked" a SUM() instead of a threshold the reader has to
  // write themselves. Asserted against the sim's own flag so the two cannot drift.
  it('exports the knock flag as a column a spreadsheet can sum', () => {
    const names = DYNO_COLUMNS.map(([n]) => n);
    expect(names).toContain('knock');
    const at = names.indexOf('knock');
    const cells = sweepToCsv(result.points).trimEnd().split('\n').slice(1).map((r) => r.split(',')[at]);
    expect(cells.every((c) => c === '0' || c === '1')).toBe(true);
    expect(cells.reduce((n, c) => n + Number(c), 0)).toBe(result.points.filter((p) => p.knock).length);
  });

  // A stamp that disagrees with the clock on the wall is one you have to convert before
  // you can use it, and nobody converts it — they misread the file instead. Pinned
  // under a fixed zone so the assertion means the same thing in CI as it does here.
  it('names the file after the engine and the local moment, not UTC', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // 22:05 on the 21st in New York is 02:05 the next day in UTC.
      const name = dynoSheetFilename({ engineName: 'BMW N54', at: new Date('2026-09-22T02:05:00Z') });
      expect(name).toBe('eculab-dyno-bmw-n54-2026-09-21-22-05.csv');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('still produces a usable name for a custom build', () => {
    expect(dynoSheetFilename({ engineName: '???' })).toMatch(/^eculab-dyno-engine-/);
  });
});
