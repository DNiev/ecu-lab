# Diff-vs-Stock Overlay — Design

**Issue:** #106 (UI overhaul PR 4c), sub-issue of #6. Follows 4b (range selection and
bulk ops, #105 / #113).

**Goal:** Let the player see at a glance which cells of AIR, SPARK and FUEL they have
changed since the calibration was loaded, and by how much — and put a region back in
one move.

## Scope

| In | Out |
|---|---|
| A baseline copy of the tables, taken whenever a calibration is loaded | Comparing two saved builds (PR 6, the garage, #62) |
| A VALUES / CHANGES view on the three calibration grids | Keyboard shortcut for the view |
| REVERT on the dock, and a "changed" count in its title | Changing `deltaHeat` on the DATA screen |

## What the code looks like today (verified against `4b4b28d`)

- `APPLY_PRESET` writes the preset's `ve`/`timing`/`afr`; `RESET_TO_STOCK` writes a
  caller-computed `ve` plus `DEFAULT_TIMING`/`DEFAULT_AFR`. Nothing keeps a copy of
  either once the player edits.
- Every hand edit (`SET_TABLE`) and every hardware edit clears `build.presetId`, so
  `presetId` cannot be used to find "stock" after the first edit.
- The VE table does not follow the hardware on its own: RECALC VE on AIR and ACCEPT
  RE-LOGGED VALUES on DATA are both `SET_TABLE` dispatches.
- `history.js` snapshots `TUNE_KEYS = ['ve', 'timing', 'afr', 'tablesDirty']`; both
  restore scopes put back the whole tune side of the snapshot.
- `pullSignature.js` measures allowlisted keys only (`MEASURED_TUNE_KEYS`), so a new
  TUNE field is not a pull input unless added there.
- `theme.js` has `heat()` (absolute values) and `deltaHeat()` (the DATA screen's fuel
  trim, hue 8 / 200). The design system's rule: the accent is never a status, and a
  status is never decoration (#78).
- 4b's `SelectModeBar` sits above each grid; `tune.rangeMode` is a shared,
  non-undoable `SET_TUNE_FIELD` flag.

## Decisions

### 1. Baseline: the last loaded calibration

`tune.baseline = { ve, timing, afr }` holds the tables as they were when the calibration
was loaded. Three writers, each in the same pass that writes the tables:

- **Initial state** — the same tables `tune` starts with.
- **`APPLY_PRESET`** — the preset's tables.
- **`RESET_TO_STOCK`** — the reset tables.

`SET_TABLE`, hardware edits and `SET_TUNE_FIELD` never write it. So RECALC VE, ACCEPT
RE-LOGGED VALUES, dock ops and key presses all read as changes, and a cam swap lights
up nothing until the player re-logs VE.

The tables are shared by reference, not cloned: every table write replaces a table and
none mutates one.

`baseline` joins `TUNE_KEYS`. Undoing a preset load restores the baseline that went with
the tables it restores; undoing a table edit puts back the baseline it already has, a
no-op. It is not added to `MEASURED_TUNE_KEYS`: a pull's inputs, and the fingerprint,
are unchanged.

Rejected: recomputing stock from the current build (the baseline moves under a hardware
edit, so cells the player never touched light up), and comparing only while `presetId`
is set (the first hand edit clears it, so the overlay vanishes when it becomes useful).

### 2. The maths lives in `src/sim/tables.js`

Beside 4b's ops, pure, never mutating their inputs:

```js
diffTable(table, baseline)          // signed per-cell delta, rounded to 2 dp
revertRect(table, rect, baseline)   // new table; cells in rect copied from baseline
changedIn(table, baseline, rect)    // how many cells in rect differ
```

A cell "differs" when its delta, rounded to 2 dp (the storage precision), is not 0.
`revertRect` does not clamp: a baseline value is by construction one the table held.

### 3. Grid: VALUES / CHANGES

- **One flag.** `tune.diffView` (`false` at start), set with `SET_TUNE_FIELD`, shared by
  AIR, SPARK and FUEL, not undoable — the same treatment as `rangeMode`.
- **Toggle.** A `Seg` labelled "Table view" with VALUES / CHANGES, in `SelectModeBar`'s
  row. The row wraps, so at phone width the toggle drops to its own line rather than
  overflowing.
- **Legend.** In CHANGES, one line under the bar: *Change since this calibration was
  loaded · violet up · cyan down*.
- **Cells in CHANGES.** Text is the signed delta at the grid's display precision
  (`+2`, `-1`, `+0.3`). An unchanged cell reads `·` on `T.panel2`. A change too small to
  show at display precision (a VE cell off by 0.3 at 0 dp) reads `~0` and is still
  tinted.
- **Tint.** `diffTint(delta, fullScale)` in `theme.js`, beside `heat()`: violet hue for
  an increase, cyan hue for a decrease, lightness rising with magnitude up to
  `fullScale`, with a floor so the smallest change is visibly distinct from an unchanged
  cell. It never resolves to `ok`, `warn`, `danger` or the accent. `deltaHeat` is left
  as it is.
- **Full scale per table,** passed by each screen as `diffScale`: VE 10 points, spark 6°,
  AFR 1.0.
- **Nothing else changes.** Selection, highlight, the anchor mark, `+`/`-`, the dock and
  every op work on the real values in both views. The sign is printed in every cell, so
  colour is never the only carrier of meaning.

### 4. Dock: REVERT and the changed count

- **REVERT** sits with INTERPOLATE and SMOOTH, and shows whenever at least one selected
  cell differs from the baseline — a single cell included. One `SET_TABLE`, labelled
  `revert · N cell(s)` where N is the number of cells that differed, so the undo button
  reads *Undo Spark edit · revert · 3 cells*.
- **Title.** A changed single cell adds `· was 24` (the baseline value, at display
  precision); a multi-cell selection with changes adds `· 3 changed`. Nothing is added
  when nothing differs.
- The dock takes a `baseline` prop (the matching table from `tune.baseline`). Its
  draft/commit logic is not touched.

## Tests

- **`tables.js`:** `diffTable` signs and 2 dp rounding, unchanged cells are 0;
  `revertRect` writes only inside the rectangle, leaves the input unmutated, handles
  unordered corners; `changedIn` counts correctly for cell, range and whole table.
- **Reducer:** baseline set by initial state, `APPLY_PRESET` and `RESET_TO_STOCK`;
  `SET_TABLE` leaves it alone; undoing a preset load restores the previous baseline;
  `diffView` is shared and not undoable; the `snapshot.tune` key test gains `baseline`.
- **UI:** CHANGES renders signed deltas and `·`; `~0` for a sub-precision change;
  `+`/`-` and a dock op in CHANGES edit the real values; REVERT is one undo step with
  the expected label, and is hidden when nothing differs; the title's `was`/`changed`
  text; the view carries from SPARK to FUEL.
- **Theme:** `diffTint` differs by sign, deepens with magnitude, saturates at
  `fullScale`, and is never a status token or the accent.
- **Fingerprint unchanged.**

## Risks

| Risk | Mitigation |
|---|---|
| Undo of a preset load leaves the new baseline behind | `baseline` is in `TUNE_KEYS`; tested |
| Baseline becomes a pull input and moves the fingerprint | Not in `MEASURED_TUNE_KEYS`; `pullSignature` test pins the projection |
| The toggle overflows `SelectModeBar` at 375px | Row wraps; checked in the browser at phone width |
| Tint reads as a warning | Violet/cyan hues only; theme test asserts it is no status token |
