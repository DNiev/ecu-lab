/**
 * Renders the chart every preset would get, stock and with all three bolt-ons, to PNG
 * files, so the real resvg output can be looked at before a deploy. The root test suite
 * never loads resvg's native binary; this is the check of bot/render.js.
 *
 *   cd bot && npm ci && node scripts/preview.js <output-dir>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_PRESETS } from '../../src/sim/index.js';
import { dynoChartSvg } from '../lib/chart.js';
import { runDyno } from '../lib/dyno.js';
import { replyTitle } from '../lib/reply.js';
import { svgToPng } from '../render.js';

const dir = resolve(process.argv[2] ?? 'dyno-preview');
mkdirSync(dir, { recursive: true });

for (const preset of ENGINE_PRESETS) {
  for (const [suffix, options] of [['stock', {}], ['bolt-ons', { intake: true, exhaust: true, headers: true }]]) {
    const run = runDyno({ engine: preset.id, ...options });
    const file = join(dir, `${preset.id}-${suffix}.png`);
    writeFileSync(file, svgToPng(dynoChartSvg({ stock: run.stock, modified: run.modified, isStock: run.isStock, title: replyTitle(run) })));
    console.log(file);
  }
}
