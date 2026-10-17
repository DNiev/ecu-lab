// @vitest-environment jsdom
/**
 * The tutorial: its pages, its real-screen snippets, its numbers and its practice
 * missions. The important guarantees are the ones a tutorial usually loses over time:
 * every callout still points at something on its screen, and every number it quotes
 * is the one the game will show.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EcuLab, { DYNO_PULL_MS } from '../../src/ui/EcuLab.jsx';
import { TutorialScreen } from '../../src/ui/screens/TutorialScreen.jsx';
import { COURSE, TUTORIAL } from '../../src/ui/tutorial/books.js';
import { MISSIONS, advance, markOf } from '../../src/ui/tutorial/missions.js';
import { intakeFitted, intakeRetuned, overAdvanced, stock } from '../../src/ui/tutorial/scenarios.js';
import { LOAD } from '../../src/sim/index.js';

// recharts' <ResponsiveContainer> needs a ResizeObserver, which jsdom lacks.
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

beforeEach(() => {
  try { localStorage.clear(); } catch { /* no storage */ }
});
afterEach(cleanup);

/** Opens lesson `i` of `book` from its contents page. */
const openLesson = (book, i) => {
  render(<TutorialScreen book={book} onDone={() => {}} onPractice={() => {}} onCourse={() => {}} />);
  const nav = screen.getByRole('navigation', { name: `${book.title} contents` });
  fireEvent.click(within(nav).getByRole('button', { name: new RegExp(`^${book.lessons[i].number.replace('.', '\\.')} `) }));
};

describe('the tutorial is short', () => {
  it('takes five minutes at most: a handful of cards, not a course', () => {
    // The in-depth material is the Tuning Course's job. The tutorial is the way in, and
    // nobody finishes a long one.
    expect(TUTORIAL.chapters.reduce((m, c) => m + c.minutes, 0)).toBeLessThanOrEqual(5);
    expect(TUTORIAL.lessons.length).toBeLessThanOrEqual(6);
  });

  it('opens on a short contents page, then counts through its cards', () => {
    render(<TutorialScreen onDone={() => {}} />);
    expect(screen.getByText('TUTORIAL · CONTENTS')).toBeTruthy();
    expect(screen.getByText('BY THE END YOU WILL BE ABLE TO')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'START' }));
    expect(screen.getByText(`TUTORIAL · 1/${TUTORIAL.lessons.length}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'NEXT' }));
    expect(screen.getByText(`TUTORIAL · 2/${TUTORIAL.lessons.length}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /BACK/ }));
    fireEvent.click(screen.getByRole('button', { name: /BACK/ }));
    expect(screen.getByText('TUTORIAL · CONTENTS')).toBeTruthy();
  });

  it('ends by offering the course, or the game', () => {
    const onDone = vi.fn();
    const onCourse = vi.fn();
    render(<TutorialScreen onDone={onDone} onCourse={onCourse} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${TUTORIAL.lessons.length} `) }));
    fireEvent.click(screen.getByRole('button', { name: 'OPEN THE COURSE' }));
    fireEvent.click(screen.getByRole('button', { name: 'START TUNING' }));
    fireEvent.click(screen.getByRole('button', { name: 'SKIP' }));
    expect(onCourse).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});

describe('from the tutorial to the course, in the app', () => {
  it('OPEN THE COURSE lands on the course\u2019s contents, not on the page the tutorial was showing', () => {
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'TUTORIAL' }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${TUTORIAL.lessons.length} `) }));
    fireEvent.click(screen.getByRole('button', { name: 'OPEN THE COURSE' }));
    expect(screen.getByText('COURSE · CONTENTS')).toBeTruthy();
    expect(window.location.hash).toBe('#/course');
  });
});

describe('the Tuning Course', () => {
  const course = () => render(<TutorialScreen book={COURSE} onDone={() => {}} onPractice={() => {}} />);

  it('says what you will learn, what you need and how long, before lesson one', () => {
    course();
    expect(screen.getByText('COURSE · CONTENTS')).toBeTruthy();
    expect(screen.getByText('YOU NEED')).toBeTruthy();
    const minutes = COURSE.chapters.reduce((m, c) => m + c.minutes, 0);
    expect(screen.getByText(new RegExp(`About ${minutes} minutes`))).toBeTruthy();
  });

  it('shows the end result first: the stock engine on the real dyno screen, with its real numbers', () => {
    course();
    const fig = screen.getByRole('figure', { name: 'Game screen: DYNO' });
    expect(fig.querySelector('[data-tour="dyno-power"]')).toBeTruthy();
    expect(within(fig).getByText(new RegExp(`${stock().result.peakHp} whp`))).toBeTruthy();
  });

  it('lists every lesson under its chapter, and ticks the ones read', () => {
    course();
    const nav = screen.getByRole('navigation', { name: 'The Tuning Course contents' });
    expect(within(nav).getAllByRole('button')).toHaveLength(COURSE.lessons.length);
    fireEvent.click(within(nav).getByRole('button', { name: /^1\.1 / }));
    fireEvent.click(screen.getByRole('button', { name: /CONTENTS/ }));
    expect(screen.getByRole('button', { name: /^1\.1 .*, read$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^1\.2 [^,]*$/ })).toBeTruthy();
  });

  it('picks up where the reader left off, separately from the tutorial', () => {
    const first = course();
    fireEvent.click(screen.getByRole('button', { name: /^2\.2 / }));
    first.unmount();
    course();
    fireEvent.click(screen.getByRole('button', { name: 'CONTINUE AT 2.2' }));
    expect(screen.getByRole('heading', { level: 1, name: /FUEL/ })).toBeTruthy();
    cleanup();
    render(<TutorialScreen onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'START' })).toBeTruthy();
  });

  it('marks the end of each chapter, and finishes back to Learn', () => {
    const onDone = vi.fn();
    render(<TutorialScreen book={COURSE} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /^1\.2 / }));
    expect(screen.getByRole('status').textContent).toMatch(/Chapter 1 complete/);
    fireEvent.click(screen.getByRole('button', { name: /CONTENTS/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${COURSE.lessons.at(-1).number.replace('.', '\\.')} `) }));
    fireEvent.click(screen.getByRole('button', { name: 'BACK TO LEARN' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  ...TUTORIAL.lessons.map((l, i) => ['tutorial', TUTORIAL, l.number, l.title, i]),
  ...COURSE.lessons.map((l, i) => ['course', COURSE, l.number, l.title, i]),
])('%s %s, %s', (_b, book, _n, _t, i) => {
  it('opens, and points every callout at something that is really on its screen', () => {
    openLesson(book, i);
    const article = screen.getByRole('article');
    // The course's lessons carry the whole lesson shape; the tutorial's cards are short.
    if (book === COURSE) {
      expect(within(article).getByText('YOU WILL')).toBeTruthy();
      expect(within(article).getByText('WHAT YOU JUST DID')).toBeTruthy();
    }
    for (const fig of screen.queryAllByRole('figure')) {
      const name = fig.getAttribute('aria-label');
      expect({ name, missing: fig.getAttribute('data-callouts-missing') }).toEqual({ name, missing: '0' });
    }
  });
});

describe('a lesson’s screen is live', () => {
  it('APPLY HALF in lesson 4.2 changes the sandbox table and then asks for a new pull, as the game does', () => {
    openLesson(COURSE, COURSE.lessons.findIndex((l) => l.id === 've-from-logs'));
    const fig = screen.getByRole('figure', { name: 'Game screen: TUNE › AIRFLOW' });
    const cellBefore = within(fig).getByRole('button', { name: '7500 RPM, 100 kPa' }).textContent;
    fireEvent.click(within(fig).getByRole('button', { name: 'APPLY HALF' }));
    expect(within(fig).getByRole('button', { name: '7500 RPM, 100 kPa' }).textContent).not.toBe(cellBefore);
    const panel = within(fig).getByRole('region', { name: 'Correct VE from logs' });
    expect(within(panel).getByText(/before you changed VE table .* run another pull/)).toBeTruthy();
  });
});

describe('the numbers are the game’s', () => {
  it('the stock pull the tutorial quotes is the pull the app makes', async () => {
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    fireEvent.click(screen.getByRole('button', { name: /DYNO/ }));
    fireEvent.click(screen.getByRole('button', { name: 'RUN DYNO PULL' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'RUN DYNO PULL' })).toBeTruthy(), { timeout: 10000 });
    const strip = document.querySelector('[data-tour="strip-last-pull"]');
    expect(strip.textContent).toContain(`${Math.round(stock().result.peakHp)} whp`);
  }, DYNO_PULL_MS + 4000);

  it('each chapter-4 scenario says what the lesson says it does', () => {
    // Over-advanced spark knocks and gains nothing, because knock control takes it back
    // out; the intake makes the MAF entry and runs lean of target at full throttle; the
    // retune clears both and makes more than either.
    expect(overAdvanced().result.events.some((e) => e.type === 'knock')).toBe(true);
    expect(overAdvanced().result.peakHp).toBeLessThanOrEqual(stock().result.peakHp + 1);
    const fitted = intakeFitted().result;
    expect(fitted.events.map((e) => e.type)).toContain('maf');
    const wotLean = Math.max(...fitted.points.filter((p) => p.openLoop).map((p) => p.afr / p.afrCommanded - 1));
    expect(wotLean).toBeGreaterThan(0.05);
    const retuned = intakeRetuned().result;
    expect(retuned.events.filter((e) => e.type === 'maf' || e.type === 'lean')).toEqual([]);
    expect(retuned.peakHp).toBeGreaterThan(intakeFitted().result.peakHp);
  });
});

describe('practice missions', () => {
  const route = (tab, section = null) => ({ tab, section });
  const base = () => {
    const s = stock().state;
    return { ...s, session: { ...s.session, result: null, pullCount: 0, running: false } };
  };
  const find = (id) => MISSIONS.find((m) => m.id === id);
  const startOf = (state) => ({ step: 0, marks: [markOf(state)] });

  it('first pull: ticks as the player opens DYNO, pulls, and reads the log and datalog', () => {
    const m = find('first-pull');
    let s = base();
    let p = advance(m, startOf(s), s, route('build', 'engine'));
    expect(p.step).toBe(0);
    p = advance(m, p, s, route('dyno', 'result'));
    expect(p.step).toBe(1);
    s = { ...s, session: { ...s.session, pullCount: 1, result: stock().result } };
    p = advance(m, p, s, route('dyno', 'result'));
    expect(p.step).toBe(2);
    p = advance(m, p, s, route('dyno', 'log'));
    p = advance(m, p, s, route('dyno', 'data'));
    expect(p.step).toBe(m.steps.length);
  });

  it('bolt-on: the VE step only ticks once the table actually changes after the pull', () => {
    const m = find('bolt-on');
    let s = base();
    let p = startOf(s);
    s = { ...s, build: { ...s.build, mods: { ...s.build.mods, intake: true } } };
    p = advance(m, p, s, route('build', 'induction'));
    expect(p.step).toBe(1);
    s = { ...s, session: { ...s.session, pullCount: 1, result: intakeFitted().result } };
    p = advance(m, p, s, route('tune', 'airflow'));
    expect(p.step).toBe(2);
    // Same table, a new render: not done.
    p = advance(m, p, { ...s, tune: { ...s.tune } }, route('tune', 'airflow'));
    expect(p.step).toBe(2);
    s = { ...s, tune: { ...s.tune, ve: s.tune.ve.map((r) => r.map((v) => v + 1)) } };
    p = advance(m, p, s, route('tune', 'airflow'));
    expect(p.step).toBe(3);
    s = { ...s, build: { ...s.build, mafScalar: 1.11 } };
    p = advance(m, p, s, route('tune', 'sensors'));
    expect(p.step).toBe(4);
    s = { ...s, session: { ...s.session, pullCount: 2, result: intakeRetuned().result } };
    p = advance(m, p, s, route('dyno', 'result'));
    expect(p.step).toBe(m.steps.length);
  });

  it('knock limit: needs the knock seen in the log, then a clean pull after it', () => {
    const m = find('knock-limit');
    let s = base();
    let p = startOf(s);
    const WOT = LOAD.indexOf(100);
    s = { ...s, tune: { ...s.tune, timing: s.tune.timing.map((r, ri) => (ri === WOT ? r.map((v) => v + 10) : r)) } };
    p = advance(m, p, s, route('tune', 'spark'));
    expect(p.step).toBe(1);
    s = { ...s, session: { ...s.session, pullCount: 1, result: overAdvanced().result } };
    p = advance(m, p, s, route('dyno', 'result'));
    expect(p.step).toBe(2);
    p = advance(m, p, s, route('dyno', 'log'));
    expect(p.step).toBe(3);
    // The same knocking pull does not count as the clean one.
    p = advance(m, p, s, route('dyno', 'log'));
    expect(p.step).toBe(3);
    s = { ...s, session: { ...s.session, pullCount: 2, result: stock().result } };
    p = advance(m, p, s, route('dyno', 'result'));
    expect(p.step).toBe(m.steps.length);
  });

  it('starts from the course, follows the player into the game, and ticks the first step', () => {
    render(<EcuLab />);
    fireEvent.click(screen.getByRole('button', { name: 'SANDBOX' }));
    // HOME › Learn is where the course lives.
    fireEvent.click(screen.getByRole('button', { name: /HOME/ }));
    fireEvent.click(screen.getByText('Learn How It Works'));
    act(() => { window.location.hash = screen.getByRole('link', { name: /OPEN THE COURSE/ }).getAttribute('href'); window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
    fireEvent.click(screen.getByRole('button', { name: 'Start practice: Your first pull' }));
    const coach = screen.getByRole('region', { name: 'Practice mission' });
    expect(within(coach).getByText('0/4')).toBeTruthy();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /DYNO/ })); });
    expect(within(screen.getByRole('region', { name: 'Practice mission' })).getByText('1/4')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Practice mission' })).getByRole('button', { name: 'STOP PRACTICE' }));
    expect(screen.queryByRole('region', { name: 'Practice mission' })).toBeNull();
  });
});
