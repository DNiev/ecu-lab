/**
 * Live-engine tests.
 *
 * `liveStep` integrates crank dynamics in time rather than solving a steady-state
 * point, so it can fail in ways the dyno sweep never will — most obviously by stalling.
 * These tests exist because the light-load MBT model moved idle timing efficiency, and
 * the idle controller has to be able to catch that.
 *
 * `liveStep` calls `sensorRead`, which uses `Math.random()`. Everything asserted here is
 * about the mechanical state (rpm, running), not the sensed values, so the noise does
 * not need stubbing — but do not add assertions on `sensed*` fields without stubbing it.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

const STOCK = S.DEFAULT_ENGINE_CONFIG;

/** The rate the app drives the live loop at, and therefore the rate these tests use. */
const STEP_S = 0.05;

/**
 * The config the live loop is driven with, matching EcuLab's `liveCfgRef`.
 *
 * `redline` is a parameter because the limiter has to key off the ENGINE'S rev limit,
 * not off a constant — see the limiter tests below for why that distinction has already
 * cost this project a bug.
 */
function liveCfg(redline) {
  return {
    ve: S.DEFAULT_VE, veTruth: S.DEFAULT_VE, timing: S.DEFAULT_TIMING, afr: S.DEFAULT_AFR,
    derived: S.deriveEngine(redline ? { ...STOCK, redline } : STOCK), fuel: S.OCTANE_OPTS[0],
    injectorCc: 315, ecuInjectorCc: 315,
    mods: { ...S.DEFAULT_MODS, turboFitted: false },
    mafScalar: 1, mafErrorBase: 1, turboOn: false, boostCurve: S.DEFAULT_BOOST,
    octaneBonus: S.OCTANE_OPTS[0].bonus,
    turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
  };
}

/** Runs the engine forward. 20 Hz, as the app does. */
function run(state, seconds, throttle = 0, redline = undefined) {
  const cfg = liveCfg(redline);
  let s = state;
  for (let i = 0; i < Math.round(seconds / STEP_S); i++) {
    s = S.liveStep(s, STEP_S, { throttle, load: 0 }, cfg);
  }
  return s;
}

/** Same, but keeping every step so a test can assert on what happened in between. */
function trace(state, seconds, throttle = 0, redline = undefined) {
  const cfg = liveCfg(redline);
  const out = [];
  let s = state;
  for (let i = 0; i < Math.round(seconds / STEP_S); i++) {
    s = S.liveStep(s, STEP_S, { throttle, load: 0 }, cfg);
    out.push(s);
  }
  return out;
}

/** A warm, idling engine — the starting point for everything below. */
const idling = (redline) => run({ ...S.makeLiveState(), cranking: true }, 3, 0, redline);

/**
 * Peak crank torque this engine actually makes, Nm — measured, not asserted.
 *
 * `simulateSweep` reports torque at the wheels in lb-ft, so this undoes both
 * conversions. Used to size the limiter's overshoot bound from the physics rather than
 * from a number someone typed.
 */
function peakCrankTorqueNm() {
  const derived = S.deriveEngine(STOCK);
  const mods = { ...S.DEFAULT_MODS };
  const r = S.simulateSweep({
    loadKpa: S.BARO_KPA, ve: S.DEFAULT_VE, veTruth: S.DEFAULT_VE,
    timing: S.clone2D(S.DEFAULT_TIMING), afr: S.clone2D(S.DEFAULT_AFR),
    turboOn: false, boostCurve: S.DEFAULT_BOOST,
    octaneBonus: S.OCTANE_OPTS[0].bonus, octaneLabel: S.OCTANE_OPTS[0].label,
    fuel: S.OCTANE_OPTS[0], injectorCc: 315, ecuInjectorCc: 315, injectorLabel: '315cc',
    mods, mafScalar: 1, derived,
    turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
  });
  return r.peakTq / 0.7376 / S.DRIVETRAIN_EFF;
}

describe('the live engine', () => {
  it('starts from the starter and catches', () => {
    const started = run({ ...S.makeLiveState(), cranking: true }, 3);
    expect(started.running).toBe(true);
    expect(started.rpm).toBeGreaterThan(S.STALL_RPM);
  });

  // The point of this test: idle sits at light load, which is exactly where the burn
  // model changed MBT. If idle timing efficiency drops far enough, the engine cannot
  // hold itself against its own friction and dies.
  it('holds idle for a full minute without stalling', () => {
    let s = run({ ...S.makeLiveState(), cranking: true }, 3);
    expect(s.running).toBe(true);
    s = run(s, 60);
    expect(s.running).toBe(true);
    expect(s.rpm).toBeGreaterThan(S.STALL_RPM);
  });

  it('settles near the idle target rather than drifting away from it', () => {
    let s = run({ ...S.makeLiveState(), cranking: true }, 3);
    s = run(s, 30);
    // Wide band deliberately: this asserts the controller converges, not what it
    // converges to. The exact idle speed is a magnitude and belongs to the fingerprint.
    expect(s.rpm).toBeGreaterThan(S.IDLE_TARGET_RPM - 250);
    expect(s.rpm).toBeLessThan(S.IDLE_TARGET_RPM + 400);
  });

  it('returns to idle after the throttle is blipped and released', () => {
    let s = run({ ...S.makeLiveState(), cranking: true }, 3);
    s = run(s, 2, 60);
    expect(s.rpm).toBeGreaterThan(2000);
    s = run(s, 20, 0);
    expect(s.running).toBe(true);
    expect(s.rpm).toBeLessThan(2000);
  });
});

/**
 * THE REV LIMITER.
 *
 * A limiter is a hysteresis loop, not a ceiling: fuel is cut above the limit, revs fall,
 * fuel comes back a band lower, and that cut-restore cycle is the bounce you hear. All
 * three of those halves need holding down, because none of them is visible from the
 * outside until an engine either runs away or will not pull to its limit.
 */
describe('the rev limiter', () => {
  it('cuts fuel at the limit and holds the engine there', () => {
    const held = trace(idling(), 15, 100);
    expect(held.some((s) => s.limiterCut)).toBe(true);
    expect(held.some((s) => s.fuelCut)).toBe(true);
    // Held against the stop rather than merely touching it once.
    const atLimit = held.filter((s) => s.limiterCut).length;
    expect(atLimit).toBeGreaterThan(held.length / 2);
  });

  it('restores fuel below the limit, so it bounces instead of latching', () => {
    const held = trace(idling(), 15, 100);
    const tail = held.slice(Math.floor(held.length / 3));
    // Both states occur in the steady tail: it is cycling, not stuck on either one.
    expect(tail.some((s) => s.limiterCut)).toBe(true);
    expect(tail.some((s) => !s.limiterCut)).toBe(true);
  });

  it('clears the cut and returns to idle once the throttle is released', () => {
    const s = run(run(idling(), 15, 100), 12, 0);
    expect(s.limiterCut).toBe(false);
    expect(s.fuelCut).toBe(false);
    expect(s.running).toBe(true);
    expect(s.rpm).toBeLessThan(2000);
  });

  // THE REGRESSION THIS FILE EXISTS FOR. The limiter must key off the engine's OWN rev
  // limit. A hardcoded threshold looks correct on the stock V6 — whose redline happens
  // to equal the constant — and silently lets every shorter-revving engine run past its
  // limit. Two engines that differ ONLY in `redline` is the cheapest way to catch that.
  it('keys off the engine\'s own redline, not a fixed number', () => {
    const shortPeak = Math.max(...trace(idling(6000), 15, 100, 6000).map((s) => s.rpm));
    const longPeak = Math.max(...trace(idling(7500), 15, 100, 7500).map((s) => s.rpm));
    expect(shortPeak).toBeLessThan(longPeak - 1000);
    expect(shortPeak).toBeGreaterThan(6000);
  });

  it('never lets engine speed run away past the limit', () => {
    // The engine is ALLOWED to overshoot the cut point, and does. `liveStep` decides the
    // cut from the previous step's speed and then integrates, so up to two 50 ms steps of
    // combustion torque are already in flight when the limit is crossed. Rather than
    // asserting a round number, derive the ceiling the same way the physics does:
    //
    //     alpha = T_crank / ENGINE_INERTIA        rad/s^2
    //     overshoot = alpha * (60 / 2pi) * dt * 2 steps
    //
    // That is a loose bound on purpose. This test is not measuring the overshoot, it is
    // asserting the engine cannot RUN AWAY — the failure mode where the limiter misses
    // entirely and speed climbs without bound. If the integrator is ever sub-stepped the
    // bound tightens on its own, with no number here to update.
    const peakCrankNm = peakCrankTorqueNm();
    const overshootRpm = (peakCrankNm / S.ENGINE_INERTIA) * (60 / (2 * Math.PI)) * STEP_S * 2;
    for (const redline of [6000, 7500]) {
      const peak = Math.max(...trace(idling(redline), 15, 100, redline).map((s) => s.rpm));
      expect(peak).toBeLessThan(redline + S.LIMITER_OVERSHOOT_RPM + overshootRpm);
    }
  });

  it('still pulls all the way to its limit rather than cutting early', () => {
    for (const redline of [6000, 7500]) {
      const peak = Math.max(...trace(idling(redline), 15, 100, redline).map((s) => s.rpm));
      expect(peak).toBeGreaterThanOrEqual(redline);
    }
  });
});
