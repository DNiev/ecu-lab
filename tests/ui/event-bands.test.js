/**
 * The event → band projection, and the severity → tone rule it shares with the pull
 * log. Pure, no DOM.
 */

import { describe, expect, it } from 'vitest';

import { eventBands, eventTone, resolveBandRpm } from '../../src/ui/components/eventBands.js';

const located = (over = {}) => ({ type: 'knock', severity: 3, msg: 'Knock', rpmStart: 4200, rpmEnd: 5100, ...over });
const whole = (over = {}) => ({ type: 'injscale', severity: 3, msg: 'Injectors', ...over });

describe('eventTone', () => {
  it('calls a severity 3 event danger', () => {
    expect(eventTone(located({ severity: 3 }))).toBe('danger');
  });

  it('calls a lower-severity event warn', () => {
    expect(eventTone(located({ type: 'lean', severity: 2 }))).toBe('warn');
  });

  it('calls maf violet even though its severity is the lowest', () => {
    // Mutation caught: a severity-only rule. `maf` is severity 1, so severity alone
    // would call it 'warn'. It is a calibration observation rather than damage, and
    // violet is the token reserved for that — this is the one genuine special case,
    // and it is the assertion that distinguishes the real rule from the easy one.
    expect(eventTone({ type: 'maf', severity: 1, msg: 'MAF trim' })).toBe('violet');
  });

  it('does not call a severity 3 event violet just because it is severe', () => {
    // The other half of the special case: violet must be maf and nothing else.
    expect(eventTone(located({ type: 'pressure', severity: 3 }))).toBe('danger');
  });
});

describe('eventBands', () => {
  it('projects a locatable event to its span and tone', () => {
    expect(eventBands([located()])).toEqual([
      { id: 'knock-4200-5100', rpmStart: 4200, rpmEnd: 5100, tone: 'danger', msg: 'Knock' },
    ]);
  });

  it('drops events that have no span', () => {
    // Mutation caught: returning every event. A whole-pull finding has no RPM, so a
    // band for it would claim a location it does not have.
    expect(eventBands([whole()])).toEqual([]);
  });

  it('keeps the locatable ones and drops the rest in the same list', () => {
    // Both directions in one call, so an implementation that filters nothing and one
    // that filters everything each fail.
    const bands = eventBands([located(), whole(), located({ type: 'lean', severity: 2, rpmStart: 6100, rpmEnd: 6600 })]);
    expect(bands.map((b) => b.tone)).toEqual(['danger', 'warn']);
  });

  it('gives two events of the same type at different RPMs distinct ids', () => {
    // groupRuns can emit the same type twice when the condition stops and restarts.
    // Colliding ids would make React reuse a DOM node for a different band.
    const bands = eventBands([located(), located({ rpmStart: 6000, rpmEnd: 6400 })]);
    expect(bands[0].id).not.toBe(bands[1].id);
  });

  it('returns an empty list for no events', () => {
    expect(eventBands([])).toEqual([]);
  });
});

describe('resolveBandRpm', () => {
  /** @type {import('../../src/ui/components/eventBands.js').EventBand[]} */
  const BANDS = [
    { id: 'knock-4200-5100', rpmStart: 4200, rpmEnd: 5100, tone: 'danger', msg: 'Knock' },
    { id: 'lean-6100-6600', rpmStart: 6100, rpmEnd: 6600, tone: 'warn', msg: 'Lean' },
  ];

  it('resolves an RPM inside a band to that RPM', () => {
    expect(resolveBandRpm(4500, BANDS)).toBe(4500);
  });

  it('returns null for an RPM outside every band', () => {
    // The half that stops a click anywhere on the chart from navigating away — a
    // resolver that answered unconditionally would fail only this one.
    expect(resolveBandRpm(3000, BANDS)).toBe(null);
  });

  it('resolves an RPM exactly on a band\'s rpmStart', () => {
    // `>` instead of `>=` drops precisely the edge a player clicking a band's
    // left boundary lands on.
    expect(resolveBandRpm(4200, BANDS)).toBe(4200);
  });

  it('resolves an RPM exactly on a band\'s rpmEnd', () => {
    expect(resolveBandRpm(5100, BANDS)).toBe(5100);
  });

  it('resolves a numeric string, since recharts may hand the label as one', () => {
    expect(resolveBandRpm('4500', BANDS)).toBe(4500);
  });

  it('returns null for undefined', () => {
    expect(resolveBandRpm(undefined, BANDS)).toBe(null);
  });

  it('returns null for any input against an empty band list', () => {
    expect(resolveBandRpm(4500, [])).toBe(null);
  });

  it('resolves an RPM inside a later band in the list, not just the first', () => {
    // An implementation that only checked bands[0] would fail this one alone.
    expect(resolveBandRpm(6300, BANDS)).toBe(6300);
  });
});
