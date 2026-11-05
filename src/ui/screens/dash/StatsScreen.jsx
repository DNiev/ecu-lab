/**
 * HOME > Sandbox Stats & Last Pull.
 *
 * Career totals, and the headline figures from the most recent dyno pull. Nothing
 * here is computed: `scores` is the shell's, because the DYNO tab's score panel reads
 * the same object and computing it twice would be two answers to one question. They
 * are what that pull MEASURED, banked at pull time and never re-graded — so when the
 * setup moves underneath them the tiles are LABELLED and dimmed rather than updated or
 * cleared. Deleting them would take away the before half of the comparison the player
 * changed something to make.
 */

import { Trophy } from 'lucide-react';
import React from 'react';

import { BuildSection } from '../../components/BuildSection.jsx';
import { Note } from '../../primitives/Note.jsx';
import { StatTile } from '../../primitives/StatTile.jsx';
import { useSession } from '../../state/StoreProvider.jsx';
import { statusTone } from '../../theme.js';

import styles from './StatsScreen.module.css';

/**
 * @typedef {object} Scores
 * @property {number} pull
 * @property {{score: number}} tuning
 * @property {{score: number}} engineer
 */

/**
 * @param {object} props
 * @param {boolean} props.active whether this is HOME's open section
 * @param {(section: string) => void} props.onToggle opens or closes a HOME section
 * @param {Scores|null} props.scores null until a pull has finished
 * @param {boolean} [props.scoresStale] the setup has changed since that pull was run
 * @returns {React.ReactElement}
 */
export function StatsScreen({ active, onToggle, scores, scoresStale = false }) {
  const [session] = useSession();
  const { bestScore, totalScore, pullCount } = session;
  // `SessionState.result` is typed `object` — see the note on the same cast in
  // LiveScreen.jsx.
  const result = /** @type {Record<string, any>|null} */ (session.result);

  return (
    <BuildSection
      active={active} onClick={() => onToggle('stats')}
      icon={Trophy} label="Sandbox Stats & Last Pull"
      sub={result ? `Best ${bestScore} · ${pullCount} pulls logged` : `${pullCount} pulls logged`}
    >
      <div className={`${styles.row} ${styles.rowGapWide}`}>
        <StatTile label="BEST PULL" value={bestScore} tone="acc" />
        <StatTile label="TOTAL SCORE" value={totalScore} tone="alt" />
        <StatTile label="PULLS" value={pullCount} />
      </div>
      {result && scores ? (
        <>
          <div className={styles.lastPull} data-stale={scoresStale ? 'true' : 'false'}>
            {scoresStale ? 'LAST PULL · SETUP HAS CHANGED SINCE' : 'LAST PULL'}
          </div>
          <div className={`${styles.row} ${styles.rowGap}`} data-stale={scoresStale ? 'true' : 'false'}>
            <StatTile label="PEAK POWER" value={result.peakHp} unit="whp" tone="acc" />
            <StatTile label="PEAK TORQUE" value={result.peakTq} unit="lb-ft" tone="alt" />
          </div>
          <div className={styles.row} data-stale={scoresStale ? 'true' : 'false'}>
            <StatTile label="PULL SCORE" value={scores.pull} tone="acc" />
            <StatTile label="TUNING" value={scores.tuning.score} tone={statusTone(scores.tuning.score)} />
            <StatTile label="ENGINEER" value={scores.engineer.score} tone={statusTone(scores.engineer.score)} />
          </div>
        </>
      ) : <Note>No dyno pull logged yet — head to DYNO and run one.</Note>}
    </BuildSection>
  );
}
