/**
 * The calibration grid's selection mode, shown above each table.
 *
 * Airflow and spark errors come in BANDS — a lean patch across high load, a
 * knock-limited corner — so the edit that answers one is a region, not a point. A mouse
 * already selects one by dragging or shift-clicking; a finger cannot, because a drag
 * across the grid scrolls it. SELECT RANGE is how touch gets there: two taps, two
 * corners. ALL is the whole table, which is what a global trim is.
 *
 * `rangeMode` is one flag on the TUNE slice, so it is the same on AIR, SPARK and FUEL.
 * Shared by those three screens, like `TuningGrid` beside it.
 *
 * VALUES / CHANGES picks what the grid draws: each cell's value, or its change since the
 * calibration was loaded (issue 106). `diffView` is shared the same way as `rangeMode`.
 */

import React from 'react';

import { LOAD, RPM } from '../../sim/index.js';
import { Button } from '../primitives/Button.jsx';
import { Seg } from '../primitives/Seg.jsx';
import { T } from '../theme.js';

/**
 * @param {object} props
 * @param {boolean} props.rangeMode
 * @param {(next: boolean) => void} props.setRangeMode
 * @param {(next: import('./selection.js').Selection|null) => void} props.setSelection
 * @param {boolean} props.diffView
 * @param {(next: boolean) => void} props.setDiffView
 * @returns {React.ReactElement}
 */
export function SelectModeBar({ rangeMode, setRangeMode, setSelection, diffView, setDiffView }) {
  return (
    <>
      {/* Wraps: at phone width the view toggle drops to its own line rather than
          pushing the row off the side of the screen. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center', marginBottom: 8 }}>
        {/* Changing mode clears the selection: a half-taken range means nothing in
            single-cell mode, and a single cell is not an anchor. */}
        <Seg
          label="Selection mode"
          value={rangeMode ? 'range' : 'cell'}
          onChange={(id) => { setRangeMode(id === 'range'); setSelection(null); }}
          options={[{ id: 'cell', label: 'SINGLE CELL' }, { id: 'range', label: 'SELECT RANGE' }]}
        />
        {/* Changing VIEW keeps the selection: it is the same cells, drawn differently. */}
        <Seg
          label="Table view"
          value={diffView ? 'changes' : 'values'}
          onChange={(id) => setDiffView(id === 'changes')}
          options={[{ id: 'values', label: 'VALUES' }, { id: 'changes', label: 'CHANGES' }]}
        />
        <div style={{ marginLeft: 'auto' }}>
          <Button
            variant="quiet" size="sm"
            onClick={() => setSelection({ type: 'range', r1: 0, c1: 0, r2: LOAD.length - 1, c2: RPM.length - 1 })}
          >ALL</Button>
        </div>
      </div>
      {diffView && (
        <div style={{ fontSize: 10.5, color: T.ink2, marginBottom: 6 }}>
          Change since this calibration was loaded · <span style={{ color: T.violet }}>violet up</span> · <span style={{ color: T.cyan }}>cyan down</span>
        </div>
      )}
    </>
  );
}
