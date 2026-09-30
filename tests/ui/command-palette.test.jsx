// @vitest-environment jsdom

/**
 * The command palette (issue 63). The component on its own first — roles, keys,
 * filtering — then, in Task 3, through the real app: Cmd-K, the strip button, and the
 * commands EcuLab builds.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '../../src/ui/components/CommandPalette.jsx';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
const hadResizeObserver = 'ResizeObserver' in window;
if (!hadResizeObserver) window.ResizeObserver = ResizeObserverStub;
afterAll(() => { if (!hadResizeObserver) delete window.ResizeObserver; });
afterEach(cleanup);

const dialog = () => /** @type {HTMLDialogElement} */ (document.querySelector('dialog'));
const input = () => /** @type {HTMLInputElement} */ (screen.getByRole('combobox', { name: 'Search pages and actions' }));
const options = () => screen.queryAllByRole('option');
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
    fireEvent.click(input());
    expect(dialog().open).toBe(true);
    fireEvent.click(dialog());
    expect(dialog().open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'OPEN', hidden: true }));
    key('Escape');
    expect(dialog().open).toBe(false);
  });

  it('starts empty each time it opens', () => {
    make();
    type('spa');
    key('Escape');
    fireEvent.click(screen.getByRole('button', { name: 'OPEN', hidden: true }));
    expect(input().value).toBe('');
    expect(options()).toHaveLength(3);
  });

  it('keeps the parent in step when the browser closes it', () => {
    make();
    act(() => { dialog().close(); });
    // The parent's flag went false, so opening again is a real open, not a no-op.
    fireEvent.click(screen.getByRole('button', { name: 'OPEN', hidden: true }));
    expect(dialog().open).toBe(true);
  });
});
