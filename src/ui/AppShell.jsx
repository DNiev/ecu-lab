/**
 * The application shell: the section nav, the always-visible status strip, and the
 * capped column the current screen is rendered into.
 *
 * WHAT THIS OWNS
 * Chrome, and only chrome. `AppShell` is handed the current route and a callback for
 * "the player asked for this tab"; it never reads `window.location`, never decides
 * what a tab means, and never knows which screen its `children` happen to be. The
 * screens, symmetrically, know nothing about navigation — none of them imports this
 * file.
 *
 * WHY `onNavigate` RATHER THAN `navigate`
 * Switching tabs is not just a route change: it also clears the tuning grid's cursor,
 * so a cell selected on TUNE does not come back with the dock still docked when you
 * return. That side effect belongs to the app, not to the chrome, so the shell asks
 * for a tab by id and `EcuLab.jsx` decides what that costs (`changeTab` = go to the
 * tab's first section + clear the selection). Handing this component the raw
 * `navigate` would have quietly dropped the second half.
 *
 * `onTutorial`/`onRepair` follow the same shape: the strip's two icon buttons ask for
 * "open the tutorial" and "repair the engine" by name, and `EcuLab.jsx` supplies
 * `goTutorial`/`repairEngine` — the same handlers the old hand-rolled header used.
 * The shell never dispatches to the store directly.
 *
 * THE 20 Hz PROBLEM
 * `LIVE_STEP` dispatches twenty times a second while the engine runs, and the strip is
 * visible on every tab — so anything in here that reads the store pays that cost on
 * every screen, not just HOME. The store is a SINGLE context whose value is a fresh
 * `[state, dispatch]` tuple per dispatch, so every consumer re-renders on every action
 * regardless of which slice it reads; `useSession()` cannot be memoised around. That
 * is a limitation of the store's shape, and fixing it means selector-based
 * subscription in `StoreProvider.jsx` — out of scope here. What this file does within
 * it:
 *
 *   - `SideNav` reads NOTHING from the store, so `React.memo` genuinely bails it out:
 *     the four buttons and their icons do not re-render at 20 Hz. That only holds
 *     while `onNavigate` is referentially stable, which is why `changeTab` in
 *     EcuLab.jsx is a `useCallback`.
 *   - `StatusStrip` reads build + session but NOT `live`; its leaves are memoised, so
 *     a LIVE_STEP re-runs the strip's own body and stops there.
 *   - `EngineRunLight` is the only thing in the shell that touches `live`. It is a
 *     leaf on purpose: when the store grows selectors, it is the one component that
 *     should subscribe to the live model, and the boundary is already drawn.
 */

import {
  Activity, Flame, Gauge, Grid3x3, Info, Settings, Wrench,
} from 'lucide-react';
import React, { useMemo } from 'react';

import {
  INJECTOR_OPTS, OCTANE_OPTS, deriveEngine, presetById,
} from '../sim/index.js';
import { BUILD_VERSION } from '../version.js';
import { Button } from './primitives/Button.jsx';
import { useBuild, useSession } from './state/StoreProvider.jsx';
import { statusTone } from './theme.js';

import styles from './AppShell.module.css';

/** @typedef {import('./routing.js').Route} Route */

/**
 * Four top-level destinations instead of seven. The three tuning tables and the
 * fuel/ECU controls live under TUNE as sub-views — same depth, far less to scan, and
 * much bigger touch targets.
 *
 * These are the tabs that exist today, so there are four of them. #83 re-sections
 * TUNE and BUILD into more pages; a fifth item added before that lands would be a
 * destination with nothing behind it.
 *
 * @type {Array<{id: string, label: string, icon: React.ElementType}>}
 */
// The order is the real working order: design it, calibrate it, HEAR IT RUN, then
// measure it. LIVE used to be a collapsed section on HOME, several taps down and easy
// never to find — a poor place for the one screen that shows a calibration running.
const NAV_ITEMS = [
  { id: 'dash', label: 'HOME', icon: Gauge },
  { id: 'build', label: 'BUILD', icon: Settings },
  { id: 'tune', label: 'TUNE', icon: Grid3x3 },
  { id: 'live', label: 'LIVE', icon: Flame },
  { id: 'dyno', label: 'DYNO', icon: Activity },
];

/**
 * The section nav: a bottom bar on a phone, a side rail from the breakpoint up. One
 * component and one stylesheet, not two of each — see AppShell.module.css.
 *
 * The active item carries `aria-current="page"`, and the styling hangs off that same
 * attribute. The bar this replaced marked the active tab with colour and a 2px rule
 * alone, which is nothing at all to a screen reader.
 *
 * @param {object} props
 * @param {string|null} props.tab id of the active tab, or null outside the app view
 * @param {(tab: string) => void} props.onNavigate
 * @returns {React.ReactElement}
 */
function SideNavInner({ tab, onNavigate }) {
  return (
    <nav className={styles.nav} aria-label="Sections">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={styles.navItem}
          // `undefined`, not "false": aria-current is a token list, and the string
          // "false" is the one spelling that means "not current" while still being
          // present in the DOM. Omitting the attribute is what an assertion can see.
          aria-current={tab === id ? 'page' : undefined}
          onClick={() => onNavigate(id)}
        >
          <Icon size={17} aria-hidden="true" />
          <span className={styles.navLabel}>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * Memoised because it is always mounted and reads no store: with a stable
 * `onNavigate` this subtree is skipped entirely on every LIVE_STEP.
 */
export const SideNav = React.memo(SideNavInner);

/**
 * One labelled readout in the strip. Memoised: `StatusStrip` re-renders on every
 * store action (see this file's header), and these props only change when the
 * quantity they show does.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.value
 * @param {'ok'|'warn'|'danger'} [props.tone]
 * @returns {React.ReactElement}
 */
function StripFieldInner({ label, value, tone }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue} data-tone={tone}>{value}</span>
    </div>
  );
}

const StripField = React.memo(StripFieldInner);

/**
 * Engine health: the same worst-of-three figure the header used to show, as a bar and
 * a percentage. Memoised for the same reason as `StripField`.
 *
 * @param {object} props
 * @param {number} props.pct 0-100
 * @returns {React.ReactElement}
 */
function HealthFieldInner({ pct }) {
  const tone = statusTone(pct);
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>HEALTH</span>
      <span className={styles.healthTrack}>
        <span className={styles.healthFill} data-tone={tone} style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.fieldValue} data-tone={tone}>{Math.round(pct)}%</span>
    </div>
  );
}

const HealthField = React.memo(HealthFieldInner);

/**
 * THE 20 Hz COMPONENT. `session.live` is rewritten twenty times a second by LIVE_STEP
 * and this is the only thing in the shell that reads it — deliberately a leaf, so the
 * rest of the strip is not dragged along by it. See this file's header for what the
 * single-context store means for that in practice today.
 *
 * @returns {React.ReactElement|null}
 */
function EngineRunLight() {
  const [session] = useSession();
  if (!session.live.running) return null;
  return <span className={styles.run}>● RUNNING</span>;
}

/**
 * The always-visible status strip: what is built, how hard it is boosted, how healthy
 * it is, and what the last pull made. Engine state never leaves the screen.
 *
 * It reads the store itself rather than being handed props by the app — the shell is
 * mounted once and outlives every screen, so threading five values through
 * `EcuLab.jsx` would only move the same re-render one level up.
 *
 * `onTutorial`/`onRepair` are the exception: what those two icon buttons DO is not
 * chrome's business (see this file's header), so they arrive as props from
 * `EcuLab.jsx` exactly like `onNavigate` does, and are rendered here because this is
 * where the header's icon buttons used to live.
 *
 * @param {object} props
 * @param {() => void} [props.onTutorial]
 * @param {() => void} [props.onRepair]
 * @returns {React.ReactElement}
 */
export function StatusStrip({ onTutorial, onRepair }) {
  const [build] = useBuild();
  const [session] = useSession();
  const { engineConfig, presetId, turboOn, boostCurve, octaneIdx, injIdx } = build;
  const { health, result } = session;

  // Keyed on `engineConfig` so the 20 Hz re-render does not re-derive the engine
  // twenty times a second to print the same string.
  const derived = useMemo(() => deriveEngine(engineConfig), [engineConfig]);
  const preset = presetId ? presetById(presetId) : null;
  const engineName = preset
    ? preset.name
    : `${derived.displacementL.toFixed(1)}L ${engineConfig.configuration}`;

  const overallHealth = Math.min(health.piston, health.bearing, health.valve);
  // Peak of the curve, not the value at any one RPM: this is "how much boost is this
  // build asking for", which is a single number a strip can hold.
  const peakBoost = turboOn ? Math.max(...boostCurve) : 0;

  return (
    <div className={styles.strip}>
      <div className={styles.stripInner}>
        {/* The maker + product name. The old hand-rolled header (deleted with it,
            d5d9f66) carried these as its own two-line block; StatusStrip had no
            equivalent, so once a player pressed START the app was nameless. Restored
            here at the strip's leading edge, sized for a slim strip rather than a
            transplant of the header's larger type scale — see AppShell.module.css. */}
        <div className={styles.brand}>
          <span className={styles.brandMaker}>CARIBOU TUNING</span>
          <span className={styles.brandProduct}>ECU Lab</span>
        </div>
        {/* The build line, moved here from the header. Its shape is pinned by
            characterisation.test.jsx and build-store.test.jsx, both of which find it
            by `data-testid="build-line"` and split the engine name off its first `·`
            segment. Query by this testid rather than by text — BUILD's accordion
            sections stay mounted when collapsed, so any BUILD-tab prose containing
            "oct" (e.g. an octane explainer) would otherwise be an ambiguous match
            for a text-based query. */}
        <div className={styles.engine} data-testid="build-line">
          {engineName} · {turboOn ? 'Turbo' : 'N/A'} · {OCTANE_OPTS[octaneIdx].label} oct · {INJECTOR_OPTS[injIdx].label} · {BUILD_VERSION}
        </div>
        <StripField label="BOOST" value={turboOn ? `${peakBoost.toFixed(1)} psi` : 'N/A'} />
        <HealthField pct={overallHealth} />
        <StripField label="LAST PULL" value={result ? `${Math.round(result.peakHp)} hp` : '—'} />
        <EngineRunLight />
        {/* Icon-only, so the label has to be spelled out: `title` alone leaves a
            button whose accessible name depends on the tooltip surviving. Note the
            lower-case names — the start screen's TUTORIAL button is queried by exact
            name and must stay the only match. Moved here verbatim from the header
            this strip replaced. */}
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" title="Tutorial" aria-label="Tutorial" onClick={onTutorial}>
            <Info size={16} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" title="Repair engine" aria-label="Repair engine" onClick={onRepair}>
            <Wrench size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {Route} props.route the current route; only `tab` is chrome's business
 * @param {(tab: string) => void} props.onNavigate what a nav item means
 * @param {() => void} [props.onTutorial] what the strip's Tutorial button means
 * @param {() => void} [props.onRepair] what the strip's Repair engine button means
 * @param {React.ReactNode} props.children the screen for the current route
 * @returns {React.ReactElement}
 */
export function AppShell({
  route, onNavigate, onTutorial, onRepair, children,
}) {
  return (
    <div className={styles.shell}>
      <SideNav tab={route.tab} onNavigate={onNavigate} />
      <div className={styles.main}>
        <StatusStrip onTutorial={onTutorial} onRepair={onRepair} />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

export default AppShell;
