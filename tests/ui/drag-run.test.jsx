// @vitest-environment jsdom

/**
 * The quarter mile, driven through the whole app.
 *
 * `drag-screen.test.jsx` mounts DRAG on its own and says the screen is independent of
 * the shell. This says the other half works: that DRAG is reachable, that the shell's
 * `runDrag` turns a real dyno pull into a real elapsed time, and that the christmas
 * tree holds the car on the line until it goes green.
 *
 * Everything below runs on the DEFAULT engine and the DEFAULT car, so the numbers it
 * asserts on are ranges a quarter mile has to fall in rather than a second copy of the
 * physics — magnitudes are the fingerprint's job (`tests/fingerprint.js` gates a
 * 72-run drag matrix), and duplicating them here would only pin the same figure twice.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import EcuLab, { EcuLabApp, dragPlaybackRate } from '../../src/ui/EcuLab.jsx';
import { StoreProvider, useSession } from '../../src/ui/state/StoreProvider.jsx';

// jsdom has no ResizeObserver, and recharts' <ResponsiveContainer> on the DYNO result
// panel needs one to mount at all — every test here runs a pull to get a torque curve,
// so all of them reach it. Same stub as build-store.test.jsx.
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
beforeEach(() => localStorage.clear());

/**
 * Reads the session slice back out of the store the test owns. `EcuLabApp` is exported
 * for exactly this (see its doc comment): mounting it inside a provider of our own is
 * what lets a test see a solved run without waiting out its real-time playback.
 * @param {{onState: (session: object) => void}} props
 * @returns {null}
 */
function SessionProbe({ onState }) {
  const [session] = useSession();
  React.useEffect(() => { onState(session); }, [onState, session]);
  return null;
}

/** Renders the app, clicks past the start screen, and runs one dyno pull. */
async function launchAndPull(node = <EcuLab />) {
  render(node);
  fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
  fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
  fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
  await waitFor(
    () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
    { timeout: 10000 },
  );
}

/** Advances real time inside `act`, so React flushes the interval's dispatches. */
async function tick(ms) {
  await act(async () => { await new Promise((r) => { setTimeout(r, ms); }); });
}

describe('DRAG, end to end', () => {
  it('is reachable from the nav and needs no pull to be told a pull is needed', () => {
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: 'DRAG' }));
    expect(screen.getByText(/Run a dyno pull first/i)).toBeTruthy();
  });

  it('deep-links: #/drag/gearing lands on DRAG rather than falling back to the start screen', () => {
    // A tab missing from ROUTES parses to the start screen, so this is the assertion
    // that says `drag` is actually in the route table and not merely in the nav.
    window.location.hash = '#/drag/gearing';
    render(<EcuLab />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const current = within(nav).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page');
    expect(current.textContent).toContain('DRAG');
  });

  it('opens the gearbox section once there is a pull to drive with', async () => {
    await launchAndPull();
    fireEvent.click(screen.getByRole('button', { name: 'DRAG' }));
    fireEvent.click(screen.getByRole('button', { name: /Gearbox/ }));
    expect(screen.getByLabelText('Final drive ratio')).toBeTruthy();
    expect(screen.getByLabelText('First gear ratio')).toBeTruthy();
  });

  it('solves a real quarter mile off a real pull, and holds the car until green', async () => {
    /** @type {object} */
    let session = {};
    await launchAndPull(
      <StoreProvider>
        <SessionProbe onState={(s) => { session = s; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'DRAG' }));
    fireEvent.click(screen.getByRole('button', { name: /RUN THE QUARTER MILE/i }));

    // The run is solved on the button press — before the tree has even lit — which is
    // what makes the animation a replay rather than a second simulation. But the car
    // has not moved: playback does not start until green.
    expect(session.dragResult).toBeTruthy();
    expect(session.dragRunning).toBe(false);
    expect(session.treePhase).toBe(1);

    // A ~1600 kg naturally aspirated coupe on street tyres runs the quarter somewhere
    // in the teens. The bounds are deliberately wide: this says the chain produced a
    // real elapsed time, not what that time is. Magnitudes are the fingerprint's job.
    expect(session.dragResult.finished).toBe(true);
    expect(session.dragResult.et).toBeGreaterThan(8);
    expect(session.dragResult.et).toBeLessThan(25);
    expect(session.dragResult.trapMph).toBeGreaterThan(50);
    expect(session.dragResult.sixtyFootT).toBeGreaterThan(0);
    expect(session.dragResult.trace.length).toBeGreaterThan(100);

    // Green comes at 1.9s, and playback starts with it.
    await tick(2200);
    await waitFor(() => expect(session.dragRunning).toBe(true), { timeout: 4000 });
    expect(/** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: /RUNNING/i })).disabled).toBe(true);
  }, 20000);

  it('keeps the guided first run walking on to the strip', () => {
    // Before DRAG existed the guide ENDED on DYNO — its step 4 call to action was
    // "Finish, let me explore freely". Walking the whole guide is the only way to
    // reach that banner, and the only way to prove the hand-off past it now exists.
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: /Done building/i }));
    fireEvent.click(screen.getByRole('button', { name: /Calibration set/i }));
    fireEvent.click(screen.getByRole('button', { name: /Sounds good/i }));
    fireEvent.click(screen.getByRole('button', { name: /Measured — now race it/i }));
    expect(screen.getByText(/STEP 5 · RACE IT/i)).toBeTruthy();
  });
});

describe('playback pacing', () => {
  it('plays an ordinary pass in real time', () => {
    // Anything a player will actually run. Real time is the whole point: the strip is
    // showing them the pass they just made, at the speed they made it.
    for (const et of [0.1, 8, 11.82, 15]) expect(dragPlaybackRate(et)).toBe(1);
  });

  it('fast-forwards a run too slow to sit through, rather than truncating it', () => {
    // `simulateDragRun` gives up at 40s, so a weak engine in a tall-geared truck solves
    // to a 40-second run that never reaches the stripe. Without this the RUN button is
    // disabled for forty-one seconds while nothing much happens.
    expect(dragPlaybackRate(30)).toBe(2);
    expect(dragPlaybackRate(40)).toBeCloseTo(40 / 15, 6);
    // Still bounded, whatever the run's length: rate x wall-clock = the whole run.
    for (const et of [16, 28.6, 40]) {
      expect(et / dragPlaybackRate(et)).toBeLessThanOrEqual(15 + 1e-9);
    }
  });
});
