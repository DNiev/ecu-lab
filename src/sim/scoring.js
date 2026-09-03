/**
 * Scoring — graded once per pull.
 *
 * Three separate numbers, deliberately measuring different things:
 *   - Tuning Score    how clean the calibration is (fewer/less severe events = higher)
 *   - Engineer Score  how coherent the BUILD hardware choices are with each other
 *   - Pull Score      the uncapped competitive number, which rewards actual output
 *
 * Tuning and Engineer are 0–100 cleanliness grades, easy to read at a glance. Pull
 * Score turns those grades into a points total that rewards making real power, not
 * just staying clean at idle. A big, dirty pull can still out-score a small, spotless
 * one — the same tension a real tuner balances between safety margin and output.
 */

import { COEFF } from './coefficients.js';
import { OCTANE_OPTS } from './hardware.js';
import { clamp } from './math.js';

/**
 * The largest octane bonus any fuel on the shelf carries.
 *
 * Read off `OCTANE_OPTS` rather than written down, because its only use is deciding
 * whether a build has any octane LEFT to buy — and a hard-coded 14 would quietly start
 * lying the day a fuel above E85 is added.
 */
const MAX_OCTANE_BONUS = Math.max(...OCTANE_OPTS.map((f) => f.bonus));

/**
 * The known hardware-consequence types (`cam`, `float`, `bearing`, `pressure`) — the
 * only event types that do NOT move the Tuning Score. The cam event's own advice text
 * reads "This is a hardware trade-off, not a tuning fault — you cannot calibrate it
 * away", and deducting for it made a perfectly calibrated engine unable to score 100
 * for reasons no table edit could address. Hardware coherence is what the Engineer
 * Score is for.
 *
 * `pressure` belongs here for the same reason, and the reason is worth stating because
 * it is the one entry that looks arguable: spark timing does move peak cylinder
 * pressure, so part of it IS tunable. But a build stacking high static compression on
 * high boost is over the mechanical limit at MBT and cannot table-edit its way back
 * under — only compression, boost or stronger parts get it there, all three of which
 * are BUILD decisions. Charging the Tuning Score for it would deduct from a flawless
 * calibration for a choice the calibration did not make. The cost that rule does carry
 * is real and lands elsewhere: piston and bearing life, in `simulateSweep`'s wear.
 *
 * Kept as an explicit list (rather than a CALIBRATION_EVENT_TYPES allowlist inverted
 * at read time) so a brand-new event type that nobody has classified yet defaults to
 * deducting from the Tuning Score, not to a free pass.
 */
const HARDWARE_EVENT_TYPES = new Set(['cam', 'float', 'bearing', 'pressure']);

/**
 * Grades how clean a calibration is, from the pull's event log.
 *
 * @param {{events: {type?: string, impact?: number, msg: string}[]}} result a completed sweep
 * @returns {{score: number, label: string, deductions: string[], advisories: string[]}}
 */
export function computeTuningScore(result) {
  let score = 100;
  const deductions = [];
  const advisories = [];
  result.events.forEach((e) => {
    if (HARDWARE_EVENT_TYPES.has(e.type)) {
      advisories.push(e.msg);
      return;
    }
    const d = e.impact ?? 5;
    score -= d;
    deductions.push(`-${d}  ${e.msg}`);
  });
  score = clamp(Math.round(score), 0, 100);
  const label = score >= 90 ? 'Dialed In'
    : score >= 75 ? 'Solid'
    : score >= 55 ? 'Rough Edges'
    : score >= 30 ? 'Risky' : 'Dangerous';
  return { score, label, deductions, advisories };
}

/**
 * Grades how coherent the hardware choices are with each other, independent of how
 * well the engine is tuned.
 *
 * `fuel` and `mods` are required rather than optional. Defaulting them would silently
 * assume 91 octane and no intercooler at any call site that forgot to pass them — the
 * harshest possible headroom, and a wrong answer that looks entirely plausible on
 * screen. `peakBoostPsi` is required for the same reason, but in the opposite
 * direction: defaulting it to 0 would silently skip the static-compression-under-boost
 * rule at any call site that forgot to pass it, rather than over-penalise.
 *
 * The JSDoc below is what makes `tsc --checkJs` catch an omission — but only for the
 * typechecked callers, i.e. the test suite. `src/ui` is excluded from `tsconfig.json`
 * (see its `include`), so the two UI call sites — the ones where an omission would
 * actually reach a player — are invisible to the typechecker. There, the failure mode
 * is a runtime `TypeError` inside a render-path memo instead.
 *
 * @param {object} input
 * @param {import('./engine.js').EngineConfig} input.engineConfig
 * @param {boolean} input.turboOn
 * @param {number} input.peakBoostPsi peak boost across the curve, psi. Gates the
 *   static-compression-under-boost rule so it never fires on a boosted build making no
 *   boost — see COEFF.COMPRESSION_BOOST_BASE for why the headroom itself does not also
 *   scale with this value
 * @param {{size: string}} input.turbine
 * @param {{size: string, boostCeiling: number}} input.compressor
 * @param {number} input.exhaustDiaError inches the fitted pipe differs from ideal
 * @param {number} input.dutyPreview injector duty at current demand, percent
 * @param {number} input.displacementL
 * @param {{label: string, bonus: number}} input.fuel the octane option fitted
 * @param {{intercooler: boolean}} input.mods bolt-ons fitted
 * @returns {{score: number, label: string, deductions: string[]}}
 */
export function computeEngineerScore({
  engineConfig, turboOn, peakBoostPsi, turbine, compressor, exhaustDiaError, dutyPreview,
  displacementL, fuel, mods,
}) {
  let score = 100;
  const deductions = [];
  if (turboOn && peakBoostPsi > 0) {
    // Gated on actually making boost, not just having the hardware fitted: a turbo kit
    // with the boost curve zeroed out (reachable from the UI's "ZERO" button) has no
    // boosted cylinder pressure for static compression to fight, and `chargeTempK`
    // returns ambient unconditionally at `boostPsi <= 0` regardless of whether an
    // intercooler is fitted — so there is no charge cooling to credit either. This gate
    // only says this rule has nothing to judge at zero boost; it does not reclassify
    // the build as naturally aspirated, and the other turbo-specific rules below (the
    // heat-load rule's `compressor.boostCeiling > 20` half, and both turbo-sizing
    // rules) still fire on it.
    //
    // Static compression is not dangerous on its own. What decides whether it survives
    // boost is how much knock margin the rest of the build brings, and octane, charge
    // cooling and boost level are the levers the player actually has — so the ceiling
    // moves with them instead of sitting at one number for every build.
    //
    // The physics already charges for compression separately: it shortens the clearance
    // volume the cycle integrates over, which raises peak pressure and shortens the
    // ignition delay of the end gas, so the tune goes knock-limited and the Tuning Score
    // deducts for the events that follow. This rule is deliberately gentler than the
    // flat penalty it replaced so the same decision is not billed twice at full price.
    //
    // And it moves with HOW MUCH boost, not merely whether there is any. Boost level is
    // the largest single determinant of whether high compression survives, and this rule
    // used to ignore it: 5 psi and 25 psi were graded identically. The reference is a
    // swing about the boost the base was fitted at, so a factory-level build sits exactly
    // where it always did while a 25 psi build on the same short block is charged for it.
    const headroom = COEFF.COMPRESSION_BOOST_BASE
      + fuel.bonus * COEFF.COMPRESSION_PER_OCTANE_DEG
      + (mods.intercooler ? COEFF.COMPRESSION_INTERCOOLER_GAIN : 0)
      - Math.max(0, peakBoostPsi - COEFF.COMPRESSION_BOOST_REF_PSI)
        * COEFF.COMPRESSION_PER_BOOST_PSI;
    const over = engineConfig.compression - headroom;
    if (over > 0) {
      const d = Math.round(Math.min(
        over * COEFF.COMPRESSION_PENALTY_PER_POINT, COEFF.COMPRESSION_PENALTY_CAP,
      ));
      // No input currently reachable from the UI drives `d` to zero here: across the
      // full reachable space (the 8.5-13.0 slider in its 0.1 steps, crossed with every
      // OCTANE_OPTS bonus and intercooler on/off, plus every preset compression) no
      // combination lands `over > 0` with `d <= 0`. That is not what this guard is for,
      // though — it is a backstop against a finer slider step or a new fuel option
      // someday producing a build that clears `over > 0` by a sliver too small to round
      // to a whole point, so this is what keeps a `-0 ...` entry from ever reaching the
      // deduction list. It is not what keeps the 11.5:1/93-octane/intercooler boundary
      // build clean — that build computes `over` as -1.776e-15 and is rejected by the
      // `over > 0` check above, never reaching this line.
      if (d > 0) {
        const cooling = mods.intercooler ? 'an intercooler' : 'no charge cooling';
        // Name the levers this build has NOT already pulled. Telling someone on E85 with
        // an intercooler that higher octane and charge cooling would buy it back is
        // advice they cannot act on — and now that the headroom moves with boost level,
        // backing the boost off is a real answer where before it did nothing.
        //
        // Boost is only offered ABOVE the reference, because that is the only place it
        // buys anything: the term is one-sided, so a build already at or under the
        // reference gets no headroom back for turning the boost down and would be
        // reading advice that does nothing.
        const levers = [
          fuel.bonus < MAX_OCTANE_BONUS ? 'higher octane' : null,
          mods.intercooler ? null : 'charge cooling',
          peakBoostPsi > COEFF.COMPRESSION_BOOST_REF_PSI
            ? `less boost than ${peakBoostPsi.toFixed(0)} psi` : null,
          'less static compression',
        ].filter(Boolean);
        score -= d;
        deductions.push(`-${d} ${engineConfig.compression.toFixed(1)}:1 static compression `
          + `outruns the knock margin this build supports at ${peakBoostPsi.toFixed(0)} psi `
          + `on ${fuel.label} with ${cooling} — ${levers.join(', ')} would buy it back`);
      }
    }
  }
  if (!turboOn && engineConfig.compression < 9.0) {
    score -= 10; deductions.push('-10 Low compression leaves naturally-aspirated efficiency on the table');
  }
  const highHeat = engineConfig.compression > 11.5 || (turboOn && compressor.boostCeiling > 20);
  if (highHeat && engineConfig.headMaterial === 'Cast Iron') {
    score -= 10; deductions.push('-10 High heat load without an aluminum head for cooling');
  }
  if (turboOn) {
    // Matched on `size`, never on `label`: labels are display copy, and rewording one
    // for the UI must not move the score. See TURBINE_OPTS in hardware.js.
    if (displacementL < 3.0 && (turbine.size === 'large' || compressor.size === 'large')) {
      score -= 8; deductions.push('-8 Turbo sized large for this displacement — expect heavy lag');
    }
    if (displacementL > 4.2 && (turbine.size === 'small' || compressor.size === 'small')) {
      score -= 8; deductions.push('-8 Turbo sized small for this displacement — will choke the top end');
    }
  }
  if (Math.abs(exhaustDiaError) > 0.3) {
    score -= 8; deductions.push('-8 Exhaust diameter poorly matched to displacement');
  }
  if (dutyPreview > 95) {
    score -= 12; deductions.push('-12 Injectors undersized for current demand');
  }
  score = clamp(Math.round(score), 0, 100);
  const label = score >= 90 ? 'Sound Engineering'
    : score >= 75 ? 'Reasonable'
    : score >= 55 ? 'Some Mismatches'
    : score >= 30 ? 'Poorly Matched' : 'Fighting Itself';
  return { score, label, deductions };
}

/**
 * The uncapped, competitive score for a pull.
 *
 * @param {{peakHp: number, peakTq: number, tuningScore: number, engineerScore: number}} input
 * @returns {number}
 */
export function computePullScore({ peakHp, peakTq, tuningScore, engineerScore }) {
  const cleanlinessMult = 0.35 + 0.65 * (tuningScore / 100);
  const engineeringMult = 0.7 + 0.3 * (engineerScore / 100);
  const raw = (peakHp + peakTq * 0.6) * cleanlinessMult * engineeringMult;
  return Math.round(raw);
}
