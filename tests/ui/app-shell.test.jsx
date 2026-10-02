// @vitest-environment jsdom

/**
 * `AppShell`'s own tests: the section nav's `aria-current`, the store-reading status
 * strip, the engine-run light, and the wiring proof that `onNavigate` is genuinely
 * `changeTab` — not a bare route change — inside the real app.
 *
 * The nav/strip cases mount `AppShell` directly inside a `StoreProvider` this test
 * owns (the same "probe" pattern build-store.test.jsx uses), which is enough for
 * everything except the `onNavigate` side effect: THAT has to run through the real
 * `EcuLab` component, because "clicking a nav item clears the tuning selection" is
 * `changeTab`'s behaviour, not `AppShell`'s — `AppShell` only ever calls whatever
 * `onNavigate` it was handed.
 */

import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINE_PRESETS, applyPreset } from '../../src/sim/index.js';
import { AppShell } from '../../src/ui/AppShell.jsx';
import shellStyles from '../../src/ui/AppShell.module.css';
import EcuLab from '../../src/ui/EcuLab.jsx';
import { ROUTES } from '../../src/ui/routing.js';
import { StoreProvider, useBuild, useSession } from '../../src/ui/state/StoreProvider.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';

afterEach(cleanup);

/**
 * A probe that hands the store's dispatch back to the test, so fabricated state can
 * be seeded directly rather than driven through the UI — same pattern as
 * `DispatchProbe` in build-store.test.jsx.
 * @param {{onReady: (dispatch: React.Dispatch<*>) => void}} props
 * @returns {null}
 */
function BuildProbe({ onReady }) {
  const [, dispatch] = useBuild();
  React.useEffect(() => { onReady(dispatch); }, [onReady, dispatch]);
  return null;
}

/** Same probe, off the session slice — same `dispatch`, different read. */
function SessionProbe({ onReady }) {
  const [, dispatch] = useSession();
  React.useEffect(() => { onReady(dispatch); }, [onReady, dispatch]);
  return null;
}

const ROUTE_DASH = { view: 'app', tab: 'dash', section: 'live' };

/**
 * Mounts a bare `AppShell` in its own store, with a dispatch handed back through
 * `onReady`.
 * @param {object} route
 * @param {(dispatch: React.Dispatch<*>) => void} onReady
 * @returns {void}
 */
function mountShell(route, onReady) {
  render(
    <StoreProvider>
      <BuildProbe onReady={onReady} />
      <SessionProbe onReady={onReady} />
      <AppShell route={route} onNavigate={() => {}}>
        <div>screen body</div>
      </AppShell>
    </StoreProvider>,
  );
}

describe('the section nav', () => {
  it('marks only the active tab aria-current, and no other', () => {
    mountShell(ROUTE_DASH, () => {});
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    const items = within(nav).getAllByRole('button');
    // Counted off ROUTES rather than written out, so the nav and the route table
    // cannot drift: a tab added to one and not the other fails here rather than
    // shipping as a destination with nothing behind it, or a screen with no way in.
    const tabCount = Object.keys(ROUTES).length;
    expect(items).toHaveLength(tabCount);

    // What would turn this red: SideNav comparing the wrong id, or marking every
    // item current (see the break-test below, which proves this exact assertion
    // catches that).
    const home = items.find((b) => b.textContent.includes('HOME'));
    expect(home.getAttribute('aria-current')).toBe('page');

    const others = items.filter((b) => b !== home);
    expect(others).toHaveLength(tabCount - 1);
    for (const b of others) {
      // Must be ABSENT, not the string "false" — aria-current="false" is still a
      // truthy token to a screen reader. getAttribute returns null when the
      // attribute is not present at all.
      expect(b.getAttribute('aria-current')).toBeNull();
    }
  });
});

describe('onNavigate', () => {
  it('carries changeTab\'s side effect: leaving TUNE and coming back drops the selection', () => {
    // A test that only checked the tab switched would pass even with the raw
    // `goTab` wired in, because TUNE's screens (and the dock inside them) unmount
    // the instant you navigate to a different tab regardless of whether the
    // selection was cleared. The real proof is round-tripping: navigate away and
    // back, and check the dock does NOT come back with you. If `AppShell` were
    // ever handed `goTab` instead of `changeTab`, the store's `tune.selection`
    // would still hold the old cell, and the dock would reappear the moment TUNE
    // remounts — this assertion is what catches that.
    render(<EcuLab />);
    // The start screen offers CAREER, SANDBOX and TUTORIAL rather than a single START.
    // SANDBOX is the free-play entry the old button was.
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));

    const grid = within(screen.getByTestId('tuning-grid'));
    const cells = grid.getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent));
    fireEvent.click(cells[Math.floor(cells.length / 2)]);
    expect(screen.getByTestId('selection-dock')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'HOME' }));
    fireEvent.click(screen.getByRole('button', { name: 'TUNE' }));

    expect(screen.queryByTestId('selection-dock')).toBeNull();
  });
});

describe('the status strip', () => {
  it('names the engine from the store, not from anything AppShell computes itself', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // A real preset's name is not a string AppShell could produce on its own — the
    // default build has no presetId at all, so this only shows up if the strip
    // actually reads `build.presetId`/`presetById` off the store.
    const seed = ENGINE_PRESETS[0];
    act(() => dispatch({ type: ACTIONS.APPLY_PRESET, preset: applyPreset(seed) }));

    expect(screen.getByText(new RegExp(seed.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
  });

  it('shows boost read from the store\'s boost curve, not a hardcoded figure', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // 37.7 psi is not a value any default state produces (turbo starts off, and no
    // stock boost curve peaks there) — seeding it is what proves the strip reads
    // `build.boostCurve`/`turboOn` rather than showing a fixed label.
    act(() => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: true }));
    act(() => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'boostCurve', value: [12, 37.7, 9] }));

    expect(screen.getByText('37.7 psi')).toBeTruthy();
  });

  it('shows health read from the store, not a hardcoded 100%', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // The default is 100/100/100 (a healthy fresh build), so 42% cannot be anything
    // but a genuine read of `session.health` — a strip that always painted the
    // track full would still pass a test seeded at 100.
    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD, field: 'health', value: { piston: 42, bearing: 100, valve: 100 },
    }));

    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('shows the last pull read from the store, not a hardcoded dash', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // 12345 is not a horsepower figure the sim would ever produce — it is only
    // reachable by the strip actually reading `session.result.peakHp`.
    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD, field: 'result', value: { peakHp: 12345, peakTq: 1, points: [], events: [] },
    }));

    // Wheel horsepower, labelled as every other power figure in the app is.
    expect(screen.getByText('12345 whp')).toBeTruthy();
  });
});

describe('the engine-run light', () => {
  it('is present only while the live engine is running', () => {
    /** @type {React.Dispatch<*>} */
    let dispatch;
    mountShell(ROUTE_DASH, (d) => { dispatch = d; });

    // What would turn the first assertion red: EngineRunLight rendering
    // unconditionally, or reading a field other than `session.live.running`.
    expect(screen.queryByText('● RUNNING')).toBeNull();

    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD, field: 'live', value: { running: true },
    }));
    // What would turn this one red: the light never appearing at all — a dead
    // component, not just a wrongly-gated one.
    expect(screen.getByText('● RUNNING')).toBeTruthy();

    act(() => dispatch({
      type: ACTIONS.SET_SESSION_FIELD, field: 'live', value: { running: false },
    }));
    expect(screen.queryByText('● RUNNING')).toBeNull();
  });
});

describe('the app\'s name', () => {
  it('is still in the chrome once the player is past the start screen', () => {
    // The regression this guards: the old hand-rolled header (deleted with it,
    // d5d9f66) carried "CARIBOU TUNING" / "ECU Lab" as its own two lines, but
    // StatusStrip had no equivalent — so once a player pressed START, neither
    // string appeared anywhere in the running app. They only survived on
    // StartScreen (pre-launch) and ErrorBoundary (crash screen), and this test
    // renders neither of those after the click: EcuLab.jsx returns one of three
    // disjoint subtrees keyed on `appView` ('start' | 'tutorial' | the AppShell
    // tree), so pressing START unmounts StartScreen outright rather than merely
    // hiding it. If AppShell's own brand block were missing, these queries would
    // find nothing at all post-click — not a leftover match from the start screen,
    // and ErrorBoundary is never mounted here since nothing throws.
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));

    expect(screen.getByText('CARIBOU TUNING')).toBeTruthy();
    expect(screen.getByText('ECU Lab')).toBeTruthy();
  });
});

// Read the real stylesheet, the way tokens.test.js and readouts.test.jsx do: jsdom
// does no layout, so "the strip fits a 375px phone" cannot be measured here — only
// the declarations that make it fit can be pinned. Under jsdom the global `URL` is
// jsdom's own, which `readFileSync` rejects, hence node:url's.
const shellCss = readFileSync(new NodeURL('../../src/ui/AppShell.module.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Splits the stylesheet into its top-level rules and its `@media`/`@container` blocks,
 * matching braces so a block's body is exactly its own rules: nothing before it, and
 * nothing after its closing brace.
 * @param {string} css comment-free CSS
 * @returns {{base: string, blocks: {prelude: string, body: string}[]}}
 */
function splitAtRules(css) {
  const blocks = [];
  let base = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@', i);
    if (at === -1) { base += css.slice(i); break; }
    base += css.slice(i, at);
    const open = css.indexOf('{', at);
    let depth = 1;
    let j = open + 1;
    for (; depth > 0; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
    }
    blocks.push({ prelude: css.slice(at, open).trim(), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return { base, blocks };
}

const { base: phoneCss, blocks } = splitAtRules(shellCss);

/**
 * The body of the one at-rule block whose prelude is exactly `prelude`. Throws when
 * absent, so a renamed query fails loudly rather than asserting against nothing.
 * @param {string} prelude e.g. '@media (min-width: 560px)'
 * @returns {string}
 */
function block(prelude) {
  const found = blocks.filter((b) => b.prelude === prelude);
  if (found.length !== 1) throw new Error(`expected one "${prelude}" block, found ${found.length}`);
  return found[0].body;
}

// The project's one breakpoint (see tokens.css), and the strip's own container query.
const breakpointCss = block('@media (min-width: 560px)');
const STRIP_QUERY = blocks.find((b) => b.prelude.startsWith('@container strip '));
const stripQueryCss = STRIP_QUERY ? STRIP_QUERY.body : '';

/**
 * The declarations of EVERY `selector { ... }` rule in `css`, joined. Matches the
 * selector exactly, so `.strip` does not find `.stripInner` or `.strip::after`.
 * Every rule, not the first, so a later override cannot slip past an assertion.
 * @param {string} css
 * @param {string} selector e.g. '.readouts'
 * @returns {string} '' when there is no such rule
 */
function decls(css, selector) {
  const escaped = selector.replace(/[.[\]():]/g, '\\$&');
  const rules = [...css.matchAll(new RegExp(`(?:^|[\\s},])${escaped}\\s*{([^}]*)}`, 'g'))];
  return rules.map((r) => r[1]).join(';');
}

/**
 * `prop: value` as a whole declaration, so `order: 1` does not also match `order: 10`.
 * @param {string} prop @param {string} value
 * @returns {RegExp}
 */
const decl = (prop, value) => new RegExp(`(?:^|[\\s;{])${prop}:\\s*${value.replace(/[()/]/g, '\\$&')}\\s*(?:;|$)`);

describe('the status strip at every width', () => {
  // The defect: at 375px the strip's readouts and buttons ran ~150px past the
  // viewport, the page scrolled sideways and the brand and nav were clipped. Then,
  // between the breakpoint and a wide display, the browser's greedy line-filling
  // wrapped the action buttons onto a second line on their own. The browser check
  // this stands in for: at 320-1400px, `document.documentElement.scrollWidth`
  // equals the viewport and the buttons share the first line with the brand.

  it('groups the readouts apart from the action buttons, so they can wrap as a unit', () => {
    mountShell(ROUTE_DASH, () => {});
    const readouts = document.querySelector(`.${shellStyles.readouts}`);
    expect(readouts).toBeTruthy();
    for (const label of ['BOOST', 'HEALTH', 'LAST PULL']) {
      expect(within(/** @type {HTMLElement} */ (readouts)).getByText(label)).toBeTruthy();
    }
    // What would turn this red: the buttons folded into the group that drops to a
    // second line, which is the very thing that used to push them off the edge.
    expect(readouts.contains(screen.getByRole('button', { name: 'Tutorial' }))).toBe(false);
    expect(readouts.contains(screen.getByRole('button', { name: 'Repair engine' }))).toBe(false);
  });

  it('wraps the strip instead of overflowing, and keeps its padding inside its width', () => {
    const inner = decls(shellCss, '.stripInner');
    expect(decls(phoneCss, '.stripInner')).toMatch(decl('flex-wrap', 'wrap'));
    expect(inner).not.toMatch(decl('flex-wrap', 'nowrap'));
    // `width: 100%` + side padding as a content box was wider than the strip at
    // every width below the content cap.
    if (decl('width', '100%').test(inner)) expect(inner).toMatch(decl('box-sizing', 'border-box'));
  });

  it('puts the readouts on their own line until the strip itself is wide enough for them', () => {
    expect(decls(phoneCss, '.strip')).toMatch(decl('container', 'strip / inline-size'));

    const own = decls(phoneCss, '.readouts');
    expect(own).toMatch(decl('flex-basis', '100%'));
    expect(own).toMatch(decl('order', '1'));

    // Inline only on the strip's width. The viewport breakpoint must not decide it:
    // that let the buttons wrap alone between 560px and a wide display.
    expect(STRIP_QUERY?.prelude).toMatch(/^@container strip \(min-width: \d+px\)$/);
    const inline = decls(stripQueryCss, '.readouts');
    expect(inline).toMatch(decl('flex', '0 0 auto'));
    expect(inline).toMatch(decl('order', '0'));
    expect(decls(breakpointCss, '.readouts')).not.toMatch(/order|flex/);
  });

  it('lets the build line take what the first line leaves, so the buttons never wrap', () => {
    // A non-zero basis wrapped the buttons off the first line on a phone.
    expect(decls(shellCss, '.engine')).toMatch(decl('flex', '1 1 0'));
  });

  it('drops the health bar below the breakpoint only, keeping the percentage', () => {
    expect(decls(phoneCss, '.healthTrack')).toMatch(decl('display', 'none'));
    expect(decls(breakpointCss, '.healthTrack')).toMatch(decl('display', 'block'));
  });

  it('holds the run light\'s width while the engine is idle, so starting it cannot reflow the strip', () => {
    mountShell(ROUTE_DASH, () => {});
    expect(screen.queryByText('● RUNNING')).toBeNull();
    // The slot is mounted while idle, and its invisible stand-in is the exact text
    // the light shows, so lit and unlit are the same width.
    expect(document.querySelector(`.${shellStyles.run}`)).toBeTruthy();
    const standIn = decls(shellCss, '.run::after');
    expect(standIn).toMatch(decl('content', "'● RUNNING'"));
    expect(standIn).toMatch(decl('visibility', 'hidden'));
  });
});
