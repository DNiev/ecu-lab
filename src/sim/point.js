/**
 * The simulation core: one operating point, fully solved.
 *
 * `evaluatePoint` is the heart of the whole app — everything else feeds it or
 * displays its output. It is commented step by step in the order an ECU actually
 * works: read load, compute air mass, decide fuel, convert to pulse width, check
 * knock, burn, subtract losses, report torque.
 *
 * It is a pure function with no React dependency, which is what makes the whole
 * physics layer testable in plain Node.
 */

import { DRIVETRAIN_EFF, INJ_DEADTIME_MS, KELVIN_OFFSET } from './constants.js';
import { COEFF } from './coefficients.js';
import {
  cycleInputsFor, cylinderVolumeM3, knockLimitedSpark, mbtFromBurn, paToBar, runCycle, trappedAirGrams,
} from './cycle.js';
import { ECU_COEFF } from './ecu/ecuCoefficients.js';
import { exhaustManifoldKpa, rubbingFmepPa, pumpingFmepPa } from './friction.js';
import { chargeIndexOf } from './knock.js';
import { bestPowerAfr } from './manifold.js';
import { clamp } from './math.js';
import { OPEN_LOOP_KPA, effectiveMafFactor } from './tables.js';
import { chargeTempK, exhaustTempK } from './thermo.js';

/**
 * @typedef {object} PointInput
 * @property {number} rpm engine speed
 * @property {number} mapKpa manifold absolute pressure, kPa
 * @property {number} boostPsi gauge boost, psi
 * @property {number} veVal the ECU's VE table value at this point, percent — what the
 *   ECU BELIEVES the cylinder filling is. Drives the fuel calculation.
 * @property {number} [veActualVal] TRUE cylinder filling at this point, percent — what
 *   the hardware really flows. Drives torque, knock and the measured airflow. Defaults
 *   to `veVal`, which models a perfectly calibrated VE table.
 * @property {number} timingVal commanded spark advance, degrees BTDC
 * @property {number} afrCommanded commanded air:fuel ratio, gasoline-equivalent
 * @property {{stoich: number, density: number, lhv: number, octane: number}} fuel
 * @property {object} mods bolt-ons fitted, plus `turboFitted`
 * @property {number} mafScalar player's MAF calibration multiplier
 * @property {number} mafErrorBase physical MAF error introduced by hardware
 * @property {number} injectorCc injector size actually fitted, cc/min
 * @property {number} ecuInjectorCc injector size the ECU believes is fitted, cc/min
 * @property {import('./engine.js').DerivedEngine} derived
 * @property {number} [octaneBonus] legacy, accepted and IGNORED. Octane is a fuel
 *   property (`fuel.octane`) the autoignition model reads, not a margin added after the
 *   fact. `fuel.bonus` is still live, but only in the Engineer Score.
 * @property {{boostCeiling: number}} compressor
 * @property {{size: string, effectiveAreaM2: number}|null} [turbine] turbine in the
 *   exhaust stream, if any. Null means no turbine, which is the correct state for a
 *   naturally aspirated engine — it sets exhaust backpressure, so it is not a cosmetic
 *   omission
 * @property {number} [empKpa] exhaust manifold pressure, when the caller has already
 *   solved the induction system and knows it. Omitted, it is computed here from this
 *   point's own exhaust flow
 * @property {number} [wastegateRelief] how much backpressure the wastegate is bleeding
 * @property {EcuPointContext} [ecu] what the engine management is actually doing at this
 *   point, resolved from its calibration by `src/sim/ecu/`. Absent, the ECU is the ideal
 *   one this function always modelled — it reads the true manifold pressure and charge
 *   temperature, knows the fuel, flows its injectors at their rating and finds the knock
 *   limit exactly — and the result is identical to before the ECU layer existed.
 */

/**
 * The engine management's side of one operating point: what it BELIEVES, and what it
 * commands on top of the base tables. Every field is optional and each one defaults to
 * the ideal ECU, so a context can describe one departure from ideal at a time.
 *
 * Nothing here is a power figure. Each field is something a real ECU reads, assumes or
 * commands, and its consequence comes out of the same air, fuel and cycle physics as
 * everything else.
 *
 * @typedef {object} EcuPointContext
 * @property {{ambientK?: number, baroKpa?: number}} [env] the day's air
 * @property {number} [sensedMapKpa] manifold pressure as the ECU's MAP sensor reports it
 * @property {number} [sensedIatK] charge temperature as the ECU's IAT sensor reports it
 * @property {'blend'|'sd'|'maf'} [airModel] how the ECU works out air mass. `blend` is the
 *   original model: speed-density from the VE table, with the MAF's error feeding the
 *   trims. `sd` is pure speed-density. `maf` fuels from the MAF reading and ignores VE
 * @property {number} [mafNetFactor] the MAF's total reading error after the ECU's own
 *   transfer-function correction, as a multiplier on true airflow
 * @property {number} [openLoopKpa] MAP above which the ECU stops trimming
 * @property {number} [trimResidual] fraction of a steady fuelling error closed loop leaves
 * @property {number} [trimLimitPct] the most the trims may correct, percent
 * @property {{stoich: number, density: number}} [ecuFuel] the fuel the ECU believes is in
 *   the tank. Fuel mass comes from its stoichiometric ratio, injector volume from its
 *   density
 * @property {number} [fuelMult] every commanded fuel correction multiplied together:
 *   enrichments, trims, per-cylinder trim. Commanded, so it changes pulse width
 * @property {number} [cylinderFuelFactor] fraction of the injected fuel that actually
 *   reaches the cylinder this cycle — the port wall film on a transient. Physical, so the
 *   ECU cannot see it
 * @property {{actualFlowScale?: number, ecuFlowScale?: number, deadActualMs?: number,
 *   deadEcuMs?: number, minPwMs?: number, maxDutyFrac?: number, railDeltaKpa?: number}} [inj]
 *   injector reality versus belief: real flow from the pressure across it and the
 *   pump's capacity, the flow the ECU assumes, true and assumed dead time, the shortest
 *   pulse the ECU will command, and the duty ceiling
 * @property {{retardDeg?: number, deadbandDeg?: number, falseRetardDeg?: number,
 *   maxRetardDeg?: number, enabled?: boolean, stepDeg?: number}} [knock] knock control. `retardDeg` is a
 *   live controller's current retard; without it the steady-state controller settles at
 *   the knock limit, less whatever knock the sensor cannot hear (`deadbandDeg`), plus
 *   whatever noise it mistakes for knock (`falseRetardDeg`)
 * @property {{intakeAdvDeg?: number, exhaustRetDeg?: number}} [cam] cam phaser positions
 * @property {number} [chamberOffsetK] extra chamber heat for this particular cylinder
 * @property {number} [cutFrac] fraction of firing events the ECU is cutting
 * @property {'fuel'|'spark'} [cutType] fuel cut leaves air in the exhaust; spark cut
 *   leaves unburned fuel to light in the manifold
 * @property {{kvAvailable?: number, gapMm?: number}} [spark] ignition energy available,
 *   against which the breakdown voltage the cylinder needs is checked
 */

/**
 * Solves one steady-state operating point.
 *
 * @param {PointInput} input
 * @returns {object} the full datalog record for this point
 */
export function evaluatePoint({
  rpm, mapKpa, boostPsi, veVal, veActualVal, timingVal, afrCommanded,
  fuel, mods, mafScalar, mafErrorBase,
  injectorCc, ecuInjectorCc, derived, compressor, turbine = null,
  empKpa: empOverride, wastegateRelief = 0, ecu: E = null,
}) {
  const compressorOver = boostPsi > compressor.boostCeiling;
  const chargeK = E ? chargeTempK(boostPsi, mods.intercooler, E.env) : chargeTempK(boostPsi, mods.intercooler);
  const chargeC = chargeK - KELVIN_OFFSET;

  // --- AIR CHARGE: ideal gas law. MAP already carries load, so VE is used purely as
  // an efficiency term here — no separate throttle multiplier (that would
  // double-count load, which is exactly the Alpha-N mistake).
  //
  // TWO VE NUMBERS, DOING DIFFERENT JOBS. Do not collapse these into one variable:
  //   veActual   what the hardware flows. Physics. Sets real air, so torque/knock/MAF.
  //   veVal      what the ECU's table CLAIMS. Calibration. The ECU has no airflow
  //              oracle and fuels from this and nothing else.
  // The gap between them IS the fuel-trim histogram's entire signal. Share one VE and the
  // gap is identically zero, the histogram reads nothing, and no iteration can close it.
  const veActual = veActualVal ?? veVal;
  const vCylM3 = (derived.displacementL / derived.cyl) / 1000;
  const airChargeG = trappedAirGrams({ veActual, mapKpa, chargeK, sweptM3: vCylM3 });
  // The ECU's speed-density sum runs on what its SENSORS say, not on the truth. With an
  // ideal ECU the two are the same thing.
  const airModel = E?.airModel ?? 'blend';
  const airChargeBelievedG = airModel === 'maf'
    ? airChargeG
    : trappedAirGrams({
      veActual: veVal,
      mapKpa: E?.sensedMapKpa ?? mapKpa,
      chargeK: E?.sensedIatK ?? chargeK,
      sweptM3: vCylM3,
    });
  // The MAF reading reports real airflow — a sensor cannot read a table.
  const mafGps = (airChargeG * derived.cyl * (rpm / 2)) / 60;

  // --- MAF error / fuel trim. Open loop above OPEN_LOOP_KPA (near WOT).
  const netFactor = airModel === 'sd' ? 1 : (E?.mafNetFactor ?? mafErrorBase * mafScalar);
  const ecuMapKpa = E?.sensedMapKpa ?? mapKpa;
  const openLoop = ecuMapKpa >= (E?.openLoopKpa ?? OPEN_LOOP_KPA);
  const effFactor = E ? ecuTrimmedFactor(netFactor, openLoop, E) : effectiveMafFactor(netFactor, mapKpa);
  const trimPct = (effFactor - 1) * 100;

  // --- FUEL MASS from lambda and the fuel's own stoichiometric ratio. Computed from
  // the air the ECU BELIEVES it has, because that is all the ECU knows — and from the
  // fuel it believes is in the tank.
  const lambdaCommanded = (afrCommanded / 14.7) / effFactor;
  const ecuFuel = E?.ecuFuel ?? fuel;
  const fuelMassG = (airChargeBelievedG * (E?.fuelMult ?? 1)) / (lambdaCommanded * ecuFuel.stoich);

  // --- INJECTOR: the ECU computes pulse width for the injector size it has been TOLD
  // it has. Fit bigger injectors without rescaling and every pulse delivers
  // proportionally more fuel than intended — the classic "went rich after upgrading
  // injectors" mistake real tuners fix with a scaling constant.
  //
  // With an ECU context, flow is also a matter of PRESSURE: an injector is an orifice, so
  // it passes fuel as the square root of the pressure across it. The ECU flows it at
  // whatever pressure it assumes; the injector flows at whatever pressure is there.
  const inj = E?.inj;
  const ecuGramsPerMs = (ecuInjectorCc * ecuFuel.density) / 60000 * (inj?.ecuFlowScale ?? 1);
  const actualGramsPerMs = (injectorCc * fuel.density) / 60000 * (inj?.actualFlowScale ?? 1);
  const deadEcuMs = inj?.deadEcuMs ?? INJ_DEADTIME_MS;
  const deadActualMs = inj?.deadActualMs ?? INJ_DEADTIME_MS;
  const cycleTimeMs = 120000 / rpm;
  // The shortest pulse the ECU will command: below it an injector is in its ballistic
  // region, where the needle never reaches full lift and flow stops being proportional
  // to time. Clamping trades a slightly rich idle for a repeatable one.
  const pulseWidthMs = Math.max(fuelMassG / ecuGramsPerMs + deadEcuMs, inj?.minPwMs ?? 0);
  const maxPulseMs = cycleTimeMs * (inj?.maxDutyFrac ?? 0.9);
  const dutyPct = clamp((pulseWidthMs / cycleTimeMs) * 100, 0, 220);

  const cappedPw = Math.min(pulseWidthMs, maxPulseMs);
  const fuelLimited = pulseWidthMs > maxPulseMs;
  const openMs = cappedPw - deadActualMs;
  const deliveredFuelG = Math.max(
    1e-6,
    (E ? ballisticOpenMs(openMs) : openMs) * actualGramsPerMs * (E?.cylinderFuelFactor ?? 1),
  );
  const lambdaActual = airChargeG / (deliveredFuelG * fuel.stoich);
  const actualAfr = lambdaActual * 14.7;

  // --- GAS EXCHANGE. What the piston pushes against on the exhaust stroke, and how
  // much of last cycle's exhaust is still in the cylinder when the intake valve shuts.
  const bestAfr = bestPowerAfr(boostPsi);
  const chargeIndex = chargeIndexOf(veActual, mapKpa);
  // Mass actually leaving the cylinder each second — air plus the fuel that went in
  // with it — which is what the turbine has to pass.
  const exhaustFlowKgS = ((airChargeG + deliveredFuelG) / 1000) * derived.cyl * (rpm / 2) / 60;
  const turbineInletK = exhaustTempK({ chargeIndex, lambda: lambdaActual });
  const empKpa = empOverride ?? exhaustManifoldKpa({
    turboOn: !!mods.turboFitted, exhaustFlowKgS, exhaustK: turbineInletK,
    turbine, wastegateRelief, ...(E?.env?.baroKpa ? { baroKpa: E.env.baroKpa } : {}),
  });

  // --- THE CYCLE ITSELF. Everything from here is read off an integrated pressure
  // trace rather than estimated: the work done, the peak pressure, and whether the end
  // gas had time to light itself before the flame reached it.
  const burnedFuelG = Math.min(deliveredFuelG, airChargeG / fuel.stoich);
  const cycDerived = E?.chamberOffsetK
    ? { ...derived, chamberOffsetK: (derived.chamberOffsetK || 0) + E.chamberOffsetK }
    : derived;
  const cyc = cycleInputsFor({
    rpm, mapKpa, empKpa, intakeK: chargeK,
    airChargeG, burnedFuelG, fuelMassG: deliveredFuelG, lambda: lambdaActual, fuel,
    derived: cycDerived, ...(E?.cam ? { cam: E.cam } : {}),
  });

  // The knock limit is solved from the same cycle, so it responds to compression,
  // boost, charge heat, residuals, mixture and cam timing without a separate term for
  // any of them. This is what the ECU's knock control is protecting against.
  const threshold = knockLimitedSpark(cyc);
  const margin = threshold - timingVal;
  const knockPull = E?.knock ? ecuKnockRetard(margin, E.knock) : (margin < 0 ? Math.min(COEFF.MAX_KNOCK_RETARD, -margin) : 0);
  const usedTiming = timingVal - knockPull;

  const cycle = runCycle({ ...cyc, sparkBtdc: usedTiming });
  const mbtIdeal = mbtFromBurn(cyc.burnDeg);
  // Events that did not burn: the ECU cutting them (limiter, protection, traction) and
  // the cylinder failing to light (a spark too weak for the pressure, or a mixture
  // outside what a flame will cross). Both cost the whole event's work.
  const ign = E ? ignitionState({ cyc, usedTiming, lambda: lambdaActual, E }) : null;
  const deadFrac = ign ? clamp((E.cutFrac ?? 0) + (1 - (E.cutFrac ?? 0)) * ign.misfireFrac, 0, 1) : 0;
  const imepPa = cycle.imepGrossPa * (1 - deadFrac);

  // The engine must pay for its own rubbing friction, and for the gas-exchange loop.
  // Pumping is exhaust manifold pressure minus intake: a loss when throttled, and
  // genuinely negative — work returned to the piston — when boost exceeds backpressure.
  const pmepPa = pumpingFmepPa(mapKpa, empKpa);
  const rubbingPa = rubbingFmepPa(rpm, derived.springPa || 0, {
    bearingFmepPa: derived.bearingFmepPa, balanceShaftFrac: derived.balanceShaftFrac,
  });
  const fmepPa = rubbingPa + pmepPa;
  const bmepPa = imepPa - fmepPa;

  // T = BMEP × Vd / (4π) for a four-stroke; power follows from torque.
  const torqueNmCrank = (bmepPa * (derived.displacementL / 1000)) / (4 * Math.PI);
  const powerW = torqueNmCrank * (2 * Math.PI * rpm / 60);
  const hp = (powerW / 745.7) * DRIVETRAIN_EFF;
  const torque = torqueNmCrank * 0.7376 * DRIVETRAIN_EFF;
  // Fuel per unit of work OUT, from fuel DELIVERED — BSFC prices what leaves the tank,
  // and at a rich WOT mixture a fifth of it finds no oxygen and the driver still paid.
  // Null on overrun and in deep vacuum: there is no work out, so the quantity is
  // undefined. Zero would read as an engine making power from no fuel.
  const bsfc = powerW > 0
    ? (deliveredFuelG * derived.cyl * (rpm / 2) * 60 / 453.6) / (powerW / 745.7) : null;

  // --- MECHANICAL LOAD. Torque is what the engine gives you; peak cylinder pressure is
  // what it costs the metal. Both come off the same trace, so they cannot disagree.
  const peakPressure = paToBar(cycle.peakPressurePa);
  const pressureRisk = peakPressure > COEFF.PEAK_PRESSURE_LIMIT_BAR;

  // The CYCLE's own answer — the burned zone at exhaust valve open, blown down to the
  // manifold. Retard shows up here for the real reason rather than a per-degree
  // coefficient: the burn finishes later into the expansion, so less work is extracted
  // and the gas leaves hotter. `exhaustTempK` survives only where an answer is needed
  // BEFORE the cycle can run — the turbine backpressure the cycle itself depends on.
  let egtC = cycle.exhaustK - KELVIN_OFFSET;
  if (ign && deadFrac > 0) {
    // A fuel-cut event pumps cool air through; a spark-cut or misfired one dumps a full
    // charge of fuel and air into a hot manifold, where it lights — the limiter's pops.
    const unlitHot = (E.cutType === 'spark' ? (E.cutFrac ?? 0) : 0) + (1 - (E.cutFrac ?? 0)) * ign.misfireFrac;
    const airOnly = deadFrac - unlitHot;
    egtC = egtC * (1 - airOnly) + (chargeK - KELVIN_OFFSET + ECU_COEFF.CUT_AIR_RISE_C) * airOnly
      + unlitHot * ECU_COEFF.AFTERBURN_RISE_C;
  }
  const egtRisk = egtC > COEFF.EGT_LIMIT_C;
  const leanRisk = actualAfr > COEFF.LEAN_DAMAGE_AFR && mapKpa >= 85;
  // Excessively rich is its own failure mode, not just "safe": unburnt fuel washes the
  // oil film off the bores, fouls plugs and costs power. Slower than knock, still damage.
  const richRisk = lambdaActual < COEFF.RICH_DAMAGE_LAMBDA && mapKpa >= 55;
  const valveRisk = leanRisk && boostPsi > 3;
  const mafFlag = Math.abs(trimPct) > 8 && (mods.intake || mods.turboFitted);
  const injMismatch = Math.abs(injectorCc / ecuInjectorCc - 1) > 0.05;

  // What only exists once the ECU is modelled. Kept out of the base record entirely when
  // it is not, so an ECU-less evaluation is the same record it always was, field for field.
  const ecuFields = E ? {
    sensedMap: Number((E.sensedMapKpa ?? mapKpa).toFixed(0)),
    sensedIat: Number(((E.sensedIatK ?? chargeK) - KELVIN_OFFSET).toFixed(0)),
    fuelMass: Number((deliveredFuelG * 1000).toFixed(2)),
    fuelCmd: Number((fuelMassG * 1000).toFixed(2)),
    // Base fuel schedule: the pulse the ECU would need for lambda 1 on the air it
    // believes, before targets, corrections and dead time. Nissan logs load as this.
    bfs: Number(((airChargeBelievedG / ecuFuel.stoich) / ecuGramsPerMs).toFixed(2)),
    deadTime: Number(deadEcuMs.toFixed(3)),
    deadTimeActual: Number(deadActualMs.toFixed(3)),
    railDp: Number((inj?.railDeltaKpa ?? 300).toFixed(0)),
    // What a wideband in the collector sees: cut cylinders pass their air straight
    // through, so a fuel cut reads lean even though every firing cylinder is on target.
    lambdaExhaust: Number((E.cutType === 'fuel' && (E.cutFrac ?? 0) > 0
      ? lambdaActual / Math.max(0.05, 1 - E.cutFrac) : lambdaActual).toFixed(3)),
    knockUnheard: Number(Math.max(0, -(margin + knockPull)).toFixed(2)),
    misfire: Number((ign.misfireFrac * 100).toFixed(1)),
    cutPct: Number(((E.cutFrac ?? 0) * 100).toFixed(0)),
    sparkKvNeed: Number(ign.kvNeeded.toFixed(1)),
    sparkKvHave: Number(ign.kvAvailable.toFixed(1)),
    camIn: Number((E.cam?.intakeAdvDeg ?? 0).toFixed(1)),
    camEx: Number((E.cam?.exhaustRetDeg ?? 0).toFixed(1)),
  } : null;

  return {
    rpm, hp: Math.round(hp), torque: Math.round(torque),
    // `ve` is the measured (true) filling, which is what a datalog and the fuel-trim
    // histogram need; `veTable` is what the ECU was working from.
    ve: Number(veActual.toFixed(1)),
    veTable: Number(veVal.toFixed(1)),
    afr: Number(actualAfr.toFixed(2)), afrCommanded: Number(afrCommanded.toFixed(2)),
    lambda: Number(lambdaActual.toFixed(3)),
    timing: Number(usedTiming.toFixed(1)), commandedTiming: Number(timingVal.toFixed(1)),
    duty: Math.round(dutyPct), pw: Number(pulseWidthMs.toFixed(2)),
    maf: Number(mafGps.toFixed(1)), map: Number(mapKpa.toFixed(0)),
    iat: Number(chargeC.toFixed(0)), airCharge: Number(airChargeG.toFixed(3)),
    boostPsi: Number(boostPsi.toFixed(1)), trimPct: Number(trimPct.toFixed(1)),
    threshold: Number(threshold.toFixed(1)), margin: Number(margin.toFixed(1)),
    chargeIndex: Number(chargeIndex.toFixed(3)),
    mbtIdeal: Number(mbtIdeal.toFixed(1)), openLoop,
    egt: Math.round(egtC),
    imep: Number((imepPa / 100000).toFixed(2)), bmep: Number((bmepPa / 100000).toFixed(2)),
    fmep: Number((fmepPa / 100000).toFixed(2)),
    bsfc: bsfc === null ? null : Number(bsfc.toFixed(3)),
    // The gas-exchange loop, reported separately from rubbing friction because they are
    // different problems with different fixes — one is a turbo match, the other is a
    // rebuild.
    pmep: Number((pmepPa / 100000).toFixed(2)), emp: Number(empKpa.toFixed(0)),
    bestAfr: Number(bestAfr.toFixed(2)),
    peakPressure: Number(peakPressure.toFixed(1)),
    // Read off the trace: where the pressure peaked, where the burn centred, how much
    // of last cycle's exhaust is still in the cylinder, and how close the end gas came
    // to lighting itself (1.0 is knock).
    peakPressureDeg: Number(cycle.peakPressureDeg.toFixed(1)),
    mfb50: Number(cycle.mfb50Deg.toFixed(1)),
    burnDeg: Number(cyc.burnDeg.toFixed(1)),
    residualFrac: Number(cyc.residualFrac.toFixed(3)),
    effectiveCr: Number(cyc.effectiveCr.toFixed(2)),
    knockIntegral: Number(cycle.knockIntegral.toFixed(3)),
    endGasK: Math.round(cycle.peakEndGasK),
    knock: knockPull > 0, knockPull, fuelLimited, leanRisk, richRisk, valveRisk,
    egtRisk, pressureRisk, mafFlag, compressorOver, injMismatch,
    ...ecuFields,
  };
}

/**
 * Closed-loop trimming with an ECU that has its own trim authority.
 *
 * The original model left a flat quarter of any error behind in closed loop. The trims
 * cannot correct more than their limit, though, so an error bigger than the limit is
 * left at whatever the limit could not reach — that is when a trim "rails" and the
 * mixture wanders off target.
 *
 * @param {number} netFactor total airflow reading error
 * @param {boolean} openLoop whether the ECU is ignoring its oxygen sensor here
 * @param {EcuPointContext} E
 * @returns {number} factor the commanded lambda is divided by
 */
function ecuTrimmedFactor(netFactor, openLoop, E) {
  const err = netFactor - 1;
  if (openLoop) return 1 + err;
  const residual = E.trimResidual ?? 0.25;
  const limit = (E.trimLimitPct ?? COEFF.TRIM_LIMIT) / 100;
  const leftAfterLimit = Math.sign(err) * Math.max(0, Math.abs(err) - limit);
  const left = Math.abs(leftAfterLimit) > Math.abs(err * residual) ? leftAfterLimit : err * residual;
  return 1 + left;
}

/**
 * Injector opening time corrected for the ballistic region. Below about a third of a
 * millisecond of open time the pintle is still accelerating and never reaches full
 * lift, so the injector passes proportionally less than its rating says. Above it, flow
 * is linear in time, which is the only region a flow rating describes.
 *
 * @param {number} openMs pulse width minus dead time
 * @returns {number} equivalent full-flow opening time, ms
 */
export function ballisticOpenMs(openMs) {
  const linearFrom = ECU_COEFF.BALLISTIC_OPEN_MS;
  if (openMs >= linearFrom) return openMs;
  if (openMs <= 0) return 0;
  // Flow ramps up as the needle lifts: quadratic in time, meeting the linear region at
  // its start. Always less than the rating predicts, which is why a tiny commanded pulse
  // runs lean and erratic.
  return (openMs * openMs) / linearFrom;
}

/**
 * Where a knock controller settles at one steady operating point.
 *
 * An ideal one lands exactly on the knock limit. A real one can only act on knock its
 * sensor can hear above the engine's mechanical noise — anything quieter than the
 * threshold is left running (`deadbandDeg` past the limit) — and it retards for noise it
 * mistakes for knock (`falseRetardDeg`), however far from the limit the engine is.
 *
 * @param {number} margin knock limit minus commanded timing, degrees
 * @param {NonNullable<EcuPointContext['knock']>} K
 * @returns {number} retard applied, degrees
 */
function ecuKnockRetard(margin, K) {
  const max = K.maxRetardDeg ?? COEFF.MAX_KNOCK_RETARD;
  if (K.enabled === false) return 0;
  if (K.retardDeg != null) return clamp(K.retardDeg, 0, max);
  // Once it hears knock the controller retards in whole steps and creeps back until it
  // hears it again. So anything it hears costs at least one step — a knock log never
  // shows a tenth of a degree, it shows the step — and a bigger deficit costs that much.
  // A deadband narrower than half a step is covered by the step; a wider one leaves the
  // engine running the difference into knock.
  const deficit = Math.max(0, -margin);
  const deadband = K.deadbandDeg ?? 0;
  const step = K.stepDeg ?? 2;
  const uncovered = Math.max(0, deadband - step / 2);
  const heard = deficit > deadband ? Math.max(step, deficit - uncovered) : 0;
  return clamp(Math.max(heard, K.falseRetardDeg ?? 0), 0, max);
}

/**
 * Whether this event lights.
 *
 * Two independent ways for a cylinder not to fire. The SPARK: the gap has to break down
 * before the coil can deliver anything, and the voltage that takes rises with the gas
 * density at the plug (Paschen) — so boost and advance both ask more of the coil. The
 * MIXTURE: a flame only crosses a charge within its flammability limits, which residual
 * gas narrows.
 *
 * @param {object} input
 * @param {ReturnType<typeof cycleInputsFor>} input.cyc
 * @param {number} input.usedTiming spark advance, degrees BTDC
 * @param {number} input.lambda delivered lambda
 * @param {EcuPointContext} input.E
 * @returns {{misfireFrac: number, kvNeeded: number, kvAvailable: number}}
 */
function ignitionState({ cyc, usedTiming, lambda, E }) {
  const vIvc = cylinderVolumeM3(-180 + cyc.ivcAbdc, cyc.clearanceM3, cyc.sweptM3, cyc.rodRatio);
  const vSpark = cylinderVolumeM3(-usedTiming, cyc.clearanceM3, cyc.sweptM3, cyc.rodRatio);
  // Polytropic compression from IVC to the spark, on the charge's own pressure.
  const pSparkBar = (cyc.trappedPa * Math.pow(vIvc / Math.max(vSpark, 1e-9), ECU_COEFF.SPARK_POLYTROPIC_N)) / 1e5;
  // Paschen's law for a small gap at engine densities: breakdown voltage grows with
  // pressure times gap, a little less than linearly. The density scales with charge
  // temperature too, which is folded into pressure at the plug here.
  const gap = E.spark?.gapMm ?? 1.0;
  const kvNeeded = ECU_COEFF.SPARK_BASE_KV
    + ECU_COEFF.SPARK_KV_PER_MM * gap * Math.pow(Math.max(pSparkBar, ECU_COEFF.SPARK_MIN_BAR), ECU_COEFF.SPARK_PRESSURE_EXP);
  const kvAvailable = E.spark?.kvAvailable ?? ECU_COEFF.SPARK_DEFAULT_KV;
  // Breakdown is statistical: within a couple of kV of the coil's ceiling some events
  // make it across the gap and some do not.
  const sparkMiss = clamp((kvNeeded - kvAvailable) / ECU_COEFF.SPARK_SPREAD_KV + 0.5, 0, 1);
  // Flammability: a flame will not propagate through a mixture much leaner than about
  // lambda 1.6 or richer than about 0.45, and residual gas narrows the band — mostly
  // from the lean side, where there is already too little heat release to spare.
  const r = cyc.residualFrac;
  const leanLimit = ECU_COEFF.FLAME_LEAN_LIMIT - ECU_COEFF.FLAME_LEAN_PER_RESIDUAL * r;
  const richLimit = ECU_COEFF.FLAME_RICH_LIMIT + ECU_COEFF.FLAME_RICH_PER_RESIDUAL * r;
  const mixMiss = lambda > leanLimit ? clamp((lambda - leanLimit) / ECU_COEFF.FLAME_LEAN_SPREAD, 0, 1)
    : lambda < richLimit ? clamp((richLimit - lambda) / ECU_COEFF.FLAME_RICH_SPREAD, 0, 1) : 0;
  return {
    misfireFrac: clamp(1 - (1 - sparkMiss) * (1 - mixMiss), 0, 1),
    kvNeeded,
    kvAvailable,
  };
}
