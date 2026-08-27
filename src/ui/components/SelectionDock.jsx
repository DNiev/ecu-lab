/**
 * The sticky editor for whatever `TuningGrid` selection is active: a cell, a row
 * or a column. Shows the current value, a reference blurb for a single selected
 * cell, and +/- steppers plus a slider to change it.
 *
 * Shared by TUNE's AIR, SPARK and FUEL screens — see `TuningGrid.jsx` and this
 * folder's README for why this lives here rather than beside any one screen.
 *
 * Relocated from EcuLab.jsx by the screen split, markup unchanged — still inline
 * styles, same as this folder's other shared components.
 */

import React from 'react';

import { LOAD, RPM, clamp, clone2D } from '../../sim/index.js';
import { Button } from '../primitives/Button.jsx';
import { Panel } from '../primitives/Panel.jsx';
import { T, shadowAlpha } from '../theme.js';

/** @typedef {import('./TuningGrid.jsx').Selection} Selection */

// Reference data for a selected cell. Deliberately DESCRIPTIVE, not predictive:
// it tells you what this parameter does and what range is normal here, but never
// simulates an outcome — only a real dyno pull produces results in this sandbox.
/**
 * @param {'ve'|'timing'|'afr'} kind
 * @param {number} row
 * @param {number} col
 * @param {number} value
 * @returns {{what: string, typical: string, affects: string, note: string|null}}
 */
function cellReference(kind, row, col, value) {
  const rpm = RPM[col], map = LOAD[row];
  const boosted = map > 105, wot = map >= 95, cruise = map <= 70;
  const highRpm = rpm >= 5500, lowRpm = rpm <= 2500;
  if (kind === 've') {
    const typical = boosted ? '95-110%' : wot ? (highRpm ? '80-95%' : lowRpm ? '60-75%' : '90-100%') : (cruise ? '55-80%' : '75-90%');
    return {
      what: 'Cylinder filling efficiency at this manifold pressure — how completely the cylinder fills relative to the pressure available.',
      typical: `Typical here: ${typical}.`,
      affects: 'Feeds the air-mass calculation (airCharge = VE x V_cyl x MAP/RT). Raising it raises fuel demand and pulse width at this point.',
      note: boosted ? 'Above ~105 kPa you are in boost — these rows only get used once a turbo is fitted.' : null,
    };
  }
  if (kind === 'timing') {
    const typical = boosted ? '14-24°' : wot ? (lowRpm ? '12-20°' : highRpm ? '28-38°' : '22-32°') : '32-45°';
    return {
      what: 'Spark advance before top dead center, aiming to land peak cylinder pressure ~16° after TDC.',
      typical: `Typical here: ${typical}. Low manifold pressure tolerates far more advance; boost tolerates much less.`,
      affects: 'Torque rises toward MBT then flattens. Beyond the knock limit the ECU pulls it back during the pull.',
      note: boosted && value > 28 ? 'Aggressive for a boosted cell — cylinder pressure is already high here.' : null,
    };
  }
  const typical = boosted ? '11.5-12.3:1' : wot ? '12.5-13.2:1' : cruise ? '14.7:1 (stoich, closed loop)' : '13.5-14.5:1';
  return {
    what: 'Commanded air:fuel ratio, gasoline-equivalent. Divide by 14.7 for lambda.',
    typical: `Typical here: ${typical}.`,
    affects: 'Sets fuel mass, and therefore pulse width and duty cycle. Richer cools combustion and resists knock; leaner raises EGT and knock risk.',
    note: boosted && value > 12.8 ? 'Lean for a boosted cell — this is where lean mixtures burn pistons.' : cruise && value < 14 ? 'Richer than needed for cruise — wastes fuel with no power gain at this load.' : null,
  };
}

/**
 * @param {object} props
 * @param {number[][]} props.data rows of values, indexed [row][col] against LOAD/RPM
 * @param {(next: number[][]) => void} props.setData
 * @param {Selection|null} props.selection
 * @param {number} props.min
 * @param {number} props.max
 * @param {number} props.decimals
 * @param {string} props.unit
 * @param {() => void} props.onClose
 * @param {'ve'|'timing'|'afr'} props.kind
 * @param {boolean} [props.rangeMode] whether the grid is taking rectangles rather than
 *   single cells. The dock only needs it to explain a half-taken range; every EDIT below
 *   is written against `cellsIn()` and so works the same for one cell or a hundred.
 * @returns {React.ReactElement|null}
 */
export function SelectionDock({ data, setData, selection, min, max, decimals, unit, onClose, kind, rangeMode }) {
  if (!selection) return null;
  // Resolve whatever shape the selection has to the list of cells it covers, so every
  // operation below is written once and works identically for one cell or a hundred.
  const cellsIn = () => {
    const out = [];
    if (selection.type === 'cell') out.push([selection.row, selection.col]);
    else if (selection.type === 'row') data[selection.row].forEach((_, c) => out.push([selection.row, c]));
    else if (selection.type === 'col') data.forEach((_, r) => out.push([r, selection.col]));
    else if (selection.type === 'range') {
      const [ra, rb] = [Math.min(selection.r1, selection.r2), Math.max(selection.r1, selection.r2)];
      const [ca, cb] = [Math.min(selection.c1, selection.c2), Math.max(selection.c1, selection.c2)];
      for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) out.push([r, c]);
    }
    return out;
  };
  const cells = cellsIn();
  const current = cells.reduce((sum, [r, c]) => sum + data[r][c], 0) / Math.max(cells.length, 1);

  /** Adds a fixed amount to every selected cell. */
  const apply = (delta) => {
    const next = clone2D(data);
    cells.forEach(([r, c]) => { next[r][c] = Number(clamp(next[r][c] + delta, min, max).toFixed(2)); });
    setData(next);
  };
  /**
   * Scales every selected cell by a percentage. This is the operation a tuner uses most
   * on a VE table, because airflow error is proportional rather than absolute — a
   * histogram correction is a percentage, so the edit that answers it should be too.
   */
  const scale = (pct) => {
    const next = clone2D(data);
    cells.forEach(([r, c]) => { next[r][c] = Number(clamp(next[r][c] * (1 + pct / 100), min, max).toFixed(2)); });
    setData(next);
  };
  const setAbs = (v) => {
    const next = clone2D(data);
    cells.forEach(([r, c]) => { next[r][c] = clamp(v, min, max); });
    setData(next);
  };
  /**
   * Pulls the selection halfway toward its own average. A histogram correction is applied
   * cell by cell from data that had different sample counts in each, so it can leave
   * spikes behind; smoothing them out is the same tool real scanners provide.
   */
  const smooth = () => {
    const next = clone2D(data);
    const avg = cells.reduce((sum, [r, c]) => sum + data[r][c], 0) / Math.max(cells.length, 1);
    cells.forEach(([r, c]) => { next[r][c] = Number(clamp(data[r][c] * 0.5 + avg * 0.5, min, max).toFixed(2)); });
    setData(next);
  };
  const smallStep = decimals ? 0.1 : 1;
  const bigStep = decimals ? 1 : 5;
  let sel = 'Cell';
  if (selection.type === 'row') sel = `Row · ${LOAD[selection.row]} kPa MAP`;
  else if (selection.type === 'col') sel = `Column · ${RPM[selection.col]} RPM`;
  else if (selection.type === 'range') {
    const [ra, rb] = [Math.min(selection.r1, selection.r2), Math.max(selection.r1, selection.r2)];
    const [ca, cb] = [Math.min(selection.c1, selection.c2), Math.max(selection.c1, selection.c2)];
    sel = selection.complete
      ? `${cells.length} cells · ${RPM[ca]}-${RPM[cb]} RPM · ${LOAD[rb]}-${LOAD[ra]} kPa`
      : 'Tap a second cell to complete the range';
  } else sel = `${RPM[selection.col]} RPM · ${LOAD[selection.row]} kPa MAP`;

  return (
    <div data-testid="selection-dock" style={{ position: 'sticky', bottom: 0, background: T.panel, borderTop: `1px solid ${T.line}`, padding: '11px 14px 13px', boxShadow: `0 -8px 20px ${shadowAlpha(0.45)}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1, color: T.ink2, textTransform: 'uppercase', fontWeight: 700 }}>{sel}</div>
          <div style={{ fontFamily: T.mono, fontSize: 23, fontWeight: 800, color: T.ink }}>
            {decimals ? current.toFixed(decimals) : Math.round(current)}<span style={{ fontSize: 12, color: T.ink2, marginLeft: 4 }}>{unit}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>DONE</Button>
      </div>
      {selection.type === 'cell' && kind && (() => {
        const ref = cellReference(kind, selection.row, selection.col, current);
        return (
          <Panel tight style={{ marginBottom: 9, fontSize: 11.5, lineHeight: 1.55, color: T.ink2 }}>
            <div style={{ fontSize: 9.5, letterSpacing: 1, color: T.cyan, fontWeight: 800, marginBottom: 5 }}>REFERENCE · {RPM[selection.col]} RPM / {LOAD[selection.row]} kPa</div>
            <div>{ref.what}</div>
            <div style={{ marginTop: 4, color: T.ink }}>{ref.typical}</div>
            <div style={{ marginTop: 4 }}><b style={{ color: T.inkSoft }}>Affects: </b>{ref.affects}</div>
            {ref.note && <div style={{ marginTop: 4, color: T.warn }}>{ref.note}</div>}
          </Panel>
        );
      })()}
      <input type="range" min={min} max={max} step={smallStep} value={current} onChange={(e) => setAbs(Number(e.target.value))} style={{ width: '100%', accentColor: T.acc }} />
      <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
        {/* One colour for all four: the +/- is already in the label. Painting the
            positive steps with the status green said "raising this cell is good", which
            is not something a stepper can know — and spending the status scale on a sign
            is what teaches a player to ignore it where it means something. */}
        {[-bigStep, -smallStep, smallStep, bigStep].map((d, i) => (
          <button key={i} onClick={() => apply(d)} style={{
            flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel2,
            color: T.accInk, fontWeight: 800, fontFamily: T.mono, fontSize: 13,
          }}>{d > 0 ? '+' : ''}{d}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 7, marginTop: 7 }}>
        {[-5, -2, 2, 5].map((pct) => (
          <button key={pct} onClick={() => scale(pct)} style={{
            flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel,
            color: pct < 0 ? T.accInk : T.cyan, fontWeight: 800, fontFamily: T.mono, fontSize: 12,
          }}>{pct > 0 ? '+' : ''}{pct}%</button>
        ))}
        <button onClick={smooth} style={{
          flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel,
          color: T.violet, fontWeight: 800, fontSize: 11,
        }}>SMOOTH</button>
      </div>
      {rangeMode && selection.type === 'range' && !selection.complete && (
        <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 7 }}>
          Anchor set. Tap the opposite corner to select everything between.
        </div>
      )}
    </div>
  );
}
