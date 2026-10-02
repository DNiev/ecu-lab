/**
 * Under a hardware choice on BUILD: whether the ECU is set up for the part just chosen,
 * and a one-tap way to make it so.
 *
 * Changing a part is often two jobs — the part on BUILD and the ECU's setting for it on
 * TUNE — and forgetting the second one is a mistake several lessons are built around.
 * Showing the state right where the part is chosen turns a silent fault into a visible
 * one, without doing the second job behind the player's back.
 */

import { AlertTriangle, Check } from 'lucide-react';
import React from 'react';

import { ecuHardwareOf, setupMismatches } from '../../../sim/index.js';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild, useTune } from '../../state/StoreProvider.jsx';

import styles from './SetupNote.module.css';

/**
 * @param {object} props
 * @param {string[]} props.paths the calibration settings this hardware choice depends on
 * @param {string} [props.okText] what to say when they all agree; nothing is shown
 *   when omitted
 * @param {string|null} [props.hardwareWarning] a problem with the part itself that no
 *   ECU setting can fix
 * @returns {React.ReactElement|null}
 */
export function SetupNote({ paths, okText, hardwareWarning = null }) {
  const [build] = useBuild();
  const [tune, dispatch] = useTune();
  const misses = setupMismatches(ecuHardwareOf(build), tune.ecu).filter((m) => paths.includes(m.path));

  if (misses.length) {
    return (
      <>
        {misses.map((m) => (
          <div key={m.path + m.text} className={styles.warn} role="status">
            <AlertTriangle size={13} aria-hidden="true" className={styles.icon} />
            <span className={styles.text}>{m.text}</span>
            {m.fix && (
              <button type="button" className={styles.fix}
                onClick={() => dispatch({ type: ACTIONS.SET_ECU, path: m.path, value: m.fix.value })}>
                {m.fix.label}
              </button>
            )}
          </div>
        ))}
      </>
    );
  }
  if (hardwareWarning) {
    return (
      <div className={styles.warn} role="status">
        <AlertTriangle size={13} aria-hidden="true" className={styles.icon} />
        <span className={styles.text}>{hardwareWarning}</span>
      </div>
    );
  }
  if (!okText) return null;
  return (
    <div className={styles.ok}>
      <Check size={13} aria-hidden="true" className={styles.icon} />
      <span className={styles.text}>{okText}</span>
    </div>
  );
}
