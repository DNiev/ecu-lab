/**
 * Superchargers, held to what real ones do: a positive-displacement blower makes nearly
 * flat boost and a centrifugal one climbs with engine speed; the pulley sets the boost;
 * the crank pays for every psi; a Roots blower heats the charge more than a twin-screw;
 * part throttle bypasses the blower; and spinning one past its rating is flagged with a
 * pulley that fixes it.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine, runLive } from './ecuHarness.js';
import { seedRandomPerTest } from './seededRandom.js';

seedRandomPerTest();

const INTERCOOLED = { ...S.DEFAULT_MODS, intercooler: true };
// Injectors and fuel with room for the extra air, so fuelling never limits what is measured.
const FUELLED = { injIdx: 3, ecuInjectorCc: 650, octaneIdx: 1 };
const pullWith = (blowerId, extra = {}, loadKpa = 100) =>
  makeEngine({ build: { ...FUELLED, mods: INTERCOOLED, blowerId, ...extra } }).pull(loadKpa);
const at = (pull, rpm) => pull.points.find((p) => p.rpm === rpm);

describe('boost follows the kind of compressor', () => {
  it('a positive-displacement blower has boost from low down, where a centrifugal has little', () => {
    const spread = (id) => {
      const boost = [3000, 4000, 5000, 6000].map((r) => at(pullWith(id), r).boostPsi);
      return Math.max(...boost) / Math.min(...boost);
    };
    const centrifugal = spread('p1sc1');
    for (const id of ['m90', 'tvs1900', 'whipple29']) {
      expect(at(pullWith(id), 3000).boostPsi).toBeGreaterThan(4);
      expect(spread(id)).toBeLessThan(centrifugal / 2);
    }
  });

  it('a centrifugal blower builds boost with engine speed', () => {
    const pull = pullWith('p1sc1');
    expect(at(pull, 6000).boostPsi).toBeGreaterThan(3 * at(pull, 3000).boostPsi);
  });

  it('a smaller blower pulley (a higher ratio) makes more boost', () => {
    for (const id of ['m90', 'p1sc1']) {
      const base = S.BLOWER_OPTS.find((b) => b.id === id).defaultRatio;
      const lo = at(pullWith(id, { blowerRatio: base * 0.9 }), 5000).boostPsi;
      const hi = at(pullWith(id, { blowerRatio: base * 1.1 }), 5000).boostPsi;
      expect(hi).toBeGreaterThan(lo);
    }
  });
});

describe('the crank pays for the boost', () => {
  it('turning the blower costs power whenever it makes boost, more as boost rises', () => {
    const pull = pullWith('tvs1900');
    for (const p of pull.points.filter((x) => x.boostPsi > 1)) expect(p.blowerHp).toBeGreaterThan(0);
    const lo = at(pullWith('tvs1900', { blowerRatio: 1.2 }), 5000);
    const hi = at(pullWith('tvs1900', { blowerRatio: 1.7 }), 5000);
    expect(hi.blowerHp).toBeGreaterThan(lo.blowerHp);
  });

  it('drive power is the compression work over the efficiency, plus drive losses', () => {
    const blower = S.BLOWER_OPTS.find((b) => b.id === 'p1sc1');
    const flow = 0.45;
    const pr = 1.68;
    const eta = 0.7;
    const expected = flow * S.COEFF.CP_AIR * 298 * (Math.pow(pr, S.GAMMA_EXP) - 1) / eta;
    const w = S.blowerDriveW(flow, pr, eta, 298, blower, 0);
    expect(Math.abs(w / (expected / S.COEFF.BLOWER_GEAR_DRIVE_EFF) - 1)).toBeLessThan(1e-9);
    // About 10 psi at ~0.45 kg/s: roughly 45-50 hp, in the 40-60 hp quoted for
    // centrifugal kits at that boost on a V8.
    expect(w / 745.7).toBeGreaterThan(40);
    expect(w / 745.7).toBeLessThan(60);
  });

  it('part throttle opens the bypass: no boost and almost nothing to pay', () => {
    const cruise = at(pullWith('m90', {}, 70), 3000);
    expect(cruise.boostPsi).toBe(0);
    expect(cruise.blowerHp).toBeLessThan(3);
  });
});

describe('efficiency sets the charge heat', () => {
  it('ranks the blowers as their makers publish them: Roots below TVS below twin-screw', () => {
    const eff = (id, pr) => S.displacementEfficiency(S.BLOWER_OPTS.find((b) => b.id === id), pr, 0.7);
    expect(eff('m90', 1.5)).toBeLessThan(eff('tvs1900', 1.5));
    expect(eff('tvs1900', 1.5)).toBeLessThan(eff('whipple29', 1.5));
    expect(eff('m90', 1.4)).toBeCloseTo(0.55, 2);
  });

  it('a less efficient compressor delivers hotter air at the same boost', () => {
    const cool = S.chargeTempK(8, false, undefined, 0.78);
    const hot = S.chargeTempK(8, false, undefined, 0.5);
    expect(hot).toBeGreaterThan(cool + 15);
    // The turbo path is exactly what it was.
    expect(S.chargeTempK(8, false)).toBe(S.chargeTempK(8, false, undefined, undefined));
  });
});

describe('a real kit on a real engine', () => {
  it('about 7 psi, intercooled, adds 35-50% at the crank, as published kit results do', () => {
    // ProCharger's own figures: an LS3 from 430 to ~600 hp at 7 psi (+40%), a Coyote from
    // 435 to ~627 hp at 8 psi (+44%); independent dynos of similar kits span ~35-50%.
    const na = at(makeEngine({ build: FUELLED }).pull(100), 6500);
    const sc = at(pullWith('p1sc1'), 6500);
    expect(sc.boostPsi).toBeGreaterThan(5.5);
    expect(sc.boostPsi).toBeLessThan(8.5);
    const gain = sc.hp / na.hp - 1;
    expect(gain).toBeGreaterThan(0.35);
    expect(gain).toBeLessThan(0.5);
  });

  it('a turbo and a supercharger are not fitted together: the turbo wins', () => {
    expect(S.blowerOf({ turboOn: true, blowerId: 'm90' })).toBeNull();
    expect(S.blowerOf({ turboOn: false, blowerId: 'm90' })?.id).toBe('m90');
  });
});

describe('the pull log names an over-spun blower and how to fix it', () => {
  it('flags a pulley that spins the blower past its rating, and its suggested ratio clears it', () => {
    const over = pullWith('m90', { blowerRatio: 2.6 });
    const ev = over.events.find((e) => e.type === 'blower');
    expect(ev).toBeDefined();
    expect(ev.fix).toMatch(/BUILD → INDUCTION/);
    const safe = Number(ev.fix.match(/about ([\d.]+):1/)[1]);
    expect(pullWith('m90', { blowerRatio: safe }).events.some((e) => e.type === 'blower')).toBe(false);
  });

  it('the default pulleys stay inside every blower\'s rating', () => {
    for (const b of S.BLOWER_OPTS) expect(pullWith(b.id).events.some((e) => e.type === 'blower')).toBe(false);
  });
});

describe('on the LIVE engine', () => {
  it('a supercharger has no lag: held at speed, its boost is there the moment the throttle is open', () => {
    // A brake holds the engine near 4,000 RPM, so what is measured is the compressor, not
    // the engine revving up. A belt-driven blower has no wheel to spool: the step the
    // throttle reaches wide open, the boost is already what it will settle at.
    const cruiseThenFloor = (t) => (t < 4 ? 30 : 100);
    const { rows } = runLive(makeEngine({ build: { ...FUELLED, mods: INTERCOOLED, blowerId: 'tvs1900' } }), {
      seconds: 8, pedal: cruiseThenFloor, coolantC: 90, holdRpm: 4000,
    });
    const open = rows.findIndex((r) => r.throttle >= 99);
    expect(rows[open - 3].boost).toBe(0);
    expect(rows[open].boost).toBeGreaterThan(0.9 * rows[open + 20].boost);
  });
});
