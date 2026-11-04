/**
 * The charge index the datalog reports: a plain description of how full the cylinder
 * is, used in the datalog and in the exhaust-flow term.
 *
 * The knock limit and MBT are not here. They are solved from an integrated pressure
 * trace in `cycle.js` (`knockLimitedSpark`, `mbtFromBurn`), so octane, compression,
 * charge temperature, boost, mixture, head material and cylinder size all reach them
 * through the physics rather than as corrections in degrees.
 */

import { BARO_KPA } from './constants.js';

/**
 * How full the cylinder is, relative to a perfectly filled one at sea level.
 *
 * @param {number} veActual TRUE cylinder filling, percent
 * @param {number} mapKpa manifold absolute pressure, kPa
 * @returns {number} charge index; 1.0 is 100% VE at one atmosphere
 */
export function chargeIndexOf(veActual, mapKpa) {
  return (veActual / 100) * (mapKpa / BARO_KPA);
}
