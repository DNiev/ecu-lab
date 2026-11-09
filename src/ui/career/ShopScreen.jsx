/**
 * The career's home: the shop, drawn, with what needs doing today underneath it.
 *
 * The scene is the centrepiece and the panels are the paperwork: today's cars, the
 * customers waiting, what to buy, what to learn, and the books. Everything here is a
 * decision about the shop; the tuning itself happens in the game's own screens, on the
 * customer's car (WORK ON THE CAR), with the job ticket pinned above them.
 */

import { BookOpen, Check, ClipboardList, Hammer, Lock, Menu, Users, Wallet, Wrench } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { Button } from '../primitives/Button.jsx';
import { ACTIONS } from '../state/reducer.js';
import { useCareer } from '../state/StoreProvider.jsx';

import { EQUIPMENT, MILESTONES, TRAINING, nextRepTier, repTier } from './catalog.js';
import { HOW_TO_SEE } from './evaluate.js';
import { jobById } from './jobs.js';
import {
  accept, blockers, board, buy, cannotBuy, cannotTrain, capacity, giveUp, newCareer, nextDay, overhead, train,
} from './shop.js';
import { ShopScene } from './ShopScene.jsx';
import styles from './ShopScreen.module.css';

const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const TIER_NAME = { 1: 'Street', 2: 'Enthusiast', 3: 'Pro' };
const VERDICT = {
  pass: { title: 'Job done', tone: 'ok' },
  partial: { title: 'Partly done', tone: 'warn' },
  fail: { title: 'Not fixed yet', tone: 'warn' },
  unsafe: { title: 'Sent home unsafe', tone: 'danger' },
};

/**
 * @param {object} props
 * @param {() => void} props.onWork opens the game on the car on the bay
 * @param {() => void} props.onMenu back to the start screen
 * @param {() => void} [props.onLearn] opens the Tuning Course
 * @returns {React.ReactElement|null}
 */
export function ShopScreen({ onWork, onMenu, onLearn }) {
  const [career, dispatch] = useCareer();
  const [tab, setTab] = useState('today');
  const [arriving, setArriving] = useState(/** @type {string|null} */ (null));
  const [speech, setSpeech] = useState(/** @type {{text: string, shirt: string}|null} */ (null));
  const [departing, setDeparting] = useState(/** @type {{color: string, body?: string}|null} */ (null));
  const [lesson, setLesson] = useState(/** @type {string|null} */ (null));
  const [confirmReset, setConfirmReset] = useState(false);

  const last = career?.last;
  const unseen = last && last.seq !== career.lastSeen;

  // A car that went home drives out when the shop opens after the hand-back.
  useEffect(() => {
    if (!unseen || !last.leaves) return undefined;
    const job = jobById(last.jobId);
    setDeparting({ color: job.customer.color, body: job.customer.body });
    setTab('today');
    const t = setTimeout(() => setDeparting(null), 2600);
    return () => clearTimeout(t);
  }, [unseen, last]);

  useEffect(() => {
    if (!arriving) return undefined;
    const t = setTimeout(() => { setArriving(null); setSpeech(null); }, 5200);
    return () => clearTimeout(t);
  }, [arriving]);

  if (!career) return null;
  const update = (next) => dispatch({ type: ACTIONS.CAREER_UPDATE, career: next });
  const tier = repTier(career.rep);
  const nextTier = nextRepTier(career.rep);
  const working = career.working ? jobById(career.working) : null;
  const waiting = board(career);

  const takeJob = (id) => {
    const job = jobById(id);
    update(accept(career, id));
    setArriving(id);
    setSpeech({ text: job.says, shirt: job.customer.color });
    setTab('today');
  };

  const TABS = [
    { id: 'today', label: 'TODAY', icon: ClipboardList },
    { id: 'customers', label: 'CUSTOMERS', icon: Users, count: waiting.filter((j) => blockers(career, j).length === 0).length },
    { id: 'upgrades', label: 'UPGRADES', icon: Hammer },
    { id: 'training', label: 'TRAINING', icon: BookOpen },
    { id: 'books', label: 'BOOKS', icon: Wallet },
  ];

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.brandMaker}>CAREER</span>
          <span className={styles.brandName}>Your tuning shop</span>
        </div>
        <div className={styles.stats} aria-label="Shop status">
          <span className={styles.stat}><span className={styles.statKey}>DAY</span>{career.day}</span>
          <span className={styles.stat} data-testid="shop-money"><span className={styles.statKey}>CASH</span>{money(career.money)}</span>
          <span className={styles.stat} data-testid="shop-rep"><span className={styles.statKey}>REP</span>{career.rep} · {tier.title}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={onMenu} aria-label="Main menu"><Menu size={15} aria-hidden="true" /> MENU</Button>
      </header>

      <div className={styles.sceneWrap}>
        <ShopScene career={career} arriving={arriving} departing={departing} speech={speech} />
      </div>

      <nav className={styles.tabs} aria-label="Shop">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={styles.tab} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <t.icon size={15} aria-hidden="true" />
            <span>{t.label}</span>
            {t.count > 0 && <span className={styles.count}>{t.count}</span>}
          </button>
        ))}
      </nav>

      <main className={styles.panel}>
        {tab === 'today' && (
          <>
            {unseen && (
              <section className={styles.card} data-tone={VERDICT[last.verdict].tone} aria-label="Job result">
                <div className={styles.cardTag}>{VERDICT[last.verdict].title.toUpperCase()} · {jobById(last.jobId).customer.name}</div>
                <p className={styles.quote}>&ldquo;{last.line}&rdquo;</p>
                <ul className={styles.checks}>
                  {last.results.map((r) => (
                    <li key={r.label} data-pass={r.pass ? 'true' : 'false'}>
                      <span className={styles.mark} aria-hidden="true">{r.pass ? '✓' : '✗'}</span>
                      <span>
                        <b>{r.label}</b><span className={styles.measured}>{r.measured}</span>
                        {!r.pass && r.type && HOW_TO_SEE[r.type] && <span className={styles.how}>How to see it: {HOW_TO_SEE[r.type]}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={styles.payout}>
                  <span>{last.paid >= 0 ? 'Paid' : 'Cost'} <b>{money(Math.abs(last.paid))}</b>{last.repair ? ` (after a ${money(last.repair)} repair)` : ''}</span>
                  <span>Reputation <b>{last.repChange >= 0 ? '+' : ''}{last.repChange}</b></span>
                </div>
                {last.verdict === 'pass' && <p className={styles.teach}><b>What this job was about:</b> {jobById(last.jobId).teaches}</p>}
                {!last.leaves && <p className={styles.teach}>The car is still on its lift. Have another look.</p>}
                <Button size="sm" onClick={() => update({ ...career, lastSeen: last.seq })}>OK</Button>
              </section>
            )}
            {working ? (
              <section className={styles.card} aria-label="On the bay">
                <div className={styles.cardTag}>ON THE BAY · {working.customer.car}</div>
                <p className={styles.quote}>&ldquo;{working.says}&rdquo;</p>
                <p className={styles.small}><b>{working.customer.name} wants:</b> {working.wants}</p>
                <div className={styles.row}>
                  <Button onClick={onWork}><Wrench size={15} aria-hidden="true" /> WORK ON THE CAR</Button>
                  <Button variant="quiet" size="sm" onClick={() => update(giveUp(career, working.id))}>SEND IT BACK UNFINISHED</Button>
                </div>
              </section>
            ) : (
              <section className={styles.card} aria-label="On the bay">
                <div className={styles.cardTag}>THE BAY IS EMPTY</div>
                <p className={styles.small}>{waiting.some((j) => blockers(career, j).length === 0) ? 'A customer is waiting. Take their car in from CUSTOMERS.' : 'Nobody you can help yet. Train or buy what the next customer needs.'}</p>
                <Button size="sm" variant="ghost" onClick={() => setTab('customers')}><Users size={14} aria-hidden="true" /> CUSTOMERS</Button>
              </section>
            )}
            {career.lifts.filter((l) => l.jobId !== career.working).map((l) => {
              const job = jobById(l.jobId);
              return (
                <section key={l.jobId} className={styles.card} aria-label={`${job.customer.name}'s car`}>
                  <div className={styles.cardTag}>ON A LIFT · {job.customer.car}</div>
                  <p className={styles.small}>{job.customer.name}: {job.wants}</p>
                  <Button size="sm" variant="ghost" onClick={() => update({ ...career, working: l.jobId })}>PUT IT ON THE BAY</Button>
                </section>
              );
            })}
          </>
        )}

        {tab === 'customers' && (
          <>
            <p className={styles.intro}>{career.lifts.length}/{capacity(career)} lifts in use. Customers describe what the car does; working out why is the job.</p>
            {waiting.map((job) => {
              const blocked = blockers(career, job);
              return (
                <section key={job.id} className={styles.card} aria-label={`${job.customer.name}, ${job.customer.car}`}>
                  <div className={styles.cardTag}>{job.build ? 'ENGINE BUILD' : job.generated ? `WALK-IN · ${TIER_NAME[job.tier].toUpperCase()}` : TIER_NAME[job.tier].toUpperCase()} · {job.customer.name} · {job.customer.car}</div>
                  <p className={styles.quote}>&ldquo;{job.says}&rdquo;</p>
                  <p className={styles.small}><b>Wants:</b> {job.wants}</p>
                  <div className={styles.meta}><span>Pays <b>{money(job.pay)}</b></span><span>Reputation <b>+{job.rep}</b></span></div>
                  {blocked.length > 0 && <p className={styles.blocked}><Lock size={12} aria-hidden="true" /> Needs: {blocked.join(' · ')}</p>}
                  <Button size="sm" disabled={blocked.length > 0} onClick={() => takeJob(job.id)} aria-label={`Take ${job.customer.name}'s car`}>TAKE THE CAR</Button>
                </section>
              );
            })}
            {waiting.length === 0 && <p className={styles.intro}>No one else is waiting today.</p>}
            <section className={styles.card} aria-label="Tomorrow">
              <div className={styles.cardTag}>DAY {career.day} · CLOSING UP</div>
              <p className={styles.small}>New customers come in every day, and the better your reputation, the bigger their jobs. Cars on the lifts wait for you overnight. Opening tomorrow costs the day&apos;s running costs, {money(overhead(career))}.</p>
              <Button size="sm" variant="ghost" onClick={() => update(nextDay(career))}>OPEN TOMORROW</Button>
            </section>
          </>
        )}

        {tab === 'upgrades' && (
          <>
            <p className={styles.intro}>Money well spent changes what the shop can do. Every item here changes the work, not just the look.</p>
            {EQUIPMENT.filter((e) => e.price > 0).map((e) => {
              const why = cannotBuy(career, e.id);
              const own = career.owned.includes(e.id);
              return (
                <section key={e.id} className={styles.card} data-owned={own ? 'true' : 'false'} aria-label={e.title}>
                  <div className={styles.cardTag}>{own ? 'OWNED' : money(e.price)} · {e.title}</div>
                  <p className={styles.small}>{e.does}</p>
                  {own ? <span className={styles.owned}><Check size={14} aria-hidden="true" /> In the shop</span> : (
                    <>
                      {why && <p className={styles.blocked}><Lock size={12} aria-hidden="true" /> {why}</p>}
                      <Button size="sm" disabled={!!why} onClick={() => update(buy(career, e.id))} aria-label={`Buy ${e.title}`}>BUY</Button>
                    </>
                  )}
                </section>
              );
            })}
          </>
        )}

        {tab === 'training' && (
          <>
            <p className={styles.intro}>A new shop can correct airflow, fuel, injectors and sensors. Every other part of the ECU opens with training.</p>
            {TRAINING.map((t) => {
              const why = cannotTrain(career, t.id);
              const done = career.trained.includes(t.id);
              return (
                <section key={t.id} className={styles.card} data-owned={done ? 'true' : 'false'} aria-label={t.title}>
                  <div className={styles.cardTag}>{done ? 'COMPLETED' : money(t.price)} · {t.title}</div>
                  <p className={styles.small}>{t.summary}</p>
                  {done ? <Button size="sm" variant="ghost" onClick={() => setLesson(t.id)}>REVIEW THE LESSON</Button> : (
                    <>
                      {why && <p className={styles.blocked}><Lock size={12} aria-hidden="true" /> {why}</p>}
                      <Button size="sm" disabled={!!why} onClick={() => { update(train(career, t.id)); setLesson(t.id); }} aria-label={`Take the ${t.title} course`}>TAKE THE COURSE</Button>
                    </>
                  )}
                </section>
              );
            })}
          </>
        )}

        {tab === 'books' && (
          <>
            <section className={styles.card} aria-label="Reputation">
              <div className={styles.cardTag}>REPUTATION · {tier.title}</div>
              <div className={styles.repTrack}><span className={styles.repFill} style={{ width: `${nextTier ? Math.min(100, ((career.rep - tier.min) / (nextTier.min - tier.min)) * 100) : 100}%` }} /></div>
              <p className={styles.small}>{nextTier ? `${nextTier.min - career.rep} more to become a ${nextTier.title.toLowerCase()}.` : 'As good as a shop gets.'} Good work raises it; unsafe work or unfinished cars cost it.</p>
            </section>
            <section className={styles.card} aria-label="Running costs">
              <div className={styles.cardTag}>RUNNING COSTS · {money(overhead(career))} A DAY</div>
              <p className={styles.small}>Rent, and what the shop has grown into: every extra lift, the dyno, the lounge. Paid each time the day moves on.</p>
            </section>
            <section className={styles.card} aria-label="Milestones">
              <div className={styles.cardTag}>MILESTONES · {career.milestones.length}/{MILESTONES.length}</div>
              <ul className={styles.plain}>
                {MILESTONES.map((m) => <li key={m.id} data-done={career.milestones.includes(m.id) ? 'true' : 'false'}>{career.milestones.includes(m.id) ? '★' : '☆'} {m.title}</li>)}
              </ul>
            </section>
            <section className={styles.card} aria-label="Job history">
              <div className={styles.cardTag}>RECENT WORK</div>
              {career.history.length === 0 ? <p className={styles.small}>Nothing yet.</p> : (
                <ul className={styles.plain}>
                  {career.history.slice(0, 12).map((h, i) => (
                    <li key={i}>Day {h.day} · {jobById(h.jobId)?.customer.name} · {VERDICT[h.verdict]?.title} · {money(h.paid)}</li>
                  ))}
                </ul>
              )}
            </section>
            <section className={styles.card} aria-label="Start over">
              {!confirmReset ? (
                <Button size="sm" variant="quiet" onClick={() => setConfirmReset(true)}>START A NEW CAREER</Button>
              ) : (
                <>
                  <p className={styles.small}>This deletes the shop: money, reputation, equipment, training and every car. Sandbox is not affected.</p>
                  <div className={styles.row}>
                    <Button size="sm" variant="danger" onClick={() => { update(newCareer()); setConfirmReset(false); }}>DELETE THE SHOP</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>KEEP IT</Button>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </main>

      {lesson && (() => {
        const t = TRAINING.find((x) => x.id === lesson);
        return (
          <div className={styles.lessonScrim} role="dialog" aria-modal="true" aria-label={`${t.title} lesson`}>
            <div className={styles.lesson}>
              <div className={styles.cardTag}>TRAINING · {t.title}</div>
              {t.lesson.map((para) => <p key={para} className={styles.lessonText}>{para}</p>)}
              <p className={styles.small}><b>Opens:</b> {[...t.pages.map((pg) => `TUNE › ${pg.toUpperCase()}`), ...(t.sections ?? []).map((sc) => `the ECU settings on TUNE › ${sc.toUpperCase()}`)].join(', ')}.</p>
              {t.deeper && <p className={styles.small}><b>Go deeper:</b> {t.deeper}{onLearn ? '.' : ''}</p>}
              <div className={styles.row}>
                <Button size="sm" onClick={() => setLesson(null)}>GOT IT</Button>
                {onLearn && <Button size="sm" variant="ghost" onClick={onLearn}>OPEN THE COURSE</Button>}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
