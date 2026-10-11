# Screen-reader state for switchers, disclosures and the sound toggle (#81)

Part of the UI overhaul (#6). Issue #81 was filed before the shell rebuild (#59); since
then the section nav (sidebar and bottom bar) gained `aria-current="page"`, and
`AdvisorPanel` and `EcuSection` gained `aria-expanded`. This covers what is left.

## What changes

**TUNE and DYNO page switchers** (`src/ui/EcuLab.jsx`). Both now write the URL, so they
are navigation, not segmented controls. Each strip of buttons is wrapped in a
`<nav aria-label="TUNE pages">` / `<nav aria-label="DYNO pages">`, and the active button
carries `aria-current="true"` — absent, not `"false"`, on the others, the same rule
`SideNav` follows. `"true"`, not `"page"`: the side nav already marks TUNE or DYNO
`"page"`, and a second `"page"` reads as two current pages. `MapSlots` and the explanatory footer stay outside TUNE's `<nav>`.
The issue's "adopt `Seg`" proposal is dropped: `Seg` is `aria-pressed`, which says
"toggle", and these are links between pages.

**DYNO's unread dot.** The dot on PULL LOG becomes `aria-hidden`, and while it shows,
the button is named `PULL LOG, N entries` (`1 entry` singular) from
`result.events.length`. TUNE's count badges already follow this pattern.

**`BuildSection` and `ExpandableInfo`** (`src/ui/components/`). The header button gets
`aria-expanded` and `aria-controls` pointing at the body's `useId()` id. The collapsed
body stays mounted (both animate open) but gets `inert` while shut, so a screen reader
skips it and Tab cannot land on a control inside a section nobody can see. React 18
passes `inert` through only as a string, so it is `''`, set through
`src/ui/components/inert.js`'s `inertWhen`. A section that shuts with focus inside hands
focus to its header, and so does the command palette when the command it ran shut the
section its opener sits in. The
body stays the header button's next sibling — `tests/ui/routing-shell.test.jsx`'s
`sectionIsOpen` depends on that. Changed in place rather than through a new
`Disclosure` primitive: `claude/tutorial-learn` edits both files, and a primitive
extraction would conflict with it wholesale. The components README's note about #81 is
updated to say so.

**The LIVE sound toggle** (`src/ui/screens/dash/LiveScreen.jsx`). Gains
`aria-pressed={soundOn}` and `aria-label="Engine sound"`; the glyph becomes
`aria-hidden`. Its accessible name is currently the glyph itself.

## Testing

- TUNE and DYNO: exactly one button in each `<nav>` has `aria-current="true"`, it is the
  routed page, and navigating moves it (`tests/ui/routing-shell.test.jsx`).
- PULL LOG is named with its entry count after a pull with events, and the dot is
  `aria-hidden` (`tests/ui/dyno-screens.test.jsx`).
- A `BuildSection` and an `ExpandableInfo`: `aria-expanded` flips with the body,
  `aria-controls` names the body's id, and the body is `inert` only while shut.
- The sound toggle is named "Engine sound" and its `aria-pressed` follows `soundOn`
  (`tests/ui/session-store.test.jsx`, replacing the glyph-as-name comment there).

## Out of scope

`--ink3` contrast (#79) ships as its own PR.
