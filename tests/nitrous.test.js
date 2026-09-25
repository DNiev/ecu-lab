/**
 * Nitrous, held to its chemistry, the published numbers racers work from, and what it does
 * on a real car: the bottle's pressure follows its temperature, a shot flows what its jets
 * are rated for, the gain tracks the shot, the knock limit drops about 2° per 50 hp, a
 * wet kit's fuel does not follow the bottle, a dry kit without fuel runs lean and is cut,
 * and nothing sprays outside the controller's window.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine, runLive } from './ecuHarness.js';
import { seedRandomPerTest } from './seededRandom.js';

seedRandomPerTest();

const F = (f) => ((f - 32) * 5) / 9 + 273.15;
const FUELLED = { injIdx: 3, ecuInjectorCc: 650, octaneIdx: 1 };
const kit = (shotHp, extra = {}) => ({ kit: 'wet', shotHp, heater: true, bottleLb: 10, ...extra });
const pull = (nitrous, opts = {}) => makeEngine({ build: { ...FUELLED, nitrous }, ...opts }).pull(opts.loadKpa ?? 100);
const at = (p, rpm) => p.points.find((x) => x.rpm === rpm);
const lbMin = (kgS) => (kgS * 60) / 0.45359237;

describe('the chemistry', () => {
  it('carries 36.4% oxygen by mass, worth 1.57 times its mass in air', () => {
    expect(S.N2O.o2MassFrac).toBeCloseTo(0.3636, 3);
    expect(S.N2O_AIR_EQUIV).toBeCloseTo(1.571, 2);
  });

  it('releases 1.86 MJ/kg coming apart (−82 kJ/mol)', () => {
    expect(S.N2O.decompJPerKg / 1e6).toBeCloseTo(1.864, 2);
  });
});

describe('the bottle', () => {
  it('holds the vapour pressure the racing charts give for its temperature', () => {
    // Published bottle charts: ~450 psi at 32 °F, ~590 at 50 °F, 762 at 70 °F, 921 at 85 °F.
    for (const [f, psi] of [[32, 450], [50, 590], [70, 762], [85, 921]]) {
      expect(Math.abs(S.bottlePressurePsi(F(f)) / psi - 1)).toBeLessThan(0.03);
    }
  });

  it('loses pressure through a pass, far more as it empties, and a heater is too slow to stop it mid-pass', () => {
    // The liquid that boils to refill the space the spray left cools what remains; with
    // less liquid left to share that cooling, the same pass costs more pressure.
    const drop = (p) => {
      const psi = p.points.filter((x) => x.nitrousLbMin > 0).map((x) => x.bottlePsi);
      return psi[0] - psi.at(-1);
    };
    const full = pull(kit(150, { heater: false }), { bottleK: F(85) });
    const low = pull(kit(150, { heater: false, bottleLb: 3 }), { bottleK: F(85) });
    const heated = pull(kit(150));
    expect(drop(full)).toBeGreaterThan(15);
    expect(drop(low)).toBeGreaterThan(2 * drop(full));
    // A heater sets the pressure each pass starts at and brings it back between passes;
    // through the wall, it cannot keep up with the boiling within one.
    expect(Math.abs(drop(heated) / drop(full) - 1)).toBeLessThan(0.2);
  });

  it('matches the saturated properties NIST publishes', () => {
    // Liquid 907 kg/m³ at 0 °C and 787 at 20 °C; vapour about 160 at 20 °C.
    expect(S.liquidDensity(F(32))).toBeCloseTo(907, -1);
    expect(S.liquidDensity(F(68))).toBeCloseTo(787, -1);
    expect(S.vapourDensity(F(68))).toBeCloseTo(160, -1);
  });

  it('a heater brings a cold bottle to pressure in the 15-30 minutes kit makers quote', () => {
    let b = { massKg: 10 * 0.45359237, tempK: F(60) };
    let s = 0;
    while (S.bottlePressurePsi(b.tempK) < 900 && s < 3600) {
      b = S.stepBottle(b, 0, 1, { heater: true, setK: F(85), ambientK: F(60) });
      s += 1;
    }
    expect(s / 60).toBeGreaterThan(15);
    expect(s / 60).toBeLessThan(30);
  });
});

describe('the jets', () => {
  it('a 100 shot flows the 5-6 lb/min racers budget for it', () => {
    const flow = lbMin(S.nitrousFlowKgS({ shotHp: 100, bottlePsi: 950, bottleK: F(85), manifoldPsi: 0 }));
    expect(flow).toBeGreaterThan(4.8);
    expect(flow).toBeLessThan(6);
  });

  it('a cold bottle flows less, and a wet kit\'s fuel does not follow it: the kit\'s mixture goes rich', () => {
    const cold = at(pull(kit(100), { bottleK: F(55) }), 4500);
    const warm = at(pull(kit(100)), 4500);
    expect(cold.nitrousLbMin).toBeLessThan(warm.nitrousLbMin * 0.92);
    expect(cold.nitrousFuelLbMin).toBeCloseTo(warm.nitrousFuelLbMin, 5);
    // The kit's own nitrous-to-fuel mixture, which is what its jets set.
    const kitLambda = (x) => (x.nitrousLbMin * S.N2O_AIR_EQUIV) / (x.nitrousFuelLbMin * S.tankFuel({ octaneIdx: 1 }).stoich);
    expect(kitLambda(cold)).toBeLessThan(kitLambda(warm) * 0.92);
    expect(pull(kit(100), { bottleK: F(55) }).events.some((e) => e.type === 'bottle')).toBe(true);
  });
});

describe('what it does to the engine', () => {
  it('adds power in step with the shot: 1.0-1.35 × the rating at the crank', () => {
    // 1.0-1.35 rather than 1.0: the model makes 10-15% more power per unit of oxygen than
    // real engines (docs/accuracy.md, approximation 1), and nitrous is oxygen.
    const base = at(pull(null), 4500).hp;
    const gains = [50, 100, 150].map((shot) => (at(pull(kit(shot)), 4500).hp - base) / S.DRIVETRAIN_EFF / shot);
    for (const g of gains) {
      expect(g).toBeGreaterThan(1.0);
      expect(g).toBeLessThan(1.35);
    }
    expect(Math.max(...gains) - Math.min(...gains)).toBeLessThan(0.1);
  });

  it('drops the knock limit about 2° per 50 hp of shot, as the rule of thumb says', () => {
    for (const shot of [100, 150]) {
      const p = pull(kit(shot), { cal: { 'nitrous.retardDeg': 0 } });
      const worst = Math.max(...p.points.filter((x) => x.nitrousLbMin > 0).map((x) => x.knockPull));
      const perFifty = worst / (shot / 50);
      expect(perFifty).toBeGreaterThan(1.5);
      expect(perFifty).toBeLessThan(3.5);
    }
  });

  it('retards spark only while spraying', () => {
    const p = pull(kit(100), { cal: { 'nitrous.retardDeg': 6 } });
    const off = pull(kit(100), { nitrousArmed: false });
    expect(at(p, 2500).commandedTiming).toBe(at(off, 2500).commandedTiming);
    expect(at(off, 4500).commandedTiming - at(p, 4500).commandedTiming).toBeCloseTo(6, 5);
  });
});

describe('the controller', () => {
  it('sprays nothing below the window, disarmed, or at part throttle — and then the engine is exactly the base engine', () => {
    const base = pull(null);
    const disarmed = pull(kit(100), { nitrousArmed: false });
    expect(disarmed.points.map((x) => x.hp)).toEqual(base.points.map((x) => x.hp));
    const armed = pull(kit(100));
    expect(at(armed, 2500).nitrousLbMin ?? 0).toBe(0);
    expect(at(armed, 2500).hp).toBe(at(base, 2500).hp);
    const partThrottle = pull(kit(100), { loadKpa: 70 });
    expect(partThrottle.points.every((x) => !(x.nitrousLbMin > 0))).toBe(true);
  });

  it('ramps a progressive shot in from its start percentage', () => {
    const p = pull(kit(100), { cal: { 'nitrous.startPct': 30, 'nitrous.rampS': 2 } });
    const first = at(p, 3000).nitrousLbMin;
    const full = at(p, 4500).nitrousLbMin;
    expect(first / full).toBeGreaterThan(0.25);
    expect(first / full).toBeLessThan(0.35);
    expect(at(p, 4000).nitrousLbMin / full).toBeGreaterThan(0.99);
  });

  it('a dry kit with no fuel added runs lean, and the lean cut shuts the nitrous off', () => {
    const p = pull(kit(100, { kit: 'dry' }), { cal: { 'nitrous.dryFuelPct': 0 } });
    const ev = p.events.find((e) => e.type === 'nitrouslean');
    expect(ev).toBeDefined();
    expect(ev.fix).toMatch(/TUNE → NITROUS/);
    expect(p.points.filter((x) => x.rpm >= 3000).every((x) => !(x.nitrousLbMin > 0))).toBe(true);
  });

  it('flags a big shot sprayed too low in the rev range', () => {
    const p = pull(kit(150), { cal: { 'nitrous.minRpm': 2000 } });
    expect(p.events.some((e) => e.type === 'nitrouswindow')).toBe(true);
  });
});

describe('fuel while spraying', () => {
  // A speed-density ECU works out its air from MAP and the VE table, so it cannot see the
  // air the nitrous vapour displaced, and a wet kit adds its own fuel on top: the engine
  // runs richer than either is jetted for. The cure is the ECU's fuel while spraying, not
  // VE or the AFR table, which are right the moment the nitrous stops. On the stock
  // engine, as it comes, with its own injectors and fuel.
  const stock = (nitrous, opts = {}) => makeEngine({ build: { nitrous }, ...opts }).pull(100);
  const rich = () => stock(kit(150));

  it('names the nitrous as the cause of a rich spray, sends the player to TUNE → NITROUS, and not to VE', () => {
    const ev = rich().events.find((e) => e.type === 'rich');
    expect(ev).toBeDefined();
    expect(ev.cause).toMatch(/nitrous/);
    expect(ev.fix).toMatch(/TUNE → NITROUS, lower Fuel correction while spraying by about \d+ points/);
    expect(ev.fix).not.toMatch(/AIRFLOW|INJECTORS/);
  });

  it('following that advice once clears it across the whole spraying range, and leaves the engine off the spray alone', () => {
    const before = rich();
    const pct = Number(before.events.find((e) => e.type === 'rich').fix.match(/by about (\d+) points/)[1]);
    const after = stock(kit(150), { cal: { 'nitrous.fuelTrimPct': -pct } });
    expect(after.events.some((e) => e.type === 'rich' || e.type === 'lean')).toBe(false);
    const spray = after.points.filter((x) => x.nitrousLbMin > 0);
    expect(Math.min(...spray.map((x) => x.lambda))).toBeGreaterThan(0.76);
    // Never leaner on the spray than the engine's own tune runs without it.
    for (const x of spray) expect(x.lambda).toBeLessThanOrEqual(x.afrCommanded / 14.7 + 0.005);
    expect(at(after, 2500).hp).toBe(at(before, 2500).hp);
  });

  it('closed loop stands down while spraying rather than trimming the nitrous toward the base target', () => {
    const eng = makeEngine({ build: { ...FUELLED, nitrous: kit(100) }, cal: { 'nitrous.minTpsPct': 50 } });
    const { rows } = runLive(eng, { seconds: 12, pedal: (t) => (t > 3 ? 55 : 0), coolantC: 90, aux: { nitrous: true }, holdRpm: 4000 });
    const spraying = rows.filter((r) => r.nitrous > 0);
    expect(spraying.length).toBeGreaterThan(50);
    // Part throttle, inside the closed-loop region: the trims would otherwise act here, and
    // did — the short-term trim pinned at -25% and leaned the spray to λ 0.90.
    expect(Math.max(...spraying.map((r) => r.map))).toBeLessThan(80);
    for (const r of spraying.slice(40)) {
      expect(Math.abs(r.stft)).toBeLessThan(1);
      expect(r.ltft).toBe(0);
      expect(r.lambda).toBeLessThan(0.85);
    }
  });

  it('the pump feeds the kit too: a weak one sags the rail and a wet kit\'s fuel falls with it', () => {
    const healthy = pull(kit(200));
    const weak = pull(kit(200), { faults: { pump: 'weak' } });
    const sprayWeak = weak.points.filter((x) => x.nitrousLbMin > 0);
    const top = (p) => Math.max(...p.points.filter((x) => x.nitrousLbMin > 0).map((x) => x.lambda));
    expect(sprayWeak.some((x) => x.fuelStarved)).toBe(true);
    expect(Math.min(...sprayWeak.map((x) => x.nitrousFuelLbMin))).toBeLessThan(at(healthy, 6000).nitrousFuelLbMin);
    expect(top(weak)).toBeGreaterThan(top(healthy) + 0.05);
  });

  it('a naturally aspirated engine\'s exhaust-heat protection talks about its valves and cat, not a turbine', () => {
    const ev = rich().events.find((e) => e.type === 'egtprot');
    expect(ev).toBeDefined();
    expect(ev.cause).not.toMatch(/turbine/);
  });
});

describe('the pull log sends the player to screens that exist', () => {
  it('every nitrous event names BUILD → INDUCTION / FUEL SYSTEM or TUNE → NITROUS / INJECTORS', () => {
    const cases = [
      pull(kit(150), { cal: { 'nitrous.retardDeg': 0 } }),
      pull(kit(100), { bottleK: F(55) }),
      pull(kit(100, { kit: 'dry' }), { cal: { 'nitrous.dryFuelPct': 0 } }),
    ];
    for (const p of cases) {
      for (const e of p.events.filter((x) => /nitrous|bottle/.test(x.type))) {
        for (const m of e.fix.matchAll(/\b(BUILD|TUNE) → ([A-Z][A-Z ]*[A-Z])/g)) {
          expect(['BUILD → INDUCTION', 'BUILD → FUEL SYSTEM', 'TUNE → NITROUS', 'TUNE → INJECTORS']).toContain(`${m[1]} → ${m[2]}`);
        }
      }
    }
  });
});

describe('on the LIVE engine', () => {
  const floorIt = (t) => (t > 3 ? 100 : 0);
  const live = (nitrous, aux, seconds = 10) => runLive(makeEngine({ build: { ...FUELLED, nitrous } }), { seconds, pedal: floorIt, coolantC: 90, aux, holdRpm: 4500 });

  it('sprays only when armed, inside the window, and the bottle loses pressure as it does', () => {
    const armed = live(kit(100, { heater: false, bottleLb: 3 }), { nitrous: true });
    const spraying = armed.rows.filter((r) => r.nitrous > 0);
    expect(spraying.length).toBeGreaterThan(20);
    for (const r of spraying) expect(r.rpm).toBeGreaterThanOrEqual(3000);
    expect(spraying.at(-1).bottle).toBeLessThan(spraying[0].bottle - 20);
    const disarmed = live(kit(100), { nitrous: false });
    expect(disarmed.rows.every((r) => r.nitrous === 0)).toBe(true);
  });

  it('an empty bottle stops the spray and reads empty rather than a pressure', () => {
    const { rows } = live(kit(100, { bottleLb: 0.3 }), { nitrous: true });
    const sprayed = rows.findIndex((r) => r.nitrous > 0);
    expect(sprayed).toBeGreaterThan(-1);
    const after = rows.slice(sprayed).filter((r) => r.nitrous === 0 && r.pedal > 90);
    expect(after.length).toBeGreaterThan(10);
    expect(rows.at(-1).bottle).toBe(0);
  });

  it('a lean cut holds the nitrous off until the driver lifts', () => {
    const eng = makeEngine({ build: { ...FUELLED, nitrous: kit(100, { kit: 'dry' }) }, cal: { 'nitrous.dryFuelPct': 0 } });
    const { rows } = runLive(eng, { seconds: 10, pedal: floorIt, coolantC: 90, aux: { nitrous: true }, holdRpm: 4500 });
    expect(rows.some((r) => r.protect.includes('nitrous lean'))).toBe(true);
    const cut = rows.findIndex((r) => r.protect.includes('nitrous lean'));
    expect(rows.slice(cut + 2).every((r) => r.nitrous === 0)).toBe(true);
  });
});

describe('superchargers and nitrous on random engines', () => {
  it('every number stays finite, the blower costs the crank, and hp = torque × RPM / 5252 holds', async () => {
    const { randomBuild, honest, rng } = await import('./randomBuilds.js');
    const r = rng(4242);
    const failures = [];
    for (let i = 0; i < 24; i += 1) {
      const base = honest(randomBuild(70000 + i));
      if (base.turboOn) continue;
      const blower = S.BLOWER_OPTS[Math.floor(r() * S.BLOWER_OPTS.length)];
      const withBlower = { ...base, blowerId: blower.id };
      const build = {
        ...withBlower,
        blowerRatio: S.starterRatio(withBlower, S.tankFuel(withBlower)),
        nitrous: kit([50, 100, 150][Math.floor(r() * 3)], { kit: r() < 0.5 ? 'wet' : 'dry' }),
      };
      const p = makeEngine({ build }).pull(100);
      for (const pt of p.points) {
        const nums = [pt.hp, pt.torque, pt.lambda, pt.egt, pt.boostPsi, pt.blowerHp, pt.peakPressure];
        if (nums.some((v) => !Number.isFinite(v))) failures.push(`seed ${base.seed} ${blower.id} @${pt.rpm}: non-finite`);
        if (pt.boostPsi > 0.5 && !(pt.blowerHp > 0)) failures.push(`seed ${base.seed} ${blower.id} @${pt.rpm}: boost with no drive power`);
        if (pt.hp > 20 && Math.abs(pt.hp - (pt.torque * pt.rpm) / 5252) > 2) failures.push(`seed ${base.seed} @${pt.rpm}: hp ${pt.hp} vs ${(pt.torque * pt.rpm / 5252).toFixed(0)}`);
        if (pt.lambda < 0.3 || pt.lambda > 2.5) failures.push(`seed ${base.seed} @${pt.rpm}: λ ${pt.lambda}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
