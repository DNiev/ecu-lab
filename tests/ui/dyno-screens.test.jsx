// @vitest-environment jsdom

/**
 * The four DYNO screens, mounted on their own — same property `tune-screens.test.jsx`
 * and `build-screens.test.jsx` pin for their tabs: a screen that had quietly kept
 * reading a value the shell passes down would look identical from inside `EcuLab`, so
 * these mount each screen with nothing but a store (and, where the real app never
 * mounts the screen without one, a pre-seeded pull result) around it.
 *
 * DYNO's screens differ from BUILD/TUNE's in one respect worth being explicit about:
 * the shell never mounts DataScreen, LogScreen or ScoreScreen without a `result`
 * already in the store (every one of the four gating conditions in EcuLab.jsx sits
 * inside `{result && (...)}`), so `mountWithResult` below seeds one before the screen
 * under test ever renders — a plain `mount()` would crash them on their first render,
 * same as it would crash the real app if that shell guard were ever dropped.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { DataScreen } from '../../src/ui/screens/dyno/DataScreen.jsx';
import { LogScreen } from '../../src/ui/screens/dyno/LogScreen.jsx';
import { ResultScreen } from '../../src/ui/screens/dyno/ResultScreen.jsx';
import { ScoreScreen } from '../../src/ui/screens/dyno/ScoreScreen.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { StoreProvider, useSession } from '../../src/ui/state/StoreProvider.jsx';
import EcuLab from '../../src/ui/EcuLab.jsx';

// jsdom has no ResizeObserver. recharts' <ResponsiveContainer> (ResultScreen's two
// charts) needs one to mount at all. Same stub as characterisation.test.jsx.
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

/**
 * Mounts a screen with a real store and nothing else — no shell, no route, no props
 * beyond the ones a screen is allowed to be given.
 * @param {React.ReactElement} node
 * @returns {ReturnType<typeof render>}
 */
function mount(node) {
  return render(<StoreProvider>{node}</StoreProvider>);
}

/**
 * Captures the store's own `dispatch` so a test can seed session state before the
 * screen under test — which assumes that state already exists — is asked to render.
 * @param {{onDispatch: (dispatch: Function) => void}} props
 * @returns {null}
 */
function Capture({ onDispatch }) {
  const [, dispatch] = useSession();
  onDispatch(dispatch);
  return null;
}

/**
 * Mounts `node` inside a store pre-seeded with the given session fields.
 *
 * Renders a store with nothing but the capture probe first, seeds it with a real
 * dispatch (wrapped in `act` since this happens outside an event handler), THEN
 * swaps in the real element via `rerender` — `StoreProvider` stays the same
 * component instance across that swap, so its `useReducer` state (the seeded
 * fields) carries over rather than resetting.
 * @param {React.ReactElement} node
 * @param {object} session fields to SET_SESSION_FIELD before `node` mounts
 * @returns {ReturnType<typeof render>}
 */
function mountWithResult(node, session) {
  let dispatch;
  const utils = render(<StoreProvider><Capture onDispatch={(d) => { dispatch = d; }} /></StoreProvider>);
  act(() => {
    for (const [field, value] of Object.entries(session)) {
      dispatch({ type: ACTIONS.SET_SESSION_FIELD, field, value });
    }
  });
  utils.rerender(
    <StoreProvider>
      <Capture onDispatch={(d) => { dispatch = d; }} />
      {node}
    </StoreProvider>,
  );
  return utils;
}

/** One sweep point with every field the DATALOG rows and the histogram read. */
const FAKE_POINT = {
  rpm: 1500, map: 100, ve: 84, veTable: 80, maf: 12,
  timing: 18, commandedTiming: 20, knock: false, knockPull: 0,
  afr: 13.0, afrCommanded: 12.5, lambda: 0.885, bestAfr: 12.5,
  fuelLimited: false, richRisk: false, leanRisk: false,
  duty: 42, pw: 6.1, egt: 780, iat: 38, egtRisk: false,
  peakPressure: 61, pressureRisk: false, hp: 111, torque: 222,
};
const FAKE_RESULT = { points: [FAKE_POINT], events: [], peakHp: 111, peakTq: 222 };

describe('ResultScreen', () => {
  it('renders the power/torque and AFR/timing panels', () => {
    mount(<ResultScreen chartData={[]} engineDerived={{ redline: 7000 }} />);
    expect(screen.getByText('POWER & TORQUE')).toBeTruthy();
    expect(screen.getByText('AFR (COMMANDED VS ACTUAL) / TIMING')).toBeTruthy();
  });

  it('computes its chart ceiling off the shell-computed engineDerived, not one it derives itself', () => {
    // ResultScreen has no `deriveEngine` import and no store read that could produce
    // an engine config to derive from — `engineDerived.redline` is its only source
    // for the chart axis ceiling. Passing a value that is missing it (rather than a
    // whole engineConfig this screen could plausibly compute its own from) proves the
    // screen reads the PROP: if it silently started deriving its own engineDerived
    // instead of trusting this one, `engineDerived` would never be undefined and
    // this render would stop throwing.
    expect(() => mount(<ResultScreen chartData={[]} engineDerived={undefined} />)).toThrow();
  });
});

describe('DataScreen', () => {
  it('reads the pull result off the store, not a prop — DataScreen takes none', () => {
    mountWithResult(<DataScreen />, { result: FAKE_RESULT, histogram: null });
    expect(screen.getByText('Datalog')).toBeTruthy();
    expect(screen.getByText('1500 RPM')).toBeTruthy();
    // `veTable` (80) and `ve` (84) deliberately differ in FAKE_POINT, which is what
    // drives the "table says X, engine actually flowed Y" branch — proves the row is
    // built from the seeded result's own fields, not a recomputation.
    expect(screen.getByText(/table says 80% VE, engine actually flowed 84%/)).toBeTruthy();
  });

  it('builds a histogram from the store\'s own result and applies it to the store\'s own VE table', () => {
    // The sign convention buildHistogram/applyHistogram carry (afr richer than
    // commanded -> table under-reads airflow -> VE goes UP) moved here verbatim
    // from EcuLab.jsx's doRun-adjacent code; this proves it still lands correctly
    // now that it runs off store reads instead of shell-scoped closures.
    // FAKE_POINT: afr 13.0 vs afrCommanded 12.5 -> ran leaner than commanded by
    // (13.0/12.5 - 1) * 100 = 4%, so the VE cell nearest 100 kPa / 1500 RPM should
    // be multiplied by 1.04.
    mountWithResult(<DataScreen />, { result: FAKE_RESULT, histogram: null });

    fireEvent.click(screen.getByRole('button', { name: 'BUILD HISTOGRAM FROM THIS PULL' }));
    expect(screen.getByText('+4.0')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'APPLY CORRECTIONS TO VE' }));
    // The histogram controls put themselves away once applied.
    expect(screen.queryByRole('button', { name: 'APPLY CORRECTIONS TO VE' })).toBeNull();
    expect(screen.getByRole('button', { name: 'BUILD HISTOGRAM FROM THIS PULL' })).toBeTruthy();
  });
});

describe('LogScreen', () => {
  it('shows the clean-pull message when the store\'s result has no events', () => {
    mountWithResult(<LogScreen />, { result: { ...FAKE_RESULT, events: [] } });
    expect(screen.getByText(/Clean pull/)).toBeTruthy();
  });

  it('tones an unrecognised event type by its severity, not by a hardcoded name list', () => {
    // The exact regression this screen exists to prevent: a real event type
    // (`bearing`) once matched no name in a hand-kept list and fell through to the
    // chart-series cyan instead of a real danger/warn tone. `bearing` is not a
    // special-cased type here — the only special case is `maf` — so a fabricated
    // event of a type this screen has never heard of has to be toned purely off
    // `severity`. If a future edit reintroduces a type-name list that omits it,
    // this reads the decorative chart-cyan colour instead and goes red.
    const event = { type: 'bearing', severity: 3, msg: 'FABRICATED BEARING STRESS EVENT', cause: null, fix: null, impact: null };
    mountWithResult(<LogScreen />, { result: { ...FAKE_RESULT, events: [event] } });
    const card = screen.getByText('FABRICATED BEARING STRESS EVENT').closest('[data-tone]');
    expect(card.getAttribute('data-tone')).toBe('danger');
  });

  it('gives a maf event the violet calibration tone regardless of its severity', () => {
    const event = { type: 'maf', severity: 3, msg: 'FABRICATED MAF TRIM NOTE', cause: null, fix: null, impact: null };
    mountWithResult(<LogScreen />, { result: { ...FAKE_RESULT, events: [event] } });
    const card = screen.getByText('FABRICATED MAF TRIM NOTE').closest('[data-tone]');
    expect(card.getAttribute('data-tone')).toBe('violet');
  });
});

describe('ScoreScreen', () => {
  // Fabricated: no real computePullScore/computeTuningScore/computeEngineerScore
  // output for the default store's engine would land on these exact figures.
  const scores = {
    pull: 4321,
    tuning: { score: 91, label: 'FABRICATED TUNING LABEL', deductions: ['fabricated tuning deduction'], advisories: ['fabricated advisory'] },
    engineer: { score: 12, label: 'FABRICATED ENGINEER LABEL', deductions: ['fabricated engineer deduction'] },
  };

  it('shows the shell-computed scores prop, not one it derives itself', () => {
    mountWithResult(<ScoreScreen scores={scores} />, { bestScore: 0 });
    expect(screen.getByText('4321')).toBeTruthy();
    expect(screen.getByText('91')).toBeTruthy();
    expect(screen.getByText('FABRICATED TUNING LABEL')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('FABRICATED ENGINEER LABEL')).toBeTruthy();
    expect(screen.getByText('fabricated tuning deduction')).toBeTruthy();
    expect(screen.getByText('fabricated engineer deduction')).toBeTruthy();
    expect(screen.getByText('fabricated advisory')).toBeTruthy();
  });

  it('reads bestScore off the store, not a prop, to decide NEW BEST vs. Best: N', () => {
    mountWithResult(<ScoreScreen scores={scores} />, { bestScore: 9999 });
    expect(screen.getByText('Best: 9999')).toBeTruthy();
    expect(screen.queryByText('NEW BEST')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
// The gating regression this task exists to pin. DYNO's five conditions are NOT the
// uniform `dynoView === x` shape TUNE's four screens use — while a pull is running,
// the section switcher is hidden and CURVES is the only view that can show,
// regardless of which section the URL has selected. `ROUTES.dyno[0]` is 'result', so
// entering DYNO fresh already selects CURVES and a WRONGLY-normalised
// `dynoView === 'result'` gate would still pass every other test in this file and in
// characterisation.test.jsx. The only way to catch that regression is to select a
// DIFFERENT view first, and then start a pull.
// ---------------------------------------------------------------------------------
describe('DYNO while a pull is running', () => {
  it('shows the live curves and hides the switcher even when DATALOG was the selected view', async () => {
    render(<EcuLab />);
    // The start screen offers CAREER, SANDBOX and TUTORIAL rather than a single START.
    // SANDBOX is the free-play entry the old button was.
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: /DYNO/ }));

    // First pull, run to completion, so the switcher and a result both exist.
    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );

    // Select DATALOG explicitly — the view a careless normalisation would keep
    // showing (as a blank tab) once a second pull starts.
    fireEvent.click(screen.getByRole('button', { name: 'DATALOG' }));
    expect(screen.getByText('Datalog')).toBeTruthy();

    // Start a second pull. doRun dispatches `running: true` synchronously, inside
    // this very click, before the reveal interval has ticked even once — so no
    // `waitFor` here would let the sweep catch up and paper over the one frame this
    // test exists to check.
    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));

    // DATALOG is gone...
    expect(screen.queryByText('Datalog')).toBeNull();
    // ...the switcher is gone (all four of its buttons, DATALOG included)...
    expect(screen.queryByRole('button', { name: 'DATALOG' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'PULL LOG' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'SCORE' })).toBeNull();
    // ...and CURVES is showing instead, unasked-for by the URL.
    expect(screen.getByText('POWER & TORQUE')).toBeTruthy();

    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );
  });
});
