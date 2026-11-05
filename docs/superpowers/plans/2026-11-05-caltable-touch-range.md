# Touch Range Selection for CalTable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a finger select a block of cells on the ECU-page table editor and scroll it, as TUNE's AIR, SPARK and FUEL grids already allow (#155).

**Architecture:** All changes are in `src/ui/components/ecu/CalTable.jsx` and its CSS module. Task 1 changes how pointers select (touch and pen on click, the mouse drag fixed against stale drags, keyboard click selects) and lets the grid pan. Task 2 adds a per-table `Range` chip whose first tap anchors and second completes a rectangle. The pattern copied is `TuningGrid.jsx`'s `onCellPointerDown` / `onCellClick` / `lastPointer`.

**Tech Stack:** React 18.3, CSS Modules, Vitest + Testing Library on jsdom 25. JSDoc JS checked by `tsc --noEmit`; ESLint with `--max-warnings 0`.

## Global Constraints

- Range mode is per table, in local component state. Do not read or write `tune.rangeMode`.
- The chip's label is exactly `Range`, it sits in the bar after Compare and Axes and before All, uses `className={styles.chip}` and carries `aria-pressed`.
- Toggling Range clears the selection.
- While waiting for the second tap, the toolbar info text is exactly `1 cell · tap the opposite corner`.
- Do not reuse `spanSelection` from `src/ui/components/selection.js`.
- `.cell` in `CalTable.module.css` must not set `touch-action: none`.
- No physics or fingerprint change; nothing under `src/sim` changes.
- Run everything on Node 22: prefix commands with `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null &&`. Pipes hide vitest's exit code, so redirect output to a file and echo `$?`.
- In any file under `src/ui`, never write `#` followed by digits (the hard-coded-colour guard flags it). Write "issue 155", not "#155".
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Touch and pen select on click; mouse drags cannot go stale; the grid pans

**Files:**
- Modify: `src/ui/components/ecu/CalTable.jsx` (the `dragging` ref near line 50, the `onCellDown` / `onCellEnter` / `useEffect` block near lines 84-92, the cell `<button>` near line 190)
- Modify: `src/ui/components/ecu/CalTable.module.css` (`.cell`, near line 119)
- Test: `tests/ui/cal-table.test.jsx`

**Interfaces:**
- Produces, inside `CalTable`: `tap(r, c)` — the one place a plain press or tap selects a cell, currently `setSel({ r1: r, c1: c, r2: r, c2: c })`. Task 2 rewrites its body. Also `lastPointer` (a ref holding the last press's `pointerType`) and `onCellClick(r, c, e)`.

- [ ] **Step 1: Write the failing tests**

In `tests/ui/cal-table.test.jsx`:

Change the imports at the top to:

```js
import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { CalTable } from '../../src/ui/components/ecu/CalTable.jsx';
```

Replace the line `afterEach(cleanup);` with:

```js
// jsdom 25 has no PointerEvent, and without one `pointerType`, `shiftKey` and `buttons`
// never reach React. MouseEvent carries the last two; this adds the first.
class PointerEventStub extends window.MouseEvent {
  constructor(type, init = {}) { super(type, init); this.pointerType = init.pointerType ?? ''; }
}
const hadPointerEvent = 'PointerEvent' in window;
if (!hadPointerEvent) /** @type {any} */ (window).PointerEvent = PointerEventStub;
afterAll(() => {
  if (!hadPointerEvent) delete /** @type {any} */ (window).PointerEvent;
});
afterEach(cleanup);
```

Update the file's header comment to:

```js
/**
 * The table editor: axis breakpoints, and selecting cells by mouse, touch and keyboard.
 * A breakpoint the ECU could not search is refused, and the box always shows the
 * breakpoint the table actually has. A finger selects on click, so a swipe scrolls.
 */
```

Append at the end of the file:

```js
/** @type {import('../../src/sim/ecu/calibration.js').EcuFieldMeta} */
const MAP_META = {
  path: 'test.map', section: 'test', group: 'Test', label: 'Test map', kind: 'map', unit: '°',
  xLabel: 'RPM', yLabel: 'kPa', min: 0, max: 100, help: 'A map for the test.',
};

/** The last table the editor committed. */
let latest;

/** A 3 × 3 map over its own state. Rows are on kPa: row 0 is 50 kPa. */
function MapHarness() {
  const [table, setTable] = React.useState({
    x: [1000, 2000, 3000], y: [50, 100, 150], z: [[10, 20, 30], [40, 50, 60], [70, 80, 90]],
  });
  return <CalTable table={table} meta={MAP_META} onChange={(t) => { latest = t; setTable(t); }} />;
}

const cellAt = (rpm, kpa) => screen.getByRole('button', { name: new RegExp(`^Test map at RPM ${rpm}, kPa ${kpa}:`) });
/** The selected cells as sorted `rpm/kPa` strings. */
const selected = () => screen.getAllByRole('button', { name: /^Test map at / })
  .filter((b) => b.hasAttribute('data-selected'))
  .map((b) => /RPM (\d+), kPa (\d+)/.exec(b.getAttribute('aria-label') ?? '').slice(1).join('/'))
  .sort();
const mouse = { pointerType: 'mouse', button: 0, buttons: 1 };

describe('selecting cells', () => {
  it('a mouse drag selects the rectangle it covers, and its click does not collapse it', () => {
    render(<MapHarness />);
    fireEvent.pointerDown(cellAt(1000, 50), mouse);
    fireEvent.pointerEnter(cellAt(2000, 100), mouse);
    fireEvent.pointerUp(window, mouse);
    fireEvent.click(cellAt(2000, 100), { detail: 1 });
    expect(selected()).toEqual(['1000/100', '1000/50', '2000/100', '2000/50']);
  });

  it('a hover with no button held does not extend, even if the release was missed', () => {
    render(<MapHarness />);
    fireEvent.pointerDown(cellAt(1000, 50), mouse);
    // no pointerup: the button came up outside the window
    fireEvent.pointerEnter(cellAt(2000, 100), { pointerType: 'mouse', buttons: 0 });
    expect(selected()).toEqual(['1000/50']);
  });

  it('a cancelled pointer ends the drag', () => {
    render(<MapHarness />);
    fireEvent.pointerDown(cellAt(1000, 50), mouse);
    fireEvent.pointerCancel(window, mouse);
    fireEvent.pointerEnter(cellAt(2000, 100), mouse);
    expect(selected()).toEqual(['1000/50']);
  });

  it('shift-click extends from the anchor', () => {
    render(<MapHarness />);
    fireEvent.pointerDown(cellAt(1000, 50), mouse);
    fireEvent.pointerUp(window, mouse);
    fireEvent.pointerDown(cellAt(3000, 100), { ...mouse, shiftKey: true });
    fireEvent.pointerUp(window, mouse);
    expect(selected()).toEqual(['1000/100', '1000/50', '2000/100', '2000/50', '3000/100', '3000/50']);
  });

  it('a touch press does not start a drag; the tap selects on click', () => {
    render(<MapHarness />);
    fireEvent.pointerDown(cellAt(1000, 50), { pointerType: 'touch', buttons: 1 });
    fireEvent.pointerEnter(cellAt(2000, 100), { pointerType: 'touch', buttons: 1 });
    expect(selected()).toEqual([]);
    fireEvent.click(cellAt(1000, 50), { detail: 1 });
    expect(selected()).toEqual(['1000/50']);
  });

  it('a keyboard click selects the cell', () => {
    render(<MapHarness />);
    fireEvent.click(cellAt(2000, 150), { detail: 0 });
    expect(selected()).toEqual(['2000/150']);
  });
});

describe('touch scrolling', () => {
  it('cells do not block panning', () => {
    const css = readFileSync(new URL('../../src/ui/components/ecu/CalTable.module.css', import.meta.url), 'utf8');
    const cellRule = /(^|\n)\.cell\s*\{[^}]*\}/.exec(css)?.[0];
    expect(cellRule).toBeTruthy();
    expect(cellRule).not.toMatch(/touch-action\s*:\s*none/);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/cal-table.test.jsx > /tmp/cal1.txt 2>&1; echo $?; grep -E '✓|×|FAIL|Tests' /tmp/cal1.txt`
Expected: exit code 1. These fail: "a hover with no button held…", "a cancelled pointer ends the drag", "a touch press does not start a drag…", "a keyboard click selects the cell", "cells do not block panning". The mouse drag, shift-click and both axis-breakpoint tests pass.

- [ ] **Step 3: Implement**

In `src/ui/components/ecu/CalTable.jsx`, replace

```js
  const dragging = React.useRef(false);
```

with

```js
  const dragging = React.useRef(false);
  // Which kind of pointer pressed last. A mouse press has already selected by the time
  // its click arrives, so that click must not select again — it would collapse a drag
  // back to one cell. A keyboard click carries `detail === 0` and always goes through.
  const lastPointer = React.useRef('');
```

Replace the whole block

```js
  const onCellDown = (r, c, e) => {
    if (e.shiftKey && sel) setSel({ ...sel, r2: r, c2: c });
    else setSel({ r1: r, c1: c, r2: r, c2: c });
    dragging.current = true;
  };
  const onCellEnter = (r, c) => { if (dragging.current && sel) setSel({ ...sel, r2: r, c2: c }); };
  React.useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
```

with

```js
  /** A tap or plain press on a cell. */
  const tap = (r, c) => setSel({ r1: r, c1: c, r2: r, c2: c });

  const onCellDown = (r, c, e) => {
    lastPointer.current = e.pointerType;
    // Touch and pen keep scrolling the grid; they select on click, below.
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.shiftKey && sel) setSel({ ...sel, r2: r, c2: c });
    else tap(r, c);
    dragging.current = true;
  };
  const onCellEnter = (r, c, e) => {
    // `buttons` as well as the ref: a release outside the window never reaches the
    // listener below, and without this the next hover would still be dragging.
    if (dragging.current && (e.buttons & 1) && sel) setSel({ ...sel, r2: r, c2: c });
  };
  const onCellClick = (r, c, e) => {
    if (e.detail > 0 && lastPointer.current === 'mouse') return;
    tap(r, c);
  };
  // A drag ends wherever the button comes up, which need not be over the grid.
  React.useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
```

On the cell `<button>`, replace

```jsx
                        onPointerDown={(e) => onCellDown(r, c, e)}
                        onPointerEnter={() => onCellEnter(r, c)}
```

with

```jsx
                        onPointerDown={(e) => onCellDown(r, c, e)}
                        onPointerEnter={(e) => onCellEnter(r, c, e)}
                        onClick={(e) => onCellClick(r, c, e)}
```

In `src/ui/components/ecu/CalTable.module.css`, delete the line `  touch-action: none;` from the `.cell` rule (and only there).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/cal-table.test.jsx > /tmp/cal1.txt 2>&1; echo $?; grep -E '✓|×|FAIL|Tests' /tmp/cal1.txt`
Expected: exit code 0, 9 tests passed.

Then: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run lint > /tmp/lint1.txt 2>&1; echo $?; npm run typecheck > /tmp/tsc1.txt 2>&1; echo $?`
Expected: `0` and `0`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ecu/CalTable.jsx src/ui/components/ecu/CalTable.module.css tests/ui/cal-table.test.jsx
git commit -m "$(cat <<'EOF'
Let touch scroll the ECU tables and select on tap

Touch and pen select a cell on click rather than on pointerdown, so a swipe that
starts on a cell pans the grid, and .cell no longer sets touch-action: none.
A keyboard click now selects too. A mouse drag extends only while the button is
held, and pointercancel ends it, so a release outside the window cannot leave
the table dragging. Same handling as TuningGrid.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The Range chip — two taps, two corners

**Files:**
- Modify: `src/ui/components/ecu/CalTable.jsx` (header comment, state near line 44, `tap`, the bar, the axis header buttons, the toolbar's info and clear button)
- Test: `tests/ui/cal-table.test.jsx`

**Interfaces:**
- Consumes from Task 1: `tap(r, c)` (every plain press or tap on a cell goes through it), `onCellDown`, `onCellEnter`, and the test file's `MapHarness`, `latest`, `cellAt`, `selected`, `mouse`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/cal-table.test.jsx`:

```js
describe('the Range chip', () => {
  const range = () => screen.getByRole('button', { name: 'Range' });
  const hint = () => screen.queryByText('1 cell · tap the opposite corner');

  it('takes two taps as two corners, the toolbar edits that block, and a third tap starts over', () => {
    render(<MapHarness />);
    fireEvent.click(range());
    expect(range().getAttribute('aria-pressed')).toBe('true');

    fireEvent.pointerDown(cellAt(1000, 50), { pointerType: 'touch', buttons: 1 });
    fireEvent.click(cellAt(1000, 50), { detail: 1 });
    expect(selected()).toEqual(['1000/50']);
    expect(hint()).toBeTruthy();

    fireEvent.pointerDown(cellAt(2000, 100), { pointerType: 'touch', buttons: 1 });
    fireEvent.click(cellAt(2000, 100), { detail: 1 });
    expect(selected()).toEqual(['1000/100', '1000/50', '2000/100', '2000/50']);
    expect(hint()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(latest.z).toEqual([[11, 21, 30], [41, 51, 60], [70, 80, 90]]);

    fireEvent.click(cellAt(3000, 150), { detail: 1 });
    expect(selected()).toEqual(['3000/150']);
    expect(hint()).toBeTruthy();
  });

  it('completes the range from a mouse press on the second corner', () => {
    render(<MapHarness />);
    fireEvent.click(range());
    fireEvent.pointerDown(cellAt(1000, 50), mouse);
    fireEvent.pointerUp(window, mouse);
    fireEvent.pointerDown(cellAt(3000, 150), mouse);
    fireEvent.pointerUp(window, mouse);
    expect(selected()).toHaveLength(9);
    expect(hint()).toBeNull();
  });

  it('clears the selection when switched on or off', () => {
    render(<MapHarness />);
    fireEvent.click(cellAt(1000, 50), { detail: 0 });
    fireEvent.click(range());
    expect(selected()).toEqual([]);
    fireEvent.click(cellAt(1000, 50), { detail: 0 });
    fireEvent.click(range());
    expect(range().getAttribute('aria-pressed')).toBe('false');
    expect(selected()).toEqual([]);
    expect(hint()).toBeNull();
  });

  it('drops a waiting anchor when the selection is set another way', () => {
    render(<MapHarness />);
    fireEvent.click(range());
    fireEvent.click(cellAt(1000, 50), { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(hint()).toBeNull();
    expect(selected()).toHaveLength(9);
    // the next tap anchors a new range rather than completing one from the old anchor
    fireEvent.click(cellAt(2000, 100), { detail: 0 });
    expect(selected()).toEqual(['2000/100']);
    expect(hint()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/cal-table.test.jsx > /tmp/cal2.txt 2>&1; echo $?; grep -E '✓|×|FAIL|Tests' /tmp/cal2.txt`
Expected: exit code 1; the four "the Range chip" tests fail (no button named Range). The 9 earlier tests pass.

- [ ] **Step 3: Implement**

In `src/ui/components/ecu/CalTable.jsx`:

In the header comment, replace

```js
 * Select a cell, drag a rectangle, or take a whole row or column from its header; then
 * step, scale, set, interpolate, smooth, copy and paste. Axis breakpoints can be moved.
```

with

```js
 * Select a cell, drag a rectangle, or take a whole row or column from its header; then
 * step, scale, set, interpolate, smooth, copy and paste. Axis breakpoints can be moved.
 * A finger cannot drag a rectangle, because a drag across the grid scrolls it: Range
 * takes one in two taps, two corners.
```

After the line `const [editAxes, setEditAxes] = React.useState(false);` add

```js
  const [rangeMode, setRangeMode] = React.useState(false);
  // In range mode, true between the first tap (the anchor) and the second. The
  // selection alone cannot say so: a waiting anchor and a single cell are the same rect.
  const [pending, setPending] = React.useState(false);
```

Replace Task 1's

```js
  /** A tap or plain press on a cell. */
  const tap = (r, c) => setSel({ r1: r, c1: c, r2: r, c2: c });
```

with

```js
  /** Sets the selection any way but a tap, which drops a waiting anchor. */
  const select = (next) => { setSel(next); setPending(false); };
  /**
   * A tap or plain press on a cell. In range mode the first tap anchors a one-cell
   * range and the second completes it; any tap after that starts over.
   */
  const tap = (r, c) => {
    if (rangeMode && pending && sel) { select({ ...sel, r2: r, c2: c }); return; }
    setSel({ r1: r, c1: c, r2: r, c2: c });
    setPending(rangeMode);
  };
```

In `onCellDown`, change `if (e.shiftKey && sel) setSel({ ...sel, r2: r, c2: c });` to `if (e.shiftKey && sel) select({ ...sel, r2: r, c2: c });`.

In `onCellEnter`, change `setSel({ ...sel, r2: r, c2: c })` to `select({ ...sel, r2: r, c2: c })`.

In the bar, replace

```jsx
        <button type="button" className={styles.chip} aria-pressed={editAxes} onClick={() => setEditAxes(!editAxes)}>Axes</button>
        <button type="button" className={styles.chip} onClick={() => setSel(all)}>All</button>
```

with

```jsx
        <button type="button" className={styles.chip} aria-pressed={editAxes} onClick={() => setEditAxes(!editAxes)}>Axes</button>
        {/* Toggling clears the selection: a half-taken range means nothing in
            single-cell mode, and a single cell is not an anchor. */}
        <button type="button" className={styles.chip} aria-pressed={rangeMode} onClick={() => { setRangeMode(!rangeMode); select(null); }}>Range</button>
        <button type="button" className={styles.chip} onClick={() => select(all)}>All</button>
```

In the column header button, change `onClick={() => setSel({ r1: 0, r2: nRows - 1, c1: c, c2: c })}` to `onClick={() => select({ r1: 0, r2: nRows - 1, c1: c, c2: c })}`.

In the row header button, change `onClick={() => setSel({ r1: r, r2: r, c1: 0, c2: nCols - 1 })}` to `onClick={() => select({ r1: r, r2: r, c1: 0, c2: nCols - 1 })}`.

In the toolbar, replace

```jsx
          <span className={styles.selInfo}>{selInfo.cells} cell{selInfo.cells > 1 ? 's' : ''} · mean {fmt(selInfo.mean)}</span>
```

with

```jsx
          <span className={styles.selInfo}>
            {pending ? '1 cell · tap the opposite corner' : `${selInfo.cells} cell${selInfo.cells > 1 ? 's' : ''} · mean ${fmt(selInfo.mean)}`}
          </span>
```

and change the clear button's `onClick={() => setSel(null)}` to `onClick={() => select(null)}`.

After this, `setSel(` appears only inside `select` and `tap`. Check: `grep -n 'setSel(' src/ui/components/ecu/CalTable.jsx` prints exactly two lines.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/cal-table.test.jsx > /tmp/cal2.txt 2>&1; echo $?; grep -E '✓|×|FAIL|Tests' /tmp/cal2.txt`
Expected: exit code 0, 13 tests passed.

Then the full gates:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test > /tmp/test2.txt 2>&1; echo "test $?"; npm run lint > /tmp/lint2.txt 2>&1; echo "lint $?"; npm run typecheck > /tmp/tsc2.txt 2>&1; echo "tsc $?"; npm run build > /tmp/build2.txt 2>&1; echo "build $?"
```

Expected: all four `0`. (`vite build` crashes intermittently on this Mac; if build fails with no compile error, rerun it once.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ecu/CalTable.jsx tests/ui/cal-table.test.jsx
git commit -m "$(cat <<'EOF'
Add a Range chip to the ECU tables: two taps, two corners

A finger cannot drag a rectangle, because a drag scrolls the grid. With Range
on, the first tap anchors a one-cell range and the second completes it; a third
starts over. The toolbar says "tap the opposite corner" while it waits. Range
is per table, in local state, and toggling it clears the selection, as the
base grids' SELECT RANGE does.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
