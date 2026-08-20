/**
 * The behavioural regression gate.
 *
 * If this fails, the simulation now produces different numbers than the committed
 * baseline. See the header of `fingerprint.js` for what to do about it. The short
 * version: work out whether you meant to change the physics. If you did, review the
 * diff and run `npm run test:fingerprint:update`. If you did not, you have a bug.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { buildFingerprint, serialiseFingerprint } from './fingerprint.js';

const here = dirname(fileURLToPath(import.meta.url));
const expected = readFileSync(join(here, 'fixtures', 'fingerprint.sha256'), 'utf8').trim();

// Building the matrix costs about fifteen seconds, and four of the assertions below want
// the same clean copy of it. Build it once.
const CLEAN = serialiseFingerprint(buildFingerprint(S));

describe('simulation fingerprint', () => {
  it('matches the committed baseline', () => {
    const actual = createHash('sha256').update(CLEAN).digest('hex');

    expect(
      actual,
      'The simulation produced different numbers than the committed fingerprint.\n'
      + 'If this change was intentional, review it and run:\n'
      + '  npm run test:fingerprint:update\n'
      + 'To see exactly what moved, run it with --report on both revisions and diff\n'
      + 'the resulting fingerprint.report.json files.',
    ).toBe(expected);
  });

  it('is deterministic across runs', () => {
    // The sweep and point layers must contain no randomness — only the live engine's
    // simulated sensors are allowed to be noisy, and those are excluded above.
    expect(serialiseFingerprint(buildFingerprint(S))).toBe(CLEAN);
  });

  /**
   * THE GATE MUST FAIL ON PHYSICS, NOT ON ARITHMETIC.
   *
   * Issue #48: the hash did not reproduce across Node majors, because V8's transcendental
   * results move by an ULP or so between releases. That is worse than a flaky test — the
   * documented cure for a failing fingerprint is to REGENERATE it, so a contributor on a
   * newer Node meets what looks like "you broke the physics" and is walked into replacing
   * the project's regression gate with their own toolchain's answer.
   *
   * This models a new V8 directly: perturb every Math.pow, Math.exp and Math.log by a
   * whole number of ULPs and rebuild. The serialised fingerprint has to come out byte for
   * byte identical. Sixteen ULP is deliberately unfair — real releases differ by about one
   * — so passing at sixteen says the quantiser has real margin rather than just enough.
   *
   * If this ever fails, do NOT widen SIG_FIGS to make it pass without first finding out
   * what became unstable. A quantity whose relative precision has collapsed usually means
   * a division by something approaching zero, and the honest fix is upstream in the
   * physics, not here.
   */
  it('is immune to floating-point noise of the kind a new Node introduces', () => {
    const view = new DataView(new ArrayBuffer(8));
    /**
     * Moves a double by `ulps` units in the last place, away from zero.
     *
     * Done on the raw words rather than with BigInt: this runs inside a replacement for
     * Math.pow, so it is called several million times per rebuild and BigInt arithmetic
     * made the test three times slower on its own. DataView is big-endian by definition,
     * so word 0 is the high word on every platform.
     */
    const nudge = (x, ulps) => {
      if (!Number.isFinite(x) || x === 0) return x;
      view.setFloat64(0, x);
      const hi = view.getUint32(0);
      const lo = view.getUint32(4) + ulps;
      // Magnitude bits are contiguous across the two words, so a carry out of the low
      // word is just an increment of the high one.
      view.setUint32(0, lo > 0xffffffff ? hi + 1 : hi);
      view.setUint32(4, lo > 0xffffffff ? lo - 0x100000000 : lo);
      return view.getFloat64(0);
    };

    const { pow, exp, log } = Math;
    try {
      for (const ulps of [1, 16]) {
        Math.pow = (a, b) => nudge(pow(a, b), ulps);
        Math.exp = (a) => nudge(exp(a), ulps);
        Math.log = (a) => nudge(log(a), ulps);
        expect(
          serialiseFingerprint(buildFingerprint(S)),
          `The fingerprint changed when every transcendental moved by ${ulps} ULP.\n`
          + 'That is numerical noise, not physics, and it means the gate will rebaseline\n'
          + 'itself on a different Node version. See the SIG_FIGS note in fingerprint.js.',
        ).toBe(CLEAN);
      }
    } finally {
      Math.pow = pow; Math.exp = exp; Math.log = log;
    }
  });

  it('produces no NaN or Infinity anywhere in the matrix', () => {
    const serialised = CLEAN;
    // JSON.stringify turns NaN and Infinity into null, so a null in a numeric slot is
    // the signature of a physics blow-up. Legitimate absent readings (e.g. bsfc when
    // the engine makes no power) are remapped to the string "n/a" in roundAll, so a
    // bare `null` surviving to here still means only one thing: a blow-up.
    expect(serialised).not.toMatch(/NaN|Infinity/);
    expect(serialised.match(/: null/g) ?? []).toHaveLength(0);
  });
});
