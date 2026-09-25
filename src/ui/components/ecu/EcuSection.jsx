/**
 * One TUNE view's engine management settings, generated from `ECU_META`.
 *
 * Every field in the calibration has one entry there — label, units, range, axes and a
 * line on what it physically does — and this renders a section's entries grouped the
 * way a tuner looks for them: scalars as steppers, strategies as segmented choices,
 * tables in the table editor. Advanced settings stay folded until asked for, so a
 * newcomer sees the handful that matter and a professional can reach everything.
 *
 * Writes go through SET_ECU, one undo step each.
 */

import { AlertTriangle, ChevronDown, RotateCcw } from 'lucide-react';
import React from 'react';

import {
  ECU_META, defaultEcuCalibration, deriveEngine, ecuHardwareOf, getCal, setCal, setupMismatches,
} from '../../../sim/index.js';
import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { Seg } from '../../primitives/Seg.jsx';
import { Toggle } from '../../primitives/Toggle.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild, useTune } from '../../state/StoreProvider.jsx';
import { UndoControls } from '../UndoControls.jsx';

import { CalTable } from './CalTable.jsx';
import styles from './EcuSection.module.css';
import { PAGE_GUIDES, tipFor } from './guides.js';

/** Which live variable each table axis is read on, for the operating-point marker. */
const AXIS_VAR = {
  RPM: 'rpm', 'MAP kPa': 'map', 'Coolant °C': 'ect', 'IAT °C': 'iat', 'Battery V': 'volts',
  'Baro kPa': 'baro', 'Throttle %': 'tps', 'Pedal %': 'pedal', 'Airflow g/s': 'maf',
  'Throttle rate %/s': 'tpsRate', 'Target psi': 'boostTarget', 'Intake cam °': 'camIn', Gear: 'gear',
};

/**
 * @param {object} props
 * @param {string} props.section which `ECU_META` section to show
 * @param {string} props.title
 * @param {React.ElementType} [props.icon]
 * @param {React.ReactNode} [props.intro] a line of its own above the page guide
 * @param {Record<string, number>|null} [props.liveVars] the running engine's operating
 *   point, when it is running — what the table markers show
 * @param {boolean} [props.embedded] shown under an existing screen's own content, so it
 *   takes a smaller heading and no undo controls of its own
 * @returns {React.ReactElement}
 */
export function EcuSection({ section, title, icon, intro, liveVars = null, embedded = false }) {
  const [tune, dispatch] = useTune();
  const [build] = useBuild();
  const cal = tune.ecu;
  const [showPro, setShowPro] = React.useState(false);
  const def = React.useMemo(
    () => defaultEcuCalibration({ derived: deriveEngine(build.engineConfig), gate: ecuHardwareOf(build).gate }),
    [build],
  );
  const fields = ECU_META.filter((m) => m.section === section && (showPro || !m.pro));
  const hiddenPro = ECU_META.filter((m) => m.section === section && m.pro).length;
  const groups = [];
  for (const f of fields) {
    let g = groups.find((x) => x.name === f.group);
    if (!g) { g = { name: f.group, fields: [] }; groups.push(g); }
    g.fields.push(f);
  }
  const set = (path, value) => dispatch({ type: ACTIONS.SET_ECU, path, value });
  const resetSection = () => {
    let next = cal;
    for (const m of ECU_META.filter((x) => x.section === section)) next = setCal(next, m.path, getCal(def, m.path));
    dispatch({ type: ACTIONS.SET_ECU, value: next, label: `Reset ${title}` });
  };
  const changedCount = ECU_META.filter((m) => m.section === section
    && JSON.stringify(getCal(cal, m.path)) !== JSON.stringify(getCal(def, m.path))).length;
  const sectionModified = changedCount > 0;
  const guide = PAGE_GUIDES[section];
  const mismatches = setupMismatches(ecuHardwareOf(build), cal).filter((m) => m.section === section);

  return (
    <section className={embedded ? styles.embedded : styles.section} aria-label={title}>
      <div className={styles.head}>
        <Eyebrow icon={icon}>{title}</Eyebrow>
        <span className={styles.flex} />
        {sectionModified && (
          <button type="button" className={styles.reset} onClick={resetSection}>
            <RotateCcw size={12} aria-hidden="true" /> Factory
          </button>
        )}
        {!embedded && <UndoControls />}
      </div>
      {intro && <div className={styles.intro}>{intro}</div>}
      {guide && <PageGuide guide={guide} changedCount={changedCount} />}
      {mismatches.length > 0 && (
        <div className={styles.mismatch} role="alert">
          <div className={styles.mismatchHead}>
            <AlertTriangle size={14} aria-hidden="true" /> Doesn&apos;t match the parts on BUILD
          </div>
          {mismatches.map((m) => (
            <div key={m.path + m.text} className={styles.mismatchRow}>
              <div className={styles.mismatchText}>{m.text}</div>
              {m.fix && <button type="button" className={styles.fix} onClick={() => set(m.path, m.fix.value)}>{m.fix.label}</button>}
            </div>
          ))}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.name} className={styles.group}>
          <div className={styles.groupName}>{g.name}</div>
          {g.fields.map((m) => (
            <Field key={m.path} meta={m} value={getCal(cal, m.path)} def={getCal(def, m.path)}
              onChange={(v) => set(m.path, v)} liveVars={liveVars} />
          ))}
        </div>
      ))}

      {hiddenPro > 0 && (
        <button type="button" className={styles.more} aria-expanded={showPro} onClick={() => setShowPro(!showPro)}>
          <ChevronDown size={14} className={showPro ? styles.chevOpen : styles.chev} aria-hidden="true" />
          {showPro ? 'Hide advanced settings' : `Advanced settings (${hiddenPro})`}
        </button>
      )}
    </section>
  );
}

/**
 * What a page is for, when to come to it, and whether anything on it has been changed —
 * so a player can decide in a glance whether this page is where their problem is.
 * @param {{guide: import('./guides.js').PageGuide, changedCount: number}} props
 */
function PageGuide({ guide, changedCount }) {
  return (
    <div className={styles.guide}>
      <p className={styles.guideDoes}>{guide.does}</p>
      <dl className={styles.guideList}>
        <dt>Come here when</dt>
        <dd>{guide.when}</dd>
        <dt>Safe to leave</dt>
        <dd>{guide.leave}</dd>
      </dl>
      <div className={styles.guideStatus} data-changed={changedCount > 0 || undefined}>
        {changedCount > 0
          ? `${changedCount} setting${changedCount === 1 ? '' : 's'} changed from factory, marked with a dot. Factory puts them all back.`
          : 'All factory settings. Nothing here needs changing to make a good tune.'}
      </div>
    </div>
  );
}

/**
 * A setting's short tip, with its full explanation behind "Why?".
 * @param {{meta: import('../../../sim/ecu/calibration.js').EcuFieldMeta}} props
 */
function Help({ meta }) {
  const [open, setOpen] = React.useState(false);
  const tip = tipFor(meta);
  // "Why?" only when the full explanation says something the tip does not — a near
  // restatement behind a link is a click that teaches nothing.
  const more = meta.help !== tip && meta.help.length > tip.length + 40;
  return (
    <div className={styles.help}>
      {tip}
      {more && !open && (
        <> <button type="button" className={styles.why} onClick={() => setOpen(true)}>Why?</button></>
      )}
      {open && <div className={styles.whyText}>{meta.help}</div>}
    </div>
  );
}

/**
 * @param {object} props
 * @param {import('../../../sim/ecu/calibration.js').EcuFieldMeta} props.meta
 * @param {any} props.value
 * @param {any} props.def
 * @param {(v: any) => void} props.onChange
 * @param {Record<string, number>|null} props.liveVars
 */
function Field({ meta, value, def, onChange, liveVars }) {
  const changed = JSON.stringify(value) !== JSON.stringify(def);
  if (meta.kind === 'bool') {
    return (
      <div className={styles.field}>
        <Toggle label={meta.label} checked={!!value} onChange={onChange} />
        <Help meta={meta} />
      </div>
    );
  }
  if (meta.kind === 'enum') {
    return (
      <div className={styles.field}>
        <FieldHead meta={meta} changed={changed} />
        <Seg label={meta.label} options={meta.options} value={value} onChange={onChange} equal={meta.options.length > 2} />
      </div>
    );
  }
  if (meta.kind === 'number') {
    return (
      <div className={styles.fieldRow}>
        <FieldHead meta={meta} changed={changed} />
        <NumberInput meta={meta} value={value} onChange={onChange} />
      </div>
    );
  }
  if (meta.kind === 'cyl') {
    const labels = meta.path.endsWith('bankTrim') ? ['Bank A', 'Bank B'] : value.map((_, i) => `Cyl ${i + 1}`);
    return (
      <div className={styles.field}>
        <FieldHead meta={meta} changed={changed} />
        <div className={styles.cyls}>
          {value.map((v, i) => (
            <label key={i} className={styles.cyl}>
              <span className={styles.cylName}>{labels[i]}</span>
              <NumberInput meta={meta} value={v} compact
                onChange={(nv) => onChange(value.map((x, j) => (j === i ? nv : x)))} />
            </label>
          ))}
        </div>
      </div>
    );
  }
  // A table: folded until opened, because a view full of open tables is a wall.
  const xVar = AXIS_VAR[meta.xLabel];
  const yVar = AXIS_VAR[meta.yLabel];
  const marker = liveVars && xVar && liveVars[xVar] != null
    ? { x: liveVars[xVar], y: yVar ? liveVars[yVar] : undefined } : null;
  return <TableField meta={meta} value={value} def={def} onChange={onChange} marker={marker} changed={changed} />;
}

/**
 * A table behind a disclosure button: folded until opened, because a view full of open
 * tables is a wall.
 * @param {{meta: any, value: any, def: any, onChange: (v: any) => void, marker: any, changed: boolean}} props
 */
function TableField({ meta, value, def, onChange, marker, changed }) {
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  return (
    <div className={styles.table} data-open={open || undefined}>
      <button type="button" className={styles.summary} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span className={styles.summaryName}>{meta.label}</span>
        <span className={styles.summaryAxes}>{meta.kind === 'map' ? `${meta.xLabel} × ${meta.yLabel}` : meta.xLabel}</span>
        {changed && <span className={styles.dot} aria-label="modified" />}
        {marker && <span className={styles.liveDot} aria-label="engine is reading this table" />}
      </button>
      {open && (
        <div className={styles.tableBody} id={bodyId}>
          <Help meta={meta} />
          <CalTable table={value} def={def} meta={meta} onChange={onChange} marker={marker} />
        </div>
      )}
    </div>
  );
}

/** @param {{meta: any, changed: boolean}} props */
function FieldHead({ meta, changed }) {
  return (
    <div className={styles.fieldHead}>
      <div className={styles.label}>
        {meta.label}
        {changed && <span className={styles.dot} aria-label="modified" />}
      </div>
      <Help meta={meta} />
    </div>
  );
}

/**
 * A stepper with a typed value in the middle, clamped to the field's range.
 * @param {{meta: any, value: number, onChange: (v: number) => void, compact?: boolean}} props
 */
function NumberInput({ meta, value, onChange, compact = false }) {
  const [draft, setDraft] = React.useState(/** @type {string|null} */ (null));
  const dec = meta.decimals ?? 0;
  const step = meta.step ?? 1;
  const clampV = (v) => {
    const p = 10 ** dec;
    return Math.round(Math.min(meta.max ?? Infinity, Math.max(meta.min ?? -Infinity, v)) * p) / p;
  };
  const commit = (raw) => {
    const v = Number(raw);
    if (raw !== '' && Number.isFinite(v)) { const c = clampV(v); if (c !== value) onChange(c); }
    setDraft(null);
  };
  return (
    <div className={compact ? styles.numCompact : styles.num}>
      <button type="button" className={styles.step} aria-label={`Decrease ${meta.label}`} onClick={() => onChange(clampV(value - step))}>−</button>
      <input
        className={styles.numInput}
        inputMode="decimal"
        aria-label={meta.label}
        value={draft ?? Number(value).toFixed(dec)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(/** @type {HTMLInputElement} */ (e.target).value); }}
      />
      {!compact && meta.unit && <span className={styles.unit}>{meta.unit}</span>}
      <button type="button" className={styles.step} aria-label={`Increase ${meta.label}`} onClick={() => onChange(clampV(value + step))}>+</button>
    </div>
  );
}
