/**
 * DYNO > PULL LOG (event list for the last pull).
 *
 * `result` is plain session state with one reader — this screen — so it is read
 * straight off the store rather than threaded down as a prop.
 */

import React from 'react';

import { AlertTriangle } from 'lucide-react';

import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { useSession } from '../../state/StoreProvider.jsx';
import { eventTone } from '../../components/eventBands.js';

import styles from './LogScreen.module.css';

/**
 * @returns {React.ReactElement}
 */
export function LogScreen() {
  const [session] = useSession();
  const { result, logFocusRpm } = session;

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
            return (
              <div
                key={i}
                className={styles.event}
                data-tone={tone}
                data-focused={String(
                  logFocusRpm != null
                  && typeof e.rpmStart === 'number'
                  && logFocusRpm >= e.rpmStart
                  && logFocusRpm <= e.rpmEnd,
                )}
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
