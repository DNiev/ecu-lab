/**
 * Advisor reports: what the simulation's advisors already concluded, narrowed to
 * whatever the player currently has selected.
 *
 * These invent no analysis. `calibrationAdvice` and `veRecommendations` in
 * `src/sim/advisors.js` decide what is wrong with a table; these functions only
 * decide which part of that answer is relevant right now, and how to say it.
 *
 * THE ONE RULE: a cell's category is looked up in the advisor's own output
 * arrays. It is never re-derived by comparing the cell against a threshold. The
 * classification in `calibrationAdvice` is subtle on purpose — a cell past both
 * ceilings with MBT the lower of the two is detonating, not merely wasteful, and
 * getting that backwards tells a player a dangerous cell is safe. Asking the
 * arrays cannot get it wrong. Recomputing can, and that is the false alarm
 * issue #34 removed.
 */

import { LOAD, OPEN_LOOP_KPA, RPM } from '../../sim/index.js';

import { inRect, rectOf } from './selection.js';

/** @typedef {import('./TuningGrid.jsx').Selection} Selection */

/**
 * @typedef {object} AdvisorReport
 * @property {'ok'|'warn'|'danger'|'info'} tone
 * @property {string} headline plain text, shown on the collapsed summary at <560px
 * @property {string} state which body the renderer should show
 * @property {object} detail numbers and cell records the body needs
 */

/** English, not a template with a stray "1 cells" in it. */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Does this category contain the cell at (ri, ci)? */
const holds = (arr, ri, ci) => arr.some((c) => c.ri === ri && c.ci === ci);

/** How many of a category fall inside the selected row, column or range? */
function countIn(arr, selection) {
  const rect = rectOf(selection);
  return arr.filter((c) => inRect(rect, c.ri, c.ci)).length;
}

/**
 * @param {object} calAdvice as returned by `calibrationAdvice`
 * @param {Selection|null} selection
 * @returns {AdvisorReport}
 */
export function sparkReport(calAdvice, selection) {
  const { spark, overAdvanced, underAdvanced, pastMbt } = calAdvice;

  if (selection && selection.type === 'cell') {
    const cell = spark.find((c) => c.ri === selection.row && c.ci === selection.col);
    // No entry means `calibrationAdvice` filtered the cell out as unreachable
    // (its rule 2): a turbo build never sees 200 kPa at 800 RPM. That is not the
    // same as a clean cell and must not be reported as one.
    if (!cell) return { tone: 'info', headline: 'Never reached by this build', state: 'cell-unreachable', detail: {} };

    if (holds(overAdvanced, cell.ri, cell.ci)) {
      return {
        tone: 'danger',
        headline: `${(cell.current - cell.knockCeiling).toFixed(1)} deg past the knock limit`,
        state: 'cell-over',
        detail: { cell },
      };
    }
    if (holds(pastMbt, cell.ri, cell.ci)) {
      return {
        tone: 'warn',
        headline: `${(cell.current - cell.mbt).toFixed(1)} deg past MBT`,
        state: 'cell-past-mbt',
        detail: { cell },
      };
    }
    if (holds(underAdvanced, cell.ri, cell.ci)) {
      return {
        tone: 'warn',
        headline: `${cell.delta.toFixed(1)} deg below what this build allows`,
        state: 'cell-under',
        detail: { cell },
      };
    }
    return { tone: 'ok', headline: 'Inside both ceilings', state: 'cell-ok', detail: { cell } };
  }

  if (selection) {
    // A row, column or range. Danger first as always, then severity order — past MBT
    // before under-advanced, the reverse of the table-wide fall-through below,
    // and with no four-cell floor: the player picked this band deliberately, so
    // one flagged cell in it is worth saying.
    const over = countIn(overAdvanced, selection);
    if (over > 0) {
      return {
        tone: 'danger',
        headline: `${over} of these cells ${over === 1 ? 'is' : 'are'} past the knock limit`,
        state: 'group-over',
        detail: { count: over },
      };
    }
    const past = countIn(pastMbt, selection);
    if (past > 0) {
      return { tone: 'warn', headline: `${past} of these cells ${past === 1 ? 'is' : 'are'} past MBT`, state: 'group-past-mbt', detail: { count: past } };
    }
    const under = countIn(underAdvanced, selection);
    if (under > 0) {
      return { tone: 'warn', headline: `${under} of these cells ${under === 1 ? 'has' : 'have'} advance left`, state: 'group-under', detail: { count: under } };
    }
    return { tone: 'ok', headline: 'Nothing flagged in this band', state: 'group-clean', detail: {} };
  }

  // Table-wide. This precedence IS the fall-through the SPARK screen rendered
  // before the panel existed, preserved exactly: danger first, then the
  // opportunity, then the wasted advance, then the all-clear.
  if (overAdvanced.length > 0) {
    return {
      tone: 'danger',
      headline: `${plural(overAdvanced.length, 'cell')} beyond the knock limit`,
      state: 'table-over',
      detail: { count: overAdvanced.length, cells: overAdvanced.slice(0, 5), more: Math.max(0, overAdvanced.length - 5) },
    };
  }
  if (underAdvanced.length > 4) {
    return { tone: 'warn', headline: 'Timing left on the table', state: 'table-under', detail: { count: underAdvanced.length } };
  }
  if (pastMbt.length > 0) {
    return { tone: 'warn', headline: 'Past peak torque', state: 'table-past-mbt', detail: { count: pastMbt.length } };
  }
  return { tone: 'ok', headline: 'Within the knock limit', state: 'table-clean', detail: {} };
}

/**
 * @param {object} calAdvice as returned by `calibrationAdvice`
 * @param {Selection|null} selection
 * @returns {AdvisorReport}
 */
export function fuelReport(calAdvice, selection) {
  const { fuelAdv, wrongMix } = calAdvice;

  if (selection && selection.type === 'cell') {
    const cell = fuelAdv.find((c) => c.ri === selection.row && c.ci === selection.col);
    // No entry means `calibrationAdvice` filtered the cell out as unreachable
    // (its rule 2), the same reason `sparkReport` can miss a lookup — not the
    // same thing as a cell that is on target.
    if (!cell) return { tone: 'info', headline: 'Never reached by this build', state: 'cell-unreachable', detail: {} };

    // Closed loop binds before membership, and unconditionally: the trims own
    // this cell regardless of how large its delta is, so a big number here is
    // not a reason to override the rule and report it anyway.
    if (cell.map < OPEN_LOOP_KPA) {
      return { tone: 'info', headline: 'Closed loop — the trims own this cell', state: 'cell-closed-loop', detail: { cell } };
    }

    if (holds(wrongMix, cell.ri, cell.ci)) {
      const direction = cell.delta < 0 ? 'lean' : 'rich';
      return {
        tone: 'warn',
        headline: `${Math.abs(cell.delta).toFixed(1)} AFR ${direction} of best power`,
        state: 'cell-off',
        detail: { cell },
      };
    }
    return { tone: 'ok', headline: 'On best power', state: 'cell-ok', detail: { cell } };
  }

  if (selection) {
    // A row, column or range. Only one category here, unlike sparkReport's three, so
    // there is no severity order to preserve — just the count in the band.
    const off = countIn(wrongMix, selection);
    if (off > 0) {
      return { tone: 'warn', headline: `${off} of these cells ${off === 1 ? 'is' : 'are'} off best power`, state: 'group-off', detail: { count: off } };
    }
    return { tone: 'ok', headline: 'Nothing flagged in this band', state: 'group-clean', detail: {} };
  }

  // Table-wide. FUEL never had a fall-through order to preserve — the old
  // banner only ever showed one thing, the wrongMix count, and simply did not
  // render when it was empty. table-clean is new prose the panel needs
  // because, unlike the old banner, it always renders something.
  if (wrongMix.length > 0) {
    return {
      tone: 'warn',
      headline: `${plural(wrongMix.length, 'high-load cell')} off best power`,
      state: 'table-off',
      detail: { count: wrongMix.length, cells: wrongMix.slice(0, 5), more: Math.max(0, wrongMix.length - 5) },
    };
  }
  return { tone: 'ok', headline: 'High-load mixture is on best power', state: 'table-clean', detail: {} };
}

/** A logged cell within this is as right as a wideband and fuel trims can tell. */
export const VE_LOG_GOOD_PCT = 2;

/**
 * @typedef {object} VeLogInput
 * @property {{cell: (import('../../sim/veLearn.js').VeCell|null)[][], cells: number}} corr
 *   from `veCorrections`
 * @property {number[][]} ve the table on screen
 * @property {'blend'|'sd'|'maf'} airModel
 * @property {{state: 'none'|'stale'|'part-load'|'unused'|'ok', changed?: string[]}} pullInfo
 * @property {number} liveSamples
 */

/**
 * What the logs say about the VE table — and only what they say. A real tuner cannot see
 * an engine's true VE, only the mixture it made against the one the table asked for, in
 * the cells the car was actually in; this reports that, cell by cell, with the working.
 *
 * @param {VeLogInput|null} log
 * @param {Selection|null} selection
 * @returns {AdvisorReport}
 */
export function veLogReport(log, selection) {
  if (!log) return { tone: 'info', headline: 'No VE logs yet', state: 'no-logs', detail: {} };
  if (log.airModel === 'maf') {
    return { tone: 'info', headline: 'MAF strategy: the VE table is not in the fuel path', state: 'maf-model', detail: {} };
  }
  const { corr, ve } = log;
  const rect = selection ? rectOf(selection) : { r1: 0, c1: 0, r2: LOAD.length - 1, c2: RPM.length - 1 };
  /** @type {any[]} */
  const logged = [];
  for (let ri = rect.r1; ri <= rect.r2; ri += 1) {
    for (let ci = rect.c1; ci <= rect.c2; ci += 1) {
      const c = corr.cell[ri]?.[ci];
      if (c) logged.push({ ...c, ri, ci, rpm: RPM[ci], load: LOAD[ri], table: ve[ri][ci], pct: (c.ratio - 1) * 100 });
    }
  }
  const where = selection?.type === 'cell' ? `${RPM[rect.c1]} RPM, ${LOAD[rect.r1]} kPa` : selection ? 'the selected cells' : null;
  if (!logged.length) {
    return {
      tone: 'info',
      headline: where ? `No logged data in ${where} yet` : 'No VE logs yet',
      state: where ? 'sel-empty' : 'no-logs',
      detail: { pullInfo: log.pullInfo, liveSamples: log.liveSamples },
    };
  }
  const worst = logged.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a));
  const at = `${worst.rpm} RPM, ${worst.load} kPa`;
  if (Math.abs(worst.pct) < VE_LOG_GOOD_PCT) {
    return {
      tone: 'ok',
      headline: selection?.type === 'cell' ? `Matches the log at ${at}` : `Logged cells match the table (within ${VE_LOG_GOOD_PCT}%)`,
      state: 'log-sync',
      detail: { cell: worst, cells: logged.length },
    };
  }
  return {
    tone: 'warn',
    headline: selection?.type === 'cell'
      ? `Log says ${Math.abs(worst.pct).toFixed(1)}% ${worst.pct > 0 ? 'more' : 'less'} air at ${at}`
      : `Logged VE off by up to ${Math.abs(worst.pct).toFixed(1)}% (${logged.length} ${logged.length === 1 ? 'cell' : 'cells'})`,
    state: 'log-off',
    detail: { cell: worst, cells: logged.length },
  };
}
