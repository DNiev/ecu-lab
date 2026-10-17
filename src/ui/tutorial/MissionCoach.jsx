/**
 * The practice mission's checklist, pinned to the top of the game while it runs.
 *
 * It watches the store and the route and ticks steps off as the player does them (see
 * missions.js), shows a hint for the step they are on, and says what they achieved
 * when the last step is done. It changes nothing but its own progress.
 */

import { Check, ChevronDown, Trophy } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { Button } from '../primitives/Button.jsx';
import { ACTIONS } from '../state/reducer.js';
import { useBuild, useSession, useTune } from '../state/StoreProvider.jsx';

import { MISSIONS, advance } from './missions.js';
import styles from './MissionCoach.module.css';

/**
 * @param {object} props
 * @param {{tab: string|null, section: string|null}} props.route
 * @param {() => void} props.onCourse back to the Tuning Course, where missions start
 * @returns {React.ReactElement|null}
 */
export function MissionCoach({ route, onCourse }) {
  const [session, dispatch] = useSession();
  const [build] = useBuild();
  const [tune] = useTune();
  const [open, setOpen] = useState(true);
  const progress = session.mission;
  const mission = progress ? MISSIONS.find((m) => m.id === progress.id) : null;

  useEffect(() => {
    if (!progress || !mission) return;
    const next = advance(mission, progress, { build, tune, session }, route);
    if (next !== progress) dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'mission', value: next });
  }, [progress, mission, build, tune, session, route, dispatch]);

  if (!progress || !mission) return null;
  const finished = progress.step >= mission.steps.length;
  const stop = () => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'mission', value: null });
  const current = mission.steps[progress.step];

  return (
    <section className={styles.coach} aria-label="Practice mission" data-finished={finished ? 'true' : 'false'}>
      <button type="button" className={styles.head} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={styles.tag}>PRACTICE</span>
        <span className={styles.title}>{mission.title}</span>
        <span className={styles.count}>{Math.min(progress.step, mission.steps.length)}/{mission.steps.length}</span>
        <ChevronDown size={15} aria-hidden="true" className={styles.chevron} />
      </button>
      {!open && !finished && <div className={styles.now}>{current.text}</div>}
      {open && (
        <div className={styles.body}>
          {finished ? (
            <div className={styles.done} role="status">
              <Trophy size={18} aria-hidden="true" />
              <span>{mission.done({ build, tune, session })}</span>
            </div>
          ) : (
            <ol className={styles.steps}>
              {mission.steps.map((s, i) => (
                <li key={s.text} data-state={i < progress.step ? 'done' : i === progress.step ? 'now' : 'todo'}>
                  <span className={styles.mark} aria-hidden="true">{i < progress.step ? <Check size={12} /> : i + 1}</span>
                  <span>
                    {s.text}
                    {i < progress.step && <span className={styles.srOnly}> (done)</span>}
                    {i === progress.step && s.hint && <span className={styles.hint}>{s.hint}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className={styles.actions}>
            <Button size="sm" variant="ghost" onClick={onCourse}>BACK TO THE COURSE</Button>
            <Button size="sm" variant="quiet" onClick={stop}>{finished ? 'CLOSE' : 'STOP PRACTICE'}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
