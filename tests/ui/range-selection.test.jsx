// @vitest-environment jsdom

/**
 * Range selection, bulk ops and keyboard tuning on TUNE's grids (#105).
 *
 * Mounted through the real screens and store, because the property that matters most —
 * every bulk edit is exactly ONE undo step with a label saying what it did — lives in
 * the join between the dock, the reducer and the undo button.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { AirflowScreen } from '../../src/ui/screens/tune/AirflowScreen.jsx';
import { FuelScreen } from '../../src/ui/screens/tune/FuelScreen.jsx';
import { SparkScreen } from '../../src/ui/screens/tune/SparkScreen.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { StoreProvider, useHistory, useTune } from '../../src/ui/state/StoreProvider.jsx';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
const hadResizeObserver = 'ResizeObserver' in window;
if (!hadResizeObserver) window.ResizeObserver = ResizeObserverStub;
// jsdom 25 has no PointerEvent, and without one `pointerType`, `shiftKey` and `buttons`
// never reach React. MouseEvent carries the last two; this adds the first.
class PointerEventStub extends window.MouseEvent {
  constructor(type, init = {}) { super(type, init); this.pointerType = init.pointerType ?? ''; }
}
const hadPointerEvent = 'PointerEvent' in window;
if (!hadPointerEvent) /** @type {any} */ (window).PointerEvent = PointerEventStub;
afterAll(() => {
  if (!hadResizeObserver) delete window.ResizeObserver;
  if (!hadPointerEvent) delete /** @type {any} */ (window).PointerEvent;
});
afterEach(cleanup);

/** Exposes the store so tests can read tables and the undo stack. */
let store;
function Spy() {
  const [tune, dispatch] = useTune();
  const [history] = useHistory();
  store = { tune, dispatch, history };
  return null;
}

function mountAir() {
  return render(<StoreProvider><Spy /><AirflowScreen /></StoreProvider>);
}
const select = (value) => act(() => { store.dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value }); });
const dock = () => screen.getByTestId('selection-dock');
const undoLabel = () => store.history.past.at(-1)?.label;

describe('SelectionDock on a range', () => {
  it('titles the range by its axes and cell count', () => {
    mountAir();
    select({ type: 'range', r1: 3, c1: 2, r2: 1, c2: 5 });
    // LOAD = [200,150,100,70,40,20], RPM = [800,...,7500]
    expect(within(dock()).getByText('Range · 2500–5500 RPM × 70–150 kPa · 12 cells')).toBeTruthy();
  });

  it('adds to every cell in one undo step, with a label', () => {
    mountAir();
    const before = store.tune.ve.map((r) => [...r]);
    select({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 });
    fireEvent.click(within(dock()).getByRole('button', { name: '+5' }));
    expect(store.tune.ve[1][1]).toBe(Number((before[1][1] + 5).toFixed(2)));
    expect(store.tune.ve[2][2]).toBe(before[2][2]);
    expect(store.history.past).toHaveLength(1);
    expect(undoLabel()).toBe('VE edit · +5 · 4 cells');
  });

  it('scales by percent', () => {
    mountAir();
    const before = store.tune.ve.map((r) => [...r]);
    select({ type: 'row', row: 2 });
    fireEvent.click(within(dock()).getByRole('button', { name: 'SCALE' }));
    fireEvent.click(within(dock()).getByRole('button', { name: '+5%' }));
    expect(store.tune.ve[2][4]).toBe(Number(Math.min(before[2][4] * 1.05, 130).toFixed(2)));
    expect(undoLabel()).toBe('VE edit · scale +5% · 8 cells');
  });

  it('sets a typed value with Enter, and ignores an empty field', () => {
    mountAir();
    select({ type: 'range', r1: 0, c1: 0, r2: 0, c2: 2 });
    fireEvent.click(within(dock()).getByRole('button', { name: 'SET' }));
    const field = within(dock()).getByLabelText('Set value');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(store.history.past).toHaveLength(0);
    fireEvent.change(field, { target: { value: '77' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(store.tune.ve[0].slice(0, 3)).toEqual([77, 77, 77]);
    expect(undoLabel()).toBe('VE edit · set 77 · 3 cells');
  });

  it('interpolates and smooths, one undo step each', () => {
    mountAir();
    select({ type: 'range', r1: 0, c1: 0, r2: 2, c2: 3 });
    fireEvent.click(within(dock()).getByRole('button', { name: 'INTERPOLATE' }));
    fireEvent.click(within(dock()).getByRole('button', { name: 'SMOOTH' }));
    expect(store.history.past.map((e) => e.label)).toEqual([
      'VE edit · interpolate · 12 cells',
      'VE edit · smooth · 12 cells',
    ]);
  });

  it('hides INTERPOLATE and SMOOTH for a single cell', () => {
    mountAir();
    select({ type: 'cell', row: 1, col: 1 });
    expect(within(dock()).queryByRole('button', { name: 'SMOOTH' })).toBeNull();
    expect(within(dock()).queryByRole('button', { name: 'INTERPOLATE' })).toBeNull();
  });

  it('goes back to ADD after the dock closes', () => {
    mountAir();
    select({ type: 'row', row: 2 });
    fireEvent.click(within(dock()).getByRole('button', { name: 'SCALE' }));
    fireEvent.click(within(dock()).getByRole('button', { name: 'DONE' }));
    select({ type: 'row', row: 2 });
    expect(within(dock()).getByRole('button', { name: 'ADD' }).getAttribute('aria-pressed')).toBe('true');
  });
});

const cell = (rpm, kpa) => within(screen.getByTestId('tuning-grid')).getByRole('button', { name: `${rpm} RPM, ${kpa} kPa` });
const mouse = { pointerType: 'mouse', button: 0, buttons: 1 };

describe('selecting a range on the grid', () => {
  it('a mouse drag selects the rectangle it covers', () => {
    mountAir();
    fireEvent.pointerDown(cell(1500, 150), mouse);
    fireEvent.pointerEnter(cell(3500, 70), mouse);
    fireEvent.pointerUp(window, mouse);
    expect(store.tune.selection).toEqual({ type: 'range', r1: 1, c1: 1, r2: 3, c2: 3 });
    // the click that follows a mouse press must not collapse it back to one cell
    fireEvent.click(cell(3500, 70), { detail: 1 });
    expect(store.tune.selection.type).toBe('range');
  });

  it('moving after release does not keep dragging', () => {
    mountAir();
    fireEvent.pointerDown(cell(1500, 150), mouse);
    fireEvent.pointerUp(window, mouse);
    fireEvent.pointerEnter(cell(3500, 70), { pointerType: 'mouse', buttons: 0 });
    expect(store.tune.selection).toEqual({ type: 'cell', row: 1, col: 1 });
  });

  it('shift-click extends from the anchor', () => {
    mountAir();
    fireEvent.pointerDown(cell(2500, 100), mouse);
    fireEvent.pointerUp(window, mouse);
    fireEvent.pointerDown(cell(5500, 40), { ...mouse, shiftKey: true });
    fireEvent.pointerUp(window, mouse);
    expect(store.tune.selection).toEqual({ type: 'range', r1: 2, c1: 2, r2: 4, c2: 5 });
  });

  it('a touch press does not start a drag', () => {
    mountAir();
    fireEvent.pointerDown(cell(1500, 150), { pointerType: 'touch', buttons: 1 });
    fireEvent.pointerEnter(cell(3500, 70), { pointerType: 'touch', buttons: 1 });
    expect(store.tune.selection).toBeNull();
  });

  it('highlights every cell in the range', () => {
    mountAir();
    select({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(cell(1500, 150).getAttribute('aria-pressed')).toBe('true');
    expect(cell(2500, 150).getAttribute('aria-pressed')).toBe('false');
  });

  it('SELECT RANGE takes two taps, and a third starts over', () => {
    mountAir();
    fireEvent.click(screen.getByRole('button', { name: 'SELECT RANGE' }));
    fireEvent.click(cell(1500, 150));
    expect(store.tune.selection).toEqual({ type: 'range', r1: 1, c1: 1, r2: 1, c2: 1 });
    fireEvent.click(cell(3500, 70));
    expect(store.tune.selection).toEqual({ type: 'range', r1: 1, c1: 1, r2: 3, c2: 3 });
    fireEvent.click(cell(800, 20));
    expect(store.tune.selection).toEqual({ type: 'range', r1: 5, c1: 0, r2: 5, c2: 0 });
  });

  it('ALL selects the whole table, and switching mode clears', () => {
    mountAir();
    fireEvent.click(screen.getByRole('button', { name: 'ALL' }));
    expect(store.tune.selection).toEqual({ type: 'range', r1: 0, c1: 0, r2: 5, c2: 7 });
    fireEvent.click(screen.getByRole('button', { name: 'SELECT RANGE' }));
    expect(store.tune.selection).toBeNull();
  });

  it('range mode is one flag, shared across the grids', () => {
    const calAdvice = { spark: [], overAdvanced: [], underAdvanced: [], pastMbt: [], fuelAdv: [], wrongMix: [] };
    render(
      <StoreProvider>
        <Spy />
        <SparkScreen calAdvice={calAdvice} />
        <FuelScreen calAdvice={calAdvice} />
      </StoreProvider>,
    );
    const [sparkRange, fuelRange] = screen.getAllByRole('button', { name: 'SELECT RANGE' });
    fireEvent.click(sparkRange);
    expect(store.tune.rangeMode).toBe(true);
    expect(fuelRange.getAttribute('aria-pressed')).toBe('true');
  });
});

const grid = () => screen.getByTestId('tuning-grid');

describe('keyboard tuning', () => {
  it('arrows move a single cell, clamped to the table', () => {
    mountAir();
    select({ type: 'cell', row: 0, col: 0 });
    fireEvent.keyDown(grid(), { key: 'ArrowRight' });
    fireEvent.keyDown(grid(), { key: 'ArrowDown' });
    expect(store.tune.selection).toEqual({ type: 'cell', row: 1, col: 1 });
    select({ type: 'cell', row: 0, col: 0 });
    fireEvent.keyDown(grid(), { key: 'ArrowUp' });
    expect(store.tune.selection).toEqual({ type: 'cell', row: 0, col: 0 });
  });

  it('an arrow with nothing selected selects the first cell', () => {
    mountAir();
    fireEvent.keyDown(grid(), { key: 'ArrowDown' });
    expect(store.tune.selection).toEqual({ type: 'cell', row: 0, col: 0 });
  });

  it('shift+arrows grow and shrink a range from the anchor', () => {
    mountAir();
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true });
    expect(store.tune.selection).toEqual({ type: 'range', r1: 1, c1: 1, r2: 2, c2: 3 });
    fireEvent.keyDown(grid(), { key: 'ArrowLeft', shiftKey: true });
    expect(store.tune.selection).toEqual({ type: 'range', r1: 1, c1: 1, r2: 2, c2: 2 });
  });

  it('+ and - nudge the selection, Shift for the big step, one undo step each', () => {
    mountAir();
    const v0 = store.tune.ve[1][1];
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.keyDown(grid(), { key: '=', code: 'Equal' });
    fireEvent.keyDown(grid(), { key: '+', code: 'Equal', shiftKey: true });
    fireEvent.keyDown(grid(), { key: '-', code: 'NumpadSubtract' });
    expect(store.tune.ve[1][1]).toBe(Number((v0 + 1 + 5 - 1).toFixed(2)));
    expect(store.history.past.map((e) => e.label)).toEqual([
      'VE edit · +1 · 1 cell', 'VE edit · +5 · 1 cell', 'VE edit · -1 · 1 cell',
    ]);
  });

  it('falls back to the character when the key has no physical code', () => {
    // On-screen keyboards and remote-input tools can send `code: ''`. Found in the real
    // browser: without the fallback, + and - did nothing at all there.
    mountAir();
    const v0 = store.tune.ve[1][1];
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.keyDown(grid(), { key: '=', code: '' });
    fireEvent.keyDown(grid(), { key: '-', code: '' });
    fireEvent.keyDown(grid(), { key: '+', code: '' });
    expect(store.history.past.map((e) => e.label)).toEqual([
      'VE edit · +1 · 1 cell', 'VE edit · -1 · 1 cell', 'VE edit · +1 · 1 cell',
    ]);
    expect(store.tune.ve[1][1]).toBe(Number((v0 + 1).toFixed(2)));
  });

  it('Esc clears the selection', () => {
    mountAir();
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.keyDown(grid(), { key: 'Escape' });
    expect(store.tune.selection).toBeNull();
  });

  it('ignores Ctrl/Cmd combinations, so undo is left to the global handler', () => {
    mountAir();
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.keyDown(grid(), { key: '=', code: 'Equal', metaKey: true });
    fireEvent.keyDown(grid(), { key: 'ArrowRight', ctrlKey: true });
    expect(store.history.past).toHaveLength(0);
    expect(store.tune.selection).toEqual({ type: 'cell', row: 1, col: 1 });
  });

  it('the grid is focusable', () => {
    mountAir();
    expect(grid().getAttribute('tabindex')).toBe('0');
  });
});
