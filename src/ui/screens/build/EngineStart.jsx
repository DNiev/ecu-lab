/**
 * What SANDBOX shows until an engine exists: nothing loaded, two ways to get one.
 *
 * A prebuilt factory engine, with the published figures it was built from; or an engine of
 * the player's own, from the numbers on their engine's spec sheet. Until one is chosen,
 * TUNE, LIVE, DYNO and DRAG have nothing true to show, so they show this instead of
 * someone else's engine.
 */

import React from 'react';

import { PRESET_GROUPS, applyPreset } from '../../../sim/index.js';
import { EngineSpecForm } from '../../components/EngineSpecForm.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild } from '../../state/StoreProvider.jsx';

import styles from './EngineStart.module.css';

/**
 * @returns {React.ReactElement}
 */
export function EngineStart() {
  const [, dispatch] = useBuild();
  const load = (preset) => dispatch({ type: ACTIONS.APPLY_PRESET, preset: applyPreset(preset) });
  const create = (patch) => dispatch({ type: ACTIONS.APPLY_PRESET, preset: patch });

  return (
    <div className={styles.page} data-testid="engine-start">
      <h2 className={styles.title}>Choose your engine</h2>
      <p className={styles.lead}>
        Nothing is loaded yet. Pick a prebuilt factory engine to start from its published figures,
        or enter your own engine&apos;s specs and the simulator will build its calibration from them.
      </p>

      <section aria-labelledby="start-prebuilt" className={styles.section}>
        <h3 className={styles.h3} id="start-prebuilt">A prebuilt engine</h3>
        {PRESET_GROUPS.map((g) => (
          <div key={g.manufacturer} className={styles.group}>
            <div className={styles.maker}>{g.manufacturer}</div>
            <div className={styles.cards}>
              {g.presets.map((p) => (
                <button key={p.id} type="button" className={styles.card} onClick={() => load(p)} aria-label={`Use ${p.name}`}>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.spec}>
                    {p.factory.displacementL.toFixed(1)} L {p.engine.configuration}
                    {p.induction.turboOn ? ' turbo' : ''} · {p.factory.crankHp} hp · {p.years}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="start-own" className={styles.section}>
        <h3 className={styles.h3} id="start-own">Or build your own</h3>
        <Panel>
          <p className={styles.formLead}>
            Enter your engine&apos;s figures from its manual or build sheet. Nothing is filled in for you.
          </p>
          <EngineSpecForm onCreate={create} />
        </Panel>
      </section>
    </div>
  );
}
