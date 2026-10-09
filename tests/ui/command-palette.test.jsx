// @vitest-environment jsdom

/**
 * The command palette (issue 63). The component on its own first — roles, keys,
 * filtering — then, in Task 3, through the real app: Cmd-K, the strip button, and the
 * commands EcuLab builds.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '../../src/ui/components/CommandPalette.jsx';
import EcuLab from '../../src/ui/EcuLab.jsx';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
const hadResizeObserver = 'ResizeObserver' in window;
if (!hadResizeObserver) window.ResizeObserver = ResizeObserverStub;
afterAll(() => { if (!hadResizeObserver) delete window.ResizeObserver; });
afterEach(cleanup);

const dialog = () => /** @type {HTMLDialogElement} */ (document.querySelector('dialog'));
const input = () => /** @type {HTMLInputElement} */ (screen.getByRole('combobox', { name: 'Search pages and actions' }));
// The palette's own options: TUNE's map-slot <select>s put native options on the page too.
const options = () => {
  const list = screen.queryByRole('listbox', { name: 'Results' });
  return list ? within(list).queryAllByRole('option') : [];
};
const type = (text) => fireEvent.change(input(), { target: { value: text } });
const key = (k) => fireEvent.keyDown(input(), { key: k });

/**
 * Owns the open flag the way EcuLab does, with a button to open it.
 * @param {{commands: import('../../src/ui/commands.js').Command[]}} props
 */
function Harness({ commands }) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>OPEN</button>
      <CommandPalette open={open} onClose={close} commands={commands} />
    </>
  );
}

const make = () => {
  const ran = vi.fn();
  /** @type {import('../../src/ui/commands.js').Command[]} */
  const commands = [
    { id: 'page:tune/spark', label: 'Spark', context: 'TUNE', kind: 'page', keywords: ['timing'], run: () => ran('spark') },
    { id: 'page:tune/fuel', label: 'Fuel', context: 'TUNE', kind: 'page', keywords: ['afr'], run: () => ran('fuel') },
    { id: 'act:start', label: 'Start engine', kind: 'action', keywords: [], run: () => ran('start') },
  ];
  render(<Harness commands={commands} />);
  fireEvent.click(screen.getByRole('button', { name: 'OPEN' }));
  return ran;
};

describe('the palette', () => {
  it('opens as a dialog with the search field focused', () => {
    make();
    expect(dialog().open).toBe(true);
    expect(dialog().getAttribute('aria-label')).toBe('Command palette');
    expect(document.activeElement).toBe(input());
  });

  it('is a combobox over a listbox of options, each tagged Page or Action', () => {
    make();
    expect(input().getAttribute('aria-controls')).toBe(screen.getByRole('listbox', { name: 'Results' }).id);
    expect(input().getAttribute('aria-expanded')).toBe('true');
    const [first, second, third] = options();
    // No query: actions first.
    expect(first.textContent).toBe('Start engineAction');
    expect(second.textContent).toBe('TUNE › SparkPage');
    expect(third.textContent).toBe('TUNE › FuelPage');
  });

  it('marks the active option, and points the input at it', () => {
    make();
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
  });

  it('moves with the arrows, wrapping at both ends', () => {
    make();
    key('ArrowUp');
    expect(options()[2].getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
  });

  it('filters as you type, and the first match is active', () => {
    make();
    key('ArrowDown');
    type('tim');
    expect(options().map((o) => o.textContent)).toEqual(['TUNE › SparkPage']);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('runs the active command on Enter, and closes', () => {
    const ran = make();
    type('fu');
    key('Enter');
    expect(ran).toHaveBeenCalledWith('fuel');
    expect(dialog().open).toBe(false);
  });

  it('runs a command on click', () => {
    const ran = make();
    fireEvent.click(options()[1]);
    expect(ran).toHaveBeenCalledWith('spark');
    expect(dialog().open).toBe(false);
  });

  it('says No matches, and Enter then does nothing', () => {
    const ran = make();
    type('zzz');
    expect(options()).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    key('Enter');
    expect(ran).not.toHaveBeenCalled();
  });

  it('closes on Escape, and on a click on the backdrop but not inside', () => {
    make();
    fireEvent.mouseDown(input());
    fireEvent.click(input());
    expect(dialog().open).toBe(true);
    fireEvent.mouseDown(dialog());
    fireEvent.click(dialog());
    expect(dialog().open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'OPEN', hidden: true }));
    key('Escape');
    expect(dialog().open).toBe(false);
  });

  it('stays open when a drag that began in the field is let go over the backdrop', () => {
    make();
    // A click lands on the common ancestor of press and release: here, the dialog.
    fireEvent.mouseDown(input());
    fireEvent.click(dialog());
    expect(dialog().open).toBe(true);
  });

  it('starts empty each time it opens', () => {
    make();
    type('spa');
    key('Escape');
    fireEvent.click(screen.getByRole('button', { name: 'OPEN', hidden: true }));
    expect(input().value).toBe('');
    expect(options()).toHaveLength(3);
  });

  it('is already empty once closed, before it is opened again', () => {
    make();
    type('spa');
    key('Escape');
    expect(dialog().open).toBe(false);
    // Closed, the dialog's contents are out of the accessibility tree.
    expect(dialog().querySelector('input').value).toBe('');
  });

  it('keeps the parent in step when the browser closes it', () => {
    make();
    act(() => { dialog().close(); });
    // The parent's flag went false, so opening again is a real open, not a no-op.
    fireEvent.click(screen.getByRole('button', { name: 'OPEN', hidden: true }));
    expect(dialog().open).toBe(true);
  });

  it('scrolls the active option into view only on open and on a real selection change, not on every render', () => {
    const hadScrollIntoView = 'scrollIntoView' in window.Element.prototype;
    if (!hadScrollIntoView) window.Element.prototype.scrollIntoView = () => {};
    const spy = vi.spyOn(window.Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    try {
      /** @type {import('../../src/ui/commands.js').Command[]} */
      const commands = [
        { id: 'act:start', label: 'Start engine', kind: 'action', keywords: [], run: () => {} },
        { id: 'page:tune/spark', label: 'Spark', context: 'TUNE', kind: 'page', keywords: [], run: () => {} },
      ];
      const { rerender } = render(<Harness commands={commands} />);
      fireEvent.click(screen.getByRole('button', { name: 'OPEN' }));
      const afterOpen = spy.mock.calls.length;
      expect(afterOpen).toBeGreaterThan(0);

      // A fresh commands array each time, as EcuLab rebuilds `paletteCommands` on every
      // render — the active option never changes, so this must not call scrollIntoView.
      rerender(<Harness commands={[...commands]} />);
      rerender(<Harness commands={[...commands]} />);
      rerender(<Harness commands={[...commands]} />);
      expect(spy.mock.calls.length).toBe(afterOpen);

      key('ArrowDown');
      expect(spy.mock.calls.length).toBe(afterOpen + 1);
    } finally {
      spy.mockRestore();
      if (!hadScrollIntoView) delete window.Element.prototype.scrollIntoView;
    }
  });

  it('scrolls the first result back into view when typing, even when it was already first', () => {
    const hadScrollIntoView = 'scrollIntoView' in window.Element.prototype;
    if (!hadScrollIntoView) window.Element.prototype.scrollIntoView = () => {};
    const spy = vi.spyOn(window.Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    try {
      make();
      // Index 0 is active on open; a list scrolled by the wheel does not change that.
      const afterOpen = spy.mock.calls.length;
      type('s');
      expect(spy.mock.calls.length).toBe(afterOpen + 1);
      expect(spy.mock.contexts.at(-1)).toBe(options()[0]);
    } finally {
      spy.mockRestore();
      if (!hadScrollIntoView) delete window.Element.prototype.scrollIntoView;
    }
  });

  it('tracks the active command by id, not by position, when commands change under it', () => {
    const ran = vi.fn();
    /** @type {import('../../src/ui/commands.js').Command[]} */
    const commands = [
      { id: 'a', label: 'Alpha', kind: 'action', keywords: [], run: () => ran('a') },
      { id: 'b', label: 'Beta', kind: 'action', keywords: [], run: () => ran('b') },
    ];
    const { rerender } = render(<Harness commands={commands} />);
    fireEvent.click(screen.getByRole('button', { name: 'OPEN' }));
    key('ArrowDown');
    expect(options()[1].textContent).toBe('BetaAction');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');

    // Insert a new command at the front. If the active option is tracked by index, the
    // highlight silently slides onto whatever is now at index 1 (Alpha) instead of
    // following Beta.
    /** @type {import('../../src/ui/commands.js').Command} */
    const charlie = { id: 'c', label: 'Charlie', kind: 'action', keywords: [], run: () => ran('c') };
    rerender(<Harness commands={[charlie, ...commands]} />);
    const selected = options().find((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.textContent).toBe('BetaAction');
  });
});

describe('the palette in the app', () => {
  const launch = () => {
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
  };
  const cmdK = (init = {}) => fireEvent.keyDown(window, { key: 'k', code: 'KeyK', metaKey: true, ...init });
  const isOpen = () => Boolean(dialog()?.open);
  const run = (text) => { type(text); key('Enter'); };

  it('opens on Cmd-K and Ctrl-K, and Cmd-K again closes it', () => {
    launch();
    cmdK();
    expect(isOpen()).toBe(true);
    cmdK();
    expect(isOpen()).toBe(false);
    cmdK({ metaKey: false, ctrlKey: true });
    expect(isOpen()).toBe(true);
  });

  it('closes on Cmd-K from inside its own field', () => {
    launch();
    cmdK();
    fireEvent.keyDown(input(), { key: 'k', code: 'KeyK', metaKey: true });
    expect(isOpen()).toBe(false);
  });

  it('opens on Ctrl-K from a non-Latin layout by the physical key, and not on Dvorak\'s KeyK', () => {
    launch();
    cmdK({ key: 'л', metaKey: false, ctrlKey: true });
    expect(isOpen()).toBe(true);
    cmdK();
    expect(isOpen()).toBe(false);
    // Dvorak puts T where QWERTY has K: its `key` says what it is.
    cmdK({ key: 't' });
    expect(isOpen()).toBe(false);
  });

  it('ignores Cmd-Alt-K, and Cmd-K on the start screen', () => {
    render(<EcuLab />);
    cmdK();
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    cmdK({ altKey: true });
    expect(isOpen()).toBe(false);
  });

  it('does not reopen on its own after the app view leaves and comes back', async () => {
    launch();
    cmdK();
    expect(isOpen()).toBe(true);

    // Browser back to the start screen the palette was opened from. CommandPalette
    // unmounts with the view, but `paletteOpen` must not survive the round trip, or
    // re-entering the app reopens it at once.
    window.history.back();
    await waitFor(() => expect(screen.getByRole('button', { name: 'SANDBOX' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    expect(isOpen()).toBe(false);
  });

  it('stays put while K is held down, and still swallows the repeats', () => {
    launch();
    cmdK();
    const repeat = new window.KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, repeat: true, cancelable: true });
    act(() => { window.dispatchEvent(repeat); });
    expect(isOpen()).toBe(true);
    expect(repeat.defaultPrevented).toBe(true);
  });

  describe('by platform', () => {
    /** @param {string} platform */
    const onPlatform = (platform) => Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
    afterEach(() => { delete (/** @type {any} */ (window.navigator)).platform; });

    it('opens on a Mac on Cmd-K only, leaving Ctrl-K to the text field it was typed in', () => {
      onPlatform('MacIntel');
      launch();
      const field = document.createElement('input');
      document.body.append(field);
      try {
        // Ctrl-K is a macOS text field's delete-to-end-of-line.
        const ctrlK = new window.KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
        act(() => { field.dispatchEvent(ctrlK); });
        expect(isOpen()).toBe(false);
        expect(ctrlK.defaultPrevented).toBe(false);
        cmdK();
        expect(isOpen()).toBe(true);
      } finally {
        field.remove();
      }
    });

    it('names Cmd-K on the strip button on a Mac', () => {
      onPlatform('MacIntel');
      launch();
      const button = screen.getByRole('button', { name: 'Search pages and actions' });
      expect(button.title).toBe('Search (⌘K)');
      expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
    });

    it('names Ctrl-K on the strip button anywhere else', () => {
      onPlatform('Win32');
      launch();
      const button = screen.getByRole('button', { name: 'Search pages and actions' });
      expect(button.title).toBe('Search (Ctrl+K)');
      expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+K');
    });
  });

  it('opens from the status strip button', () => {
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'Search pages and actions' }));
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it('goes to a section', () => {
    launch();
    cmdK();
    run('spark');
    expect(window.location.hash).toBe('#/tune/spark');
    expect(isOpen()).toBe(false);
  });

  it('goes to a tab the way the nav does', () => {
    launch();
    cmdK();
    run('drag');
    expect(window.location.hash).toBe('#/drag/body');
  });

  it('offers no DYNO result pages and no History before the first pull', () => {
    launch();
    cmdK();
    type('curves');
    expect(screen.getByText('No matches')).toBeTruthy();
    type('history');
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('offers Start engine, and Sound on or off', () => {
    launch();
    cmdK();
    const labels = options().map((o) => o.textContent);
    expect(labels).toContain('Start engineAction');
    expect(labels.some((l) => /^Sound (on|off)Action$/.test(l))).toBe(true);
  });

  it('offers Undo only when there is something to undo, and runs it', () => {
    launch();
    cmdK();
    type('undo');
    expect(screen.getByText('No matches')).toBeTruthy();
    key('Escape');

    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    const cell = within(screen.getByTestId('tuning-grid')).getByRole('button', { name: '3500 RPM, 100 kPa' });
    fireEvent.click(cell);
    const before = cell.textContent;
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));
    expect(cell.textContent).not.toBe(before);

    cmdK();
    type('undo');
    expect(options()[0].textContent).toMatch(/^Undo .+Action$/);
    key('Enter');
    expect(cell.textContent).toBe(before);
  });

  it('runs a dyno pull on DYNO', () => {
    launch();
    cmdK();
    run('run dyno');
    expect(window.location.hash).toBe('#/dyno/result');
    // jsdom has no Web Audio, so the pull goes straight to the sweep.
    expect(screen.getByRole('button', { name: 'SWEEPING…' })).toBeTruthy();
  });

  it('does nothing on Cmd-K from the tutorial view', () => {
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'TUTORIAL' }));
    cmdK();
    expect(isOpen()).toBe(false);
  });

  it('starts the engine on LIVE, where it is heard and seen', () => {
    launch();
    cmdK();
    run('start engine');
    expect(window.location.hash).toBe('#/live/engine');
    expect(screen.getByRole('button', { name: 'STOP' })).toBeTruthy();
  });

  it('offers no DYNO page but Curves while a pull is running', () => {
    launch();
    cmdK();
    run('run dyno');
    expect(screen.getByRole('button', { name: 'SWEEPING…' })).toBeTruthy();
    cmdK();
    type('datalog');
    expect(screen.getByText('No matches')).toBeTruthy();
    type('curves');
    expect(options().map((o) => o.textContent)).toEqual(['DYNO › CurvesPage']);
  });

  it('offers Stop engine once the engine is started, and running it stops it', () => {
    launch();
    fireEvent.click(screen.getByRole('button', { name: 'LIVE' }));
    fireEvent.click(screen.getByRole('button', { name: 'START ENGINE' }));

    cmdK();
    const labels = options().map((o) => o.textContent);
    expect(labels).toContain('Stop engineAction');
    run('stop engine');
    expect(screen.getByRole('button', { name: 'START ENGINE' })).toBeTruthy();
  });

  it('offers Redo after an undo, and running it redoes the edit', () => {
    launch();
    fireEvent.click(screen.getByRole('button', { name: /TUNE/ }));
    const cell = within(screen.getByTestId('tuning-grid')).getByRole('button', { name: '3500 RPM, 100 kPa' });
    fireEvent.click(cell);
    const before = cell.textContent;
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));
    const after = cell.textContent;
    expect(after).not.toBe(before);

    cmdK();
    run('undo');
    expect(cell.textContent).toBe(before);

    cmdK();
    const labels = options().map((o) => o.textContent);
    expect(labels.some((l) => /^Redo .+Action$/.test(l))).toBe(true);
    run('redo');
    expect(cell.textContent).toBe(after);
  });

  it('toggles the Sound action label when run', () => {
    // BUILD's preset picker is a real <select> full of <option>s, which `options()`
    // (a plain byRole('option') over the whole document) would pick up alongside the
    // palette's own listbox — so this reaches into the listbox by name instead.
    const soundOption = () => within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option')[0];
    launch();
    cmdK();
    type('sound');
    expect(soundOption().textContent).toBe('Sound offAction');
    key('Enter');

    cmdK();
    type('sound');
    expect(soundOption().textContent).toBe('Sound onAction');
  });
});
