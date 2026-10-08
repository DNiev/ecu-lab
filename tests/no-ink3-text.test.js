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
