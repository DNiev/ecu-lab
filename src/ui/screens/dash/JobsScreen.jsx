/**
 * HOME > Customer Cars.
 *
 * The career board: every job is a car that arrived with one real fault, and the fault
 * is always something the simulation genuinely models. Nothing is scripted — a job is
 * solved by running a pull and reading what the log actually says, which is why the
 * brief describes the symptom and never the cause.
 *
 * The jobs themselves are data, in `src/ui/career.js`. Taking one is a single TAKE_JOB
 * action, because a half-applied job is a car with the customer's fault fitted and the
 * last job's tables still loaded — see reducer.js.
 */

import { Wrench } from 'lucide-react';
import React from 'react';

import { CAREER_JOBS } from '../../career.js';
import { BuildSection } from '../../components/BuildSection.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { useSession } from '../../state/StoreProvider.jsx';
import { T } from '../../theme.js';

/**
 * @param {object} props
 * @param {boolean} props.active whether this is HOME's open section
 * @param {(section: string) => void} props.onToggle opens or closes a HOME section
 * @param {(index: number) => void} props.onTakeJob fits the customer's car and clears
 *   the bench. The shell's, because it needs `computeHardwareVE` fed the hardware the
 *   job describes, which is not this screen's to know.
 * @param {() => void} props.onAbandon puts the active job down without grading it
 * @returns {React.ReactElement}
 */
export function JobsScreen({ active, onToggle, onTakeJob, onAbandon }) {
  const [session] = useSession();
  const { activeJob, completedJobs } = session;

  return (
      <BuildSection
        active={active} onClick={() => onToggle('jobs')}
        icon={Wrench} label="Customer Cars"
        sub={`${completedJobs.length}/${CAREER_JOBS.length} completed`}
      >
        <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.55, marginBottom: 10 }}>
          Each car comes in with one real fault. Nothing is scripted — take a job, run a
          pull, and read the log. The cause is always something the simulation genuinely
          models, and the tables are what fix it.
        </div>

        {activeJob != null && (
          <Panel style={{ marginBottom: 12, borderColor: T.acc }}>
            <div style={{ fontSize: 10, letterSpacing: 1, color: T.accInk, fontWeight: 800 }}>CURRENT JOB</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 3 }}>{CAREER_JOBS[activeJob].title}</div>
            <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.55, marginTop: 7 }}>{CAREER_JOBS[activeJob].brief}</div>
            <div style={{ fontSize: 12, color: T.accInk, marginTop: 8, fontWeight: 700 }}>Target: {CAREER_JOBS[activeJob].target}</div>
            <button onClick={onAbandon} style={{
              marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 8,
              border: `1px solid ${T.line}`, background: T.panel, color: T.ink2, fontWeight: 700, fontSize: 11.5,
            }}>ABANDON JOB</button>
          </Panel>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CAREER_JOBS.map((j, i) => {
            const done = completedJobs.includes(i);
            const current = activeJob === i;
            return (
              <button key={j.id} onClick={() => onTakeJob(i)} style={{
                textAlign: 'left', padding: '11px 13px', borderRadius: 10,
                border: `1px solid ${current ? T.acc : done ? T.okLine : T.line}`,
                background: current ? T.accBg : done ? T.okBg : T.panel2,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: done ? T.ok : T.ink }}>{j.title}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, flexShrink: 0, color: done ? T.ok : current ? T.accInk : T.ink3 }}>
                    {done ? 'COMPLETE' : current ? 'ACTIVE' : 'TAKE JOB'}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 4, lineHeight: 1.45 }}>{j.customer}</div>
              </button>
            );
          })}
        </div>
      </BuildSection>
  );
}
