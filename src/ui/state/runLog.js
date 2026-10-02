/**
 * The dyno run log: what one banked pull keeps, and the operations over a list of them.
 *
 * WHY A SLIM RECORD
 * A full `simulateSweep` result is about 88 KB of JSON — 61 points of 83 fields each.
 * The three things a timeline row and a ghost curve actually need are about 2 KB. A
 * whole record, with the measured build and calibration it was pulled on, is about
 * 9 KB. At twenty runs that is the difference between ~1.8 MB of localStorage and
 * ~190 KB, so the record stores the projection and not the result.
 *
 * WHY `knocks` IS A STORED COUNT AND NOT A DERIVED ONE
 * The delta panel on DYNO compares knock counts between the current pull and the one
 * before it. A slim record has no `events` array to count, so the count is taken once,
 * at bank time, from the result that still has one.
 *
 * NAMING: this is `runs`, never "history". `state.history` is the undo stack.
 *
 * This module imports nothing from `reducer.js`, the same discipline `history.js`
 * keeps and for the same reason: the reducer imports this.
 */

/**
 * How many runs the log keeps. Twenty at ~9 KB each is ~190 KB, comfortably inside a
 * ~5 MB localStorage budget while leaving room for a career's other state.
 */
export const RUN_LIMIT = 20;

/**
 * @typedef {object} RunPoint
 * @property {number} rpm
 * @property {number} hp
 * @property {number} torque
 */

/**
 * @typedef {object} RunRecord
 * @property {string} id unique and stable for the life of the record. A pin holds an
 *   id rather than an index precisely so that evicting OTHER runs cannot silently
 *   repoint it at a run the player never chose.
 * @property {number} n the career pull ordinal, for display ("Run 12").
 * @property {number} at epoch ms, for the row's relative timestamp.
 * @property {string} label the engine's name at the time of the pull.
 * @property {number} peakHp
 * @property {number} peakTq
 * @property {number} knocks how many `type: 'knock'` events the pull logged.
 * @property {{tuning: number, engineer: number, pull: number}} scores banked so a
 *   later PR can show a run's scorecard from the log without re-deriving it. Nothing
 *   under `src/` reads this field yet — HISTORY's own row shows `peakHp`/`peakTq`, not
 *   these — it is deliberately here ahead of its reader for PR 5b/5c, not dead weight.
 * @property {RunPoint[]} points
 * @property {{build: object, tune: object, loadKpa: number}} inputs the measured
 *   configuration, as `measuredInputs` in pullSignature.js projects it.
 */

/**
 * Builds a record from a completed pull.
 *
 * `id`, `n` and `at` are the CALLER's to supply. The reducer that consumes this is
 * documented as calling no `Date.now()` — it must stay a pure function of
 * `(state, action)` — so the clock is read at the dispatch site and travels on the
 * action, the same "caller computes, reducer applies" split `RESET_TO_STOCK`'s `ve`
 * and `BANK_PULL`'s `pullScore` already use.
 *
 * @param {object} args
 * @param {string} args.id
 * @param {number} args.n
 * @param {number} args.at
 * @param {string} args.label
 * @param {{peakHp: number, peakTq: number, points: object[], events: {type?: string}[]}} args.result
 * @param {{tuning: {score: number}, engineer: {score: number}}} args.scores
 * @param {number} args.pullScore
 * @param {{build: object, tune: object, loadKpa: number}} args.inputs
 * @returns {RunRecord}
 */
export function makeRunRecord({ id, n, at, label, result, scores, pullScore, inputs }) {
  return {
    id,
    n,
    at,
    label,
    peakHp: result.peakHp,
    peakTq: result.peakTq,
    knocks: result.events.filter((e) => e.type === 'knock').length,
    scores: { tuning: scores.tuning.score, engineer: scores.engineer.score, pull: pullScore },
    points: result.points.map((p) => ({ rpm: p.rpm, hp: p.hp, torque: p.torque })),
    inputs,
  };
}

/**
 * Adds a run to the front of the log, capped at {@link RUN_LIMIT}.
 *
 * Newest-first, so the run just banked is index 0 and eviction drops the TAIL — the
 * oldest run. Returns a new array; the input is never mutated.
 *
 * @param {RunRecord[]} runs
 * @param {RunRecord} record
 * @returns {RunRecord[]}
 */
export function pushRun(runs, record) {
  return [record, ...runs].slice(0, RUN_LIMIT);
}

/**
 * The run the ghost curve should draw.
 *
 * A pin wins when the run it names is still in the log. When it is not — the pinned
 * run has aged out past {@link RUN_LIMIT} — this falls back to the previous run rather
 * than returning nothing, because a pin quietly expiring should not also take the
 * default comparison with it.
 *
 * `runs[1]`, not `runs[0]`: index 0 is the pull just banked, which is the same pull
 * the chart is drawing live.
 *
 * Pinning `runs[0]` is legitimate and deliberately not special-cased — "make this my
 * benchmark, now go tune" is the main reason to pin at all, and from the next pull
 * onward that run is no longer index 0.
 *
 * @param {RunRecord[]} runs
 * @param {string|null} pinnedRunId
 * @returns {RunRecord|null}
 */
export function ghostRun(runs, pinnedRunId) {
  if (pinnedRunId != null) {
    const pinned = runs.find((r) => r.id === pinnedRunId);
    if (pinned) return pinned;
  }
  return runs[1] ?? null;
}

/**
 * What the chart legend calls the ghost series.
 *
 * This lives here rather than as an expression at the JSX call site so that both of
 * its branches can be watched failing. It has two: a pinned run is named, and anything
 * else is "Prev". The distinction is load-bearing — a chart that labelled the default
 * comparison as a pin would tell the player they had chosen a benchmark they had not.
 *
 * Takes the already-resolved run rather than the list, so it cannot disagree with
 * {@link ghostRun} about which run is being drawn: when the pin names an evicted run,
 * `ghostRun` falls back to the previous run and this labels it "Prev", because that is
 * what it now is.
 *
 * @param {RunRecord|null} run the run {@link ghostRun} resolved
 * @param {string|null} pinnedRunId
 * @returns {string|null} null when there is no ghost to draw
 */
export function ghostLabel(run, pinnedRunId) {
  if (!run) return null;
  return pinnedRunId != null && run.id === pinnedRunId ? `Run ${run.n}` : 'Prev';
}

/**
 * SVG path data for a timeline row's power sparkline, scaled to fill the box.
 *
 * Pure and DOM-free so the geometry is unit-testable. A flat curve has no range to
 * scale against, so the span floors at 1 and the line renders along the bottom edge
 * rather than as `NaN`, which would draw nothing and report nothing.
 *
 * @param {RunPoint[]} points
 * @param {number} width
 * @param {number} height
 * @returns {string} path data, or '' when there is nothing to draw
 */
export function sparklinePath(points, width, height) {
  if (!points || points.length === 0) return '';
  const hps = points.map((p) => p.hp);
  const min = Math.min(...hps);
  const span = Math.max(...hps) - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  return points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.hp - min) / span) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}
