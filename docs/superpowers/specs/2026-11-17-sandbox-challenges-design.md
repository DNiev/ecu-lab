# Sandbox challenges (the challenges half of #63)

Part of the UI overhaul (#6). #63 asked for "win conditions like 'make 400hp on 91
octane without exceeding 85% injector duty'", to give the sandbox a goal. The command
palette half shipped in #125. Career mode (#137) has since shipped a grader that does
exactly this for customer jobs, so challenges are a thin layer over it: no shop, no
money, no reputation.

## Decisions

- **A challenge brings its own car.** Each names a preset (with any hardware changes),
  and starting one loads that car onto the SANDBOX bench, the way taking a career job
  loads a customer's car. Targets can then be sized to the engine, and two players' results
  mean the same thing.
- **Pass or not, and a passed challenge stays ticked.** No tiers, no best score.
- **Grading is career's grading.** `evaluate.js` is split so challenges reuse the pull,
  the idle test and every check without touching pay or reputation.

## Grading

`src/ui/career/evaluate.js` gains an exported
`gradeChecks(checks, carSpec, handedBack)`. It holds what `evaluateJob` does today up to
the verdict:

- the full-throttle pull in the car's own conditions (load 100 kPa, the delivered
  car's env, faults and aux switches);
- the Tuning Score;
- the lazy idle test;
- every check, run through the existing `check()`;
- engine wear per pull, with `DAMAGING_WEAR`.

It returns `{verdict, results, peakHp, score, health, wearPerPull, damaged}`. `evaluateJob` calls it
and keeps everything career-only: pay, repair, reputation and the customer's line. Career
verdicts and payouts do not change, and `tests/career.test.js` passes untouched.

The verdict rules are career's. A failed safety check or damaging wear makes it
`unsafe`; a failed complaint, `fail`; a failed request, `partial`; otherwise `pass`. A
challenge counts as passed only on `pass`.

## Challenges

`src/ui/challenges/challenges.js` exports `CHALLENGES` and `challengeById`. A challenge
is:

```js
/**
 * @typedef {object} Challenge
 * @property {string} id
 * @property {string} title       short, e.g. "400 on pump gas"
 * @property {string} goal        one sentence, what to achieve
 * @property {string} carName     what the card calls the car, e.g. "Nissan VQ35HR"
 * @property {import('../career/cars.js').CarSpec} car
 * @property {import('../career/jobs.js').Criterion[]} checks
 * @property {string} teaches     shown once passed
 */
```

The checks use only the 11 criterion types career already has. The headline goal is
`kind: 'complaint'`, the rules are `kind: 'request'`, and every challenge includes
`SAFE` from `criteria.js`. No new criterion types.

**The starter set is five or six challenges**, each on a different preset, covering:

- a power target on pump gas with an injector-duty ceiling (#63's own example);
- naturally aspirated power with a rev-limit ceiling (`naOnly`, `maxRedline`);
- a Tuning Score target with no knock;
- a boosted car under an exhaust-temperature ceiling;
- one fuel challenge (`fuelIs`, e.g. power on E85 with duty headroom).

The target numbers come from worked solutions, not guesses. For each challenge, a
scripted solution in `tests/challengeSolutions.js` is run on the simulator. The
challenge's target is the solution's result rounded down to a round figure, so that a
reasonable tune passes without needing to reproduce the script exactly.

The car comes from `customerCar(spec)` (`career/cars.js`). That function sets
`session.mode: 'career'`, so it gains an optional `mode` argument and challenges pass
`'sandbox'`.

## Store

Two new pieces of state:

- **`session.challenge: string|null`**, the active challenge's id. It is not saved,
  because the bench it applies to is not saved either.
- **`challenges: {passed: string[]}`**, saved through `src/storage.js` under its own
  key with `loadChallenges` and `saveChallenges`. These follow `loadShop` and `saveShop`
  across the three backends (artifact, local and memory). A missing or malformed save
  reads as `{passed: []}`.

New actions:

- **`START_CHALLENGE {id, car}`** replaces `build`, `tune` and `session.env` with the
  challenge car's, and sets `session.challenge`. Like a career car on the bay
  (`onTheBay` in `reducer.js`), the car starts with full health, no pull and an empty undo
  history. It is not undoable: undoing it would leave the challenge running on a car that
  is not the challenge's.
- **`LEAVE_CHALLENGE`** sets `session.challenge` to null and leaves the car on the bench.
- **`CHALLENGE_GRADED {id, verdict, results}`** keeps the last grade for the HOME card,
  as `session.challengeGrade`, which is not saved. On `pass` it adds the id to
  `challenges.passed`.
- **`RESTORE_CHALLENGES {challenges}`** for the cold-start load, as `RESTORE_CAREER` does.

`APPLY_PRESET` (a factory engine or the player's own, which arrives through the same
action) also clears `session.challenge` and `session.challengeGrade`. Changing the engine
under a challenge ends it, rather than grading a car that is not the challenge's. RESET
ALL TO STOCK does not: it rewrites the calibration for the hardware on the bench, which is
a tuning move a challenge's solution may use.

Career mode does not see challenges. Entering career stashes the sandbox as it does
today, `session.challenge` included, and leaving restores it.

## What the player sees

**HOME › CHALLENGES** is a new accordion section, after LEARN. `ROUTES.dash` gains
`'challenges'`, so `#/dash/challenges` and the command palette's page list get it for
free. It is a list of cards. Each card shows:

- the title, the car and the goal;
- the rules, as the checks' labels;
- a tick and its `teaches` line once passed;
- **START**, or **ACTIVE** on the running challenge.

START asks first when the bench holds an engine: "This replaces the engine on your
bench." It has REPLACE MY ENGINE and CANCEL, inline in the card. On an empty bench it
starts straight away. START is disabled while a pull is running.

While a challenge is active, the card also shows the last grade, if there is one: each
check, pass or not, with its `measured` text and its `HOW_TO_SEE` line.

**The challenge bar.** While `session.challenge` is set in SANDBOX, AppShell's `banner`
slot (the one CareerBar uses) shows a thin bar with:

- the challenge's title;
- **GRADE**, which grades the bench and opens HOME › CHALLENGES on the result;
- **LEAVE**.

GRADE is disabled while a pull is running, as career's hand-back is. Grading runs on the
main thread, like hand-back. The bar is its own component, `ChallengeBar.jsx`, styled
from the same tokens as CareerBar, with no shared markup.

## Tests

- **`tests/challenges.test.js`**, a `describe.each` over `CHALLENGES`, as
  `career.test.js` does:
  - the car as delivered does not pass;
  - the scripted solution passes, with no failing checks.

  It also checks that every challenge includes `SAFE`, and that its preset exists.
- **`gradeChecks`**: on a career job, `evaluateJob` gives the same result it gives
  today. Use the `turbo-kit` unsafe case and the `intake-maf` pass from `career.test.js`.
- **Storage**: `loadChallenges` and `saveChallenges` round-trip on the memory backend, and
  a malformed save reads as empty.
- **Reducer**:
  - START_CHALLENGE loads the car and sets the id;
  - LEAVE_CHALLENGE keeps the car;
  - CHALLENGE_GRADED on `pass` adds the id once, and on `fail` adds nothing;
  - APPLY_PRESET clears the challenge, and RESET_TO_STOCK keeps it.
- **UI**, in `tests/ui/`:
  - the HOME section lists every challenge;
  - START on a loaded bench asks first, and CANCEL changes nothing;
  - the bar appears with the challenge's title, and LEAVE removes it;
  - GRADE shows each check's result on the card;
  - a passed challenge shows its tick.

No physics change and no fingerprint change.

## Out of scope

- Tiers, best scores and leaderboards.
- Challenges on the player's own engine.
- New criterion types, such as a "no hardware changes" rule.
- Challenges in career mode.
