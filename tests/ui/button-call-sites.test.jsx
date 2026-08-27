// @vitest-environment jsdom

/**
 * What the APP hands `Button`, as opposed to what `Button.test.jsx` proves about the
 * component in isolation.
 *
 * Button.test.jsx renders `<Button variant="danger">` and checks the danger class
 * lands. It cannot see a call site that asks for `variant="ghos"`, and neither can
 * anything else: `Button` builds its className as `styles[variant]`, and
 * `.filter(Boolean)` quietly drops the `undefined` a typo produces. The button still
 * renders, still clicks, still passes every existing test — it just arrives with no
 * fill, no border and an inherited text colour. Same shape of hole as the 95%-duty
 * injector that rendered bright green with every test passing: the primitive was fine,
 * the props were not.
 *
 * So these tests drive the real screens and assert, of every Button the app actually
 * mounts, that it carries exactly one variant, that it is not full-width, and that
 * `danger` is spent only on the one destructive confirm.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import EcuLab, { DYNO_PULL_MS } from '../../src/ui/EcuLab.jsx';
import styles from '../../src/ui/primitives/Button.module.css';

// jsdom has no ResizeObserver, and the sweep runs a dyno pull — whose result panel
// mounts recharts' <ResponsiveContainer>, which throws without one. Same stub as
// characterisation.test.jsx.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const hadResizeObserver = 'ResizeObserver' in window;
if (!hadResizeObserver) window.ResizeObserver = ResizeObserverStub;
afterAll(() => {
  if (!hadResizeObserver) delete window.ResizeObserver;
});

afterEach(cleanup);

const VARIANTS = ['primary', 'ghost', 'danger', 'quiet'];

/** Renders the app and clicks past the start screen. */
function launch() {
  render(<EcuLab />);
  clickButton('START');
}

/** @param {string|RegExp} name */
function clickButton(name) {
  fireEvent.click(screen.getByRole('button', { name }));
}

/**
 * Walks the app, collecting every Button that mounts along the way.
 *
 * Most of this is setup rather than navigation, and deliberately so — six of the
 * call sites only exist in a state the app has to be driven into. A bolt-on has to
 * be fitted before the VE table goes stale and offers ACCEPT RE-LOGGED VALUES; the
 * ECU scaling has to be knocked off the fitted injectors before RESCALE appears; the
 * engine has to be started before STOP replaces START; a pull has to finish before
 * the histogram trio exists at all. A Button that never mounts is a Button this
 * sweep never checks.
 * @returns {Promise<HTMLElement[]>}
 */
async function sweep() {
  const seen = new Set();
  const collect = () => {
    for (const el of document.querySelectorAll(`.${styles.button}`)) seen.add(el);
  };

  launch();
  collect();

  // BUILD is the landing tab, and its sections arrive collapsed.
  for (const section of ['Engine Architecture', 'Induction', 'Fuel System', 'Exhaust']) {
    fireEvent.click(screen.getByText(section));
    collect();
  }
  // Fitting a part leaves the logged VE table behind the hardware, which is what
  // puts the ACCEPT RE-LOGGED VALUES advisory on TUNE > AIRFLOW.
  const uninstalled = screen.getAllByRole('button')
    .filter((b) => b.textContent.includes('INSTALL') && !(/** @type {HTMLButtonElement} */ (b).disabled));
  fireEvent.click(uninstalled[0]);
  collect();

  clickButton(/TUNE/);
  collect();
  // INJECTORS visited last: the scaling-mismatch step right after this loop needs
  // to still be on TUNE > Injectors, where ECU Injector Scaling and RESCALE live.
  for (const view of ['AIRFLOW', 'SPARK', 'FUEL', 'SENSORS', 'INJECTORS']) {
    clickButton(view);
    collect();
    // Selecting a grid cell mounts the SelectionDock and its DONE button.
    const grid = screen.queryByTestId('tuning-grid');
    if (grid) {
      const cells = within(grid).getAllByRole('button');
      fireEvent.click(cells[cells.length - 1]);
      collect();
    }
  }
  // Still on TUNE > Injectors: telling the ECU a different injector size is fitted
  // raises the scaling-mismatch warning and its RESCALE button.
  const scaling = within(screen.getByRole('group', { name: 'ECU Injector Scaling' })).getAllByRole('button');
  fireEvent.click(scaling.find((b) => b.getAttribute('aria-pressed') === 'false'));
  collect();

  clickButton(/HOME/);
  collect();
  fireEvent.click(screen.getByText('Live Engine'));
  collect();
  clickButton('START ENGINE'); // mounts STOP, the other branch of that variant
  collect();

  clickButton(/DYNO/);
  collect();
  clickButton('RUN DYNO PULL');
  collect();
  // `disabled={running}` is the entire mechanism behind the disabled-state
  // contrast fix, and losing it also lets a second pull fire mid-sweep. The label
  // names the PHASE while running, and a pull opens by holding idle, so the first
  // label after the click is IDLING… rather than SWEEPING….
  expect(/** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'IDLING…' })).disabled).toBe(true);
  // A pull now runs settle -> sweep -> spooldown -> rest, so the wait is named from the
  // sequence rather than carrying a number that has to be remembered if it is retimed.
  await waitFor(() => expect(screen.getByRole('button', { name: 'DATALOG' })).toBeTruthy(),
    { timeout: DYNO_PULL_MS + 2000 });
  clickButton('DATALOG');
  collect();
  clickButton('BUILD HISTOGRAM FROM THIS PULL'); // mounts APPLY CORRECTIONS / DISCARD
  collect();

  return [...seen];
}

/** How many of the four variant classes an element carries. */
function variantsOn(el) {
  return VARIANTS.filter((v) => el.classList.contains(styles[v]));
}

// Every Button the sweep is supposed to reach. Asserting the labels, not just a
// count, is what stops the sweep quietly degrading: a navigation click that stopped
// working would drop its screen's buttons and every "all of them are fine" assertion
// below would go on passing over the shorter list.
const EXPECTED = [
  'SKIP GUIDE', 'RESET ALL TO STOCK', 'FLAT ACROSS ALL', 'SPOOL RAMP', 'ZERO',
  'ACCEPT RE-LOGGED VALUES', 'DONE', 'RESCALE ECU TO', 'STOP', 'TEST', 'RUN DYNO PULL',
  'BUILD HISTOGRAM FROM THIS PULL', 'APPLY CORRECTIONS TO VE', 'DISCARD',
];

describe('every Button the app mounts', () => {
  it('is exactly one variant, never full-width, and never red', async () => {
    // One expensive sweep — it runs a dyno pull — shared by the three assertions,
    // rather than three renders of the whole app.
    const found = await sweep();

    const text = found.map((el) => el.textContent);
    for (const label of EXPECTED) {
      expect({ label, reached: text.some((t) => t.includes(label)) }).toEqual({ label, reached: true });
    }

    for (const el of found) {
      const label = el.textContent || el.getAttribute('aria-label');

      // Honest here because every Button in the sweep either carries real
      // label text or is icon-only (Tutorial, Repair engine — the only two
      // whose textContent is empty), so `|| aria-label` is the whole name,
      // not a fallback masked by a sub-label sharing the element. Catches a
      // deleted `title`+`aria-label` pair leaving a nameless icon button.
      expect({ label, named: Boolean(label) }).toEqual({ label, named: true });

      // A mistyped variant produces styles[variant] === undefined, which filter(Boolean)
      // drops: the button renders with no variant class at all and nothing notices.
      expect({ label, variants: variantsOn(el) }).toEqual({ label, variants: [expect.any(String)] });

      // The inversion this task exists for. If a call site ever earns `block`, turn
      // this into a named exception and say why in the same edit — do not delete it.
      expect({ label, block: el.classList.contains(styles.block) }).toEqual({ label, block: false });
      expect({ label, width: el.style.width }).toEqual({ label, width: '' });

      // `danger` means destructive, not important. The one button that earns it is
      // unreachable from here by construction — see the next test.
      expect({ label, danger: el.classList.contains(styles.danger) }).toEqual({ label, danger: false });
    }
  }, 30000);
});

describe('the danger variant', () => {
  it('is spent on the preset-overwrite confirm and nowhere else', async () => {
    // The sweep above proves nothing on the ordinary screens is red. On its own that
    // would pass just as well if `danger` had no call site at all, or if the confirm
    // had quietly become unreachable — so prove the other half here.
    //
    // `choosePreset` only raises this prompt when `hasTuningWork()` is true, which is
    // exactly why the confirm is destructive: reaching it means there is hand-edited
    // calibration work for it to overwrite.
    launch();
    clickButton(/TUNE/);
    const grid = within(screen.getByTestId('tuning-grid'));
    const cells = grid.getAllByRole('button').filter((b) => /^-?\d+(\.\d+)?$/.test(b.textContent));
    fireEvent.click(cells[Math.floor(cells.length / 2)]);
    fireEvent.click(within(screen.getByTestId('selection-dock')).getByRole('button', { name: '+1' }));
    clickButton(/BUILD/);

    const picker = /** @type {HTMLSelectElement[]} */ (screen.getAllByRole('combobox'))
      .find((el) => el.querySelector('optgroup'));
    const preset = [...picker.querySelectorAll('option')].map((o) => o.value).find((v) => v && v !== '__custom__');
    fireEvent.change(picker, { target: { value: preset } });

    expect(screen.getByRole('button', { name: /^LOAD / }).classList.contains(styles.danger)).toBe(true);
    // Its partner is not: backing out of the prompt destroys nothing.
    expect(screen.getByRole('button', { name: 'CANCEL' }).classList.contains(styles.ghost)).toBe(true);
  });
});

describe('the Button call sites in the shell and its screens', () => {
  // Every file that can hold one. This used to read EcuLab.jsx alone, which was the
  // whole app; the screen split moves call sites out of it a tab at a time, so a
  // single-file scan would quietly measure less of the app after each extraction and
  // still pass. Walking `src/ui/screens` means a screen extracted tomorrow is covered
  // the day it lands, without anyone remembering to add it here.
  //
  // `src/ui/components/` joined the walk when TUNE's split moved `SelectionDock` (a
  // shared component with its own DONE button) there rather than into any one screen
  // — the same reasoning as `screens/`: a call site that moves out of EcuLab.jsx into
  // a shared component must not quietly stop being counted.
  //
  // `src/ui/AppShell.jsx` joined the same way: wiring the app shell moved the header's
  // Tutorial and Repair-engine buttons out of EcuLab.jsx and into the strip
  // `AppShell.jsx` renders, so a scan that stopped at `screens/`/`components/` would
  // undercount by exactly those two — not because a Button was deleted, but because
  // the file holding it is a third kind of home this test did not yet know about.
  const sources = [
    readFileSync(new NodeURL('../../src/ui/EcuLab.jsx', import.meta.url), 'utf8'),
    readFileSync(new NodeURL('../../src/ui/AppShell.jsx', import.meta.url), 'utf8'),
    ...readdirSync(new NodeURL('../../src/ui/screens/', import.meta.url), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.jsx'))
      .map((e) => readFileSync(`${e.parentPath ?? e.path}/${e.name}`, 'utf8')),
    ...readdirSync(new NodeURL('../../src/ui/components/', import.meta.url), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.jsx'))
      .map((e) => readFileSync(`${e.parentPath ?? e.path}/${e.name}`, 'utf8')),
  ];

  /**
   * The text of every `<Button …>` opening tag across those files.
   *
   * Scanning to the first `>` would stop inside `onClick={() => …}`, so track brace
   * depth and accept only a `>` outside braces.
   * @returns {string[]}
   */
  function openingTags() {
    const tags = [];
    for (const source of sources) {
      let from = source.indexOf('<Button');
      while (from !== -1) {
        let depth = 0;
        let i = from;
        for (; i < source.length; i += 1) {
          const c = source[i];
          if (c === '{') depth += 1;
          else if (c === '}') depth -= 1;
          else if (c === '>' && depth === 0) break;
        }
        tags.push(source.slice(from, i + 1));
        from = source.indexOf('<Button', i);
      }
    }
    return tags;
  }

  /**
   * Every variant name written at a call site — both `variant="ghost"` and every
   * branch of `variant={cond ? 'ghost' : 'primary'}`, which is why a single regex
   * capture is not enough.
   * @param {string} tag
   * @returns {string[]}
   */
  function variantsNamedIn(tag) {
    const names = [];
    for (const m of tag.matchAll(/variant=(?:"([^"]*)"|\{([^}]*)\})/g)) {
      if (m[1] !== undefined) names.push(m[1]);
      else for (const lit of m[2].matchAll(/'([^']*)'/g)) names.push(lit[1]);
    }
    return names;
  }

  it('finds the call sites at all', () => {
    // Guards the scanner, not the code: one that matched nothing would make every
    // test below pass over an empty list.
    //
    // 18 was the count when EcuLab.jsx was the only file scanned. Extracting HOME and
    // BUILD did not delete a Button, it moved them — so the floor RISES to the total
    // across the shell, the screens and (since TUNE's split) the shared components
    // rather than dropping to what is left in the shell. TUNE's own extraction moved
    // three call sites (VE's ACCEPT RE-LOGGED VALUES, ECU's RESCALE, and
    // SelectionDock's DONE) but deleted none, so the total stays 23.
    //
    // Wiring `AppShell` moved two more (Tutorial, Repair engine) out of EcuLab.jsx and
    // into AppShell.jsx, which is why that file joined `sources` above — the total is
    // still 23 because a move nets zero, not because nothing happened. Raise the floor
    // when a screen or shared component adds a real call site; lowering it is how this
    // stops guarding anything.
    expect(openingTags().length).toBeGreaterThanOrEqual(23);
  });

  it('names a real variant at every call site, including the ones the sweep cannot mount', () => {
    // The DOM sweep can only judge what it can reach. This catches a typo anywhere,
    // including inside a conditional branch that only renders in a state the sweep
    // never enters. No `variant` at all is fine — the primitive defaults to primary.
    const named = openingTags().flatMap(variantsNamedIn);
    expect(named.length).toBeGreaterThanOrEqual(10);
    for (const v of named) expect({ variant: v, known: VARIANTS.includes(v) }).toEqual({ variant: v, known: true });
  });

  it('gives every Button a click handler, so none of them is inert', () => {
    // `Button` spreads its rest props straight onto the element, so an omitted
    // onClick is not a type error and not a render error — it is a button that looks
    // right and does nothing. Nothing in the DOM can tell the difference, which is
    // why this one reads the source.
    for (const tag of openingTags()) {
      expect({ tag, wired: tag.includes('onClick=') }).toEqual({ tag, wired: true });
    }
  });
});
