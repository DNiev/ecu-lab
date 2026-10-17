/**
 * Learn, part 6: tuning in depth. The articles a player reaches for once the tutorial
 * is done: the VE-from-logs method in full, the MAF against speed-density, a
 * troubleshooting guide by symptom, a whole session worked through, and how the
 * simulator itself steps through time.
 *
 * Every figure is worked out from the simulator when the article opens (see
 * tutorial/scenarios.js), and the live game screens mount only then (`lazy`), so
 * HOME does not run a dyno pull for an article nobody opened.
 */

import React from 'react';

import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { RPM } from '../../../sim/index.js';
import { COEFF } from '../../../sim/coefficients.js';
import { AirflowScreen } from '../tune/AirflowScreen.jsx';
import { veCellMaths } from '../../tutorial/demoEngine.js';
import {
  INTAKE_MAF_SCALAR, WOT, intakeFitted, intakeMafOnly, intakeRetuned, pointAt, stock, veHalfPasses,
} from '../../tutorial/scenarios.js';
import { ScreenSnippet } from '../../tutorial/ScreenSnippet.jsx';

import styles from './LearnScreen.module.css';

/** A link into the game, for "try it" lines. @param {{href: string, children: React.ReactNode}} props */
export function TryIt({ href, children }) {
  return <a className={styles.tryIt} href={href}>Try it: {children} ›</a>;
}

/** @param {{rows: React.ReactNode[][], head: React.ReactNode[]}} props */
function Table({ head, rows }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function VeFromLogs() {
  const d = intakeFitted();
  const col = RPM.indexOf(5500);
  const m = veCellMaths(d, WOT, col);
  const table = d.state.tune.ve[WOT][col];
  const passes = veHalfPasses(4);
  return (
    <>
      Nobody can see an engine&apos;s true volumetric efficiency, on a real car or here. What a tuner can see is the wideband. Wherever the mixture the engine got differs from the one the table asked for, the ECU&apos;s air estimate was off by that ratio. HP Tuners&apos; VE histograms, Holley&apos;s learn and Haltech&apos;s quick-tune all run on the same line, and so does TUNE › AIRFLOW:
      <br /><br /><span className={styles.formula}>VE new = VE × (λ measured ÷ λ target) × (1 + fuel trims) × MAF factor</span>
      <br /><br /><b className={styles.em}>λ measured ÷ λ target.</b> Over 1 is leaner than asked: the engine had more air than the ECU calculated, so the cell goes up by that ratio.
      <br /><br /><b className={styles.em}>The fuel trims.</b> At part throttle the ECU runs closed loop and trims the fuel to hit λ 1.00. The trims are then covering the table&apos;s error, so they are folded back in: a +5% trim means the table was 5% short even though the wideband reads perfect.
      <br /><br /><b className={styles.em}>The MAF factor.</b> The game&apos;s default ECU blends a MAF reading into its fuel. A MAF that reads wrong moves the mixture too, and that part belongs to the MAF calibration (article 43). It is taken out, or correcting VE would build the MAF&apos;s error into the table.
      <br /><br /><b className={styles.em}>Which cells.</b> Each logged point sits between four cells, and is shared among them by how close it sat to each. A share under a fifth says too little about a cell to count, and a cell needs the weight of about two points right on it before it changes. Cells with no data keep what they had.
      <br /><br /><b className={styles.em}>What is not data.</b> Acceleration enrichment, warm-up fuel below {'75 °C'} coolant, fuel cut, nitrous, protection enrichment, misfires (unburnt oxygen reads lean), injectors at their limit, and transients (manifold pressure moving more than 3 kPa between log rows). In each, something other than the VE table set the mixture.
      <ScreenSnippet
        where="TUNE › AIRFLOW"
        demo={d}
        focus='section[aria-label="Correct VE from logs"]'
        height={330}
        callouts={[
          { at: '[data-tour="velog-maf"]', text: 'The MAF error, reported and taken out.' },
          { at: 'table[aria-label="Logged VE error by cell, percent"]', text: 'Each logged cell’s correction, in percent.' },
        ]}
        caption="The real correction panel after one pull with a cold air intake on the stock tune."
      >
        <AirflowScreen veLog={d.veLog} />
      </ScreenSnippet>
      {m && (
        <>
          <b className={styles.em}>One cell, by hand (5500 RPM, 100 kPa):</b> table {table.toFixed(1)}% × wideband {m.lambdaRatio.toFixed(3)} × MAF {m.maf.toFixed(3)} = {(table * m.ratio).toFixed(1)}%. The wideband alone read {((m.lambdaRatio - 1) * 100).toFixed(0)}% lean; only {((m.ratio - 1) * 100).toFixed(1)}% of that was the table.
          <br /><br />
        </>
      )}
      <b className={styles.em}>Why half at a time.</b> The mixture moves a little as cells change, and a point shared among four cells over-corrects the ones it barely touched. Here is the loop run for real on that engine, with the MAF rescaled first, applying half each time:
      <Table
        head={['Pull', 'Worst logged cell', 'Peak']}
        rows={passes.map((p) => [p.pass, `${p.worstPct >= 0 ? '+' : ''}${p.worstPct.toFixed(1)}%`, `${p.peakHp} whp`])}
      />
      The error halves every pass, and by pull {passes.find((p) => Math.abs(p.worstPct) < 2)?.pass ?? passes.length} every cell is inside the 2% a wideband and fuel trims can resolve. That is the whole method: log, apply half, log again.
      <br /><br /><TryIt href="#/tune/airflow">TUNE › AIRFLOW</TryIt>
    </>
  );
}

function MafAndSd() {
  const f = intakeFitted();
  const p = pointAt(f, 5500);
  return (
    <>
      An ECU can know the air in the cylinder two ways, and this game&apos;s ECU uses both.
      <br /><br /><b className={styles.em}>Speed-density</b> works it out: manifold pressure, air temperature and the VE table, through the ideal gas law (article 7). It is only as right as the VE table.
      <br /><br /><b className={styles.em}>A mass airflow sensor (MAF)</b> measures it: a heated wire in the intake, cooled by the air flowing past, read through a curve calibrated for the housing it sits in. It needs no VE table, but it is only as right as that curve.
      <br /><br />The default <b className={styles.em}>Air-mass strategy</b> on TUNE › AIRFLOW is <i>Speed-density + MAF trim</i>: fuel from VE, with the MAF&apos;s error feeding the trims. You can switch it to either one alone. Real tuning splits the same way: HP Tuners on a GM speed-density setup works through a VE table, and UpRev on a Nissan MAF ECU through the MAF curve.
      <br /><br /><b className={styles.em}>Telling the two errors apart.</b> A housing change scales the MAF&apos;s reading by one factor across the whole rev range: the cold air intake here reads {Math.abs(p.trimPct).toFixed(0)}% low at 5500 RPM and about the same everywhere. A VE error is different in every cell, because the part changes how the engine breathes at each speed. So a flat error across the pull is the MAF&apos;s, and a shaped one is VE&apos;s.
      <br /><br /><b className={styles.em}>The fix for each.</b> The MAF scalar on TUNE › SENSORS undoes a flat MAF error: a MAF reading 90% of the air needs 1 ÷ 0.90 ≈ {INTAKE_MAF_SCALAR.toFixed(2)}. The shaped part goes into VE from the log (article 42). Do the MAF first when you can: then the VE log is not also carrying the MAF&apos;s error, although the correction takes it out either way.
      <br /><br /><TryIt href="#/tune/sensors">TUNE › SENSORS</TryIt>
    </>
  );
}

function Troubleshooting() {
  return (
    <>
      The Pull Log names most problems and says where the fix is. This is the same knowledge the other way round: start from what you see.
      <Table
        head={['You see', 'Usually', 'Fix it on']}
        rows={[
          ['Knock at full throttle', 'Spark too advanced for this fuel and compression', 'TUNE › SPARK (the Try line says how far); or better fuel'],
          ['Lean at full throttle after a bolt-on', 'The VE table and the MAF still describe the old hardware', 'TUNE › AIRFLOW (correct from the log) and TUNE › SENSORS'],
          ['MAF reading low or high across the pull', 'An intake or turbo housing changed what the MAF reads', 'TUNE › SENSORS: the MAF scalar'],
          ['Rich everywhere after new injectors', 'The ECU still thinks the old injectors are fitted', 'TUNE › INJECTORS: RESCALE'],
          ['Injectors maxed, lean at the top end', 'Not enough injector for the fuel the engine needs (a hardware limit)', 'BUILD › FUEL SYSTEM, then TUNE › INJECTORS'],
          ['Mixture misses the FUEL table’s target', 'The air estimate is wrong, not the target', 'AIRFLOW, SENSORS or INJECTORS: never the FUEL table'],
          ['Valve float near redline', 'Springs too soft for the cam and RPM', 'BUILD › ENGINE (springs), or a lower rev limit'],
          ['Compressor past its range', 'More boost than this turbo makes efficiently', 'Less boost on TUNE › BOOST, or a bigger compressor on BUILD'],
          ['Overboost protection tripped', 'Boost overshooting its target', 'TUNE › BOOST'],
          ['False knock', 'Valvetrain noise heard as knock', 'TUNE › SPARK: raise the knock threshold just above the noise'],
          ['Knock the ECU could not hear', 'The knock threshold is set above real knock', 'TUNE › SPARK: lower the threshold, and take timing out'],
          ['Bottom-end stress', 'Sustained cylinder pressure: compression times boost', 'Less boost or less compression; no table removes it'],
          ['Big cam, soft low end', 'Overlap: a hardware trade-off', 'A milder cam, if the low end matters'],
          ['Clean log, but no more power to find', 'The engine is at its hardware’s limit', 'BUILD: more air needs parts'],
        ]}
      />
      Two rules cover most of the rest. Fix the <b className={styles.em}>cause</b>, not the target: if the mixture misses the FUEL table, making the table richer only hides a wrong air estimate. And change <b className={styles.em}>one thing</b> per pull, or you will not know which one worked.
      <br /><br /><TryIt href="#/dyno/log">DYNO › PULL LOG</TryIt>
    </>
  );
}

function WorkedSession() {
  const s = stock();
  const f = intakeFitted();
  const m = intakeMafOnly();
  const r = intakeRetuned();
  const entries = (d) => d.result.events.map((e) => e.type).join(', ') || 'clean';
  return (
    <>
      The whole job from chapter 4 of the Tuning Course, with every step&apos;s pull. These are real pulls of the SANDBOX engine, worked out by the game when you opened this article.
      <Table
        head={['Step', 'Peak', 'Pull Log']}
        rows={[
          ['Stock', `${s.result.peakHp} whp`, entries(s)],
          ['Cold air intake fitted', `${f.result.peakHp} whp`, entries(f)],
          [`MAF scalar ${INTAKE_MAF_SCALAR.toFixed(2)}`, `${m.result.peakHp} whp`, entries(m)],
          ['VE corrected from the log', `${r.result.peakHp} whp`, entries(r)],
        ]}
      />
      <b className={styles.em}>What each step did.</b> Fitting the part added {f.result.peakHp - s.result.peakHp} whp on its own, and brought two entries: the MAF reading low, and a lean top end. Rescaling the MAF fixed the mixture: {m.result.peakHp} whp, {m.result.peakHp - f.result.peakHp} more than the untuned part. Correcting VE from the log then changed peak power by {r.result.peakHp - m.result.peakHp} whp, and that is expected: its job is to put the table back in step with the hardware, so the ECU&apos;s air estimate is right from its own tables everywhere the engine runs, not only where a trim happened to catch it.
      <br /><br /><b className={styles.em}>What was not done.</b> Nobody touched the FUEL table, because the target was never wrong. Nobody added spark to &ldquo;use&rdquo; the new air, because a clean log gives no reason to, and chapter 3 showed what too much spark does on this fuel. The part was worth {r.result.peakHp - s.result.peakHp} whp, fitted and tuned.
      <br /><br /><TryIt href="#/build/induction">BUILD › INDUCTION</TryIt>
    </>
  );
}

function HowItRuns() {
  const p = pointAt(stock(), 4500);
  return (
    <>
      A simulation moves in steps. It works out the state of things at one moment, uses the laws of physics to work out the next, and repeats. Physics engines separate that step from the screen: the simulation keeps its own clock, whatever the display is doing. This one works the same way, at three scales.
      <br /><br /><b className={styles.em}>Inside one engine cycle: every {COEFF.CYCLE_STEP_DEG} crank degrees.</b> The pressure, temperature and burned fraction in one cylinder are followed through intake, compression, burn and exhaust, {COEFF.CYCLE_STEP_DEG}° at a time: {720 / COEFF.CYCLE_STEP_DEG} steps per four-stroke cycle. At 4500 RPM on the stock engine the burn takes about {p.burnDeg}°, so it is followed over roughly {Math.round(p.burnDeg / COEFF.CYCLE_STEP_DEG)} steps. Work on the piston is added up step by step, and that sum, less friction and pumping, is the torque (article 26).
      <br /><br /><b className={styles.em}>Across the dyno pull: every 100 RPM.</b> A pull is the cycle above solved at each speed from 1500 RPM to the redline, with the ECU deciding each point&apos;s fuel and spark from your tables. Each point is steady running at that speed; the dyno&apos;s sweep animation is drawn from them afterwards.
      <br /><br /><b className={styles.em}>On LIVE: every 50 milliseconds.</b> The engine advances in fixed 50 ms steps, 20 a second, and the screen shows the latest one. Throttle, idle control, fuel trims, warm-up and the protections all run on that clock.
      <br /><br /><b className={styles.em}>Why fixed steps.</b> The same inputs always give the same answer, to the last digit. That is what lets the game check itself: a test re-runs a large set of engines and compares every number with a stored fingerprint, so a change to the physics can never slip in unnoticed. Smaller steps cost more time for a result that has stopped changing; bigger ones start to miss the fast parts of the burn.
      <br /><br /><b className={styles.em}>Built in layers, checked against the world.</b> Like any simulation worth trusting, this one was built a layer at a time (air, then combustion, then friction, then the ECU) and each layer is held to published data: factory power figures, textbook efficiencies, real saturation tables for nitrous. The accuracy page in the source lists every check.
      <br /><br /><b className={styles.em}>Use it like a lab.</b> Before a pull, say what you think will happen: more power or less, knock or not, where. Then pull. The distance between your guess and the log is exactly what you have just learned.
    </>
  );
}

/**
 * @returns {React.ReactElement}
 */
export function LearnDeep() {
  return (
    <>
      <div className={styles.part}>PART 6 · TUNING IN DEPTH</div>
      <div className={styles.partGoal}>After this part you can run the VE-from-logs method by hand, tell a MAF error from a VE error, diagnose a pull from its symptoms, and say how the simulator gets its answers.</div>
      <ExpandableInfo lazy title="42. Correcting VE from logs, step by step"><VeFromLogs /></ExpandableInfo>
      <ExpandableInfo lazy title="43. MAF, speed-density, and telling their errors apart"><MafAndSd /></ExpandableInfo>
      <ExpandableInfo lazy title="44. Troubleshooting by symptom"><Troubleshooting /></ExpandableInfo>
      <ExpandableInfo lazy title="45. A whole session, worked through"><WorkedSession /></ExpandableInfo>
      <ExpandableInfo lazy title="46. How the simulator runs: steps in time and crank angle"><HowItRuns /></ExpandableInfo>
    </>
  );
}
