/**
 * The career's customers, held to the real simulator: every job fails as the customer
 * delivers it, and passes once the actual fault is fixed the way a tuner would fix it.
 * A job that passes untouched would be a free payout; one no fix can pass would be a
 * wall. Both are bugs, and this is where they show up.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { customerCar } from '../src/ui/career/cars.js';
import { evaluateJob } from '../src/ui/career/evaluate.js';
import { JOBS, jobById } from '../src/ui/career/jobs.js';
import * as shop from '../src/ui/career/shop.js';
import { START_MONEY } from '../src/ui/career/shop.js';

import { STORY_FIXES } from './careerFixes.js';

const FIXES = STORY_FIXES;
const setBuild = (st, patch) => ({ ...st, build: { ...st.build, ...patch } });

const failures = (v) => v.results.filter((x) => !x.pass).map((x) => `${x.check.label}: ${x.measured}`);

describe.each(JOBS.map((j) => [j.id, j]))('%s', (_id, job) => {
  it('does not pass as the customer delivers it', () => {
    const v = evaluateJob(job, customerCar(job.car));
    expect(v.verdict, 'an unfixed car must not be a free payout').not.toBe('pass');
  });

  it('passes once the real fault is fixed', () => {
    const fixed = FIXES[job.id](customerCar(job.car));
    const v = evaluateJob(job, fixed);
    expect({ verdict: v.verdict, failing: failures(v) }).toEqual({ verdict: 'pass', failing: [] });
  });
});

describe('grading', () => {
  it('judges the idle once it has settled after a warm restart, not the start-up flare', () => {
    // A player reported failing "Still idles smoothly" on a car that never idled rough in
    // LIVE. The idle test judged four seconds straight after the flare, and a warm restart
    // fell through the idle target (see the warm-restart tests in ecu.test.js). A MAF
    // scalar anywhere near right must not fail the idle.
    const job = jobById('intake-maf');
    for (const mafScalar of [1.05, 1.11, 1.15]) {
      const v = evaluateJob(job, setBuild(customerCar(job.car), { mafScalar }));
      const idle = v.results.find((x) => x.check.type === 'idle');
      expect(idle.pass, `${mafScalar}: ${idle.measured}`).toBe(true);
    }
  });

  it('big power with knock is unsafe, not a success', () => {
    const job = jobById('turbo-kit');
    // Leave the knock in and turn the boost rows richer only: fast, and knocking.
    const s = customerCar(job.car);
    const v = evaluateJob(job, { ...s, tune: { ...s.tune, afr: s.tune.afr.map((row, ri) => row.map((x) => (S.LOAD[ri] > 100 ? 11.8 : x))) } });
    expect(v.verdict).toBe('unsafe');
    expect(v.pay).toBe(0);
    expect(v.rep).toBeLessThan(0);
  });

  it('bending the fuel targets instead of fixing the cause is only partly paid', () => {
    const job = jobById('injector-scaling');
    const s = customerCar(job.car);
    const cc = S.INJECTOR_OPTS[s.build.injIdx].cc;
    const fixedByScaling = setBuild(s, { ecuInjectorCc: cc });
    // Scale it right, then also lean every target out: the customer asked for neither.
    const bent = { ...fixedByScaling, tune: { ...fixedByScaling.tune, afr: fixedByScaling.tune.afr.map((row) => row.map((x) => x + 0.6)) } };
    const v = evaluateJob(job, bent);
    expect(v.verdict).toBe('partial');
    expect(v.pay).toBe(Math.round(job.pay * 0.5));
  });

  it('pays for quality: a cleaner calibration earns at least the quoted price', () => {
    const job = jobById('intake-maf');
    const v = evaluateJob(job, FIXES['intake-maf'](customerCar(job.car)));
    expect(v.pay).toBeGreaterThanOrEqual(job.pay);
  });
});

describe('the shop', () => {
  const { accept, blockers, board, buy, cannotBuy, cannotTrain, capacity, deliver, newCareer, overhead, pageUnlocked, reviveCareer, storeCar, train } = /** @type {any} */ (shop);

  it('starts small: a little money, no reputation, fuel basics only, one lift, no dyno', () => {
    const c = newCareer();
    expect(c.money).toBe(START_MONEY);
    expect(c.rep).toBe(0);
    expect(capacity(c)).toBe(1);
    expect(c.owned).not.toContain('dyno');
    expect(['airflow', 'fuel', 'injectors', 'sensors'].every((p) => pageUnlocked(c, p))).toBe(true);
    expect(['spark', 'idle', 'boost', 'vvt', 'nitrous'].some((p) => pageUnlocked(c, p))).toBe(false);
  });

  it('a first customer is waiting, and one the shop is not ready for says what it needs', () => {
    const c = newCareer();
    const waiting = board(c);
    expect(waiting.some((j) => blockers(c, j).length === 0)).toBe(true);
    const idle = jobById('idle-hunt');
    expect(blockers(c, idle)).toContain('Idle control training');
  });

  it('the whole loop: take the car, fix it, hand it back, get paid, and the car leaves', () => {
    let c = accept(newCareer(), 'intake-maf');
    expect(c.lifts).toHaveLength(1);
    expect(c.working).toBe('intake-maf');
    // The work happens on the car on the lift.
    const lift = c.lifts[0];
    const car = { ...customerCar(jobById('intake-maf').car), build: { ...lift.car.build, mafScalar: 1.11 }, tune: lift.car.tune };
    c = storeCar(c, 'intake-maf', { build: car.build, tune: car.tune });
    const v = evaluateJob(jobById('intake-maf'), car);
    c = deliver(c, 'intake-maf', v);
    expect(v.verdict).toBe('pass');
    // Paid, less the day's running costs: the day moves on when the car leaves.
    expect(c.money).toBe(START_MONEY + v.pay - overhead(newCareer()));
    expect(c.rep).toBe(jobById('intake-maf').rep);
    expect(c.lifts).toHaveLength(0);
    expect(c.done['intake-maf']).toBe(1);
    expect(c.day).toBe(2);
    expect(c.milestones).toContain('first-job');
    expect(board(c).some((j) => j.id === 'intake-maf')).toBe(false);
  });

  it('an unfixed car stays in the shop to be worked on, pays nothing, and costs a little standing', () => {
    let c = { ...newCareer(), rep: 10 };
    c = accept(c, 'intake-maf');
    const v = evaluateJob(jobById('intake-maf'), customerCar(jobById('intake-maf').car));
    c = deliver(c, 'intake-maf', v);
    expect(v.verdict).toBe('fail');
    expect(c.lifts).toHaveLength(1);
    expect(c.money).toBe(START_MONEY);
    expect(c.rep).toBe(8);
    expect(c.day).toBe(1);
  });

  it('one lift holds one car: a second customer waits until you buy another', () => {
    let c = accept({ ...newCareer(), money: 10000, rep: 20 }, 'intake-maf');
    expect(blockers(c, jobById('injector-scaling'))).toContain('A free lift');
    c = buy(c, 'lift2');
    expect(capacity(c)).toBe(2);
    expect(blockers(c, jobById('injector-scaling'))).toEqual([]);
  });

  it('money is a decision: you cannot buy what you cannot afford, and buying spends it', () => {
    const c = { ...newCareer(), rep: 20 };
    expect(cannotBuy(c, 'dyno')).toMatch(/\$5,000 short/);
    const rich = buy({ ...c, money: 7000 }, 'dyno');
    expect(rich.owned).toContain('dyno');
    expect(rich.money).toBe(1000);
    expect(rich.milestones).toContain('dyno');
  });

  it('training costs money, needs its prerequisites, and opens the real pages', () => {
    let c = { ...newCareer(), money: 5000, rep: 30 };
    expect(cannotTrain(c, 'knock')).toMatch(/After Ignition timing/);
    c = train(c, 'spark');
    expect(pageUnlocked(c, 'spark')).toBe(true);
    expect(c.money).toBe(5000 - 600);
    expect(cannotTrain(c, 'knock')).toBeNull();
  });

  it('a save that is missing, corrupt or from another version starts a new career instead of breaking', () => {
    expect(reviveCareer(null).money).toBe(START_MONEY);
    expect(reviveCareer({ v: 999, money: 5 }).money).toBe(START_MONEY);
    const kept = reviveCareer({ ...newCareer(), money: 4321, lifts: [{ jobId: 'no-such-job', car: {} }] });
    expect(kept.money).toBe(4321);
    expect(kept.lifts).toEqual([]);
  });
});
