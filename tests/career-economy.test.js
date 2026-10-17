/**
 * The producer run: a player who fixes every car properly plays the career for 70 days,
 * spending as they go, and the career is held to how it should feel.
 *
 * It measures pacing, not correctness (career.test.js and career-generated.test.js do
 * that): there is always work the shop can take, every job it takes is fixable, money
 * never runs dry, and the reputation ladder is a climb rather than a sprint. When this
 * was first run, a perfect player reached the top of the ladder on day 14.
 */

import { describe, expect, it } from 'vitest';

import { customerCar } from '../src/ui/career/cars.js';
import { EQUIPMENT, TRAINING } from '../src/ui/career/catalog.js';
import { evaluateJob } from '../src/ui/career/evaluate.js';
import { levelOf } from '../src/ui/career/generate.js';
import * as shop from '../src/ui/career/shop.js';

import { STORY_FIXES, TEMPLATE_FIXES } from './careerFixes.js';

/** What the player buys, in the order they want it, once they can afford it with a margin. */
const WISH = ['idle', 'spark', 'dyno', 'lift2', 'flex', 'sign', 'knock', 'egt', 'boost', 'builder', 'lounge', 'fuel-strategy', 'nitrous', 'limits', 'vvt', 'torque', 'expansion'];

function play(days) {
  let c = shop.newCareer(20240925);
  const firstDay = {};
  let idle = 0;
  const unfixed = [];
  let lowest = c.money;
  while (c.day <= days) {
    for (const id of WISH) {
      const equipment = EQUIPMENT.find((e) => e.id === id);
      const price = (equipment ?? TRAINING.find((t) => t.id === id)).price;
      if (c.money < price + 400) continue;
      if (equipment ? !shop.cannotBuy(c, id) : !shop.cannotTrain(c, id)) {
        c = equipment ? shop.buy(c, id) : shop.train(c, id);
      }
    }
    const takeable = shop.board(c).filter((j) => shop.blockers(c, j).length === 0);
    if (!takeable.length) { idle += 1; c = shop.nextDay(c); continue; }
    const job = takeable.sort((a, b) => b.pay - a.pay)[0];
    c = shop.accept(c, job.id);
    const delivered = customerCar(job.car);
    const fix = job.generated ? TEMPLATE_FIXES[job.template] : STORY_FIXES[job.id];
    const fixed = fix(delivered, job);
    const v = evaluateJob(job, fixed);
    if (v.verdict !== 'pass') unfixed.push(`${job.id}: ${v.verdict}`);
    c = shop.deliver(shop.storeCar(c, job.id, { build: fixed.build, tune: fixed.tune }), job.id, v, {});
    if (c.lifts.some((l) => l.jobId === job.id)) c = shop.giveUp(c, job.id);
    lowest = Math.min(lowest, c.money);
    const level = levelOf(c.rep);
    for (let l = 1; l <= level; l += 1) firstDay[l] ??= c.day;
    if (job.build) firstDay.build ??= c.day;
  }
  return { c, firstDay, idle, unfixed, lowest };
}

describe('the producer run: 70 days of good work', () => {
  const run = play(70);

  it('always has work the shop can take, and every car it takes is fixable', () => {
    expect(run.idle).toBe(0);
    expect(run.unfixed).toEqual([]);
  });

  it('never runs out of money', () => {
    expect(run.lowest).toBeGreaterThan(0);
  });

  it('climbs the reputation ladder over weeks, not days', () => {
    const { firstDay } = run;
    expect(firstDay[1]).toBeGreaterThanOrEqual(3);
    expect(firstDay[2]).toBeGreaterThanOrEqual(7);
    expect(firstDay[3]).toBeGreaterThanOrEqual(20);
    expect(firstDay[4] ?? Infinity).toBeGreaterThanOrEqual(40);
  });

  it('reaches engine building within the run', () => {
    expect(run.firstDay.build).toBeLessThanOrEqual(60);
  });
});
