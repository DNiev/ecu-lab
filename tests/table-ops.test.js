import { describe, expect, it } from 'vitest';

import {
  addRect, changedIn, diffTable, interpolateRect, orderRect, revertRect, scaleRect, setRect, smoothRect,
} from '../src/sim/tables.js';

const B = { min: 0, max: 100 };
const grid = () => [
  [10, 20, 30, 40],
  [50, 60, 70, 80],
  [90, 95, 99, 100],
];
const all = { r1: 0, c1: 0, r2: 2, c2: 3 };

describe('orderRect', () => {
  it('orders corners given in any direction', () => {
    expect(orderRect({ r1: 2, c1: 3, r2: 0, c2: 1 })).toEqual({ r1: 0, c1: 1, r2: 2, c2: 3 });
  });
});

describe('addRect', () => {
  it('changes only cells inside the rectangle', () => {
    expect(addRect(grid(), { r1: 0, c1: 1, r2: 1, c2: 2 }, 5, B)).toEqual([
      [10, 25, 35, 40],
      [50, 65, 75, 80],
      [90, 95, 99, 100],
    ]);
  });
  it('accepts unordered corners', () => {
    expect(addRect(grid(), { r1: 1, c1: 2, r2: 0, c2: 1 }, 5, B))
      .toEqual(addRect(grid(), { r1: 0, c1: 1, r2: 1, c2: 2 }, 5, B));
  });
  it('clamps at both bounds', () => {
    expect(addRect(grid(), all, 5, B)[2]).toEqual([95, 100, 100, 100]);
    expect(addRect(grid(), all, -15, B)[0]).toEqual([0, 5, 15, 25]);
  });
  it('rounds to 2 dp', () => {
    expect(addRect([[0.1]], { r1: 0, c1: 0, r2: 0, c2: 0 }, 0.2, B)).toEqual([[0.3]]);
  });
  it('does not mutate its input', () => {
    const t = grid();
    addRect(t, all, 1, B);
    expect(t).toEqual(grid());
  });
  it('edits a single cell', () => {
    expect(addRect(grid(), { r1: 1, c1: 1, r2: 1, c2: 1 }, -10, B)[1]).toEqual([50, 50, 70, 80]);
  });
});

describe('scaleRect', () => {
  it('multiplies by 1 + pct/100', () => {
    expect(scaleRect(grid(), { r1: 0, c1: 0, r2: 0, c2: 3 }, 10, B)[0]).toEqual([11, 22, 33, 44]);
  });
  it('clamps and rounds', () => {
    expect(scaleRect(grid(), { r1: 2, c1: 0, r2: 2, c2: 3 }, 5, B)[2]).toEqual([94.5, 99.75, 100, 100]);
  });
});

describe('setRect', () => {
  it('sets every cell in the rectangle, clamped', () => {
    expect(setRect(grid(), { r1: 0, c1: 0, r2: 1, c2: 0 }, 42, B).map((r) => r[0])).toEqual([42, 42, 90]);
    expect(setRect(grid(), { r1: 0, c1: 0, r2: 0, c2: 0 }, 500, B)[0][0]).toBe(100);
  });
});

describe('interpolateRect', () => {
  it('keeps the four corners exactly', () => {
    const t = [[10.123, 0, 30], [0, 0, 0], [70, 0, 90]];
    const out = interpolateRect(t, { r1: 0, c1: 0, r2: 2, c2: 2 }, B);
    expect([out[0][0], out[0][2], out[2][0], out[2][2]]).toEqual([10.123, 30, 70, 90]);
  });
  it('fills the inside bilinearly', () => {
    const t = [[10, 0, 30], [0, 0, 0], [70, 0, 90]];
    expect(interpolateRect(t, { r1: 0, c1: 0, r2: 2, c2: 2 }, B)).toEqual([
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
    ]);
  });
  it('reduces to a straight line on one row', () => {
    expect(interpolateRect([[0, 7, 7, 30]], { r1: 0, c1: 0, r2: 0, c2: 3 }, B)).toEqual([[0, 10, 20, 30]]);
  });
  it('reduces to a straight line on one column', () => {
    expect(interpolateRect([[0], [7], [20]], { r1: 0, c1: 0, r2: 2, c2: 0 }, B)).toEqual([[0], [10], [20]]);
  });
  it('leaves a single cell alone', () => {
    expect(interpolateRect(grid(), { r1: 1, c1: 1, r2: 1, c2: 1 }, B)).toEqual(grid());
  });
  it('leaves cells outside the rectangle alone', () => {
    const out = interpolateRect(grid(), { r1: 0, c1: 0, r2: 0, c2: 2 }, B);
    expect(out.slice(1)).toEqual(grid().slice(1));
    expect(out[0][3]).toBe(40);
  });
});

describe('smoothRect', () => {
  it('averages each selected cell with its 3x3 neighbourhood', () => {
    const t = [[0, 0, 0], [0, 90, 0], [0, 0, 0]];
    expect(smoothRect(t, { r1: 1, c1: 1, r2: 1, c2: 1 }, B)[1][1]).toBe(10);
  });
  it('clips the neighbourhood at the table edge', () => {
    const t = [[40, 0], [0, 0]];
    expect(smoothRect(t, { r1: 0, c1: 0, r2: 0, c2: 0 }, B)[0][0]).toBe(10);
  });
  it('reads neighbours from the original table, not already-smoothed cells', () => {
    const t = [[0, 0, 0, 0], [0, 90, 0, 0], [0, 0, 0, 0]];
    const out = smoothRect(t, { r1: 1, c1: 1, r2: 1, c2: 2 }, B);
    expect(out[1][1]).toBe(10);
    expect(out[1][2]).toBe(10);
  });
  it('writes only inside the rectangle', () => {
    const t = [[0, 0, 0], [0, 90, 0], [0, 0, 0]];
    const out = smoothRect(t, { r1: 1, c1: 1, r2: 1, c2: 1 }, B);
    expect(out[0]).toEqual([0, 0, 0]);
  });
});

describe('diffTable', () => {
  it('is the signed per-cell change, rounded to 2 dp', () => {
    expect(diffTable([[10.1, 20], [30, 40]], [[10, 20.5], [30, 40]])).toEqual([[0.1, -0.5], [0, 0]]);
  });
  it('reads a difference below storage precision as no change, and never as -0', () => {
    expect(diffTable([[10.001]], [[10]])).toEqual([[0]]);
    expect(Object.is(diffTable([[9.999]], [[10]])[0][0], 0)).toBe(true);
  });
});

describe('revertRect', () => {
  it('copies only the cells inside the rectangle back from the baseline', () => {
    const edited = addRect(grid(), all, -5, B);
    expect(revertRect(edited, { r1: 1, c1: 2, r2: 0, c2: 1 }, grid())).toEqual([
      [5, 20, 30, 35],
      [45, 60, 70, 75],
      [85, 90, 94, 95],
    ]);
  });
  it('does not mutate its input', () => {
    const edited = addRect(grid(), all, -5, B);
    const copy = edited.map((r) => [...r]);
    revertRect(edited, all, grid());
    expect(edited).toEqual(copy);
  });
});

describe('changedIn', () => {
  const edited = addRect(grid(), { r1: 0, c1: 0, r2: 0, c2: 1 }, 5, B);
  it('counts the cells in the rectangle that differ from the baseline', () => {
    expect(changedIn(edited, grid(), all)).toBe(2);
    expect(changedIn(edited, grid(), { r1: 2, c1: 3, r2: 0, c2: 1 })).toBe(1);
  });
  it('is 0 where nothing moved', () => {
    expect(changedIn(edited, grid(), { r1: 1, c1: 1, r2: 1, c2: 1 })).toBe(0);
  });
});
