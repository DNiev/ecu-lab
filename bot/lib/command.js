/**
 * The `/dyno` command as Discord registers it.
 *
 * The choices are built from the sim's own lists, never typed out, so a preset added to
 * ENGINE_PRESETS shows up here by itself. It does still need re-registering
 * (`bot/scripts/register.js`), because Discord keeps its own copy of the choices.
 */

import { ENGINE_PRESETS, MOD_INFO, OCTANE_OPTS } from '../../src/sim/index.js';
import { MOD_KEYS } from './dyno.js';

// Discord's application-command option types.
const STRING = 3;
const BOOLEAN = 5;
// A CHAT_INPUT command: one typed with a slash.
const CHAT_INPUT = 1;

/** @returns {object} the command definition, as Discord's API takes it */
export function dynoCommand() {
  return {
    name: 'dyno',
    type: CHAT_INPUT,
    description: 'Full-throttle dyno pull of a factory engine, on its factory tune',
    options: [
      {
        type: STRING,
        name: 'engine',
        description: 'Which factory engine',
        required: true,
        choices: ENGINE_PRESETS.map((p) => ({ name: p.name, value: p.id })),
      },
      ...MOD_KEYS.map((k) => ({
        type: BOOLEAN,
        name: k,
        description: `Fit or remove the ${MOD_INFO[k].label} (default: as the engine ships)`,
      })),
      {
        type: STRING,
        name: 'fuel',
        description: "Fuel in the tank (default: the engine's own)",
        choices: OCTANE_OPTS.map((o) => ({ name: o.label, value: o.label })),
      },
    ],
  };
}
