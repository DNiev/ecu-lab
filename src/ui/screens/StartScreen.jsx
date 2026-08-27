/** The first screen: what this is, and the three ways in. */

import React from 'react';

import { Button } from '../primitives/Button.jsx';

import styles from './StartScreen.module.css';

/**
 * The three ways in, in the order a newcomer should meet them.
 *
 * CAREER is first and is the primary action, because a customer car with a fault in it
 * is the only one of the three that tells you what you are trying to achieve. A sandbox
 * with no objective is the right tool once you know what you are doing and a poor place
 * to start, and the tutorial is a detour a returning player does not want.
 */
const WAYS_IN = [
  { key: 'career', label: 'CAREER', variant: 'primary', caption: 'Customer cars with real faults to diagnose' },
  { key: 'sandbox', label: 'SANDBOX', variant: 'ghost', caption: 'Build and tune anything, no objectives' },
  { key: 'tutorial', label: 'TUTORIAL', variant: 'quiet', caption: 'Fifteen steps through the whole loop' },
];

/**
 * @param {object} props
 * @param {() => void} props.onCareer open the job board
 * @param {() => void} props.onStart open the sandbox
 * @param {() => void} props.onTutorial
 * @param {string} props.version
 * @param {React.ReactNode} [props.dial] decorative dial mark
 * @returns {React.ReactElement}
 */
export function StartScreen({ onCareer, onStart, onTutorial, version, dial }) {
  const handlers = { career: onCareer, sandbox: onStart, tutorial: onTutorial };
  return (
    <div className={styles.screen}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.inner}>
        {dial && <div className={styles.dial}>{dial}</div>}
        <div className={styles.eyebrow}>CARIBOU TUNING</div>
        <h1 className={styles.title}>Engine Management Sandbox</h1>
        <p className={styles.blurb}>
          Design an engine. Tune it. Log it. Improve it. A free-tune sandbox built to
          teach real engine management, not just move sliders.
        </p>
        <div className={styles.actions}>
          {WAYS_IN.map((way) => (
            <div key={way.key} className={styles.way}>
              <Button
                size="lg"
                block
                variant={/** @type {'primary'|'ghost'|'quiet'} */ (way.variant)}
                onClick={handlers[way.key]}
              >
                {way.label}
              </Button>
              <div className={styles.caption}>{way.caption}</div>
            </div>
          ))}
        </div>
        <div className={styles.version}>{version}</div>
      </div>
    </div>
  );
}
