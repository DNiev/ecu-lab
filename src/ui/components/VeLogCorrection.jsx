/**
 * TUNE > AIRFLOW: correct the VE table from what the logs measured — the way a
 * speed-density table is really tuned (see src/sim/veLearn.js).
 *
 * The wideband and the fuel trims say, cell by cell, how far the ECU's air estimate was
 * off wherever the car has been; this shows that error and applies a share of it to the
 * cells that have data. Cells never visited keep their values, exactly as in HP Tuners'
 * histograms or a Holley learn: the software cannot know what it has not measured.
 */

import React from 'react';

import { LOAD, RPM } from '../../sim/index.js';
import { Button } from '../primitives/Button.jsx';
import { Note } from '../primitives/Note.jsx';

import styles from './VeLogCorrection.module.css';

/** Within this, a cell is as right as a wideband and trims can tell. */
const GOOD_PCT = 2;
/** Past this, a cell is far enough off to be worth fixing before anything else. */
const FAR_PCT = 5;

/** Why the last pull is not in the numbers, in a line. */
const PULL_NOTE = {
  none: 'No dyno pull yet.',
  'part-load': 'The last pull was at part throttle (closed loop), so it is left out.',
  unused: 'The last pull had no usable points.',
};

/**
 * @param {object} props
 * @param {{ratio: (number|null)[][], cells: number}} props.corr from `veCorrections`
 * @param {number} props.pullCount samples from the last dyno pull, if it still describes this tune
 * @param {number} props.liveCount samples from the LIVE datalog
 * @param {{state: string, changed?: string[]}} props.pullInfo why the pull is or is not used
 * @param {number} props.mafPct the MAF's own reading error across the samples, percent
 * @param {'blend'|'sd'|'maf'} props.airModel the ECU's air-mass strategy
 * @param {(share: number) => void} props.onApply applies that share of the correction
 * @returns {React.ReactElement}
 */
export function VeLogCorrection({ corr, pullCount, liveCount, pullInfo, mafPct, airModel, onApply }) {
  const pullNote = pullInfo.state === 'stale'
    ? `The last pull was run before you changed ${pullInfo.changed?.length ? pullInfo.changed.join(', ') : 'the conditions'} — a log only describes the tune it was taken on, so run another pull.`
    : PULL_NOTE[/** @type {keyof typeof PULL_NOTE} */ (pullInfo.state)] ?? null;

  if (airModel === 'maf') {
    return (
      <section className={styles.panel} aria-label="Correct VE from logs">
        <div className={styles.head}>CORRECT VE FROM LOGS</div>
        <Note>The ECU is running on the MAF, so the VE table is not in the fuel path. Mixture error on a MAF car belongs in the MAF calibration: the MAF transfer correction on this page and the MAF scalar on TUNE › SENSORS.</Note>
      </section>
    );
  }

  /** @type {{pct: number, rpm: number, load: number}} */
  let worst = { pct: 0, rpm: RPM[0], load: LOAD[0] };
  const errPct = corr.ratio.map((row, ri) => row.map((r, ci) => {
    if (r == null) return null;
    const pct = (r - 1) * 100;
    if (Math.abs(pct) > Math.abs(worst.pct)) worst = { pct, rpm: RPM[ci], load: LOAD[ri] };
    return pct;
  }));
  const inSync = corr.cells > 0 && Math.abs(worst.pct) < GOOD_PCT;

  return (
    <section className={styles.panel} aria-label="Correct VE from logs">
      <div className={styles.head}>CORRECT VE FROM LOGS</div>
      <p className={styles.summary}>
        {pullCount} samples from the last pull · {liveCount} from the LIVE log · <b>{corr.cells}</b> {corr.cells === 1 ? 'cell' : 'cells'} with data
      </p>
      {pullNote && <p className={styles.hint}>{pullNote}</p>}
      {Math.abs(mafPct) >= GOOD_PCT && (
        <p className={styles.maf}>
          The MAF read {Math.abs(mafPct).toFixed(1)}% {mafPct < 0 ? 'low' : 'high'} in these logs. That part is the MAF scalar&apos;s job, on{' '}
          <a href="#/tune/sensors">TUNE › SENSORS</a>, and is taken out of the numbers below — tune the MAF and the VE table separately, or each hides the other&apos;s error.
        </p>
      )}
      {corr.cells === 0 ? (
        <p className={styles.hint}>
          No usable data yet. Run a dyno pull, or drive the LIVE engine warm at a steady throttle through the cells you want to tune. Acceleration enrichment, warm-up fuel, fuel cut, nitrous and protection enrichment are left out, as real tuning software leaves them out.
        </p>
      ) : (
        <>
          <div className={styles.scroll}>
            <table className={styles.grid} aria-label="Logged VE error by cell, percent">
              <thead>
                <tr><th className={styles.corner}>kPa</th>{RPM.map((r) => <th key={r}>{r >= 1000 ? `${(r / 1000).toFixed(1)}k` : r}</th>)}</tr>
              </thead>
              <tbody>
                {LOAD.map((load, ri) => (
                  <tr key={load}>
                    <th>{load}</th>
                    {RPM.map((rpm, ci) => {
                      const pct = errPct[ri][ci];
                      const tone = pct == null ? 'none' : Math.abs(pct) < GOOD_PCT ? 'good' : Math.abs(pct) < FAR_PCT ? 'near' : 'far';
                      // Rounded first, so a hair under zero shows as 0.0 rather than -0.0.
                      const shown = pct == null ? null : Number(pct.toFixed(1)) || 0;
                      return <td key={rpm} data-tone={tone}>{shown == null ? '·' : `${shown > 0 ? '+' : ''}${shown.toFixed(1)}`}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>
            {inSync
              ? `Every logged cell is within ${GOOD_PCT}% — as close as a wideband and fuel trims can tell.`
              : `Largest: ${worst.pct > 0 ? '+' : ''}${worst.pct.toFixed(1)}% at ${worst.rpm} RPM, ${worst.load} kPa. Positive means the engine got more air than the table thought (it ran lean).`}
          </p>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => onApply(0.5)} disabled={inSync}>APPLY HALF</Button>
            <Button size="sm" variant="ghost" onClick={() => onApply(1)} disabled={inSync}>APPLY ALL</Button>
          </div>
          <p className={styles.hint}>
            Tuners apply about half, log again and repeat until every cell is within 2–3%. Only cells with data change; applying also resets the fuel trims, which had been covering the same error. A pull is used only while it matches the tune on screen.
          </p>
        </>
      )}
    </section>
  );
}
