/**
 * DYNO > HISTORY (the run log).
 *
 * Every pull the career has banked, newest first, with what changed since the one
 * before it and a control to pin any of them as the chart's comparison.
 *
 * `runs` is plain session state and this screen is its only list reader, so it comes
 * off the store rather than down as a prop — the same call LogScreen makes for
 * `result`.
 *
 * The "what changed" line compares the two runs' stored `inputs` through
 * `diffMeasuredInputs`, which derives its field list from the same private array the
 * pull signature is built from. That is the whole reason the diff lives in
 * pullSignature.js: a new simulation input is signed and reported in one edit.
 */

import React, { useMemo } from 'react';

import { History, Pin } from 'lucide-react';

import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { diffMeasuredInputs } from '../../state/pullSignature.js';
import { ACTIONS } from '../../state/reducer.js';
import { sparklinePath } from '../../state/runLog.js';
import { useRoadTest, useSession } from '../../state/StoreProvider.jsx';

import styles from './HistoryScreen.module.css';

/** Sparkline box, in the same user units the CSS sizes it in. */
const SPARK_W = 84;
const SPARK_H = 22;

/**
 * "4m ago", "2h ago", "just now" — coarse on purpose. A run log is read for order and
 * recency, not for timestamps.
 * @param {number} at epoch ms
 * @param {number} now epoch ms
 * @returns {string}
 */
function relativeTime(at, now) {
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * @returns {React.ReactElement}
 */
export function HistoryScreen() {
  const [session, dispatch] = useSession();
  const { runs, pinnedRunId } = session;

  // `diffMeasuredInputs` runs ~32 `JSON.stringify` calls per row and `sparklinePath`
  // walks up to 61 points; both ran on every render, unmemoized, over up to 20 rows.
  // The store is a single context and `LIVE_STEP` dispatches into it at 20 Hz, so
  // with the engine running and HISTORY open that was ~640 `JSON.stringify` calls a
  // second for numbers that had not changed. `now` is captured in here too — reading
  // `Date.now()` in the render body made the component impure for no reason a memo
  // keyed on the same two inputs doesn't already fix.
  const roadTest = useRoadTest();
  const rows = useMemo(() => {
    const now = Date.now();
    return runs.map((run, i) => {
      const prev = runs[i + 1];
      const dHp = prev ? run.peakHp - prev.peakHp : 0;
      const tone = roadTest || !prev || dHp === 0 ? 'flat' : dHp > 0 ? 'up' : 'down';
      const changed = prev ? diffMeasuredInputs(prev.inputs, run.inputs) : [];
      const pinned = run.id === pinnedRunId;
      // `prev` is undefined for every row with nothing older still in the log, not
      // only the career's actual first pull — once the log caps at RUN_LIMIT, the
      // oldest VISIBLE row has no `prev` either, at whatever `n` it happens to be.
      // "first pull" is keyed on `run.n === 1` so only the real first pull claims it.
      const deltaText = prev
        ? (roadTest ? `after Run ${prev.n}` : `${dHp > 0 ? '+' : ''}${Math.round(dHp)} whp vs Run ${prev.n}`)
        : (run.n === 1 ? 'first pull' : '');
      return {
        run, prev, tone, changed, pinned, deltaText,
        when: relativeTime(run.at, now),
        spark: sparklinePath(run.points, SPARK_W, SPARK_H),
      };
    });
  }, [runs, pinnedRunId, roadTest]);

  if (runs.length === 0) {
    return (
      <>
        <Eyebrow icon={History}>Run History</Eyebrow>
        <div className={styles.empty}>
          No pulls yet. Run a dyno pull and it lands here, with every pull after it.
        </div>
      </>
    );
  }

  return (
    <>
      <Eyebrow icon={History}>Run History</Eyebrow>
      <ul className={styles.list}>
        {rows.map(({ run, prev, tone, changed, pinned, deltaText, when, spark }) => (
          <li key={run.id} className={styles.row} data-pinned={pinned}>
            <div>
              <div className={styles.ordinal}>Run {run.n}</div>
              <div className={styles.when}>{when}</div>
              <div className={styles.label}>{run.label}</div>
            </div>
            <svg className={styles.spark} data-hidden={roadTest ? 'true' : undefined} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true">
              <path className={styles.sparkLine} d={spark} />
            </svg>
            <div>
              <div className={styles.peaks}>{roadTest ? 'Road test' : `${Math.round(run.peakHp)} whp · ${Math.round(run.peakTq)} lb-ft`}</div>
              <div className={styles.delta} data-tone={tone}>
                {deltaText}
                {run.knocks > 0 && <span className={styles.knocks}> · {run.knocks} knock{run.knocks === 1 ? '' : 's'}</span>}
              </div>
            </div>
            <button
              type="button"
              className={styles.pin}
              data-on={pinned}
              aria-label={pinned ? `Unpin run ${run.n}` : `Pin run ${run.n} as the comparison`}
              onClick={() => dispatch(pinned ? { type: ACTIONS.UNPIN_RUN } : { type: ACTIONS.PIN_RUN, id: run.id })}
            >
              <Pin size={12} />
            </button>
            {changed.length > 0 && (
              <div className={styles.changed}>Changed since Run {prev.n}: {changed.join(', ')}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
