/**
 * TUNE > SPARK (ignition timing).
 *
 * `calAdvice` is the shell's: it also feeds the FUEL screen (the wrong-mixture
 * advisory there reads a different slice of the same object), so the shell keeps
 * owning the one computation rather than each screen recomputing its own half.
 */

import React from 'react';

import { Zap } from 'lucide-react';

import { SPARK_MAX_DEG, SPARK_MIN_DEG } from '../../../sim/index.js';
import { AdvisorPanel } from '../../components/AdvisorPanel.jsx';
import { sparkReport } from '../../components/advisorReports.js';
import { SelectModeBar } from '../../components/SelectModeBar.jsx';
import { SelectionDock } from '../../components/SelectionDock.jsx';
import { TuneAdvisory } from '../../components/TuneAdvisory.jsx';
import { TuningGrid } from '../../components/TuningGrid.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useTune } from '../../state/StoreProvider.jsx';

import styles from './SparkScreen.module.css';

/** @typedef {import('../../components/TuningGrid.jsx').Selection} Selection */

/**
 * @typedef {object} CalAdvice
 * @property {Array<{map: number, rpm: number, current: number, suggested: number}>} overAdvanced
 * @property {Array<object>} underAdvanced
 * @property {Array<object>} pastMbt
 * @property {Array<{map: number, rpm: number, current: number, suggested: number, delta: number, delivered: number, target: number}>} wrongMix
 */

/**
 * @param {object} props
 * @param {CalAdvice} props.calAdvice the shell's — also read by the FUEL screen
 * @returns {React.ReactElement}
 */
export function SparkScreen({ calAdvice }) {
  const [tune, dispatch] = useTune();
  const { timing, selection, rangeMode } = tune;
  /** @param {Selection|null} value */
  const setSelection = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value });
  const setRangeMode = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'rangeMode', value });
  // A handful of `.some()` scans over at most 96 cells, no allocation in the
  // hot path — plainly on every render, not memoised.
  const report = sparkReport(calAdvice, selection);

  return (
    <>
      <div className={styles.wrap}>
        <div className={styles.main}>
          <Eyebrow icon={Zap}>Ignition Timing</Eyebrow>
          <div className={styles.intro}>Degrees of spark advance before top dead center (° BTDC).</div>
          <SelectModeBar rangeMode={rangeMode} setRangeMode={setRangeMode} setSelection={setSelection} />
          <TuningGrid data={timing} min={SPARK_MIN_DEG} max={SPARK_MAX_DEG} decimals={0} selection={selection} setSelection={setSelection} rangeMode={rangeMode} />

          <ExpandableInfo title="Why the app never rewrites your spark or fuel tables">
            The VE table auto-syncs because volumetric efficiency is a <b className={styles.emInk}>measurement of the hardware</b> — swap a cam and a tuner simply re-logs airflow, and the numbers are what they are.
            <br /><br />Spark and fuel are different: they are <b className={styles.emInk}>your calibration</b>, a set of judgement calls about how much risk to take for how much power. A real ECU does not retune itself when you bolt on a turbo — it keeps running the old numbers into the new hardware, which is exactly how engines get hurt.
            <br /><br />So the app tells you what the hardware will now tolerate, and leaves the editing to you. That gap between "what the engine can take" and "what your table asks for" is the entire job.
          </ExpandableInfo>

          <ExpandableInfo title="Why timing has a sweet spot (MBT)">
            Combustion is not instant — the flame front takes time to burn through the mixture. Timing decides when the burn starts so peak cylinder pressure lands just after top dead center, where it does useful work. Advance too far and pressure peaks before the piston is ready, fighting the crank and risking knock; retard too far and you are burning fuel after the piston has already started down, wasting it as heat. MBT is the earliest timing that still lands the burn right — past it, more advance buys almost nothing, only risk.
            <br /><br /><b className={styles.emInk}>As a beginner:</b> nudge one cell 1-2° at a time, run a pull, and read the log. If it comes back clean with no knock event, you probably still have room. If you see a knock warning, that cell is your new ceiling — back off to what the log suggests and move on.
          </ExpandableInfo>
        </div>
        <AdvisorPanel headline={report.headline} tone={report.tone}>
          <TuneAdvisory kind="timing" report={report} />
        </AdvisorPanel>
      </div>
      <div className={styles.spacer} />
      <SelectionDock data={timing} setData={(value) => dispatch({ type: ACTIONS.SET_TABLE, table: 'timing', value })} selection={selection} min={SPARK_MIN_DEG} max={SPARK_MAX_DEG} decimals={0} unit="°" onClose={() => setSelection(null)} kind="timing" rangeMode={rangeMode} />
    </>
  );
}
