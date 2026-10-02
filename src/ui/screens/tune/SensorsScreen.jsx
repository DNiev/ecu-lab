/**
 * TUNE > Sensors (fuel control & MAF scaling: recal status, MAF scalar, fuel trim).
 *
 * `needsMafRecal` is the shell's rather than this screen's own — it also drives
 * HOME's health screen, one computation, several readers, so the shell keeps owning
 * it. `chartData` and `result` are the same story, shared with DYNO.
 */

import React from 'react';

import { Zap } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild } from '../../state/StoreProvider.jsx';
import { T } from '../../theme.js';

import styles from './SensorsScreen.module.css';

/**
 * @param {object} props
 * @param {boolean} props.needsMafRecal the shell's — also read by HOME's health screen
 * @param {Array<{rpm: number, trimPct: number}>} props.chartData the shell's,
 *   shared with DYNO's own fuel-trim chart
 * @param {{points: Array<object>}|null} props.result the shell's, shared with DYNO
 * @param {React.ReactNode} [props.children] the engine management settings that belong
 *   with this screen, shown under it
 * @returns {React.ReactElement}
 */
export function SensorsScreen({ needsMafRecal, chartData, result, children }) {
  const [build, dispatch] = useBuild();
  const { turboOn, mods, mafScalar } = build;

  return (
    <div className={styles.wrap}>
      <Eyebrow icon={Zap}>Fuel Control &amp; MAF Scaling</Eyebrow>
      <Panel className={styles.mafPanel}>
        <div className={styles.mafHead}>
          <span>MAF RECAL STATUS</span>
          <span className={styles.mafStatus} data-needs-recal={needsMafRecal ? 'true' : 'false'}>{needsMafRecal ? 'HARDWARE CHANGED' : 'STOCK — OK'}</span>
        </div>
        {needsMafRecal && (
          <div className={styles.mafNote}>
            {mods.intake && turboOn ? 'Intake + turbo plumbing' : mods.intake ? 'Intake' : 'Turbo plumbing'} changed how air reads across the MAF. Dial in the scalar below, then confirm with a dyno pull.
          </div>
        )}
      </Panel>
      <div className={styles.scalarLabel}>MAF Scalar</div>
      <div className={styles.scalarRow}>
        <input type="range" min={0.75} max={1.25} step={0.01} value={mafScalar} onChange={(e) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'mafScalar', value: Number(e.target.value) })} className={styles.scalarSlider} />
        <div className={styles.scalarValue}>{mafScalar.toFixed(2)}</div>
      </div>
      <ExpandableInfo title="VE tuning vs. MAF tuning — platforms differ">
        This sandbox exposes a VE table because that is the clearest way to teach airflow. Real platforms split into two camps.
        <br /><br /><b className={styles.em}>Speed-density platforms</b> (GM via HP Tuners/EFILive) index a VE table by RPM and MAP — exactly the axes here — and you tune VE directly.
        <br /><br /><b className={styles.em}>MAF-based platforms</b> (Nissan via UpRev) barely expose VE at all. Instead you tune a <b className={styles.em}>MAF curve indexed by sensor voltage</b>, whose values map to grams per second, plus the K-fuel multiplier and a fuel compensation table. Same physics, different control surface: on a Nissan you correct airflow by reshaping the MAF curve rather than a VE grid.
        <br /><br />Everything you learn here transfers — just expect the knobs to be named differently depending on the platform.
      </ExpandableInfo>

      <ExpandableInfo title="How MAF-based fueling actually works">
        The MAF sensor reports airflow as a voltage, using a curve calibrated for the stock intake's exact diameter. Change the housing size and the same real airflow produces a different voltage, so the ECU's load calculation is wrong even though your fuel/timing tables did not change. At part throttle, closed-loop O2 feedback quietly corrects most of this; at wide-open throttle the ECU usually runs open-loop and blind to the O2 sensor, so the error goes straight through — which is why WOT is where bad MAF scaling shows up hardest.
        <br /><br /><b className={styles.em}>As a beginner:</b> do not guess the scalar. Install the part, run a pull, then check the AFR trace and the MAF trim log entry on DYNO — they will tell you which direction and roughly how far to move it.
      </ExpandableInfo>
      {result && (
        <Panel tight className={styles.trimPanel}>
          <div className={styles.trimLabel}>FUEL TRIM — LAST PULL</div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={chartData} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={T.line} />
              <XAxis dataKey="rpm" stroke={T.ink3} fontSize={10} />
              <YAxis stroke={T.ink3} fontSize={10} unit="%" />
              <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11 }} />
              <Line dataKey="trimPct" name="MAF trim %" stroke={T.violet} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      )}
      {children}
    </div>
  );
}
