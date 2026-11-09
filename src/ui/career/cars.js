/**
 * Customer cars: a real engine from the preset catalogue, on its factory calibration,
 * with whatever the customer has done to it since.
 *
 * Built through the store's own reducer (APPLY_PRESET), so a customer's car is exactly
 * the car SANDBOX would give you from the same preset. The customer's changes go on
 * top of the hardware only: the ECU still carries the factory tables for the factory
 * parts, which is precisely why a modified car arrives running wrong.
 */

import { EXHAUST_DIA_OPTS, applyPreset, idealExhaustDiameter, liveStep, makeEcuLiveState, makeLiveState, presetById } from '../../sim/index.js';
import { makeInitialState } from '../state/initialState.js';
import { pullInputs } from '../state/pullInputs.js';
import { ACTIONS, reducer } from '../state/reducer.js';

/** @typedef {import('../state/initialState.js').StoreState} StoreState */

/**
 * @typedef {object} CarSpec
 * @property {string|null} [preset] an ENGINE_PRESETS id; null is the game's own default V6
 * @property {(build: any) => object} [build] the customer's hardware changes, as a build patch
 * @property {(tune: any) => object} [tune] anything already done to the calibration
 * @property {{ambientC?: number, altitudeM?: number}} [env] where the customer drives
 */

/**
 * The store state with the customer's car on the lift.
 *
 * @param {CarSpec} spec
 * @returns {StoreState}
 */
export function customerCar(spec) {
  let s = makeInitialState();
  if (spec.preset) s = reducer(s, { type: ACTIONS.APPLY_PRESET, preset: applyPreset(presetById(spec.preset)) });
  const build = { ...s.build, ...(spec.build ? spec.build(s.build) : {}), presetId: null };
  const tune = { ...s.tune, ...(spec.tune ? spec.tune(s.tune) : {}), tablesDirty: false, selection: null };
  return {
    ...s,
    build,
    tune,
    session: { ...s.session, env: { ...s.session.env, ...(spec.env ?? {}) }, mode: 'career' },
  };
}

/**
 * Idles the car on the LIVE engine, warm, and reports how it held: the same `liveStep`
 * LIVE runs, with the configuration EcuLab.jsx hands it. With `acAt`, the A/C comes on
 * that many seconds in, the way a driver switches it on at a light, and the second half
 * is judged with it running.
 *
 * @param {StoreState} state
 * @param {{seconds?: number, acAt?: number}} [opts]
 * @returns {{running: boolean, meanRpm: number, swingRpm: number, targetRpm: number}}
 */
export function idleTest(state, { seconds = 16, acAt } = {}) {
  const { args, derived, mafErrorBase } = pullInputs(state);
  const b = state.build;
  const exhaustDiaError = EXHAUST_DIA_OPTS[b.exhaustDiaIdx].dia
    - idealExhaustDiameter(derived.displacementL, b.turboOn ? Math.max(...b.boostCurve) : 0);
  const aux = state.session.liveAux ?? {};
  const cfgWith = (ac) => ({ ...args, mafErrorBase, exhaustDiaError, ecu: { ...args.ecu, aux: { ...aux, ac } } });
  const off = cfgWith(false);
  const on = cfgWith(true);
  // Warm, and the ECU's own coolant reading warm with it: a key-on reads the sensor
  // straight away, where a fresh ECU state would start it at 20 °C and filter up.
  let s = { ...makeLiveState(), cranking: true, coolantC: 88, oilC: 88, ecu: { ...makeEcuLiveState(), sEct: 88 } };
  const rpms = [];
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i += 1) {
    s = liveStep(s, 0.05, { throttle: 0, load: 0 }, acAt != null && i * 0.05 >= acAt ? on : off);
    if (i > steps / 2) rpms.push(s.rpm);
  }
  const mean = rpms.reduce((a, r) => a + r, 0) / Math.max(1, rpms.length);
  return {
    running: !!s.running,
    meanRpm: mean,
    swingRpm: rpms.length ? Math.max(...rpms) - Math.min(...rpms) : 0,
    targetRpm: s.ecu?.idleTarget ?? state.tune.ecu?.idle?.targetRpm ?? 0,
  };
}
