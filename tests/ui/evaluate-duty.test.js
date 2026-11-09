/**
 * The career's "injectors keep up" check reads the busier injector bank (#39): a staged
 * port kit can be at its limit while the direct injectors idle. `evaluateJob` pulls the
 * car on the real simulator, so the sweep is replaced by a fixed one here to put the two
 * banks' duties exactly where the check can tell them apart.
 */

import { describe, expect, it, vi } from 'vitest';

const sweep = vi.hoisted(() => ({ points: [] }));

vi.mock('../../src/sim/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  simulateSweep: () => ({ points: sweep.points, events: [], peakHp: 300, wear: {} }),
  computeTuningScore: () => ({ score: 80 }),
}));

const { evaluateJob } = await import('../../src/ui/career/evaluate.js');
const { customerCar } = await import('../../src/ui/career/cars.js');

/** @type {import('../../src/ui/career/jobs.js').Job} */
const job = {
  id: 'duty-test', tier: 1,
  customer: { name: 'Test', car: 'B58', color: 'silver' },
  says: 'It runs out of fuel up top.', wants: 'Make the injectors keep up.', work: [],
  car: { preset: 'b58-m1' }, needs: {}, minRep: 0, pay: 100, rep: 1,
  checks: [{ type: 'maxDuty', max: 90, kind: 'request', label: 'Injectors keep up' }],
  hint: 'Try again.', teaches: 'Read the busier bank.',
};

const grade = (points) => {
  sweep.points = points;
  const [result] = evaluateJob(job, customerCar(job.car)).results;
  return result;
};

describe('the maxDuty check', () => {
  it('fails on a port kit at its limit while the direct bank has room', () => {
    const r = grade([{ rpm: 5000, duty: 20, portDuty: 96 }]);
    expect(r.pass).toBe(false);
    expect(r.measured).toBe('peak 96% duty; 90% allowed');
  });

  it('passes when neither bank passes the limit', () => {
    expect(grade([{ rpm: 5000, duty: 80, portDuty: 60 }]).pass).toBe(true);
  });

  it('reads the direct bank alone when there is no kit', () => {
    const r = grade([{ rpm: 5000, duty: 40 }, { rpm: 6000, duty: 93 }]);
    expect(r.pass).toBe(false);
    expect(r.measured).toBe('peak 93% duty; 90% allowed');
  });
});
