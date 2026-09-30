/**
 * The command palette (issue 63): type to jump to any page or run a common action.
 * Opened by Cmd/Ctrl-K or the status strip's search button; both live in EcuLab.
 *
 * A native `<dialog>` opened with `showModal()`, so the browser puts it in the top
 * layer, makes the page behind it inert, and hands focus back to whatever opened it.
 * Esc is handled here as well as natively so the parent's `open` flag always follows.
 *
 * The ARIA combobox pattern: focus never leaves the input; the arrows move
 * `aria-activedescendant` through a listbox of options.
 *
 * It knows no store and no routes — `commands` arrive built, and `commands.js` ranks
 * them. Shared by nothing else yet; it sits in this folder because the shell mounts it
 * over every tab. See the README for why it has a stylesheet.
 */

import React from 'react';

import { matchCommands } from '../commands.js';

import styles from './CommandPalette.module.css';

/** @typedef {import('../commands.js').Command} Command */

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose idempotent: may be called more than once per close
 * @param {Command[]} props.commands
 * @returns {React.ReactElement}
 */
export function CommandPalette({ open, onClose, commands }) {
  const dialogRef = React.useRef(/** @type {HTMLDialogElement|null} */ (null));
  const inputRef = React.useRef(/** @type {HTMLInputElement|null} */ (null));
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  const results = matchCommands(query, commands);
  const current = Math.min(active, results.length - 1);
  const optionId = (i) => `${listId}-${i}`;

  React.useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      setQuery('');
      setActive(0);
      d.showModal();
      inputRef.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // However the dialog closes — Esc, a command, the browser — the parent hears of it.
  React.useEffect(() => {
    const d = dialogRef.current;
    if (!d) return undefined;
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, [onClose]);

  React.useEffect(() => {
    if (!open || current < 0) return;
    // Optional call: jsdom has no scrollIntoView.
    document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
  });

  /** @param {number} i */
  const runAt = (i) => {
    const c = results[i];
    if (!c) return;
    onClose();
    c.run();
  };

  /** @param {React.KeyboardEvent<HTMLInputElement>} e */
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(current);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // The panel fills the dialog, so a click whose target is the dialog itself landed on
  // the backdrop.
  /** @param {React.MouseEvent<HTMLDialogElement>} e */
  const onDialogClick = (e) => { if (e.target === dialogRef.current) onClose(); };

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-label="Command palette" onClick={onDialogClick}>
      <div className={styles.panel}>
        <input
          ref={inputRef}
          className={styles.input}
          role="combobox"
          aria-label="Search pages and actions"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results.length ? optionId(current) : undefined}
          placeholder="Go to a page or run an action…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} role="listbox" aria-label="Results" className={styles.list}>
          {results.map((c, i) => (
            // Focus stays in the input (combobox pattern), so the options take clicks only.
            <li
              key={c.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              className={styles.option}
              onMouseMove={() => { if (i !== current) setActive(i); }}
              onClick={() => runAt(i)}
            >
              <span className={styles.label}>
                {c.context && <span className={styles.context}>{c.context} › </span>}
                {c.label}
              </span>
              <span className={styles.kind}>{c.kind === 'page' ? 'Page' : 'Action'}</span>
            </li>
          ))}
        </ul>
        {!results.length && <p className={styles.empty}>No matches</p>}
      </div>
    </dialog>
  );
}
