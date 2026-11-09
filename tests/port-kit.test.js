/**
 * A port injection kit on a direct-injected engine (#39, targets T6–T10): staged by the
 * ECU so the direct injectors carry idle and light load, and fuelling the top end.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { at, makeEngine, runLive } from './ecuHarness.js';

const idx = (cc) => S.INJECTOR_OPTS.findIndex((o) => o.cc === cc);
const direct = { ...S.DEFAULT_ENGINE_CONFIG, injection: 'direct' };
const port = { ...S.DEFAULT_ENGINE_CONFIG, injection: 'port' };
const kit = { injIdx: idx(1300), ecuInjectorCc: 1300 };

describe('port kit hardware', () => {
  it('exists only on a direct-injected engine', () => {
    expect(S.portKitOf({ engineConfig: direct, portKit: kit })).toEqual({ injectorCc: 1300, ecuInjectorCc: 1300 });
    expect(S.portKitOf({ engineConfig: port, portKit: kit })).toBeNull();
    expect(S.portKitOf({ engineConfig: direct, portKit: null })).toBeNull();
    expect(S.portKitOf({ engineConfig: direct })).toBeNull();
    expect(S.ecuHardwareOf({ engineConfig: direct, octaneIdx: 0, portKit: kit }).portKit).toEqual({ injectorCc: 1300, ecuInjectorCc: 1300 });
  });
});

describe('factory staging', () => {
  it('keeps the port set off up to atmospheric, then brings it in with boost', () => {
    expect(S.factoryPortSharePct(30)).toBe(0);
    expect(S.factoryPortSharePct(100)).toBe(0);
    expect(S.factoryPortSharePct(150)).toBeGreaterThan(0);
    expect(S.factoryPortSharePct(200)).toBe(50);
    expect(S.factoryPortSharePct(300)).toBe(50);
  });

  it('ships in the default calibration and is read from it', () => {
    const cal = S.defaultEcuCalibration({});
    expect(cal.injector.portShare.z.flat().every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(S.portShareAt(cal, 3000, 40)).toBe(0);
    expect(S.portShareAt(cal, 3000, 200)).toBeCloseTo(0.5, 2);
  });

  it('falls back to factory staging on a calibration saved before the table existed', () => {
    const cal = S.defaultEcuCalibration({});
    const { portShare: _portShare, ...injector } = cal.injector;
    expect(S.portShareAt({ ...cal, injector }, 3000, 200)).toBeCloseTo(0.5, 2);
  });
});

/** Every cell of the port share table set to `pct`. */
const flatShare = (pct) => {
  const t = S.defaultEcuCalibration({}).injector.portShare;
  return S.map2(t.x, t.y, () => pct);
};

describe('metering through a staged kit (T6–T9)', () => {
  const b58 = (patch = {}, cal = {}) => makeEngine({ preset: 'b58-m1', build: patch, cal });

  it('T6: idles exactly like the same engine with no kit, on the factory staging', () => {
    const bare = runLive(b58(), { seconds: 8 }).rows.at(-1);
    const kitted = runLive(b58({ portKit: kit }), { seconds: 8 }).rows.at(-1);
    expect(kitted.lambda).toBe(bare.lambda);
    expect(kitted.pw).toBe(bare.pw);
  });

  it('T7: pays the ballistic cost when the port share is raised at idle', () => {
    const eng = b58({ portKit: kit }, { 'injector.portShare': flatShare(50) });
    expect(eng.pull(30).events.some((e) => e.type === 'ballistic')).toBe(true);
  });

  it('T8: gives back charge cooling and knock margin as port share rises', () => {
    // 4000 rpm is boosted on the B58 at pull(100) (about 12.7 psi), so the charge cooling is
    // doing real work there and the swing is measurable.
    const rpm = 4000;
    const none = at(b58({ portKit: kit }, { 'injector.portShare': flatShare(0) }).pull(100), rpm);
    const most = at(b58({ portKit: kit }, { 'injector.portShare': flatShare(80) }).pull(100), rpm);
    expect(most.endGasK).toBeGreaterThan(none.endGasK);
    expect(most.margin).toBeLessThan(none.margin);
  });

  it('T9: trips the duty protection when an undersized kit saturates', () => {
    // A 315 cc kit carrying 90% of the fuel peaks at about 87% duty, under the 92% limit;
    // handing it all of the fuel (100%) is what saturates it on the B58's pull.
    const small = { injIdx: idx(315), ecuInjectorCc: 315 };
    const pull = b58({ portKit: small }, { 'injector.portShare': flatShare(100) }).pull(100);
    expect(pull.points.some((p) => (p.protect ?? []).includes('duty'))).toBe(true);
  });
});
