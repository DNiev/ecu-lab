import { describe, expect, it } from 'vitest';

import { LOAD, RPM } from '../../src/sim/index.js';
import {
  anchorOf, cellCount, countLabel, formatDelta, inRect, opLabel, rectOf, selectionKey, signed, spanSelection, stepsFor,
} from '../../src/ui/components/selection.js';

const lastR = LOAD.length - 1;
const lastC = RPM.length - 1;

describe('rectOf', () => {
  it('covers each selection type', () => {
    expect(rectOf({ type: 'cell', row: 2, col: 3 })).toEqual({ r1: 2, c1: 3, r2: 2, c2: 3 });
    expect(rectOf({ type: 'row', row: 1 })).toEqual({ r1: 1, c1: 0, r2: 1, c2: lastC });
    expect(rectOf({ type: 'col', col: 4 })).toEqual({ r1: 0, c1: 4, r2: lastR, c2: 4 });
    expect(rectOf({ type: 'range', r1: 3, c1: 5, r2: 1, c2: 2 })).toEqual({ r1: 1, c1: 2, r2: 3, c2: 5 });
  });
});

describe('inRect / cellCount', () => {
  const r = { r1: 1, c1: 2, r2: 3, c2: 5 };
  it('tests membership inclusively', () => {
    expect(inRect(r, 1, 2)).toBe(true);
    expect(inRect(r, 3, 5)).toBe(true);
    expect(inRect(r, 0, 2)).toBe(false);
    expect(inRect(r, 2, 6)).toBe(false);
  });
  it('counts cells', () => {
    expect(cellCount(r)).toBe(12);
    expect(cellCount({ r1: 0, c1: 0, r2: 0, c2: 0 })).toBe(1);
  });
});

describe('anchorOf', () => {
  it('names the fixed corner of each type', () => {
    expect(anchorOf({ type: 'cell', row: 2, col: 3 })).toEqual({ r: 2, c: 3 });
    expect(anchorOf({ type: 'range', r1: 3, c1: 5, r2: 1, c2: 2 })).toEqual({ r: 3, c: 5 });
    expect(anchorOf({ type: 'row', row: 1 })).toEqual({ r: 1, c: 0 });
    expect(anchorOf({ type: 'col', col: 4 })).toEqual({ r: 0, c: 4 });
  });
});

describe('spanSelection', () => {
  it('is a cell when both ends are the same point', () => {
    expect(spanSelection({ r: 1, c: 1 }, { r: 1, c: 1 })).toEqual({ type: 'cell', row: 1, col: 1 });
  });
  it('is a one-cell range when forced', () => {
    expect(spanSelection({ r: 1, c: 1 }, { r: 1, c: 1 }, true)).toEqual({ type: 'range', r1: 1, c1: 1, r2: 1, c2: 1 });
  });
  it('keeps the anchor as r1/c1', () => {
    expect(spanSelection({ r: 3, c: 4 }, { r: 1, c: 2 })).toEqual({ type: 'range', r1: 3, c1: 4, r2: 1, c2: 2 });
  });
});

describe('selectionKey', () => {
  it('differs for different ranges and is empty for none', () => {
    expect(selectionKey(null)).toBe('');
    expect(selectionKey({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 1 }))
      .not.toBe(selectionKey({ type: 'range', r1: 0, c1: 0, r2: 1, c2: 2 }));
    expect(selectionKey({ type: 'cell', row: 1, col: 2 })).toBe(selectionKey({ type: 'cell', row: 1, col: 2 }));
  });
});

describe('labels and steps', () => {
  it('steps by table precision', () => {
    expect(stepsFor(0)).toEqual({ small: 1, big: 5 });
    expect(stepsFor(1)).toEqual({ small: 0.1, big: 1 });
  });
  it('signs numbers', () => {
    expect(signed(5)).toBe('+5');
    expect(signed(-0.1)).toBe('-0.1');
  });
  it('pluralises the cell count', () => {
    expect(opLabel('smooth', { r1: 0, c1: 0, r2: 2, c2: 3 })).toBe('smooth · 12 cells');
    expect(opLabel('+1', { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe('+1 · 1 cell');
  });
});

describe('countLabel', () => {
  it('names the op and how many cells it changed', () => {
    expect(countLabel('revert', 3)).toBe('revert · 3 cells');
    expect(countLabel('revert', 1)).toBe('revert · 1 cell');
  });
});

describe('formatDelta', () => {
  it('prints an unchanged cell as a dot', () => {
    expect(formatDelta(0, 0)).toBe('·');
  });
  it('signs a change at the grid precision', () => {
    expect(formatDelta(2, 0)).toBe('+2');
    expect(formatDelta(-1, 0)).toBe('-1');
    expect(formatDelta(0.3, 1)).toBe('+0.3');
    expect(formatDelta(-0.5, 1)).toBe('-0.5');
  });
  it('shows ~0 for a real change too small to print', () => {
    expect(formatDelta(0.3, 0)).toBe('~0');
    expect(formatDelta(-0.3, 0)).toBe('~0');
    expect(formatDelta(0.04, 1)).toBe('~0');
  });
});
