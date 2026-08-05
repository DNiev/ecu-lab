# ECU Lab

### An engine management and tuning simulator, created by **CaribouTuning**.

> **CaribouTuning** Designed it, and wrote the engine
> model — the physics, the calibration tables, the pull log, the teaching material,
> the whole thing. Every number this simulator produces comes from his work.
>
> **Turtle.GTI** is hosting the repository and handling the engineering, scaffolding,
> and scaling around it: packaging it as a project, adding the test suite, and setting up
> CI, so the app has somewhere to live and grow.

Design an engine, edit the same three calibration tables a real tuner edits, run a dyno
pull, and read a log that explains what went right or wrong.

It is a teaching tool, not a game with a horsepower slider.

## The design rule

**Nothing adds horsepower.** Every part changes airflow, pressure, temperature or fuel
delivery, and power is whatever falls out of the physics. If you contribute a feature,
add it as a physical mechanism — never as a bonus multiplier.

That rule is why the numbers mean something. A stock 3.5 L V6 on 91 octane makes about
237 whp here because the ideal gas law, the Otto cycle and the friction model say so,
not because someone typed 237.

## What it actually models

- **Air charge** from the ideal gas law — `ρ = MAP / (R·T)`, `airCharge = VE × V_cyl × ρ`
- **Fuel mass** from lambda and each fuel's real stoichiometric ratio, density and lower
  heating value — which is why E85 needs ~1.5× the injector volume for the same lambda
- **Injector pulse width** against the real time available per engine cycle, so duty
  cycle is a physical wall rather than a capacity index
- **Knock** driven by trapped charge mass, charge temperature, octane, compression and
  mixture — not by boost alone
- **Torque** as `IMEP − FMEP → BMEP → T = BMEP × Vd / 4π`, with rubbing friction, valve
  spring load and pumping losses all paid for separately
- **A live engine** integrating real crankshaft dynamics at 20 Hz: it idles, revs,
  stalls, hits a rev limiter with hysteresis, and cuts fuel on overrun
- **Cam and valvetrain** — duration shifts the VE peak, overlap costs idle vacuum, and
  springs set the speed at which the valves stop following the lobe

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

- **`tests/physics.test.js`** asserts on direction and relationship — "a longer cam
  gives away bottom end and gains top end", "lean under load costs knock margin but
  lean at cruise does not". Readable failures that say what broke.
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

**ECU Lab was created by [CaribouTuning](#credits).**

The simulator is his. The engine model, the calibration tables, the knock envelope, the
pull log, the scoring, the tutorial and the design — all of it originated with him, and
the domain knowledge behind it is his too. Anything this app teaches, it teaches because
he knew it first.

| | |
|---|---|
| **CaribouTuning** | Creator and author. Engine model, physics, calibration design, UI, teaching material. |
| **Turtle.GTI** | Repository, build tooling, test suite, CI, packaging. |

Contributions from anyone else are very welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE) — copyright Caribou Tuning.

## A note on real engines

This is a simulator. The physics is real enough to teach the shape of the problem and
the reasoning behind it, but it is not a substitute for a wideband, a knock ear, and
someone who has done it before. Do not take a calibration from here to a real car.
