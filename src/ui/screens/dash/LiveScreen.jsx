/**
 * HOME > Live Engine.
 *
 * The engine running in real time: tach, ECU state, sensor gauges and fuel trims.
 *
 * THIS IS THE 20 Hz SCREEN. `session.live` is rewritten twenty times a second by the
 * LIVE_STEP action, and every one of those writes re-renders this component. That is
 * the point of it being its own file: nothing that reads `live` is allowed to move up
 * into a parent that also renders the other three HOME sections, or all four would
 * re-render at 20 Hz to redraw three panels that did not change. The accordion
 * header's own subtitle counts — it shows live RPM — which is why this screen owns
 * its `BuildSection` rather than being handed one as children.
 */

import { Activity } from 'lucide-react';
import React from 'react';

import { clamp } from '../../../sim/index.js';
import { BuildSection } from '../../components/BuildSection.jsx';
import { Button } from '../../primitives/Button.jsx';
import { DialMark } from '../../components/DialMark.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useSession } from '../../state/StoreProvider.jsx';
import { T } from '../../theme.js';

import styles from './LiveScreen.module.css';

/**
 * One sensor readout. Local to this screen: the live panel is the only place in the
 * app that shows a raw, noisy, lagged sensor value rather than a computed figure.
 *
 * `color` is the caller's, because it says which QUANTITY this is — airflow is the
 * chart's cyan, lambda its violet — so it stays an inline value rather than a class.
 * `warn` is a state, so it is a data attribute the stylesheet reads.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string|number} props.value
 * @param {string} props.unit
 * @param {string} [props.color]
 * @param {boolean} [props.warn] the reading is outside its safe range
 * @returns {React.ReactElement}
 */
function LiveGauge({ label, value, unit, color = T.ink, warn }) {
  return (
    <div className={styles.gauge} data-warn={warn ? 'true' : 'false'}>
      <div className={styles.gaugeLabel}>{label}</div>
      <div className={styles.gaugeValue} style={{ color: warn ? T.danger : color }}>
        {value}<span className={styles.gaugeUnit}>{unit}</span>
      </div>
    </div>
  );
}

/**
 * A fuel trim, drawn as a deviation either side of centre.
 *
 * Not `Bar`: a trim is signed and its zero is the middle of the track, where Bar
 * measures a 0..max quantity from the left edge.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number} props.value percent, positive means the ECU is adding fuel
 * @returns {React.ReactElement}
 */
function TrimBar({ label, value }) {
  const pct = clamp((value + 25) / 50, 0, 1) * 100;
  const c = Math.abs(value) > 15 ? T.danger : Math.abs(value) > 8 ? T.warn : T.ok;
  return (
    <div className={styles.trim}>
      <div className={styles.trimHead}>
        <span>{label}</span><span className={styles.trimValue} style={{ color: c }}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>
      </div>
      <div className={styles.trimTrack}>
        <div className={styles.trimCentre} />
        <div className={styles.trimFill} style={{ left: `${Math.min(50, pct)}%`, width: `${Math.abs(pct - 50)}%`, background: c }} />
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.active whether this is HOME's open section
 * @param {(section: string) => void} props.onToggle opens or closes a HOME section
 * @param {number} props.tachFullScaleRpm redline plus the limiter's overshoot
 *   headroom. Derived from `engineConfig` in the shell because the dyno tach needs
 *   the same number — see the note on `tachFullScaleRpm` in EcuLab.jsx.
 * @param {() => void} props.onStart
 * @param {() => void} props.onStop
 * @param {() => void} props.onToggleSound
 * @param {() => void} props.onTestSound plays one note through the engine's own graph
 * @param {(percent: number) => void} props.onThrottle driver throttle input, 0 or 100
 * @returns {React.ReactElement}
 */
export function LiveScreen({ active, onToggle, tachFullScaleRpm, onStart, onStop, onToggleSound, onTestSound, onThrottle }) {
  const [session, dispatch] = useSession();
  const { soundOn, throttleInput, volume, audioStatus } = session;
  // `SessionState.live` is typed `object` because the live model it holds is built in
  // src/sim/live.js, which has no typedef to point at and which this PR may not touch.
  // One cast here, named and explained, rather than a suppression on each of the
  // thirty reads below.
  const live = /** @type {Record<string, any>} */ (session.live);

  return (
    <BuildSection
      active={active} onClick={() => onToggle('live')}
      icon={Activity} label="Live Engine"
      sub={live.running ? `Running · ${Math.round(live.sensedRpm)} RPM · ${Math.round(live.coolantC)}°C` : live.cranking ? 'Cranking…' : 'Off'}
    >
      <Panel style={{ background: T.panel, marginBottom: 10 }}>
        <div className={styles.head}>
          <div className={styles.dial}>
            <DialMark size={104} pct={clamp(live.sensedRpm / tachFullScaleRpm, 0, 1)} live />
            <div className={styles.dialReadout}>
              <div className={styles.dialRpm} style={{ color: live.fuelCut ? T.danger : T.ink }}>{Math.round(live.sensedRpm)}</div>
              <div className={styles.dialCaption}>RPM</div>
            </div>
          </div>
          <div className={styles.column}>
            <div className={styles.status}>
              {live.running
                ? (live.limiterCut ? 'Rev limiter — fuel cut to protect the engine.'
                  : live.dfco ? 'Overrun fuel cut — injectors off while coasting down. Real ECUs do this; it costs nothing to spin.'
                  : live.coolantC < 70 ? 'Warming up — the ECU is running extra fuel until it reaches temperature.'
                  : live.closedLoop ? 'Warm and in closed loop — the ECU is trimming fuel against the O2 sensor.'
                  : 'Open loop — the ECU is following your tables directly, ignoring O2 feedback.')
                : live.cranking ? 'Starter engaged…' : 'Engine off. Start it to watch the ECU work in real time.'}
            </div>
            <div className={styles.actions}>
              {/* START was filled with `ok`. Green here is decoration, not
                  state — the engine is not running when the button says
                  START — and spending a status colour on an action is the
                  rule Toggle's docstring closed. It takes the accent; STOP
                  is the secondary state and takes `ghost`. Not `danger`:
                  shutting an engine down destroys nothing. */}
              <Button
                variant={live.running || live.cranking ? 'ghost' : 'primary'}
                style={{ flex: 1 }}
                onClick={live.running || live.cranking ? onStop : onStart}
              >{live.running || live.cranking ? 'STOP' : 'START ENGINE'}</Button>
              {/* Plays one note through the same graph the engine uses, so a player
                  whose browser has blocked audio finds out here rather than by
                  wondering why a running engine is silent. `ghost` for the same
                  reason STOP is: it is a secondary action. */}
              <Button variant="ghost" title="Test sound" onClick={onTestSound}>TEST</Button>
              <button
                className={styles.sound}
                data-on={soundOn ? 'true' : 'false'}
                title="Engine sound"
                onClick={onToggleSound}
              >{soundOn ? '♪' : '✕'}</button>
            </div>
          </div>
        </div>

        <div
          className={styles.pad}
          data-open={throttleInput > 0 ? 'true' : 'false'}
          data-running={live.running ? 'true' : 'false'}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); onThrottle(100); }}
          onPointerUp={() => onThrottle(0)}
          onPointerCancel={() => onThrottle(0)}
        >
          <div className={styles.padFill} style={{ width: `${clamp(live.effThrottle ?? 0, 0, 100)}%` }} />
          <span className={styles.padLabel}>
            {!live.running ? 'START THE ENGINE FIRST' : throttleInput > 0 ? 'WIDE OPEN THROTTLE' : 'PRESS AND HOLD TO REV'}
          </span>
        </div>

        {/* An engine is the loudest thing in the app and the one a player is most
            likely to want turned down without turning off. It writes the same session
            field the waveguide's output trim reads. */}
        <div className={styles.volume}>
          <span className={styles.volumeLabel}>VOL</span>
          <input
            type="range" min={0} max={2} step={0.05} value={volume}
            onChange={(e) => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'volume', value: Number(e.target.value) })}
            aria-label="Engine volume"
            className={styles.volumeSlider}
          />
          <span className={styles.volumeValue}>{Math.round(volume * 100)}%</span>
        </div>

        {audioStatus && (
          <div className={styles.audioStatus} data-ok={audioStatus === 'ok' ? 'true' : 'false'}>
            {audioStatus === 'ok'
              ? 'Audio is running. If you heard the test beep but not the engine, start it and hold the throttle.'
              : audioStatus === 'blocked'
                ? 'The browser is still blocking audio — tap START, or any tab, then try TEST again.'
                : 'This browser did not provide Web Audio, so engine sound is unavailable.'}
            <br />On iPhone the physical ring/silent switch mutes web audio even at full volume.
          </div>
        )}

        <div className={`${styles.gaugeRow} ${styles.gaugeRowFirst}`}>
          <LiveGauge label="MAF" value={live.sensedMaf.toFixed(1)} unit="g/s" color={T.cyan} />
          <LiveGauge label="MAP" value={Math.round(live.sensedMap)} unit="kPa" />
          <LiveGauge label="IAT" value={Math.round(live.sensedIat)} unit="°C" warn={live.sensedIat > 65} />
        </div>
        <div className={styles.gaugeRow}>
          <LiveGauge label="LAMBDA" value={live.sensedLambda.toFixed(2)} unit="λ" color={T.violet} />
          <LiveGauge label="COOLANT" value={Math.round(live.sensedCoolant)} unit="°C" warn={live.sensedCoolant > 105} />
          <LiveGauge label="TIMING" value={live.live ? live.live.timing : '—'} unit="°" warn={!!(live.live && live.live.knock)} />
        </div>
        <div className={styles.gaugeRow}>
          <LiveGauge label="INJ PW" value={live.live ? live.live.pw : '—'} unit="ms" />
          <LiveGauge label="DUTY" value={live.live ? live.live.duty : '—'} unit="%" warn={!!(live.live && live.live.duty > 90)} />
          <LiveGauge label="IDLE AIR" value={Math.round(live.idleTrim)} unit="%" />
          <LiveGauge label="FUEL" value={live.fuelCut ? 'CUT' : 'ON'} unit="" color={live.fuelCut ? T.warn : T.ok} />
        </div>

        <div className={styles.trims}>
          <TrimBar label="SHORT TERM FUEL TRIM (STFT)" value={live.stft} />
          <TrimBar label="LONG TERM FUEL TRIM (LTFT)" value={live.ltft} />
        </div>
      </Panel>
      <ExpandableInfo title="Why these gauges jitter">
        Every value above is a simulated sensor reading, with real noise and lag — not the exact internal number. That is what a tuner actually sees on a scan tool, and why real logs never look perfectly smooth.
      </ExpandableInfo>
    </BuildSection>
  );
}
