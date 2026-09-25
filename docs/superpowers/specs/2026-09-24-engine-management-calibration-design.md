# Engine management calibration (#112) — design

## Goal

Take ECU Lab's calibration from three base tables to the depth of professional ECU software —
HP Tuners, Haltech, Link, MoTeC, EcuTek, UpRev — without breaking the physics-first model.
Every new setting is something a real ECU reads, assumes or commands; none of them is a power
figure. What each one is worth comes out of the same air, fuel and cycle physics as the rest
of the app.

References used: UpRev's *Nissan Tuning Guide* (base fuel schedule, fuel compensation,
cranking enrichment, injector latency, lookup delay, knock thresholds and high-det maps, cam
phasing, throttle-cut limiters, launch control, flat-foot shifting, map switching) and HP
Tuners' *Switch on the Fly* guide (map slots).

## The contract

1. **No ECU context, no change.** `evaluatePoint`, `simulateSweep` and `liveStep` take an
   optional ECU context. Absent, they run the original code path; the behavioural
   fingerprint is byte-identical. ECU constants live in `src/sim/ecu/`, never in `COEFF`.
2. **The default calibration is the original model.** Every correction starts at zero,
   every strategy where the physics always implicitly had it, every sensor scaled to its
   part. The default build and every preset pull to the same peak power and torque and the
   same pull log with and without the ECU (`tests/ecu.test.js`, first block). The one
   residual difference is ±1 lb-ft at isolated turbo points, from the boost-by-throttle
   curve being a table read linearly where the original used the exact square.
3. **Protections genuinely trip.** A lean, hot or knocking engine now meets the protection a
   real ECU has. That changes results, and the pull log says why.

## Architecture

- `src/sim/ecu/calibration.js` — the calibration object, its factory defaults (knock
  threshold fitted to the engine's own valvetrain noise; base wastegate duty fitted to the
  actuator), and `ECU_META`, one entry per field: label, units, axes, range, help. The UI is
  generated from it.
- `ecuTables.js` — tables that own their axes (`{x, z}` curves, `{x, y, z}` maps).
- `ecuHardware.js` — pump and regulator (rail pressure, pump capacity), injector dead time
  vs voltage and pressure, orifice flow vs ΔP, coil energy vs dwell, oil pressure, barometer.
- `sensors.js` — part transfer → volts → ECU scaling; faults and plausibility.
- `knockSensor.js` — valvetrain noise vs RPM, knock signal vs pressure, threshold deadband
  and false-knock rate.
- `boost.js` — target stack, gate hold vs duty (electronic / pneumatic spring), steady gate.
- `vvt.js` — cam targets; VE solved at several intake phases and interpolated.
- `fuelBlend.js` — flex-fuel blends (stoich, LHV, latent heat by mass; density by volume;
  concave octane).
- `strategy.js` — `resolveEcuPoint` (sensors → tables at believed load → correction stack →
  evaluatePoint inputs + breakdown), `evaluateEcu` (optional per-cylinder solve),
  `ecuSteadyPoint` (boost control, cams, protections and torque limits iterated to a settled
  dyno point).
- `liveEcu.js` — the ECU in time: idle PID with feed-forward, boost PI with wind-up, knock
  retard/recovery, phaser dynamics, X-τ wall film with accel/decel enrichment, lookup delay,
  trims on the sensed wideband, cranking and after-start, battery/alternator, protections,
  limp mode, launch control, datalog.
- `ecuEvents.js` — pull-log events for everything the ECU did.

Physics added where the old model could not carry a feature: ambient temperature and
barometer (`env`); cam phase in IVC, overlap, EVO and the VE curve; ballistic injector flow;
spark breakdown voltage (Paschen) vs coil energy; flammability limits; spark-cut afterburn;
manifold filling lag in LIVE; turbine inlet temperature from the cycle in LIVE (anti-lag).

## UI

- TUNE gains a second row — BOOST, VVT, IDLE, PROTECT, TORQUE — and each base-table view
  gets its ECU section underneath. A map-slot bar sits above all of them.
- `CalTable`: rectangle selection, step, scale, set, interpolate, smooth, copy/paste
  (spreadsheet-compatible), axis editing, compare with factory, live operating-point marker.
- BUILD: cam phasers, coils, plug gap, MAP sensor, wastegate actuator, pump, regulator, rail
  pressure, wideband controller, flex tank and ethanol sensor.
- LIVE: ECU panel — status, map slots, A/C / lights / launch arm, 20 Hz logger with small-
  multiple charts and CSV export, correction stack, conditions and fault injection.
- DYNO datalog: engine management readout and correction stack per point.
- HOME › Learn articles 31–37; three tutorial steps.

## Limits, stated

- Per-cylinder modelling is opt-in (it multiplies solve time by the cylinder count).
- Axis editing is for tables that own their axes; the three base tables keep the app-wide
  RPM × MAP axes the whole model reads them on.
- The drag model's tyre is grip-or-slide, so traction control can react to slip but cannot
  beat the model's perfectly feathering driver.
- Map slots switch every table together (UpRev style), not per-table as HP Tuners allows.
