/**
 * The engine the tutorial and the Tuning Course talk about — the same one a player gets on SANDBOX.
 *
 * Their lessons show real game screens, and a real screen needs real data: a pull, the
 * advisor's verdicts, the VE log. This works them out the way the game does, from a
 * store-shaped state (`makeInitialState()`, optionally changed by a scenario), through
 * the same simulator calls EcuLab.jsx makes. So every number a lesson quotes — "the
 * stock V6 makes 258 whp", "this cell reads 95%" — is the number the player will see
 * when they do it themselves, and it moves with the physics instead of going stale.
 *
 * Pure apart from its cache: state in, derived data out. `tests/ui/tutorial.test.jsx`
 * holds it to the app: the demo's stock pull must equal the app's first pull.
 */

import {
  calibrationAdvice, interp2, isLocatable, simulateSweep, veCorrections, veSamplesFromPull,
} from '../../sim/index.js';
import { eventBands } from '../components/eventBands.js';
import { makeInitialState } from '../state/initialState.js';
import { pullInputs } from '../state/pullInputs.js';

/** @typedef {import('../state/initialState.js').StoreState} StoreState */

/**
 * @typedef {object} Demo
 * @property {StoreState} state the store the snippets are seeded from
 * @property {object} result the dyno pull, as `simulateSweep` returns it
 * @property {object} calAdvice what TUNE's SPARK and FUEL advisors say about this tune
 * @property {object[]} chartData DYNO's curves, shaped as the shell shapes them
 * @property {object[]} bands the pull's event bands on the chart
 * @property {number} wholePullCount events that belong to the whole pull, not an RPM
 * @property {{pull: object[], live: object[], airModel: 'blend'|'sd'|'maf', pullInfo: {state: 'none'|'stale'|'part-load'|'unused'|'ok'}, onApply: (share: number) => void}} veLog
 *   TUNE › AIRFLOW's log correction, fed from this pull
 * @property {ReturnType<typeof import('../../sim/index.js').deriveEngine>} derived
 * @property {number[][]} veTruth the engine's real breathing (for the tutorial's own maths, never shown as a tuning aid)
 * @property {object} fuel
 */

/** Scenario runs are pure and a few tens of milliseconds each: worked out once. */
const cache = new Map();

/**
 * Runs a scenario the way the game would: build the store, pull, and derive what the
 * screens are handed.
 *
 * @param {string} key a cache key, one per scenario
 * @param {(state: StoreState) => StoreState} [scenario] changes to the SANDBOX start
 * @returns {Demo}
 */
export function runDemo(key, scenario = (s) => s) {
  if (cache.has(key)) return cache.get(key);
  const base = scenario(makeInitialState());
  const { args, derived, veTruth, fuel, mafErrorBase } = pullInputs(base);
  const result = simulateSweep(args);
  // The advisor's pull is the same full-throttle pull, as in EcuLab.jsx.
  const advisorPull = base.session.loadKpa === 100 ? result : simulateSweep({ ...args, loadKpa: 100 });
  const calAdvice = calibrationAdvice({
    ve: base.tune.ve, veTruth, timing: base.tune.timing, afr: base.tune.afr, derived,
    octaneBonus: fuel.bonus, fuel, mods: base.build.mods, turboOn: base.build.turboOn,
    boostCurve: base.build.boostCurve, compressor: args.compressor,
    turbine: args.turbine, injectorCc: args.injectorCc, ecuInjectorCc: base.build.ecuInjectorCc,
    mafScalar: base.build.mafScalar, mafErrorBase, pull: advisorPull,
  });
  const chartData = result.points.map((p) => ({
    rpm: p.rpm, hp: p.hp, torque: p.torque, afr: p.afr, afrCommanded: p.afrCommanded,
    timing: p.timing, commandedTiming: p.commandedTiming, duty: p.duty, trimPct: p.trimPct,
  }));
  const pull = veSamplesFromPull(result.points);
  const state = { ...base, session: { ...base.session, result, pullCount: 1 } };
  const demo = {
    state, result, calAdvice, chartData, derived, veTruth, fuel,
    bands: eventBands(result.events),
    wholePullCount: result.events.filter((e) => !isLocatable(e)).length,
    veLog: {
      pull, live: [], airModel: /** @type {'blend'|'sd'|'maf'} */ (base.tune.ecu?.config?.airModel ?? 'blend'),
      pullInfo: { state: /** @type {'ok'|'unused'} */ (pull.length ? 'ok' : 'unused') },
      // The sandbox's own table is what a snippet's APPLY changes; this is only its label.
      onApply: () => {},
    },
  };
  cache.set(key, demo);
  return demo;
}

/**
 * The air one cylinder takes in at a cell, the way the ECU works it out — for a
 * lesson's worked example. Same ideal-gas step as article 7 on Learn.
 *
 * @param {Demo} demo
 * @param {number} rpm
 * @param {number} mapKpa
 */
export function airPerCylinder(demo, rpm, mapKpa) {
  const p = demo.result.points.reduce((best, q) => (Math.abs(q.rpm - rpm) < Math.abs(best.rpm - rpm) ? q : best));
  const ve = interp2(demo.state.tune.ve, rpm, mapKpa);
  const vCylL = demo.derived.displacementL / demo.derived.cyl;
  const tK = p.iat + 273.15;
  const rho = (mapKpa * 1000) / (287 * tK);
  const mg = (ve / 100) * (vCylL / 1000) * rho * 1e6;
  return { ve, vCylL, tK, iatC: p.iat, rho, mg, point: p };
}

/** The log's correction for one cell, split into the parts TUNE › AIRFLOW shows. */
export function veCellMaths(demo, row, col) {
  const { cell } = veCorrections(demo.veLog.pull);
  return cell[row]?.[col] ?? null;
}
