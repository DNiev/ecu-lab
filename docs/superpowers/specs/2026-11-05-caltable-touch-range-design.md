# Touch range selection and scrolling for the ECU-page tables (#155)

Part of the UI overhaul (#6). `CalTable` (`src/ui/components/ecu/CalTable.jsx`) edits
every `kind: 'map' | 'curve'` field on the ECU page, about 28 of them. On a touchscreen
it cannot select a block of cells, and a swipe that starts on a cell probably does not
scroll the grid. TUNE's AIR, SPARK and FUEL grids (`TuningGrid.jsx`) already solve both;
this brings their approach to `CalTable`.

## What changes

**Pointer handling.** A mouse works as now: press anchors, drag extends, shift-click
extends. Two fixes come over from `TuningGrid`:

- A drag extends only while `e.buttons & 1`, and `pointercancel` ends a drag as well as
  `pointerup`. Without them, a button released outside the window leaves the table
  dragging on the next hover.
- Touch and pen do not select on `pointerdown`. They select on `click`. A `lastPointer`
  ref records the last press's `pointerType`; a click with `detail > 0` after a mouse
  press is ignored, because the press already selected and the click would collapse a
  drag to one cell. A keyboard click (`detail === 0`) always selects, so Enter or Space
  on a focused cell now selects it. Today it does nothing.

**A `Range` chip**, per table and in local state, not `tune.rangeMode`. It sits in the
bar after Compare and Axes, before All, styled as they are, with `aria-pressed`. While it
is on, the first tap anchors a one-cell range, the second completes the rectangle, and a
third starts a new one. Toggling it clears the selection, as `SelectModeBar` does: a
half-taken range means nothing in single-cell mode.

`CalTable`'s selection is a plain `{r1, c1, r2, c2}` with `(r1, c1)` as the anchor and no
`type`, so a waiting anchor cannot be told from a single cell by shape. A local `pending`
flag holds that: set by the first tap in range mode, cleared by the second tap, by a
mouse drag or shift-click that extends, and by every other way the selection is set (a
row or column header, All, clear, toggling Range).

While `pending`, the toolbar's info reads `1 cell · tap the opposite corner` in place of
the mean.

`spanSelection` from `src/ui/components/selection.js` is not reused. It builds
`TuningGrid`'s typed `Selection`, whose row and column types assume the fixed RPM × LOAD
shape; `CalTable`'s tables have their own axes.

**Scrolling.** `touch-action: none` comes off `.cell` in `CalTable.module.css`. Nothing
needs it once touch no longer drags to select, and without it a swipe on the cells pans
the `.scroll` wrapper.

The header comment of `CalTable.jsx` gains a sentence on how touch selects a range.

## Testing

In `tests/ui/cal-table.test.jsx`, with the `PointerEvent` stub from
`tests/ui/range-selection.test.jsx` (jsdom 25 has none):

- A mouse drag selects the rectangle it covers, and the click that follows does not
  collapse it.
- Moving with no button held after release does not extend the selection.
- Shift-click extends from the anchor.
- A touch `pointerdown` followed by `pointerenter` selects nothing.
- A keyboard click (`detail: 0`) selects the cell.
- With Range on, two taps select a rectangle, the toolbar edits exactly those cells, and
  a third tap starts over. The hint shows between the first and second tap.
- Toggling Range clears the selection.
- `.cell` in `CalTable.module.css` has no `touch-action: none`.

No physics or fingerprint change.

## Out of scope

Checking on a real phone that a swipe on the cells scrolls the table. The browser pane's
phone emulation sends mouse events, so the PR asks for a device check.
