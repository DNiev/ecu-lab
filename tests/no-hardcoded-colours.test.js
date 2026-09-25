/**
 * Guards the rule theme.js has always stated and nothing ever enforced.
 *
 * A hard-coded colour is invisible to the token layer, so a palette change silently
 * misses it. That is exactly how 58 stray hexes accumulated in one component.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const UI_DIR = new URL('../src/ui/', import.meta.url);

/** Files allowed to name a colour literally: the token layer itself. */
const ALLOWED = new Set(['tokens.js', 'tokens.css']);

/**
 * Files allowed to compute an hsl() colour: the token layer, plus theme.js — the only
 * file where a computed ramp (heat(), deltaHeat(), diffTint()) legitimately lives. This is a
 * separate list from ALLOWED on purpose: theme.js must still fail the hex and rgba
 * checks below, so a raw literal can't hide there. Do not fold this into ALLOWED.
 */
const HSL_ALLOWED = new Set(['tokens.js', 'tokens.css', 'theme.js']);

/** @returns {string[]} every source file under src/ui that must not name a colour */
function sourceFiles() {
  return readdirSync(UI_DIR, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(jsx?|css)$/.test(e.name) && !ALLOWED.has(e.name))
    .map((e) => `${e.parentPath ?? e.path}/${e.name}`);
}

describe('src/ui contains no hard-coded colours', () => {
  for (const file of sourceFiles()) {
    const rel = file.slice(file.indexOf('src/ui'));

    it(`${rel} names no hex colour`, () => {
      const hits = readFileSync(file, 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(hits, `use a token from theme.js instead of ${hits.join(', ')}`).toEqual([]);
    });

    it(`${rel} names no rgb/rgba colour`, () => {
      const hits = readFileSync(file, 'utf8').match(/\brgba?\(\s*\d/g) ?? [];
      expect(hits, 'use a token, or a colour-mix on one, instead').toEqual([]);
    });

    if (!HSL_ALLOWED.has(file.slice(file.lastIndexOf('/') + 1))) {
      it(`${rel} names no hsl colour`, () => {
        const hits = readFileSync(file, 'utf8').match(/\bhsla?\(/g) ?? [];
        expect(hits, 'computed colour ramps belong in theme.js').toEqual([]);
      });
    }
  }
});
