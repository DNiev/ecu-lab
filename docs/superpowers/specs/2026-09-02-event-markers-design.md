# Events on the Dyno Curve — Design

**Issue:** #61 (UI overhaul PR 5), sub-issue of #6. This is **PR 5b** of three.

**Goal:** Draw each pull-log event across the RPM range it actually occupied, on both dyno
charts, and let the player click any of them through to the log entry that explains it.

## Scope

| PR | Contents | Status |
|---|---|---|
| 5a | Run-history timeline, ghost-curve fix, pinning | Merged (#95) |
| **5b** | Events plotted at their RPM, clickable through to the log. **This spec.** | This PR |
| 5c | Post-pull scrubber — drag the RPM axis, every gauge replays at that point | Later |

**Out of scope, deliberately:**

- **The scrubber.** It replays the current pull, which is already in memory at full
  fidelity, and needs nothing from this PR.
- **Changing what the sim detects.** This PR makes the existing twelve event types
  locatable. It adds no new event, changes no threshold, and moves no number.
- **A hover tooltip on the bands.** The log entry is the full-detail surface and already
  carries `msg`, `cause` and `fix`. A tooltip would be a second, thinner copy of it.

## The data, as it actually is

The issue asks for events "drawn at the RPM where they actually happened". That is not
quite what the sim produces, and the difference shapes the whole design. Verified against
`8f06f38`:

`src/sim/sweep.js` emits **twelve** event types, in three families:

| Family | Types | RPM information available |
|---|---|---|
| **Range** (8) | `knock`, `pressure`, `fuel`, `lean`, `valve`, `rich`, `maf`, `compressor` | Produced by `groupRuns(points, predicate)`, so each holds a contiguous array of sweep points. First and last point give the span exactly. |
| **Threshold** (1) | `float` | Spans `derived.floatRpm` to `endRpm`. |
| **Whole-pull** (3) | `injscale`, `cam`, `bearing` | None. These are true everywhere: the ECU is calibrated for the wrong injector; the cam trades low end for top end; average cylinder pressure stresses the bottom end. |

So nine of twelve are locatable, and eight of those nine are **ranges, not points**. Every
range event already writes its span into prose through `rangeLabel(run)`. This PR makes
machine-readable what the message already says.

## Decisions

Three of these went against the recommendation offered at the time. They are recorded with
the trade-off that was accepted, not as consensus.

**Plot the nine, and say so on the chart.** A chart that silently drops a quarter of the
event types claims to be the log and is not. The three whole-pull findings get a line
beneath the charts that clicks through to the log. `injscale` in particular — the ECU
calibrated for the wrong injector size — is one of the most consequential things the sim
can tell a player, and it has no RPM at all.

**Bands over the plot area, not a rail below it.** The tint sits over the curve it
explains, so a player sees power flatten exactly where the red begins. *Recommended
against at the time* on the grounds that a bad tune emits five or six events and bands
compete with the two traces for the same pixels. Accepted deliberately.

**Draw every band; let overlaps compound.** *Recommended against at the time*: where three
bands stack, the chart's darkest region is the one with the most co-occurring findings
rather than the most severe one, so density reads as severity when it does not mean that.
Accepted deliberately. The alternatives considered and rejected were: drawing only the top
three by impact (makes the chart a summary and asks the player to trust a cut-off), and
merging overlapping spans into one band per region at its worst severity (keeps colour
meaningful but breaks the one-band-to-one-entry click-through).

**Bands on both charts.** They share one RPM axis and are stacked precisely so the eye can
run vertically between them. A knock band lines up with the timing trace being pulled; a
lean band lines up with AFR climbing. That correspondence is where a diagnosis becomes
visible, and annotating only one chart throws it away.

**Click-through resolves by RPM, not by band.** See below — this is what makes the
overlap decision survivable.

## Architecture

### 1. The simulation change

This is the first PR in the #61 series permitted to touch `src/sim/`. Every range event
gains two fields, taken from the run it already holds:

```js
rpmStart: run[0].rpm,
rpmEnd: run[run.length - 1].rpm,
```

`float` gets `rpmStart: floatRpm, rpmEnd: endRpm`. `injscale`, `cam` and `bearing` get
**nothing**, and that absence is the contract:

```js
export function isLocatable(event) {
  return typeof event.rpmStart === 'number';
}
```

Derived, not enumerated. A hand-kept list of locatable type names is exactly the bug
`LogScreen`'s own comment records — a list there once named eleven of the twelve types,
and `bearing` fell through to a chart colour. A thirteenth event type added later is
handled correctly the day it appears.

**The fingerprint is the gate, not a reassurance.** `tests/fingerprint.js:247` projects
each event to `{type, severity, impact, msg}`, so added fields cannot reach the hash. This
was verified empirically before the design was accepted — a probe field added to the knock
event left `fingerprint.test.js` at 4 passed. The requirement stands regardless of that
evidence: **`tests/fixtures/fingerprint.sha256` must be byte-identical to `main` at
merge.** If it moves, the change altered physics and the fix is to the change. Never run
`npm run test:fingerprint:update`.

### 2. `src/ui/components/eventBands.js`

Pure, no DOM, unit-testable. Follows the existing `advisorReports.js` precedent for a pure
helper under `components/`.

```js
/** 'danger' | 'warn' | 'violet' — severity-derived, with maf as the one special case. */
export function eventTone(event);

/** Locatable events only, as {id, rpmStart, rpmEnd, tone}. */
export function eventBands(events);
```

`eventTone` **moves here from `LogScreen.jsx`, where it currently lives inline.** Copying
it for the chart would duplicate a rule whose own comment explains that deriving tone from
severity — instead of from a hand-kept list of type names — is what stopped `bearing`
rendering as decoration. Two copies of that rule is one copy too many. `LogScreen` imports
it after the move; its behaviour does not change.

### 3. Rendering

Bands render as recharts `<ReferenceArea>` on both charts in `ResultScreen.jsx`, placed
**before** the `<Line>` elements so the traces paint on top of the tint. Each band fills
with its severity token at low opacity and draws edge lines at both boundaries, so a band's
extent stays readable where another overlaps it.

### 4. Click-through — and why overlap stops mattering

Clicking a band sets `session.logFocusRpm` to the RPM under the pointer and navigates to
`#/dyno/log`. `LogScreen` highlights **every** event whose span covers that RPM and scrolls
the first into view.

Resolving by RPM rather than by band is what makes the "draw everything" decision hold:
where three bands overlap it does not matter which one captures the click, because the
band that won and the two beneath it all produce the same result. The overlap ambiguity is
answered by never asking the question.

`logFocusRpm` is plain session state written through the existing `SET_SESSION_FIELD`; no
new action is needed. **`BANK_PULL` must clear it.** A focus RPM belongs to the log of the
pull it was clicked on; carried into the next pull it would highlight whichever new events
happen to span that RPM — a wrong answer that looks like a right one.

### 5. Keyboard access

Each band renders through `ReferenceArea`'s `shape` prop as a focusable element:
`tabIndex={0}`, `role="button"`, and an `aria-label` naming the event and its range
("Knock, 4200 to 5100 RPM"). Enter and Space do what a click does.

This is a requirement, not a nicety. A chart-only affordance would put a whole feature
behind a mouse, and #81 already tracks this project's accessibility debt. It also comes out
*better* than the mouse path: overlapping bands are each separately focusable, so a keyboard
user can reach a buried event that a pointer cannot single out.

### 6. The whole-pull findings

Beneath the charts, rendered only when such events exist: a button reading "N findings
apply to the whole pull", navigating to the log with `logFocusRpm` set to `null` — no
highlight, the whole list.

## Verification

Full gate on every commit, on Node 22 (`v22.23.2`): `npm test`, `npm run lint`
(`--max-warnings 0`), `npm run typecheck`, `npm run build`. Tests run as
`./node_modules/.bin/vitest run --pool=forks --poolOptions.forks.singleFork`.

`tests/ui/characterisation.test.jsx` stays byte-identical to `main`.

### Tests, and the failure mode they are written against

PR 4a shipped seven task suites that each passed against a broken implementation, and PR 5a
shipped one vacuous assertion that survived a bundled mutation. The recurring shapes: pinning
one side of a pair; pinning each case but not the exclusivity between them; moving two
variables at once so neither is held; asserting a count or shape but not which end; and a
harness reading post-state for its "before".

**Every mutation proof changes exactly one thing**, and must fail the specific test it was
predicted to fail — not merely fail something.

Required:

- **Locatability, both halves.** A range event carries `rpmStart`/`rpmEnd` equal to its
  run's first and last point's RPM, *and* `injscale`/`cam`/`bearing` carry neither.
- **The fingerprint fixture is byte-identical.** The justification for touching `src/sim`
  at all.
- **`eventTone` holds all three tones and the precedence.** `maf` is violet despite being
  severity 1, so a severity-only implementation must fail.
- **`eventBands` filters, both directions.** A locatable event appears; a whole-pull event
  does not.
- **Highlighting pins both directions.** An event whose span covers the focus RPM is
  highlighted; one that does not is not. Returning "all" and returning "none" must each
  fail.
- **Keyboard and mouse are both asserted.** Not one tested and the other assumed — that is
  the "pins one side of a pair" shape verbatim.
- **`BANK_PULL` clears `logFocusRpm`.**
- **The whole-pull note appears only when such events exist**, both halves.

## Risks

| Risk | Mitigation |
|---|---|
| A `src/sim` edit moves the fingerprint | The fixture is checked on every commit; a move means the change altered physics, and the fix is to the change — never a rebaseline |
| Overlapping bands mislead by density | Accepted, deliberately, with the trade-off recorded above. Click-through resolves by RPM so the ambiguity never has to be answered |
| Tint fights the traces for contrast | Bands paint before the lines; low fill opacity with defined edges |
| `eventTone` diverges between chart and log | It is one function in one module, imported by both — the reason for the move |
| A stale `logFocusRpm` highlights the wrong pull's events | `BANK_PULL` clears it, with a test |
