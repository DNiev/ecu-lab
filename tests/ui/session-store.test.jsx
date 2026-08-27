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

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCareer } from '../../src/storage.js';
import EcuLab, { DYNO_PULL_MS, EcuLabApp } from '../../src/ui/EcuLab.jsx';
import { StoreProvider, useSession } from '../../src/ui/state/StoreProvider.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';

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
  fireEvent.click(screen.getByRole('button', { name: 'START' }));
  return view;
}

/** Renders the app and clicks past the start screen onto HOME. */
function launchOnHome() {
  const view = launch();
  fireEvent.click(screen.getByRole('button', { name: 'HOME' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'START' }));
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
    launchOnHome();

    // The Live Engine panel's subtitle is the engine's own state machine: "Off",
    // "Cranking…", or "Running · <n> RPM · <n>°C".
    expect(screen.getByText('Off')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'START ENGINE' }));

    // liveStep catches on the third 50 ms step from cold (tests/live.test.js covers the
    // physics), so this is ~150 ms of real time. Real timers rather than fake ones, for
    // the same reason as characterisation.test.jsx's dyno pull: fake timers would need
    // act() around every tick.
    await waitFor(
      () => expect(screen.getByText(/^Running · \d+ RPM · \d+°C$/)).toBeTruthy(),
      { timeout: 5000 },
    );
    // Not just "the flag flipped": the engine is actually turning, which only happens
    // if the reducer integrated real steps from the store's own `live`.
    const rpm = Number(screen.getByText(/^Running · \d+ RPM/).textContent.match(/(\d+) RPM/)[1]);
    expect(rpm).toBeGreaterThan(300);
  });

  it('opens and closes the throttle while it runs', async () => {
    // `throttleInput` is a session field written from three pointer handlers, and the
    // throttle pad's own label is the only thing that reads it back. Stub those
    // dispatches and the pad silently stops acknowledging the press.
    launchOnHome();
    fireEvent.click(screen.getByRole('button', { name: 'START ENGINE' }));
    await waitFor(
      () => expect(screen.getByText(/^Running · /)).toBeTruthy(),
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
    launchOnHome();
    fireEvent.click(screen.getByRole('button', { name: 'START ENGINE' }));
    await waitFor(
      () => expect(screen.getByText(/^Running · /)).toBeTruthy(),
      { timeout: 5000 },
    );

    fireEvent.click(screen.getByRole('button', { name: 'STOP' }));

    // Wait past several more interval ticks: a STOP that the next step overwrites
    // would show as the engine still running here.
    await act(async () => { await new Promise((r) => { setTimeout(r, 400); }); });
    expect(screen.getByText('Off')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'START' }));

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
  it('flips the button through the pull phases and sweeps the tach to the top of the run', async () => {
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
    // A pull opens by holding idle before it loads, so this is the first phase label.
    expect(screen.getByRole('button', { name: 'IDLING…' })).toBeTruthy();
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'SWEEPING…' })).toBeTruthy(),
      { timeout: DYNO_PULL_MS },
    );

    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );
    // The reveal ran to the end of the sweep, so the needle is up at the last logged
    // point rather than still on the first one.
    expect(tachReading()).toBeGreaterThan(1500);
    // A whole pull now runs settle -> sweep -> spooldown -> rest, which outlasts the
    // runner's default per-test timeout — hence the explicit budget, named from the
    // sequence itself so retiming the pull cannot silently break this.
  }, DYNO_PULL_MS + 4000);

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
    // `BANK_PULL` updates bestScore/totalScore/pullCount in the store; `persistCareer`
    // (EcuLab.jsx:873) is a SEPARATE synchronous call that writes them through to the
    // storage adapter. It is deliberately not in the reducer — reducers do no I/O — and
    // deliberately not in a useEffect keyed on the score fields, because the restore
    // effect is async and a score-watching effect would fire with 0,0,0 on mount,
    // BEFORE loadCareer() resolves, and overwrite a real save with zeroes.
    //
    // That left the call itself pinned by nothing. Deleting the persistCareer line
    // passes all 169 other tests: the session plays perfectly, the HOME panel shows the
    // right figures from the store, and the career is simply gone at the next refresh.
    // A whole-branch break sweep found this; every earlier review confirmed the call
    // site was CORRECT without checking a regression would be caught.
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'DYNO' }));
    // Guard the setup: nothing is saved before a pull is banked, so if the pull below
    // silently failed to run, the assertion afterwards would be comparing zero to zero.
    expect(localStorage.getItem('career')).toBeNull();

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
    launchOnHome();
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
