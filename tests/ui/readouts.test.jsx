// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Bar } from '../../src/ui/primitives/Bar.jsx';
import { StatTile } from '../../src/ui/primitives/StatTile.jsx';
import tileStyles from '../../src/ui/primitives/StatTile.module.css';
import { camelToKebab, tokens } from '../../src/ui/tokens.js';

// This file's queries rely on `screen` being scoped to the current test's render;
// without this, meters from earlier tests accumulate in the DOM and unscoped
// role/name queries start matching more than one element. Matches the pattern
// already used in Button.test.jsx and surfaces.test.jsx.
afterEach(cleanup);

// WCAG relative-luminance contrast ratio between two hex colours. There is no
// contrast helper anywhere in this repo — every contrast finding so far (including
// the three fixed in this PR) was caught by a human reading a diff.
function contrast(hexA, hexB) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [R, G, B] = [r, g, b].map(lin);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  };
  const [l1, l2] = [luminance(hexA), luminance(hexB)];
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// Read the real stylesheet rather than trusting a value copied out of it by hand.
// `tests/tokens.test.js` reads tokens.css the same way, for the same reason: a
// hardcoded stand-in for a stylesheet value can drift from the stylesheet silently.
// Under jsdom the global `URL` is jsdom's own, which `readFileSync` rejects, so this
// uses node:url's URL explicitly.
const tileCss = readFileSync(
  new NodeURL('../../src/ui/primitives/StatTile.module.css', import.meta.url),
  'utf8',
);

// Button's stylesheet, read the same way and for the same reason. Its `quiet`
// variant is measured below, beside StatTile's label: same class of defect (a
// hierarchy token used where a legibility one was needed), same kind of guard.
const buttonCss = readFileSync(
  new NodeURL('../../src/ui/primitives/Button.module.css', import.meta.url),
  'utf8',
);

// tokens.js keyed by the CSS custom property name it declares (e.g. `accInk` ->
// `acc-ink`), so a `var(--x)` pulled out of the stylesheet can be resolved to a hex
// value without hardcoding the mapping a second time.
const tokensByCssName = new Map(Object.entries(tokens).map(([name, value]) => [camelToKebab(name), value]));

/**
 * The custom-property name (without `--`) a declaration in `css` resolves to, e.g.
 * `customPropertyIn(tileCss, 'StatTile.module.css', '.label', 'color')` -> `'ink2'`.
 * Throws if the selector or declaration isn't found, so a typo here fails loudly
 * instead of silently asserting against `undefined`.
 */
function customPropertyIn(css, name, selector, property) {
  const escapedSelector = selector.replace(/[.[\]()]/g, '\\$&');
  const rule = css.match(new RegExp(`${escapedSelector}\\s*{([^}]*)}`));
  if (!rule) throw new Error(`no "${selector}" rule in ${name}`);
  const decl = rule[1].match(new RegExp(`${property}\\s*:\\s*var\\(--([a-z0-9-]+)\\)`));
  if (!decl) throw new Error(`no "${property}" declaration on "${selector}" in ${name}`);
  return decl[1];
}

/** `customPropertyIn` bound to StatTile's stylesheet, which most of this file reads. */
function customPropertyOf(selector, property) {
  return customPropertyIn(tileCss, 'StatTile.module.css', selector, property);
}

/** Resolves a custom-property name read from the stylesheet to its token hex value. */
function tokenFor(cssName) {
  const value = tokensByCssName.get(cssName);
  if (!value) throw new Error(`--${cssName} is not a known token`);
  return value;
}

// The surfaces these assertions measure against, read out of the stylesheet rather
// than assumed: `.tile` is the element `.label` and `.acc .value` actually paint onto.
const tileBg = tokenFor(customPropertyOf('.tile', 'background'));
const labelColor = tokenFor(customPropertyOf('.label', 'color'));
const accValueColor = tokenFor(customPropertyOf('.acc .value', 'color'));

describe('StatTile', () => {
  it('renders label, value and unit', () => {
    render(<StatTile label="PEAK HP" value={412} unit="whp" />);
    expect(screen.getByText('PEAK HP')).toBeTruthy();
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('whp')).toBeTruthy();
  });

  it('omits the unit element entirely when no unit is given', () => {
    const { container } = render(<StatTile label="PULLS" value={7} />);
    expect(container.querySelector(`.${tileStyles.unit}`)).toBeNull();
  });

  it('applies the tone it is given', () => {
    const { container } = render(<StatTile label="KNOCK" value="0.4" tone="warn" />);
    expect(container.querySelector(`.${tileStyles.warn}`)).toBeTruthy();
  });

  it('gives the alt tone its own class, distinct from the partner it sits beside', () => {
    // `alt` marks the second quantity in a paired readout — torque beside power. If it
    // resolved to the same colour as its partner the pairing would be invisible, which
    // is the whole reason the tone exists. A class-name check alone can't catch that:
    // two differently-named classes can still be styled to the same colour. Compare
    // the custom properties the stylesheet actually assigns instead.
    const { container } = render(<StatTile label="PEAK TQ" value={300} tone="alt" />);
    expect(container.querySelector(`.${tileStyles.alt}`)).toBeTruthy();
    expect(container.querySelector(`.${tileStyles.acc}`)).toBeNull();
    expect(customPropertyOf('.alt .value', 'color')).not.toBe(customPropertyOf('.acc .value', 'color'));
  });

  it('keeps the label readable on the surface it sits on', () => {
    // ~9.5px is small text: WCAG AA wants 4.5:1. This failed at 3.17:1 when `.label`
    // used --ink3, a hierarchy token, not a legibility one; --ink2 clears 5.67:1.
    // Measured against the property `.label` actually sets and the background `.tile`
    // actually paints, both read out of the stylesheet above, not asserted by name.
    expect(contrast(labelColor, tileBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('paints tone text with an ink variant, never with the interactive accent', () => {
    // Contrast alone cannot pin this: --acc on --panel measures 6.46:1 and clears the
    // 3:1 large-text bar perfectly well, so a correct WCAG assertion stays green if
    // someone puts it back. What is wrong with it is not legibility, it is meaning.
    //
    // --acc is the interactive accent: the colour of a thing you can click. A stat
    // tile's figure is a readout. Spending the interactive colour on it is the quiet
    // half of the rule this whole PR enforces — the accent is never a status, and a
    // status is never decoration. --acc-ink is the readable-on-dark variant that
    // exists for exactly this, and it is what all four call sites passed before the
    // migration.
    expect(customPropertyOf('.acc .value', 'color')).toBe('acc-ink');
  });

  it('keeps the acc value readable on the surface it sits on', () => {
    // `.value` renders at --fs-lg (18px) and font-weight 800 — WCAG "large text",
    // which AA holds to 3:1 rather than 4.5:1. --acc alone clears 6.46:1; --acc-ink,
    // what `.acc .value` actually sets, clears 9.57:1 — comfortably past the bar,
    // and read from the stylesheet rather than assumed.
    expect(contrast(accValueColor, tileBg)).toBeGreaterThanOrEqual(3);
  });
});

// Not a readout, but it lives here because this is where the contrast helper is, and
// because it is the same defect StatTile's label had: a token picked for hierarchy
// without checking it against the surface it lands on. `quiet` has no fill and no
// border, so its label is the entire control — if that fails AA the button is not
// quiet, it is missing.
describe('Button, quiet variant', () => {
  // Every surface a quiet button is placed on today: --acc-bg (formerly the journey banner's
  // SKIP GUIDE), --bg (the tutorial's SKIP and BUILD's RESET ALL TO STOCK). --panel
  // and --panel2 are the two surfaces it would land on next, and --panel3 is the
  // lightest surface in the system, so it bounds the whole set.
  const surfaces = ['bg', 'panel', 'panel2', 'panel3', 'accBg'];

  it('stays readable on every surface it lands on', () => {
    // `size="sm"` is --fs-xs, 10.5px: small text, so AA wants 4.5:1, not 3:1. --ink3
    // measured 2.87-3.47:1 across these; --ink2 measures 4.59-6.21:1.
    const quietColor = tokenFor(customPropertyIn(buttonCss, 'Button.module.css', '.quiet', 'color'));
    // Collected rather than asserted one at a time, so a failure names the surfaces.
    const failing = surfaces.filter((surface) => contrast(quietColor, tokens[surface]) < 4.5);
    expect(failing).toEqual([]);
  });

  it('brightens on hover rather than dimming', () => {
    // The hover colour used to be --ink2, which is now the resting colour; leaving it
    // there would have made hover a no-op.
    const resting = customPropertyIn(buttonCss, 'Button.module.css', '.quiet', 'color');
    const hovered = customPropertyIn(buttonCss, 'Button.module.css', '.quiet:hover:not(:disabled)', 'color');
    expect(contrast(tokenFor(hovered), tokens.bg)).toBeGreaterThan(contrast(tokenFor(resting), tokens.bg));
  });
});

describe('Seg legibility', () => {
  it('keeps an unselected option readable on the control it sits in', () => {
    // The same defect this suite already pins for StatTile's label and Button's quiet
    // variant, in a third place: --ink3 is a hierarchy token, and on --panel at 10.5px
    // it measures 3.17:1 against AA's 4.5:1 for small text. It affects roughly thirty
    // option labels — every unselected option in all eight segmented controls — so it
    // was the widest of the three and the last one measured.
    const css = readFileSync(new NodeURL('../../src/ui/primitives/Seg.module.css', import.meta.url), 'utf8');
    const itemColor = css.match(/\.item \{[^}]*color:\s*var\(--([a-z0-9-]+)\)/)[1];
    const segBg = css.match(/\.seg \{[^}]*background:\s*var\(--([a-z0-9-]+)\)/)[1];
    expect(contrast(tokenFor(itemColor), tokenFor(segBg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Bar', () => {
  it('exposes itself as a meter with its current value', () => {
    render(<Bar label="Pistons" value={86} />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('86');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
  });

  it('names the meter after its label', () => {
    render(<Bar label="Bearings" value={71} />);
    expect(screen.getByRole('meter', { name: 'Bearings' })).toBeTruthy();
  });

  it('scales the fill to the percentage of max', () => {
    const { container } = render(<Bar label="Duty" value={40} max={80} />);
    const fill = /** @type {HTMLElement} */ (container.querySelector('[data-fill]'));
    expect(fill.style.width).toBe('50%');
  });

  it('clamps a value above max instead of overflowing the track', () => {
    const { container } = render(<Bar label="Duty" value={150} max={100} />);
    const fill = /** @type {HTMLElement} */ (container.querySelector('[data-fill]'));
    expect(fill.style.width).toBe('100%');
  });

  it('clamps a negative value to zero', () => {
    const { container } = render(<Bar label="Duty" value={-20} max={100} />);
    const fill = /** @type {HTMLElement} */ (container.querySelector('[data-fill]'));
    expect(fill.style.width).toBe('0%');
  });

  it('never announces a value outside its own declared range', () => {
    // A meter whose aria-valuenow exceeds aria-valuemax is invalid ARIA, and it
    // means the announced reading disagrees with the bar a sighted user sees.
    render(<Bar label="Duty" value={150} max={100} />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('100');
  });

  it('never announces a value below zero', () => {
    render(<Bar label="Duty" value={-20} max={100} />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
  });

  it('reads a high value as healthy by default', () => {
    render(<Bar label="Pistons" value={95} max={100} />);
    expect(screen.getByRole('meter')).toBeTruthy();
    expect(screen.getByText('95%')).toBeTruthy();
  });

  it('inverts the scale when a high value is the dangerous end', () => {
    // 95% injector duty is a build about to lean out, not a healthy one. Without
    // higherIsBetter={false} this renders green at exactly the wrong moment.
    const { container } = render(<Bar label="Duty" value={95} max={100} higherIsBetter={false} />);
    const healthy = render(<Bar label="Pistons" value={95} max={100} />);
    const dutyFill = /** @type {HTMLElement} */ (container.querySelector('[data-fill]'));
    const healthFill = /** @type {HTMLElement} */ (healthy.container.querySelector('[data-fill]'));
    expect(dutyFill.style.background).not.toBe(healthFill.style.background);
  });

  it('reads an ordinary duty cycle as healthy, not as an alarm', () => {
    // 60% injector duty is a comfortably sized injector, not a warning. Mirroring the
    // health bands used to paint everything above 45% red, which is what this pins.
    const { container } = render(<Bar label="Duty" value={60} max={100} higherIsBetter={false} />);
    const healthy = render(<Bar label="Pistons" value={95} max={100} />);
    const dutyFill = /** @type {HTMLElement} */ (container.querySelector('[data-fill]'));
    const healthFill = /** @type {HTMLElement} */ (healthy.container.querySelector('[data-fill]'));
    expect(dutyFill.style.background).toBe(healthFill.style.background);
  });

  it('reads a duty cycle with no headroom left as dangerous', () => {
    const { container } = render(<Bar label="Duty" value={95} max={100} higherIsBetter={false} />);
    const failing = render(<Bar label="Pistons" value={20} max={100} />);
    const dutyFill = /** @type {HTMLElement} */ (container.querySelector('[data-fill]'));
    const failingFill = /** @type {HTMLElement} */ (failing.container.querySelector('[data-fill]'));
    expect(dutyFill.style.background).toBe(failingFill.style.background);
  });
});
