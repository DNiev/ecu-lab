# Screen-reader state (#81) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TUNE/DYNO page switchers, `BuildSection`, `ExpandableInfo` and the LIVE sound toggle announce their state to a screen reader.

**Architecture:** Attribute-level changes in place: `<nav>` + `aria-current="page"` for the two page switchers, `aria-expanded`/`aria-controls`/`inert` for the two disclosures, `aria-pressed`/`aria-label` for the sound toggle. No new primitives.

**Tech Stack:** React 18, Vitest + Testing Library on jsdom 25. JSDoc JS checked by `tsc --noEmit`; ESLint `--max-warnings 0`.

Spec: `docs/superpowers/specs/2026-10-08-screen-reader-state-design.md`.

## Global Constraints

- Run everything on Node 22: `source ~/.nvm/nvm.sh && nvm use 22`.
- `aria-current` is ABSENT (`undefined`) on non-current items, never the string `"false"` — the rule `SideNav` in `src/ui/AppShell.jsx` follows.
- Collapsed bodies stay mounted (they animate). They get `inert` as a string: `inert={open ? undefined : ''}` (React 18 drops a boolean `inert`).
- A `BuildSection` body must remain the header button's `nextElementSibling` — `sectionIsOpen` in `tests/ui/routing-shell.test.jsx` reads it.
- Do not write a `#` followed by digits in `src/ui` (the colour guard test flags it as a hex colour); write "issue 81".
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before each commit: `npx vitest run`, `npx tsc --noEmit`, `npx eslint . --max-warnings 0` all clean.

---

### Task 1: TUNE and DYNO page switchers

**Files:**
- Modify: `src/ui/EcuLab.jsx` (TUNE switcher at the `TUNE: sub-view switcher` comment, about line 1437; DYNO switcher at the `HISTORY sits outside the result gate` comment, about line 1636)
- Test: `tests/ui/routing-shell.test.jsx`, `tests/ui/dyno-screens.test.jsx`

**Interfaces:** none consumed or produced.

- [ ] **Step 1: Write the failing tests.** In `tests/ui/routing-shell.test.jsx`, inside `describe('clicking a tab', ...)` after the "routes every TUNE sub-tab" test, add (add `within` to the `@testing-library/react` import):

```jsx
  it('marks the open TUNE and DYNO page aria-current, and moves it on navigation', () => {
    launch();
    /** @param {string} name @returns {string[]} labels of the current buttons in that nav */
    const current = (name) => within(screen.getByRole('navigation', { name }))
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-current') === 'page')
      .map((b) => b.textContent);

    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));
    expect(current('TUNE pages')).toEqual(['AIRFLOW']);
    fireEvent.click(screen.getByRole('button', { name: 'SPARK' }));
    expect(current('TUNE pages')).toEqual(['SPARK']);
    // Absent, not "false", on every other page.
    const others = within(screen.getByRole('navigation', { name: 'TUNE pages' }))
      .getAllByRole('button').filter((b) => b.textContent !== 'SPARK');
    for (const b of others) expect(b.hasAttribute('aria-current')).toBe(false);
  });
```

In `tests/ui/dyno-screens.test.jsx`, add a new describe at the end of the file:

```jsx
describe('the DYNO page switcher', () => {
  it('is a labelled nav, marks the open page, and names PULL LOG with its entry count', async () => {
    let dispatch;
    render(
      <StoreProvider>
        <Capture onDispatch={(d) => { dispatch = d; }} />
        <EcuLabApp />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    // A stock pull logs nothing; 10° of extra spark everywhere makes it knock.
    const timing = makeInitialState().tune.timing.map((row) => row.map((v) => v + 10));
    act(() => dispatch({ type: ACTIONS.SET_TABLE, table: 'timing', value: timing }));
    fireEvent.click(screen.getByRole('button', { name: /DYNO/ }));
    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(),
      { timeout: 10000 },
    );

    const nav = screen.getByRole('navigation', { name: 'DYNO pages' });
    const log = within(nav).getByRole('button', { name: /^PULL LOG, \d+ entr(y|ies)$/ });
    expect(log.querySelector('[aria-hidden="true"]')).toBeTruthy();

    fireEvent.click(within(nav).getByRole('button', { name: 'DATALOG' }));
    const current = within(nav).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current.map((b) => b.textContent)).toEqual(['DATALOG']);
  }, 20000);
});
```

- [ ] **Step 2: Run them and see them fail.**
Run: `npx vitest run tests/ui/routing-shell.test.jsx tests/ui/dyno-screens.test.jsx`
Expected: the two new tests FAIL (no `navigation` named "TUNE pages" / "DYNO pages").

- [ ] **Step 3: TUNE switcher.** In `src/ui/EcuLab.jsx`, wrap the `(nitrous ? [0, 1, 2] : [0, 1]).map(...)` rows (only the rows; `<MapSlots />` above and the "Numbered pages…" footer below stay outside) in:

```jsx
            <nav aria-label="TUNE pages" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* ...the existing rows .map(...) unchanged... */}
            </nav>
```

and on each row's `<button key={v.id} ...>` add, after `onClick`:

```jsx
                        aria-current={on ? 'page' : undefined}
```

- [ ] **Step 4: DYNO switcher.** Change the switcher's outer `<div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>` to `<nav aria-label="DYNO pages" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>` (and its closing tag). Inside the `.map`, replace `const flag = id === 'log' && result && result.events.length > 0;` with:

```jsx
                  const entries = id === 'log' && result ? result.events.length : 0;
```

and the button becomes:

```jsx
                    <button key={id} onClick={() => goSection('dyno', id)}
                      aria-current={on ? 'page' : undefined}
                      aria-label={entries ? `${label}, ${entries} ${entries === 1 ? 'entry' : 'entries'}` : undefined}
                      style={{ /* unchanged */ }}>
                      {label}
                      {entries > 0 && <span aria-hidden="true" style={{ /* unchanged dot style */ }} />}
                    </button>
```

- [ ] **Step 5: Run the tests.**
Run: `npx vitest run tests/ui/routing-shell.test.jsx tests/ui/dyno-screens.test.jsx`
Expected: PASS. Then the full gate: `npx vitest run && npx tsc --noEmit && npx eslint . --max-warnings 0`.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/EcuLab.jsx tests/ui/routing-shell.test.jsx tests/ui/dyno-screens.test.jsx
git commit -m "TUNE and DYNO page switchers say which page is open (issue 81)"
```

---

### Task 2: Disclosures and the sound toggle

**Files:**
- Modify: `src/ui/components/BuildSection.jsx`, `src/ui/components/ExpandableInfo.jsx`, `src/ui/components/README.md` (the line mentioning issue #81), `src/ui/screens/dash/LiveScreen.jsx` (sound `<button>` near line 151)
- Create: `tests/ui/disclosures.test.jsx`
- Modify test: `tests/ui/session-store.test.jsx` (`describe('the engine-sound toggle', ...)`, about line 712)

**Interfaces:** `BuildSection({ active, onClick, icon, label, sub, children })` and `ExpandableInfo({ title, children })` keep their props.

- [ ] **Step 1: Write the failing tests.** Create `tests/ui/disclosures.test.jsx`:

```jsx
// @vitest-environment jsdom

/**
 * The two expand/collapse components every screen uses. Both keep a collapsed body
 * mounted so it can animate, which is exactly why each has to say it is shut: an
 * open/closed chevron is nothing to a screen reader, and a mounted body is reachable
 * by Tab unless it is inert.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Wrench } from 'lucide-react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { BuildSection } from '../../src/ui/components/BuildSection.jsx';
import { ExpandableInfo } from '../../src/ui/components/ExpandableInfo.jsx';

afterEach(cleanup);

/** @param {HTMLElement} header @returns {HTMLElement} */
const bodyOf = (header) => /** @type {HTMLElement} */ (document.getElementById(header.getAttribute('aria-controls')));

/** @param {HTMLElement} header @param {boolean} open */
function expectState(header, open) {
  expect(header.getAttribute('aria-expanded')).toBe(String(open));
  const body = bodyOf(header);
  expect(body).toBeTruthy();
  expect(body.hasAttribute('inert')).toBe(!open);
}

function Section() {
  const [open, setOpen] = useState(false);
  return (
    <BuildSection active={open} onClick={() => setOpen(!open)} icon={Wrench} label="Engine">
      <button type="button">inside</button>
    </BuildSection>
  );
}

describe('BuildSection', () => {
  it('announces open and shut, and names its body', () => {
    render(<Section />);
    const header = screen.getByRole('button', { name: /Engine/ });
    expectState(header, false);
    fireEvent.click(header);
    expectState(header, true);
    expect(bodyOf(header).contains(screen.getByText('inside'))).toBe(true);
  });

  it('keeps the body as the header button\'s next sibling', () => {
    render(<Section />);
    const header = screen.getByRole('button', { name: /Engine/ });
    expect(header.nextElementSibling).toBe(bodyOf(header));
  });
});

describe('ExpandableInfo', () => {
  it('announces open and shut, and names its body', () => {
    render(<ExpandableInfo title="Why">Because.</ExpandableInfo>);
    const header = screen.getByRole('button', { name: /Why/ });
    expectState(header, false);
    fireEvent.click(header);
    expectState(header, true);
    expect(bodyOf(header).textContent).toContain('Because.');
  });
});
```

In `tests/ui/session-store.test.jsx`, replace the body of `it('switches the button between on and off', ...)` with:

```jsx
    // `soundOn` gates the audio synth's master gain, which jsdom has no way to hear.
    // The button's pressed state is the readable half of that write.
    launchOnLive();
    const toggle = () => screen.getByRole('button', { name: 'Engine sound' });
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(toggle().textContent).toBe('♪');

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(toggle().textContent).toBe('✕');

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
```

(`soundOn` starts `true` in `src/ui/state/initialState.js`.)

- [ ] **Step 2: Run them and see them fail.**
Run: `npx vitest run tests/ui/disclosures.test.jsx tests/ui/session-store.test.jsx`
Expected: FAIL — no `aria-controls`/`aria-expanded`, and no button named "Engine sound".

- [ ] **Step 3: `BuildSection`.** Import `useId` (`import React, { useId } from 'react';`). In the function body add `const bodyId = useId();`. On the header `<button>` add `type="button" aria-expanded={active ? 'true' : 'false'} aria-controls={bodyId}`. On the body `<div style={{ maxHeight: ... }}>` add `id={bodyId} inert={active ? undefined : ''}`. Mark the chevron `aria-hidden="true"`. Add one comment line above the body div: `{/* inert while shut: still mounted so it can animate, but neither read nor tabbable. */}` (place it so the body stays the button's next ELEMENT sibling — a JSX comment renders nothing, so that holds).

- [ ] **Step 4: `ExpandableInfo`.** Import `useId` (`import React, { useId, useState } from 'react';`). Add `const bodyId = useId();`. Header `<button>` gets `type="button" aria-expanded={open ? 'true' : 'false'} aria-controls={bodyId}`. The outer grid `<div style={{ display: 'grid', ... }}>` gets `id={bodyId} inert={open ? undefined : ''}`. Mark the `ChevronDown` `aria-hidden="true"`.

If `tsc` rejects `inert` as an unknown prop on a `div` in either file, use a typed spread instead: `{...(/** @type {object} */ (active ? {} : { inert: '' }))}`.

- [ ] **Step 5: README.** In `src/ui/components/README.md`, replace the sentence that says issue #81 tracks replacing both with a `Disclosure` primitive with: both now carry `aria-expanded`, `aria-controls` and an `inert` collapsed body (issue #81); a shared `Disclosure` primitive was left for later because a branch in flight edits both files.

- [ ] **Step 6: Sound toggle.** In `src/ui/screens/dash/LiveScreen.jsx`, the raw sound `<button className={styles.sound} ...>` gets `type="button" aria-pressed={soundOn} aria-label="Engine sound"`, and its glyph is wrapped: `<span aria-hidden="true">{soundOn ? '♪' : '✕'}</span>`. Keep `title="Engine sound"` and `data-on`.

- [ ] **Step 7: Run the tests.**
Run: `npx vitest run tests/ui/disclosures.test.jsx tests/ui/session-store.test.jsx tests/ui/routing-shell.test.jsx`
Expected: PASS. Then the full gate: `npx vitest run && npx tsc --noEmit && npx eslint . --max-warnings 0`.

- [ ] **Step 8: Commit.**

```bash
git add src/ui/components/BuildSection.jsx src/ui/components/ExpandableInfo.jsx src/ui/components/README.md src/ui/screens/dash/LiveScreen.jsx tests/ui/disclosures.test.jsx tests/ui/session-store.test.jsx
git commit -m "Accordions, info disclosures and the sound toggle announce their state (issue 81)"
```
