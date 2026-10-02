/**
 * The three places the app judges a tune — the TUNE advisor, the dyno pull log and the
 * LIVE engine — have to tell a player the same story, because a real engine only has
 * one. Every test here is a contradiction a player met while tuning: the advisor calling
 * a table clean that knocks on the dyno, a stock engine showing red timing at idle, a
 * pull log sending the player to the AFR table for a fault that is in the injector
 * scaling.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine } from './ecuHarness.js';
import { seedRandomPerTest } from './seededRandom.js';

seedRandomPerTest();

const TURBO_10 = { turboOn: true, boostCurve: [0, 2, 6, 10, 10, 10, 10, 9] };

/** The TUNE advisor, judged against a pull of the same tables — as EcuLab calls it. */
function advise(eng) {
  const pull = eng.pull(100);
  const advice = S.calibrationAdvice({
    ve: eng.tables.ve, veTruth: eng.veTruth, timing: eng.tables.timing, afr: eng.tables.afr,
    derived: eng.derived, fuel: eng.fuel, mods: eng.build.mods, turboOn: eng.build.turboOn,
    boostCurve: eng.build.boostCurve, compressor: eng.compressor, turbine: eng.turbine,
    injectorCc: 315, ecuInjectorCc: 315, mafScalar: 1,
    mafErrorBase: S.mafErrorFactor(eng.build.mods, eng.build.turboOn), pull,
  });
  return { pull, advice };
}

/** Holds the live engine at a steady pedal and returns every step's state. */
function hold(eng, { seconds, throttle, from }) {
  const cfg = eng.liveCfg();
  let s = from;
  const steps = [];
  for (let i = 0; i < Math.round(seconds / 0.05); i++) {
    s = S.liveStep(s, 0.05, { throttle, load: 0 }, cfg);
    steps.push({ rpm: s.rpm, knockNow: s.ecu.knockNow, knockRetard: s.ecu.knockRetard });
  }
  return { state: s, steps };
}

function warmIdle(eng) {
  return hold(eng, { seconds: 10, throttle: 0, from: { ...S.makeLiveState(), cranking: true, coolantC: 90, oilC: 90 } });
}

describe('the advisor and the pull log agree about knock', () => {
  it.each([
    ['a stock N/A engine', {}],
    ['a turbo at 5 psi', { turboOn: true, boostCurve: [0, 0, 3, 5, 5, 5, 5, 5] }],
    ['a turbo at 10 psi', TURBO_10],
  ])('flags knock exactly when the pull knocks, on %s', (_, build) => {
    const { pull, advice } = advise(makeEngine({ build }));
    const pullKnocks = pull.points.some((p) => p.margin < 0);
    expect(advice.overAdvanced.some((c) => c.knockingOnPull)).toBe(pullKnocks);
  });

  it('clears the knock the pull shows when its suggestions are typed in', () => {
    const eng = makeEngine({ build: TURBO_10 });
    expect(eng.pull(100).events.some((e) => e.type === 'knock')).toBe(true);
    for (let i = 0; i < 3; i++) {
      const { advice } = advise(eng);
      for (const c of [...advice.overAdvanced, ...advice.underAdvanced, ...advice.pastMbt]) {
        eng.tables.timing[c.ri][c.ci] = c.suggested;
      }
    }
    const { pull, advice } = advise(eng);
    expect(pull.points.filter((p) => p.margin < 0)).toEqual([]);
    expect(advice.overAdvanced).toEqual([]);
  });
});

describe('the pull log reads like a knock log', () => {
  it('never logs a fraction of the controller step', () => {
    const eng = makeEngine({ build: TURBO_10 });
    const heard = eng.pull(100).points.filter((p) => p.knockPull > 0);
    expect(heard.length).toBeGreaterThan(0);
    for (const p of heard) expect(p.knockPull).toBeGreaterThanOrEqual(eng.cal.ignition.knockStep - 1e-9);
  });

  it('names the load row the engine was on, and how much to take out', () => {
    const knock = makeEngine({ build: TURBO_10 }).pull(100).events.find((e) => e.type === 'knock');
    expect(knock.fix).toMatch(/take about \d+° out of the \d+ kPa row|rows \(the engine ran at \d+ kPa/);
  });
});

describe('the pull log blames the right table for a bad mixture', () => {
  it('sends a lean mixture from wrong injector scaling to the fuelling, not the AFR table', () => {
    const lean = makeEngine({ build: { ecuInjectorCc: 550 } }).pull(100).events.find((e) => e.type === 'lean');
    expect(lean.cause).toMatch(/target is fine/);
    expect(lean.fix).toMatch(/TUNE → INJECTORS/);
    expect(lean.fix).not.toMatch(/richen/i);
  });

  it('sends a lean AFR target to the AFR table', () => {
    const eng = makeEngine();
    eng.tables.afr = eng.tables.afr.map((row, ri) => row.map((v) => (S.LOAD[ri] >= 90 ? 15.8 : v)));
    const lean = eng.pull(100).events.find((e) => e.type === 'lean');
    expect(lean.fix).toMatch(/richen/);
  });

  it('sends a rich mixture from wrong injector scaling to the fuelling, not the AFR table', () => {
    const rich = makeEngine({ build: { ecuInjectorCc: 200 } }).pull(100).events.find((e) => e.type === 'rich');
    expect(rich.fix).toMatch(/fuelling is off, not the target/);
  });
});

describe('the LIVE engine does not cry knock', () => {
  it('idles a stock engine with no knock and no red timing', () => {
    const { steps } = warmIdle(makeEngine());
    const settled = steps.slice(-60);
    expect(settled.some((s) => s.knockNow)).toBe(false);
    expect(Math.max(...settled.map((s) => s.knockRetard))).toBe(0);
  });

  it('holds a stock engine on the rev limiter without overshoot or knock', () => {
    const eng = makeEngine();
    const { steps } = hold(eng, { seconds: 6, throttle: 100, from: warmIdle(eng).state });
    const onLimiter = steps.slice(-40);
    const top = Math.max(...onLimiter.map((s) => s.rpm));
    const bottom = Math.min(...onLimiter.map((s) => s.rpm));
    expect(top - bottom).toBeLessThan(400);
    expect(steps.some((s) => s.knockNow)).toBe(false);
  });
});
