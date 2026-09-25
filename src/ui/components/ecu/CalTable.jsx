/**
 * The calibration table editor: one table, with its own axes, edited the way a tuner
 * edits a table in professional software.
 *
 * Select a cell, drag a rectangle, or take a whole row or column from its header; then
 * step, scale, set, interpolate, smooth, copy and paste. Axis breakpoints can be moved.
 * Compare shows every cell's difference from the factory table. When the engine is
 * running the cells it is reading right now are outlined, weighted by how much of each
 * the interpolation takes.
 *
 * Every committed change is one `onChange`, which the store records as one undo step.
 * Nothing here decides what a value means — that is the ECU's job, in `src/sim/ecu`.
 */

import React from 'react';

import { axisPosition } from '../../../sim/index.js';
import { deltaHeat, heat } from '../../theme.js';

import styles from './CalTable.module.css';
import {
  blockToText, copyBlock, inRect, interpolate, mapCells, norm, pasteBlock, rowsOf,
  sameTable, setBreakpoint, smooth, textToBlock,
} from './tableOps.js';

/** One clipboard shared by every table on the page, so a block copies across tables. */
let clip = /** @type {number[][]|null} */ (null);

/**
 * @param {object} props
 * @param {import('./tableOps.js').Table} props.table
 * @param {import('./tableOps.js').Table} [props.def] the factory table, for reset and compare
 * @param {import('../../../sim/ecu/calibration.js').EcuFieldMeta} props.meta
 * @param {(next: import('./tableOps.js').Table) => void} props.onChange
 * @param {{x?: number, y?: number}|null} [props.marker] the operating point, when live
 * @returns {React.ReactElement}
 */
export function CalTable({ table, def, meta, onChange, marker }) {
  const twoD = Array.isArray(table.y);
  const rows = rowsOf(table);
  const nRows = rows.length;
  const nCols = rows[0].length;
  const [sel, setSel] = React.useState(/** @type {import('./tableOps.js').Rect|null} */ (null));
  const [compare, setCompare] = React.useState(false);
  const [editAxes, setEditAxes] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [pct, setPct] = React.useState('');
  const dragging = React.useRef(false);
  const lim = { min: meta.min, max: meta.max, decimals: meta.decimals ?? 0 };
  const step = meta.step ?? 1;
  const dec = meta.decimals ?? 0;
  const fmt = (v) => (v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(dec));

  // Maps display tables with the highest load on top, the way the base tables read.
  const order = twoD ? [...Array(nRows).keys()].reverse() : [0];
  const defRows = def ? rowsOf(def) : null;
  const sameShape = defRows && defRows.length === nRows && defRows[0].length === nCols;
  const lo = meta.min ?? Math.min(...rows.flat());
  const hi = meta.max ?? Math.max(...rows.flat());

  // Which cells the ECU is reading, and how much of each.
  const mx = marker?.x;
  const my = marker?.y;
  const weights = React.useMemo(() => {
    if (mx == null) return null;
    const px = axisPosition(table.x, mx);
    const py = twoD && my != null ? axisPosition(table.y, my) : { i: 0, f: 0 };
    const w = new Map();
    const put = (r, c, v) => { if (v > 0.02 && r < nRows && c < nCols) w.set(`${r}:${c}`, v); };
    put(py.i, px.i, (1 - px.f) * (1 - py.f));
    put(py.i, px.i + 1, px.f * (1 - py.f));
    if (twoD) {
      put(py.i + 1, px.i, (1 - px.f) * py.f);
      put(py.i + 1, px.i + 1, px.f * py.f);
    }
    return w;
  }, [mx, my, table, twoD, nRows, nCols]);

  const commit = (next) => { if (!sameTable(next, table)) onChange(next); };
  const all = { r1: 0, c1: 0, r2: nRows - 1, c2: nCols - 1 };
  const target = sel ?? null;

  const onCellDown = (r, c, e) => {
    if (e.shiftKey && sel) setSel({ ...sel, r2: r, c2: c });
    else setSel({ r1: r, c1: c, r2: r, c2: c });
    dragging.current = true;
  };
  const onCellEnter = (r, c) => { if (dragging.current && sel) setSel({ ...sel, r2: r, c2: c }); };
  React.useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const setAxis = (axis, i, raw) => {
    const next = setBreakpoint(table, axis, i, Number(raw));
    if (next) commit(next);
  };

  const doCopy = () => {
    if (!target) return;
    clip = copyBlock(table, target);
    try { window.navigator.clipboard?.writeText(blockToText(clip)); } catch { /* clipboard is optional */ }
  };
  const doPaste = async () => {
    if (!target) return;
    let block = clip;
    try {
      const text = await window.navigator.clipboard?.readText?.();
      const parsed = text ? textToBlock(text) : null;
      if (parsed) block = parsed;
    } catch { /* fall back to the in-app clipboard */ }
    if (block) commit(pasteBlock(table, target, block, lim));
  };
  const resetSel = () => {
    if (!target || !sameShape) return;
    commit(mapCells(table, target, (v, r, c) => defRows[r][c], lim));
  };

  const selInfo = target ? (() => {
    const n = norm(target);
    const cells = (n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1);
    let s = 0;
    for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) s += rows[r][c];
    return { cells, mean: s / cells };
  })() : null;

  const modified = def && !sameTable(table, def);

  return (
    <div className={styles.wrap} data-testid={`cal-${meta.path}`}>
      <div className={styles.bar}>
        <span className={styles.unit}>{meta.unit}</span>
        {modified && <span className={styles.badge}>modified</span>}
        <span className={styles.flex} />
        <button type="button" className={styles.chip} aria-pressed={compare} onClick={() => setCompare(!compare)} disabled={!sameShape}>Compare</button>
        <button type="button" className={styles.chip} aria-pressed={editAxes} onClick={() => setEditAxes(!editAxes)}>Axes</button>
        <button type="button" className={styles.chip} onClick={() => setSel(all)}>All</button>
      </div>

      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.corner}>{twoD ? `${meta.yLabel ?? ''} ↓ ${meta.xLabel ?? ''} →` : (meta.xLabel ?? '')}</th>
              {table.x.map((xv, c) => (
                <th key={c} className={styles.axis} aria-selected={!!target && inRect(target, norm(target).r1, c) && norm(target).r1 === 0 && norm(target).r2 === nRows - 1}>
                  {editAxes
                    ? <input className={styles.axisInput} defaultValue={xv} aria-label={`${meta.xLabel ?? 'x'} breakpoint ${c + 1}`}
                      onBlur={(e) => setAxis('x', c, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') /** @type {HTMLInputElement} */ (e.target).blur(); }} />
                    : <button type="button" className={styles.axisBtn} onClick={() => setSel({ r1: 0, r2: nRows - 1, c1: c, c2: c })}>{xv}</button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((r) => (
              <tr key={r}>
                <th className={styles.axis}>
                  {!twoD ? <span className={styles.axisBtn}>{meta.unit}</span>
                    : editAxes
                      ? <input className={styles.axisInput} defaultValue={table.y[r]} aria-label={`${meta.yLabel ?? 'y'} breakpoint ${r + 1}`}
                        onBlur={(e) => setAxis('y', r, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') /** @type {HTMLInputElement} */ (e.target).blur(); }} />
                      : <button type="button" className={styles.axisBtn} onClick={() => setSel({ r1: r, r2: r, c1: 0, c2: nCols - 1 })}>{table.y[r]}</button>}
                </th>
                {rows[r].map((v, c) => {
                  const selected = !!target && inRect(target, r, c);
                  const w = weights?.get(`${r}:${c}`) ?? 0;
                  const delta = sameShape ? v - defRows[r][c] : 0;
                  const bg = compare ? deltaHeat(delta, Math.max(step * 8, Math.abs(hi - lo) * 0.15)) : heat(v, lo, hi);
                  return (
                    <td key={c} className={styles.cellWrap}>
                      <button
                        type="button"
                        className={styles.cell}
                        data-selected={selected || undefined}
                        data-live={w > 0 || undefined}
                        style={/** @type {React.CSSProperties} */ (/** @type {any} */ ({ background: bg, '--live': w.toFixed(2) }))}
                        aria-label={`${meta.label} at ${meta.xLabel ?? 'x'} ${table.x[c]}${twoD ? `, ${meta.yLabel ?? 'y'} ${table.y[r]}` : ''}: ${fmt(v)} ${meta.unit ?? ''}`}
                        onPointerDown={(e) => onCellDown(r, c, e)}
                        onPointerEnter={() => onCellEnter(r, c)}
                      >
                        {compare ? (delta === 0 ? '·' : `${delta > 0 ? '+' : ''}${fmt(delta)}`) : fmt(v)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!twoD && <CurvePlot table={table} def={sameShape ? def : null} lo={lo} hi={hi} marker={marker?.x} />}

      {target && (
        <div className={styles.tools} role="toolbar" aria-label={`Edit ${meta.label}`}>
          <span className={styles.selInfo}>{selInfo.cells} cell{selInfo.cells > 1 ? 's' : ''} · mean {fmt(selInfo.mean)}</span>
          <button type="button" className={styles.tool} onClick={() => commit(mapCells(table, target, (v) => v - step, lim))} aria-label="Decrease">−{step}</button>
          <button type="button" className={styles.tool} onClick={() => commit(mapCells(table, target, (v) => v + step, lim))} aria-label="Increase">+{step}</button>
          <span className={styles.field}>
            <input className={styles.num} inputMode="decimal" placeholder="set" value={value} aria-label="Set selected cells to"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && value !== '' && Number.isFinite(Number(value))) { commit(mapCells(table, target, () => Number(value), lim)); setValue(''); } }} />
          </span>
          <span className={styles.field}>
            <input className={styles.num} inputMode="decimal" placeholder="±%" value={pct} aria-label="Scale selected cells by percent"
              onChange={(e) => setPct(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pct !== '' && Number.isFinite(Number(pct))) { commit(mapCells(table, target, (v) => v * (1 + Number(pct) / 100), lim)); setPct(''); } }} />
          </span>
          <button type="button" className={styles.tool} onClick={() => commit(interpolate(table, target, lim))}>Interpolate</button>
          <button type="button" className={styles.tool} onClick={() => commit(smooth(table, target, lim))}>Smooth</button>
          <button type="button" className={styles.tool} onClick={doCopy}>Copy</button>
          <button type="button" className={styles.tool} onClick={doPaste}>Paste</button>
          {sameShape && <button type="button" className={styles.tool} onClick={resetSel}>Factory</button>}
          <button type="button" className={styles.tool} onClick={() => setSel(null)} aria-label="Clear selection">✕</button>
        </div>
      )}
    </div>
  );
}

/**
 * The shape of a curve at a glance — what a single row of numbers hides.
 * @param {object} props
 * @param {{x: number[], z: any}} props.table
 * @param {{x: number[], z: any}|null} props.def
 * @param {number} props.lo
 * @param {number} props.hi
 * @param {number} [props.marker]
 */
function CurvePlot({ table, def, lo, hi, marker }) {
  const W = 300, H = 64, pad = 4;
  const x0 = table.x[0], x1 = table.x[table.x.length - 1];
  const span = hi - lo || 1;
  const px = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const py = (v) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const path = (t) => t.x.map((x, i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(t.z[i]).toFixed(1)}`).join(' ');
  return (
    <svg className={styles.plot} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {def && <path d={path(def)} className={styles.plotDef} />}
      <path d={path(table)} className={styles.plotLine} />
      {marker != null && marker >= x0 && marker <= x1 && <line x1={px(marker)} x2={px(marker)} y1={0} y2={H} className={styles.plotMarker} />}
    </svg>
  );
}
