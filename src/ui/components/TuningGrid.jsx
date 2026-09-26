/**
 * The RPM x MAP calibration grid: one cell per (load, RPM) pair, coloured by a
 * heat scale, building a `Selection` for `SelectionDock` to edit.
 *
 * A cell selects on click. A mouse also drags out a range or shift-clicks one from the
 * anchor; a finger cannot drag (that scrolls the grid), so in SELECT RANGE mode
 * (`SelectModeBar`) two taps make the two corners. Row and column headers select the
 * whole row or column.
 *
 * Focused, it also takes the keyboard: arrows move, Shift+arrows grow a range from the
 * anchor, `+`/`-` nudge the selection (Shift for the coarse step), Esc clears.
 *
 * In the CHANGES view (`SelectModeBar`) each cell shows its change from `baseline` —
 * the calibration as it was loaded — tinted violet up and cyan down. Only the drawing
 * changes: selection, keys and the dock still work on the real values.
 *
 * Shared by TUNE's AIR, SPARK and FUEL screens — the ECU screen uses neither this
 * nor `SelectionDock`, which is why both live here rather than beside any one
 * screen. See this folder's README for what that distinction means.
 *
 * Relocated from EcuLab.jsx by the screen split — still inline styles, same as this
 * folder's other shared components.
 */

import React from 'react';

import { LOAD, RPM, addRect, diffTable } from '../../sim/index.js';
import { T, diffTint, heat, shadowAlpha } from '../theme.js';

import { anchorOf, formatDelta, inRect, opLabel, rectOf, signed, spanSelection, stepsFor } from './selection.js';

/** @typedef {import('./selection.js').Selection} Selection */

/** Arrow key -> [row step, column step]. */
const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
/**
 * Physical key -> nudge direction. By `code` first: `+` already needs Shift on most
 * layouts, so `key` could not tell "+" from "coarse +".
 */
const NUDGE = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1 };
/**
 * ...and by character when there is no physical key to go on. On-screen keyboards and
 * remote-input tools can send an empty `code`; without this, + and - did nothing at all
 * there. Shift still means coarse, so a Shift+= that arrives as "+" is the coarse step.
 */
const NUDGE_BY_KEY = { '=': 1, '+': 1, '-': -1, _: -1 };
const clampR = (r) => Math.min(Math.max(r, 0), LOAD.length - 1);
const clampC = (c) => Math.min(Math.max(c, 0), RPM.length - 1);

/**
 * @param {object} props
 * @param {number[][]} props.data rows of values, indexed [row][col] against LOAD/RPM
 * @param {number} props.min lower bound of the heat scale
 * @param {number} props.max upper bound of the heat scale
 * @param {number} props.decimals how many decimal places to render each cell at
 * @param {Selection|null} props.selection the current selection, or none
 * @param {(next: Selection|null) => void} props.setSelection
 * @param {boolean} [props.rangeMode] whether a tap starts or completes a range (the
 *   touch path) rather than selecting one cell
 * @param {(next: number[][], label: string) => void} [props.setData] one table write,
 *   one undo step — what `+`/`-` call. Without it the keys only move the selection.
 * @param {number[][]} [props.baseline] the table as loaded; without it there is no
 *   CHANGES view to draw
 * @param {boolean} [props.diffView] draw each cell's change from `baseline`
 * @param {number} [props.diffScale] the change at which the tint stops brightening
 * @returns {React.ReactElement}
 */
export function TuningGrid({ data, min, max, decimals, selection, setSelection, rangeMode = false, setData, baseline, diffView = false, diffScale = 1 }) {
  const fmt = (v) => (decimals ? v.toFixed(decimals) : Math.round(v));
  // 96 subtractions, on renders that already walk every cell — not memoised.
  const diff = diffView && baseline ? diffTable(data, baseline) : null;
  const rect = selection ? rectOf(selection) : null;
  const anchor = selection ? anchorOf(selection) : null;
  // The anchor of a mouse drag in progress, or null. A ref, not state: it changes on
  // every press and release and nothing renders from it.
  const dragFrom = React.useRef(/** @type {{r: number, c: number}|null} */ (null));
  // Which kind of pointer pressed last. A mouse press has already selected by the time
  // its click arrives, so that click must not select again — it would collapse a drag
  // back to one cell. A keyboard click carries `detail === 0` and always goes through.
  const lastPointer = React.useRef('');

  // A drag ends wherever the button comes up, which need not be over the grid.
  React.useEffect(() => {
    const end = () => { dragFrom.current = null; };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  /**
   * A tap or plain press on a cell. In SELECT RANGE mode the first tap is a one-cell
   * range (the anchor) and the second completes it; any tap after that starts over.
   * @param {number} ri
   * @param {number} ci
   * @returns {{r: number, c: number}} the anchor the new selection extends from
   */
  const tap = (ri, ci) => {
    const here = { r: ri, c: ci };
    if (rangeMode && selection?.type === 'range' && selection.r1 === selection.r2 && selection.c1 === selection.c2) {
      const from = { r: selection.r1, c: selection.c1 };
      setSelection(spanSelection(from, here, true));
      return from;
    }
    setSelection(rangeMode ? spanSelection(here, here, true) : { type: 'cell', row: ri, col: ci });
    return here;
  };

  const onCellPointerDown = (e, ri, ci) => {
    lastPointer.current = e.pointerType;
    // Touch and pen keep scrolling the grid; they select on click, below.
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.shiftKey && anchor) {
      setSelection(spanSelection(anchor, { r: ri, c: ci }, rangeMode));
      dragFrom.current = anchor;
      return;
    }
    dragFrom.current = tap(ri, ci);
  };
  const onCellPointerEnter = (e, ri, ci) => {
    // `buttons` as well as the ref: a release outside the window never reaches the
    // listener above, and without this the next hover would still be dragging.
    if (!dragFrom.current || !(e.buttons & 1)) return;
    setSelection(spanSelection(dragFrom.current, { r: ri, c: ci }, rangeMode));
  };
  const onCellClick = (e, ri, ci) => {
    if (e.detail > 0 && lastPointer.current === 'mouse') return;
    tap(ri, ci);
  };
  const selectRow = (row) => setSelection({ type: 'row', row });
  const selectCol = (col) => setSelection({ type: 'col', col });
  const isSelected = (ri, ci) => Boolean(rect && inRect(rect, ri, ci));
  // Only a range marks its anchor: it is the corner a shift-click extends from, so it
  // has to be findable. A lone cell is its own anchor and needs no second mark.
  const isAnchor = (ri, ci) => selection?.type === 'range' && anchor.r === ri && anchor.c === ci;

  const onKeyDown = (e) => {
    // Ctrl/Cmd/Alt belong to EcuLab's global undo handler and to the browser.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (selection) { e.preventDefault(); setSelection(null); }
      return;
    }
    const move = ARROWS[e.key];
    if (move) {
      e.preventDefault();
      if (!selection) { setSelection({ type: 'cell', row: 0, col: 0 }); return; }
      if (e.shiftKey) {
        // The corner that moves is whichever one is not the anchor.
        const far = selection.type === 'range'
          ? { r: selection.r2, c: selection.c2 }
          : { r: rect.r1 === anchor.r ? rect.r2 : rect.r1, c: rect.c1 === anchor.c ? rect.c2 : rect.c1 };
        setSelection(spanSelection(anchor, { r: clampR(far.r + move[0]), c: clampC(far.c + move[1]) }));
      } else {
        setSelection({ type: 'cell', row: clampR(anchor.r + move[0]), col: clampC(anchor.c + move[1]) });
      }
      return;
    }
    const sign = NUDGE[e.code] ?? NUDGE_BY_KEY[e.key];
    if (sign && selection && setData) {
      e.preventDefault();
      const { small, big } = stepsFor(decimals);
      const delta = sign * (e.shiftKey ? big : small);
      setData(addRect(data, rect, delta, { min, max }), opLabel(signed(delta), rect));
    }
  };

  return (
    <div
      data-testid="tuning-grid"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Calibration table: arrows move, Shift+arrows select a range, plus and minus adjust"
    >
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: T.ink3, fontWeight: 700, letterSpacing: 0.8, marginBottom: 4 }}>
      <span>MAP kPa &darr;</span><span>RPM &rarr;</span>
    </div>
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: `1px solid ${T.line}`, borderRadius: 10 }}>
      <div style={{ display: 'inline-block', minWidth: '100%' }}>
        <div style={{ display: 'flex' }}>
          <div style={{ width: 44, flexShrink: 0, background: T.panel }} />
          {RPM.map((r, ci) => (
            <button key={r} onClick={() => selectCol(ci)} style={{
              width: 51, height: 30, flexShrink: 0, border: 'none', borderBottom: `1px solid ${T.line}`, borderLeft: `1px solid ${T.line}`,
              background: selection?.type === 'col' && selection.col === ci ? T.acc : T.panel,
              color: selection?.type === 'col' && selection.col === ci ? T.accOn : T.ink2,
              fontFamily: T.mono, fontSize: 10, fontWeight: 700,
            }}>{r}</button>
          ))}
        </div>
        {LOAD.map((load, ri) => (
          <div key={load} style={{ display: 'flex' }}>
            <button onClick={() => selectRow(ri)} style={{
              width: 44, height: 37, flexShrink: 0, border: 'none', borderRight: `1px solid ${T.line}`, borderTop: `1px solid ${T.line}`,
              background: selection?.type === 'row' && selection.row === ri ? T.acc : T.panel,
              color: selection?.type === 'row' && selection.row === ri ? T.accOn : T.ink2,
              fontFamily: T.mono, fontSize: 10, fontWeight: 700,
            }}>{load}</button>
            {data[ri].map((val, ci) => (
              <button
                key={ci}
                aria-label={`${RPM[ci]} RPM, ${load} kPa`}
                aria-pressed={isSelected(ri, ci)}
                onPointerDown={(e) => onCellPointerDown(e, ri, ci)}
                onPointerEnter={(e) => onCellPointerEnter(e, ri, ci)}
                onClick={(e) => onCellClick(e, ri, ci)}
                style={{
                  width: 51, height: 37, flexShrink: 0,
                  border: isAnchor(ri, ci) ? `2px solid ${T.acc}` : isSelected(ri, ci) ? `2px solid ${T.ink}` : `1px solid ${shadowAlpha(0.35)}`,
                  background: !diff ? heat(val, min, max) : diff[ri][ci] === 0 ? T.panel2 : diffTint(diff[ri][ci], diffScale),
                  color: diff && diff[ri][ci] === 0 ? T.ink3 : T.ink,
                  fontFamily: T.mono, fontSize: 12, fontWeight: 700,
                  // A mouse drag across cells must not start a text selection.
                  userSelect: 'none',
                }}
              >{diff ? formatDelta(diff[ri][ci], decimals) : fmt(val)}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}
