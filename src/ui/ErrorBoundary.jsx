/**
 * Error boundary.
 *
 * A physics simulator that can emit a NaN into JSX should fail loudly rather than
 * quietly render "NaN whp" and leave the user wondering. This catches render-time
 * crashes, shows what happened, and offers a way back without a manual reload.
 */

import React from 'react';

import { T } from './theme.js';
import { BUILD_VERSION } from '../version.js';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep this — it is the only breadcrumb a bug reporter can paste into an issue.
    console.error('ECU Lab crashed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        minHeight: '100dvh', background: T.bg, color: T.ink, fontFamily: T.sans,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: 24, gap: 14,
      }}>
        <div style={{ fontSize: 10.5, letterSpacing: 2, color: T.accInk, fontWeight: 800 }}>
          CARIBOU TUNING · ECU LAB
        </div>
        <div style={{ fontSize: 21, fontWeight: 800 }}>Something broke.</div>
        <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.65, maxWidth: 520 }}>
          The app hit an error it could not recover from. Your tune is still in memory
          until you reload. If you can reproduce this, please open an issue with the
          message below and what you were doing at the time — that is genuinely useful.
        </div>
        <pre style={{
          background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 10,
          padding: '12px 14px', fontSize: 11.5, fontFamily: T.mono, color: T.dangerInk,
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
        }}>
          {String(error?.stack || error?.message || error)}
        </pre>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '13px 22px', borderRadius: 11, border: 'none', background: T.acc,
              color: T.accOn, fontWeight: 800, fontSize: 13.5,
            }}
          >
            TRY AGAIN
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '13px 22px', borderRadius: 11, border: `1px solid ${T.line}`,
              background: T.panel2, color: T.inkSoft, fontWeight: 700, fontSize: 13.5,
            }}
          >
            RELOAD
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: T.ink2, fontFamily: T.mono }}>{BUILD_VERSION}</div>
      </div>
    );
  }
}
