/**
 * Where a number came from: the base table value, each correction the ECU stacked on it
 * in the order it applied them, and what came out.
 *
 * Reads the breakdown `resolveEcuPoint` records — nothing here recomputes anything, so
 * what it shows is exactly what the engine was given.
 */

import React from 'react';

import styles from './CorrectionStack.module.css';

/**
 * @param {object} props
 * @param {{timing?: object[], fuel?: object[], boost?: object[], ve?: object[]}|null} props.breakdown
 * @param {{timing?: number, lambda?: number, boost?: number}} [props.result] what the
 *   engine actually ran — after knock control, which acts on top of the stack
 * @returns {React.ReactElement|null}
 */
export function CorrectionStack({ breakdown, result = {} }) {
  if (!breakdown) return null;
  const cols = [
    { key: 'timing', title: 'Spark', unit: '°', final: result.timing != null ? { label: 'Fired (after knock control)', value: result.timing } : null },
    { key: 'fuel', title: 'Fuel', unit: '', final: result.lambda != null ? { label: 'Delivered lambda', value: result.lambda, unit: 'λ' } : null },
    { key: 'boost', title: 'Boost', unit: 'psi', final: null },
  ].filter((c) => breakdown[c.key]?.length);
  return (
    <div className={styles.wrap}>
      {cols.map((c) => (
        <div key={c.key} className={styles.col}>
          <div className={styles.title}>{c.title}</div>
          <ol className={styles.list}>
            {breakdown[c.key].map((s, i) => (
              <li key={i} className={styles.row} data-base={i === 0 || undefined}>
                <span className={styles.label}>{s.label}</span>
                <span className={styles.value}>
                  {s.delta != null ? `${s.delta > 0 ? '+' : ''}${s.delta.toFixed(1)}` : fmt(s.value, s.unit)}
                  <span className={styles.unit}>{s.unit === '%' ? '%' : s.unit === 'λ' ? 'λ' : c.unit}</span>
                </span>
              </li>
            ))}
            {c.final && (
              <li className={styles.row} data-final>
                <span className={styles.label}>{c.final.label}</span>
                <span className={styles.value}>{fmt(c.final.value, c.final.unit)}<span className={styles.unit}>{c.final.unit ?? c.unit}</span></span>
              </li>
            )}
          </ol>
        </div>
      ))}
    </div>
  );
}

/** @param {number} v @param {string} [unit] */
function fmt(v, unit) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (unit === 'λ') return v.toFixed(3);
  if (unit === '%') return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  return v.toFixed(1);
}
