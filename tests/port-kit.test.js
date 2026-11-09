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
const portKit = { injectorCc: 1300, ecuInjectorCc: 1300 };

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
    const pull = eng.pull(30);
    expect(pull.events.some((e) => e.type === 'ballistic')).toBe(true);
    // The event is the port bank's: the direct injectors alone are not in their ballistic
    // region at this load, so a bare engine reports nothing and the port message names the kit.
    expect(pull.points.some((p) => p.portBallistic)).toBe(true);
    expect(pull.events.find((e) => e.type === 'ballistic').msg).toMatch(/^Port injectors/);
    expect(b58().pull(30).events.some((e) => e.type === 'ballistic')).toBe(false);
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

  it('reports a saturated port kit in the pull log with the port bank\'s own duty', () => {
    // Handed all the fuel, the 315 cc kit is the injector that runs out, while the direct
    // bank sits nearly idle. The event must judge the kit, not the bank that is not busy.
    const small = { injIdx: idx(315), ecuInjectorCc: 315 };
    const pull = b58({ portKit: small }, { 'injector.portShare': flatShare(100) }).pull(100);
    const ev = pull.events.find((e) => e.type === 'fuel');
    expect(ev.msg).toMatch(/^Port injectors maxed/);
    const peakPort = Math.max(...pull.points.filter((p) => p.fuelLimited).map((p) => p.portDuty ?? 0));
    expect(ev.msg).toContain(`up to ${peakPort}% duty`);
    expect(ev.cause).toMatch(/port kit/);
    // The direct bank is idling here, so the cause says the problem is the share, not the direct injectors.
    expect(ev.cause).toContain('The direct injectors are not the ones out of room');
    expect(ev.fix).toContain('fit a larger port injection kit (then enter its flow rate on TUNE → INJECTORS)');
  });

  it('keeps the injector wording exactly as it was when there is no kit and the injectors run out', () => {
    // A 315 cc direct set on a boosted B58 saturates. Without a kit nothing about the
    // events may change: the strings below are what the parent of the port kit work printed.
    const eng = b58({ injIdx: idx(315), ecuInjectorCc: 315 });
    const pull = eng.pull(100);
    expect(pull.points.some((p) => p.fuelLimited)).toBe(true);
    expect(pull.points.every((p) => !('portDuty' in p))).toBe(true);

    const fuel = pull.events.find((e) => e.type === 'fuel');
    expect(fuel.msg).toMatch(/^Injectors maxed across \d+–\d+ RPM \(up to \d+% duty\) — mixture leaned to [\d.]+:1$/);
    expect(fuel.cause).toMatch(/^Required pulse width \([\d.]+ ms\) exceeds 90% of the [\d.]+ ms available per engine cycle at \d+ RPM, so the 315cc \(stock\) injectors physically cannot deliver the commanded fuel\.$/);
    expect(fuel.fix).toBe('On BUILD → FUEL SYSTEM, fit larger injectors — size them to run about 80–85% duty at peak — then enter their flow rate on TUNE → INJECTORS. Or lower the boost target in this range on BUILD → INDUCTION so demand fits the injectors you have.');

    const prot = pull.events.find((e) => e.type === 'dutyprot');
    expect(prot.msg).toMatch(/^Injector duty protection cut boost across \d+–\d+ RPM$/);
    expect(prot.cause).toMatch(/^Duty passed \d+%\. Beyond it the injectors cannot add fuel as boost adds air\.$/);
    expect(prot.fix).toBe('On BUILD → FUEL SYSTEM, fit larger injectors — sized to run about 80–85% duty at peak — and enter their flow rate on TUNE → INJECTORS. Or lower the boost target on BUILD → INDUCTION.');
  });

  it('names the port kit in the duty protection event when the kit tripped it', () => {
    const small = { injIdx: idx(315), ecuInjectorCc: 315 };
    const pull = b58({ portKit: small }, { 'injector.portShare': flatShare(100) }).pull(100);
    const ev = pull.events.find((e) => e.type === 'dutyprot');
    expect(ev.msg).toMatch(/^Port kit duty protection cut boost across/);
    expect(ev.cause).toMatch(/^Port kit duty passed \d+%/);
    expect(ev.cause).toMatch(/port share/);
    expect(ev.fix).toMatch(/larger port injection kit/);
    expect(ev.fix).toMatch(/port share/);
    expect(ev.fix).toMatch(/TUNE → INJECTORS/);
  });

  it('keeps the plain duty protection wording when the direct bank tripped it, even with a kit fitted', () => {
    // Small direct injectors, a kit that is sent nothing: the direct bank is the one out of room.
    const eng = b58({ portKit: kit, injIdx: idx(315), ecuInjectorCc: 315 }, { 'injector.portShare': flatShare(0) });
    const ev = eng.pull(100).events.find((e) => e.type === 'dutyprot');
    expect(ev.msg).toMatch(/^Injector duty protection cut boost across/);
    expect(ev.cause).toMatch(/^Duty passed \d+%\. Beyond it the injectors cannot/);
    expect(ev.fix).toMatch(/^On BUILD → FUEL SYSTEM, fit larger injectors/);
  });

  it('previews the busier bank\'s duty, so TUNE shows a saturated kit', () => {
    const small = { injIdx: idx(315), ecuInjectorCc: 315 };
    const eng = b58({ portKit: small }, { 'injector.portShare': flatShare(100) });
    const preview = eng.dutyPreview(5000);
    expect(preview).toBe(at(eng.pull(100), 5000).portDuty);
    expect(preview).toBeGreaterThan(at(eng.pull(100), 5000).duty);
  });

  it('pins the port bank fields: present with a share, absent without one', () => {
    const withShare = at(b58({ portKit: kit }, { 'injector.portShare': flatShare(50) }).pull(100), 4000);
    for (const f of ['portPw', 'portDuty', 'portOpen', 'portShare']) expect(withShare).toHaveProperty(f);
    expect(withShare.portShare).toBeCloseTo(0.5, 2);
    expect(withShare.portPw).toBeGreaterThan(0);
    const none = at(b58({ portKit: kit }, { 'injector.portShare': flatShare(0) }).pull(100), 4000);
    for (const f of ['portPw', 'portDuty', 'portOpen', 'portBallistic', 'portShare']) expect(none).not.toHaveProperty(f);
    expect(at(b58().pull(100), 4000)).not.toHaveProperty('portShare');
  });

  it('conserves fuel: a kit told its real size delivers what the bare engine does', () => {
    // Away from the ballistic region and from saturation, splitting the fuel between two
    // banks must not add or lose any: the ECU meters the same total for the same air.
    const bare = at(b58().pull(100), 4000);
    const split = at(b58({ portKit: kit }, { 'injector.portShare': flatShare(50) }).pull(100), 4000);
    expect(split.portBallistic).toBe(false);
    expect(split.ballistic).toBe(false);
    expect(split.portDuty).toBeLessThan(90);
    expect(split.fuelMass).toBeCloseTo(bare.fuelMass, 0);
    expect(Math.abs(split.fuelMass / bare.fuelMass - 1)).toBeLessThan(0.02);
  });

  it('logs both banks on the live engine, and the kit wets the port walls', () => {
    expect(S.LOG_CHANNELS.some((c) => c.id === 'portDuty')).toBe(true);
    expect(S.LOG_CHANNELS.some((c) => c.id === 'portPw')).toBe(true);
    const eng = b58({ portKit: kit }, { 'injector.portShare': flatShare(60) });
    expect(runLive(eng, { seconds: 4 }).rows.at(-1).portPw).toBeGreaterThan(0);
    expect(runLive(b58(), { seconds: 4 }).rows.at(-1).portPw).toBe(0);
    // More fuel on the walls means less of a tip-in's fuel reaches the cylinder at first.
    const tip = (e) => Math.min(...runLive(e, { seconds: 1, from: runLive(e, { seconds: 4 }).state, pedal: () => 60 }).rows.map((r) => r.filmFactor));
    expect(tip(eng)).toBeLessThan(tip(b58()));
    // T6's last check: on the factory staging a kit sends nothing at idle.
    expect(runLive(b58({ portKit: kit }), { seconds: 8 }).rows.at(-1).portPw).toBe(0);
  });

  it('applies the duty protection to the port bank on the live engine', () => {
    const small = { injIdx: idx(315), ecuInjectorCc: 315 };
    const eng = b58({ portKit: small }, { 'injector.portShare': flatShare(100) });
    const rows = runLive(eng, { seconds: 6, pedal: () => 100, holdRpm: 5500 }).rows;
    expect(rows.some((r) => r.portDuty > 92)).toBe(true);
    expect(rows.some((r) => (r.protect ?? []).includes('duty'))).toBe(true);
  });
});

describe('a kit only exists on a direct-injected engine', () => {
  it('leaves a port engine untouched even if a kit is forced into its ECU hardware', () => {
    const eng = makeEngine({ cal: { 'injector.portShare': flatShare(60) } });
    expect(eng.derived.injection).toBe('port');
    const cfg = eng.liveCfg();
    const sweep = (hw) => S.simulateSweep({ ...cfg, loadKpa: 100, ecu: { ...cfg.ecu, hw } });
    const plain = sweep(cfg.ecu.hw);
    const forced = sweep({ ...cfg.ecu.hw, portKit });
    expect(forced.points).toEqual(plain.points);
    expect(forced.points.some((p) => 'portShare' in p)).toBe(false);
  });
});
