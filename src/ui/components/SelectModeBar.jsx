/**
 * The calibration grid's selection mode, shown above each table.
 *
 * Real tuning software almost never edits one cell at a time. Airflow and spark errors
 * come in BANDS — a lean patch across the top of the load range, a knock-limited corner
 * at high RPM — so the edit that answers one is a region, not a point. SINGLE CELL is
 * the precise mode; SELECT RANGE takes two taps and moves everything between them; ALL
 * is the whole table, which is what a global VE trim actually is.
 *
 * Shared by TUNE's AIR, SPARK and FUEL screens, like `TuningGrid` and `SelectionDock`
 * it sits beside — see this folder's README for what that distinction means.
 */

import React from 'react';

import { LOAD, RPM } from '../../sim/index.js';
import { T } from '../theme.js';

/**
 * @param {object} props
 * @param {boolean} props.rangeMode whether a tap starts or extends a rectangle
 * @param {(next: boolean) => void} props.setRangeMode
 * @param {(next: import('./TuningGrid.jsx').Selection|null) => void} props.setSelection
 * @returns {React.ReactElement}
 */
export function SelectModeBar({ rangeMode, setRangeMode, setSelection }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 8 }}>
      {/* Changing mode clears the selection: a half-taken range means nothing in
          single-cell mode, and a single cell is not an anchor. */}
      {[[false, 'SINGLE CELL'], [true, 'SELECT RANGE']].map(([mode, label]) => (
        <button key={String(label)} onClick={() => { setRangeMode(Boolean(mode)); setSelection(null); }} style={{
          flex: 1, padding: '9px 0', borderRadius: 8, fontWeight: 800, fontSize: 11,
          border: `1px solid ${rangeMode === mode ? T.acc : T.line}`,
          background: rangeMode === mode ? T.accBg : T.panel2,
          color: rangeMode === mode ? T.accInk : T.ink2,
        }}>{label}</button>
      ))}
      <button
        onClick={() => setSelection({
          type: 'range', r1: 0, c1: 0, r2: LOAD.length - 1, c2: RPM.length - 1, complete: true,
        })}
        style={{
          padding: '9px 12px', borderRadius: 8, fontWeight: 800, fontSize: 11,
          border: `1px solid ${T.line}`, background: T.panel2, color: T.ink2,
        }}
      >ALL</button>
    </div>
  );
}
