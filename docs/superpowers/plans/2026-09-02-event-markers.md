# Events on the Dyno Curve — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw each pull-log event across the RPM range it occupied, on both dyno charts, and let any of them be clicked or keyboard-activated through to the log entry that explains it.

**Architecture:** `src/sim/sweep.js` gains two fields on each locatable event, taken from the run it already holds. A pure UI module turns events into band models and owns the severity→tone rule that currently lives inline in `LogScreen`. `ResultScreen` renders the bands as focusable `ReferenceArea` shapes; the chart's own click handler resolves the RPM under the pointer, and `LogScreen` highlights every event whose span covers it.

**Tech Stack:** React 18 + `useReducer` (single store, three context hooks), CSS Modules, recharts, vitest + @testing-library/react, JSDoc-typed JS checked by `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-09-02-event-markers-design.md`

## Global Constraints

- **Node 22 only** — `v22.23.2`. Node 26 shifts float results and invalidates the fingerprint hash on its own.
- **Run the suite as** `./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork`. Do **not** use `npx vitest` — it resolves a different cached copy that rejects `--poolOptions`.
- **`tests/fixtures/fingerprint.sha256` must be byte-identical to `main` at merge.** This PR is the first in the #61 series permitted to edit `src/sim/`, and the permission is conditional on exactly that. Verify with `git diff --stat origin/main -- tests/fixtures/fingerprint.sha256` — expect empty output. **Never run `npm run test:fingerprint:update`.** If the hash moves, the change altered physics and the fix is to the change.
- **`tests/ui/characterisation.test.jsx` must stay byte-identical to `main`.**
- **No hard-coded colours anywhere under `src/ui/`** — no hex, no `rgb()`/`rgba()`, no `hsl()`. `tests/no-hardcoded-colours.test.js` enforces this per file. Use `var(--token)` in CSS Modules and `T.*` from `src/ui/theme.js` in JSX.
- **Full gate before every commit:** `npm test`, `npm run lint` (`--max-warnings 0`), `npm run typecheck`, `npm run build`. All four must pass.
- **Locatability is derived, never enumerated.** `isLocatable(e)` is `typeof e.rpmStart === 'number'`. A hand-kept list of type names is the exact bug `LogScreen.jsx:34-43` records — one such list named eleven of twelve types and `bearing` fell through to a chart colour.
- **Every mutation proof changes exactly ONE thing**, and must fail the specific test predicted — not merely fail something. A bundled mutation on the previous PR produced a false positive: it killed a test through one variable while the other assertion was silently vacuous.
- **`git add` explicit paths only.** Never `git add -A`, never `git add .`. Never any form of `git stash` — a pre-existing stash entry belongs to another branch.
- **A raw test total is not a stable baseline.** `no-hardcoded-colours.test.js` generates 2–3 tests per source file under `src/ui/`. Compare per-file counts.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/ui/components/eventBands.js` | The severity→tone rule and the event→band projection. Pure, no DOM. |
| `tests/ui/event-bands.test.js` | Its unit tests. |

**Modify:**

| File | Change |
|---|---|
| `src/sim/sweep.js` | `rpmStart`/`rpmEnd` on the nine locatable events; export `isLocatable`. |
| `src/ui/screens/dyno/LogScreen.jsx` | Import `eventTone` instead of computing it; highlight events covering `logFocusRpm`. |
| `src/ui/screens/dyno/ResultScreen.jsx` | Render bands on both charts; the whole-pull note; chart click handler. |
| `src/ui/screens/dyno/ResultScreen.module.css` | Band and note styles, tokens only. |
| `src/ui/screens/dyno/LogScreen.module.css` | Highlight style. |
| `src/ui/state/initialState.js` | `session.logFocusRpm`. |
| `src/ui/state/reducer.js` | `BANK_PULL` clears `logFocusRpm`. |
| `src/ui/EcuLab.jsx` | Compute bands; pass them and the select handler to `ResultScreen`. |
| `tests/physics.test.js` | Locatability tests. |
| `tests/ui/state/reducer.test.js` | The `BANK_PULL` clear. |
| `tests/ui/dyno-screens.test.jsx` | Band rendering, keyboard, highlight, the note. |

---

## Task 1: Locate the events in `src/sim/sweep.js`

**Files:**
- Modify: `src/sim/sweep.js`
- Test: `tests/physics.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: every locatable event carries `rpmStart: number` and `rpmEnd: number`; `isLocatable(event) => boolean` exported from `src/sim/sweep.js` (and therefore from `src/sim/index.js`, which does `export * from './sweep.js'`).

**The nine locatable events.** Eight are produced inside `groupRuns(points, predicate).forEach((run) => { … })`, so `run` is in scope at every push site: `knock`, `pressure`, `fuel`, `lean`, `valve`, `rich`, `maf`, `compressor`. The ninth is `float`, which is not a `groupRuns` event and takes its span from `floatRpm` to `endRpm` — both already in scope.

**The three that get nothing:** `injscale`, `cam`, `bearing`. Do not add fields to these. Their absence is the contract.

- [ ] **Step 1: Write the failing tests**

Append to `tests/physics.test.js`, **inside the `describe('dyno sweep', …)` block** (opens at line 368). That block defines the local `stockPull(overrides)` helper at line 370 and holds the existing event tests; the file already has `import * as S from '../src/sim/index.js'` and `const STOCK = S.DEFAULT_ENGINE_CONFIG`, so the fixtures below need no new imports.

```js
  it('gives every locatable event the RPM span it actually covered', () => {
    // A deliberately awful build, so that several range events fire at once.
    const r = stockPull({
      cfg: { ...STOCK, camDuration: 290, springRate: 20, compression: 12.5 },
      turboOn: true, boostCurve: [0, 4, 12, 20, 24, 25, 25, 25],
      injectorCc: 850, ecuInjectorCc: 315,
    });
    const located = r.events.filter(S.isLocatable);
    expect(located.length).toBeGreaterThan(0);
    for (const e of located) {
      expect(e.rpmEnd, `${e.type} ends before it starts`).toBeGreaterThanOrEqual(e.rpmStart);
      expect(e.rpmStart, `${e.type} starts below the sweep`).toBeGreaterThanOrEqual(S.SWEEP_START_RPM);
      expect(e.rpmEnd, `${e.type} ends above the sweep`).toBeLessThanOrEqual(r.points[r.points.length - 1].rpm);
    }
  });

  it('takes a range event\'s span from the points it was detected on', () => {
    // The span must be the RUN's own first and last point, not the whole sweep.
    // Mutation caught: rpmStart: SWEEP_START_RPM / rpmEnd: endRpm, which satisfies
    // every bound in the test above while telling the chart the knock covered
    // everything.
    const r = stockPull({ turboOn: true, boostCurve: [0, 2, 8, 12, 14, 14, 14, 14] });
    const knock = r.events.find((e) => e.type === 'knock');
    expect(knock).toBeTruthy();
    const knocking = r.points.filter((p) => p.knock);
    expect(knock.rpmStart).toBe(knocking[0].rpm);
    expect(knock.rpmEnd).toBe(knocking[knocking.length - 1].rpm);
    // And it is genuinely narrower than the sweep, or the assertion above proves nothing.
    expect(knock.rpmStart).toBeGreaterThan(r.points[0].rpm);
  });

  it('leaves the three whole-pull findings unlocated', () => {
    // The other half of the pair. injscale, cam and bearing are true everywhere, so
    // a band for them would be a lie about where they apply.
    const r = stockPull({
      cfg: { ...STOCK, camDuration: 290, springRate: 20, compression: 12.5 },
      turboOn: true, boostCurve: [0, 4, 12, 20, 24, 25, 25, 25],
      injectorCc: 850, ecuInjectorCc: 315,
    });
    for (const type of ['injscale', 'cam', 'bearing']) {
      const e = r.events.find((ev) => ev.type === type);
      expect(e, `${type} did not fire in this fixture`).toBeTruthy();
      expect(S.isLocatable(e), `${type} must not carry an RPM span`).toBe(false);
      expect(e.rpmStart).toBeUndefined();
    }
  });

  it('locates valve float from the float RPM, not from a points run', () => {
    const r = stockPull({ cfg: { ...STOCK, camDuration: 290, springRate: 20 } });
    const float = r.events.find((e) => e.type === 'float');
    expect(float).toBeTruthy();
    expect(S.isLocatable(float)).toBe(true);
    expect(float.rpmEnd).toBe(r.points[r.points.length - 1].rpm);
    expect(float.rpmStart).toBeLessThan(float.rpmEnd);
  });
```

If the fixtures above do not make `cam` or `bearing` fire, adjust the build until they do rather than deleting the assertion — the `toBeTruthy()` guard is there so a fixture that silently stops covering a type fails loudly instead of passing vacuously.

- [ ] **Step 2: Run the tests and watch them fail**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/physics.test.js
```

Expected: FAIL — `S.isLocatable is not a function`.

- [ ] **Step 3: Add the predicate**

At the end of `src/sim/sweep.js`:

```js
/**
 * Whether an event happened somewhere in particular, rather than being true of the
 * whole pull.
 *
 * Derived from the data, never from a list of type names. `LogScreen` records what a
 * hand-kept list costs: one there named eleven of the twelve types this file emits and
 * `bearing` fell through to a chart colour. A thirteenth event type added later is
 * classified correctly the day it appears — it carries a span or it does not.
 *
 * @param {{rpmStart?: number}} event
 * @returns {boolean}
 */
export function isLocatable(event) {
  return typeof event.rpmStart === 'number';
}
```

- [ ] **Step 4: Add the span to the eight range events**

In each of the eight `groupRuns(...).forEach((run) => { … events.push({ … }) })` blocks — `knock`, `pressure`, `fuel`, `lean`, `valve`, `rich`, `maf`, `compressor` — add this line to the pushed object, immediately after the `type`/`severity`/`impact` line:

```js
      rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm,
```

Add nothing to `injscale`, `cam` or `bearing`.

- [ ] **Step 5: Add the span to `float`**

In the `if (floatRpm < endRpm)` block, add to the pushed object:

```js
      rpmStart: Math.round(floatRpm), rpmEnd: endRpm,
```

`Math.round` because `floatRpm` is a computed float and the message already rounds it — the band and the sentence should agree.

- [ ] **Step 6: Run the tests and watch them pass**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/physics.test.js
```

Expected: PASS.

- [ ] **Step 7: Prove the span test holds, one mutation at a time**

Run each, confirm the named test fails and no other, then revert before the next:

1. In the `knock` block, replace the new line with `rpmStart: SWEEP_START_RPM, rpmEnd: endRpm,` → **"takes a range event's span from the points it was detected on"** must fail, and the bounds test must still pass (that is the point of having both).
2. Add `rpmStart: 0, rpmEnd: 0,` to the `injscale` event → **"leaves the three whole-pull findings unlocated"** must fail.

- [ ] **Step 8: The fingerprint gate**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/fingerprint.test.js
git diff --stat -- tests/fixtures/fingerprint.sha256
```

Expected: 4 tests pass, and **no diff on the fixture**. If the hash moved, stop and report — do not regenerate it.

- [ ] **Step 9: Full gate and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run build
git add src/sim/sweep.js tests/physics.test.js
git commit -m "Give every locatable pull-log event the RPM span it covered"
```

---

## Task 2: `eventBands.js` — the tone rule, moved and shared

**Files:**
- Create: `src/ui/components/eventBands.js`
- Modify: `src/ui/screens/dyno/LogScreen.jsx`
- Test: `tests/ui/event-bands.test.js`

**Interfaces:**
- Consumes: `isLocatable` from `src/sim/index.js`.
- Produces:
  - `eventTone(event) => 'danger' | 'warn' | 'violet'`
  - `eventBands(events) => {id: string, rpmStart: number, rpmEnd: number, tone: string, msg: string}[]`

**Why this is a move and not a copy.** `LogScreen.jsx:34-47` computes the tone inline, under a comment explaining that deriving it from severity — rather than from a hand-kept list of type names — is what stopped `bearing` rendering as decoration. The chart needs the same rule. Two copies of a rule whose own comment is about a list drifting out of date is one copy too many. `LogScreen` must end up importing it, not keeping a second implementation.

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/event-bands.test.js`:

```js
/**
 * The event → band projection, and the severity → tone rule it shares with the pull
 * log. Pure, no DOM.
 */

import { describe, expect, it } from 'vitest';

import { eventBands, eventTone } from '../../src/ui/components/eventBands.js';

const located = (over = {}) => ({ type: 'knock', severity: 3, msg: 'Knock', rpmStart: 4200, rpmEnd: 5100, ...over });
const whole = (over = {}) => ({ type: 'injscale', severity: 3, msg: 'Injectors', ...over });

describe('eventTone', () => {
  it('calls a severity 3 event danger', () => {
    expect(eventTone(located({ severity: 3 }))).toBe('danger');
  });

  it('calls a lower-severity event warn', () => {
    expect(eventTone(located({ type: 'lean', severity: 2 }))).toBe('warn');
  });

  it('calls maf violet even though its severity is the lowest', () => {
    // Mutation caught: a severity-only rule. `maf` is severity 1, so severity alone
    // would call it 'warn'. It is a calibration observation rather than damage, and
    // violet is the token reserved for that — this is the one genuine special case,
    // and it is the assertion that distinguishes the real rule from the easy one.
    expect(eventTone({ type: 'maf', severity: 1, msg: 'MAF trim' })).toBe('violet');
  });

  it('does not call a severity 3 event violet just because it is severe', () => {
    // The other half of the special case: violet must be maf and nothing else.
    expect(eventTone(located({ type: 'pressure', severity: 3 }))).toBe('danger');
  });
});

describe('eventBands', () => {
  it('projects a locatable event to its span and tone', () => {
    expect(eventBands([located()])).toEqual([
      { id: 'knock-4200-5100', rpmStart: 4200, rpmEnd: 5100, tone: 'danger', msg: 'Knock' },
    ]);
  });

  it('drops events that have no span', () => {
    // Mutation caught: returning every event. A whole-pull finding has no RPM, so a
    // band for it would claim a location it does not have.
    expect(eventBands([whole()])).toEqual([]);
  });

  it('keeps the locatable ones and drops the rest in the same list', () => {
    // Both directions in one call, so an implementation that filters nothing and one
    // that filters everything each fail.
    const bands = eventBands([located(), whole(), located({ type: 'lean', severity: 2, rpmStart: 6100, rpmEnd: 6600 })]);
    expect(bands.map((b) => b.tone)).toEqual(['danger', 'warn']);
  });

  it('gives two events of the same type at different RPMs distinct ids', () => {
    // groupRuns can emit the same type twice when the condition stops and restarts.
    // Colliding ids would make React reuse a DOM node for a different band.
    const bands = eventBands([located(), located({ rpmStart: 6000, rpmEnd: 6400 })]);
    expect(bands[0].id).not.toBe(bands[1].id);
  });

  it('returns an empty list for no events', () => {
    expect(eventBands([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/ui/event-bands.test.js
```

Expected: FAIL — cannot resolve `eventBands.js`.

- [ ] **Step 3: Write the module**

Create `src/ui/components/eventBands.js`:

```js
/**
 * Pull-log events as chart bands, and the tone rule the chart shares with the log.
 *
 * WHY THE TONE RULE LIVES HERE AND NOT IN LogScreen
 * It used to be computed inline in `LogScreen.jsx`, under a comment explaining that the
 * tone is derived from the severity the sim assigns rather than from a hand-kept list of
 * type names — because such a list once named eleven of the twelve types `src/sim` emits,
 * and `bearing` fell through to a chart-series colour. The chart now needs the same rule.
 * Keeping two copies of a rule whose whole point is that lists drift would be the
 * original bug with an extra step, so the rule moved here and both screens import it.
 *
 * Pure and DOM-free: the projection is unit-testable without rendering a chart.
 */

import { isLocatable } from '../../sim/index.js';

/**
 * The token family an event should be drawn in.
 *
 * `maf` is the one genuine special case — a calibration observation rather than damage,
 * and violet is the token reserved for that. Everything else is severity: 3 and above is
 * danger, below is warn.
 *
 * @param {{type: string, severity: number}} event
 * @returns {'danger'|'warn'|'violet'}
 */
export function eventTone(event) {
  if (event.type === 'maf') return 'violet';
  return event.severity >= 3 ? 'danger' : 'warn';
}

/**
 * @typedef {object} EventBand
 * @property {string} id stable per span, so two runs of the same type do not collide
 * @property {number} rpmStart
 * @property {number} rpmEnd
 * @property {'danger'|'warn'|'violet'} tone
 * @property {string} msg the event's own headline, for the band's accessible name
 */

/**
 * Every event that happened somewhere in particular, as a band.
 *
 * Whole-pull findings are dropped rather than stretched across the axis: a band from
 * 1500 to redline would claim a location the finding does not have. `ResultScreen`
 * accounts for them separately, in a line beneath the charts.
 *
 * @param {{type: string, severity: number, msg: string, rpmStart?: number, rpmEnd?: number}[]} events
 * @returns {EventBand[]}
 */
export function eventBands(events) {
  return events.filter(isLocatable).map((e) => ({
    id: `${e.type}-${e.rpmStart}-${e.rpmEnd}`,
    rpmStart: /** @type {number} */ (e.rpmStart),
    rpmEnd: /** @type {number} */ (e.rpmEnd),
    tone: eventTone(e),
    msg: e.msg,
  }));
}
```

- [ ] **Step 4: Move the rule out of `LogScreen`**

In `src/ui/screens/dyno/LogScreen.jsx`, add the import:

```js
import { eventTone } from '../../components/eventBands.js';
```

Delete the four `const isViolet/isDanger/isWarn/tone` lines and the comment block above them (lines 34-47), and replace with:

```js
            const tone = eventTone(e);
```

The comment's substance now lives in `eventBands.js`'s header, which is why it is deleted here rather than duplicated. Leave every other line of the map body unchanged.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/ui/event-bands.test.js tests/ui/dyno-screens.test.jsx
```

Expected: PASS. `dyno-screens.test.jsx` is included because it renders `LogScreen` — if the move changed the log's tones, it fails here.

- [ ] **Step 6: Prove the tone tests hold**

Run each mutation alone, confirm the named test fails, revert:

1. `eventTone` returns `event.severity >= 3 ? 'danger' : 'warn'` with the `maf` line deleted → **"calls maf violet even though its severity is the lowest"** must fail.
2. `eventBands` drops its `.filter(isLocatable)` → **"drops events that have no span"** must fail.

- [ ] **Step 7: Full gate and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run build
git add src/ui/components/eventBands.js src/ui/screens/dyno/LogScreen.jsx tests/ui/event-bands.test.js
git commit -m "Share one severity-to-tone rule between the pull log and the chart"
```

---

## Task 3: `session.logFocusRpm`

**Files:**
- Modify: `src/ui/state/initialState.js`, `src/ui/state/reducer.js`
- Test: `tests/ui/state/reducer.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `session.logFocusRpm: number|null`, written through the existing `ACTIONS.SET_SESSION_FIELD`. No new action.

**Why `BANK_PULL` must clear it.** A focus RPM belongs to the log of the pull it was clicked on. Carried into the next pull it would highlight whichever *new* events happen to span that RPM — a wrong answer that looks like a right one, which is worse than no answer.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/state/reducer.test.js`, inside the `describe` that holds the other `BANK_PULL` tests (reuse that block's existing `bank(...)` fixture helper — do not add a second one):

```js
  it('starts with no log focus', () => {
    expect(makeInitialState().session.logFocusRpm).toBe(null);
  });

  it('clears the log focus when a new pull is banked', () => {
    // A focus RPM belongs to the log of the pull it was clicked on. Carried forward it
    // would highlight whichever new events happen to span that RPM — wrong, and
    // indistinguishable from right.
    const focused = reducer(makeInitialState(), { type: ACTIONS.SET_SESSION_FIELD, field: 'logFocusRpm', value: 4800 });
    expect(focused.session.logFocusRpm).toBe(4800);
    expect(reducer(focused, bank('1')).session.logFocusRpm).toBe(null);
  });

  it('does not clear the log focus on an unrelated session write', () => {
    // The other half. A BANK_PULL that cleared it is right; a reducer that cleared it
    // on every session write would also pass the test above while destroying the
    // focus the moment anything else changed.
    const focused = reducer(makeInitialState(), { type: ACTIONS.SET_SESSION_FIELD, field: 'logFocusRpm', value: 4800 });
    const after = reducer(focused, { type: ACTIONS.SET_SESSION_FIELD, field: 'running', value: true });
    expect(after.session.logFocusRpm).toBe(4800);
  });
```

- [ ] **Step 2: Run and watch them fail**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/ui/state/reducer.test.js
```

Expected: FAIL — `logFocusRpm` is `undefined`, not `null`.

- [ ] **Step 3: Add the field**

In `src/ui/state/initialState.js`, add to the `SessionState` typedef immediately after the `journeyStep` property:

```js
 * @property {number|null} logFocusRpm the RPM a chart band was activated at, so the
 *   pull log can highlight every event whose span covers it. Null means no highlight.
 *   Cleared by BANK_PULL — see that case in reducer.js.
```

And in `makeInitialState`'s `session` object, after `journeyStep: 0,`:

```js
      logFocusRpm: null,
```

- [ ] **Step 4: Clear it on `BANK_PULL`**

In `src/ui/state/reducer.js`'s `BANK_PULL` case, add to the returned `session` object:

```js
          // The focus belongs to the log of the pull it was clicked on. Carried into
          // this new pull it would highlight whichever events happen to span that RPM.
          logFocusRpm: null,
```

- [ ] **Step 5: Run and watch them pass**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/ui/state/reducer.test.js
```

Expected: PASS.

- [ ] **Step 6: Prove it**

Delete the `logFocusRpm: null` line from `BANK_PULL` → **"clears the log focus when a new pull is banked"** must fail, and the "does not clear on an unrelated write" test must still pass. Restore it.

- [ ] **Step 7: Full gate and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run build
git add src/ui/state/initialState.js src/ui/state/reducer.js tests/ui/state/reducer.test.js
git commit -m "Track which RPM the pull log should highlight, and clear it per pull"
```

---

## Task 4: Bands on both charts, with keyboard access

**Files:**
- Modify: `src/ui/screens/dyno/ResultScreen.jsx`, `src/ui/screens/dyno/ResultScreen.module.css`, `src/ui/EcuLab.jsx`
- Test: `tests/ui/dyno-screens.test.jsx`

**Interfaces:**
- Consumes: `eventBands` from `src/ui/components/eventBands.js`; `isLocatable` from `src/sim/index.js`; `session.logFocusRpm` from Task 3.
- Produces: `ResultScreen` takes two new props — `bands: EventBand[]` and `onSelectRpm: (rpm: number|null) => void`.

**Both the producer and the consumer land in this task.** Introducing a required prop in one task and supplying it in the next cannot typecheck, because `EcuLab.jsx` no longer carries `@ts-nocheck`. That mistake cost a task on the previous PR.

**How the pointer path resolves the RPM.** Recharts' `<LineChart onClick={state => …}>` hands back `activeLabel`, which is the x-axis value under the pointer — the RPM. That is what makes the overlap decision work: where three bands stack it does not matter which one the pointer is "on", because the answer is a function of the RPM, not of the band. The band rects therefore take `pointerEvents: 'none'` so they never swallow the chart's own click or tooltip.

**The keyboard path** uses the focused band's midpoint, which is by definition inside that band.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/dyno-screens.test.jsx`. Use the file's existing `mount(node)` helper; do not add another harness.

```js
describe('ResultScreen event bands', () => {
  const BANDS = [
    { id: 'knock-4200-5100', rpmStart: 4200, rpmEnd: 5100, tone: 'danger', msg: 'Knock across 4200-5100' },
    { id: 'lean-6100-6600', rpmStart: 6100, rpmEnd: 6600, tone: 'warn', msg: 'Lean mixture' },
  ];
  const CHART = [{ rpm: 1500, hp: 111, torque: 222 }];

  it('draws one focusable band per event, on both charts', () => {
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={() => {}} />);
    // Two charts share the axis, so each band appears twice — that duplication is the
    // feature, not an accident, and asserting the count pins it.
    expect(screen.getAllByRole('button', { name: /Knock across 4200-5100, 4200 to 5100 RPM/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Lean mixture, 6100 to 6600 RPM/ })).toHaveLength(2);
  });

  it('draws no bands when there are none', () => {
    // The other half — an implementation that always rendered something would pass the
    // test above.
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={[]} onSelectRpm={() => {}} />);
    expect(screen.queryAllByRole('button', { name: / RPM$/ })).toHaveLength(0);
  });

  it('activates a band from the keyboard, at an RPM inside its own span', () => {
    // The keyboard path is asserted directly rather than assumed from the mouse path —
    // testing one side of that pair and trusting the other is the exact shape this
    // project keeps shipping.
    const seen = [];
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={(r) => seen.push(r)} />);
    fireEvent.keyDown(screen.getAllByRole('button', { name: /Knock across/ })[0], { key: 'Enter' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(4200);
    expect(seen[0]).toBeLessThanOrEqual(5100);
  });

  it('ignores a key that is not Enter or Space', () => {
    const seen = [];
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={(r) => seen.push(r)} />);
    fireEvent.keyDown(screen.getAllByRole('button', { name: /Knock across/ })[0], { key: 'ArrowRight' });
    expect(seen).toEqual([]);
  });

  it('shows the whole-pull note only when such findings exist', () => {
    const { rerender } = mount(
      <ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} wholePullCount={3} onSelectRpm={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /3 findings apply to the whole pull/ })).toBeTruthy();
    rerender(
      <StoreProvider>
        <ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} wholePullCount={0} onSelectRpm={() => {}} />
      </StoreProvider>,
    );
    expect(screen.queryByRole('button', { name: /apply to the whole pull/ })).toBe(null);
  });

  it('sends null when the whole-pull note is activated', () => {
    // Null means "open the log with nothing highlighted", which is distinct from any
    // RPM — a note that sent a number would highlight arbitrary events.
    const seen = [];
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={[]} wholePullCount={2} onSelectRpm={(r) => seen.push(r)} />);
    fireEvent.click(screen.getByRole('button', { name: /2 findings apply to the whole pull/ }));
    expect(seen).toEqual([null]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/ui/dyno-screens.test.jsx
```

Expected: FAIL — no elements with those accessible names.

- [ ] **Step 3: Add the band styles**

Append to `src/ui/screens/dyno/ResultScreen.module.css`:

```css
/* Event bands. Painted before the traces so the lines stay on top, and
   pointer-transparent so the chart's own click and tooltip still work — the RPM under
   the pointer is what resolves a click, not which band happens to be uppermost. */
.band {
  pointer-events: none;
}
.band[data-tone='danger'] { fill: var(--danger); stroke: var(--danger); }
.band[data-tone='warn'] { fill: var(--warn); stroke: var(--warn); }
.band[data-tone='violet'] { fill: var(--violet); stroke: var(--violet); }
.band:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: 1px;
}

.wholePull {
  margin-top: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 11px;
  text-align: left;
  width: 100%;
  color: var(--ink2);
  background: var(--panel2);
  border: 1px solid var(--line);
}
```

- [ ] **Step 4: Render the bands**

In `src/ui/screens/dyno/ResultScreen.jsx`, add `ReferenceArea` to the recharts import, extend the props and JSDoc, and add a band renderer above the component:

```jsx
/**
 * One event band. Rendered through `ReferenceArea`'s `shape` so it can carry the
 * focus and ARIA attributes a bare rect cannot.
 *
 * The rect is pointer-transparent on purpose: a click is answered by the chart, from
 * the RPM under the pointer, so where several bands overlap it does not matter which
 * one is uppermost. Keyboard activation has no pointer to read, so it uses the band's
 * own midpoint — by definition inside its span.
 *
 * @param {{band: import('../../components/eventBands.js').EventBand,
 *   onSelectRpm: (rpm: number) => void, x?: number, y?: number,
 *   width?: number, height?: number}} props
 * @returns {React.ReactElement}
 */
function Band({ band, onSelectRpm, x, y, width, height }) {
  const activate = () => onSelectRpm(Math.round((band.rpmStart + band.rpmEnd) / 2));
  return (
    <rect
      x={x} y={y} width={width} height={height}
      className={styles.band} data-tone={band.tone}
      fillOpacity={0.13} strokeOpacity={0.45}
      tabIndex={0} role="button"
      aria-label={`${band.msg}, ${band.rpmStart} to ${band.rpmEnd} RPM`}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        activate();
      }}
    />
  );
}
```

Add the props to the component signature and JSDoc:

```jsx
/**
 * @param {object} props
 * @param {Array<object>} props.chartData the shell's, shared with TUNE's ECU screen
 * @param {{redline: number}} props.engineDerived the shell's — see file header
 * @param {string|null} [props.ghostLabel] what to call the comparison series in the
 *   legend, or null/undefined to draw no ghost at all — see `ghostLabel` in runLog.js
 * @param {import('../../components/eventBands.js').EventBand[]} [props.bands]
 * @param {number} [props.wholePullCount] how many findings have no RPM at all
 * @param {(rpm: number|null) => void} [props.onSelectRpm]
 * @returns {React.ReactElement}
 */
export function ResultScreen({ chartData, engineDerived, ghostLabel, bands = [], wholePullCount = 0, onSelectRpm = () => {} }) {
```

Inside **each** of the two `<LineChart>` elements, add the click handler and render the bands immediately after `<Legend />` and before the first `<Line>`:

```jsx
          <LineChart
            data={chartData} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}
            onClick={(state) => {
              const rpm = Number(state?.activeLabel);
              if (!Number.isFinite(rpm)) return;
              if (!bands.some((b) => rpm >= b.rpmStart && rpm <= b.rpmEnd)) return;
              onSelectRpm(rpm);
            }}
          >
```

```jsx
            {bands.map((b) => (
              <ReferenceArea
                key={b.id} x1={b.rpmStart} x2={b.rpmEnd}
                shape={(shapeProps) => <Band {...shapeProps} band={b} onSelectRpm={onSelectRpm} />}
              />
            ))}
```

And after the second `</Panel>`, before the closing fragment:

```jsx
      {wholePullCount > 0 && (
        <button type="button" className={styles.wholePull} onClick={() => onSelectRpm(null)}>
          {wholePullCount} finding{wholePullCount === 1 ? '' : 's'} apply to the whole pull — open the log
        </button>
      )}
```

- [ ] **Step 5: Wire it in `EcuLab.jsx`**

Add the imports:

```js
import { eventBands } from './components/eventBands.js';
```

and add `isLocatable` to the existing `src/sim/index.js` import list.

Add above the return, near `chartData`:

```js
  // The shell computes these for the same reason it computes `chartData`: the screen
  // is handed a model rather than deriving one.
  const bands = useMemo(() => (result ? eventBands(result.events) : []), [result]);
  const wholePullCount = useMemo(
    () => (result ? result.events.filter((e) => !isLocatable(e)).length : 0),
    [result],
  );

  /**
   * Opens the pull log focused on `rpm`, or on nothing when null. Both the bands and
   * the whole-pull note go through here.
   * @param {number|null} rpm
   */
  const selectLogRpm = (rpm) => {
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'logFocusRpm', value: rpm });
    goSection('dyno', 'log');
  };
```

And extend the `ResultScreen` call site:

```jsx
                  <ResultScreen
                    chartData={chartData}
                    engineDerived={engineDerived}
                    ghostLabel={ghostLabel(ghost, pinnedRunId)}
                    bands={bands}
                    wholePullCount={wholePullCount}
                    onSelectRpm={selectLogRpm}
                  />
```

- [ ] **Step 6: Run and watch them pass**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/ui/dyno-screens.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Prove it, one mutation at a time**

1. Render the bands unconditionally with a hardcoded one-element array → **"draws no bands when there are none"** must fail.
2. Delete the `if (e.key !== 'Enter' && e.key !== ' ') return;` guard → **"ignores a key that is not Enter or Space"** must fail.
3. Change the note's handler to `onSelectRpm(0)` → **"sends null when the whole-pull note is activated"** must fail.

- [ ] **Step 8: Full gate and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run build
git add src/ui/screens/dyno/ResultScreen.jsx src/ui/screens/dyno/ResultScreen.module.css src/ui/EcuLab.jsx tests/ui/dyno-screens.test.jsx
git commit -m "Draw pull-log events as focusable bands across the RPM they covered"
```

---

## Task 5: The log highlights what the band pointed at

**Files:**
- Modify: `src/ui/screens/dyno/LogScreen.jsx`, `src/ui/screens/dyno/LogScreen.module.css`
- Test: `tests/ui/dyno-screens.test.jsx`

**Interfaces:**
- Consumes: `session.logFocusRpm` (Task 3); events carrying `rpmStart`/`rpmEnd` (Task 1).
- Produces: nothing later tasks depend on. This is the last task.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/dyno-screens.test.jsx`. Use the file's existing `mountWithResult(node, sessionFields)` helper.

```js
describe('LogScreen focus highlighting', () => {
  const RESULT = {
    points: [], peakHp: 300, peakTq: 280,
    events: [
      { type: 'knock', severity: 3, impact: 20, msg: 'Knock in the midrange', cause: 'c', fix: 'f', rpmStart: 4200, rpmEnd: 5100 },
      { type: 'lean', severity: 2, impact: 10, msg: 'Lean at the top', cause: 'c', fix: 'f', rpmStart: 6100, rpmEnd: 6600 },
      { type: 'injscale', severity: 3, impact: 30, msg: 'Injector scaling mismatch', cause: 'c', fix: 'f' },
    ],
  };

  const entry = (msg) => screen.getByText(msg).closest('[data-focused]');

  it('highlights every event whose span covers the focus RPM, and no others', () => {
    // Both directions in one assertion. Highlighting all three, and highlighting none,
    // must each fail.
    mountWithResult(<LogScreen />, { result: RESULT, logFocusRpm: 4800 });
    expect(entry('Knock in the midrange').getAttribute('data-focused')).toBe('true');
    expect(entry('Lean at the top').getAttribute('data-focused')).toBe('false');
    expect(entry('Injector scaling mismatch').getAttribute('data-focused')).toBe('false');
  });

  it('highlights an event at the exact edge of its span', () => {
    // Off-by-one: a `>` instead of `>=` drops the boundary, which is precisely the RPM
    // a player clicking the edge of a band lands on.
    mountWithResult(<LogScreen />, { result: RESULT, logFocusRpm: 4200 });
    expect(entry('Knock in the midrange').getAttribute('data-focused')).toBe('true');
  });

  it('highlights a different event when the focus moves', () => {
    mountWithResult(<LogScreen />, { result: RESULT, logFocusRpm: 6300 });
    expect(entry('Knock in the midrange').getAttribute('data-focused')).toBe('false');
    expect(entry('Lean at the top').getAttribute('data-focused')).toBe('true');
  });

  it('highlights nothing when there is no focus', () => {
    mountWithResult(<LogScreen />, { result: RESULT, logFocusRpm: null });
    for (const msg of ['Knock in the midrange', 'Lean at the top', 'Injector scaling mismatch']) {
      expect(entry(msg).getAttribute('data-focused')).toBe('false');
    }
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/ui/dyno-screens.test.jsx
```

Expected: FAIL — `closest('[data-focused]')` returns null, so `.getAttribute` throws.

- [ ] **Step 3: Add the highlight style**

Append to `src/ui/screens/dyno/LogScreen.module.css`:

```css
/* The entry a chart band pointed at. A left edge rather than a background, so it
   reads as "this one" without fighting the per-tone backgrounds above. */
.event[data-focused='true'] {
  box-shadow: inset 3px 0 0 0 var(--acc);
}
```

- [ ] **Step 4: Highlight in `LogScreen`**

Read the focus off the store and mark each entry. Replace the destructure and the `<div className={styles.event} …>` opening tag:

```jsx
  const [session] = useSession();
  const { result, logFocusRpm } = session;
```

```jsx
              <div
                key={i}
                className={styles.event}
                data-tone={tone}
                data-focused={String(
                  logFocusRpm != null
                  && typeof e.rpmStart === 'number'
                  && logFocusRpm >= e.rpmStart
                  && logFocusRpm <= e.rpmEnd,
                )}
              >
```

`data-focused` is always present, `'true'` or `'false'`, rather than being omitted when false — a missing attribute and a false one are the same thing to `querySelector`, and a test that cannot tell them apart cannot hold this.

- [ ] **Step 5: Run and watch them pass**

```bash
./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork tests/ui/dyno-screens.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Prove it, one mutation at a time**

1. Change `logFocusRpm >= e.rpmStart` to `logFocusRpm > e.rpmStart` → **"highlights an event at the exact edge of its span"** must fail, and nothing else.
2. Change the whole expression to `String(logFocusRpm != null)` → **"highlights every event whose span covers the focus RPM, and no others"** must fail.

- [ ] **Step 7: Confirm the sim gate one last time**

```bash
git diff --stat origin/main -- tests/fixtures/fingerprint.sha256 tests/ui/characterisation.test.jsx
```

Expected: no output.

- [ ] **Step 8: Full gate and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run build
git add src/ui/screens/dyno/LogScreen.jsx src/ui/screens/dyno/LogScreen.module.css tests/ui/dyno-screens.test.jsx
git commit -m "Highlight the log entries a chart band pointed at"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: the sim change and `isLocatable` to Task 1; `eventBands.js` and the `eventTone` move to Task 2; `logFocusRpm` and the `BANK_PULL` clear to Task 3; band rendering, keyboard access, the pointer path and the whole-pull note to Task 4; the log highlight to Task 5. All eight of the spec's required tests appear in the task owning the code they hold.

**Type consistency.** `EventBand` is defined once, in Task 2, and referred to by import thereafter. `onSelectRpm` takes `number|null` at every call site — bands send a number, the whole-pull note sends `null`, and `selectLogRpm` writes either straight to `logFocusRpm`, whose type is `number|null`.

**Two risks the implementer should watch, neither of which I could settle from reading alone:**

- **`ReferenceArea`'s `shape` prop contract.** The plan passes a function receiving computed `x`/`y`/`width`/`height`. If this recharts version passes them differently, adapt the `Band` signature — but keep the rect focusable with the same role and label, since that is what the tests assert and what the accessibility requirement is actually about.
- **`activeLabel` on the chart's `onClick`.** It should be the RPM, because `XAxis dataKey="rpm"`. If it arrives as a string, the `Number()` conversion in the handler already covers it; if it arrives undefined in this version, fall back to a band-level pointer handler and say so in the report — but do not silently switch the click to resolve by band, because resolving by RPM is the whole reason overlapping bands are safe.
