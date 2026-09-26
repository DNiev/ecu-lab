// @vitest-environment jsdom

/**
 * The diff-vs-stock overlay on TUNE's grids (issue 106): the CHANGES view, and REVERT.
 *
 * Mounted through the real screens and store, like range-selection.test.jsx, because
 * what matters — the overlay compares against the calibration as LOADED, and REVERT
 * is one labelled undo step — lives in the join between the store and the components.
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
afterAll(() => { if (!hadResizeObserver) delete window.ResizeObserver; });
afterEach(cleanup);

let store;
function Spy() {
  const [tune, dispatch] = useTune();
  const [history] = useHistory();
  store = { tune, dispatch, history };
  return null;
}

const VE_ADVICE = { inSync: true, maxAbs: 0, recs: [], deltas: [] };
const mountAir = () => render(<StoreProvider><Spy /><AirflowScreen veAdvice={VE_ADVICE} veTruth={[[0]]} /></StoreProvider>);
const select = (value) => act(() => { store.dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value }); });
/** Writes a VE table straight through the store: one SET_TABLE, as any edit is. */
const writeVe = (fn) => act(() => {
  store.dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: store.tune.ve.map((row, ri) => row.map((v, ci) => fn(v, ri, ci))) });
});
// LOAD = [200,150,100,70,40,20], RPM = [800,1500,2500,3500,4500,5500,6500,7500]
const cell = (rpm, kpa) => within(screen.getByTestId('tuning-grid')).getByRole('button', { name: `${rpm} RPM, ${kpa} kPa` });
const changes = () => fireEvent.click(screen.getByRole('button', { name: 'CHANGES' }));

describe('the CHANGES view', () => {
  it('starts on VALUES, showing values', () => {
    mountAir();
    expect(screen.getByRole('button', { name: 'VALUES' }).getAttribute('aria-pressed')).toBe('true');
    expect(cell(1500, 150).textContent).toBe(String(Math.round(store.tune.ve[1][1])));
  });

  it('prints each cell’s signed change, and a dot where nothing moved', () => {
    mountAir();
    writeVe((v, ri, ci) => (ri === 1 && ci === 1 ? v - 5 : v));
    changes();
    expect(cell(1500, 150).textContent).toBe('-5');
    expect(cell(2500, 150).textContent).toBe('·');
    expect(screen.getByText(/Change since this calibration was loaded/)).toBeTruthy();
  });

  it('reads a change too small to print as ~0', () => {
    mountAir();
    writeVe((v, ri, ci) => (ri === 2 && ci === 2 ? Number((v + 0.3).toFixed(2)) : v));
    changes();
    expect(cell(2500, 100).textContent).toBe('~0');
  });

  it('is shared by the grids, and survives an undo', () => {
    const calAdvice = { spark: [], overAdvanced: [], underAdvanced: [], pastMbt: [], fuelAdv: [], wrongMix: [] };
    render(
      <StoreProvider>
        <Spy />
        <SparkScreen calAdvice={calAdvice} />
        <FuelScreen calAdvice={calAdvice} />
      </StoreProvider>,
    );
    const [sparkChanges, fuelChanges] = screen.getAllByRole('button', { name: 'CHANGES' });
    fireEvent.click(sparkChanges);
    expect(store.tune.diffView).toBe(true);
    expect(fuelChanges.getAttribute('aria-pressed')).toBe('true');
    expect(store.history.past).toHaveLength(0);
  });

  it('keeps the keys editing real values', () => {
    mountAir();
    const v0 = store.tune.ve[1][1];
    changes();
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.keyDown(screen.getByTestId('tuning-grid'), { key: '-', code: 'Minus' });
    expect(store.tune.ve[1][1]).toBe(Number((v0 - 1).toFixed(2)));
    expect(cell(1500, 150).textContent).toBe('-1');
  });

  it('keeps the dock editing real values', () => {
    mountAir();
    const v0 = store.tune.ve[1][1];
    changes();
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '-5' }));
    expect(store.tune.ve[1][1]).toBe(Number((v0 - 5).toFixed(2)));
    expect(cell(1500, 150).textContent).toBe('-5');
  });

  it('does not clear the selection when the view changes', () => {
    mountAir();
    select({ type: 'cell', row: 1, col: 1 });
    changes();
    expect(store.tune.selection).toEqual({ type: 'cell', row: 1, col: 1 });
  });
});

const dock = () => screen.getByTestId('selection-dock');
const revertButton = () => within(dock()).queryByRole('button', { name: 'REVERT' });

describe('REVERT and the changed count', () => {
  it('is hidden, and the title unchanged, when nothing differs', () => {
    mountAir();
    select({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(revertButton()).toBeNull();
    expect(within(dock()).getByText('Range · 800–1500 RPM × 150–200 kPa · 4 cells')).toBeTruthy();
  });

  it('titles a changed cell with what it was', () => {
    mountAir();
    const v0 = store.tune.ve[1][1];
    writeVe((v, ri, ci) => (ri === 1 && ci === 1 ? v - 5 : v));
    select({ type: 'cell', row: 1, col: 1 });
    expect(within(dock()).getByText(`1500 RPM · 150 kPa MAP · was ${Math.round(v0)}`)).toBeTruthy();
    expect(revertButton()).toBeTruthy();
  });

  it('counts the changed cells in a range', () => {
    mountAir();
    writeVe((v, ri, ci) => (ri === 0 && ci <= 1 ? v - 5 : v));
    select({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(within(dock()).getByText('Range · 800–1500 RPM × 150–200 kPa · 4 cells · 2 changed')).toBeTruthy();
  });

  it('puts the changed cells back in one undo step, counting only those', () => {
    mountAir();
    const before = store.tune.ve.map((r) => [...r]);
    writeVe((v, ri, ci) => (ri === 0 && ci <= 1 ? v - 5 : v));
    select({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 });
    fireEvent.click(revertButton());
    expect(store.tune.ve).toEqual(before);
    expect(store.history.past).toHaveLength(2);
    expect(store.history.past.at(-1).label).toBe('VE edit · revert · 2 cells');
    expect(revertButton()).toBeNull();
  });

  it('reverts a single cell', () => {
    mountAir();
    const v0 = store.tune.ve[1][1];
    writeVe((v, ri, ci) => (ri === 1 && ci === 1 ? v - 5 : v));
    select({ type: 'cell', row: 1, col: 1 });
    fireEvent.click(revertButton());
    expect(store.tune.ve[1][1]).toBe(v0);
    expect(store.history.past.at(-1).label).toBe('VE edit · revert · 1 cell');
  });
});
