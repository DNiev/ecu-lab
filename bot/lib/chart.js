/**
 * The dyno chart for a `/dyno` reply, as SVG.
 *
 * It mirrors DYNO's result chart (src/ui/screens/dyno/ResultScreen.jsx), so a tester sees
 * the same picture in Discord as in the app:
 * - power in `acc` and torque in `cyan`, 2 px wide, on one shared axis
 * - the stock curves in the same colours, dashed `5 4` at half opacity, drawn only when the
 *   build differs from stock
 *
 * Colours come from the app's tokens, never retyped, so a palette change reaches the bot
 * too. Text names Roboto only: the PNG renderer (bot/render.js) loads just the bundled
 * font, and any other family would draw nothing.
 */

import { SWEEP_START_RPM } from '../../src/sim/index.js';
import { tokens } from '../../src/ui/tokens.js';

export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 560;

const PAD = { left: 64, right: 24, top: 56, bottom: 76 };
const FONT = 'font-family="Roboto"';
// Candidate y-axis steps, smallest first. The first that gives at most 8 gridlines wins.
const Y_STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
const X_STEP_RPM = 1000;

/** @param {unknown} text */
export function escapeXml(text) {
  /** @type {Record<string, string>} */
  const map = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
  return String(text).replace(/[<>&"']/g, (c) => map[c]);
}

/**
 * @param {{ stock: {points: object[]}, modified: {points: object[]}, title: string }} input
 * @returns {string}
 */
export function dynoChartSvg({ stock, modified, title }) {
  const showStock = stock !== modified;
  const pulls = showStock ? [stock, modified] : [modified];
  /** @param {{points: any[]}} pull */
  const plotted = (pull) => pull.points.filter((p) => Number.isFinite(p.hp) && Number.isFinite(p.torque));
  const all = pulls.flatMap(plotted);

  const xMin = SWEEP_START_RPM;
  const xMax = Math.max(xMin + X_STEP_RPM, ...all.map((p) => p.rpm));
  const yPeak = Math.max(1, ...all.flatMap((p) => [p.hp, p.torque]));
  const yStep = Y_STEPS.find((s) => (yPeak * 1.05) / s <= 8) ?? Y_STEPS[Y_STEPS.length - 1];
  const yMax = Math.ceil((yPeak * 1.05) / yStep) * yStep;

  const w = CHART_WIDTH - PAD.left - PAD.right;
  const h = CHART_HEIGHT - PAD.top - PAD.bottom;
  /** @param {number} rpm */
  const x = (rpm) => PAD.left + ((rpm - xMin) / (xMax - xMin)) * w;
  /** @param {number} v */
  const y = (v) => PAD.top + h - (v / yMax) * h;
  /** @param {any[]} points @param {'hp' | 'torque'} key */
  const path = (points, key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.rpm).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const parts = [];
  parts.push(`<rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="${tokens.bg}"/>`);
  parts.push(`<text x="${PAD.left}" y="34" ${FONT} font-size="20" fill="${tokens.ink}">${escapeXml(title)}</text>`);

  for (let v = 0; v <= yMax; v += yStep) {
    parts.push(`<line x1="${PAD.left}" x2="${PAD.left + w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${tokens.line}"/>`);
    parts.push(`<text x="${PAD.left - 8}" y="${(y(v) + 4).toFixed(1)}" ${FONT} font-size="12" fill="${tokens.ink2}" text-anchor="end">${v}</text>`);
  }
  for (let rpm = Math.ceil(xMin / X_STEP_RPM) * X_STEP_RPM; rpm <= xMax; rpm += X_STEP_RPM) {
    parts.push(`<line x1="${x(rpm).toFixed(1)}" x2="${x(rpm).toFixed(1)}" y1="${PAD.top}" y2="${PAD.top + h}" stroke="${tokens.line}"/>`);
    parts.push(`<text x="${x(rpm).toFixed(1)}" y="${PAD.top + h + 18}" ${FONT} font-size="12" fill="${tokens.ink2}" text-anchor="middle">${rpm}</text>`);
  }
  parts.push(`<text x="${PAD.left + w / 2}" y="${PAD.top + h + 38}" ${FONT} font-size="12" fill="${tokens.ink2}" text-anchor="middle">RPM</text>`);

  const series = [];
  if (showStock) {
    series.push({ id: 'stock-hp', points: plotted(stock), key: 'hp', colour: tokens.acc, label: 'Stock WHP', dashed: true });
    series.push({ id: 'stock-torque', points: plotted(stock), key: 'torque', colour: tokens.cyan, label: 'Stock TQ', dashed: true });
  }
  series.push({ id: 'hp', points: plotted(modified), key: 'hp', colour: tokens.acc, label: 'WHP', dashed: false });
  series.push({ id: 'torque', points: plotted(modified), key: 'torque', colour: tokens.cyan, label: 'Torque', dashed: false });

  for (const s of series) {
    const style = s.dashed ? 'stroke-width="1.5" stroke-dasharray="5 4" opacity="0.5"' : 'stroke-width="2"';
    parts.push(`<path data-series="${s.id}" d="${path(s.points, /** @type {'hp' | 'torque'} */ (s.key))}" fill="none" stroke="${s.colour}" ${style}/>`);
  }

  // Legend along the bottom, in drawing order with the measured build last.
  let lx = PAD.left;
  const ly = CHART_HEIGHT - 16;
  for (const s of series) {
    const dash = s.dashed ? ' stroke-dasharray="5 4" opacity="0.5"' : '';
    parts.push(`<line x1="${lx}" x2="${lx + 22}" y1="${ly - 4}" y2="${ly - 4}" stroke="${s.colour}" stroke-width="2"${dash}/>`);
    parts.push(`<text x="${lx + 28}" y="${ly}" ${FONT} font-size="12" fill="${tokens.ink2}">${escapeXml(s.label)}</text>`);
    lx += 40 + s.label.length * 7;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">${parts.join('')}</svg>`;
}
