/**
 * The command palette's page list and ranking (issue 63). Pure, so node env.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  SECTION_LABELS, TAB_KEYWORDS, isApplePlatform, matchCommands, pageCommands, sectionAvailable,
} from '../src/ui/commands.js';
import { ROUTES, TAB_NAMES } from '../src/ui/routing.js';

const ALL = { showJobs: true, hasResult: true, hasHistory: true, hasNitrous: true, running: false };
const pages = (flags = ALL, go = () => {}) => pageCommands(flags, go);
const ids = (cmds) => cmds.map((c) => c.id);

/** @returns {import('../src/ui/commands.js').Command} */
const cmd = (id, label, keywords = [], kind = /** @type {'page'|'action'} */ ('page')) => ({ id, label, kind, keywords, run: () => {} });

describe('the label table', () => {
  it('names every tab, and nothing that is not a tab', () => {
    expect(Object.keys(TAB_NAMES).sort()).toEqual(Object.keys(ROUTES).sort());
    expect(Object.keys(TAB_KEYWORDS).sort()).toEqual(Object.keys(ROUTES).sort());
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
    expect(list).toHaveLength(6 + 28);
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

  it("drops Nitrous Control without a kit, as TUNE's switcher does", () => {
    expect(ids(pages({ ...ALL, hasNitrous: false }))).not.toContain('page:tune/nitrous');
    expect(ids(pages())).toContain('page:tune/nitrous');
  });

  it('drops the four result sections before the first pull, and History with no pulls banked', () => {
    const list = ids(pages({ ...ALL, hasResult: false, hasHistory: false }));
    for (const s of ['result', 'log', 'data', 'score', 'history']) expect(list).not.toContain(`page:dyno/${s}`);
    expect(list).toContain('page:dyno');
  });

  it('offers only Curves on DYNO while a pull runs, since nothing else renders then', () => {
    const list = ids(pages({ ...ALL, running: true }));
    expect(list).toContain('page:dyno/result');
    for (const s of ['log', 'data', 'score', 'history']) expect(list).not.toContain(`page:dyno/${s}`);
  });

  it('keeps History when pulls are banked but none is showing', () => {
    const list = ids(pages({ ...ALL, hasResult: false, hasHistory: true }));
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

describe('sectionAvailable', () => {
  it('gates a section the same way for the palette and the switchers', () => {
    expect(sectionAvailable('tune/spark', { ...ALL, hasResult: false, hasNitrous: false })).toBe(true);
    expect(sectionAvailable('tune/nitrous', { ...ALL, hasNitrous: false })).toBe(false);
    expect(sectionAvailable('dash/jobs', { ...ALL, showJobs: false })).toBe(false);
    expect(sectionAvailable('dyno/data', { ...ALL, hasResult: false })).toBe(false);
    expect(sectionAvailable('dyno/data', { ...ALL, running: true })).toBe(false);
    expect(sectionAvailable('dyno/result', { ...ALL, running: true })).toBe(true);
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

  it('finds a page typed the way it is printed, tab first', () => {
    const tuneSpark = cmd('ts', 'Spark', ['timing']);
    tuneSpark.context = 'TUNE';
    const dynoHistory = cmd('dh', 'History', ['runs']);
    dynoHistory.context = 'DYNO';
    const both = [tuneSpark, dynoHistory, start];
    expect(ids(matchCommands('tune spark', both))).toEqual(['ts']);
    expect(ids(matchCommands('tune sp', both))).toEqual(['ts']);
    expect(ids(matchCommands('TUNE › Spark', both))).toEqual(['ts']);
    expect(ids(matchCommands('dyno hist', both))).toEqual(['dh']);
    expect(matchCommands('tune hist', both)).toEqual([]);
  });

  it('ranks a several-word match after every single-phrase match', () => {
    const tuneSpark = cmd('ts', 'Spark');
    tuneSpark.context = 'TUNE';
    // 'tune spark' is a substring of this label (rank 2), so it outranks the page above.
    const literal = cmd('lit', 'Retune Spark Plugs');
    expect(ids(matchCommands('tune spark', [tuneSpark, literal]))).toEqual(['lit', 'ts']);
  });

  it('with no query lists actions first, then pages, each in input order', () => {
    expect(ids(matchCommands('', [spark, start, pullLog]))).toEqual(['a', 's', 'l']);
  });
});

describe('isApplePlatform', () => {
  it('is true on a Mac, an iPhone and an iPad, by userAgentData where there is one', () => {
    expect(isApplePlatform(/** @type {any} */ ({ platform: 'MacIntel' }))).toBe(true);
    expect(isApplePlatform(/** @type {any} */ ({ platform: 'iPhone' }))).toBe(true);
    expect(isApplePlatform(/** @type {any} */ ({ platform: 'iPad' }))).toBe(true);
    expect(isApplePlatform(/** @type {any} */ ({ userAgentData: { platform: 'macOS' }, platform: '' }))).toBe(true);
  });

  it('is false on Windows, Linux, Android, and when nothing is known', () => {
    expect(isApplePlatform(/** @type {any} */ ({ platform: 'Win32' }))).toBe(false);
    expect(isApplePlatform(/** @type {any} */ ({ platform: 'Linux x86_64' }))).toBe(false);
    expect(isApplePlatform(/** @type {any} */ ({ userAgentData: { platform: 'Android' }, platform: 'Linux armv8l' }))).toBe(false);
    expect(isApplePlatform(/** @type {any} */ ({}))).toBe(false);
    expect(isApplePlatform(/** @type {any} */ (null))).toBe(false);
  });
});
