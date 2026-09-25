/**
 * The pull log's crosslinks: every screen a fix names resolves to a route that exists,
 * across real pulls of the kinds of build that produce the most varied advice.
 */

import { describe, expect, it } from 'vitest';

import { fixLinks, tuneAttention } from '../../src/ui/components/fixLinks.js';
import { ROUTES } from '../../src/ui/routing.js';
import { makeEngine } from '../ecuHarness.js';
import { seedRandomPerTest } from '../seededRandom.js';

seedRandomPerTest();

describe('fixLinks', () => {
  it('reads each screen once, in the order the text names it', () => {
    const text = 'On TUNE → NITROUS, raise it, or fit a bigger pump on BUILD → FUEL SYSTEM, then TUNE → NITROUS again.';
    expect(fixLinks(text).map((l) => l.href)).toEqual(['#/tune/nitrous', '#/build/fuel']);
  });

  it('does not read BUILD → FUEL SYSTEM as TUNE → FUEL, and maps the older TIMING / AFR wording', () => {
    expect(fixLinks('BUILD → FUEL SYSTEM').map((l) => l.href)).toEqual(['#/build/fuel']);
    expect(fixLinks('On TIMING, take 2° out. On AFR, richen it.').map((l) => l.href)).toEqual(['#/tune/spark', '#/tune/fuel']);
    expect(fixLinks('')).toEqual([]);
    expect(fixLinks(null)).toEqual([]);
  });

  it('every link it can make is a route the app has', () => {
    const all = 'BUILD → FUEL SYSTEM BUILD → INDUCTION BUILD → ENGINE BUILD → EXHAUST TUNE → AIRFLOW TUNE → SPARK TUNE → FUEL TUNE → INJECTORS TUNE → SENSORS TUNE → BOOST TUNE → VVT TUNE → IDLE TUNE → PROTECT TUNE → TORQUE TUNE → NITROUS';
    const links = fixLinks(all);
    expect(links).toHaveLength(15);
    for (const l of links) expect(ROUTES[l.tab]).toContain(l.section);
  });

  it('on real pulls, every "TUNE → X" or "BUILD → X" a fix names becomes a link', () => {
    const FUELLED = { injIdx: 3, ecuInjectorCc: 650, octaneIdx: 1 };
    const kit = { kit: 'wet', shotHp: 150, heater: false, bottleLb: 3 };
    const pulls = [
      makeEngine({}).pull(100),
      makeEngine({ preset: 'b58-m1' }).pull(100),
      makeEngine({ build: { nitrous: kit } }).pull(100),
      makeEngine({ build: { ...FUELLED, nitrous: { ...kit, kit: 'dry' } }, cal: { 'nitrous.dryFuelPct': 0 } }).pull(100),
      makeEngine({ build: { ...FUELLED, blowerId: 'm90', blowerRatio: 3.2 } }).pull(100),
      makeEngine({ build: { injIdx: 3 } }).pull(100),
    ];
    let named = 0;
    for (const p of pulls) {
      for (const e of p.events) {
        const mentions = [...(e.fix ?? '').matchAll(/\b(TUNE|BUILD) → ([A-Z][A-Z ]*[A-Z])/g)].map((m) => `${m[1]} › ${m[2]}`);
        const labels = fixLinks(e.fix).map((l) => l.label);
        for (const m of mentions) expect(labels.some((l) => m.startsWith(l))).toBe(true);
        named += mentions.length;
      }
    }
    expect(named).toBeGreaterThan(5);
  });

  it('counts how many events point at each TUNE page', () => {
    const counts = tuneAttention([
      { fix: 'On TUNE → NITROUS, raise the retard.' },
      { fix: 'On TUNE → NITROUS, lower the fuel. Or BUILD → INDUCTION.' },
      { fix: 'On TIMING, take 2° out.' },
      { fix: null },
    ]);
    expect(counts).toEqual({ nitrous: 2, spark: 1 });
  });
});
