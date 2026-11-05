/**
 * The order a tuner works a pull log in, and which step each event belongs to.
 *
 * A calibration is fixed from the bottom up, because each layer reads the one beneath it:
 * the ECU has to know the parts (injector flow rate, MAP and MAF scaling, the fuel) before
 * the fuelling means anything; the fuelling has to be right before timing does, because
 * the knock limit and best-torque timing both move with the mixture; and boost comes last,
 * on a tune that is safe at the boost it already has. Nitrous is tuned on top of a finished
 * base tune. Hardware limits are trade-offs to choose, not cells to fix.
 *
 * A long log in the order the simulator happened to find things gave the player no place
 * to start; in this order the first entry is the first thing to fix.
 *
 * Pure: event types in, steps out. A type not listed here lands in the last step rather
 * than disappearing, and `tests/ui/fix-order.test.js` fails the day the simulator emits a
 * type this file does not name.
 */

/** @type {{id: string, label: string, types: string[]}[]} */
export const FIX_STEPS = [
  { id: 'setup', label: 'Setup', types: ['injscale', 'mapsensor', 'maf', 'wideband', 'fueltype'] },
  { id: 'fuel', label: 'Fuel', types: ['rich', 'lean', 'valve', 'fuel', 'rail', 'dutyprot', 'leanprot', 'misfire'] },
  { id: 'spark', label: 'Spark', types: ['knock', 'unheardknock', 'falseknock', 'knockprot', 'iatprot', 'egtprot'] },
  { id: 'boost', label: 'Boost', types: ['underboost', 'overboost', 'boostctl', 'compressor', 'blower'] },
  { id: 'nitrous', label: 'Nitrous', types: ['nitrouslean', 'nitrousknock', 'bottle', 'nitrouswindow'] },
  { id: 'hardware', label: 'Hardware', types: ['pressure', 'bearing', 'float', 'cam', 'limiter', 'torquelimit', 'oilprot'] },
];

/**
 * @param {string} type an event type
 * @returns {{index: number, id: string, label: string}} its step, 1-based `index`
 */
export function fixStep(type) {
  const i = FIX_STEPS.findIndex((s) => s.types.includes(type));
  const at = i < 0 ? FIX_STEPS.length - 1 : i;
  return { index: at + 1, id: FIX_STEPS[at].id, label: FIX_STEPS[at].label };
}

/**
 * A pull's events in working order: by step, and within a step by what they cost the
 * pull, biggest first. Stable, and a new array — the result itself is left as logged.
 *
 * @template E
 * @param {(E & {type: string, impact?: number})[]} events
 * @returns {(E & {type: string, impact?: number})[]}
 */
export function inFixOrder(events) {
  return events
    .map((e, i) => ({ e, i, step: fixStep(e.type).index }))
    .sort((a, b) => a.step - b.step || (b.e.impact ?? 0) - (a.e.impact ?? 0) || a.i - b.i)
    .map(({ e }) => e);
}
