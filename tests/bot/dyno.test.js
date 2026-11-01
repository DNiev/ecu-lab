import { describe, expect, it } from 'vitest';

import * as S from '../../src/sim/index.js';
import { DynoInputError, MOD_KEYS, runDyno } from '../../bot/lib/dyno.js';

describe('runDyno', () => {
  it('runs the preset as it ships when no options are given, and pulls once', () => {
    const r = runDyno({ engine: 'vq35hr' });
    const preset = S.presetById('vq35hr');
    expect(r.preset).toBe(preset);
    expect(r.isStock).toBe(true);
    expect(r.modified).toBe(r.stock);
    expect(r.mods).toEqual(preset.mods);
    expect(r.fuel).toBe(S.OCTANE_OPTS[preset.parts.octaneIdx]);
    expect(r.stock).toEqual(S.buildRig({ preset: 'vq35hr' }).pull());
  });

  it('treats options that match the preset as stock', () => {
    const preset = S.presetById('vq35hr');
    const r = runDyno({ engine: 'vq35hr', intake: preset.mods.intake, fuel: S.OCTANE_OPTS[preset.parts.octaneIdx].label });
    expect(r.isStock).toBe(true);
  });

  it('lays given bolt-ons over the preset and keeps the factory tune', () => {
    const preset = S.presetById('vq35hr');
    const r = runDyno({ engine: 'vq35hr', intake: true, headers: true });
    expect(r.isStock).toBe(false);
    expect(r.mods).toEqual({ ...preset.mods, intake: true, headers: true });
    expect(r.modified).toEqual(S.buildRig({ preset: 'vq35hr', build: { mods: r.mods } }).pull());
    expect(r.stock).toEqual(S.buildRig({ preset: 'vq35hr' }).pull());
  });

  it('runs a different fuel by its label', () => {
    const e85 = S.OCTANE_OPTS.findIndex((o) => o.label === 'E85');
    const r = runDyno({ engine: 'b58-m1', fuel: 'E85' });
    expect(r.fuel).toBe(S.OCTANE_OPTS[e85]);
    expect(r.modified).toEqual(S.buildRig({ preset: 'b58-m1', build: { mods: r.mods, octaneIdx: e85 } }).pull());
  });

  it('rejects an unknown engine or fuel with the bad value', () => {
    expect(() => runDyno({ engine: 'sr20det' })).toThrow(DynoInputError);
    try { runDyno({ engine: 'vq35hr', fuel: 'diesel' }); } catch (e) {
      expect(e).toBeInstanceOf(DynoInputError);
      expect(e.value).toBe('diesel');
    }
    expect(() => runDyno({ engine: 'vq35hr', fuel: 'diesel' })).toThrow(DynoInputError);
  });

  it('offers exactly the bolt-ons the sim has labels for', () => {
    for (const k of MOD_KEYS) expect(S.MOD_INFO[k].label).toBeTruthy();
  });
});
