/**
 * The engine management layer, tested by its CONSEQUENCES.
 *
 * Every test here changes something a tuner can change — a sensor's scaling, a
 * controller's gain, a protection's threshold, a part — and asserts what the physics
 * does about it: the mixture the cylinder gets, the torque, the knock, the boost, the
 * idle speed. None of them checks that a variable was set.
 *
 * The first block is the contract the rest rest on: the default calibration IS the
 * original model, so nothing changes for anyone until they change something.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { copyBlock, interpolate, pasteBlock, setBreakpoint, smooth } from '../src/ui/components/ecu/tableOps.js';
import { at, makeEngine, runLive } from './ecuHarness.js';
import { seedRandomPerTest } from './seededRandom.js';

seedRandomPerTest();

const types = (pull) => pull.events.map((e) => e.type).sort();

describe('the default calibration is the original model', () => {
  it('pulls the default build exactly as the model without an ECU does', () => {
    const eng = makeEngine();
    for (const load of [100, 60]) {
      const a = eng.pull(load, { legacy: true });
      const b = eng.pull(load);
      expect(b.points.map((p) => p.torque)).toEqual(a.points.map((p) => p.torque));
      expect(types(b)).toEqual(types(a));
    }
  });

  it.each(S.ENGINE_PRESETS.map((p) => [p.id]))('pulls the %s preset to the same power and log', (id) => {
    const eng = makeEngine({ preset: id });
    const a = eng.pull(100, { legacy: true });
    const b = eng.pull(100);
    // Within one unit everywhere, peaks included: the boost-by-throttle curve is a table,
    // read with linear interpolation between 10% steps, where the original model used the
    // exact square. A 100 kPa pull sits at 98.7% throttle, where the two differ by 0.11%
    // of the boost target — about 0.3 hp on a 380 hp engine, enough to tip a rounding.
    expect(Math.abs(b.peakHp - a.peakHp)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.peakTq - a.peakTq)).toBeLessThanOrEqual(1);
    b.points.forEach((p, i) => expect(Math.abs(p.torque - a.points[i].torque)).toBeLessThanOrEqual(1));
    expect(types(b)).toEqual(types(a));
  });
});

describe('the dyno\'s two numbers', () => {
  // Learn article 37 teaches hp = lb-ft × RPM ÷ 5252 on this app's own figures. Both are
  // wheel numbers (crank × the same drivetrain efficiency), so the identity must hold
  // on every logged point, rounding aside — and the curves must cross at 5252 RPM.
  it('logs power as torque times speed, on every point', () => {
    for (const id of ['stock', ...S.ENGINE_PRESETS.map((p) => p.id)]) {
      const pull = makeEngine(id === 'stock' ? {} : { preset: id }).pull(100);
      for (const p of pull.points) {
        if (p.torque <= 0) continue;
        expect(Math.abs(p.hp - p.torque * p.rpm / 5252)).toBeLessThanOrEqual(1 + p.rpm / 5252);
      }
    }
  });
});

describe('sensors: the ECU acts on what it measures', () => {
  it('cannot see boost through a 1-bar MAP sensor, and fuels the turbo engine lean for it', () => {
    const good = makeEngine({ preset: 'b58-m1' });
    const blind = makeEngine({ preset: 'b58-m1', build: { sensorHw: { map: '1bar' } } });
    const g = at(good.pull(), 4500);
    const b = at(blind.pull(), 4500);
    expect(g.map).toBeGreaterThan(150);
    expect(b.sensedMap).toBeLessThanOrEqual(106);
    // Speed-density fuels for 105 kPa of air while the cylinder holds far more.
    expect(b.lambda).toBeGreaterThan(g.lambda + 0.2);
    expect(types(blind.pull())).toContain('mapsensor');
  });

  it('reads a 3-bar sensor at a third of the pressure when the ECU is told it is 1-bar', () => {
    const r = S.readSensor({ kind: 'map', value: 100, part: '3bar', scale: '1bar' });
    expect(r.value).toBeLessThan(45);
  });

  it('drives closed loop to the wrong mixture on a mis-scaled wideband, while reading on target', () => {
    const eng = makeEngine({ cal: { 'sensors.wideband': 'afr-10-20' } });
    const p = at(eng.pull(40), 3500);
    expect(p.openLoop).toBe(false);
    expect(Math.abs(p.sensedLambda - 1)).toBeLessThan(0.02);
    expect(Math.abs(p.lambda - 1)).toBeGreaterThan(0.025);
    expect(types(eng.pull(40))).toContain('wideband');
  });

  it('misreads charge temperature on the wrong thermistor curve', () => {
    const r = S.readSensor({ kind: 'iat', value: 40, part: 'bosch', scale: 'gm' });
    expect(Math.abs(r.value - 40)).toBeGreaterThan(5);
  });

  it('flags an open circuit as a fault and substitutes a default', () => {
    const r = S.readSensor({ kind: 'map', value: 60, part: '3bar', scale: '3bar', fault: 'open', fallback: 101 });
    expect(r.fault).toBe(true);
    expect(r.value).toBe(101);
  });
});

describe('wideband controllers read on their published lines', () => {
  // Innovate LC-2: AFR = 7.35 + 3.008·V over 0–5 V. AEM X-series: AFR = 7.3125 + 2.375·V,
  // used over 0.5–4.5 V. At stoichiometric gasoline (14.7) each gives its own voltage.
  it.each([
    ['afr-7.3-22.4', (14.7 - 7.35) / 3.008],
    ['afr-8.5-18', (14.7 - 7.3125) / 2.375],
  ])('%s', (id, volts) => {
    const r = S.readSensor({ kind: 'wideband', value: 1, part: id, scale: id });
    expect(r.volts).toBeCloseTo(volts, 2);
    expect(r.value).toBeCloseTo(1, 3);
  });
});

describe('fuel: what the ECU believes about fuel reaches the cylinder', () => {
  it('fuels a flex tank as gasoline until it can read the ethanol sensor', () => {
    // Only a sensor can report a blend. Without one the ECU fuels the gasoline it was
    // calibrated on, and an E50 tank runs lean; with it, the mixture is back on target.
    const flex = { octaneIdx: 4, ethanolPct: 50 };
    const blind = at(makeEngine({ build: flex }).pull(), 4000);
    const read = at(makeEngine({ build: { ...flex, sensorHw: { ...S.DEFAULT_ECU_HW.sensorHw, flex: true } }, cal: { 'config.flexEnabled': true } }).pull(), 4000);
    const pump = at(makeEngine().pull(), 4000);
    expect(blind.lambda).toBeGreaterThan(pump.lambda * 1.15);
    expect(Math.abs(read.lambda - pump.lambda)).toBeLessThan(0.02);
  });

  it('runs E85 a third lean when the ECU thinks it is gasoline', () => {
    const right = at(makeEngine({ build: { octaneIdx: 3, injIdx: 4, ecuInjectorCc: 850 } }).pull(), 4000);
    const wrong = at(makeEngine({ build: { octaneIdx: 3, injIdx: 4, ecuInjectorCc: 850 }, cal: { 'config.stoichMode': 'gasoline' } }).pull(), 4000);
    expect(wrong.lambda / right.lambda).toBeGreaterThan(1.35);
  });

  it('fuels any flex blend correctly with an ethanol sensor, and not without one', () => {
    const build = { octaneIdx: 4, ethanolPct: 60, injIdx: 4, ecuInjectorCc: 850 };
    const withSensor = at(makeEngine({ build: { ...build, sensorHw: { flex: true } }, cal: { 'config.flexEnabled': true, 'config.stoichMode': 'gasoline' } }).pull(), 4000);
    const blind = at(makeEngine({ build, cal: { 'config.stoichMode': 'gasoline' } }).pull(), 4000);
    const target = withSensor.afrCommanded / 14.7;
    expect(Math.abs(withSensor.lambda - target)).toBeLessThan(0.03);
    expect(blind.lambda).toBeGreaterThan(withSensor.lambda + 0.15);
  });

  it('blends fuel properties so a flex tank at 85% is the E85 pump fuel', () => {
    const b = S.blendFuel(85);
    const e85 = S.OCTANE_OPTS[3];
    expect(b.stoich).toBeCloseTo(e85.stoich, 1);
    expect(b.octane).toBe(e85.octane);
    expect(S.blendFuel(30).octane).toBeGreaterThan(93 + (105 - 93) * (30 / 85));
  });

  it('leans out under boost on a returnless rail, and compensation brings it back', () => {
    const base = { preset: 'b58-m1', build: { fuelSystem: { regulator: 'returnless', basePressureKpa: 300, pumpIdx: 3 } } };
    const ret = at(makeEngine({ preset: 'b58-m1' }).pull(), 4500);
    const raw = at(makeEngine(base).pull(), 4500);
    const comp = at(makeEngine({ ...base, cal: { 'injector.pressureComp': 'manifold' } }).pull(), 4500);
    expect(raw.railDp).toBeLessThan(250);
    expect(raw.lambda).toBeGreaterThan(ret.lambda * 1.08);
    expect(Math.abs(comp.lambda - ret.lambda)).toBeLessThan(0.02);
  });

  it('starves the rail when the pump is too small for the demand', () => {
    // The stock pump, and a tired one at that, against E85's fuel volume under boost.
    const eng = makeEngine({ preset: 'b58-m1', build: { octaneIdx: 3, injIdx: 4, ecuInjectorCc: 850, fuelSystem: { regulator: 'return', basePressureKpa: 300, pumpIdx: 0 } }, faults: { pump: 'weak' } });
    const pull = eng.pull();
    expect(pull.points.some((p) => p.fuelStarved)).toBe(true);
    const starved = pull.points.find((p) => p.fuelStarved);
    const healthy = at(makeEngine({ preset: 'b58-m1', build: { octaneIdx: 3, injIdx: 4, ecuInjectorCc: 850 } }).pull(), starved.rpm);
    expect(starved.lambda).toBeGreaterThan(healthy.lambda);
  });

  it('corrects the final pulse with the fuel compensation table', () => {
    const eng = makeEngine();
    const comp = S.map2(S.RPM, S.MAP_AXIS, () => 110);
    const rich = at(makeEngine({ cal: { 'fuel.comp': comp } }).pull(), 4000);
    const base = at(eng.pull(), 4000);
    expect(base.lambda / rich.lambda).toBeCloseTo(1.1, 1);
  });

  it('delivers less than rated below the ballistic threshold', () => {
    expect(S.ballisticOpenMs(0.2)).toBeLessThan(0.2);
    expect(S.ballisticOpenMs(0.5)).toBe(0.5);
  });
});

describe('ignition: knock control acts on what the sensor hears', () => {
  it('retards for valvetrain noise when the threshold sits below it, and loses power up top', () => {
    const eng = makeEngine();
    const lowThr = S.curve(S.RPM, () => 0.06);
    const deaf = makeEngine({ cal: { 'ignition.knockThreshold': lowThr } });
    const a = at(eng.pull(), 7000);
    const b = at(deaf.pull(), 7000);
    expect(b.knockPull).toBeGreaterThan(5);
    expect(b.torque).toBeLessThan(a.torque);
    expect(types(deaf.pull())).toContain('falseknock');
  });

  it('lets knock run unheard when the threshold is far above the signal', () => {
    // A naturally aspirated engine: lower cylinder pressure, a quieter knock ring, so a
    // threshold set for a much louder engine misses it.
    const deafEng = makeEngine({ cal: { 'ignition.knockThreshold': S.curve(S.RPM, () => 2) } });
    const heardEng = makeEngine();
    const hot = deafEng.tables.timing.map((row) => row.map((v) => v + 10));
    deafEng.tables.timing = hot;
    heardEng.tables.timing = hot;
    const deaf = deafEng.pull();
    const heard = heardEng.pull();
    expect(Math.max(...deaf.points.map((p) => p.knockUnheard))).toBeGreaterThan(1);
    expect(Math.max(...heard.points.map((p) => p.knockUnheard))).toBeLessThan(0.3);
    expect(deaf.wear.piston).toBeGreaterThan(heard.wear.piston);
    expect(types(deaf)).toContain('unheardknock');
  });

  it('does nothing about knock with knock control switched off', () => {
    const eng = makeEngine({ preset: 'b58-m1', cal: { 'ignition.knockEnabled': false } });
    eng.tables.timing = eng.tables.timing.map((row) => row.map((v) => v + 8));
    const p = eng.pull().points.find((q) => q.knockUnheard > 0);
    expect(p).toBeDefined();
    expect(p.knockPull).toBe(0);
  });

  it('adds real advance through a correction table — torque follows MBT, not the number', () => {
    const base = at(makeEngine().pull(), 3000);
    const adv = at(makeEngine({ cal: { 'ignition.iatCorr': S.curve(S.IAT_AXIS, () => 20) } }).pull(), 3000);
    expect(adv.commandedTiming).toBeCloseTo(base.commandedTiming + 20, 0);
    // Twenty degrees past a table that was already near MBT buys nothing, or costs.
    expect(adv.torque).toBeLessThanOrEqual(base.torque + 2);
  });

  it('misfires under boost when the coil cannot break down the gap', () => {
    const short = { 'ignition.dwell': S.curve(S.VOLT_AXIS, () => 1.0) };
    const weak = at(makeEngine({ preset: 'b58-m1', cal: short }).pull(), 4500);
    const narrow = at(makeEngine({ preset: 'b58-m1', build: { plugGapMm: 0.6 }, cal: short }).pull(), 4500);
    const full = at(makeEngine({ preset: 'b58-m1' }).pull(), 4500);
    expect(weak.sparkKvNeed).toBeGreaterThan(weak.sparkKvHave);
    expect(weak.misfire).toBeGreaterThan(50);
    expect(weak.torque).toBeLessThan(full.torque * 0.6);
    // A narrower gap breaks down at a lower voltage, and the same weak coil lights it.
    expect(narrow.misfire).toBe(0);
  });
});

describe('boost control commands the wastegate, and the turbo answers', () => {
  it('overboosts in open loop on a base duty table that holds too much', () => {
    const eng = makeEngine({ preset: 'b58-m1', cal: { 'boost.mode': 'open', 'boost.baseDuty': S.map2(S.RPM, S.BOOST_AXIS, () => 95) } });
    const pull = eng.pull();
    expect(types(pull)).toContain('overboost');
  });

  it('cannot hold boost below a pneumatic spring', () => {
    const eng = makeEngine({ preset: 'n54', build: { wastegate: { type: 'pneumatic', springPsi: 14 } } });
    const pull = eng.pull();
    expect(pull.points.some((p) => p.gateLimited === 'spring')).toBe(true);
    expect(types(pull)).toContain('boostctl');
  });

  it('limits boost by gear, taking torque out of first', () => {
    const eng = makeEngine({ preset: 'b58-m1', cal: { 'boost.gearLimit': S.curve(S.GEAR_AXIS, (g) => (g === 1 ? 5 : 40)) } });
    const first = eng.pull(100, { gear: 1 });
    const fourth = eng.pull(100, { gear: 4 });
    expect(Math.max(...first.points.map((p) => p.boostPsi))).toBeLessThanOrEqual(5.1);
    expect(first.peakTq).toBeLessThan(fourth.peakTq);
  });
});

describe('cam phasing moves the torque curve through the valve events', () => {
  it('trades top end for low end when the intake cam is advanced', () => {
    const vvt = { engineConfig: { ...S.DEFAULT_ENGINE_CONFIG, vvt: 'intake' } };
    const parked = makeEngine({ build: vvt });
    const adv = makeEngine({ build: vvt, cal: { 'vvt.intakeTarget': S.map2(S.RPM, S.MAP_AXIS, () => 30) } });
    const p = parked.pull();
    const a = adv.pull();
    expect(at(a, 2000).torque).toBeGreaterThan(at(p, 2000).torque);
    expect(at(a, 7000).torque).toBeLessThan(at(p, 7000).torque);
    expect(at(a, 2000).residualFrac).toBeGreaterThan(at(p, 2000).residualFrac);
  });

  it('does nothing on an engine without phasers, whatever the targets say', () => {
    const eng = makeEngine({ cal: { 'vvt.intakeTarget': S.map2(S.RPM, S.MAP_AXIS, () => 30) } });
    expect(eng.pull().peakTq).toBe(makeEngine().pull().peakTq);
  });
});

describe('protections intervene, and say why', () => {
  it('cuts boost when the wideband reads lean under boost', () => {
    // 440s fitted, the ECU told they are 650s: every pulse a third short.
    const eng = makeEngine({ preset: 'b58-m1', build: { injIdx: 1, ecuInjectorCc: 650 } });
    const lean = makeEngine({ preset: 'b58-m1', build: { injIdx: 1, ecuInjectorCc: 650 }, cal: { 'protect.leanEnabled': false } });
    const a = eng.pull();
    const b = lean.pull();
    expect(types(a)).toContain('leanprot');
    expect(Math.max(...a.points.map((p) => p.boostPsi))).toBeLessThan(Math.max(...b.points.map((p) => p.boostPsi)));
  });

  it('holds torque to a limit by throttle; spark retard runs out of authority and runs hot', () => {
    const limit = S.curve(S.RPM, () => 250);
    const nm = (p) => p.torque / 0.7376 / 0.85;
    const base = at(makeEngine().pull(), 4500);
    const spark = at(makeEngine({ cal: { 'torque.limitByRpm': limit, 'torque.method': 'spark' } }).pull(), 4500);
    const thr = at(makeEngine({ cal: { 'torque.limitByRpm': limit, 'torque.method': 'throttle' } }).pull(), 4500);
    const boost = at(makeEngine({ cal: { 'torque.limitByRpm': limit, 'torque.method': 'boost' } }).pull(), 4500);
    expect(nm(thr)).toBeLessThanOrEqual(253);
    // Retard takes torque out — but a burn that late still does work, so spark alone
    // cannot reach the limit, and what it does remove leaves as exhaust heat.
    expect(nm(spark)).toBeLessThan(nm(base) * 0.8);
    expect(spark.egt).toBeGreaterThan(thr.egt + 50);
    // No turbo, no boost to take away.
    expect(boost.torque).toBe(base.torque);
  });

  it('ends the pull at a rev limit set below redline', () => {
    const eng = makeEngine({ cal: { 'limiter.offsetRpm': -1000 } });
    const pull = eng.pull();
    expect(Math.max(...pull.points.map((p) => p.rpm))).toBeLessThan(eng.derived.redline - 900);
    expect(types(pull)).toContain('limiter');
  });

  it('runs a spark-cut limiter hotter than a fuel-cut one', () => {
    const cfg = { 'limiter.softWindowRpm': 800 };
    const fuel = at(makeEngine({ cal: { ...cfg, 'limiter.mode': 'fuel' } }).pull(), 7300);
    const spark = at(makeEngine({ cal: { ...cfg, 'limiter.mode': 'spark' } }).pull(), 7300);
    expect(spark.egt).toBeGreaterThan(fuel.egt);
  });
});

describe('the day matters', () => {
  it('makes less power at altitude and on a hot day', () => {
    const sea = makeEngine().pull().peakHp;
    expect(makeEngine({ env: { ambientC: 24.85, altitudeM: 2000 } }).pull().peakHp).toBeLessThan(sea * 0.85);
    expect(makeEngine({ env: { ambientC: 40, altitudeM: 0 } }).pull().peakHp).toBeLessThan(sea);
  });
});

describe('the live engine runs its controllers in time', () => {
  it('charges the battery at a hot idle, and sags only under a heavy electrical load', () => {
    // A 120 A alternator gives about half its rating at idle: enough for the car itself,
    // not for lights and A/C on top.
    const eng = makeEngine();
    const quiet = runLive(eng, { seconds: 8 }).rows.at(-1);
    const loaded = runLive(eng, { seconds: 8, aux: { lights: true, ac: true } }).rows.at(-1);
    expect(quiet.volts).toBeGreaterThan(13.8);
    expect(loaded.volts).toBeLessThan(13);
    expect(loaded.volts).toBeGreaterThan(11.5);
  });

  it('learns no long-term trim from the start-up enrichment on a correct tune', () => {
    // While after-start fuel is still fading the short-term trim fights it on purpose;
    // storing that as a learned correction would tell the player the tune is off.
    const { rows } = runLive(makeEngine(), { seconds: 12 });
    expect(Math.abs(rows.at(-1).ltft)).toBeLessThan(0.5);
  });

  it('starts cold and settles on the idle target', () => {
    const { rows } = runLive(makeEngine(), { seconds: 15, coolantC: 20 });
    const tail = rows.slice(-60).map((r) => r.rpm);
    expect(rows.at(-1).running).toBe(true);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(120);
    expect(Math.abs(tail.at(-1) - 800)).toBeLessThan(80);
  });

  it('floods on a cold start with far too much fuel, and cranks without firing', () => {
    // A VE table far over the engine's own, plus cranking enrichment, puts λ near 0.15
    // in the cylinder: far past the rich flammability limit, most of it liquid. A real
    // engine cranks and will not fire. On E85, with twice gasoline's latent heat, the
    // evaporation arithmetic used to cool that charge below absolute zero and hand LIVE
    // a NaN for RPM.
    const eng = makeEngine({ build: { octaneIdx: 3 } });
    eng.tables.ve = eng.tables.ve.map((row) => row.map(() => 130));
    const { rows, state } = runLive(eng, { seconds: 8, coolantC: 20, pedal: (t) => (t > 4 ? 100 : 0) });
    expect(rows.every((r) => Number.isFinite(r.rpm) && Number.isFinite(r.torque) && Number.isFinite(r.egt))).toBe(true);
    expect(rows.some((r) => r.running)).toBe(false);
    expect(state.cranking).toBe(true);
    expect(rows.at(-1).misfire).toBe(100);
    expect(rows.at(-1).lambda).toBeLessThan(0.3);
  });

  it('hunts on an idle controller with far too much gain', () => {
    const { rows } = runLive(makeEngine({ cal: { 'idle.gainUp': 0.05, 'idle.gainDown': 0.02, 'idle.damp': 0 } }), { seconds: 15 });
    const tail = rows.slice(-100).map((r) => r.rpm);
    expect(Math.max(...tail) - Math.min(...tail)).toBeGreaterThan(300);
  });

  it('does not start with no cranking fuel on a cold engine', () => {
    const { rows } = runLive(makeEngine({ cal: { 'fuel.cranking': S.curve(S.ECT_AXIS, () => -90) } }), { seconds: 3, coolantC: -10 });
    expect(rows.some((r) => r.running)).toBe(false);
  });

  it('holds idle under the A/C better with the feed-forward than without it', () => {
    // The sag in the second after the compressor clutch and the lights come in: the
    // feed-forward adds air the moment the load arrives, before the speed has dropped.
    const run = (cal) => {
      const eng = makeEngine({ cal });
      const warm = runLive(eng, { seconds: 10 }).state;
      const { rows } = runLive(eng, { seconds: 1, from: warm, aux: { ac: true, lights: true } });
      return Math.min(...rows.map((r) => r.rpm));
    };
    expect(run({})).toBeGreaterThan(run({ 'idle.acAirAdd': 0, 'idle.elecAirAdd': 0 }));
  });

  it('goes lean on a cold tip-in without acceleration enrichment', () => {
    const tip = (cal) => {
      const eng = makeEngine({ cal });
      const idle = runLive(eng, { seconds: 6, coolantC: 30 }).state;
      const { rows } = runLive(eng, { seconds: 0.6, from: idle, pedal: () => 40 });
      return Math.max(...rows.map((r) => r.lambda));
    };
    const zero = S.curve(S.TPS_RATE_AXIS, () => 0);
    expect(tip({ 'fuel.accel': zero })).toBeGreaterThan(tip({}) + 0.05);
  });

  it('tracks boost target in closed loop, and overshoots it with a wound-up integrator', () => {
    const peak = (cal) => {
      const eng = makeEngine({ preset: 'b58-m1', cal });
      const idle = runLive(eng, { seconds: 4 }).state;
      const { rows } = runLive(eng, { seconds: 2.5, from: idle, pedal: () => 100 });
      return Math.max(...rows.map((r) => r.boost - r.boostTarget));
    };
    expect(peak({})).toBeLessThan(1.5);
    expect(peak({ 'boost.ki': 40, 'boost.iWindowPsi': 30 })).toBeGreaterThan(2);
  });

  it('holds the two-step on launch control and builds boost on it', () => {
    const eng = makeEngine({ preset: 'b58-m1', cal: { 'arc.launchEnabled': true, 'arc.launchRpm': 4500, 'arc.launchRestoreRpm': 4300 } });
    const idle = runLive(eng, { seconds: 4 }).state;
    const { rows } = runLive(eng, { seconds: 4, from: idle, pedal: () => 100, aux: { launch: true } });
    const tail = rows.slice(-40);
    expect(Math.max(...tail.map((r) => r.rpm))).toBeLessThan(5800);
    expect(Math.max(...tail.map((r) => r.boost))).toBeGreaterThan(5);
  });

  it('cuts fuel when oil pressure is lost', () => {
    const eng = makeEngine({ faults: { oil: 'low' } });
    const { rows } = runLive(eng, { seconds: 12, pedal: (t) => (t > 5 ? 100 : 0) });
    expect(rows.some((r) => r.protect.includes('oil pressure'))).toBe(true);
  });
});

describe('the drag strip sees the torque strategy', () => {
  const tq = (rpm) => 300 + rpm * 0.03;
  const car = { ...S.DEFAULT_CAR };
  const drag = (cal) => S.simulateDragRun({ car, torqueCurveNm: tq, redline: 7000, ecu: cal ? { cal, cyl: 6 } : null });
  const def = S.defaultEcuCalibration({});

  it('is unchanged with the default calibration', () => {
    expect(drag(def).et).toBe(drag(null).et);
  });

  it('caps trap speed at the road-speed limiter', () => {
    const r = drag(S.setCal(def, 'limiter.speedLimitKph', 150));
    expect(r.trapMph).toBeLessThan(150 / 1.609 + 2);
  });

  it('shifts quicker flat-foot on a manual box', () => {
    expect(drag(S.setCal(def, 'arc.ffsEnabled', true)).et).toBeLessThan(drag(def).et);
  });

  it('holds crank torque to the same limit the dyno does', () => {
    // The drag curve is torque after the transmission's loss; the limit is crank torque.
    // A 250 Nm crank limit must drive exactly like an engine that only ever made 250 Nm.
    const limited = S.setCal(def, 'torque.limitByGear', { ...def.torque.limitByGear, z: def.torque.limitByGear.z.map(() => 250) });
    const capped = S.simulateDragRun({ car, torqueCurveNm: () => 250 * S.DRIVETRAIN_EFF, redline: 7000, ecu: { cal: def, cyl: 6 } });
    expect(drag(limited).et).toBeCloseTo(capped.et, 3);
  });
});

describe('map slots switch whole calibrations', () => {
  it('stores, switches, copies and swaps, and undo puts it back', async () => {
    const { reducer, ACTIONS } = await import('../src/ui/state/reducer.js');
    const { makeInitialState } = await import('../src/ui/state/initialState.js');
    let s = makeInitialState();
    const hot = s.tune.timing.map((r) => r.map((v) => v + 5));
    s = reducer(s, { type: ACTIONS.SET_TABLE, table: 'timing', value: hot });
    s = reducer(s, { type: ACTIONS.COPY_MAP, to: 2 });
    s = reducer(s, { type: ACTIONS.SET_TABLE, table: 'timing', value: S.clone2D(S.DEFAULT_TIMING) });
    s = reducer(s, { type: ACTIONS.SWITCH_MAP, index: 2 });
    expect(s.tune.activeMap).toBe(2);
    expect(s.tune.timing).toEqual(hot);
    s = reducer(s, { type: ACTIONS.SWAP_MAPS, a: 2, b: 0 });
    expect(s.tune.timing).toEqual(S.DEFAULT_TIMING);
    s = reducer(s, { type: ACTIONS.UNDO });
    expect(s.tune.timing).toEqual(hot);
  });
});

describe('table editor operations', () => {
  const t = { x: [0, 1, 2, 3], y: [0, 1], z: [[0, 0, 0, 30], [10, 0, 0, 40]] };
  const lim = { min: -100, max: 100, decimals: 1 };

  it('interpolates a row between its end cells', () => {
    const r = interpolate(t, { r1: 0, c1: 0, r2: 0, c2: 3 }, lim);
    expect(r.z[0]).toEqual([0, 10, 20, 30]);
  });

  it('interpolates a rectangle bilinearly from its corners', () => {
    const r = interpolate(t, { r1: 0, c1: 0, r2: 1, c2: 3 }, lim);
    expect(r.z[1][0]).toBe(10);
    expect(r.z[1][3]).toBe(40);
    expect(r.z[0][1]).toBe(10);
  });

  it('smooths without moving a flat region', () => {
    const flat = { x: [0, 1, 2], z: [5, 5, 5] };
    expect(smooth(flat, { r1: 0, c1: 0, r2: 0, c2: 2 }, lim).z).toEqual([5, 5, 5]);
  });

  it('copies and pastes a block, clipped to the table', () => {
    const block = copyBlock(t, { r1: 0, c1: 2, r2: 1, c2: 3 });
    const r = pasteBlock(t, { r1: 0, c1: 3, r2: 0, c2: 3 }, block, lim);
    expect(r.z[0][3]).toBe(0);
    expect(r.z[1][3]).toBe(0);
  });

  it('refuses a breakpoint that would break the axis order', () => {
    expect(setBreakpoint(t, 'x', 1, 5)).toBeNull();
    expect(setBreakpoint(t, 'x', 1, 1.5).x).toEqual([0, 1.5, 2, 3]);
  });
});
