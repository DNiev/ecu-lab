/**
 * The turbocharger as a machine, not as a boost slider.
 *
 * A POWER BALANCE. The compressor takes work to raise intake pressure; the turbine
 * extracts it by expanding exhaust to atmospheric. At steady state they are equal, and
 * that sets the boost the hardware can make:
 *
 *   Pc = ṁ_air · cp · T_in · (PR^((γ-1)/γ) − 1) / η_c        compressor work required
 *   Pt = ṁ_exh · cp · T_exh · (1 − PR_t^-((γ-1)/γ)) · η_t    turbine work available
 *
 * Backpressure comes first, from the turbine as a fixed-area nozzle; the expansion across
 * it sets the power available; the balance sets the boost. The player's target is a
 * CEILING enforced by the wastegate, not a promise.
 *
 * Two things this replaces, both of which a tuner feels immediately. Boost was
 * `target × spool(RPM) × throttle²` — but a turbo spools on exhaust ENERGY, so a small
 * housing at full load is already on boost at 2000 RPM and the same housing at light load
 * is not on boost at 5000. And backpressure was proportional to BOOST, when the turbine is
 * a restriction of fixed area: double the flow and it takes roughly twice the pressure.
 *
 * Compressor efficiency comes off a MAP ({@link compressorMap}), so surge and choke are
 * real limit lines rather than one `boostCeiling`. Shaft inertia lives in `live.js` —
 * only the live engine has a transient to lag through, since a dyno sweep holds each
 * point until it settles.
 *
 * STILL MISSING: the map is parametric, not digitised — one island, one surge line, one
 * choke line, not a measured field. No variable geometry, no compressor heat soak.
 */

import { BARO_KPA, GAMMA_EXP, PSI_TO_KPA } from './constants.js';
import { COEFF } from './coefficients.js';
import { clamp } from './math.js';
import { solveBlower } from './blower.js';
import { compressorMap } from './compressorMap.js';

export { compressorMap };

/**
 * Pressure the turbine needs upstream of itself to pass a given exhaust flow.
 *
 * The housing is a nozzle: flow scales with upstream pressure over the square root of
 * upstream temperature, times an effective area. Inverting gives the backpressure the
 * engine pushes against — why a small housing costs pumping work at high flow and almost
 * nothing at idle.
 *
 * @param {number} exhaustFlowKgS mass flow through the turbine
 * @param {number} exhaustK exhaust temperature entering the turbine
 * @param {number} effectiveAreaM2 turbine effective flow area
 * @param {number} [baroKpa] pressure the turbine exhausts to — the day's barometer
 * @returns {number} exhaust manifold pressure, kPa
 */
export function turbineBackPressureKpa(exhaustFlowKgS, exhaustK, effectiveAreaM2, baroKpa = BARO_KPA) {
  const flowParam = (exhaustFlowKgS * Math.sqrt(Math.max(exhaustK, 1)))
    / Math.max(effectiveAreaM2, 1e-9);
  return baroKpa + flowParam * COEFF.TURBINE_FLOW_TO_KPA;
}

/**
 * Boost the hardware can actually make, from the turbine/compressor power balance.
 *
 * @param {object} input
 * @param {number} input.airFlowKgS air the engine is drawing
 * @param {number} input.fuelFlowKgS fuel going in with it; exhaust is the sum of the two
 * @param {number} input.exhaustK turbine inlet temperature
 * @param {number} input.intakeK compressor inlet temperature
 * @param {number} input.empKpa exhaust manifold pressure available to expand
 * @param {{turbineEff: number}} input.turbine
 * @param {object} input.compressor a COMPRESSOR_OPTS entry, read through {@link compressorMap}
 * @param {number} [input.currentPr] pressure ratio to evaluate the map at
 * @param {number} [input.baroKpa] ambient pressure both wheels work against
 * @returns {{boostPsi: number, map: ReturnType<typeof compressorMap>}}
 */
export function achievableBoostPsi({
  airFlowKgS, fuelFlowKgS, exhaustK, intakeK, empKpa, turbine, compressor, currentPr = 1,
  baroKpa = BARO_KPA,
}) {
  const exhaustFlowKgS = airFlowKgS + fuelFlowKgS;
  const expansionRatio = Math.max(1, empKpa / baroKpa);
  // Work the turbine can pull out of that expansion.
  const turbineW = exhaustFlowKgS * COEFF.CP_EXHAUST * exhaustK
    * (1 - Math.pow(expansionRatio, -GAMMA_EXP)) * turbine.turbineEff
    * COEFF.TURBO_MECH_EFF;
  if (turbineW <= 0 || airFlowKgS <= 0) return { boostPsi: 0, map: compressorMap(compressor, airFlowKgS, currentPr) };
  // Efficiency comes off the MAP at where this point actually sits, not from a constant.
  const map = compressorMap(compressor, airFlowKgS, currentPr);
  // Invert the compressor work equation for the pressure ratio that power buys.
  const specificWork = (turbineW * map.eff)
    / (airFlowKgS * COEFF.CP_AIR * Math.max(intakeK, 1));
  const pressureRatio = Math.pow(1 + specificWork, 1 / GAMMA_EXP);
  return { boostPsi: Math.max(0, (pressureRatio - 1) * baroKpa / PSI_TO_KPA), map };
}

/**
 * Solves the manifold and exhaust state for one operating point, turbo included.
 *
 * Boost, airflow and backpressure are mutually dependent. The boost that settles is the
 * highest pressure the turbine can hold, reached by spooling up from zero, capped by the
 * wastegate — see the note on the march below.
 *
 * @param {object} input
 * @param {number} input.rpm engine speed
 * @param {number} input.loadKpa commanded load (throttle), kPa
 * @param {boolean} input.turboOn
 * @param {number} input.boostTargetPsi what the boost controller is asking for
 * @param {object} input.turbine
 * @param {object} input.compressor
 * @param {(mapKpa: number) => number} input.veAt true cylinder filling at a given MAP
 * @param {import('./engine.js').DerivedEngine} input.derived
 * @param {(boostPsi: number) => number} input.intakeKAt charge temperature at a boost level
 * @param {number} input.lambda delivered lambda, for exhaust mass and temperature
 * @param {number} input.exhaustK turbine inlet temperature
 * @param {number} [input.baroKpa] the day's barometric pressure. At altitude a wide-open
 *   throttle only reaches the barometer, and the turbo has to make its pressure ratio
 *   from there
 * @param {object} [input.blower] a BLOWER_OPTS entry: a supercharger instead of a turbo.
 *   Its boost comes from its own physics (src/sim/blower.js) and the target is ignored —
 *   a supercharger has no wastegate; the pulley sets its boost
 * @param {number} [input.blowerRatio] crank pulley ÷ blower pulley
 * @param {(boostPsi: number, isenEff: number) => number} [input.intakeKAtEff] charge
 *   temperature at a boost level for a compressor of the given efficiency
 * @param {boolean} [input.targetIsFinal] the boost controller has already turned the
 *   driver's request into a wastegate ceiling, so the stock throttle² scaling below must
 *   not be applied a second time
 * @returns {{mapKpa: number, boostPsi: number, empKpa: number, throttleFrac: number,
 *   spool: number, boostShortfallPsi: number, compressorEff: number, surge: boolean,
 *   choke: boolean, mapMargin: number, blower?: ReturnType<typeof solveBlower>}}
 */
export function solveInduction({
  rpm, loadKpa, turboOn, boostTargetPsi, turbine, compressor,
  veAt, derived, intakeKAt, lambda, exhaustK, baroKpa = BARO_KPA, targetIsFinal = false,
  blower = null, blowerRatio = 1, intakeKAtEff = null,
}) {
  const throttleFrac = clamp(loadKpa / BARO_KPA, 0, 1);
  // `loadKpa` is the throttle expressed as the sea-level manifold pressure it would give,
  // so at altitude the same opening gives proportionally less. At sea level this is
  // exactly min(loadKpa, BARO_KPA).
  const throttledKpa = baroKpa === BARO_KPA ? Math.min(loadKpa, BARO_KPA) : throttleFrac * baroKpa;
  // The throttle plate still gates a turbo engine: closed throttle means no flow to
  // compress, whatever the turbine could theoretically do.
  const target = turboOn
    ? Math.max(0, boostTargetPsi) * (targetIsFinal ? 1 : Math.pow(throttleFrac, 2)) : 0;

  const airFlowAt = (mapKpa, boostPsi) => {
    const chargeK = intakeKAt(boostPsi);
    const sweptM3 = (derived.displacementL / derived.cyl) / 1000;
    const densityKgM3 = (mapKpa * 1000) / (287 * chargeK);
    const perCycleKg = (veAt(mapKpa) / 100) * sweptM3 * densityKgM3;
    return perCycleKg * derived.cyl * (rpm / 2) / 60;
  };

  // A supercharger: its boost is its own physics, not a balance with a turbine.
  if (blower && !turboOn) {
    const airFlowAtK = (mapKpa, chargeK) => {
      const sweptM3 = (derived.displacementL / derived.cyl) / 1000;
      const densityKgM3 = (mapKpa * 1000) / (287 * chargeK);
      return (veAt(mapKpa) / 100) * sweptM3 * densityKgM3 * derived.cyl * (rpm / 2) / 60;
    };
    const chargeKFor = (b, eta) => (intakeKAtEff ? intakeKAtEff(b, eta) : intakeKAt(b));
    const sc = solveBlower({
      blower, driveRatio: blowerRatio, rpm, throttleFrac, throttledKpa, baroKpa,
      inletK: intakeKAt(0),
      engineFlowAt: (mapKpa, b, eta) => airFlowAtK(mapKpa, chargeKFor(b, eta)),
    });
    const mapKpa = throttledKpa + sc.boostPsi * PSI_TO_KPA;
    const airFlowKgS = airFlowAtK(mapKpa, chargeKFor(sc.boostPsi, sc.eta));
    return {
      mapKpa,
      boostPsi: sc.boostPsi,
      empKpa: baroKpa + airFlowKgS * COEFF.EXHAUST_SYSTEM_KPA_PER_KGS,
      throttleFrac,
      spool: 1,
      boostShortfallPsi: 0,
      compressorEff: sc.eta,
      surge: sc.surge,
      choke: sc.choke,
      mapMargin: sc.margin,
      blower: sc,
    };
  }

  // One turn of the loop at an assumed boost: the air that pressure pushes in, the
  // backpressure that flow meets at the turbine, and the boost the turbine could then hold.
  const stateAt = (boostPsi) => {
    const mapKpa = throttledKpa + boostPsi * PSI_TO_KPA;
    const airFlowKgS = airFlowAt(mapKpa, boostPsi);
    const fuelFlowKgS = airFlowKgS / Math.max(1, lambda * COEFF.EXHAUST_STOICH_REF);
    if (!turboOn) {
      return { mapKpa, empKpa: baroKpa + (airFlowKgS * COEFF.EXHAUST_SYSTEM_KPA_PER_KGS), canMake: 0, map: compressorMap(compressor, 0, 1) };
    }
    const empKpa = turbineBackPressureKpa(airFlowKgS + fuelFlowKgS, exhaustK, turbine.effectiveAreaM2, baroKpa);
    const solved = achievableBoostPsi({
      airFlowKgS, fuelFlowKgS, exhaustK, intakeK: intakeKAt(boostPsi),
      empKpa, turbine, compressor, currentPr: mapKpa / baroKpa, baroKpa,
    });
    // CHOKE IS A MASS FLOW LIMIT, not merely an efficiency penalty. Once the inducer is
    // at Mach 1 no more air goes through it at any shaft speed, so a boost that would
    // push more than that flow through the compressor cannot be held.
    const chokeCap = airFlowKgS > compressor.chokeFlowKgS
      ? boostPsi * (compressor.chokeFlowKgS / airFlowKgS)
      : Infinity;
    return { mapKpa, empKpa, canMake: Math.min(solved.boostPsi, chokeCap), map: solved.map };
  };

  // THE TURBO SPOOLS UP FROM BELOW. Boost builds from nothing, and it keeps building for
  // as long as the turbine can hold the pressure it has reached; it stops at the first
  // pressure it cannot hold, or at the wastegate ceiling, whichever comes first. So the
  // answer is found the same way: march up from zero while the turbine can sustain it,
  // then close in on the edge.
  //
  // This replaced three damped passes that started AT the target and relaxed down, which
  // is not what a turbo does and did not converge: past the surge line the turbine's
  // answer collapses, so starting high dropped the solve into surge, where it cycled
  // between two or three values however many passes it was given. The result depended
  // on how much boost was asked for even when none of it could be made — asking for 16
  // psi at 1900 RPM gave 2.9 psi where asking for 5 gave 4.2, and the ECU and the
  // original model, asking for 14.08 and 14.07, landed 1.4 psi apart. Marching from below
  // is monotone by construction: asking for more never gives less.
  let boostPsi = 0;
  if (target > 0) {
    const step = Math.max(COEFF.INDUCTION_SPOOL_STEP_PSI, target / COEFF.INDUCTION_SPOOL_MAX_STEPS);
    let failed = null;
    for (let b = Math.min(step, target); ; b = Math.min(b + step, target)) {
      if (stateAt(b).canMake >= b) {
        boostPsi = b;
        if (b >= target) break;
      } else {
        failed = b;
        break;
      }
    }
    if (failed !== null) {
      let lo = boostPsi;
      let hi = failed;
      for (let i = 0; i < COEFF.INDUCTION_EDGE_PASSES; i += 1) {
        const mid = (lo + hi) / 2;
        if (stateAt(mid).canMake >= mid) lo = mid; else hi = mid;
      }
      boostPsi = lo;
    }
  }
  const settled = stateAt(boostPsi);
  const mapKpa = settled.mapKpa;
  let empKpa = settled.empKpa;
  const mapState = settled.map;

  // When the wastegate is holding boost down, it is also bleeding exhaust around the
  // turbine, so the engine does not pay the full backpressure the turbine would need to
  // pass everything. That is precisely why a bigger turbine on a wastegated setup is
  // worth power even at the same boost.
  //
  // The gate opens only when the turbine could hold MORE than the ceiling, and it bleeds
  // the excess: the share of turbine capability above the target. When the turbo cannot
  // reach the target the gate is shut and every gram goes through the wheel. (This used
  // to open the gate in proportion to the SHORTFALL — 1 − boost/target — which relieved
  // backpressure on exactly the points where the gate is closed.)
  if (turboOn && empKpa > baroKpa) {
    const holding = target > 0 && boostPsi >= target - 1e-6;
    const gateOpen = holding && settled.canMake > target ? clamp(1 - target / settled.canMake, 0, 1) : 0;
    empKpa = baroKpa + (empKpa - baroKpa) * (1 - gateOpen * COEFF.WASTEGATE_RELIEF);
  }

  return {
    mapKpa,
    boostPsi,
    empKpa,
    throttleFrac,
    // Kept for display continuity: how much of the requested boost is actually present.
    spool: target > 0 ? clamp(boostPsi / target, 0, 1) : 0,
    boostShortfallPsi: Math.max(0, target - boostPsi),
    // Where the compressor ended up on its own map. Surge and choke are real limits now,
    // not a single `boostCeiling` standing in for both.
    compressorEff: mapState.eff,
    surge: mapState.surge,
    choke: mapState.choke,
    mapMargin: mapState.margin,
  };
}
