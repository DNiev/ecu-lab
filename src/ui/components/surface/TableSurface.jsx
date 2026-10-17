/**
 * The 3-D view of a table, with a pull replayed across it.
 *
 * The pull is the full-throttle dyno pull the app already solves for the tuning advisor
 * (EcuLab.jsx `advisorPull`): this engine, this ECU, this tune, the same physics as the
 * DYNO tab. It reaches here through `PullTraceContext`, so nothing is re-simulated to
 * draw it. Each point is placed on the table at the values the ECU reads (the sensed
 * MAP and intake temperature where the ECU uses sensors), and the readout shows what
 * the table gives there: the blend of the four nearest cells, as the ECU reads it.
 *
 * A pull only moves some axes. A table on throttle, coolant or battery voltage has no
 * path across it in a dyno pull, and the view says so instead of drawing one.
 */

import React from 'react';

import { Surface3D, readSurface } from './Surface3D.jsx';
import styles from './surface.module.css';

/** The last full-throttle pull's points, or null. Provided by EcuLab. */
export const PullTraceContext = React.createContext(/** @type {object[]|null} */ (null));

/** Where a pull point records each live variable the ECU reads a table on. */
export const PULL_FIELD = Object.freeze({
  rpm: (p) => p.rpm,
  map: (p) => p.sensedMap ?? p.map,
  // Air per cylinder, for a layout that reads spark by it (sim/layouts.js).
  airG: (p) => p.airCharge,
  airMg: (p) => (p.airCharge == null ? null : p.airCharge * 1000),
  iat: (p) => p.sensedIat ?? p.iat,
  maf: (p) => p.maf,
  camIn: (p) => p.camIn,
  boostTarget: (p) => p.boostTarget,
});

/** One preference for every table on the page: open one in 3-D and the next opens in 3-D. */
let preferred = /** @type {'table'|'3d'} */ ('table');

/** @returns {['table'|'3d', (m: 'table'|'3d') => void]} */
export function useTableView() {
  const [mode, setMode] = React.useState(preferred);
  return [mode, (m) => { preferred = m; setMode(m); }];
}

/** @param {{mode: 'table'|'3d', onChange: (m: 'table'|'3d') => void}} props */
export function ViewToggle({ mode, onChange }) {
  return (
    <div className={styles.toggle} role="group" aria-label="Show as">
      <button type="button" aria-pressed={mode === 'table'} onClick={() => onChange('table')}>Table</button>
      <button type="button" aria-pressed={mode === '3d'} onClick={() => onChange('3d')}>3-D</button>
    </div>
  );
}

/**
 * @param {object} props
 * @param {number[]} props.x ascending
 * @param {number[]} props.y ascending
 * @param {number[][]} props.z z[row][col]
 * @param {number} props.lo
 * @param {number} props.hi
 * @param {string} props.xLabel
 * @param {string} props.yLabel
 * @param {string} [props.unit]
 * @param {number} [props.decimals]
 * @param {string} props.title
 * @param {string|null} props.xVar live variable on the x axis (`PULL_FIELD` key), if any
 * @param {string|null} props.yVar live variable on the y axis, if any
 * @param {{x: number, y: number}|null} [props.marker] the running engine's point, in LIVE
 * @param {{label: string, read: (p: object) => number}} [props.commanded] what the ECU
 *   finally commanded at each pull point, after its corrections, when the pull records it
 */
export function TableSurface({ x, y, z, lo, hi, xLabel, yLabel, unit = '', decimals = 0, title, xVar, yVar, marker = null, commanded }) {
  const pull = React.useContext(PullTraceContext);
  const fx = xVar ? PULL_FIELD[xVar] : null;
  const fy = yVar ? PULL_FIELD[yVar] : null;
  const trace = React.useMemo(() => {
    if (!pull || !fx || !fy) return null;
    const pts = pull.map((p) => ({ x: fx(p), y: fy(p), p })).filter((t) => Number.isFinite(t.x) && Number.isFinite(t.y));
    return pts.length > 1 ? pts : null;
  }, [pull, fx, fy]);
  const [idx, setIdx] = React.useState(-1);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    if (!playing || !trace) return undefined;
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= trace.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 80);
    return () => clearInterval(id);
  }, [playing, trace]);
  React.useEffect(() => { setIdx(-1); setPlaying(false); }, [trace]);

  const cur = trace && idx >= 0 ? trace[Math.min(idx, trace.length - 1)] : null;
  const fmt = (v) => Number(v).toFixed(decimals);
  const start = () => { setIdx(0); setPlaying(true); };

  return (
    <div className={styles.wrap}>
      <Surface3D x={x} y={y} z={z} lo={lo} hi={hi} xLabel={xLabel} yLabel={yLabel} unit={unit} decimals={decimals}
        title={title} trace={trace} traceIndex={idx} point={cur ? null : marker} />
      {trace ? (
        <div className={styles.player}>
          <div className={styles.controls}>
            <button type="button" className={styles.play} onClick={() => (playing ? setPlaying(false) : idx < 0 || idx >= trace.length - 1 ? start() : setPlaying(true))}>
              {playing ? 'Pause' : idx < 0 ? 'Simulate a pull' : idx >= trace.length - 1 ? 'Run it again' : 'Resume'}
            </button>
            <input type="range" min={0} max={trace.length - 1} value={Math.max(0, idx)} aria-label="Point in the pull"
              className={styles.scrub} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
          </div>
          {cur ? (
            <dl className={styles.read}>
              <div><dt>{xLabel}</dt><dd>{Math.round(cur.x)}</dd></div>
              <div><dt>{yLabel}</dt><dd>{Math.round(cur.y * 10) / 10}</dd></div>
              <div className={styles.key}><dt>This table gives</dt><dd>{fmt(readSurface(x, y, z, cur.x, cur.y))} {unit}</dd></div>
              {commanded && Number.isFinite(commanded.read(cur.p)) && (
                <div><dt>{commanded.label}</dt><dd>{fmt(commanded.read(cur.p))} {unit}</dd></div>
              )}
            </dl>
          ) : (
            <p className={styles.note}>
              Plays a full-throttle dyno pull of this engine on the current tune, the same physics as the DYNO tab, and shows where it reads this table at each moment.
            </p>
          )}
          {cur && (
            <p className={styles.note}>
              Between breakpoints the ECU blends the four nearest cells; the dot sits on that blend.
              {commanded ? ' The final command also includes the ECU\'s corrections, which is why it can differ from the table.' : ''}
            </p>
          )}
        </div>
      ) : (
        <p className={styles.note}>
          {pull
            ? `A dyno pull holds ${!fx ? xLabel : yLabel} steady, so it draws no path across this table. In LIVE, the dot shows where the running engine reads it.`
            : 'Change the build or tune and a pull is solved for this view.'}
        </p>
      )}
    </div>
  );
}
