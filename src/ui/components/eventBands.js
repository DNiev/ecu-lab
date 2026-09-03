/**
 * Pull-log events as chart bands, and the tone rule the chart shares with the log.
 *
 * WHY THE TONE RULE LIVES HERE AND NOT IN LogScreen
 * It used to be computed inline in `LogScreen.jsx`, under a comment explaining that the
 * tone is derived from the severity the sim assigns rather than from a hand-kept list of
 * type names — because such a list once named eleven of the twelve types `src/sim` emits,
 * and `bearing` fell through to a chart-series colour. The chart now needs the same rule.
 * Keeping two copies of a rule whose whole point is that lists drift would be the
 * original bug with an extra step, so the rule moved here and both screens import it.
 *
 * Pure and DOM-free: the projection is unit-testable without rendering a chart.
 */

import { isLocatable } from '../../sim/index.js';

/**
 * The token family an event should be drawn in.
 *
 * `maf` is the one genuine special case — a calibration observation rather than damage,
 * and violet is the token reserved for that. Everything else is severity: 3 and above is
 * danger, below is warn.
 *
 * @param {{type: string, severity: number, msg?: string}} event
 * @returns {'danger'|'warn'|'violet'}
 */
export function eventTone(event) {
  if (event.type === 'maf') return 'violet';
  return event.severity >= 3 ? 'danger' : 'warn';
}

/**
 * @typedef {object} EventBand
 * @property {string} id stable per span, so two runs of the same type do not collide
 * @property {number} rpmStart
 * @property {number} rpmEnd
 * @property {'danger'|'warn'|'violet'} tone
 * @property {string} msg the event's own headline, for the band's accessible name
 */

/**
 * Every event that happened somewhere in particular, as a band.
 *
 * Whole-pull findings are dropped rather than stretched across the axis: a band from
 * 1500 to redline would claim a location the finding does not have. `ResultScreen`
 * accounts for them separately, in a line beneath the charts.
 *
 * @param {{type: string, severity: number, msg: string, rpmStart?: number, rpmEnd?: number}[]} events
 * @returns {EventBand[]}
 */
export function eventBands(events) {
  return events.filter(isLocatable).map((e) => ({
    id: `${e.type}-${e.rpmStart}-${e.rpmEnd}`,
    rpmStart: /** @type {number} */ (e.rpmStart),
    rpmEnd: /** @type {number} */ (e.rpmEnd),
    tone: eventTone(e),
    msg: e.msg,
  }));
}
