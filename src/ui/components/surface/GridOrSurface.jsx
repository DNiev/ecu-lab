/**
 * The RPM × MAP grids (VE, spark, AFR) with a Table / 3-D switch above them. The grid is
 * stored with the highest load first (sim/tables.js LOAD); the surface wants both axes
 * ascending, so the rows are turned over here and nowhere else.
 */

import React from 'react';

import { GAME_LAYOUT } from '../../../sim/index.js';

import { LOAD_UNIT_LABEL } from '../TuningGrid.jsx';
import styles from './surface.module.css';
import { TableSurface, ViewToggle, useTableView } from './TableSurface.jsx';

/** Which pull field places a point on each kind of load axis. */
const Y_VAR = { kPa: 'map', 'g/cyl': 'airG', 'mg/cyl': 'airMg' };

/**
 * @param {object} props
 * @param {number[][]} props.data rows against the load axis (highest first), columns against RPM
 * @param {import('../../../sim/layouts.js').TableAxes} [props.axes] the ECU Lab grid's unless
 *   the tune sits on an engine computer's own breakpoints
 * @param {number} props.min
 * @param {number} props.max
 * @param {number} props.decimals
 * @param {string} props.unit
 * @param {string} props.title
 * @param {{label: string, read: (p: object) => number}} [props.commanded]
 * @param {React.ReactNode} props.children the grid
 */
export function GridOrSurface({ data, min, max, decimals, unit, title, commanded, children, axes = GAME_LAYOUT.ve }) {
  const [view, setView] = useTableView();
  const z = React.useMemo(() => [...data].reverse(), [data]);
  const loadUp = React.useMemo(() => [...axes.load].reverse(), [axes]);
  return (
    <div className={styles.wrap}>
      <div className={styles.switchRow}><ViewToggle mode={view} onChange={setView} /></div>
      {view === '3d'
        ? <TableSurface x={axes.rpm} y={loadUp} z={z} lo={min} hi={max} xLabel="RPM" yLabel={LOAD_UNIT_LABEL[axes.loadUnit]} unit={unit} decimals={decimals}
          title={title} xVar="rpm" yVar={Y_VAR[axes.loadUnit]} commanded={commanded} />
        : children}
    </div>
  );
}
