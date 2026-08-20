/**
 * Advisors — compare what the hardware now wants against what the player's tables
 * actually say.
 *
 * These NEVER edit anything. That is the central design rule of the app: hardware
 * changes invalidate a calibration but do not rewrite it, exactly as in a real shop.
 * The advisors report the gap; closing it is the player's job.
 */

import { BARO_KPA, PSI_TO_KPA } from './constants.js';
import { computeHardwareVE } from './airflow.js';
import { chargeIndexOf } from './knock.js';
import { mbtForCell, trappedAirGrams } from './cycle.js';
import { exhaustManifoldKpa } from './friction.js';
import { chargeTempK, exhaustTempK } from './thermo.js';
import { clamp, interp1, interp2 } from './math.js';
import { evaluatePoint } from './point.js';
import { LOAD, RPM, SPARK_MAX_DEG, SPARK_MIN_DEG } from './tables.js';

/** The ~100 kPa row — wide-open throttle, naturally aspirated. */
const WOT_ROW = 2;

/** A cell delta below this (percent) is not worth reporting. */
const VE_NOTABLE_PCT = 2.5;

/** Safety left under the calculated knock limit when advising, degrees. */
const KNOCK_SAFETY_DEG = 1.5;

/**
 * Where between two rows the interpolated spark advice is checked.
 *
 * The sweep reads the table at whatever pressure the boost curve produced, so advice has
 * to hold everywhere between rows and not just on them. Three interior samples, because
 * the knock ceiling is not linear in pressure and the binding point is not always the
 * middle. The endpoints are excluded: at f = 0 and f = 1 the blend is one row's own
 * value, which its own grading already covers.
 */
const INTERP_SAMPLE_FRACTIONS = [0.25, 0.5, 0.75];

/** A cell must sit more than this far past a ceiling before it is worth reporting. */
const ADVANCE_TOLERANCE_DEG = 1.0;

/** A cell has to be leaving this much advance on the table before it is worth chasing. */
const UNDER_ADVANCED_DEG = 3.0;

/** Mixture error worth reporting, AFR points. Below this it is calibration noise. */
const MIX_NOTABLE_AFR = 0.45;

/**
 * Manifold pressure above which the ECU runs open loop, kPa. Mixture advice is limited
 * to these rows: below it the target is stoichiometric and the trims own it, so
 * best-power advice would be actively wrong.
 */
const OPEN_LOOP_KPA = 85;

/**
 * Slack above the boost target when deciding whether a row is reachable, kPa. Enough to
 * cover interpolation and the barometric rounding, not enough to admit a whole row.
 */
const REACHABLE_SLACK_KPA = 2;

/**
 * Compares the player's VE table against what the current hardware would flow, and
 * turns the gap into specific, cell-level tuning advice — the same thing a tuner
 * would conclude after re-logging airflow following a parts change.
 *
 * @param {number[][]} currentVe the player's VE table
 * @param {import('./engine.js').EngineConfig} cfg
 * @param {object} mods
 * @param {object} hw induction hardware, as passed to {@link computeHardwareVE}
 * @returns {{inSync: boolean, recs: object[], deltas: object[], maxAbs: number}}
 */
export function veRecommendations(currentVe, cfg, mods, hw) {
  const target = computeHardwareVE(cfg, mods, hw);
  const recs = [];
  const deltas = RPM.map((rpm, ci) => ({
    rpm,
    pct: ((target[WOT_ROW][ci] - currentVe[WOT_ROW][ci]) / Math.max(1, currentVe[WOT_ROW][ci])) * 100,
    from: currentVe[WOT_ROW][ci],
    to: target[WOT_ROW][ci],
  }));

  const notable = deltas.filter((d) => Math.abs(d.pct) >= VE_NOTABLE_PCT);
  if (notable.length === 0) {
    return { inSync: true, recs: [], deltas, maxAbs: Math.max(...deltas.map((d) => Math.abs(d.pct))) };
  }

  const low = notable.filter((d) => d.rpm <= 3500);
  const mid = notable.filter((d) => d.rpm > 3500 && d.rpm < 6500);
  const high = notable.filter((d) => d.rpm >= 6500);

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
  // Delivered fuel, used here as the burned mass. Same known defect as the one documented
  // in `factoryCalibration` — the two are fixed together or not at all, because a spark
  // advisor that disagrees with the generator is the false alarm #34 removed.
  const burnedFuelG = airG / (fuel.stoich * lambda);
  return mbtForCell({
    rpm, mapKpa, intakeK: chargeK, airChargeG: airG, burnedFuelG, lambda, fuel, derived,
    empKpa: exhaustManifoldKpa({
      turboOn, turbine: turboOn ? turbine : null,
      exhaustFlowKgS: ((airG + burnedFuelG) / 1000) * derived.cyl * (rpm / 2) / 60,
      exhaustK: exhaustTempK({ chargeIndex: chargeIndexOf(veCell, mapKpa), lambda }),
    }),
  });
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
 * @param {object} input
 * @returns {{spark: object[], fuelAdv: object[], overAdvanced: object[], underAdvanced: object[], pastMbt: object[], wrongMix: object[]}}
 */
export function calibrationAdvice({
  ve, veTruth, timing, afr, derived, fuel, mods, turboOn, boostCurve,
  compressor, turbine, injectorCc, ecuInjectorCc, mafScalar, mafErrorBase,
}) {
  const spark = [], fuelAdv = [];
  /** Highest manifold pressure the boost controller is even asking for at this speed. */
  const reachableKpa = (rpm) => BARO_KPA + REACHABLE_SLACK_KPA
    + (turboOn ? Math.max(0, interp1(RPM, boostCurve, rpm)) * PSI_TO_KPA : 0);

  /**
   * The knock threshold at any manifold pressure, not just a row's.
   *
   * Sampled the way the sweep reads the tables — VE and mixture interpolated to the same
   * pressure — so this is the ceiling that genuinely applies BETWEEN two rows.
   */
  const ceilingAt = (ci, mapKpa) => evaluatePoint({
    rpm: RPM[ci], mapKpa,
    boostPsi: Math.max(0, (mapKpa - BARO_KPA) / PSI_TO_KPA),
    veVal: interp2(ve, RPM[ci], mapKpa),
    veActualVal: veTruth ? interp2(veTruth, RPM[ci], mapKpa) : undefined,
    timingVal: interp2(timing, RPM[ci], mapKpa), afrCommanded: interp2(afr, RPM[ci], mapKpa),
    fuel, mods: { ...mods, turboFitted: turboOn }, mafScalar, mafErrorBase,
    injectorCc, ecuInjectorCc, derived, compressor,
    turbine: turboOn ? turbine : null,
  }).threshold;

  /**
   * The pressure a row is actually in force at, or null if it never is.
   *
   * Normally a row's own pressure — rule 1, unchanged. The exception is the row that
   * BRACKETS the highest pressure the engine reaches. `interp2` blends between the two
   * rows either side of whatever MAP the boost curve produced, so at 14 psi, where the
   * manifold peaks at 197.9 kPa, the 200 kPa row carries 96% of the answer — and under
   * the old test it was "unreachable" by 2.1 kPa and went ungraded entirely, keeping
   * whatever aggressive number happened to be in it. Following the advice then met 18
   * degrees of retard: the whole of #43, an order of magnitude worse than reported.
   *
   * A bracket row is graded at the pressure it is genuinely used at rather than at its
   * own row pressure, because the engine never gets there.
   */
  const gradingKpa = (ri, rpm) => {
    const reach = reachableKpa(rpm);
    // The TOP row is clamped, not interpolated: `interp2` hands back its value for every
    // pressure above it. Ask for 22 psi and the manifold reaches 254 kPa while the table
    // stops at 200, so that one row is in force across 54 kPa of pressure it was never
    // graded against — and the knock ceiling falls the whole way. Same defect as the
    // bracket row below, at the other end of the table.
    if (ri === 0 && reach > LOAD[0]) return reach;
    if (LOAD[ri] <= reach) return LOAD[ri];                                 // rule 1
    const below = LOAD[ri + 1];
    return below !== undefined && below < reach ? reach : null;             // rule 2
  };

  LOAD.forEach((mapRow, ri) => {
    RPM.forEach((rpm, ci) => {
      const gradeKpa = gradingKpa(ri, rpm);
      if (gradeKpa === null) return;                                        // rule 2
      // A row graded away from its own pressure is ADVISED but never CLASSIFIED.
      //
      // Below reach, because the player's number is not wrong at a pressure the engine
      // cannot get to — that is the false alarm rule 2 exists to prevent. Above it,
      // because `factoryCalibration` writes the top row against its own row pressure, so
      // grading it at 254 kPa would condemn the app's own factory tables for a rule the
      // generator does not share. Making the two agree means moving the generator, which
      // moves every preset's power, and that is a bigger change than an advisor fix.
      // Advice is free to be stricter than judgement; judgement is not free to cry wolf.
      const bracketOnly = gradeKpa !== mapRow;
      const pt = evaluatePoint({
        rpm, mapKpa: gradeKpa,                                              // rule 1
        boostPsi: Math.max(0, (gradeKpa - BARO_KPA) / PSI_TO_KPA),
        veVal: ve[ri][ci], veActualVal: veTruth?.[ri]?.[ci],
        timingVal: timing[ri][ci], afrCommanded: afr[ri][ci],
        fuel, mods: { ...mods, turboFitted: turboOn }, mafScalar, mafErrorBase,
        injectorCc, ecuInjectorCc, derived, compressor,
        turbine: turboOn ? turbine : null,
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
        rpm, mapKpa: gradeKpa, veCell: ve[ri][ci], afrCell: afr[ri][ci],
        fuel, mods, derived, turboOn, turbine,
      });
      const safeTiming = clamp(
        Math.round(Math.min(knockCeiling, mbt) * 2) / 2, SPARK_MIN_DEG, SPARK_MAX_DEG,
      );
      spark.push({
        ri, ci, rpm, map: mapRow, bracketOnly, current: timing[ri][ci], suggested: safeTiming,
        delta: Number((safeTiming - timing[ri][ci]).toFixed(1)), knocking: pt.knock,
        mbt: Number(mbt.toFixed(1)), knockCeiling: Number(knockCeiling.toFixed(1)),
        // Which ceiling bound the suggestion. Useful on its own, but it says nothing
        // about danger: a cell can sit past both with MBT the lower of the two. Danger
        // is where the PLAYER'S number sits — see the classification below.
        knockLimited: knockCeiling < mbt,
      });

      // Scaling the commanded value by target/delivered prices the error the engine
      // actually made, and lands on the number to type in.                  // rule 3
      const suggestedAfr = afr[ri][ci] * (pt.bestAfr / Math.max(0.1, pt.afr));
      fuelAdv.push({
        ri, ci, rpm, map: mapRow, bracketOnly, current: afr[ri][ci],
        suggested: Number(suggestedAfr.toFixed(1)),
        delta: Number((suggestedAfr - afr[ri][ci]).toFixed(1)),
        delivered: Number(pt.afr.toFixed(2)), target: Number(pt.bestAfr.toFixed(2)),
        duty: pt.duty,
      });
    });
  });

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
  RPM.forEach((rpm, ci) => {
    for (let ri = 1; ri < LOAD.length; ri++) {
      const here = byCell.get(`${ri}|${ci}`);
      const above = byCell.get(`${ri - 1}|${ci}`);        // one row up = more pressure
      // If the row above is unreachable it was never graded, and the engine never runs at
      // those pressures either — so there is no interpolated path to protect.
      if (!here || !above) continue;
      // Only the part of the gap the engine actually enters needs protecting. At 14 psi
      // the manifold peaks at 197.9 kPa, so the 150-200 gap is entered 96% of the way;
      // at no boost it is not entered at all and the pair is left alone.
      const span = LOAD[ri - 1] - LOAD[ri];
      const entered = clamp((reachableKpa(rpm) - LOAD[ri]) / span, 0, 1);
      if (entered <= 0) continue;
      let room = Infinity;
      for (const frac of INTERP_SAMPLE_FRACTIONS) {
        const f = frac * entered;
        const ceiling = ceilingAt(ci, LOAD[ri] + f * span) - KNOCK_SAFETY_DEG;
        room = Math.min(room, (ceiling - f * above.suggested) / (1 - f));
      }
      if (room < here.suggested) {
        here.suggested = clamp(Math.floor(room * 2) / 2, SPARK_MIN_DEG, SPARK_MAX_DEG);
        here.delta = Number((here.suggested - here.current).toFixed(1));
        here.interpolationLimited = true;
      }
      // A cell the interpolated path binds is DANGEROUS, not merely sub-optimal: the
      // sweep really does detonate at that pressure. So the ceiling this cell is judged
      // against comes down with the advice, and the existing classification below reports
      // it in the same breath as any other cell past the knock limit. Reporting the
      // suggestion without the warning would leave the player with a number to type and
      // no reason for it.
      here.knockCeiling = Math.min(here.knockCeiling, Number(room.toFixed(1)));
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
  const overAdvanced = spark.filter((c) => !c.bracketOnly && c.current - c.knockCeiling > ADVANCE_TOLERANCE_DEG);
  const pastMbt = spark.filter((c) => !c.bracketOnly && c.current - c.knockCeiling <= ADVANCE_TOLERANCE_DEG
    && c.current - c.mbt > ADVANCE_TOLERANCE_DEG);
  const underAdvanced = spark.filter((c) => !c.bracketOnly && c.delta > UNDER_ADVANCED_DEG);
  const wrongMix = fuelAdv.filter((c) => !c.bracketOnly && c.map >= OPEN_LOOP_KPA
    && Math.abs(c.delta) > MIX_NOTABLE_AFR);
  return { spark, fuelAdv, overAdvanced, underAdvanced, pastMbt, wrongMix };
}
