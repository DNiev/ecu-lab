// @vitest-environment jsdom

/**
 * The two BUILD-slice fields that are cursors, not hardware.
 *
 * Thirteen of the fifteen fields in the build slice are hardware or ECU configuration:
 * a hand edit to any of them means the build is no longer the factory preset it was
 * loaded from, so `SET_BUILD_FIELD` clears `presetId` and the header stops naming that
 * preset. `boostSel` (which RPM column the boost editor has selected) and
 * `presetPrompt` (whether the overwrite-confirmation dialog is open) live in the same
 * slice but are NOT that — they are a cursor and a piece of dialog state. Routing
 * either through `SET_BUILD_FIELD` would make the header stop claiming the factory
 * preset because the player tapped an RPM column or opened a dialog.
 *
 * That is invisible to the characterisation tests, which never touch either control,
 * and it is invisible to the reducer tests, which prove SET_BOOST_SEL/SET_PRESET_PROMPT
 * preserve `presetId` but say nothing about which action EcuLab actually dispatches.
 * These tests close that gap: they drive the real controls and read the real header.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, ENGINE_PRESETS, OCTANE_OPTS, TURBINE_OPTS,
  applyPreset, computeHardwareVE, turbineWithCount,
} from '../../src/sim/index.js';
import { LOAD, RPM } from '../../src/sim/tables.js';
import EcuLab, { EcuLabApp } from '../../src/ui/EcuLab.jsx';
import { Bar } from '../../src/ui/primitives/Bar.jsx';
import { StoreProvider, useBuild, useTune } from '../../src/ui/state/StoreProvider.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';

// jsdom has no ResizeObserver. recharts' <ResponsiveContainer> (used on the DYNO
// results panel) needs one to mount at all, so any test that reaches a rendered
// dyno result throws an uncaught ReferenceError from inside react-dom's commit
// phase without this stub. Same approach as characterisation.test.jsx.
// observe/unobserve/disconnect are no-ops: the tests below never depend on a
// resize callback firing, only on the chart mounting.
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
 * The preset picker is the only select with optgroups.
 * @returns {HTMLSelectElement}
 */
function presetPicker() {
  return /** @type {HTMLSelectElement[]} */ (screen.getAllByRole('combobox'))
    .find((el) => el.querySelector('optgroup'));
}

/**
 * The header line is `${engineName} · ${turbo} · ${octane} oct · ...`, where
 * `engineName` is the loaded preset's name if one is loaded and a derived "3.0L I6"
 * form if not. Its leading segment is therefore exactly the thing `presetId` drives.
 *
 * Queries by `data-testid="build-line"` rather than `getByText(/oct/)`: BUILD's
 * accordion sections stay mounted when collapsed, and FuelSystemScreen's octane
 * explainer prose also contains "oct", which made the old text query ambiguous
 * once that section existed.
 * @returns {string}
 */
function headerEngineName() {
  return screen.getByTestId('build-line').textContent.split('·')[0].trim();
}

/** Renders the app and clicks past the start screen. */
function launch() {
  const view = render(<EcuLab />);
  // The start screen offers CAREER, SANDBOX and TUTORIAL on this branch rather than a
  // single START. SANDBOX is the free-play entry the old button was.
  // The start screen offers CAREER, SANDBOX and TUTORIAL rather than a single START.
  // SANDBOX is the free-play entry the old button was.
  fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
  return view;
}

/** Loads the first preset the picker offers and returns the header name it produced. */
function loadFirstPreset() {
  const picker = presetPicker();
  const target = [...picker.querySelectorAll('option')]
    .map((o) => o.value)
    .find((v) => v && v !== picker.value);
  fireEvent.change(picker, { target: { value: target } });
  return headerEngineName();
}

describe('moving the boost-curve cursor', () => {
  it('does not stop the header claiming the factory preset', () => {
    launch();
    const preset = loadFirstPreset();
    // Guard the setup rather than trusting it: if loading the preset silently failed,
    // presetId would be null before the click and the assertion below would pass for
    // the wrong reason.
    expect(preset).not.toMatch(/^\d\.\dL /);

    const columns = within(screen.getByTestId('boost-columns')).getAllByRole('button');
    // The selected RPM appears in the editor's readout under the bars. Reading it
    // before and after proves the click actually MOVED the cursor — without that, a
    // click that hit nothing would leave the header intact and the test would pass
    // while proving nothing.
    const selectedRpm = () => screen.getByText(/^\d+ RPM$/).textContent;
    const before = selectedRpm();
    const moved = columns.some((col) => {
      fireEvent.click(col);
      return selectedRpm() !== before;
    });
    expect(moved).toBe(true);

    expect(headerEngineName()).toBe(preset);
  });
});

describe('moving the tune-grid cursor', () => {
  it('does not stop the header claiming the factory preset', () => {
    // The twin of the boost-cursor test above: `setSelection` on the TUNE grid
    // dispatches SET_TUNE_FIELD (a cursor move), not SET_TABLE (a calibration edit
    // that clears presetId and flags tablesDirty). Selecting a grid cell must not
    // disown a loaded preset or trip the overwrite-confirmation prompt.
    launch();
    const preset = loadFirstPreset();
    // Guard the setup rather than trusting it: if loading the preset silently failed,
    // presetId would be null before the click and the assertion below would pass for
    // the wrong reason.
    expect(preset).not.toMatch(/^\d\.\dL /);

    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    const grid = within(screen.getByTestId('tuning-grid'));
    // TuningGrid renders, in DOM order: RPM.length column-header buttons (each
    // itself a numeric label, so a text-pattern filter can't tell them apart from
    // data cells), then one row per LOAD entry — a numeric row-header button
    // followed by RPM.length data-cell buttons. Slicing by that known layout is
    // what actually isolates the data cells; text content alone can collide (a VE
    // cell can legitimately read "100", same as a LOAD header).
    const allButtons = grid.getAllByRole('button');
    const dataCells = [];
    let idx = RPM.length;
    for (let row = 0; row < LOAD.length; row += 1) {
      idx += 1; // row-header button
      for (let col = 0; col < RPM.length; col += 1) { dataCells.push(allButtons[idx]); idx += 1; }
    }

    // Selecting a grid cell mounts the SelectionDock, whose readout line names the
    // selected cell's coordinates: "<rpm> RPM · <map> kPa MAP". Reading it after two
    // DIFFERENT cell clicks and confirming it changed proves the clicks actually
    // MOVED the cursor — without that, a click that hit nothing (or landed on the
    // same cell twice) would leave the header intact and the test would pass while
    // proving nothing.
    const cellLabel = () => within(screen.getByTestId('selection-dock'))
      .getByText(/^\d+ RPM · \d+ kPa MAP$/).textContent;

    fireEvent.click(dataCells[0]);
    const first = cellLabel();
    fireEvent.click(dataCells[dataCells.length - 1]);
    const second = cellLabel();
    expect(second).not.toBe(first);

    expect(headerEngineName()).toBe(preset);
  });
});

/**
 * A probe that hands the store's dispatch back to the test, so it can put the build
 * into a state the UI's own guards cannot reach (see below).
 * @param {{onReady: (dispatch: React.Dispatch<*>) => void}} props
 * @returns {null}
 */
function DispatchProbe({ onReady }) {
  const [, dispatch] = useBuild();
  // In an effect, not in render: a render-phase callback fires on every render and
  // twice under StrictMode.
  React.useEffect(() => { onReady(dispatch); }, [onReady, dispatch]);
  return null;
}

describe('opening and dismissing the overwrite prompt', () => {
  it('does not stop the header claiming the factory preset', () => {
    // `presetId` set AND unsaved calibration work pending is unreachable through the
    // UI alone: every path that flags `tablesDirty` also clears `presetId`, so the
    // prompt only ever opens on a build the header already shows as custom. The
    // combination is still worth pinning — it is one guard away from reachable, and
    // it is the state in which routing `presetPrompt` through SET_BUILD_FIELD does
    // visible damage. So mount the app body inside a store this test owns, and seed
    // that half of the state directly.
    /** @type {React.Dispatch<*>} */
    let dispatch;
    render(
      <StoreProvider>
        <DispatchProbe onReady={(d) => { dispatch = d; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));

    // Hand-edit a calibration table: this is what sets `tablesDirty`, which is what
    // makes choosePreset offer the prompt instead of loading straight away.
    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    const grid = within(screen.getByTestId('tuning-grid'));
    const cells = grid.getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent));
    fireEvent.click(cells[Math.floor(cells.length / 2)]);
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));
    fireEvent.click(screen.getByRole('button', { name: /BUILD/ }));

    // Now put a preset label back on the build. APPLY_PRESET also clears the store's
    // `tune.tablesDirty` (it moved into the store in Task 5, along with the rest of the
    // tune slice) — a fresh factory calibration is not unsaved player work. That is
    // correct behaviour, but it undoes this test's setup: the hand edit above no longer
    // leaves any unsaved work behind once a preset is loaded on top of it. So re-flag
    // `tablesDirty` directly afterwards, via the one action built for exactly this seam:
    // `SET_TUNE_FIELD` deliberately does NOT clear `presetId` (unlike SET_TABLE), so it
    // can put the store back into "preset loaded, unsaved work pending" — the combination
    // this test exists to pin — without going through another hand edit that would just
    // clear the preset label again.
    const seed = ENGINE_PRESETS[0];
    act(() => dispatch({ type: ACTIONS.APPLY_PRESET, preset: applyPreset(seed) }));
    act(() => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'tablesDirty', value: true }));
    expect(headerEngineName()).toBe(seed.name);

    // Choosing a different preset with work pending opens the prompt rather than
    // loading. The prompt is dialog state, not a hardware edit: the build has not
    // changed, so the header must still name the preset it is running.
    const picker = presetPicker();
    const other = [...picker.querySelectorAll('option')]
      .map((o) => o.value)
      .find((v) => v && v !== seed.id && v !== '__custom__');
    fireEvent.change(picker, { target: { value: other } });
    expect(screen.getByRole('button', { name: /^LOAD / })).toBeTruthy();
    expect(headerEngineName()).toBe(seed.name);

    // Backing out of the prompt is not a hardware edit either.
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('button', { name: /^LOAD / })).toBeNull();
    expect(headerEngineName()).toBe(seed.name);
  });
});


/**
 * The Toggle primitive renders a `role="switch"` with the label as its accessible
 * name, so it can be reached directly rather than through the row's DOM shape.
 * @param {string} label
 * @returns {HTMLElement}
 */
function toggleFor(label) {
  return screen.getByRole('switch', { name: label });
}

/**
 * Reports the store's `tune` slice to the test on every change.
 * @param {{onTune: (tune: *) => void}} props
 * @returns {null}
 */
function TuneProbe({ onTune }) {
  const [tune] = useTune();
  React.useEffect(() => { onTune(tune); }, [onTune, tune]);
  return null;
}

/**
 * Reports the store's `build` slice to the test on every change.
 * @param {{onBuild: (build: *) => void}} props
 * @returns {null}
 */
function BuildProbe({ onBuild }) {
  const [build] = useBuild();
  React.useEffect(() => { onBuild(build); }, [onBuild, build]);
  return null;
}

describe('choosing a turbine', () => {
  it('drops the twin-turbo count the preset installed', () => {
    // SET_TURBINE resets `turbineCount` to 1 as well as setting `turbineIdx`, because
    // the count belongs to the preset's induction layout, not to the housing you just
    // picked. Route this control through SET_BUILD_FIELD and the count survives: a
    // twin count against a turbine chosen as a single, silently doubling the airflow
    // the sim is handed. Nothing else in the suite covers that.
    launch();
    const picker = presetPicker();
    const twin = ENGINE_PRESETS.find((p) => applyPreset(p).turbineCount > 1);
    expect(twin).toBeTruthy();
    fireEvent.change(picker, { target: { value: twin.id } });

    // The Induction summary is where the count is legible: it reads "Twin
    // <housing> turbine" above 1 and the bare housing name at 1.
    const inductionSummary = () => screen.getByText(/turbine · peak/).textContent;
    expect(inductionSummary()).toMatch(/Twin/);

    fireEvent.click(screen.getByText('Induction'));
    const current = TURBINE_OPTS[applyPreset(twin).turbineIdx].label;
    const other = TURBINE_OPTS.map((o) => o.label).find((l) => l !== current);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${other}`) }));

    expect(inductionSummary()).not.toMatch(/Twin/);
  });
});

describe('resetting the calibration to stock', () => {
  /**
   * Runs the app to a reset and reports the VE table the store received.
   * @param {boolean} withIntake whether to fit the intake first
   * @returns {number[][]}
   */
  function veAfterReset(withIntake) {
    // This helper runs TWICE inside one test, so the global per-test hash reset in
    // tests/setup.js is not enough: navigation lives in the URL now, and the second
    // call would otherwise boot straight into wherever the first call left off —
    // past the start screen the line below clicks. Setup only; nothing asserted here
    // changes.
    window.location.hash = '';
    /** @type {*} */
    let tune;
    render(
      <StoreProvider>
        <TuneProbe onTune={(t) => { tune = t; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    // Turbo on in BOTH runs, so the hardware half of the VE calculation is identical
    // and the only difference between them is the mod set.
    fireEvent.click(screen.getByText('Induction'));
    fireEvent.click(toggleFor('Turbo kit'));
    // `boltons` dissolved into Induction and Exhaust — the intake card is already in
    // the DOM once this section is mounted.
    if (withIntake) {
      fireEvent.click(screen.getByRole('button', { name: /Intake/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: /RESET ALL TO STOCK/ }));
    cleanup();
    return tune.ve;
  }

  it('rebuilds the VE table from STOCK mods, not the ones still bolted on', () => {
    // resetToStock passes computeHardwareVE(engineConfig, DEFAULT_MODS, hwForVe) —
    // DEFAULT_MODS for the mods argument, but the CURRENT hwForVe for hardware.
    // Wiping a calibration is not un-installing the turbo, and it is not un-bolting
    // the intake either: reset means "give me the stock BASELINE for this hardware",
    // so the table must come out the same whether or not parts are fitted.
    //
    // Change that DEFAULT_MODS to `mods` and the player gets a table calibrated for
    // bolt-ons the reset just told them it had discarded. The whole suite passes.
    expect(veAfterReset(true)).toEqual(veAfterReset(false));
  });

  it('can tell the two apart — the mods argument changes the table', () => {
    // Guards the test above. If mods made no difference to computeHardwareVE, the
    // equality assertion would hold no matter which argument the call site passed,
    // and would be proving nothing at all.
    const hw = {
      turboOn: true,
      turbine: turbineWithCount(TURBINE_OPTS[1], 1),
      exhaustDia: 3.0,
      fuel: OCTANE_OPTS[0],
      peakBoostPsi: 8,
    };
    const stock = computeHardwareVE(DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, hw);
    const modded = computeHardwareVE(DEFAULT_ENGINE_CONFIG, { ...DEFAULT_MODS, intake: true }, hw);
    expect(modded).not.toEqual(stock);
  });
});

describe('accepting a re-logged VE table', () => {
  it('rewrites the VE table on ACCEPT RE-LOGGED VALUES', () => {
    // recalcVE (EcuLab.jsx:663) is the ACCEPT RE-LOGGED VALUES button's dispatch.
    // Stub it out and the button silently does nothing — the player is told their
    // hardware and calibration are out of sync and handed a button that claims to
    // fix it, and nothing happens.
    /** @type {*} */
    let tune;
    render(
      <StoreProvider>
        <TuneProbe onTune={(t) => { tune = t; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));

    // Drift the hardware away from the stock VE table the store starts with, so
    // veAdvice.inSync goes false and the ACCEPT button actually renders.
    fireEvent.click(screen.getByText('Induction'));
    fireEvent.click(toggleFor('Turbo kit'));
    // `boltons` dissolved into Induction and Exhaust — the intake card is already in
    // the DOM once this section is mounted (BuildSection stays mounted collapsed too,
    // but opening it here matches how a real player would reach the card).
    fireEvent.click(screen.getByRole('button', { name: /Intake/ }));

    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));

    // Guard: the button only renders when the advisor actually sees a gap. If the
    // toggles above hadn't moved computeHardwareVE, this query would throw instead
    // of silently finding nothing, and the assertion below could never run for the
    // right reason.
    const acceptBtn = screen.getByRole('button', { name: 'ACCEPT RE-LOGGED VALUES' });
    const veBefore = tune.ve;

    fireEvent.click(acceptBtn);

    expect(tune.ve).not.toEqual(veBefore);
  });
});

describe('applying a fuel-trim histogram', () => {
  it('rewrites the VE table on APPLY CORRECTIONS TO VE', async () => {
    // applyHistogram (EcuLab.jsx:990) is the APPLY CORRECTIONS TO VE button's
    // dispatch. tests/regressions.test.js re-implements the histogram math directly
    // and never touches this button, so it LOOKS like coverage of this path and is
    // not. This drives the real control instead: fit hardware the stock VE table
    // doesn't match, run a dyno pull (the ECU fuels from the stale table while the
    // engine actually breathes the true one, so the pull logs a real mismatch),
    // build a histogram from it, and apply it.
    /** @type {*} */
    let tune;
    render(
      <StoreProvider>
        <TuneProbe onTune={(t) => { tune = t; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));

    fireEvent.click(screen.getByText('Induction'));
    fireEvent.click(toggleFor('Turbo kit'));
    // `boltons` dissolved into Induction and Exhaust — the intake card is already in
    // the DOM once this section is mounted (BuildSection stays mounted collapsed too,
    // but opening it here matches how a real player would reach the card).
    fireEvent.click(screen.getByRole('button', { name: /Intake/ }));

    fireEvent.click(screen.getByRole('button', { name: /DYNO/ }));
    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    // The reveal is a setInterval that ends by setting running false, which is what
    // uncovers the CURVES/PULL LOG/DATALOG/SCORE sub-tabs. Real timers + waitFor,
    // same approach as characterisation.test.jsx's dyno-pull test.
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );

    fireEvent.click(screen.getByRole('button', { name: 'DATALOG' }));
    fireEvent.click(screen.getByRole('button', { name: 'BUILD HISTOGRAM FROM THIS PULL' }));

    // Guard: BUILD HISTOGRAM swaps its own button for an APPLY/DISCARD pair only once
    // `histogram` is actually set. If that click's handler were missing, this query
    // would throw instead of silently finding nothing.
    const applyBtn = screen.getByRole('button', { name: 'APPLY CORRECTIONS TO VE' });
    const veBefore = tune.ve;

    fireEvent.click(applyBtn);

    expect(tune.ve).not.toEqual(veBefore);
  });
});

describe('choosing Custom build from the preset picker', () => {
  it('stops the header claiming the preset', () => {
    // clearPresetId (EcuLab.jsx:600) is CLEAR_PRESET_ID's only call site, reached by
    // choosing "Custom build" from the preset picker. The reducer case is tested;
    // this call site was not — stub the dispatch and choosing "Custom build" leaves
    // the header still naming the preset the player just disowned.
    launch();
    const preset = loadFirstPreset();
    expect(preset).not.toMatch(/^\d\.\dL /);

    fireEvent.change(presetPicker(), { target: { value: '__custom__' } });

    expect(headerEngineName()).toMatch(/^\d\.\dL /);
  });
});

describe('the injector-duty preview call site', () => {
  it('paints the Duty bar as dangerous, not healthy, once duty cycle has no headroom left', () => {
    // TUNE/readouts.test.jsx's describe('Bar') proves the PRIMITIVE inverts colour
    // correctly given higherIsBetter={false} — it renders Bar in isolation. It says
    // nothing about whether InjectorsScreen's own INJECTOR DUTY PREVIEW call site
    // (TUNE > Injectors, src/ui/screens/tune/InjectorsScreen.jsx) actually PASSES
    // that prop. A reviewer flipped it to higherIsBetter={true} — 95% duty, an
    // injector out of headroom and about to lean the mixture out, painted bright
    // green — and all existing tests, including the Bar unit tests, stayed green.
    // This drives the real app to a build that reaches a genuinely dangerous duty
    // cycle and reads the colour off the rendered bar.
    launch();

    // dutyPreview (EcuLab.jsx:331) is computed at WOT @ 6500 RPM. It scales inversely
    // with ecuInjectorCc (a fresh build already starts at 315cc, the smallest on the
    // menu, so no edit is needed there) and rises with airflow — so fit a turbo and
    // dial the boost target at 6500 RPM to its maximum.
    fireEvent.click(screen.getByRole('button', { name: /BUILD/ }));
    fireEvent.click(screen.getByText('Induction'));
    fireEvent.click(toggleFor('Turbo kit'));

    const columns = within(screen.getByTestId('boost-columns')).getAllByRole('button');
    fireEvent.click(columns[RPM.indexOf(6500)]);
    // Every collapsed BuildSection stays mounted (its content is hidden with
    // max-height, not unmounted — see BuildSection in EcuLab.jsx), so the Engine
    // Architecture section's five sliders are still in the DOM here alongside the
    // boost slider. max=25 is unique to the boost-curve range input.
    const slider = screen.getAllByRole('slider').find((s) => s.getAttribute('max') === '25');
    fireEvent.change(slider, { target: { value: '25' } });

    // The true VE the boosted hardware breathes is not what the ECU's calibration
    // table believes until the player accepts it — RESET ALL TO STOCK rebuilds the VE
    // table from the CURRENT hardware (hwForVe, which reads turboOn and boostCurve),
    // which is what lets dutyPreview's own VE lookup see the boosted cylinder filling
    // instead of the naturally-aspirated baseline it started on.
    fireEvent.click(screen.getByRole('button', { name: /RESET ALL TO STOCK/ }));

    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    fireEvent.click(screen.getByRole('button', { name: 'INJECTORS' }));

    const meter = screen.getByRole('meter', { name: 'Duty' });
    const dutyValue = Number(meter.getAttribute('aria-valuenow'));
    // Guard the setup rather than trusting it: utilisationColor's danger band is
    // strictly above 90. If the boost/injector combination above did not actually
    // push duty past that line, the colour assertion below could pass or fail for
    // the wrong reason.
    expect(dutyValue).toBeGreaterThan(90);

    // Compare against a Bar known to render dangerous, the same way
    // readouts.test.jsx's own describe('Bar') tests do, rather than a hardcoded
    // colour literal: jsdom normalizes an inline `background` to `rgb(...)`, so a
    // hex literal copied out of theme.js would never string-match what the DOM
    // actually holds.
    const dangerRef = render(<Bar label="Reference" value={20} max={100} />);
    const fill = /** @type {HTMLElement} */ (meter.querySelector('[data-fill]'));
    const refFill = /** @type {HTMLElement} */ (dangerRef.container.querySelector('[data-fill]'));
    expect(fill.style.background).toBe(refFill.style.background);
  });
});

/**
 * The segmented controls on screen right now.
 *
 * `role="group"` alone is not enough: `<optgroup>` carries that role implicitly, so the
 * preset picker's three manufacturer headings answer to it too. A Seg is the group whose
 * children are `aria-pressed` buttons.
 * @returns {HTMLElement[]}
 */
function segmentedControls() {
  return screen.queryAllByRole('group')
    .filter((g) => g.querySelector('button[aria-pressed]'));
}

/** Asserts every Seg on the current screen shows exactly one option as selected. */
function expectEverySegHasOneSelection() {
  const groups = segmentedControls();
  expect(groups.length).toBeGreaterThan(0);
  groups.forEach((group) => {
    // `label` is the group's accessible name and the primitive has no default. Drop it
    // at a call site and the control still renders, still works, and announces itself
    // as an unnamed group of buttons — so a screen-reader user hears the options with
    // no idea what choice they belong to. Counting selections alone does not see that.
    expect(group.getAttribute('aria-label')).toBeTruthy();
    const pressed = within(group).getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(1);
  });
  return groups.length;
}

describe('every segmented control', () => {
  it('shows exactly one option as selected, on every tab that has one', () => {
    // Seg's options changed shape from {value,label} to {id,label}. A call site left on
    // the old shape gives every option `id: undefined`, so `aria-pressed` is false on
    // ALL of them and `onChange` fires with undefined — the control renders, shows no
    // selection, and writes garbage into the build. EcuLab.jsx carries @ts-nocheck, so
    // neither lint nor tsc can see it, and the primitive's own tests render it in
    // isolation and never inspect what the app passes.
    //
    // Counting pressed options catches that without naming a single call site, so a
    // ninth Seg added later is covered the day it appears.
    launch();
    // launch() lands on BUILD. Every BuildSection accordion mounts unconditionally —
    // only `max-height` hides the collapsed ones — and jsdom's getByRole does not
    // treat `max-height: 0` as hidden (only display:none/hidden/aria-hidden are
    // excluded), so this first count already picks up every Seg on BUILD: three on
    // EngineScreen (Configuration, Block Material, Head Material), one on
    // InductionScreen (Compressor Size), one on FuelSystemScreen (Fuel Octane) and
    // one on ExhaustScreen (Exhaust Diameter) — six — regardless of which section is
    // open.
    let total = expectEverySegHasOneSelection();

    // The remaining two Segs are not on BUILD. ECU Injector Scaling is on TUNE >
    // Injectors, which is not the default sub-view, so it needs an explicit click.
    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    fireEvent.click(screen.getByRole('button', { name: 'INJECTORS' }));
    total += expectEverySegHasOneSelection();

    // DYNO's manifold-pressure picker (EcuLab.jsx) is the eighth and last, and is on
    // the default DYNO sub-view so no further click is needed to reach it.
    fireEvent.click(screen.getByRole('button', { name: /DYNO/ }));
    total += expectEverySegHasOneSelection();

    // Guard the sweep itself: if navigation silently failed, the per-tab assertions
    // above would each pass on whatever happened to be showing. Eight is the count of
    // <Seg> call sites across the app today — they live in the screen components now,
    // not in EcuLab.jsx (see the breakdown above) — confirmed by
    // `grep -rn '<Seg\b' src/ui | grep -v '\.module\.css'`.
    expect(total).toBe(8);
  });
});

describe('every toggle', () => {
  it('carries an accessible name at every call site', () => {
    // Toggle puts the name in `aria-label`, so dropping `label` leaves a switch that
    // renders, works, and announces itself unnamed. EcuLab.jsx carries @ts-nocheck and
    // Toggle's own tests render it in isolation, so nothing else would see it.
    //
    // This asserts `aria-label` directly and deliberately does NOT fall back to
    // textContent: the sub-label lives inside the same <button>, so textContent stays
    // truthy with the name gone and the fallback made the assertion unfailable. An
    // earlier version of this test had exactly that bug.
    launch();
    fireEvent.click(screen.getByText('Induction'));
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(1);
    switches.forEach((sw) => {
      expect(sw.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('installs the turbo when switched on, and reports it', () => {
    // The partner to the intercooler test below. Without this, breaking Turbo kit's
    // `checked` or `onChange` was caught only incidentally, by an unrelated duty-cycle
    // test whose threshold happens to need turboOn — change that number and a broken
    // turbo switch would pass the whole suite.
    launch();
    fireEvent.click(screen.getByText('Induction'));
    const summary = () => screen.getByText(/Not installed|turbine · peak/).textContent;
    expect(summary()).toBe('Not installed');

    fireEvent.click(screen.getByRole('switch', { name: /Turbo kit/ }));

    expect(screen.getByRole('switch', { name: /Turbo kit/ }).getAttribute('aria-checked')).toBe('true');
    // And it reached the build, not just the switch: the section summary reads turboOn.
    expect(summary()).toMatch(/turbine · peak/);
  });

  it('installs the intercooler when switched on, and reports it', () => {
    // The intercooler had no coverage at all, before this migration or after. It is
    // also the call site that lost a prop in the swap, so it is the one most likely to
    // have been broken by it.
    //
    // BoltonsScreen's dissolve removed the "N/4 installed" summary this test used to
    // read as its independent confirmation that the click reached `mods`, not just
    // the switch's own re-render — so a BuildProbe reads `mods.intercooler` off the
    // store directly instead, which is a strictly stronger check than the old count
    // (that count could stay right by coincidence if a DIFFERENT mod flipped).
    /** @type {*} */
    let build;
    render(
      <StoreProvider>
        <BuildProbe onBuild={(b) => { build = b; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByText('Induction'));
    const intercooler = screen.getByRole('switch', { name: /Intercooler/ });
    expect(intercooler.getAttribute('aria-checked')).toBe('false');
    expect(build.mods.intercooler).toBe(false);

    fireEvent.click(intercooler);

    expect(screen.getByRole('switch', { name: /Intercooler/ }).getAttribute('aria-checked')).toBe('true');
    // And it reached the build, not just the switch.
    expect(build.mods.intercooler).toBe(true);
  });
});
