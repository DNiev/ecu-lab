/**
 * SVG to PNG for `/dyno`'s chart, with resvg.
 *
 * Discord shows a PNG inline but not an SVG, and a serverless function has no browser to
 * draw with. resvg is a native SVG renderer (what Vercel's own image generation uses) and
 * needs no system libraries.
 *
 * It sees exactly one font, the bundled Roboto TTF, with system fonts off: a serverless
 * box has none worth relying on, and resvg reads neither WOFF nor WOFF2. The chart
 * names Roboto for that reason. `vercel.json` ships `fonts/` with the function explicitly,
 * since a path built at runtime is invisible to Vercel's file tracing.
 */

import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { CHART_WIDTH } from './lib/chart.js';

const FONT_FILE = fileURLToPath(new URL('./fonts/Roboto-Regular.ttf', import.meta.url));

/**
 * @param {string} svg
 * @returns {Uint8Array} PNG bytes
 */
export function svgToPng(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CHART_WIDTH },
    font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: 'Roboto' },
  });
  return resvg.render().asPng();
}
