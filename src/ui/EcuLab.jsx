/**
 * ECU LAB — the application shell and screens.
 *
 * WHAT THIS FILE IS
 * Presentation only. It reads the simulation's output but contains no physics — if
 * you find yourself doing engineering maths in here, it belongs in `src/sim/`
 * instead. That separation is what keeps the physics testable in plain Node.
 *
 * LAYOUT
 * Shared primitives first, then the screens. Screens are plain conditional blocks
 * inside one component, each marked with a banner comment.
 *
 * KNOWN WORK IN PROGRESS
 * This file is still the original single-component app. Decomposing it into
 * `ui/primitives/` and `ui/screens/` is tracked as follow-up work — see CONTRIBUTING.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
  Gauge, Grid3x3, Zap, Droplets, Wind, Activity, RotateCcw, Play, AlertTriangle, Info,
  Wrench, Settings, Package, Flame, ChevronDown, Trophy, TrendingUp, BookOpen, Fuel,
} from 'lucide-react';

import {
  BARO_KPA, COMPRESSOR_OPTS, CONFIG_OPTS, CYL_COUNT, DEFAULT_AFR, DEFAULT_BOOST,
  DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, DEFAULT_TIMING, EXHAUST_DIA_OPTS, INJ_DEADTIME_MS,
  INJECTOR_OPTS, LOAD, MATERIAL_OPTS, MOD_INFO, OCTANE_OPTS, PSI_TO_KPA, R_AIR, RPM,
  TURBINE_OPTS, calibrationAdvice, chargeTempK, clamp, clone2D, computeEngineerScore,
  computeHardwareVE, computePullScore, computeTuningScore, deriveEngine,
  idealExhaustDiameter, interp2, liveStep, makeLiveState, simulateSweep, veRecommendations
} from '../sim/index.js';
import { T, heat, statusColor } from './theme.js';
import { BUILD_VERSION } from '../version.js';
import { loadCareer, saveCareer } from '../storage.js';

const Eyebrow = ({ children, icon: Icon }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
    <div style={{ width: 3, height: 13, background: T.amber, borderRadius: 2 }} />
    {Icon && <Icon size={13} color={T.amberInk} />}
    <span style={{ fontSize: 10.5, letterSpacing: 1.6, color: T.amberInk, textTransform: 'uppercase', fontWeight: 800 }}>{children}</span>
  </div>
);

const Panel = ({ children, style, tight }) => (
  <div style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, padding: tight ? '10px 12px' : 14, ...style }}>
    {children}
  </div>
);

const Note = ({ children, tone = 'info' }) => {
  const colors = { info: [T.ink2, T.line, T.panel2], warn: [T.yellow, '#3a2f16', T.yellowBg] };
  const [fg, bd, bgc] = colors[tone] || colors.info;
  return (
    <div style={{ display: 'flex', gap: 9, background: bgc, border: `1px solid ${bd}`, borderRadius: 10, padding: '11px 13px', margin: '10px 0', fontSize: 12.5, color: fg === T.ink2 ? '#b7c0c9' : fg, lineHeight: 1.55 }}>
      <Info size={15} style={{ flexShrink: 0, marginTop: 1, color: fg }} />
      <div>{children}</div>
    </div>
  );
};

function ExpandableInfo({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '10px 0', border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden', background: T.panel }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 13px', background: 'none', border: 'none' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, color: T.ink, fontSize: 12.5, fontWeight: 700, textAlign: 'left' }}>
          <Info size={14} style={{ color: T.amber, flexShrink: 0 }} />{title}
        </span>
        <ChevronDown size={15} style={{ color: T.ink3, flexShrink: 0, marginLeft: 8, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      <div style={{ maxHeight: open ? 900 : 0, opacity: open ? 1 : 0, overflow: 'hidden', transition: 'max-height .3s ease, opacity .2s ease' }}>
        <div style={{ padding: '0 13px 13px', fontSize: 12.5, color: '#a5aebb', lineHeight: 1.65 }}>{children}</div>
      </div>
    </div>
  );
}

// Segmented row of equal-width option buttons — replaces the repeated
// flex-row-of-buttons pattern used all over the tuning screens.
function Seg({ options, value, onChange, wrap }) {
  return (
    <div style={{ display: 'flex', gap: 7, marginBottom: 4, flexWrap: wrap ? 'wrap' : 'nowrap' }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            flex: wrap ? '1 1 30%' : 1, padding: '11px 4px', borderRadius: 9, fontWeight: 700, fontSize: 12.5,
            border: `1px solid ${active ? T.amber : T.line}`, background: active ? T.amberBg : T.panel2,
            color: active ? T.amberInk : T.ink2, transition: 'all .15s',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// Full-width descriptive rows for choices that need a subtitle (turbine, injectors).
function PickList({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            textAlign: 'left', padding: '11px 13px', borderRadius: 9, fontWeight: 600, fontSize: 13,
            border: `1px solid ${active ? T.amber : T.line}`, background: active ? T.amberBg : T.panel2,
            color: active ? T.amberInk : '#c3cad2',
          }}>{o.label}{o.sub && <div style={{ fontSize: 11, color: T.ink2, marginTop: 2, fontWeight: 400 }}>{o.sub}</div>}</button>
        );
      })}
    </div>
  );
}

function ToggleRow({ label, sub, checked, onChange, color = T.amber }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 10, padding: 13 }}>
      <div style={{ marginRight: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: T.ink }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 1 }}>{sub}</div>}
      </div>
      <button onClick={() => onChange(!checked)} style={{ width: 48, height: 27, borderRadius: 14, border: 'none', position: 'relative', flexShrink: 0, background: checked ? color : '#2a323a', transition: 'background .2s' }}>
        <div style={{ position: 'absolute', top: 3, left: checked ? 24 : 3, width: 21, height: 21, borderRadius: 11, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.4)' }} />
      </button>
    </div>
  );
}

function StatTile({ label, value, unit, color = T.ink, flex = 1 }) {
  return (
    <div style={{ flex, background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 11, padding: 13 }}>
      <div style={{ fontSize: 9.5, color: T.ink2, letterSpacing: 1, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: T.mono, color, marginTop: 2 }}>{value}<span style={{ fontSize: 11.5, color: T.ink2, marginLeft: 3, fontWeight: 600 }}>{unit}</span></div>
    </div>
  );
}

function HealthBar({ label, value }) {
  const c = statusColor(value);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: T.ink2, marginBottom: 4, fontWeight: 600 }}>
        <span>{label}</span><span style={{ color: c, fontWeight: 800 }}>{Math.round(value)}%</span>
      </div>
      <div style={{ height: 7, background: T.panel, borderRadius: 4, overflow: 'hidden', border: `1px solid ${T.line}` }}>
        <div style={{ width: `${value}%`, height: '100%', background: c, borderRadius: 4, transition: 'width .4s', boxShadow: `0 0 8px ${c}66` }} />
      </div>
    </div>
  );
}

// Guided first run. Walks a new player through the actual working order a tuner
// uses — build the engine, calibrate it, hear it run, then measure it — and then
// gets out of the way. Purely navigational: it never changes the simulation.
const JOURNEY = [
  { tab: 'build', title: 'Step 1 · Build the engine',
    body: 'Open Engine Architecture and design a short block: bore, stroke, compression, cam, springs. Then fit parts under Bolt-Ons. Nothing here is cosmetic — every choice changes how the engine breathes.',
    cta: 'Done building — go tune it', next: 'tune' },
  { tab: 'tune', title: 'Step 2 · Calibrate it',
    body: 'AIR is your airflow log — if it is stale after your build, accept the re-logged values. Then SPARK sets ignition timing and FUEL sets the mixture. The advisories tell you what your hardware will tolerate; the editing is yours.',
    cta: 'Calibration set — start the engine', next: 'dash' },
  { tab: 'dash', title: 'Step 3 · Start it and listen',
    body: 'Open Live Engine and press START. Watch it idle, hold the throttle to rev it, and watch the sensors and fuel trims respond in real time. This is your calibration actually running.',
    cta: 'Sounds good — put it on the dyno', next: 'dyno' },
  { tab: 'dyno', title: 'Step 4 · Measure it',
    body: 'Run a pull. Then read the Pull Log before you look at the power number — it explains anything that went wrong and what to change. From here the loop is: adjust, pull again, compare.',
    cta: 'Finish — let me explore freely', next: null },
];

function JourneyBanner({ step, onAdvance, onDismiss }) {
  const j = JOURNEY[step];
  if (!j) return null;
  return (
    <div style={{ background: T.amberBg, border: `1px solid ${T.amber}`, borderRadius: 12, padding: '13px 14px', margin: '0 0 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: 1, color: T.amberInk, fontWeight: 800 }}>{j.title.toUpperCase()}</div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: T.ink3, fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>SKIP GUIDE</button>
      </div>
      <div style={{ fontSize: 12.5, color: '#c3cad2', lineHeight: 1.55, marginTop: 7 }}>{j.body}</div>
      <div style={{ display: 'flex', gap: 5, marginTop: 11, marginBottom: 10 }}>
        {JOURNEY.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? T.amber : T.line }} />
        ))}
      </div>
      <button onClick={onAdvance} style={{ width: '100%', padding: '11px 0', borderRadius: 9, border: 'none', background: T.amber, color: '#1a0f08', fontWeight: 800, fontSize: 12.5 }}>
        {j.cta}
      </button>
    </div>
  );
}

function BuildSection({ active, onClick, icon: Icon, label, sub, children }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <button onClick={onClick} style={{
        width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 14px',
        borderRadius: 11, border: `1px solid ${active ? T.amber : T.line}`, background: active ? T.amberBg : T.panel2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left' }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: active ? 'rgba(255,106,44,0.18)' : T.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={16} color={active ? T.amberInk : T.ink2} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: active ? T.amberInk : T.ink }}>{label}</div>
            {sub && <div style={{ fontSize: 10.5, color: T.ink2, marginTop: 1 }}>{sub}</div>}
          </div>
        </div>
        <ChevronDown size={16} style={{ color: active ? T.amberInk : T.ink3, flexShrink: 0, marginLeft: 8, transform: active ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      <div style={{ maxHeight: active ? 3000 : 0, opacity: active ? 1 : 0, overflow: 'hidden', transition: 'max-height .35s ease, opacity .25s ease' }}>
        <div style={{ padding: '13px 2px 2px' }}>{children}</div>
      </div>
    </div>
  );
}

// Signature visual motif: a dial/gauge, used both as the static brand mark
// (Start screen) and as the live, RPM-driven readout (Dyno tab).
function DialMark({ size = 64, pct = 0.62, live = false }) {
  const angle = -120 + pct * 240;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <circle cx="50" cy="50" r="44" fill={T.panel2} stroke={T.line} strokeWidth="1.5" />
      {Array.from({ length: 13 }).map((_, i) => {
        const a = (-120 + (i / 12) * 240) * (Math.PI / 180);
        const inner = 34, outer = i % 3 === 0 ? 28 : 31;
        return (
          <line key={i}
            x1={50 + inner * Math.sin(a)} y1={50 - inner * Math.cos(a)}
            x2={50 + outer * Math.sin(a)} y2={50 - outer * Math.cos(a)}
            stroke={i > 9 ? T.red : T.line === T.line ? '#3a4149' : T.line} strokeWidth={i % 3 === 0 ? 1.6 : 1} />
        );
      })}
      <g style={{ transition: live ? 'none' : 'transform .6s cubic-bezier(.34,1.4,.64,1)' }} transform={`rotate(${angle} 50 50)`}>
        <line x1="50" y1="50" x2="50" y2="20" stroke={T.amber} strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="50" r="5" fill={T.amber} />
    </svg>
  );
}

function Tach({ rpm, cylinders, running }) {
  const pct = clamp(rpm / 7500, 0, 1);
  const zoneColor = pct > 0.93 ? T.red : pct > 0.75 ? T.yellow : T.green;
  return (
    <Panel style={{ textAlign: 'center', background: T.panel }}>
      <style>{`@keyframes cylpulse{0%,100%{opacity:.25;transform:scaleY(.6)}50%{opacity:1;transform:scaleY(1)}}`}</style>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <DialMark size={168} pct={pct} live={running} />
        <div style={{ position: 'absolute', top: '58%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 800, fontFamily: T.mono, color: T.ink }}>{Math.round(rpm)}</div>
          <div style={{ fontSize: 8.5, color: T.ink3, letterSpacing: 1.5, fontWeight: 700 }}>RPM</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 8, height: 26 }}>
        {Array.from({ length: cylinders }).map((_, i) => (
          <div key={i} style={{
            width: 8, height: 24, borderRadius: 2, background: zoneColor,
            animation: running ? `cylpulse ${Math.max(0.12, 50 / Math.max(rpm, 500))}s ease-in-out infinite` : 'none',
            animationDelay: `${i * (0.5 / cylinders)}s`, opacity: running ? undefined : 0.3,
          }} />
        ))}
      </div>
    </Panel>
  );
}

// ============================================================
function TuningGrid({ data, min, max, decimals, selection, setSelection }) {
  const fmt = (v) => (decimals ? v.toFixed(decimals) : Math.round(v));
  const selectCell = (row, col) => setSelection({ type: 'cell', row, col });
  const selectRow = (row) => setSelection({ type: 'row', row });
  const selectCol = (col) => setSelection({ type: 'col', col });
  const isSelected = (row, col) => {
    if (!selection) return false;
    if (selection.type === 'cell') return selection.row === row && selection.col === col;
    if (selection.type === 'row') return selection.row === row;
    if (selection.type === 'col') return selection.col === col;
    return false;
  };
  return (
    <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: T.ink3, fontWeight: 700, letterSpacing: 0.8, marginBottom: 4 }}>
      <span>MAP kPa &darr;</span><span>RPM &rarr;</span>
    </div>
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: `1px solid ${T.line}`, borderRadius: 10 }}>
      <div style={{ display: 'inline-block', minWidth: '100%' }}>
        <div style={{ display: 'flex' }}>
          <div style={{ width: 44, flexShrink: 0, background: T.panel }} />
          {RPM.map((r, ci) => (
            <button key={r} onClick={() => selectCol(ci)} style={{
              width: 51, height: 30, flexShrink: 0, border: 'none', borderBottom: `1px solid ${T.line}`, borderLeft: `1px solid ${T.line}`,
              background: selection?.type === 'col' && selection.col === ci ? T.amber : T.panel,
              color: selection?.type === 'col' && selection.col === ci ? '#1a0f08' : T.ink2,
              fontFamily: T.mono, fontSize: 10, fontWeight: 700,
            }}>{r}</button>
          ))}
        </div>
        {LOAD.map((load, ri) => (
          <div key={load} style={{ display: 'flex' }}>
            <button onClick={() => selectRow(ri)} style={{
              width: 44, height: 37, flexShrink: 0, border: 'none', borderRight: `1px solid ${T.line}`, borderTop: `1px solid ${T.line}`,
              background: selection?.type === 'row' && selection.row === ri ? T.amber : T.panel,
              color: selection?.type === 'row' && selection.row === ri ? '#1a0f08' : T.ink2,
              fontFamily: T.mono, fontSize: 10, fontWeight: 700,
            }}>{load}</button>
            {data[ri].map((val, ci) => (
              <button key={ci} onClick={() => selectCell(ri, ci)} style={{
                width: 51, height: 37, flexShrink: 0,
                border: isSelected(ri, ci) ? `2px solid ${T.ink}` : `1px solid rgba(0,0,0,0.35)`,
                background: heat(val, min, max), color: '#f2f5f7',
                fontFamily: T.mono, fontSize: 12, fontWeight: 700,
              }}>{fmt(val)}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}

// Reference data for a selected cell. Deliberately DESCRIPTIVE, not predictive:
// it tells you what this parameter does and what range is normal here, but never
// simulates an outcome — only a real dyno pull produces results in this sandbox.
function cellReference(kind, row, col, value) {
  const rpm = RPM[col], map = LOAD[row];
  const boosted = map > 105, wot = map >= 95, cruise = map <= 70;
  const highRpm = rpm >= 5500, lowRpm = rpm <= 2500;
  if (kind === 've') {
    const typical = boosted ? '95-110%' : wot ? (highRpm ? '80-95%' : lowRpm ? '60-75%' : '90-100%') : (cruise ? '55-80%' : '75-90%');
    return {
      what: 'Cylinder filling efficiency at this manifold pressure — how completely the cylinder fills relative to the pressure available.',
      typical: `Typical here: ${typical}.`,
      affects: 'Feeds the air-mass calculation (airCharge = VE x V_cyl x MAP/RT). Raising it raises fuel demand and pulse width at this point.',
      note: boosted ? 'Above ~105 kPa you are in boost — these rows only get used once a turbo is fitted.' : null,
    };
  }
  if (kind === 'timing') {
    const typical = boosted ? '14-24°' : wot ? (lowRpm ? '12-20°' : highRpm ? '28-38°' : '22-32°') : '32-45°';
    return {
      what: 'Spark advance before top dead center, aiming to land peak cylinder pressure ~16° after TDC.',
      typical: `Typical here: ${typical}. Low manifold pressure tolerates far more advance; boost tolerates much less.`,
      affects: 'Torque rises toward MBT then flattens. Beyond the knock limit the ECU pulls it back during the pull.',
      note: boosted && value > 28 ? 'Aggressive for a boosted cell — cylinder pressure is already high here.' : null,
    };
  }
  const typical = boosted ? '11.5-12.3:1' : wot ? '12.5-13.2:1' : cruise ? '14.7:1 (stoich, closed loop)' : '13.5-14.5:1';
  return {
    what: 'Commanded air:fuel ratio, gasoline-equivalent. Divide by 14.7 for lambda.',
    typical: `Typical here: ${typical}.`,
    affects: 'Sets fuel mass, and therefore pulse width and duty cycle. Richer cools combustion and resists knock; leaner raises EGT and knock risk.',
    note: boosted && value > 12.8 ? 'Lean for a boosted cell — this is where lean mixtures burn pistons.' : cruise && value < 14 ? 'Richer than needed for cruise — wastes fuel with no power gain at this load.' : null,
  };
}

function SelectionDock({ data, setData, selection, min, max, decimals, unit, onClose, kind }) {
  if (!selection) return null;
  let current;
  if (selection.type === 'cell') current = data[selection.row][selection.col];
  else if (selection.type === 'row') current = data[selection.row].reduce((a, b) => a + b, 0) / data[selection.row].length;
  else current = data.reduce((a, r) => a + r[selection.col], 0) / data.length;

  const apply = (delta) => {
    const next = clone2D(data);
    if (selection.type === 'cell') next[selection.row][selection.col] = Number(clamp(next[selection.row][selection.col] + delta, min, max).toFixed(2));
    else if (selection.type === 'row') next[selection.row] = next[selection.row].map((v) => Number(clamp(v + delta, min, max).toFixed(2)));
    else next.forEach((r) => { r[selection.col] = Number(clamp(r[selection.col] + delta, min, max).toFixed(2)); });
    setData(next);
  };
  const setAbs = (v) => {
    const next = clone2D(data);
    if (selection.type === 'cell') next[selection.row][selection.col] = clamp(v, min, max);
    else if (selection.type === 'row') next[selection.row] = next[selection.row].map(() => clamp(v, min, max));
    else next.forEach((r) => { r[selection.col] = clamp(v, min, max); });
    setData(next);
  };
  const smallStep = decimals ? 0.1 : 1;
  const bigStep = decimals ? 1 : 5;
  let sel = 'Cell';
  if (selection.type === 'row') sel = `Row · ${LOAD[selection.row]} kPa MAP`;
  else if (selection.type === 'col') sel = `Column · ${RPM[selection.col]} RPM`;
  else sel = `${RPM[selection.col]} RPM · ${LOAD[selection.row]} kPa MAP`;

  return (
    <div style={{ position: 'sticky', bottom: 0, background: T.panel, borderTop: `1px solid ${T.line}`, padding: '11px 14px 13px', boxShadow: '0 -8px 20px rgba(0,0,0,0.45)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1, color: T.ink2, textTransform: 'uppercase', fontWeight: 700 }}>{sel}</div>
          <div style={{ fontFamily: T.mono, fontSize: 23, fontWeight: 800, color: T.ink }}>
            {decimals ? current.toFixed(decimals) : Math.round(current)}<span style={{ fontSize: 12, color: T.ink2, marginLeft: 4 }}>{unit}</span>
          </div>
        </div>
        <button onClick={onClose} style={{ color: T.ink2, background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 11.5, fontWeight: 700, padding: '8px 14px' }}>DONE</button>
      </div>
      {selection.type === 'cell' && kind && (() => {
        const ref = cellReference(kind, selection.row, selection.col, current);
        return (
          <div style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 9, padding: '9px 11px', marginBottom: 9, fontSize: 11.5, lineHeight: 1.55, color: '#a5aebb' }}>
            <div style={{ fontSize: 9.5, letterSpacing: 1, color: T.cyan, fontWeight: 800, marginBottom: 5 }}>REFERENCE · {RPM[selection.col]} RPM / {LOAD[selection.row]} kPa</div>
            <div>{ref.what}</div>
            <div style={{ marginTop: 4, color: T.ink }}>{ref.typical}</div>
            <div style={{ marginTop: 4 }}><b style={{ color: '#c3cad2' }}>Affects: </b>{ref.affects}</div>
            {ref.note && <div style={{ marginTop: 4, color: T.yellow }}>{ref.note}</div>}
          </div>
        );
      })()}
      <input type="range" min={min} max={max} step={smallStep} value={current} onChange={(e) => setAbs(Number(e.target.value))} style={{ width: '100%', accentColor: T.amber }} />
      <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
        {[-bigStep, -smallStep, smallStep, bigStep].map((d, i) => (
          <button key={i} onClick={() => apply(d)} style={{
            flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel2,
            color: d < 0 ? '#ff9d7a' : T.green, fontWeight: 800, fontFamily: T.mono, fontSize: 13,
          }}>{d > 0 ? '+' : ''}{d}</button>
        ))}
      </div>
    </div>
  );
}

const TUTORIAL_STEPS = [
  { title: 'This is an air pump',
    body: 'An engine makes power by burning fuel, and it can only burn as much fuel as it has air to burn it with. So everything starts with airflow. The ECU measures the air, decides how much fuel to inject, and picks the moment to light it. Tuning is adjusting those last two decisions.' },
  { title: 'Design it on BUILD',
    body: 'Bore, stroke, compression, cam duration, valve springs, materials, turbo, exhaust. None of it is cosmetic — every choice feeds the physics. Change the cam and watch the VE table on TUNE redraw itself, because that is genuinely what changing a cam does to an engine.' },
  { title: 'Three tables, three jobs',
    body: 'On TUNE: AIR (volumetric efficiency — how well each cylinder fills), SPARK (ignition timing in degrees before top dead center), FUEL (target air-fuel ratio). Rows are manifold pressure in kPa, columns are RPM — the same axes real speed-density tuning software uses.' },
  { title: 'Nothing is simulated until you pull',
    body: 'No preview, no live guess. Press RUN DYNO PULL on DYNO and the engine sweeps 800 to 7500 RPM, producing a real datalog. That is the only way to find out what your changes did — exactly like a real dyno session.' },
  { title: 'Read the log before touching anything',
    body: 'Every pull produces a Pull Log. Each problem gets a plain-language Why (what physically caused it) and a Try (what to change). The datalog next to it shows commanded vs. actual for timing and mixture. A gap between those two columns is the ECU telling you something.' },
  { title: 'Change one thing, then pull again',
    body: 'This is the entire method: one change, one pull, read the log, adjust. The VS. LAST PULL line tells you whether it actually helped. Tuners who change three things at once cannot tell which one worked — and tuners who guess instead of logging break engines.' },
  { title: 'Know what you cannot tune away',
    body: 'Knock, mixture and MAF errors are calibration faults — tables fix them completely. Injectors out of duty cycle, valve float, a compressor past its range: those are physical limits, and the log will tell you so. Recognising which kind you are looking at is most of the skill.' },
  { title: 'Chase the score',
    body: 'Every pull grades Tuning (how clean the calibration is) and Engineer (how sound the hardware choices are), then combines them with actual output into an uncapped Pull Score. A big, slightly dirty pull can beat a small spotless one — the same tension a real tuner balances.' },
];

function TutorialScreen({ onDone }) {
  const [step, setStep] = useState(0);
  const s = TUTORIAL_STEPS[step];
  const last = step === TUTORIAL_STEPS.length - 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: T.bg, color: T.ink, fontFamily: T.sans }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px' }}>
        <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: T.amberInk, fontWeight: 800 }}>TUTORIAL · {step + 1}/{TUTORIAL_STEPS.length}</div>
        <button onClick={onDone} style={{ background: 'none', border: 'none', color: T.ink3, fontSize: 12, fontWeight: 700 }}>SKIP</button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 24px' }}>
        <div style={{ fontSize: 21, fontWeight: 800, marginBottom: 13, letterSpacing: -0.3 }}>{s.title}</div>
        <div style={{ fontSize: 14.5, color: '#c3cad2', lineHeight: 1.7 }}>{s.body}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '0 0 18px' }}>
        {TUTORIAL_STEPS.map((_, i) => (
          <div key={i} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3, background: i === step ? T.amber : T.line, transition: 'width .2s' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, padding: '0 16px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
        {step > 0 && (
          <button onClick={() => setStep((v) => v - 1)} style={{ flex: 1, padding: '15px 0', borderRadius: 12, border: `1px solid ${T.line}`, background: T.panel2, color: '#c3cad2', fontWeight: 700, fontSize: 14 }}>BACK</button>
        )}
        <button onClick={() => (last ? onDone() : setStep((v) => v + 1))} style={{ flex: 2, padding: '15px 0', borderRadius: 12, border: 'none', background: T.amber, color: '#1a0f08', fontWeight: 800, fontSize: 14.5 }}>
          {last ? 'START TUNING' : 'NEXT'}
        </button>
      </div>
    </div>
  );
}

function StartScreen({ onStart, onTutorial }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: T.bg, color: T.ink, fontFamily: T.sans, justifyContent: 'center', alignItems: 'center', padding: 24, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-15%', left: '50%', transform: 'translateX(-50%)', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,106,44,0.10) 0%, transparent 70%)' }} />
      <div style={{ marginBottom: 22, position: 'relative' }}><DialMark size={92} pct={0.62} /></div>
      <div style={{ fontSize: 11, letterSpacing: 3, color: T.amberInk, fontWeight: 800, marginBottom: 7 }}>CARIBOU TUNING</div>
      <div style={{ fontSize: 25, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 15, maxWidth: 320 }}>Engine Management Sandbox</div>
      <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.65, maxWidth: 300, marginBottom: 34 }}>
        Design an engine. Tune it. Log it. Improve it. A free-tune sandbox built to teach real engine management, not just move sliders.
      </div>
      <button onClick={onStart} style={{ width: '100%', maxWidth: 300, padding: '16px 0', borderRadius: 12, border: 'none', background: T.amber, color: '#1a0f08', fontWeight: 800, fontSize: 15, letterSpacing: 0.4, marginBottom: 12, boxShadow: '0 8px 24px rgba(255,106,44,0.25)' }}>
        START
      </button>
      <button onClick={onTutorial} style={{ width: '100%', maxWidth: 300, padding: '15px 0', borderRadius: 12, border: `1px solid ${T.line}`, background: 'none', color: '#c3cad2', fontWeight: 700, fontSize: 13.5 }}>
        TUTORIAL
      </button>
      <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 18, fontFamily: T.mono }}>{BUILD_VERSION}</div>
    </div>
  );
}

function LiveGauge({ label, value, unit, color = T.ink, warn }) {
  return (
    <div style={{ flex: 1, minWidth: 68, background: T.panel, border: `1px solid ${warn ? T.red : T.line}`, borderRadius: 9, padding: '8px 9px' }}>
      <div style={{ fontSize: 8.5, color: T.ink2, letterSpacing: 0.8, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: T.mono, color: warn ? T.red : color }}>
        {value}<span style={{ fontSize: 9, color: T.ink3, marginLeft: 2 }}>{unit}</span>
      </div>
    </div>
  );
}

function TrimBar({ label, value }) {
  const pct = clamp((value + 25) / 50, 0, 1) * 100;
  const c = Math.abs(value) > 15 ? T.red : Math.abs(value) > 8 ? T.yellow : T.green;
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: T.ink2, fontWeight: 700, marginBottom: 3 }}>
        <span>{label}</span><span style={{ color: c, fontFamily: T.mono }}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>
      </div>
      <div style={{ height: 5, background: T.panel, borderRadius: 3, position: 'relative', border: `1px solid ${T.line}` }}>
        <div style={{ position: 'absolute', left: '50%', top: -1, bottom: -1, width: 1, background: T.lineHi }} />
        <div style={{ position: 'absolute', left: `${Math.min(50, pct)}%`, width: `${Math.abs(pct - 50)}%`, top: 0, bottom: 0, background: c, borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ============================================================
export default function EngineManagementSandbox() {
  const [appView, setAppView] = useState('start');
  const [tab, setTab] = useState('dash');
  const [engineConfig, setEngineConfig] = useState(DEFAULT_ENGINE_CONFIG);
  const [mods, setMods] = useState(DEFAULT_MODS);
  const [ve, setVe] = useState(() => computeHardwareVE(DEFAULT_ENGINE_CONFIG, DEFAULT_MODS));
  const [timing, setTiming] = useState(clone2D(DEFAULT_TIMING));
  const [afr, setAfr] = useState(clone2D(DEFAULT_AFR));
  const [turboOn, setTurboOn] = useState(false);
  const [boostCurve, setBoostCurve] = useState([...DEFAULT_BOOST]);
  const [octaneIdx, setOctaneIdx] = useState(0);
  const [injIdx, setInjIdx] = useState(0);
  const [mafScalar, setMafScalar] = useState(1.0);
  const [loadKpa, setLoadKpa] = useState(100);
  const [health, setHealth] = useState({ piston: 100, bearing: 100, valve: 100 });
  const [selection, setSelection] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [prevResult, setPrevResult] = useState(null);
  const [revealCount, setRevealCount] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [pullCount, setPullCount] = useState(0);
  const [turbineIdx, setTurbineIdx] = useState(1);
  const [compressorIdx, setCompressorIdx] = useState(1);
  // Pinned by diameter, not by position: adding sizes to the catalogue must not
  // silently change which pipe a new build starts with.
  const [exhaustDiaIdx, setExhaustDiaIdx] = useState(
    () => EXHAUST_DIA_OPTS.findIndex((o) => o.dia === 3.0),
  );
  const [buildSection, setBuildSection] = useState('engine');
  const [ecuInjectorCc, setEcuInjectorCc] = useState(315);
  const [tuneView, setTuneView] = useState('ve');
  const [boostSel, setBoostSel] = useState(4);
  const [dynoView, setDynoView] = useState('result');
  const [histogram, setHistogram] = useState(null);
  const [live, setLive] = useState(() => makeLiveState());
  const [throttleInput, setThrottleInput] = useState(0);
  const [dashSection, setDashSection] = useState('live');
  // Guided first run: BUILD -> TUNE -> LIVE -> DYNO, then free play (step 4).
  const [journeyStep, setJourneyStep] = useState(0);
  const revealTimer = useRef(null);
  const liveTimer = useRef(null);
  const liveCfgRef = useRef(null);
  const throttleRef = useRef(0);
  const audioRef = useRef(null);
  const [soundOn, setSoundOn] = useState(true);

  const octaneBonus = OCTANE_OPTS[octaneIdx].bonus;
  const engineDerived = useMemo(() => deriveEngine(engineConfig), [engineConfig]);
  const idealExhaustDia = useMemo(() => idealExhaustDiameter(engineDerived.displacementL, turboOn ? Math.max(...boostCurve) : 0), [engineDerived, turboOn, boostCurve]);
  const exhaustDiaError = EXHAUST_DIA_OPTS[exhaustDiaIdx].dia - idealExhaustDia;
  const mafErrorBase = useMemo(() => {
    let e = 1.0;
    if (mods.intake) e *= 0.90;
    if (turboOn) e *= 0.92;
    return e;
  }, [mods.intake, turboOn]);

  const fuel = OCTANE_OPTS[octaneIdx];
  const injectorCc = INJECTOR_OPTS[injIdx].cc;

  // Every hardware choice that physically changes how the engine breathes feeds the
  // VE table: bore/stroke, cylinder count, compression, cam duration, valve springs,
  // head material, bolt-ons, exhaust diameter, turbine backpressure, and the fuel's
  // charge-cooling effect.
  //
  // The table is NEVER rewritten silently. Changing hardware leaves your logged VE
  // stale — exactly as it would in a real shop, where the old log does not update
  // itself because you bolted something on. The VE tab shows what changed and by how
  // much, and you choose when to accept it.
  const hwForVe = useMemo(() => ({
    turboOn,
    turbine: turboOn ? TURBINE_OPTS[turbineIdx] : null,
    exhaustDia: EXHAUST_DIA_OPTS[exhaustDiaIdx].dia,
    fuel,
    peakBoostPsi: turboOn ? Math.max(...boostCurve) : 0,
  }), [turboOn, turbineIdx, exhaustDiaIdx, fuel, boostCurve]);

  // TRUE cylinder filling for the hardware as currently built. The player's `ve` table
  // is only the ECU's BELIEF about this; the gap between the two is what makes the
  // mixture drift off target and what the fuel-trim histogram measures and corrects.
  const veTruth = useMemo(
    () => computeHardwareVE(engineConfig, mods, hwForVe),
    [engineConfig, mods, hwForVe],
  );

  const recalcVE = () => setVe(veTruth);

  // Every boost-curve write goes through here. Rebuilding from the RPM axis makes it
  // structurally impossible for the curve to be the wrong length or to contain a
  // non-number, which is what previously let a single edit poison the whole sim.
  const setBoostAt = (i, value) => setBoostCurve(
    RPM.map((_, idx) => clamp(Number(idx === i ? value : boostCurve[idx]) || 0, 0, 25)),
  );
  const calAdvice = useMemo(() => calibrationAdvice({
    ve, veTruth, timing, afr, derived: engineDerived, octaneBonus, fuel, mods, turboOn, boostCurve,
    compressor: COMPRESSOR_OPTS[compressorIdx], turbine: TURBINE_OPTS[turbineIdx],
    injectorCc, ecuInjectorCc, mafScalar, mafErrorBase,
  }), [ve, veTruth, timing, afr, engineDerived, octaneBonus, fuel, mods, turboOn, boostCurve,
       compressorIdx, turbineIdx, injectorCc, ecuInjectorCc, mafScalar, mafErrorBase]);

  const veAdvice = useMemo(
    () => veRecommendations(ve, engineConfig, mods, hwForVe),
    [ve, engineConfig, mods, hwForVe]
  );

  // Same real-units chain the sim uses, evaluated at WOT / 6500 RPM as a preview.
  const dutyPreview = useMemo(() => {
    const rpm = 6500;
    const boostPsi = turboOn ? boostCurve[RPM.indexOf(6500)] : 0;
    const mapKpa = BARO_KPA + boostPsi * PSI_TO_KPA;
    const chargeK = chargeTempK(boostPsi, mods.intercooler);
    const vCylM3 = (engineDerived.displacementL / engineDerived.cyl) / 1000;
    const airDensity = (mapKpa * 1000) / (R_AIR * chargeK);
    const airChargeG = (interp2(ve, rpm, mapKpa) / 100) * vCylM3 * airDensity * 1000;
    const lambda = interp2(afr, rpm, mapKpa) / 14.7;
    const fuelMassG = airChargeG / (lambda * fuel.stoich);
    const pw = fuelMassG / ((ecuInjectorCc * fuel.density) / 60000) + INJ_DEADTIME_MS;
    return clamp((pw / (120000 / rpm)) * 100, 0, 220);
  }, [ve, afr, turboOn, boostCurve, ecuInjectorCc, fuel, mods.intercooler, engineDerived]);

  const needsMafRecal = mods.intake || turboOn;
  const changeTab = (t) => { setTab(t); setSelection(null); };

  const installMod = (key) => {
    if (mods[key]) return;
    if (key === 'intercooler') { setMods((m) => ({ ...m, intercooler: true })); return; }
    // Fitting a part changes airflow but does NOT edit your logged VE table — the
    // VE tab will show the gap and let you accept it once you understand why.
    setMods({ ...mods, [key]: true });
  };
  const resetToStock = () => {
    setVe(computeHardwareVE(engineConfig, DEFAULT_MODS, hwForVe));
    setTiming(clone2D(DEFAULT_TIMING)); setAfr(clone2D(DEFAULT_AFR));
    setMods(DEFAULT_MODS); setMafScalar(1.0);
  };
  const repairEngine = () => setHealth({ piston: 100, bearing: 100, valve: 100 });
  const setCfg = (patch) => setEngineConfig((c) => ({ ...c, ...patch }));

  const ensureAudio = () => {
    if (audioRef.current) return audioRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      const ctx = new Ctx();
      const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);

      // An exhaust note is a PULSE TRAIN, not a smooth wave — each cylinder fires a
      // sharp pressure spike. Building a periodic wave with many harmonics falling
      // off ~1/n gives that pulse character, which sounds far more like an engine
      // than a raw sawtooth does.
      const N = 24;
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let n = 1; n < N; n++) { re[n] = 0; im[n] = (1 / n) * Math.exp(-n / 14); }
      const pulseWave = ctx.createPeriodicWave(re, im, { disableNormalization: false });

      // Two slightly detuned pulse oscillators — real engines never hold a perfectly
      // pure pitch, and the beating between them is what stops it sounding synthetic.
      const oscA = ctx.createOscillator(); oscA.setPeriodicWave(pulseWave); oscA.frequency.value = 40;
      const oscB = ctx.createOscillator(); oscB.setPeriodicWave(pulseWave); oscB.frequency.value = 40; oscB.detune.value = 9;
      const oscG = ctx.createGain(); oscG.gain.value = 0.5;
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 20;
      const subG = ctx.createGain(); subG.gain.value = 0.35;

      // Exhaust system: a resonant body plus an overall lowpass.
      const body = ctx.createBiquadFilter(); body.type = 'bandpass'; body.frequency.value = 320; body.Q.value = 0.9;
      const bodyG = ctx.createGain(); bodyG.gain.value = 0.8;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 2;
      filter.connect(master); body.connect(bodyG); bodyG.connect(master);
      oscA.connect(oscG); oscB.connect(oscG); oscG.connect(filter); oscG.connect(body);
      sub.connect(subG); subG.connect(filter);

      const bufLen = 2 * ctx.sampleRate;
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const dch = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) dch[i] = (Math.random() * 2 - 1) * 0.35;

      // Combustion roughness, amplitude-modulated at the firing rate so the noise
      // arrives in pulses rather than as constant hiss.
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const ng = ctx.createGain(); ng.gain.value = 0.04;
      const pulseLfo = ctx.createOscillator(); pulseLfo.type = 'sawtooth'; pulseLfo.frequency.value = 40;
      const pulseDepth = ctx.createGain(); pulseDepth.gain.value = 0.03;
      pulseLfo.connect(pulseDepth); pulseDepth.connect(ng.gain);
      noise.connect(ng); ng.connect(filter);

      // LOPE: valve overlap makes combustion inconsistent cylinder-to-cylinder at
      // idle, so output surges and dips at a slow sub-multiple of the firing rate.
      // That uneven pulsing is the classic cammed idle.
      const lopeLfo = ctx.createOscillator(); lopeLfo.type = 'triangle'; lopeLfo.frequency.value = 6;
      const lopeDepth = ctx.createGain(); lopeDepth.gain.value = 0;
      lopeLfo.connect(lopeDepth); lopeDepth.connect(master.gain);
      lopeLfo.start();

      const indG = ctx.createGain(); indG.gain.value = 0;
      const indFilt = ctx.createBiquadFilter(); indFilt.type = 'bandpass'; indFilt.frequency.value = 1800; indFilt.Q.value = 1.2;
      const noise2 = ctx.createBufferSource(); noise2.buffer = buf; noise2.loop = true;
      noise2.connect(indFilt); indFilt.connect(indG); indG.connect(master);

      const whistle = ctx.createOscillator(); whistle.type = 'sine'; whistle.frequency.value = 3000;
      const whistleG = ctx.createGain(); whistleG.gain.value = 0;
      whistle.connect(whistleG); whistleG.connect(master);
      const bovFilt = ctx.createBiquadFilter(); bovFilt.type = 'bandpass'; bovFilt.frequency.value = 2600; bovFilt.Q.value = 0.8;
      const bovG = ctx.createGain(); bovG.gain.value = 0;
      const noise3 = ctx.createBufferSource(); noise3.buffer = buf; noise3.loop = true;
      noise3.connect(bovFilt); bovFilt.connect(bovG); bovG.connect(master);

      oscA.start(); oscB.start(); sub.start(); noise.start(); noise2.start(); noise3.start(); pulseLfo.start();
      audioRef.current = { ctx, oscA, oscB, oscG, sub, subG, master, filter, body, bodyG, ng, pulseLfo, lopeLfo, lopeDepth, indG, whistle, whistleG, bovG };
      return audioRef.current;
    } catch { return null; }
  };

  // Persistence goes through the storage adapter, which picks whichever backend is
  // available (artifact host, localStorage, or in-memory) so career stats survive a
  // refresh wherever the app is deployed.
  const persistCareer = (best, total, pulls) => saveCareer({ best, total, pulls });

  const doRun = () => {
    const a = ensureAudio();
    if (a && a.ctx.state === 'suspended') a.ctx.resume();
    setRunning(true);
    setRevealCount(0);
    const r = simulateSweep({
      loadKpa, ve, veTruth, timing, afr, turboOn, boostCurve, octaneBonus, octaneLabel: OCTANE_OPTS[octaneIdx].label,
      fuel, injectorCc, ecuInjectorCc, injectorLabel: INJECTOR_OPTS[injIdx].label, mods, mafScalar, derived: engineDerived,
      turbine: TURBINE_OPTS[turbineIdx], compressor: COMPRESSOR_OPTS[compressorIdx], exhaustDiaError,
    });
    setPrevResult(result);
    setResult(r);
    setHealth((h) => ({
      piston: clamp(h.piston - r.wear.piston, 0, 100),
      bearing: clamp(h.bearing - r.wear.bearing, 0, 100),
      valve: clamp(h.valve - r.wear.valve, 0, 100),
    }));
    const ts = computeTuningScore(r);
    const es = computeEngineerScore({
      engineConfig, turboOn, turbine: TURBINE_OPTS[turbineIdx], compressor: COMPRESSOR_OPTS[compressorIdx],
      exhaustDiaError, dutyPreview, displacementL: engineDerived.displacementL,
    });
    const pull = computePullScore({ peakHp: r.peakHp, peakTq: r.peakTq, tuningScore: ts.score, engineerScore: es.score });
    const nextBest = Math.max(bestScore, pull);
    const nextTotal = totalScore + pull;
    const nextPulls = pullCount + 1;
    setBestScore(nextBest); setTotalScore(nextTotal); setPullCount(nextPulls);
    persistCareer(nextBest, nextTotal, nextPulls);
    const total = r.points.length;
    let i = 0;
    revealTimer.current = setInterval(() => {
      i += Math.ceil(total / 30);
      setRevealCount(Math.min(i, total));
      if (i >= total) { clearInterval(revealTimer.current); setRunning(false); }
    }, 55);
  };
  useEffect(() => () => { if (revealTimer.current) clearInterval(revealTimer.current); }, []);

  // Keep the live-engine config in a ref so the loop always uses current tuning
  // without needing to restart the interval every time a table changes.
  liveCfgRef.current = {
    ve, veTruth, timing, afr, derived: engineDerived, fuel, injectorCc, ecuInjectorCc, mods, mafScalar, mafErrorBase,
    turboOn, boostCurve, octaneBonus, turbine: TURBINE_OPTS[turbineIdx],
    compressor: COMPRESSOR_OPTS[compressorIdx], exhaustDiaError,
  };
  throttleRef.current = throttleInput;

  // The engine runs continuously in the background at 20 Hz, integrating real
  // crankshaft dynamics and running one ECU control pass per step.
  useEffect(() => {
    liveTimer.current = setInterval(() => {
      setLive((prev) => (prev.running || prev.cranking || prev.rpm > 1)
        ? liveStep(prev, 0.05, { throttle: throttleRef.current, load: 0 }, liveCfgRef.current)
        : prev);
    }, 50);
    return () => clearInterval(liveTimer.current);
  }, []);

  // ---- Engine audio -------------------------------------------------------
  // Synthesised from the firing frequency: a 4-stroke fires cyl/2 times per
  // crank revolution, so pitch tracks RPM and cylinder count exactly. A lowpass
  // that opens with throttle gives the "load" character — closed throttle is
  // muffled, wide open is bright and raspy.
  const startEngine = () => {
    const a = ensureAudio();
    if (a && a.ctx.state === 'suspended') a.ctx.resume();
    setLive((p) => ({ ...p, cranking: true }));
  };
  const stopEngine = () => {
    setThrottleInput(0); throttleRef.current = 0;
    setLive((p) => ({ ...p, running: false, cranking: false }));
  };

  // Safety net: if a pointerup/cancel is missed (scroll, app switch, lost focus)
  // the throttle must still close, or the engine would hang at redline.
  useEffect(() => {
    const release = () => { setThrottleInput(0); throttleRef.current = 0; };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    };
  }, []);

  // Career stats persist across sessions so the high score is worth chasing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCareer();
      if (cancelled) return;
      setBestScore(c.best); setTotalScore(c.total); setPullCount(c.pulls);
    })();
    return () => { cancelled = true; };
  }, []);

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.points.slice(0, running ? revealCount : result.points.length).map((p, i) => ({
      rpm: p.rpm, hp: p.hp, torque: p.torque, afr: p.afr, afrCommanded: p.afrCommanded,
      timing: p.timing, commandedTiming: p.commandedTiming, duty: p.duty, trimPct: p.trimPct,
      prevHp: prevResult?.points?.[i]?.hp, prevTorque: prevResult?.points?.[i]?.torque,
    }));
  }, [result, prevResult, running, revealCount]);

  // HISTOGRAM — the core real-world tuning workflow. A pull's lambda error is
  // binned onto the same RPM x MAP grid as the VE table, so the correction can be
  // applied cell-for-cell. This is what HP Tuners' scanner histogram does.
  const buildHistogram = () => {
    if (!result) return;
    const cells = LOAD.map(() => RPM.map(() => ({ sum: 0, n: 0 })));
    result.points.forEach((p) => {
      let ri = 0, best = Infinity;
      LOAD.forEach((m, i) => { const d = Math.abs(m - p.map); if (d < best) { best = d; ri = i; } });
      let ci = 0, bc = Infinity;
      RPM.forEach((r, i) => { const d = Math.abs(r - p.rpm); if (d < bc) { bc = d; ci = i; } });
      // Airflow error % = how far the ACTUAL mixture sat from what was commanded.
      //
      // Sign convention, because getting it backwards makes the tool teach the exact
      // wrong reflex: the ECU fuels from the VE table, so
      //     actualAfr / commandedAfr  =  trueVE / tableVE
      // A positive number therefore means the engine ran LEANER than commanded, which
      // means it swallowed MORE air than the table claimed, which means the table is
      // reading low and must come UP by that percentage. Multiplying the cell by
      // (1 + err/100) drives the table onto the truth in one pass.
      const err = ((p.afr / p.afrCommanded) - 1) * 100;
      cells[ri][ci].sum += err; cells[ri][ci].n += 1;
    });
    setHistogram(cells.map((row) => row.map((c) => (c.n ? c.sum / c.n : null))));
  };
  const applyHistogram = () => {
    if (!histogram) return;
    setVe((prev) => prev.map((row, ri) => row.map((v, ci) => {
      const e = histogram[ri][ci];
      return e == null ? v : Number(clamp(v * (1 + e / 100), 10, 130).toFixed(1));
    })));
    setHistogram(null);
  };

  const currentRpm = result ? (result.points[Math.min(revealCount, result.points.length - 1)]?.rpm ?? 1500) : 1500;
  const scores = useMemo(() => {
    if (!result || running) return null;
    const tuning = computeTuningScore(result);
    const engineer = computeEngineerScore({
      engineConfig, turboOn, turbine: TURBINE_OPTS[turbineIdx], compressor: COMPRESSOR_OPTS[compressorIdx],
      exhaustDiaError, dutyPreview, displacementL: engineDerived.displacementL,
    });
    const pull = computePullScore({ peakHp: result.peakHp, peakTq: result.peakTq, tuningScore: tuning.score, engineerScore: engineer.score });
    return { tuning, engineer, pull };
  }, [result, running, engineConfig, turboOn, turbineIdx, compressorIdx, exhaustDiaError, dutyPreview, engineDerived]);

  // Drive the audio from whichever engine is actually turning — and only while the
  // relevant page is open, so sound stops the moment you navigate away.
  const prevBoostRef = useRef(0);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const t = a.ctx.currentTime;

    const onDyno = tab === 'dyno' && running && result;
    const onLive = tab === 'dash' && (live.running || live.cranking);
    const audible = onDyno || onLive;

    const rpm = onDyno ? currentRpm : live.rpm;
    const dynoPt = onDyno ? result.points[Math.min(revealCount, result.points.length - 1)] : null;
    const load = onDyno ? 1 : clamp((live.effThrottle ?? 0) / 100, 0, 1);
    const boostNow = onDyno ? (dynoPt?.boostPsi ?? 0) : (live.live?.boostPsi ?? 0);
    const cut = onLive ? live.fuelCut : false;

    const cyl = engineDerived.cyl;
    const fire = Math.max(6, (rpm / 60) * (cyl / 2));
    a.oscA.frequency.setTargetAtTime(fire, t, 0.02);
    a.oscB.frequency.setTargetAtTime(fire, t, 0.02);
    a.sub.frequency.setTargetAtTime(fire / 2, t, 0.02);
    a.pulseLfo.frequency.setTargetAtTime(fire, t, 0.02);

    // Layout character. A four is rough and buzzy (wider detune, more upper content);
    // a V8 leans on its low-order rumble; a six sits between.
    const isFour = cyl === 4, isEight = cyl === 8;
    a.oscB.detune.setTargetAtTime(isFour ? 16 : isEight ? 6 : 9, t, 0.2);
    a.oscG.gain.setTargetAtTime(isFour ? 0.55 : isEight ? 0.42 : 0.50, t, 0.1);
    a.subG.gain.setTargetAtTime(isFour ? 0.20 : isEight ? 0.58 : 0.35, t, 0.1);
    a.body.frequency.setTargetAtTime(isEight ? 240 : isFour ? 420 : 320, t, 0.15);

    // Exhaust diameter: a bigger pipe is louder, deeper and less restricted.
    const dia = EXHAUST_DIA_OPTS[exhaustDiaIdx].dia;
    const diaOpen = 0.72 + (dia - 2.5) * 0.20;
    const catBack = mods.exhaust || mods.headers;
    a.filter.frequency.setTargetAtTime((300 + fire * 7 + load * 2400) * diaOpen, t, 0.05);
    a.filter.Q.setTargetAtTime(isFour ? 3.2 : isEight ? 1.8 : 2.4, t, 0.1);
    a.bodyG.gain.setTargetAtTime(0.5 + (dia - 2.5) * 0.22, t, 0.15);

    a.indG.gain.setTargetAtTime(mods.intake && audible ? load * 0.055 * (rpm / 7500 + 0.3) : 0, t, 0.06);

    if (turboOn) {
      a.whistle.frequency.setTargetAtTime(1400 + (rpm / 7500) * 5200, t, 0.08);
      a.whistleG.gain.setTargetAtTime(audible ? Math.min(0.05, boostNow * 0.006) * load : 0, t, 0.08);
      if (prevBoostRef.current > 3 && load < 0.15 && audible) {
        a.bovG.gain.cancelScheduledValues(t);
        a.bovG.gain.setValueAtTime(0.09, t);
        a.bovG.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      }
      prevBoostRef.current = boostNow;
    } else {
      a.whistleG.gain.setTargetAtTime(0, t, 0.1);
      prevBoostRef.current = 0;
    }

    // Lope is loudest at idle and washes out as revs rise and combustion evens up.
    const overlap = engineDerived.overlapDeg || 0;
    const lopeRate = clamp(fire / 6, 2.5, 14);
    a.lopeLfo.frequency.setTargetAtTime(lopeRate, t, 0.15);
    const lopeStrength = audible && overlap > 2 && rpm < 2200
      ? Math.min(0.085, overlap * 0.0022) * clamp(1 - (rpm - 800) / 1600, 0.15, 1)
      : 0;
    a.lopeDepth.gain.setTargetAtTime(lopeStrength, t, 0.12);

    a.ng.gain.setTargetAtTime(live.cranking && onLive ? 0.12 : 0.03 + load * 0.045, t, 0.05);
    const vol = cut ? 0.012 : 0.05 + load * 0.11;
    a.master.gain.setTargetAtTime(audible && soundOn ? vol * (catBack ? 1.18 : 1) : 0, t, cut ? 0.015 : 0.06);
  }, [live.rpm, live.running, live.cranking, live.effThrottle, live.fuelCut, live.live, soundOn,
      engineDerived.cyl, exhaustDiaIdx, mods.intake, mods.exhaust, mods.headers, turboOn,
      running, currentRpm, revealCount, result, tab, engineDerived.overlapDeg]);

  // Hard-stop audio on unmount or when the tab changes away from a sounding page.
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) { try { a.master.gain.setTargetAtTime(0, a.ctx.currentTime, 0.02); } catch { /* noop */ } }
    };
  }, [tab]);

  const overallHealth = Math.min(health.piston, health.bearing, health.valve);
  const overallColor = statusColor(overallHealth);
  const engineName = `${engineDerived.displacementL.toFixed(1)}L ${engineConfig.configuration}`;

  // Four top-level destinations instead of seven. The three tuning tables and the
  // fuel/ECU controls now live under TUNE as sub-views — same depth, far less to
  // scan, and much bigger touch targets.
  const TABS = [
    { id: 'dash', label: 'HOME', icon: Gauge },
    { id: 'build', label: 'BUILD', icon: Settings },
    { id: 'tune', label: 'TUNE', icon: Grid3x3 },
    { id: 'dyno', label: 'DYNO', icon: Activity },
  ];
  const TUNE_VIEWS = [
    { id: 've', label: 'AIR', icon: Grid3x3 },
    { id: 'timing', label: 'SPARK', icon: Zap },
    { id: 'afr', label: 'FUEL', icon: Droplets },
    { id: 'ecu', label: 'ECU', icon: Fuel },
  ];
  const gridProps = { selection, setSelection };

  if (appView === 'start') return <StartScreen onStart={() => { setAppView('app'); setTab('build'); }} onTutorial={() => setAppView('tutorial')} />;
  if (appView === 'tutorial') return <TutorialScreen onDone={() => { setAppView('app'); setTab('build'); setJourneyStep(0); }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', maxHeight: '100dvh', background: T.bg, color: T.ink, fontFamily: T.sans, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 16px 12px', borderBottom: `1px solid ${T.line}`, background: T.panel }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: T.amberInk, fontWeight: 800 }}>CARIBOU TUNING</div>
            <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: 0.2 }}>ECU Lab</div>
            <div style={{ fontSize: 11, color: T.ink2, marginTop: 3, fontFamily: T.mono }}>
              {engineName} · {turboOn ? 'Turbo' : 'N/A'} · {OCTANE_OPTS[octaneIdx].label} oct · {INJECTOR_OPTS[injIdx].label} · {BUILD_VERSION}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={() => setAppView('tutorial')} title="Tutorial" style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 9, padding: 9, color: T.ink2 }}>
              <Info size={16} />
            </button>
            <button onClick={repairEngine} title="Repair engine" style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 9, padding: 9, color: T.ink2 }}>
              <Wrench size={16} />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
          <div style={{ flex: 1, height: 4, background: T.panel2, borderRadius: 2, overflow: 'hidden', border: `1px solid ${T.line}` }}>
            <div style={{ width: `${overallHealth}%`, height: '100%', background: overallColor, transition: 'width .4s' }} />
          </div>
          <span style={{ fontSize: 10, color: overallColor, fontWeight: 800, fontFamily: T.mono }}>{Math.round(overallHealth)}%</span>
          {live.running && <span style={{ fontSize: 9.5, color: T.green, fontWeight: 800, letterSpacing: 0.5 }}>● RUNNING</span>}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* ---------- HOME: live engine, career stats, health, learning ---------- */}
        {tab === 'dash' && (
          <div style={{ padding: 16 }}>
            {journeyStep === 2 && <JourneyBanner step={2} onAdvance={() => { setJourneyStep(3); changeTab('dyno'); }} onDismiss={() => setJourneyStep(99)} />}
            <BuildSection
              active={dashSection === 'live'} onClick={() => setDashSection(dashSection === 'live' ? null : 'live')}
              icon={Activity} label="Live Engine"
              sub={live.running ? `Running · ${Math.round(live.sensedRpm)} RPM · ${Math.round(live.coolantC)}°C` : live.cranking ? 'Cranking…' : 'Off'}
            >
              <Panel style={{ background: T.panel, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <DialMark size={104} pct={clamp(live.sensedRpm / 7500, 0, 1)} live />
                    <div style={{ position: 'absolute', top: '58%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
                      <div style={{ fontSize: 17, fontWeight: 800, fontFamily: T.mono, color: live.fuelCut ? T.red : T.ink }}>{Math.round(live.sensedRpm)}</div>
                      <div style={{ fontSize: 7, color: T.ink3, letterSpacing: 1, fontWeight: 700 }}>RPM</div>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: T.ink2, marginBottom: 8, lineHeight: 1.5 }}>
                      {live.running
                        ? (live.rpm > 7500 ? 'Rev limiter — fuel cut to protect the engine.'
                          : live.dfco ? 'Overrun fuel cut — injectors off while coasting down. Real ECUs do this; it costs nothing to spin.'
                          : live.coolantC < 70 ? 'Warming up — the ECU is running extra fuel until it reaches temperature.'
                          : live.closedLoop ? 'Warm and in closed loop — the ECU is trimming fuel against the O2 sensor.'
                          : 'Open loop — the ECU is following your tables directly, ignoring O2 feedback.')
                        : live.cranking ? 'Starter engaged…' : 'Engine off. Start it to watch the ECU work in real time.'}
                    </div>
                    <div style={{ display: 'flex', gap: 7 }}>
                      <button onClick={live.running || live.cranking ? stopEngine : startEngine} style={{
                        flex: 1, padding: '11px 0', borderRadius: 9, border: 'none', fontWeight: 800, fontSize: 12.5,
                        background: live.running || live.cranking ? T.panel2 : T.green, color: live.running || live.cranking ? T.ink : '#06210f',
                        borderWidth: 1, borderStyle: 'solid', borderColor: live.running || live.cranking ? T.line : T.green,
                      }}>{live.running || live.cranking ? 'STOP' : 'START ENGINE'}</button>
                      <button onClick={() => { if (!soundOn) ensureAudio()?.ctx.resume(); setSoundOn((v) => !v); }} title="Engine sound" style={{
                        width: 46, padding: '11px 0', borderRadius: 9, fontWeight: 800, fontSize: 13,
                        border: `1px solid ${soundOn ? T.amber : T.line}`, background: soundOn ? T.amberBg : T.panel2,
                        color: soundOn ? T.amberInk : T.ink3,
                      }}>{soundOn ? '♪' : '✕'}</button>
                    </div>
                  </div>
                </div>

                <div
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setThrottleInput(100); throttleRef.current = 100; }}
                  onPointerUp={() => { setThrottleInput(0); throttleRef.current = 0; }}
                  onPointerCancel={() => { setThrottleInput(0); throttleRef.current = 0; }}
                  style={{
                    position: 'relative', overflow: 'hidden',
                    marginTop: 12, padding: '18px 0', borderRadius: 12, textAlign: 'center', userSelect: 'none',
                    WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
                    border: `1px solid ${throttleInput > 0 ? T.amber : T.line}`,
                    background: throttleInput > 0 ? T.amberBg : T.panel2,
                    color: throttleInput > 0 ? T.amberInk : T.ink2, fontWeight: 800, fontSize: 13.5, letterSpacing: 0.5,
                    touchAction: 'none', opacity: live.running ? 1 : 0.4,
                    transition: 'background .1s, border-color .1s',
                  }}
                >
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${clamp(live.effThrottle ?? 0, 0, 100)}%`,
                    background: 'rgba(255,106,44,0.16)', transition: 'width .12s',
                  }} />
                  <span style={{ position: 'relative' }}>
                    {!live.running ? 'START THE ENGINE FIRST' : throttleInput > 0 ? 'WIDE OPEN THROTTLE' : 'PRESS AND HOLD TO REV'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  <LiveGauge label="MAF" value={live.sensedMaf.toFixed(1)} unit="g/s" color={T.cyan} />
                  <LiveGauge label="MAP" value={Math.round(live.sensedMap)} unit="kPa" />
                  <LiveGauge label="IAT" value={Math.round(live.sensedIat)} unit="°C" warn={live.sensedIat > 65} />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <LiveGauge label="LAMBDA" value={live.sensedLambda.toFixed(2)} unit="λ" color={T.violet} />
                  <LiveGauge label="COOLANT" value={Math.round(live.sensedCoolant)} unit="°C" warn={live.sensedCoolant > 105} />
                  <LiveGauge label="TIMING" value={live.live ? live.live.timing : '—'} unit="°" color={T.yellow} warn={!!(live.live && live.live.knock)} />
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <LiveGauge label="INJ PW" value={live.live ? live.live.pw : '—'} unit="ms" />
                  <LiveGauge label="DUTY" value={live.live ? live.live.duty : '—'} unit="%" warn={!!(live.live && live.live.duty > 90)} />
                  <LiveGauge label="IDLE AIR" value={Math.round(live.idleTrim)} unit="%" />
                  <LiveGauge label="FUEL" value={live.fuelCut ? 'CUT' : 'ON'} unit="" color={live.fuelCut ? T.yellow : T.green} />
                </div>

                <div style={{ marginTop: 12 }}>
                  <TrimBar label="SHORT TERM FUEL TRIM (STFT)" value={live.stft} />
                  <TrimBar label="LONG TERM FUEL TRIM (LTFT)" value={live.ltft} />
                </div>
              </Panel>
              <ExpandableInfo title="Why these gauges jitter">
                Every value above is a simulated sensor reading, with real noise and lag — not the exact internal number. That is what a tuner actually sees on a scan tool, and why real logs never look perfectly smooth.
              </ExpandableInfo>
            </BuildSection>

            <BuildSection
              active={dashSection === 'stats'} onClick={() => setDashSection(dashSection === 'stats' ? null : 'stats')}
              icon={Trophy} label="Career & Last Pull"
              sub={result ? `Best ${bestScore} · ${pullCount} pulls logged` : `${pullCount} pulls logged`}
            >
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <StatTile label="BEST PULL" value={bestScore} color={T.amberInk} />
                <StatTile label="CAREER TOTAL" value={totalScore} color={T.cyan} />
                <StatTile label="PULLS" value={pullCount} color={T.ink} />
              </div>
              {result && scores ? (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <StatTile label="PEAK POWER" value={result.peakHp} unit="whp" color={T.amberInk} />
                    <StatTile label="PEAK TORQUE" value={result.peakTq} unit="lb-ft" color={T.cyan} />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <StatTile label="PULL SCORE" value={scores.pull} color={T.amberInk} />
                    <StatTile label="TUNING" value={scores.tuning.score} color={statusColor(scores.tuning.score)} />
                    <StatTile label="ENGINEER" value={scores.engineer.score} color={statusColor(scores.engineer.score)} />
                  </div>
                </>
              ) : <Note>No dyno pull logged yet — head to DYNO and run one.</Note>}
            </BuildSection>

            <BuildSection
              active={dashSection === 'health'} onClick={() => setDashSection(dashSection === 'health' ? null : 'health')}
              icon={Wrench} label="Engine Health"
              sub={`${Math.round(overallHealth)}% overall`}
            >
              <Panel>
                <HealthBar label="PISTON / RINGS · knock, detonation" value={health.piston} />
                <HealthBar label="BEARINGS · sustained cylinder pressure" value={health.bearing} />
                <HealthBar label="VALVES · lean-under-boost heat" value={health.valve} />
              </Panel>
              {needsMafRecal && <Note tone="warn">Your intake and/or turbo plumbing changed the MAF reading — head to <b>FUEL</b> to rescale it before your next pull.</Note>}
            </BuildSection>

            <BuildSection
              active={dashSection === 'learn'} onClick={() => setDashSection(dashSection === 'learn' ? null : 'learn')}
              icon={BookOpen} label="Learn How It Works"
              sub="Plain-language guide to engine tuning"
            >
              <div style={{ fontSize: 12, color: T.ink3, marginBottom: 10, lineHeight: 1.5 }}>Read in order. Each explains a piece of what the live engine is doing right now.</div>

              <div style={{ fontSize: 11, letterSpacing: 1, color: T.amberInk, fontWeight: 800, margin: '4px 0 8px' }}>PART 1 · FUNDAMENTALS</div>

              <ExpandableInfo title="1. The whole thing in one paragraph">
                An engine is an air pump. However much air it swallows decides how much fuel can be burned, and burning fuel is what makes power. The ECU's entire job is to measure the air, add the right amount of fuel, and light it at the right moment. Tuning is adjusting those last two decisions.
                <br /><br />Everything else in this app — cams, turbos, exhaust diameter, compression — exists to change how much air gets in, or how much of that fuel's energy you can safely extract.
              </ExpandableInfo>

              <ExpandableInfo title="2. Volumetric efficiency — the master number">
                VE is how completely a cylinder fills compared to its own swept volume. At 100% VE the cylinder takes in exactly its displacement worth of air at the pressure available. Naturally aspirated engines typically peak around 85–100%; the peak sits at the RPM where the intake and exhaust tuning line up best, which is also where peak torque lands.
                <br /><br />VE falls off at high RPM because there simply is not enough time to fill the cylinder, and it falls at very low RPM because gas velocity is too low to help. That curve is the shape of your torque curve.
                <br /><br /><b style={{ color: T.ink }}>Every hardware choice on BUILD moves this table</b> — cam duration slides the peak up or down the RPM range, headers and exhaust add flow up top, bore/stroke ratio biases the whole curve. That is why VE is where hardware becomes visible.
              </ExpandableInfo>

              <ExpandableInfo title="3. Lambda — the only mixture number that matters">
                Gasoline burns completely at about 14.7 parts air to 1 part fuel. Divide any AFR by its fuel's stoichiometric ratio and you get <b style={{ color: T.ink }}>lambda</b>: 1.00 is exactly complete combustion, below 1 is rich, above 1 is lean.
                <br /><br />Lambda matters because it means the same thing on every fuel. E85 is stoichiometric at about 9.8:1, so 12.5:1 means something completely different on E85 than on pump gas — but lambda 0.85 is lambda 0.85 on both.
                <br /><br />Best power is slightly rich: around <b style={{ color: T.ink }}>lambda 0.87</b> naturally aspirated, and richer still under boost — near 0.83 — because the extra fuel evaporating cools the charge and buys knock margin. Leaner than that under load and you lose power while raising both knock risk and exhaust temperature.
              </ExpandableInfo>

              <ExpandableInfo title="4. Why timing makes torque, and where it stops">
                Fuel does not explode instantly — it burns over a few milliseconds. So the spark fires <i>before</i> top dead center, timed so peak cylinder pressure arrives around 16° after TDC, where the crank has the best leverage.
                <br /><br />Too retarded and you are still burning while the piston runs away: wasted energy, hot exhaust. Too advanced and pressure peaks while the piston is still rising, fighting the crank and building the heat and pressure that cause knock. The best point is <b style={{ color: T.ink }}>MBT</b> — minimum spark for best torque. Past MBT you gain almost nothing and risk everything.
                <br /><br />MBT moves: higher RPM needs more advance because there is less time for the burn; higher load needs less because the denser charge burns faster.
              </ExpandableInfo>

              <ExpandableInfo title="5. Knock — what actually destroys engines">
                Knock is the end gas — the mixture farthest from the spark plug — igniting on its own from heat and pressure before the flame front reaches it. Two flame fronts collide and the pressure spike hammers the piston and ring lands.
                <br /><br />It is driven by <b style={{ color: T.ink }}>trapped charge mass</b>, not just boost: more air in the cylinder means higher peak pressure. That is why a big cam that breathes better also needs a little less timing, and why the same tune that is safe at part throttle knocks at wide open.
                <br /><br />What makes it worse: more timing, more boost, more compression, hotter intake air, leaner mixture, lower octane. What buys margin: higher octane, richer mixture, cooler charge (intercooler), aluminium head, less compression.
                <br /><br /><b style={{ color: T.ink }}>How much is too much?</b> Tuners treat anything sustained above about 2° of retard as damaging, not as an operating point. Zero is the target.
              </ExpandableInfo>

              <div style={{ fontSize: 11, letterSpacing: 1, color: T.amberInk, fontWeight: 800, margin: '14px 0 8px' }}>PART 2 · WHAT THE ECU CALCULATES</div>

              <ExpandableInfo title="6. The control loop, in order">
                Thousands of times a minute, the ECU runs the same sequence:
                <br /><br />read sensors → calculate cylinder air mass → decide open or closed loop → work out required fuel mass → convert that to an injector pulse width → apply fuel trims → look up ignition timing → check for knock → retard if needed → fire injectors and coils → update learned values.
                <br /><br />Everything you edit in this app is one of the lookups inside that loop. The ECU is not deciding anything creative — it is doing arithmetic against your tables, very fast.
              </ExpandableInfo>

              <ExpandableInfo title="7. Step 1 — how much air is in the cylinder?">
                This is the ideal gas law, and it is the foundation of every speed-density calculation:
                <br /><br /><span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>ρ = MAP ÷ (R × T)</span><br />
                <span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>airCharge = VE × V_cylinder × ρ</span>
                <br /><br />MAP is manifold pressure (about 101 kPa at wide open naturally aspirated, higher with boost, down to ~20 kPa at idle). R is the gas constant for air, 287 J/(kg·K). T is charge temperature.
                <br /><br />Two consequences worth internalising. <b style={{ color: T.ink }}>Boost raises MAP</b>, so it directly multiplies air mass. And <b style={{ color: T.ink }}>compressing air heats it</b>, which lowers density and gives some of that gain back — which is the entire reason intercoolers exist. You can watch both in the datalog's MAP and IAT columns.
              </ExpandableInfo>

              <ExpandableInfo title="8. Step 2 — how much fuel does that need?">
                Fuel mass follows directly from air mass and your lambda target:
                <br /><br /><span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>fuelMass = airCharge ÷ (λ × stoichRatio)</span>
                <br /><br />Nothing is fudged here. Because E85's stoichiometric ratio is 9.8 instead of 14.7, the same lambda target automatically demands about 1.5× the fuel mass — it falls straight out of the chemistry, which is why E85 needs a much bigger fuel system for the same power.
              </ExpandableInfo>

              <ExpandableInfo title="9. Step 3 — pulse width, and the hard time limit">
                The ECU never commands "fuel" — it commands a number of milliseconds. That comes from the required fuel mass and the injector's flow rating, plus deadtime (the ~1 ms an injector takes to physically open):
                <br /><br /><span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>PW = fuelMass ÷ (injectorCC × density ÷ 60000) + deadtime</span><br />
                <span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>cycleTime = 120000 ÷ RPM&nbsp;&nbsp;(ms per 720° cycle)</span><br />
                <span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>duty% = PW ÷ cycleTime × 100</span>
                <br /><br />A four-stroke injects once every two crank revolutions, so at 7500 RPM there are only 16 ms in a cycle. An injector needing 15 of them is at 94% duty. Past about 90% there is no time left, and the mixture goes lean <i>no matter what your AFR table says</i>. This is a physical wall, not a calibration choice.
                <br /><br /><b style={{ color: T.ink }}>Critical:</b> the ECU calculates that pulse width for the injector size it has been <i>told</i> is fitted. Fit bigger injectors without updating the ECU Injector Size on FUEL and every pulse delivers proportionally more fuel than intended — the engine runs rich everywhere regardless of your tables.
              </ExpandableInfo>

              <ExpandableInfo title="10. Step 4 — open loop, closed loop, and fuel trims">
                At part throttle the ECU runs <b style={{ color: T.ink }}>closed loop</b>: it reads the oxygen sensor and corrects fuelling in real time. <b style={{ color: T.ink }}>Short term fuel trim (STFT)</b> is that instant correction; <b style={{ color: T.ink }}>long term fuel trim (LTFT)</b> is what it has learned and stored over time. Watch both on the HOME gauges — fit an intake without rescaling the MAF and you can see STFT swing, then hand off to LTFT as it learns.
                <br /><br />Above roughly 85 kPa the ECU switches to <b style={{ color: T.ink }}>open loop</b> and stops listening to the O2 sensor entirely, following your tables blind. That is deliberate — at wide open throttle you want a rich power mixture, not stoichiometric.
                <br /><br />It is also why <b style={{ color: T.ink }}>wide open throttle is where a bad tune bites</b>. Errors that closed loop quietly papers over at cruise pass straight through at full load.
              </ExpandableInfo>

              <ExpandableInfo title="11. Step 5 — from combustion to torque at the wheels">
                Fuel energy becomes indicated work on the piston, then the engine pays its own bills:
                <br /><br /><span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>η = (1 − 1/CR^0.35) × 0.685</span><br />
                <span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>IMEP = fuelMass × LHV × η × timingEff × afrEff ÷ V_cyl</span><br />
                <span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>FMEP = rubbing friction + pumping loss + spring load</span><br />
                <span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>BMEP = IMEP − FMEP</span><br />
                <span style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11.5 }}>torque = BMEP × Vd ÷ 4π</span>
                <br /><br />The first line is ideal Otto-cycle efficiency for your compression ratio, scaled to what real engines actually achieve. So raising compression makes power through genuine thermodynamics.
                <br /><br /><b style={{ color: T.ink }}>Pumping loss</b> is the one people forget: at part throttle the engine is working hard to breathe against a closed throttle, and that shows up as wasted work. It is why fuel consumption per horsepower gets much worse at light load, and why a throttled engine brakes itself on overrun.
              </ExpandableInfo>

              <div style={{ fontSize: 11, letterSpacing: 1, color: T.amberInk, fontWeight: 800, margin: '14px 0 8px' }}>PART 3 · THE TUNING PROCESS</div>

              <ExpandableInfo title="12. The loop: change → pull → read → adjust">
                This is the whole method, and it is not a simplification:
                <br /><br /><b style={{ color: T.ink }}>1. Change one thing.</b> One table region, one hardware item. Change three and you will not know which one mattered.
                <br /><br /><b style={{ color: T.ink }}>2. Run a pull.</b> Nothing is known until it is measured. There is no preview in this app on purpose.
                <br /><br /><b style={{ color: T.ink }}>3. Read the log first.</b> Before looking at the power number, read the Pull Log and check the datalog for gaps between commanded and actual. Power that came with 6° of knock retard is not power you keep.
                <br /><br /><b style={{ color: T.ink }}>4. Adjust and repeat.</b> The VS. LAST PULL line tells you whether the change helped. Small logged steps beat big guesses, every time.
              </ExpandableInfo>

              <ExpandableInfo title="13. A worked example — first turbo tune">
                Fit a turbo on BUILD and run a pull without touching anything. It will score terribly, and here is why: a factory naturally-aspirated calibration has no real tuning above 101 kPa, so the boost rows are just a flat continuation of the wide-open-throttle row — far too much timing and far too lean for the cylinder pressure you have just created.
                <br /><br /><b style={{ color: T.ink }}>Read the log.</b> It will report knock across most of the range, with the RPM band and how many degrees the ECU pulled.
                <br /><br /><b style={{ color: T.ink }}>Fix the spark first.</b> On SPARK, pull the 150 and 200 kPa rows down. Roughly 2° per 20 kPa of extra pressure is a sane starting point. Pull again.
                <br /><br /><b style={{ color: T.ink }}>Then the mixture.</b> On FUEL, richen those same rows toward lambda 0.83 (about 12.2:1). Pull again — you should see knock margin improve as well, because a richer charge resists knock.
                <br /><br /><b style={{ color: T.ink }}>Then check the fuel system.</b> If the log reports injectors maxed, that is hardware: fit bigger injectors and set the matching ECU Injector Size, or ask for less boost. Nothing in the tables can create fuel that the injectors have no time to deliver.
              </ExpandableInfo>

              <ExpandableInfo title="14. How to read the datalog columns">
                The datalog is where diagnosis actually happens. Read it in pairs:
                <br /><br /><b style={{ color: T.ink }}>Timing: asked → got</b> — if they differ, the ECU overrode you. That is knock retard, and the gap is how far past the limit your table was.
                <br /><br /><b style={{ color: T.ink }}>Mixture: asked → got</b> — if actual is not what you commanded, the cause is upstream of the fuel table: usually MAF scaling or injectors out of duty. Do not "fix" it by editing fuel cells; fix the cause.
                <br /><br /><b style={{ color: T.ink }}>Airflow</b> — around 200 g/s is typical at redline for an engine near 300 hp, which is a quick sanity check on whether your VE table is plausible.
                <br /><br /><b style={{ color: T.ink }}>Injectors</b> — duty above 90% is the wall. <b style={{ color: T.ink }}>Heat</b> — sustained EGT above ~950°C cooks turbines and valves; it rises with retarded timing and lean mixtures.
              </ExpandableInfo>

              <ExpandableInfo title="15. What tuning can fix, and what it can't">
                <b style={{ color: T.ink }}>Calibration faults — tables fix these completely:</b> knock (pull timing), lean or rich mixture (AFR table), MAF drift after an intake change (MAF scalar), injector mismatch (set the ECU injector size). Fix the cause and the score returns to 100.
                <br /><br /><b style={{ color: T.ink }}>Physical limits — no table touches these:</b> injectors out of duty cycle, valve float, a compressor past its efficient range, a cam that has moved the powerband somewhere you did not want. The Pull Log always names both routes when you hit one: change the hardware, or ask less of it.
                <br /><br />Knowing which kind of problem you are looking at is most of what separates a tuner from someone guessing at numbers.
              </ExpandableInfo>

              <ExpandableInfo title="16. Habits that keep engines alive">
                Target zero knock, not "acceptable" knock. Stay on the rich side of best power until you have confirmed margin. Never chase a number you have not measured. When something looks wrong, find the cause rather than compensating for it downstream — a MAF error corrected by bending the AFR table will be wrong again the moment load changes.
                <br /><br />And watch engine health on HOME. Damage here accumulates the way it does in reality: a few destructive pulls, not one dramatic failure.
              </ExpandableInfo>

            </BuildSection>
          </div>
        )}

        {/* ---------- BUILD: engine architecture, parts, forced induction ---------- */}
        {tab === 'build' && (
          <div style={{ padding: 16 }}>
            {journeyStep === 0 && <JourneyBanner step={0} onAdvance={() => { setJourneyStep(1); changeTab('tune'); }} onDismiss={() => setJourneyStep(99)} />}
            <Eyebrow icon={Settings}>Garage</Eyebrow>
            <p style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6, marginTop: 0, marginBottom: 14 }}>
              Design the car before you tune it. Tap a section to open it — every choice inside changes real physics elsewhere in the sandbox.
            </p>

            <BuildSection
              active={buildSection === 'engine'} onClick={() => setBuildSection(buildSection === 'engine' ? null : 'engine')}
              icon={Settings} label="Engine Architecture"
              sub={`${engineDerived.displacementL.toFixed(1)}L ${engineConfig.configuration} · ${engineConfig.compression.toFixed(1)}:1 · ${engineConfig.camDuration}° cam`}
            >
              <Panel tight style={{ marginBottom: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.ink2, marginBottom: 5, fontWeight: 600 }}><span>DISPLACEMENT</span><span style={{ color: T.ink, fontWeight: 800, fontFamily: T.mono }}>{engineDerived.displacementL.toFixed(2)} L</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.ink2, marginBottom: 5, fontWeight: 600 }}><span>BORE : STROKE</span><span style={{ color: T.ink, fontWeight: 800, fontFamily: T.mono }}>{engineDerived.ratio.toFixed(3)}</span></div>
                <div style={{ fontSize: 11.5, color: T.amberInk, fontWeight: 600 }}>{engineDerived.character}</div>
              </Panel>

              {!veAdvice.inSync && (
                <div style={{ background: T.panel2, border: `1px solid ${T.amber}`, borderRadius: 10, padding: '11px 13px', margin: '4px 0 10px', fontSize: 12, color: '#a5aebb', lineHeight: 1.5 }}>
                  <b style={{ color: T.amberInk }}>Your VE table is now stale.</b> This hardware breathes differently than what you last logged — up to {veAdvice.maxAbs.toFixed(0)}% off. Head to <b style={{ color: T.ink }}>TUNE &rsaquo; AIR</b> to see which cells changed and why, then accept it there.
                </div>
              )}
              <ExpandableInfo title="Why changing hardware does not update your VE table">
                Everything that physically changes how this engine breathes feeds volumetric efficiency: bore/stroke ratio, cylinder count, compression, cam duration, valve springs, head material, intake/headers/exhaust, pipe diameter, turbine backpressure, even fuel choice (E85 evaporates cold enough to measurably densify the charge).
                <br /><br />But your VE table is a <b style={{ color: T.ink }}>log</b> — a record of what the engine actually flowed last time it was measured. Bolt on a cam and that log does not rewrite itself; it just becomes wrong. In a real shop you would go back to the dyno and re-log airflow before trusting any of it.
                <br /><br />So this app never edits it silently. It tells you what changed, by how much, and in which RPM range — and lets you accept it once you understand why it moved.
                <br /><br />Note that <b style={{ color: T.ink }}>boost is not part of VE</b>. VE measures how well the cylinder fills relative to the pressure available; boost raises that pressure (MAP) separately. That is why adding boost does not change these numbers, but adding a turbine does — the turbine is a restriction in the exhaust.
              </ExpandableInfo>

              <div style={{ fontSize: 12, color: T.ink2, marginBottom: 6, marginTop: 10, fontWeight: 600 }}>Configuration</div>
              <Seg options={CONFIG_OPTS.map((c) => ({ label: `${c} · ${CYL_COUNT[c]}cyl`, value: c }))} value={engineConfig.configuration} onChange={(v) => setCfg({ configuration: v })} />
              <ExpandableInfo title="Why cylinder count and layout matter">
                For the same total displacement, spreading it across more, smaller cylinders means each one needs less peak pressure to make the same overall torque — a small real knock-margin benefit and smoother delivery. More cylinders also means more bearings and friction, so it is a trade-off, not a free upgrade.
              </ExpandableInfo>

              <div style={{ fontSize: 12, color: T.ink2, margin: '10px 0 6px', fontWeight: 600 }}>Bore: {engineConfig.bore.toFixed(1)} mm</div>
              <input type="range" min={75} max={105} step={0.5} value={engineConfig.bore} onChange={(e) => setCfg({ bore: Number(e.target.value) })} style={{ width: '100%', accentColor: T.amber }} />
              <div style={{ fontSize: 12, color: T.ink2, margin: '10px 0 6px', fontWeight: 600 }}>Stroke: {engineConfig.stroke.toFixed(1)} mm</div>
              <input type="range" min={65} max={100} step={0.5} value={engineConfig.stroke} onChange={(e) => setCfg({ stroke: Number(e.target.value) })} style={{ width: '100%', accentColor: T.amber }} />
              <ExpandableInfo title="Bore, stroke, and engine character">
                Bore is cylinder diameter, stroke is how far the piston travels; together with cylinder count they set displacement. But the ratio between them shapes character independent of displacement: big-bore/short-stroke ("oversquare") tends to breathe and rev higher; small-bore/long-stroke ("undersquare") tends toward stronger low-end torque. This sandbox shifts your VE curve's effective bias toward high or low RPM based on what you set here.
              </ExpandableInfo>

              <div style={{ fontSize: 12, color: T.ink2, margin: '10px 0 6px', fontWeight: 600 }}>Compression Ratio: {engineConfig.compression.toFixed(1)}:1</div>
              <input type="range" min={8.5} max={13.0} step={0.1} value={engineConfig.compression} onChange={(e) => setCfg({ compression: Number(e.target.value) })} style={{ width: '100%', accentColor: T.amber }} />
              <ExpandableInfo title="Compression ratio's trade-off">
                Higher compression squeezes the mixture tighter before ignition, extracting more work from the same fuel — genuinely more efficient and torquey. The same squeeze also raises end-gas temperature and pressure, which is what causes knock. That is exactly why turbocharged engines usually run lower static compression than naturally aspirated ones: boost already adds cylinder pressure on its own.
              </ExpandableInfo>

              <div style={{ fontSize: 12, color: T.ink2, margin: '10px 0 6px', fontWeight: 600 }}>
                Camshaft Duration: {engineConfig.camDuration}° <span style={{ color: T.ink3, fontWeight: 400 }}>· overlap {Math.round(engineDerived.overlapDeg)}°</span>
              </div>
              <input type="range" min={180} max={300} step={2} value={engineConfig.camDuration} onChange={(e) => setCfg({ camDuration: Number(e.target.value) })} style={{ width: '100%', accentColor: T.amber }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: T.ink3, marginTop: 2 }}>
                <span>mild · low-end torque</span><span>wild · top-end power</span>
              </div>
              <ExpandableInfo title="What camshaft duration actually does">
                Duration is how long, in crank degrees, a valve stays open. Hold the intake valve open longer and at <b style={{ color: T.ink }}>low RPM</b> some charge gets pushed back out during compression — you lose bottom end. But at <b style={{ color: T.ink }}>high RPM</b> there is barely time to fill the cylinder at all, and that extra open time is exactly what keeps it breathing.
                <br /><br />So a bigger cam does not add power everywhere — it <i>moves</i> the power. Watch the VE table and the dyno curve: the peak slides up the RPM range and the low-RPM cells drop. This sandbox models it by sampling the breathing curve at a cam-shifted engine speed, which is the honest way to represent it.
                <br /><br /><b style={{ color: T.ink }}>Overlap</b> is the window where both valves are open together. It grows with duration, and it is why cammed engines idle lumpy, pull weak manifold vacuum, and sound the way they do.
              </ExpandableInfo>

              <div style={{ fontSize: 12, color: T.ink2, margin: '10px 0 6px', fontWeight: 600 }}>
                Valve Spring Rate: {engineConfig.springRate} <span style={{ color: engineDerived.floatRpm < 7500 ? T.red : T.ink3, fontWeight: 400 }}>· float at {Math.round(engineDerived.floatRpm)} RPM</span>
              </div>
              <input type="range" min={20} max={100} step={1} value={engineConfig.springRate} onChange={(e) => setCfg({ springRate: Number(e.target.value) })} style={{ width: '100%', accentColor: engineDerived.floatRpm < 7500 ? T.red : T.cyan }} />
              {engineDerived.floatRpm < 7500 && (
                <div style={{ fontSize: 11.5, color: T.red, marginTop: 5 }}>
                  Springs float below redline — cylinder filling collapses above {Math.round(engineDerived.floatRpm)} RPM. Stiffen them or fit a milder cam.
                </div>
              )}
              <ExpandableInfo title="Why springs decide how far a cam can go">
                The cam pushes the valve open; only the spring closes it. As RPM rises the valve has less and less time to follow the closing ramp, and past the spring's limit it stops following the lobe entirely — <b style={{ color: T.ink }}>valve float</b>. The cylinder cannot fill, and power falls off a cliff rather than tapering.
                <br /><br />Bigger cams open valves further and faster, so they need stiffer springs. That is why "cam and springs" are sold together: fit an aggressive cam on stock springs and you will make <i>less</i> power than stock up top, because you float before you reach the RPM the cam was designed for.
                <br /><br />Stiffness is not free either — every cycle the engine compresses those springs, and that parasitic loss shows up in FMEP. Over-spring a mild cam and you simply lose a little power for nothing.
              </ExpandableInfo>

              <div style={{ fontSize: 12, color: T.ink2, marginBottom: 6, fontWeight: 600 }}>Block Material</div>
              <Seg options={MATERIAL_OPTS.map((m) => ({ label: m, value: m }))} value={engineConfig.blockMaterial} onChange={(v) => setCfg({ blockMaterial: v })} />
              <div style={{ fontSize: 12, color: T.ink2, margin: '10px 0 6px', fontWeight: 600 }}>Head Material</div>
              <Seg options={MATERIAL_OPTS.map((m) => ({ label: m, value: m }))} value={engineConfig.headMaterial} onChange={(v) => setCfg({ headMaterial: v })} />
              <ExpandableInfo title="Why block and head material matter">
                Aluminum conducts heat roughly three times faster than cast iron, so an aluminum head pulls heat away from the combustion chamber faster — a real, measurable knock-margin benefit. Cast iron is heavier and a worse conductor, but stiffer under heat, which is part of why some high-output blocks still use it.
              </ExpandableInfo>
              <Note>Changing bore, stroke, or configuration does not retroactively rewrite your VE/timing/AFR tables — you will feel the shift on your next dyno pull and can re-tune from there, just like swapping a real short block.</Note>
            </BuildSection>

            <BuildSection
              active={buildSection === 'boltons'} onClick={() => setBuildSection(buildSection === 'boltons' ? null : 'boltons')}
              icon={Package} label="Bolt-On Parts"
              sub={`${Object.values(mods).filter((v) => v).length}/4 installed`}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 9 }}>
                <button onClick={resetToStock} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: T.ink2, fontSize: 11, fontWeight: 600 }}>
                  <RotateCcw size={12} /> RESET ALL TO STOCK
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.keys(MOD_INFO).map((key) => (
                  <button key={key} onClick={() => installMod(key)} disabled={mods[key]} style={{
                    textAlign: 'left', padding: '11px 13px', borderRadius: 10,
                    border: `1px solid ${mods[key] ? '#1f4a30' : T.line}`,
                    background: mods[key] ? T.greenBg : T.panel2,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: mods[key] ? T.green : T.ink }}>{MOD_INFO[key].label}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: mods[key] ? T.green : T.amberInk }}>{mods[key] ? 'INSTALLED' : 'INSTALL'}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 3 }}>{MOD_INFO[key].blurb}</div>
                  </button>
                ))}
              </div>

            </BuildSection>

            <BuildSection
              active={buildSection === 'turbo'} onClick={() => setBuildSection(buildSection === 'turbo' ? null : 'turbo')}
              icon={Wind} label="Forced Induction"
              sub={turboOn ? `On · ${TURBINE_OPTS[turbineIdx].label.split(' ')[0]} turbine · peak ${Math.max(...boostCurve)} psi` : 'Not installed'}
            >
              <ToggleRow label="Turbo kit" sub="Adds boost near WOT, with spool lag off idle" checked={turboOn} onChange={setTurboOn} />

              <div style={{ maxHeight: turboOn ? 3000 : 0, opacity: turboOn ? 1 : 0, overflow: 'hidden', transition: 'max-height .4s ease, opacity .3s ease' }}>
                <div style={{ paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: T.ink2, marginBottom: 6, fontWeight: 600 }}>Turbine Size</div>
                  <PickList options={TURBINE_OPTS.map((o) => ({ label: o.label, value: o.label }))} value={TURBINE_OPTS[turbineIdx].label} onChange={(v) => setTurbineIdx(TURBINE_OPTS.findIndex((o) => o.label === v))} />
                  <div style={{ fontSize: 12, color: T.ink2, marginBottom: 6, marginTop: 4, fontWeight: 600 }}>Compressor Size</div>
                  <Seg options={COMPRESSOR_OPTS.map((o) => ({ label: o.label, value: o.label }))} value={COMPRESSOR_OPTS[compressorIdx].label} onChange={(v) => setCompressorIdx(COMPRESSOR_OPTS.findIndex((o) => o.label === v))} />
                  <div style={{ fontSize: 11, color: T.ink3, marginBottom: 10, marginTop: 4 }}>Ceiling before it runs outside its efficient range: ~{COMPRESSOR_OPTS[compressorIdx].boostCeiling} psi</div>
                  <ExpandableInfo title="Turbine vs. compressor — different jobs">
                    The turbine sits in the exhaust and spins from exhaust energy — its size sets how quickly it spools (small = fast but chokes exhaust flow up top; large = laggy but flows more at redline). The compressor sits in the intake and does the actual pressurizing — its size sets a practical boost ceiling before it's forced outside its efficient operating range, making hot, inefficient, knock-prone air.
                    <br /><br />Real turbo shops size compressors by required <b style={{ color: T.ink }}>airflow</b>, not boost pressure. The industry rule of thumb is about <b style={{ color: T.ink }}>10 crank horsepower per lb/min of air</b> (roughly 8.5 whp after drivetrain loss) — so a 400 whp target needs a compressor good for roughly 47 lb/min, which you then check against the manufacturer's compressor map.
                    <br /><br />Note that this figure barely changes with fuel. E85 needs far more fuel by volume, but it also releases almost exactly the same energy per unit of <i>air</i> as gasoline, so airflow — not fuel type — sets the power ceiling. Octane still helps, but through better timing, not through a bigger number here.
                  </ExpandableInfo>

                  <div style={{ marginTop: 4, marginBottom: 14 }}>
                    <ToggleRow label="Intercooler" sub="Cools charge air, buys knock margin under boost" checked={mods.intercooler} onChange={(v) => setMods((m) => ({ ...m, intercooler: v }))} color={T.cyan} />
                  </div>

                  <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8, fontWeight: 600 }}>Boost Target Curve</div>

                  <Panel tight style={{ marginBottom: 10 }}>
                    {/* Tap a bar to select that RPM point, then edit it below with full-width controls. */}
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 104 }}>
                      {RPM.map((r, i) => {
                        const on = boostSel === i;
                        const ceiling = COMPRESSOR_OPTS[compressorIdx].boostCeiling;
                        const over = boostCurve[i] > ceiling;
                        return (
                          <button key={r} onClick={() => setBoostSel(i)} style={{
                            flex: 1, height: '100%', padding: 0, borderRadius: 7,
                            border: `1px solid ${on ? T.amber : T.line}`,
                            background: on ? T.amberBg : T.panel,
                            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden',
                          }}>
                            <div style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 800, color: over ? T.red : on ? T.amberInk : T.ink2, paddingBottom: 2 }}>
                              {boostCurve[i]}
                            </div>
                            <div style={{
                              height: `${(boostCurve[i] / 25) * 72}%`, minHeight: boostCurve[i] > 0 ? 3 : 0,
                              background: over ? T.red : on ? T.amber : '#7a4526',
                              borderRadius: '3px 3px 0 0', transition: 'height .12s',
                            }} />
                            <div style={{ fontSize: 8, color: on ? T.amberInk : T.ink3, fontFamily: T.mono, padding: '3px 0' }}>
                              {r >= 1000 ? (r / 1000).toFixed(1) + 'k' : r}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </Panel>

                  <Panel tight style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <span style={{ fontSize: 10.5, letterSpacing: 1, color: T.ink2, fontWeight: 700 }}>{RPM[boostSel]} RPM</span>
                      <span style={{ fontFamily: T.mono, fontSize: 24, fontWeight: 800, color: boostCurve[boostSel] > COMPRESSOR_OPTS[compressorIdx].boostCeiling ? T.red : T.amberInk }}>
                        {boostCurve[boostSel]}<span style={{ fontSize: 12, color: T.ink2, marginLeft: 3 }}>psi</span>
                      </span>
                    </div>
                    <input type="range" min={0} max={25} step={1} value={boostCurve[boostSel]}
                      onChange={(e) => setBoostAt(boostSel, Number(e.target.value))}
                      style={{ width: '100%', accentColor: T.amber }} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      {[-5, -1, 1, 5].map((d) => (
                        <button key={d} onClick={() => setBoostAt(boostSel, (boostCurve[boostSel] ?? 0) + d)}
                          style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel,
                            color: d < 0 ? '#ff9d7a' : T.green, fontWeight: 800, fontFamily: T.mono, fontSize: 14 }}>
                          {d > 0 ? '+' : ''}{d}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button onClick={() => setBoostCurve(RPM.map(() => clamp(Number(boostCurve[boostSel]) || 0, 0, 25)))}
                        style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.ink2, fontWeight: 700, fontSize: 11 }}>
                        FLAT ACROSS ALL
                      </button>
                      <button onClick={() => { const peak = boostCurve[boostSel]; setBoostCurve(RPM.map((r) => Math.round(peak * clamp((r - 1500) / 2600, 0, 1)))); }}
                        style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.ink2, fontWeight: 700, fontSize: 11 }}>
                        SPOOL RAMP
                      </button>
                      {/* Built from RPM so the curve can never be shorter than the
                          axis. A hand-written literal previously had seven entries
                          for eight breakpoints, and the next edit put NaN through
                          the entire simulation. */}
                      <button onClick={() => setBoostCurve(RPM.map(() => 0))}
                        style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.ink2, fontWeight: 700, fontSize: 11 }}>
                        ZERO
                      </button>
                    </div>
                    <div style={{ fontSize: 10.5, color: Math.max(...boostCurve) > COMPRESSOR_OPTS[compressorIdx].boostCeiling ? T.red : T.ink3, marginTop: 8 }}>
                      Compressor efficient to ~{COMPRESSOR_OPTS[compressorIdx].boostCeiling} psi{Math.max(...boostCurve) > COMPRESSOR_OPTS[compressorIdx].boostCeiling ? ' — you are past it, expect hot inefficient air' : ''}
                    </div>
                  </Panel>

                  <Note tone="warn">Stock calibrations have no real tuning above ~101 kPa. Adding boost without retarding SPARK and richening FUEL in the high-MAP rows will knock hard — run a pull and read the log.</Note>

                  <ExpandableInfo title="Why boost costs you timing">
                    Boost packs more air and fuel into the same cylinder volume before combustion starts, raising peak pressure and temperature for a given amount of spark advance. The same timing that was safe with no boost becomes knock-prone at 8-10 psi through the same head and pistons — which is why boosted tunes run less initial timing than a naturally aspirated tune, and why timing has to come out further as boost climbs. Set your target here, then dial in TIMING and AFR to match.
                  </ExpandableInfo>
                </div>
              </div>
            </BuildSection>

            <BuildSection
              active={buildSection === 'exhaust'} onClick={() => setBuildSection(buildSection === 'exhaust' ? null : 'exhaust')}
              icon={Flame} label="Exhaust"
              sub={EXHAUST_DIA_OPTS[exhaustDiaIdx].label}
            >
              <div style={{ fontSize: 12, color: T.ink2, marginBottom: 6, fontWeight: 600 }}>Exhaust Diameter</div>
              <Seg options={EXHAUST_DIA_OPTS.map((o) => ({ label: o.label, value: o.label }))} value={EXHAUST_DIA_OPTS[exhaustDiaIdx].label} onChange={(v) => setExhaustDiaIdx(EXHAUST_DIA_OPTS.findIndex((o) => o.label === v))} />
              <div style={{ fontSize: 11, color: T.ink3, marginBottom: 4 }}>
                Estimated ideal for this build: ~{idealExhaustDia.toFixed(2)} in
                {turboOn && Math.max(...boostCurve) > 0 && <span style={{ color: T.amberInk }}> (raised by boost)</span>}
              </div>
              <ExpandableInfo title="Why exhaust diameter isn't just 'bigger is better'">
                Undersized piping restricts flow at high RPM, choking VE right when the engine wants air moving fastest. Oversized piping does the opposite at low RPM — exhaust velocity drops, scavenging gets lazy, and low-end response suffers.
                <br /><br />The long-standing shop rule is about <b style={{ color: T.ink }}>one inch of total pipe diameter per 100 crank horsepower</b>. Note that this follows POWER, not just engine size — which is why adding boost raises the ideal diameter for the very same engine. This sandbox estimates that target from your displacement and boost, and shows how far your choice sits from it.
              </ExpandableInfo>
            </BuildSection>
          </div>
        )}

        {/* ---------- TUNE: sub-view switcher for the calibration tables ---------- */}
        {tab === 'tune' && (
          <div style={{ display: 'flex', gap: 6, padding: '14px 16px 0' }}>
            {TUNE_VIEWS.map((v) => {
              const on = tuneView === v.id;
              const Icon = v.icon;
              return (
                <button key={v.id} onClick={() => { setTuneView(v.id); setSelection(null); }} style={{
                  flex: 1, padding: '10px 0 9px', borderRadius: 10, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 10, letterSpacing: 0.4,
                  border: `1px solid ${on ? T.amber : T.line}`, background: on ? T.amberBg : T.panel2,
                  color: on ? T.amberInk : T.ink2,
                }}>
                  <Icon size={15} />{v.label}
                </button>
              );
            })}
          </div>
        )}

        {tab === 'tune' && journeyStep === 1 && (
          <div style={{ padding: '14px 16px 0' }}>
            <JourneyBanner step={1} onAdvance={() => { setJourneyStep(2); changeTab('dash'); }} onDismiss={() => setJourneyStep(99)} />
          </div>
        )}

        {tab === 'tune' && tuneView === 've' && (
          <>
            <div style={{ padding: '16px 16px 0' }}>
              <Eyebrow icon={Grid3x3}>Volumetric Efficiency</Eyebrow>
              <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 12, lineHeight: 1.5 }}>How completely the cylinder fills at each engine speed and load. Rows are manifold pressure (MAP kPa &mdash; about 100 is wide open, higher is boost); columns are RPM. Tap any cell for reference data.</div>
              <TuningGrid data={ve} min={10} max={130} decimals={0} {...gridProps} />

              {veAdvice && (
                veAdvice.inSync ? (
                  <div style={{ display: 'flex', gap: 8, background: T.greenBg, border: '1px solid #1f4a30', borderRadius: 10, padding: '11px 13px', margin: '10px 0', fontSize: 12.5, color: T.green, lineHeight: 1.5 }}>
                    <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>VE table matches your current hardware. Nothing to correct.</div>
                  </div>
                ) : (
                  <div style={{ background: T.panel2, border: `1px solid ${T.amber}`, borderRadius: 10, padding: '12px 13px', margin: '10px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 10, letterSpacing: 1, color: T.amberInk, fontWeight: 800 }}>VE OUT OF SYNC WITH HARDWARE</div>
                      <div style={{ fontSize: 11, fontFamily: T.mono, color: T.amberInk, fontWeight: 700 }}>{veAdvice.maxAbs.toFixed(0)}% max gap</div>
                    </div>
                    <div style={{ fontSize: 12, color: '#a5aebb', lineHeight: 1.55, marginBottom: 9 }}>
                      Your hardware changed but this table is still the old log. Here is what re-logging airflow on the dyno would actually show:
                    </div>
                    {veAdvice.recs.map((r, i) => (
                      <div key={i} style={{ marginBottom: 9 }}>
                        <div style={{ fontSize: 12, color: T.ink, fontWeight: 700 }}>{r.rpmText}</div>
                        <div style={{ fontSize: 11.5, color: '#a5aebb', lineHeight: 1.5, marginTop: 2 }}>{r.text}</div>
                        <div style={{ fontSize: 10.5, color: T.cyan, fontFamily: T.mono, marginTop: 3 }}>{r.cells.join('   ')}</div>
                      </div>
                    ))}
                    <button onClick={recalcVE} style={{ width: '100%', marginTop: 4, padding: '11px 0', borderRadius: 9, border: 'none', background: T.amber, color: '#1a0f08', fontWeight: 800, fontSize: 12.5 }}>
                      ACCEPT RE-LOGGED VALUES
                    </button>
                    <div style={{ fontSize: 10.5, color: T.ink3, textAlign: 'center', marginTop: 6 }}>Or type them in yourself — these are the measured targets, not a suggestion.</div>
                  </div>
                )
              )}

              <ExpandableInfo title="What VE actually means">
                VE compares the air trapped in the cylinder to the theoretical maximum the swept volume could hold. It rises with RPM as intake tuning matches resonance, then falls as the valves cannot flow fast enough — that fall is why every N/A engine has a torque peak. More air here means more fuel needed to hit a given AFR and more potential torque; VE is really the master variable, and timing/AFR are how you extract power from whatever air is already there.
                <br /><br /><b style={{ color: T.ink }}>As a beginner:</b> leave VE alone at first. It is set by real hardware (intake, heads, cams) — the Bolt-Ons on BUILD already move it for you when you install parts. Spend your early pulls learning TIMING and AFR before you start hand-editing VE.
              </ExpandableInfo>
            </div>
            <div style={{ flex: 1 }} />
            <SelectionDock data={ve} setData={setVe} selection={selection} min={10} max={130} decimals={0} unit="%" onClose={() => setSelection(null)} kind="ve" />
          </>
        )}

        {tab === 'tune' && tuneView === 'timing' && (
          <>
            <div style={{ padding: '16px 16px 0' }}>
              <Eyebrow icon={Zap}>Ignition Timing</Eyebrow>
              <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 12 }}>Degrees of spark advance before top dead center (° BTDC).</div>
              <TuningGrid data={timing} min={-5} max={50} decimals={0} {...gridProps} />
              {calAdvice.overAdvanced.length > 0 ? (
                <div style={{ background: T.redBg, border: `1px solid #3a2020`, borderRadius: 10, padding: '12px 13px', margin: '10px 0' }}>
                  <div style={{ fontSize: 10, letterSpacing: 1, color: '#ff9d9d', fontWeight: 800, marginBottom: 7 }}>
                    {calAdvice.overAdvanced.length} CELLS BEYOND THE KNOCK LIMIT
                  </div>
                  <div style={{ fontSize: 12, color: '#a5aebb', lineHeight: 1.55, marginBottom: 8 }}>
                    Your current hardware will not tolerate this much advance here. These cells are asking for more timing than the charge, octane and compression allow:
                  </div>
                  {calAdvice.overAdvanced.slice(0, 5).map((c, i) => (
                    <div key={i} style={{ fontSize: 11, fontFamily: T.mono, color: T.cyan, marginBottom: 2 }}>
                      {c.map} kPa / {c.rpm} RPM: {c.current}° → {c.suggested}°
                    </div>
                  ))}
                  {calAdvice.overAdvanced.length > 5 && <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 3 }}>…and {calAdvice.overAdvanced.length - 5} more</div>}
                  <div style={{ fontSize: 11, color: T.ink3, marginTop: 8 }}>Edit them yourself — a calibration is yours to make, not something the app should silently rewrite.</div>
                </div>
              ) : calAdvice.underAdvanced.length > 4 ? (
                <div style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 10, padding: '11px 13px', margin: '10px 0', fontSize: 12, color: '#a5aebb', lineHeight: 1.5 }}>
                  <b style={{ color: T.amberInk }}>Timing left on the table.</b> {calAdvice.underAdvanced.length} cells are more than 3° below what this build would tolerate. Safe, but you are giving away torque — advance them a little at a time and pull between each change.
                </div>
              ) : (
                <div style={{ background: T.greenBg, border: '1px solid #1f4a30', borderRadius: 10, padding: '11px 13px', margin: '10px 0', fontSize: 12.5, color: T.green }}>
                  Spark table sits within the knock limit for this hardware.
                </div>
              )}

              <ExpandableInfo title="Why the app never rewrites your spark or fuel tables">
                The VE table auto-syncs because volumetric efficiency is a <b style={{ color: T.ink }}>measurement of the hardware</b> — swap a cam and a tuner simply re-logs airflow, and the numbers are what they are.
                <br /><br />Spark and fuel are different: they are <b style={{ color: T.ink }}>your calibration</b>, a set of judgement calls about how much risk to take for how much power. A real ECU does not retune itself when you bolt on a turbo — it keeps running the old numbers into the new hardware, which is exactly how engines get hurt.
                <br /><br />So the app tells you what the hardware will now tolerate, and leaves the editing to you. That gap between "what the engine can take" and "what your table asks for" is the entire job.
              </ExpandableInfo>

              <ExpandableInfo title="Why timing has a sweet spot (MBT)">
                Combustion is not instant — the flame front takes time to burn through the mixture. Timing decides when the burn starts so peak cylinder pressure lands just after top dead center, where it does useful work. Advance too far and pressure peaks before the piston is ready, fighting the crank and risking knock; retard too far and you are burning fuel after the piston has already started down, wasting it as heat. MBT is the earliest timing that still lands the burn right — past it, more advance buys almost nothing, only risk.
                <br /><br /><b style={{ color: T.ink }}>As a beginner:</b> nudge one cell 1-2° at a time, run a pull, and read the log. If it comes back clean with no knock event, you probably still have room. If you see a knock warning, that cell is your new ceiling — back off to what the log suggests and move on.
              </ExpandableInfo>
            </div>
            <div style={{ flex: 1 }} />
            <SelectionDock data={timing} setData={setTiming} selection={selection} min={-5} max={50} decimals={0} unit="°" onClose={() => setSelection(null)} kind="timing" />
          </>
        )}

        {tab === 'tune' && tuneView === 'afr' && (
          <>
            <div style={{ padding: '16px 16px 0' }}>
              <Eyebrow icon={Droplets}>Air-Fuel Ratio Target</Eyebrow>
              <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 12, lineHeight: 1.5 }}>Target air:fuel ratio the ECU aims for. Divide by 14.7 to read it as lambda.</div>
              <TuningGrid data={afr} min={10} max={18} decimals={1} {...gridProps} />
              {calAdvice.wrongMix.length > 0 && (
                <div style={{ background: T.panel2, border: `1px solid ${T.amber}`, borderRadius: 10, padding: '12px 13px', margin: '10px 0' }}>
                  <div style={{ fontSize: 10, letterSpacing: 1, color: T.amberInk, fontWeight: 800, marginBottom: 7 }}>
                    {calAdvice.wrongMix.length} HIGH-LOAD CELLS OFF BEST POWER
                  </div>
                  <div style={{ fontSize: 12, color: '#a5aebb', lineHeight: 1.55, marginBottom: 8 }}>
                    Best-power mixture shifts with boost — richer as cylinder pressure rises. At these points your target is off what this build wants:
                  </div>
                  {calAdvice.wrongMix.slice(0, 5).map((c, i) => (
                    <div key={i} style={{ fontSize: 11, fontFamily: T.mono, color: c.delta < 0 ? '#ff9d9d' : T.cyan, marginBottom: 2 }}>
                      {c.map} kPa / {c.rpm} RPM: {c.current}:1 → {c.suggested}:1 {c.delta < 0 ? '(richen)' : '(lean out)'}
                    </div>
                  ))}
                  {calAdvice.wrongMix.length > 5 && <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 3 }}>…and {calAdvice.wrongMix.length - 5} more</div>}
                </div>
              )}

              <ExpandableInfo title="Why AFR trades power for safety">
                14.7:1 is stoichiometric — burns all the fuel and oxygen with nothing left over, great for emissions and cruise. Peak power sits richer, because the extra fuel absorbs heat as it vaporizes, cooling combustion enough to make more power before knock becomes the limit. Go leaner than that under load and you lose power and raise both knock risk and exhaust gas temperature at once — which is why lean-under-boost is especially dangerous to valves and pistons.
                <br /><br /><b style={{ color: T.ink }}>Best power is not one number.</b> Naturally aspirated engines make best torque near lambda 0.85-0.92 (about 12.5-13.5:1 on gasoline). Under boost, best power moves richer — near lambda 0.82-0.85 (about 12.0-12.5:1) — because you are deliberately buying charge cooling to hold off knock. This sandbox moves its best-power target with your boost level, so the same AFR table that was ideal naturally aspirated reads genuinely lean once you are on 8 psi.
                <br /><br /><b style={{ color: T.ink }}>Reading it in lambda:</b> lambda is AFR divided by the fuel's stoichiometric point, so lambda 0.85 means the same relative richness on any fuel. That is why tuners talk in lambda once E85 enters the picture — 12.5:1 means something completely different on E85 than on pump gas.
                <br /><br /><b style={{ color: T.ink }}>As a beginner:</b> when in doubt, go richer (a lower number), not leaner. A rich cell costs a little power; a lean cell under load is how you actually damage something.
              </ExpandableInfo>
            </div>
            <div style={{ flex: 1 }} />
            <SelectionDock data={afr} setData={setAfr} selection={selection} min={10} max={18} decimals={1} unit=":1" onClose={() => setSelection(null)} kind="afr" />
          </>
        )}

        {tab === 'tune' && tuneView === 'ecu' && (
          <div style={{ padding: 16 }}>
            <Eyebrow icon={Fuel}>Fuel System</Eyebrow>
            {!turboOn && <Note>Naturally aspirated — no turbo installed. Add one on <b>BUILD</b> if you want boost to tune around.</Note>}
            {turboOn && <Note>Turbo hardware and the boost target curve live on <b>BUILD</b> — this tab is fuel-side tuning: octane, injectors, and MAF/ECU.</Note>}

            <div style={{ fontSize: 12, color: T.ink2, margin: '12px 0 6px', fontWeight: 600 }}>Fuel Octane</div>
            <Seg options={OCTANE_OPTS.map((o) => ({ label: o.label, value: o.label }))} value={OCTANE_OPTS[octaneIdx].label} onChange={(v) => setOctaneIdx(OCTANE_OPTS.findIndex((o) => o.label === v))} />
            <ExpandableInfo title="What octane actually does — and what E85 costs you">
              Octane measures a fuel's resistance to auto-igniting under heat and pressure before the spark fires it — not energy content or "power." Higher octane tolerates more cylinder pressure and temperature before knock, letting a tuner run more advance or more boost safely. It does not add power on its own; it raises the ceiling for how much timing/boost you can use before knock becomes the limit.
              <br /><br /><b style={{ color: T.ink }}>E85 is not a free upgrade.</b> Its stoichiometric point is about 9.8:1, not gasoline's 14.7:1 — so hitting the same lambda takes roughly <b style={{ color: T.amberInk }}>1.43× the fuel volume</b>. Switch to E85 without upsizing injectors and you will run out of duty cycle long before you cash in that knock margin. Watch the duty preview below change the moment you select it.
              <br /><br />That trade — huge knock resistance, huge fuel demand — is exactly why serious E85 builds pair it with bigger injectors and a bigger pump, and why "just run E85" is not a shortcut around a fuel system.
            </ExpandableInfo>

            <div style={{ fontSize: 12, color: T.ink2, margin: '10px 0 6px', fontWeight: 600 }}>Fuel Injectors</div>
            <PickList options={INJECTOR_OPTS.map((o) => ({ label: o.label, value: o.label }))} value={INJECTOR_OPTS[injIdx].label} onChange={(v) => setInjIdx(INJECTOR_OPTS.findIndex((o) => o.label === v))} />
            <div style={{ fontSize: 12, color: T.ink2, margin: '12px 0 6px', fontWeight: 600 }}>
              ECU Injector Scaling <span style={{ color: T.ink3, fontWeight: 400 }}>— what the ECU thinks is fitted</span>
            </div>
            <Seg options={INJECTOR_OPTS.map((o) => ({ label: `${o.cc}`, value: o.cc }))} value={ecuInjectorCc} onChange={setEcuInjectorCc} wrap />
            {ecuInjectorCc !== injectorCc ? (
              <div style={{ background: T.redBg, border: `1px solid #3a2020`, borderRadius: 10, padding: '11px 13px', margin: '8px 0', fontSize: 12, color: '#ff9d9d', lineHeight: 1.5 }}>
                <b>Scaling mismatch.</b> Hardware is {injectorCc}cc but the ECU is calibrated for {ecuInjectorCc}cc — every pulse delivers about {((injectorCc / ecuInjectorCc) * 100).toFixed(0)}% of the intended fuel, so the engine runs {injectorCc > ecuInjectorCc ? 'far too rich' : 'dangerously lean'} everywhere.
                <button onClick={() => setEcuInjectorCc(injectorCc)} style={{ display: 'block', width: '100%', marginTop: 9, padding: '10px 0', borderRadius: 8, border: 'none', background: T.amber, color: '#1a0f08', fontWeight: 800, fontSize: 12.5 }}>
                  RESCALE ECU TO {injectorCc}cc
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: T.green, margin: '6px 0 4px' }}>ECU scaling matches the fitted injectors.</div>
            )}
            <ExpandableInfo title="Injector scaling — the step everyone forgets">
              The ECU never commands "fuel" — it commands a pulse width, calculated for the injector size it has been <i>told</i> is fitted. Bolt in bigger injectors without updating that number and every pulse delivers proportionally more fuel than intended, so the engine runs rich everywhere regardless of what your AFR table says.
              <br /><br />Every real tuning platform has this constant: UpRev calls it the <b style={{ color: T.ink }}>K-fuel multiplier</b> (lower it for bigger injectors), HP Tuners calls it <b style={{ color: T.ink }}>injector flow rate</b>. It is the first thing you change after a fuel system upgrade, before touching any table.
            </ExpandableInfo>

            <ExpandableInfo title="Why injector duty cycle limits everything">
              Injectors flow a rated amount of fuel, and the ECU controls delivery by varying how long each stays open per cycle. As RPM and airflow rise, more fuel is needed in less time, and eventually the injector is open almost the whole cycle — that is duty cycle nearing 100%. Past about 90%, there is no more room to add fuel even if the AFR table calls for it, so the mixture leans out on its own regardless of what you commanded.
            </ExpandableInfo>

            <Panel tight style={{ marginTop: 6, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 10, color: T.ink2, letterSpacing: 1, fontWeight: 700 }}>INJECTOR DUTY PREVIEW · WOT @ 6500 RPM</div>
                {fuel.stoich < 14 && <div style={{ fontSize: 10, color: T.amberInk, fontFamily: T.mono, fontWeight: 700 }}>{fuel.label} stoich {fuel.stoich}:1</div>}
              </div>
              <div style={{ height: 8, background: T.panel, borderRadius: 4, marginTop: 8, overflow: 'hidden', border: `1px solid ${T.line}` }}>
                <div style={{ width: `${Math.min(100, dutyPreview)}%`, height: '100%', background: dutyPreview > 90 ? T.red : dutyPreview > 75 ? T.yellow : T.green }} />
              </div>
              <div style={{ fontSize: 12, marginTop: 7, color: dutyPreview > 90 ? '#ff9d9d' : '#c3cad2' }}>
                {dutyPreview.toFixed(0)}% duty {dutyPreview > 90 ? '— undersized for this build, expect forced lean-out' : ''}
              </div>
            </Panel>

            <Eyebrow icon={Zap}>Fuel Control &amp; MAF Scaling</Eyebrow>
            <Panel style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.ink2, fontWeight: 700 }}>
                <span>MAF RECAL STATUS</span>
                <span style={{ color: needsMafRecal ? T.yellow : T.green, fontWeight: 800 }}>{needsMafRecal ? 'HARDWARE CHANGED' : 'STOCK — OK'}</span>
              </div>
              {needsMafRecal && (
                <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 7 }}>
                  {mods.intake && turboOn ? 'Intake + turbo plumbing' : mods.intake ? 'Intake' : 'Turbo plumbing'} changed how air reads across the MAF. Dial in the scalar below, then confirm with a dyno pull.
                </div>
              )}
            </Panel>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 7, fontWeight: 600 }}>MAF Scalar</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
              <input type="range" min={0.75} max={1.25} step={0.01} value={mafScalar} onChange={(e) => setMafScalar(Number(e.target.value))} style={{ flex: 1, accentColor: T.amber }} />
              <div style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 15, width: 52, textAlign: 'right', color: T.ink }}>{mafScalar.toFixed(2)}</div>
            </div>
            <ExpandableInfo title="VE tuning vs. MAF tuning — platforms differ">
              This sandbox exposes a VE table because that is the clearest way to teach airflow. Real platforms split into two camps.
              <br /><br /><b style={{ color: T.ink }}>Speed-density platforms</b> (GM via HP Tuners/EFILive) index a VE table by RPM and MAP — exactly the axes here — and you tune VE directly.
              <br /><br /><b style={{ color: T.ink }}>MAF-based platforms</b> (Nissan via UpRev) barely expose VE at all. Instead you tune a <b style={{ color: T.ink }}>MAF curve indexed by sensor voltage</b>, whose values map to grams per second, plus the K-fuel multiplier and a fuel compensation table. Same physics, different control surface: on a Nissan you correct airflow by reshaping the MAF curve rather than a VE grid.
              <br /><br />Everything you learn here transfers — just expect the knobs to be named differently depending on the platform.
            </ExpandableInfo>

            <ExpandableInfo title="How MAF-based fueling actually works">
              The MAF sensor reports airflow as a voltage, using a curve calibrated for the stock intake's exact diameter. Change the housing size and the same real airflow produces a different voltage, so the ECU's load calculation is wrong even though your fuel/timing tables did not change. At part throttle, closed-loop O2 feedback quietly corrects most of this; at wide-open throttle the ECU usually runs open-loop and blind to the O2 sensor, so the error goes straight through — which is why WOT is where bad MAF scaling shows up hardest.
              <br /><br /><b style={{ color: T.ink }}>As a beginner:</b> do not guess the scalar. Install the part, run a pull, then check the AFR trace and the MAF trim log entry on DYNO — they will tell you which direction and roughly how far to move it.
            </ExpandableInfo>
            {result && (
              <Panel tight style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, color: T.ink2, letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>FUEL TRIM — LAST PULL</div>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke={T.line} />
                    <XAxis dataKey="rpm" stroke={T.ink3} fontSize={10} />
                    <YAxis stroke={T.ink3} fontSize={10} unit="%" />
                    <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11 }} />
                    <Line dataKey="trimPct" name="MAF trim %" stroke={T.violet} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
            )}
          </div>
        )}

        {/* ---------- DYNO: run a pull, then curves / log / datalog / score ---------- */}
        {tab === 'dyno' && (
          <div style={{ padding: 16 }}>
            {journeyStep === 3 && <JourneyBanner step={3} onAdvance={() => setJourneyStep(99)} onDismiss={() => setJourneyStep(99)} />}
            <Eyebrow icon={Activity}>Dyno Cell</Eyebrow>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8, fontWeight: 600 }}>Manifold pressure for the pull (load)</div>
            <Seg options={[100, 70, 40].map((l) => ({ label: `${l} kPa`, value: l }))} value={loadKpa} onChange={setLoadKpa} />
            <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 4, marginBottom: 4 }}>
              ~100 kPa is wide-open throttle naturally aspirated. Boost adds on top and walks the tables into the higher-MAP rows automatically.
            </div>

            <div style={{ margin: '14px 0' }}><Tach rpm={running || result ? currentRpm : 1500} cylinders={engineDerived.cyl} running={running} /></div>

            <button onClick={doRun} disabled={running} style={{
              width: '100%', padding: '15px 0', borderRadius: 12, border: 'none', marginBottom: 16,
              background: running ? '#3a2c1c' : T.amber, color: '#1a0f08', fontWeight: 800, fontSize: 14.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, letterSpacing: 0.3,
              boxShadow: running ? 'none' : '0 6px 18px rgba(255,106,44,0.22)',
            }}>
              <Play size={16} />
              {running ? 'SWEEPING…' : 'RUN DYNO PULL'}
            </button>

            {result && (
              <>
                <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  <StatTile label="PEAK WHP" value={result.peakHp} color={T.amberInk} />
                  <StatTile label="PEAK TQ" value={result.peakTq} unit="lb-ft" color={T.cyan} />
                </div>

                {prevResult && !running && (() => {
                  const dHp = result.peakHp - prevResult.peakHp;
                  const dTq = result.peakTq - prevResult.peakTq;
                  const knockNow = result.events.filter((e) => e.type === 'knock').length;
                  const knockPrev = prevResult.events.filter((e) => e.type === 'knock').length;
                  const dKnock = knockNow - knockPrev;
                  const fmtDelta = (v, unit) => `${v > 0 ? '+' : ''}${v}${unit}`;
                  return (
                    <Panel tight style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TrendingUp size={15} color={T.ink2} style={{ flexShrink: 0 }} />
                      <div style={{ display: 'flex', gap: 14, fontSize: 12.5, flexWrap: 'wrap' }}>
                        <span style={{ color: dHp === 0 ? T.ink2 : dHp > 0 ? T.green : '#ff8f8f', fontFamily: T.mono, fontWeight: 800 }}>{fmtDelta(dHp, ' whp')}</span>
                        <span style={{ color: dTq === 0 ? T.ink2 : dTq > 0 ? T.green : '#ff8f8f', fontFamily: T.mono, fontWeight: 800 }}>{fmtDelta(dTq, ' lb-ft')}</span>
                        <span style={{ color: dKnock === 0 ? T.ink2 : dKnock < 0 ? T.green : '#ff9d9d', fontFamily: T.mono, fontWeight: 800 }}>{knockNow} knock{knockNow === 1 ? '' : 's'} {dKnock !== 0 ? `(${fmtDelta(dKnock, '')})` : ''}</span>
                      </div>
                    </Panel>
                  );
                })()}

                {!running && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                    {[['result', 'CURVES'], ['log', 'PULL LOG'], ['data', 'DATALOG'], ['score', 'SCORE']].map(([id, label]) => {
                      const on = dynoView === id;
                      const flag = id === 'log' && result.events.length > 0;
                      return (
                        <button key={id} onClick={() => setDynoView(id)} style={{
                          flex: 1, padding: '9px 0', borderRadius: 9, fontWeight: 800, fontSize: 10, letterSpacing: 0.3,
                          border: `1px solid ${on ? T.amber : T.line}`, background: on ? T.amberBg : T.panel2,
                          color: on ? T.amberInk : T.ink2, position: 'relative',
                        }}>
                          {label}
                          {flag && <span style={{ position: 'absolute', top: 5, right: 7, width: 5, height: 5, borderRadius: 3, background: T.red }} />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {(running || dynoView === 'result') && (
                <>
                <Panel tight style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: T.ink2, letterSpacing: 1, fontWeight: 700, padding: '2px 0 8px' }}>POWER &amp; TORQUE</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}>
                      <CartesianGrid stroke={T.line} />
                      <XAxis dataKey="rpm" stroke={T.ink3} fontSize={10} type="number" domain={[1500, 7500]} />
                      <YAxis stroke={T.ink3} fontSize={10} />
                      <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {prevResult && <Line dataKey="prevHp" name="Prev WHP" stroke="#3a4149" strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
                      {prevResult && <Line dataKey="prevTorque" name="Prev TQ" stroke="#3a4149" strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
                      <Line dataKey="hp" name="WHP" stroke={T.amber} strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line dataKey="torque" name="Torque" stroke={T.cyan} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Panel>

                <Panel tight style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: T.ink2, letterSpacing: 1, fontWeight: 700, padding: '2px 0 8px' }}>AFR (COMMANDED VS ACTUAL) / TIMING</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chartData} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}>
                      <CartesianGrid stroke={T.line} />
                      <XAxis dataKey="rpm" stroke={T.ink3} fontSize={10} type="number" domain={[1500, 7500]} />
                      <YAxis stroke={T.ink3} fontSize={10} />
                      <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line dataKey="afrCommanded" name="AFR commanded" stroke="#5c6672" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                      <Line dataKey="afr" name="AFR actual" stroke={T.green} strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line dataKey="timing" name="Timing used" stroke={T.yellow} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Panel>
                </>
                )}

                {!running && dynoView === 'data' && (
                  <>
                    <Eyebrow icon={Info}>Datalog</Eyebrow>
                    <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.55, marginBottom: 10 }}>
                      One card per RPM breakpoint. Each line pairs <b style={{ color: T.ink }}>what you asked for</b> with <b style={{ color: T.ink }}>what the engine actually did</b> — a mismatch is the ECU telling you something.
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                      {RPM.map((r) => {
                        const p = result.points.find((pt) => pt.rpm === r);
                        if (!p) return null;
                        const bad = p.knock || p.fuelLimited || p.leanRisk || p.richRisk;
                        const warn = !bad && (p.duty > 85 || p.egt > 870);
                        const edge = bad ? T.red : warn ? T.yellow : T.line;

                        // Each row: label, what was asked, what happened, and a verdict.
                        const rows = [
                          { k: 'Airflow', asked: p.veTable !== p.ve ? `${p.veTable}% VE` : null, got: `${p.maf} g/s`,
                            note: p.veTable !== p.ve
                              ? `${p.map} kPa manifold · table says ${p.veTable}% VE, engine actually flowed ${p.ve}%`
                              : `${p.map} kPa manifold · ${p.ve}% VE`,
                            ok: Math.abs(p.veTable - p.ve) / Math.max(1, p.ve) < 0.03 },
                          { k: 'Timing', asked: `${p.commandedTiming}°`, got: `${p.timing}°`,
                            note: p.knock ? `ECU pulled ${p.knockPull.toFixed(1)}° — too advanced for this cylinder pressure` : 'ran your commanded value',
                            ok: !p.knock },
                          { k: 'Mixture', asked: `${p.afrCommanded}:1`, got: `${p.afr}:1`,
                            note: p.fuelLimited ? 'injectors out of time — mixture leaned out on its own'
                              : p.richRisk ? 'far richer than commanded — check injector scaling'
                              : `lambda ${p.lambda} · best power here is ${p.bestAfr}:1`,
                            ok: !p.fuelLimited && !p.richRisk && !p.leanRisk },
                          { k: 'Injectors', asked: null, got: `${p.duty}% duty`,
                            note: `${p.pw} ms of the ${(120000 / p.rpm).toFixed(1)} ms available${p.duty > 90 ? ' — at the limit' : ''}`,
                            ok: p.duty <= 90 },
                          { k: 'Heat', asked: null, got: `${p.egt}°C`,
                            note: `intake charge ${p.iat}°C${p.egt > 950 ? ' · exhaust running hot' : ''}`,
                            ok: p.egt <= 950 },
                        ];

                        return (
                          <div key={r} style={{ border: `1px solid ${edge}`, borderRadius: 10, background: T.panel2, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: bad ? T.redBg : warn ? T.yellowBg : T.panel }}>
                              <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 14, color: T.ink }}>{r} RPM</span>
                              <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: bad ? T.red : warn ? T.yellow : T.green }}>
                                {p.hp} whp · {p.torque} lb-ft{bad ? '  ⚠' : warn ? '  !' : '  ✓'}
                              </span>
                            </div>
                            <div style={{ padding: '4px 12px 10px' }}>
                              {rows.map((row, i) => (
                                <div key={i} style={{ paddingTop: 7 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                    <span style={{ fontSize: 11.5, color: T.ink2, fontWeight: 600, minWidth: 62 }}>{row.k}</span>
                                    <span style={{ fontFamily: T.mono, fontSize: 12, color: row.ok ? T.ink : T.red, fontWeight: 700, textAlign: 'right' }}>
                                      {row.asked != null && <span style={{ color: T.ink3, fontWeight: 400 }}>{row.asked} → </span>}
                                      {row.got}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 10.5, color: row.ok ? T.ink3 : '#ff9d9d', lineHeight: 1.4, marginTop: 1 }}>{row.note}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <ExpandableInfo title="How to read a datalog">
                      Diagnosis happens in the <b style={{ color: T.ink }}>asked → got</b> pairs, not in the power number.
                      <br /><br /><b style={{ color: T.ink }}>Timing</b>: if the two differ, the ECU overrode you. That is knock retard, and the gap is how far past the limit your table was. Tuners treat anything sustained above ~2° as damaging.
                      <br /><br /><b style={{ color: T.ink }}>Mixture</b>: if actual is not what you commanded, the cause is upstream of the fuel table — usually injectors out of duty cycle, MAF scaling, or an ECU injector size that does not match the hardware. Do not paper over it by editing fuel cells; fix the cause.
                      <br /><br /><b style={{ color: T.ink }}>Injectors</b>: duty is a time budget. At 7500 RPM there are only 16 ms in an engine cycle. Past about 90% there is no room left and the mixture goes lean regardless of what you asked for.
                      <br /><br /><b style={{ color: T.ink }}>Heat</b>: exhaust temperature rises with retarded timing and lean mixtures. Sustained above ~950°C cooks turbines and valves.
                    </ExpandableInfo>

                    <Eyebrow icon={Grid3x3}>Fuel Trim Histogram</Eyebrow>
                    <ExpandableInfo title="How real tuners actually correct a VE table">
                      This is the workflow every professional platform is built around. You log a pull, bin the difference between commanded and actual mixture onto the same RPM x MAP grid as your VE table, then apply that error back into the cells.
                      <br /><br />A cell reading <b style={{ color: T.ink }}>+6%</b> means the engine ran 6% leaner than you commanded, which can only happen if it actually pulled 6% <i>more</i> air than your VE table claimed — so that cell should go <b style={{ color: T.ink }}>up</b> 6%. A negative cell means the opposite: the table is over-reporting airflow, the ECU is over-fuelling, and the number should come down.
                      <br /><br />The ECU has no way to measure cylinder filling directly. It fuels from your table and nothing else, so a wrong table means wrong fuel, every time. Blue cells are within tolerance; red means your table is lying to the ECU at that point. Correct, re-pull, repeat until it is flat. A cell you hit squarely lands on the truth in one pass; the rest take a couple, because every logged point is interpolated between four cells.
                    </ExpandableInfo>
                    {!histogram ? (
                      <button onClick={buildHistogram} style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: `1px solid ${T.cyan}`, background: T.cyanBg, color: T.cyan, fontWeight: 800, fontSize: 12.5, marginBottom: 16 }}>
                        BUILD HISTOGRAM FROM THIS PULL
                      </button>
                    ) : (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ overflowX: 'auto', border: `1px solid ${T.line}`, borderRadius: 10, marginBottom: 8 }}>
                          <div style={{ display: 'inline-block', minWidth: '100%' }}>
                            <div style={{ display: 'flex' }}>
                              <div style={{ width: 44, flexShrink: 0, background: T.panel }} />
                              {RPM.map((r) => (
                                <div key={r} style={{ width: 51, height: 26, flexShrink: 0, background: T.panel, color: T.ink2, fontFamily: T.mono, fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: `1px solid ${T.line}` }}>{r}</div>
                              ))}
                            </div>
                            {LOAD.map((m, ri) => (
                              <div key={m} style={{ display: 'flex' }}>
                                <div style={{ width: 44, height: 32, flexShrink: 0, background: T.panel, color: T.ink2, fontFamily: T.mono, fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: `1px solid ${T.line}` }}>{m}</div>
                                {RPM.map((_, ci) => {
                                  const e = histogram[ri][ci];
                                  const mag = e == null ? 0 : Math.min(1, Math.abs(e) / 12);
                                  const bg = e == null ? T.panel2 : `hsl(${e > 0 ? 8 : 200}, 60%, ${14 + mag * 22}%)`;
                                  return (
                                    <div key={ci} style={{ width: 51, height: 32, flexShrink: 0, background: bg, color: e == null ? T.ink3 : '#fff', fontFamily: T.mono, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,0,0,0.35)' }}>
                                      {e == null ? '—' : `${e > 0 ? '+' : ''}${e.toFixed(1)}`}
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ fontSize: 10.5, color: T.ink3, marginBottom: 8 }}>Cells show % airflow error (blank = not visited during this pull). Rows are MAP kPa, columns RPM.</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={applyHistogram} style={{ flex: 2, padding: '12px 0', borderRadius: 10, border: 'none', background: T.amber, color: '#1a0f08', fontWeight: 800, fontSize: 12.5 }}>
                            APPLY CORRECTIONS TO VE
                          </button>
                          <button onClick={() => setHistogram(null)} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink2, fontWeight: 700, fontSize: 12.5 }}>
                            DISCARD
                          </button>
                        </div>
                      </div>
                    )}

                  </>
                )}

                {!running && dynoView === 'log' && (
                  <>
                    <Eyebrow icon={AlertTriangle}>Pull Log</Eyebrow>
                    {result.events.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: T.green, background: T.greenBg, border: '1px solid #1f4a30', borderRadius: 10, padding: 12 }}>
                        Clean pull — no knock, fueling, or trim issues across the sweep.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {result.events.map((e, i) => {
                          const isDanger = e.type === 'knock' || e.type === 'valve' || e.type === 'rich' || e.type === 'injscale' || e.type === 'float';
                          const isWarn = e.type === 'lean' || e.type === 'fuel' || e.type === 'compressor' || e.type === 'cam';
                          const isViolet = e.type === 'maf';
                          const bg = isDanger ? T.redBg : isWarn ? T.yellowBg : isViolet ? T.violetBg : T.panel2;
                          const bd = isDanger ? '#3a2020' : isWarn ? '#3a2f16' : isViolet ? '#382a4a' : T.line;
                          const fg = isDanger ? '#ff9d9d' : isWarn ? '#ffcf8a' : isViolet ? T.violet : T.cyan;
                          return (
                            <div key={i} style={{ padding: '11px 12px', borderRadius: 10, background: bg, border: `1px solid ${bd}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <div style={{ display: 'flex', gap: 8, fontSize: 12.5, fontWeight: 700, color: fg }}>
                                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                  <span>{e.msg}</span>
                                </div>
                                {e.impact != null && <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 800, color: fg, flexShrink: 0 }}>-{e.impact}</span>}
                              </div>
                              {e.cause && <div style={{ fontSize: 11.5, color: '#9aa4b0', marginTop: 6, paddingLeft: 22 }}><b style={{ color: '#c3cad2' }}>Why: </b>{e.cause}</div>}
                              {e.fix && <div style={{ fontSize: 11.5, color: '#9aa4b0', marginTop: 4, paddingLeft: 22 }}><b style={{ color: '#c3cad2' }}>Try: </b>{e.fix}</div>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                  </>
                )}

                {!running && dynoView === 'score' && scores && (
                      <>
                        <Eyebrow icon={Trophy}>Scorecard</Eyebrow>
                        <Panel style={{ marginBottom: 10, background: T.amberBg, border: `1px solid ${T.amber}`, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: T.amberInk, letterSpacing: 1.5, fontWeight: 800 }}>PULL SCORE</div>
                          <div style={{ fontSize: 40, fontWeight: 800, fontFamily: T.mono, color: T.amberInk, lineHeight: 1.1 }}>{scores.pull}</div>
                          <div style={{ fontSize: 11.5, color: scores.pull >= bestScore ? T.green : T.ink2, fontWeight: 700, marginTop: 2 }}>
                            {scores.pull >= bestScore ? 'NEW BEST' : `Best: ${bestScore}`}
                          </div>
                        </Panel>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                          {[['TUNING SCORE', scores.tuning], ['ENGINEER SCORE', scores.engineer]].map(([label, s]) => {
                            const c = statusColor(s.score);
                            return (
                              <div key={label} style={{ flex: 1, background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, padding: 14 }}>
                                <div style={{ fontSize: 9.5, color: T.ink2, letterSpacing: 1, fontWeight: 700 }}>{label}</div>
                                <div style={{ fontSize: 28, fontWeight: 800, fontFamily: T.mono, color: c, marginTop: 2 }}>{s.score}</div>
                                <div style={{ fontSize: 11, color: c, fontWeight: 700 }}>{s.label}</div>
                              </div>
                            );
                          })}
                        </div>
                        <Note>Pull Score rewards actual output (peak whp + torque), scaled by how clean (Tuning) and how sound (Engineer) the build is — a big, slightly imperfect pull can still out-score a small, spotless one. It has no ceiling; every pull is a chance to beat your best.</Note>
                        {(scores.tuning.deductions.length > 0 || scores.engineer.deductions.length > 0) && (
                          <Panel tight style={{ marginBottom: 16, fontSize: 11.5, color: '#9aa4b0', fontFamily: T.mono, lineHeight: 1.8 }}>
                            {scores.tuning.deductions.map((d, i) => <div key={'t' + i}>{d}</div>)}
                            {scores.engineer.deductions.map((d, i) => <div key={'e' + i}>{d}</div>)}
                          </Panel>
                        )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ display: 'flex', borderTop: `1px solid ${T.line}`, background: T.panel, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => changeTab(t.id)} style={{
              flex: 1, padding: '10px 0 9px', background: 'none', border: 'none', position: 'relative',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              color: active ? T.amberInk : T.ink3,
            }}>
              {active && <div style={{ position: 'absolute', top: 0, left: '30%', right: '30%', height: 2, background: T.amber, borderRadius: '0 0 2px 2px' }} />}
              <Icon size={17} />
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.3 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
