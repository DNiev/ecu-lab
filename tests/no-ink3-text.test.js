/**
 * Guards issue 79: text is never coloured --ink3.
 *
 * --ink3 measures 2.56-3.47:1 against the four surfaces, under WCAG AA's 4.5:1 for small
 * text on every one of them. Brightening it until it passes would make it --ink2, so the
 * rule is per use: text takes --ink2, and hierarchy below that comes from size and
 * weight. --ink3 stays for stroke/fill graphics and borders, which this does not match.
 *
 * The scan works on whole CSS declarations and whole JSX tags, not lines, so a tag whose
 * props wrap, or a prop holding an arrow function, is read the same as a one-liner.
 * Comments are blanked first, so prose that mentions `T.ink3` is not a hit.
 *
 * A colour use that is genuinely text-free may keep --ink3 if a comment on its line, or
 * on the line above, says `decorative` and why. The word only counts inside a comment.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { tokens } from '../src/ui/tokens.js';

const UI_DIR = fileURLToPath(new URL('../src/ui/', import.meta.url));

/** The token layer defines --ink3; it does not use it. Paths are relative to src/ui. */
const ALLOWED = new Set(['tokens.js', 'tokens.css', 'theme.js']);

/** Which files the guard reads. */
const GUARDED = /\.(jsx?|css)$/;

/** A reference to the --ink3 token, in CSS or in JS. */
const INK3 = /\b(?:T|tokens)\.ink3\b|\b(?:T|tokens)\[\s*['"]ink3['"]\s*\]|var\(\s*--ink3\s*[,)]/;

/**
 * Which JSX props colour text, per tag. recharts colours an axis's tick labels with its
 * `stroke`, and a series' legend and tooltip text with its "main colour": `stroke` for
 * Line, `stroke` (or `fill` when the stroke is none) for Area and Radar, and `fill` for
 * everything else (getMainColorOfGraphicItem in recharts' ChartUtils).
 */
const TEXT_PROPS_BY_TAG = {
  XAxis: ['stroke'],
  YAxis: ['stroke'],
  ZAxis: ['stroke'],
  PolarAngleAxis: ['stroke'],
  PolarRadiusAxis: ['stroke'],
  Line: ['stroke'],
  Area: ['stroke', 'fill'],
  Radar: ['stroke', 'fill'],
  Bar: ['fill'],
  Scatter: ['fill'],
  Pie: ['fill'],
  Funnel: ['fill'],
  RadialBar: ['fill'],
  Legend: ['inactiveColor'],
  text: ['fill', 'stroke'],
  tspan: ['fill', 'stroke'],
  textPath: ['fill', 'stroke'],
  Text: ['fill', 'stroke'],
  Label: ['fill', 'stroke'],
  LabelList: ['fill', 'stroke'],
};

/** Props that colour text on any tag: icon/gauge `color`, recharts `tick` and `label`. */
const TEXT_PROPS_ANY_TAG = ['color', 'tick', 'label'];

/** CSS selectors whose `fill` paints SVG text. */
const SVG_TEXT_SELECTOR = /(^|[\s>+~,(])(text|tspan|textPath)\b/;

/** @returns {string[]} every guarded source file, as a path relative to src/ui */
function sourceFiles() {
  return readdirSync(UI_DIR, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && GUARDED.test(e.name))
    .map((e) => relative(UI_DIR, join(e.parentPath ?? e.path, e.name)).split(sep).join('/'))
    .filter((rel) => !ALLOWED.has(rel));
}

/**
 * Replaces every comment with spaces, keeping newlines so offsets and line numbers hold,
 * and returns the comments it removed.
 *
 * @param {string} src
 * @param {boolean} js true to also handle `//` comments and skip over string literals
 * @returns {{ code: string, comments: { start: number, end: number, text: string }[] }}
 */
function blankComments(src, js) {
  const out = src.split('');
  const comments = [];
  const blank = (start, end) => {
    for (let k = start; k < end; k++) if (out[k] !== '\n') out[k] = ' ';
    comments.push({ start, end, text: src.slice(start, end) });
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      blank(i, end);
      i = end;
    } else if (js && c === '/' && next === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      blank(i, end);
      i = end;
    } else if (js && (c === '"' || c === "'" || c === '`')) {
      // Skip the literal so a `//` inside it (a URL) is not read as a comment. Plain
      // quotes stop at a newline too, so a stray quote cannot swallow the file.
      i++;
      while (i < src.length && src[i] !== c && (c === '`' || src[i] !== '\n')) {
        i += src[i] === '\\' ? 2 : 1;
      }
      i++;
    } else {
      i++;
    }
  }
  return { code: out.join(''), comments };
}

/**
 * Reads a balanced expression starting at `start`, stopping before a `,` or `;` at depth
 * zero, or before a bracket that closes something opened earlier.
 *
 * @param {string} code
 * @param {number} start
 * @returns {string}
 */
function readExpression(code, start) {
  let depth = 0;
  let i = start;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < code.length && code[i] !== c) i += code[i] === '\\' ? 2 : 1;
    } else if ('([{'.includes(c)) {
      depth++;
    } else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if ((c === ',' || c === ';') && depth === 0) {
      break;
    }
    i++;
  }
  return code.slice(start, i);
}

/**
 * Reads one JSX tag's props, from just after its name to its closing `>`. Values in
 * braces are read balanced, so `=>` inside a prop does not end the tag.
 *
 * @param {string} code
 * @param {number} start
 * @returns {{ name: string, value: string, at: number }[]}
 */
function readProps(code, start) {
  const props = [];
  let i = start;
  while (i < code.length) {
    while (/\s/.test(code[i] ?? '')) i++;
    const c = code[i];
    if (c === undefined || c === '>' || c === '/' || c === '<') break;
    if (c === '{') {
      // A spread: `{...rest}`.
      i += readExpression(code, i + 1).length + 2;
      continue;
    }
    const name = /^[\w:.-]+/.exec(code.slice(i))?.[0];
    if (!name) break;
    const at = i;
    i += name.length;
    if (code[i] !== '=') {
      props.push({ name, value: '', at });
      continue;
    }
    i++;
    let value;
    if (code[i] === '{') {
      value = readExpression(code, i + 1);
      i += value.length + 2;
    } else if (code[i] === '"' || code[i] === "'") {
      const close = code.indexOf(code[i], i + 1);
      if (close === -1) break;
      value = code.slice(i + 1, close);
      i = close + 1;
    } else {
      break;
    }
    props.push({ name, value, at });
  }
  return props;
}

/**
 * @param {string} code CSS with comments blanked
 * @returns {{ at: number, why: string }[]}
 */
function cssHits(code) {
  const hits = [];
  for (const rule of code.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const [, selector, body] = rule;
    const bodyAt = rule.index + selector.length + 1;
    for (const decl of body.matchAll(/([-\w]+)\s*:([^;]*)/g)) {
      const prop = decl[1].toLowerCase();
      if (!INK3.test(decl[2])) continue;
      const at = bodyAt + decl.index;
      if (prop === 'color' || prop === '-webkit-text-fill-color') {
        hits.push({ at, why: `${prop} is text colour` });
      } else if (prop === 'fill' && SVG_TEXT_SELECTOR.test(selector)) {
        hits.push({ at, why: 'fill on SVG text is text colour' });
      } else if (prop.startsWith('--')) {
        hits.push({ at, why: 'an alias of --ink3 hides its uses from this guard' });
      }
    }
  }
  return hits;
}

/**
 * @param {string} code JS/JSX with comments blanked
 * @returns {{ at: number, why: string }[]}
 */
function jsHits(code) {
  const hits = [];
  // A `color` key in an object literal: inline styles, recharts style props.
  for (const m of code.matchAll(/(?<![-\w$.])(['"]?)color\1\s*:/g)) {
    if (INK3.test(readExpression(code, m.index + m[0].length))) {
      hits.push({ at: m.index, why: 'color is text colour' });
    }
  }
  // JSX tags, prop by prop.
  for (const m of code.matchAll(/(?<![\w$])<([A-Za-z][\w.]*)/g)) {
    const tag = m[1].split('.').pop();
    const textProps = [...TEXT_PROPS_ANY_TAG, ...(TEXT_PROPS_BY_TAG[tag] ?? [])];
    for (const { name, value, at } of readProps(code, m.index + m[0].length)) {
      if (textProps.includes(name) && INK3.test(value)) {
        hits.push({ at, why: `<${tag} ${name}> colours text` });
      }
    }
  }
  return hits;
}

/**
 * Every place a source file colours text --ink3, minus the ones a `decorative` comment
 * on the same line or the line above exempts.
 *
 * @param {string} src file contents
 * @param {boolean} js true for .js/.jsx, false for .css
 * @returns {string[]} `line: source` for each hit
 */
function findInk3Text(src, js) {
  const { code, comments } = blankComments(src, js);
  const lineOf = (offset) => src.slice(0, offset).split('\n').length;
  const exempt = new Set();
  for (const c of comments) {
    if (!/\bdecorative\b/.test(c.text)) continue;
    for (let n = lineOf(c.start); n <= lineOf(c.end) + 1; n++) exempt.add(n);
  }
  const lines = src.split('\n');
  const seen = new Set();
  return (js ? jsHits(code) : cssHits(code))
    .map(({ at, why }) => ({ n: lineOf(at), why }))
    .filter(({ n }) => !exempt.has(n) && !seen.has(n) && seen.add(n))
    .sort((a, b) => a.n - b.n)
    .map(({ n, why }) => `${n}: ${lines[n - 1].trim()}  (${why})`);
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

/** The surfaces text sits on: the four panels, plus every accent and status fill. */
const SURFACES = ['bg', 'panel', 'panel2', 'panel3', ...Object.keys(tokens).filter((k) => k.endsWith('Bg'))];

describe('the premise: --ink2 is legible small text on every surface', () => {
  it('checks the accent and status fills, not just the panels', () => {
    expect(SURFACES).toEqual(expect.arrayContaining(['accBg', 'okBg', 'warnBg', 'dangerBg']));
  });

  for (const surface of SURFACES) {
    it(`ink2 on ${surface} is at least 4.5:1`, () => {
      expect(contrast(tokens.ink2, tokens[surface])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('the guard itself', () => {
  const flagsJs = (src) => findInk3Text(src, true);
  const flagsCss = (src) => findInk3Text(src, false);

  it.each([
    ['inline style', `<div style={{ fontSize: 9, color: T.ink3 }}>RPM</div>`],
    ['a ternary', `<span style={{ color: done ? T.ok : T.ink3 }} />`],
    ['a call with a comma', `<span style={{ color: pick(a, T.ink3) }} />`],
    ['a quoted CSS var', `<span style={{ color: 'var(--ink3)' }} />`],
    ['the raw token', `<span style={{ color: tokens.ink3 }} />`],
    ['an icon colour prop', `<Info size={14} color={T.ink3} />`],
    ['a one-line axis', `<XAxis dataKey="rpm" stroke={T.ink3} />`],
    ['a wrapped axis', `<YAxis\n  dataKey="rpm"\n  stroke={T.ink3}\n/>`],
    ['an axis after an arrow function', `<YAxis tickFormatter={(v) => \`\${v}%\`} stroke={T.ink3} />`],
    ['a tick fill', `<XAxis tick={{ fontSize: 10, fill: T.ink3 }} />`],
    ['a reference line label', `<ReferenceLine y={14.7} label={{ value: 'stoich', fill: T.ink3 }} />`],
    ['a wrapped series', `<Line\n  dataKey="afr"\n  stroke={T.ink3}\n/>`],
    ['a Bar fill (its legend colour)', `<Bar dataKey="hp" fill={T.ink3} />`],
    ['an Area stroke', `<Area dataKey="hp" stroke={T.ink3} />`],
    ['SVG text', `<text x={4} y={8} fill={T.ink3}>0</text>`],
    ['a recharts Label', `<Label value="kPa" fill={T.ink3} />`],
    ['a nested tag in a prop', `<Bar shape={(p) => <text fill={T.ink3}>x</text>} />`],
  ])('flags %s', (_, src) => {
    expect(flagsJs(src)).toHaveLength(1);
  });

  it.each([
    ['a dial tick', `<line x1={0} y1={0} stroke={i > 9 ? T.danger : T.ink3} />`],
    ['a grid', `<CartesianGrid stroke={T.ink3} />`],
    ['a Bar outline (its legend takes the fill)', `<Bar dataKey="hp" stroke={T.ink3} fill={T.acc} />`],
    ['a border', `<div style={{ borderColor: T.ink3, border: \`1px solid \${T.ink3}\` }} />`],
    ['a comment that mentions it', `// was <XAxis stroke={T.ink3} />, now ink2\nconst x = 1;`],
    ['a block comment that mentions it', `/* color: T.ink3 used to be here */`],
    ['a decorative line comment above', `// decorative: rule under the heading, no text\n<span style={{ color: T.ink3 }} />`],
    ['a decorative JSX comment on the line', `<span style={{ color: T.ink3 }} /> {/* decorative: a dot */}`],
    ['ink2', `<XAxis stroke={T.ink2} tick={{ fill: T.ink2 }} />`],
  ])('passes %s', (_, src) => {
    expect(flagsJs(src)).toEqual([]);
  });

  it('only counts `decorative` inside a comment', () => {
    expect(flagsJs(`<i className={styles.decorative} />\n<span style={{ color: T.ink3 }} />`)).toHaveLength(1);
    expect(flagsJs(`<span title="decorative" style={{ color: T.ink3 }} />`)).toHaveLength(1);
  });

  it('does not read a URL in a string as a comment', () => {
    expect(flagsJs(`<a href="https://x.y" style={{ color: T.ink3 }}>docs</a>`)).toHaveLength(1);
  });

  it('reports the line the colour is on', () => {
    expect(flagsJs(`<YAxis\n  dataKey="rpm"\n  stroke={T.ink3}\n/>`)[0]).toMatch(/^3: stroke=\{T\.ink3\}/);
  });

  it.each([
    ['a color', `.cap { color: var(--ink3); }`],
    ['a wrapped color', `.cap {\n  color:\n    var(--ink3);\n}`],
    ['a fallback', `.cap { color: var(--ink3, grey); }`],
    ['a rule inside @media', `@media (min-width: 600px) {\n  .cap { color: var(--ink3); }\n}`],
    ['a text fill', `.dial text { fill: var(--ink3); }`],
    ['an alias', `.panel { --muted: var(--ink3); }`],
  ])('flags CSS %s', (_, src) => {
    expect(flagsCss(src)).toHaveLength(1);
  });

  it.each([
    ['a border colour', `.slot { border-color: var(--ink3); }`],
    ['a stroke', `.plotDef { fill: none; stroke: var(--ink3); }`],
    ['a shape fill', `.dial path { fill: var(--ink3); }`],
    ['a comment', `/* color: var(--ink3) was too dim */ .cap { color: var(--ink2); }`],
    ['a decorative comment', `.rule {\n  /* decorative: a hairline, no text */\n  color: var(--ink3);\n}`],
  ])('passes CSS %s', (_, src) => {
    expect(flagsCss(src)).toEqual([]);
  });
});

describe('src/ui colours no text --ink3', () => {
  it('finds the UI sources it guards', () => {
    expect(sourceFiles().length).toBeGreaterThan(50);
  });

  it('exempts files by their path from src/ui, and each exemption exists', () => {
    for (const rel of ALLOWED) expect(existsSync(join(UI_DIR, rel)), rel).toBe(true);
  });

  for (const rel of sourceFiles()) {
    it(`src/ui/${rel} colours no text --ink3`, () => {
      const hits = findInk3Text(readFileSync(join(UI_DIR, rel), 'utf8'), !rel.endsWith('.css'));
      expect(hits, 'text takes --ink2 (issue 79); a text-free graphic may say `decorative` in a comment').toEqual([]);
    });
  }
});
