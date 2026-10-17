/**
 * The advisor, the dyno and LIVE, checked against each other on random builds.
 *
 * tuning-consistency.test.js pins these three to one story on three hand-picked engines.
 * A player-reported contradiction ("the pull says knock, the advisor says fine") is a
 * disagreement between them on SOME engine; this looks for it on engines nobody picked.
 * Builds are honest about their injectors (the ECU told the size that is fitted), so a
 * deliberate misconfiguration never stands in for a disagreement.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine } from './ecuHarness.js';
import { honest, randomBuild } from './randomBuilds.js';
import { seedRandomPerTest } from './seededRandom.js';

seedRandomPerTest();

const BUILDS = 40;
const builds = Array.from({ length: BUILDS }, (_, i) => honest(randomBuild(20000 + i)));

/** The TUNE advisor judged against a pull of the same tables, as EcuLab calls it. */
function advise(eng) {
  const pull = eng.pull(100);
  const cc = S.INJECTOR_OPTS[eng.build.injIdx].cc;
  const advice = S.calibrationAdvice({
    ve: eng.tables.ve, veTruth: eng.veTruth, timing: eng.tables.timing, afr: eng.tables.afr,
    derived: eng.derived, fuel: eng.fuel, mods: eng.build.mods, turboOn: eng.build.turboOn,
    boostCurve: eng.build.boostCurve, compressor: eng.compressor, turbine: eng.turbine,
    injectorCc: cc, ecuInjectorCc: cc, mafScalar: 1,
    mafErrorBase: S.mafErrorFactor(eng.build.mods, eng.build.turboOn), pull,
  });
  return { pull, advice };
}

describe('the advisor and the pull log agree on random builds', () => {
  it('flag knock on exactly the builds the pull shows knocking', () => {
    const failures = [];
    for (const build of builds) {
      const { pull, advice } = advise(makeEngine({ build }));
      const pullKnocks = pull.points.some((p) => p.margin < 0);
      const advisorKnocks = advice.overAdvanced.some((c) => c.knockingOnPull);
      if (pullKnocks !== advisorKnocks) failures.push(`seed ${build.seed}: pull ${pullKnocks ? 'knocks' : 'clean'}, advisor ${advisorKnocks ? 'knocks' : 'clean'}`);
    }
    expect(failures).toEqual([]);
  });

  it('clear the knock they report when the advice is followed', () => {
    const failures = [];
    for (const build of builds) {
      const eng = makeEngine({ build });
      if (!eng.pull(100).points.some((p) => p.margin < 0)) continue;
      for (let round = 0; round < 4; round++) {
        const { advice } = advise(eng);
        for (const c of [...advice.overAdvanced, ...advice.pastMbt]) eng.tables.timing[c.ri][c.ci] = c.suggested;
      }
      const left = eng.pull(100).points.filter((p) => p.margin < 0);
      // What timing cannot fix — an injector out of time, a mixture far lean, a knock limit
      // past the most retard a spark table holds (less the advisor's 1.5° of safety) — the
      // pull log names separately; the advisor's job is the spark table, and there it must
      // finish.
      const sparkFixable = left.filter((p) => !p.fuelLimited && p.lambda < 1.05 && p.threshold >= S.SPARK_MIN_DEG + 1.5);
      if (sparkFixable.length) failures.push(`seed ${build.seed}: still knocks at ${sparkFixable.map((p) => p.rpm).join(', ')} RPM after four rounds of advice`);
    }
    expect(failures).toEqual([]);
  });

  it('flag a mixture on the fuel advisor wherever the pull logs it lean or rich', () => {
    const failures = [];
    for (const build of builds) {
      const { pull, advice } = advise(makeEngine({ build }));
      for (const e of pull.events.filter((ev) => ev.type === 'lean' || ev.type === 'rich' || ev.type === 'valve')) {
        const pts = pull.points.filter((p) => p.rpm >= e.rpmStart && p.rpm <= e.rpmEnd);
        if (pts.every((p) => p.fuelLimited)) continue; // injectors out of time: a hardware event, not a table
        const want = e.type === 'rich' ? 1 : -1; // richen = suggested below current
        const flagged = advice.fuelAdv.some((c) => !c.bracketOnly && c.rpm >= e.rpmStart - 1000 && c.rpm <= e.rpmEnd + 1000
          && Math.sign(c.delta) === want && Math.abs(c.delta) > 0.3);
        if (!flagged) failures.push(`seed ${build.seed}: ${e.type} across ${e.rpmStart}-${e.rpmEnd} with nothing on the fuel advisor`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('only send the player to screens that exist', () => {
    // Every "BUILD → X" or "TUNE → X" in a fix must name a real view, or the advice is
    // a dead end however right it is.
    const views = {
      BUILD: ['ENGINE', 'INDUCTION', 'FUEL SYSTEM', 'EXHAUST'],
      TUNE: ['AIRFLOW', 'SPARK', 'FUEL', 'INJECTORS', 'SENSORS', 'BOOST', 'VVT', 'IDLE', 'PROTECT', 'TORQUE', 'NITROUS'],
    };
    const failures = [];
    for (const build of builds) {
      const pull = makeEngine({ build }).pull(100);
      for (const e of pull.events) {
        for (const m of `${e.msg} ${e.cause} ${e.fix}`.matchAll(/\b(BUILD|TUNE) → ([A-Z][A-Z ]*[A-Z])/g)) {
          if (!views[m[1]].some((v) => m[2].startsWith(v))) failures.push(`${e.type}: "${m[0]}"`);
        }
      }
    }
    expect([...new Set(failures)]).toEqual([]);
  });
});

describe('LIVE and the dyno agree on random builds', () => {
  it('make the same torque and mixture at a held full-throttle speed', () => {
    const failures = [];
    for (const build of builds.filter((b) => !b.turboOn).slice(0, 5)) {
      const eng = makeEngine({ build });
      const pull = eng.pull(100);
      const cfg = eng.liveCfg();
      let s = { ...S.makeLiveState(), cranking: true, coolantC: 90, oilC: 90 };
      for (let i = 0; i < 200; i++) s = S.liveStep(s, 0.05, { throttle: 0, load: 0 }, cfg);
      for (const target of [3000, 4500]) {
        // Held at speed by a brake, the way a load-bearing dyno holds it.
        let integ = 0;
        for (let i = 0; i < 240; i++) {
          const err = s.rpm - target;
          integ += err * 0.05;
          s = S.liveStep(s, 0.05, { throttle: 100, load: Math.max(0, 0.4 * err + 0.3 * integ) }, cfg);
        }
        const live = s.ecu.log.at(-1);
        const dyno = pull.points.reduce((a, b) => (Math.abs(b.rpm - live.rpm) < Math.abs(a.rpm - live.rpm) ? b : a));
        const dynoNm = dyno.torque / 0.7376 / S.DRIVETRAIN_EFF;
        if (Math.abs(live.torque - dynoNm) > 0.05 * dynoNm) failures.push(`seed ${build.seed} at ${target}: LIVE ${Math.round(live.torque)} Nm, dyno ${Math.round(dynoNm)} Nm`);
        if (Math.abs(live.lambda - dyno.lambda) > 0.03) failures.push(`seed ${build.seed} at ${target}: LIVE λ ${live.lambda}, dyno λ ${dyno.lambda}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
