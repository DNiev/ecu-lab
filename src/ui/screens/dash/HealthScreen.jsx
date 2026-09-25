/**
 * HOME > Engine Health.
 *
 * How much life is left in the three things this simulation can destroy, and the one
 * warning that belongs beside them.
 *
 * `overallHealth` and `needsMafRecal` are the shell's, not this screen's: the header
 * bar draws the same overall figure, and the TUNE > SENSORS screen raises the same MAF
 * warning. One definition each, passed in.
 */

import { Wrench } from 'lucide-react';
import React from 'react';

import { Bar } from '../../primitives/Bar.jsx';
import { BuildSection } from '../../components/BuildSection.jsx';
import { Note } from '../../primitives/Note.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { useSession } from '../../state/StoreProvider.jsx';

import styles from './HealthScreen.module.css';

/**
 * @param {object} props
 * @param {boolean} props.active whether this is HOME's open section
 * @param {(section: string) => void} props.onToggle opens or closes a HOME section
 * @param {number} props.overallHealth the worst of the three components, percent
 * @param {boolean} props.needsMafRecal the intake or turbo plumbing has moved the
 *   MAF reading away from what the ECU is calibrated for
 * @returns {React.ReactElement}
 */
export function HealthScreen({ active, onToggle, overallHealth, needsMafRecal }) {
  const [session] = useSession();
  const { health } = session;

  return (
    <BuildSection
      active={active} onClick={() => onToggle('health')}
      icon={Wrench} label="Engine Health"
      sub={`${Math.round(overallHealth)}% overall`}
    >
      <Panel>
        <div className={styles.bars}>
          <Bar label="PISTON / RINGS · knock, pressure, mixture" value={health.piston} />
          <Bar label="BEARINGS · sustained cylinder pressure" value={health.bearing} />
          <Bar label="VALVES · lean-under-boost heat" value={health.valve} />
        </div>
      </Panel>
      {needsMafRecal && <Note tone="warn">Your intake and/or turbo plumbing changed the MAF reading — head to <b>FUEL</b> to rescale it before your next pull.</Note>}
    </BuildSection>
  );
}
