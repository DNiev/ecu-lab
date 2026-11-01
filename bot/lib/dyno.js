/**
 * Turns `/dyno`'s options into two dyno pulls: the engine as it ships, and the engine with
 * whatever was changed.
 *
 * The factory tune is never touched. Parts the calibration doesn't know about show up in
 * the pull log as a mixture or MAF problem rather than as free power — that gap is what
 * ECU Lab teaches, and the bot shows it the same way the app does. The pulls come from
 * `buildRig`, the app's own assembly, never a simplified one.
 */

import { OCTANE_OPTS, buildRig, presetById } from '../../src/sim/index.js';

/** The bolt-ons `/dyno` can fit or remove, as named in a preset's `mods`. */
export const MOD_KEYS = ['intake', 'exhaust', 'headers'];

/**
 * An option the sim doesn't recognise. In practice this means the command was registered
 * against a different build of the sim than the one now deployed.
 */
export class DynoInputError extends Error {
  /**
   * @param {string} message
   * @param {unknown} value the unrecognised input
   */
  constructor(message, value) {
    super(message);
    this.name = 'DynoInputError';
    this.value = value;
  }
}

/**
 * @param {{ engine: string, intake?: boolean, exhaust?: boolean, headers?: boolean, fuel?: string }} options
 */
export function runDyno({ engine, intake, exhaust, headers, fuel }) {
  const preset = presetById(engine);
  if (!preset) throw new DynoInputError(`Unknown engine "${engine}"`, engine);

  let octaneIdx = preset.parts.octaneIdx;
  if (fuel !== undefined) {
    octaneIdx = OCTANE_OPTS.findIndex((o) => o.label === fuel);
    if (octaneIdx < 0) throw new DynoInputError(`Unknown fuel "${fuel}"`, fuel);
  }

  /** @type {Record<string, boolean | undefined>} */
  const given = { intake, exhaust, headers };
  const mods = { ...preset.mods };
  for (const k of MOD_KEYS) if (typeof given[k] === 'boolean') mods[k] = given[k];

  const isStock = octaneIdx === preset.parts.octaneIdx && MOD_KEYS.every((k) => mods[k] === preset.mods[k]);
  const stock = buildRig({ preset: preset.id }).pull();
  const modified = isStock ? stock : buildRig({ preset: preset.id, build: { mods, octaneIdx } }).pull();

  // A NaN peak would render as "NaN whp" and an empty chart. That is a sim bug, and
  // the person who hit it should be told so, not shown nonsense.
  for (const r of [stock, modified]) {
    if (!Number.isFinite(r.peakHp) || !Number.isFinite(r.peakTq)) {
      throw new Error(`The pull returned a non-finite peak (${r.peakHp} whp, ${r.peakTq} lb-ft)`);
    }
  }

  return { preset, mods, fuel: OCTANE_OPTS[octaneIdx], isStock, stock, modified };
}
