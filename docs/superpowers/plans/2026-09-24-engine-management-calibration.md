# Engine management calibration (#112) — plan

1. **Audit** (no code): map what exists, what is partial, what is missing, and where each
   feature connects to the physics. Result: optional ECU context, legacy path untouched.
2. **Infrastructure**: `src/sim/ecu/*`; env and cam hooks in thermo/turbo/friction/cycle/
   airflow; ECU context in `evaluatePoint`; `ecuSteadyPoint` in the sweep; `liveStepEcu`;
   drag torque strategy. Gate: fingerprint unchanged; neutrality on default build and every
   preset.
3. **Editor**: `CalTable` and `tableOps`, `EcuSection` generated from `ECU_META`, SET_ECU
   (undoable), map slots (SWITCH/COPY/SWAP_MAP, undoable).
4. **Controls & corrections**: TUNE control views, BUILD hardware, correction stacks.
5. **Logging**: LIVE logger (channels, charts, CSV), dyno ECU readout.
6. **Tests & teaching**: `tests/ecu.test.js` (consequences, not assignments), Learn 31–37,
   tutorial steps, gates (`npm test`, lint, typecheck, build), screenshots at phone and
   desktop widths.
