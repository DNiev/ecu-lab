// @vitest-environment jsdom

/**
 * Characterisation tests: what the app DOES today, pinned before its state moves.
 *
 * PR 2 is a pure refactor — 34 pieces of state leave EcuLab.jsx for a store, and by
 * definition nothing observable should change. The problem is that a refactor with no
 * behavioural tests is unverifiable: a setter wired to the wrong slice still compiles,
 * still typechecks, still builds, and still passes 408 tests about physics and buttons.
 *
 * These do not describe what the app SHOULD do. They describe what it does now, so the
 * refactor has something to preserve. If one of these fails after the extraction, the
 * extraction is wrong — do not edit the test to match the new behaviour.
 *
 * FIRST CHANGE SINCE WRITING (the UI re-sectioning PR, task 6): the file had stayed
 * byte-identical through seven merged PRs until this one, which renamed TUNE's four
 * sub-views to five (AIR -> AIRFLOW, plus the new INJECTORS/SENSORS split) and moved
 * the octane explainer onto a BUILD accordion. Only queries moved to keep pointing at
 * the same real behaviour — the AIR button is now found by its new AIRFLOW label, and
 * the header build line is now found by `getByTestId('build-line')` instead of
 * `getByText(/oct/)`, because that regex started also matching the (permanently
 * mounted) octane explainer prose once it existed. No assertion changed: every
 * expectation here checks exactly what it checked before.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import EcuLab, { DYNO_PULL_MS } from '../../src/ui/EcuLab.jsx';

// jsdom has no ResizeObserver. recharts' <ResponsiveContainer> (used on the DYNO
// results panel) needs one to mount at all, so without this stub any test that
// reaches a rendered result panel throws an uncaught ReferenceError from inside
// react-dom's commit phase. observe/unobserve/disconnect are no-ops: the tests
// below never depend on a resize callback firing, only on the chart mounting.
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

/** Renders the app and clicks past the start screen into the build tab. */
function launch() {
  const view = render(<EcuLab />);
  fireEvent.click(screen.getByRole('button', { name: 'START' }));
  return view;
}

/**
 * The preset picker is the only select with optgroups.
 * @returns {HTMLSelectElement | undefined}
 */
function presetPicker() {
  return /** @type {HTMLSelectElement[]} */ (screen.getAllByRole('combobox'))
    .find((el) => el.querySelector('optgroup'));
}

describe('entry', () => {
  it('opens on the start screen', () => {
    render(<EcuLab />);
    expect(screen.getByRole('button', { name: 'START' })).toBeTruthy();
  });

  it('enters the app on START and lands on BUILD', () => {
    launch();
    expect(screen.getByRole('button', { name: /BUILD/ })).toBeTruthy();
  });

  it('opens the tutorial and comes back', () => {
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'TUTORIAL' }));
    expect(screen.getByText(/TUTORIAL · 1\//)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'SKIP' }));
    expect(screen.getByRole('button', { name: /BUILD/ })).toBeTruthy();
  });
});

describe('navigation', () => {
  it('moves between the four tabs', () => {
    launch();
    // The bottom-nav buttons (HOME/BUILD/TUNE/DYNO) are rendered unconditionally —
    // only their active styling changes — so re-querying for the clicked button by
    // name proves nothing about whether the click actually switched tabs; it would
    // pass even if the tab body never moved. Assert on a marker that only exists
    // while that tab's body is mounted instead.
    const marker = {
      TUNE: () => screen.getByRole('button', { name: 'AIRFLOW' }), // TUNE_VIEWS sub-tab
      DYNO: () => screen.getByRole('button', { name: 'RUN DYNO PULL' }),
      HOME: () => screen.getByText('Live Engine'),
      BUILD: () => screen.getByText('Garage'),
    };
    for (const tab of ['TUNE', 'DYNO', 'HOME', 'BUILD']) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      expect(marker[tab]()).toBeTruthy();
    }
  });
});

describe('the header reflects the build', () => {
  it('names the current engine and fuel', () => {
    launch();
    // The header line is `${engineName} · ${turbo} · ${octane} oct · ${injector} · ${version}`.
    // Pin that it renders at all and carries an octane figure; the exact preset name is
    // not the point. Query by testid, not text: BUILD's accordion sections stay
    // mounted when collapsed, so a `getByText(/oct/)` also matches the Fuel System
    // section's octane explainer prose once that section exists in the DOM.
    //
    // Assert on the CONTENT, not just that the element exists. The retired
    // `getByText(/oct/)` implicitly pinned that the line carries an octane figure —
    // a bare `getByTestId(...)` would still pass with the octane segment deleted
    // entirely, which is a weaker test than the one it replaced. Scoping to the
    // element AND matching the figure is stronger than either.
    expect(screen.getByTestId('build-line').textContent).toMatch(/\S+ oct\b/);
  });
});

describe('loading a preset', () => {
  it('rewrites the header to name that preset', () => {
    // Exercises applyEnginePreset's 23 writes across all three slices in one go.
    launch();
    const picker = presetPicker();
    expect(picker).toBeTruthy();
    const target = [...picker.querySelectorAll('option')]
      .map((o) => o.value)
      .find((v) => v && v !== picker.value);
    fireEvent.change(picker, { target: { value: target } });
    // With a preset loaded the header shows its NAME, not the "3.0L I6" fallback.
    expect(screen.getByTestId('build-line').textContent).not.toMatch(/^\d\.\dL /);
  });
});

describe('editing a calibration table', () => {
  it('stops the header claiming the factory preset', () => {
    // The single most important behaviour in this PR: withTableEdit crosses the
    // build/tune boundary, clearing presetId (build) and setting tablesDirty (tune).
    // If the extraction drops that link, the header goes on claiming a factory
    // calibration the player has just edited away from.
    launch();
    const picker = presetPicker();
    const target = [...picker.querySelectorAll('option')]
      .map((o) => o.value)
      .find((v) => v && v !== picker.value);
    fireEvent.change(picker, { target: { value: target } });

    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    // Scope to the tuning grid itself: unscoped queries also match the BUILD tab's
    // boost-curve editor, so if tab navigation broke and the app never left BUILD,
    // an unscoped query would still find cells there and the test would pass for
    // the wrong reason. Querying inside the grid means this can only pass by
    // actually landing on TUNE and editing a real calibration table cell.
    const grid = within(screen.getByTestId('tuning-grid'));
    // Any grid cell; the first numeric-labelled button inside the grid will do.
    const cells = grid.getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent));
    fireEvent.click(cells[Math.floor(cells.length / 2)]);
    // Selecting a grid cell mounts the SelectionDock (the sticky editor at the
    // bottom of the tuning tab). The BUILD tab's boost-curve editor has its own
    // unrelated '+1' button, so scope to the dock rather than querying the whole
    // document — otherwise a broken tab switch that left the boost editor visible
    // could satisfy this query too.
    const dock = within(screen.getByTestId('selection-dock'));
    fireEvent.click(dock.getByRole('button', { name: '+1' }));

    // Header falls back to the derived "3.0L I6" form once the preset is invalidated.
    expect(screen.getByTestId('build-line').textContent).toMatch(/^\d\.\dL /);
  });
});

describe('running a dyno pull', () => {
  it('produces a result', async () => {
    launch();
    fireEvent.click(screen.getByRole('button', { name: /DYNO/ }));
    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    // doRun() calls setResult(r) synchronously (before the reveal interval even
    // starts), so the PEAK WHP tile mounts immediately — no need to wait for the
    // sweep to finish. This is the actual point of the test: if setResult were
    // wired to the wrong slice (or dropped entirely), this tile never appears,
    // regardless of what the button label does.
    expect(screen.getByText('PEAK WHP')).toBeTruthy();
    // The reveal is a setInterval that ends by setting running false, so the button
    // returns to its idle label. Real timers + waitFor is less brittle here than fake
    // timers, which would need act() wrapping around every tick.
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );
  }, DYNO_PULL_MS + 4000);
});
