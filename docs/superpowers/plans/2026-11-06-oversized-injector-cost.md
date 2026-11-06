# Oversized Injector Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an oversized injector cost fuelling accuracy at idle and light load
(DNiev/ecu-lab#39), and let a direct-injected engine add a staged port injection kit that
does not pay that cost.

**Architecture:**

- The ballistic (short-pulse) region in `src/sim/point.js` now grows with injector flow
  rating. Injector metering is factored into a per-bank helper, so a second bank (the port
  kit) reuses it.
- The ECU decides each point's port share from a new calibration table. The share then
  blends evaporative cooling, the DI VE gain and the live engine's wall film.
- Everything lives on the ECU-context path. The path without an ECU is untouched, which is
  why the fingerprint must not move.

**Tech Stack:** Plain ES modules (`src/sim/`), React (`src/ui/`), and vitest with
@testing-library/react.

**Spec:** `docs/superpowers/specs/2026-11-06-oversized-injector-cost-design.md`. Read it
first; targets T1–T10 come from it.

## Global Constraints

- Node 22 via `nvm use`. Gates: `npm test`, `npm run lint` (max 0 warnings),
  `npm run typecheck`, `npm run build`.
- "Nothing adds horsepower." Every effect is a physical mechanism (CONTRIBUTING.md).
- No bare magic numbers in `src/sim/`. New constants go in
  `src/sim/ecu/ecuCoefficients.js` (`ECU_COEFF`, **not** `COEFF`), each with a comment
  saying what it represents and whether it is fitted.
- Every pull-log event has all of `msg`, `cause` and `fix`.
- JSDoc on everything exported from `src/sim/`. Comments explain why, and match the
  surrounding teaching tone.
- The app never rewrites the player's calibration. Fitting a kit does not set its ECU
  scaling for them.
- **The fingerprint (`tests/fixtures/fingerprint.sha256`) must not move.** If
  `npm test -- tests/fingerprint.test.js` fails at any point, stop and find what leaked
  into the path without an ECU. Never regenerate it in this plan.
- `INJECTOR_OPTS` is not changed.
- Saved builds and calibrations from before this change must load: every new field is
  optional, with a fallback.
- Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Run single test files with `npx vitest run <file>`. vitest's exit code is hidden behind a
pipe, so do not pipe the command when you need to read pass or fail.

---

### Task 1: Size-scaled ballistic region and per-bank metering

**Files:**
- Modify: `src/sim/ecu/ecuCoefficients.js` (beside `BALLISTIC_OPEN_MS`, around line 190)
- Modify: `src/sim/point.js` (injector block, around lines 205–230; `ballisticOpenMs` around
  line 450; `ecuFields` around line 342)
- Modify: `src/sim/ecu/calibration.js` (`injector.minEffPwMs` help text, around line 355)
- Create: `tests/injector-sizing.test.js`

**Interfaces:**
- Produces:
  - `ballisticFromMs(cc: number): number` (exported from `point.js` and so from
    `src/sim/index.js`).
  - `ballisticOpenMs(openMs: number, cc?: number): number` (`cc` defaults to
    `ECU_COEFF.BALLISTIC_REF_CC`).
  - New ECU-only point fields: `injOpen` (ms, the base bank's open time, 3 decimals) and
    `ballistic` (boolean).
  - Internal `meterBank(...)` in `point.js`; Task 4 reuses it.
  - `ECU_COEFF.BALLISTIC_REF_CC`, `ECU_COEFF.BALLISTIC_FLOW_EXP`.

- [ ] **Step 1: Write the failing tests**

Create `tests/injector-sizing.test.js`:

```js
/**
 * Oversized injectors cost fuelling accuracy where pulses are short (#39).
 *
 * Intent tests, by design: they pin directions and thresholds the spec names (T1–T10 in
 * docs/superpowers/specs/2026-11-06-oversized-injector-cost-design.md), not magnitudes.
 * Every run is a live engine settled at a hot idle with closed loop OFF, so the mixture
 * shows the metering error directly instead of a trim hiding it.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine, runLive } from './ecuHarness.js';

const idx = (cc) => S.INJECTOR_OPTS.findIndex((o) => o.cc === cc);
const E85 = S.OCTANE_OPTS.findIndex((o) => o.stoich < 12);

/** Hot-idle λ against target, closed loop off, scaling matched to the fitted size. */
function idleLambda({ preset, cc, build = {}, cal = {} }) {
  const eng = makeEngine({
    preset,
    build: { injIdx: idx(cc), ecuInjectorCc: cc, ...build },
    cal: { 'fuel.closedLoop': false, ...cal },
  });
  const r = runLive(eng, { seconds: 8 }).rows.at(-1);
  return r.lambda / r.lambdaTarget;
}

/** A 1.4 L four: cylinders smaller than anything shipped (the smallest is about 0.5 L). */
const SMALL_FOUR = {
  ...S.DEFAULT_ENGINE_CONFIG, configuration: 'I4', bore: 76.5, stroke: 75.6, displacementL: 1.39,
};

describe('ballistic threshold grows with flow rating', () => {
  it('is 0.35 ms at the reference size and longer for a bigger injector', () => {
    expect(S.ballisticFromMs(315)).toBe(0.35);
    expect(S.ballisticFromMs(1300)).toBeGreaterThan(S.ballisticFromMs(850));
    expect(S.ballisticFromMs(850)).toBeGreaterThan(S.ballisticFromMs(315));
  });

  it('delivers the reference injector exactly as before', () => {
    expect(S.ballisticOpenMs(0.2)).toBe((0.2 * 0.2) / 0.35);
    expect(S.ballisticOpenMs(0.5)).toBe(0.5);
  });

  it('puts the same opening deeper into the ballistic region on a bigger injector', () => {
    expect(S.ballisticOpenMs(0.4, 1300)).toBeLessThan(0.4);
    expect(S.ballisticOpenMs(0.4, 315)).toBe(0.4);
  });
});

describe('idle cost of oversized injectors (T1–T5)', () => {
  it('T1: leaves 315–850 cc idling as they did on every shipped engine', () => {
    for (const preset of S.ENGINE_PRESETS) {
      const small = idleLambda({ preset: preset.id, cc: 315 });
      const big = idleLambda({ preset: preset.id, cc: 850 });
      expect(Math.abs(big / small - 1), preset.id).toBeLessThan(0.005);
    }
  });

  it('T2: runs 1300 cc carrying idle on a six at least 10% lean untuned', () => {
    for (const preset of ['vq35hr', 'b58-m1']) {
      expect(idleLambda({ preset, cc: 1300 }), preset).toBeGreaterThan(1.1);
    }
  });

  it('T3: brings it back within the trim limit with the minimum pulse set', () => {
    for (const preset of ['vq35hr', 'b58-m1']) {
      const lam = idleLambda({ preset, cc: 1300, cal: { 'injector.minEffPwMs': S.ballisticFromMs(1300) } });
      expect(lam, preset).toBeLessThan(1);
      expect(lam, preset).toBeGreaterThan(1 / 1.25);
    }
  });

  it('T4: cannot be tuned back on a 1.4 L four', () => {
    const lam = idleLambda({
      cc: 1300, build: { engineConfig: SMALL_FOUR },
      cal: { 'injector.minEffPwMs': S.ballisticFromMs(1300) },
    });
    expect(lam).toBeLessThan(1 / 1.25);
  });

  it('T5: costs less on E85, whose pulses are longer', () => {
    const gas = idleLambda({ preset: 'vq35hr', cc: 1300 });
    const e85 = idleLambda({ preset: 'vq35hr', cc: 1300, build: { octaneIdx: E85 } });
    expect(Math.abs(e85 - 1)).toBeLessThan(Math.abs(gas - 1));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/injector-sizing.test.js`

Expected: FAIL. `S.ballisticFromMs is not a function`; T2 fails at about λ 1.00.

- [ ] **Step 3: Add the coefficients**

In `src/sim/ecu/ecuCoefficients.js`, replace the `BALLISTIC_OPEN_MS` entry with:

```js
  /** Open time below which the pintle never reaches full lift, ms, for a BALLISTIC_REF_CC injector. */
  BALLISTIC_OPEN_MS: 0.35,
  /** The injector size BALLISTIC_OPEN_MS describes, cc/min: the stock 315 cc part. */
  BALLISTIC_REF_CC: 315,
  /**
   * How the ballistic region grows with flow rating: open time scales as (cc / ref) to
   * this power. A higher-flow injector has a larger seat and a heavier armature to lift,
   * so it takes longer to reach full lift. FITTED, not published: it is the value that
   * leaves 850 cc untouched at a hot idle on every shipped engine, puts 1300 cc carrying
   * idle on a 3.0–3.5 L six more than 10% lean, and still lets the minimum effective pulse
   * bring that six back inside the 25% trim limit (#39, targets T1–T3). Those bound it to
   * about 0.11–0.19.
   */
  BALLISTIC_FLOW_EXP: 0.15,
```

- [ ] **Step 4: Scale the threshold and factor out per-bank metering**

In `src/sim/point.js`, replace `ballisticOpenMs` and its JSDoc with:

```js
/**
 * The open time below which an injector is ballistic: the pintle is still accelerating
 * and never reaches full lift. It grows with the flow rating, because a bigger injector
 * has a heavier armature to lift (`BALLISTIC_FLOW_EXP`), and that is the whole cost of
 * oversizing: the bigger the injector, the more of idle and light load falls inside it.
 *
 * @param {number} cc static flow rating, cc/min
 * @returns {number} ms
 */
export function ballisticFromMs(cc) {
  return ECU_COEFF.BALLISTIC_OPEN_MS * (cc / ECU_COEFF.BALLISTIC_REF_CC) ** ECU_COEFF.BALLISTIC_FLOW_EXP;
}

/**
 * Injector opening time corrected for the ballistic region. Below
 * {@link ballisticFromMs} the pintle is still accelerating and never reaches full lift,
 * so the injector passes proportionally less than its rating says. Above it, flow is
 * linear in time, which is the only region a flow rating describes.
 *
 * @param {number} openMs pulse width minus dead time
 * @param {number} [cc] the injector's flow rating, cc/min; the reference size when absent
 * @returns {number} equivalent full-flow opening time, ms
 */
export function ballisticOpenMs(openMs, cc = ECU_COEFF.BALLISTIC_REF_CC) {
  const linearFrom = ballisticFromMs(cc);
  if (openMs >= linearFrom) return openMs;
  if (openMs <= 0) return 0;
  // Flow ramps up as the needle lifts: quadratic in time, meeting the linear region at
  // its start. Always less than the rating predicts, which is why a tiny commanded pulse
  // runs lean and erratic.
  return (openMs * openMs) / linearFrom;
}

/**
 * One bank of injectors metering its share of a cycle's fuel: the pulse the ECU commands
 * for the size it has been TOLD is fitted, and what the injectors really deliver.
 *
 * @param {object} b
 * @param {number} b.fuelG fuel the ECU wants from this bank this cycle, g
 * @param {number} b.cc fitted flow rating, cc/min
 * @param {number} b.ecuCc the flow rating the ECU has been told, cc/min
 * @param {object} [b.inj] injector reality versus belief (`PointInput.inj`)
 * @param {{density: number}} b.ecuFuel the fuel the ECU believes is in the tank
 * @param {{density: number}} b.fuel the fuel actually in the tank
 * @param {number} b.cycleTimeMs one engine cycle, ms
 * @param {object|null} b.E the ECU context, when there is one
 * @returns {{ecuGramsPerMs: number, deadEcuMs: number, deadActualMs: number, pulseWidthMs: number,
 *   dutyPct: number, openMs: number, fuelLimited: boolean, deliveredG: number, ballistic: boolean}}
 */
function meterBank({ fuelG, cc, ecuCc, inj, ecuFuel, fuel, cycleTimeMs, E }) {
  const ecuGramsPerMs = (ecuCc * ecuFuel.density) / 60000 * (inj?.ecuFlowScale ?? 1);
  const actualGramsPerMs = (cc * fuel.density) / 60000 * (inj?.actualFlowScale ?? 1);
  const deadEcuMs = inj?.deadEcuMs ?? INJ_DEADTIME_MS;
  const deadActualMs = inj?.deadActualMs ?? INJ_DEADTIME_MS;
  // The shortest pulse the ECU will command: below it an injector is in its ballistic
  // region, where the needle never reaches full lift and flow stops being proportional
  // to time. Clamping trades a slightly rich idle for a repeatable one.
  const pulseWidthMs = Math.max(fuelG / ecuGramsPerMs + deadEcuMs, inj?.minPwMs ?? 0);
  const maxPulseMs = cycleTimeMs * (inj?.maxDutyFrac ?? 0.9);
  const cappedPw = Math.min(pulseWidthMs, maxPulseMs);
  const openMs = cappedPw - deadActualMs;
  return {
    ecuGramsPerMs, deadEcuMs, deadActualMs, pulseWidthMs, openMs,
    dutyPct: clamp((pulseWidthMs / cycleTimeMs) * 100, 0, 220),
    fuelLimited: pulseWidthMs > maxPulseMs,
    deliveredG: (E ? ballisticOpenMs(openMs, cc) : openMs) * actualGramsPerMs * (E?.cylinderFuelFactor ?? 1),
    // The epsilon keeps a minimum pulse set exactly to the threshold from flagging on
    // the rounding of (pulse + dead) − dead.
    ballistic: !!E && openMs > 0 && openMs < ballisticFromMs(cc) - 1e-9,
  };
}
```

Then replace the injector block. It starts at `const inj = E?.inj;` and ends after the
`deliveredFuelG` definition; keep the long `// --- INJECTOR:` comment above it as it is.

```js
  const inj = E?.inj;
  const cycleTimeMs = 120000 / rpm;
  const base = meterBank({
    fuelG: fuelMassG, cc: injectorCc, ecuCc: ecuInjectorCc, inj, ecuFuel, fuel, cycleTimeMs, E,
  });
  const { ecuGramsPerMs, deadEcuMs, deadActualMs, pulseWidthMs, dutyPct } = base;
  const fuelLimited = base.fuelLimited;
  const deliveredFuelG = Math.max(1e-6, base.deliveredG);
```

Every later reference (`pulseWidthMs`, `dutyPct`, `fuelLimited`, `deliveredFuelG`,
`ecuGramsPerMs`, `deadEcuMs`, `deadActualMs`) keeps its name. Delete the now-unused
locals (`actualGramsPerMs`, `maxPulseMs`, `cappedPw`, `openMs`) only if nothing below
still reads them: `grep -n "openMs\|cappedPw\|maxPulseMs\|actualGramsPerMs" src/sim/point.js`.

In `ecuFields`, after `deadTimeActual`, add:

```js
    // The base bank's real opening, and whether it fell inside its ballistic region:
    // what the pull log reports when an injector is too big for the fuel this load needs.
    injOpen: Number(base.openMs.toFixed(3)),
    ballistic: base.ballistic,
```

- [ ] **Step 5: Correct the calibration help text**

In `src/sim/ecu/calibration.js`, replace the `injector.minEffPwMs` help string with:

```js
    help: 'The shortest opening the ECU will command. Below it an injector is ballistic: the needle never fully lifts and delivers less than its rating predicts. About 0.35 ms on a stock 315 cc injector and longer on bigger ones (0.43 ms at 1300 cc), which is why oversized injectors idle badly until this is set.' },
```

If the fitted exponent ends up other than 0.15, recompute the 1300 cc figure:
`node -e "console.log((0.35*(1300/315)**EXP).toFixed(2))"`.

- [ ] **Step 6: Run the tests and fit the exponent**

Run: `npx vitest run tests/injector-sizing.test.js tests/ecu.test.js`

Expected: PASS. If T2 or T3 fails, adjust `BALLISTIC_FLOW_EXP` within 0.11–0.19: T2 needs
a higher value, T3 and T1 need a lower one. Re-run until all pass. If no value in that range
passes all five, stop and report the measured λ for each target. Do not change the targets.

- [ ] **Step 7: Check that the fingerprint did not move**

Run: `npx vitest run tests/fingerprint.test.js`

Expected: PASS. A failure means the path without an ECU changed. Find it before going on.

- [ ] **Step 8: Commit**

```bash
git add src/sim/ecu/ecuCoefficients.js src/sim/point.js src/sim/ecu/calibration.js tests/injector-sizing.test.js
git commit -m "Ballistic region grows with injector flow rating (#39)

A bigger injector has a longer short-pulse region, so 1300 cc carrying idle
now runs lean until the minimum effective pulse is set. Metering moves into
a per-bank helper for the port kit that follows.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pull-log event and live log channel

**Files:**
- Modify: `src/sim/ecu/ecuEvents.js` (add an event block after the `dutyprot` block, around
  line 245)
- Modify: `src/sim/ecu/liveEcu.js` (`LOG_CHANNELS` around line 80; log row around line 525;
  the summary around line 620)
- Test: `tests/injector-sizing.test.js`

**Interfaces:**
- Consumes: the point fields `injOpen` and `ballistic` (Task 1); `ballisticFromMs`.
- Produces:
  - An event `{ type: 'ballistic' }` with `msg`, `cause` and `fix`.
  - A live log channel `injOpen`.
  - Later tasks add `portBallistic` and `portOpen`; this block already reads them when
    present.

- [ ] **Step 1: Write the failing tests**

Append to `tests/injector-sizing.test.js`:

```js
describe('the pull log reports it', () => {
  const ballisticEvents = (pull) => pull.events.filter((e) => e.type === 'ballistic');

  it('reports a light-load pull on 1300 cc, with cause and fix', () => {
    const eng = makeEngine({ preset: 'vq35hr', build: { injIdx: idx(1300), ecuInjectorCc: 1300 } });
    const [ev] = ballisticEvents(eng.pull(30));
    expect(ev).toBeTruthy();
    expect(ev.msg).toMatch(/1300cc/);
    expect(ev.cause.length).toBeGreaterThan(40);
    expect(ev.fix).toMatch(/minimum effective pulse/);
  });

  it('says nothing on the stock injectors, or once the minimum pulse is set', () => {
    expect(ballisticEvents(makeEngine({ preset: 'vq35hr' }).pull(30))).toHaveLength(0);
    const tuned = makeEngine({
      preset: 'vq35hr', build: { injIdx: idx(1300), ecuInjectorCc: 1300 },
      cal: { 'injector.minEffPwMs': S.ballisticFromMs(1300) },
    });
    expect(ballisticEvents(tuned.pull(30))).toHaveLength(0);
  });

  it('logs the injector open time on the live engine', () => {
    expect(S.LOG_CHANNELS.some((c) => c.id === 'injOpen')).toBe(true);
    const r = runLive(makeEngine({ preset: 'vq35hr' }), { seconds: 4 }).rows.at(-1);
    expect(r.injOpen).toBeGreaterThan(0);
  });
});
```

Check first that `simulateSweep`'s result carries the ECU events in `.events`. If it
doesn't: `grep -n "ecuSweepEvents" src/sim/sweep.js`, then use whatever property it merges
them into. Also check that `pull(30)`'s lowest-RPM point is in the ballistic region for
1300 cc on the VQ35HR (`injOpen` below `S.ballisticFromMs(1300)`). If it isn't, use the
lowest `loadKpa` the sweep accepts at which it is, and say which in the test comment.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/injector-sizing.test.js -t "pull log"`

Expected: FAIL. No `ballistic` event, and no `injOpen` channel.

- [ ] **Step 3: Add the event**

In `src/sim/ecu/ecuEvents.js`, import the threshold:

```js
import { ballisticFromMs } from '../point.js';
```

If that import creates a cycle (`point.js` already imports `ecu/ecuCoefficients.js`, not
`ecuEvents.js`, so it should not), compute the threshold inline from `ECU_COEFF` instead.

After the `dutyprot` block, add:

```js
  // Injectors too big for the fuel this load needs: they never fully open, deliver less
  // than the ECU calculated, and the mixture misses (#39).
  const shortest = (p) => Math.min(p.ballistic ? p.injOpen : Infinity, p.portBallistic ? p.portOpen : Infinity);
  groupRuns(points, (p) => p.ballistic || p.portBallistic).forEach((run) => {
    const peak = run.reduce((a, b) => (shortest(b) < shortest(a) ? b : a));
    const port = !!peak.portBallistic && !(peak.ballistic && peak.injOpen <= peak.portOpen);
    const cc = port ? hw.portKit?.injectorCc : hw.injectorCc;
    const open = port ? peak.portOpen : peak.injOpen;
    const need = ballisticFromMs(cc).toFixed(2);
    events.push({
      type: 'ballistic', severity: 2, impact: imp(6, run), ...span(run),
      msg: `${port ? 'Port injectors' : 'Injectors'} too big for this load across ${label(run)}: open ${open} ms, short of the ${need} ms a ${cc}cc injector needs to lift fully`,
      cause: `At this load each cylinder needs so little fuel that the ${cc}cc injectors are open only ${open} ms. Below about ${need} ms the needle never reaches full lift, so they deliver less than the ECU calculated, and the mixture runs lean and varies from pulse to pulse. A bigger injector has a longer region like this, so it misses most at idle and light load, where an engine spends most of its life.`,
      fix: port
        ? 'On TUNE → INJECTORS, lower the port share at light load so the direct injectors carry it. That is what factory staging does: the port set only comes in where the direct injectors run out.'
        : `On TUNE → INJECTORS, set the minimum effective pulse to about ${need} ms. The engine idles slightly rich but steady, and the trims pull it back. If it still sits past the trim limit, the injectors are too big for this engine: fit smaller ones on BUILD → FUEL SYSTEM${hw.cfg?.injection === 'direct' ? ', or keep smaller direct injectors and add a port injection kit for the top end' : ''}.`,
    });
  });
```

- [ ] **Step 4: Add the live log channel**

In `src/sim/ecu/liveEcu.js`, add to `LOG_CHANNELS` right after the `pw` entry:

```js
  { id: 'injOpen', label: 'Injector open time', unit: 'ms' },
```

In the log row object, where `pw: pt.pw, duty: pt.duty, deadTime: pt.deadTime` appear, add
`injOpen: pt.injOpen ?? 0,`. In the summary object (around line 620), where
`pw: log ? log.pw : 0` appears, add `injOpen: log ? log.injOpen : 0,`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/injector-sizing.test.js tests/ecu.test.js tests/live.test.js`

Expected: PASS. If a test somewhere counts `LOG_CHANNELS` or snapshots a log row,
`npx vitest run` will show it. Update that count, and say so in the commit message.

- [ ] **Step 6: Run the fingerprint, then commit**

Run: `npx vitest run tests/fingerprint.test.js`. Expected: PASS.

```bash
git add src/sim/ecu/ecuEvents.js src/sim/ecu/liveEcu.js tests/injector-sizing.test.js
git commit -m "Report injectors running in their ballistic region (#39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Port kit hardware and the port share table

**Files:**
- Modify: `src/sim/ecu/ecuCoefficients.js` (add the staging constants after
  `BALLISTIC_FLOW_EXP`)
- Modify: `src/sim/ecu/calibration.js` (`injector` defaults around line 106; `ECU_META` after
  `injector.maxDutyPct`; add `factoryPortSharePct` and `portShareAt`)
- Modify: `src/sim/ecu/context.js` (`ecuHardwareOf`, add `portKitOf`)
- Modify: `src/sim/ecu/strategy.js` (`EcuHardware` typedef only)
- Create: `tests/port-kit.test.js`

**Interfaces:**
- Produces:
  - `portKitOf(build): {injectorCc: number, ecuInjectorCc: number} | null`, exported
    from `context.js`. `ecuHardwareOf(build).portKit` is the same value.
  - `factoryPortSharePct(mapKpa: number): number` (0–100).
  - `portShareAt(cal, rpm: number, mapKpa: number): number` (0–1). It falls back to the
    factory staging when a saved calibration has no `injector.portShare`.
  - The `cal.injector.portShare` table (`{x, y, z}` from `map2`).
  - The `ECU_META` entry `needs: 'portKit'`; Task 7 filters on it.
- Build field consumed: `build.portKit: null | {injIdx: number, ecuInjectorCc: number}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/port-kit.test.js`:

```js
/**
 * A port injection kit on a direct-injected engine (#39, targets T6–T10): staged by the
 * ECU so the direct injectors carry idle and light load, and fuelling the top end.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

const idx = (cc) => S.INJECTOR_OPTS.findIndex((o) => o.cc === cc);
const direct = { ...S.DEFAULT_ENGINE_CONFIG, injection: 'direct' };
const port = { ...S.DEFAULT_ENGINE_CONFIG, injection: 'port' };
const kit = { injIdx: idx(1300), ecuInjectorCc: 1300 };

describe('port kit hardware', () => {
  it('exists only on a direct-injected engine', () => {
    expect(S.portKitOf({ engineConfig: direct, portKit: kit })).toEqual({ injectorCc: 1300, ecuInjectorCc: 1300 });
    expect(S.portKitOf({ engineConfig: port, portKit: kit })).toBeNull();
    expect(S.portKitOf({ engineConfig: direct, portKit: null })).toBeNull();
    expect(S.portKitOf({ engineConfig: direct })).toBeNull();
    expect(S.ecuHardwareOf({ engineConfig: direct, octaneIdx: 0, portKit: kit }).portKit).toEqual({ injectorCc: 1300, ecuInjectorCc: 1300 });
  });
});

describe('factory staging', () => {
  it('keeps the port set off up to atmospheric, then brings it in with boost', () => {
    expect(S.factoryPortSharePct(30)).toBe(0);
    expect(S.factoryPortSharePct(100)).toBe(0);
    expect(S.factoryPortSharePct(150)).toBeGreaterThan(0);
    expect(S.factoryPortSharePct(200)).toBe(50);
    expect(S.factoryPortSharePct(300)).toBe(50);
  });

  it('ships in the default calibration and is read from it', () => {
    const cal = S.defaultEcuCalibration({});
    expect(cal.injector.portShare.z.flat().every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(S.portShareAt(cal, 3000, 40)).toBe(0);
    expect(S.portShareAt(cal, 3000, 200)).toBeCloseTo(0.5, 2);
  });

  it('falls back to factory staging on a calibration saved before the table existed', () => {
    const cal = S.defaultEcuCalibration({});
    const { portShare, ...injector } = cal.injector;
    expect(S.portShareAt({ ...cal, injector }, 3000, 200)).toBeCloseTo(0.5, 2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/port-kit.test.js`

Expected: FAIL. `S.portKitOf is not a function`.

- [ ] **Step 3: Add the staging constants**

In `src/sim/ecu/ecuCoefficients.js`, after `BALLISTIC_FLOW_EXP`:

```js
  /**
   * Factory staging of a port injection kit over direct injection: no port fuel up to
   * this manifold pressure, kPa. A port set brought in at idle runs pulses short enough to
   * be ballistic, which is exactly what staging exists to avoid, so the direct injectors
   * carry everything off boost.
   */
  PORT_STAGE_START_KPA: 100,
  /** Manifold pressure at which the port set reaches its full share, kPa. */
  PORT_STAGE_FULL_KPA: 200,
  /** The share of each cycle's fuel the port set carries once fully staged in, percent. */
  PORT_STAGE_MAX_PCT: 50,
```

- [ ] **Step 4: Add the table, its helpers and its editor entry**

In `src/sim/ecu/calibration.js`:
- add `read2` to the `./ecuTables.js` import;
- import `clamp` from `'../math.js'`;
- import `{ ECU_COEFF as E }` from `'./ecuCoefficients.js'`, if it is not already imported
  under another name (`grep -n ecuCoefficients src/sim/ecu/calibration.js`; reuse the
  existing name if there is one).

Then add, before `defaultEcuCalibration`:

```js
/**
 * The share of each cycle's fuel a factory-staged port kit carries, by manifold pressure:
 * none off boost, rising to its full share. Staging keeps the port injectors out of the
 * short pulses where they would be ballistic (#39).
 *
 * @param {number} mapKpa
 * @returns {number} percent, 0–100
 */
export function factoryPortSharePct(mapKpa) {
  const t = clamp((mapKpa - E.PORT_STAGE_START_KPA) / (E.PORT_STAGE_FULL_KPA - E.PORT_STAGE_START_KPA), 0, 1);
  return t * E.PORT_STAGE_MAX_PCT;
}

/**
 * The port share the ECU applies at an operating point, read from its table at the load
 * it believes. A calibration saved before the table existed gets the factory staging.
 *
 * @param {object} cal
 * @param {number} rpm
 * @param {number} mapKpa the manifold pressure the ECU reads
 * @returns {number} share, 0–1
 */
export function portShareAt(cal, rpm, mapKpa) {
  const table = cal.injector?.portShare;
  const pct = table ? read2(table, rpm, mapKpa) : factoryPortSharePct(mapKpa);
  return clamp(pct, 0, 100) / 100;
}
```

In `defaultEcuCalibration`, inside `injector: { ... }`, after `maxDutyPct: 90,`, add:

```js
      // Only read when a port kit is fitted (BUILD → FUEL SYSTEM, direct-injected engines).
      portShare: map2(rpmAx, mapAx, (_, m) => factoryPortSharePct(m)),
```

In `ECU_META`, after the `injector.maxDutyPct` entry, add:

```js
  { path: 'injector.portShare', section: 'injectors', group: 'Port injection kit', label: 'Port share', kind: 'map', unit: '%', xLabel: 'RPM', yLabel: 'MAP kPa', min: 0, max: 100, step: 1, needs: 'portKit',
    help: 'How much of each cycle\'s fuel goes through the port injectors; the direct injectors carry the rest. The factory stages the port set in only on boost. Port fuel at idle means short port pulses, deep in the ballistic region, and port fuel cools the valve rather than the charge, so every percent here gives back some of direct injection\'s knock margin.' },
```

- [ ] **Step 5: Expose the kit on the ECU hardware**

In `src/sim/ecu/context.js`, add `INJECTOR_OPTS` to the `../hardware.js` import, and above
`ecuHardwareOf` add:

```js
/**
 * A port injection kit as the ECU's hardware sees it. Only a direct-injected engine can
 * carry one: on a port engine the injectors already are port injectors, and upgrading
 * them is BUILD → FUEL SYSTEM's injector choice.
 *
 * @param {{engineConfig?: {injection?: string}, portKit?: {injIdx: number, ecuInjectorCc: number}|null}} build
 * @returns {{injectorCc: number, ecuInjectorCc: number}|null}
 */
export function portKitOf(build) {
  const kit = build.portKit;
  if (!kit || build.engineConfig?.injection !== 'direct') return null;
  return { injectorCc: (INJECTOR_OPTS[kit.injIdx] ?? INJECTOR_OPTS[0]).cc, ecuInjectorCc: kit.ecuInjectorCc };
}
```

In `ecuHardwareOf`'s returned object, after `cfg: build.engineConfig,`, add
`portKit: portKitOf(build),`. Make sure `src/sim/ecu/index.js` re-exports `context.js` and
`calibration.js` (`grep -n "context\|calibration" src/sim/ecu/index.js`), so `S.portKitOf`,
`S.factoryPortSharePct` and `S.portShareAt` resolve.

In `src/sim/ecu/strategy.js`'s `EcuHardware` typedef, after `@property {number} ecuInjectorCc`,
add:

```js
 * @property {{injectorCc: number, ecuInjectorCc: number}|null} [portKit] a port injection kit
 *   staged over direct injection, when one is fitted
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/port-kit.test.js tests/ecu.test.js tests/fingerprint.test.js`

Expected: PASS, fingerprint included (`factoryCalibration` hashes only VE, timing and AFR).

- [ ] **Step 7: Commit**

```bash
git add src/sim/ecu/ecuCoefficients.js src/sim/ecu/calibration.js src/sim/ecu/context.js src/sim/ecu/strategy.js tests/port-kit.test.js
git commit -m "Port injection kit hardware and factory staging table (#39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Two-bank metering and per-point blending

**Files:**
- Modify: `src/sim/point.js` (`PointInput` JSDoc; VE around line 153; the injector block from
  Task 1; `cycDerived` around line 259; `ecuFields`)
- Modify: `src/sim/ecu/strategy.js` (`ctx` in `resolveEcuPoint` around line 340; `WORST_MAX`;
  duty protection around line 538)
- Test: `tests/port-kit.test.js`

**Interfaces:**
- Consumes: `meterBank` (Task 1), `portShareAt` and `hw.portKit` (Task 3).
- Produces:
  - ECU context `E.portKit = {injectorCc, ecuInjectorCc, share}` (share 0–1), present only
    when a kit is fitted.
  - Point fields, present only when the share is above 0: `portPw` (ms, 2 decimals),
    `portDuty` (integer %), `portOpen` (ms, 3 decimals), `portBallistic` (boolean) and
    `portShare` (0–1, 3 decimals).
  - `fuelLimited` is true when either bank saturates.

- [ ] **Step 1: Write the failing tests**

Append to `tests/port-kit.test.js`:

```js
import { at, makeEngine, runLive } from './ecuHarness.js';

/** Every cell of the port share table set to `pct`. */
const flatShare = (pct) => {
  const t = S.defaultEcuCalibration({}).injector.portShare;
  return S.map2(t.x, t.y, () => pct);
};

describe('metering through a staged kit (T6–T9)', () => {
  const b58 = (patch = {}, cal = {}) => makeEngine({ preset: 'b58-m1', build: patch, cal });

  it('T6: idles exactly like the same engine with no kit, on the factory staging', () => {
    const bare = runLive(b58(), { seconds: 8 }).rows.at(-1);
    const kitted = runLive(b58({ portKit: kit }), { seconds: 8 }).rows.at(-1);
    expect(kitted.lambda).toBe(bare.lambda);
    expect(kitted.pw).toBe(bare.pw);
    expect(kitted.portPw).toBe(0);
  });

  it('T7: pays the ballistic cost when the port share is raised at idle', () => {
    const eng = b58({ portKit: kit }, { 'injector.portShare': flatShare(50) });
    expect(eng.pull(30).events.some((e) => e.type === 'ballistic')).toBe(true);
  });

  it('T8: gives back charge cooling and knock margin as port share rises', () => {
    const rpm = 4000;
    const none = at(b58({ portKit: kit }, { 'injector.portShare': flatShare(0) }).pull(100), rpm);
    const most = at(b58({ portKit: kit }, { 'injector.portShare': flatShare(80) }).pull(100), rpm);
    expect(most.endGasK).toBeGreaterThan(none.endGasK);
    expect(most.margin).toBeLessThan(none.margin);
  });

  it('T9: trips the duty protection when an undersized kit saturates', () => {
    const small = { injIdx: idx(315), ecuInjectorCc: 315 };
    const pull = b58({ portKit: small }, { 'injector.portShare': flatShare(90) }).pull(100);
    expect(pull.points.some((p) => (p.protect ?? []).includes('duty'))).toBe(true);
  });
});
```

Merge the `import` line into the file's existing imports at the top. Check that the
harness's `makeEngine` passes `build.portKit` through to `ecuHardwareOf` (it spreads
`patch` into `build`, then calls `S.ecuHardwareOf(build)`, so it should). For T8, confirm
`margin` and `endGasK` are on sweep points (see `point.js`'s return). If the B58 at
4000 RPM is not boosted at `pull(100)`, pick an RPM where `boostPsi > 5`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/port-kit.test.js -t "staged kit"`

Expected: FAIL. `kitted.portPw` is undefined, and the share does nothing.

- [ ] **Step 3: Pass the kit and its share to the point**

In `src/sim/ecu/strategy.js`, add `portShareAt` to the `./calibration.js` import
(`import { DYNO_GEAR, portShareAt } from './calibration.js';`). In `resolveEcuPoint`, just
before `const ctx = {`, add:

```js
  // A port kit's share of this cycle's fuel, read at the load the ECU believes.
  const portKit = hw.portKit ? { ...hw.portKit, share: portShareAt(cal, rpm, sMap) } : null;
```

In `ctx`, after `inj,`, add `...(portKit ? { portKit } : {}),`.

In `WORST_MAX`, add `'portDuty'` and `'portPw'`.

Replace the duty-protection condition:

```js
    if (P.dutyEnabled && hw.turboOn && Math.max(pt.duty, pt.portDuty ?? 0) > P.dutyLimitPct && mod.boostCutPsi < E.BOOST_CUT_STACK_MAX_PSI) {
```

- [ ] **Step 4: Meter the second bank and blend the physics**

In `src/sim/point.js`'s `PointInput` typedef, add:

```js
 * @property {{injectorCc: number, ecuInjectorCc: number, share: number}} [portKit] a port
 *   injection kit staged over direct injection: its fitted and believed sizes, and the
 *   share (0–1) of this cycle's fuel the ECU sends through it
```

At the top of `evaluatePoint`'s body (it must come before `veActual`), add:

```js
  // A port kit on a direct-injected engine carries this share of the fuel; the direct
  // injectors carry the rest. Zero without a kit, and zero off boost on factory staging.
  const portKit = E?.portKit ?? null;
  const portShare = portKit ? clamp(portKit.share, 0, 1) : 0;
```

Replace `const veActual = veActualVal ?? veVal;` with:

```js
  // Direct injection's extra filling comes from fuel evaporating in the cylinder while the
  // intake valve is open (VE_DIRECT_INJECTION). Fuel sent through a port kit cools the
  // valve instead, so the share it carries does not earn it.
  const diFillingKept = portShare > 0
    ? (1 + (COEFF.VE_DIRECT_INJECTION - 1) * (1 - portShare)) / COEFF.VE_DIRECT_INJECTION
    : 1;
  const veActual = (veActualVal ?? veVal) * diFillingKept;
```

Replace Task 1's injector block with:

```js
  const inj = E?.inj;
  const cycleTimeMs = 120000 / rpm;
  const base = meterBank({
    fuelG: fuelMassG * (1 - portShare), cc: injectorCc, ecuCc: ecuInjectorCc, inj, ecuFuel, fuel, cycleTimeMs, E,
  });
  // The port set rides on the same rail and the same dead-time table as the direct
  // injectors (both simplifications, see the spec): only its size and share differ.
  const portBank = portShare > 0
    ? meterBank({
      fuelG: fuelMassG * portShare, cc: portKit.injectorCc, ecuCc: portKit.ecuInjectorCc, inj, ecuFuel, fuel, cycleTimeMs, E,
    })
    : null;
  const { ecuGramsPerMs, deadEcuMs, deadActualMs, pulseWidthMs, dutyPct } = base;
  const fuelLimited = base.fuelLimited || !!portBank?.fuelLimited;
  const deliveredFuelG = Math.max(1e-6, base.deliveredG + (portBank?.deliveredG ?? 0));
```

(`fuelMassG * (1 - 0)` is `fuelMassG` exactly, and `x + 0` is `x`, so a build without a
kit computes the same numbers as before.)

Replace the `cycDerived` definition with:

```js
  // Fuel through a port kit evaporates off the valve, not in the cylinder, so the charge
  // cooling a direct-injected engine relies on shrinks with the share it carries.
  const evapInCylinder = portShare > 0
    ? portShare * COEFF.FUEL_EVAP_IN_CYLINDER_PORT + (1 - portShare) * derived.evapInCylinder
    : null;
  const cycDerived = E?.chamberOffsetK || evapInCylinder != null
    ? {
      ...derived,
      ...(E?.chamberOffsetK ? { chamberOffsetK: (derived.chamberOffsetK || 0) + E.chamberOffsetK } : {}),
      ...(evapInCylinder != null ? { evapInCylinder } : {}),
    }
    : derived;
```

Confirm that `cycDerived` is what reaches `cycle.js`'s
`evaporativeCoolingK(..., derived.evapInCylinder)` (`grep -n "cycDerived" src/sim/point.js`
and follow it into `cycleInputsFor` / `runCycle`). If evaporative cooling is also read
elsewhere from the original `derived`, pass `cycDerived` there too.

In `ecuFields`, after `ballistic: base.ballistic,`, add:

```js
    ...(portBank ? {
      portPw: Number(portBank.pulseWidthMs.toFixed(2)),
      portDuty: Math.round(portBank.dutyPct),
      portOpen: Number(portBank.openMs.toFixed(3)),
      portBallistic: portBank.ballistic,
      portShare: Number(portShare.toFixed(3)),
    } : {}),
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/port-kit.test.js tests/injector-sizing.test.js tests/ecu.test.js tests/fingerprint.test.js`

Expected: PASS. T6 only passes if no port fields appear at a share of 0. If
`kitted.portPw` is undefined rather than 0, that is Task 5's log channel; leave that one
assertion failing until then, and say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/sim/point.js src/sim/ecu/strategy.js tests/port-kit.test.js
git commit -m "Meter a staged port kit as its own bank, blending DI cooling by share (#39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Live engine: wall film, log channels, duty protection

**Files:**
- Modify: `src/sim/ecu/liveEcu.js` (`filmParams` around line 58; its call around line 419;
  `LOG_CHANNELS`; the log row; the summary; the duty protection around line 517)
- Test: `tests/port-kit.test.js`

**Interfaces:**
- Consumes: the point fields `portShare`, `portPw` and `portDuty` (Task 4).
- Produces: live log channels `portPw` and `portDuty` (0 without a kit).

- [ ] **Step 1: Write the failing test**

Append inside the `staged kit` describe in `tests/port-kit.test.js`:

```js
  it('logs both banks on the live engine, and the kit wets the port walls', () => {
    expect(S.LOG_CHANNELS.some((c) => c.id === 'portDuty')).toBe(true);
    const eng = b58({ portKit: kit }, { 'injector.portShare': flatShare(60) });
    const rows = runLive(eng, { seconds: 4 }).rows;
    expect(rows.at(-1).portPw).toBeGreaterThan(0);
    const bare = runLive(b58(), { seconds: 4 }).rows;
    // More fuel on the walls means less of a tip-in's fuel reaches the cylinder at first.
    const tip = (rs) => Math.min(...rs.map((r) => r.filmFactor ?? 100));
    const tipKit = runLive(eng, { seconds: 1, from: runLive(eng, { seconds: 4 }).state, pedal: () => 60 }).rows;
    const tipBare = runLive(b58(), { seconds: 1, from: runLive(b58(), { seconds: 4 }).state, pedal: () => 60 }).rows;
    expect(tip(tipKit)).toBeLessThan(tip(tipBare));
    expect(bare.at(-1).portPw).toBe(0);
  });
```

Check how `filmFactor` is logged (it is a `LOG_CHANNELS` entry, "Fuel reaching
cylinder", %). If it is logged as a percentage above 100 on a tip-in, flip the comparison so
it asserts that the kit's transient deviates more from 100.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/port-kit.test.js -t "live engine"`

Expected: FAIL. No `portDuty` channel.

- [ ] **Step 3: Implement**

In `src/sim/ecu/liveEcu.js`, replace `filmParams` with:

```js
/**
 * Wall-film fraction and evaporation time constant by coolant temperature. A direct
 * injector wets far less wall than a port injector; a port kit over direct injection
 * wets the ports in proportion to the share of fuel it carries.
 *
 * @param {number} ectC
 * @param {string} injection the engine's factory injection
 * @param {number} [portShare] share of the fuel through a port kit, 0–1
 */
function filmParams(ectC, injection, portShare = 0) {
  const cold = clamp((E.FILM_WARM_C - ectC) / E.FILM_COLD_SPAN_C, 0, 1);
  const k = injection === 'direct' ? E.FILM_DIRECT_SHARE + (1 - E.FILM_DIRECT_SHARE) * portShare : 1;
  return { X: k * (E.FILM_X_WARM + E.FILM_X_COLD_ADD * cold), tau: E.FILM_TAU_WARM_S + E.FILM_TAU_COLD_ADD_S * cold };
}
```

Change the call to `filmParams(s.coolantC, derived.injection, lastPt?.portShare ?? 0)`.

Add to `LOG_CHANNELS`, right after the `duty` entry:

```js
  { id: 'portPw', label: 'Port kit pulse width', unit: 'ms' },
  { id: 'portDuty', label: 'Port kit duty', unit: '%' },
```

In the log row, add `portPw: pt.portPw ?? 0, portDuty: pt.portDuty ?? 0,`. In the summary,
add `portPw: log ? log.portPw : 0, portDuty: log ? log.portDuty : 0,`.

Replace the live duty protection with:

```js
    if (turboOn && P.dutyEnabled && Math.max(pt.duty, pt.portDuty ?? 0) > P.dutyLimitPct) { prot.push('duty'); e.boostCutPsi = Math.max(e.boostCutPsi, P.boostCutPsi); }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/port-kit.test.js tests/injector-sizing.test.js tests/live.test.js tests/ecu.test.js tests/fingerprint.test.js`

Expected: PASS, including Task 4's T6 `portPw` assertion.

- [ ] **Step 5: Commit**

```bash
git add src/sim/ecu/liveEcu.js tests/port-kit.test.js
git commit -m "Live engine: port kit film, log channels and duty protection (#39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Build state: the kit field

**Files:**
- Modify: `src/ui/state/initialState.js` (the build typedef around line 44; `build` defaults
  around line 291)
- Modify: `src/ui/state/history.js` (`BUILD_KEYS`)
- Modify: `src/ui/state/pullSignature.js` (field list around line 61; labels around line 91)
- Modify: `src/ui/state/reducer.js` (`SET_ENGINE_CONFIG_PATCH` around line 570;
  `APPLY_PRESET` around line 580)
- Test: `tests/ui/state/reducer.test.js`

**Interfaces:**
- Produces: `state.build.portKit: null | {injIdx: number, ecuInjectorCc: number}`, `null`
  by default.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/state/reducer.test.js` (the file already imports `makeInitialState`,
`ACTIONS`, `reducer`, `applyPreset` and `ENGINE_PRESETS`):

```js
describe('port injection kit (#39, T10)', () => {
  const kit = { injIdx: 6, ecuInjectorCc: 1300 };
  const directState = () => {
    const s = makeInitialState();
    const withDirect = reducer(s, { type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { injection: 'direct' } });
    return reducer(withDirect, { type: ACTIONS.SET_BUILD_FIELD, field: 'portKit', value: kit });
  };

  it('starts with no kit', () => {
    expect(makeInitialState().build.portKit).toBeNull();
  });

  it('takes the kit off when the engine is switched to port injection', () => {
    const s = reducer(directState(), { type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { injection: 'port' } });
    expect(s.build.portKit).toBeNull();
  });

  it('keeps the kit through an unrelated engine change', () => {
    const s = reducer(directState(), { type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { compression: 9.5 } });
    expect(s.build.portKit).toEqual(kit);
  });

  it('a preset is a factory car: no kit', () => {
    const preset = applyPreset(ENGINE_PRESETS.find((p) => p.id === 'b58-m1'));
    const s = reducer(directState(), { type: ACTIONS.APPLY_PRESET, preset });
    expect(s.build.portKit).toBeNull();
  });
});
```

Check how existing tests in this file dispatch `APPLY_PRESET` (the action may carry more
than `preset`) and copy that exact shape. Use `S.INJECTOR_OPTS.findIndex((o) => o.cc === 1300)`
instead of the literal 6 if the file imports the sim.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ui/state/reducer.test.js -t "port injection kit"`

Expected: FAIL. `portKit` is `undefined`.

- [ ] **Step 3: Implement**

In `initialState.js`'s build typedef, after the `ecuInjectorCc` property:

```js
 * @property {{injIdx: number, ecuInjectorCc: number}|null} portKit a port injection kit
 *   staged over direct injection: its INJECTOR_OPTS index and the size the ECU is told.
 *   Direct-injected engines only
```

In the build defaults, after `ecuInjectorCc: 315,`, add `portKit: null,`.

In `history.js`'s `BUILD_KEYS`, add `'portKit'` after `'ecuInjectorCc'`.

In `pullSignature.js`, add `'portKit'` to the field list after `'ecuInjectorCc'`, and add
`portKit: 'port injection kit',` to the labels object beside `ecuInjectorCc`.

In `reducer.js`'s `SET_ENGINE_CONFIG_PATCH`, inside `build: { ... }` after `presetId: null,`:

```js
          // A port engine's injectors already are port injectors: a kit only exists over
          // direct injection.
          ...(action.patch.injection && action.patch.injection !== 'direct' ? { portKit: null } : {}),
```

In `APPLY_PRESET`, beside `nitrous: null,`, add `portKit: null,`. Extend the comment
above them to "no supercharger, nitrous or port kit carried over from the last build."

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/ui/state`

Expected: PASS. If `pullSignature.test.js` pins the exact field list, add `portKit` there.

- [ ] **Step 5: Commit**

```bash
git add src/ui/state/initialState.js src/ui/state/history.js src/ui/state/pullSignature.js src/ui/state/reducer.js tests/ui/state
git commit -m "Build state carries a port injection kit (#39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Screens: fitting the kit and scaling it

**Files:**
- Modify: `src/ui/screens/build/FuelSystemScreen.jsx` (after the Fuel Injectors `PickList`,
  around line 73)
- Modify: `src/ui/screens/tune/InjectorsScreen.jsx` (after the scaling mismatch block)
- Modify: `src/ui/components/ecu/EcuSection.jsx` (the `fields` filter, line 58, and where
  a field's value is read)
- Test: `tests/ui/build-screens.test.jsx`, `tests/ui/tune-screens.test.jsx`

**Interfaces:**
- Consumes: `build.portKit` (Task 6), `ECU_META` `needs: 'portKit'` (Task 3), `ecuHardwareOf`.

- [ ] **Step 1: Write the failing tests**

In `tests/ui/build-screens.test.jsx`, inside `describe('FuelSystemScreen', ...)`, add a test.
Follow the file's existing `mount` and `useTune` probe patterns. To put the store on a
direct-injected engine first, use a small probe component that dispatches
`{ type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { injection: 'direct' } }` on a button click:

```jsx
  it('offers a port injection kit only on a direct-injected engine', () => {
    function MakeDirect() {
      const [, dispatch] = useBuild();
      return <button type="button" onClick={() => dispatch({ type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { injection: 'direct' } })}>make direct</button>;
    }
    mount(<><MakeDirect /><FuelSystemScreen active onToggle={noop} /></>);
    expect(screen.queryByText('Port Injection Kit')).toBeNull();
    fireEvent.click(screen.getByText('make direct'));
    expect(screen.getByText('Port Injection Kit')).toBeTruthy();
  });
```

Add `useBuild` to the file's `StoreProvider.jsx` import.

In `tests/ui/tune-screens.test.jsx` (it already has `mount`, `quietProps`, `useBuild` and
`ACTIONS`; add `INJECTOR_OPTS` from `'../../src/sim/index.js'` to its imports), inside the
`InjectorsScreen` describe block, add:

```jsx
  it('scales a port kit separately, and flags it until told its size', () => {
    function FitKit() {
      const [, dispatch] = useBuild();
      return (
        <button type="button" onClick={() => {
          dispatch({ type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { injection: 'direct' } });
          dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'portKit', value: { injIdx: INJECTOR_OPTS.findIndex((o) => o.cc === 1300), ecuInjectorCc: 315 } });
        }}>fit kit</button>
      );
    }
    mount(<><FitKit /><InjectorsScreen {...quietProps} /></>);
    expect(screen.queryByText(/ECU Port Injector Scaling/)).toBeNull();
    fireEvent.click(screen.getByText('fit kit'));
    expect(screen.getByText(/ECU Port Injector Scaling/)).toBeTruthy();
    fireEvent.click(screen.getByText('RESCALE PORT KIT TO 1300cc'));
    expect(screen.getByText('Port kit scaling matches the fitted injectors.')).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ui/build-screens.test.jsx tests/ui/tune-screens.test.jsx`

Expected: FAIL. The new text is not found.

- [ ] **Step 3: The kit picker**

In `FuelSystemScreen.jsx`, read `build.engineConfig?.injection` and `build.portKit`. After
the Fuel Injectors `PickList`, add:

```jsx
      {build.engineConfig?.injection === 'direct' && (
        <>
          <div className={styles.labelSpaced}>Port Injection Kit</div>
          <PickList
            options={[{ label: 'None', value: 'none' }, ...INJECTOR_OPTS.map((o) => ({ label: o.label, value: o.label }))]}
            value={build.portKit ? INJECTOR_OPTS[build.portKit.injIdx].label : 'none'}
            onChange={(v) => dispatch({
              type: ACTIONS.SET_BUILD_FIELD, field: 'portKit',
              // A new kit's ECU scaling starts at the stock size, not the fitted one: the
              // ECU has never been told about it, and telling it is TUNE → INJECTORS.
              value: v === 'none' ? null : {
                injIdx: INJECTOR_OPTS.findIndex((o) => o.label === v),
                ecuInjectorCc: build.portKit?.ecuInjectorCc ?? INJECTOR_OPTS[0].cc,
              },
            })}
          />
          <ExpandableInfo title="Port injection over direct injection">
            Direct injectors run out of flow before the rest of a big build does, because they inject against cylinder pressure in a fraction of the cycle. The usual answer is not bigger direct injectors but a <b className={styles.em}>port injection kit</b>: a second set of injectors in the intake runners, staged in by the ECU only where the direct injectors run short.
            <br /><br />Staging is what lets a large port set live on a street engine. At idle and light load the direct injectors carry everything, so the port injectors never run the short, ballistic pulses an oversized injector cannot meter. Send them fuel at idle (TUNE › INJECTORS, port share) and they will. And port fuel cools the valve rather than the charge, so every percent the port set carries gives back some of direct injection&apos;s knock margin.
          </ExpandableInfo>
        </>
      )}
```

- [ ] **Step 4: The kit's scaling on TUNE → INJECTORS**

In `InjectorsScreen.jsx`, read `build.portKit` and `build.engineConfig?.injection`. After
the existing mismatch or match block, add:

```jsx
      {build.portKit && build.engineConfig?.injection === 'direct' && (() => {
        const kitCc = INJECTOR_OPTS[build.portKit.injIdx].cc;
        const kitEcu = build.portKit.ecuInjectorCc;
        const setKitEcu = (cc) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'portKit', value: { ...build.portKit, ecuInjectorCc: cc } });
        return (
          <>
            <div className={styles.label}>
              ECU Port Injector Scaling <span className={styles.subLabel}>— what the ECU thinks the port kit is</span>
            </div>
            <Seg label="ECU Port Injector Scaling" options={INJECTOR_OPTS.map((o) => ({ label: `${o.cc}`, id: o.cc }))} value={kitEcu} onChange={setKitEcu} equal />
            {kitEcu !== kitCc ? (
              <div className={styles.mismatchBanner}>
                <b>Port kit scaling mismatch.</b> The kit is {kitCc}cc but the ECU is calibrated for {kitEcu}cc, so wherever the port set is staged in, it delivers about {((kitCc / kitEcu) * 100).toFixed(0)}% of its share of the fuel.
                <div className={styles.mismatchAction}>
                  <Button onClick={() => setKitEcu(kitCc)}>RESCALE PORT KIT TO {kitCc}cc</Button>
                </div>
              </div>
            ) : (
              <div className={styles.matchNote}>Port kit scaling matches the fitted injectors.</div>
            )}
          </>
        );
      })()}
```

If lint rejects the IIFE (for example `react/no-unstable-nested-components` or a style
rule), lift it into a small `function PortKitScaling({ build, dispatch })` component in the
same file, with JSDoc.

- [ ] **Step 5: Show the port share table only with a kit**

In `EcuSection.jsx`, change the `fields` filter to:

```js
  const hwNow = ecuHardwareOf(build);
  // A field that only means something with a part fitted (the port share table needs a
  // port kit) is not offered without it.
  const fitted = (m) => !m.needs || !!hwNow[m.needs];
  const fields = ECU_META.filter((m) => m.section === section && fitted(m) && (showPro || !m.pro));
```

Apply `fitted(m)` to `hiddenPro` too, and reuse `hwNow` in the `setupMismatches` call.

Then find where each field's value is read for display (`getCal(cal, f.path)` in the
groups render). Make it fall back to the default, `getCal(cal, f.path) ?? getCal(def, f.path)`,
so that a calibration saved before `injector.portShare` existed shows the factory staging
when a kit is fitted. `changedCount`'s `isChanged` must apply the same fallback.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/ui`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/build/FuelSystemScreen.jsx src/ui/screens/tune/InjectorsScreen.jsx src/ui/components/ecu/EcuSection.jsx tests/ui
git commit -m "BUILD fits a port injection kit, TUNE scales and stages it (#39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Gates, fingerprint control, docs, pull request

**Files:**
- Modify: `docs/accuracy.md`, but only if it lists injector limitations
  (`grep -n -i "injector\|ballistic" docs/accuracy.md`). Add one line per simplification
  in the spec: shared rail, shared dead-time table, fitted `BALLISTIC_FLOW_EXP`.

- [ ] **Step 1: Run the fingerprint control (CLAUDE.md)**

```bash
git worktree add ../fp-control origin/main
cd ../fp-control && ln -s "$OLDPWD/node_modules" node_modules && node scripts/update-fingerprint.js --report > /dev/null && git diff --quiet tests/fixtures/fingerprint.sha256 && echo CONTROL-CLEAN; cd "$OLDPWD"
git worktree remove --force ../fp-control
```

Expected: `CONTROL-CLEAN`. Then, on the branch, run
`git diff --quiet origin/main -- tests/fixtures/fingerprint.sha256 && echo HASH-UNCHANGED`.
Expected: `HASH-UNCHANGED`.

- [ ] **Step 2: Run all four gates on Node 22**

```bash
node -v
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: Node v22.x, then each gate exits 0. `vite build` crashes intermittently on this
machine; re-run it once before treating a build failure as real. Paste the real tail of each
command's output into the report.

- [ ] **Step 3: Commit any docs change**

```bash
git add docs/accuracy.md
git commit -m "Accuracy notes for the injector sizing model (#39)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Re-sync with main and re-run the gates**

```bash
git fetch origin
git rebase origin/main
```

If anything conflicts, resolve it deliberately. Then run Step 2 again in full.

- [ ] **Step 5: Push and open the PR (the controller does this, not a task subagent)**

```bash
git push -u origin fix/39-oversized-injector-cost
gh pr create --repo DNiev/ecu-lab --draft --title "Oversized injectors cost something; port injection kit for DI engines" --body-file pr-body.md
```

`pr-body.md` is written by the controller into the scratchpad from the task reports. It says what changed, why, how it was verified (with gate output), and why the
fingerprint did not move. It includes `Closes #39` and ends with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Never merge.
