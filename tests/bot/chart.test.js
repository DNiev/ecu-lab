// @vitest-environment jsdom
/**
 * The chart's SVG is checked as a document (jsdom's parser), not as a string, so a
 * structural mistake fails here rather than as a blank image in Discord.
 */

import { describe, expect, it } from 'vitest';

import { tokens } from '../../src/ui/tokens.js';
import { runDyno } from '../../bot/lib/dyno.js';
import { CHART_HEIGHT, CHART_WIDTH, dynoChartSvg, escapeXml } from '../../bot/lib/chart.js';

// Through `window`, which the lint config already knows; DOMParser itself isn't a declared global.
const parse = (svg) => new window.DOMParser().parseFromString(svg, 'image/svg+xml');
const stockRun = runDyno({ engine: 'vq35hr' });
const moddedRun = runDyno({ engine: 'vq35hr', intake: true, headers: true });

describe('dynoChartSvg', () => {
  it('is a well-formed SVG of the agreed size', () => {
    const doc = parse(dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, isStock: stockRun.isStock, title: 'T' }));
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('width')).toBe(String(CHART_WIDTH));
    expect(root.getAttribute('height')).toBe(String(CHART_HEIGHT));
  });

  it('draws power and torque, and no stock overlay for a stock pull', () => {
    const doc = parse(dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, isStock: stockRun.isStock, title: 'T' }));
    expect(doc.querySelector('[data-series="hp"]')).not.toBeNull();
    expect(doc.querySelector('[data-series="torque"]')).not.toBeNull();
    expect(doc.querySelector('[data-series="stock-hp"]')).toBeNull();
    expect(doc.querySelector('[data-series="stock-torque"]')).toBeNull();
  });

  it('overlays the stock curves, dashed, when the build differs', () => {
    const doc = parse(dynoChartSvg({ stock: moddedRun.stock, modified: moddedRun.modified, isStock: moddedRun.isStock, title: 'T' }));
    for (const s of ['stock-hp', 'stock-torque']) {
      const line = doc.querySelector(`[data-series="${s}"]`);
      expect(line).not.toBeNull();
      expect(line.getAttribute('stroke-dasharray')).toBe('5 4');
    }
  });

  it('plots one vertex per point of the pull', () => {
    const doc = parse(dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, isStock: stockRun.isStock, title: 'T' }));
    const d = doc.querySelector('[data-series="hp"]').getAttribute('d');
    expect(d.match(/[ML]/g)).toHaveLength(stockRun.modified.points.length);
  });

  it('escapes the title', () => {
    const svg = dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, isStock: stockRun.isStock, title: 'A <b> & "c"' });
    expect(parse(svg).getElementsByTagName('parsererror')).toHaveLength(0);
    expect(svg).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
  });

  it('uses only the app\'s token colours', () => {
    const svg = dynoChartSvg({ stock: moddedRun.stock, modified: moddedRun.modified, isStock: moddedRun.isStock, title: 'T' });
    const allowed = new Set(Object.values(tokens).filter((v) => typeof v === 'string').map((v) => v.toLowerCase()));
    for (const hex of svg.match(/#[0-9a-f]{3,8}\b/gi) ?? []) expect(allowed).toContain(hex.toLowerCase());
  });

  it('names its font, since resvg sees only the bundled one', () => {
    const svg = dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, isStock: stockRun.isStock, title: 'T' });
    expect(svg).toContain('font-family="Roboto"');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML specials', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});
