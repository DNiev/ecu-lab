// @vitest-environment jsdom

/**
 * The four BUILD screens, mounted on their own.
 *
 * `characterisation.test.jsx` and `build-store.test.jsx` already drive all of this
 * through the whole app, and they are the tests that say BUILD still works. What
 * they cannot say is whether a screen is INDEPENDENT of the shell: every one of
 * them renders EcuLab, so a screen that had quietly kept reading a value the shell
 * passes down would look identical from there.
 *
 * These mount each screen with nothing but a store around it. A screen that needs
 * the shell to render fails here and only here — the same property
 * `dash-screens.test.jsx` pins for HOME.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ENGINE_CONFIG, MOD_INFO, deriveEngine } from '../../src/sim/index.js';
import { EngineScreen } from '../../src/ui/screens/build/EngineScreen.jsx';
import { ExhaustScreen } from '../../src/ui/screens/build/ExhaustScreen.jsx';
import { FuelSystemScreen } from '../../src/ui/screens/build/FuelSystemScreen.jsx';
import { InductionScreen } from '../../src/ui/screens/build/InductionScreen.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { StoreProvider, useBuild, useTune } from '../../src/ui/state/StoreProvider.jsx';

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

const noop = () => {};
const engineDerived = deriveEngine(DEFAULT_ENGINE_CONFIG);
const veAdvice = { inSync: true, maxAbs: 0 };

describe('EngineScreen', () => {
  it('reads the engine config off the store rather than off a prop', () => {
    mount(
      <EngineScreen active onToggle={noop} engineDerived={engineDerived} activePreset={null} veAdvice={veAdvice} onResetToStock={noop} />,
    );
    // Configuration comes straight from the store's default build, not a prop.
    expect(screen.getByRole('group', { name: 'Configuration' })).toBeTruthy();
    expect(screen.getByText('Custom build — every value below is yours to set. Pick a real engine above to start from a known-good factory configuration instead.')).toBeTruthy();
  });

  it('reports which section it is when its header is clicked', () => {
    const onToggle = vi.fn();
    mount(
      <EngineScreen active={false} onToggle={onToggle} engineDerived={engineDerived} activePreset={null} veAdvice={veAdvice} onResetToStock={noop} />,
    );
    fireEvent.click(screen.getByText('Engine Architecture'));
    expect(onToggle).toHaveBeenCalledWith('engine');
  });

  it('raises the stale-VE callout only when the shell says the tables are out of sync', () => {
    mount(
      <EngineScreen active onToggle={noop} engineDerived={engineDerived} activePreset={null} veAdvice={{ inSync: false, maxAbs: 12 }} onResetToStock={noop} />,
    );
    expect(screen.getByText(/Your VE table is now stale/)).toBeTruthy();
  });
  it('calls the shell-owned reset rather than doing it itself', () => {
    // RESET ALL TO STOCK lives beside the preset picker: both set the WHOLE build to a
    // known state. EngineScreen dispatches nothing of its own for it — the shell owns
    // the reset because it rebuilds the VE table from `hwForVe`, which several other
    // screens and the sim payload also read.
    const onResetToStock = vi.fn();
    mount(
      <EngineScreen
        active onToggle={noop} engineDerived={engineDerived} activePreset={null}
        veAdvice={veAdvice} onResetToStock={onResetToStock}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /RESET ALL TO STOCK/ }));
    expect(onResetToStock).toHaveBeenCalledTimes(1);
  });

});

describe('InductionScreen', () => {
  it('reveals the boost editor off the store once the turbo switch is on', () => {
    const { container } = mount(<InductionScreen active onToggle={noop} />);
    expect(screen.getByText('Not installed')).toBeTruthy();
    // The boost-columns block is always mounted and hidden with CSS (`data-open`),
    // the same hide-not-unmount contract BuildSection uses — so the buttons already
    // exist pre-click. Assert on `data-open` itself, which is what actually flips
    // with `turboOn`, rather than on button presence, which does not.
    const subPanel = container.querySelector('[data-open]');
    expect(subPanel.getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('switch', { name: /Turbo kit/ }));
    expect(subPanel.getAttribute('data-open')).toBe('true');
    expect(within(screen.getByTestId('boost-columns')).getAllByRole('button')).toHaveLength(8);
  });

  it('reports which section it is when its header is clicked', () => {
    const onToggle = vi.fn();
    mount(<InductionScreen active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('Induction'));
    expect(onToggle).toHaveBeenCalledWith('induction');
  });

  it('installs the intake bolt-on through the store when its card is clicked', () => {
    // `boltons` dissolved into this screen and ExhaustScreen — this is the induction
    // half's only card. If `installMod` were dropped or mis-wired on the move out of
    // BoltonsScreen, the card would render but the click would never flip
    // `data-installed`, and this would fail.
    mount(<InductionScreen active onToggle={noop} />);
    const install = screen.getAllByRole('button').find((b) => b.textContent.includes('INSTALL') && !/** @type {HTMLButtonElement} */ (b).disabled);
    fireEvent.click(install);
    expect(screen.getByText(MOD_INFO.intake.label).closest('button').getAttribute('data-installed')).toBe('true');
  });
});

describe('FuelSystemScreen', () => {

  it('offers a port injection kit only on a direct-injected engine', () => {
    function MakeDirect() {
      const [, dispatch] = useBuild();
      return <button type="button" onClick={() => dispatch({ type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch: { injection: 'direct' } })}>make direct</button>;
    }
    mount(<><MakeDirect /><FuelSystemScreen active onToggle={noop} /></>);
    expect(screen.queryByText('Port Injection Kit')).toBeNull();
    fireEvent.click(screen.getByText('make direct'));
    expect(screen.getByText('Port Injection Kit')).toBeTruthy();
  });
  it('sets the fuel octane on the build slice', () => {
    mount(<FuelSystemScreen active onToggle={noop} />);
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    expect(screen.getByRole('button', { name: '100' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not carry the ECU-side injector scaling across with the hardware', () => {
    // The hardware/calibration split is the whole point: what is FITTED lives here,
    // what the ECU BELIEVES is fitted lives on TUNE > Injectors. If the scaling Seg
    // came along with the PickList, the move flattened the distinction it exists for.
    mount(<FuelSystemScreen active onToggle={noop} />);
    expect(screen.queryByRole('button', { name: /RESCALE ECU/ })).toBeNull();
    expect(screen.queryByText('ECU Injector Scaling')).toBeNull();
  });

  it('sets the physical injector on the build slice', () => {
    // PickList carries no aria-pressed of its own (unlike Seg), so the dispatch
    // landing is checked through the header's `sub` line instead, which reads
    // straight off `INJECTOR_OPTS[injIdx]` — a value only the reducer, not this
    // screen, computes. `getByText` on the full string (not a `/650cc/` regex)
    // avoids also matching the PickList option button, which is still on screen
    // reading "650cc" after the click.
    mount(<FuelSystemScreen active onToggle={noop} />);
    expect(screen.getByText('91 · 315cc (stock)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '650cc' }));
    expect(screen.getByText('91 · 650cc')).toBeTruthy();
  });

  it('reports which section it is when its header is clicked', () => {
    const onToggle = vi.fn();
    mount(<FuelSystemScreen active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('Fuel System'));
    expect(onToggle).toHaveBeenCalledWith('fuel');
  });
});

describe('ExhaustScreen', () => {
  it('shows the shell-computed ideal diameter, not one it derived itself', () => {
    // Fabricated — not something the screen's own inputs (default store state)
    // could ever produce via `idealExhaustDiameter`. If the screen silently
    // re-derived the value instead of trusting the prop, this would fail.
    const ideal = 7.77;
    mount(<ExhaustScreen active onToggle={noop} idealExhaustDia={ideal} />);
    expect(screen.getByText(new RegExp(`~${ideal.toFixed(2)} in`))).toBeTruthy();
  });

  it('reports which section it is when its header is clicked', () => {
    const onToggle = vi.fn();
    mount(<ExhaustScreen active={false} onToggle={onToggle} idealExhaustDia={3} />);
    fireEvent.click(screen.getByText('Exhaust'));
    expect(onToggle).toHaveBeenCalledWith('exhaust');
  });

  it('installs the exhaust and headers bolt-ons through the store when their cards are clicked', () => {
    // The exhaust half of the dissolved BoltonsScreen — both remaining cards land
    // here. Clicking each in turn and reading `data-installed` back off the DOM
    // catches either card losing its `installMod` wiring on the move.
    mount(<ExhaustScreen active onToggle={noop} idealExhaustDia={3} />);
    fireEvent.click(screen.getByText(MOD_INFO.exhaust.label).closest('button'));
    fireEvent.click(screen.getByText(MOD_INFO.headers.label).closest('button'));
    expect(screen.getByText(MOD_INFO.exhaust.label).closest('button').getAttribute('data-installed')).toBe('true');
    expect(screen.getByText(MOD_INFO.headers.label).closest('button').getAttribute('data-installed')).toBe('true');
  });

});

describe('EngineScreen — the undo offer', () => {
  /** The prop bundle this file already uses for EngineScreen, at :47. */
  const props = {
    engineDerived, activePreset: null, veAdvice, onResetToStock: noop,
  };

  it('offers nothing before anything destructive has happened', () => {
    mount(<EngineScreen active onToggle={noop} {...props} />);
    expect(screen.queryByRole('button', { name: /^Undo / })).toBeNull();
  });

  it('offers to undo a preset load, naming the preset', () => {
    mount(<EngineScreen active onToggle={noop} {...props} />);
    const picker = /** @type {HTMLSelectElement[]} */ (screen.getAllByRole('combobox'))
      .find((el) => el.querySelector('optgroup'));
    const was = picker.value;
    const target = [...picker.querySelectorAll('option')]
      .map((o) => o.value)
      .find((v) => v && v !== picker.value);
    fireEvent.change(picker, { target: { value: target } });
    expect(picker.value).toBe(target);

    // The prefix regex above is the brief's own query, kept as-is. It is satisfied by
    // construction if the label is ever hardcoded wrong, so it is not enough on its
    // own — pin the FULL accessible name as a literal too, naming the preset actually
    // selected (`target` resolves to 'vq35de-revup', the default engine).
    expect(screen.getByRole('button', { name: 'Undo Preset · Nissan VQ35DE Rev-Up' })).toBeTruthy();
    // The visible sentence and the button's visible label are the only things a
    // sighted player reads — every query above goes through `aria-label`, so nothing
    // else pins them. Literal text, not derived from anything the component reads.
    expect(screen.getByText(
      'Preset · Nissan VQ35DE Rev-Up replaced your tune. Undo restores the tables and hardware as they were before it.',
    )).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Undo Preset · / }).textContent).toBe('UNDO');

    fireEvent.click(screen.getByRole('button', { name: /^Undo Preset · / }));

    // The offer going away is NOT sufficient evidence: a button that dispatches
    // nothing and merely hides the Note passes that assertion too. Assert the preset
    // load was actually reversed.
    expect(picker.value).toBe(was);
    // Undone: the offer goes with it, because the top of the stack is gone.
    expect(screen.queryByRole('button', { name: /^Undo Preset · / })).toBeNull();
  });

  it('offers to undo a reset to stock, naming it', () => {
    // The Note appears for a preset load OR a reset — both are the destructive acts
    // this offer exists for. Testing only the preset case would let an implementation
    // that matches on `Preset · ` alone pass while leaving the reset, which throws
    // away EVERYTHING, with no offer at all.
    //
    // `onResetToStock` is a PROP, so the shared `props` object's `noop` would dispatch
    // nothing and this test would pass without a reset ever happening. Wire a real one
    // the way EcuLab.jsx does. `ve` is supplied by the caller, not the reducer — the
    // current table is fine here, since what is under test is the history entry, not
    // which numbers a reset computes.
    function WithRealReset() {
      const [tune, dispatch] = useTune();
      return (
        <EngineScreen
          active onToggle={noop} {...props}
          onResetToStock={() => dispatch({ type: ACTIONS.RESET_TO_STOCK, ve: tune.ve })}
        />
      );
    }
    mount(<WithRealReset />);
    const picker = /** @type {HTMLSelectElement[]} */ (screen.getAllByRole('combobox'))
      .find((el) => el.querySelector('optgroup'));
    const target = [...picker.querySelectorAll('option')]
      .map((o) => o.value)
      .find((v) => v && v !== picker.value);
    fireEvent.change(picker, { target: { value: target } });
    expect(picker.value).toBe(target);

    fireEvent.click(screen.getByRole('button', { name: /RESET ALL TO STOCK/i }));
    // The reset cleared presetId, so the picker no longer names the preset.
    expect(picker.value).not.toBe(target);

    // The visible sentence and the button's visible label, pinned as literals — the
    // 'Reset to stock' label shape, not the 'Preset · ' one covered above.
    expect(screen.getByText(
      'Reset to stock replaced your tune. Undo restores the tables and hardware as they were before it.',
    )).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo Reset to stock' }).textContent).toBe('UNDO');

    fireEvent.click(screen.getByRole('button', { name: 'Undo Reset to stock' }));

    // The reset is reversed, so the preset it wiped is selected again.
    expect(picker.value).toBe(target);
  });

  it('withdraws the offer once a later edit sits on top of the preset load', () => {
    // The offer reads the TOP of the stack — `past[past.length - 1]`. Every other test
    // here creates at most ONE entry before looking, so `past[0]` would satisfy all of
    // them while reversing the wrong thing. This is the discriminator: after a table
    // edit lands on top, the top is a 'VE edit', the button would no longer undo the
    // preset load, and offering it would be a lie about what the click does.
    function WithTableEdit() {
      const [tune, dispatch] = useTune();
      return (
        <>
          <button onClick={() => dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: tune.ve })}>
            EDIT VE
          </button>
          <EngineScreen active onToggle={noop} {...props} />
        </>
      );
    }
    mount(<WithTableEdit />);
    const picker = /** @type {HTMLSelectElement[]} */ (screen.getAllByRole('combobox'))
      .find((el) => el.querySelector('optgroup'));
    const target = [...picker.querySelectorAll('option')]
      .map((o) => o.value)
      .find((v) => v && v !== picker.value);
    fireEvent.change(picker, { target: { value: target } });
    // The offer is up, so its disappearance below cannot be a false negative.
    // `getByRole` already throws if the element is absent, so a bare `.toBeTruthy()`
    // here would assert nothing beyond the query itself — pin the actual accessible
    // name as a literal instead, so this line carries real weight.
    expect(screen.getByRole('button', { name: /^Undo Preset · / }).getAttribute('aria-label'))
      .toBe('Undo Preset · Nissan VQ35DE Rev-Up');

    fireEvent.click(screen.getByRole('button', { name: 'EDIT VE' }));

    expect(screen.queryByRole('button', { name: /^Undo / })).toBeNull();
  });

  it('does not offer undo for a plain hardware change', () => {
    // Hardware writes are not undoable, so an offer here would be a lie about what the
    // button does. "Block Material" is a Seg on this screen (`EngineScreen.jsx:242`)
    // that dispatches SET_ENGINE_CONFIG_PATCH — a hardware write, not a calibration one.
    mount(<EngineScreen active onToggle={noop} {...props} />);
    const materials = within(screen.getByRole('group', { name: 'Block Material' }));
    fireEvent.click(materials.getByRole('button', { name: 'Cast Iron' }));
    // Without this, a neutered `onChange` that writes nothing would pass the assertion
    // below too — it would just be "nothing happened" rather than "a real hardware
    // write happened and produced no offer". `Seg` reflects the store's value back as
    // `aria-pressed`, so this proves the click actually reached the reducer.
    expect(materials.getByRole('button', { name: 'Cast Iron' }).getAttribute('aria-pressed')).toBe('true');
    expect(materials.getByRole('button', { name: 'Aluminum' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: /^Undo / })).toBeNull();
  });
});

describe('the dissolved Bolt-On Parts section', () => {
  it('leaves no bolt-on without a screen', () => {
    // `boltons` dissolved into Induction and Exhaust. A fourth mod added to MOD_INFO
    // later would otherwise be installable by nothing — this fails the day that
    // happens. It also fails the other way: if a mod were rendered on BOTH screens
    // (e.g. left behind on Induction after also being added to Exhaust), the merged
    // list would contain a duplicate key and the sorted-array equality would no
    // longer match Object.keys(MOD_INFO)'s sorted, deduplicated list.
    mount(<InductionScreen active onToggle={noop} />);
    const onInduction = Object.keys(MOD_INFO).filter((k) => screen.queryByText(MOD_INFO[k].label));
    cleanup();
    mount(<ExhaustScreen active onToggle={noop} idealExhaustDia={2.5} />);
    const onExhaust = Object.keys(MOD_INFO).filter((k) => screen.queryByText(MOD_INFO[k].label));
    expect([...onInduction, ...onExhaust].sort()).toEqual(Object.keys(MOD_INFO).sort());
  });
});
