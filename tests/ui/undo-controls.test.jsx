// @vitest-environment jsdom

/**
 * The undo/redo pair on TUNE's table screens.
 *
 * The load-bearing test here is the last one: it drives the REAL app through a preset
 * load, a table edit and a click on the real button, and asserts the header goes back
 * to claiming the preset. That fails for any implementation which restores the 48
 * numbers but forgets `presetId` — the exact defect a table-only history would ship.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import EcuLab from '../../src/ui/EcuLab.jsx';
import { SelectionDock } from '../../src/ui/components/SelectionDock.jsx';
import { UndoControls } from '../../src/ui/components/UndoControls.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { StoreProvider, useHistory, useTune } from '../../src/ui/state/StoreProvider.jsx';

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

/** Dispatches one VE edit, so the undo stack is non-empty. */
function EditOnce() {
  const [, dispatch] = useTune();
  return (
    <button onClick={() => dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: [[42]] })}>
      EDIT
    </button>
  );
}

/** Dispatches one edit per table, so the stack holds three distinguishable entries. */
function EditThree() {
  const [, dispatch] = useTune();
  return (
    <>
      <button onClick={() => dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: [[1]] })}>
        EDIT VE
      </button>
      <button onClick={() => dispatch({ type: ACTIONS.SET_TABLE, table: 'timing', value: [[2]] })}>
        EDIT SPARK
      </button>
      <button onClick={() => dispatch({ type: ACTIONS.SET_TABLE, table: 'afr', value: [[3]] })}>
        EDIT FUEL
      </button>
    </>
  );
}

/** Renders the VE table's top-left cell, so a redo that actually replays SET_TABLE
 *  is directly observable, not just its label/disabled bookkeeping. */
function ReadVeCell() {
  const [tune] = useTune();
  return <div data-testid="ve-cell">{tune.ve[0][0]}</div>;
}

/** A bare SelectionDock over the store's timing table, with a cell pre-selectable. */
function EcuLabTuneHarness() {
  const [tune, dispatch] = useTune();
  return (
    <>
      <button onClick={() => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'cell', row: 0, col: 0 } })}>
        SELECT
      </button>
      <button onClick={() => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'cell', row: 1, col: 1 } })}>
        SELECT OTHER
      </button>
      {/* Same row as SELECT (row 0), a different column: isolates selKey's col
          component from its row component. */}
      <button onClick={() => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'cell', row: 0, col: 1 } })}>
        SELECT SAME ROW
      </button>
      {/* Same column as SELECT (col 0), a different row: the mirror isolation. */}
      <button onClick={() => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'cell', row: 3, col: 0 } })}>
        SELECT SAME COL
      </button>
      <button onClick={() => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'row', row: 0 } })}>
        SELECT ROW
      </button>
      <button onClick={() => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: { type: 'col', col: 0 } })}>
        SELECT COL
      </button>
      {/* The cell the first SELECT targets, so a test can assert WHICH value was
          committed rather than only how many entries were recorded. */}
      <output data-testid="cell">{tune.timing[0][0]}</output>
      {/* Row 0 in full, so a row-selection commit can be pinned across all 8 cells
          rather than spot-checked at one index. */}
      <output data-testid="row0">{JSON.stringify(tune.timing[0])}</output>
      {/* Column 0 in full (one entry per row), the mirror of row0 for a col-selection
          commit. */}
      <output data-testid="col0">{JSON.stringify(tune.timing.map((r) => r[0]))}</output>
      <SelectionDock
        data={tune.timing}
        setData={(value) => dispatch({ type: ACTIONS.SET_TABLE, table: 'timing', value })}
        selection={tune.selection} min={-5} max={50} decimals={0} unit="°"
        onClose={() => {}} kind="timing"
      />
    </>
  );
}

function mount() {
  return render(
    <StoreProvider>
      <UndoControls />
      <EditOnce />
    </StoreProvider>,
  );
}

function mountThree() {
  return render(
    <StoreProvider>
      <UndoControls />
      <EditThree />
    </StoreProvider>,
  );
}

const undoBtn = () => screen.getByRole('button', { name: /^(Undo|Nothing to undo)/ });
const redoBtn = () => screen.getByRole('button', { name: /^(Redo|Nothing to redo)/ });

describe('UndoControls', () => {
  it('starts with both buttons disabled', () => {
    // POSITIONAL, not by accessible name. `undoBtn()`/`redoBtn()` match on the very
    // strings this test asserts, so swapping the two fallbacks between the buttons
    // swapped which button each helper found and both literal assertions below held
    // against the wrong element — the test derived its subject from the string under
    // test and survived the exact mutation its comment names. The row renders undo
    // first (pinned by the document-order test below), and the third button belongs
    // to EditOnce.
    const { container } = mount();
    const [undo, redo] = /** @type {HTMLButtonElement[]} */ ([...container.querySelectorAll('button')]);
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    // The exact disabled-state strings, not just the prefix the query above
    // matches on.
    expect(undo.getAttribute('aria-label')).toBe('Nothing to undo');
    expect(redo.getAttribute('aria-label')).toBe('Nothing to redo');
    // The hover tooltip carries the same text as the accessible name. Derived on
    // purpose here — the literals are asserted two lines up, so this pins the
    // RELATIONSHIP. The populated case is pinned separately, below: in the empty
    // state a title frozen to the hardcoded fallback would satisfy this too.
    expect(undo.getAttribute('title')).toBe(undo.getAttribute('aria-label'));
    expect(redo.getAttribute('title')).toBe(redo.getAttribute('aria-label'));
  });

  it('renders undo before redo in DOM order', () => {
    const { container } = mount();
    const buttons = container.querySelectorAll('button');
    expect(buttons[0]).toBe(undoBtn());
    expect(buttons[1]).toBe(redoBtn());
  });

  it('keeps the tooltip tracking the entry once there is one to name', () => {
    // The empty-state test above pins title === aria-label, but BOTH are the
    // hardcoded fallback there, so a title that never tracks the entry passes it.
    // Literal, and taken after an edit, so the tooltip has to follow the label.
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'EDIT' }));
    expect(undoBtn().getAttribute('title')).toBe('Undo VE edit');
    fireEvent.click(undoBtn());
    expect(redoBtn().getAttribute('title')).toBe('Redo VE edit');
  });

  it('names what it would undo', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'EDIT' }));
    expect(undoBtn().getAttribute('aria-label')).toBe('Undo VE edit');
  });

  it('enables redo only after an undo', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'EDIT' }));
    expect(/** @type {HTMLButtonElement} */ (redoBtn()).disabled).toBe(true);
    fireEvent.click(undoBtn());
    expect(/** @type {HTMLButtonElement} */ (redoBtn()).disabled).toBe(false);
    expect(redoBtn().getAttribute('aria-label')).toBe('Redo VE edit');
  });

  it('redo actually replays the edit it names, not a no-op', () => {
    // The mirror of undo's own click-handler coverage: undoing then redoing the
    // same edit must bring the exact edited value back, not merely flip the
    // disabled flag redo's label already proves it tracks.
    render(
      <StoreProvider>
        <UndoControls />
        <EditOnce />
        <ReadVeCell />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'EDIT' }));
    expect(screen.getByTestId('ve-cell').textContent).toBe('42');
    fireEvent.click(undoBtn());
    expect(screen.getByTestId('ve-cell').textContent).not.toBe('42');
    fireEvent.click(redoBtn());
    expect(screen.getByTestId('ve-cell').textContent).toBe('42');
  });

  it('names the MOST RECENT edit to undo, not the oldest', () => {
    // past is a stack: VE then Spark then Fuel means Fuel is on top, and undo
    // reverses the top of the stack first. If the label read the wrong end, this
    // would say "Undo VE edit" instead.
    mountThree();
    fireEvent.click(screen.getByRole('button', { name: 'EDIT VE' }));
    fireEvent.click(screen.getByRole('button', { name: 'EDIT SPARK' }));
    fireEvent.click(screen.getByRole('button', { name: 'EDIT FUEL' }));
    expect(undoBtn().getAttribute('aria-label')).toBe('Undo Fuel edit');
  });

  it('names the NEXT redo after two undos, not the last one undone', () => {
    // Undoing Fuel then Spark leaves future = [Spark, Fuel] (head-first): Spark is
    // next in line to be replayed, so redo must name Spark, not Fuel.
    mountThree();
    fireEvent.click(screen.getByRole('button', { name: 'EDIT VE' }));
    fireEvent.click(screen.getByRole('button', { name: 'EDIT SPARK' }));
    fireEvent.click(screen.getByRole('button', { name: 'EDIT FUEL' }));
    fireEvent.click(undoBtn()); // undoes Fuel edit -> future = [Fuel]
    fireEvent.click(undoBtn()); // undoes Spark edit -> future = [Spark, Fuel]
    expect(redoBtn().getAttribute('aria-label')).toBe('Redo Spark edit');
  });

  it('puts the preset label back when a table edit is undone', () => {
    // The whole point of a snapshot spanning both slices, driven through the real app.
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));

    const picker = /** @type {HTMLSelectElement[]} */ (screen.getAllByRole('combobox'))
      .find((el) => el.querySelector('optgroup'));
    const target = [...picker.querySelectorAll('option')]
      .map((o) => o.value)
      .find((v) => v && v !== picker.value);
    fireEvent.change(picker, { target: { value: target } });
    // Loading over an untouched default asks for no confirmation, so the preset is on.
    expect(screen.getByTestId('build-line').textContent).not.toMatch(/^\d\.\dL /);

    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    const grid = within(screen.getByTestId('tuning-grid'));
    const cells = grid.getAllByRole('button')
      .filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent));
    fireEvent.click(cells[Math.floor(cells.length / 2)]);
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));

    // The edit disowned the preset: the header falls back to the derived "3.5L V6".
    expect(screen.getByTestId('build-line').textContent).toMatch(/^\d\.\dL /);

    fireEvent.click(undoBtn());

    // ...and undo gives it back. The negative regex alone would pass for ANY
    // preset restored, including the wrong one — this names the specific preset
    // the picker loaded (the first option in the first optgroup, the Nissan
    // group, over an untouched default store) so a restore that hands back a
    // different preset fails here instead of slipping through.
    expect(screen.getByTestId('build-line').textContent).not.toMatch(/^\d\.\dL /);
    expect(screen.getByTestId('build-line').textContent).toMatch(/^Nissan VQ35DE Rev-Up /);
  });

  it('Cmd+Z still undoes while the grid has focus (#105)', () => {
    // The grid now handles its own keys (+/- nudge the selection). The global undo
    // shortcut must still reach EcuLab's window handler from inside it, and must not be
    // read as a nudge on its way there.
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    const gridEl = screen.getByTestId('tuning-grid');
    const cell = within(gridEl).getByRole('button', { name: '3500 RPM, 100 kPa' });
    fireEvent.click(cell);
    const before = cell.textContent;
    gridEl.focus();
    fireEvent.keyDown(gridEl, { key: '=', code: 'Equal' });
    expect(cell.textContent).toBe(String(Number(before) + 1));
    fireEvent.keyDown(gridEl, { key: 'z', code: 'KeyZ', metaKey: true });
    expect(cell.textContent).toBe(before);
  });
});

describe('the dock slider commits once, on release', () => {
  /** Reports both stack depths into the DOM so a test can read them. */
  function Depth() {
    const [history] = useHistory();
    return (
      <>
        <output data-testid="depth">{history.past.length}</output>
        <output data-testid="redo-depth">{history.future.length}</output>
      </>
    );
  }

  it('records ONE history entry for a drag, not one per intermediate value', () => {
    // React maps onChange on a range input to the `input` event, so a real drag fires
    // it continuously — roughly 18 times from 12 to 30 degrees. Recorded naively, undo
    // would walk back one slider pixel at a time.
    //
    // Asserting the DEPTH is the point. Asserting only the final table value would
    // pass just as well with eighteen entries recorded.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' }));
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '20' } });
    fireEvent.change(slider, { target: { value: '25' } });
    fireEvent.change(slider, { target: { value: '30' } });

    // Mid-drag: nothing committed yet.
    expect(screen.getByTestId('depth').textContent).toBe('0');

    fireEvent.pointerUp(slider);

    expect(screen.getByTestId('depth').textContent).toBe('1');
    // ...and it must commit the LAST draft, not the first. Depth alone cannot tell
    // those apart: an implementation that commits the value it saw when the drag
    // started records exactly one entry too, and would silently write 20 where the
    // player released at 30.
    expect(screen.getByTestId('cell').textContent).toBe('30');
  });

  it('commits on key release too, so the slider is usable from the keyboard', () => {
    // A keyboard user arrows the slider instead of dragging it. If only onPointerUp
    // commits, their edit is held in the draft forever and never reaches the table —
    // the control looks like it works and silently discards every change.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' }));
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '22' } });
    expect(screen.getByTestId('depth').textContent).toBe('0');

    fireEvent.keyUp(slider, { key: 'ArrowRight' });

    expect(screen.getByTestId('depth').textContent).toBe('1');
    expect(screen.getByTestId('cell').textContent).toBe('22');
  });

  it('does NOT commit anywhere in the FULL Cmd/Ctrl+Z sequence, modifier release included', () => {
    // EcuLab's global keydown handler blocks Cmd/Ctrl+Z on this INPUT, but the
    // matching KEYUPs still bubble here, and an unguarded keyup committed whatever
    // draft was pending — turning "press undo" into "commit an edit and burn an undo
    // slot".
    //
    // All FOUR events, in the order a browser really produces them. The earlier
    // version of this test fired only the middle two, and the guard it was written
    // against (`if (e.metaKey || e.ctrlKey) return;`) passed it while still committing
    // on the fourth: modifier flags on a keyup report the state AFTER the event, so
    // `metaKey` is FALSE on the release of Meta itself. Stopping at `keyup z` pins one
    // case and not the boundary between cases.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '42' } }); // drag with no pointerup
    expect(screen.getByTestId('depth').textContent).toBe('0');

    fireEvent.keyDown(slider, { key: 'Meta', metaKey: true });
    fireEvent.keyDown(slider, { key: 'z', metaKey: true });
    fireEvent.keyUp(slider, { key: 'z', metaKey: true });
    fireEvent.keyUp(slider, { key: 'Meta', metaKey: false });

    // The abandoned draft (42) must NOT have been committed.
    expect(screen.getByTestId('depth').textContent).toBe('0');
    expect(screen.getByTestId('cell').textContent).toBe('10');

    // Ctrl+Z (the Windows/Linux spelling) must be caught the same way, release of the
    // Control key included.
    fireEvent.keyDown(slider, { key: 'Control', ctrlKey: true });
    fireEvent.keyDown(slider, { key: 'z', ctrlKey: true });
    fireEvent.keyUp(slider, { key: 'z', ctrlKey: true });
    fireEvent.keyUp(slider, { key: 'Control', ctrlKey: false });
    expect(screen.getByTestId('depth').textContent).toBe('0');
    expect(screen.getByTestId('cell').textContent).toBe('10');
  });

  it('does NOT commit on the release of a key that cannot move a slider', () => {
    // The whitelist's other side. The guard names the keys that DO change a range
    // input's value, so every other release — Tab away, a letter typed with the
    // control focused, Shift on its own — must leave the draft alone. A blacklist
    // spelled as "not a modifier" would pass the Cmd+Z test above (once its fourth
    // event is handled) and still commit on all of these.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '42' } });

    for (const key of ['Tab', 'a', 'Shift', 'Enter', 'Escape']) {
      fireEvent.keyUp(slider, { key });
    }

    expect(screen.getByTestId('depth').textContent).toBe('0');
    expect(screen.getByTestId('cell').textContent).toBe('10');
  });

  it('commits on every key release that DOES move a range input', () => {
    // The arrow-release test above covers ArrowRight alone, so a whitelist of exactly
    // one key would satisfy it and silently break Home/End/PageUp/PageDown — the keys
    // a range input also responds to. Each is driven from a fresh mount so none can
    // pass on another's account, and the committed VALUE is asserted, not just depth.
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      const { unmount } = render(
        <StoreProvider>
          <Depth />
          <EcuLabTuneHarness />
        </StoreProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
      fireEvent.change(screen.getByRole('slider'), { target: { value: '27' } });
      fireEvent.keyUp(screen.getByRole('slider'), { key });

      expect(screen.getByTestId('depth').textContent).toBe('1');
      expect(screen.getByTestId('cell').textContent).toBe('27');
      unmount();
    }
  });

  it('drops an uncommitted draft when the selection moves to another cell', () => {
    // The draft is per-cell. Without the reset, selecting a new cell keeps showing the
    // previous cell's abandoned value, and the next release would write that stale
    // number into a cell the player never dragged.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' }));
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    expect(/** @type {HTMLInputElement} */ (screen.getByRole('slider')).value).toBe('40');

    // Move to a different cell without releasing: the abandoned 40 must not follow.
    fireEvent.click(screen.getByRole('button', { name: 'SELECT OTHER' }));

    // Literals, not `not.toBe('40')` (passes for any non-40 value, including another
    // stale draft) or a value re-read from the component's own earlier render. 14 is
    // DEFAULT_TIMING[1][1], cell(1,1)'s real committed value.
    expect(/** @type {HTMLInputElement} */ (screen.getByRole('slider')).value).toBe('14');
    // Nothing was ever committed, and the first cell still holds its original value —
    // 10, DEFAULT_TIMING[0][0].
    expect(screen.getByTestId('depth').textContent).toBe('0');
    expect(screen.getByTestId('cell').textContent).toBe('10');
  });

  it('drops an uncommitted draft when the selection moves to a different column in the same row', () => {
    // T2: selKey must include the column, not just the row. The two prior tests only
    // ever move (0,0) -> (1,1), which differs in both indices, so a selKey missing
    // EITHER one would still satisfy them. This isolates the column.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    expect(/** @type {HTMLInputElement} */ (screen.getByRole('slider')).value).toBe('40');

    // Same row, next column over: cell(0,1), current 14 (DEFAULT_TIMING[0][1]).
    fireEvent.click(screen.getByRole('button', { name: 'SELECT SAME ROW' }));

    expect(/** @type {HTMLInputElement} */ (screen.getByRole('slider')).value).toBe('14');
    expect(screen.getByTestId('dock-readout').textContent).toBe('14°');
    expect(screen.getByTestId('depth').textContent).toBe('0');
  });

  it('drops an uncommitted draft when the selection moves to a different row in the same column', () => {
    // T3: the mirror of T2 — selKey must include the row, not just the column.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    expect(/** @type {HTMLInputElement} */ (screen.getByRole('slider')).value).toBe('40');

    // Same column, a different row: cell(3,0), current 14 (DEFAULT_TIMING[3][0]).
    fireEvent.click(screen.getByRole('button', { name: 'SELECT SAME COL' }));

    expect(/** @type {HTMLInputElement} */ (screen.getByRole('slider')).value).toBe('14');
    expect(screen.getByTestId('dock-readout').textContent).toBe('14°');
    expect(screen.getByTestId('depth').textContent).toBe('0');
  });

  it('the live readout tracks the drag mid-flight, not just the slider', () => {
    // T1: the live readout is the stated mitigation for this task's accepted cost
    // (the grid's heat tint now updates on release, not continuously) — nothing else
    // in the suite ever reads it. Pins `shown`, not `current`, feeding the big number.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });

    // Mid-drag: nothing committed yet, but the readout already reads the drag.
    expect(screen.getByTestId('depth').textContent).toBe('0');
    expect(screen.getByTestId('dock-readout').textContent).toBe('40°');
  });

  it('a stepper click clears a draft left over from a drag that never released', () => {
    // B1: a pointercancel (touch gesture taken over by scroll, mouse released outside
    // the window) leaves the draft live with no pointerup ever landing. Reaching for a
    // stepper instead must win outright — not queue behind the abandoned drag.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    expect(screen.getByTestId('depth').textContent).toBe('0');

    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));

    // The stepper commits against the TABLE's value (10), not the abandoned draft (40).
    expect(screen.getByTestId('depth').textContent).toBe('1');
    expect(screen.getByTestId('cell').textContent).toBe('11');
    expect(screen.getByTestId('dock-readout').textContent).toBe('11°');

    // The drag's pointerup finally arrives, late. Without the fix this recommits the
    // abandoned 40 over the stepper's edit; with it, there is nothing left to commit.
    fireEvent.pointerUp(slider);

    expect(screen.getByTestId('depth').textContent).toBe('1');
    expect(screen.getByTestId('cell').textContent).toBe('11');
  });

  it('a drag that ends where it started does not commit', () => {
    // B2: dragging 10 -> 40 -> back to 10 and releasing must not burn an undo entry
    // or, via SET_TABLE, clear build.presetId / set tablesDirty for a table that
    // never actually changed.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.change(slider, { target: { value: '10' } }); // back to where it started
    expect(screen.getByTestId('depth').textContent).toBe('0');

    fireEvent.pointerUp(slider);

    // No history entry burned, table untouched...
    expect(screen.getByTestId('depth').textContent).toBe('0');
    expect(screen.getByTestId('cell').textContent).toBe('10');
    // This does NOT prove the draft was cleared: here draft === current === 10, so
    // `shown` reads 10 whether or not `setDraft(null)` ran. The test below ("the
    // draft is cleared even when a no-op drag ends where it started") is the one
    // that moves `current` after the release and actually bites on that clear.
    expect(screen.getByTestId('dock-readout').textContent).toBe('10°');
  });

  it('the draft is cleared even when a no-op drag ends where it started', () => {
    // NEW-2: commitDraft's early return is `{ setDraft(null); return; }`. The B2 test
    // above cannot show the `setDraft(null)` half of that matters, because on its path
    // draft === current === 10 already, so the readout reads 10 either way. This test
    // moves `current` AFTER the no-op release, with the selection never changing, so a
    // stale draft and a cleared one disagree.
    render(
      <StoreProvider>
        <UndoControls />
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));
    expect(screen.getByTestId('cell').textContent).toBe('11'); // depth 1, current now 11

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.change(slider, { target: { value: '11' } }); // back to where THIS drag started
    fireEvent.pointerUp(slider);

    // The no-op guard fired: no second entry, table still 11.
    expect(screen.getByTestId('depth').textContent).toBe('1');
    expect(screen.getByTestId('cell').textContent).toBe('11');

    fireEvent.click(undoBtn()); // real undo of the +1 -> table back to 10

    // Shipped: the abandoned draft was cleared, so the dock follows the table to 10.
    // Under a mutant that drops `setDraft(null)` from the no-op branch, the stale
    // draft (11) is still showing and this reads '11°' instead.
    expect(screen.getByTestId('dock-readout').textContent).toBe('10°');
  });

  it('clears the draft after a normal commit, so a later change to the table is not masked by it', () => {
    // T4: `commitDraft` must null the draft on the success path too, not only on the
    // `draft === null` early return. Deleting that clear leaves the dock pinned to the
    // last dragged value forever. A later stepper click can't prove this on its own
    // any more (B1 also clears the draft, from the stepper side) — so this drives the
    // table out from under the dock a different way: undoing the very commit that
    // just happened, with the selection never changing.
    render(
      <StoreProvider>
        <UndoControls />
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.pointerUp(slider); // commits 40, depth 1

    expect(screen.getByTestId('depth').textContent).toBe('1');
    expect(screen.getByTestId('cell').textContent).toBe('40');

    fireEvent.click(undoBtn());

    // The table is back to 10. If the draft were never cleared after the commit, the
    // dock would still show the abandoned 40 here instead of following the table.
    expect(screen.getByTestId('cell').textContent).toBe('10');
    expect(screen.getByTestId('dock-readout').textContent).toBe('10°');
    expect(/** @type {HTMLInputElement} */ (screen.getByRole('slider')).value).toBe('10');
  });

  it('drops an abandoned draft when an UNDO changes the table under the same cell', () => {
    // F2. The draft is dropped when the SELECTION moves and when a stepper is clicked,
    // but an undo changes the table with the selection unchanged — and the abandoned
    // draft used to survive it. The grid went back to 10 while the dock's big readout,
    // the stated mitigation for this task's accepted cost, still read 42; a late
    // pointerup then wrote 42 back over the undo and took the redo branch with it.
    render(
      <StoreProvider>
        <UndoControls />
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));
    expect(screen.getByTestId('cell').textContent).toBe('11'); // depth 1, current now 11

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '42' } }); // drag with no pointerup
    expect(screen.getByTestId('dock-readout').textContent).toBe('42°');

    fireEvent.click(undoBtn()); // table back to 10, selection untouched

    // The dock follows the table instead of going on showing the abandoned drag.
    expect(screen.getByTestId('cell').textContent).toBe('10');
    expect(screen.getByTestId('dock-readout').textContent).toBe('10°');
    expect(/** @type {HTMLInputElement} */ (screen.getByRole('slider')).value).toBe('10');
    expect(screen.getByTestId('redo-depth').textContent).toBe('1');

    // The drag's pointerup finally arrives, late: there is nothing left to commit, so
    // the undo stands and the redo it created is still there.
    fireEvent.pointerUp(slider);

    expect(screen.getByTestId('cell').textContent).toBe('10');
    expect(screen.getByTestId('depth').textContent).toBe('0');
    expect(screen.getByTestId('redo-depth').textContent).toBe('1');
    // The other side of this reset — that it does NOT fire mid-drag — is held by the
    // drag tests at the top of this block, which assert the value the drag committed
    // on release. A reset that fired while `data` held still would leave the draft
    // null there and commit nothing. Not duplicated here.
  });

  it('commits one value across the whole row as a single entry, for a row selection', () => {
    // M1: all prior tests here select a `cell`. For a row, `current` is a mean and
    // `setAbs` fans the released value across all 8 cells of the row — verified
    // correct by the reviewer, but previously unpinned.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT ROW' })); // row 0
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '20' } });
    expect(screen.getByTestId('depth').textContent).toBe('0'); // still just a draft

    fireEvent.pointerUp(slider);

    expect(screen.getByTestId('depth').textContent).toBe('1'); // one entry, not eight
    expect(screen.getByTestId('row0').textContent).toBe('[20,20,20,20,20,20,20,20]');
  });

  it('flattening a row onto its own exact mean is still a real edit and must commit', () => {
    // F1 / NEW-1: for a row/col selection `current` is the MEAN, not a stored value.
    // The no-op guard in commitDraft compares `draft === current` — correct for a cell,
    // where equality really does mean nothing changed, but wrong here: landing the
    // slider exactly on the row's mean and releasing is a genuine edit (it flattens
    // every cell to that value), and an unscoped guard silently discards it.
    //
    // Row 0 starts [10,14,20,26,30,32,33,34] (sum 199). +1 on cell(0,0) makes it
    // [11,14,20,26,30,32,33,34], sum 200, mean EXACTLY 25 — the row selection's
    // `current` for the rest of this test.
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT' })); // cell(0,0), current 10
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));
    expect(screen.getByTestId('row0').textContent).toBe('[11,14,20,26,30,32,33,34]');
    expect(screen.getByTestId('depth').textContent).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'SELECT ROW' })); // row 0, current (mean) 25
    expect(screen.getByTestId('dock-readout').textContent).toBe('25°');

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.change(slider, { target: { value: '25' } }); // lands exactly back on the mean
    fireEvent.pointerUp(slider);

    // An unscoped `draft === current` guard would treat this as a no-op and throw the
    // fan-out away, leaving depth 1 and the row unchanged. The real behaviour is that
    // this flattens the row and burns a second undo entry.
    expect(screen.getByTestId('depth').textContent).toBe('2');
    expect(screen.getByTestId('row0').textContent).toBe('[25,25,25,25,25,25,25,25]');
  });

  it('commits one value across the whole column as a single entry, for a column selection', () => {
    // F3 / NEW-3: M1 pinned the row fan-out but left its mirror, the column branch of
    // `setAbs`, entirely uncovered. Column 0 starts [10,10,10,14,16,14]
    // (DEFAULT_TIMING[*][0]).
    render(
      <StoreProvider>
        <Depth />
        <EcuLabTuneHarness />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SELECT COL' })); // col 0
    expect(screen.getByTestId('col0').textContent).toBe('[10,10,10,14,16,14]');
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '20' } });
    expect(screen.getByTestId('depth').textContent).toBe('0'); // still just a draft

    fireEvent.pointerUp(slider);

    expect(screen.getByTestId('depth').textContent).toBe('1'); // one entry, not six
    expect(screen.getByTestId('col0').textContent).toBe('[20,20,20,20,20,20]');
  });
});

describe('keyboard shortcuts', () => {
  // `cells[0]` in TuningGrid's DOM order is the RPM=800 COLUMN HEADER button (the
  // header row is rendered before any data row, and header text is plain digits too,
  // so it passes the same regex filter) — not a data cell. Its own text never changes
  // no matter what gets edited, so picking it here would make `edited` equal `before`
  // by construction, failing every assertion below for the wrong reason before the
  // keyboard shortcut is even exercised. Mid-array — same fix the preset-label test
  // above this describe block already uses — lands on a real data cell instead.
  const dataCell = (list) => list[Math.floor(list.length / 2)];

  // Returns the PRE-edit value, not the post-edit one: the brief's literal version
  // read `cells[0].textContent` AFTER the `+1` click had already fired, so it handed
  // back the edited value. The very next line in every test below reads the grid
  // again with nothing in between, so `edited` and that returned value would always
  // be identical DOM state — `expect(edited).not.toBe(before)` could never pass, on
  // any cell, regardless of the keyboard handler. Capturing the value before the
  // dock dispatch (edit still happens as the documented side effect) is what makes
  // `before` actually mean "before".
  // Returns { before, unmount }, not just the pre-edit value: F7 (listener cleanup)
  // needs a handle to unmount the real render, and reusing this helper for that test
  // keeps the same launch path every other test in this block already exercises.
  function launchWithEdit() {
    const { unmount } = render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    const grid = within(screen.getByTestId('tuning-grid'));
    const cells = grid.getAllByRole('button')
      .filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent));
    fireEvent.click(dataCell(cells));
    const before = dataCell(cells).textContent;
    const dock = within(screen.getByTestId('selection-dock'));
    fireEvent.click(dock.getByRole('button', { name: '+1' }));
    return { before, unmount };
  }

  it('undoes on Cmd+Z and redoes on Cmd+Shift+Z', () => {
    const { before } = launchWithEdit();
    const cell = () => dataCell(within(screen.getByTestId('tuning-grid'))
      .getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent)));
    const edited = cell().textContent;
    expect(edited).not.toBe(before);

    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(cell().textContent).toBe(before);

    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(cell().textContent).toBe(edited);
  });

  it('redoes on Cmd+Shift+Z using the real uppercase key browsers report', () => {
    // Per UI Events, KeyboardEvent.key reflects the character AFTER modifiers are
    // applied, so Chrome/Firefox/Safari all report key: "Z" (uppercase) for
    // Cmd+Shift+Z — not lowercase 'z' with shiftKey true, which is what the test
    // above (and every fabricated event in this file until now) actually fires.
    // Without .toLowerCase() in the handler this redo would be silently dead in
    // every real browser while still passing a suite that only ever sends 'z'.
    const { before } = launchWithEdit();
    const cell = () => dataCell(within(screen.getByTestId('tuning-grid'))
      .getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent)));
    const edited = cell().textContent;
    expect(edited).not.toBe(before);

    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(cell().textContent).toBe(before);

    fireEvent.keyDown(window, { key: 'Z', metaKey: true, shiftKey: true });
    expect(cell().textContent).toBe(edited);
  });

  it('leaves Cmd+A and Cmd+C alone: not undo, and not swallowed', () => {
    // Each half of `key !== 'z' && key !== 'y'` is pinned individually elsewhere in
    // this file, but nothing proves the guard's EXCLUSIVITY — that a modified key
    // which is neither z nor y is left alone. Without the whole line, Cmd+A/Cmd+C
    // (and even a bare Cmd keypress) would dispatch UNDO and swallow the browser's
    // own select-all/copy via preventDefault(). fireEvent.keyDown returns `true`
    // exactly when preventDefault() was NOT called, so this checks both at once.
    const { before } = launchWithEdit();
    const cell = () => dataCell(within(screen.getByTestId('tuning-grid'))
      .getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent)));
    const edited = cell().textContent;
    expect(edited).not.toBe(before);

    expect(fireEvent.keyDown(window, { key: 'a', metaKey: true })).toBe(true);
    expect(cell().textContent).toBe(edited);

    expect(fireEvent.keyDown(window, { key: 'c', metaKey: true })).toBe(true);
    expect(cell().textContent).toBe(edited);
  });

  it('prevents the browser default on the shortcut, so it does not also fire', () => {
    // fireEvent.keyDown resolves to `false` exactly when preventDefault() was called
    // on the dispatched event. Without this the app's own undo would fire ALONGSIDE
    // Firefox's page-level undo / Safari's Cmd+Y History.
    launchWithEdit();
    expect(fireEvent.keyDown(window, { key: 'z', metaKey: true })).toBe(false);
  });

  it('ignores Ctrl+Alt (AltGr), which types a real character on many European layouts', () => {
    // Windows/Linux report AltGr as Ctrl+Alt together. Without excluding altKey,
    // AltGr+Z / AltGr+Y on those layouts would undo/redo and swallow the typed
    // character instead. `toBe(true)` here proves it was NOT swallowed, the same
    // literal-return technique as the preventDefault test above.
    const { before } = launchWithEdit();
    const cell = () => dataCell(within(screen.getByTestId('tuning-grid'))
      .getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent)));
    const edited = cell().textContent;
    expect(edited).not.toBe(before);

    expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true, altKey: true })).toBe(true);
    expect(cell().textContent).toBe(edited);

    expect(fireEvent.keyDown(window, { key: 'y', ctrlKey: true, altKey: true })).toBe(true);
    expect(cell().textContent).toBe(edited);
  });

  it('ignores the shortcut while focus is in a text field', () => {
    // Otherwise the app would steal undo from the field the player is typing in.
    const { before } = launchWithEdit();
    const cell = () => dataCell(within(screen.getByTestId('tuning-grid'))
      .getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent)));
    const edited = cell().textContent;
    expect(edited).not.toBe(before);

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'z', metaKey: true });
    expect(cell().textContent).toBe(edited);
    input.remove();
  });

  it('ignores a bare z with no modifier', () => {
    const { before } = launchWithEdit();
    const cell = () => dataCell(within(screen.getByTestId('tuning-grid'))
      .getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent)));
    const edited = cell().textContent;
    expect(edited).not.toBe(before);

    fireEvent.keyDown(window, { key: 'z' });
    expect(cell().textContent).toBe(edited);
  });

  it('redoes on Ctrl+Y, the Windows spelling', () => {
    // The handler accepts 'y' as well as shift+z. Nothing else asserts it, so the
    // `key !== 'y'` half of the guard could be deleted and every other test here would
    // still pass — leaving Ctrl+Y silently dead for every Windows player.
    const { before } = launchWithEdit();
    const cell = () => dataCell(within(screen.getByTestId('tuning-grid'))
      .getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent)));
    const edited = cell().textContent;
    expect(edited).not.toBe(before);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(cell().textContent).toBe(before);

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(cell().textContent).toBe(edited);
  });

  it('ignores the shortcut while focus is in a select, a textarea, or a contenteditable', () => {
    // The INPUT case above is the only guard any other test exercises, so the SELECT,
    // TEXTAREA and isContentEditable halves could all be dropped with the suite still
    // green. SELECT is not hypothetical here: BUILD's preset picker is one, and
    // stealing Cmd+Z from an open picker takes the browser's own behaviour away from
    // it. No <textarea> exists anywhere in src/ui today, so TEXTAREA's impact is nil,
    // but the guard clause should still be held rather than left dead.
    const { before } = launchWithEdit();
    const cell = () => dataCell(within(screen.getByTestId('tuning-grid'))
      .getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent)));
    const edited = cell().textContent;
    expect(edited).not.toBe(before);

    const select = document.createElement('select');
    document.body.appendChild(select);
    fireEvent.keyDown(select, { key: 'z', metaKey: true });
    expect(cell().textContent).toBe(edited);
    select.remove();

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    fireEvent.keyDown(textarea, { key: 'z', metaKey: true });
    expect(cell().textContent).toBe(edited);
    textarea.remove();

    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: 'z', metaKey: true });
    expect(cell().textContent).toBe(edited);
    editable.remove();
  });

  it('removes the keydown listener on unmount', () => {
    // Coverage for the effect's cleanup, not a defect: `return () =>
    // window.removeEventListener('keydown', onKey)` is already correct today (the
    // review instrumented it: exactly one add, one matching remove). But replacing
    // that cleanup with `() => {}` still leaves a fully green suite — every other
    // test here unmounts via afterEach(cleanup) with nothing left in the DOM to
    // observe a leaked listener against. Spying on add/removeEventListener directly
    // is what actually catches it: after unmount, the SAME function reference handed
    // to addEventListener must come back out of removeEventListener.
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));

    const keydownAdds = addSpy.mock.calls.filter((call) => call[0] === 'keydown');
    expect(keydownAdds.length).toBe(1);
    const handler = keydownAdds[0][1];

    unmount();

    const keydownRemoves = removeSpy.mock.calls.filter((call) => call[0] === 'keydown');
    expect(keydownRemoves.length).toBe(1);
    expect(keydownRemoves[0][1]).toBe(handler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
