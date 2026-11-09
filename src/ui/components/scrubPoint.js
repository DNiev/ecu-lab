/**
 * The pull, addressed by RPM.
 *
 * DATALOG used to render one card per entry in `RPM` from `src/sim/tables.js` — the VE
 * TABLE's axis, borrowed because the constant was in scope. A default pull produces 61
 * sweep points and that axis has eight entries, one of which sits below the sweep's
 * start, so 54 points were in memory and unreachable. These three functions are what
 * make them addressable.
 *
 * Pure and DOM-free, same as `eventBands.js`: a decision buried in JSX is a decision no
 * test can reach.
 */

import { utilisationTone } from '../theme.js';

/**
 * The sweep point at `rpm`, or the nearest one below it.
 *
 * Falls back below rather than requiring an exact hit. The track's own `step` guarantees
 * exact hits, but the seeded RPM does not come from the track — it comes from
 * `logFocusRpm`, written by a chart click. Tying correctness to two separate things
 * agreeing is how a screen goes blank in a case nobody rendered.
 *
 * @param {object[]} points the pull's sweep points, ascending by rpm
 * @param {number} rpm
 * @returns {object|null} null only when `rpm` is below the first point
 */
export function pointAt(points, rpm) {
  let found = null;
  for (const p of points) {
    if (p.rpm > rpm) break;
    found = p;
  }
  return found;
}

/**
 * Where the scrubber opens.
 *
 * With a focus RPM it opens there, so clicking a knock band on CURVES and switching to
 * DATALOG lands on that knock. Without one it opens at peak power, which is the point a
 * player is most likely to want first. `BANK_PULL` clears the focus, so a new pull opens
 * at its own peak rather than at the last pull's event.
 *
 * The focus is clamped into this pull's range: it is written by a different screen and
 * must not be able to park the scrubber past the data.
 *
 * The clamped RPM is then snapped onto an actual sweep point. A clamp alone can still
 * land off-grid — `ResultScreen` activates a band at `Math.round((rpmStart + rpmEnd) /
 * 2)`, and a knock event's `rpmStart` is `Math.round(floatRpm)`, neither of which is
 * guaranteed to be a multiple of the sweep step. `pointAt` then rounds DOWN to the
 * nearest point while the track `<input>`'s own `step` rounds to the NEAREST one, so an
 * off-grid seed would disagree with the thumb the moment it first moved.
 *
 * @param {object[]} points the pull's sweep points, ascending by rpm
 * @param {number|null} logFocusRpm
 * @returns {number}
 */
export function initialScrubRpm(points, logFocusRpm) {
  const first = points[0].rpm;
  const last = points[points.length - 1].rpm;
  if (logFocusRpm != null) {
    const clamped = Math.min(Math.max(logFocusRpm, first), last);
    return pointAt(points, clamped)?.rpm ?? points[0].rpm;
  }
  // Peak POWER's rpm, not peak power. `result.peakHp` is the value; the rpm it
  // happened at is not stored anywhere and has to come from the points.
  return points.reduce((a, b) => (b.hp > a.hp ? b : a)).rpm;
}

/**
 * @typedef {object} Gauge
 * @property {string} key
 * @property {string} label
 * @property {string|number} value
 * @property {string} unit
 * @property {'neutral'|'ok'|'warn'|'danger'} tone
 */

/**
 * The eight readings a single number can carry.
 *
 * Volumetric efficiency, timing and mixture are deliberately absent. Each of those is an
 * asked-to-got PAIR — the VE table's claim against what the engine flowed, commanded
 * timing against what the ECU ran, commanded mixture against what came out — and a bare
 * number cannot say that the ECU overrode you. They stay as rows.
 *
 * Every tone comes from a flag the sim already set, or from `utilisationTone`. Nothing
 * here re-derives a threshold that lives somewhere else.
 *
 * @param {object} p one sweep point
 * @returns {Gauge[]}
 */
export function pointGauges(p) {
  const mixture = p.leanRisk || p.richRisk ? 'danger' : 'neutral';
  // The busier of the two injector banks: a staged port kit can be at its limit while the
  // direct injectors are not, and one DUTY reading should not hide that.
  const duty = Math.max(p.duty, p.portDuty ?? 0);
  return [
    { key: 'maf', label: 'AIRFLOW', value: p.maf, unit: 'g/s', tone: 'neutral' },
    { key: 'map', label: 'MAP', value: p.map, unit: 'kPa', tone: 'neutral' },
    { key: 'iat', label: 'IAT', value: p.iat, unit: '°C', tone: 'neutral' },
    { key: 'lambda', label: 'LAMBDA', value: p.lambda, unit: 'λ', tone: mixture },
    { key: 'duty', label: 'DUTY', value: duty, unit: '%', tone: utilisationTone(duty) },
    { key: 'pw', label: 'INJ PW', value: p.pw, unit: 'ms', tone: p.fuelLimited ? 'danger' : 'neutral' },
    { key: 'egt', label: 'EGT', value: p.egt, unit: '°C', tone: p.egtRisk ? 'danger' : 'neutral' },
    { key: 'peakPressure', label: 'PEAK P', value: p.peakPressure, unit: 'bar', tone: p.pressureRisk ? 'danger' : 'neutral' },
  ];
}
