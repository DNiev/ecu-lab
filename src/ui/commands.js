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
