# Oversized injectors cost something — design

Issue: DNiev/ecu-lab#39. Findings and the decisions behind this design are in the issue
thread; this file is the agreed shape.

## Problem

A larger injector is strictly better than a smaller one. Duty falls as flow rises and
nothing else moves. `main` now sells 1050 cc and 1300 cc (added in #138 for E85), and a
hot-idle probe on every shipped engine gives the same λ, 1.001–1.004, from 315 cc to
1300 cc, with zero trim.

The mechanism half exists. #112 added `ballisticOpenMs` (`src/sim/point.js`) and the ECU's
minimum effective pulse (`injector.minEffPwMs`). The ballistic region is a single 0.35 ms
for every injector, though, and 1300 cc at idle opens for 0.35–0.38 ms, so it never fires.

Real injectors with higher flow have a longer nonlinear low-pulse region. A tuner fitting
big injectors to an engine that idles on them pays for it at idle and light load. One
that stages a port set over the factory direct injectors does not: the owner's 2.0 GTI
runs 1400 cc port injectors over its OEM DI and idles fine, because the port set never
runs a short pulse.

## Scope

Two commits in one PR, so that each fingerprint move is attributable on its own.

1. **Size-scaled ballistic cost** and its event.
2. **Port injection kit for direct-injected engines**, with a staged split.

Out of scope: a short-pulse adder table, cycle-to-cycle fuel scatter, a high-pressure DI
pump model, port kits in career mode's shop, and turning any shipped preset dual.

## 1. Size-scaled ballistic region

**Mechanism.** The open time below which an injector is ballistic grows with its flow
rating, because a higher-flow injector has a larger seat and a heavier armature to lift:

```
ballisticFromMs(cc) = BALLISTIC_OPEN_MS × (cc / BALLISTIC_REF_CC) ^ BALLISTIC_FLOW_EXP
```

- `BALLISTIC_OPEN_MS` stays 0.35 ms, now anchored at `BALLISTIC_REF_CC` = 315 cc.
- `BALLISTIC_FLOW_EXP` is fitted to the targets below, not taken from a published curve,
  and its comment says so.
- All three live in `src/sim/ecu/ecuCoefficients.js`, beside the existing constant.

`ballisticOpenMs(openMs, cc)` takes the injector's rating. Below the threshold, flow stays
quadratic in time (the existing shape), so a 315 cc injector behaves exactly as today.

**Where it applies.** It applies to each bank's own open time, only with an ECU context, as
now. The path without an ECU (`E` absent) is unchanged.

**The remedy already exists.** TUNE → INJECTORS → Minimum effective pulse clamps the
commanded opening. The engine then runs slightly rich but repeatable, and closed-loop
trims pull it back. It applies to each bank.

**Event.** When a point runs a bank below its threshold, the ECU flags it, and
`ecuSweepEvents` reports the run with all of `msg`, `cause` and `fix`:

- **cause:** the injectors are too large for the fuel these cylinders need here, so they
  never fully open, and delivered fuel falls short of what the ECU computed.
- **fix:** set the minimum effective pulse on TUNE → INJECTORS, fit smaller injectors, or
  on a direct-injected engine stage a port kit rather than oversizing the injectors that
  carry idle.

It shows in light-load pulls (`simulateSweep` at low `loadKpa`) and in the live engine's
log. A wide-open-throttle pull never reaches idle.

**Targets** (each becomes a test):

| # | Case | Expected |
|---|---|---|
| T1 | 315–850 cc, gasoline, hot idle, every shipped engine | λ within 0.5% of today |
| T2 | 1300 cc carrying idle on a 3.0–3.5 L six, gasoline, minimum pulse 0 | delivered fuel at least 10% short of what the ECU computed (seen as trim in closed loop, and as lean λ with closed loop off); event fires |
| T3 | as T2, minimum pulse set to the injector's ballistic threshold | rich, but within the 25% trim limit |
| T4 | far oversized for the cylinder (1300 cc on the smallest shipped cylinder) | past the trim limit even with the minimum pulse set |
| T5 | the same injector on E85 against gasoline | smaller error on E85 (longer pulses) |

## 2. Port injection kit on direct-injected engines

**Factory base.** `engineConfig.injection` remains the engine's factory injection,
`'port'` or `'direct'`, as #138 set it per preset. `INJECTION_OPTS` is unchanged.

- **Port engine:** `injIdx` / `ecuInjectorCc` are the port injectors. The fuel-system
  picker upgrades them.
- **Direct engine:** `injIdx` / `ecuInjectorCc` are the direct injectors, still
  upgradeable. The engine can also take a **port injection kit**.

**Build state.** A new field `portKit: null | { injIdx, ecuInjectorCc }`.

- `null` everywhere by default. Old saves have no field and load as before.
- Honoured only when the engine is direct. The reducer clears it when the engine switches
  to port, and the sim ignores it on a port engine as a second guard.
- `history.js` and `pullSignature.js` learn it.

**Split.** A new ECU table, `injector.portShare`: RPM × MAP, the percentage of each
cycle's fuel through the port set.

- Used only when a kit is fitted.
- The factory default stages the kit: 0% at and below atmospheric MAP, rising linearly to
  50% at 200 kPa. The staging constants live in `ecuCoefficients.js`.
- A direct-injected engine without boost therefore gets nothing from the kit until the
  tuner edits the table. That is deliberate: staging is a tuning decision.

**Metering.** The ECU splits the fuel mass it computed. Each bank's share goes through that
bank's own ECU scaling (`ecuInjectorCc`, or `portKit.ecuInjectorCc`), the shared dead-time
table and the minimum pulse. Each bank's delivered fuel uses its real rating, its own
ballistic threshold from section 1, and the rail.

A scaling mismatch on either bank shows exactly as it does today. A port share set at
idle gives short port pulses and pays the ballistic cost.

**Physics blended by the point's port share `s`:**

- **In-cylinder evaporation:**
  `evapInCylinder = s × FUEL_EVAP_IN_CYLINDER_PORT + (1 − s) × FUEL_EVAP_IN_CYLINDER_DIRECT`,
  passed per point through the ECU context. This moves charge cooling and knock margin.
- **VE:** a direct engine's VE truth already carries `VE_DIRECT_INJECTION`. With a kit, the
  point scales that gain by `(1 − s)`, so port fuel does not earn direct injection's
  filling.
- **Wall film (live engine):** the film fraction blends from `FILM_DIRECT_SHARE` toward 1
  by `s`.

**Duty and protections.** Each bank has its own pulse width and duty.

- The live log gains `portPw` and `portDuty`; `pw` and `duty` stay the base bank.
- The duty protection, and the fuel-limited state, fire when either bank exceeds its limit.

**UI.**

- BUILD → Fuel system, on a direct engine: "Add port injection" with a size picker.
- TUNE → Injectors, when a kit is fitted: the kit's ECU scaling (with the same mismatch
  warning) and the port share table.

**Simplifications, stated in the code:**

- Both banks run off the existing low-pressure rail model, which is what a direct engine
  already does.
- The banks share one dead-time table.

**Targets:**

| # | Case | Expected |
|---|---|---|
| T6 | direct engine + 1300 cc kit, factory split, hot idle | identical to the same engine without a kit |
| T7 | as T6, port share raised at idle | short port pulses; the ballistic event fires |
| T8 | more port share at a boosted point | warmer charge, less knock margin |
| T9 | kit undersized for its share at high load | port duty saturates, and the duty protection fires |
| T10 | engine switched to port with a kit fitted | kit cleared, and the build evaluates as plain port |

## Fingerprint

Run the control first: `--report` on clean `origin/main` must leave
`tests/fixtures/fingerprint.sha256` unchanged.

- **Commit 1** moves ECU-context points where an injector above 315 cc runs below its new
  threshold: light-load ECU sweeps. `deriveEngine`, `computeHardwareVE`,
  `factoryCalibration` and the WOT sweeps stay byte-identical.
- **Commit 2** adds an option that defaults off. Every existing evaluated cell is
  unchanged (`moved: 0, removed: 0`), and cells are added for kit builds.
  `factoryCalibration` gains the new `injector.portShare` table, which is an addition to
  its output, not a change to any existing value.
