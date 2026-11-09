/**
 * Oversized injectors cost fuelling accuracy where pulses are short (#39).
 *
 * Intent tests, by design: they pin directions and thresholds the spec names (T1–T10 in
 * docs/superpowers/specs/2026-11-06-oversized-injector-cost-design.md), not magnitudes.
 * Every run is a live engine settled at a hot idle with closed loop OFF, so the mixture
 * shows the metering error directly instead of a trim hiding it.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine, runLive } from './ecuHarness.js';

const idx = (cc) => S.INJECTOR_OPTS.findIndex((o) => o.cc === cc);
const E85 = S.OCTANE_OPTS.findIndex((o) => o.stoich < 12);

/**
 * Hot-idle λ against target, closed loop off, scaling matched to the fitted size.
 * @param {{preset?: string, cc: number, build?: object, cal?: object}} o
 */
function idleLambda({ preset, cc, build = {}, cal = {} }) {
  const eng = makeEngine({
    preset,
    build: { injIdx: idx(cc), ecuInjectorCc: cc, ...build },
    cal: { 'fuel.closedLoop': false, ...cal },
  });
  const r = runLive(eng, { seconds: 8 }).rows.at(-1);
  return r.lambda / r.lambdaTarget;
}

/** A 1.4 L four: cylinders smaller than anything shipped (the smallest is about 0.5 L). */
const SMALL_FOUR = {
  ...S.DEFAULT_ENGINE_CONFIG, configuration: 'I4', bore: 76.5, stroke: 75.6, displacementL: 1.39,
};

describe('ballistic threshold grows with flow rating', () => {
  it('is 0.35 ms at the reference size and longer for a bigger injector', () => {
    expect(S.ballisticFromMs(315)).toBe(0.35);
    expect(S.ballisticFromMs(1300)).toBeGreaterThan(S.ballisticFromMs(850));
    expect(S.ballisticFromMs(850)).toBeGreaterThan(S.ballisticFromMs(315));
  });

  it('delivers the reference injector exactly as before', () => {
    expect(S.ballisticOpenMs(0.2)).toBe((0.2 * 0.2) / 0.35);
    expect(S.ballisticOpenMs(0.5)).toBe(0.5);
  });

  it('puts the same opening deeper into the ballistic region on a bigger injector', () => {
    expect(S.ballisticOpenMs(0.4, 1300)).toBeLessThan(0.4);
    expect(S.ballisticOpenMs(0.4, 315)).toBe(0.4);
  });
});

describe('idle cost of oversized injectors (T1–T5)', () => {
  it('T1: leaves 315–850 cc idling as they did on every shipped engine', () => {
    for (const preset of S.ENGINE_PRESETS) {
      const small = idleLambda({ preset: preset.id, cc: 315 });
      const big = idleLambda({ preset: preset.id, cc: 850 });
      expect(Math.abs(big / small - 1), preset.id).toBeLessThan(0.005);
    }
  });

  it('T2: runs 1300 cc carrying idle on a six at least 4% lean untuned', () => {
    for (const preset of ['vq35hr', 'b58-m1']) {
      expect(idleLambda({ preset, cc: 1300 }), preset).toBeGreaterThan(1.04);
    }
  });

  it('T3: brings it back within the trim limit with the minimum pulse set', () => {
    for (const preset of ['vq35hr', 'b58-m1']) {
      const lam = idleLambda({ preset, cc: 1300, cal: { 'injector.minEffPwMs': S.ballisticFromMs(1300) } });
      expect(lam, preset).toBeLessThan(1);
      expect(lam, preset).toBeGreaterThan(1 / 1.25);
    }
  });

  it('T4: cannot be tuned back on a 1.4 L four', () => {
    const lam = idleLambda({
      cc: 1300, build: { engineConfig: SMALL_FOUR },
      cal: { 'injector.minEffPwMs': S.ballisticFromMs(1300) },
    });
    expect(lam).toBeLessThan(1 / 1.25);
  });

  it('T5: costs less on E85, whose pulses are longer', () => {
    const gas = idleLambda({ preset: 'vq35hr', cc: 1300 });
    const e85 = idleLambda({ preset: 'vq35hr', cc: 1300, build: { octaneIdx: E85 } });
    expect(Math.abs(e85 - 1)).toBeLessThan(Math.abs(gas - 1));
  });
});
