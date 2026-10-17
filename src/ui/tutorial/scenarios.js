/**
 * The engines the tutorial's lessons are about. Each is the SANDBOX start with one
 * change a player can make themselves, so a lesson can say "do this and you will see
 * exactly this" and be right.
 */

import { LOAD, RPM, applyVeCorrections, veCorrections } from '../../sim/index.js';

import { runDemo } from './demoEngine.js';

const WOT = LOAD.indexOf(100);

/** @param {any} s */
const withIntake = (s) => ({ ...s, build: { ...s.build, mods: { ...s.build.mods, intake: true } } });

/** The engine a player gets on SANDBOX, untouched. */
export const stock = () => runDemo('stock');

/**
 * SPARK's rows at 70 kPa and up, 4° more advanced: past the knock limit on 91. At full
 * throttle this engine is knock-limited through the low and middle revs, as a real 10.3:1
 * engine on pump fuel is, and the stock table sits about 2° short of that limit.
 */
export const SPARK_ADDED_DEG = 4;
export const overAdvanced = () => runDemo('over-advanced', (s) => ({
  ...s,
  tune: { ...s.tune, timing: s.tune.timing.map((row, ri) => row.map((v) => (LOAD[ri] >= 70 ? v + SPARK_ADDED_DEG : v))) },
}));

/** A cold air intake fitted, and nothing retuned. */
export const intakeFitted = () => runDemo('intake', withIntake);

/** The scalar that cancels the bigger housing's MAF error (the MAF reads 10% low). */
export const INTAKE_MAF_SCALAR = 1.11;

/** The intake retuned: the MAF scalar set, and the pull's VE correction applied. */
export const intakeRetuned = () => runDemo('intake-retuned', (s) => {
  const fitted = intakeFitted();
  const { ratio } = veCorrections(fitted.veLog.pull);
  const t = withIntake(s);
  return {
    ...t,
    build: { ...t.build, mafScalar: INTAKE_MAF_SCALAR },
    tune: { ...t.tune, ve: applyVeCorrections(t.tune.ve, ratio, 1) },
  };
});

/** The first logged point at `rpm` or above. */
export const pointAt = (demo, rpm) => demo.result.points.find((p) => p.rpm >= rpm) ?? demo.result.points.at(-1);

/** The point where the pull made its most power, and its most torque. */
export const peaks = (demo) => {
  const pts = demo.result.points;
  return {
    hp: pts.reduce((a, b) => (b.hp > a.hp ? b : a)),
    tq: pts.reduce((a, b) => (b.torque > a.torque ? b : a)),
  };
};

export { LOAD, RPM, WOT };

/**
 * The apply-half loop, run for real: fit the intake, rescale the MAF, then pull,
 * correct half of what the log says, and pull again, `passes` times. Each row is what
 * the log said on that pull, before its correction was applied.
 *
 * @param {number} passes
 * @returns {{pass: number, worstPct: number, cells: number, peakHp: number}[]}
 */
export function veHalfPasses(passes) {
  const rows = [];
  let ve = null;
  for (let k = 0; k < passes; k += 1) {
    const d = runDemo(`ve-half-pass-${k}`, (s) => {
      const t = withIntake(s);
      return { ...t, build: { ...t.build, mafScalar: INTAKE_MAF_SCALAR }, tune: { ...t.tune, ve: ve ?? t.tune.ve } };
    });
    const { ratio, cells } = veCorrections(d.veLog.pull);
    const worst = ratio.flat().filter((r) => r != null).reduce((w, r) => (Math.abs(r - 1) > Math.abs(w) ? r - 1 : w), 0);
    rows.push({ pass: k + 1, worstPct: worst * 100, cells, peakHp: d.result.peakHp });
    ve = applyVeCorrections(d.state.tune.ve, ratio, 0.5);
  }
  return rows;
}

/** The intake with only its MAF rescaled: the VE table still stock. */
export const intakeMafOnly = () => runDemo('intake-maf-only', (s) => {
  const t = withIntake(s);
  return { ...t, build: { ...t.build, mafScalar: INTAKE_MAF_SCALAR } };
});
