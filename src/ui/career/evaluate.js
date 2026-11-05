/**
 * Grading a job: the car as handed back, run on the simulator.
 *
 * Nothing here estimates. The customer's car is pulled exactly as the dyno pulls it
 * (same inputs, via pullInputs), idled exactly as LIVE idles it (idleTest), and every
 * criterion reads what that pull and that idle actually did. So the only way to pass is
 * to have fixed the car, and a tune that makes big power by knocking is graded as the
 * danger it is, not as a success.
 */

import { OCTANE_OPTS, computeTuningScore, simulateSweep } from '../../sim/index.js';
import { pullInputs } from '../state/pullInputs.js';

import { customerCar, idleTest } from './cars.js';

/** @typedef {import('./jobs.js').Job} Job */
/** @typedef {import('./jobs.js').Criterion} Criterion */

/**
 * Wear per full-throttle pull, in health points, past which a tune is destroying the
 * engine rather than using it. A healthy factory pull costs well under one point.
 */
const DAMAGING_WEAR = 3;

/** Reference pulls (a healthy stock car) are the same every time: worked out once. */
const referenceCache = new Map();
/** @param {import('./cars.js').CarSpec} spec */
function referenceHp(spec) {
  const key = JSON.stringify({ p: spec.preset ?? null });
  if (!referenceCache.has(key)) referenceCache.set(key, simulateSweep(pullInputs(customerCar(spec)).args).peakHp);
  return referenceCache.get(key);
}

/**
 * @typedef {object} CheckResult
 * @property {Criterion} check
 * @property {boolean} pass
 * @property {string} measured what the car actually did, in words and numbers
 */

/**
 * Where the player can see each check for themselves, before handing the car back. A
 * check that fails without saying how to reproduce it reads as the game being unfair.
 */
export const HOW_TO_SEE = {
  events: 'DYNO › PULL LOG lists each of these, and each entry names the page that fixes it.',
  mixture: 'DYNO › CURVES: the AFR chart, commanded against actual. The gap at full throttle is what the customer’s gauge shows.',
  minHp: 'DYNO › CURVES: the peak wheel horsepower.',
  maxEgt: 'DYNO › DATALOG: exhaust temperature at each RPM.',
  maxDuty: 'DYNO › DATALOG: injector duty at each RPM.',
  untouched: 'This table was changed from how the car came in. The customer wants the cause fixed instead.',
  idle: 'LIVE: START the engine and let it warm up, then STOP and START it again. The customer judges a warm restart and the idle after it settles.',
  score: 'DYNO › SCORE: the Tuning Score of the last pull.',
  fuelIs: 'BUILD › FUEL SYSTEM: the fuel the customer asked for.',
  naOnly: 'BUILD › INDUCTION: no turbo, supercharger or nitrous.',
  maxRedline: 'BUILD › ENGINE: the rev limit.',
};

/**
 * @param {Criterion} c
 * @param {{r: any, state: any, delivered: any, idle: () => ReturnType<typeof idleTest>, score: number}} ctx
 * @returns {CheckResult}
 */
function check(c, ctx) {
  const { r } = ctx;
  const wot = r.points.filter((p) => p.openLoop && !(p.nitrousLbMin > 0));
  switch (c.type) {
    case 'events': {
      const hit = r.events.filter((e) => c.types.includes(e.type));
      return { check: c, pass: hit.length === 0, measured: hit.length ? hit.map((e) => e.msg).join('; ') : 'none in the log' };
    }
    case 'mixture': {
      const worst = wot.reduce((w, p) => {
        const err = p.afr / p.afrCommanded - 1;
        return Math.abs(err) > Math.abs(w.err) ? { err, rpm: p.rpm } : w;
      }, { err: 0, rpm: 0 });
      const pct = worst.err * 100;
      return {
        check: c, pass: Math.abs(pct) <= c.pct,
        measured: `worst ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% (${pct >= 0 ? 'lean' : 'rich'}) at ${worst.rpm} RPM; within ${c.pct}% needed`,
      };
    }
    case 'minHp': {
      const need = c.hp ?? Math.round(referenceHp(c.hpOf.spec) * c.hpOf.share);
      return { check: c, pass: r.peakHp >= need, measured: `${Math.round(r.peakHp)} whp; ${need} needed` };
    }
    case 'maxEgt': {
      const egt = Math.max(...r.points.map((p) => p.egt));
      return { check: c, pass: egt <= c.max, measured: `peak ${Math.round(egt)} °C; ${c.max} °C allowed` };
    }
    case 'maxDuty': {
      const duty = Math.max(...r.points.map((p) => p.duty));
      return { check: c, pass: duty <= c.max, measured: `peak ${Math.round(duty)}% duty; ${c.max}% allowed` };
    }
    case 'untouched': {
      const a = ctx.state.tune[c.table];
      const b = ctx.delivered.tune[c.table];
      const moved = Math.max(...a.flatMap((row, i) => row.map((v, j) => Math.abs(v - b[i][j]))));
      return { check: c, pass: moved <= c.tol, measured: moved <= c.tol ? 'left as delivered' : `changed by up to ${moved.toFixed(1)}` };
    }
    case 'idle': {
      const t = ctx.idle();
      const off = Math.abs(t.meanRpm - t.targetRpm);
      const pass = t.running && t.swingRpm <= c.swing && off <= c.offset;
      return {
        check: c, pass,
        measured: !t.running ? 'stalled on a warm restart'
          : `settled at ${Math.round(t.meanRpm)} RPM (target ${Math.round(t.targetRpm)}), swinging ${Math.round(t.swingRpm)} RPM; up to ${c.swing} allowed`,
      };
    }
    case 'fuelIs': {
      const idx = ctx.state.build.octaneIdx;
      return { check: c, pass: idx === c.octaneIdx, measured: `on ${OCTANE_OPTS[idx]?.label ?? '?'}; ${OCTANE_OPTS[c.octaneIdx].label} asked for` };
    }
    case 'naOnly': {
      const b = ctx.state.build;
      const adders = [b.turboOn && 'a turbo', b.blowerId && 'a supercharger', b.nitrous && 'nitrous'].filter(Boolean);
      return { check: c, pass: adders.length === 0, measured: adders.length ? `has ${adders.join(' and ')}` : 'naturally aspirated' };
    }
    case 'maxRedline': {
      const rl = ctx.state.build.engineConfig.redline;
      return { check: c, pass: rl <= c.max, measured: `rev limit ${rl} RPM; ${c.max} allowed` };
    }
    case 'score':
      return { check: c, pass: ctx.score >= c.min, measured: `Tuning Score ${ctx.score}; ${c.min} needed` };
    default:
      return { check: c, pass: true, measured: '' };
  }
}

/**
 * @typedef {object} Verdict
 * @property {'pass'|'partial'|'fail'|'unsafe'} verdict
 * @property {CheckResult[]} results
 * @property {number} pay what the customer pays, before the shop's own bonuses
 * @property {number} repair what a damaged engine costs the shop
 * @property {number} rep reputation change
 * @property {number} peakHp
 * @property {number} score Tuning Score
 * @property {number} health what one hard pull on the handed-back tune leaves of a healthy engine, 0-100
 * @property {string} line what the customer says
 */

/**
 * Grades the car on the lift against the job.
 *
 * @param {Job} job
 * @param {any} handedBack the store state: the car as handed back
 * @returns {Verdict}
 */
export function evaluateJob(job, handedBack) {
  const delivered = customerCar(job.car);
  // Graded the same way for everyone: a full-throttle pull in the customer's own
  // conditions, whatever load, weather or switches the bench was last left on.
  const d = delivered.session;
  const state = { ...handedBack, session: { ...handedBack.session, loadKpa: 100, env: d.env, faults: d.faults, liveAux: d.liveAux } };
  const r = simulateSweep(pullInputs(state).args);
  const score = computeTuningScore(r).score;
  let idleCache = null;
  const idle = () => (idleCache ??= idleTest(state));
  const results = job.checks.map((c) => check(c, { r, state, delivered, idle, score }));
  // Judged on the calibration handed back, not on the pulls it took to find the fault:
  // a customer's car often arrives doing damage (that is why it came in), and a
  // diagnosis pull on it is not the shop's fault. What is the shop's fault is sending it
  // home on a tune that is still wearing the engine out every time it is driven hard.
  const wearPerPull = Math.max(r.wear?.piston ?? 0, r.wear?.bearing ?? 0, r.wear?.valve ?? 0);
  const health = Math.max(0, 100 - wearPerPull);
  const damaged = wearPerPull > DAMAGING_WEAR;
  const failed = (kind) => results.filter((x) => x.check.kind === kind && !x.pass);
  const unsafe = failed('safety').length > 0 || damaged;
  const complaint = failed('complaint').length === 0;
  const request = failed('request').length === 0;

  /** @type {Verdict['verdict']} */
  const verdict = unsafe ? 'unsafe' : !complaint ? 'fail' : !request ? 'partial' : 'pass';
  const repair = damaged ? Math.round(wearPerPull * 60) : 0;
  const quality = verdict === 'pass' ? 1 + Math.max(0, score - 90) / 100 : 1;
  const pay = verdict === 'pass' ? Math.round(job.pay * quality)
    : verdict === 'partial' ? Math.round(job.pay * 0.5)
      : 0;
  // A car that comes back unfixed stays in the shop to be worked on again, so it pays
  // nothing and costs a little standing; an unsafe one leaves, and costs a lot.
  const rep = verdict === 'pass' ? job.rep : verdict === 'partial' ? 1 : verdict === 'fail' ? -2 : -8;
  const line = verdict === 'pass' ? 'That’s it. That’s exactly what I wanted. Thank you.'
    : verdict === 'partial' ? 'It’s better, and I’ll pay for what you did, but it isn’t everything I asked for.'
      : verdict === 'unsafe' ? (damaged ? 'Something in the engine sounds wrong now. I’m not paying for this.' : 'My friend looked at your log. You were going to send me home with that?')
        : job.hint;
  return { verdict, results, pay, repair, rep, peakHp: r.peakHp, score, health, line };
}
