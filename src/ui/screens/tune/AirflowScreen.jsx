/**
 * TUNE > AIRFLOW (volumetric efficiency).
 *
 * The table is corrected the way a real speed-density table is: from logs. Nothing on
 * this screen reads the engine's true VE — only what the dyno and the LIVE datalog
 * measured (src/sim/veLearn.js), which the shell gathers and passes down as `veLog`.
 */

import React from 'react';

import { Grid3x3 } from 'lucide-react';

import { AdvisorPanel } from '../../components/AdvisorPanel.jsx';
import { veLogReport } from '../../components/advisorReports.js';
import { SelectModeBar } from '../../components/SelectModeBar.jsx';
import { SelectionDock } from '../../components/SelectionDock.jsx';
import { TuneAdvisory } from '../../components/TuneAdvisory.jsx';
import { TuningGrid } from '../../components/TuningGrid.jsx';
import { VeLogCorrection } from '../../components/VeLogCorrection.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { UndoControls } from '../../components/UndoControls.jsx';
import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { mafErrorPct, veCorrections } from '../../../sim/index.js';
import { ACTIONS } from '../../state/reducer.js';
import { useTune } from '../../state/StoreProvider.jsx';

import styles from './AirflowScreen.module.css';

/** @typedef {import('../../components/TuningGrid.jsx').Selection} Selection */

/**
 * @typedef {object} VeLog
 * @property {import('../../../sim/veLearn.js').VeSample[]} pull from the last dyno pull, if it still describes this tune
 * @property {import('../../../sim/veLearn.js').VeSample[]} live from the LIVE datalog
 * @property {'blend'|'sd'|'maf'} airModel the ECU's air-mass strategy
 * @property {{state: 'none'|'stale'|'part-load'|'unused'|'ok', changed?: string[]}} pullInfo
 *   why the last pull is or is not in the numbers
 * @property {(share: number) => void} onApply applies that share of the correction
 */

/**
 * @param {object} props
 * @param {React.ReactNode} [props.children] the engine management settings that belong
 *   with this table, shown under it
 * @param {VeLog} [props.veLog] what the logs measured — the shell's, which gathers the
 *   dyno result and the LIVE datalog
 * @returns {React.ReactElement}
 */
export function AirflowScreen({ children, veLog }) {
  const [tune, dispatch] = useTune();
  const { ve, selection, rangeMode } = tune;
  /** @param {Selection|null} value */
  const setSelection = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value });
  /** @param {boolean} value */
  /**
   * One table write, one undo step — shared by the grid's +/- keys and the dock.
   * @param {number[][]} value
   * @param {string} [label]
   */
  const setTable = (value, label) => dispatch({ type: ACTIONS.SET_TABLE, table: 've', value, label });
  const setRangeMode = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'rangeMode', value });
  // A handful of `.some()`-free array reads, no allocation in the hot path —
  // plainly on every render, matching SparkScreen/FuelScreen.
  const samples = React.useMemo(() => (veLog ? [...veLog.pull, ...veLog.live] : []), [veLog]);
  const corr = React.useMemo(() => veCorrections(samples), [samples]);
  const report = veLogReport(veLog ? {
    corr, ve, airModel: veLog.airModel, pullInfo: veLog.pullInfo, liveSamples: veLog.live.length,
  } : null, selection);

  return (
    <>
      <div className={styles.wrap}>
        <div className={styles.main}>
          <div className={styles.gridHead}>
            <Eyebrow icon={Grid3x3}>Volumetric Efficiency</Eyebrow>
            <UndoControls />
          </div>
          <div className={styles.intro}>How completely the cylinder fills at each engine speed and load. Rows are manifold pressure (MAP kPa &mdash; about 100 is wide open, higher is boost); columns are RPM. Tap any cell for reference data; drag or shift-click for a range.</div>
          <SelectModeBar rangeMode={rangeMode} setRangeMode={setRangeMode} setSelection={setSelection} />
          <TuningGrid data={ve} min={10} max={130} decimals={0} selection={selection} setSelection={setSelection} rangeMode={rangeMode} setData={setTable} />
          {veLog && (
            <VeLogCorrection corr={corr} pullCount={veLog.pull.length} liveCount={veLog.live.length}
              pullInfo={veLog.pullInfo} mafPct={mafErrorPct(samples)} airModel={veLog.airModel} onApply={veLog.onApply} />
          )}

          <ExpandableInfo title="What VE actually means">
            VE compares the air trapped in the cylinder to the theoretical maximum the swept volume could hold. It rises with RPM as intake tuning matches resonance, then falls as the valves cannot flow fast enough — that fall is why every N/A engine has a torque peak. More air here means more fuel needed to hit a given AFR and more potential torque; VE is really the master variable, and timing/AFR are how you extract power from whatever air is already there.
            <br /><br /><b className={styles.em}>As a beginner:</b> leave VE alone at first. It is set by real hardware (intake, heads, cams) — fitting an intake, headers or a cat-back on BUILD already moves it for you. Spend your early pulls learning TIMING and AFR before you start hand-editing VE.
            <br /><br /><b className={styles.em}>How it is really tuned:</b> no ECU and no tuner can see the engine&apos;s true VE. What you can see is the wideband. Wherever the engine ran leaner than the AFR table asked, it got more air than the VE table thought, by that ratio; the fuel trims say the same thing in closed loop. Tuning software sorts that error into the cells the car was driven through and corrects only those. Log a pull or a drive, apply about half from <b className={styles.em}>Correct VE from logs</b>, log again, and repeat until the cells you use are within 2–3%. On a speed-density ECU this is the job after every change that moves air: intake, cam, exhaust, boost.
          </ExpandableInfo>
          {children}
        </div>
        <AdvisorPanel headline={report.headline} tone={report.tone}>
          <TuneAdvisory kind="ve" report={report} />
        </AdvisorPanel>
      </div>
      <div className={styles.spacer} />
      <SelectionDock data={ve} setData={setTable} selection={selection} min={10} max={130} decimals={0} unit="%" onClose={() => setSelection(null)} kind="ve" />
    </>
  );
}
