// @vitest-environment jsdom

/**
 * SANDBOX's first launch has no engine: the engine screens ask for one (prebuilt, or the
 * player's own specs) instead of showing a placeholder engine nobody chose.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import EcuLab from '../../src/ui/EcuLab.jsx';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
const hadResizeObserver = 'ResizeObserver' in window;
if (!hadResizeObserver) window.ResizeObserver = ResizeObserverStub;
afterAll(() => { if (!hadResizeObserver) delete window.ResizeObserver; });
afterEach(cleanup);
beforeEach(() => localStorage.clear());

const launchBlank = () => {
  window.location.hash = '';
  const view = render(<EcuLab blankStart />);
  fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
  return view;
};
const goTo = (name) => fireEvent.click(screen.getAllByRole('button', { name }).at(0));

describe('SANDBOX with no engine yet', () => {
  it('says so in the header and offers prebuilt engines and the spec form on every engine screen', () => {
    launchBlank();
    expect(screen.getByTestId('build-line').textContent).toMatch(/No engine chosen yet/);
    for (const tab of [/^TUNE/i, /^LIVE/i, /^DYNO/i, /^BUILD/i]) {
      goTo(tab);
      expect(screen.getByTestId('engine-start')).toBeTruthy();
      expect(screen.queryByTestId('tuning-grid')).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Use Nissan VQ35DE Rev-Up' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Describe your engine' })).toBeTruthy();
  });

  it('starts on a prebuilt engine in one click, with that engine named in the header', () => {
    launchBlank();
    goTo(/^BUILD/i);
    fireEvent.click(screen.getByRole('button', { name: 'Use Nissan VQ35HR' }));
    expect(screen.queryByTestId('engine-start')).toBeNull();
    expect(screen.getByTestId('build-line').textContent).toMatch(/^Nissan VQ35HR/);
  });

  it('refuses a spec with missing or out-of-range figures and says which', () => {
    launchBlank();
    goTo(/^BUILD/i);
    const form = within(screen.getByRole('form', { name: 'Describe your engine' }));
    fireEvent.click(form.getByRole('button', { name: 'CREATE THIS ENGINE' }));
    expect(form.getAllByRole('alert').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId('engine-start')).toBeTruthy();
    fireEvent.change(form.getByPlaceholderText('Cylinder diameter'), { target: { value: '400' } });
    fireEvent.click(form.getByRole('button', { name: 'CREATE THIS ENGINE' }));
    expect(form.getByText(/^Between 75 and 105 mm\. Outside this range/)).toBeTruthy();
  });

  it('builds an engine from the player\'s own figures, showing its displacement first', () => {
    launchBlank();
    goTo(/^BUILD/i);
    const form = within(screen.getByRole('form', { name: 'Describe your engine' }));
    fireEvent.click(form.getByRole('button', { name: /^V8/ }));
    fireEvent.change(form.getByPlaceholderText('Cylinder diameter'), { target: { value: '96' } });
    fireEvent.change(form.getByPlaceholderText('Piston travel'), { target: { value: '92' } });
    fireEvent.change(form.getByPlaceholderText('Static, e.g. 10.5'), { target: { value: '10.1' } });
    fireEvent.change(form.getByPlaceholderText('Rev limit'), { target: { value: '6500' } });
    expect(form.getByTestId('spec-displacement').textContent).toMatch(/5\.33 L/);
    fireEvent.click(form.getByRole('button', { name: 'CREATE THIS ENGINE' }));
    expect(screen.queryByTestId('engine-start')).toBeNull();
    expect(screen.getByTestId('build-line').textContent).toMatch(/^5\.3L V8/);
  });

  it('is undone by one UNDO from BUILD, back to no engine', () => {
    launchBlank();
    goTo(/^BUILD/i);
    fireEvent.click(screen.getByRole('button', { name: 'Use Nissan VQ35HR' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Undo Preset/ }).at(0));
    expect(screen.getByTestId('engine-start')).toBeTruthy();
  });
});

describe('everything else still starts ready', () => {
  it('a plain <EcuLab /> (tests, tutorial stores) has its default engine', () => {
    window.location.hash = '';
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    expect(screen.getByTestId('build-line').textContent).not.toMatch(/No engine chosen/);
  });
});

describe('figures the app assumed for the player\'s own engine', () => {
  it('lists them on BUILD until each is set, and drops each as the player sets it', () => {
    launchBlank();
    goTo(/^BUILD/i);
    const form = within(screen.getByRole('form', { name: 'Describe your engine' }));
    fireEvent.click(form.getByRole('button', { name: /^V6/ }));
    fireEvent.change(form.getByPlaceholderText('Cylinder diameter'), { target: { value: '95.5' } });
    fireEvent.change(form.getByPlaceholderText('Piston travel'), { target: { value: '81.4' } });
    fireEvent.change(form.getByPlaceholderText('Static, e.g. 10.5'), { target: { value: '10.3' } });
    fireEvent.change(form.getByPlaceholderText('Rev limit'), { target: { value: '7000' } });
    fireEvent.click(form.getByRole('button', { name: 'CREATE THIS ENGINE' }));
    const note = () => screen.queryByText(/Assumed, not entered/)?.parentElement?.textContent ?? '';
    expect(note()).toMatch(/intake cam duration 210°.*valvetrain DOHC.*4 valves per cylinder.*aluminum block.*aluminum head/i);
    fireEvent.change(screen.getAllByRole('slider').find((s) => s.getAttribute('min') === '180'), { target: { value: '222' } });
    expect(note()).not.toMatch(/cam duration/);
    expect(note()).toMatch(/valvetrain DOHC/);
  });
});

describe('a practice mission with no engine chosen yet', () => {
  const openCourse = () => act(() => { window.location.hash = '#/course'; window.dispatchEvent(new window.HashChangeEvent('hashchange')); });

  it('puts the engine the missions were written around on the bench, from SANDBOX', () => {
    launchBlank();
    openCourse();
    fireEvent.click(screen.getByRole('button', { name: 'Start practice: Find the knock limit' }));
    expect(screen.queryByTestId('engine-start')).toBeNull();
    expect(screen.getByTestId('build-line').textContent).toMatch(/^Nissan VQ35DE Rev-Up/);
    expect(within(screen.getByRole('region', { name: 'Practice mission' })).getByText('0/4')).toBeTruthy();
  });

  it('does the same when started from CAREER, whose SANDBOX car is the one with no engine', async () => {
    window.location.hash = '';
    render(<EcuLab blankStart />);
    fireEvent.click(screen.getByRole('button', { name: 'CAREER' }));
    await screen.findByText('Your tuning shop');
    openCourse();
    fireEvent.click(screen.getByRole('button', { name: 'Start practice: Your first pull' }));
    expect(screen.queryByTestId('engine-start')).toBeNull();
    expect(screen.getByTestId('build-line').textContent).toMatch(/^Nissan VQ35DE Rev-Up/);
  });
});

describe('the form refuses what the simulator cannot answer for, and says why', () => {
  it('a redline past 11,000 rpm', () => {
    launchBlank();
    goTo(/^BUILD/i);
    const form = within(screen.getByRole('form', { name: 'Describe your engine' }));
    fireEvent.change(form.getByPlaceholderText('Rev limit'), { target: { value: '11500' } });
    fireEvent.click(form.getByRole('button', { name: 'CREATE THIS ENGINE' }));
    expect(form.getByText(/Between 4000 and 11000 rpm\. Past 11,000 rpm is racing-engine territory/)).toBeTruthy();
  });
});
