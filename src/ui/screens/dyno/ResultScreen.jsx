/**
 * DYNO > CURVES (power/torque and AFR/timing traces for the last pull).
 *
 * This is the one DYNO section that also renders WHILE a pull is running — the
 * shell gates it on `running || dynoView === 'result'`, not just the section id,
 * so the player watches the sweep draw live rather than staring at a switcher.
 * That gate lives in EcuLab.jsx, not here: this component only ever renders when
 * it should be visible.
 *
 * `chartData` is the shell's — EcuScreen's own FUEL TRIM chart reads the same
 * memo, so it stays a shell-level computation rather than being repeated per
 * screen. `engineDerived` is the shell's for the same reason (the header's engine
 * label, the audio effect and BUILD's Engine Architecture screen all read it
 * too); `dynoChartMaxRpm` itself has exactly one reader — this screen's two chart
 * axes — so it is computed here off the `engineDerived` prop rather than
 * threaded down as its own value.
 *
 * The ghost lines take each live series' own colour at half opacity rather than a
 * neutral grey. `T.ink3` — what they used to use — is also the axis, tick-label and
 * `afrCommanded` colour, so the previous pull was not too dim to see so much as
 * indistinguishable from the chart's furniture. Hue now carries series identity and
 * opacity carries time.
 */

import React from 'react';

import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { resolveBandRpm } from '../../components/eventBands.js';
import { Panel } from '../../primitives/Panel.jsx';
import { T } from '../../theme.js';

import styles from './ResultScreen.module.css';

/**
 * One event band. Rendered through `ReferenceArea`'s `shape` so it can carry the
 * focus and ARIA attributes a bare rect cannot.
 *
 * The rect is pointer-transparent on purpose: a click is answered by the chart, from
 * the RPM under the pointer, so where several bands overlap it does not matter which
 * one is uppermost. Keyboard activation has no pointer to read, so it uses the band's
 * own midpoint — by definition inside its span. That transparency is declared here as
 * a presentation attribute (`pointerEvents="none"`), not only in the stylesheet:
 * Vitest applies no CSS, so a CSS-only rule cannot be asserted in a test and every
 * click test would keep passing even if the rule were deleted from the stylesheet.
 * The CSS copy stays too, belt-and-braces, but this attribute is the one that makes
 * the guarantee testable.
 *
 * `onClick` matters for a reason `onKeyDown` alone does not cover: screen readers in
 * browse mode (NVDA, JAWS, VoiceOver) activate a `role="button"` element by
 * dispatching a click, not a keydown. `pointer-events: none` means a real pointer
 * click never reaches this rect — only a programmatic or assistive-technology-
 * dispatched one does — so wiring `onClick` here cannot double-fire with the chart's
 * own click handler.
 *
 * @param {{band: import('../../components/eventBands.js').EventBand,
 *   onSelectRpm: (rpm: number) => void, x?: number, y?: number,
 *   width?: number, height?: number, focusable?: boolean}} props
 * @returns {React.ReactElement}
 */
function Band({ band, onSelectRpm, x, y, width, height, focusable = true }) {
  // `ReferenceArea.render` returns null only when neither `rect` nor `shape` is
  // present; with a `shape` given, a `getRect` that comes back null still reaches
  // here with x/y/width/height all undefined. Rendering that would be a phantom
  // focusable button sitting at the origin.
  if (width == null) return null;
  const activate = () => onSelectRpm(Math.round((band.rpmStart + band.rpmEnd) / 2));
  // A single-point event (rpmStart === rpmEnd) is a real, zero-width span — true to
  // the data — but a zero-width rect is nothing for a sighted mouse user to aim at.
  // Widened here, at paint time only: `eventBands`' span is what the chart-click and
  // log-highlight matching use, and widening it there would make the log highlight
  // RPMs the player never actually clicked.
  const drawnWidth = Math.max(Number(width) || 0, 3);
  const single = band.rpmStart === band.rpmEnd;
  return (
    <rect
      x={x} y={y} width={drawnWidth} height={height}
      className={styles.band} data-tone={band.tone}
      fillOpacity={0.13} strokeOpacity={0.45}
      pointerEvents="none"
      tabIndex={focusable ? 0 : -1} role="button"
      aria-hidden={focusable ? undefined : 'true'}
      aria-label={single
        ? `${band.msg}, at ${band.rpmStart} RPM`
        : `${band.msg}, ${band.rpmStart} to ${band.rpmEnd} RPM`}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        activate();
      }}
    />
  );
}

/**
 * @param {object} props
 * @param {Array<object>} props.chartData the shell's, shared with TUNE's ECU screen
 * @param {{redline: number}} props.engineDerived the shell's — see file header
 * @param {string|null} [props.ghostLabel] what to call the comparison series in the
 *   legend, or null/undefined to draw no ghost at all — see `ghostLabel` in runLog.js
 * @param {import('../../components/eventBands.js').EventBand[]} [props.bands]
 * @param {number} [props.wholePullCount] how many findings have no RPM at all
 * @param {(rpm: number|null) => void} [props.onSelectRpm]
 * @returns {React.ReactElement}
 */
export function ResultScreen({ chartData, engineDerived, ghostLabel, bands = [], wholePullCount = 0, onSelectRpm = () => {} }) {
  // The live tach needle and this chart's RPM axis both used to top out at a
  // hardcoded 7500 — correct only for the one preset whose redline happened to
  // match it. 1.05x redline gives the sweep's last point a little headroom
  // without the axis running away for a low-redline build.
  const dynoChartMaxRpm = engineDerived.redline * 1.05;

  // Shared by both charts below — see `resolveBandRpm`'s own doc for why the decision
  // lives there rather than inline here, and why it resolves by RPM rather than by band.
  const handleChartClick = (state) => {
    const rpm = resolveBandRpm(state?.activeLabel, bands);
    if (rpm !== null) onSelectRpm(rpm);
  };

  return (
    <>
      <Panel tight className={styles.panel}>
        <div className={styles.chartLabel}>POWER &amp; TORQUE</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart
            data={chartData} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}
            onClick={handleChartClick}
          >
            <CartesianGrid stroke={T.line} />
            <XAxis dataKey="rpm" stroke={T.ink3} fontSize={10} type="number" domain={[1500, dynoChartMaxRpm]} />
            <YAxis stroke={T.ink3} fontSize={10} />
            <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {bands.map((b) => (
              <ReferenceArea
                key={b.id} x1={b.rpmStart} x2={b.rpmEnd}
                shape={(shapeProps) => <Band {...shapeProps} band={b} onSelectRpm={onSelectRpm} />}
              />
            ))}
            {ghostLabel && <Line dataKey="prevHp" name={`${ghostLabel} WHP`} stroke={T.acc} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.5} dot={false} isAnimationActive={false} />}
            {ghostLabel && <Line dataKey="prevTorque" name={`${ghostLabel} TQ`} stroke={T.cyan} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.5} dot={false} isAnimationActive={false} />}
            <Line dataKey="hp" name="WHP" stroke={T.acc} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="torque" name="Torque" stroke={T.cyan} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel tight className={styles.panel}>
        <div className={styles.chartLabel}>AFR (COMMANDED VS ACTUAL) / TIMING</div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart
            data={chartData} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}
            onClick={handleChartClick}
          >
            <CartesianGrid stroke={T.line} />
            <XAxis dataKey="rpm" stroke={T.ink3} fontSize={10} type="number" domain={[1500, dynoChartMaxRpm]} />
            <YAxis stroke={T.ink3} fontSize={10} />
            <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {bands.map((b) => (
              <ReferenceArea
                key={b.id} x1={b.rpmStart} x2={b.rpmEnd}
                // This chart's bands are the second copy of every event — see the
                // POWER & TORQUE chart above for the first. Both stay visible (the
                // overlap is the intended visual), but only one copy should be a tab
                // stop: two focusable nodes per event with identical accessible names
                // would double every announcement in the a11y tree.
                shape={(shapeProps) => <Band {...shapeProps} band={b} onSelectRpm={onSelectRpm} focusable={false} />}
              />
            ))}
            <Line dataKey="afrCommanded" name="AFR commanded" stroke={T.ink3} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            {/* Series identity colours, not status: both lines are on screen for
                every pull, so green and amber here reported a health this chart
                never measures. */}
            <Line dataKey="afr" name="AFR actual" stroke={T.cyan} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="timing" name="Timing used" stroke={T.violet} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      {wholePullCount > 0 && (
        <button type="button" className={styles.wholePull} onClick={() => onSelectRpm(null)}>
          {/* The verb agrees as well as the noun: pluralising only `finding` left
              the singular reading "1 finding apply to the whole pull". */}
          {wholePullCount === 1
            ? '1 finding applies to the whole pull — open the log'
            : `${wholePullCount} findings apply to the whole pull — open the log`}
        </button>
      )}
    </>
  );
}
