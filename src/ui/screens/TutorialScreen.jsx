/** The eight-card walkthrough, shown before the first run and from the header. */

import React, { useState } from 'react';

import { Button } from '../primitives/Button.jsx';

import styles from './TutorialScreen.module.css';

/**
 * @param {object} props
 * @param {Array<{title: string, body: string}>} props.steps
 * @param {() => void} props.onDone
 * @returns {React.ReactElement}
 */
export function TutorialScreen({ steps, onDone }) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className={styles.screen}>
      <div className={styles.bar}>
        <div className={styles.count}>TUTORIAL · {step + 1}/{steps.length}</div>
        <Button variant="quiet" size="sm" onClick={onDone}>SKIP</Button>
      </div>

      <div className={styles.body}>
        <div className={styles.inner}>
          <h1 className={styles.title}>{current.title}</h1>
          {/* A step's body may carry the formula it is describing, as lines indented by
              four spaces. Prose stays prose; the arithmetic is set as code so it can be
              read as arithmetic. Steps with no newlines render exactly as before. */}
          {current.body.split('\n').map((line, i) => {
            if (line.trim() === '') return <div key={i} className={styles.gap} />;
            return line.startsWith('    ')
              ? <p key={i} className={styles.formula}>{line.trim()}</p>
              : <p key={i} className={styles.text}>{line}</p>;
          })}
        </div>
      </div>

      <div className={styles.dots} aria-hidden="true">
        {steps.map((s, i) => (
          <span
            key={s.title}
            className={[styles.dot, i === step && styles.dotOn].filter(Boolean).join(' ')}
          />
        ))}
      </div>

      <div className={styles.actions}>
        {step > 0 && (
          <Button size="lg" variant="ghost" onClick={() => setStep((v) => v - 1)}>BACK</Button>
        )}
        <Button size="lg" onClick={() => (last ? onDone() : setStep((v) => v + 1))}>
          {last ? 'START TUNING' : 'NEXT'}
        </Button>
      </div>
    </div>
  );
}
