/**
 * An engine described by its own figures: the cylinder layout, bore, stroke, compression
 * and redline from the owner's manual or the build sheet, and anything else the player
 * knows. Nothing is pre-filled. A figure the player leaves out is filled with a stated
 * typical value and listed afterwards, so no number on a later screen is a quiet guess.
 *
 * The same form starts a blank game (EngineStart) and replaces the engine from BUILD.
 */

import React, { useState } from 'react';

import {
  BOTTOM_END_OPTS, CONFIG_OPTS, CUSTOM_ENGINE_LIMITS, CYL_COUNT, INJECTION_OPTS, MATERIAL_OPTS, VALVES_PER_CYL_OPTS,
  VALVETRAIN_OPTS, bottomEndLimit, customEnginePatch, pistonMotion, validateCustomEngine,
} from '../../sim/index.js';
import { Button } from '../primitives/Button.jsx';
import { Note } from '../primitives/Note.jsx';
import { Seg } from '../primitives/Seg.jsx';

import styles from './EngineSpecForm.module.css';

/** The required figures, in the order a build sheet lists them. */
const REQUIRED = [
  { key: 'bore', label: 'Bore', hint: 'Cylinder diameter' },
  { key: 'stroke', label: 'Stroke', hint: 'Piston travel' },
  { key: 'compression', label: 'Compression ratio', hint: 'Static, e.g. 10.5' },
  { key: 'redline', label: 'Redline', hint: 'Rev limit' },
];

/**
 * @param {object} props
 * @param {(patch: object) => void} props.onCreate gets the `customEnginePatch` for a valid spec
 * @param {string} [props.submitLabel]
 * @returns {React.ReactElement}
 */
export function EngineSpecForm({ onCreate, submitLabel = 'CREATE THIS ENGINE' }) {
  const [spec, setSpec] = useState(/** @type {Record<string, any>} */ ({
    configuration: '', bore: '', stroke: '', compression: '', redline: '',
    camDuration: '', valvetrain: '', valvesPerCyl: '', injection: '', blockMaterial: '', headMaterial: '', bottomEnd: '',
  }));
  const [tried, setTried] = useState(false);
  const set = (patch) => setSpec((s) => ({ ...s, ...patch }));
  const check = validateCustomEngine(spec);
  const errors = /** @type {Record<string, string>} */ (tried ? /** @type {any} */ (check).errors ?? {} : {});

  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    if (check.ok) onCreate(customEnginePatch(check.engine, check.assumed));
  };

  // What the entered figures come to, shown as soon as they are valid: the player can
  // compare it with the number on their own spec sheet before creating anything.
  const displacement = check.ok
    ? (Math.PI / 4) * (check.engine.bore / 10) ** 2 * (check.engine.stroke / 10) * CYL_COUNT[check.engine.configuration] / 1000
    : null;

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-label="Describe your engine">
      <div className={styles.group}>
        <div className={styles.label} id="spec-layout">Cylinder layout</div>
        <Seg
          label="Cylinder layout" equal value={spec.configuration}
          options={CONFIG_OPTS.map((c) => ({ id: c, label: `${c} · ${CYL_COUNT[c]} cyl` }))}
          onChange={(v) => set({ configuration: v })}
        />
        {errors.configuration && <div className={styles.error} role="alert">{errors.configuration}</div>}
      </div>

      <div className={styles.grid}>
        {REQUIRED.map(({ key, label, hint }) => {
          const lim = CUSTOM_ENGINE_LIMITS[key];
          return (
            <label key={key} className={styles.field}>
              <span className={styles.label}>{label}</span>
              <span className={styles.inputRow}>
                <input
                  className={styles.input} inputMode="decimal" autoComplete="off"
                  value={spec[key]} placeholder={hint}
                  aria-invalid={errors[key] ? 'true' : undefined}
                  onChange={(e) => set({ [key]: e.target.value })}
                />
                <span className={styles.unit}>{lim.unit}</span>
              </span>
              {errors[key] && <span className={styles.error} role="alert">{errors[key]}</span>}
            </label>
          );
        })}
      </div>

      <details className={styles.more}>
        <summary>More about this engine (optional)</summary>
        <p className={styles.note}>
          Fill in what you know. Anything you leave blank is filled with the typical value named
          beside it, and listed for you after the engine is created.
        </p>
        <label className={styles.field}>
          <span className={styles.label}>Intake cam duration</span>
          <span className={styles.inputRow}>
            <input
              className={styles.input} inputMode="decimal" autoComplete="off" placeholder="210 if unknown"
              value={spec.camDuration} aria-invalid={errors.camDuration ? 'true' : undefined}
              onChange={(e) => set({ camDuration: e.target.value })}
            />
            <span className={styles.unit}>{CUSTOM_ENGINE_LIMITS.camDuration.unit}</span>
          </span>
          {errors.camDuration && <span className={styles.error} role="alert">{errors.camDuration}</span>}
        </label>
        <div className={styles.label}>Valvetrain <span className={styles.typical}>DOHC if left blank</span></div>
        <Seg label="Valvetrain" equal value={spec.valvetrain} options={VALVETRAIN_OPTS} onChange={(v) => set({ valvetrain: v })} />
        <div className={styles.label}>Valves per cylinder <span className={styles.typical}>4 if left blank</span></div>
        <Seg label="Valves per cylinder" equal value={spec.valvesPerCyl} options={VALVES_PER_CYL_OPTS.map((n) => ({ id: n, label: String(n) }))} onChange={(v) => set({ valvesPerCyl: Number(v) })} />
        <div className={styles.label}>Fuel injection <span className={styles.typical}>port if left blank</span></div>
        <Seg label="Fuel injection" equal value={spec.injection} options={INJECTION_OPTS} onChange={(v) => set({ injection: v })} />
        <div className={styles.label}>Pistons and rods <span className={styles.typical}>production if left blank</span></div>
        <Seg label="Pistons and rods" equal value={spec.bottomEnd} options={BOTTOM_END_OPTS.map((o) => ({ id: o.id, label: o.label.split(' (')[0] }))} onChange={(v) => set({ bottomEnd: v })} />
        <div className={styles.label}>Block <span className={styles.typical}>aluminium if left blank</span></div>
        <Seg label="Block material" equal value={spec.blockMaterial} options={MATERIAL_OPTS.map((m) => ({ id: m, label: m }))} onChange={(v) => set({ blockMaterial: v })} />
        <div className={styles.label}>Cylinder head <span className={styles.typical}>aluminium if left blank</span></div>
        <Seg label="Head material" equal value={spec.headMaterial} options={MATERIAL_OPTS.map((m) => ({ id: m, label: m }))} onChange={(v) => set({ headMaterial: v })} />
      </details>

      {displacement != null && (
        <div className={styles.result} data-testid="spec-displacement">
          That is <b>{displacement.toFixed(2)} L</b> ({(displacement * 61.0237).toFixed(0)} cu in). Check it against your engine&apos;s own figure before creating it.
        </div>
      )}
      {check.ok && (() => {
        // What the redline asks of the pistons and rods (bottomEnd.js), said before the
        // engine exists rather than discovered on the dyno.
        const limit = bottomEndLimit(check.engine);
        const at = pistonMotion(check.engine.stroke, check.engine.redline);
        const past = check.engine.redline > limit.ratedRpm;
        return (
          <div className={styles.result} data-testid="spec-bottom-end">
            At {check.engine.redline.toLocaleString('en-US')} RPM the pistons average <b>{at.meanSpeedMs.toFixed(1)} m/s</b>.
            {' '}{limit.label} are good for about {limit.limitMs} m/s, which this stroke reaches at {limit.ratedRpm.toLocaleString('en-US')} RPM.
            {past
              ? ' The redline is past that: the engine will rev there, but the parts are outside what they are built for. Pick a stronger assembly, a shorter stroke or a lower redline.'
              : ''}
            {check.engine.redline > 9000
              ? ' Past 9,000 RPM the breathing curve is carried beyond the speeds the factory engines it was built from reach; docs/accuracy.md shows how it compares with five real high-revving engines.'
              : ''}
          </div>
        );
      })()}
      {check.ok && check.estimated.length > 0 && (
        <Note>Not entered, so typical values will be used: {check.estimated.join('; ')}. You can change each on BUILD afterwards.</Note>
      )}
      {check.ok && (
        <Note>
          It starts naturally aspirated, on 91 octane, with no bolt-ons. Add a turbo, supercharger,
          intercooler or a different fuel on BUILD afterwards, then press RESET ALL TO STOCK on BUILD ›
          ENGINE: it writes a calibration generated for that hardware.
        </Note>
      )}
      <div>
        <Button type="submit" size="lg" onClick={submit}>{submitLabel}</Button>
      </div>
    </form>
  );
}
