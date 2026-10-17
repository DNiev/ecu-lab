/**
 * Table layouts (src/sim/layouts.js): the three main tables on an engine computer's own
 * breakpoints, read the way that computer reads them, and the switch between layouts.
 */
import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { layoutSwitch } from '../src/ui/state/layoutSwitch.js';
import { makeInitialState } from '../src/ui/state/initialState.js';
import { ACTIONS, reducer } from '../src/ui/state/reducer.js';
import { makeEngine } from './ecuHarness.js';

const GM = S.ECU_LAYOUTS['gm-gen3'];
const GPEC2 = S.ECU_LAYOUTS['chrysler-gpec2'];

describe('layouts', () => {
  it('reads the ECU Lab grid exactly as interp2 does', () => {
    const t = S.DEFAULT_TIMING;
    for (const rpm of [800, 1234, 4500, 7000]) {
      for (const kpa of [20, 33, 70, 96, 150, 210]) {
        expect(S.readTable(t, S.GAME_LAYOUT.timing, rpm, kpa)).toBe(S.interp2(t, rpm, kpa));
      }
    }
  });

  it('carries the GM P01/P59 breakpoints read from the stock images', () => {
    expect(GM.ve.rpm).toHaveLength(20);
    expect(GM.ve.load).toHaveLength(19);
    expect(GM.ve.load[0]).toBe(105);
    expect(GM.ve.load.at(-1)).toBe(15);
    expect(GM.timing.rpm).toHaveLength(25);
    expect(GM.timing.load).toHaveLength(29);
    expect(GM.timing.loadUnit).toBe('g/cyl');
    expect(GM.timing.load[0]).toBeCloseTo(1.2, 9);
    expect(GPEC2.timing.rpm).toHaveLength(17);
    expect(GPEC2.timing.load).toEqual([900, 775, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 125, 100, 75]);
  });

  it('reads a spark table on air per cylinder by the air, not the pressure', () => {
    expect(S.loadFor(GM.timing, { mapKpa: 95, airmassG: 0.62 })).toBe(0.62);
    expect(S.loadFor(GPEC2.timing, { mapKpa: 95, airmassG: 0.62 })).toBeCloseTo(620, 9);
    expect(S.loadFor(GM.ve, { mapKpa: 95, airmassG: 0.62 })).toBe(95);
  });

  it.each(['ls1', 'lm7', 'hemi-392'])('builds %s\'s factory tables on its own computer\'s breakpoints, and a pull on them matches the ECU Lab grid', (id) => {
    const layout = S.layoutById(S.PRESET_ECU_LAYOUT[id]);
    const f = S.factoryCalibrationOn(S.presetById(id), layout);
    expect(f.timing).toHaveLength(layout.timing.load.length);
    expect(f.timing[0]).toHaveLength(layout.timing.rpm.length);
    expect(f.ve).toHaveLength(layout.ve.load.length);
    const eng = makeEngine({ preset: id });
    const game = eng.pull(100);
    const on = S.simulateSweep({
      ...eng.liveCfg(), ve: f.ve, timing: f.timing, afr: f.afr, layout, loadKpa: 100,
      ecu: { cal: eng.cal, hw: eng.hw, cond: S.dynoConditions() },
    });
    expect(Math.abs(on.peakHp - game.peakHp) / game.peakHp).toBeLessThan(0.01);
    expect(on.events.filter((e) => e.type === 'knock')).toEqual([]);
  });

  it('moves a table from one layout to another and back with the interior intact', () => {
    const conv = { airmassAt: (rpm, kpa) => kpa / 100, kpaFor: (rpm, g) => g * 100 };
    const ve = S.computeHardwareVE(S.DEFAULT_ENGINE_CONFIG, S.DEFAULT_MODS);
    const there = S.resampleTable(ve, S.GAME_LAYOUT.ve, GM.ve, conv);
    const back = S.resampleTable(there, GM.ve, S.GAME_LAYOUT.ve, conv);
    // Rows 100, 70 and 40 kPa, columns 1500-6500 rpm: inside both grids.
    for (const ri of [2, 3, 4]) for (const ci of [1, 2, 3, 4, 5, 6]) expect(Math.abs(back[ri][ci] - ve[ri][ci])).toBeLessThan(1.5);
  });
});

describe('the layout switch', () => {
  /** A state on a factory LS1, its tables untouched. */
  const onLs1 = () => {
    const s = makeInitialState();
    return reducer(s, { type: ACTIONS.APPLY_PRESET, preset: S.applyPreset(S.presetById('ls1')) });
  };

  it('regenerates an untouched factory calibration on the new breakpoints, and undo puts the engine\'s own back', () => {
    let s = onLs1();
    s = reducer(s, { type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'cell', row: 2, col: 3 } });
    s = reducer(s, /** @type {any} */ (layoutSwitch(s, 'gm-gen3')));
    expect(S.layoutById(s.tune.layout).id).toBe('gm-gen3');
    expect(s.tune.timing).toHaveLength(29);
    expect(s.tune.ve[0]).toHaveLength(20);
    expect(s.tune.baseline.timing).toEqual(s.tune.timing);
    expect(s.tune.selection).toBeNull();
    expect(s.build.presetId).toBe('ls1');
    s = reducer(s, { type: ACTIONS.UNDO });
    expect(S.layoutById(s.tune.layout).id).toBe('engine');
    expect(s.tune.timing).toHaveLength(16);
  });

  it('carries the player\'s own edits across, cell by cell', () => {
    let s = onLs1();
    const edited = s.tune.timing.map((row) => row.map((v) => v - 2));
    s = reducer(s, { type: ACTIONS.SET_TABLE, table: 'timing', value: edited });
    const own = S.layoutById(s.tune.layout).timing;
    s = reducer(s, /** @type {any} */ (layoutSwitch(s, 'gm-gen3')));
    const back = layoutSwitch(s, 'engine');
    // The cell nearest 4500 rpm and 100 kPa: well inside both grids.
    const near = (xs, x) => xs.reduce((b, v, i) => (Math.abs(v - x) < Math.abs(xs[b] - x) ? i : b), 0);
    const ri = near(own.load, 100); const ci = near(own.rpm, 4500);
    expect(Math.abs(back.timing[ri][ci] - edited[ri][ci])).toBeLessThan(1);
  });

  it('starts a preset on breakpoints sized to that engine', () => {
    let s = onLs1();
    s = reducer(s, /** @type {any} */ (layoutSwitch(s, 'gm-gen3')));
    s = reducer(s, { type: ACTIONS.APPLY_PRESET, preset: S.applyPreset(S.presetById('lm7')) });
    const L = S.layoutById(s.tune.layout);
    expect(L.id).toBe('engine');
    // The LM7's 5600 limiter, 250 past it, and no boost: 100 kPa is the top row.
    expect(L.timing.rpm.at(-1)).toBeGreaterThanOrEqual(5600);
    expect(L.timing.load[0]).toBe(100);
  });

  it('follows the build: more boost re-spans the load axis and carries the tables onto it', () => {
    let s = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset: S.applyPreset(S.presetById('n54')) });
    const before = S.layoutById(s.tune.layout);
    s = reducer(s, { type: ACTIONS.SET_BUILD_FIELD, field: 'boostCurve', value: s.build.boostCurve.map((b) => (b > 0 ? b + 8 : b)) });
    const after = S.layoutById(s.tune.layout);
    expect(after.timing.load[0]).toBeGreaterThan(before.timing.load[0]);
    expect(s.tune.timing).toHaveLength(after.timing.load.length);
    expect(s.tune.baseline.timing).toHaveLength(after.timing.load.length);
  });
});
