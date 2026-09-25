/**
 * TUNE's engine management views that have no base table of their own — BOOST, VVT,
 * IDLE, PROTECT and TORQUE — each a live status strip over its settings.
 *
 * The status strip reads the running engine, so a tuner sees what the controller is
 * doing while they change how it does it. Nothing here computes anything: the values
 * come from the ECU's own state in the LIVE model.
 */

import React from 'react';

import { VVT_OPTS } from '../../../sim/index.js';
import { EcuSection } from '../../components/ecu/EcuSection.jsx';
import { Note } from '../../primitives/Note.jsx';
import { StatTile } from '../../primitives/StatTile.jsx';
import { useBuild, useSession } from '../../state/StoreProvider.jsx';

import styles from './EcuControlScreen.module.css';


/**
 * @param {object} props
 * @param {'boost'|'vvt'|'idle'|'protect'|'torque'} props.section
 * @param {string} props.title
 * @param {React.ElementType} props.icon
 * @param {Record<string, number>|null} props.liveVars
 * @returns {React.ReactElement}
 */
export function EcuControlScreen({ section, title, icon, liveVars }) {
  const [build] = useBuild();
  const [session] = useSession();
  const live = session.live;
  const e = live?.ecu;
  const row = e?.log?.[e.log.length - 1];
  const running = !!(live?.running && row);
  const vvt = VVT_OPTS.find((o) => o.id === (build.engineConfig?.vvt ?? 'none')) ?? VVT_OPTS[0];

  const tiles = {
    boost: running && build.turboOn ? [
      ['Boost', row.boost.toFixed(1), 'psi'], ['Target', row.boostTarget.toFixed(1), 'psi'],
      ['Wastegate', row.wgDuty.toFixed(0), '%'],
    ] : null,
    vvt: running && vvt.intake ? [
      ['Intake cam', row.camIn.toFixed(1), '°'], ['Target', row.camInTarget.toFixed(1), '°'],
      ['Exhaust cam', row.camEx.toFixed(1), '°'],
    ] : null,
    idle: running ? [
      ['Engine', String(row.rpm), 'rpm'], ['Target', String(row.idleTarget), 'rpm'],
      ['Idle air', row.idleAir.toFixed(1), '%'],
    ] : null,
    protect: running ? [
      ['Active', e.protect.length ? e.protect.join(', ') : 'none', ''],
      ['Limp', e.limp ?? 'no', ''],
    ] : null,
    torque: running ? [
      ['Crank torque', String(row.torque), 'Nm'], ['Spark', row.timing.toFixed(1), '°'],
    ] : null,
  }[section];

  return (
    <div className={styles.wrap}>
      {tiles && (
        <div className={styles.tiles} aria-label="Live">
          {tiles.map(([label, value, unit]) => (
            <StatTile key={label} label={label} value={value} unit={unit} />
          ))}
        </div>
      )}
      {section === 'boost' && !build.turboOn && (
        <div className={styles.note}><Note>No turbo fitted — these settings take effect once one is, on BUILD → INDUCTION.</Note></div>
      )}
      {section === 'vvt' && !vvt.intake && (
        <div className={styles.note}><Note>This engine has fixed cams. Fit cam phasers on BUILD → ENGINE and the targets below start moving the valve events.</Note></div>
      )}
      <EcuSection section={section} title={title} icon={icon} liveVars={liveVars} />
    </div>
  );
}
