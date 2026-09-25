/**
 * The engine management's decisions at one operating point.
 *
 * `resolveEcuPoint` is the ECU: it reads its sensors, looks up its tables at the load it
 * THINKS it is at, stacks every correction on top, and hands `evaluatePoint` the
 * commanded spark, commanded fuel and everything it believes along the way. It never
 * sees a true value it would not have a sensor for.
 *
 * `ecuSteadyPoint` is a settled operating point on the dyno: the boost controller, the
 * cam phasers and the knock controller have all had as long as they need, the trims have
 * converged, and any protection that would trip has tripped. It iterates, because a
 * protection changes the point that tripped it.
 *
 * Every correction lands in a breakdown — base value, each correction in the order the
 * ECU applies it, final value — so the UI can show a tuner exactly where a number came
 * from.
 */

import { BARO_KPA, DRIVETRAIN_EFF, KELVIN_OFFSET, PSI_TO_KPA } from '../constants.js';
import { trappedAirGrams } from '../cycle.js';
import { OCTANE_OPTS } from '../hardware.js';
import { clamp, interp2 } from '../math.js';
import { evaluatePoint } from '../point.js';
import { RPM } from '../tables.js';
import { chargeTempK, INDUCTION_REF_EXHAUST_K } from '../thermo.js';
import { solveInduction } from '../turbo.js';
import { boostTarget, steadyGate } from './boost.js';
import { DYNO_GEAR } from './calibration.js';
import { ECU_COEFF as E } from './ecuCoefficients.js';
import {
  COIL_OPTS, coilOutput, fuelRail, injectorDeadTimeMs, oilPressureKpa,
} from './ecuHardware.js';
import { read1, read2 } from './ecuTables.js';
import { blendFuel } from './fuelBlend.js';
import { knockDetection, knockThresholdAt } from './knockSensor.js';
import { nitrousDelivery, nitrousFraction } from './nitrousControl.js';
import { readSensor, widebandTrueFor } from './sensors.js';
import { camTargets, veAtPhase } from './vvt.js';

const NM_PER_LBFT = 1 / 0.7376;

/**
 * Everything physical the ECU is attached to, gathered once per pull.
 *
 * @typedef {object} EcuHardware
 * @property {object} fuel the fuel actually in the tank
 * @property {number} [ethanolPct] ethanol content of that fuel, for a flex sensor
 * @property {boolean} [flexTank] the tank holds a flex blend rather than one pump fuel
 * @property {{regulator: string, basePressureKpa: number, pumpIdx: number}} fuelSystem
 * @property {{map: string, wideband: string, iat: string, ect: string, flex: boolean}} sensorHw
 * @property {{type: string, springPsi: number}} gate
 * @property {string} vvt VVT hardware id
 * @property {string} coil coil id
 * @property {number} plugGapMm
 * @property {number} injectorCc
 * @property {number} ecuInjectorCc
 * @property {object} mods
 * @property {boolean} turboOn
 * @property {number[]} boostCurve
 * @property {object|null} turbine
 * @property {object} compressor
 * @property {object} derived
 * @property {number} mafScalar
 * @property {number} mafErrorBase
 * @property {number[][][]} veTruthByPhase hardware VE at each VE_PHASE_SAMPLES intake phase
 * @property {object} [cfg] the engine config, for the cylinder layout
 * @property {object|null} [blower] a supercharger (a BLOWER_OPTS entry), instead of a turbo
 * @property {number} [blowerRatio] crank pulley ÷ blower pulley
 * @property {{kit: 'wet'|'dry', shotHp: number, heater?: boolean, bottleLb?: number}|null} [nitrous]
 *   a nitrous kit
 */

/**
 * The conditions around the engine.
 * @typedef {object} EcuConditions
 * @property {{ambientK: number, baroKpa: number}} env
 * @property {number} ectC
 * @property {number} oilC
 * @property {number} volts
 * @property {number} gear
 * @property {Record<string, string>} [faults]
 * @property {number} [pumpHealth]
 * @property {number} [oilHealth]
 * @property {{armed: boolean, bottleK: number, setK?: number}} [nitrous] a nitrous kit's arming
 *   switch and the bottle's temperature, which sets its pressure
 */

/**
 * The fuel the ECU believes is in the tank.
 * @param {object} cal
 * @param {EcuHardware} hw
 * @param {number|null} sensedEthanol
 */
export function ecuFuelBelief(cal, hw, sensedEthanol) {
  if (cal.config.flexEnabled && hw.sensorHw?.flex && sensedEthanol != null) {
    return blendFuel(sensedEthanol);
  }
  if (cal.config.stoichMode === 'gasoline') return OCTANE_OPTS[1];
  if (cal.config.stoichMode === 'e85') return OCTANE_OPTS[3];
  // "Matches tank" means the ECU was calibrated for the fuel that goes in. A pump fuel is
  // one known fuel; a flex tank is whatever blend the last fills left, which only an
  // ethanol sensor can report — without one the ECU fuels it as the gasoline it was
  // calibrated on.
  if (hw.flexTank) return OCTANE_OPTS[1];
  return hw.fuel;
}

/**
 * How the cylinders of this engine share the manifold's air and heat.
 *
 * Runners do not flow identically: the charge's momentum piles up at the far end of a
 * plenum and the cylinders nearest the inlet are shadowed, a spread of a few percent.
 * The cylinders in the middle of a bank are surrounded by hot neighbours on both sides
 * and run a hotter chamber than the ends. Fixed by the architecture, not by the tune —
 * which is why per-cylinder trims exist.
 *
 * @param {{cyl: number}} derived
 * @param {string} [configuration]
 * @returns {{air: number, chamberK: number, bank: number}[]}
 */
export function cylinderDistribution(derived, configuration) {
  const n = derived.cyl;
  const banks = configuration?.startsWith('V') ? 2 : 1;
  const perBank = n / banks;
  const out = [];
  for (let i = 0; i < n; i++) {
    const bank = banks === 2 ? i % 2 : 0;
    const pos = banks === 2 ? Math.floor(i / 2) : i;
    const x = perBank > 1 ? (pos / (perBank - 1)) * 2 - 1 : 0;
    out.push({ x, bank });
  }
  const meanSq = out.reduce((s, c) => s + c.x * c.x, 0) / n;
  return out.map((c) => ({
    air: 1 + E.CYL_AIR_END_GAIN * (c.x * c.x - meanSq) - E.CYL_AIR_SKEW * c.x,
    chamberK: E.CYL_CHAMBER_MID_K * ((1 - c.x * c.x) - (1 - meanSq)),
    bank: c.bank,
  }));
}

/**
 * One operating point, as the ECU sees and commands it.
 *
 * @param {object} input
 * @param {object} input.cal the calibration
 * @param {EcuHardware} input.hw
 * @param {EcuConditions} input.cond
 * @param {{ve: number[][], timing: number[][], afr: number[][]}} input.tables
 * @param {number} input.rpm
 * @param {number} input.mapKpa true manifold pressure
 * @param {number} input.boostPsi
 * @param {number} input.veActual true filling here, percent
 * @param {{intakeAdvDeg: number, exhaustRetDeg: number}} input.cam actual cam positions
 * @param {number} [input.empKpa]
 * @param {object} [input.dyn] the live controllers' states and any protection overrides
 * @param {number} [input.cylIdx] which cylinder, when solving them separately
 * @param {ReturnType<typeof import('../blower.js').solveBlower>} [input.blower] a
 *   supercharger's state at this point: its efficiency sets the charge the IAT sensor reads
 * @returns {{input: object, sensed: object, breakdown: object}}
 */
export function resolveEcuPoint({
  cal, hw, cond, tables, rpm, mapKpa, boostPsi, veActual, cam, empKpa, dyn = {}, cylIdx, blower = null,
}) {
  const env = cond.env;
  const faults = /** @type {Record<string, any>} */ (cond.faults ?? {});
  const chargeK = chargeTempK(boostPsi, hw.mods.intercooler, env, blower && blower.boostPsi > 0 ? blower.eta : undefined);

  // ---- SENSORS. The ECU knows nothing it cannot measure.
  const mapPart = hw.sensorHw?.map ?? '3bar';
  const mapScale = cal.sensors.map === 'auto' ? mapPart : cal.sensors.map;
  const mapRead = dyn.sensedMapKpa != null
    ? { value: dyn.sensedMapKpa, fault: false }
    : readSensor({ kind: 'map', value: mapKpa, part: mapPart, scale: mapScale, fault: faults.map, fallback: env.baroKpa });
  const sMap = mapRead.value;
  const iatRead = dyn.sensedIatC != null
    ? { value: dyn.sensedIatC, fault: false }
    : readSensor({ kind: 'iat', value: chargeK - KELVIN_OFFSET, part: hw.sensorHw?.iat ?? 'bosch', scale: cal.sensors.iat, fault: faults.iat, fallback: 40 });
  const sIatC = iatRead.value;
  const ectRead = dyn.sensedEctC != null
    ? { value: dyn.sensedEctC, fault: false }
    : readSensor({ kind: 'ect', value: cond.ectC, part: hw.sensorHw?.ect ?? 'bosch', scale: cal.sensors.ect, fault: faults.ect, fallback: 90 });
  const sEctC = ectRead.value;
  const sEthanol = hw.sensorHw?.flex ? (hw.ethanolPct ?? 0) : null;
  const sensorFault = !!(mapRead.fault || iatRead.fault || ectRead.fault);

  // ---- WHAT THE ECU THINKS IS IN THE TANK.
  const ecuFuel = ecuFuelBelief(cal, hw, sEthanol);

  // ---- NITROUS: the dose the controller is passing, and what the kit brings with it.
  const ncal = cal.nitrous;
  const nFrac = hw.nitrous && ncal ? (dyn.nitrousFrac ?? 0) : 0;
  const nitrous = nFrac > 0
    ? nitrousDelivery({
      kit: hw.nitrous, frac: nFrac, bottleK: cond.nitrous?.bottleK ?? env.ambientK, mapKpa,
      baroKpa: env.baroKpa, fuel: hw.fuel, dryFuelPct: ncal.dryFuelPct, fuelTrimPct: ncal.fuelTrimPct ?? 0,
    })
    : null;

  // ---- BASE TABLES, read at the load the ECU believes.
  const veBase = interp2(tables.ve, rpm, sMap);
  const camVe = read2(cal.airflow.camVeCorr, rpm, cam.intakeAdvDeg);
  const veVal = veBase * (1 + camVe / 100);
  const timingBase = interp2(tables.timing, rpm, sMap);
  const afrBase = interp2(tables.afr, rpm, sMap);

  // ---- SPARK: base, then every correction in the order the ECU stacks them.
  const timingSteps = [{ label: 'Base table', value: timingBase }];
  let timing = timingBase;
  const addT = (label, deg) => {
    if (!deg) return;
    timing += deg;
    timingSteps.push({ label, value: timing, delta: deg });
  };
  addT('Intake temperature', read1(cal.ignition.iatCorr, sIatC));
  addT('Coolant temperature', read1(cal.ignition.ectCorr, sEctC));
  addT('Oil temperature', read1(cal.ignition.oilCorr, dyn.oilC ?? cond.oilC));
  addT('Barometric', read1(cal.ignition.baroCorr, env.baroKpa));
  if (cal.config.flexEnabled && sEthanol != null) {
    addT(`Ethanol (E${Math.round(sEthanol)})`, read2(cal.ignition.flexAdd, rpm, sMap) * Math.min(1, sEthanol / 85));
  }
  if (cylIdx != null) addT(`Cylinder ${cylIdx + 1} trim`, cal.ignition.cylTrim[cylIdx] ?? 0);
  if (cal.protect.iatEnabled && sIatC > cal.protect.iatLimitC) {
    addT('IAT protection', -(sIatC - cal.protect.iatLimitC) * cal.protect.iatRetardPerC);
  }
  addT('High-det map', dyn.highDet ? -cal.ignition.highDetRetard : 0);
  addT('Idle spark control', dyn.idleSparkDeg ?? 0);
  addT('Overrun retard', dyn.decel ? -cal.ignition.decelRetard : 0);
  addT('Limiter / torque retard', -(dyn.extraRetardDeg ?? 0));
  if (nitrous) addT('Nitrous retard', -ncal.retardDeg * nFrac);
  if (dyn.cranking) {
    timing = cal.ignition.crankingDeg;
    timingSteps.push({ label: 'Cranking timing (overrides)', value: timing });
  } else if (dyn.launch) {
    timing = cal.arc.launchTiming;
    timingSteps.push({ label: 'Launch control timing (overrides)', value: timing });
  }

  // ---- FUEL: target, then the multipliers.
  const stoichTarget = Math.abs(afrBase - 14.7) < 0.05;
  // Closed loop stands down while nitrous flows, as it does on a real controller: the
  // wideband is reading a mixture the base tune is not responsible for, and trimming to
  // it would learn the nitrous into the fuelling it goes back to when the spray stops.
  const closedLoopRegion = cal.fuel.closedLoop && sMap < cal.fuel.openLoopKpa && sEctC >= cal.fuel.clMinEctC
    && (!cal.fuel.clStoichOnly || stoichTarget) && !nitrous;
  let afrCmd = dyn.afrTarget ?? afrBase;
  const fuelSteps = [{ label: 'Target (AFR table)', value: afrBase / 14.7, unit: 'λ' }];
  if (dyn.afrTarget != null && Math.abs(dyn.afrTarget - afrBase) > 0.01) {
    fuelSteps.push({ label: 'Target lookup delay (still moving)', value: dyn.afrTarget / 14.7, unit: 'λ' });
  }
  const wbPart = hw.sensorHw?.wideband ?? 'lambda-0.5-1.5';
  if (dyn.steadyTrims && closedLoopRegion && wbPart !== cal.sensors.wideband) {
    // Settled closed loop holds the READING on target, not the mixture.
    afrCmd = widebandTrueFor(afrBase / 14.7, wbPart, cal.sensors.wideband) * 14.7;
    fuelSteps.push({ label: 'Closed loop on a mis-scaled wideband', value: afrCmd / 14.7, unit: 'λ' });
  }
  const mults = [];
  const addF = (label, pct) => { if (pct) mults.push({ label, pct }); };
  addF('Fuel compensation', read2(cal.fuel.comp, rpm, sMap) - 100);
  addF('Warm-up', read1(cal.fuel.warmup, sEctC));
  addF('After-start', dyn.afterStartPct ?? 0);
  addF('Cranking', dyn.crankingPct ?? 0);
  addF('Acceleration', dyn.aePct ?? 0);
  if (cylIdx != null) {
    addF(`Cylinder ${cylIdx + 1} trim`, cal.fuel.cylTrim[cylIdx] ?? 0);
    addF('Bank trim', cal.fuel.bankTrim[dyn.bank ?? 0] ?? 0);
  }
  addF('Component protection', dyn.extraFuelPct ?? 0);
  addF('Short-term trim', dyn.stftPct ?? 0);
  addF('Long-term trim', dyn.ltftPct ?? 0);
  const fuelMult = mults.reduce((m, s) => m * (1 + s.pct / 100), 1);
  mults.forEach((s) => fuelSteps.push({ label: s.label, value: s.pct, unit: '%' }));

  // ---- AIR MODEL.
  const sweptM3 = (hw.derived.displacementL / hw.derived.cyl) / 1000;
  const airG = trappedAirGrams({ veActual, mapKpa, chargeK, sweptM3 });
  const mafGps = (airG * hw.derived.cyl * (rpm / 2)) / 60;
  const mafTrim = read1(cal.airflow.mafTrim, mafGps * hw.mafErrorBase);
  const mafNetFactor = hw.mafErrorBase * hw.mafScalar * (1 + mafTrim / 100);

  // ---- INJECTORS AND RAIL.
  const volts = cond.volts;
  const stoich = ecuFuel.stoich;
  const fuelPerCycleG = (airG * fuelMult) / Math.max(0.3, (afrCmd / 14.7) * stoich);
  // The pump also feeds the nitrous kit: a wet kit's fuel jet, or a dry kit's fuel through
  // the injectors. A pump that cannot keep up sags the rail for both.
  const kitLph = nitrous ? ((nitrous.wetFuelKgS + Math.max(0, nitrous.injFuelKgS)) / hw.fuel.density) * 3600 : 0;
  const requiredLph = (fuelPerCycleG / hw.fuel.density) * hw.derived.cyl * (rpm / 120) * 3.6 + kitLph;
  const rail = fuelRail({
    fuelSystem: hw.fuelSystem, mapKpa, baroKpa: env.baroKpa, demandLph: requiredLph, volts,
    pumpHealth: cond.pumpHealth ?? 1,
  });
  let ecuDp = cal.injector.refPressureKpa;
  if (cal.injector.pressureComp === 'none') ecuDp = 300;
  else if (cal.injector.pressureComp === 'manifold') ecuDp = cal.injector.refPressureKpa + env.baroKpa - sMap;
  else if (cal.injector.pressureComp === 'sensor') {
    const fp = readSensor({ kind: 'fuelPressure', value: rail.railGaugeKpa, part: '100psi', scale: cal.sensors.fuelPressure, fault: faults.fuelPressure, fallback: 300 });
    ecuDp = fp.value + env.baroKpa - sMap;
  }
  const deadEcuMs = read1(cal.injector.deadTime, volts);
  const inj = {
    actualFlowScale: rail.flowScale,
    ecuFlowScale: Math.sqrt(Math.max(1, ecuDp) / 300),
    deadActualMs: injectorDeadTimeMs(volts, rail.deltaKpa),
    deadEcuMs,
    minPwMs: cal.injector.minEffPwMs > 0 ? cal.injector.minEffPwMs + deadEcuMs : 0,
    maxDutyFrac: cal.injector.maxDutyPct / 100,
    railDeltaKpa: rail.deltaKpa,
  };

  // ---- KNOCK CONTROL.
  const peakEst = E.PEAK_BAR_PER_KPA * mapKpa;
  const det = knockDetection({
    rpm, peakBar: peakEst, thresholdV: knockThresholdAt(cal.ignition.knockThreshold, rpm, hw.derived),
    derived: hw.derived, maxRetardDeg: cal.ignition.knockMaxRetard,
  });
  // Outside its window the knock controller is not listening at all.
  const knockListening = cal.ignition.knockEnabled && rpm >= cal.ignition.knockMinRpm && sMap >= cal.ignition.knockMinKpa;
  const knock = dyn.knockRetardDeg != null
    ? { enabled: knockListening, retardDeg: knockListening ? dyn.knockRetardDeg : 0, maxRetardDeg: cal.ignition.knockMaxRetard }
    : {
      enabled: knockListening,
      deadbandDeg: det.deadbandDeg,
      falseRetardDeg: det.falseRetardDeg,
      maxRetardDeg: cal.ignition.knockMaxRetard,
      stepDeg: cal.ignition.knockStep,
    };

  // ---- COIL.
  const coil = COIL_OPTS.find((c) => c.id === hw.coil) ?? COIL_OPTS[0];
  const dwell = read1(cal.ignition.dwell, volts);
  const co = coilOutput(dwell, volts, coil);

  const dist = cylIdx != null ? dyn.dist?.[cylIdx] : null;
  const ctx = {
    env,
    // Nitrous fuel through the injectors — a dry kit's, and the tuner's correction — on top
    // of what the ECU meters for the air, so it counts against their duty like any other
    // fuel. A speed-density ECU cannot see the air the nitrous vapour displaced, so on a
    // wet kit the correction is usually a reduction.
    ...(nitrous?.injFuelKgS ? { extraFuelG: (nitrous.injFuelKgS * 1000) / (hw.derived.cyl * (rpm / 2) / 60) } : {}),
    sensedMapKpa: sMap,
    sensedIatK: sIatC + KELVIN_OFFSET,
    airModel: cal.config.airModel,
    mafNetFactor,
    // Closed loop only where the ECU would actually be trimming; everywhere else it
    // runs open loop and the whole airflow error reaches the cylinder.
    openLoopKpa: cal.fuel.closedLoop && !nitrous && (!cal.fuel.clStoichOnly || stoichTarget) ? cal.fuel.openLoopKpa : -1,
    trimResidual: dyn.steadyTrims === false ? 1 : cal.fuel.trimResidual,
    trimLimitPct: cal.fuel.stftLimit + cal.fuel.ltftLimit,
    ecuFuel,
    fuelMult,
    cylinderFuelFactor: dyn.cylinderFuelFactor ?? 1,
    inj,
    knock,
    cam,
    chamberOffsetK: dist?.chamberK ?? 0,
    cutFrac: dyn.cutFrac ?? 0,
    cutType: dyn.cutType ?? 'fuel',
    spark: { kvAvailable: co.kv, gapMm: hw.plugGapMm ?? 1.0 },
  };

  return {
    input: {
      rpm, mapKpa, boostPsi,
      veVal, veActualVal: veActual * (dist?.air ?? 1),
      timingVal: timing, afrCommanded: afrCmd,
      fuel: hw.fuel, mods: { ...hw.mods, turboFitted: hw.turboOn },
      mafScalar: hw.mafScalar, mafErrorBase: hw.mafErrorBase,
      injectorCc: hw.injectorCc, ecuInjectorCc: hw.ecuInjectorCc,
      derived: hw.derived, compressor: hw.compressor,
      turbine: hw.turboOn ? hw.turbine : null,
      ...(empKpa != null ? { empKpa } : {}),
      ...(blower ? { blower } : {}),
      // A wet kit's fuel jet is an orifice on the same rail as the injectors, so it flows
      // with the pressure the pump holds.
      ...(nitrous ? { nitrous: { n2oKgS: nitrous.n2oKgS, fuelKgS: nitrous.wetFuelKgS * rail.flowScale, frac: nFrac, bottleK: cond.nitrous?.bottleK ?? env.ambientK, bottlePsi: nitrous.bottlePsi } } : {}),
      ecu: ctx,
    },
    sensed: {
      mapKpa: sMap, iatC: sIatC, ectC: sEctC, ethanol: sEthanol, fault: sensorFault,
      closedLoopRegion, dwell, coilMj: co.mj, rail, knockNoiseV: det.noiseV,
      knockDeadband: det.deadbandDeg, knockFalse: det.falseRetardDeg, ecuFuel, mafGps,
    },
    breakdown: { timing: timingSteps, fuel: fuelSteps, ve: [{ label: 'VE table', value: veBase }, ...(camVe ? [{ label: 'Cam-angle correction', value: veVal }] : [])] },
  };
}

/** Numeric fields a multi-cylinder result takes the worst of, rather than the mean. */
const WORST_MAX = new Set(['peakPressure', 'knockPull', 'knockUnheard', 'duty', 'pw', 'egtMax', 'misfire', 'sparkKvNeed']);
const WORST_MIN = new Set(['threshold', 'margin']);

/**
 * Combines per-cylinder results into the engine's.
 * @param {object[]} pts
 * @returns {object}
 */
export function combineCylinders(pts) {
  if (pts.length === 1) return pts[0];
  const out = {};
  for (const k of Object.keys(pts[0])) {
    const vals = pts.map((p) => p[k]);
    if (typeof vals[0] === 'boolean') out[k] = vals.some(Boolean);
    else if (typeof vals[0] === 'number') {
      if (WORST_MAX.has(k)) out[k] = Math.max(...vals);
      else if (WORST_MIN.has(k)) out[k] = Math.min(...vals);
      else {
        const m = vals.reduce((s, v) => s + v, 0) / vals.length;
        out[k] = Math.abs(m) >= 100 ? Math.round(m) : Number(m.toFixed(3));
      }
    } else out[k] = vals[0];
  }
  out.hp = Math.round(pts.reduce((s, p) => s + p.hp, 0) / pts.length);
  out.torque = Math.round(pts.reduce((s, p) => s + p.torque, 0) / pts.length);
  out.egtMax = Math.max(...pts.map((p) => p.egt));
  out.cyl = pts.map((p) => ({
    lambda: p.lambda, timing: p.timing, knockPull: p.knockPull, margin: p.margin,
    egt: p.egt, peakPressure: p.peakPressure, misfire: p.misfire ?? 0,
  }));
  return out;
}

/**
 * Evaluates the engine at one resolved condition — as the average cylinder, or cylinder
 * by cylinder when the calibration asks for it.
 *
 * @param {Parameters<typeof resolveEcuPoint>[0]} args
 * @returns {{pt: object, resolved: ReturnType<typeof resolveEcuPoint>}}
 */
export function evaluateEcu(args) {
  const { cal, hw } = args;
  if (!cal.config.cylinderModel) {
    const resolved = resolveEcuPoint(args);
    return { pt: evaluatePoint(/** @type {any} */ (resolved.input)), resolved };
  }
  const dist = cylinderDistribution(hw.derived, hw.cfg?.configuration);
  const solveAll = (dynExtra) => dist.map((d, i) => {
    const r = resolveEcuPoint({ ...args, cylIdx: i, dyn: { ...(args.dyn ?? {}), dist, bank: d.bank, ...dynExtra } });
    return { r, pt: evaluatePoint(/** @type {any} */ (r.input)) };
  });
  let cyls = solveAll({});
  // Global knock control can only retard every cylinder together, so the one that knocks
  // worst sets the retard for all of them.
  if (!cal.ignition.knockPerCylinder && args.dyn?.knockRetardDeg == null) {
    const worst = Math.max(...cyls.map((c) => c.pt.knockPull));
    if (worst > 0) cyls = solveAll({ knockRetardDeg: worst });
  }
  return { pt: combineCylinders(cyls.map((c) => c.pt)), resolved: cyls[0].r };
}

/**
 * A settled operating point with the whole engine management in the loop: boost
 * control, cam phasing, knock control, trims and protections.
 *
 * @param {object} input
 * @param {object} input.cal
 * @param {EcuHardware} input.hw
 * @param {EcuConditions} input.cond
 * @param {{ve: number[][], timing: number[][], afr: number[][]}} input.tables
 * @param {number} input.rpm
 * @param {number} input.loadKpa the dyno's throttle, as sea-level kPa
 * @returns {object} the datalog record, with ECU channels and the correction breakdown
 */
export function ecuSteadyPoint({ cal, hw, cond, tables, rpm, loadKpa }) {
  const throttleFrac = clamp(loadKpa / BARO_KPA, 0, 1);
  const throttlePct = throttleFrac * 100;
  const gear = cond.gear ?? DYNO_GEAR;
  const protect = new Set();
  const mod = { boostCutPsi: 0, extraFuelPct: 0, extraRetardDeg: 0, cutFrac: 0, cutType: 'fuel', loadScale: 1, highDet: false, nitrousFrac: 0 };

  // Nitrous: the controller's window and, on the dyno, its progressive ramp in RPM — the
  // pull sweeps at a known rate, so seconds since the window opened are RPM travelled.
  if (hw.nitrous && cond.nitrous?.armed && cal.nitrous) {
    const n = cal.nitrous;
    mod.nitrousFrac = nitrousFraction({
      ncal: n, rpm, throttlePct, ectC: cond.ectC, sinceOnS: (rpm - n.minRpm) / E.DYNO_SWEEP_RPM_PER_S,
    });
  }

  // Rev limiter: a soft window below the hard cut.
  const hardCut = (hw.derived.redline ?? 7500) + cal.limiter.offsetRpm;
  const soft = cal.limiter.softWindowRpm > 0 ? clamp((rpm - (hardCut - cal.limiter.softWindowRpm)) / cal.limiter.softWindowRpm, 0, 1) : 0;
  if (cal.limiter.throttleCutRpm > 0 && rpm > hardCut - cal.limiter.throttleCutRpm) {
    protect.add('limiter');
    mod.loadScale = clamp(1 - (rpm - (hardCut - cal.limiter.throttleCutRpm)) / cal.limiter.throttleCutRpm, E.THROTTLE_CUT_MIN, 1);
  }
  if (soft > 0) {
    protect.add('limiter');
    if (cal.limiter.mode === 'retard') mod.extraRetardDeg += E.LIMITER_RETARD_DEG * soft;
    else { mod.cutFrac = Math.max(mod.cutFrac, soft); mod.cutType = cal.limiter.mode === 'spark' ? 'spark' : 'fuel'; }
  }

  let last = null;
  for (let iter = 0; iter < 4; iter += 1) {
    const solved = solveOperatingPoint({ cal, hw, cond, rpm, loadKpa: loadKpa * mod.loadScale, throttlePct, gear, boostCutPsi: mod.boostCutPsi });
    const dyn = {
      steadyTrims: true, extraFuelPct: mod.extraFuelPct, extraRetardDeg: mod.extraRetardDeg,
      cutFrac: mod.cutFrac, cutType: mod.cutType, highDet: mod.highDet, nitrousFrac: mod.nitrousFrac,
    };
    const { pt, resolved } = evaluateEcu({
      cal, hw, cond, tables, rpm, mapKpa: solved.man.mapKpa, boostPsi: solved.man.boostPsi,
      veActual: solved.veActual, cam: solved.cam, empKpa: solved.man.empKpa, dyn,
      ...(solved.man.blower ? { blower: solved.man.blower } : {}),
    });
    last = { pt, resolved, solved };

    // ---- PROTECTIONS. Each acts on what the ECU can measure.
    let changed = false;
    const P = cal.protect;
    const wbPart = hw.sensorHw?.wideband ?? 'lambda-0.5-1.5';
    const sensedLambda = readSensor({ kind: 'wideband', value: pt.lambdaExhaust ?? pt.lambda, part: wbPart, scale: cal.sensors.wideband }).value;
    // A lean reading while spraying shuts the nitrous off before anything else acts: it is
    // the likeliest cause, and the one that melts pistons.
    if (mod.nitrousFrac > 0 && cal.nitrous.leanCutEnabled && sensedLambda > cal.nitrous.leanCutLambda) {
      protect.add('nitrous lean');
      mod.nitrousFrac = 0;
      changed = true;
    }
    if (hw.turboOn && cal.boost.overboostEnabled && pt.boostPsi > solved.target + cal.boost.overboostMarginPsi) {
      protect.add('overboost');
      if (cal.boost.overboostAction === 'fuel-cut') { if (mod.cutFrac < 1) { mod.cutFrac = 1; changed = true; } } else if (mod.boostCutPsi < E.BOOST_CUT_ALL_PSI) { mod.boostCutPsi = E.BOOST_CUT_ALL_PSI; changed = true; }
    }
    if (P.leanEnabled && sensedLambda > P.leanLambda && resolved.sensed.mapKpa > P.leanMinKpa && mod.cutFrac < 1) {
      protect.add('lean');
      changed = applyAction(P.leanAction, mod, P.boostCutPsi, hw.turboOn) || changed;
    }
    if (P.egtEnabled && pt.egt > P.egtLimitC) {
      const want = Math.min(P.egtEnrichMaxPct, mod.extraFuelPct + ((pt.egt - P.egtLimitC) / 10) * P.egtEnrichPctPer10C);
      if (want > mod.extraFuelPct + E.EGT_ENRICH_DEADBAND_PCT) { mod.extraFuelPct = want; changed = true; protect.add('egt'); }
    }
    // Heavy knock control drops the ECU onto its high-detonation map.
    if (!mod.highDet && cal.ignition.highDetRetard > 0 && pt.knockPull > cal.ignition.highDetTriggerDeg) {
      mod.highDet = true; changed = true; protect.add('highdet');
    }
    if (P.knockEnabled && hw.turboOn && pt.knockPull > P.knockRetardDeg && mod.boostCutPsi < E.BOOST_CUT_STACK_MAX_PSI) {
      mod.boostCutPsi += P.knockBoostCutPsi; changed = true; protect.add('knock');
    }
    if (P.dutyEnabled && hw.turboOn && pt.duty > P.dutyLimitPct && mod.boostCutPsi < E.BOOST_CUT_STACK_MAX_PSI) {
      mod.boostCutPsi += P.boostCutPsi; changed = true; protect.add('duty');
    }
    if (P.fuelPressEnabled && resolved.sensed.rail.deltaKpa < P.fuelMinDeltaKpa && mod.cutFrac < 1) {
      protect.add('fuelpressure');
      if (hw.turboOn && mod.boostCutPsi < E.BOOST_CUT_ALL_PSI) { mod.boostCutPsi = E.BOOST_CUT_ALL_PSI; changed = true; }
    }
    if (P.sensorLimp && resolved.sensed.fault && hw.turboOn && mod.boostCutPsi < E.BOOST_CUT_ALL_PSI) {
      protect.add('limp'); mod.boostCutPsi = E.BOOST_CUT_ALL_PSI; changed = true;
    }
    if (P.oilEnabled && oilPressureKpa(rpm, cond.oilC, cond.oilHealth ?? 1) < read1(P.oilMinKpa, rpm) && mod.cutFrac < 1) {
      protect.add('oil'); mod.cutFrac = 1; mod.cutType = 'fuel'; changed = true;
    }
    // ---- TORQUE LIMIT, reduced by the calibrated method until it fits.
    const limitNm = Math.min(read1(cal.torque.limitByGear, gear), read1(cal.torque.limitByRpm, rpm));
    const crankNm = pt.torque * NM_PER_LBFT / DRIVETRAIN_EFF;
    if (crankNm > limitNm + 2 && mod.cutFrac < 1) {
      protect.add('torque');
      last = limitTorque({ cal, hw, cond, tables, rpm, loadKpa, throttlePct, gear, mod, limitNm });
      break;
    }
    if (!changed) break;
  }

  const { pt, resolved, solved } = last;
  // Intake-temperature protection acts inside the spark resolve, not in the loop above,
  // so it is named here — a retard the player cannot see the reason for teaches nothing.
  if (cal.protect.iatEnabled && pt.sensedIat > cal.protect.iatLimitC) protect.add('iat');
  const oil = oilPressureKpa(rpm, cond.oilC, cond.oilHealth ?? 1);
  return {
    ...pt,
    boostTarget: Number(solved.target.toFixed(1)),
    wgDuty: Number(solved.gate.duty.toFixed(1)),
    wgDutyBase: Number(solved.gate.dutyBase.toFixed(1)),
    gateLimited: solved.gate.limited,
    boostSteps: solved.steps,
    railKpa: Number(resolved.sensed.rail.railGaugeKpa.toFixed(0)),
    pumpLph: Math.round(resolved.sensed.rail.pumpLph),
    fuelStarved: resolved.sensed.rail.starved,
    dwell: Number(resolved.sensed.dwell.toFixed(2)),
    knockNoise: Number(resolved.sensed.knockNoiseV.toFixed(3)),
    knockFalse: Number(resolved.sensed.knockFalse.toFixed(1)),
    oilKpa: Math.round(oil),
    sensedLambda: Number(readSensor({ kind: 'wideband', value: pt.lambdaExhaust ?? pt.lambda, part: hw.sensorHw?.wideband ?? 'lambda-0.5-1.5', scale: cal.sensors.wideband }).value.toFixed(3)),
    ecuStoich: Number(resolved.sensed.ecuFuel.stoich.toFixed(2)),
    torqueLimitNm: Math.round(Math.min(read1(cal.torque.limitByGear, gear), read1(cal.torque.limitByRpm, rpm))),
    protect: [...protect],
    breakdown: { ...resolved.breakdown, boost: solved.steps },
  };
}

/**
 * @param {string} action
 * @param {object} mod
 * @param {number} cutPsi
 * @param {boolean} turboOn
 * @returns {boolean} whether anything changed
 */
function applyAction(action, mod, cutPsi, turboOn) {
  if (action === 'fuel-cut') { if (mod.cutFrac >= 1) return false; mod.cutFrac = 1; mod.cutType = 'fuel'; return true; }
  if (action === 'torque') {
    if (mod.loadScale <= E.PROTECT_THROTTLE_MIN) return false;
    mod.loadScale *= E.PROTECT_THROTTLE_STEP;
    return true;
  }
  if (!turboOn || mod.boostCutPsi >= E.BOOST_CUT_STACK_MAX_PSI) return false;
  mod.boostCutPsi += cutPsi;
  return true;
}

/**
 * Boost target, gate ceiling, induction solve and cam position for one settled point.
 *
 * @param {object} input
 * @returns {{man: ReturnType<typeof solveInduction>, target: number, gate: ReturnType<typeof steadyGate>,
 *   steps: {label: string, value: number}[], cam: {intakeAdvDeg: number, exhaustRetDeg: number}, veActual: number}}
 */
export function solveOperatingPoint({ cal, hw, cond, rpm, loadKpa, throttlePct, gear, boostCutPsi = 0 }) {
  const { env } = cond;
  const throttleFrac = clamp(loadKpa / BARO_KPA, 0, 1);
  // The target is decided before the turbo has answered, on the IAT the ECU reads now.
  const iatGuessC = chargeTempK(hw.turboOn ? Math.max(...hw.boostCurve) * E.IAT_GUESS_BOOST_SHARE : 0, hw.mods.intercooler, env) - KELVIN_OFFSET;
  const bt = hw.turboOn
    ? boostTarget({ cal: cal.boost, baseCurve: hw.boostCurve, rpmAxis: RPM, rpm, throttlePct, gear, iatC: iatGuessC })
    : { target: 0, steps: [] };
  let target = bt.target;
  const steps = [...bt.steps];
  if (boostCutPsi > 0 && hw.turboOn) {
    target = Math.max(0, target - boostCutPsi);
    steps.push({ label: 'Protection boost cut', value: target });
  }
  const gate = steadyGate({ cal: cal.boost, gate: hw.gate, rpm, target, throttleFrac });
  if (hw.turboOn) steps.push({ label: gate.limited === 'spring' ? 'Gate ceiling (spring floor)' : gate.limited === 'duty' ? 'Gate ceiling (duty maxed)' : 'Gate ceiling', value: gate.ceiling });

  // Cams: targets depend on the load the ECU reads, which depends on the cams. Two passes.
  let cam = camTargets({ cal: cal.vvt, vvt: hw.vvt, rpm, mapKpa: Math.min(loadKpa, BARO_KPA) + target * PSI_TO_KPA });
  let man = null;
  for (let pass = 0; pass < 2; pass += 1) {
    const camNow = cam;
    man = solveInduction({
      rpm, loadKpa, turboOn: hw.turboOn, boostTargetPsi: gate.ceiling, targetIsFinal: true,
      turbine: hw.turbine, compressor: hw.compressor,
      veAt: (m) => veAtPhase(hw.veTruthByPhase, rpm, m, camNow.intakeAdvDeg),
      derived: hw.derived,
      intakeKAt: (b) => chargeTempK(b, hw.mods.intercooler, env),
      lambda: 1, exhaustK: INDUCTION_REF_EXHAUST_K, baroKpa: env.baroKpa,
      ...(hw.blower ? { blower: hw.blower, blowerRatio: hw.blowerRatio, intakeKAtEff: (b, eta) => chargeTempK(b, hw.mods.intercooler, env, eta) } : {}),
    });
    const next = camTargets({ cal: cal.vvt, vvt: hw.vvt, rpm, mapKpa: man.mapKpa });
    if (Math.abs(next.intakeAdvDeg - cam.intakeAdvDeg) < 0.5 && Math.abs(next.exhaustRetDeg - cam.exhaustRetDeg) < 0.5) break;
    cam = next;
  }
  if (hw.turboOn) steps.push({ label: 'Achieved', value: man.boostPsi });
  const veActual = veAtPhase(hw.veTruthByPhase, rpm, man.mapKpa, cam.intakeAdvDeg);
  return { man, target, gate, steps, cam, veActual };
}

/**
 * Brings crank torque down to a limit with the calibrated actuator, by bisection on
 * that actuator. The torque comes out of the same physics as every other point: pull
 * spark and the burn phases late, so torque falls AND the exhaust runs hotter; close the
 * throttle and there is less air; cut boost and there is less air and less heat; cut
 * cylinders and some events simply do not fire.
 *
 * @param {object} input
 * @returns {{pt: object, resolved: object, solved: object}}
 */
function limitTorque({ cal, hw, cond, tables, rpm, loadKpa, throttlePct, gear, mod, limitNm }) {
  const method = cal.torque.method;
  const run = (m) => {
    const solved = solveOperatingPoint({ cal, hw, cond, rpm, loadKpa: loadKpa * m.loadScale, throttlePct, gear, boostCutPsi: m.boostCutPsi });
    const { pt, resolved } = evaluateEcu({
      cal, hw, cond, tables, rpm, mapKpa: solved.man.mapKpa, boostPsi: solved.man.boostPsi,
      veActual: solved.veActual, cam: solved.cam, empKpa: solved.man.empKpa,
      dyn: { steadyTrims: true, extraFuelPct: m.extraFuelPct, extraRetardDeg: m.extraRetardDeg, cutFrac: m.cutFrac, cutType: m.cutType, highDet: m.highDet },
      ...(solved.man.blower ? { blower: solved.man.blower } : {}),
    });
    return { pt, resolved, solved };
  };
  const nm = (r) => r.pt.torque * NM_PER_LBFT / DRIVETRAIN_EFF;
  if (method === 'fuel') {
    const base = run(mod);
    const n = hw.derived.cyl;
    const keep = Math.floor((limitNm / Math.max(1, nm(base))) * n) / n;
    return run({ ...mod, cutFrac: clamp(1 - keep, 0, 1), cutType: 'fuel' });
  }
  const knob = method === 'throttle' ? 'loadScale' : method === 'boost' ? 'boostCutPsi' : 'extraRetardDeg';
  let lo = method === 'throttle' ? E.THROTTLE_CUT_MIN : mod[knob];
  let hi = method === 'throttle' ? mod.loadScale : method === 'boost' ? mod.boostCutPsi + 40 : mod.extraRetardDeg + 35;
  let best = null;
  for (let i = 0; i < 10; i += 1) {
    const mid = (lo + hi) / 2;
    const r = run({ ...mod, [knob]: mid });
    const over = nm(r) > limitNm;
    if (method === 'throttle') { if (over) hi = mid; else { lo = mid; best = r; } } else if (over) lo = mid; else { hi = mid; best = r; }
  }
  return best ?? run({ ...mod, [knob]: method === 'throttle' ? lo : hi });
}
