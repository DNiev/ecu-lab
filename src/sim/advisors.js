/**
 * Advisors — compare what the hardware now wants against what the player's tables
 * actually say.
 *
 * These NEVER edit anything. That is the central design rule of the app: hardware
 * changes invalidate a calibration but do not rewrite it, exactly as in a real shop.
 * The advisors report the gap; closing it is the player's job.
 */

import { BARO_KPA, PSI_TO_KPA } from './constants.js';
import { COEFF } from './coefficients.js';
import { hardwareVeAt } from './airflow.js';
import { chargeIndexOf } from './knock.js';
import { mbtForCell, trappedAirGrams } from './cycle.js';
import { exhaustManifoldKpa } from './friction.js';
import { chargeTempK, exhaustTempK } from './thermo.js';
import { clamp, curveAt, interp1 } from './math.js';
import { evaluatePoint } from './point.js';
import { reachableKpa } from './manifold.js';
import { inductionAtMap } from './turbo.js';
import {
  GAME_LAYOUT, kpaForLoad, layoutById, loadForKpa, needsAirmass, readEcuTable, sameAxes, truthReader,
} from './layouts.js';
import {
  OPEN_LOOP_KPA, SPARK_MAX_DEG, SPARK_MIN_DEG, interpolationRoomDeg,
} from './tables.js';

/**
 * Turbo induction solved for a cell, per engine (keyed on its breathing function, so a new
 * build starts afresh and the old one is collected).
 * @type {WeakMap<Function, Map<string, object>>}
 */
const INDUCTION_MEMO = new WeakMap();

/** A cell delta below this (percent) is not worth reporting. */
export const VE_NOTABLE_PCT = 2.5;

/** Safety left under the calculated knock limit when advising, degrees. */
const KNOCK_SAFETY_DEG = 1.5;

/** A cell must sit more than this far past a ceiling before it is worth reporting. */
const ADVANCE_TOLERANCE_DEG = 1.0;

/** A cell has to be leaving this much advance on the table before it is worth chasing. */
const UNDER_ADVANCED_DEG = 3.0;

/** Mixture error worth reporting, AFR points. Below this it is calibration noise. */
const MIX_NOTABLE_AFR = 0.45;

/**
 * Compares the player's VE table against what the current hardware would flow, and
 * turns the gap into specific, cell-level tuning advice — the same thing a tuner
 * would conclude after re-logging airflow following a parts change.
 *
 * @param {number[][]} currentVe the player's VE table
 * @param {import('./engine.js').EngineConfig} cfg
 * @param {object} mods
 * @param {object|((rpm: number, kpa: number) => number)} hw induction hardware, as passed to
 *   {@link computeHardwareVE}, or the engine's true breathing as a function
 * @param {import('./layouts.js').TableAxes} [axes] the VE table's breakpoints; the old 8 × 6 grid when absent
 * @returns {{inSync: boolean, recs: object[], deltas: object[], maxAbs: number}}
 */
export function veRecommendations(currentVe, cfg, mods, hw, axes = GAME_LAYOUT.ve) {
  // The hardware as `computeHardwareVE` takes it, or the engine's breathing itself (the
  // app's, with its cam phasers where the calibration holds them: `scheduledVeAt`).
  const at = typeof hw === 'function' ? hw : hardwareVeAt(cfg, mods, hw);
  const recs = [];
  // The full-throttle row: the one nearest atmospheric (100 kPa), where the VE table
  // carries what the engine breathes with the throttle open.
  const wot = axes.load.reduce((best, v, i) => (Math.abs(v - 100) < Math.abs(axes.load[best] - 100) ? i : best), 0);
  const deltas = axes.rpm.map((rpm, ci) => {
    const to = at(rpm, axes.load[wot]);
    return {
      rpm,
      pct: ((to - currentVe[wot][ci]) / Math.max(1, currentVe[wot][ci])) * 100,
      from: currentVe[wot][ci],
      to,
    };
  });

  const notable = deltas.filter((d) => Math.abs(d.pct) >= VE_NOTABLE_PCT);
  if (notable.length === 0) {
    return { inSync: true, recs: [], deltas, maxAbs: Math.max(...deltas.map((d) => Math.abs(d.pct))) };
  }

  // Low, mid-range and top end as shares of the axis's own span (3500 and 6500 RPM on
  // a table that ends at 7500), so an engine that revs to 11,000 has a top end of its own.
  const top = axes.rpm[axes.rpm.length - 1];
  const lowMax = top * (3500 / 7500);
  const highMin = top * (6500 / 7500);
  const low = notable.filter((d) => d.rpm <= lowMax);
  const mid = notable.filter((d) => d.rpm > lowMax && d.rpm < highMin);
  const high = notable.filter((d) => d.rpm >= highMin);

  const band = (arr, name) => {
    if (!arr.length) return;
    const avg = arr.reduce((a, b) => a + b.pct, 0) / arr.length;
    const dir = avg > 0 ? 'raise' : 'lower';
    recs.push({
      band: name,
      rpmText: arr.length === 1 ? `${arr[0].rpm} RPM` : `${arr[0].rpm}–${arr[arr.length - 1].rpm} RPM`,
      pct: avg,
      text: `${dir === 'raise' ? 'Raise' : 'Lower'} the ${name} cells by about ${Math.abs(avg).toFixed(0)}% — your hardware ${avg > 0 ? 'now flows more air here than your table assumes' : 'flows less air here than your table assumes'}.`,
      cells: arr.map((d) => `${d.rpm} RPM: ${d.from} → ${d.to}`),
    });
  };
  band(low, 'low-RPM');
  band(mid, 'mid-range');
  band(high, 'top-end');

  return { inSync: false, recs, deltas, maxAbs: Math.max(...deltas.map((d) => Math.abs(d.pct))) };
}

/**
 * MBT for one spark-table cell, at the cell's own manifold pressure.
 *
 * Pulled out of {@link calibrationAdvice} because assembling the cycle inputs for a
 * table cell is a job in itself, and burying it mid-loop hid the one thing that matters
 * about it: every input here is the ROW's, not the throttle's. See the note on
 * `calibrationAdvice`.
 *
 * @param {object} input
 * @returns {number} MBT spark advance, degrees BTDC
 */
function mbtAtRow({ rpm, mapKpa, veCell, afrCell, fuel, mods, derived, turboOn, turbine }) {
  const chargeK = chargeTempK(Math.max(0, (mapKpa - BARO_KPA) / PSI_TO_KPA), mods.intercooler);
  const airG = trappedAirGrams({
    veActual: veCell, mapKpa, chargeK,
    sweptM3: (derived.displacementL / derived.cyl) / 1000,
  });
  const lambda = afrCell / 14.7;
  // Burnable mass releases the heat; delivered mass evaporates. Fixed together with
  // `factoryCalibration` — a spark advisor that disagrees with the generator is the
  // false alarm #34 removed.
  const deliveredFuelG = airG / (fuel.stoich * lambda);
  const burnedFuelG = Math.min(deliveredFuelG, airG / fuel.stoich);
  return mbtForCell({
    rpm, mapKpa, intakeK: chargeK, airChargeG: airG, burnedFuelG,
    fuelMassG: deliveredFuelG, lambda, fuel, derived,
    empKpa: exhaustManifoldKpa({
      turboOn, turbine: turboOn ? turbine : null,
      exhaustFlowKgS: ((airG + burnedFuelG) / 1000) * derived.cyl * (rpm / 2) / 60,
      exhaustK: exhaustTempK({ chargeIndex: chargeIndexOf(veCell, mapKpa), lambda }),
    }),
  });
}

/**
 * One cell of mixture advice. Scaling the commanded value by target/delivered prices the
 * error the engine actually made, and lands on the number to type in (rule 3 below).
 */
function fuelCell(ri, ci, rpm, rowKpa, rowLoad, bracketOnly, current, pt) {
  const suggestedAfr = current * (pt.bestAfr / Math.max(0.1, pt.afr));
  return {
    ri, ci, rpm, map: Number(rowKpa.toFixed(1)), load: rowLoad, bracketOnly, current,
    suggested: Number(suggestedAfr.toFixed(1)),
    delta: Number((suggestedAfr - current).toFixed(1)),
    delivered: Number(pt.afr.toFixed(2)), target: Number(pt.bestAfr.toFixed(2)),
    duty: pt.duty,
  };
}

/**
 * Reports, cell by cell, what the current hardware would actually tolerate for spark
 * and mixture — so the player can see where their tune has gone stale and fix it
 * themselves. Spark and fuel are never auto-changed.
 *
 * THREE RULES GOVERN THIS FUNCTION, and each one exists because breaking it produced a
 * false alarm on the app's own factory calibration — the fastest way to teach a player
 * that the advisor is noise.
 *
 * 1. EVERY CELL IS JUDGED AT ITS OWN ROW PRESSURE. A spark table is indexed by manifold
 *    pressure, so the 100 kPa row IS the calibration for 100 kPa. What the throttle
 *    happens to be doing when the engine passes through that row is not a property of
 *    the cell, and `factoryCalibration` writes it the same way. Solving the induction
 *    system first and judging at the pressure it produced meant reading the Golf R's
 *    100 kPa row at 200 kPa.
 *
 * 2. ONLY CELLS THE ENGINE CAN REACH, AT THE SPEED IT REACHES THEM. A turbo build never
 *    sees 200 kPa at 800 RPM. Judging it there reported the factory table as detonating
 *    at an operating point that cannot exist.
 *
 * 3. MIXTURE IS JUDGED ON WHAT WAS DELIVERED, NOT WHAT WAS COMMANDED, and the suggestion
 *    is the commanded number that would deliver the target — because that is what the
 *    player types into the cell. The two differ whenever the ECU's fuel maths is off, and
 *    a real factory table is written PRE-CORRECTED for its own MAF error: the Golf R
 *    commands 11.22 at 5000 RPM and full boost and delivers 12.20, its best-power target
 *    to the hundredth.
 *
 * 4. AT THE CAM PHASE THE CALIBRATION RUNS. An intake phaser closes the intake valve
 *    earlier as it advances, which raises effective compression and lowers the knock
 *    limit. `camAt` (`intakeCamAt`) says where the phaser sits; absent, the cam is parked.
 *
 * @param {object} input includes `camAt`, the intake cam advance the VVT calibration holds
 *   at a speed and pressure (crank degrees), when the engine has an intake phaser
 * @returns {{spark: object[], fuelAdv: object[], overAdvanced: object[], underAdvanced: object[], pastMbt: object[], wrongMix: object[]}}
 */
export function calibrationAdvice({
  ve, veTruth, timing, afr, layout = null, derived, fuel, mods, turboOn, boostCurve,
  compressor, turbine, injectorCc, ecuInjectorCc, mafScalar, mafErrorBase, pull = null, camAt = null,
}) {
  const spark = [], fuelAdv = [];
  // The breakpoints each table is on: an engine-sized layout, an engine computer's own,
  // or the old 8 × 6 grid when the tables carry none.
  const L = layoutById(layout);
  const tables = { ve, timing, afr, layout: layout ? L : null };
  const truthAt = truthReader(veTruth, layout ? L.ve : null);
  const sweptM3 = (derived.displacementL / derived.cyl) / 1000;
  /** The air the ECU believes one cylinder holds, from its own VE table: what an
   *  air-per-cylinder axis is read with. */
  const ecuAirAt = (rpm, kpa) => trappedAirGrams({
    veActual: readEcuTable(tables, 've', rpm, { mapKpa: kpa }), mapKpa: kpa,
    chargeK: chargeTempK(Math.max(0, (kpa - BARO_KPA) / PSI_TO_KPA), mods.intercooler), sweptM3,
  });
  const airmass = needsAirmass(tables.layout);
  const read = (name, rpm, kpa) => readEcuTable(tables, name, rpm, { mapKpa: kpa, airmassG: airmass ? ecuAirAt(rpm, kpa) : 0 });
  const kpaOf = (axes, rpm, v) => kpaForLoad(axes, rpm, v, ecuAirAt);
  const loadOf = (axes, rpm, kpa) => loadForKpa(axes, rpm, kpa, ecuAirAt);

  /** Highest manifold pressure the boost controller is even asking for at this speed. A
   *  supercharger asks for nothing — its boost is what the pulley makes — so there the
   *  pull's own boost is the answer. */
  const blowerPull = !turboOn && pull?.points?.some((p) => p.blowerRpm != null) ? pull.points : null;
  const reachAt = (rpm) => (blowerPull
    ? reachableKpa({ turboOn, boostCurve, rpm, boostPsi: interp1(blowerPull.map((p) => p.rpm), blowerPull.map((p) => p.boostPsi), rpm) })
    : reachableKpa({ turboOn, boostCurve, rpm }));

  /**
   * The compressor pressure and exhaust backpressure a turbo engine runs at a manifold
   * pressure below full throttle, as the dyno and LIVE solve them (`inductionAtMap`), or
   * the no-boost default. The dyno and this advisor must grade a cell under the same
   * charge: judged as if drawn from ambient, a part-throttle turbo cell was advised a
   * degree or two past where the pull then knocked.
   */
  // Kept across calls for the same engine (the same breathing function): the solve
  // depends on the hardware and the boost asked for, not on the tables being judged.
  const hardwareKey = JSON.stringify([turbine ?? null, compressor ?? null, !!mods.intercooler]);
  let inductionMemo = new Map();
  if (truthAt) {
    if (!INDUCTION_MEMO.has(truthAt)) INDUCTION_MEMO.set(truthAt, new Map());
    inductionMemo = INDUCTION_MEMO.get(truthAt);
    if (inductionMemo.size > 20000) inductionMemo.clear();
  }
  const inductionAt = (rpm, mapKpa) => {
    const plain = { boostPsi: Math.max(0, (mapKpa - BARO_KPA) / PSI_TO_KPA) };
    if (!turboOn || blowerPull) return plain;
    const key = `${hardwareKey}|${curveAt(boostCurve, rpm)}|${rpm}:${mapKpa.toFixed(2)}`;
    if (!inductionMemo.has(key)) {
      const s = inductionAtMap({
        rpm, mapKpa, boostTargetPsi: curveAt(boostCurve, rpm), turbine, compressor,
        veAt: (m) => (truthAt ? truthAt(rpm, m) : read('ve', rpm, m)), derived,
        intakeKAt: (b) => chargeTempK(b, mods.intercooler),
      });
      inductionMemo.set(key, s ?? plain);
    }
    return inductionMemo.get(key);
  };

  /** The engine at one speed and pressure, run on the player's tables. */
  const pointAt = (rpm, mapKpa, { veVal, veActualVal, timingVal, afrCommanded }) => evaluatePoint({
    rpm, mapKpa,
    ...inductionAt(rpm, mapKpa),
    veVal, veActualVal, timingVal, afrCommanded,
    // Where the phaser holds the intake cam here: it sets effective compression.
    ...(camAt ? { cam: { intakeAdvDeg: camAt(rpm, mapKpa) } } : {}),
    fuel, mods: { ...mods, turboFitted: turboOn }, mafScalar, mafErrorBase,
    injectorCc, ecuInjectorCc, derived, compressor,
    turbine: turboOn ? turbine : null,
  });

  /**
   * The knock threshold at any manifold pressure, not just a row's.
   *
   * Sampled the way the sweep reads the tables — VE and mixture interpolated to the same
   * pressure — so this is the ceiling that genuinely applies BETWEEN two rows.
   */
  const ceilingMemo = new Map();
  const ceilingAt = (rpm, mapKpa) => {
    const key = `${rpm}|${mapKpa}`;
    if (!ceilingMemo.has(key)) {
      ceilingMemo.set(key, pointAt(rpm, mapKpa, {
        veVal: read('ve', rpm, mapKpa), veActualVal: truthAt ? truthAt(rpm, mapKpa) : undefined,
        timingVal: read('timing', rpm, mapKpa), afrCommanded: read('afr', rpm, mapKpa),
      }).threshold);
    }
    return ceilingMemo.get(key);
  };

  /**
   * The pressure a row is actually in force at, or null if it never is.
   *
   * Normally a row's own pressure — rule 1, unchanged. The exception is the row that
   * BRACKETS the highest pressure the engine reaches. The ECU blends between the two
   * rows either side of whatever MAP the boost curve produced, so at 14 psi, where the
   * manifold peaks at 197.9 kPa, a 200 kPa row carries 96% of the answer — and under
   * the old test it was "unreachable" by 2.1 kPa and went ungraded entirely, keeping
   * whatever aggressive number happened to be in it. Following the advice then met 18
   * degrees of retard: the whole of #43, an order of magnitude worse than reported.
   *
   * A bracket row is graded at the pressure it is genuinely used at rather than at its
   * own row pressure, because the engine never gets there. The TOP row is clamped, not
   * interpolated: the ECU hands back its value for every pressure above it, so it is in
   * force across all the pressure above it the engine reaches — and graded there.
   */
  const gradingKpa = (axes, ri, rpm) => {
    const reach = reachAt(rpm);
    const rowKpa = kpaOf(axes, rpm, axes.load[ri]);
    if (ri === 0 && reach > rowKpa) return reach;
    if (rowKpa <= reach) return rowKpa;                                       // rule 1
    const below = ri + 1 < axes.load.length ? kpaOf(axes, rpm, axes.load[ri + 1]) : undefined;
    return below !== undefined && below < reach ? reach : null;               // rule 2
  };

  const T = L.timing;
  const A = L.afr;
  const sharedAxes = sameAxes(T, A);
  T.load.forEach((rowLoad, ri) => {
    T.rpm.forEach((rpm, ci) => {
      const gradeKpa = gradingKpa(T, ri, rpm);
      if (gradeKpa === null) return;                                          // rule 2
      // A row graded away from its own pressure is ADVISED but never CLASSIFIED.
      //
      // Below reach, because the player's number is not wrong at a pressure the engine
      // cannot get to — that is the false alarm rule 2 exists to prevent. Above it,
      // because `factoryCalibration` writes the top row against its own row pressure, so
      // grading it at the reach would condemn the app's own factory tables for a rule the
      // generator does not share. Advice is free to be stricter than judgement; judgement
      // is not free to cry wolf.
      const rowKpa = kpaOf(T, rpm, rowLoad);
      // Below cranking speed the cell is in the table for the start, not for a load the
      // engine can hold (it idles at 800 and stalls well above this under load), so it is
      // advised but not classified either: an engine-sized table reaches down to 500 RPM,
      // where wide-open throttle on a big V8 knocks below the table's own floor.
      const bracketOnly = Math.abs(gradeKpa - rowKpa) > 1e-6 || rpm < CRANKING_MAX_RPM;
      // The row's own VE, mixture and true airflow (the cell's, where the tables share
      // breakpoints), graded at the pressure the row is in force at.
      const veCell = read('ve', rpm, rowKpa);
      const afrCell = read('afr', rpm, rowKpa);
      const pt = pointAt(rpm, gradeKpa, {                                     // rule 1
        veVal: veCell, veActualVal: truthAt ? truthAt(rpm, rowKpa) : undefined,
        timingVal: timing[ri][ci], afrCommanded: afrCell,
      });

      // TWO CEILINGS BIND, AND ONLY ONE IS DANGEROUS.
      //
      // Knock is the hard one: past it the engine is damaging itself, so leave a little
      // safety under the calculated limit, as a tuner would. MBT is the soft one: past it
      // the burn already lands where it should, so more advance buys nothing and only
      // moves you toward the hard ceiling. At light load the knock limit is enormous — a
      // cylinder in deep vacuum effectively cannot knock — and advising against it alone
      // produced suggestions like "run 165 deg at 20 kPa". Whichever is lower is real.
      //
      // This is the rule `factoryCalibration` writes its spark table with. The two must
      // not disagree about what good timing looks like.
      const knockCeiling = pt.threshold - KNOCK_SAFETY_DEG;
      const mbt = mbtAtRow({
        rpm, mapKpa: gradeKpa, veCell, afrCell,
        fuel, mods, derived, turboOn, turbine,
      });
      const safeTiming = clamp(
        Math.round(Math.min(knockCeiling, mbt) * 2) / 2, SPARK_MIN_DEG, SPARK_MAX_DEG,
      );
      spark.push({
        ri, ci, rpm, map: Number(rowKpa.toFixed(1)), load: rowLoad, bracketOnly, current: timing[ri][ci], suggested: safeTiming,
        delta: Number((safeTiming - timing[ri][ci]).toFixed(1)), knocking: pt.knock,
        mbt: Number(mbt.toFixed(1)), knockCeiling: Number(knockCeiling.toFixed(1)),
        // Which ceiling bound the suggestion. Useful on its own, but it says nothing
        // about danger: a cell can sit past both with MBT the lower of the two. Danger
        // is where the PLAYER'S number sits — see the classification below.
        knockLimited: knockCeiling < mbt,
        unbounded: pt.threshold >= COEFF.KNOCK_UNBOUNDED_BTDC,
      });
      if (sharedAxes) fuelAdv.push(fuelCell(ri, ci, rpm, rowKpa, rowLoad, bracketOnly, afr[ri][ci], pt));
    });
  });

  // Mixture advice on the fuel table's own breakpoints, where they are not the spark
  // table's (GM's VE-shaped mixture against its airmass spark grid, say).
  if (!sharedAxes) {
    A.load.forEach((rowLoad, ri) => {
      A.rpm.forEach((rpm, ci) => {
        const gradeKpa = gradingKpa(A, ri, rpm);
        if (gradeKpa === null) return;
        const rowKpa = kpaOf(A, rpm, rowLoad);
        const pt = pointAt(rpm, gradeKpa, {
          veVal: read('ve', rpm, rowKpa), veActualVal: truthAt ? truthAt(rpm, rowKpa) : undefined,
          timingVal: read('timing', rpm, rowKpa), afrCommanded: afr[ri][ci],
        });
        fuelAdv.push(fuelCell(ri, ci, rpm, rowKpa, rowLoad, Math.abs(gradeKpa - rowKpa) > 1e-6, afr[ri][ci], pt));
      });
    });
  }

  // ADVICE HAS TO SURVIVE BEING READ BY INTERPOLATION.
  //
  // Grading a cell at its own row pressure is right (rule 1) and is what keeps this
  // advisor from crying wolf about the app's own factory tables. But the SWEEP does not
  // read the table at row pressures. It asks for whatever manifold pressure the boost
  // curve produced and gets a blend of two rows, and the knock ceiling between them falls
  // faster than the blend does — so a player could follow every suggestion here exactly
  // and still meet knock on the dyno, at pressures no row sits on. That was #43.
  //
  // Judging is one thing and advising is another, so only the advice changes. Between two
  // rows the value handed back is a blend, and the blend has to clear the ceiling at the
  // pressure it is handed back AT. At a fraction f of the way from this row up to the one
  // above:
  //
  //     (1 - f) * T_here + f * T_above  <=  ceiling(p_f)
  //     T_here <= (ceiling(p_f) - f * T_above) / (1 - f)
  //
  // Sampled at three points across the gap rather than only the middle, because the
  // ceiling is not linear in pressure and the binding point is not always halfway.
  //
  // Rows are walked from the most boosted downward, so the higher-pressure row — already
  // pinned to its own tighter ceiling — is fixed by the time its neighbour is solved, and
  // any excess comes out of the lower-pressure cell. That is the correct one to charge:
  // it is the cell reaching its extra advance up into pressure it does not have to carry.
  //
  // Rounded DOWN to the half degree, never to nearest. Rounding a safety limit up is how
  // you hand someone advice that is 0.2 deg past the thing you just told them not to
  // cross. And it only ever lowers a suggestion, so it cannot make advice more aggressive
  // than the per-row grading already allows.
  const byCell = new Map(spark.map((c) => [`${c.ri}|${c.ci}`, c]));
  T.rpm.forEach((rpm, ci) => {
    for (let ri = 1; ri < T.load.length; ri++) {
      const here = byCell.get(`${ri}|${ci}`);
      const above = byCell.get(`${ri - 1}|${ci}`);        // one row up = more pressure
      // If the row above is unreachable it was never graded, and the engine never runs at
      // those pressures either — so there is no interpolated path to protect.
      if (!here || !above) continue;
      // Only the part of the gap the engine actually enters needs protecting. At 14 psi
      // the manifold peaks at 197.9 kPa, so a 150-200 gap is entered 96% of the way;
      // at no boost it is not entered at all and the pair is left alone.
      const hereKpa = kpaOf(T, rpm, T.load[ri]);
      const span = kpaOf(T, rpm, T.load[ri - 1]) - hereKpa;
      const entered = clamp((reachAt(rpm) - hereKpa) / span, 0, 1);
      // Neither row can knock at any advance it could carry, so nothing between them can:
      // knock only gets likelier with pressure.
      if (entered <= 0 || (here.unbounded && above.unbounded)) continue;
      const room = interpolationRoomDeg({
        ceilingAtFrac: (f) => ceilingAt(rpm, hereKpa + f * span) - KNOCK_SAFETY_DEG,
        aboveDeg: above.suggested,
        entered,
      });
      if (room < here.suggested) {
        here.suggested = clamp(Math.floor(room * 2) / 2, SPARK_MIN_DEG, SPARK_MAX_DEG);
        here.delta = Number((here.suggested - here.current).toFixed(1));
        here.interpolationLimited = true;
      }
      // ADVICE AND JUDGEMENT NEED DIFFERENT BASELINES, and sharing one was quietly
      // wrong. `room` above is what this cell may carry once the row ABOVE has taken
      // the advice — correct for a suggestion, because that is the table the player
      // would end up with. It is not what the CURRENT table does: the ECU blends the
      // numbers actually in the table, so judging this cell against a neighbour's
      // suggested value condemns it for advance it never meets.
      //
      // Judged against the table as it stands, therefore. When the two agree the
      // result is identical; where they differ, this is the one that answers "is the
      // table in front of me dangerous".
      const judged = interpolationRoomDeg({
        ceilingAtFrac: (f) => ceilingAt(rpm, hereKpa + f * span) - KNOCK_SAFETY_DEG,
        aboveDeg: above.current,
        entered,
      });
      // A cell the interpolated path binds is DANGEROUS, not merely sub-optimal: the
      // sweep really does detonate at that pressure. So the ceiling this cell is judged
      // against comes down with the advice, and the existing classification below reports
      // it in the same breath as any other cell past the knock limit. Reporting the
      // suggestion without the warning would leave the player with a number to type and
      // no reason for it.
      here.knockCeiling = Math.min(here.knockCeiling, Number(judged.toFixed(1)));
    }
  });

  // Past the knock limit is a damage risk. Past MBT is only wasted effort. Reporting
  // them as one category would either cry wolf about a safe cruise cell or say nothing
  // about a genuinely dangerous one.
  //
  // Which one a cell is depends on where the PLAYER'S OWN NUMBER sits, not on which
  // ceiling happens to be lower. Those come apart exactly when MBT is under the knock
  // ceiling and the table is over both: the cell is detonating, but the lower ceiling
  // is MBT. Classifying on ceiling order would file that cell as merely wasteful and
  // tell the player it is safe, which is the one thing this report must never do.
  const wrongMix = fuelAdv.filter((c) => !c.bracketOnly && c.map >= OPEN_LOOP_KPA
    && Math.abs(c.delta) > MIX_NOTABLE_AFR);
  // SPARK CANNOT FIX EVERY CELL. Where the knock ceiling sits below the most retard the
  // table can hold, no number typed into this cell is safe at the boost being asked for:
  // the fix is less boost here (a real ECU's low-speed boost or torque limit), or better
  // fuel. Marked so the report can say so instead of asking for retard it cannot give.
  for (const c of spark) c.sparkCannotFix = c.knockCeiling < SPARK_MIN_DEG;
  if (pull) {
    return { spark, fuelAdv, wrongMix, ...judgeAgainstPull(spark, pull, (p) => cellsInForce(p.rpm, loadOf(T, p.rpm, p.map), T)) };
  }
  const overAdvanced = spark.filter((c) => !c.bracketOnly && c.current - c.knockCeiling > ADVANCE_TOLERANCE_DEG);
  const pastMbt = spark.filter((c) => !c.bracketOnly && c.current - c.knockCeiling <= ADVANCE_TOLERANCE_DEG
    && c.current - c.mbt > ADVANCE_TOLERANCE_DEG);
  const underAdvanced = spark.filter((c) => !c.bracketOnly && c.delta > UNDER_ADVANCED_DEG);
  return { spark, fuelAdv, overAdvanced, underAdvanced, pastMbt, wrongMix };
}

/** A cell carrying less than this share of a point's timing is not "in force" there. */
const IN_FORCE_WEIGHT = 0.15;

/** Below this speed an engine is cranking or stalling, not running under load. */
const CRANKING_MAX_RPM = 600;

/** Columns at or below this speed are the idle columns: run under MBT on purpose. */
const IDLE_COLUMN_MAX_RPM = 1000;

/**
 * How much each spark-table cell contributes to the timing read at one operating point,
 * by the same bilinear blend the ECU reads the table with.
 * @param {number} rpm
 * @param {number} load in the axes' own unit (kPa, or air per cylinder)
 * @param {import('./layouts.js').TableAxes} [axes] the old 8 × 6 grid when absent
 * @returns {{ri: number, ci: number, w: number}[]}
 */
export function cellsInForce(rpm, load, axes = GAME_LAYOUT.timing) {
  const axis = (xs, x) => {
    const asc = xs[0] < xs[xs.length - 1];
    const a = asc ? xs : [...xs].reverse();
    if (x <= a[0]) return [[0, 1]];
    if (x >= a[a.length - 1]) return [[a.length - 1, 1]];
    let i = 0;
    while (x > a[i + 1]) i += 1;
    const f = (x - a[i]) / (a[i + 1] - a[i]);
    return [[i, 1 - f], [i + 1, f]];
  };
  const toIdx = (xs, i) => (xs[0] < xs[xs.length - 1] ? i : xs.length - 1 - i);
  const out = [];
  for (const [ci, wc] of axis(axes.rpm, rpm)) {
    for (const [ri, wr] of axis(axes.load, load)) {
      out.push({ ri: toIdx(axes.load, ri), ci: toIdx(axes.rpm, ci), w: wc * wr });
    }
  }
  return out;
}

/**
 * The cells of `cells` that `pull` never read: no operating point of the pull gave one of
 * them a real share of its timing (the same in-force test the advisor judges a pull by).
 *
 * TUNE's advisor judges every cell against its own full-throttle pull, but the player can
 * pull at any load. A flagged cell the player's pull did run has already had its say in
 * that pull's log; only the rest are ones the log cannot have shown.
 *
 * @template {{ri: number, ci: number}} C
 * @param {C[]} cells
 * @param {{points: {rpm: number, map: number, airCharge?: number}[]}} pull a `simulateSweep` result
 * @param {import('./layouts.js').TableAxes} [axes] the spark table's breakpoints; the old 8 × 6 grid when absent
 * @returns {C[]}
 */
export function cellsNotRunBy(cells, pull, axes = GAME_LAYOUT.timing) {
  const run = new Set();
  for (const p of pull.points) {
    const load = loadForKpa(axes, p.rpm, p.map, () => p.airCharge ?? 0);
    for (const { ri, ci, w } of cellsInForce(p.rpm, load, axes)) if (w >= IN_FORCE_WEIGHT) run.add(`${ri}|${ci}`);
  }
  return cells.filter((c) => !run.has(`${c.ri}|${c.ci}`));
}

/**
 * The spark verdicts, judged against a full-throttle pull of the same engine.
 *
 * Grading every cell at its own row pressure is right for a table's shape, but it is not
 * what the dyno does: the pull reads the table at whatever manifold pressure the turbo
 * actually made, blending the rows either side, with the ECU's own corrections and knock
 * control in the loop. Judging one way and pulling the other is how the advisor came to
 * call a table clean that the pull showed knocking, and to warn of knock the pull never
 * met. So wherever the pull's own operating points use a cell, the pull decides:
 *
 * - it knocked where the cell is in force → the cell is past the knock limit, by as much
 *   as the pull ran past it, and the suggestion takes that out plus the safety margin;
 * - it did not → the cell is not, and no suggestion may add more advance than the margin
 *   the pull measured there.
 *
 * Cells no full-throttle pull uses keep their row grading. And the idle column and the
 * closed-throttle row are never "timing left on the table": a calibration runs idle
 * below MBT on purpose, to give idle control spark in reserve, and nobody chases torque
 * on overrun.
 *
 * @param {object[]} spark the per-cell grading, adjusted in place
 * @param {{points: object[]}} pull a full-throttle `simulateSweep` result
 * @param {(p: object) => {ri: number, ci: number, w: number}[]} inForce the spark cells one
 *   point of the pull reads, on the spark table's own breakpoints
 * @returns {{overAdvanced: object[], underAdvanced: object[], pastMbt: object[]}}
 */
function judgeAgainstPull(spark, pull, inForce) {
  const knockBy = new Map();
  const marginBy = new Map();
  for (const p of pull.points) {
    for (const { ri, ci, w } of inForce(p)) {
      if (w < IN_FORCE_WEIGHT) continue;
      const key = `${ri}|${ci}`;
      marginBy.set(key, Math.min(marginBy.get(key) ?? Infinity, p.margin));
      if (p.margin < 0) knockBy.set(key, Math.max(knockBy.get(key) ?? 0, -p.margin));
    }
  }
  const halfDown = (v) => Math.floor(v * 2) / 2;
  const overAdvanced = [], underAdvanced = [], pastMbt = [];
  for (const c of spark) {
    const key = `${c.ri}|${c.ci}`;
    const idle = c.rpm <= IDLE_COLUMN_MAX_RPM || c.map <= 30;
    if (marginBy.has(key)) {
      c.pullMargin = Number(marginBy.get(key).toFixed(1));
      // The limit shown beside the verdict is the one the pull met, so the two never
      // disagree: a clean cell cannot show a limit under the player's own number.
      c.knockCeiling = Number((c.current + marginBy.get(key)).toFixed(1));
      const knock = knockBy.get(key) ?? 0;
      if (knock > 0) {
        c.knockingOnPull = true;
        c.suggested = clamp(Math.min(c.suggested, halfDown(c.current - knock - KNOCK_SAFETY_DEG)), SPARK_MIN_DEG, SPARK_MAX_DEG);
        c.delta = Number((c.suggested - c.current).toFixed(1));
        overAdvanced.push(c);
        continue;
      }
      // Clean on the pull: never advise more advance than the pull had room for.
      c.suggested = clamp(Math.min(c.suggested, halfDown(c.current + marginBy.get(key) - KNOCK_SAFETY_DEG)), SPARK_MIN_DEG, SPARK_MAX_DEG);
      c.delta = Number((c.suggested - c.current).toFixed(1));
      if (c.current - c.mbt > ADVANCE_TOLERANCE_DEG) pastMbt.push(c);
      else if (!idle && c.delta > UNDER_ADVANCED_DEG) underAdvanced.push(c);
      continue;
    }
    if (c.bracketOnly) continue;
    if (c.current - c.knockCeiling > ADVANCE_TOLERANCE_DEG) overAdvanced.push(c);
    else if (c.current - c.mbt > ADVANCE_TOLERANCE_DEG) pastMbt.push(c);
    else if (!idle && c.delta > UNDER_ADVANCED_DEG) underAdvanced.push(c);
  }
  return { overAdvanced, underAdvanced, pastMbt };
}
