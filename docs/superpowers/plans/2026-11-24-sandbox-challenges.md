# Sandbox Challenges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give SANDBOX goals to play for. Five challenges, each on its own factory car, are graded by career mode's grader. A passed challenge stays ticked. There is no money and no reputation.

**Architecture:** `career/evaluate.js` is split. The pull-and-check part becomes an exported `gradeChecks`, and `evaluateJob` keeps pay, reputation and lines on top of it. Challenges are data in `src/ui/challenges/challenges.js`; each one's target was measured from a scripted solution, which the tests replay. The store gains:
- the active challenge and its last grade, in `session`, which is not saved;
- the passed ids, in `challenges`, saved under their own storage key.

HOME gains a CHALLENGES section. While a challenge is active, AppShell's banner slot shows a ChallengeBar.

**Tech Stack:** React 18.3, Vite, Vitest + Testing Library (jsdom 25), CSS Modules, JSDoc-typed JS checked by `tsc --noEmit`, ESLint with `--max-warnings 0`.

**Spec:** `docs/superpowers/specs/2026-11-17-sandbox-challenges-design.md`

## Global Constraints

- Node 22 for every command: prefix with `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null &&`.
- Gates before the PR: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, all on Node 22.
- Pipes hide vitest's exit code. Redirect output to a file and `echo $?`. Do not pipe into `tail`.
- Never write `#` followed by a digit anywhere under `src/ui`; a colour guard test fails on it. Write "issue 63", not "#63".
- No new criterion types. Challenges use the 11 that `career/jobs.js` already defines.
- Career verdicts, pay and reputation must not change, and `tests/career.test.js` passes untouched.
- No physics change, and no fingerprint change (`tests/fixtures/fingerprint.sha256` untouched).
- Styling from tokens only (`var(--…)`), in CSS Modules. No inline colours.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Match the surrounding code's style: JSDoc on exports, comments that say why, no TypeScript files.

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/ui/career/evaluate.js` | modify | `gradeChecks` (new, exported) and `evaluateJob` (calls it) |
| `src/ui/career/cars.js` | modify | `customerCar(spec, mode = 'career')` |
| `src/ui/challenges/challenges.js` | create | `CHALLENGES`, `challengeById`, `Challenge` typedef |
| `src/storage.js` | modify | `loadChallenges`, `saveChallenges` |
| `src/ui/state/initialState.js` | modify | `session.challenge`, `session.challengeGrade`, top-level `challenges` |
| `src/ui/state/reducer.js` | modify | `START_CHALLENGE`, `LEAVE_CHALLENGE`, `CHALLENGE_GRADED`, `RESTORE_CHALLENGES`; APPLY_PRESET and onTheBay clear the challenge; stash fields |
| `src/ui/state/StoreProvider.jsx` | modify | `useChallenges()` |
| `src/ui/routing.js`, `src/ui/commands.js` | modify | `dash/challenges` section and its palette label |
| `src/ui/screens/dash/ChallengesScreen.jsx` + `.module.css` | create | HOME › CHALLENGES |
| `src/ui/challenges/ChallengeBar.jsx` + `.module.css` | create | the banner while a challenge is active |
| `src/ui/EcuLab.jsx` | modify | mounts the section and the bar; grade and leave handlers; load and save effects |
| `tests/grade-checks.test.js` | create | `gradeChecks` matches `evaluateJob`; `customerCar` mode |
| `tests/challengeSolutions.js` | create | scripted solutions |
| `tests/challenges.test.js` | create | every challenge fails as delivered and passes when solved |
| `tests/challenge-store.test.js` | create | storage round trip; reducer actions |
| `tests/commands.test.js` | modify | page list gains `dash/challenges` |
| `tests/ui/dash-screens.test.jsx` | modify | ChallengesScreen mounted on its own |
| `tests/ui/challenges-app.test.jsx` | create | the whole app: start, grade, leave, ticks |

---

### Task 1: Split career grading into `gradeChecks`; `customerCar` takes a mode

**Files:**
- Modify: `src/ui/career/evaluate.js` (the `Verdict` typedef through the end of `evaluateJob`)
- Modify: `src/ui/career/cars.js` (`customerCar`)
- Test: `tests/grade-checks.test.js`

**Interfaces:**
- Produces:
  - `gradeChecks(checks: Criterion[], carSpec: CarSpec, handedBack: StoreState) => Grade`, where `Grade = {verdict: 'pass'|'partial'|'fail'|'unsafe', results: CheckResult[], peakHp: number, score: number, health: number, wearPerPull: number, damaged: boolean}`.
  - `customerCar(spec: CarSpec, mode?: 'career'|'sandbox') => StoreState`, which sets `session.mode` to `mode` (default `'career'`).
  - Both are exported. Later tasks import `gradeChecks` from `src/ui/career/evaluate.js` and `customerCar` from `src/ui/career/cars.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/grade-checks.test.js`:

```js
/**
 * `gradeChecks` is career's grading without the shop: the pull, the idle and every
 * check, and the verdict they add up to. Career's jobs and the sandbox's challenges
 * both grade through it, so a job must grade exactly as it did before the split.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { customerCar } from '../src/ui/career/cars.js';
import { evaluateJob, gradeChecks } from '../src/ui/career/evaluate.js';
import { jobById } from '../src/ui/career/jobs.js';

import { STORY_FIXES } from './careerFixes.js';

/** The fields a job's verdict and a bare grade share. */
const shared = (v) => ({ verdict: v.verdict, results: v.results, peakHp: v.peakHp, score: v.score, health: v.health });

describe('gradeChecks', () => {
  it('grades a fixed customer car exactly as evaluateJob does', () => {
    const job = jobById('intake-maf');
    const fixed = STORY_FIXES[job.id](customerCar(job.car));
    const g = gradeChecks(job.checks, job.car, fixed);
    expect(g.verdict).toBe('pass');
    expect(shared(g)).toEqual(shared(evaluateJob(job, fixed)));
  });

  it('calls a knocking tune unsafe, as evaluateJob does', () => {
    const job = jobById('turbo-kit');
    const s = customerCar(job.car);
    const knocking = { ...s, tune: { ...s.tune, afr: s.tune.afr.map((row, ri) => row.map((x) => (S.layoutById(s.tune.layout).afr.load[ri] > 100 ? 11.8 : x))) } };
    const g = gradeChecks(job.checks, job.car, knocking);
    expect(g.verdict).toBe('unsafe');
    expect(shared(g)).toEqual(shared(evaluateJob(job, knocking)));
  });

  it('reports the wear one pull costs, and whether that is damage', () => {
    const job = jobById('intake-maf');
    const g = gradeChecks(job.checks, job.car, customerCar(job.car));
    expect(g.wearPerPull).toBeGreaterThanOrEqual(0);
    expect(g.health).toBeCloseTo(Math.max(0, 100 - g.wearPerPull), 9);
    expect(g.damaged).toBe(g.wearPerPull > 3);
  });
});

describe('customerCar', () => {
  it('puts the car on the career bench unless told otherwise', () => {
    expect(customerCar({ preset: 'ls1' }).session.mode).toBe('career');
    expect(customerCar({ preset: 'ls1' }, 'sandbox').session.mode).toBe('sandbox');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/grade-checks.test.js > /tmp/t1.log 2>&1; echo "exit $?"; tail -30 /tmp/t1.log`
Expected: exit 1. `gradeChecks` is not exported (a TypeError: gradeChecks is not a function), and the mode test fails because `session.mode` is `'career'`.

- [ ] **Step 3: Add `mode` to `customerCar`**

In `src/ui/career/cars.js`, change the JSDoc and signature of `customerCar` and the line that sets the mode:

```js
/**
 * The store state with the customer's car on the lift.
 *
 * @param {CarSpec} spec
 * @param {'career'|'sandbox'} [mode] whose bench it goes on: a customer's, or the
 *   sandbox's when a challenge brings the car (challenges/challenges.js)
 * @returns {StoreState}
 */
export function customerCar(spec, mode = 'career') {
```

and in its return value, replace `mode: 'career' },` with `mode },`.

- [ ] **Step 4: Split `evaluateJob`**

In `src/ui/career/evaluate.js`, replace everything from the `Verdict` typedef's opening `/**` through the end of `evaluateJob` with the following. Everything above the `Verdict` typedef stays as it is: `DAMAGING_WEAR`, `referenceHp`, `CheckResult`, `HOW_TO_SEE` and `check()`.

```js
/**
 * @typedef {object} Grade
 * @property {'pass'|'partial'|'fail'|'unsafe'} verdict
 * @property {CheckResult[]} results
 * @property {number} peakHp
 * @property {number} score Tuning Score
 * @property {number} health what one hard pull on the handed-back tune leaves of a healthy engine, 0-100
 * @property {number} wearPerPull health points one hard pull costs the worst-worn component
 * @property {boolean} damaged whether that wear is a tune destroying the engine (`DAMAGING_WEAR`)
 */

/**
 * Grades a car against a list of checks on the simulator, and says what they add up
 * to. Career's jobs (evaluateJob, below) and the sandbox's challenges
 * (challenges/challenges.js) both grade through here; only the shop's side of it,
 * the money and the customer, is career's alone.
 *
 * @param {Criterion[]} checks
 * @param {import('./cars.js').CarSpec} carSpec the car as it came in: its conditions are
 *   the ones it is graded in, and `untouched` checks compare against its tables
 * @param {any} handedBack the store state: the car as handed back
 * @returns {Grade}
 */
export function gradeChecks(checks, carSpec, handedBack) {
  const delivered = customerCar(carSpec);
  // Graded the same way for everyone: a full-throttle pull in the car's own
  // conditions, whatever load, weather or switches the bench was last left on.
  const d = delivered.session;
  const state = { ...handedBack, session: { ...handedBack.session, loadKpa: 100, env: d.env, faults: d.faults, liveAux: d.liveAux } };
  const r = simulateSweep(pullInputs(state).args);
  const score = computeTuningScore(r).score;
  let idleCache = null;
  const idle = () => (idleCache ??= idleTest(state));
  const results = checks.map((c) => check(c, { r, state, delivered, idle, score }));
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

  /** @type {Grade['verdict']} */
  const verdict = unsafe ? 'unsafe' : !complaint ? 'fail' : !request ? 'partial' : 'pass';
  return { verdict, results, peakHp: r.peakHp, score, health, wearPerPull, damaged };
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
 * Grades the car on the lift against the job, and settles up.
 *
 * @param {Job} job
 * @param {any} handedBack the store state: the car as handed back
 * @returns {Verdict}
 */
export function evaluateJob(job, handedBack) {
  const { verdict, results, peakHp, score, health, wearPerPull, damaged } = gradeChecks(job.checks, job.car, handedBack);
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
  return { verdict, results, pay, repair, rep, peakHp, score, health, line };
}
```

Use the file's existing curly apostrophes (’) in the customer lines exactly as they are now.

- [ ] **Step 5: Run the new test and career's tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/grade-checks.test.js tests/career.test.js tests/ui/career-app.test.jsx > /tmp/t1.log 2>&1; echo "exit $?"; tail -15 /tmp/t1.log`
Expected: exit 0, all pass.

- [ ] **Step 6: Lint and typecheck**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run -s lint > /tmp/l.log 2>&1; echo "lint $?"; npm run -s typecheck > /tmp/tc.log 2>&1; echo "tsc $?"; tail -20 /tmp/l.log /tmp/tc.log`
Expected: `lint 0`, `tsc 0`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/career/evaluate.js src/ui/career/cars.js tests/grade-checks.test.js
git commit -m "Split career grading into gradeChecks; customerCar takes a mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The challenges, and the solutions that set their targets

**Files:**
- Create: `src/ui/challenges/challenges.js`
- Create: `tests/challengeSolutions.js`
- Test: `tests/challenges.test.js`

**Interfaces:**
- Consumes:
  - `gradeChecks(checks, carSpec, handedBack)` and its `Grade`, from Task 1;
  - `customerCar(spec, mode?)`;
  - `SAFE` and `withMods` from `src/ui/career/criteria.js`;
  - from `tests/careerFixes.js`: `pull`, `setBuild`, `veFix`, `mafFix`, `scaleFix`, `sparkClean`.
- Produces:
  - `CHALLENGES: Challenge[]`.
  - `challengeById(id: string) => Challenge|undefined`.
  - `Challenge = {id: string, title: string, goal: string, carName: string, car: CarSpec, checks: Criterion[], teaches: string}`.
  - The ids, in this order: `'pump-gas-v8'`, `'breathe'`, `'big-turbo-91'`, `'e85-gti'`, `'mile-high'`. The titles are `'Pump-gas V8'`, `'Bolt-ons, then the tune'`, `'Big turbo, cheap fuel'`, `'E85 hatch'` and `'A mile high'`.

The targets below were measured on the simulator before this plan was written. Each challenge was graded on the car as delivered and on its scripted solution (whp is wheel horsepower):

| id | as delivered | solved |
|---|---|---|
| pump-gas-v8 | fail: 325 whp | pass: 368 whp, 66% duty |
| breathe | unsafe: lean, 311 whp, score 83 | pass: 331 whp, score 100 |
| big-turbo-91 | fail: 302 whp, on 93 | pass: 354 whp, 834 °C |
| e85-gti | fail: 180 whp, on 93 | pass: 239 whp, health 98 |
| mile-high | fail: 211 whp | pass: 245 whp |

- [ ] **Step 1: Write the scripted solutions**

Create `tests/challengeSolutions.js`:

```js
/**
 * How a tuner solves each sandbox challenge, using only what the game gives the player:
 * BUILD's parts and fuel, RESET ALL TO STOCK for a calibration generated for the
 * hardware on the bench, the MAF scalar and VE corrections the pull log names, the
 * injector size on the part, and spark pulled a degree at a time until the log shows
 * no knock. Each challenge's target is this solution's result, rounded down, so a
 * reasonable tune passes without retracing it step by step.
 */

import * as S from '../src/sim/index.js';
import { ACTIONS, reducer } from '../src/ui/state/reducer.js';

import { mafFix, scaleFix, setBuild, sparkClean, veFix } from './careerFixes.js';

/** RESET ALL TO STOCK: a calibration generated for the hardware as it stands. */
const reset = (st) => {
  const c = S.stockCalibrationFor(st.build);
  return reducer(st, { type: ACTIONS.RESET_TO_STOCK, ve: c.ve, timing: c.timing, afr: c.afr, mafScalar: c.mafScalar, layout: c.layout, ecu: c.ecu });
};
/** Every point of the boost curve that has boost, raised by `psi`. */
const moreBoost = (st, psi) => setBuild(st, { boostCurve: st.build.boostCurve.map((v) => (v > 0 ? Math.min(25, v + psi) : v)) });
/** Scaling, then airflow, then mixture: the order a tuner works in. */
const airAndFuel = (st) => veFix(mafFix(veFix(mafFix(scaleFix(st)), 2)), 2);
const boltOns = (b) => ({ mods: { ...b.mods, intake: true, exhaust: true, headers: true } });

/** @type {Record<string, (s: any) => any>} keyed by challenge id; takes the car as delivered */
export const CHALLENGE_SOLUTIONS = {
  // Bolt-ons, and 440 cc injectors (INJECTOR_OPTS[1]) so the factory 315s stop running out of time.
  'pump-gas-v8': (s) => sparkClean(airAndFuel(setBuild(s, { ...boltOns(s.build), injIdx: 1 }))),
  // The bolt-ons are already on: correct the airflow from the log, then the spark.
  breathe: (s) => sparkClean(veFix(mafFix(veFix(mafFix(s), 2)), 2)),
  // 91, the Large compressor (COMPRESSOR_OPTS[2]) and 8 psi more, then a calibration for it.
  'big-turbo-91': (s) => sparkClean(reset(moreBoost(setBuild(s, { octaneIdx: 0, compressorIdx: 2 }), 8))),
  // E85 (OCTANE_OPTS[3]), 850 cc injectors (INJECTOR_OPTS[4]) and 6 psi more.
  'e85-gti': (s) => sparkClean(airAndFuel(reset(moreBoost(setBuild(s, { octaneIdx: 3, injIdx: 4 }), 6)))),
  // 3 psi more puts back what the altitude took.
  'mile-high': (s) => sparkClean(reset(moreBoost(s, 3))),
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/challenges.test.js`:

```js
/**
 * The sandbox challenges, held to the real simulator the way career.test.js holds the
 * customers: each one fails on the car as it is handed over, and passes once it is
 * solved the way a tuner would solve it (challengeSolutions.js). One that passes
 * untouched is no challenge; one nothing can pass is a wall.
 */

import { describe, expect, it } from 'vitest';

import { presetById } from '../src/sim/index.js';
import { customerCar } from '../src/ui/career/cars.js';
import { SAFE } from '../src/ui/career/criteria.js';
import { gradeChecks } from '../src/ui/career/evaluate.js';
import { CHALLENGES, challengeById } from '../src/ui/challenges/challenges.js';

import { CHALLENGE_SOLUTIONS } from './challengeSolutions.js';

const failures = (g) => g.results.filter((x) => !x.pass).map((x) => `${x.check.label}: ${x.measured}`);

describe('the challenge list', () => {
  it('has five challenges with distinct ids, each findable by id', () => {
    expect(CHALLENGES).toHaveLength(5);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    for (const c of CHALLENGES) expect(challengeById(c.id)).toBe(c);
    expect(challengeById('nope')).toBeUndefined();
  });

  it.each(CHALLENGES.map((c) => [c.id, c]))('%s runs on a real preset, keeps the engine safe, and has a solution', (_id, c) => {
    expect(presetById(c.car.preset)).toBeTruthy();
    for (const safe of SAFE) expect(c.checks).toContain(safe);
    expect(c.checks.filter((x) => x.kind === 'complaint')).toHaveLength(1);
    expect(CHALLENGE_SOLUTIONS[c.id]).toBeTypeOf('function');
  });
});

describe.each(CHALLENGES.map((c) => [c.id, c]))('%s', (_id, c) => {
  it('does not pass on the car as delivered', () => {
    const g = gradeChecks(c.checks, c.car, customerCar(c.car, 'sandbox'));
    expect(g.verdict).not.toBe('pass');
  }, 30_000);

  it('passes once solved', () => {
    const solved = CHALLENGE_SOLUTIONS[c.id](customerCar(c.car, 'sandbox'));
    const g = gradeChecks(c.checks, c.car, solved);
    expect({ verdict: g.verdict, failing: failures(g) }).toEqual({ verdict: 'pass', failing: [] });
  }, 30_000);
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/challenges.test.js > /tmp/t2.log 2>&1; echo "exit $?"; tail -20 /tmp/t2.log`
Expected: exit 1, because `src/ui/challenges/challenges.js` cannot be resolved.

- [ ] **Step 4: Write the challenges**

Create `src/ui/challenges/challenges.js`:

```js
/**
 * SANDBOX's challenges: a goal and a car to reach it on, graded by career's grader
 * (gradeChecks in career/evaluate.js) with no shop, no money and no customer.
 *
 * Each brings its own car, a preset from the catalogue with anything already done to
 * it, so a target can be sized to the engine and two players' results mean the same
 * thing. The headline goal is the one `complaint` check, the rules are `request`
 * checks, and every challenge carries career's SAFE checks: a tune that knocks, runs
 * lean or wears the engine out does not pass, whatever it makes.
 *
 * Every target was set from a worked solution and is held to it by
 * tests/challenges.test.js: each challenge fails as delivered and passes once solved
 * (tests/challengeSolutions.js).
 */

import { SAFE, withMods } from '../career/criteria.js';

/**
 * @typedef {object} Challenge
 * @property {string} id
 * @property {string} title short, for the card and the bar
 * @property {string} goal one or two sentences: what to achieve
 * @property {string} carName what the card calls the car
 * @property {import('../career/cars.js').CarSpec} car
 * @property {import('../career/jobs.js').Criterion[]} checks
 * @property {string} teaches shown once it is passed
 */

/** @type {Challenge[]} */
export const CHALLENGES = [
  {
    id: 'pump-gas-v8',
    title: 'Pump-gas V8',
    carName: 'GM LS6 (Cadillac CTS-V)',
    goal: 'Make 360 wheel horsepower on 91 octane, with the injectors under 85% duty.',
    car: { preset: 'ls6' },
    checks: [
      ...SAFE,
      { type: 'minHp', kind: 'complaint', hp: 360, label: '360 wheel horsepower' },
      { type: 'fuelIs', kind: 'request', octaneIdx: 0, label: 'Runs on 91 octane' },
      { type: 'maxDuty', kind: 'request', max: 85, label: 'Injectors under 85% duty' },
    ],
    teaches: 'Bolt-ons find the power, but the factory injectors run out of time to spray the fuel it needs: duty is how much of each cycle an injector spends open. Bigger injectors, scaled in the ECU, give the headroom back.',
  },
  {
    id: 'breathe',
    title: 'Bolt-ons, then the tune',
    carName: 'GM LS1 (C5 Corvette)',
    goal: 'It comes with an intake, exhaust and headers fitted and the factory tune still on it. Make 325 wheel horsepower with a Tuning Score of 95, naturally aspirated, at the factory rev limit.',
    car: { preset: 'ls1', build: withMods({ intake: true, exhaust: true, headers: true }) },
    checks: [
      ...SAFE,
      { type: 'minHp', kind: 'complaint', hp: 325, label: '325 wheel horsepower' },
      { type: 'score', kind: 'request', min: 95, label: 'Tuning Score of at least 95' },
      { type: 'naOnly', kind: 'request', label: 'No turbo, supercharger or nitrous' },
      { type: 'maxRedline', kind: 'request', max: 6000, label: 'Rev limit no higher than 6000 RPM' },
    ],
    teaches: 'Parts that help an engine breathe change how much air it takes in, and the ECU only knows what its tables tell it. The power was in the parts all along; the tune is what lets the engine use it without running lean.',
  },
  {
    id: 'big-turbo-91',
    title: 'Big turbo, cheap fuel',
    carName: 'BMW B58B30M1',
    goal: 'Make 350 wheel horsepower on 91 octane, with exhaust temperature under 850 °C.',
    car: { preset: 'b58-m1' },
    checks: [
      ...SAFE,
      { type: 'minHp', kind: 'complaint', hp: 350, label: '350 wheel horsepower' },
      { type: 'fuelIs', kind: 'request', octaneIdx: 0, label: 'Runs on 91 octane' },
      { type: 'maxEgt', kind: 'request', max: 850, label: 'Exhaust under 850 °C' },
    ],
    teaches: 'Boost makes power until the compressor runs out of map or the exhaust runs out of temperature. A bigger compressor moves the first limit; the second is why the last few psi are rarely worth it on pump gas.',
  },
  {
    id: 'e85-gti',
    title: 'E85 hatch',
    carName: 'VW EA888.3 (GTI)',
    goal: 'Make 230 wheel horsepower on E85, with the injectors under 85% duty.',
    car: { preset: 'ea888-gti' },
    checks: [
      ...SAFE,
      { type: 'minHp', kind: 'complaint', hp: 230, label: '230 wheel horsepower' },
      { type: 'fuelIs', kind: 'request', octaneIdx: 3, label: 'Runs on E85' },
      { type: 'maxDuty', kind: 'request', max: 85, label: 'Injectors under 85% duty' },
    ],
    teaches: 'E85 resists knock far better than pump gas, so it takes more boost and more spark, but it needs about a third more fuel for the same air. The injectors and their scaling come first.',
  },
  {
    id: 'mile-high',
    title: 'A mile high',
    carName: 'BMW N54',
    goal: 'The car lives at 1,600 m, where the air is thinner. Get it back to 240 wheel horsepower.',
    car: { preset: 'n54', env: { altitudeM: 1600 } },
    checks: [
      ...SAFE,
      { type: 'minHp', kind: 'complaint', hp: 240, label: '240 wheel horsepower' },
    ],
    teaches: 'Thinner air puts less of it in every cylinder, turbo or not. A turbo car can win it back with boost: a few psi more restores what the altitude took, as long as the compressor has room.',
  },
];

/** @param {string} id @returns {Challenge|undefined} */
export const challengeById = (id) => CHALLENGES.find((c) => c.id === id);
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/challenges.test.js > /tmp/t2.log 2>&1; echo "exit $?"; tail -20 /tmp/t2.log`
Expected: exit 0, 16 tests pass (1 list test, 5 per-challenge list checks, and 10 delivered/solved).

If a "passes once solved" test fails by a few whp, the simulator has moved since this plan was measured. Report the measured numbers as DONE_WITH_CONCERNS; do not lower a target on your own.

- [ ] **Step 6: Lint and typecheck**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run -s lint > /tmp/l.log 2>&1; echo "lint $?"; npm run -s typecheck > /tmp/tc.log 2>&1; echo "tsc $?"; tail -20 /tmp/l.log /tmp/tc.log`
Expected: `lint 0`, `tsc 0`.

If tsc rejects a check object literal against `Criterion` (for example `kind` widening to `string`), add `/** @type {Challenge[]} */` casts the way `criteria.js` does: `/** @type {Criterion} */ ({ ... })`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/challenges/challenges.js tests/challengeSolutions.js tests/challenges.test.js
git commit -m "Five sandbox challenges, each held to a worked solution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Save the ticks, and keep the active challenge in the store

**Files:**
- Modify: `src/storage.js` (after `saveShop`, at the end of the file)
- Modify: `src/ui/state/initialState.js` (the `SessionState` and `StoreState` typedefs, and `makeInitialState`'s return)
- Modify: `src/ui/state/reducer.js`. The places:
  - `ACTIONS`;
  - the action typedefs near the career ones;
  - the `APPLY_PRESET` case;
  - new cases after `CAREER_UPDATE`;
  - `SANDBOX_SESSION_FIELDS`;
  - `onTheBay`;
  - the `StoreAction` union typedef, wherever the other actions' typedefs are listed in it.
- Modify: `src/ui/state/StoreProvider.jsx` (add `useChallenges` after `useCareer`)
- Test: `tests/challenge-store.test.js`

**Interfaces:**
- Consumes:
  - `customerCar(spec, 'sandbox')` (Task 1);
  - `CHALLENGES`, `challengeById` (Task 2);
  - `CheckResult` from `career/evaluate.js`.
- Produces:
  - `loadChallenges(): Promise<{passed: string[]}>`.
  - `saveChallenges(c: {passed: string[]}): Promise<boolean>`.
  - In the store state:
    - `state.challenges: {passed: string[]}`;
    - `state.session.challenge: string|null`;
    - `state.session.challengeGrade: {id: string, verdict: 'pass'|'partial'|'fail'|'unsafe', results: CheckResult[]}|null`.
  - Actions:
    - `ACTIONS.START_CHALLENGE` `{id, car}`, where `car` is a StoreState from `customerCar(spec, 'sandbox')`;
    - `ACTIONS.LEAVE_CHALLENGE`;
    - `ACTIONS.CHALLENGE_GRADED` `{id, verdict, results}`;
    - `ACTIONS.RESTORE_CHALLENGES` `{challenges}`.
  - `useChallenges(): [{passed: string[]}, dispatch]`.

- [ ] **Step 1: Write the failing test**

Create `tests/challenge-store.test.js`:

```js
/**
 * Challenges in the store: the ticks that are saved, and the challenge on the bench
 * that is not. A challenge's car replaces the bench without touching SANDBOX's saved
 * pull stats, and anything that swaps the engine out ends the challenge.
 */

import { describe, expect, it } from 'vitest';

import { loadChallenges, saveChallenges } from '../src/storage.js';
import { applyPreset, presetById } from '../src/sim/index.js';
import { customerCar } from '../src/ui/career/cars.js';
import { challengeById } from '../src/ui/challenges/challenges.js';
import { makeInitialState } from '../src/ui/state/initialState.js';
import { ACTIONS, reducer } from '../src/ui/state/reducer.js';

const start = (state, id) => reducer(state, { type: ACTIONS.START_CHALLENGE, id, car: customerCar(challengeById(id).car, 'sandbox') });

describe('challenge storage', () => {
  it('round-trips the passed ids', async () => {
    await saveChallenges({ passed: ['mile-high', 'breathe'] });
    expect(await loadChallenges()).toEqual({ passed: ['mile-high', 'breathe'] });
  });

  it('reads a malformed save as nothing passed', async () => {
    await saveChallenges(/** @type {any} */ ({ passed: 'mile-high' }));
    expect(await loadChallenges()).toEqual({ passed: [] });
    await saveChallenges(/** @type {any} */ ({ passed: ['breathe', 7, null] }));
    expect(await loadChallenges()).toEqual({ passed: ['breathe'] });
  });
});

describe('challenge actions', () => {
  it('a new store has no challenge and nothing passed', () => {
    const s = makeInitialState({ blank: true });
    expect(s.session.challenge).toBeNull();
    expect(s.session.challengeGrade).toBeNull();
    expect(s.challenges).toEqual({ passed: [] });
  });

  it('START_CHALLENGE puts the challenge car on the bench and keeps the saved pull stats', () => {
    const before = { ...makeInitialState({ blank: true }) };
    before.session = { ...before.session, bestScore: 87, pullCount: 4, totalScore: 300 };
    const s = start(before, 'mile-high');
    expect(s.session.challenge).toBe('mile-high');
    expect(s.build.engineReady).toBe(true);
    expect(s.build.turboOn).toBe(true);
    expect(s.session.env.altitudeM).toBe(1600);
    expect(s.session.mode).toBe('sandbox');
    expect(s.session.result).toBeNull();
    expect(s.history).toEqual({ past: [], future: [] });
    expect([s.session.bestScore, s.session.pullCount, s.session.totalScore]).toEqual([87, 4, 300]);
  });

  it('LEAVE_CHALLENGE ends the challenge and leaves its car on the bench', () => {
    const s = start(makeInitialState({ blank: true }), 'breathe');
    const left = reducer(s, { type: ACTIONS.LEAVE_CHALLENGE });
    expect(left.session.challenge).toBeNull();
    expect(left.build).toBe(s.build);
    expect(left.tune).toBe(s.tune);
  });

  it('CHALLENGE_GRADED keeps the grade, and ticks a pass once', () => {
    let s = start(makeInitialState({ blank: true }), 'breathe');
    s = reducer(s, { type: ACTIONS.CHALLENGE_GRADED, id: 'breathe', verdict: 'fail', results: [] });
    expect(s.session.challengeGrade).toEqual({ id: 'breathe', verdict: 'fail', results: [] });
    expect(s.challenges.passed).toEqual([]);
    s = reducer(s, { type: ACTIONS.CHALLENGE_GRADED, id: 'breathe', verdict: 'pass', results: [] });
    s = reducer(s, { type: ACTIONS.CHALLENGE_GRADED, id: 'breathe', verdict: 'pass', results: [] });
    expect(s.challenges.passed).toEqual(['breathe']);
  });

  it('CHALLENGE_GRADED for a challenge that is not running changes nothing', () => {
    const s = start(makeInitialState({ blank: true }), 'breathe');
    expect(reducer(s, { type: ACTIONS.CHALLENGE_GRADED, id: 'mile-high', verdict: 'pass', results: [] })).toBe(s);
  });

  it('RESTORE_CHALLENGES merges the save with ticks earned before it loaded', () => {
    let s = start(makeInitialState({ blank: true }), 'breathe');
    s = reducer(s, { type: ACTIONS.CHALLENGE_GRADED, id: 'breathe', verdict: 'pass', results: [] });
    s = reducer(s, { type: ACTIONS.RESTORE_CHALLENGES, challenges: { passed: ['mile-high', 'breathe'] } });
    expect([...s.challenges.passed].sort()).toEqual(['breathe', 'mile-high']);
  });

  it('loading another engine ends the challenge; RESET ALL TO STOCK does not', () => {
    const s = start(makeInitialState({ blank: true }), 'big-turbo-91');
    const reset = reducer(s, { type: ACTIONS.RESET_TO_STOCK, ve: s.tune.ve });
    expect(reset.session.challenge).toBe('big-turbo-91');
    const other = reducer(s, { type: ACTIONS.APPLY_PRESET, preset: applyPreset(presetById('ls1')) });
    expect(other.session.challenge).toBeNull();
    expect(other.session.challengeGrade).toBeNull();
  });

  it('career never sees a challenge, and SANDBOX gets it back', () => {
    const s = start(makeInitialState({ blank: true }), 'mile-high');
    const career = { working: null, lifts: [], owned: [] };
    const inCareer = reducer(s, { type: ACTIONS.ENTER_CAREER, career: /** @type {any} */ (career) });
    expect(inCareer.session.challenge).toBeNull();
    const back = reducer(inCareer, { type: ACTIONS.ENTER_SANDBOX });
    expect(back.session.challenge).toBe('mile-high');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/challenge-store.test.js > /tmp/t3.log 2>&1; echo "exit $?"; tail -30 /tmp/t3.log`
Expected: exit 1. `loadChallenges` is not exported, and the new actions do not exist.

- [ ] **Step 3: Storage**

Append to `src/storage.js`:

```js
/** SANDBOX's challenges passed, kept apart from the career's saves. */
const CHALLENGES_KEY = 'challenges';

/**
 * Reads which sandbox challenges have been passed. Anything unreadable, or not a list
 * of ids, reads as none: a tick is not worth crashing the app over.
 *
 * @returns {Promise<{passed: string[]}>}
 */
export async function loadChallenges() {
  try {
    let raw;
    switch (storageBackend()) {
      case 'artifact': raw = (await window.storage.get(CHALLENGES_KEY))?.value ?? null; break;
      case 'local': raw = localStorage.getItem(CHALLENGES_KEY); break;
      default: raw = memory.get(CHALLENGES_KEY) ?? null;
    }
    const saved = raw ? JSON.parse(raw) : null;
    return { passed: Array.isArray(saved?.passed) ? saved.passed.filter((id) => typeof id === 'string') : [] };
  } catch {
    return { passed: [] };
  }
}

/**
 * Writes which sandbox challenges have been passed. Best-effort, like `saveCareer`.
 *
 * @param {{passed: string[]}} challenges
 * @returns {Promise<boolean>} whether it was written
 */
export async function saveChallenges(challenges) {
  try {
    const raw = JSON.stringify(challenges);
    switch (storageBackend()) {
      case 'artifact': await window.storage.set(CHALLENGES_KEY, raw); return true;
      case 'local': localStorage.setItem(CHALLENGES_KEY, raw); return true;
      default: memory.set(CHALLENGES_KEY, raw); return true;
    }
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Initial state**

In `src/ui/state/initialState.js`:

Add to the `SessionState` typedef, after the `mode` property:

```js
 * @property {string|null} challenge the sandbox challenge on the bench (challenges/challenges.js),
 *   or null. Not saved: the bench it applies to is not saved either
 * @property {{id: string, verdict: 'pass'|'partial'|'fail'|'unsafe',
 *   results: import('../career/evaluate.js').CheckResult[]}|null} challengeGrade the last
 *   GRADE of that challenge, for HOME › CHALLENGES to show
```

Add to the `StoreState` typedef, after `stash`:

```js
 * @property {{passed: string[]}} challenges which sandbox challenges have been passed,
 *   saved under their own key (storage.js)
```

In `makeInitialState`'s returned `session`, after `mode: 'sandbox',`, add:

```js
      challenge: null,
      challengeGrade: null,
```

In its top-level return, after `stash: null,`, add:

```js
    challenges: { passed: [] },
```

- [ ] **Step 5: Reducer**

In `src/ui/state/reducer.js`:

(a) Add to `ACTIONS`, after `CAREER_UPDATE: 'CAREER_UPDATE',`:

```js
  START_CHALLENGE: 'START_CHALLENGE',
  LEAVE_CHALLENGE: 'LEAVE_CHALLENGE',
  CHALLENGE_GRADED: 'CHALLENGE_GRADED',
  RESTORE_CHALLENGES: 'RESTORE_CHALLENGES',
```

(b) After the career action typedef block (the one ending `CareerUpdateAction`), add:

```js
/**
 * SANDBOX's challenges (challenges/challenges.js). START_CHALLENGE puts the challenge's
 * car on the bench: a clean bench like a career car on the bay, full health, no pull
 * and an undo history of its own, so undo cannot leave the challenge running on a car
 * that is not its own. SANDBOX's saved pull stats and run log stay: they are the
 * player's, not the bench's. LEAVE_CHALLENGE ends it and leaves the car where it is.
 * CHALLENGE_GRADED keeps the last grade for HOME and ticks a pass. RESTORE_CHALLENGES
 * merges the saved ticks in, for the same load race RESTORE_CAREER describes.
 * @typedef {{type: 'START_CHALLENGE', id: string, car: StoreState}} StartChallengeAction
 * @typedef {{type: 'LEAVE_CHALLENGE'}} LeaveChallengeAction
 * @typedef {{type: 'CHALLENGE_GRADED', id: string, verdict: 'pass'|'partial'|'fail'|'unsafe',
 *   results: import('../career/evaluate.js').CheckResult[]}} ChallengeGradedAction
 * @typedef {{type: 'RESTORE_CHALLENGES', challenges: {passed: string[]}}} RestoreChallengesAction
 */
```

Add `StartChallengeAction`, `LeaveChallengeAction`, `ChallengeGradedAction` and `RestoreChallengesAction` to the `StoreAction` union typedef, next to `CareerUpdateAction`. Find it with `grep -n "CareerUpdateAction" src/ui/state/reducer.js`. If `StoreState` is not already imported as a typedef in this file, use `import('./initialState.js').StoreState` in the `StartChallengeAction` typedef.

(c) In the `APPLY_PRESET` case, the returned `session: { ... }` object already clears `result` and `pullScores`. Add these two lines inside it:

```js
          // Another engine ends a challenge: its grade would be of a car that is not the challenge's.
          challenge: null,
          challengeGrade: null,
```

Do not touch `RESET_TO_STOCK`. Rewriting the calibration for the hardware on the bench is a tuning move.

(d) After the `CAREER_UPDATE` case, add:

```js
    case ACTIONS.START_CHALLENGE: {
      if (state.session.mode !== 'sandbox') return state;
      const car = action.car;
      return {
        ...state,
        build: car.build,
        tune: car.tune,
        session: {
          ...state.session,
          result: null, pullScores: null, histogram: null, logFocusRpm: null, revealCount: 0,
          health: { piston: 100, bearing: 100, valve: 100 },
          mission: null, running: false, live: makeLiveState(),
          // The challenge's own conditions: where its car lives, and nothing switched on.
          env: car.session.env, faults: car.session.faults, liveAux: car.session.liveAux,
          challenge: action.id, challengeGrade: null,
        },
        history: { past: [], future: [] },
      };
    }

    case ACTIONS.LEAVE_CHALLENGE:
      return { ...state, session: { ...state.session, challenge: null, challengeGrade: null } };

    case ACTIONS.CHALLENGE_GRADED: {
      if (state.session.challenge !== action.id) return state;
      const passed = state.challenges.passed;
      return {
        ...state,
        session: { ...state.session, challengeGrade: { id: action.id, verdict: action.verdict, results: action.results } },
        challenges: action.verdict === 'pass' && !passed.includes(action.id)
          ? { passed: [...passed, action.id] }
          : state.challenges,
      };
    }

    case ACTIONS.RESTORE_CHALLENGES:
      return { ...state, challenges: { passed: [...new Set([...state.challenges.passed, ...action.challenges.passed])] } };
```

(e) Add `'challenge', 'challengeGrade'` to `SANDBOX_SESSION_FIELDS`, so ENTER_CAREER sets them aside with the rest of SANDBOX's bench and ENTER_SANDBOX brings them back:

```js
const SANDBOX_SESSION_FIELDS = [
  'result', 'runs', 'pinnedRunId', 'pullScores', 'histogram', 'logFocusRpm', 'health',
  'pullCount', 'bestScore', 'totalScore', 'mission', 'revealCount',
  'env', 'faults', 'liveAux', 'challenge', 'challengeGrade',
];
```

(f) In `onTheBay`, add to the `session` object, after `mission: null, revealCount: 0, running: false, live: makeLiveState(),`:

```js
      // A customer's car is never a sandbox challenge's.
      challenge: null, challengeGrade: null,
```

None of the four new actions is undoable. Do not add them to `UNDO_SCOPE` or `labelFor`.

- [ ] **Step 6: Store hook**

In `src/ui/state/StoreProvider.jsx`, after `useCareer`, add:

```js
/**
 * Which sandbox challenges have been passed.
 * @returns {[{passed: string[]}, React.Dispatch<StoreAction>]}
 */
export function useChallenges() {
  const [state, dispatch] = useStore();
  return [state.challenges, dispatch];
}
```

`StoreAction` is already a typedef name in that file. Match how `useCareer`'s JSDoc names it.

- [ ] **Step 7: Run the test, then the store and career suites**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/challenge-store.test.js tests/career.test.js tests/ui/career-app.test.jsx tests/reducer > /tmp/t3.log 2>&1; echo "exit $?"; tail -20 /tmp/t3.log`
Expected: exit 0. The `tests/reducer` filter matches any reducer test files; if it matches none, vitest still runs the named files.

Then run the whole suite. Other tests may snapshot the initial state or enumerate `ACTIONS`:
Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run > /tmp/all.log 2>&1; echo "exit $?"; grep -E "Test Files|Tests|FAIL" /tmp/all.log | head -20`
Expected: exit 0. Some test may list every action or session field and fail only because the new ones are missing. If so, add them to that test's expected list, and say so in your report.

- [ ] **Step 8: Lint and typecheck**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run -s lint > /tmp/l.log 2>&1; echo "lint $?"; npm run -s typecheck > /tmp/tc.log 2>&1; echo "tsc $?"; tail -20 /tmp/l.log /tmp/tc.log`
Expected: `lint 0`, `tsc 0`.

- [ ] **Step 9: Commit**

```bash
git add src/storage.js src/ui/state/initialState.js src/ui/state/reducer.js src/ui/state/StoreProvider.jsx tests/challenge-store.test.js
git commit -m "Challenges in the store: the bench's challenge, and the saved ticks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any test file you had to update in Step 7.)

---

### Task 4: HOME › CHALLENGES

**Files:**
- Modify: `src/ui/routing.js` (`ROUTES.dash`)
- Modify: `src/ui/commands.js` (`SECTION_LABELS`)
- Modify: `tests/commands.test.js` (the `pageCommands` ordering test)
- Create: `src/ui/screens/dash/ChallengesScreen.jsx`, `src/ui/screens/dash/ChallengesScreen.module.css`
- Modify: `src/ui/EcuLab.jsx` (the HOME block, right after `<LearnScreen … />`)
- Test: `tests/ui/dash-screens.test.jsx`

**Interfaces:**
- Consumes:
  - `CHALLENGES` and `Challenge` (Task 2);
  - `HOW_TO_SEE` from `career/evaluate.js`;
  - `customerCar(spec, 'sandbox')`;
  - `useChallenges`, `useSession` and `useBuild` from StoreProvider;
  - `ACTIONS.START_CHALLENGE` (Task 3).
- Produces:
  - `ChallengesScreen({active: boolean, onToggle: (section: string) => void})`, a HOME section with route key `'challenges'`.
  - Per card, these accessible names, which Task 5's tests use:
    - a `START` button named `Start <title>`, disabled while `session.running`;
    - once START is pressed on a loaded bench, buttons `REPLACE MY ENGINE` and `CANCEL`;
    - the text `ACTIVE` on the running challenge;
    - the text `PASSED` on a passed one.
  - Grade rows show the text `PASS` or `NOT YET`, then each result's `measured` text.

- [ ] **Step 1: Write the failing tests**

In `tests/commands.test.js`, the `pageCommands` test changes to:

```js
    expect(list.slice(0, 8)).toEqual([
      'page:dash', 'page:dash/stats', 'page:dash/health',
      'page:dash/learn', 'page:dash/challenges', 'page:dash/realcar', 'page:build', 'page:build/engine',
    ]);
    expect(list).toContain('page:live');
    expect(list.some((id) => id.startsWith('page:live/'))).toBe(false);
    expect(list).toHaveLength(6 + 28);
```

In `tests/ui/dash-screens.test.jsx`, add `import { ChallengesScreen } from '../../src/ui/screens/dash/ChallengesScreen.jsx';` with the other screen imports. Add `import { CHALLENGES } from '../../src/ui/challenges/challenges.js';` after the screen imports, with a blank line between groups as the file does. Then append:

```js
describe('ChallengesScreen', () => {
  /** A probe that hands the test the store's dispatch, as mountWithResult does. */
  function mountWithDispatch(node) {
    /** @type {Function} */
    let dispatch;
    const Capture = () => {
      const [, d] = useSession();
      dispatch = d;
      return null;
    };
    const utils = render(<StoreProvider><Capture />{node}</StoreProvider>);
    return { ...utils, dispatch: (a) => act(() => dispatch(a)) };
  }

  it('lists every challenge, with its car and goal', () => {
    mount(<ChallengesScreen active onToggle={noop} />);
    for (const c of CHALLENGES) {
      expect(screen.getByText(c.title)).toBeTruthy();
      expect(screen.getByText(c.goal)).toBeTruthy();
      expect(screen.getByRole('button', { name: `Start ${c.title}` })).toBeTruthy();
    }
  });

  it('toggles its own section', () => {
    const onToggle = vi.fn();
    mount(<ChallengesScreen active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /Challenges/ }));
    expect(onToggle).toHaveBeenCalledWith('challenges');
  });

  it('asks before replacing an engine on the bench, and CANCEL changes nothing', () => {
    mount(<ChallengesScreen active onToggle={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start A mile high' }));
    expect(screen.getByText('This replaces the engine on your bench.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByText('This replaces the engine on your bench.')).toBeNull();
    expect(screen.queryByText('ACTIVE')).toBeNull();
  });

  it('starts once confirmed, and shows the last grade on the running card', () => {
    const { dispatch } = mountWithDispatch(<ChallengesScreen active onToggle={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start A mile high' }));
    fireEvent.click(screen.getByRole('button', { name: 'REPLACE MY ENGINE' }));
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    const c = CHALLENGES.find((x) => x.id === 'mile-high');
    dispatch({
      type: ACTIONS.CHALLENGE_GRADED, id: 'mile-high', verdict: 'fail',
      results: c.checks.map((check) => ({ check, pass: check.kind !== 'complaint', measured: check.kind === 'complaint' ? '211 whp; 240 needed' : 'fine' })),
    });
    expect(screen.getByText('NOT YET')).toBeTruthy();
    expect(screen.getByText('211 whp; 240 needed')).toBeTruthy();
  });

  it('ticks a passed challenge', () => {
    const { dispatch } = mountWithDispatch(<ChallengesScreen active onToggle={noop} />);
    dispatch({ type: ACTIONS.RESTORE_CHALLENGES, challenges: { passed: ['breathe'] } });
    expect(screen.getByText('PASSED')).toBeTruthy();
    expect(screen.getByText(CHALLENGES.find((x) => x.id === 'breathe').teaches)).toBeTruthy();
  });
});
```

`mount`, `noop`, `act`, `fireEvent`, `screen`, `vi`, `useSession`, `StoreProvider` and `ACTIONS` are already imported or defined in this file. If `mountWithResult` already shows a reusable capture pattern you can share, reuse it; otherwise keep the local helper.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/commands.test.js tests/ui/dash-screens.test.jsx > /tmp/t4.log 2>&1; echo "exit $?"; tail -30 /tmp/t4.log`
Expected: exit 1. `ChallengesScreen.jsx` is missing, and the commands list lacks `dash/challenges`.

- [ ] **Step 3: Route and palette label**

In `src/ui/routing.js`:

```js
  dash: ['stats', 'health', 'learn', 'challenges', 'realcar'],
```

In `src/ui/commands.js` `SECTION_LABELS`, after `'dash/learn'`:

```js
  'dash/challenges': { label: 'Challenges', keywords: ['goals', 'scenarios', 'win'] },
```

- [ ] **Step 4: The section**

Create `src/ui/screens/dash/ChallengesScreen.jsx`:

```jsx
/**
 * HOME > Challenges: SANDBOX's goals (challenges/challenges.js).
 *
 * Each card is a car and a target. START puts the challenge's car on the bench (asking
 * first if there is an engine on it already, because it replaces it), and the
 * challenge bar (ChallengeBar.jsx) carries GRADE and LEAVE while it runs. GRADE comes
 * back here, so the running card is where its last grade shows: every check, what the
 * car measured, and where in the game to see it for yourself (HOW_TO_SEE).
 */

import { Check, Trophy } from 'lucide-react';
import React, { useState } from 'react';

import { customerCar } from '../../career/cars.js';
import { HOW_TO_SEE } from '../../career/evaluate.js';
import { CHALLENGES } from '../../challenges/challenges.js';
import { BuildSection } from '../../components/BuildSection.jsx';
import { Button } from '../../primitives/Button.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild, useChallenges, useSession } from '../../state/StoreProvider.jsx';

import styles from './ChallengesScreen.module.css';

/**
 * @param {object} props
 * @param {boolean} props.active whether this is HOME's open section
 * @param {(section: string) => void} props.onToggle opens or closes a HOME section
 * @returns {React.ReactElement}
 */
export function ChallengesScreen({ active, onToggle }) {
  const [challenges, dispatch] = useChallenges();
  const [session] = useSession();
  const [build] = useBuild();
  const [asking, setAsking] = useState(/** @type {string|null} */ (null));
  const passed = challenges.passed;

  /** @param {import('../../challenges/challenges.js').Challenge} c */
  const start = (c) => {
    setAsking(null);
    dispatch({ type: ACTIONS.START_CHALLENGE, id: c.id, car: customerCar(c.car, 'sandbox') });
  };

  return (
    <BuildSection
      active={active} onClick={() => onToggle('challenges')}
      icon={Trophy} label="Challenges"
      sub={`${passed.filter((id) => CHALLENGES.some((c) => c.id === id)).length} of ${CHALLENGES.length} passed`}
    >
      <p className={styles.intro}>A car and a target. START puts the car on your bench; GRADE, at the top of the screen, runs the pull and checks it.</p>
      <ul className={styles.list}>
        {CHALLENGES.map((c) => {
          const running = session.challenge === c.id;
          const grade = running && session.challengeGrade?.id === c.id ? session.challengeGrade : null;
          const done = passed.includes(c.id);
          return (
            <li key={c.id} className={styles.card} data-active={running || undefined}>
              <div className={styles.head}>
                <span className={styles.title}>{c.title}</span>
                {done && <span className={styles.passed}><Check size={13} aria-hidden="true" /> PASSED</span>}
                {running
                  ? <span className={styles.active}>ACTIVE</span>
                  : (
                    <Button size="sm" aria-label={`Start ${c.title}`} disabled={session.running}
                      onClick={() => (build.engineReady === false ? start(c) : setAsking(c.id))}>START</Button>
                  )}
              </div>
              <div className={styles.car}>{c.carName}</div>
              <p className={styles.goal}>{c.goal}</p>
              <ul className={styles.rules}>{c.checks.map((x) => <li key={x.label}>{x.label}</li>)}</ul>
              {asking === c.id && (
                <div className={styles.confirm} role="group" aria-label={`Start ${c.title}?`}>
                  <span>This replaces the engine on your bench.</span>
                  <Button size="sm" onClick={() => start(c)}>REPLACE MY ENGINE</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>CANCEL</Button>
                </div>
              )}
              {grade && (
                <ul className={styles.grade} aria-label={`Last grade of ${c.title}`}>
                  {grade.results.map((x) => (
                    <li key={x.check.label} className={styles.result} data-pass={x.pass || undefined}>
                      <span className={styles.verdict}>{x.pass ? 'PASS' : 'NOT YET'}</span>
                      <span className={styles.label}>{x.check.label}</span>
                      <span className={styles.measured}>{x.measured}</span>
                      {!x.pass && HOW_TO_SEE[x.check.type] && <span className={styles.how}>{HOW_TO_SEE[x.check.type]}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {done && <p className={styles.teaches}>{c.teaches}</p>}
            </li>
          );
        })}
      </ul>
    </BuildSection>
  );
}
```

Create `src/ui/screens/dash/ChallengesScreen.module.css`. Before writing it, read `src/ui/tokens.js` or the CSS custom properties in use, and use only tokens that exist (`--ink`, `--ink2`, `--ink-soft`, `--line`, `--line-hi`, `--panel`, `--panel2`, `--acc`, `--acc-ink`, `--acc-bg`, `--warn-ink`, `--sp-*`, `--fs-*`, `--r-*` are all used elsewhere in `src/ui`). If a token named below does not exist, use the nearest one that does.

```css
/* HOME > Challenges. Tokens only: the design system's one rule. */

.intro { margin: 0 0 var(--sp-md); font-size: var(--fs-sm); line-height: 1.55; color: var(--ink-soft); }

.list { display: flex; flex-direction: column; gap: var(--sp-md); margin: 0; padding: 0; list-style: none; }

.card {
  padding: var(--sp-md) var(--sp-lg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel2);
}

.card[data-active] { border-color: var(--acc); }

.head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-sm); }
.title { flex: 1; min-width: 0; font-size: var(--fs-base); font-weight: 800; color: var(--ink); }

.passed, .active {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-micro);
  font-weight: 800;
  letter-spacing: 0.12em;
}
.passed { color: var(--acc-ink); }
.active { color: var(--acc-ink); padding: 2px 8px; border-radius: var(--r-sm); background: var(--acc-bg); }

.car { margin-top: 2px; font-size: var(--fs-xs); font-weight: 700; color: var(--ink2); }
.goal { margin: var(--sp-sm) 0; font-size: var(--fs-sm); line-height: 1.55; color: var(--ink); }
.rules { margin: 0; padding-left: 1.2em; font-size: var(--fs-xs); line-height: 1.6; color: var(--ink2); }

.confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-sm);
  margin-top: var(--sp-md);
  padding: var(--sp-sm) var(--sp-md);
  border: 1px solid var(--line-hi);
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  color: var(--ink);
}

.grade { display: flex; flex-direction: column; gap: var(--sp-xs); margin: var(--sp-md) 0 0; padding: 0; list-style: none; }
.result { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--sp-sm); font-size: var(--fs-xs); line-height: 1.45; }
.verdict { font-weight: 800; letter-spacing: 0.08em; color: var(--warn-ink); }
.result[data-pass] .verdict { color: var(--acc-ink); }
.label { font-weight: 700; color: var(--ink); }
.measured, .how { grid-column: 2; color: var(--ink2); }

.teaches { margin: var(--sp-sm) 0 0; font-size: var(--fs-sm); line-height: 1.55; color: var(--ink-soft); }
```

- [ ] **Step 5: Mount it on HOME**

In `src/ui/EcuLab.jsx`, import it with the other dash screens, at `import { LearnScreen } from './screens/dash/LearnScreen.jsx';`:

```js
import { ChallengesScreen } from './screens/dash/ChallengesScreen.jsx';
```

and in the HOME block, between `<LearnScreen … />` and `<RealCarScreen … />`:

```jsx
            <ChallengesScreen active={dashSection === 'challenges'} onToggle={toggleDashSection} />
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/commands.test.js tests/ui/dash-screens.test.jsx tests/ui/command-palette.test.jsx > /tmp/t4.log 2>&1; echo "exit $?"; tail -20 /tmp/t4.log`
Expected: exit 0.

Then run the whole suite, because routing changes reach shell tests:
Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run > /tmp/all.log 2>&1; echo "exit $?"; grep -E "Test Files|Tests|FAIL" /tmp/all.log | head -20`
Expected: exit 0. A test may list HOME's sections in order. If so, add `challenges` after `learn` there and report it.

- [ ] **Step 7: Lint, typecheck and the colour guard**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run -s lint > /tmp/l.log 2>&1; echo "lint $?"; npm run -s typecheck > /tmp/tc.log 2>&1; echo "tsc $?"; tail -20 /tmp/l.log /tmp/tc.log; grep -nE '#[0-9]' src/ui/screens/dash/ChallengesScreen.* || echo "no digit after #"`
Expected: `lint 0`, `tsc 0`, `no digit after #`.

- [ ] **Step 8: Commit**

```bash
git add src/ui/routing.js src/ui/commands.js tests/commands.test.js src/ui/screens/dash/ChallengesScreen.jsx src/ui/screens/dash/ChallengesScreen.module.css src/ui/EcuLab.jsx tests/ui/dash-screens.test.jsx
git commit -m "HOME > Challenges: the list, START, and the last grade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The challenge bar, grading, and the saved ticks in the app

**Files:**
- Create: `src/ui/challenges/ChallengeBar.jsx`, `src/ui/challenges/ChallengeBar.module.css`
- Modify: `src/ui/EcuLab.jsx`:
  - imports;
  - a `challenge` value next to `inCareer`;
  - `gradeChallenge` and `leaveChallenge` handlers next to `handBack`;
  - load and save effects next to the career ones;
  - AppShell's `banner` prop.
- Test: `tests/ui/challenges-app.test.jsx`

**Interfaces:**
- Consumes:
  - `gradeChecks` (Task 1);
  - `challengeById` (Task 2);
  - `loadChallenges`, `saveChallenges`, `ACTIONS.CHALLENGE_GRADED`, `ACTIONS.LEAVE_CHALLENGE`, `ACTIONS.RESTORE_CHALLENGES` and `useChallenges` (Task 3);
  - ChallengesScreen's accessible names (Task 4).
- Produces: `ChallengeBar({challenge: Challenge, running: boolean, onGrade: () => void, onLeave: () => void})`, a `<section aria-label="Challenge">` with:
  - the text `CHALLENGE`;
  - the challenge's title;
  - a button `GRADE`, disabled while `running`;
  - a button `LEAVE`.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/challenges-app.test.jsx`:

```jsx
// @vitest-environment jsdom

/**
 * Sandbox challenges in the whole app: START from HOME puts the car on the bench and
 * the challenge bar on the screen, GRADE runs the real grader and brings the result
 * back to HOME, LEAVE takes the bar away, and the ticks come back from the save.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveChallenges } from '../../src/storage.js';
import EcuLab from '../../src/ui/EcuLab.jsx';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const hadResizeObserver = 'ResizeObserver' in window;
if (!hadResizeObserver) window.ResizeObserver = ResizeObserverStub;
afterAll(() => {
  if (!hadResizeObserver) delete window.ResizeObserver;
});

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/dash/challenges';
});

const bar = () => screen.queryByRole('region', { name: 'Challenge' });

describe('sandbox challenges in the app', () => {
  it('starts straight away on an empty bench, shows the bar, and LEAVE takes it away', async () => {
    render(<EcuLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start A mile high' }));
    expect(screen.queryByText('This replaces the engine on your bench.')).toBeNull();
    expect(within(bar()).getByText('A mile high')).toBeTruthy();
    fireEvent.click(within(bar()).getByRole('button', { name: 'LEAVE' }));
    expect(bar()).toBeNull();
  });

  it('asks first once the bench has an engine, and CANCEL keeps the running challenge', async () => {
    render(<EcuLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start A mile high' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Pump-gas V8' }));
    expect(screen.getByText('This replaces the engine on your bench.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(within(bar()).getByText('A mile high')).toBeTruthy();
  });

  it('GRADE runs the grader and shows every check on HOME', async () => {
    render(<EcuLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start Pump-gas V8' }));
    window.location.hash = '#/tune/spark';
    fireEvent.click(within(bar()).getByRole('button', { name: 'GRADE' }));
    await waitFor(() => expect(window.location.hash).toBe('#/dash/challenges'));
    const grade = await screen.findByRole('list', { name: 'Last grade of Pump-gas V8' });
    expect(within(grade).getByText('325 whp; 360 needed')).toBeTruthy();
    expect(within(grade).getAllByText('NOT YET').length).toBeGreaterThan(0);
  }, 30_000);

  it('brings back the ticks from the save', async () => {
    await saveChallenges({ passed: ['breathe'] });
    render(<EcuLab />);
    expect(await screen.findByText('PASSED')).toBeTruthy();
  });
});
```

If the app opens on the start screen even with the hash set, read `tests/ui/career-app.test.jsx` and `tests/setup.js` for how they reach the game. The sandbox is entered from the start screen's SANDBOX button: `fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }))`. Add a small `openSandbox()` helper to do that before each test, then set the hash with `window.location.hash = '#/dash/challenges'` and wait for `Start A mile high`. Keep the assertions as written.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/challenges-app.test.jsx > /tmp/t5.log 2>&1; echo "exit $?"; tail -30 /tmp/t5.log`
Expected: exit 1. There is no `region` named Challenge, and the ticks are not loaded.

- [ ] **Step 3: The bar**

Create `src/ui/challenges/ChallengeBar.jsx`:

```jsx
/**
 * The challenge on the bench, pinned to the top of SANDBOX while it runs, in the slot
 * the career's job ticket uses (AppShell's `banner`). GRADE runs career's grader on
 * the car as it stands and shows the result on HOME › CHALLENGES; LEAVE ends the
 * challenge and leaves the car on the bench.
 */

import { Trophy } from 'lucide-react';
import React from 'react';

import { Button } from '../primitives/Button.jsx';

import styles from './ChallengeBar.module.css';

/**
 * @param {object} props
 * @param {import('./challenges.js').Challenge} props.challenge
 * @param {boolean} props.running whether a pull is running: grading waits for it
 * @param {() => void} props.onGrade
 * @param {() => void} props.onLeave
 * @returns {React.ReactElement}
 */
export function ChallengeBar({ challenge, running, onGrade, onLeave }) {
  return (
    <section className={styles.bar} aria-label="Challenge">
      <Trophy size={14} aria-hidden="true" className={styles.icon} />
      <span className={styles.tag}>CHALLENGE</span>
      <span className={styles.title}>{challenge.title}</span>
      <Button size="sm" onClick={onGrade} disabled={running}>GRADE</Button>
      <Button size="sm" variant="ghost" onClick={onLeave}>LEAVE</Button>
    </section>
  );
}
```

Create `src/ui/challenges/ChallengeBar.module.css`:

```css
/* The challenge bar: CareerBar's place and shape, in the accent colour rather than the
   job ticket's warning colour, because a challenge is a goal rather than a fault. */

.bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-sm);
  margin: var(--sp-md) var(--sp-xl) 0;
  padding: var(--sp-xs) var(--sp-md) var(--sp-xs) var(--sp-lg);
  border: 1px solid var(--acc);
  border-radius: var(--r-md);
  background: var(--acc-bg);
  box-shadow: 0 6px 18px rgba(var(--shadow-rgb), 0.35);
}

.icon { flex-shrink: 0; color: var(--acc-ink); }
.tag { flex-shrink: 0; font-size: var(--fs-micro); font-weight: 800; letter-spacing: 0.14em; color: var(--acc-ink); }
.title { flex: 1; min-width: 0; font-size: var(--fs-base); font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 4: Wire it into EcuLab**

In `src/ui/EcuLab.jsx`:

(a) Imports, in the existing groups:

```js
import { gradeChecks } from './career/evaluate.js';   // add to the existing evaluate.js import if there is one
import { ChallengeBar } from './challenges/ChallengeBar.jsx';
import { challengeById } from './challenges/challenges.js';
```

Change the storage import line to:

```js
import { loadCareer, loadChallenges, loadShop, saveCareer, saveChallenges, saveShop } from '../storage.js';
```

Add `useChallenges` to the existing StoreProvider import.

(b) Next to `const inCareer = mode === 'career' && career != null;` (line ~293), add:

```js
  const [challenges] = useChallenges();
  // The sandbox challenge on the bench, if any. Never in CAREER: the bench is a customer's.
  const challenge = !inCareer && session.challenge ? challengeById(session.challenge) ?? null : null;
```

Use whatever name the file already gives the session slice for `session` (it reads `const [session] = useSession();` around line 282).

(c) After the `handBack` function, add:

```js
  /**
   * SANDBOX: grades the bench against the running challenge, on the simulator, with
   * career's grader (career/evaluate.js), and shows the result where the challenge
   * was started from.
   */
  const gradeChallenge = () => {
    if (!challenge || running) return;
    const g = gradeChecks(challenge.checks, challenge.car, { build, tune, session });
    dispatch({ type: ACTIONS.CHALLENGE_GRADED, id: challenge.id, verdict: g.verdict, results: g.results });
    navigate({ view: 'app', tab: 'dash', section: 'challenges' });
  };
  const leaveChallenge = () => dispatch({ type: ACTIONS.LEAVE_CHALLENGE });
```

(d) After the career save effect (the `useEffect` that calls `saveCareer`), add:

```js
  // Which challenges have been passed, loaded once and written back whenever a pass
  // lands. Merged rather than overwritten on load (RESTORE_CHALLENGES), for the same
  // race the career stats above describe.
  const challengesLoaded = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadChallenges();
      if (cancelled) return;
      dispatch({ type: ACTIONS.RESTORE_CHALLENGES, challenges: c });
      challengesLoaded.current = true;
    })();
    return () => { cancelled = true; };
  }, [dispatch]);
  useEffect(() => {
    if (!challengesLoaded.current) return;
    saveChallenges(challenges);
  }, [challenges]);
```

`useRef` and `useEffect` are already imported in this file; check the React import line.

(e) Change AppShell's `banner` prop to:

```jsx
        banner={inCareer
          ? <CareerBar career={career} onShop={() => changeTab('shop')} onHandBack={handBack} />
          : challenge ? <ChallengeBar challenge={challenge} running={running} onGrade={gradeChallenge} onLeave={leaveChallenge} /> : null}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/challenges-app.test.jsx > /tmp/t5.log 2>&1; echo "exit $?"; tail -20 /tmp/t5.log`
Expected: exit 0, 4 tests pass.

- [ ] **Step 6: Full gates**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run > /tmp/all.log 2>&1; echo "test $?"; grep -E "Test Files|Tests|FAIL" /tmp/all.log | head -20
npm run -s lint > /tmp/l.log 2>&1; echo "lint $?"; tail -20 /tmp/l.log
npm run -s typecheck > /tmp/tc.log 2>&1; echo "tsc $?"; tail -20 /tmp/tc.log
npm run -s build > /tmp/b.log 2>&1; echo "build $?"; tail -5 /tmp/b.log
git diff --quiet origin/main -- tests/fixtures/fingerprint.sha256 && echo "fingerprint untouched"
grep -rnE '#[0-9]' src/ui/challenges src/ui/screens/dash/ChallengesScreen.* || echo "no digit after #"
```

Expected: `test 0`, `lint 0`, `tsc 0`, `build 0`, `fingerprint untouched`, `no digit after #`. `vite build` crashes intermittently on this machine; if `build` fails with a crash rather than a compile error, run it once more.

- [ ] **Step 7: Commit**

```bash
git add src/ui/challenges/ChallengeBar.jsx src/ui/challenges/ChallengeBar.module.css src/ui/EcuLab.jsx tests/ui/challenges-app.test.jsx
git commit -m "The challenge bar: GRADE on the real grader, LEAVE, and the saved ticks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
