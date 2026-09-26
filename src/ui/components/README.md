# Shared components

Components used by more than one screen that are **not** primitives.

`src/ui/primitives/` carries a guarantee: token-driven, styled in a co-located
`.module.css`, typed, and tested in isolation. Everything in there has been through
that. These have not — they are markup lifted out of `EcuLab.jsx` during the screen
split because several screens needed them, and they still carry inline styles.

Keeping them here rather than beside the primitives is the point. Three files in
`primitives/` with no stylesheet would quietly turn that folder from a promise into a
location, and the next person adding one would have no way to tell which kind they were
looking at.

`BuildSection` and `ExpandableInfo` are both hand-rolled disclosures, and neither carries
`aria-expanded` — issue #81 tracks replacing both with a real `Disclosure` primitive, at
which point they graduate out of this folder by being deleted.

`BuildSection` keeps its inline `maxHeight` deliberately: `tests/ui/routing-shell.test.jsx`
reads it to tell an open section from a collapsed one, which is how the fully-collapsed
route state is pinned.

`PickList` is here for the ordinary reason, not the disclosure one: BUILD's Forced
Induction screen and TUNE's Injectors screen both need a full-width descriptive row for a
choice with a subtitle (turbine housing, injector size), which is wider than `Seg`'s
chip layout can hold without wrapping. One screen owning it and the other importing
across tabs would be a cycle risk the moment either screen moves again.

`TuningGrid` and `SelectionDock` are the same ordinary reason as `PickList`: TUNE's
AIRFLOW, SPARK and FUEL screens each mount both, and TUNE's Injectors and Sensors
screens need neither
— so they belong to the tab as a whole rather than to any one screen inside it. Both
still carry the `data-testid`s (`tuning-grid`, `selection-dock`) that
`button-call-sites.test.jsx` and `characterisation.test.jsx` query, unchanged by the
move.

`SelectModeBar` sits above each of those grids for the same reason. `selection.js` is the
one place a selection — cell, row, column or range — becomes a rectangle, and where an
edit gets its undo label; the grid, the dock and `advisorReports.js` all read it. The
maths an edit applies to that rectangle stays in `src/sim/tables.js`, not here. Its VALUES
/ CHANGES toggle switches the grid to each cell's change since the calibration was loaded;
the baseline it compares against is `tune.baseline`, set by the store whenever a
calibration is loaded, and the diff maths is in `tables.js` too.

`TuneAdvisory` is the ordinary reason once more, one layer up: `AdvisorPanel` is chrome
only (see its own header comment) and `advisorReports.js` only classifies, so something
has to turn a report into prose, and SPARK, FUEL and AIRFLOW all need one. `kind` picks
the body; `report.state` (from `sparkReport`/`fuelReport`/`veReport` in
`advisorReports.js`) picks which of that body's cases renders, and `report.detail`
supplies the numbers. It is pure — no store access, no computation — so the screens stay
the only thing in TUNE that talks to the store, and `advisorReports.js` stays the only
thing that decides what a cell's category means.

`UndoControls` is the ordinary shared-component reason again: AIRFLOW, SPARK and FUEL
each mount one above their grid. It takes no props and reads `history` from the store
itself, because the stacks are global — undoing a spark edit from the FUEL screen is
correct behaviour, not a bug. What is undoable lives in `src/ui/state/reducer.js`
(`UNDOABLE`); what a snapshot carries lives in `src/ui/state/history.js`.
