// @vitest-environment jsdom

/**
 * CAREER in the app, end to end: the shop, a customer's car, the hand-back, the save,
 * and SANDBOX coming back exactly as it was left.
 *
 * `career.test.js` proves every job is solvable on the simulator and that the shop's
 * rules add up. This file proves the game wires them together: the car on the bay is
 * the customer's, the fix is made with the real controls, the grade lands in the shop,
 * and neither mode ever sees the other's car.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import EcuLab from '../../src/ui/EcuLab.jsx';
import { loadShop } from '../../src/storage.js';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const hadResizeObserver = 'ResizeObserver' in window;
if (!hadResizeObserver) window.ResizeObserver = ResizeObserverStub;
afterAll(() => {
  if (!hadResizeObserver) delete window.ResizeObserver;
});

afterEach(cleanup);

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
});

/** From the start screen into the shop, once the save has loaded. */
async function openShop() {
  fireEvent.click(screen.getByRole('button', { name: 'CAREER' }));
  await screen.findByText('Your tuning shop');
}

const tab = (name) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Shop' })).getByRole('button', { name: new RegExp(name) }));
const money = () => screen.getByTestId('shop-money').textContent;

describe('CAREER in the app', () => {
  it('runs the loop: take a car, fix it with the real controls, hand it back, get paid', async () => {
    render(<EcuLab />);
    await openShop();
    expect(money()).toContain('$1,000');

    // The customer says what the car does; taking it in puts it on the bay.
    tab('CUSTOMERS');
    fireEvent.click(screen.getByRole('button', { name: "Take Marcus's car" }));
    expect(screen.getByText(/ON THE BAY/)).toBeTruthy();

    // Into the game, on the customer's car: the career nav, the job ticket, no DRAG.
    fireEvent.click(screen.getByRole('button', { name: /WORK ON THE CAR/ }));
    expect(window.location.hash).toBe('#/tune/airflow');
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('button', { name: 'SHOP' })).toBeTruthy();
    expect(within(nav).queryByRole('button', { name: 'DRAG' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'HOME' })).toBeNull();
    expect(screen.getByText(/Marcus · 2006 Nissan 350Z/)).toBeTruthy();

    // A new shop has not trained for spark: the page is there, and locked.
    fireEvent.click(screen.getByRole('button', { name: /SPARK, locked/ }));
    expect(screen.getByText('Your shop has not learned this yet')).toBeTruthy();

    // The fix: the intake changed what the airflow sensor reads, so recalibrate it.
    fireEvent.click(screen.getByRole('button', { name: 'SENSORS' }));
    fireEvent.change(screen.getByLabelText('MAF scalar'), { target: { value: '1.11' } });

    // Hand it back from the ticket.
    fireEvent.click(screen.getByRole('button', { name: /JOB/ }));
    fireEvent.click(screen.getByRole('button', { name: 'HAND BACK THE CAR' }));
    expect(window.location.hash).toBe('#/shop');
    // Grading runs a full dyno pull on the real simulator; under a loaded test run that
    // can take longer than findByText's default second.
    await screen.findByText(/JOB DONE/, {}, { timeout: 10000 });
    expect(money()).not.toContain('$1,000');
    expect(screen.getByTestId('shop-rep').textContent).not.toMatch(/^REP0/);

    // Saved, with the car gone home.
    await waitFor(async () => {
      const saved = /** @type {any} */ (await loadShop());
      expect(saved?.history?.[0]?.verdict).toBe('pass');
      expect(saved.lifts).toEqual([]);
    }, { timeout: 10000 });
    // The hand-back grades the car with a full dyno pull on the real simulator, so this
    // test runs near five seconds alone and longer under a loaded suite.
  }, 30000);

  it('never lets one mode see the other’s car, and keeps both across the switch', async () => {
    render(<EcuLab />);
    // A SANDBOX car with something distinctive about it: a MAF scalar nobody else uses.
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));
    fireEvent.click(screen.getByRole('button', { name: 'SENSORS' }));
    fireEvent.change(screen.getByLabelText('MAF scalar'), { target: { value: '0.8' } });

    // To the shop by the main-menu button, and a customer's car onto the bay.
    fireEvent.click(screen.getByRole('button', { name: 'Main menu' }));
    await openShop();
    tab('CUSTOMERS');
    fireEvent.click(screen.getByRole('button', { name: "Take Marcus's car" }));
    fireEvent.click(screen.getByRole('button', { name: /WORK ON THE CAR/ }));
    fireEvent.click(screen.getByRole('button', { name: 'SENSORS' }));
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('MAF scalar')).value).toBe('1');
    fireEvent.change(screen.getByLabelText('MAF scalar'), { target: { value: '1.05' } });

    // Back to SANDBOX: its own car, exactly as it was.
    fireEvent.click(screen.getByRole('button', { name: 'Main menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));
    fireEvent.click(screen.getByRole('button', { name: 'SENSORS' }));
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('MAF scalar')).value).toBe('0.8');

    // And CAREER again: the customer's car still on its lift, half-done work and all.
    fireEvent.click(screen.getByRole('button', { name: 'Main menu' }));
    await openShop();
    fireEvent.click(screen.getByRole('button', { name: /WORK ON THE CAR/ }));
    fireEvent.click(screen.getByRole('button', { name: 'SENSORS' }));
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('MAF scalar')).value).toBe('1.05');
  });

  it('keeps the customer’s parts: BUILD is for looking, not changing', async () => {
    render(<EcuLab />);
    await openShop();
    tab('CUSTOMERS');
    fireEvent.click(screen.getByRole('button', { name: "Take Marcus's car" }));
    fireEvent.click(screen.getByRole('button', { name: /WORK ON THE CAR/ }));
    fireEvent.click(screen.getByRole('button', { name: 'BUILD' }));
    expect(screen.getByText(/The customer.s car\./)).toBeTruthy();
    const body = screen.getByText('Engine Architecture').closest('button').nextElementSibling;
    expect(body.querySelector('fieldset[disabled]')).not.toBeNull();
  });

  it('comes back after a reload: the shop is saved, the car on its lift with it', async () => {
    const first = render(<EcuLab />);
    await openShop();
    tab('CUSTOMERS');
    fireEvent.click(screen.getByRole('button', { name: "Take Marcus's car" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    first.unmount();

    window.location.hash = '#/shop';
    render(<EcuLab />);
    await screen.findByText('Your tuning shop');
    expect(screen.getByRole('button', { name: /WORK ON THE CAR/ })).toBeTruthy();
  });
});
