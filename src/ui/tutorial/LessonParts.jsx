/**
 * The pieces every lesson is built from, so every lesson reads the same way:
 *
 *   Goal     what you will be able to do, and what you need first
 *   ...      the explanation, a real screen, a worked example with real numbers
 *   Do       the steps, in the game, in order
 *   Did      what those steps just did, and why it matters
 *   Trouble  what usually goes wrong, and what to do about it
 *   Aside    optional background, closed until asked for
 *
 * That shape is the one tutorial writers keep arriving at: say what the reader will
 * learn and what they need, show the thing, have them do it, then tell them what they
 * did and what to do when it does not work.
 */

import { ChevronDown } from 'lucide-react';
import React, { useState } from 'react';

import styles from './Lesson.module.css';

/**
 * @param {{learn: React.ReactNode, need?: React.ReactNode}} props
 * @returns {React.ReactElement}
 */
export function Goal({ learn, need }) {
  return (
    <div className={styles.goal}>
      <div className={styles.goalRow}><span className={styles.goalKey}>YOU WILL</span><span>{learn}</span></div>
      {need && <div className={styles.goalRow}><span className={styles.goalKey}>YOU NEED</span><span>{need}</span></div>}
    </div>
  );
}

/** @param {{children: React.ReactNode}} props */
export function H({ children }) {
  return <h2 className={styles.h}>{children}</h2>;
}

/** @param {{children: React.ReactNode}} props */
export function P({ children }) {
  return <p className={styles.p}>{children}</p>;
}

/** @param {{items: React.ReactNode[]}} props */
export function List({ items }) {
  return <ol className={styles.list}>{items.map((it, i) => <li key={i}>{it}</li>)}</ol>;
}

/** A formula or a line of arithmetic, set so it reads as arithmetic. @param {{children: React.ReactNode}} props */
export function F({ children }) {
  return <p className={styles.formula}>{children}</p>;
}

/**
 * A worked example: the formula with this engine's own numbers in it.
 * @param {{title: React.ReactNode, rows: [React.ReactNode, React.ReactNode][], children?: React.ReactNode}} props
 */
export function Worked({ title, rows, children }) {
  return (
    <div className={styles.worked}>
      <div className={styles.boxHead}>WORKED EXAMPLE · {title}</div>
      <dl className={styles.workedRows}>
        {rows.map(([k, v], i) => (
          <React.Fragment key={i}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
        ))}
      </dl>
      {children && <div className={styles.boxNote}>{children}</div>}
    </div>
  );
}

/** @param {{steps: React.ReactNode[]}} props */
export function Do({ steps }) {
  return (
    <div className={styles.do}>
      <div className={styles.boxHead}>DO IT IN THE GAME</div>
      <ol className={styles.doSteps}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  );
}

/** @param {{children: React.ReactNode}} props */
export function Did({ children }) {
  return (
    <div className={styles.did}>
      <div className={styles.boxHead}>WHAT YOU JUST DID</div>
      <div className={styles.boxBody}>{children}</div>
    </div>
  );
}

/** @param {{items: [React.ReactNode, React.ReactNode][]}} props */
export function Trouble({ items }) {
  return (
    <div className={styles.trouble}>
      <div className={styles.boxHead}>IF IT GOES WRONG</div>
      <dl className={styles.troubleItems}>
        {items.map(([q, a], i) => (
          <React.Fragment key={i}><dt>{q}</dt><dd>{a}</dd></React.Fragment>
        ))}
      </dl>
    </div>
  );
}

/**
 * Optional background: useful, not needed to carry on, so it starts closed.
 * @param {{title: React.ReactNode, children: React.ReactNode}} props
 */
export function Aside({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.aside} data-open={open ? 'true' : 'false'}>
      <button type="button" className={styles.asideHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={styles.asideTag}>GO DEEPER</span>
        <span className={styles.asideTitle}>{title}</span>
        <ChevronDown size={15} aria-hidden="true" className={styles.asideChevron} />
      </button>
      {open && <div className={styles.asideBody}>{children}</div>}
    </div>
  );
}

/** A name of something on screen, set the way the game sets it. @param {{children: React.ReactNode}} props */
export function K({ children }) {
  return <b className={styles.k}>{children}</b>;
}
