/**
 * The ECU's map slots: four complete calibrations — base tables and engine management
 * alike — one of them running. Switch between them, copy the running one into another
 * slot, or swap two. The same thing UpRev calls map switching and HP Tuners calls
 * Switch on the Fly, and it switches while the engine runs: the LIVE engine picks up
 * the new calibration on its next step.
 */

import React from 'react';

import { ACTIONS } from '../../state/reducer.js';
import { useTune } from '../../state/StoreProvider.jsx';

import styles from './MapSlots.module.css';

/**
 * @param {object} props
 * @param {boolean} [props.compact] just the slot buttons, for LIVE
 * @returns {React.ReactElement}
 */
export function MapSlots({ compact = false }) {
  const [tune, dispatch] = useTune();
  const maps = tune.maps ?? [null, null, null, null];
  const active = tune.activeMap ?? 0;
  const [copyTo, setCopyTo] = React.useState('');
  const [swap, setSwap] = React.useState('');
  const others = maps.map((_, i) => i).filter((i) => i !== active);
  // Swapping with an empty slot would only copy the running map there, which is what
  // Copy is for; offer swaps with stored maps only.
  const stored = others.filter((i) => maps[i]);

  return (
    <div className={styles.wrap}>
      <div className={styles.row} role="group" aria-label="Map slot">
        <span className={styles.label}>MAP</span>
        {maps.map((m, i) => (
          <button
            key={i} type="button" className={styles.slot} aria-pressed={i === active}
            data-state={i === active ? 'running' : m ? 'stored' : 'empty'}
            aria-label={`Map ${i + 1}, ${i === active ? 'running' : m ? 'stored' : 'empty'}`}
            onClick={() => dispatch({ type: ACTIONS.SWITCH_MAP, index: i })}
          >
            {i + 1}
            {i !== active && m && <span className={styles.stored} aria-hidden="true" />}
          </button>
        ))}
      </div>
      {!compact && (
        <div className={styles.utils}>
          <select className={styles.select} value={copyTo} aria-label="Copy the running map to slot"
            onChange={(e) => { const to = Number(e.target.value); if (e.target.value !== '') dispatch({ type: ACTIONS.COPY_MAP, to }); setCopyTo(''); }}>
            <option value="">Copy map {active + 1} to…</option>
            {others.map((i) => <option key={i} value={i}>Map {i + 1}{maps[i] ? ' (replaces it)' : ''}</option>)}
          </select>
          {stored.length > 0 && (
            <select className={styles.select} value={swap} aria-label="Swap the running map with slot"
              onChange={(e) => { const b = Number(e.target.value); if (e.target.value !== '') dispatch({ type: ACTIONS.SWAP_MAPS, a: active, b }); setSwap(''); }}>
              <option value="">Swap map {active + 1} with…</option>
              {stored.map((i) => <option key={i} value={i}>Map {i + 1}</option>)}
            </select>
          )}
        </div>
      )}
      {!compact && (
        <p className={styles.caption}>
          Each map is a whole tune. Tap one to run it; an empty map starts as a copy of the one running. A dot marks a map with a tune stored in it.
        </p>
      )}
    </div>
  );
}
