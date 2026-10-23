# `--ink3` Text Contrast (#79) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No text in `src/ui` is coloured `--ink3`; a guard test keeps it that way.

**Architecture:** A per-file guard test (like `tests/no-hardcoded-colours.test.js`) plus a premise test that `ink2` passes AA on every surface, then a site-by-site swap of `--ink3` → `--ink2` for text. CSS modules first (Task 1), then inline JSX and chart axes (Task 2), each task extending the guard to the files it cleans.

**Tech Stack:** React 18, CSS Modules, recharts, Vitest. JSDoc JS checked by `tsc --noEmit`; ESLint `--max-warnings 0`.

Spec: `docs/superpowers/specs/2026-10-08-ink3-text-contrast-design.md`.

## Global Constraints

- Run everything on Node 22: `source ~/.nvm/nvm.sh && nvm use 22`.
- Text is never coloured `--ink3`. Text sites become `--ink2` (CSS) / `T.ink2` (JSX). Chevrons and other icons coloured through `color` become `--ink2` too.
- `--ink3` stays for `stroke`/`fill` graphics and borders; do not touch those.
- A `color` use that is genuinely text-free decoration may keep `--ink3` only if its own line or the line above contains a comment with the word `decorative` saying why. Expect this to be rare or zero.
- Change colour only. Do not change sizes, weights or layout.
- Do not write `#` followed by digits in `src/ui` (the colour guard flags it); write "issue 79".
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before each commit: `npx vitest run`, `npx tsc --noEmit`, `npx eslint . --max-warnings 0` all clean.

---

### Task 1: Guard test, premise test, and the CSS-module sweep

**Files:**
- Create: `tests/no-ink3-text.test.js`
- Modify: every `src/ui/**/*.module.css` with a `color: var(--ink3)` declaration (about 55 declarations across about 28 files; `grep -rn "color: var(--ink3)" src/ui` lists them)

**Interfaces:**
- Produces: `tests/no-ink3-text.test.js` with a `GUARDED` extension regex that Task 2 widens from `/\.css$/` to `/\.(jsx?|css)$/`.

- [ ] **Step 1: Write the guard and premise tests.** Create `tests/no-ink3-text.test.js`:

```js
/**
 * Guards issue 79: text is never coloured --ink3.
 *
 * --ink3 measures 2.56-3.47:1 against the four surfaces, under WCAG AA's 4.5:1 for small
 * text on every one of them. Brightening it until it passes would make it --ink2, so the
 * rule is per use: text takes --ink2, and hierarchy below that comes from size and
 * weight. --ink3 stays for stroke/fill graphics and borders, which this does not match.
 *
 * A colour use that is genuinely text-free may keep --ink3 if its line, or the line
 * above, says `decorative` in a comment explaining why.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { tokens } from '../src/ui/tokens.js';

const UI_DIR = new URL('../src/ui/', import.meta.url);

/** The token layer defines --ink3; it does not use it. */
const ALLOWED = new Set(['tokens.js', 'tokens.css', 'theme.js']);

/** Which files the guard reads. */
const GUARDED = /\.css$/;

/**
 * A line that colours text --ink3: a CSS `color` (not `border-color`), a JSX `color:`
 * whose expression up to the next `,` or `}` names T.ink3, or a recharts axis stroked
 * T.ink3 (recharts colours tick labels with the axis stroke).
 */
const INK3_TEXT = [
  /(^|[^-\w])color\s*:\s*var\(--ink3\)/,
  /(^|[^-\w])color\s*:[^,}]*\bT\.ink3\b/,
  /<[XY]Axis\b[^>]*\bstroke=\{T\.ink3\}/,
];

/** @returns {string[]} every guarded source file under src/ui */
function sourceFiles() {
  return readdirSync(UI_DIR, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && GUARDED.test(e.name) && !ALLOWED.has(e.name))
    .map((e) => `${e.parentPath ?? e.path}/${e.name}`);
}

/**
 * @param {string} hex `#rrggbb`
 * @returns {number} WCAG relative luminance
 */
function luminance(hex) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} a @param {string} b @returns {number} WCAG contrast ratio */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the premise: --ink2 is legible small text on every surface', () => {
  for (const surface of ['bg', 'panel', 'panel2', 'panel3']) {
    it(`ink2 on ${surface} is at least 4.5:1`, () => {
      expect(contrast(tokens.ink2, tokens[surface])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('src/ui colours no text --ink3', () => {
  for (const file of sourceFiles()) {
    const rel = file.slice(file.indexOf('src/ui'));
    it(`${rel} colours no text --ink3`, () => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const hits = lines
        .map((line, i) => ({ line, n: i + 1, above: lines[i - 1] ?? '' }))
        .filter(({ line, above }) => INK3_TEXT.some((re) => re.test(line))
          && !/decorative/.test(line) && !/decorative/.test(above))
        .map(({ line, n }) => `${n}: ${line.trim()}`);
      expect(hits, 'text takes --ink2 (issue 79); a text-free graphic may say `decorative`').toEqual([]);
    });
  }
});
```

Check first that `src/ui/tokens.js` exports the palette as `tokens` with keys `ink2`, `bg`, `panel`, `panel2`, `panel3` (`src/ui/theme.js` reads `tokens.ink2`). If the export name differs, use the real one.

- [ ] **Step 2: Run it and see it fail.**
Run: `npx vitest run tests/no-ink3-text.test.js`
Expected: the four premise tests PASS; about 28 CSS-file tests FAIL, each listing its `color: var(--ink3)` lines.

- [ ] **Step 3: Sweep the CSS modules.** For each failing line, open the rule and look at what the selector styles (check the JSX that uses the class). If it styles text, or an icon that carries meaning, change `var(--ink3)` to `var(--ink2)`. If the element holds nothing but a purely decorative graphic, keep `--ink3` and add a `/* decorative: <why> */` comment on that line. Where a nearby comment explains the old `--ink3` choice, update it in one clause (e.g. "--ink2, not --ink3: issue 79").

- [ ] **Step 4: Run it and see it pass.**
Run: `npx vitest run tests/no-ink3-text.test.js`
Expected: PASS. Then the full gate: `npx vitest run && npx tsc --noEmit && npx eslint . --max-warnings 0`.

- [ ] **Step 5: Commit.**

```bash
git add tests/no-ink3-text.test.js src/ui
git commit -m "CSS modules colour no text --ink3, and a guard keeps it that way (issue 79)"
```

---

### Task 2: Inline JSX and chart axes

**Files:**
- Modify: `tests/no-ink3-text.test.js` (`GUARDED`)
- Modify: `src/ui/ErrorBoundary.jsx:77`, `src/ui/EcuLab.jsx` (lines ~155, ~1454, ~1486, ~1573), `src/ui/screens/dash/JobsScreen.jsx:75`, `src/ui/components/TuningGrid.jsx` (~177, ~213), `src/ui/components/BuildSection.jsx:53`, `src/ui/components/ExpandableInfo.jsx:32`, `src/ui/screens/dyno/ResultScreen.jsx` (axes ~131-132, ~157-158, and the header comment ~line 19), `src/ui/screens/tune/SensorsScreen.jsx:73-74`, `src/ui/screens/dash/LiveEcuPanel.jsx:134`

**Interfaces:**
- Consumes: Task 1's `tests/no-ink3-text.test.js` and its `GUARDED` constant.

- [ ] **Step 1: Widen the guard.** In `tests/no-ink3-text.test.js` change

```js
const GUARDED = /\.css$/;
```

to

```js
const GUARDED = /\.(jsx?|css)$/;
```

- [ ] **Step 2: Run it and see it fail.**
Run: `npx vitest run tests/no-ink3-text.test.js`
Expected: FAIL for the JSX files listed above, each naming its lines.

- [ ] **Step 3: Sweep.** Change `T.ink3` to `T.ink2` on every failing line: text colours, the two `ChevronDown` icons, the `JobsScreen` status label's fallback, `TuningGrid`'s unchanged-cell colour and axis caption, and every recharts `<XAxis>`/`<YAxis>` `stroke`. Leave `<Line ... stroke={T.ink3}>` (the `afrCommanded` series) and `DialMark`'s tick `stroke` as they are: graphics, not text. In `ResultScreen.jsx`'s header comment, which says `T.ink3` is "the axis, tick-label and `afrCommanded` colour", update it to say the axes and tick labels are now `T.ink2` (issue 79) and `afrCommanded` is still `T.ink3`.

- [ ] **Step 4: Run it and see it pass.**
Run: `npx vitest run tests/no-ink3-text.test.js`
Expected: PASS. Then the full gate: `npx vitest run && npx tsc --noEmit && npx eslint . --max-warnings 0`. `grep -rn "ink3" src/ui` should now show only the token layer, `stroke`/`fill` graphics, `decorative`-marked lines, and comments.

- [ ] **Step 5: Commit.**

```bash
git add tests/no-ink3-text.test.js src/ui
git commit -m "Inline text and chart axes take --ink2, and the guard covers JSX (issue 79)"
```
