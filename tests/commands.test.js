/**
 * The command palette's page list and ranking (issue 63). Pure, so node env.
 */

import { describe, expect, it, vi } from 'vitest';

import { SECTION_LABELS, TAB_LABELS, matchCommands, pageCommands } from '../src/ui/commands.js';
import { ROUTES } from '../src/ui/routing.js';

const ALL = { showJobs: true, hasResult: true, hasHistory: true };
const pages = (flags = ALL, go = () => {}) => pageCommands({ ...flags, go });
const ids = (cmds) => cmds.map((c) => c.id);

/** @returns {import('../src/ui/commands.js').Command} */
const cmd = (id, label, keywords = [], kind = /** @type {'page'|'action'} */ ('page')) => ({ id, label, kind, keywords, run: () => {} });

describe('the label table', () => {
  it('labels every tab, and nothing that is not a tab', () => {
    expect(Object.keys(TAB_LABELS).sort()).toEqual(Object.keys(ROUTES).sort());
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
    expect(list).toHaveLength(6 + 22);
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

  it('drops the four result sections before the first pull, and History with no pulls banked', () => {
    const list = ids(pages({ showJobs: true, hasResult: false, hasHistory: false }));
    for (const s of ['result', 'log', 'data', 'score', 'history']) expect(list).not.toContain(`page:dyno/${s}`);
    expect(list).toContain('page:dyno');
  });

  it('keeps History when pulls are banked but none is showing', () => {
    const list = ids(pages({ showJobs: true, hasResult: false, hasHistory: true }));
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

  it('with no query lists actions first, then pages, each in input order', () => {
    expect(ids(matchCommands('', [spark, start, pullLog]))).toEqual(['a', 's', 'l']);
  });
});
