/**
 * One accordion section: a header row that names the section, and a body that
 * collapses to nothing when it is not the open one.
 *
 * Every tab is built out of these, and each one is ADDRESSABLE: `active` and
 * `onClick` come from the route, so the open section is part of the URL and
 * clicking the open section's own header closes it, leaving the tab with none open
 * (see `toggleSection` in EcuLab.jsx). It is therefore navigation, not local state,
 * and the section owns neither.
 *
 * The body is HIDDEN, not unmounted: `max-height: 0` with an opacity fade, so the
 * transition has something to animate and so a control inside a closed section is
 * still in the document. Both halves of that are load-bearing — `tests/ui/
 * routing-shell.test.jsx` reads the inline `maxHeight` as a DOM-visible difference
 * between open and closed (`aria-expanded` and `inert` differ too), and
 * `tests/ui/build-store.test.jsx` reaches a slider inside a collapsed section. Do not
 * convert this component's inline styles to a stylesheet without re-pointing both.
 *
 * The shut body is `inert`: it stays mounted so it can animate, so jsdom and Testing
 * Library can still reach controls in it (build-store.test.jsx relies on that), but a
 * real user cannot read or Tab into it. A section that shuts with focus inside (the
 * back button, a route change) hands focus to its own header, or the browser would drop
 * it to <body>.
 *
 * Relocated from EcuLab.jsx by the screen split; it has since gained
 * aria-expanded, aria-controls and inert (issue 81).
 */

import { ChevronDown } from 'lucide-react';
import React, { useId, useLayoutEffect, useRef } from 'react';

import { T, accAlpha } from '../theme.js';

import { inertWhen } from './inert.js';

/**
 * @param {object} props
 * @param {boolean} props.active whether this is the tab's open section
 * @param {() => void} props.onClick toggles this section open or closed
 * @param {React.ElementType} props.icon Lucide icon component for the header
 * @param {string} props.label
 * @param {React.ReactNode} [props.sub] one line of current state, read while collapsed
 * @param {React.ReactNode} props.children
 * @returns {React.ReactElement}
 */
export function BuildSection({ active, onClick, icon: Icon, label, sub, children }) {
  const bodyId = useId();
  const headerRef = useRef(/** @type {HTMLButtonElement|null} */ (null));
  const bodyRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  // Layout, not passive: it has to run before the browser's focus fixup notices the
  // focused control went inert.
  useLayoutEffect(() => {
    if (!active && bodyRef.current?.contains(document.activeElement)) headerRef.current?.focus();
  }, [active]);
  return (
    <div style={{ marginBottom: 9 }}>
      <button ref={headerRef} type="button" aria-expanded={active} aria-controls={bodyId} onClick={onClick} style={{
        width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 14px',
        borderRadius: 11, border: `1px solid ${active ? T.acc : T.line}`, background: active ? T.accBg : T.panel2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left' }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: active ? accAlpha(0.18) : T.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={16} color={active ? T.accInk : T.ink2} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: active ? T.accInk : T.ink }}>{label}</div>
            {sub && <div style={{ fontSize: 10.5, color: T.ink2, marginTop: 1 }}>{sub}</div>}
          </div>
        </div>
        <ChevronDown aria-hidden="true" size={16} style={{ color: active ? T.accInk : T.ink3, flexShrink: 0, marginLeft: 8, transform: active ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      {/* A cap, because the tests read maxHeight, but one no section reaches: at 3000px
          Learn How It Works (2400px of titles before any article opens) cut off whatever
          was opened past it. The easing differs by direction so a close still starts
          at once instead of spending most of its time above the content's real height. */}
      {/* inert while shut: still mounted so it can animate, but neither read nor tabbable. */}
      <div ref={bodyRef} id={bodyId} {...inertWhen(!active)} style={{ maxHeight: active ? 20000 : 0, opacity: active ? 1 : 0, overflow: 'hidden', transition: active ? 'max-height .6s ease-in, opacity .25s ease' : 'max-height .35s cubic-bezier(0, 1, 0, 1), opacity .25s ease' }}>
        <div style={{ padding: '13px 2px 2px' }}>{children}</div>
      </div>
    </div>
  );
}
