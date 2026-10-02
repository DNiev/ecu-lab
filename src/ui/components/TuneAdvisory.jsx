/**
 * TUNE's advisor panel body: turns an `AdvisorReport` (`advisorReports.js`)
 * into prose.
 *
 * Pure by design — no store access, no computation of its own. `report.state`
 * picks which body renders and `report.detail` supplies the numbers that go
 * in it; every classification decision already happened in `advisorReports.js`
 * (which itself only reads what the sim's advisors concluded — see that
 * file's header for why re-deriving a category here would be a bug, not a
 * convenience).
 *
 * `kind` distinguishes the three grid screens sharing this component: SPARK
 * (`'timing'`), FUEL (`'afr'`) and AIRFLOW (`'ve'`).
 */

import React from 'react';


import styles from './TuneAdvisory.module.css';

/** @typedef {import('./advisorReports.js').AdvisorReport} AdvisorReport */

/**
 * @param {object} props
 * @param {'ve'|'timing'|'afr'} props.kind
 * @param {AdvisorReport} props.report
 * @returns {React.ReactElement|null}
 */
export function TuneAdvisory({ kind, report }) {
  if (kind === 'timing') return <TimingAdvisory report={report} />;
  if (kind === 'afr') return <AfrAdvisory report={report} />;
  if (kind === 've') return <VeAdvisory report={report} />;
  return null;
}

/**
 * The cell's coordinates and its four numbers, as a small definition list.
 * Shared by the four timing states below (`cell-over`, `cell-past-mbt`,
 * `cell-under`, `cell-ok`) — AFR's `cell-ok` hand-rolls its own line instead,
 * since a fuel cell has no knock ceiling or MBT to show.
 * @param {object} props
 * @param {object} props.cell a `spark` row from `calibrationAdvice`
 * @returns {React.ReactElement}
 */
function CellStats({ cell }) {
  return (
    <>
      <div className={styles.bannerCell}>{cell.map} kPa / {cell.rpm} RPM</div>
      <dl className={styles.cellStats}>
        <dt>Your value</dt><dd>{cell.current}°</dd>
        <dt>Knock limit</dt><dd>{cell.knockCeiling}°</dd>
        <dt>MBT</dt><dd>{cell.mbt}°</dd>
        <dt>Suggested</dt><dd>{cell.suggested}°</dd>
      </dl>
    </>
  );
}

/**
 * @param {object} props
 * @param {AdvisorReport} props.report
 * @returns {React.ReactElement|null}
 */
function TimingAdvisory({ report }) {
  const { state, detail } = report;

  switch (state) {
    // Table-wide, mutually exclusive — the same four states SparkScreen used
    // to fall through to, moved here verbatim. The outer bordered/tinted box
    // does NOT come along: the panel already renders and colours that surface
    // from `report.tone`, so nesting a second one here would double it up.
    case 'table-over':
      return (
        <>
          <div className={styles.bannerBody}>
            Your current hardware will not tolerate this much advance here. These cells are asking for more timing than the charge, octane and compression allow{detail.cells.some((c) => c.knockingOnPull) ? ' — they are the cells the engine was reading when it knocked on a full-throttle pull' : ''}:
          </div>
          {detail.cells.map((c, i) => (
            <div key={i} className={styles.bannerCell}>
              {c.map} kPa / {c.rpm} RPM: {c.current}° → {c.suggested}°
            </div>
          ))}
          {detail.more > 0 && <div className={styles.bannerMore}>…and {detail.more} more</div>}
          <div className={styles.bannerFooter}>Edit them yourself — a calibration is yours to make, not something the app should silently rewrite.</div>
        </>
      );
    case 'table-under':
      return (
        <div className={styles.prose}>
          <b className={styles.em}>Timing left on the table.</b> {detail.count} cells are more than 3° below what this build would tolerate. Safe, but you are giving away torque — advance them a little at a time and pull between each change.
        </div>
      );
    case 'table-past-mbt':
      return (
        <div className={styles.prose}>
          <b className={styles.em}>Past peak torque.</b> {detail.count} cells command more advance than the burn can use — the charge is already finishing where it should, so the extra degrees are working against the piston on its way up rather than adding torque. Not dangerous here — these cells are inside the knock limit — but pulling them back gains a little power and buys margin.
        </div>
      );
    case 'table-clean':
      return <div className={`${styles.prose} ${styles.ok}`}>Spark table sits within the knock limit for this hardware.</div>;

    // A single selected cell. These states did not exist before the panel —
    // `SparkScreen` never narrowed to a selection — so there is no old markup
    // to preserve; the wording below is the brief's, verbatim.
    case 'cell-over':
      return (
        <div className={styles.prose}>
          <CellStats cell={detail.cell} />
          {detail.cell.knockingOnPull ? 'The engine knocked while it was reading this cell on a full-throttle pull. ' : ''}Past the knock limit the engine is damaging itself. Pull this cell back to the suggested value, or lower.
        </div>
      );
    case 'cell-past-mbt':
      return (
        <div className={styles.prose}>
          <CellStats cell={detail.cell} />
          The burn already lands where it should, so the extra degrees are pushing against the piston on the way up rather than making torque. Not dangerous — this cell is inside the knock limit — but pulling it back gains a little power and buys margin.
        </div>
      );
    case 'cell-under':
      return (
        <div className={styles.prose}>
          <CellStats cell={detail.cell} />
          This cell is leaving advance on the table. Add it a degree at a time and run a pull between each change.
        </div>
      );
    case 'cell-ok':
      return (
        <div className={`${styles.prose} ${styles.ok}`}>
          <CellStats cell={detail.cell} />
          Inside both the knock limit and MBT. Nothing to correct here.
        </div>
      );
    case 'cell-unreachable':
      return (
        <div className={styles.prose}>
          This build never reaches this manifold pressure at this engine speed, so the advisor has nothing to say about the cell. It is still yours to edit — it just will not be used.
        </div>
      );

    // A selected row or column. Severity already picked the tone and headline
    // (Task 3); the body just points at the fix.
    case 'group-over':
    case 'group-past-mbt':
    case 'group-under':
      return <div className={styles.prose}>Select a single cell to see its numbers.</div>;
    case 'group-clean':
      return <div className={`${styles.prose} ${styles.ok}`}>Select a single cell to see its numbers.</div>;

    default:
      return null;
  }
}

/**
 * One AFR cell's coordinates and its commanded/suggested numbers, formatted
 * exactly as `FuelScreen`'s old banner formatted a wrongMix row — `data-richen`
 * stays on it, since `TuneAdvisory.module.css:24` colours the two directions
 * differently and that distinction has to survive wherever this line appears.
 * @param {object} props
 * @param {object} props.cell a `fuelAdv` row from `calibrationAdvice`
 * @returns {React.ReactElement}
 */
function AfrCellLine({ cell }) {
  return (
    <div className={styles.bannerCell} data-richen={cell.delta < 0 ? 'true' : 'false'}>
      {cell.map} kPa / {cell.rpm} RPM: {cell.current}:1 → {cell.suggested}:1 {cell.delta < 0 ? '(richen)' : '(lean out)'} · delivered {cell.delivered}, wants {cell.target}
    </div>
  );
}

/**
 * Whether the engine got a different mixture from the one the cell asks for — by more
 * than a wideband's worth of noise. When it did, the cell is not where the fault is.
 * @param {{current: number, delivered: number}} cell
 * @returns {boolean}
 */
function missesTarget(cell) {
  return Math.abs(cell.delivered - cell.current) > 0.5;
}

/**
 * Said wherever a cell's suggestion is making up for fuelling that misses its target:
 * the suggestion works, but a tuner fixes the cause first.
 * @returns {React.ReactElement}
 */
function FuellingNote() {
  return (
    <p className={styles.prose}>
      The engine is not getting what these cells ask for, so the fuelling is off, not just the target. A tuner fixes that first: correct VE on AIRFLOW, and check the injector scaling on INJECTORS and the MAF scalar on SENSORS. Then the table means what it says everywhere, not only in the cells you patched.
    </p>
  );
}

/**
 * @param {object} props
 * @param {AdvisorReport} props.report
 * @returns {React.ReactElement|null}
 */
function AfrAdvisory({ report }) {
  const { state, detail } = report;

  switch (state) {
    // Table-wide. FuelScreen's old banner, moved here verbatim — the outer
    // bordered/tinted box and the "N HIGH-LOAD CELLS..." label do NOT come
    // along, same as SPARK: the panel already renders that surface from
    // `report.tone` and shows the label's content as `report.headline`.
    case 'table-off':
      return (
        <>
          <div className={styles.bannerBody}>
            Best-power mixture shifts with boost — richer as cylinder pressure rises. These cells are judged on what the engine actually <b className={styles.emInk}>delivered</b>, not on what the table commanded: if your MAF or injector scaling is off, the two are not the same number, and the delivered one is the one the pistons feel. The suggestion is the value to type into the cell to land on target.
          </div>
          {detail.cells.map((c, i) => <AfrCellLine key={i} cell={c} />)}
          {detail.more > 0 && <div className={styles.bannerMore}>…and {detail.more} more</div>}
          {detail.cells.some(missesTarget) && <div className={styles.bannerBody}><FuellingNote /></div>}
        </>
      );
    // FUEL had no clean state at all — the old banner simply did not render
    // when wrongMix was empty. The panel always renders something, so this is
    // genuinely new prose, not a moved state.
    case 'table-clean':
      return <div className={`${styles.prose} ${styles.ok}`}>AFR table sits on best power at every high-load cell for this hardware.</div>;

    // A single selected cell. None of these states existed before the panel —
    // FuelScreen never narrowed to a selection — so there is no old markup to
    // preserve.
    case 'cell-off':
      return (
        <div className={styles.prose}>
          <AfrCellLine cell={detail.cell} />
          Best-power mixture shifts with boost, and this cell is judged on what the engine actually delivered, not on what the table commanded. Type the suggested value into the cell to land on target.
          {missesTarget(detail.cell) && <FuellingNote />}
        </div>
      );
    case 'cell-closed-loop':
      return (
        <div className={styles.prose}>
          Below the open-loop load (85 kPa) the ECU runs closed loop: the fuel trims hold the delivered mixture on this cell&apos;s target and correct any error live. Best-power mixture advice does not apply here — this cell belongs to the trims, not the power tune.
        </div>
      );
    case 'cell-ok':
      return (
        <div className={`${styles.prose} ${styles.ok}`}>
          <div className={styles.bannerCell}>{detail.cell.map} kPa / {detail.cell.rpm} RPM: {detail.cell.current}:1</div>
          Delivered mixture lands on the best-power target here. Nothing to correct.
        </div>
      );
    case 'cell-unreachable':
      return (
        <div className={styles.prose}>
          This build never reaches this manifold pressure at this engine speed, so the advisor has nothing to say about the cell. It is still yours to edit — it just will not be used.
        </div>
      );

    // A selected row or column. Only one category applies to FUEL, unlike
    // SPARK's three, so the body just points at the fix.
    case 'group-off':
      return <div className={styles.prose}>Select a single cell to see its numbers.</div>;
    case 'group-clean':
      return <div className={`${styles.prose} ${styles.ok}`}>Select a single cell to see its numbers.</div>;

    default:
      return null;
  }
}

/** Why the last pull is not in the VE numbers, in words. */
function pullWhy(pullInfo) {
  switch (pullInfo?.state) {
    case 'none': return 'No dyno pull yet.';
    case 'stale': return pullInfo.changed?.length
      ? `The last pull was run before you changed: ${pullInfo.changed.join(', ')}. A log only describes the tune it was taken on — run another pull.`
      : 'The last pull was run in different conditions (the day or an injected fault changed). Run another pull.';
    case 'part-load': return 'The last pull was at part throttle, in closed loop, where the fuel trims — not the table — set the mixture. Pull at full load, or drive LIVE for part-throttle cells.';
    case 'unused': return 'The last pull had no usable points (nitrous, injectors at their limit, protection or fuel cut).';
    default: return null;
  }
}

/** One cell's correction, worked through the way tuning software does it. */
function VeMath({ cell }) {
  const f = (v) => v.toFixed(3);
  const newVe = cell.table * cell.ratio;
  return (
    <div className={styles.veMath}>
      <div className={styles.recTitle}>{cell.rpm} RPM · {cell.load} kPa — {cell.samples} samples</div>
      <dl className={styles.cellStats}>
        <dt>Table VE now</dt><dd>{cell.table.toFixed(1)}%</dd>
        <dt>λ measured ÷ λ target</dt><dd>{f(cell.lambdaRatio)}</dd>
        {Math.abs(cell.trim - 1) > 0.0005 && <><dt>× fuel trims</dt><dd>{f(cell.trim)}</dd></>}
        {Math.abs(cell.maf - 1) > 0.0005 && <><dt>× MAF error taken out</dt><dd>{f(cell.maf)}</dd></>}
        {Math.abs(cell.rescale - 1) > 0.0005 && <><dt>× logged on a different VE</dt><dd>{f(cell.rescale)}</dd></>}
        <dt>= correction</dt><dd>{f(cell.ratio)} ({cell.ratio >= 1 ? '+' : ''}{((cell.ratio - 1) * 100).toFixed(1)}%)</dd>
        <dt>New VE</dt><dd>{cell.table.toFixed(1)} × {f(cell.ratio)} = {newVe.toFixed(1)}% (half: {(cell.table + (newVe - cell.table) / 2).toFixed(1)}%)</dd>
      </dl>
      <div className={styles.recText}>
        Leaner than the table asked (over 1) means the engine got more air than the ECU calculated from MAP, IAT and this VE; richer means less.
        {Math.abs(cell.maf - 1) > 0.0005 && ' The MAF was reading wrong too; that part is taken out here because it belongs to the MAF scalar on TUNE › SENSORS, not the VE table.'}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {AdvisorReport} props.report from `veLogReport`
 * @returns {React.ReactElement|null}
 */
function VeAdvisory({ report }) {
  const { state, detail } = report;
  const formula = (
    <div className={styles.bannerCell}>VE new = VE × (λ measured ÷ λ target) × fuel trims × MAF factor</div>
  );
  switch (state) {
    case 'no-logs':
    case 'sel-empty': {
      const why = pullWhy(detail.pullInfo);
      return (
        <div className={styles.prose}>
          {formula}
          No tuning software can see an engine&apos;s true VE; it corrects the table from logs. {why}
          {' '}Run a pull for the full-throttle row, and drive the LIVE engine warm at a steady throttle for the rest — then apply the correction under the table.
        </div>
      );
    }
    case 'maf-model':
      return <div className={styles.prose}>The ECU is running on the MAF, so this table does not set the fuel. Mixture error belongs in the MAF calibration: the MAF transfer correction on this page and the MAF scalar on TUNE › SENSORS.</div>;
    case 'log-sync':
    case 'log-off':
      return (
        <>
          {formula}
          <VeMath cell={detail.cell} />
          <div className={styles.acceptNote}>
            {state === 'log-sync'
              ? 'Within what a wideband and fuel trims can resolve. Nothing to correct here.'
              : 'Apply half with CORRECT VE FROM LOGS under the table, log again, and repeat until every cell you use is within 2–3%.'}
          </div>
        </>
      );
    default:
      return null;
  }
}
