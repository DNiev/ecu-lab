# Contributing to ECU Lab

Thanks for being here. This project is a teaching tool, so contributions that make the
physics more honest or the explanations clearer are worth as much as new features.

**ECU Lab is built by CaribouTuning and Turtle.GTI, as partners.** CaribouTuning created
it — the engine model and everything it teaches started with him, the domain knowledge
behind them is his, and he still works on the physics. Turtle.GTI develops and maintains
it: the physics added since, the test suite and its fingerprint gate, the tooling, and
the current rework of the app.

A change that touches the physics or the teaching material is settled between them. If a
pull request raises a question neither the code nor the tests can answer on their own,
expect that conversation rather than a single verdict.

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

**Node 20 or 22 — not newer.** `.nvmrc` pins 22, so `nvm use` in this repo picks it up.

This is narrower than it looks and it is not fussiness. The behavioural fingerprint is a
float-sensitive hash, and V8's `Math.pow`/`Math.exp` results shift by an ULP or so
between major releases — enough to change it. One untouched commit passes on Node 20 and
22 and fails on 26, same machine. On a newer Node you will meet a failing fingerprint
that looks like you broke the physics, and the documented cure for that is to regenerate
the baseline, which would replace the project's regression gate with your toolchain's
answer. `scripts/update-fingerprint.js` refuses to run outside 20/22 for exactly that
reason.

## Before you open a pull request

```bash
npm test          # physics intent tests + behavioural fingerprint
npm run lint      # warnings fail too — see below
npm run typecheck # JSDoc types are checked with tsc --checkJs
npm run build     # make sure it still builds
```

CI runs all four on every PR.

`lint` runs with `--max-warnings 0`, so a warning fails the build exactly like an error
does. That is deliberate: `react-hooks/exhaustive-deps` is a warning by default, and a
missing dependency in this app does not throw — it shows the player a score computed from
hardware they have since changed, silently and with no visual cue. A rule that cannot fail
the build is a rule nobody fixes.

`main` is protected: every change lands through a pull request with CI green and the
branch up to date. That applies to maintainers too — nobody pushes to `main` directly.

## Releasing

**Merging to `main` means "this is good". Tagging means "this is live".**

`main` is always deployable but is not itself deployed, so finished work can sit there
unpublished until it is worth a release.

**The bump is normally prepared for you.** `.github/workflows/release.yml` runs every
Thursday at 02:00 UTC — 22:00 Thursday US Eastern in summer, 21:00 in winter, since
GitHub cron has no timezone. If anything is unreleased it bumps the version on a
`release/vX.Y.Z` branch, pushes it, and files an issue with the notes and a one-click
link to open the pull request. Quiet weeks are skipped rather than burning a version
number on an empty diff. Run it off-cadence, or with a `patch`/`major` bump, from the
Actions tab.

You open the PR, approve, merge and tag. That is three deliberate steps and they stay
manual: tagging is what publishes.

It stops short of opening the PR itself for a specific reason. `gh pr create` from a
workflow needs the repository setting *"Allow GitHub Actions to create and approve pull
requests"*, and that one toggle also grants every workflow here the right to **approve**
pull requests — which would quietly undercut the review requirement on `main`. Opening
it yourself costs a click and gains something too: a PR you open raises a normal
`pull_request` event, so CI attaches without any dispatch workaround.

The rest of this section is what that automation does, and the path to follow by hand
for a hotfix or if the workflow fails.

The version bump is an ordinary pull request — `main` takes no direct pushes, from
anyone. So do **not** use a bare `npm version`, which commits and tags straight onto
`main` and will simply be rejected on push. Bump on a branch instead:

```bash
git checkout main && git pull
git checkout -b release/v1.3.0
npm version minor --no-git-tag-version   # patch/major as appropriate; no commit, no tag
git commit -am "Release v1.3.0"
gh pr create --title "Release v1.3.0"
```

Once that PR is merged, tag the merge commit and push the tag. Tags are not governed by
the branch rules, so this push is the one that goes direct:

```bash
git checkout main && git pull
git tag v1.3.0
git push origin v1.3.0
```

The tag fires `.github/workflows/deploy.yml`, which reruns the tests, builds, and
publishes to GitHub Pages.

`--no-git-tag-version` suppresses the commit and tag but still runs npm's `version`
lifecycle hook, so `scripts/sync-version.js` regenerates `src/version.js` — the
`BUILD_VERSION` shown in the app header and quoted in bug reports — from
`package.json`. **Do not edit `src/version.js` by hand**; it is generated, and a build
that misreports its own version makes every bug report from it untrustworthy.

If a deploy fails for reasons that are not the code's fault, re-run the Deploy workflow
from the Actions tab rather than moving the tag. A tag should keep meaning the commit it
originally meant.

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
