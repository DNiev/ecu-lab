/**
 * The generated customers, held to the same two facts as the story ones, on the real
 * simulator: every template, on every car it can come on, at the lowest and highest
 * standing it is offered at, fails as delivered and passes with the real fix. A template
 * that passes untouched is a free payout; one no fix passes is a wall. Both are bugs.
 *
 * Plus the endless loop itself: every day brings new customers, the same career always
 * gets the same ones, and a new shop always has work it can take.
 */

import { describe, expect, it } from 'vitest';

import { customerCar } from '../src/ui/career/cars.js';
import { evaluateJob } from '../src/ui/career/evaluate.js';
import { TEMPLATE_IDS, generatedJob, genId, levelOf, templateById } from '../src/ui/career/generate.js';
import { jobById } from '../src/ui/career/jobs.js';
import * as shop from '../src/ui/career/shop.js';

import { TEMPLATE_FIXES } from './careerFixes.js';

/** One job per template × car × level, from the first seeds that produce each. */
function coverage() {
  const seen = new Map();
  for (const tpl of TEMPLATE_IDS) {
    const t = templateById(tpl);
    for (const level of [...new Set([t.minLevel, 4])]) {
      for (let seed = 1; seed < 400; seed += 1) {
        const job = generatedJob(genId(tpl, seed, level));
        // Engine-building targets are drawn from a range: hold the hardest one each
        // car is asked for, not whichever came up first.
        const key = `${tpl} · ${job.carKey} · level ${level}`;
        const prev = seen.get(key);
        if (!prev || (job.build && job.params.share > prev.params.share)) seen.set(key, job);
      }
    }
  }
  return [...seen.entries()];
}

const failures = (v) => v.results.filter((x) => !x.pass).map((x) => `${x.check.label}: ${x.measured}`);

describe.each(coverage())('%s', (_key, job) => {
  it('fails as delivered, and passes with the real fix', () => {
    const delivered = customerCar(job.car);
    expect(evaluateJob(job, delivered).verdict, 'an unfixed car must not be a free payout').not.toBe('pass');
    const v = evaluateJob(job, TEMPLATE_FIXES[job.template](delivered, job));
    expect({ verdict: v.verdict, failing: failures(v) }).toEqual({ verdict: 'pass', failing: [] });
  });
});

describe('generated jobs', () => {
  it('are their id: the same id always makes the same job', () => {
    const id = genId('injectors', 12345, 2);
    const a = generatedJob(id);
    const b = jobById(id);
    expect(JSON.stringify({ ...a, car: null })).toBe(JSON.stringify({ ...b, car: null }));
    expect(a.params).toEqual(b.params);
  });

  it('pay more and ask more as the shop grows', () => {
    const pays = [0, 4].map((level) => {
      let sum = 0;
      for (let seed = 1; seed <= 40; seed += 1) sum += generatedJob(genId('intake', seed, level)).pay;
      return sum / 40;
    });
    expect(pays[1]).toBeGreaterThan(pays[0] * 1.8);
    const mix = (level) => generatedJob(genId('intake', 7, level)).checks.find((c) => c.type === 'mixture').pct;
    expect(mix(4)).toBeLessThan(mix(0));
  });

  it('never name the fix: customers describe the car', () => {
    for (const tpl of TEMPLATE_IDS) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const j = generatedJob(genId(tpl, seed, 4));
        expect(`${j.says} ${j.wants}`, `${tpl}:${seed}`).not.toMatch(/\b(VE table|MAF scalar|injector scaling|damping|timing table|TUNE ›)\b/i);
      }
    }
  });
});

describe('the endless loop', () => {
  it('brings new customers every day, and the same ones for the same career', () => {
    const a = shop.newCareer(99);
    const b = shop.newCareer(99);
    expect(a.offers).toEqual(b.offers);
    const tomorrow = shop.nextDay(a);
    expect(tomorrow.day).toBe(2);
    expect(tomorrow.offers).not.toEqual(a.offers);
  });

  it('always has work a brand-new shop can take', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const c = shop.newCareer(seed);
      const takeable = shop.board(c).filter((j) => shop.blockers(c, j).length === 0);
      expect(takeable.length, `career seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('offers engine-building jobs once the shop is good enough, and opens BUILD for them', () => {
    let c = { ...shop.newCareer(5), rep: 140, money: 50000, owned: ['laptop', 'wideband', 'dyno', 'egt'], trained: ['spark', 'boost', 'builder'] };
    expect(levelOf(c.rep)).toBe(3);
    const builds = [];
    for (let d = 0; d < 20; d += 1) {
      c = shop.nextDay(c);
      builds.push(...c.offers.map(jobById).filter((j) => j.build));
    }
    expect(builds.length).toBeGreaterThan(0);
    expect(builds.every((j) => j.checks.some((x) => x.type === 'minHp'))).toBe(true);
  });

  it('keeps a revived old save playable: offers are made for it', () => {
    const old = { ...shop.newCareer(3) };
    delete old.offers;
    delete old.seed;
    const revived = shop.reviveCareer(old);
    expect(revived.offers.length).toBeGreaterThan(0);
    expect(shop.board(revived).length).toBeGreaterThan(0);
  });
});
