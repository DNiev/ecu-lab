/**
 * A calibration table as a 3-D surface: one quad per cell, coloured on the same heat
 * ramp as the grid, drawn on a canvas with no dependencies. Drag (or arrow keys) to turn
 * it, double-click to reset.
 *
 * Breakpoints are spaced by index, the way the grid lays them out, so a table with
 * uneven axes reads the same in both views. A point (the live engine, or a replayed
 * pull) is placed where the ECU would read it: between breakpoints by the same linear
 * blend the ECU uses, at the height of the value it reads there.
 */

import React from 'react';

import { heat, shadowAlpha, T } from '../../theme.js';

import styles from './surface.module.css';

/** Where v falls on an ascending axis, as a fractional index (clamped to the ends). */
export function fracIndex(axis, v) {
  if (v <= axis[0]) return 0;
  const last = axis.length - 1;
  if (v >= axis[last]) return last;
  for (let i = 0; i < last; i += 1) {
    if (v <= axis[i + 1]) return i + (v - axis[i]) / (axis[i + 1] - axis[i] || 1);
  }
  return last;
}

/** Bilinear read of z[yi][xi] at (x, y), as an ECU reads a 2-D table: clamped at the edges. */
export function readSurface(x, y, z, xv, yv) {
  const fx = fracIndex(x, xv);
  const fy = fracIndex(y, yv);
  const i = Math.min(Math.floor(fx), x.length - 2);
  const j = Math.min(Math.floor(fy), y.length - 2);
  const tx = x.length > 1 ? fx - i : 0;
  const ty = y.length > 1 ? fy - j : 0;
  const at = (r, c) => z[Math.max(0, Math.min(r, y.length - 1))][Math.max(0, Math.min(c, x.length - 1))];
  const a = at(j, i) * (1 - tx) + at(j, i + 1) * tx;
  const b = at(j + 1, i) * (1 - tx) + at(j + 1, i + 1) * tx;
  return a * (1 - ty) + b * ty;
}

const DEFAULT_VIEW = { yaw: -0.65, pitch: 0.62 };

/**
 * @param {object} props
 * @param {number[]} props.x ascending column breakpoints
 * @param {number[]} props.y ascending row breakpoints
 * @param {number[][]} props.z values, z[row][col] against y and x
 * @param {number} props.lo bottom of the colour and height scale
 * @param {number} props.hi top of it
 * @param {string} props.xLabel
 * @param {string} props.yLabel
 * @param {string} [props.unit]
 * @param {string} props.title for the accessible description
 * @param {{x: number, y: number}[]|null} [props.trace] a path across the table (a pull)
 * @param {number} [props.traceIndex] how far along the trace the highlighted point is
 * @param {{x: number, y: number}|null} [props.point] a single highlighted point (live)
 * @param {number} [props.decimals]
 */
export function Surface3D({ x, y, z, lo, hi, xLabel, yLabel, unit = '', title, trace = null, traceIndex = -1, point = null, decimals = 0 }) {
  const canvasRef = React.useRef(/** @type {HTMLCanvasElement|null} */ (null));
  const boxRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));
  const [view, setView] = React.useState(DEFAULT_VIEW);
  const [width, setWidth] = React.useState(480);
  const drag = React.useRef(/** @type {{x: number, y: number, v: typeof DEFAULT_VIEW}|null} */ (null));

  React.useEffect(() => {
    const el = boxRef.current;
    const RO = typeof window !== 'undefined' ? window.ResizeObserver : undefined;
    if (!el || !RO) return undefined;
    const ro = new RO(([e]) => setWidth(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = Math.round(Math.min(440, Math.max(260, width * 0.62)));
  const focus = point ?? (trace && traceIndex >= 0 ? trace[Math.min(traceIndex, trace.length - 1)] : null);

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return; // jsdom and some print paths have no canvas
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, { width, height, x, y, z, lo, hi, view, trace, traceIndex, focus, xLabel, yLabel, unit, decimals });
  }, [width, height, x, y, z, lo, hi, view, trace, traceIndex, focus, xLabel, yLabel, unit, decimals]);

  const onDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, v: view };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    setView({
      yaw: d.v.yaw + (e.clientX - d.x) * 0.01,
      pitch: Math.min(1.45, Math.max(0.12, d.v.pitch + (e.clientY - d.y) * 0.008)),
    });
  };
  const onUp = () => { drag.current = null; };
  const onKey = (e) => {
    const k = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] }[e.key];
    if (!k) return;
    e.preventDefault();
    setView((v) => ({ yaw: v.yaw + k[0], pitch: Math.min(1.45, Math.max(0.12, v.pitch + k[1])) }));
  };

  const vmin = Math.min(...z.flat());
  const vmax = Math.max(...z.flat());
  return (
    <div ref={boxRef} className={styles.box}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={`3-D view of ${title}: ${xLabel} ${x[0]} to ${x[x.length - 1]} across, ${yLabel} ${y[0]} to ${y[y.length - 1]} deep, values ${vmin.toFixed(decimals)} to ${vmax.toFixed(decimals)} ${unit}. Drag or use the arrow keys to turn it.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => setView(DEFAULT_VIEW)}
        onKeyDown={onKey}
      />
      <div className={styles.hint}>Drag to turn · double-click to reset</div>
    </div>
  );
}

/** Everything the canvas shows, from scratch each frame. */
function draw(ctx, o) {
  const { width, height, x, y, z, lo, hi, view, trace, traceIndex, focus, xLabel, yLabel, unit, decimals } = o;
  ctx.clearRect(0, 0, width, height);
  const nx = x.length;
  const ny = y.length;
  const span = hi - lo || 1;
  const H = 0.85; // surface height relative to the unit floor
  const cy = Math.cos(view.yaw); const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch); const sp = Math.sin(view.pitch);
  // World: X across the columns and Y along the rows, both −1…1; Z up from the floor.
  /** @type {(fi: number, fj: number, v: number) => [number, number, number]} */
  const world = (fi, fj, v) => [nx > 1 ? (fi / (nx - 1)) * 2 - 1 : 0, ny > 1 ? (fj / (ny - 1)) * 2 - 1 : 0, ((Math.min(hi, Math.max(lo, v)) - lo) / span) * H];
  const rot = ([X, Y, Z]) => {
    const xr = X * cy - Y * sy;
    const yr = X * sy + Y * cy;
    return { sx: xr, sy: yr * sp - Z * cp, depth: yr };
  };
  // Fit the box's corners into the canvas, leaving room for the axis labels.
  const corners = [];
  for (const X of [-1, 1]) for (const Y of [-1, 1]) for (const Z of [0, H]) corners.push(rot([X, Y, Z]));
  const minX = Math.min(...corners.map((c) => c.sx)); const maxX = Math.max(...corners.map((c) => c.sx));
  const minY = Math.min(...corners.map((c) => c.sy)); const maxY = Math.max(...corners.map((c) => c.sy));
  const narrow = width < 520;
  const pad = narrow ? 38 : 46;
  const s = Math.min((width - 2 * pad) / (maxX - minX || 1), (height - 2 * pad) / (maxY - minY || 1));
  const ox = width / 2 - ((minX + maxX) / 2) * s;
  const oy = height / 2 - ((minY + maxY) / 2) * s;
  const P = (w) => { const r = rot(w); return { x: ox + r.sx * s, y: oy + r.sy * s, d: r.depth }; };

  // Floor outline and grid.
  ctx.lineWidth = 1;
  ctx.strokeStyle = T.line;
  for (let i = 0; i < nx; i += 1) line(ctx, P(world(i, 0, lo)), P(world(i, ny - 1, lo)));
  for (let j = 0; j < ny; j += 1) line(ctx, P(world(0, j, lo)), P(world(nx - 1, j, lo)));

  // Quads, far to near.
  const quads = [];
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const pts = [P(world(i, j, z[j][i])), P(world(i + 1, j, z[j][i + 1])), P(world(i + 1, j + 1, z[j + 1][i + 1])), P(world(i, j + 1, z[j + 1][i]))];
      const v = (z[j][i] + z[j][i + 1] + z[j + 1][i + 1] + z[j + 1][i]) / 4;
      quads.push({ pts, v, d: pts.reduce((a, p) => a + p.d, 0) / 4 });
    }
  }
  quads.sort((a, b) => a.d - b.d);
  ctx.strokeStyle = shadowAlpha(0.45);
  for (const q of quads) {
    ctx.beginPath();
    q.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = heat(q.v, lo, hi);
    ctx.fill();
    ctx.stroke();
  }

  // Axis labels on the two floor edges nearest the viewer.
  ctx.font = `11px ${T.sans}`;
  ctx.fillStyle = T.ink2;
  const every = (n) => Math.max(1, Math.ceil(n / (narrow ? 3 : 6)));
  const nearY = rot(world(0, 0, lo)).depth > rot(world(0, ny - 1, lo)).depth ? 0 : ny - 1;
  const nearX = rot(world(0, 0, lo)).depth > rot(world(nx - 1, 0, lo)).depth ? 0 : nx - 1;
  for (let i = 0; i < nx; i += every(nx)) label(ctx, P(world(i, nearY + (nearY ? 0.35 : -0.35), lo)), fmtAxis(x[i]));
  for (let j = 0; j < ny; j += every(ny)) label(ctx, P(world(nearX + (nearX ? 0.35 : -0.35), j, lo)), fmtAxis(y[j]));
  ctx.fillStyle = T.ink;
  ctx.font = `600 11px ${T.sans}`;
  label(ctx, P(world((nx - 1) / 2, nearY + (nearY ? 0.9 : -0.9), lo)), `${xLabel} →`);
  label(ctx, P(world(nearX + (nearX ? 0.9 : -0.9), (ny - 1) / 2, lo)), `${yLabel} →`);
  ctx.fillStyle = T.ink2;
  ctx.font = `11px ${T.sans}`;
  const zEdge = P(world(nearX ? 0 : nx - 1, nearY ? 0 : ny - 1, hi));
  label(ctx, { x: zEdge.x, y: zEdge.y - 8 }, `${fmtNum(hi, decimals)} ${unit}`);

  // The trace: the part already run solid, the rest faint.
  if (trace && trace.length > 1) {
    const pts = trace.map((t) => P(world(fracIndex(x, t.x), fracIndex(y, t.y), readSurface(x, y, z, t.x, t.y) + span * 0.01)));
    const upto = traceIndex < 0 ? pts.length - 1 : Math.min(traceIndex, pts.length - 1);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = T.ink3;
    ctx.lineWidth = 1;
    poly(ctx, pts);
    ctx.setLineDash([]);
    ctx.strokeStyle = T.acc;
    ctx.lineWidth = 2.5;
    poly(ctx, pts.slice(0, upto + 1));
  }

  // The highlighted point, dropped to the floor so its RPM and load read off the axes.
  if (focus) {
    const fi = fracIndex(x, focus.x); const fj = fracIndex(y, focus.y);
    const v = readSurface(x, y, z, focus.x, focus.y);
    const top = P(world(fi, fj, v));
    const floor = P(world(fi, fj, lo));
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = T.acc;
    ctx.lineWidth = 1;
    line(ctx, top, floor);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(top.x, top.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = T.acc;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = T.bg;
    ctx.stroke();
    const text = `${fmtNum(v, decimals)} ${unit}`;
    ctx.font = `700 12px ${T.mono}`;
    const w = ctx.measureText(text).width + 10;
    const bx = Math.min(width - w - 4, Math.max(4, top.x + 10));
    const by = Math.max(4, top.y - 26);
    ctx.fillStyle = T.panel3;
    ctx.fillRect(bx, by, w, 18);
    ctx.fillStyle = T.ink;
    ctx.fillText(text, bx + 5, by + 13);
  }
}

const fmtAxis = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10));
const fmtNum = (v, d) => Number(v).toFixed(d);
function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
function poly(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}
function label(ctx, p, text) {
  const w = ctx.measureText(text).width;
  ctx.fillText(text, p.x - w / 2, p.y + 4);
}
