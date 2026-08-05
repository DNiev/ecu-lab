# Contributing to ECU Lab

Thanks for being here. This project is a teaching tool, so contributions that make the
physics more honest or the explanations clearer are worth as much as new features.

**ECU Lab was created by CaribouTuning** — the engine model and everything it teaches
are his work. Turtle.GTI maintains the repository, tests and tooling. When a change
touches the physics or the teaching material, CaribouTuning's read on it is the one
that settles it; he is the domain authority here.

## The one rule that matters

**Nothing adds horsepower.**

Every part must change airflow, pressure, temperature or fuel delivery, and let power
fall out of the physics. A pull request that adds `power *= 1.05` for a part will be
sent back, however well it plays. If you cannot express your feature as a physical
mechanism, open an issue and let's work out together what the mechanism actually is.

Corollaries:

- Physics lives in `src/sim/`. If you are doing engineering maths in `src/ui/`, it is
  in the wrong place.
- Empirical numbers live in `src/sim/coefficients.js`, with a comment explaining what
  they represent. No bare magic numbers anywhere else in `src/sim/`.
- The app never silently rewrites the player's spark or fuel tables. Hardware changes
  invalidate a calibration but do not fix it — that is the central lesson, and the
  advisors exist to report the gap, not close it.
- Every pull-log event needs all three of `msg`, `cause` and `fix`. An event that only
  says something is wrong teaches nothing.

## Getting set up

```bash
git clone <your-fork>
cd ecu-lab
npm install
npm run dev
npm test
```

Node 20+.

## Before you open a pull request

```bash
npm test          # physics intent tests + behavioural fingerprint
npm run lint
npm run typecheck # JSDoc types are checked with tsc --checkJs
npm run build     # make sure it still builds
```

CI runs all four on every PR.

## The fingerprint test

`tests/fingerprint.test.js` hashes the whole simulation across a large matrix of
configurations. It exists because the physics is a web of coupled formulas: a change to
the knock envelope moves torque, which moves the event log, which moves the score.

**If it fails, stop and think.** Two possibilities:

1. **You did not mean to change the physics.** You have a bug. Find it.
2. **You did mean to change the physics.** Then:
   ```bash
   node scripts/update-fingerprint.js --report   # on main, save the report
   # apply your change
   node scripts/update-fingerprint.js --report   # diff the two reports
   npm run test:fingerprint:update
   ```
   Explain in your PR *what moved and why*. A reviewer should be able to understand the
   change without re-deriving it.

Never update the fixture just to make CI green. That defeats the entire point.

## Writing tests

- **Intent tests** (`tests/physics.test.js`) assert on **direction and relationship** —
  "more compression makes more torque", "float collapses VE above the float speed". Not
  on exact magnitudes.
- **Magnitudes** belong to the fingerprint. Do not hard-code `expect(hp).toBe(235)` in
  an intent test; it will break on every legitimate tuning change and tell you nothing.

## Style

- Match the surrounding code. It is deliberately plain — no clever abstractions.
- Comments explain **why**, not what. The existing comments are unusually thorough
  because this is a teaching codebase; please keep that up.
- JSDoc on anything exported from `src/sim/`.
- British or American spelling both fine; do not reformat existing text either way.

## Good places to start

Roughly in order of value to the project:

**Improvements**

- Decompose `src/ui/EcuLab.jsx` into `ui/primitives/` and `ui/screens/`. It is still
  the original single component.
- The live engine re-renders the whole tree at 20 Hz, charts included. Isolate it.
- Accessibility: the tuning grid needs `role="grid"` and arrow-key navigation, icon
  buttons need `aria-label`, and status is currently encoded by colour alone.
- `resetToStock` resets about a third of what its label claims.
- Bolt-ons can be installed but never uninstalled, which blocks the app's own
  "change one thing, measure, revert" method.
- No undo/redo on table edits.

**Features**

- Scenario/challenge mode — "here is a broken tune, diagnose it in three pulls".
- Save/load/share a calibration as JSON.
- Drivetrain and vehicle simulation (gearing, mass, 0–60) so powerband *shape* matters,
  not just peak horsepower.
- Knock audio. The Web Audio engine is already there; detonation ping is the most
  recognisable sound in tuning and it is missing.
- CSV datalog export.

## Physics corrections

If a model here is wrong, please say so — ideally with a source (a textbook, an SAE
paper, a compressor map, or "I have tuned forty of these and it does X"). Real-world
experience counts as evidence. Open an issue before a large rewrite so we can agree on
the approach.

## Reporting bugs

Include the build version from the header, what you built, what you changed, and what
you expected versus what happened. If the app crashed, the error boundary shows a stack
trace — paste it.

## Code of conduct

Be decent to each other. Assume good faith, critique the code and not the person, and
remember that a lot of people here are learning. Behaviour that makes this a worse
place to learn is not welcome, and maintainers will act on it.
