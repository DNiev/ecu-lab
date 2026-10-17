/**
 * A real game screen, shown inside a lesson with numbered callouts.
 *
 * Not a screenshot: the screen itself, mounted in a store of its own and seeded with a
 * demo engine's pull (see demoEngine.js). So a snippet always looks like the version
 * the player is running, its numbers are the ones they will get, and it can be touched
 * — tap a cell, open the advisor — without changing their own build or tune.
 *
 * Each callout names its target by a CSS selector inside the screen. The badge is
 * placed on that element after layout, so a callout follows its target wherever the
 * screen lays it out, at any width. A selector that finds nothing is a callout pointing
 * at something that no longer exists, and `tests/ui/tutorial.test.jsx` fails on it.
 *
 * Links inside a snippet are inert: the screens carry "open TUNE › SENSORS" links, and
 * following one would leave the tutorial for a page of the player's own game.
 */

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { StoreProvider } from '../state/StoreProvider.jsx';

import styles from './ScreenSnippet.module.css';

/**
 * @typedef {object} Callout
 * @property {string} at CSS selector for the element it explains, inside the screen
 * @property {React.ReactNode} text what the reader should notice there
 */

/**
 * Where each callout's target sits inside `content`, in content coordinates.
 *
 * @param {HTMLElement} content
 * @param {Callout[]} callouts
 * @returns {({top: number, left: number, width: number, height: number}|null)[]}
 */
function locateCallouts(content, callouts) {
  const box = content.getBoundingClientRect();
  return callouts.map((c) => {
    const el = content.querySelector(c.at);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top - box.top, left: r.left - box.left, width: r.width, height: r.height };
  });
}

/**
 * @param {object} props
 * @param {string} props.where the screen's place in the app, as its nav names it ("TUNE › AIRFLOW")
 * @param {import('./demoEngine.js').Demo} props.demo the engine and pull it shows
 * @param {(state: any) => any} [props.seed] further changes to the demo's store (a selected cell, an open section)
 * @param {string} [props.focus] selector the frame scrolls to on open
 * @param {number} [props.height] the frame's height, px
 * @param {Callout[]} [props.callouts]
 * @param {React.ReactNode} props.caption one or two sentences: what this screen is, in this lesson
 * @param {React.ReactNode} props.children the real screen
 * @returns {React.ReactElement}
 */
export function ScreenSnippet({ where, demo, seed, focus, height = 360, callouts = [], caption, children }) {
  const frame = useRef(/** @type {HTMLDivElement|null} */ (null));
  const content = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [spots, setSpots] = useState(/** @type {ReturnType<typeof locateCallouts>} */ ([]));
  // Seeded once per mount: the sandbox then owns its state, as the real store does.
  const [init] = useState(() => () => (seed ? seed(demo.state) : demo.state));

  // Read through a ref, so re-placing never has to re-run the effect that scrolls.
  const calloutsRef = useRef(callouts);
  calloutsRef.current = callouts;
  const place = useCallback(() => {
    if (content.current) setSpots(locateCallouts(content.current, calloutsRef.current));
  }, []);

  useLayoutEffect(() => {
    const f = frame.current;
    const c = content.current;
    if (!f || !c) return undefined;
    if (focus) {
      const el = c.querySelector(focus);
      if (el) f.scrollTop = Math.max(0, el.getBoundingClientRect().top - c.getBoundingClientRect().top - 8);
    }
    place();
    // A chart or a font can settle a frame late; re-place once it has.
    const t = setTimeout(place, 250);
    window.addEventListener('resize', place);
    const ro = window.ResizeObserver ? new window.ResizeObserver(place) : null;
    ro?.observe(c);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', place);
      ro?.disconnect();
    };
  }, [focus, place]);

  /** @param {React.MouseEvent} e */
  const inertLinks = (e) => {
    const a = /** @type {HTMLElement} */ (e.target).closest?.('a[href^="#"]');
    if (a) e.preventDefault();
  };

  return (
    <figure
      className={styles.snippet}
      aria-label={`Game screen: ${where}`}
      // How many callouts found nothing to point at: always 0 unless a screen changed
      // under a lesson, which the tutorial's tests fail on.
      data-callouts={callouts.length}
      data-callouts-missing={spots.length === callouts.length ? spots.filter((sp) => sp === null).length : ''}
    >
      <div className={styles.chrome}>
        <span className={styles.live}>LIVE SCREEN</span>
        <span className={styles.where}>{where}</span>
      </div>
      <div
        ref={frame}
        className={styles.frame}
        style={{ height }}
        // Scrollable, so it has to be reachable from the keyboard.
        tabIndex={0}
        role="region"
        aria-label={`${where}, scrollable`}
        onClickCapture={inertLinks}
      >
        <div ref={content} className={styles.content} data-testid="snippet-content">
          <StoreProvider init={init}>{children}</StoreProvider>
          {/* A target with no size is hidden at this width (a collapsed panel); its legend
              entry still reads, but a badge at the corner of nothing would mislead. */}
          {spots.map((s, i) => (s && (s.width > 0 || s.height > 0) ? (
            <React.Fragment key={i}>
              <span className={styles.ring} style={{ top: s.top - 3, left: s.left - 3, width: s.width + 6, height: s.height + 6 }} aria-hidden="true" />
              <span className={styles.badge} style={{ top: Math.max(0, s.top - 10), left: Math.max(0, s.left - 10) }} aria-hidden="true">{i + 1}</span>
            </React.Fragment>
          ) : null))}
        </div>
      </div>
      <figcaption className={styles.caption}>
        <p className={styles.captionText}>{caption}</p>
        {callouts.length > 0 && (
          <ol className={styles.legend}>
            {callouts.map((c, i) => (
              <li key={i} className={styles.legendItem}>
                <span className={styles.legendBadge} aria-hidden="true">{i + 1}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ol>
        )}
      </figcaption>
    </figure>
  );
}
