import { describe, expect, it } from 'vitest';

import { LOAD, OPEN_LOOP_KPA, RPM } from '../../src/sim/index.js';
import { fuelReport, sparkReport, veLogReport } from '../../src/ui/components/advisorReports.js';

/** A spark entry; only the fields the report reads. */
const cell = (ri, ci, over) => ({
  ri, ci, rpm: 1000 * (ci + 1), map: 100 + ri * 20,
  current: over ? 24 : 18, suggested: 18, delta: over ? -6 : 0,
  mbt: 22, knockCeiling: 20, knockLimited: false,
});

/** Assembles a calAdvice whose category arrays genuinely contain the cells named. */
function advice({ over = [], under = [], past = [] } = {}) {
  const all = [...over, ...under, ...past];
  return { spark: all, fuelAdv: [], overAdvanced: over, underAdvanced: under, pastMbt: past, wrongMix: [] };
}

/**
 * A fuelAdv entry; only the fields `fuelReport` reads. `map` defaults well
 * above `OPEN_LOOP_KPA` (open loop, mixture advice applies); `delta` defaults
 * negative (suggested is richer than current, i.e. the cell is lean).
 */
const afrCell = (ri, ci, { map = OPEN_LOOP_KPA + 10, delta = -0.8 } = {}) => ({
  ri, ci, rpm: 1000 * (ci + 1), map,
  current: 12.5, suggested: Number((12.5 + delta).toFixed(2)), delta,
  delivered: 12.3, target: 12.0, duty: 50,
});

/** Assembles a calAdvice whose fuel arrays genuinely contain the cells named. */
function fuelAdvice({ fuelAdv = [], wrongMix = [] } = {}) {
  return { spark: [], overAdvanced: [], underAdvanced: [], pastMbt: [], fuelAdv, wrongMix };
}

describe('sparkReport, no selection', () => {
  it('leads with the knock limit when any cell is past it', () => {
    const r = sparkReport(advice({ over: [cell(3, 4, true)] }), null);
    expect(r.state).toBe('table-over');
    expect(r.tone).toBe('danger');
    expect(r.headline).toBe('1 cell beyond the knock limit');
  });

  it('pluralises the headline', () => {
    const r = sparkReport(advice({ over: [cell(3, 4, true), cell(3, 5, true)] }), null);
    expect(r.headline).toBe('2 cells beyond the knock limit');
  });

  it('reports timing left on the table only past the four-cell floor', () => {
    const four = [cell(0, 0), cell(0, 1), cell(0, 2), cell(0, 3)];
    expect(sparkReport(advice({ under: four }), null).state).toBe('table-clean');
    expect(sparkReport(advice({ under: [...four, cell(0, 4)] }), null).state).toBe('table-under');
  });

  it('ranks the knock limit above every other finding', () => {
    // A table that is simultaneously over-advanced somewhere and under-advanced
    // in six places leads with the danger, never with the opportunity.
    const under = [cell(0, 0), cell(0, 1), cell(0, 2), cell(0, 3), cell(0, 4), cell(0, 5)];
    const r = sparkReport(advice({ over: [cell(3, 4, true)], under }), null);
    expect(r.state).toBe('table-over');
  });

  it('is clean when every category is empty', () => {
    const r = sparkReport(advice(), null);
    expect(r.state).toBe('table-clean');
    expect(r.tone).toBe('ok');
  });

  it('keeps the table-wide fall-through order, which is the reverse', () => {
    // Under-advanced is checked first table-wide, but only past a four-cell floor,
    // so a single under-advanced cell loses to any past-MBT cell here.
    const r = sparkReport(advice({ under: [cell(0, 0)], past: [cell(0, 1)] }), null);
    expect(r.state).toBe('table-past-mbt');
  });
});

describe('sparkReport, one cell selected', () => {
  it('classifies by membership, not by comparing against the ceilings itself', () => {
    // This cell's own numbers say it is inside both ceilings (current 18 < mbt 22,
    // < knockCeiling 20). The advisor nonetheless filed it as over-advanced. The
    // report must follow the advisor, because the advisor is the single source of
    // truth for what counts as over-advanced — a UI that recomputed the answer is
    // exactly the disagreement advisors.js warns about.
    const c = { ...cell(3, 4), current: 18 };
    const r = sparkReport(advice({ over: [c] }), { type: 'cell', row: 3, col: 4 });
    expect(r.state).toBe('cell-over');
    expect(r.tone).toBe('danger');
  });

  it('names the gap to the ceiling that bound it', () => {
    const c = { ...cell(3, 4), current: 24, knockCeiling: 20 };
    const r = sparkReport(advice({ over: [c] }), { type: 'cell', row: 3, col: 4 });
    expect(r.headline).toBe('4.0 deg past the knock limit');
    expect(r.detail.cell).toBe(c);
  });

  it('says a cell the engine never reaches is unreachable, not clean', () => {
    // calibrationAdvice skips unreachable cells entirely (its rule 2), so the
    // lookup misses. Reporting that as "inside both ceilings" would tell the
    // player their 200 kPa cell at 800 RPM is fine, when it simply never happens.
    const r = sparkReport(advice({ over: [cell(3, 4, true)] }), { type: 'cell', row: 0, col: 0 });
    expect(r.state).toBe('cell-unreachable');
    expect(r.tone).toBe('info');
  });

  it('reports a cell in no category as inside both ceilings', () => {
    const c = cell(2, 2);
    const r = sparkReport({ ...advice(), spark: [c] }, { type: 'cell', row: 2, col: 2 });
    expect(r.state).toBe('cell-ok');
    expect(r.tone).toBe('ok');
  });

  it('names the gap past MBT', () => {
    const c = { ...cell(2, 2), current: 25, mbt: 22 };
    const r = sparkReport(advice({ past: [c] }), { type: 'cell', row: 2, col: 2 });
    expect(r.headline).toBe('3.0 deg past MBT');
  });

  it('names the gap for a cell past BOTH ceilings, with MBT the lower one', () => {
    // The exact geometry advisors.js warns about: this cell is detonating, and a
    // classifier that ordered by which ceiling is lower would file it as merely
    // wasteful. The existing membership test uses mbt ABOVE knockCeiling, so it
    // never reproduces this shape.
    const c = { ...cell(3, 4), current: 26, mbt: 18, knockCeiling: 22, knockLimited: false };
    const r = sparkReport(advice({ over: [c] }), { type: 'cell', row: 3, col: 4 });
    expect(r.state).toBe('cell-over');
    expect(r.headline).toBe('4.0 deg past the knock limit');
  });

  it('names the gap for an under-advanced cell', () => {
    const c = { ...cell(1, 1), delta: 5 };
    const r = sparkReport(advice({ under: [c] }), { type: 'cell', row: 1, col: 1 });
    expect(r.headline).toBe('5.0 deg below what this build allows');
  });
});

describe('sparkReport, a row or column selected', () => {
  it('counts the flagged cells inside the selected row', () => {
    const r = sparkReport(
      advice({ over: [cell(3, 1, true), cell(3, 2, true), cell(1, 5, true)] }),
      { type: 'row', row: 3 },
    );
    expect(r.state).toBe('group-over');
    expect(r.headline).toBe('2 of these cells are past the knock limit');
  });

  it('counts down the column when a column is selected', () => {
    const r = sparkReport(
      advice({ over: [cell(1, 4, true), cell(3, 4, true), cell(3, 0, true)] }),
      { type: 'col', col: 4 },
    );
    expect(r.headline).toBe('2 of these cells are past the knock limit');
  });

  it('is clean when nothing in the group is flagged', () => {
    const r = sparkReport(advice({ over: [cell(1, 5, true)] }), { type: 'row', row: 3 });
    expect(r.state).toBe('group-clean');
  });

  it('puts past-MBT ahead of under-advanced within a band', () => {
    const r = sparkReport(advice({ under: [cell(3, 0)], past: [cell(3, 1)] }), { type: 'row', row: 3 });
    expect(r.state).toBe('group-past-mbt');
  });

  it('uses singular verb agreement for a single flagged cell', () => {
    const r = sparkReport(advice({ over: [cell(3, 1, true)] }), { type: 'row', row: 3 });
    expect(r.headline).toBe('1 of these cells is past the knock limit');
  });
});

describe('fuelReport, no selection', () => {
  it('flags high-load cells off best power', () => {
    const r = fuelReport(fuelAdvice({ wrongMix: [afrCell(3, 4)] }), null);
    expect(r.state).toBe('table-off');
    expect(r.tone).toBe('warn');
    expect(r.headline).toBe('1 high-load cell off best power');
  });

  it('pluralises the headline', () => {
    const r = fuelReport(fuelAdvice({ wrongMix: [afrCell(3, 4), afrCell(3, 5)] }), null);
    expect(r.headline).toBe('2 high-load cells off best power');
  });

  it('is clean when wrongMix is empty', () => {
    const r = fuelReport(fuelAdvice(), null);
    expect(r.state).toBe('table-clean');
    expect(r.tone).toBe('ok');
    expect(r.headline).toBe('High-load mixture is on best power');
  });
});

describe('fuelReport, one cell selected', () => {
  it('classifies by membership in wrongMix, not by comparing delta itself', () => {
    // This cell's own delta (0.1) is well under MIX_NOTABLE_AFR and would never
    // land in wrongMix if the report recomputed the threshold itself. The
    // advisor nonetheless filed it as off-target — the report must follow that,
    // the same membership rule sparkReport pins.
    const c = afrCell(3, 4, { delta: 0.1 });
    const r = fuelReport(fuelAdvice({ fuelAdv: [c], wrongMix: [c] }), { type: 'cell', row: 3, col: 4 });
    expect(r.state).toBe('cell-off');
    expect(r.tone).toBe('warn');
  });

  it('names a negative delta as lean of best power — the suggestion is richer, so the cell is lean', () => {
    const c = afrCell(3, 4, { delta: -0.8 });
    const r = fuelReport(fuelAdvice({ fuelAdv: [c], wrongMix: [c] }), { type: 'cell', row: 3, col: 4 });
    expect(r.headline).toBe('0.8 AFR lean of best power');
  });

  it('names a positive delta as rich of best power — the suggestion is leaner, so the cell is rich', () => {
    const c = afrCell(3, 4, { delta: 0.8 });
    const r = fuelReport(fuelAdvice({ fuelAdv: [c], wrongMix: [c] }), { type: 'cell', row: 3, col: 4 });
    expect(r.headline).toBe('0.8 AFR rich of best power');
  });

  it('reports closed loop even when the cell has a large delta', () => {
    // Below OPEN_LOOP_KPA the trims own the cell — this is deliberately
    // fabricated with both a huge delta AND wrongMix membership, to prove the
    // closed-loop check binds first and unconditionally, not because a real
    // wrongMix could ever contain a sub-OPEN_LOOP_KPA cell (calibrationAdvice's
    // own filter would never put one there).
    const c = afrCell(3, 4, { map: OPEN_LOOP_KPA - 5, delta: -5 });
    const r = fuelReport(fuelAdvice({ fuelAdv: [c], wrongMix: [c] }), { type: 'cell', row: 3, col: 4 });
    expect(r.state).toBe('cell-closed-loop');
    expect(r.tone).toBe('info');
    expect(r.headline).toBe('Closed loop — the trims own this cell');
  });

  it('says a cell the engine never reaches is unreachable, not on target', () => {
    const c = afrCell(3, 4);
    const r = fuelReport(fuelAdvice({ fuelAdv: [c], wrongMix: [c] }), { type: 'cell', row: 0, col: 0 });
    expect(r.state).toBe('cell-unreachable');
    expect(r.tone).toBe('info');
  });

  it('reports an open-loop cell not in wrongMix as on target', () => {
    const c = afrCell(2, 2);
    const r = fuelReport(fuelAdvice({ fuelAdv: [c] }), { type: 'cell', row: 2, col: 2 });
    expect(r.state).toBe('cell-ok');
    expect(r.tone).toBe('ok');
    expect(r.headline).toBe('On best power');
  });
});

describe('fuelReport, a row or column selected', () => {
  it('counts the flagged cells inside the selected row', () => {
    const r = fuelReport(
      fuelAdvice({ wrongMix: [afrCell(3, 1), afrCell(3, 2), afrCell(1, 5)] }),
      { type: 'row', row: 3 },
    );
    expect(r.state).toBe('group-off');
    expect(r.headline).toBe('2 of these cells are off best power');
  });

  it('counts down the column when a column is selected', () => {
    const r = fuelReport(
      fuelAdvice({ wrongMix: [afrCell(1, 4), afrCell(3, 4), afrCell(3, 0)] }),
      { type: 'col', col: 4 },
    );
    expect(r.headline).toBe('2 of these cells are off best power');
  });

  it('is clean when nothing in the group is flagged', () => {
    const r = fuelReport(fuelAdvice({ wrongMix: [afrCell(1, 5)] }), { type: 'row', row: 3 });
    expect(r.state).toBe('group-clean');
    expect(r.tone).toBe('ok');
  });

  it('uses singular verb agreement for a single flagged cell', () => {
    const r = fuelReport(fuelAdvice({ wrongMix: [afrCell(3, 1)] }), { type: 'row', row: 3 });
    expect(r.headline).toBe('1 of these cells is off best power');
  });
});

/**
 * A `veCorrections` result with logged data in the given cells only — what a pull at
 * wide-open throttle, or a LIVE drive, would leave behind.
 * @param {Array<[number, number, number]>} cells [row, col, correction factor]
 */
const corrWith = (cells) => {
  const cell = LOAD.map(() => RPM.map(() => null));
  for (const [ri, ci, ratio] of cells) cell[ri][ci] = { ratio, weight: 5, samples: 5, lambdaRatio: ratio, trim: 1, maf: 1, rescale: 1 };
  return { cell, cells: cells.length };
};
const VE = LOAD.map(() => RPM.map(() => 80));
/** @returns {*} */
const log = (corr, over = {}) => ({ corr, ve: VE, airModel: 'blend', pullInfo: { state: 'ok' }, liveSamples: 0, ...over });

describe('veLogReport — only what the logs measured', () => {
  it('has nothing to say without logs, and says why', () => {
    const r = veLogReport(log(corrWith([]), { pullInfo: { state: 'none' } }), null);
    expect(r.state).toBe('no-logs');
    expect(r.headline).toBe('No VE logs yet');
    expect(r.detail.pullInfo.state).toBe('none');
    expect(veLogReport(null, null).state).toBe('no-logs');
  });

  it('reports the worst logged cell, table-wide, and counts the cells with data', () => {
    const r = veLogReport(log(corrWith([[2, 3, 1.04], [2, 4, 1.08], [4, 2, 0.99]])), null);
    expect(r.state).toBe('log-off');
    expect(r.tone).toBe('warn');
    expect(r.headline).toBe('Logged VE off by up to 8.0% (3 cells)');
    expect(r.detail.cell.rpm).toBe(RPM[4]);
    expect(r.detail.cell.table).toBe(80);
  });

  it('calls a table within 2% of its logs in sync', () => {
    const r = veLogReport(log(corrWith([[2, 3, 1.01], [2, 4, 0.985]])), null);
    expect(r.state).toBe('log-sync');
    expect(r.tone).toBe('ok');
  });

  it('narrows to a selected cell, and says plainly when that cell has no data', () => {
    const corr = corrWith([[2, 4, 1.08]]);
    expect(veLogReport(log(corr), { type: 'cell', row: 2, col: 4 }).headline).toBe(`Log says 8.0% more air at ${RPM[4]} RPM, ${LOAD[2]} kPa`);
    const empty = veLogReport(log(corr), { type: 'cell', row: 5, col: 0 });
    expect(empty.state).toBe('sel-empty');
    expect(empty.headline).toBe(`No logged data in ${RPM[0]} RPM, ${LOAD[5]} kPa yet`);
  });

  it('scopes a row or range selection to the cells inside it', () => {
    const corr = corrWith([[2, 4, 1.08], [4, 2, 1.03]]);
    const row = veLogReport(log(corr), { type: 'row', row: 4 });
    expect(row.detail.cell.ri).toBe(4);
    expect(row.headline).toBe('Logged VE off by up to 3.0% (1 cell)');
  });

  it('on the MAF strategy, says the table is not in the fuel path', () => {
    expect(veLogReport(log(corrWith([[2, 4, 1.08]]), { airModel: 'maf' }), null).state).toBe('maf-model');
  });
});


describe('a range selection (#105)', () => {
  it('counts only flagged cells inside the rectangle', () => {
    const cal = {
      spark: [], underAdvanced: [], pastMbt: [],
      overAdvanced: [{ ri: 0, ci: 0 }, { ri: 1, ci: 1 }, { ri: 3, ci: 3 }],
    };
    const r = sparkReport(cal, { type: 'range', r1: 1, c1: 1, r2: 0, c2: 0 });
    expect(r.state).toBe('group-over');
    expect(r.detail.count).toBe(2);
  });
  it('fuel counts a range the same way', () => {
    const cal = { fuelAdv: [], wrongMix: [{ ri: 2, ci: 2 }, { ri: 5, ci: 7 }] };
    expect(fuelReport(cal, { type: 'range', r1: 2, c1: 2, r2: 4, c2: 4 }).detail.count).toBe(1);
  });
});
