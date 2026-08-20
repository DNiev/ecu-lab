# ECU Lab

### An engine management and tuning simulator.

> **CaribouTuning** and **Turtle.GTI** build ECU Lab together.
>
> CaribouTuning created it. The concept, the engine model, the calibration tables, the
> pull log and the teaching material started with him, the domain knowledge behind them
> is his, and he still works on the physics.
>
> Turtle.GTI develops and maintains it: the physics added since, the test suite and its
> behavioural fingerprint gate, the tooling and CI, and the current rework of the app.

Design an engine, edit the same three calibration tables a real tuner edits, run a dyno
pull, and read a log that explains what went right or wrong.

It is a teaching tool, not a game with a horsepower slider.

## The design rule

**Nothing adds horsepower.** Every part changes airflow, pressure, temperature or fuel
delivery, and power is whatever falls out of the physics. If you contribute a feature,
add it as a physical mechanism — never as a bonus multiplier.

That rule is why the numbers mean something. A stock 3.5 L V6 on 91 octane makes about
250 whp here because the ideal gas law, an integrated pressure trace and the friction
model say so, not because someone typed 250.

## What it actually models

- **Air charge** from the ideal gas law — `ρ = MAP / (R·T)`, `airCharge = VE × V_cyl × ρ`
- **Fuel mass** from lambda and each fuel's real stoichiometric ratio, density and lower
  heating value — which is why E85 needs ~1.5× the injector volume for the same lambda
- **Injector pulse width** against the real time available per engine cycle, so duty
  cycle is a physical wall rather than a capacity index
- **The closed cycle**, integrated two crank degrees at a time from intake valve close
  to exhaust valve open — Wiebe heat release, slider-crank volume, and indicated work as
  `∮ p dV`. Peak cylinder pressure, the angle it occurs at, and MBT all come off that
  trace rather than from a correlation
- **Knock** as an autoignition integral over the unburned end gas, so octane,
  compression, charge temperature, residual dilution and mixture all reach it through
  the pressure history instead of through separate corrections
- **Torque** as `IMEP − friction − PMEP → BMEP → T = BMEP × Vd / 4π`. Pumping work is
  exhaust manifold pressure minus intake, with its real sign, so a turbine's
  backpressure is a cost and a well-matched one can hand work back
- **A live engine** integrating real crankshaft dynamics at 20 Hz: it idles, revs,
  stalls, hits a rev limiter with hysteresis, and cuts fuel on overrun
- **Cam and valvetrain** — duration shifts the VE peak, overlap costs idle vacuum, and
  springs set the speed at which the valves stop following the lobe
- **A quarter mile** — the measured torque curve goes into a car and runs the strip:
  `F = μN` grip, `ΔN = m·a·h/L` weight transfer, `F_aero = ½ρCdAv²` drag, gearing that
  multiplies torque and divides speed by the same factor, and rotating inertia that
  behaves as extra mass in proportion to the square of the ratio

Units are real throughout: kPa, K, grams, ms, J, Nm, Pa, g/s, W.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # physics test suite
npm run build    # production build into dist/
```

Requires Node 20 or newer.

## How the code is laid out

```
src/
  sim/           the physics — pure functions, zero React, fully testable in Node
    constants.js     real measured values (gas constant, LHV, ...)
    coefficients.js  every empirical/tuned number, in one place
    tables.js        the editable calibration data and its axes
    hardware.js      the parts catalogue
    math.js          clamp, interpolation, run grouping
    thermo.js        charge temperature
    friction.js      rubbing, pumping and total parasitic losses
    engine.js        short-block design -> derived properties
    manifold.js      manifold pressure, best-power mixture
    airflow.js       hardware -> VE table
    point.js         evaluatePoint — the heart of it
    sweep.js         a full dyno pull + the event log
    live.js          real-time crank dynamics + ECU control loop
    drivetrain.js    the car: gearing, grip, weight transfer, the quarter mile
    advisors.js      what the hardware wants vs. what your tables say
    scoring.js       tuning / engineer / pull scores
  ui/            presentation only — no physics below this line
  storage.js     persistence adapter (artifact host / localStorage / memory)
tests/           physics intent tests + the behavioural fingerprint
```

**Where to start reading:** `src/sim/point.js`. Everything else either feeds it or
displays its output, and it is commented step by step in the order an ECU works.

**To change how the engine behaves:** adjust `src/sim/coefficients.js`, not the
formulas. Every empirical number lives there with a note on why it has the value it
has.

## Testing

Two layers, doing different jobs:

- **`tests/physics.test.js`** and **`tests/drivetrain.test.js`** assert on direction and
  relationship — "a longer cam gives away bottom end and gains top end", "a
  traction-limited launch is independent of mass". Readable failures that say what
  broke.
- **`tests/fingerprint.test.js`** hashes the entire simulation across 6,480 operating
  points, 432 full sweeps and 144 VE tables. It catches the coupled changes you did not
  think to check.

If the fingerprint fails, that is not automatically a bug — it means the numbers moved.
Work out whether you meant it. If you did, review the diff and run
`npm run test:fingerprint:update`, then explain the change in your PR. Never update the
fixture just to make CI green.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Physics corrections from people who tune real
cars are especially welcome — if a model here is wrong, we want to know, ideally with a
source.

## Status

Working and playable. Known gaps and planned work are tracked in
[CONTRIBUTING.md](CONTRIBUTING.md#good-places-to-start); the short version is that the
UI is still one large component pending decomposition, and accessibility needs work.

## Credits

**ECU Lab is built by CaribouTuning and Turtle.GTI, as partners.**

It began as CaribouTuning's. The engine model, the calibration tables, the knock
envelope, the pull log, the scoring, the tutorial and the original design all originated
with him, and so did the domain knowledge behind them. Anything this app teaches at its
core, it teaches because he knew it first — and he is still working on the physics.

Turtle.GTI develops and maintains it: the physics added since, the behavioural
fingerprint that pins the model against drift, the intent test suite, CI, the release
pipeline, and the current rebuild of the interface.

Decisions that touch the physics or the teaching material are made between them.

| | |
|---|---|
| **CaribouTuning** | Created it. Engine model, calibration design, pull log, scoring, teaching material, ongoing physics. |
| **Turtle.GTI** | Develops and maintains it. Physics, test suite and fingerprint gate, tooling, CI, and the UI rework. |

Contributions from anyone else are very welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE) — copyright Caribou Tuning and Turtle.GTI.

## A note on real engines

This is a simulator. The physics is real enough to teach the shape of the problem and
the reasoning behind it, but it is not a substitute for a wideband, a knock ear, and
someone who has done it before. Do not take a calibration from here to a real car.
