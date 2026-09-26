# Diff-vs-Stock Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show on AIR, SPARK and FUEL which cells have changed since the calibration was loaded, and by how much, and let the player put a region back in one undo step.

**Architecture:** A `tune.baseline` copy of the three tables is taken whenever a calibration is loaded (initial state, `APPLY_PRESET`, `RESET_TO_STOCK`) and rides the undo snapshot. Pure diff/revert maths goes in `src/sim/tables.js` beside 4b's ops. The grid gets a VALUES / CHANGES view (a shared `tune.diffView` flag) that draws signed deltas on a violet/cyan `diffTint` ramp, and the dock gets REVERT plus a "changed" count in its title.

**Tech Stack:** React 18, Vite, Vitest + Testing Library on jsdom 25, JSDoc-typed JS checked by `tsc --noEmit`, ESLint with `--max-warnings 0`.

**Spec:** `docs/superpowers/specs/2026-09-25-diff-vs-stock-overlay-design.md`

## Global Constraints

- Use Node 22 via nvm (`source ~/.nvm/nvm.sh && nvm use 22`) before any `npm` command; the fingerprint test only reproduces on Node 22.
- Branch: `feat/106-diff-overlay` (already exists, spec committed).
- Fingerprint unchanged: `npm test` includes the fingerprint test; never run `test:fingerprint:update`.
- Every colour resolves through `src/ui/theme.js`/`tokens.js`; computed `hsl()` is allowed only in `theme.js` (`tests/no-hardcoded-colours.test.js`).
- The tint never resolves to `ok`, `warn`, `danger` or the accent (`acc`). `deltaHeat` is not changed.
- A cell "differs" when its delta rounded to 2 dp is not 0.
- Full scale per table: VE 10, spark 6, AFR 1.0.
- Every edit is exactly one `SET_TABLE` dispatch — one undo step.
- The dock's draft/commit logic in `SelectionDock.jsx` (`draft`, `commitDraft`, `COMMIT_KEYS`, the `prevSelKey`/`prevData` reset) is not modified.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/sim/tables.js` | modify | `diffTable`, `revertRect`, `changedIn` |
| `src/ui/theme.js` | modify | `diffTint(delta, fullScale)` |
| `src/ui/components/selection.js` | modify | `formatDelta`, `countLabel` (and `opLabel` on top of it) |
| `src/ui/state/initialState.js` | modify | `tune.baseline`, `tune.diffView`, typedef |
| `src/ui/state/reducer.js` | modify | `APPLY_PRESET` / `RESET_TO_STOCK` write `baseline` |
| `src/ui/state/history.js` | modify | `baseline` in `TUNE_KEYS` |
| `src/ui/components/TuningGrid.jsx` | modify | CHANGES rendering |
| `src/ui/components/SelectModeBar.jsx` | modify | VALUES / CHANGES toggle and legend |
| `src/ui/components/SelectionDock.jsx` | modify | REVERT, changed count in title |
| `src/ui/screens/tune/{Airflow,Spark,Fuel}Screen.jsx` | modify | wire baseline, diffView, diffScale |
| `src/ui/components/README.md` | modify | one sentence on the overlay |
| `tests/table-ops.test.js` | modify | maths tests |
| `tests/theme.test.js` | modify | `diffTint` tests |
| `tests/ui/selection.test.js` | modify | `formatDelta`, `countLabel` tests |
| `tests/ui/state/reducer.test.js` | modify | baseline / diffView tests, snapshot key list |
| `tests/ui/diff-overlay.test.jsx` | create | grid, toggle and dock UI tests |

---

### Task 1: Diff maths in `tables.js`

**Files:**
- Modify: `src/sim/tables.js` (append after `smoothRect`, end of file)
- Test: `tests/table-ops.test.js`

**Interfaces:**
- Consumes: the file's existing private `mapRect(table, rect, fn)` and `orderRect(rect)`, and the `Rect` typedef.
- Produces (re-exported through `src/sim/index.js` by its existing `export * from './tables.js'`):
  - `diffTable(table: number[][], baseline: number[][]): number[][]` — signed delta per cell, 2 dp, never `-0`.
  - `revertRect(table: number[][], rect: Rect, baseline: number[][]): number[][]`
  - `changedIn(table: number[][], baseline: number[][], rect: Rect): number`

- [ ] **Step 1: Write the failing tests**

In `tests/table-ops.test.js`, extend the import:

```js
import {
  addRect, changedIn, diffTable, interpolateRect, orderRect, revertRect, scaleRect, setRect, smoothRect,
} from '../src/sim/tables.js';
```

Append at the end of the file:

```js
describe('diffTable', () => {
  it('is the signed per-cell change, rounded to 2 dp', () => {
    expect(diffTable([[10.1, 20], [30, 40]], [[10, 20.5], [30, 40]])).toEqual([[0.1, -0.5], [0, 0]]);
  });
  it('reads a difference below storage precision as no change, and never as -0', () => {
    expect(diffTable([[10.001]], [[10]])).toEqual([[0]]);
    expect(Object.is(diffTable([[9.999]], [[10]])[0][0], 0)).toBe(true);
  });
});

describe('revertRect', () => {
  it('copies only the cells inside the rectangle back from the baseline', () => {
    const edited = addRect(grid(), all, -5, B);
    expect(revertRect(edited, { r1: 1, c1: 2, r2: 0, c2: 1 }, grid())).toEqual([
      [5, 20, 30, 35],
      [45, 60, 70, 75],
      [85, 90, 94, 95],
    ]);
  });
  it('does not mutate its input', () => {
    const edited = addRect(grid(), all, -5, B);
    const copy = edited.map((r) => [...r]);
    revertRect(edited, all, grid());
    expect(edited).toEqual(copy);
  });
});

describe('changedIn', () => {
  const edited = addRect(grid(), { r1: 0, c1: 0, r2: 0, c2: 1 }, 5, B);
  it('counts the cells in the rectangle that differ from the baseline', () => {
    expect(changedIn(edited, grid(), all)).toBe(2);
    expect(changedIn(edited, grid(), { r1: 2, c1: 3, r2: 0, c2: 1 })).toBe(1);
  });
  it('is 0 where nothing moved', () => {
    expect(changedIn(edited, grid(), { r1: 1, c1: 1, r2: 1, c2: 1 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/table-ops.test.js`
Expected: FAIL — `diffTable is not a function` (and the same for the other two).

- [ ] **Step 3: Implement**

Append to `src/sim/tables.js`:

```js
// The overlay's maths (#106): how far a table has moved from the calibration it was
// loaded as, and putting a region back. Same precision rule as the ops above — a cell
// differs when its change survives rounding to storage precision (2 dp), so float noise
// from a scale-then-unscale never reads as an edit.

/**
 * @param {number} v
 * @param {number} base
 * @returns {number} the signed change, 2 dp; `|| 0` turns a -0 into 0
 */
const cellDelta = (v, base) => Number((v - base).toFixed(2)) || 0;

/**
 * Signed change of every cell from its baseline value.
 * @param {number[][]} table
 * @param {number[][]} baseline
 * @returns {number[][]}
 */
export const diffTable = (table, baseline) => table.map((row, ri) => row.map((v, ci) => cellDelta(v, baseline[ri][ci])));

/**
 * The table with the cells in `rect` put back to their baseline values. No clamping: a
 * baseline value is one the table has already held.
 * @param {number[][]} table
 * @param {Rect} rect
 * @param {number[][]} baseline
 * @returns {number[][]}
 */
export const revertRect = (table, rect, baseline) => mapRect(table, rect, (v, ri, ci) => baseline[ri][ci]);

/**
 * How many cells in `rect` differ from the baseline.
 * @param {number[][]} table
 * @param {number[][]} baseline
 * @param {Rect} rect
 * @returns {number}
 */
export function changedIn(table, baseline, rect) {
  const { r1, c1, r2, c2 } = orderRect(rect);
  let n = 0;
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (cellDelta(table[r][c], baseline[r][c]) !== 0) n++;
  return n;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/table-ops.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/tables.js tests/table-ops.test.js
git commit -m "Measure and revert a table's change from its baseline (#106)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `diffTint`, `formatDelta` and `countLabel`

**Files:**
- Modify: `src/ui/theme.js` (after `deltaHeat`, and its export line)
- Modify: `src/ui/components/selection.js` (replace `opLabel`, append `formatDelta`)
- Modify: `tests/no-hardcoded-colours.test.js` (comment only)
- Test: `tests/theme.test.js`, `tests/ui/selection.test.js`

**Interfaces:**
- Produces:
  - `diffTint(delta: number, fullScale: number): string` from `src/ui/theme.js` — `hsl(255|188, 55%, 20–40%)`.
  - `formatDelta(delta: number, decimals: number): string` from `selection.js` — `'·'` for 0, `'~0'` for a change that rounds to 0 at `decimals`, else signed (`'+2'`, `'-0.5'`).
  - `countLabel(desc: string, n: number): string` from `selection.js` — `"desc · n cell(s)"`. `opLabel(desc, rect)` keeps its signature and output, built on `countLabel`.

- [ ] **Step 1: Write the failing tests**

In `tests/theme.test.js`, change the theme import to:

```js
import { T, diffTint, heat, statusColor, statusTone, utilisationColor, utilisationTone } from '../src/ui/theme.js';
```

Append:

```js
describe('diffTint', () => {
  const hueOf = (s) => Number(/^hsl\((\d+)/.exec(s)[1]);
  const lightOf = (s) => Number(/(\d+)%\)$/.exec(s)[1]);
  /** Hue in degrees of a #rrggbb token. */
  function hexHue(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    if (d === 0) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  it('is violet for an increase and cyan for a decrease', () => {
    expect(hueGap(hueOf(diffTint(2, 10)), hexHue(tokens.violet))).toBeLessThan(3);
    expect(hueGap(hueOf(diffTint(-2, 10)), hexHue(tokens.cyan))).toBeLessThan(3);
  });
  it('brightens with magnitude and stops at full scale', () => {
    expect(lightOf(diffTint(1, 10))).toBeLessThan(lightOf(diffTint(5, 10)));
    expect(diffTint(10, 10)).toBe(diffTint(40, 10));
    expect(diffTint(-6, 6)).toBe(diffTint(-60, 6));
  });
  it('gives the smallest change a visible floor', () => {
    expect(lightOf(diffTint(0.01, 10))).toBeGreaterThanOrEqual(20);
  });
  it('is never a status colour or the accent', () => {
    for (const d of [2, -2]) {
      for (const key of ['ok', 'warn', 'danger', 'acc']) {
        expect(hueGap(hueOf(diffTint(d, 10)), hexHue(tokens[key])), `${d} vs ${key}`).toBeGreaterThanOrEqual(20);
      }
    }
  });
});
```

In `tests/ui/selection.test.js`, extend the import list with `countLabel, formatDelta` and append:

```js
describe('countLabel', () => {
  it('names the op and how many cells it changed', () => {
    expect(countLabel('revert', 3)).toBe('revert · 3 cells');
    expect(countLabel('revert', 1)).toBe('revert · 1 cell');
  });
});

describe('formatDelta', () => {
  it('prints an unchanged cell as a dot', () => {
    expect(formatDelta(0, 0)).toBe('·');
  });
  it('signs a change at the grid precision', () => {
    expect(formatDelta(2, 0)).toBe('+2');
    expect(formatDelta(-1, 0)).toBe('-1');
    expect(formatDelta(0.3, 1)).toBe('+0.3');
    expect(formatDelta(-0.5, 1)).toBe('-0.5');
  });
  it('shows ~0 for a real change too small to print', () => {
    expect(formatDelta(0.3, 0)).toBe('~0');
    expect(formatDelta(-0.3, 0)).toBe('~0');
    expect(formatDelta(0.04, 1)).toBe('~0');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/theme.test.js tests/ui/selection.test.js`
Expected: FAIL — `diffTint is not a function`, `countLabel is not a function`, `formatDelta is not a function`.

- [ ] **Step 3: Implement `diffTint`**

In `src/ui/theme.js`, insert after the `deltaHeat` function (before the `export {` line):

```js
// The hues of T.violet and T.cyan, so the overlay reads as the app's secondary data
// colours. Neither is near a status hue (ok ~150, warn ~39, danger 0) or the accent
// (~213); tests/theme.test.js holds them to that.
const DIFF_UP_HUE = 255;
const DIFF_DOWN_HUE = 188;

/**
 * Tint for a cell's change from the loaded calibration (#106): violet up, cyan down,
 * brighter with magnitude up to `fullScale`.
 *
 * Not `deltaHeat`: that one's warm half sits on red, and a table the player has simply
 * edited must never look like a fault. The floor keeps the smallest change distinct
 * from an unchanged cell, which is drawn on `T.panel2` instead of through this.
 *
 * @param {number} delta signed change, non-zero
 * @param {number} fullScale magnitude at which the colour stops brightening
 * @returns {string} an hsl() colour
 */
function diffTint(delta, fullScale) {
  const mag = clamp(Math.abs(delta) / fullScale, 0, 1);
  return `hsl(${delta > 0 ? DIFF_UP_HUE : DIFF_DOWN_HUE}, 55%, ${(20 + mag * 20).toFixed(0)}%)`;
}
```

Change the export line to:

```js
export { T, accAlpha, deltaHeat, diffTint, heat, horizonGlowAlpha, shadowAlpha, smokeAlpha, strip };
```

In `tests/no-hardcoded-colours.test.js`, change the comment text `(heat(), deltaHeat())` to `(heat(), deltaHeat(), diffTint())`.

- [ ] **Step 4: Implement `countLabel` and `formatDelta`**

In `src/ui/components/selection.js`, insert directly ABOVE the existing `opLabel` JSDoc block (defined first, since `opLabel` calls it):

```js
/**
 * An undo label for an op that changed `n` cells — which, for REVERT, is fewer than
 * the selection holds: only the cells that differed moved.
 * @param {string} desc
 * @param {number} n
 * @returns {string}
 */
export const countLabel = (desc, n) => `${desc} · ${n} ${n === 1 ? 'cell' : 'cells'}`;

```

Replace the existing `opLabel` function body (its JSDoc stays) with:

```js
export function opLabel(desc, rect) {
  return countLabel(desc, cellCount(rect));
}
```

Append at the end of the file:

```js
/**
 * A cell's change as the CHANGES view prints it, at the grid's precision. A real change
 * that rounds away (a VE cell off by 0.3 at 0 dp) reads "~0" rather than "+0", so it is
 * never mistaken for no change at all.
 * @param {number} delta from `diffTable`, so exactly 0 when unchanged
 * @param {number} decimals the grid's display precision
 * @returns {string}
 */
export function formatDelta(delta, decimals) {
  if (delta === 0) return '·';
  const s = delta.toFixed(decimals);
  if (Number(s) === 0) return '~0';
  return delta > 0 ? `+${s}` : s;
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run tests/theme.test.js tests/ui/selection.test.js tests/no-hardcoded-colours.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/theme.js src/ui/components/selection.js tests/theme.test.js tests/ui/selection.test.js tests/no-hardcoded-colours.test.js
git commit -m "Add the overlay's tint and delta formatting (#106)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `tune.baseline` and `tune.diffView` in the store

**Files:**
- Modify: `src/ui/state/initialState.js` (`TuneState` typedef; `makeInitialState`)
- Modify: `src/ui/state/reducer.js` (`APPLY_PRESET` and `RESET_TO_STOCK` cases)
- Modify: `src/ui/state/history.js` (`TUNE_KEYS` and three comments)
- Test: `tests/ui/state/reducer.test.js`

**Interfaces:**
- Produces: `state.tune.baseline: { ve: number[][], timing: number[][], afr: number[][] }` and `state.tune.diffView: boolean` (initially `false`, written only by `SET_TUNE_FIELD`).

- [ ] **Step 1: Write the failing tests**

In `tests/ui/state/reducer.test.js`:

1. In `describe('snapshot field coverage')`, rename the first test to `'snapshots exactly the documented 13 build and 5 tune fields'` and change its tune expectation to:

```js
    expect(Object.keys(snap.tune).sort()).toEqual(['afr', 'baseline', 'tablesDirty', 'timing', 've']);
```

2. In `'round-trips every snapshotted field through APPLY_PRESET + UNDO'`, add after `const beforeAfr = [[7]];`:

```js
    const beforeBaseline = { ve: [[1]], timing: [[2]], afr: [[3]] };
```

add `baseline: beforeBaseline,` to the `start.tune = { ... }` object (after `tablesDirty: true,`), add after `expect(applied.tune.tablesDirty).toBe(false);`:

```js
    expect(applied.tune.baseline).toEqual({ ve: [[80]], timing: [[20]], afr: [[12]] });
```

and add after `expect(undone.tune.tablesDirty).toBe(true);`:

```js
    expect(undone.tune.baseline).toBe(beforeBaseline);
```

3. Append at the end of the file:

```js
describe('tune.baseline (#106)', () => {
  it('starts as the tables themselves', () => {
    const s = makeInitialState();
    expect(s.tune.baseline.ve).toBe(s.tune.ve);
    expect(s.tune.baseline.timing).toBe(s.tune.timing);
    expect(s.tune.baseline.afr).toBe(s.tune.afr);
  });

  it('APPLY_PRESET takes the preset tables as the baseline', () => {
    const s = reducer(makeInitialState(), { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    expect(s.tune.baseline).toEqual({ ve: [[80]], timing: [[20]], afr: [[12]] });
  });

  it('RESET_TO_STOCK takes the reset tables as the baseline', () => {
    const s = reducer(makeInitialState(), { type: ACTIONS.RESET_TO_STOCK, ve: [[70]] });
    expect(s.tune.baseline.ve).toEqual([[70]]);
    expect(s.tune.baseline.timing).toBe(s.tune.timing);
    expect(s.tune.baseline.afr).toBe(s.tune.afr);
  });

  it('a table edit leaves it alone', () => {
    const s0 = makeInitialState();
    const s = reducer(s0, { type: ACTIONS.SET_TABLE, table: 'timing', value: [[1]] });
    expect(s.tune.baseline).toBe(s0.tune.baseline);
  });

  it('undoing a preset load puts the previous baseline back', () => {
    const s0 = makeInitialState();
    const loaded = reducer(s0, { type: ACTIONS.APPLY_PRESET, preset: N54_PRESET });
    const undone = reducer(loaded, { type: ACTIONS.UNDO });
    expect(undone.tune.baseline).toBe(s0.tune.baseline);
  });
});

describe('tune.diffView (#106)', () => {
  it('starts off and is not undoable work', () => {
    const s0 = makeInitialState();
    expect(s0.tune.diffView).toBe(false);
    const edited = reducer(s0, { type: ACTIONS.SET_TABLE, table: 've', value: [[1]] });
    const undone = reducer(edited, { type: ACTIONS.UNDO });
    const toggled = reducer(undone, { type: ACTIONS.SET_TUNE_FIELD, field: 'diffView', value: true });
    expect(toggled.tune.diffView).toBe(true);
    expect(toggled.history.past).toHaveLength(0);
    expect(toggled.history.future).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/ui/state/reducer.test.js`
Expected: FAIL — `snap.tune` keys lack `baseline`; `s.tune.baseline` is undefined; `s0.tune.diffView` is undefined.

- [ ] **Step 3: Implement initial state**

In `src/ui/state/initialState.js`, add to the `TuneState` typedef after the `rangeMode` property:

```js
 * @property {{ve: number[][], timing: number[][], afr: number[][]}} baseline the tables
 *   as they were when this calibration was loaded (start, preset, reset to stock) — what
 *   the CHANGES view and REVERT compare against. Hand and hardware edits never move it;
 *   it is in the undo snapshot so undoing a load puts the old one back
 * @property {boolean} diffView true while TUNE's grids show each cell's change from
 *   `baseline` instead of its value. Shared and outside the snapshot, like `rangeMode`
```

Change the start of `makeInitialState` from:

```js
export function makeInitialState() {
  return {
```

to:

```js
export function makeInitialState() {
  const ve = computeHardwareVE(DEFAULT_ENGINE_CONFIG, DEFAULT_MODS);
  const timing = clone2D(DEFAULT_TIMING);
  const afr = clone2D(DEFAULT_AFR);
  return {
```

and replace the `tune: { ... }` block with:

```js
    tune: {
      ve,
      timing,
      afr,
      // The same arrays, not copies: no write mutates a table, only replaces it.
      baseline: { ve, timing, afr },
      tablesDirty: false,
      selection: null,
      rangeMode: false,
      diffView: false,
    },
```

- [ ] **Step 4: Implement the reducer**

In `src/ui/state/reducer.js`, in `case ACTIONS.APPLY_PRESET`, add to the `tune: { ... }` object after `afr: p.afr,`:

```js
          // What the CHANGES view compares against from here on (#106).
          baseline: { ve: p.ve, timing: p.timing, afr: p.afr },
```

Replace the whole `case ACTIONS.RESET_TO_STOCK:` branch with:

```js
    case ACTIONS.RESET_TO_STOCK: {
      const timing = clone2D(DEFAULT_TIMING);
      const afr = clone2D(DEFAULT_AFR);
      return {
        ...state,
        build: {
          ...state.build,
          mods: DEFAULT_MODS,
          mafScalar: 1.0,
          presetId: null,
        },
        tune: {
          ...state.tune,
          ve: action.ve,
          timing,
          afr,
          baseline: { ve: action.ve, timing, afr },
          // A reset baseline is not unsaved player work — no "last call" needed to
          // pin this false, it is simply false in this same pass.
          tablesDirty: false,
        },
      };
    }
```

- [ ] **Step 5: Implement the snapshot key**

In `src/ui/state/history.js`:

- Change `const TUNE_KEYS = ['ve', 'timing', 'afr', 'tablesDirty'];` to:

```js
const TUNE_KEYS = ['ve', 'timing', 'afr', 'tablesDirty', 'baseline'];
```

- Add to the `TUNE_KEYS` JSDoc, after its existing paragraph:

```js
 *
 * `baseline` IS here, though no edit writes it: APPLY_PRESET and RESET_TO_STOCK do, and
 * undoing either must put back the baseline that went with the tables it restores, or
 * the CHANGES view would compare the old tables against the new calibration.
```

- In the `RESTORE_ALL` JSDoc change `all thirteen build fields and all four tune` to `all thirteen build fields and all five tune`.
- In the `RESTORE_CALIBRATION` JSDoc change `Puts back the four tune fields` to `Puts back the five tune fields`.
- In `restore`'s comment change `APPLY_PRESET/RESET_TO_STOCK write all four` to `APPLY_PRESET/RESET_TO_STOCK write all five`.

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npx vitest run tests/ui/state`
Expected: PASS. `pullSignature.test.js`'s projection test still expects `['afr', 'timing', 've']` — that is the proof `baseline` is not a pull input.

- [ ] **Step 7: Commit**

```bash
git add src/ui/state/initialState.js src/ui/state/reducer.js src/ui/state/history.js tests/ui/state/reducer.test.js
git commit -m "Keep the loaded calibration as a baseline, and undo it with the tables (#106)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: VALUES / CHANGES on the grid

**Files:**
- Modify: `src/ui/components/TuningGrid.jsx`
- Modify: `src/ui/components/SelectModeBar.jsx`
- Modify: `src/ui/screens/tune/AirflowScreen.jsx`, `SparkScreen.jsx`, `FuelScreen.jsx`
- Create: `tests/ui/diff-overlay.test.jsx`

**Interfaces:**
- Consumes: `diffTable` (Task 1, from `../../sim/index.js`), `diffTint` (Task 2, from `../theme.js`), `formatDelta` (Task 2, from `./selection.js`), `tune.baseline` / `tune.diffView` (Task 3).
- Produces:
  - `TuningGrid` new optional props: `baseline?: number[][]`, `diffView?: boolean` (default `false`), `diffScale?: number` (default `1`).
  - `SelectModeBar` new props: `diffView: boolean`, `setDiffView: (next: boolean) => void`. Renders a `Seg` labelled `"Table view"` with options `VALUES` / `CHANGES`, and the legend line in CHANGES.

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/diff-overlay.test.jsx`:

```jsx
// @vitest-environment jsdom

/**
 * The diff-vs-stock overlay on TUNE's grids (#106): the CHANGES view, and REVERT.
 *
 * Mounted through the real screens and store, like range-selection.test.jsx, because
 * what matters — the overlay compares against the calibration as LOADED, and REVERT
 * is one labelled undo step — lives in the join between the store and the components.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { AirflowScreen } from '../../src/ui/screens/tune/AirflowScreen.jsx';
import { FuelScreen } from '../../src/ui/screens/tune/FuelScreen.jsx';
import { SparkScreen } from '../../src/ui/screens/tune/SparkScreen.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { StoreProvider, useHistory, useTune } from '../../src/ui/state/StoreProvider.jsx';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
const hadResizeObserver = 'ResizeObserver' in window;
if (!hadResizeObserver) window.ResizeObserver = ResizeObserverStub;
afterAll(() => { if (!hadResizeObserver) delete window.ResizeObserver; });
afterEach(cleanup);

let store;
function Spy() {
  const [tune, dispatch] = useTune();
  const [history] = useHistory();
  store = { tune, dispatch, history };
  return null;
}

const VE_ADVICE = { inSync: true, maxAbs: 0, recs: [], deltas: [] };
const mountAir = () => render(<StoreProvider><Spy /><AirflowScreen veAdvice={VE_ADVICE} veTruth={[[0]]} /></StoreProvider>);
const select = (value) => act(() => { store.dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value }); });
/** Writes a VE table straight through the store: one SET_TABLE, as any edit is. */
const writeVe = (fn) => act(() => {
  store.dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: store.tune.ve.map((row, ri) => row.map((v, ci) => fn(v, ri, ci))) });
});
// LOAD = [200,150,100,70,40,20], RPM = [800,1500,2500,3500,4500,5500,6500,7500]
const cell = (rpm, kpa) => within(screen.getByTestId('tuning-grid')).getByRole('button', { name: `${rpm} RPM, ${kpa} kPa` });
const changes = () => fireEvent.click(screen.getByRole('button', { name: 'CHANGES' }));

describe('the CHANGES view', () => {
  it('starts on VALUES, showing values', () => {
    mountAir();
    expect(screen.getByRole('button', { name: 'VALUES' }).getAttribute('aria-pressed')).toBe('true');
    expect(cell(1500, 150).textContent).toBe(String(Math.round(store.tune.ve[1][1])));
  });

  it('prints each cell’s signed change, and a dot where nothing moved', () => {
    mountAir();
    writeVe((v, ri, ci) => (ri === 1 && ci === 1 ? v - 5 : v));
    changes();
    expect(cell(1500, 150).textContent).toBe('-5');
    expect(cell(2500, 150).textContent).toBe('·');
    expect(screen.getByText(/Change since this calibration was loaded/)).toBeTruthy();
  });

  it('reads a change too small to print as ~0', () => {
    mountAir();
    writeVe((v, ri, ci) => (ri === 2 && ci === 2 ? Number((v + 0.3).toFixed(2)) : v));
    changes();
    expect(cell(2500, 100).textContent).toBe('~0');
  });

  it('is shared by the grids, and survives an undo', () => {
    const calAdvice = { spark: [], overAdvanced: [], underAdvanced: [], pastMbt: [], fuelAdv: [], wrongMix: [] };
    render(
      <StoreProvider>
        <Spy />
        <SparkScreen calAdvice={calAdvice} />
        <FuelScreen calAdvice={calAdvice} />
      </StoreProvider>,
    );
    const [sparkChanges, fuelChanges] = screen.getAllByRole('button', { name: 'CHANGES' });
    fireEvent.click(sparkChanges);
    expect(store.tune.diffView).toBe(true);
    expect(fuelChanges.getAttribute('aria-pressed')).toBe('true');
    expect(store.history.past).toHaveLength(0);
  });

  it('keeps the keys editing real values', () => {
    mountAir();
    const v0 = store.tune.ve[1][1];
    changes();
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.keyDown(screen.getByTestId('tuning-grid'), { key: '-', code: 'Minus' });
    expect(store.tune.ve[1][1]).toBe(Number((v0 - 1).toFixed(2)));
    expect(cell(1500, 150).textContent).toBe('-1');
  });

  it('does not clear the selection when the view changes', () => {
    mountAir();
    select({ type: 'cell', row: 1, col: 1 });
    changes();
    expect(store.tune.selection).toEqual({ type: 'cell', row: 1, col: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/ui/diff-overlay.test.jsx`
Expected: FAIL — no button named `VALUES` / `CHANGES`.

- [ ] **Step 3: Implement the grid**

In `src/ui/components/TuningGrid.jsx`:

Change the imports to:

```js
import { LOAD, RPM, addRect, diffTable } from '../../sim/index.js';
import { T, diffTint, heat, shadowAlpha } from '../theme.js';

import { anchorOf, formatDelta, inRect, opLabel, rectOf, signed, spanSelection, stepsFor } from './selection.js';
```

Add to the file header comment, after the keyboard paragraph:

```js
 * In the CHANGES view (`SelectModeBar`) each cell shows its change from `baseline` —
 * the calibration as it was loaded — tinted violet up and cyan down. Only the drawing
 * changes: selection, keys and the dock still work on the real values.
```

Add to the props JSDoc after `setData`:

```js
 * @param {number[][]} [props.baseline] the table as loaded; without it there is no
 *   CHANGES view to draw
 * @param {boolean} [props.diffView] draw each cell's change from `baseline`
 * @param {number} [props.diffScale] the change at which the tint stops brightening
```

Change the signature and add `diff` below `fmt`:

```js
export function TuningGrid({ data, min, max, decimals, selection, setSelection, rangeMode = false, setData, baseline, diffView = false, diffScale = 1 }) {
  const fmt = (v) => (decimals ? v.toFixed(decimals) : Math.round(v));
  // 96 subtractions, on renders that already walk every cell — not memoised.
  const diff = diffView && baseline ? diffTable(data, baseline) : null;
```

In the data cell `<button>`, replace its `style` lines

```js
                  background: heat(val, min, max), color: T.ink,
```

with

```js
                  background: !diff ? heat(val, min, max) : diff[ri][ci] === 0 ? T.panel2 : diffTint(diff[ri][ci], diffScale),
                  color: diff && diff[ri][ci] === 0 ? T.ink3 : T.ink,
```

and replace its content `>{fmt(val)}</button>` with

```js
              >{diff ? formatDelta(diff[ri][ci], decimals) : fmt(val)}</button>
```

- [ ] **Step 4: Implement the toggle**

Replace the body of `src/ui/components/SelectModeBar.jsx` from its imports down with:

```jsx
import React from 'react';

import { LOAD, RPM } from '../../sim/index.js';
import { Button } from '../primitives/Button.jsx';
import { Seg } from '../primitives/Seg.jsx';
import { T } from '../theme.js';

/**
 * @param {object} props
 * @param {boolean} props.rangeMode
 * @param {(next: boolean) => void} props.setRangeMode
 * @param {(next: import('./selection.js').Selection|null) => void} props.setSelection
 * @param {boolean} props.diffView
 * @param {(next: boolean) => void} props.setDiffView
 * @returns {React.ReactElement}
 */
export function SelectModeBar({ rangeMode, setRangeMode, setSelection, diffView, setDiffView }) {
  return (
    <>
      {/* Wraps: at phone width the view toggle drops to its own line rather than
          pushing the row off the side of the screen. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center', marginBottom: 8 }}>
        {/* Changing mode clears the selection: a half-taken range means nothing in
            single-cell mode, and a single cell is not an anchor. */}
        <Seg
          label="Selection mode"
          value={rangeMode ? 'range' : 'cell'}
          onChange={(id) => { setRangeMode(id === 'range'); setSelection(null); }}
          options={[{ id: 'cell', label: 'SINGLE CELL' }, { id: 'range', label: 'SELECT RANGE' }]}
        />
        {/* Changing VIEW keeps the selection: it is the same cells, drawn differently. */}
        <Seg
          label="Table view"
          value={diffView ? 'changes' : 'values'}
          onChange={(id) => setDiffView(id === 'changes')}
          options={[{ id: 'values', label: 'VALUES' }, { id: 'changes', label: 'CHANGES' }]}
        />
        <div style={{ marginLeft: 'auto' }}>
          <Button
            variant="quiet" size="sm"
            onClick={() => setSelection({ type: 'range', r1: 0, c1: 0, r2: LOAD.length - 1, c2: RPM.length - 1 })}
          >ALL</Button>
        </div>
      </div>
      {diffView && (
        <div style={{ fontSize: 10.5, color: T.ink2, marginBottom: 6 }}>
          Change since this calibration was loaded · <span style={{ color: T.violet }}>violet up</span> · <span style={{ color: T.cyan }}>cyan down</span>
        </div>
      )}
    </>
  );
}
```

Add to the file's header comment, after its second paragraph:

```js
 *
 * VALUES / CHANGES picks what the grid draws: each cell's value, or its change since the
 * calibration was loaded (#106). `diffView` is shared the same way as `rangeMode`.
```

- [ ] **Step 5: Wire the three screens**

In each of `AirflowScreen.jsx`, `SparkScreen.jsx`, `FuelScreen.jsx`:

1. Add `baseline, diffView` to the destructure from `tune`, e.g. in SparkScreen:

```js
  const { timing, selection, rangeMode, baseline, diffView } = tune;
```

(AIR destructures `ve`, FUEL `afr`, in place of `timing`.)

2. Delete the stray `/** @param {boolean} value */` line that sits directly above the `setTable` JSDoc (it documents `setRangeMode`, and was left in the wrong place by #105), and change the `setRangeMode` line to:

```js
  /** @param {boolean} value */
  const setRangeMode = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'rangeMode', value });
  /** @param {boolean} value */
  const setDiffView = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'diffView', value });
```

3. Replace the `<SelectModeBar ... />` line with:

```jsx
          <SelectModeBar rangeMode={rangeMode} setRangeMode={setRangeMode} setSelection={setSelection} diffView={diffView} setDiffView={setDiffView} />
```

4. Add to the `<TuningGrid ... />` props, before `/>`:
   - AIR: `baseline={baseline.ve} diffView={diffView} diffScale={10}`
   - SPARK: `baseline={baseline.timing} diffView={diffView} diffScale={6}`
   - FUEL: `baseline={baseline.afr} diffView={diffView} diffScale={1}`

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npx vitest run tests/ui/diff-overlay.test.jsx tests/ui/range-selection.test.jsx tests/ui/tune-screens.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/TuningGrid.jsx src/ui/components/SelectModeBar.jsx src/ui/screens/tune tests/ui/diff-overlay.test.jsx
git commit -m "Show each cell's change since the calibration was loaded (#106)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: REVERT and the changed count on the dock

**Files:**
- Modify: `src/ui/components/SelectionDock.jsx`
- Modify: `src/ui/screens/tune/AirflowScreen.jsx`, `SparkScreen.jsx`, `FuelScreen.jsx` (dock props)
- Test: `tests/ui/diff-overlay.test.jsx`

**Interfaces:**
- Consumes: `changedIn`, `revertRect` (Task 1), `countLabel` (Task 2), `tune.baseline` (Task 3).
- Produces: `SelectionDock` new optional prop `baseline?: number[][]`. Without it (as `tests/ui/undo-controls.test.jsx` mounts it) there is no REVERT and no changed text.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/diff-overlay.test.jsx`:

```jsx
const dock = () => screen.getByTestId('selection-dock');
const revertButton = () => within(dock()).queryByRole('button', { name: 'REVERT' });

describe('REVERT and the changed count', () => {
  it('is hidden, and the title unchanged, when nothing differs', () => {
    mountAir();
    select({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(revertButton()).toBeNull();
    expect(within(dock()).getByText('Range · 800–1500 RPM × 150–200 kPa · 4 cells')).toBeTruthy();
  });

  it('titles a changed cell with what it was', () => {
    mountAir();
    const v0 = store.tune.ve[1][1];
    writeVe((v, ri, ci) => (ri === 1 && ci === 1 ? v - 5 : v));
    select({ type: 'cell', row: 1, col: 1 });
    expect(within(dock()).getByText(`1500 RPM · 150 kPa MAP · was ${Math.round(v0)}`)).toBeTruthy();
    expect(revertButton()).toBeTruthy();
  });

  it('counts the changed cells in a range', () => {
    mountAir();
    writeVe((v, ri, ci) => (ri === 0 && ci <= 1 ? v - 5 : v));
    select({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(within(dock()).getByText('Range · 800–1500 RPM × 150–200 kPa · 4 cells · 2 changed')).toBeTruthy();
  });

  it('puts the changed cells back in one undo step, counting only those', () => {
    mountAir();
    const before = store.tune.ve.map((r) => [...r]);
    writeVe((v, ri, ci) => (ri === 0 && ci <= 1 ? v - 5 : v));
    select({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 });
    fireEvent.click(revertButton());
    expect(store.tune.ve).toEqual(before);
    expect(store.history.past).toHaveLength(2);
    expect(store.history.past.at(-1).label).toBe('VE edit · revert · 2 cells');
    expect(revertButton()).toBeNull();
  });

  it('reverts a single cell', () => {
    mountAir();
    const v0 = store.tune.ve[1][1];
    writeVe((v, ri, ci) => (ri === 1 && ci === 1 ? v - 5 : v));
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.click(revertButton());
    expect(store.tune.ve[1][1]).toBe(v0);
    expect(store.history.past.at(-1).label).toBe('VE edit · revert · 1 cell');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/ui/diff-overlay.test.jsx`
Expected: the five new tests FAIL (no `REVERT`, no `was` / `changed` text); Task 4's tests still PASS.

- [ ] **Step 3: Implement the dock**

In `src/ui/components/SelectionDock.jsx`:

Change the header comment's second sentence ending `plus INTERPOLATE and SMOOTH once the selection covers more than one cell.` to:

```js
 * plus INTERPOLATE and SMOOTH once the selection covers more than one cell, and REVERT
 * once any of it differs from the calibration as loaded (#106).
```

Change the imports to:

```js
import {
  LOAD, RPM, addRect, changedIn, interpolateRect, revertRect, scaleRect, setRect, smoothRect,
} from '../../sim/index.js';
```

```js
import { cellCount, countLabel, opLabel, rectOf, selectionKey, signed, stepsFor } from './selection.js';
```

Add to the props JSDoc after `kind`:

```js
 * @param {number[][]} [props.baseline] the table as loaded — what REVERT puts back and
 *   the title's "was"/"changed" compare against. Without it, neither appears
```

Change the signature to:

```js
export function SelectionDock({ data, setData, selection, min, max, decimals, unit, onClose, kind, baseline }) {
```

After `const current = sum / count;` add:

```js
  const changed = baseline ? changedIn(data, baseline, rect) : 0;
```

After the `applySet` function add:

```js
  // Its own label rather than `write`'s: the count is the cells that moved back, not the
  // selection's size — reverting a 12-cell range with 3 edits in it is "3 cells".
  const revert = () => {
    setDraft(null);
    setData(revertRect(data, rect, baseline), countLabel('revert', changed));
  };
```

Replace the line `} else sel = \`${RPM[selection.col]} RPM · ${LOAD[selection.row]} kPa MAP\`;` with:

```js
  } else sel = `${RPM[selection.col]} RPM · ${LOAD[selection.row]} kPa MAP`;
  if (changed && count === 1) {
    const was = baseline[rect.r1][rect.c1];
    sel += ` · was ${decimals ? was.toFixed(decimals) : Math.round(was)}`;
  } else if (changed) sel += ` · ${changed} changed`;
```

Replace the closing ops block:

```jsx
      {count > 1 && (
        <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
          <Button variant="ghost" size="sm" onClick={() => write(interpolateRect(data, rect, bounds), 'interpolate')}>INTERPOLATE</Button>
          <Button variant="ghost" size="sm" onClick={() => write(smoothRect(data, rect, bounds), 'smooth')}>SMOOTH</Button>
        </div>
      )}
```

with:

```jsx
      {(count > 1 || changed > 0) && (
        <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
          {count > 1 && <Button variant="ghost" size="sm" onClick={() => write(interpolateRect(data, rect, bounds), 'interpolate')}>INTERPOLATE</Button>}
          {count > 1 && <Button variant="ghost" size="sm" onClick={() => write(smoothRect(data, rect, bounds), 'smooth')}>SMOOTH</Button>}
          {changed > 0 && <Button variant="ghost" size="sm" onClick={revert}>REVERT</Button>}
        </div>
      )}
```

- [ ] **Step 4: Pass the baseline from each screen**

Add to each `<SelectionDock ... />`, before `/>`:
- AIR: `baseline={baseline.ve}`
- SPARK: `baseline={baseline.timing}`
- FUEL: `baseline={baseline.afr}`

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run tests/ui/diff-overlay.test.jsx tests/ui/range-selection.test.jsx tests/ui/undo-controls.test.jsx`
Expected: PASS — `undo-controls` passes unchanged, since it mounts the dock without `baseline`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/SelectionDock.jsx src/ui/screens/tune tests/ui/diff-overlay.test.jsx
git commit -m "Revert a selection to the loaded calibration in one step (#106)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and full verification

**Files:**
- Modify: `src/ui/components/README.md` (the `SelectModeBar` paragraph)

- [ ] **Step 1: Document**

In `src/ui/components/README.md`, append to the paragraph beginning `` `SelectModeBar` sits above each of those grids``:

```md
 Its VALUES / CHANGES toggle switches the grid to each cell's change since the
calibration was loaded; the baseline it compares against is `tune.baseline`, set by the
store whenever a calibration is loaded, and the diff maths is in `tables.js` too.
```

- [ ] **Step 2: Run the whole gate**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test && npm run lint && npm run typecheck`
Expected: all tests pass (including the fingerprint test, unchanged), lint reports 0 problems, `tsc` exits 0.

- [ ] **Step 3: Check it in the browser**

Start the dev server (`npm run dev`, via a temporary `.claude/launch.json` entry and `preview_start`), open TUNE › SPARK, and verify:
- VALUES shows the heat map as before.
- Edit a range with `+5`, switch to CHANGES: those cells read `+5` in violet, the rest `·` on the plain panel; the legend line shows.
- Select the edited range: title ends `· N changed`; REVERT puts the values back and the undo button reads `Undo Spark edit · revert · N cells`.
- Load a preset from BUILD, edit, then undo the preset load: CHANGES compares against the calibration before the preset.
- At 375px wide, the bar wraps with no horizontal page scroll.

Remove the temporary `.claude/launch.json` afterwards.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/README.md
git commit -m "Document where the diff overlay lives (#106)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
