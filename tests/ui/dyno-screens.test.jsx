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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DataScreen } from '../../src/ui/screens/dyno/DataScreen.jsx';
import { HistoryScreen } from '../../src/ui/screens/dyno/HistoryScreen.jsx';
import { LogScreen } from '../../src/ui/screens/dyno/LogScreen.jsx';
import { ResultScreen } from '../../src/ui/screens/dyno/ResultScreen.jsx';
import { ScoreScreen } from '../../src/ui/screens/dyno/ScoreScreen.jsx';
import { makeInitialState } from '../../src/ui/state/initialState.js';
import { measuredInputs } from '../../src/ui/state/pullSignature.js';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { makeRunRecord } from '../../src/ui/state/runLog.js';
import { StoreProvider, useSession } from '../../src/ui/state/StoreProvider.jsx';
import EcuLab, { EcuLabApp } from '../../src/ui/EcuLab.jsx';

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

// jsdom does no layout, so every element's getBoundingClientRect() is all zeros —
// which recharts' <ResponsiveContainer> (a percentage-width box) reads as "no space",
// and passes a 0 width down to <LineChart>, whose own `validateWidthHeight` guard then
// renders nothing at all. The ghost-curve tests below assert on Legend item NAMES,
// which only exist once the chart actually renders, so this file needs a non-zero
// rect where the two DYNO/DataScreen tests above it never did.
//
// `offsetWidth`/`offsetHeight` get the same treatment one level down, for the chart
// CLICK tests further below: recharts' own click handler (`getMouseInfo` in
// generateCategoricalChart.js) divides the container's real getBoundingClientRect()
// width by its `offsetWidth` to get a scale factor before it will resolve a click to
// a chart position at all. jsdom leaves `offsetWidth`/`offsetHeight` at 0 on every
// element, so that division comes out Infinity and every click resolves to nothing —
// none of the tests above this point click anything, so they never needed this half.
const origGetBoundingClientRect = window.Element.prototype.getBoundingClientRect;
const origOffsetWidth = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetWidth');
const origOffsetHeight = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetHeight');
beforeAll(() => {
  window.Element.prototype.getBoundingClientRect = () => (
    { width: 400, height: 200, top: 0, left: 0, bottom: 200, right: 400, x: 0, y: 0, toJSON() {} }
  );
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 400 });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 200 });
});
afterAll(() => {
  window.Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', origOffsetWidth);
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', origOffsetHeight);
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

describe('ResultScreen ghost curve', () => {
  const CHART = [{ rpm: 1500, hp: 111, torque: 222, prevHp: 100, prevTorque: 200 }];

  it('draws both ghost series, named for the comparison, when there is one', () => {
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} ghostLabel="Run 4" />);
    expect(screen.getByText('Run 4 WHP')).toBeTruthy();
    expect(screen.getByText('Run 4 TQ')).toBeTruthy();
  });

  it('draws no ghost series at all when there is no comparison', () => {
    // The other half. Rendering the lines unconditionally would still look right on
    // the first pull — recharts just draws nothing for an all-undefined dataKey — so
    // the legend is what makes the difference observable.
    mount(<ResultScreen chartData={[{ rpm: 1500, hp: 111, torque: 222 }]} engineDerived={{ redline: 7000 }} ghostLabel={null} />);
    // `queryByText` throws (Testing Library's "multiple elements found") under the
    // ghost mutation, which the ghost mutation reads as a failure of THIS line —
    // never letting the two load-bearing `toBe(null)` assertions below it run at
    // all. `queryAllByText` never throws on multiple matches, so a real regression
    // lands on the assertion that actually names it.
    expect(screen.queryAllByText(/WHP$/)).toHaveLength(1);
    expect(screen.queryByText(/ WHP$/)).toBe(null);
    expect(screen.queryByText(/ TQ$/)).toBe(null);
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

describe('LogScreen focus highlighting', () => {
  const RESULT = {
    points: [], peakHp: 300, peakTq: 280,
    events: [
      { type: 'knock', severity: 3, impact: 20, msg: 'Knock in the midrange', cause: 'c', fix: 'f', rpmStart: 4200, rpmEnd: 5100 },
      { type: 'lean', severity: 2, impact: 10, msg: 'Lean at the top', cause: 'c', fix: 'f', rpmStart: 6100, rpmEnd: 6600 },
      { type: 'injscale', severity: 3, impact: 30, msg: 'Injector scaling mismatch', cause: 'c', fix: 'f' },
    ],
  };

  const entry = (msg) => screen.getByText(msg).closest('[data-focused]');

  it('highlights every event whose span covers the focus RPM, and no others', () => {
    // Both directions in one assertion. Highlighting all three, and highlighting none,
    // must each fail.
    mountWithResult(<LogScreen />, { result: RESULT, logFocusRpm: 4800 });
    expect(entry('Knock in the midrange').getAttribute('data-focused')).toBe('true');
    expect(entry('Lean at the top').getAttribute('data-focused')).toBe('false');
    expect(entry('Injector scaling mismatch').getAttribute('data-focused')).toBe('false');
  });

  it('highlights an event at the exact edge of its span', () => {
    // Off-by-one: a `>` instead of `>=` drops the boundary, which is precisely the RPM
    // a player clicking the edge of a band lands on.
    mountWithResult(<LogScreen />, { result: RESULT, logFocusRpm: 4200 });
    expect(entry('Knock in the midrange').getAttribute('data-focused')).toBe('true');
  });

  it('highlights a different event when the focus moves', () => {
    mountWithResult(<LogScreen />, { result: RESULT, logFocusRpm: 6300 });
    expect(entry('Knock in the midrange').getAttribute('data-focused')).toBe('false');
    expect(entry('Lean at the top').getAttribute('data-focused')).toBe('true');
  });

  it('highlights nothing when there is no focus', () => {
    mountWithResult(<LogScreen />, { result: RESULT, logFocusRpm: null });
    for (const msg of ['Knock in the midrange', 'Lean at the top', 'Injector scaling mismatch']) {
      expect(entry(msg).getAttribute('data-focused')).toBe('false');
    }
  });
});

describe('ScoreScreen', () => {
  // Fabricated: no real computePullScore/computeTuningScore/computeEngineerScore
  // output for the default store's engine would land on these exact figures.
  const scores = {
    pull: 4321,
    wasBest: true,
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

  it('reads bestScore off the store, not a prop, for the figure it reports', () => {
    mountWithResult(<ScoreScreen scores={{ ...scores, wasBest: false }} />, { bestScore: 9999 });
    expect(screen.getByText('Best: 9999')).toBeTruthy();
    expect(screen.queryByText('NEW BEST')).toBeNull();
  });

  it('takes NEW BEST off the run that was banked, not off a live comparison', () => {
    // The regression this pins is not cosmetic. `scores.pull >= bestScore` is
    // evaluated AFTER banking has already folded this pull into `bestScore`, so it is
    // true by construction on every pull, tie or not — the badge lit up every single
    // time. `wasBest` is decided in BANK_PULL against the best as it stood BEFORE the
    // pull landed, which is the only moment the comparison means anything.
    //
    // The store's `bestScore` here is deliberately HIGHER than the pull: any screen
    // that went back to comparing the two would print `Best: 9999` and go red.
    mountWithResult(<ScoreScreen scores={{ ...scores, pull: 10, wasBest: true }} />, { bestScore: 9999 });
    expect(screen.getByText('NEW BEST')).toBeTruthy();
    expect(screen.queryByText('Best: 9999')).toBeNull();
  });

  it('says nothing about staleness for a pull the build has not moved since', () => {
    mountWithResult(<ScoreScreen scores={scores} />, { bestScore: 0 });
    expect(screen.queryByText(/before your latest change/)).toBeNull();
  });

  it('labels the scorecard as last pull\'s once the build has changed under it', () => {
    // The banked figures are still shown — deleting them would take away the BEFORE
    // half of the comparison the player changed something to make — so the only thing
    // that can tell a player these numbers are not about the car on screen is this
    // warning. Without it, banking silently turns one lie (a re-graded score) into
    // another (a stale one presented as current).
    mountWithResult(<ScoreScreen scores={scores} stale />, { bestScore: 0 });
    expect(screen.getByText(/before your latest change/)).toBeTruthy();
    expect(screen.getByText('4321')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'START' }));
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

// ---------------------------------------------------------------------------------
// The other regression this task exists to pin: DYNO's body used to be wrapped
// wholesale in `{result && (...)}`, which hid the section switcher — HISTORY
// included — on a cold start, because `result` is never persisted while `runs`
// is. A restored session has a populated run log and a null `result`, so this
// mounts exactly that combination without ever running a pull.
// ---------------------------------------------------------------------------------
describe('DYNO body gating — HISTORY outlives result', () => {
  it('shows HISTORY (and only HISTORY) when runs exist but no pull has landed yet', () => {
    let dispatch;
    render(
      <StoreProvider>
        <Capture onDispatch={(d) => { dispatch = d; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'START' }));
    fireEvent.click(screen.getByRole('button', { name: /DYNO/ }));

    // Seed a restored run directly, the way RESTORE_CAREER would on a cold start —
    // `result` stays at its initial `null`, exactly as it is after a page reload.
    const restoredRun = makeRunRecord({
      id: 'restored', n: 1, at: 1000, label: 'VQ35DE',
      result: { peakHp: 300, peakTq: 280, points: [{ rpm: 1500, hp: 100, torque: 200 }], events: [] },
      scores: { tuning: { score: 80 }, engineer: { score: 70 } }, pullScore: 640,
      inputs: measuredInputs(makeInitialState().build, makeInitialState().tune, 100),
    });
    act(() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'runs', value: [restoredRun] }));

    expect(screen.getByRole('button', { name: 'HISTORY' })).toBeTruthy();
    // Only HISTORY: the other four sections lead to screens that render nothing
    // without a result, so they must not be offered.
    expect(screen.queryByRole('button', { name: 'CURVES' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'PULL LOG' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'DATALOG' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'SCORE' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'HISTORY' }));
    expect(screen.getByText('Run 1')).toBeTruthy();
  });

  it('shows no DYNO nav row at all for a pristine session with no runs and no result', () => {
    // The converse: a brand-new career has neither `runs` nor `result`, and the
    // switcher — HISTORY included — must not appear for it to click into.
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'START' }));
    fireEvent.click(screen.getByRole('button', { name: /DYNO/ }));

    expect(screen.queryByRole('button', { name: 'HISTORY' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'CURVES' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
/** Three records, oldest id last, matching the store's newest-first order. */
const RUN_1 = makeRunRecord({
  id: 'a', n: 1, at: 1_000, label: 'VQ35DE',
  result: { peakHp: 300, peakTq: 280, points: [{ rpm: 1500, hp: 100, torque: 200 }], events: [] },
  scores: { tuning: { score: 80 }, engineer: { score: 70 } }, pullScore: 640,
  inputs: measuredInputs(makeInitialState().build, makeInitialState().tune, 100),
});
const RUN_2 = { ...RUN_1, id: 'b', n: 2, peakHp: 320 };
const RUN_3 = { ...RUN_1, id: 'c', n: 3, peakHp: 340 };
/** Identical to RUN_1 except for one measured input, so the diff has exactly one answer. */
const RUN_BOOSTED = {
  ...RUN_1, id: 'd', n: 2, peakHp: 400,
  inputs: measuredInputs(
    { ...makeInitialState().build, boostCurve: [1, 2, 3, 4, 5, 6, 7, 8] },
    makeInitialState().tune, 100,
  ),
};

describe('DYNO > HISTORY', () => {
  it('shows an empty state before any pull', () => {
    mountWithResult(<HistoryScreen />, { runs: [], pinnedRunId: null });
    expect(screen.getByText(/no pulls yet/i)).toBeTruthy();
  });

  it('lists runs newest first', () => {
    mountWithResult(<HistoryScreen />, { runs: [RUN_3, RUN_2, RUN_1], pinnedRunId: null });
    const rows = screen.getAllByRole('listitem');
    // Position, not presence: a screen that rendered the log reversed would pass a
    // test that only asserted all three runs appear somewhere.
    expect(rows[0].textContent).toContain('Run 3');
    expect(rows[2].textContent).toContain('Run 1');
  });

  it('calls the real first pull "first pull"', () => {
    mountWithResult(<HistoryScreen />, { runs: [RUN_1], pinnedRunId: null });
    expect(screen.getByText('first pull')).toBeTruthy();
  });

  it('does not call a capped-off log\'s oldest VISIBLE row "first pull" when it is not run 1', () => {
    // Once the log caps at RUN_LIMIT, the bottom row has no `prev` either, at
    // whatever `n` it happens to be — `prev === undefined` alone is not "this was
    // the career's first pull".
    const oldButNotFirst = { ...RUN_1, id: 'old', n: 137 };
    mountWithResult(<HistoryScreen />, { runs: [oldButNotFirst], pinnedRunId: null });
    expect(screen.queryByText('first pull')).toBeNull();
  });

  it('signs a gain over the previous run as positive', () => {
    // RUN_3 is 340 whp, RUN_2 is 320: a real 20 whp gain must read "+20", not "-20".
    mountWithResult(<HistoryScreen />, { runs: [RUN_3, RUN_2], pinnedRunId: null });
    expect(screen.getByText(/\+20 whp vs Run 2/)).toBeTruthy();
  });

  it('signs a loss under the previous run as negative', () => {
    // The converse ordering of the same two fixtures — RUN_2 (320) now the current
    // run, RUN_3 (340) the one before it — so a real 20 whp loss must read "-20".
    mountWithResult(<HistoryScreen />, { runs: [RUN_2, RUN_3], pinnedRunId: null });
    expect(screen.getByText(/-20 whp vs Run 3/)).toBeTruthy();
  });

  it("shows each run's engine label, so a swap does not read as an unexplained gain", () => {
    // APPLY_PRESET clears `result` but keeps `runs`, so a pull right after an LS -> VQ
    // swap can sit next to a run banked on the old engine. `label` is the only cue
    // that tells the two apart.
    const LS_RUN = { ...RUN_1, id: 'ls', n: 1, label: 'LS3', peakHp: 300 };
    const VQ_RUN = { ...RUN_1, id: 'vq', n: 2, label: 'VQ35DE', peakHp: 420 };
    mountWithResult(<HistoryScreen />, { runs: [VQ_RUN, LS_RUN], pinnedRunId: null });
    expect(screen.getByText('LS3')).toBeTruthy();
    expect(screen.getByText('VQ35DE')).toBeTruthy();
  });

  it('names what changed between a run and the one before it', () => {
    mountWithResult(<HistoryScreen />, { runs: [RUN_BOOSTED, RUN_1], pinnedRunId: null });
    expect(screen.getByText(/boost curve/)).toBeTruthy();
  });

  it('says nothing changed when nothing did', () => {
    // The other half of the diff pair. A screen that always rendered the "changed"
    // line would pass the test above while telling the player a clean re-run had
    // altered their build.
    mountWithResult(<HistoryScreen />, { runs: [{ ...RUN_1, id: 'e', n: 2 }, RUN_1], pinnedRunId: null });
    expect(screen.queryByText(/Changed since/)).toBe(null);
  });

  it('pins a run and unpins the same run', () => {
    // Both directions through one control, so a handler that only ever dispatched
    // PIN_RUN would fail the second half.
    mountWithResult(<HistoryScreen />, { runs: [RUN_2, RUN_1], pinnedRunId: null });
    // Full literals, not substrings: "Unpin run 1" CONTAINS "Pin run 1", so a loose
    // matcher would happily find the wrong button and still pass.
    fireEvent.click(screen.getByRole('button', { name: 'Pin run 1 as the comparison' }));
    expect(screen.getByRole('button', { name: 'Unpin run 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unpin run 1' }));
    expect(screen.getByRole('button', { name: 'Pin run 1 as the comparison' })).toBeTruthy();
  });

  it('marks only the pinned row as pinned', () => {
    mountWithResult(<HistoryScreen />, { runs: [RUN_2, RUN_1], pinnedRunId: RUN_1.id });
    // Names the end, not just the count: an implementation that marked runs[0]
    // pinned whenever anything is pinned would produce the same 1/1 counts below.
    expect(screen.getByRole('button', { name: 'Unpin run 1' })).toBeTruthy();
    // Anchored for the same reason: /pin run/i matches "Unpin run 1" as well, and
    // would count two where the answer is one.
    expect(screen.getAllByRole('button', { name: /^Unpin run/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Pin run/ })).toHaveLength(1);

    // `data-pinned` is the row's only visual mark and is otherwise asserted
    // nowhere. Rows render newest first, so index 0 is RUN_2 (unpinned) and
    // index 1 is RUN_1 (the pinned one).
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].getAttribute('data-pinned')).toBe('false');
    expect(rows[1].getAttribute('data-pinned')).toBe('true');
  });
});

describe('ResultScreen event bands', () => {
  /** @type {import('../../src/ui/components/eventBands.js').EventBand[]} */
  const BANDS = [
    { id: 'knock-4200-5100', rpmStart: 4200, rpmEnd: 5100, tone: 'danger', msg: 'Knock across 4200-5100' },
    { id: 'lean-6100-6600', rpmStart: 6100, rpmEnd: 6600, tone: 'warn', msg: 'Lean mixture' },
  ];
  const CHART = [{ rpm: 1500, hp: 111, torque: 222 }];

  it('draws one focusable band per event, on both charts', () => {
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={() => {}} />);
    // Two charts share the axis, so each band appears twice — that duplication is the
    // feature, not an accident, and asserting the count pins it.
    expect(screen.getAllByRole('button', { name: /Knock across 4200-5100, 4200 to 5100 RPM/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Lean mixture, 6100 to 6600 RPM/ })).toHaveLength(2);
  });

  it('draws no bands when there are none', () => {
    // The other half — an implementation that always rendered something would pass the
    // test above.
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={[]} onSelectRpm={() => {}} />);
    expect(screen.queryAllByRole('button', { name: / RPM$/ })).toHaveLength(0);
  });

  it('activates a band from the keyboard, at an RPM inside its own span', () => {
    // The keyboard path is asserted directly rather than assumed from the mouse path —
    // testing one side of that pair and trusting the other is the exact shape this
    // project keeps shipping.
    const seen = [];
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={(r) => seen.push(r)} />);
    fireEvent.keyDown(screen.getAllByRole('button', { name: /Knock across/ })[0], { key: 'Enter' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(4200);
    expect(seen[0]).toBeLessThanOrEqual(5100);
  });

  it('ignores a key that is not Enter or Space', () => {
    const seen = [];
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={(r) => seen.push(r)} />);
    fireEvent.keyDown(screen.getAllByRole('button', { name: /Knock across/ })[0], { key: 'ArrowRight' });
    expect(seen).toEqual([]);
  });

  it('shows the whole-pull note only when such findings exist', () => {
    const { rerender } = mount(
      <ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} wholePullCount={3} onSelectRpm={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /3 findings apply to the whole pull/ })).toBeTruthy();
    rerender(
      <StoreProvider>
        <ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} wholePullCount={0} onSelectRpm={() => {}} />
      </StoreProvider>,
    );
    expect(screen.queryByRole('button', { name: /apply to the whole pull/ })).toBe(null);
  });

  it('sends null when the whole-pull note is activated', () => {
    // Null means "open the log with nothing highlighted", which is distinct from any
    // RPM — a note that sent a number would highlight arbitrary events.
    const seen = [];
    mount(<ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={[]} wholePullCount={2} onSelectRpm={(r) => seen.push(r)} />);
    fireEvent.click(screen.getByRole('button', { name: /2 findings apply to the whole pull/ }));
    expect(seen).toEqual([null]);
  });
});

describe('ResultScreen chart click (mouse)', () => {
  // The keyboard path above is asserted directly; this is its other half — clicking
  // the chart itself, which is how `handleChartClick` in ResultScreen.jsx actually
  // gets exercised. `resolveBandRpm` is unit-tested on its own, but nothing before
  // this pinned that it is wired to `state?.activeLabel` (not e.g. `activeIndex`), or
  // that both `<LineChart>`s carry the `onClick`, rather than just the first.
  //
  // recharts resolves a click to the nearest actual DATA POINT under the pointer, not
  // to a continuous axis value — with only one point (as the band tests above use)
  // every click resolves to that one point regardless of where it lands, which would
  // make a click position irrelevant to the outcome. This needs several points spread
  // across the axis so a click can land near one inside a band and one outside it.
  const CHART = [
    { rpm: 1500, hp: 50, torque: 100 },
    { rpm: 2500, hp: 80, torque: 150 },
    { rpm: 3500, hp: 110, torque: 200 },
    { rpm: 4500, hp: 140, torque: 220 },
    { rpm: 5500, hp: 160, torque: 210 },
    { rpm: 6500, hp: 170, torque: 190 },
    { rpm: 7300, hp: 165, torque: 170 },
  ];
  /** @type {import('../../src/ui/components/eventBands.js').EventBand[]} */
  const BANDS = [
    { id: 'knock-4200-5100', rpmStart: 4200, rpmEnd: 5100, tone: 'danger', msg: 'Knock across 4200-5100' },
  ];

  /**
   * Clicks the middle of the rendered knock band on the given chart (0 = POWER/TORQUE,
   * 1 = AFR/TIMING). The band's own rendered `<rect>` (found by the `data-tone`
   * attribute `Band` sets in ResultScreen.jsx) gives the real on-screen position to
   * click, rather than a pixel guess — recharts then snaps the click to the nearest
   * data point, which for this CHART is the rpm:4500 point, inside 4200-5100.
   * @param {HTMLElement} container
   * @param {number} chartIndex
   */
  function clickBand(container, chartIndex) {
    const rect = container.querySelectorAll('rect[data-tone="danger"]')[chartIndex];
    const x = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
    const y = Number(rect.getAttribute('y'));
    const wrapper = container.querySelectorAll('.recharts-wrapper')[chartIndex];
    fireEvent.click(wrapper, { clientX: x, clientY: y });
  }

  /**
   * Clicks the chart's plot background, just inside its left edge — the rpm:1500
   * point, outside every band — on the given chart. Same DOM-derived-position
   * approach as `clickBand`, off the plot's own background rect instead of a band's.
   * @param {HTMLElement} container
   * @param {number} chartIndex
   */
  function clickOutsideBands(container, chartIndex) {
    const rect = container.querySelectorAll('svg.recharts-surface rect:not([data-tone])')[chartIndex];
    const x = Number(rect.getAttribute('x')) + 2;
    const y = Number(rect.getAttribute('y'));
    const wrapper = container.querySelectorAll('.recharts-wrapper')[chartIndex];
    fireEvent.click(wrapper, { clientX: x, clientY: y });
  }

  it("calls onSelectRpm with an RPM inside the clicked band's span", () => {
    const seen = [];
    const { container } = mount(
      <ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={(r) => seen.push(r)} />,
    );
    clickBand(container, 0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(4200);
    expect(seen[0]).toBeLessThanOrEqual(5100);
  });

  it('does not call onSelectRpm for a click outside every band', () => {
    // The other half — without this, a handler that fired unconditionally on every
    // click would still pass the test above.
    const seen = [];
    const { container } = mount(
      <ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={(r) => seen.push(r)} />,
    );
    clickOutsideBands(container, 0);
    expect(seen).toEqual([]);
  });

  it('wires the click handler to both charts, not just the first', () => {
    // The regression this whole describe block exists for: wiring `onClick` onto only
    // the POWER/TORQUE `<LineChart>` would still pass both tests above.
    const seen = [];
    const { container } = mount(
      <ResultScreen chartData={CHART} engineDerived={{ redline: 7000 }} bands={BANDS} onSelectRpm={(r) => seen.push(r)} />,
    );
    clickBand(container, 0);
    clickBand(container, 1);
    expect(seen).toHaveLength(2);
    for (const rpm of seen) {
      expect(rpm).toBeGreaterThanOrEqual(4200);
      expect(rpm).toBeLessThanOrEqual(5100);
    }
  });
});
