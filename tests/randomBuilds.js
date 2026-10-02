/**
 * Random builds for the property and consistency tests.
 *
 * Every build is one a player could make from the BUILD sliders and pickers — nothing
 * outside the ranges the UI allows — so a failure is always a real player's engine, not
 * an impossible one. The generator is SEEDED, so a failure names its seed and replays
 * exactly: `randomBuild(seed)` is the same engine on every machine and every run.
 */

import * as S from '../src/sim/index.js';

/**
 * Mulberry32: a tiny, fast, well-distributed 32-bit PRNG. Enough for test sampling and,
 * unlike Math.random, reproducible from a seed.
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONFIGS = /** @type {const} */ (['I4', 'I6', 'V6', 'V8']);
const MATERIALS = /** @type {const} */ (['Aluminum', 'Cast Iron']);

/**
 * A build a player could make: engine geometry on the BUILD slider ranges, bolt-ons,
 * fuel, injectors, and (half the time) a turbo with a boost curve the compressor can
 * plausibly reach.
 * @param {number} seed
 */
export function randomBuild(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const range = (lo, hi, step) => lo + Math.round((r() * (hi - lo)) / step) * step;
  const turboOn = r() < 0.5;
  const compressorIdx = Math.floor(r() * S.COMPRESSOR_OPTS.length);
  const peak = turboOn ? range(3, Math.min(22, S.COMPRESSOR_OPTS[compressorIdx].boostCeiling), 0.5) : 0;
  // A boost curve shaped the way players draw them: nothing at idle, rising to a plateau,
  // tapering a little at the top.
  const shape = [0, 0.35 + r() * 0.5, 0.8 + r() * 0.2, 1, 1, 1 - r() * 0.1, 1 - r() * 0.15, 1 - r() * 0.2];
  const engineConfig = {
    configuration: pick(CONFIGS),
    bore: range(75, 105, 0.5),
    stroke: range(65, 100, 0.5),
    compression: Number(range(8.5, turboOn ? 11.5 : 13, 0.1).toFixed(1)),
    blockMaterial: pick(MATERIALS),
    headMaterial: pick(MATERIALS),
    camDuration: range(190, 280, 2),
    springRate: range(40, 100, 1),
    redline: range(6000, 7500, 100),
  };
  return {
    seed,
    engineConfig,
    mods: {
      intake: r() < 0.5, exhaust: r() < 0.5, headers: r() < 0.5,
      intercooler: turboOn ? r() < 0.8 : false,
    },
    turboOn,
    boostCurve: shape.map((k) => Number((k * peak).toFixed(1))),
    // Pump fuels only: the flex tank is exercised by its own tests.
    octaneIdx: Math.floor(r() * S.OCTANE_OPTS.length),
    injIdx: Math.floor(r() * S.INJECTOR_OPTS.length),
    turbineIdx: Math.floor(r() * S.TURBINE_OPTS.length),
    turbineCount: 1,
    compressorIdx,
    exhaustDiaIdx: Math.floor(r() * S.EXHAUST_DIA_OPTS.length),
  };
}

/**
 * The same build with the ECU told the truth about its injectors — the setup a player
 * reaches by following the setup warnings. Consistency tests use this so that a
 * deliberate misconfiguration does not stand in for a bug.
 * @param {ReturnType<typeof randomBuild>} b
 */
export function honest(b) {
  return { ...b, ecuInjectorCc: S.INJECTOR_OPTS[b.injIdx].cc };
}
