/**
 * TUNE > AIRFLOW (volumetric efficiency).
 *
 * `veAdvice` is the shell's: it also feeds BUILD's Engine Architecture screen (the
 * stale-VE callout there), so the shell keeps owning the one computation rather than
 * this screen recomputing half of it. `veTruth` is the same story — it also feeds
 * the shell's `calAdvice` and the dyno payload — so it is passed down purely as the
 * value ACCEPT RE-LOGGED VALUES writes into the table, not recomputed here.
 */

import React from 'react';

import { Grid3x3 } from 'lucide-react';

import { AdvisorPanel } from '../../components/AdvisorPanel.jsx';
import { veReport } from '../../components/advisorReports.js';
import { SelectModeBar } from '../../components/SelectModeBar.jsx';
import { SelectionDock } from '../../components/SelectionDock.jsx';
import { TuneAdvisory } from '../../components/TuneAdvisory.jsx';
import { TuningGrid } from '../../components/TuningGrid.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useTune } from '../../state/StoreProvider.jsx';

import styles from './AirflowScreen.module.css';

/** @typedef {import('../../components/TuningGrid.jsx').Selection} Selection */

/**
 * @typedef {object} VeAdvice
 * @property {boolean} inSync
 * @property {number} maxAbs
 * @property {Array<{rpmText: string, text: string, cells: string[]}>} recs
 * @property {Array<{rpm: number, pct: number, from: number, to: number}>} [deltas]
 *   one per RPM column, measured at the wide-open-throttle row only — read by
 *   `veReport` for a cell/col selection, never by this screen directly.
 *   Optional here only because a handful of pre-existing tests fabricate a
 *   `VeAdvice` that never exercises a cell/col selection; the real shell's
 *   value (`veRecommendations`' return) always has it.
 */

/**
 * @param {object} props
 * @param {VeAdvice|null} props.veAdvice the shell's — also read by BUILD's Engine
 *   Architecture screen, so it stays a shell-level computation
 * @param {number[][]} props.veTruth the hardware's true VE, as currently built —
 *   the shell's, also read by `calAdvice` and the dyno payload
 * @returns {React.ReactElement}
 */
export function AirflowScreen({ veAdvice, veTruth }) {
  const [tune, dispatch] = useTune();
  const { ve, selection, rangeMode } = tune;
  /** @param {Selection|null} value */
  const setSelection = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value });
  const setRangeMode = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'rangeMode', value });
  const recalcVE = () => dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: veTruth });
  // A handful of `.some()`-free array reads, no allocation in the hot path —
  // plainly on every render, matching SparkScreen/FuelScreen.
  const report = veReport(veAdvice, selection);

  return (
    <>
      <div className={styles.wrap}>
        <div className={styles.main}>
          <Eyebrow icon={Grid3x3}>Volumetric Efficiency</Eyebrow>
          <div className={styles.intro}>How completely the cylinder fills at each engine speed and load. Rows are manifold pressure (MAP kPa &mdash; about 100 is wide open, higher is boost); columns are RPM. Tap any cell for reference data.</div>
          <SelectModeBar rangeMode={rangeMode} setRangeMode={setRangeMode} setSelection={setSelection} />
          <TuningGrid data={ve} min={10} max={130} decimals={0} selection={selection} setSelection={setSelection} rangeMode={rangeMode} />

          <ExpandableInfo title="What VE actually means">
            VE compares the air trapped in the cylinder to the theoretical maximum the swept volume could hold. It rises with RPM as intake tuning matches resonance, then falls as the valves cannot flow fast enough — that fall is why every N/A engine has a torque peak. More air here means more fuel needed to hit a given AFR and more potential torque; VE is really the master variable, and timing/AFR are how you extract power from whatever air is already there.
            <br /><br /><b className={styles.em}>As a beginner:</b> leave VE alone at first. It is set by real hardware (intake, heads, cams) — the Bolt-Ons on BUILD already move it for you when you install parts. Spend your early pulls learning TIMING and AFR before you start hand-editing VE.
          </ExpandableInfo>
        </div>
        <AdvisorPanel headline={report.headline} tone={report.tone}>
          <TuneAdvisory kind="ve" report={report} onAcceptVe={recalcVE} />
        </AdvisorPanel>
      </div>
      <div className={styles.spacer} />
      <SelectionDock data={ve} setData={(value) => dispatch({ type: ACTIONS.SET_TABLE, table: 've', value })} selection={selection} min={10} max={130} decimals={0} unit="%" onClose={() => setSelection(null)} kind="ve" rangeMode={rangeMode} />
    </>
  );
}
