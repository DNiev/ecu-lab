// @vitest-environment jsdom

/**
 * `AppShell`'s own tests: the section nav's `aria-current`, the store-reading status
 * strip, the engine-run light, and the wiring proof that `onNavigate` is genuinely
 * `changeTab` — not a bare route change — inside the real app.
 *
 * The nav/strip cases mount `AppShell` directly inside a `StoreProvider` this test
 * owns (the same "probe" pattern build-store.test.jsx uses), which is enough for
 * everything except the `onNavigate` side effect: THAT has to run through the real
 * `EcuLab` component, because "clicking a nav item clears the tuning selection" is
 * `changeTab`'s behaviour, not `AppShell`'s — `AppShell` only ever calls whatever
 * `onNavigate` it was handed.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINE_PRESETS, applyPreset } from '../../src/sim/index.js';
import { AppShell } from '../../src/ui/AppShell.jsx';
import EcuLab from '../../src/ui/EcuLab.jsx';
import { StoreProvider, useBuild, useSession } from '../../src/ui/state/StoreProvider.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';

afterEach(cleanup);

/**
 * A probe that hands the store's dispatch back to the test, so fabricated state can
 * be seeded directly rather than driven through the UI — same pattern as
 * `DispatchProbe` in build-store.test.jsx.
 * @param {{onReady: (dispatch: React.Dispatch<*>) => void}} props
 * @returns {null}
 */
function BuildProbe({ onReady }) {
  const [, dispatch] = useBuild();
  React.useEffect(() => { onReady(dispatch); }, [onReady, dispatch]);
  return null;
}

/** Same probe, off the session slice — same `dispatch`, different read. */
function SessionProbe({ onReady }) {
  const [, dispatch] = useSession();
  React.useEffect(() => { onReady(dispatch); }, [onReady, dispatch]);
  return null;
}

const ROUTE_DASH = { view: 'app', tab: 'dash', section: 'live' };

/**
 * Mounts a bare `AppShell` in its own store, with a dispatch handed back through
 * `onReady`.
 * @param {object} route
 * @param {(dispatch: React.Dispatch<*>) => void} onReady
 * @returns {void}
 */
function mountShell(route, onReady) {
  render(
    <StoreProvider>
      <BuildProbe onReady={onReady} />
      <SessionProbe onReady={onReady} />
      <AppShell route={route} onNavigate={() => {}}>
        <div>screen body</div>
      </AppShell>
    </StoreProvider>,
  );
}

describe('the section nav', () => {
  it('marks only the active tab aria-current, and no other', () => {
    mountShell(ROUTE_DASH, () => {});
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const items = within(nav).getAllByRole('button');
    // Five: HOME, BUILD, TUNE, LIVE, DYNO. LIVE is a destination rather than a section
    // of HOME, so the nav follows the real working order — design it, calibrate it,
    // hear it run, then measure it.
    expect(items).toHaveLength(5);

    // What would turn this red: SideNav comparing the wrong id, or marking every
    // item current (see the break-test below, which proves this exact assertion
    // catches that).
    const home = items.find((b) => b.textContent.includes('HOME'));
    expect(home.getAttribute('aria-current')).toBe('page');

    const others = items.filter((b) => b !== home);
    expect(others).toHaveLength(4);
    for (const b of others) {
      // Must be ABSENT, not the string "false" — aria-current="false" is still a
      // truthy token to a screen reader. getAttribute returns null when the
      // attribute is not present at all.
      expect(b.getAttribute('aria-current')).toBeNull();
    }
  });
});

describe('onNavigate', () => {
  it('carries changeTab\'s side effect: leaving TUNE and coming back drops the selection', () => {
    // A test that only checked the tab switched would pass even with the raw
    // `goTab` wired in, because TUNE's screens (and the dock inside them) unmount
    // the instant you navigate to a different tab regardless of whether the
    // selection was cleared. The real proof is round-tripping: navigate away and
    // back, and check the dock does NOT come back with you. If `AppShell` were
    // ever handed `goTab` instead of `changeTab`, the store's `tune.selection`
    // would still hold the old cell, and the dock would reappear the moment TUNE
    // remounts — this assertion is what catches that.
    render(<EcuLab />);
    // The start screen offers CAREER, SANDBOX and TUTORIAL rather than a single START.
    // SANDBOX is the free-play entry the old button was.
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));

    const grid = within(screen.getByTestId('tuning-grid'));
    const cells = grid.getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent));
    fireEvent.click(cells[Math.floor(cells.length / 2)]);
    expect(screen.getByTestId('selection-dock')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'HOME' }));
    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));

    expect(screen.queryByTestId('selection-dock')).toBeNull();
  });
});

describe('the status strip', () => {
  it('names the engine from the store, not from anything AppShell computes itself', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // A real preset's name is not a string AppShell could produce on its own — the
    // default build has no presetId at all, so this only shows up if the strip
    // actually reads `build.presetId`/`presetById` off the store.
    const seed = ENGINE_PRESETS[0];
    act(() => dispatch({ type: ACTIONS.APPLY_PRESET, preset: applyPreset(seed) }));

    expect(screen.getByText(new RegExp(seed.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
  });

  it('shows boost read from the store\'s boost curve, not a hardcoded figure', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // 37.7 psi is not a value any default state produces (turbo starts off, and no
    // stock boost curve peaks there) — seeding it is what proves the strip reads
    // `build.boostCurve`/`turboOn` rather than showing a fixed label.
    act(() => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true }));
    act(() => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'boostCurve', value: [12, 37.7, 9] }));

    expect(screen.getByText('37.7 psi')).toBeTruthy();
  });

  it('shows health read from the store, not a hardcoded 100%', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // The default is 100/100/100 (a healthy fresh build), so 42% cannot be anything
    // but a genuine read of `session.health` — a strip that always painted the
    // track full would still pass a test seeded at 100.
    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD, field: 'health', value: { piston: 42, bearing: 100, valve: 100 },
    }));

    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('shows the last pull read from the store, not a hardcoded dash', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // 12345 is not a horsepower figure the sim would ever produce — it is only
    // reachable by the strip actually reading `session.result.peakHp`.
    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD, field: 'result', value: { peakHp: 12345, peakTq: 1, points: [], events: [] },
    }));

    expect(screen.getByText('12345 hp')).toBeTruthy();
  });
});

describe('the engine-run light', () => {
  it('is present only while the live engine is running', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // What would turn the first assertion red: EngineRunLight rendering
    // unconditionally, or reading a field other than `session.live.running`.
    expect(screen.queryByText('● RUNNING')).toBeNull();

    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD, field: 'live', value: { running: true },
    }));
    // What would turn this one red: the light never appearing at all — a dead
    // component, not just a wrongly-gated one.
    expect(screen.getByText('● RUNNING')).toBeTruthy();

    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD, field: 'live', value: { running: false },
    }));
    expect(screen.queryByText('● RUNNING')).toBeNull();
  });
});

describe('the app\'s name', () => {
  it('is still in the chrome once the player is past the start screen', () => {
    // The regression this guards: the old hand-rolled header (deleted with it,
    // d5d9f66) carried "CARIBOU TUNING" / "ECU Lab" as its own two lines, but
    // StatusStrip had no equivalent — so once a player pressed START, neither
    // string appeared anywhere in the running app. They only survived on
    // StartScreen (pre-launch) and ErrorBoundary (crash screen), and this test
    // renders neither of those after the click: EcuLab.jsx returns one of three
    // disjoint subtrees keyed on `appView` ('start' | 'tutorial' | the AppShell
    // tree), so pressing START unmounts StartScreen outright rather than merely
    // hiding it. If AppShell's own brand block were missing, these queries would
    // find nothing at all post-click — not a leftover match from the start screen,
    // and ErrorBoundary is never mounted here since nothing throws.
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));

    expect(screen.getByText('CARIBOU TUNING')).toBeTruthy();
    expect(screen.getByText('ECU Lab')).toBeTruthy();
  });
});
