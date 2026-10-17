/**
 * The checks every job shares, and a helper the job definitions use. Their own module so
 * the hand-written customers (jobs.js) and the generated ones (generate.js) can both use
 * them without importing each other.
 */

/** @typedef {import('./jobs.js').Criterion} Criterion */

/** What keeps an engine alive: no knock, never lean under load, and a survivable exhaust. */
export const SAFE = /** @type {Criterion[]} */ ([
  { type: 'events', kind: 'safety', types: ['knock', 'unheardknock', 'nitrousknock'], label: 'No knock' },
  { type: 'events', kind: 'safety', types: ['lean', 'nitrouslean', 'fuel'], label: 'Never lean or out of fuel under load' },
  { type: 'maxEgt', kind: 'safety', max: 950, label: 'Exhaust temperature in a safe range' },
]);

/** Whatever else the job is about, the car still has to idle. */
export const IDLES = /** @type {Criterion} */ ({ type: 'idle', kind: 'request', swing: 120, offset: 150, label: 'Still idles smoothly' });

/** A build patch that fits parts on top of whatever the car already has. @param {object} patch */
export const withMods = (patch) => (b) => ({ mods: { ...b.mods, ...patch } });
