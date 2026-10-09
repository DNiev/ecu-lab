# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach any page, and the few things a player does most, by typing — Cmd/Ctrl-K on a keyboard, a search button in the status strip on any width.

**Architecture:** A pure `src/ui/commands.js` owns the page list (derived from `ROUTES`, filtered by what would render) and the ranking. A `CommandPalette` component renders a native `<dialog>` with the ARIA combobox pattern and knows nothing of the store. `EcuLab` owns the open flag, the Cmd-K handler and the actions (it already owns their handlers); `AppShell`'s status strip gets a search button through an `onSearch` prop.

**Tech Stack:** React 18, Vite, Vitest + Testing Library on jsdom 25, JSDoc-typed JS checked by `tsc --noEmit`, ESLint `--max-warnings 0`, CSS modules on design tokens.

**Spec:** `docs/superpowers/specs/2026-09-30-command-palette-design.md`

## Global Constraints

- Always run Node 22: prefix commands with `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null &&`.
- Never write `#` followed by 3–8 hex-looking characters anywhere under `src/ui/` — comments included. `tests/no-hardcoded-colours.test.js` reads `#63` or `#106` as a colour. Write "issue 63".
- Colours in CSS modules come from tokens (`var(--…)`) only; no hex, no `rgb(` with a literal digit. `rgba(var(--shadow-rgb), 0.6)` is allowed.
- Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm run lint`, `npm run typecheck` and `npm test` must all be clean before a task is done.
- Out of scope, do not add: loading a preset, reset to stock, challenges, a side-rail search field.
- The strip button: `aria-label="Search pages and actions"`, `title="Search (⌘K)"`, first in StatusStrip's actions group.
- Cmd/Ctrl-K: app view only (not start or tutorial), toggles, works from inside a field, ignored when `altKey` is held.
- The palette's open flag is view state in EcuLab (`useState`), not the store, not undoable.
- Fingerprint unchanged: nothing under `src/sim` changes.

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/commands.js` (create) | Tab/section labels + keywords, `pageCommands`, `matchCommands`. Pure. |
| `tests/commands.test.js` (create) | Node-env unit tests for the above. |
| `src/ui/components/CommandPalette.jsx` (create) | The dialog, combobox, keyboard handling. |
| `src/ui/components/CommandPalette.module.css` (create) | Its styles, tokens only. |
| `src/ui/components/README.md` (modify) | Why this shared component has a stylesheet. |
| `tests/setup.js` (modify) | Stub `HTMLDialogElement#showModal`/`close` (jsdom 25 lacks them). |
| `tests/ui/command-palette.test.jsx` (create) | Component tests (Task 2) and integration tests through `EcuLab` (Task 3). |
| `src/ui/AppShell.jsx` (modify) | `onSearch` prop, search icon button. |
| `src/ui/EcuLab.jsx` (modify) | `paletteOpen`, Cmd-K, actions, `go`, render the palette. |

---

### Task 1: Pages and ranking — `src/ui/commands.js`

**Files:**
- Create: `src/ui/commands.js`
- Test: `tests/commands.test.js`

**Interfaces:**
- Consumes: `ROUTES` from `src/ui/routing.js` (`{ dash: ['jobs','stats','health','learn','realcar'], build: ['engine','induction','fuel','exhaust'], tune: ['airflow','spark','fuel','injectors','sensors'], live: ['engine'], dyno: ['result','data','log','score','history'], drag: ['body','gearing','tyres'] }`).
- Produces:
  - `/** @typedef {{ id: string, label: string, context?: string, kind: 'page'|'action', keywords: string[], run: () => void }} Command */` — `context` is the tab name printed before a section's label (`TUNE › Spark`); matching reads `label` and `keywords` only.
  - `TAB_LABELS: Record<string, {label: string, keywords: string[]}>`
  - `SECTION_LABELS: Record<string, {label: string, keywords: string[]}>` keyed `'tab/section'`, for every section of every tab with more than one section.
  - `pageCommands({ showJobs, hasResult, hasHistory, go }): Command[]` — `go(tab: string, section: string|null)`; `null` means "the tab, as a nav tap opens it".
  - `matchCommands(query: string, commands: Command[]): Command[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/commands.test.js`:

```js
/**
 * The command palette's page list and ranking (issue 63). Pure, so node env.
 */

import { describe, expect, it, vi } from 'vitest';

import { SECTION_LABELS, TAB_LABELS, matchCommands, pageCommands } from '../src/ui/commands.js';
import { ROUTES } from '../src/ui/routing.js';

const ALL = { showJobs: true, hasResult: true, hasHistory: true };
const pages = (flags = ALL, go = () => {}) => pageCommands({ ...flags, go });
const ids = (cmds) => cmds.map((c) => c.id);

/** @returns {import('../src/ui/commands.js').Command} */
const cmd = (id, label, keywords = [], kind = 'page') => ({ id, label, kind, keywords, run: () => {} });

describe('the label table', () => {
  it('labels every tab, and nothing that is not a tab', () => {
    expect(Object.keys(TAB_LABELS).sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it('labels every section of a multi-section tab, and nothing else', () => {
    const expected = Object.entries(ROUTES)
      .filter(([, sections]) => sections.length > 1)
      .flatMap(([tab, sections]) => sections.map((s) => `${tab}/${s}`))
      .sort();
    expect(Object.keys(SECTION_LABELS).sort()).toEqual(expected);
  });
});

describe('pageCommands', () => {
  it('lists each tab, then its sections, in nav order; a one-section tab is one command', () => {
    const list = ids(pages());
    expect(list.slice(0, 7)).toEqual([
      'page:dash', 'page:dash/jobs', 'page:dash/stats', 'page:dash/health',
      'page:dash/learn', 'page:dash/realcar', 'page:build',
    ]);
    expect(list).toContain('page:live');
    expect(list.some((id) => id.startsWith('page:live/'))).toBe(false);
    expect(list).toHaveLength(6 + 22);
  });

  it('prints the tab before a section, and not before a tab', () => {
    const spark = pages().find((c) => c.id === 'page:tune/spark');
    expect(spark).toMatchObject({ label: 'Spark', context: 'TUNE', kind: 'page' });
    expect(pages().find((c) => c.id === 'page:tune').context).toBeUndefined();
  });

  it('lets the tab name find its sections', () => {
    const spark = pages().find((c) => c.id === 'page:tune/spark');
    expect(spark.keywords).toContain('tune');
  });

  it('drops Customer Cars outside career', () => {
    expect(ids(pages({ ...ALL, showJobs: false }))).not.toContain('page:dash/jobs');
  });

  it('drops the four result sections before the first pull, and History with no pulls banked', () => {
    const list = ids(pages({ showJobs: true, hasResult: false, hasHistory: false }));
    for (const s of ['result', 'log', 'data', 'score', 'history']) expect(list).not.toContain(`page:dyno/${s}`);
    expect(list).toContain('page:dyno');
  });

  it('keeps History when pulls are banked but none is showing', () => {
    const list = ids(pages({ showJobs: true, hasResult: false, hasHistory: true }));
    expect(list).toContain('page:dyno/history');
    expect(list).not.toContain('page:dyno/result');
  });

  it('runs go with the tab and section, or null for a tab', () => {
    const go = vi.fn();
    const list = pages(ALL, go);
    list.find((c) => c.id === 'page:tune/spark').run();
    list.find((c) => c.id === 'page:dyno').run();
    expect(go.mock.calls).toEqual([['tune', 'spark'], ['dyno', null]]);
  });
});

describe('matchCommands', () => {
  const spark = cmd('s', 'Spark', ['timing']);
  const pullLog = cmd('l', 'Pull Log');
  const datalog = cmd('d', 'Datalog');
  const sensors = cmd('n', 'Sensors', ['maf']);
  const start = cmd('a', 'Start engine', ['engine'], 'action');

  it('ranks label start, then word start, then substring, then keyword', () => {
    const list = [cmd('k', 'Knock', ['log']), datalog, pullLog, cmd('x', 'Logbook')];
    expect(ids(matchCommands('log', list))).toEqual(['x', 'l', 'd', 'k']);
  });

  it('keeps input order within a rank', () => {
    expect(ids(matchCommands('s', [sensors, spark, start]))).toEqual(['n', 's', 'a']);
  });

  it('finds by keyword', () => {
    expect(ids(matchCommands('tim', [sensors, spark]))).toEqual(['s']);
  });

  it('ignores case and surrounding space', () => {
    expect(ids(matchCommands('  SPA ', [spark]))).toEqual(['s']);
  });

  it('drops what does not match', () => {
    expect(matchCommands('zzz', [spark, pullLog])).toEqual([]);
  });

  it('with no query lists actions first, then pages, each in input order', () => {
    expect(ids(matchCommands('', [spark, start, pullLog]))).toEqual(['a', 's', 'l']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/commands.test.js`
Expected: FAIL — cannot resolve `../src/ui/commands.js`.

- [ ] **Step 3: Implement**

Create `src/ui/commands.js`:

```js
/**
 * What the command palette (issue 63) can find: every page, and the ranking that
 * orders commands against a query.
 *
 * Pure — no React, no store. The pages derive from `ROUTES`, so a tab or section added
 * there without a label here fails `tests/commands.test.js` rather than going missing
 * from the palette. The actions (start the engine, run a pull, undo…) are built in
 * `EcuLab.jsx`, which owns their handlers, and are matched here beside the pages.
 */

import { ROUTES } from './routing.js';

/**
 * One thing the palette can run.
 * @typedef {object} Command
 * @property {string} id
 * @property {string} label what is matched against first, and printed
 * @property {string} [context] the tab name printed before a section's label
 * @property {'page'|'action'} kind
 * @property {string[]} keywords other words a player might type for it
 * @property {() => void} run
 */

/** Each tab as the nav prints it, and what else a player might call it. */
export const TAB_LABELS = {
  dash: { label: 'HOME', keywords: ['dashboard'] },
  build: { label: 'BUILD', keywords: ['garage', 'hardware'] },
  tune: { label: 'TUNE', keywords: ['calibration', 'tables'] },
  live: { label: 'LIVE', keywords: ['engine', 'sound', 'rev'] },
  dyno: { label: 'DYNO', keywords: ['pull', 'power'] },
  drag: { label: 'DRAG', keywords: ['strip', 'quarter'] },
};

/**
 * Each section's label, keyed `tab/section`. The labels are the screens' own
 * headings. A tab with one section (LIVE) has no entry: its tab command is the page.
 */
export const SECTION_LABELS = {
  'dash/jobs': { label: 'Customer Cars', keywords: ['career', 'jobs'] },
  'dash/stats': { label: 'Career & Last Pull', keywords: ['stats', 'best'] },
  'dash/health': { label: 'Engine Health', keywords: ['wear', 'repair'] },
  'dash/learn': { label: 'Learn How It Works', keywords: ['guide', 'articles'] },
  'dash/realcar': { label: 'Taking It To A Real Car', keywords: ['software', 'real'] },
  'build/engine': { label: 'Engine Architecture', keywords: ['preset', 'cam', 'bore', 'stroke'] },
  'build/induction': { label: 'Induction', keywords: ['turbo', 'boost', 'intake'] },
  'build/fuel': { label: 'Fuel System', keywords: ['octane', 'pump'] },
  'build/exhaust': { label: 'Exhaust', keywords: ['pipe', 'header'] },
  'tune/airflow': { label: 'Airflow', keywords: ['ve', 'volumetric'] },
  'tune/spark': { label: 'Spark', keywords: ['timing', 'ignition', 'knock'] },
  'tune/fuel': { label: 'Fuel', keywords: ['afr', 'lambda', 'mixture'] },
  'tune/injectors': { label: 'Injectors', keywords: ['duty', 'scaling'] },
  'tune/sensors': { label: 'Sensors', keywords: ['maf'] },
  'dyno/result': { label: 'Curves', keywords: ['power', 'torque', 'result'] },
  'dyno/data': { label: 'Datalog', keywords: ['histogram', 'data'] },
  'dyno/log': { label: 'Pull Log', keywords: ['events'] },
  'dyno/score': { label: 'Score', keywords: ['grade'] },
  'dyno/history': { label: 'History', keywords: ['runs', 'previous'] },
  'drag/body': { label: 'Car Body', keywords: ['weight', 'aero'] },
  'drag/gearing': { label: 'Gearbox', keywords: ['gears', 'ratio'] },
  'drag/tyres': { label: 'Tyres & Drive', keywords: ['tires', 'traction'] },
};

/** DYNO sections that render nothing until there is a pull to show. */
const RESULT_SECTIONS = new Set(['dyno/result', 'dyno/log', 'dyno/data', 'dyno/score']);

/**
 * Whether a section would render anything right now — the same conditions its own
 * screen applies, so the palette never offers a blank page.
 * @param {string} key `tab/section`
 * @param {{showJobs: boolean, hasResult: boolean, hasHistory: boolean}} flags
 * @returns {boolean}
 */
function available(key, { showJobs, hasResult, hasHistory }) {
  if (key === 'dash/jobs') return showJobs;
  if (RESULT_SECTIONS.has(key)) return hasResult;
  if (key === 'dyno/history') return hasHistory || hasResult;
  return true;
}

/**
 * One command per tab and one per section, in nav order, leaving out sections that
 * would render nothing.
 * @param {object} args
 * @param {boolean} args.showJobs career mode, or a job underway
 * @param {boolean} args.hasResult a pull is showing
 * @param {boolean} args.hasHistory at least one pull is banked
 * @param {(tab: string, section: string|null) => void} args.go `null`: the tab, as a
 *   nav tap opens it
 * @returns {Command[]}
 */
export function pageCommands({ showJobs, hasResult, hasHistory, go }) {
  /** @type {Command[]} */
  const out = [];
  for (const [tab, sections] of Object.entries(ROUTES)) {
    const t = TAB_LABELS[tab];
    out.push({ id: `page:${tab}`, label: t.label, kind: 'page', keywords: t.keywords, run: () => go(tab, null) });
    if (sections.length < 2) continue;
    for (const section of sections) {
      const key = `${tab}/${section}`;
      if (!available(key, { showJobs, hasResult, hasHistory })) continue;
      const s = SECTION_LABELS[key];
      out.push({
        id: `page:${key}`, label: s.label, context: t.label, kind: 'page',
        keywords: [...s.keywords, t.label.toLowerCase()],
        run: () => go(tab, section),
      });
    }
  }
  return out;
}

/**
 * How well a command matches a lower-cased query: 0 is best, 4 is no match.
 * @param {string} q
 * @param {Command} c
 * @returns {number}
 */
function rank(q, c) {
  const label = c.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  if (c.keywords.some((k) => k.startsWith(q))) return 3;
  return 4;
}

/**
 * The commands that match `query`, best first and in input order within a rank.
 * An empty query returns everything: actions first, then pages.
 * @param {string} query
 * @param {Command[]} commands
 * @returns {Command[]}
 */
export function matchCommands(query, commands) {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands.filter((c) => c.kind === 'action'), ...commands.filter((c) => c.kind === 'page')];
  return commands
    .map((c, i) => ({ c, i, r: rank(q, c) }))
    .filter((x) => x.r < 4)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/commands.test.js tests/no-hardcoded-colours.test.js`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run lint && npm run typecheck
git add src/ui/commands.js tests/commands.test.js
git commit -m "List every page for the command palette, and rank them against a query (#63)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The palette component

**Files:**
- Create: `src/ui/components/CommandPalette.jsx`, `src/ui/components/CommandPalette.module.css`, `tests/ui/command-palette.test.jsx`
- Modify: `tests/setup.js` (append), `src/ui/components/README.md` (append a paragraph)

**Interfaces:**
- Consumes: `matchCommands(query, commands)` and the `Command` typedef from `src/ui/commands.js` (Task 1).
- Produces: `export function CommandPalette({ open, onClose, commands })` — `open: boolean`, `onClose: () => void` (must be idempotent; the component may call it more than once per close), `commands: Command[]`. The dialog is labelled `Command palette`; the input is a `combobox` labelled `Search pages and actions`; results are `option`s in a `listbox` labelled `Results`; an empty result reads `No matches`.

- [ ] **Step 1: Stub the dialog in the test setup**

Append to `tests/setup.js`:

```js
/**
 * jsdom 25 has `HTMLDialogElement` but not `showModal`/`close`. These do the part a
 * test can observe — the `open` flag and the `close` event — and none of the modal
 * behaviour (top layer, inert page, focus return), which is checked in a browser.
 */
if (typeof window !== 'undefined' && window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
}
```

- [ ] **Step 2: Write the failing component tests**

Create `tests/ui/command-palette.test.jsx`:

```jsx
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
const input = () => screen.getByRole('combobox', { name: 'Search pages and actions' });
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/command-palette.test.jsx`
Expected: FAIL — cannot resolve `CommandPalette.jsx`.

- [ ] **Step 4: Implement the component**

Create `src/ui/components/CommandPalette.jsx`:

```jsx
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
```

Create `src/ui/components/CommandPalette.module.css`:

```css
/* The command palette (issue 63). Tokens only — see tests/no-hardcoded-colours.test.js. */

.dialog {
  padding: 0;
  border: 1px solid var(--line-hi);
  border-radius: var(--r-lg);
  background: var(--panel);
  color: var(--ink);
  /* Functional sizes, not rhythm steps: a readable column on a desktop, the phone
     width less the page's 16px gutters on a phone. */
  width: min(560px, calc(100vw - 32px));
  max-height: min(480px, calc(100vh - 96px));
  margin: 12vh auto auto;
  overflow: hidden;
}

.dialog::backdrop { background: rgba(var(--shadow-rgb), 0.6); }

.panel {
  display: flex;
  flex-direction: column;
  max-height: inherit;
}

.input {
  padding: var(--sp-lg) var(--sp-xl);
  border: none;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font-family: var(--sans);
  font-size: var(--fs-md);
}

.input::placeholder { color: var(--ink2); }
.input:focus-visible { outline: none; }

.list {
  margin: 0;
  padding: var(--sp-xs) 0;
  list-style: none;
  overflow-y: auto;
}

.option {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--sp-md);
  padding: var(--sp-md) var(--sp-xl);
  font-size: var(--fs-base);
  cursor: pointer;
}

.option[aria-selected='true'] { background: var(--acc-bg); }

.label { font-weight: 600; }
.context { color: var(--ink2); font-weight: 700; }

.kind {
  flex-shrink: 0;
  color: var(--ink2);
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.empty {
  margin: 0;
  padding: var(--sp-lg) var(--sp-xl);
  color: var(--ink2);
  font-size: var(--fs-base);
}
```

Append to `src/ui/components/README.md`:

```markdown

`CommandPalette` is the one file here with a stylesheet, and the reason is the
opposite of its neighbours': they were lifted out of `EcuLab.jsx` with inline styles
already on them, and it was written new (issue 63), so it was written the way a
primitive is. It is not in `primitives/` because it is not general — it knows what a
command is. It knows nothing else: `commands.js` beside the shell builds and ranks
the list, and EcuLab owns when it is open.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/command-palette.test.jsx tests/no-hardcoded-colours.test.js`
Expected: PASS.

- [ ] **Step 6: Full suite, lint, typecheck, commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test && npm run lint && npm run typecheck
git add src/ui/components/CommandPalette.jsx src/ui/components/CommandPalette.module.css src/ui/components/README.md tests/setup.js tests/ui/command-palette.test.jsx
git commit -m "Add the command palette: a dialog that finds a command as you type (#63)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wire it into the app — Cmd-K, the strip button, the actions

**Files:**
- Modify: `src/ui/AppShell.jsx` (lucide import at line ~47; `StatusStrip` JSDoc + signature ~line 203–207 and its actions group ~line 258; `AppShell` JSDoc + signature ~line 270–285)
- Modify: `src/ui/EcuLab.jsx` (imports ~line 50; the "There is no local `useState` left in this file" comment ~line 340; a new effect after the undo handler ~line 979; commands before the `if (appView === 'start')` early return ~line 1202; the `<AppShell …>` element ~line 1237 and the end of its children)
- Test: `tests/ui/command-palette.test.jsx` (append a describe)

**Interfaces:**
- Consumes: `pageCommands({ showJobs, hasResult, hasHistory, go })` and `Command` from `src/ui/commands.js`; `CommandPalette({ open, onClose, commands })` from `src/ui/components/CommandPalette.jsx`.
- Existing EcuLab names used (all already in scope in the `EcuLab` inner component): `appView`, `changeTab(t)`, `goSection(t, sec)`, `setSelection(v)`, `dispatch`, `ACTIONS.UNDO`, `ACTIONS.REDO`, `startEngine`, `stopEngine`, `doRun`, `toggleSound`, and from the session slice `live`, `running`, `soundOn`, `result`, `runs`, `mode`, `activeJob`. `useHistory` comes from `./state/StoreProvider.jsx` and returns `[{ past, future }]` where each entry has a `label` string (see `src/ui/components/UndoControls.jsx:31-32`).
- Produces: `AppShell` and `StatusStrip` accept `onSearch?: () => void`.

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/ui/command-palette.test.jsx`. Add `import EcuLab from '../../src/ui/EcuLab.jsx';` and `within` to the Testing Library import at the top of the file.

```jsx
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

  it('ignores Cmd-Alt-K, and Cmd-K on the start screen', () => {
    render(<EcuLab />);
    cmdK();
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    cmdK({ altKey: true });
    expect(isOpen()).toBe(false);
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
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/command-palette.test.jsx`
Expected: the Task 2 tests pass; the new describe fails (no dialog in the app, no `Search pages and actions` button).

- [ ] **Step 3: Add the strip button to `AppShell.jsx`**

Change the lucide import to add `Search`:

```js
import {
  Activity, Flag, Flame, Gauge, Grid3x3, Info, Search, Settings, Wrench,
} from 'lucide-react';
```

In `StatusStrip`'s JSDoc, extend the paragraph about `onTutorial`/`onRepair` to name `onSearch` too, and add the param:

```js
 * `onTutorial`/`onRepair`/`onSearch` are the exception: what those icon buttons DO is
 * not chrome's business (see this file's header), so they arrive as props from
 * `EcuLab.jsx` exactly like `onNavigate` does, and are rendered here because this is
 * where the header's icon buttons used to live.
 *
 * @param {object} props
 * @param {() => void} [props.onTutorial]
 * @param {() => void} [props.onRepair]
 * @param {() => void} [props.onSearch] opens the command palette
```

Signature: `export function StatusStrip({ onTutorial, onRepair, onSearch }) {`

First child of `<div className={styles.actions}>`:

```jsx
          <Button variant="ghost" size="sm" title="Search (⌘K)" aria-label="Search pages and actions" onClick={onSearch}>
            <Search size={16} aria-hidden="true" />
          </Button>
```

In `AppShell`'s JSDoc add `@param {() => void} [props.onSearch] what the strip's Search button means`, destructure `onSearch`, and pass it: `<StatusStrip onTutorial={onTutorial} onRepair={onRepair} onSearch={onSearch} />`.

- [ ] **Step 4: Wire EcuLab**

Imports — add `useState` to the React import, `useHistory` to the StoreProvider import, and two new imports beside the other `./components/…` imports:

```js
import React, { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { StoreProvider, useBuild, useHistory, useSession, useTune } from './state/StoreProvider.jsx';
import { pageCommands } from './commands.js';
import { CommandPalette } from './components/CommandPalette.jsx';
```

Replace the sentence "There is no local `useState` left in this file:" in the comment above `const [session] = useSession();` with "The only local `useState` in this file is the command palette's open flag, further down;" — keep the rest of that comment as it is.

After the undo/redo `useEffect` (the one ending `}, [dispatch]);`), add:

```js
  // The command palette (issue 63). Whether it is open is VIEW state like the route,
  // but nothing links to an open palette, so it is local rather than in the hash.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const [history] = useHistory();

  // Cmd/Ctrl-K toggles it, in the app view only. Unlike undo it is not held back from
  // text fields: Cmd-K means nothing to an input, and the palette's own field is one.
  useEffect(() => {
    if (appView !== 'app') return undefined;
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      // Alt excluded for the same AltGr reason as the undo handler above.
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setPaletteOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appView]);
```

Immediately before `if (appView === 'start') {`, add:

```js
  // Built only while the palette is open: its labels read the undo stack and the
  // engine state, and nothing needs them otherwise. Only what can be taken back is
  // here — no preset load, no reset to stock (see the spec).
  /** @type {import('./commands.js').Command[]} */
  const paletteCommands = [];
  if (paletteOpen) {
    const engineOn = live.running || live.cranking;
    const actions = [
      engineOn
        ? { id: 'act:stop', label: 'Stop engine', keywords: ['engine', 'off'], run: stopEngine }
        : { id: 'act:start', label: 'Start engine', keywords: ['engine', 'crank'], run: startEngine },
      !running && {
        id: 'act:pull', label: 'Run dyno pull', keywords: ['dyno', 'sweep', 'power'],
        run: () => { goSection('dyno', 'result'); doRun(); },
      },
      history.past.length > 0 && {
        id: 'act:undo', label: `Undo ${history.past[history.past.length - 1].label}`, keywords: [],
        run: () => dispatch({ type: ACTIONS.UNDO }),
      },
      history.future.length > 0 && {
        id: 'act:redo', label: `Redo ${history.future[0].label}`, keywords: [],
        run: () => dispatch({ type: ACTIONS.REDO }),
      },
      { id: 'act:sound', label: soundOn ? 'Sound off' : 'Sound on', keywords: ['audio', 'mute'], run: toggleSound },
    ];
    for (const a of actions) if (a) paletteCommands.push({ ...a, kind: 'action' });
    /** A page command's target: a tab exactly as the nav opens it, or one section. */
    const go = (t, sec) => {
      if (sec === null) { changeTab(t); return; }
      goSection(t, sec);
      setSelection(null);
    };
    paletteCommands.push(...pageCommands({
      showJobs: mode === 'career' || activeJob != null,
      hasResult: result != null,
      hasHistory: runs.length > 0,
      go,
    }));
  }
```

On the `<AppShell …>` element add `onSearch={openPalette}`:

```jsx
      <AppShell route={route} onNavigate={changeTab} onTutorial={goTutorial} onRepair={repairEngine} onSearch={openPalette}>
```

As the last child inside `<AppShell>` (immediately before `</AppShell>`), add:

```jsx
        {/* In the top layer when open, so where it sits in the tree does not matter. */}
        <CommandPalette open={paletteOpen} onClose={closePalette} commands={paletteCommands} />
```

If `npm run typecheck` rejects the `actions` array (a union of objects and `false`), type it: `/** @type {(Omit<import('./commands.js').Command, 'kind'>|false)[]} */` on `const actions`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run tests/ui/command-palette.test.jsx tests/ui/app-shell.test.jsx tests/ui/routing-shell.test.jsx tests/no-hardcoded-colours.test.js`
Expected: PASS.

- [ ] **Step 6: Full suite, lint, typecheck, commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test && npm run lint && npm run typecheck
git add src/ui/AppShell.jsx src/ui/EcuLab.jsx tests/ui/command-palette.test.jsx
git commit -m "Open the command palette from Cmd-K or the strip, with pages and actions (#63)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### After the tasks (controller, not a subagent task)

Browser check with the dev server at desktop width and at 375px:
- Cmd-K opens the real dialog; Esc closes it; a backdrop click closes it; focus returns to the search button when opened from it.
- `spark` + Enter lands on TUNE › Spark; `run dyno` runs a pull.
- At 375px the dialog fits inside the 16px gutters, and the status strip's `scrollWidth` is no wider than before the change (compare against `main`).
