/**
 * LIVE's engine management panel: what the ECU is doing, the loads a driver switches
 * on, the day's air, faults to inject, a data logger, and the correction stack behind
 * the numbers.
 *
 * Renders at 20 Hz with the rest of LIVE (see LiveScreen.jsx), so it only reads.
 */

import { Cpu } from 'lucide-react';
import React from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { FAULTABLE_SENSORS, LOG_CHANNELS } from '../../../sim/index.js';
import { CorrectionStack } from '../../components/ecu/CorrectionStack.jsx';
import { MapSlots } from '../../components/ecu/MapSlots.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { StatTile } from '../../primitives/StatTile.jsx';
import { Toggle } from '../../primitives/Toggle.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useSession } from '../../state/StoreProvider.jsx';
import { T } from '../../theme.js';

import styles from './LiveEcuPanel.module.css';

/** Series colours for the logger's small multiples: data hues, never status colours. */
const SERIES = [T.acc, T.cyan, T.violet, T.ink2];
const DEFAULT_CHANNELS = ['rpm', 'lambda', 'timing', 'boost'];
/** Seconds of log the charts show. */
const WINDOW_S = 20;

/** @returns {React.ReactElement|null} */
export function LiveEcuPanel() {
  const [session, dispatch] = useSession();
  const live = /** @type {Record<string, any>} */ (session.live);
  const e = live.ecu;
  const [channels, setChannels] = React.useState(DEFAULT_CHANNELS);
  const [frozen, setFrozen] = React.useState(/** @type {object[]|null} */ (null));
  const setSession = (field, value) => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field, value });
  const aux = session.liveAux ?? { ac: false, lights: false };
  const faults = session.faults ?? {};
  const env = session.env ?? { ambientC: 25, altitudeM: 0 };

  const log = frozen ?? e?.log ?? [];
  const tEnd = log.length ? log[log.length - 1].t : 0;
  const shown = log.filter((r) => r.t >= tEnd - WINDOW_S);
  const row = e?.log?.[e.log.length - 1];

  const toggleChannel = (id) => {
    if (channels.includes(id)) setChannels(channels.filter((c) => c !== id));
    else setChannels([...channels, id].slice(-4));
  };
  const exportCsv = () => {
    const src = e?.log ?? [];
    if (!src.length) return;
    const cols = LOG_CHANNELS.map((c) => c.id);
    const text = [cols.map((id) => {
      const c = LOG_CHANNELS.find((x) => x.id === id);
      return `${c.label} (${c.unit})`;
    }).join(','), ...src.map((r) => cols.map((id) => r[id] ?? '').join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'ecu-lab-live-log.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Panel style={{ background: T.panel, marginBottom: 10 }}>
      <Eyebrow icon={Cpu}>Engine management</Eyebrow>

      {row && live.running ? (
        <div className={styles.tiles}>
          <StatTile label="Knock retard" value={row.knockRetard.toFixed(1)} unit="°" tone={row.knockRetard > 0 ? 'warn' : 'neutral'} />
          <StatTile label="Accel enrich" value={row.ae.toFixed(0)} unit="%" />
          <StatTile label="Cyl gets" value={row.filmFactor} unit="% of fuel" />
          <StatTile label="Battery" value={row.volts.toFixed(1)} unit="V" />
          <StatTile label="Oil" value={row.oil} unit="kPa" tone={e.protect.includes('oil pressure') ? 'danger' : 'neutral'} />
          <StatTile label="Protections" value={e.protect.length ? e.protect.join(', ') : 'none'} tone={e.protect.length ? 'warn' : 'ok'} />
        </div>
      ) : (
        <p className={styles.muted}>Start the engine to see the ECU's controllers at work.</p>
      )}
      {e?.limp && <div className={styles.limp}>LIMP MODE — {e.limp}. Reduced power until it clears.</div>}

      <div className={styles.slots}>
        <MapSlots compact />
        <span className={styles.hint}>Switch maps on the fly — the engine runs the new calibration on its next step.</span>
      </div>

      <div className={styles.loads}>
        <Toggle label="A/C compressor" sub="About 11 Nm on the crank when the clutch is in — watch the idle hold it" checked={!!aux.ac} onChange={(v) => setSession('liveAux', { ...aux, ac: v })} />
        <Toggle label="Headlights & fans" sub="45 A more from the alternator, which it takes from the crank" checked={!!aux.lights} onChange={(v) => setSession('liveAux', { ...aux, lights: v })} />
        <Toggle label="Clutch in — launch armed" sub="With launch control on (TUNE › TORQUE), full throttle holds the engine on the two-step" checked={!!aux.launch} onChange={(v) => setSession('liveAux', { ...aux, launch: v })} />
      </div>

      <div className={styles.sectionHead}>
        <span>DATA LOG</span>
        <span className={styles.flex} />
        <button type="button" className={styles.chip} aria-pressed={!!frozen} onClick={() => setFrozen(frozen ? null : [...(e?.log ?? [])])}>{frozen ? 'Resume' : 'Pause'}</button>
        <button type="button" className={styles.chip} onClick={exportCsv} disabled={!e?.log?.length}>Export CSV</button>
      </div>
      <div className={styles.channels} role="group" aria-label="Logged channels shown">
        {LOG_CHANNELS.filter((c) => c.id !== 't').map((c) => (
          <button key={c.id} type="button" className={styles.channel} aria-pressed={channels.includes(c.id)} onClick={() => toggleChannel(c.id)}>{c.label}</button>
        ))}
      </div>
      {shown.length > 2 ? channels.map((id, i) => {
        const c = LOG_CHANNELS.find((x) => x.id === id);
        return (
          <div key={id} className={styles.chart}>
            <div className={styles.chartLabel} style={{ color: SERIES[i] }}>{c.label} <span className={styles.chartUnit}>{c.unit}</span> <span className={styles.chartNow}>{shown[shown.length - 1][id]}</span></div>
            <ResponsiveContainer width="100%" height={64}>
              <LineChart data={shown} margin={{ top: 2, right: 6, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
                <YAxis stroke={T.ink3} fontSize={9} width={34} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11 }} labelFormatter={(t) => `${Number(t).toFixed(1)} s`} />
                <Line dataKey={id} stroke={SERIES[i]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      }) : <p className={styles.muted}>The logger records every channel at 20 Hz while the engine runs — the last 60 seconds are kept.</p>}

      {e?.breakdown && live.running && live.live && (
        <>
          <div className={styles.sectionHead}><span>WHERE THE NUMBERS COME FROM</span></div>
          <p className={styles.muted}>Each value starts from your table, then lists every adjustment the ECU made, in order. If a number surprises you, the line that moved it is here.</p>
          <CorrectionStack breakdown={{ ...e.breakdown, boost: e.boostSteps }} result={{ timing: live.live.timing, lambda: live.live.lambda }} />
        </>
      )}

      <details className={styles.details}>
        <summary className={styles.summary}>Conditions &amp; fault injection</summary>
        <div className={styles.detailsBody}>
          <label className={styles.slider}>
            <span>Ambient {Math.round(env.ambientC)} °C</span>
            <input type="range" min={-20} max={45} step={1} value={Math.round(env.ambientC)} aria-label="Ambient temperature"
              onChange={(ev) => setSession('env', { ...env, ambientC: Number(ev.target.value) === 25 ? 24.85 : Number(ev.target.value) })} />
          </label>
          <label className={styles.slider}>
            <span>Altitude {env.altitudeM} m</span>
            <input type="range" min={0} max={3000} step={100} value={env.altitudeM} aria-label="Altitude"
              onChange={(ev) => setSession('env', { ...env, altitudeM: Number(ev.target.value) })} />
          </label>
          <div className={styles.hint}>The dyno breathes the same air: hot air is thinner and closer to knock, and at altitude the barometer is lower before the throttle even opens.</div>

          <div className={styles.faultGrid}>
            {FAULTABLE_SENSORS.map((s) => (
              <label key={s.id} className={styles.fault}>
                <span>{s.label}</span>
                <select value={faults[s.id] ?? 'ok'} aria-label={`${s.label} sensor fault`}
                  onChange={(ev) => setSession('faults', { ...faults, [s.id]: ev.target.value })}>
                  <option value="ok">Healthy</option>
                  <option value="bias">Reading high</option>
                  <option value="open">Open circuit</option>
                  <option value="short">Short to ground</option>
                </select>
              </label>
            ))}
            <label className={styles.fault}>
              <span>Fuel pump</span>
              <select value={faults.pump ?? 'ok'} aria-label="Fuel pump fault" onChange={(ev) => setSession('faults', { ...faults, pump: ev.target.value })}>
                <option value="ok">Healthy</option><option value="weak">Weak</option>
              </select>
            </label>
            <label className={styles.fault}>
              <span>Oil pump</span>
              <select value={faults.oil ?? 'ok'} aria-label="Oil pump fault" onChange={(ev) => setSession('faults', { ...faults, oil: ev.target.value })}>
                <option value="ok">Healthy</option><option value="low">Worn / low oil</option>
              </select>
            </label>
            <label className={styles.fault}>
              <span>Cooling fan</span>
              <select value={faults.fan ?? 'ok'} aria-label="Cooling fan fault" onChange={(ev) => setSession('faults', { ...faults, fan: ev.target.value })}>
                <option value="ok">Working</option><option value="failed">Failed</option>
              </select>
            </label>
          </div>
          <button type="button" className={styles.chip} onClick={() => setSession('faults', {})}>Clear all faults</button>
        </div>
      </details>

      <ExpandableInfo title="Reading an ECU log">
        A log is the only way to see a controller work: one channel against another, over time. Put boost next to its target and wastegate duty and an overshoot tells you whether the base duty or the integral gain is wrong. Put lambda next to accel enrichment and a stumble on tip-in reads as a lean spike the enrichment did not cover. Put knock retard next to RPM and false knock shows up as retard that tracks engine speed rather than load.
      </ExpandableInfo>
    </Panel>
  );
}
