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

import { Button } from '../primitives/Button.jsx';

import styles from './TuneAdvisory.module.css';

/** @typedef {import('./advisorReports.js').AdvisorReport} AdvisorReport */

/**
 * @param {object} props
 * @param {'ve'|'timing'|'afr'} props.kind
 * @param {AdvisorReport} props.report
 * @param {() => void} [props.onAcceptVe] only read by the `'ve'` kind
 * @returns {React.ReactElement|null}
 */
export function TuneAdvisory({ kind, report, onAcceptVe }) {
  if (kind === 'timing') return <TimingAdvisory report={report} />;
  if (kind === 'afr') return <AfrAdvisory report={report} />;
  if (kind === 've') return <VeAdvisory report={report} onAcceptVe={onAcceptVe} />;
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

/**
 * @param {object} props
 * @param {AdvisorReport} props.report
 * @param {() => void} [props.onAcceptVe]
 * @returns {React.ReactElement|null}
 */
function VeAdvisory({ report, onAcceptVe }) {
  const { state, detail } = report;

  switch (state) {
    // Table-wide, verbatim from the old `.inSyncBanner` text — the bordered/
    // tinted flex box and its Info icon do NOT come along, same reasoning as
    // every other table-wide state in this file: the panel already renders and
    // colours that surface from `report.tone`.
    case 'table-sync':
      return <div className={`${styles.prose} ${styles.ok}`}>VE table matches your current hardware. Nothing to correct.</div>;
    // Table-wide, verbatim from the old `.staleBanner` body — its `.staleHead`
    // (the "VE OUT OF SYNC WITH HARDWARE" label plus the max-gap figure) does
    // NOT come along either: both numbers are already folded into
    // `report.headline`, the same move SPARK's `.dangerLabel` and FUEL's
    // `.label` made.
    case 'table-stale':
      return (
        <>
          <div className={styles.staleBody}>
            Your hardware changed but this table is still the old log. Here is what re-logging airflow on the dyno would actually show:
          </div>
          {detail.recs.map((r, i) => (
            <div key={i} className={styles.rec}>
              <div className={styles.recTitle}>{r.rpmText}</div>
              <div className={styles.recText}>{r.text}</div>
              <div className={styles.recCells}>{r.cells.join('   ')}</div>
            </div>
          ))}
          {/* Was width:100%. It is the only action in this advisory box and
              reads as one at its own width; the box is already the full
              content column, so stretching it only made it wider. */}
          <Button onClick={onAcceptVe} style={{ marginTop: 4 }}>
            ACCEPT RE-LOGGED VALUES
          </Button>
          <div className={styles.acceptNote}>Or type them in yourself — these are the measured targets, not a suggestion.</div>
        </>
      );

    // A single cell or column. Neither state existed before the panel —
    // AirflowScreen never narrowed to a selection — so there is no old markup
    // to preserve. `veRecommendations` only measures at wide-open throttle, one
    // gap per RPM column, so both states report the SAME number (the column's)
    // and say plainly that it is the column's, never inventing a per-cell one.
    case 'cell-gap':
    case 'col-gap':
      return (
        <div className={styles.prose}>
          <div className={styles.bannerCell}>{detail.rpm} RPM: {detail.from}% &rarr; {detail.to}%</div>
          Measured at wide-open throttle. This gap belongs to the RPM column, not to this one cell.
        </div>
      );
    // The below-threshold counterpart to cell-gap/col-gap — the column's gap
    // is smaller than `VE_NOTABLE_PCT`, the same cutoff `veRecommendations`
    // itself uses to decide a column is not worth flagging, so this reads as
    // an all-clear rather than a muted warning.
    case 'cell-sync':
    case 'col-sync':
      return (
        <div className={`${styles.prose} ${styles.ok}`}>
          <div className={styles.bannerCell}>{detail.rpm} RPM: {detail.from}% &rarr; {detail.to}%</div>
          Measured at wide-open throttle. This column matches your hardware.
        </div>
      );

    // A selected row. `veRecommendations` reports one gap per RPM column, never
    // per row, so there is no row-scoped number to narrow to — unlike SPARK and
    // FUEL's `group-*` states, which count flagged cells inside the band. This
    // deliberately does NOT fall through to `table-stale`: that body carries
    // the ACCEPT RE-LOGGED VALUES button, which writes every row in the table,
    // and a player who selected one row must never be shown a button that
    // silently overwrites the other five.
    case 'group-ve':
      return (
        <div className={styles.prose}>
          VE is measured per RPM column, at wide-open throttle — a row has no gap of its own to report. Select a column header, or a single cell, to see the gap for that RPM.
        </div>
      );

    // No shell comparison at all for this build (`veAdvice` is `null`) — keep
    // the panel mounted rather than throwing or rendering nothing.
    case 'no-advice':
      return <div className={styles.prose}>No airflow comparison available for this build yet.</div>;

    default:
      return null;
  }
}
