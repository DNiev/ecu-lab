/**
 * What the command palette (issue 63) can find: every page, and the ranking that
 * orders commands against a query.
 *
 * Pure — no React, no store. The pages derive from `ROUTES`, so a tab or section added
 * there without a label here fails `tests/commands.test.js` rather than going missing
 * from the palette. The actions (start the engine, run a pull, undo…) are built in
 * `EcuLab.jsx`, which owns their handlers, and are matched here beside the pages.
 */

import { ROUTES, TAB_NAMES } from './routing.js';

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

/**
 * What else a player might call each tab. The tab's own name is `TAB_NAMES`, the
 * nav's, so the palette prints exactly what the nav does.
 */
export const TAB_KEYWORDS = {
  dash: ['dashboard'],
  build: ['garage', 'hardware'],
  tune: ['calibration', 'tables'],
  live: ['engine', 'sound', 'rev'],
  dyno: ['pull', 'power'],
  drag: ['strip', 'quarter'],
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
  'tune/boost': { label: 'Boost Control', keywords: ['wastegate', 'turbo', 'overboost'] },
  'tune/vvt': { label: 'Variable Cam Timing', keywords: ['vvt', 'vanos', 'cam', 'phaser'] },
  'tune/idle': { label: 'Idle Control', keywords: ['stall', 'hunt', 'rpm'] },
  'tune/protect': { label: 'Engine Protection', keywords: ['rev limiter', 'limp', 'safety'] },
  'tune/torque': { label: 'Torque Management', keywords: ['traction', 'launch', 'limiter'] },
  'tune/nitrous': { label: 'Nitrous Control', keywords: ['nos', 'spray', 'shot'] },
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
 * What decides which sections have anything to show.
 * @typedef {object} SectionFlags
 * @property {boolean} showJobs career mode, or a job underway
 * @property {boolean} hasResult a pull is showing
 * @property {boolean} hasHistory at least one pull is banked
 * @property {boolean} hasNitrous a nitrous kit is fitted
 * @property {boolean} running a dyno pull is under way
 */

/**
 * Whether a section would render anything right now. The one statement of it: TUNE's
 * and DYNO's switchers filter their buttons through this, and the palette its pages,
 * so neither can offer a blank page the other knows to hide.
 * @param {string} key `tab/section`
 * @param {SectionFlags} flags
 * @returns {boolean}
 */
export function sectionAvailable(key, { showJobs, hasResult, hasHistory, hasNitrous, running }) {
  if (key === 'dash/jobs') return showJobs;
  // Like real ECU software, which shows its nitrous tables once nitrous is enabled.
  if (key === 'tune/nitrous') return hasNitrous;
  // While a pull runs, DYNO shows its curves and nothing else, whatever the URL says.
  if (running && key.startsWith('dyno/')) return key === 'dyno/result';
  if (RESULT_SECTIONS.has(key)) return hasResult;
  if (key === 'dyno/history') return hasHistory || hasResult;
  return true;
}

/**
 * One command per tab and one per section, in nav order, leaving out sections that
 * would render nothing (see `sectionAvailable`).
 * @param {SectionFlags} flags
 * @param {(tab: string, section: string|null) => void} go `null`: the tab, as a nav
 *   tap opens it
 * @returns {Command[]}
 */
export function pageCommands(flags, go) {
  /** @type {Command[]} */
  const out = [];
  for (const [tab, sections] of Object.entries(ROUTES)) {
    const name = TAB_NAMES[tab];
    out.push({ id: `page:${tab}`, label: name, kind: 'page', keywords: TAB_KEYWORDS[tab], run: () => go(tab, null) });
    if (sections.length < 2) continue;
    for (const section of sections) {
      const key = `${tab}/${section}`;
      if (!sectionAvailable(key, flags)) continue;
      const s = SECTION_LABELS[key];
      out.push({
        id: `page:${key}`, label: s.label, context: name, kind: 'page',
        keywords: [...s.keywords, name.toLowerCase()],
        run: () => go(tab, section),
      });
    }
  }
  return out;
}

/**
 * Whether the player is on an Apple device, where the palette's shortcut is Cmd-K and
 * only Cmd-K: in a macOS text field Ctrl-K deletes to the end of the line, and the
 * shortcut works from inside fields. iPadOS reports itself as a Mac, which is right here.
 * @param {Navigator} [nav]
 * @returns {boolean}
 */
export function isApplePlatform(nav = globalThis.navigator) {
  // `userAgentData` where the browser has it (Chromium says "macOS"), `platform` otherwise.
  const p = /** @type {any} */ (nav)?.userAgentData?.platform || nav?.platform || '';
  return /mac|iphone|ipad|ipod/i.test(p);
}

/** @param {string} s lower-cased @returns {string[]} */
const words = (s) => s.split(/[^a-z0-9]+/).filter(Boolean);

/** What `rank` returns for a command the query does not match at all. */
const NO_MATCH = 5;

/**
 * How well a command matches a lower-cased query: 0 is best, `NO_MATCH` is none.
 * @param {string} q
 * @param {Command} c
 * @returns {number}
 */
function rank(q, c) {
  const label = c.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (words(label).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  if (c.keywords.some((k) => k.startsWith(q))) return 3;
  // A query of several words, typed the way the palette prints a page ("tune spark",
  // "dyno hist", even "tune › spark"): each word starts a word of the tab, the label
  // or a keyword.
  const terms = words(q);
  const vocab = [...words(`${c.context ?? ''} ${label}`.toLowerCase()), ...c.keywords.flatMap((k) => words(k))];
  if (terms.length && terms.every((t) => vocab.some((w) => w.startsWith(t)))) return 4;
  return NO_MATCH;
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
    .filter((x) => x.r < NO_MATCH)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}
