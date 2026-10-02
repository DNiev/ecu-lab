/**
 * Seeded `Math.random` for the live-engine tests.
 */

import { afterEach, beforeEach } from 'vitest';

import { rng } from './randomBuilds.js';

/**
 * Makes `Math.random` a seeded generator for every test in the calling file.
 *
 * The live engine is not pure: sensor noise (`sensorRead`) and the knock sensor's false
 * triggers draw on `Math.random`, and with the ECU in the loop that noise feeds closed-loop
 * trims and knock control, so it reaches the engine itself, not just the gauges. Seeding it
 * keeps a live test reproducible — a failure is a real failure, never a bad draw — while
 * leaving the noise statistically the same. Call once at the top level of a test file.
 * @param {number} [seed]
 */
export function seedRandomPerTest(seed = 12345) {
  const real = Math.random;
  beforeEach(() => { Math.random = rng(seed); });
  afterEach(() => { Math.random = real; });
}
