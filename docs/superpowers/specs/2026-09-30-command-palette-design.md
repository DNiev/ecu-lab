# Command Palette — Design

**Issue:** #63 (UI overhaul PR 7), sub-issue of #6. This is the palette half; the
challenges half gets its own spec, as the issue suggests.

**Goal:** Reach any page, and the handful of things a player does most, by typing —
Cmd/Ctrl-K on a keyboard, a search button on a phone.

## Scope

| In | Out |
|---|---|
| Every tab and section, filtered to the ones that would render something | Challenges / scenarios (own spec) |
| Actions that can be taken back: engine start/stop, dyno pull, undo/redo, sound | Loading a preset, reset to stock (they overwrite the tables) |
| Cmd/Ctrl-K, and a search icon in the status strip | A search field in the side rail |

## What the code looks like today (verified against `02ffef3`)

- `ROUTES` in `src/ui/routing.js` is the one table of tabs and sections: 6 tabs, 23
  sections. It holds ids only; human labels live in each screen (`BuildSection`'s
  `label`, `TUNE_VIEWS`, DYNO's switcher list in `EcuLab.jsx`).
- `changeTab(t)` (EcuLab) is what a nav tap does: resumes audio, opens the tab's first
  section (HOME's is `jobs` or `stats`, from `homeFirstSectionRef`), clears the
  selection. `goSection(t, sec)` navigates to one section.
- DYNO's CURVES / PULL LOG / DATALOG / SCORE need a `result`; its switcher shows
  HISTORY alone when there is none, and nothing while a pull runs. HOME's Customer
  Cars renders only in career mode or with an active job.
- EcuLab owns one global `keydown` handler (undo/redo); AppShell is chrome only and
  receives what its buttons do as props (`onTutorial`, `onRepair`).
- `startEngine`, `stopEngine`, `doRun`, `toggleSound` are EcuLab closures; RUN is
  `disabled={running}`. Undo labels come from `history.past`/`future` (see
  `UndoControls`).
- No dialog exists in the app. jsdom 25 has `HTMLDialogElement` but no `showModal`.

## Decisions

### 1. Pages: `src/ui/commands.js` (pure)

A label table beside the routes, keyed `tab` and `tab/section`, each entry a label and
search keywords:

| Tab | Sections |
|---|---|
| HOME | Customer Cars, Career & Last Pull, Engine Health, Learn How It Works, Taking It To A Real Car |
| BUILD | Engine Architecture, Induction (`turbo`, `boost`), Fuel System (`octane`), Exhaust |
| TUNE | Airflow (`ve`, `volumetric`), Spark (`timing`, `ignition`, `knock`), Fuel (`afr`, `lambda`, `mixture`), Injectors, Sensors (`maf`); after #115: Boost Control, Variable Cam Timing, Idle Control, Engine Protection, Torque Management, Nitrous Control |
| LIVE | — (one section, so one command) |
| DYNO | Curves (`power`, `torque`), Pull Log, Datalog, Score, History |
| DRAG | Car Body, Gearbox, Tyres & Drive |

`pageCommands(flags, go)` returns one command per tab (`HOME`, …, named by
`routing.js`'s `TAB_NAMES`, which the nav reads too) and one per section
(`TUNE › Spark`), in nav order, dropping sections that would render nothing.
`sectionAvailable(key, flags)` decides that, and TUNE's and DYNO's switchers filter
their buttons through the same function: Customer Cars without `showJobs`; the four
result sections without `hasResult`; History without `hasHistory || hasResult`;
Nitrous Control without `hasNitrous`; and while a pull is `running`, every DYNO
section but Curves. A test fails if a route has no label or a label has no route.

A command is `{ id, label, kind: 'page'|'action', keywords, run }`; `commands.js`
leaves `run` to the caller, which passes a `go(tab, section|null)` callback.

### 2. Matching: `matchCommands(query, commands)` in the same file

Case-insensitive, whitespace-trimmed. Ranks, best first, stable within a rank:

1. the query starts the label (`sp` → Spark);
2. the query starts a word of the label (`log` → Pull Log);
3. the query is a substring of the label;
4. the query starts a keyword (`timing` → Spark);
5. every word of the query starts a word of the tab, the label or a keyword, so a
   page can be typed as it is printed (`tune spark`, `dyno hist`).

No match on any is dropped. An empty query returns actions, then pages, unfiltered.

### 3. Actions: built in `EcuLab`

| Command | Shown when | Does |
|---|---|---|
| Start engine / Stop engine | always (one or the other, by `live.running \|\| live.cranking`) | `changeTab('live')`, then `startEngine()` / `stopEngine()` |
| Run dyno pull | `!running` | `goSection('dyno', 'result')`, then `doRun()` |
| Undo *label* / Redo *label* | the stack is non-empty | dispatch `UNDO` / `REDO` |
| Sound on / Sound off | always | `toggleSound()` |

Labels read like the undo button's: *Undo Spark edit · +5 · 12 cells*.

### 4. The palette: `src/ui/components/CommandPalette.jsx` + `.module.css`

- A native `<dialog>`, opened with `showModal()`: the browser supplies Esc, the inert
  page behind it and focus return to the trigger. Clicking the backdrop closes it: a
  press and release both on the backdrop, so a drag out of the field does not.
- Combobox pattern: the input keeps focus, `role="combobox"`, `aria-expanded`,
  `aria-controls`, `aria-activedescendant`; results are `role="listbox"` with
  `role="option"` / `aria-selected`, each tagged *Page* or *Action*.
- ↑/↓ move (wrapping), Enter runs the active command and closes, "No matches" when
  the list is empty. The query resets and the first result is active on every open.
- Props: `open`, `onClose`, `commands`. It filters with `matchCommands`; it knows no
  store and no routes.
- Styled from tokens in its module; the folder README says why this shared component
  has a stylesheet when its neighbours do not (it is new, not lifted out of EcuLab).

### 5. Opening it

- **Cmd/Ctrl-K** in its own effect in EcuLab, not folded into the undo handler beside
  it: the undo handler deliberately skips text fields and Cmd-K must work from them,
  and Cmd-K is gated on the app view where undo is not. App view only (not start or
  tutorial), toggles, works from inside a field (Cmd-K means nothing to an input),
  `altKey` excluded like undo's. K is matched by `key` when that is a Latin letter
  (Dvorak's K is the K) and by `code === 'KeyK'` otherwise (Cyrillic, Greek).
- **Strip button:** a `Search` icon button first in StatusStrip's actions group,
  `aria-label="Search pages and actions"`, `title="Search (⌘K)"`, wired through a new
  `onSearch` prop on `AppShell`/`StatusStrip`.
- `paletteOpen` is `useState` in EcuLab: view state, not the store, not undoable.
- A separate session is fixing the strip's phone-width overflow (the earlier header
  chip). Whichever lands second rebases onto the other; this PR must not make the strip
  wider than it is at 375px.

## Tests

- **`commands.js`:** every route labelled and every label a route; availability
  filtering for jobs, result and history; each ranking rule and their order; keyword
  hits; empty query ordering.
- **`CommandPalette`:** roles and `aria-activedescendant`; arrows wrap; Enter runs and
  closes; "No matches"; query resets on reopen. `tests/setup.js` stubs `showModal` /
  `close` to toggle `open`.
- **Integration:** Cmd-K opens, "spark" + Enter lands on `#/tune/spark`; Cmd-K on the
  start screen does nothing; the strip button opens it; Undo is absent with an empty
  stack and runs with one; Run dyno pull lands on DYNO with a result; DYNO's result
  sections are absent before the first pull.
- **Browser:** the real dialog (Esc, backdrop, focus return) at desktop and 375px.
- **Fingerprint unchanged:** no physics moves.

## Risks

| Risk | Mitigation |
|---|---|
| The label table drifts from `ROUTES` | Two-way coverage test |
| The palette offers a page that renders nothing | Availability flags, tested per section |
| jsdom stub hides real dialog behaviour | Browser check of Esc, backdrop and focus return |
| Cmd-K steals a browser shortcut | Only in the app view, and only Cmd/Ctrl-K without Alt |
| Conflict with the strip-overflow fix | One button added to one group; rebase whichever lands second |
