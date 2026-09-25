// @vitest-environment jsdom

/**
 * The SESSION-slice call sites nothing else watches.
 *
 * `tests/ui/state/reducer.test.js` proves what each action DOES to the state tree. It
 * says nothing about which action `EcuLab` dispatches, or whether it dispatches one at
 * all — and the session slice is where that gap is widest, because two of its actions
 * had no caller before this task and three of its writes are invisible to every other
 * test in the suite:
 *
 * - REPAIR_ENGINE existed in the reducer, fully tested, dispatched from NOWHERE. The
 *   REPAIR button wrote a local `health` the store never saw. Deleting that setter
 *   without adding the dispatch leaves the button inert with no error anywhere.
 * - LIVE_STEP integrates the running engine. Its whole reason to exist is that the
 *   50 ms interval must not read `live` from the render scope — get that wrong and the
 *   engine readout freezes, which presents as a physics bug, not a state bug.
 * - LIVE_PATCH is START/STOP. `live.running` gates the throttle pad, so a broken patch
 *   locks the player out of revving the engine.
 *
 * Every test below drives a real control and reads a real readout, so none of them can
 * pass with the dispatch stubbed out.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCareer, saveCareer } from '../../src/storage.js';
import EcuLab, { DYNO_PULL_MS, EcuLabApp } from '../../src/ui/EcuLab.jsx';
import { StoreProvider, useSession } from '../../src/ui/state/StoreProvider.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { installStubAudio } from './audioStub.js';

// Records every saveCareer call (arguments, not return value) while keeping the real
// implementation, so the guard test below can assert on what was WRITTEN and not just
// on the final state — a final-state assertion cannot catch the guard's absence, because
// the write-zeroes-then-write-the-real-values sequence lands on the correct value either
// way; only the intermediate call is wrong.
const { saveCalls } = vi.hoisted(() => ({ saveCalls: /** @type {any[]} */ ([]) }));
vi.mock('../../src/storage.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    saveCareer: (career) => { saveCalls.push(career); return actual.saveCareer(career); },
  };
});

// jsdom has no ResizeObserver. recharts' <ResponsiveContainer> (used on the DYNO
// results panel) needs one to mount at all, so any test that reaches a rendered dyno
// result throws an uncaught ReferenceError from inside react-dom's commit phase
// without this stub. Same approach as characterisation.test.jsx.
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

// The dyno tests below bank a pull, and banking persists career stats through the
// storage adapter — which in jsdom is localStorage. Left in place that would leak into
// the career-restore test, which asserts on exactly those figures.
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

/** Renders the app and clicks past the start screen. Lands on BUILD. */
function launch() {
  const view = render(<EcuLab />);
  // The start screen offers CAREER, SANDBOX and TUTORIAL on this branch rather than a
  // single START. SANDBOX is the free-play entry the old button was.
  fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
  return view;
}

/** Renders the app and clicks past the start screen onto HOME. */
function launchOnHome() {
  const view = launch();
  fireEvent.click(screen.getByRole('button', { name: 'HOME' }));
  return view;
}

/**
 * Renders the app and lands on LIVE, which is where the running engine, its throttle
 * pad and the sound toggle are on this branch — HOME opens on the jobs board.
 */
function launchOnLive() {
  const view = launch();
  fireEvent.click(screen.getByRole('button', { name: 'LIVE' }));
  return view;
}

/**
 * A probe that hands the store's dispatch back to the test, so it can seed session
 * state the UI's own controls cannot produce on demand. Same shape as the one in
 * build-store.test.jsx.
 * @param {{onReady: (dispatch: React.Dispatch<*>) => void}} props
 * @returns {null}
 */
function DispatchProbe({ onReady }) {
  const [, dispatch] = useSession();
  // In an effect, not in render: a render-phase callback fires on every render and
  // twice under StrictMode.
  React.useEffect(() => { onReady(dispatch); }, [onReady, dispatch]);
  return null;
}

/** The Engine Health accordion's subtitle, which reads "<n>% overall" while collapsed. */
function overallHealth() {
  return Number(screen.getByText(/% overall$/).textContent.match(/^(\d+)%/)[1]);
}

describe('the REPAIR button', () => {
  it('puts every worn component back to full health', () => {
    // REPAIR_ENGINE's reducer case has been tested since Task 3; its CALL SITE has
    // never been. Before this task `repairEngine` set a local `health` the store could
    // not see, so removing the setter and forgetting the dispatch would leave the
    // wrench button doing nothing at all — no error, no failing test, and a player
    // staring at a damaged engine they were told they could fix.
    /** @type {React.Dispatch<*>} */
    let dispatch;
    render(
      <StoreProvider>
        <DispatchProbe onReady={(d) => { dispatch = d; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: 'HOME' }));

    // Wear the engine directly rather than by running pulls: how much damage a given
    // build takes is the sim's business and would make this test a physics test.
    // `overallHealth` is the MINIMUM of the three, so the readout below is the 42.
    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD,
      field: 'health',
      value: { piston: 42, bearing: 71, valve: 88 },
    }));
    // Guard the setup rather than trusting it: if the seed silently failed, health
    // would already be 100 and the assertion after the click would pass for the wrong
    // reason.
    expect(overallHealth()).toBe(42);

    fireEvent.click(screen.getByRole('button', { name: 'Repair engine' }));

    expect(overallHealth()).toBe(100);
  });
});

describe('the live engine', () => {
  it('cranks, catches and runs off the store', async () => {
    // The hardest conversion in the PR, and the one with the least margin for error.
    // The 20 Hz interval is installed once with a stable dependency, so anything it
    // reads from the render scope is frozen at mount — an engine-off `live` forever.
    // LIVE_STEP therefore resolves `prev` inside the reducer. If it did not, the guard
    // (`running || cranking || rpm > 1`) would evaluate against that frozen state and
    // this engine would never leave 0 RPM, no matter how many times START was pressed.
    launchOnLive();

    // The panel's status line is the engine's own state machine, read off the store.
    expect(screen.getByText('Engine off. Start it to watch the ECU work in real time.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'START ENGINE' }));

    // liveStep catches on the third 50 ms step from cold (tests/live.test.js covers the
    // physics), so this is ~150 ms of real time. Real timers rather than fake ones, for
    // the same reason as characterisation.test.jsx's dyno pull: fake timers would need
    // act() around every tick.
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'STOP' })).toBeTruthy(),
      { timeout: 5000 },
    );
    // Not just "the flag flipped": the engine is actually turning, which only happens
    // if the reducer integrated real steps from the store's own `live`.
    await waitFor(
      () => expect(Number(screen.getByRole('status', { name: 'Engine speed' }).textContent)).toBeGreaterThan(300),
      { timeout: 5000 },
    );
  });

  it('opens and closes the throttle while it runs', async () => {
    // `throttleInput` is a session field written from three pointer handlers, and the
    // throttle pad's own label is the only thing that reads it back. Stub those
    // dispatches and the pad silently stops acknowledging the press.
    launchOnLive();
    fireEvent.click(screen.getByRole('button', { name: 'START ENGINE' }));
    await waitFor(
      () => expect(screen.getByText('PRESS AND HOLD TO REV')).toBeTruthy(),
      { timeout: 5000 },
    );

    const pad = screen.getByText('PRESS AND HOLD TO REV');
    fireEvent.pointerDown(pad.parentElement);
    expect(screen.getByText('WIDE OPEN THROTTLE')).toBeTruthy();

    fireEvent.pointerUp(screen.getByText('WIDE OPEN THROTTLE').parentElement);
    expect(screen.getByText('PRESS AND HOLD TO REV')).toBeTruthy();
  });

  it('shuts down on STOP', async () => {
    // STOP is the other LIVE_PATCH. It has to land on top of whatever the 20 Hz
    // interval last wrote — the interval is still ticking underneath it — so if this
    // regressed to a value-carrying write of a captured `live`, the engine would come
    // straight back to life on the next step.
    launchOnLive();
    fireEvent.click(screen.getByRole('button', { name: 'START ENGINE' }));
    await waitFor(
      () => expect(screen.getByText('PRESS AND HOLD TO REV')).toBeTruthy(),
      { timeout: 5000 },
    );

    fireEvent.click(screen.getByRole('button', { name: 'STOP' }));

    // Wait past several more interval ticks: a STOP that the next step overwrites
    // would show as the engine still running here.
    await act(async () => { await new Promise((r) => { setTimeout(r, 400); }); });
    expect(screen.getByText('Engine off. Start it to watch the ECU work in real time.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'START ENGINE' })).toBeTruthy();
  });

  it('does not re-render the app while it is stopped', async () => {
    // LIVE_STEP's early return hands back the SAME state object, which is what makes
    // React bail out. Return a fresh state holding an unchanged `live` instead and
    // nothing breaks, nothing fails — the entire app just re-renders twenty times a
    // second, forever, on a dead engine. Nothing else in the suite would notice.
    let renders = 0;
    /** @returns {null} */
    function RenderCounter() {
      useSession();
      renders += 1;
      return null;
    }
    render(
      <StoreProvider>
        <RenderCounter />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));

    // Let the mount settle first — the career-restore effect resolves asynchronously
    // and dispatches three writes of its own, which are legitimate re-renders.
    await act(async () => { await new Promise((r) => { setTimeout(r, 300); }); });
    const settled = renders;

    // Four separate waits rather than one long one: a single `act` would flush every
    // tick's re-render into one commit, so a broken bail-out would show up as ONE
    // extra render instead of one per tick and the signal would be a hair from noise.
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { await new Promise((r) => { setTimeout(r, 120); }); });
    }

    expect(renders).toBe(settled);
  });
});

describe('running a dyno pull', () => {
  it('flips the button through the pull and sweeps the tach to the top of the run', async () => {
    // Two session writes nothing else pins. `running` is only legible as the RUN
    // button's label while the sweep is live — characterisation.test.jsx waits for the
    // idle label to come BACK, which a permanently-idle button satisfies immediately.
    // `revealCount` is only legible through the tach, which reads points[revealCount]:
    // stub that dispatch and the needle sits at the sweep's first point (1500 RPM) for
    // the whole pull and forever afterwards.
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
    expect(tachReading()).toBe(1500);

    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    // jsdom has no Web Audio, so there is nothing to hear the idle either side of the
    // sweep with — and a pull that cannot be heard goes straight to the sweep.
    expect(screen.getByRole('button', { name: 'SWEEPING…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'IDLING…' })).toBeNull();

    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );
    // The reveal ran to the end of the sweep, so the needle is up at the last logged
    // point rather than still on the first one.
    expect(tachReading()).toBeGreaterThan(1500);
  });

  describe('with audio available', () => {
    /** @type {ReturnType<typeof installStubAudio>} */
    let audio;
    beforeEach(() => { audio = installStubAudio(); });
    afterEach(() => { audio.restore(); });

    it('holds idle before the sweep and comes back down after it, because it can be heard', async () => {
      launch();
      fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
      fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
      // A pull opens by holding idle before it loads, so this is the first phase label.
      expect(screen.getByRole('button', { name: 'IDLING…' })).toBeTruthy();
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'SWEEPING…' })).toBeTruthy(),
        { timeout: DYNO_PULL_MS },
      );
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'COMING BACK DOWN…' })).toBeTruthy(),
        { timeout: DYNO_PULL_MS },
      );
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
        { timeout: DYNO_PULL_MS },
      );
      // The whole sequence outlasts the runner's default per-test timeout — hence the
      // explicit budget, named from the sequence itself so retiming it cannot silently
      // break this.
    }, DYNO_PULL_MS + 4000);

    it('skips the bookends when sound is switched off, because nobody can hear them', async () => {
      launchOnLive();
      fireEvent.click(screen.getByTitle('Engine sound'));
      fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
      fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
      expect(screen.getByRole('button', { name: 'SWEEPING…' })).toBeTruthy();
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
        { timeout: 10000 },
      );
    });

    it('reports a working TEST once the context has actually resumed, not before', async () => {
      // `resume()` settles later. Reading the state straight after calling it saw
      // 'suspended' on exactly the tap that unlocks audio, and the first TEST told the
      // player the browser was blocking a beep they had just heard.
      launchOnLive();
      fireEvent.click(screen.getByRole('button', { name: 'TEST' }));
      expect(await screen.findByText(/Audio is running/)).toBeTruthy();
      expect(screen.queryByText(/still blocking audio/)).toBeNull();
    });

    it('suspends the audio context once nothing is sounding', async () => {
      // The exhaust model is sample-rate JavaScript. Left running, a stopped engine
      // costs a noticeable share of a core for the life of the page.
      launch();
      fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
      fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
      const [ctx] = audio.contexts;
      expect(ctx).toBeTruthy();
      await waitFor(() => expect(ctx.state).toBe('running'));
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
        { timeout: DYNO_PULL_MS + 2000 },
      );
      await waitFor(() => expect(ctx.state).toBe('suspended'), { timeout: 2000 });
    }, DYNO_PULL_MS + 6000);
  });

  it('puts the histogram controls away once the correction is applied', async () => {
    // `applyHistogram` clears `histogram` after writing the VE table. Drop that write
    // and the APPLY/DISCARD pair stays on screen, inviting the player to apply the same
    // correction to the same table over and over. build-store.test.jsx covers the VE
    // write itself but stops before the clear.
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );

    fireEvent.click(screen.getByRole('button', { name: 'DATALOG' }));
    fireEvent.click(screen.getByRole('button', { name: 'BUILD HISTOGRAM FROM THIS PULL' }));
    // Guard: the APPLY/DISCARD pair only exists while `histogram` is set, so this also
    // proves the build-side write landed before the clear is asserted below.
    fireEvent.click(screen.getByRole('button', { name: 'APPLY CORRECTIONS TO VE' }));

    expect(screen.queryByRole('button', { name: 'APPLY CORRECTIONS TO VE' })).toBeNull();
    expect(screen.getByRole('button', { name: 'BUILD HISTOGRAM FROM THIS PULL' })).toBeTruthy();
  }, DYNO_PULL_MS + 4000);

  it('resets the tach to the start of the sweep when a second pull begins', async () => {
    // `doRun` (EcuLab.jsx:846) dispatches `revealCount: 0` before the reveal interval
    // starts. Task 6's report justified leaving that dispatch untested by calling it
    // "a reset to a value the field is usually already at" with "no readout that could
    // distinguish" it. Both halves are false: after ANY completed pull revealCount ===
    // points.length, never 0, and the tach (EcuLab.jsx:1017) reads it back directly.
    // Drop the dispatch and every pull after the first opens with the tach still
    // pinned at the PREVIOUS pull's peak RPM and the chart fully drawn, then snaps
    // back to the sweep's first point and re-animates a beat later — a visible flash
    // on a core screen, every time a player runs back-to-back pulls.
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));

    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );
    const afterFirstPull = tachReading();
    // Guard the setup, not just the outcome: if the reveal had not actually run to the
    // end of the sweep, this would already read the sweep's first point, and the real
    // assertion below would pass whether or not the second pull's reset dispatch fired
    // — for the wrong reason. Same figure the "sweeps the tach to the top of the run"
    // test above already establishes is reachable.
    expect(afterFirstPull).toBeGreaterThan(1500);

    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    // Deliberately no `waitFor` here: `doRun` dispatches SET_SESSION_FIELD/revealCount
    // and BANK_PULL synchronously, inside this very click, before the reveal interval
    // has ticked even once. The whole failure this test exists to catch is the FIRST
    // frame of the second pull — waiting for anything would let the 55 ms interval
    // catch up and paper over exactly the flash a player would see.
    expect(tachReading()).toBeLessThan(afterFirstPull);
  }, DYNO_PULL_MS + 4000);
});

/**
 * The dyno tab's tach renders its RPM figure as a bare integer directly above a "RPM"
 * caption. recharts also labels an axis "RPM", so match on the pairing rather than on
 * the caption alone.
 * @returns {number}
 */
function tachReading() {
  const readings = screen.getAllByText('RPM')
    .map((el) => el.previousElementSibling)
    .filter((el) => el && /^\d+$/.test(el.textContent))
    .map((el) => Number(el.textContent));
  expect(readings).toHaveLength(1);
  return readings[0];
}

describe('the dyno load selector', () => {
  it('moves the selection to the load the player picked', () => {
    // `loadKpa` decides which manifold-pressure column the sweep is run at. It is fed
    // straight into simulateSweep, so a dropped write is only visible as a pull that
    // quietly measured the wrong thing — but the Seg's own highlight reads the value
    // back out of the store, which makes the round trip testable in one click.
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
    expect(selectedLoad()).toBe('100 kPa');

    fireEvent.click(screen.getByRole('button', { name: '40 kPa' }));

    expect(selectedLoad()).toBe('40 kPa');
  });
});

/**
 * Seg marks its selected option with `aria-pressed="true"`, so the selected label is
 * whichever of the three carries it.
 * @returns {string}
 */
function selectedLoad() {
  const buttons = ['100 kPa', '70 kPa', '40 kPa']
    .map((name) => screen.getByRole('button', { name }));
  const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
  expect(pressed).toHaveLength(1);
  return pressed[0].textContent;
}

describe('the guided first run', () => {
  it('advances to the next step when the banner is followed', () => {
    // `journeyStep` is onboarding progress, and the banner is the only thing that
    // reads it. A dropped write leaves a new player stuck on step 1 of 4, being told
    // to do something they have already done.
    launch();
    expect(screen.getByText('STEP 1 · BUILD THE ENGINE')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done building — go tune it' }));

    // The banner's onAdvance both bumps the step and changes tab, so the step-2 banner
    // is what proves the store took the write — the tab change alone would not.
    expect(screen.getByText('STEP 2 · CALIBRATE IT')).toBeTruthy();
  });

  it('dismisses for good on SKIP GUIDE', () => {
    // The dismissal writes 99, a step the JOURNEY table has no entry for, so
    // JourneyBanner renders null. Drop the write and the banner is unclosable.
    launch();
    expect(screen.getByText('STEP 1 · BUILD THE ENGINE')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'SKIP GUIDE' }));

    expect(screen.queryByText('STEP 1 · BUILD THE ENGINE')).toBeNull();
  });
});

describe('banking a pull', () => {
  it('writes the career through to storage, not just to the store', async () => {
    // `BANK_PULL` updates bestScore/totalScore/pullCount/runs in the store; a
    // `useEffect` over those fields (EcuLab.jsx, below the career-restore effect) is
    // what writes them through to the storage adapter. It is deliberately not in the
    // reducer — reducers do no I/O — and it is guarded by a `careerLoaded` ref set
    // only once the restore effect's own dispatches land, because that effect is
    // async and an unguarded persistence effect would fire with 0,0,0 on mount,
    // before `loadCareer()` resolves, and overwrite a real save with zeroes.
    //
    // Deleting the persistence effect passes every other test: the session plays
    // perfectly, the HOME panel shows the right figures from the store, and the
    // career is simply gone at the next refresh. A whole-branch break sweep found
    // the equivalent gap in the pre-Task-5 design; every earlier review confirmed the
    // call site was CORRECT without checking a regression would be caught.
    // No settle-wait for the mount's async career-restore effect before banking: a
    // synchronous `fireEvent` chain CAN still land `BANK_PULL` before that effect's
    // `RESTORE_CAREER` dispatch resolves, but RESTORE_CAREER merges the loaded
    // (empty, on this fresh a `localStorage`) career with whatever the session
    // already banked rather than overwriting it — see reducer.js. So racing it here
    // is no longer a hazard this test needs to dodge; it exercises the actual
    // ordering a real fast-clicking player can produce instead of avoiding it.
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );

    // Read it back through the adapter rather than parsing the raw string, so this
    // pins the round trip a returning player actually depends on.
    const saved = await loadCareer();
    expect(saved.pulls).toBe(1);
    expect(saved.total).toBeGreaterThan(0);
    expect(saved.best).toBe(saved.total);
  }, DYNO_PULL_MS + 4000);

  // -----------------------------------------------------------------------------
  // Issue #29. The scorecard used to recompute the Engineer and Pull scores from the
  // hardware selected AT RENDER TIME and grade them against the LAST pull's dyno
  // output. Change the setup after a pull and that finished run was silently re-graded
  // as though it had been made on the new one — a number the engine never produced,
  // from a session that never happened — and the Pull Score moved with it, so it could
  // climb past `bestScore` and light up NEW BEST with nobody having run anything.
  //
  // Nothing below stubs a score. Each test runs a REAL pull through the real sim,
  // reads the real figure off the scorecard, changes something, and reads it again:
  // the assertion is that a number on screen did not move while no pull was run. That
  // is the entire claim, and it is not checkable any other way — every intermediate
  // layer (the memo, the store, the props) would look correct with the bug in place.
  // -----------------------------------------------------------------------------
  describe('and then changing the setup without running another', () => {
    it('leaves the banked scores exactly as measured, and says they are last pull\'s', async () => {
      launch();
      fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
      fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
        { timeout: 10000 },
      );
      fireEvent.click(screen.getByRole('button', { name: 'SCORE' }));
      const measured = statTile('PULL SCORE');
      // Guard the setup: a scorecard showing nothing would make the comparison below
      // pass for the wrong reason.
      expect(Number(measured)).toBeGreaterThan(0);
      expect(screen.queryByText(/before your latest change/)).toBeNull();

      // The dyno's own load selector, chosen because it is a MEASURED input that can
      // be changed without leaving the scorecard — no navigation, no other write, and
      // the score panel stays mounted across it. A pull at 40 kPa is a different
      // measurement of the same engine, so these figures are no longer what running
      // now would produce.
      fireEvent.click(screen.getByRole('button', { name: '40 kPa' }));

      expect(statTile('PULL SCORE')).toBe(measured);
      expect(screen.getByText(/before your latest change/)).toBeTruthy();
    });

    it('does not re-grade a finished pull against hardware fitted afterwards', async () => {
      // The headline case from the issue, driven through a real hardware control:
      // change the exhaust after the pull. Under the old memo the Engineer Score
      // recomputed to 92 (`-8 Exhaust diameter poorly matched to displacement`) and
      // dragged the Pull Score down with it — on a dyno session that had already ended,
      // through a pipe the engine never ran.
      //
      // Exhaust diameter rather than the turbo switch, and the difference matters: the
      // default boost curve is all zeros, so fitting a turbo alone moves NO engineer
      // rule for the stock engine, and a "fit a turbo" version of this test passes with
      // the bug fully in place. Verified by running it against the old memo.
      launch();
      fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
      fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
        { timeout: 10000 },
      );
      fireEvent.click(screen.getByRole('button', { name: 'SCORE' }));
      const measured = {
        pull: statTile('PULL SCORE'),
        tuning: statTile('TUNING SCORE'),
        engineer: statTile('ENGINEER SCORE'),
      };
      expect(Number(measured.pull)).toBeGreaterThan(0);

      // BUILD > EXHAUST > fit a 4.0" pipe, then back to the scorecard.
      fireEvent.click(screen.getByRole('button', { name: 'BUILD' }));
      fireEvent.click(screen.getByText('Exhaust'));
      fireEvent.click(screen.getByRole('button', { name: '4.0"' }));
      // Guard the interaction, not just the outcome: an equality assertion passes
      // trivially if the pipe was never actually changed.
      expect(screen.getByRole('button', { name: '4.0"' }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
      fireEvent.click(screen.getByRole('button', { name: 'SCORE' }));

      expect({
        pull: statTile('PULL SCORE'),
        tuning: statTile('TUNING SCORE'),
        engineer: statTile('ENGINEER SCORE'),
      }).toEqual(measured);
      expect(screen.getByText(/before your latest change/)).toBeTruthy();
    });

    it('goes back to current when an undo puts the setup back', async () => {
      // Staleness is a comparison against the LIVE setup, not a flag latched at the
      // moment something changed. Undo the edit and the banked scores describe the car
      // on screen again — so the warning has to clear itself, or it becomes noise the
      // player learns to ignore.
      launch();
      fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
      fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
        { timeout: 10000 },
      );
      fireEvent.click(screen.getByRole('button', { name: 'SCORE' }));
      const measured = statTile('PULL SCORE');

      // A calibration edit, not a hardware one: SET_TABLE is what the undo stack
      // records, and the tables are the inputs a tuner changes most between pulls.
      // Same route into the grid as characterisation.test.jsx — a cell has to be
      // selected before the dock that edits it exists.
      fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));
      const grid = within(screen.getByTestId('tuning-grid'));
      const cells = grid.getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent));
      fireEvent.click(cells[Math.floor(cells.length / 2)]);
      const dock = within(screen.getByTestId('selection-dock'));
      fireEvent.click(dock.getByRole('button', { name: '+1' }));
      fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
      fireEvent.click(screen.getByRole('button', { name: 'SCORE' }));
      expect(screen.getByText(/before your latest change/)).toBeTruthy();
      expect(statTile('PULL SCORE')).toBe(measured);

      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      expect(screen.queryByText(/before your latest change/)).toBeNull();
      expect(statTile('PULL SCORE')).toBe(measured);
    });
  });
});

describe('career stats saved from a previous session', () => {
  it('are restored into the store on mount', async () => {
    // The career-restore effect writes bestScore, totalScore and pullCount. Drop those
    // writes and a returning player's high score reads back as zero — and then the
    // next pull's `persistCareer` OVERWRITES the real save with that zeroed career, so
    // the failure is not just cosmetic, it destroys the data. tests/storage.test.js
    // covers the adapter and never touches this wiring.
    localStorage.setItem('career', JSON.stringify({ best: 812, total: 3405, pulls: 7 }));
    launchOnHome();

    // The load is async, so the first paint legitimately shows a zeroed career.
    await waitFor(() => expect(screen.getByText('7 pulls logged')).toBeTruthy());

    // Open the panel for the other two figures: the collapsed subtitle only names the
    // pull count while no pull has been run this session.
    fireEvent.click(screen.getByText('Career & Last Pull'));
    expect(statTile('BEST PULL')).toBe('812');
    expect(statTile('CAREER TOTAL')).toBe('3405');
  });

  it('does not overwrite a saved career before the load completes', async () => {
    // The hazard: loadCareer is async, so there is a window between first paint and
    // its dispatches landing. A persistence effect with no guard runs during that
    // window and writes zeroes over a real save — silently, and on every cold start.
    // A final-state assertion cannot catch this: the zeroes get overwritten by the
    // real values a moment later either way, so this asserts on every call made, not
    // on where things end up.
    await saveCareer({ best: 900, total: 5000, pulls: 30, runs: [], pinnedRunId: null });
    saveCalls.length = 0;
    launch();

    await waitFor(() => expect(saveCalls.length).toBeGreaterThan(0));
    for (const call of saveCalls) {
      expect(call).not.toMatchObject({ best: 0, total: 0, pulls: 0 });
    }
  });
});

/**
 * StatTile renders its caption and its figure as sibling divs.
 * @param {string} label
 * @returns {string}
 */
function statTile(label) {
  return screen.getByText(label).nextElementSibling.firstChild.textContent;
}

describe('the engine-sound toggle', () => {
  it('switches the button between on and off', () => {
    // `soundOn` gates the audio synth's master gain, which jsdom has no way to hear.
    // The button's own glyph is the readable half of that write.
    launchOnLive();
    // By title, not by name: the button's only content is the glyph this test is
    // asserting on, and that glyph IS its accessible name.
    const toggle = () => screen.getByTitle('Engine sound');
    expect(toggle().textContent).toBe('♪');

    fireEvent.click(toggle());
    expect(toggle().textContent).toBe('✕');

    fireEvent.click(toggle());
    expect(toggle().textContent).toBe('♪');
  });
});
