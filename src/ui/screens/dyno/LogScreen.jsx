/**
 * DYNO > PULL LOG (event list for the last pull).
 *
 * `result` is plain session state with one reader — this screen — so it is read
 * straight off the store rather than threaded down as a prop.
 */

import React, { useEffect, useRef } from 'react';

import { AlertTriangle } from 'lucide-react';

import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { useSession } from '../../state/StoreProvider.jsx';
import { coversRpm, eventTone } from '../../components/eventBands.js';

import styles from './LogScreen.module.css';

/**
 * @returns {React.ReactElement}
 */
export function LogScreen() {
  const [session] = useSession();
  const { result, logFocusRpm } = session;

  // The spec's own words: a chart-band click "highlights every event whose span covers
  // that RPM and scrolls the first into view." Landing on an off-screen highlight with
  // no scroll defeats the reason click-through exists — a bad tune can emit five or six
  // events, and the log is longer than the viewport well before that.
  const firstFocusedRef = useRef(null);
  useEffect(() => {
    if (logFocusRpm == null) return;
    firstFocusedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [logFocusRpm]);

  let firstFocusedSeen = false;

  return (
    <>
      <Eyebrow icon={AlertTriangle}>Pull Log</Eyebrow>
      {result.events.length === 0 ? (
        <div className={styles.clean}>
          Clean pull — no knock, fueling, or trim issues across the sweep.
        </div>
      ) : (
        <div className={styles.events}>
          {result.events.map((e, i) => {
            const tone = eventTone(e);
            const focused = coversRpm(e, logFocusRpm);
            let ref;
            if (focused && !firstFocusedSeen) {
              firstFocusedSeen = true;
              ref = firstFocusedRef;
            }
            return (
              <div
                key={i}
                ref={ref}
                className={styles.event}
                data-tone={tone}
                data-focused={String(focused)}
              >
                <div className={styles.eventHead}>
                  <div className={styles.eventTitle}>
                    <AlertTriangle size={14} className={styles.eventIcon} />
                    <span>{e.msg}</span>
                  </div>
                  {e.impact != null && <span className={styles.eventImpact}>-{e.impact}</span>}
                </div>
                {e.cause && <div className={styles.eventCause}><b className={styles.eventLabel}>Why: </b>{e.cause}</div>}
                {e.fix && <div className={styles.eventFix}><b className={styles.eventLabel}>Try: </b>{e.fix}</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
