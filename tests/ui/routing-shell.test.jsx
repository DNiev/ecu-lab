// @vitest-environment jsdom

/**
 * The shell's half of routing: what the URL and the rendered screen do to each other.
 *
 * `routing.test.js` covers `parseRoute`/`formatRoute` as pure functions, and
 * `characterisation.test.jsx` covers what the app renders when you click things. The
 * gap between them is everything this file tests, and it is a real gap: the
 * characterisation tests navigate by clicking real controls and never once look at
 * `window.location`, so the entire URL half of this feature could be missing — or
 * wired backwards — and all eight of them would still pass.
 *
 * Four behaviours live only here:
 *   - a deep link works on a COLD load, with no navigation to react to;
 *   - a click writes the URL, not just React state;
 *   - the browser back button walks back through the app;
 *   - "every accordion closed" is a state the URL can hold and restore.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import EcuLab from '../../src/ui/EcuLab.jsx';
import { ROUTES } from '../../src/ui/routing.js';

// Same stub, and the same reason, as characterisation.test.jsx: recharts'
// <ResponsiveContainer> on the DYNO panel needs a ResizeObserver to mount at all.
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

// tests/setup.js already clears the hash before every test; restating it here keeps
// this file honest about the precondition every one of these assertions depends on.
beforeEach(() => {
  window.location.hash = '';
});

/** Renders the app at whatever the current hash says. @returns {void} */
function mount() {
  render(<EcuLab />);
}

/** Renders the app and clicks past the start screen (which lands on BUILD). */
function launch() {
  mount();
  // The start screen offers CAREER, SANDBOX and TUTORIAL rather than a single START.
  // SANDBOX is the free-play entry the old button was.
  fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
}

/**
 * A BuildSection renders its label inside its header button and its body in the
 * button's next sibling, collapsed with `max-height: 0` rather than unmounted. That
 * inline height is therefore the only DOM-visible difference between an open section
 * and a closed one.
 * @param {string} label e.g. 'Engine Architecture'
 * @returns {boolean}
 */
function sectionIsOpen(label) {
  const header = screen.getByText(label).closest('button');
  const body = /** @type {HTMLElement} */ (header.nextElementSibling);
  // Compare the parsed number, not the string. React writes a non-zero maxHeight as
  // "3000px" but leaves zero as bare "0" — CSS allows a unitless zero — so a string
  // comparison against "0px" reports every collapsed section as open, and this whole
  // describe block fails against a working app.
  return Number.parseFloat(body.style.maxHeight) > 0;
}

const BUILD_SECTION_LABELS = ['Engine Architecture', 'Induction', 'Fuel System', 'Exhaust'];

describe('a deep link on a cold load', () => {
  it('renders the linked screen without anyone clicking first', () => {
    // The failure this guards is a hook that only subscribes to `hashchange`: it is
    // correct for every navigation and wrong for the one case that has no navigation
    // to hear about — someone opening the link in a fresh tab. That reads as "deep
    // links were never implemented" rather than as a bug, which is why no amount of
    // clicking-based testing finds it.
    window.location.hash = '#/tune/spark';
    mount();

    expect(screen.queryByRole('button', { name: 'SANDBOX' })).toBeNull();
    expect(screen.getByText('Ignition Timing')).toBeTruthy();
  });

  it('lands on the tab when the section is stale, rather than on nothing', () => {
    // #83 re-sections these tabs, so links to today's section names will outlive
    // them. parseRoute drops the unknown section and keeps the tab; this pins that
    // the SHELL then renders that tab rather than a blank frame.
    window.location.hash = '#/build/supercharger';
    mount();

    expect(screen.getByText('Garage')).toBeTruthy();
  });
});

describe('clicking a tab', () => {
  it('writes the URL, not just React state', () => {
    launch();
    expect(window.location.hash).toBe('#/build/engine');

    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));
    expect(window.location.hash).toBe('#/tune/airflow');

    // Sub-tab strips are part of the address too, one level down.
    fireEvent.click(screen.getByRole('button', { name: 'SPARK' }));
    expect(window.location.hash).toBe('#/tune/spark');
    expect(screen.getByText('Ignition Timing')).toBeTruthy();
  });

  it('opens each tab on its first section, the way the old per-tab defaults did', () => {
    // The six useState calls this replaced defaulted to 'live'/'engine'/'ve'/'result'.
    // Those are the heads of the ROUTES lists, and `goTab` reads them from there — so
    // this asserts the defaults did not quietly change hands during the conversion.
    launch();
    for (const [tab, label] of [['dash', 'HOME'], ['build', 'BUILD'], ['tune', 'TUNE'], ['dyno', 'DYNO']]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(window.location.hash).toBe(`#/${tab}/${ROUTES[tab][0]}`);
    }
  });

  it('routes every TUNE sub-tab to the screen with a matching id, not just a highlighted button', () => {
    // TUNE_VIEWS (the switcher's own id list, in EcuLab.jsx) and the `tuneView === '…'`
    // mount conditions right below it are two separate hand-written lists with nothing
    // that forces them to agree. Get one id wrong and the switcher still lights up —
    // `on = tuneView === v.id` reads the same id it navigates to — while the section
    // below the switcher silently renders nothing, because no mount condition matches
    // the URL. characterisation.test.jsx's TUNE marker only proves a switcher button
    // exists, not that a view rendered, because the switcher itself is part of the TUNE
    // tab body: it would still be there even if every mount condition were wrong. This
    // is the test that actually looks below the switcher for each of the five ids.
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));
    const views = {
      AIRFLOW: 'Volumetric Efficiency',
      SPARK: 'Ignition Timing',
      FUEL: 'Air-Fuel Ratio Target',
      INJECTORS: 'Injectors',
      SENSORS: 'Fuel Control & MAF Scaling',
    };
    for (const [tabLabel, ownEyebrow] of Object.entries(views)) {
      fireEvent.click(screen.getByRole('button', { name: tabLabel }));
      expect(screen.getByText(ownEyebrow)).toBeTruthy();
    }
  });
});

describe('the back button', () => {
  it('returns to the previous screen', async () => {
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));
    expect(screen.getByText('Volumetric Efficiency')).toBeTruthy();

    window.history.back();

    // jsdom dispatches hashchange from a queued task rather than synchronously, so
    // the assertion has to wait for it — as it would in a browser.
    await waitFor(() => expect(window.location.hash).toBe('#/build/engine'));
    await waitFor(() => expect(screen.getByText('Garage')).toBeTruthy());
  });

  it('does not have to step through dead entries for clicks that went nowhere', async () => {
    // Re-clicking the tab you are already on must not push history. If it does, the
    // app still looks right — every screen renders correctly — but the back button
    // needs four presses to do one thing, which reads to a user as a broken control.
    // Push one known start-screen entry first, so "one press back" has a fixed
    // destination regardless of what the previous test in this file left on the stack.
    window.location.hash = '#/';
    launch();
    const active = () => screen.getByRole('button', { name: 'BUILD' });
    fireEvent.click(active());
    fireEvent.click(active());
    fireEvent.click(active());
    expect(window.location.hash).toBe('#/build/engine');

    // One press, from the app back to the start screen it was launched from.
    window.history.back();
    await waitFor(() => expect(screen.getByRole('button', { name: 'SANDBOX' })).toBeTruthy());
  });
});

describe('a fully collapsed accordion', () => {
  it('is a state the URL can hold, and a cold load restores it', () => {
    // BuildSection's onClick is a TOGGLE: clicking the open section's own header
    // closes it and leaves NOTHING open. That is `section: null`, and `#/build` with
    // no second segment is how the route spells it.
    //
    // If a missing segment fell back to a default section instead, closing would be
    // impossible — and not one existing test would notice, because none of them close
    // an accordion and then look. The cold-load half below is the part that bites: a
    // component that merely remembers `null` in React state would pass the first half
    // and fail the second.
    launch();
    expect(sectionIsOpen('Engine Architecture')).toBe(true);

    fireEvent.click(screen.getByText('Engine Architecture'));
    expect(window.location.hash).toBe('#/build');
    for (const label of BUILD_SECTION_LABELS) expect(sectionIsOpen(label)).toBe(false);

    // Round trip: throw the component away and rebuild it from that URL alone.
    cleanup();
    expect(window.location.hash).toBe('#/build');
    mount();

    expect(screen.getByText('Garage')).toBeTruthy();
    for (const label of BUILD_SECTION_LABELS) expect(sectionIsOpen(label)).toBe(false);
  });

  it('is reachable on HOME too, and reopening a section puts it back in the URL', () => {
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'HOME' }));
    // HOME's first section is the job board: the live engine is its own tab now.
    expect(window.location.hash).toBe('#/dash/jobs');
    expect(sectionIsOpen('Customer Cars')).toBe(true);

    fireEvent.click(screen.getByText('Customer Cars'));
    expect(window.location.hash).toBe('#/dash');
    expect(sectionIsOpen('Customer Cars')).toBe(false);

    // Opening a DIFFERENT section is not a toggle-to-null — it swaps which one is open.
    fireEvent.click(screen.getByText('Engine Health'));
    expect(window.location.hash).toBe('#/dash/health');
    expect(sectionIsOpen('Engine Health')).toBe(true);
    expect(sectionIsOpen('Customer Cars')).toBe(false);
  });
});

describe('the tutorial', () => {
  it('has its own address, and leaving it lands back on BUILD', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'TUTORIAL' }));
    expect(window.location.hash).toBe('#/tutorial');

    fireEvent.click(screen.getByRole('button', { name: 'SKIP' }));
    expect(window.location.hash).toBe('#/build/engine');
  });
});
