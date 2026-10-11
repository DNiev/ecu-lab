/**
 * The command palette (issue 63): type to jump to any page or run a common action.
 * Opened by Cmd/Ctrl-K or the status strip's search button; both live in EcuLab.
 *
 * A native `<dialog>` opened with `showModal()`, so the browser puts it in the top
 * layer, makes the page behind it inert, and hands focus back to whatever opened it
 * (or, when a command shut the section holding that, to the section's header).
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
import { headerHiding } from './inert.js';

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
  // The active command's id, not its position: `commands` can change under an open
  // palette (the undo/redo entries come and go, a page becomes available), and an
  // index would then silently point at whatever is now in that slot. `null` means "no
  // explicit choice yet" — the first result — and covers both the initial mount and
  // every reset below.
  const [activeId, setActiveId] = React.useState(/** @type {string|null} */ (null));
  const listId = React.useId();
  // Whether the press that began the current click landed on the backdrop.
  const pressedBackdrop = React.useRef(false);
  // Whatever had focus when the palette opened: where close() hands it back.
  const opener = React.useRef(/** @type {Element|null} */ (null));

  const results = matchCommands(query, commands);
  const activeIndex = results.findIndex((c) => c.id === activeId);
  // Falls back to the first result both when nothing is chosen yet and when the chosen
  // id scrolled out of the results entirely (a rerank, or the command disappearing).
  const current = results.length === 0 ? -1 : (activeIndex >= 0 ? activeIndex : 0);
  const optionId = (i) => `${listId}-${i}`;

  React.useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      // showModal() would focus the field on its own in a real browser; the explicit
      // call is for environments whose <dialog> does not do that (the test stub).
      inputRef.current?.focus();
    } else if (!open) {
      // Emptied on the way out, not the way in: cleared at open, the dialog was already
      // showing the last query when the reset landed, and a frame of it could paint.
      // Whatever closed it (Esc, a command, the browser), `open` ends up false here.
      if (d.open) d.close();
      // close() hands focus back to the opener, unless the command just run shut the
      // section holding it: that body is inert now, so focus would drop to <body>. The
      // section's own header is the nearest place still on screen.
      headerHiding(opener.current)?.focus();
      opener.current = null;
      setQuery('');
      setActiveId(null);
    }
  }, [open]);

  // However the dialog closes — Esc, a command, the browser — the parent hears of it.
  React.useEffect(() => {
    const d = dialogRef.current;
    if (!d) return undefined;
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, [onClose]);

  // Deps matter here: with none, this ran after every render, and EcuLab rebuilds
  // `commands` (and so `results`) on every one of its own renders — at 20 Hz while the
  // engine is running. That scrolled the list back to the active option every 50 ms,
  // fighting anyone trying to scroll it by hand. `current >= 0 ? optionId(current) :
  // null` changes only on open and on a real change of which option is active. `query`
  // is here too: typing puts the first result back in charge, which is usually already
  // index 0, so the id alone would not change and a list scrolled by hand would leave
  // the result Enter runs out of sight.
  const activeOptionId = current >= 0 ? optionId(current) : null;
  React.useEffect(() => {
    if (!open || !activeOptionId) return;
    // Optional call: jsdom has no scrollIntoView.
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeOptionId, query]);

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
      setActiveId(results[(current + step + results.length) % results.length].id);
    } else if (e.key === 'Enter') {
      // An IME (composing Japanese, Chinese, Korean…) uses Enter to confirm the
      // candidate it is composing, not to submit. Without this guard that Enter both
      // confirms the candidate and runs whatever the palette currently has active.
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      runAt(current);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // The panel fills the dialog and draws its border, so the dialog itself is never hit
  // inside the panel: a press on the dialog is a press on the backdrop. Both ends of the
  // click must be there, because a click targets the common ancestor of where it was
  // pressed and released — a drag that selects the query and lets go past the panel's
  // edge is a "click" on the dialog too, and must not close it.
  /** @param {React.MouseEvent<HTMLDialogElement>} e */
  const onDialogMouseDown = (e) => { pressedBackdrop.current = e.target === dialogRef.current; };
  /** @param {React.MouseEvent<HTMLDialogElement>} e */
  const onDialogClick = (e) => {
    if (pressedBackdrop.current && e.target === dialogRef.current) onClose();
    pressedBackdrop.current = false;
  };

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-label="Command palette"
      onMouseDown={onDialogMouseDown} onClick={onDialogClick}
    >
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
          onChange={(e) => { setQuery(e.target.value); setActiveId(null); }}
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
              onMouseMove={() => { if (i !== current) setActiveId(c.id); }}
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
