/**
 * The engine management calibration: everything a professional ECU lets a tuner set
 * beyond the three base tables, with the defaults a sensible factory would ship.
 *
 * DEFAULTS ARE THE ORIGINAL MODEL. Every correction table starts at zero, every
 * strategy starts where the app's physics always implicitly had it (idle at 800 RPM,
 * warm-up enrichment at 0.4% per degree below 80 °C, a fuel-cut rev limiter 100 RPM past
 * redline, trims that leave a quarter of an error behind, a knock controller that finds
 * the limit) and every sensor's scaling matches the part fitted. Run the default
 * calibration and the engine does what it did before the ECU layer existed — unless a
 * protection genuinely has something to protect, which is the point of having one.
 *
 * `ECU_META` describes every field for the editor: what it is, its units, its axes, its
 * range, and a line on what it physically does. The UI is generated from it, so a field
 * without an entry there cannot be edited, and one with an entry cannot be edited
 * outside its range.
 */

import { COEFF } from '../coefficients.js';
import { LOAD, RPM } from '../tables.js';
import { dutyForHold } from './boost.js';
import { injectorDeadTimeMs } from './ecuHardware.js';
import { curve, map2 } from './ecuTables.js';
import { factoryKnockThresholdV } from './knockSensor.js';

/** Calibration format version, for saved calibrations. */
export const ECU_CAL_VERSION = 1;

export const ECT_AXIS = [-20, 0, 20, 40, 60, 80, 100, 120];
export const IAT_AXIS = [-10, 10, 30, 50, 70, 90];
export const VOLT_AXIS = [8, 9, 10, 11, 12, 13, 13.5, 14, 15, 16];
export const BARO_AXIS = [70, 80, 90, 100, 105];
export const PCT_AXIS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export const GEAR_AXIS = [1, 2, 3, 4, 5, 6];
/** Manifold pressure, ascending, for tables that own their axes. */
export const MAP_AXIS = [...LOAD].reverse();
export const BOOST_AXIS = [0, 4, 8, 12, 16, 20, 25, 30];
export const CAM_AXIS = [0, 10, 20, 30, 40, 50];
export const MAF_AXIS = [2, 5, 10, 20, 40, 80, 160, 320];
export const TPS_RATE_AXIS = [0, 50, 100, 200, 400, 800];
export const OIL_AXIS = [0, 40, 80, 100, 120, 140];

/** The gear a dyno pull is run in — 1:1 on a typical box, the conventional choice. */
export const DYNO_GEAR = 4;

/**
 * @typedef {ReturnType<typeof defaultEcuCalibration>} EcuCalibration
 */

/**
 * A factory calibration for the engine as built.
 *
 * Only two things are fitted to the hardware, both the way a factory does it: the
 * knock threshold is set just above THIS engine's valvetrain noise, and the open-loop
 * boost duty table is filled with the duty that holds each target on THIS wastegate.
 * Everything else is generic.
 *
 * @param {object} [input]
 * @param {{cyl?: number, springRate?: number, camDuration?: number}} [input.derived]
 * @param {{type: string, springPsi: number}} [input.gate]
 * @returns {object}
 */
export function defaultEcuCalibration({ derived = {}, gate = { type: 'electronic', springPsi: 7 } } = {}) {
  const cyl = derived.cyl ?? 6;
  return {
    version: ECU_CAL_VERSION,
    config: {
      airModel: 'blend',
      cylinderModel: false,
      stoichMode: 'auto',
      flexEnabled: false,
    },
    fuel: {
      closedLoop: true,
      openLoopKpa: 85,
      clMinEctC: 45,
      stftLimit: COEFF.TRIM_LIMIT,
      ltftLimit: COEFF.TRIM_LIMIT,
      stftGain: COEFF.STFT_GAIN,
      ltftRate: COEFF.LTFT_LEARN_RATE,
      trimResidual: 0.25,
      warmup: curve(ECT_AXIS, (t) => Math.max(0, (80 - t) * 0.4)),
      afterStart: curve(ECT_AXIS, (t) => Math.max(3, 15 - t * 0.15)),
      afterStartDecayS: 8,
      cranking: curve(ECT_AXIS, (t) => Math.max(30, 150 - t * 1.8)),
      accel: curve(TPS_RATE_AXIS, (r) => Math.min(16, r * 0.022)),
      accelColdMult: curve(ECT_AXIS, (t) => Math.max(1, 2.0 - t * 0.0125)),
      accelDecayS: 0.35,
      decelEnlean: 0.6,
      dfcoEnabled: true,
      dfcoEnterRpm: 1850,
      dfcoExitRpm: 1600,
      dfcoMinEctC: 45,
      cylTrim: Array.from({ length: cyl }, () => 0),
      bankTrim: [0, 0],
      comp: map2(RPM, MAP_AXIS, () => 100),
      targetDelayS: 0,
      clStoichOnly: false,
    },
    injector: {
      deadTime: curve(VOLT_AXIS, (v) => injectorDeadTimeMs(v)),
      minEffPwMs: 0,
      pressureComp: 'none',
      refPressureKpa: 300,
      maxDutyPct: 90,
    },
    ignition: {
      iatCorr: curve(IAT_AXIS, () => 0),
      ectCorr: curve(ECT_AXIS, () => 0),
      baroCorr: curve(BARO_AXIS, () => 0),
      flexAdd: map2(RPM, MAP_AXIS, () => 0),
      cylTrim: Array.from({ length: cyl }, () => 0),
      crankingDeg: 8,
      decelRetard: 0,
      dwell: curve(VOLT_AXIS, (v) => Math.min(5.5, 3.0 * Math.pow(14 / v, 1.2))),
      knockEnabled: true,
      knockMaxRetard: COEFF.MAX_KNOCK_RETARD,
      knockStep: 2,
      knockRecoveryDegS: 1.5,
      knockRecoveryDelayS: 0.8,
      knockPerCylinder: true,
      knockThreshold: curve(RPM, (r) => factoryKnockThresholdV(r, derived)),
      knockMinRpm: 0,
      knockMinKpa: 0,
      oilCorr: curve(OIL_AXIS, () => 0),
      highDetTriggerDeg: 6,
      highDetRetard: 0,
    },
    airflow: {
      mafTrim: curve(MAF_AXIS, () => 0),
      camVeCorr: map2(RPM, CAM_AXIS, () => 0),
      pedalMap: curve(PCT_AXIS, (p) => p),
      etbRatePctS: 600,
    },
    boost: {
      mode: 'closed',
      throttleScale: curve(PCT_AXIS, (p) => (p * p) / 100),
      gearLimit: curve(GEAR_AXIS, () => 40),
      iatComp: curve(IAT_AXIS, () => 0),
      baseDuty: map2(RPM, BOOST_AXIS, (_, psi) => dutyForHold(gate, psi).duty),
      kp: 3,
      ki: 5,
      iWindowPsi: 4,
      maxDuty: 95,
      rampPsiS: 40,
      overboostEnabled: true,
      overboostMarginPsi: 4,
      overboostAction: 'boost-cut',
      overboostDelayS: 0.25,
    },
    vvt: {
      intakeTarget: map2(RPM, MAP_AXIS, () => 0),
      exhaustTarget: map2(RPM, MAP_AXIS, () => 0),
      rateDegS: 150,
      gain: 6,
      minOilC: 20,
    },
    idle: {
      target: curve(ECT_AXIS, () => 800),
      baseAir: curve(ECT_AXIS, (t) => Math.max(10, 13 - t * 0.06)),
      startHoldS: 0.8,
      gainUp: 0.003,
      gainDown: 0.001,
      damp: 0.04,
      bleed: COEFF.IDLE_BLEED_RATE,
      sparkGain: COEFF.IDLE_SPARK_GAIN,
      sparkLimit: COEFF.IDLE_SPARK_LIMIT,
      acRpmAdd: 50,
      acAirAdd: 2.5,
      elecAirAdd: 1.2,
      antiStallRpm: 200,
      antiStallAir: 2,
      tpsIdlePct: 3,
    },
    limiter: {
      mode: 'fuel',
      offsetRpm: 100,
      softWindowRpm: 0,
      restoreBandRpm: COEFF.LIMITER_RESTORE_BAND_RPM,
      throttleCutRpm: 0,
      coldLimitRpm: 0,
      coldBelowC: 60,
      speedLimitKph: 0,
    },
    arc: {
      launchEnabled: false,
      launchRpm: 4500,
      launchRestoreRpm: 4300,
      launchTiming: -6,
      ffsEnabled: false,
    },
    protect: {
      leanEnabled: true,
      leanLambda: 1.02,
      leanMinKpa: 110,
      leanAction: 'boost-cut',
      egtEnabled: true,
      egtLimitC: 950,
      egtEnrichPctPer10C: 3,
      egtEnrichMaxPct: 15,
      knockEnabled: true,
      knockRetardDeg: 8,
      knockBoostCutPsi: 3,
      iatEnabled: true,
      iatLimitC: 70,
      iatRetardPerC: 0.3,
      ectEnabled: true,
      ectLimitC: 112,
      oilEnabled: true,
      oilMinKpa: curve([800, 2000, 4000, 6000, 8000], (r) => 30 + r * 0.02),
      fuelPressEnabled: true,
      fuelMinDeltaKpa: 180,
      dutyEnabled: true,
      dutyLimitPct: 92,
      sensorLimp: true,
      limpRpm: 3500,
      limpThrottlePct: 40,
      boostCutPsi: 5,
      fanOnC: 95,
    },
    sensors: {
      map: 'auto',
      wideband: 'lambda-0.5-1.5',
      iat: 'bosch',
      ect: 'bosch',
      fuelPressure: '100psi',
      oilPressure: '100psi',
      egt: 'k-1250',
      tpsClosedV: 0.62,
      tpsOpenV: 4.38,
      mapFilterS: 0.03,
      tpsFilterS: 0.0,
      iatFilterS: 2.5,
      widebandFilterS: 0.12,
    },
    torque: {
      limitByGear: curve(GEAR_AXIS, () => 2000),
      limitByRpm: curve(RPM, () => 2000),
      method: 'spark',
      tcEnabled: false,
      tcSlipPct: 12,
      tcGain: 2.5,
      tcMethod: 'spark',
    },
  };
}

/**
 * @typedef {object} EcuFieldMeta
 * @property {string} path dotted path into the calibration
 * @property {string} section which TUNE view it lives on
 * @property {string} group heading within that view
 * @property {string} label
 * @property {'curve'|'map'|'number'|'enum'|'bool'|'cyl'} kind
 * @property {string} [unit]
 * @property {string} [xLabel]
 * @property {string} [yLabel]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {number} [decimals]
 * @property {{id: string, label: string}[]} [options]
 * @property {string} help what it physically does — never a promise of power
 * @property {boolean} [pro] an advanced setting, collapsed until asked for
 */

const onOff = [{ id: 'true', label: 'On' }, { id: 'false', label: 'Off' }];
const actions = [
  { id: 'boost-cut', label: 'Cut boost' },
  { id: 'fuel-cut', label: 'Cut fuel' },
  { id: 'torque', label: 'Limit torque' },
];

/** @type {EcuFieldMeta[]} */
export const ECU_META = [
  // ---- FUEL ----
  { path: 'config.stoichMode', section: 'fuel', group: 'Fuel type', label: 'Fuel the ECU assumes', kind: 'enum',
    options: [{ id: 'auto', label: 'Matches tank' }, { id: 'gasoline', label: 'Gasoline 14.7' }, { id: 'e85', label: 'E85 9.8' }],
    help: 'Fuel mass comes from air mass and the stoichiometric ratio the ECU believes. Tell it gasoline with E85 in the tank and it injects about 30% less fuel than the engine needs: a λ 0.86 target comes out near 1.22, far too lean to make power or survive boost.' },
  { path: 'config.flexEnabled', section: 'fuel', group: 'Fuel type', label: 'Use ethanol sensor', kind: 'bool', options: onOff,
    help: 'With a flex sensor fitted, the ECU reads ethanol content and computes fuel from the blend it measures. Without it, a tank that drifts from the assumed fuel runs off target.' },
  { path: 'fuel.closedLoop', section: 'fuel', group: 'Closed loop', label: 'Closed-loop fuelling', kind: 'bool', options: onOff,
    help: 'Below the open-loop threshold the ECU trims fuel from the wideband so the mixture holds target. Off, every airflow error reaches the cylinder.' },
  { path: 'fuel.openLoopKpa', section: 'fuel', group: 'Closed loop', label: 'Open-loop above', kind: 'number', unit: 'kPa', min: 60, max: 110, step: 1,
    help: 'Above this manifold pressure the ECU stops trimming and fuels from the tables alone, so the AFR table can command power enrichment.' },
  { path: 'fuel.stftLimit', section: 'fuel', group: 'Closed loop', label: 'Short-term trim limit', kind: 'number', unit: '%', min: 0, max: 40, step: 1, pro: true,
    help: 'The most the fast trim may correct. An error bigger than the trims can reach is left in the mixture.' },
  { path: 'fuel.ltftLimit', section: 'fuel', group: 'Closed loop', label: 'Long-term trim limit', kind: 'number', unit: '%', min: 0, max: 40, step: 1, pro: true,
    help: 'The most the learned trim may correct.' },
  { path: 'fuel.stftGain', section: 'fuel', group: 'Closed loop', label: 'Short-term trim gain', kind: 'number', min: 0, max: 150, step: 1, pro: true,
    help: 'How hard the trim reacts to a lambda error. Too high and the mixture oscillates around target instead of settling on it.' },
  { path: 'fuel.ltftRate', section: 'fuel', group: 'Closed loop', label: 'Long-term learn rate', kind: 'number', min: 0, max: 0.05, step: 0.001, decimals: 3, pro: true,
    help: 'How fast the short-term trim is learned into the long-term one.' },
  { path: 'fuel.clMinEctC', section: 'fuel', group: 'Closed loop', label: 'Closed loop from', kind: 'number', unit: '°C', min: 0, max: 90, step: 1, pro: true,
    help: 'Coolant temperature below which the ECU stays open loop — a cold engine needs enrichment the trims would fight.' },
  { path: 'fuel.warmup', section: 'fuel', group: 'Enrichment', label: 'Warm-up enrichment', kind: 'curve', unit: '%', xLabel: 'Coolant °C', min: 0, max: 100, step: 1,
    help: 'Extra fuel while the engine is cold. Fuel condenses on cold port walls and only the vapour burns, so a cold engine needs more injected to get the same mixture in the cylinder.' },
  { path: 'fuel.afterStart', section: 'fuel', group: 'Enrichment', label: 'After-start enrichment', kind: 'curve', unit: '%', xLabel: 'Coolant °C', min: 0, max: 100, step: 1,
    help: 'Extra fuel right after the engine catches, decaying away. It keeps the first seconds from stumbling while the port walls wet up.' },
  { path: 'fuel.afterStartDecayS', section: 'fuel', group: 'Enrichment', label: 'After-start decay', kind: 'number', unit: 's', min: 0.5, max: 60, step: 0.5, pro: true,
    help: 'How long the after-start enrichment takes to fade.' },
  { path: 'fuel.cranking', section: 'fuel', group: 'Enrichment', label: 'Cranking fuel', kind: 'curve', unit: '%', xLabel: 'Coolant °C', min: 0, max: 400, step: 5,
    help: 'Fuel on top of the base calculation while cranking. Too little and nothing lights; too much and the plugs wet and it floods.' },
  { path: 'fuel.accel', section: 'fuel', group: 'Transient', label: 'Acceleration enrichment', kind: 'curve', unit: '%', xLabel: 'Throttle rate %/s', min: 0, max: 80, step: 1,
    help: 'Fuel added when the throttle opens fast. A sudden rise in manifold pressure deposits fuel on the port walls instead of in the cylinder, so without this a tip-in goes lean and stumbles.' },
  { path: 'fuel.accelColdMult', section: 'fuel', group: 'Transient', label: 'Accel enrichment, cold multiplier', kind: 'curve', unit: '×', xLabel: 'Coolant °C', min: 0.5, max: 4, step: 0.1, decimals: 1, pro: true,
    help: 'Cold walls hold more fuel and release it slower, so a cold tip-in needs more.' },
  { path: 'fuel.accelDecayS', section: 'fuel', group: 'Transient', label: 'Accel enrichment decay', kind: 'number', unit: 's', min: 0.05, max: 2, step: 0.05, decimals: 2, pro: true,
    help: 'How long the added fuel lasts. It should match how long the wall film takes to build.' },
  { path: 'fuel.decelEnlean', section: 'fuel', group: 'Transient', label: 'Decel enleanment', kind: 'number', unit: '×', min: 0, max: 2, step: 0.05, decimals: 2, pro: true,
    help: 'Fuel removed when the throttle closes, as a share of what the same rate would add on opening. The wall film gives its fuel back as the manifold empties, so without this a lift goes rich.' },
  { path: 'fuel.dfcoEnabled', section: 'fuel', group: 'Transient', label: 'Overrun fuel cut', kind: 'bool', options: onOff,
    help: 'Closed throttle above idle, the injectors switch off entirely: engine braking, no fuel burned.' },
  { path: 'fuel.dfcoEnterRpm', section: 'fuel', group: 'Transient', label: 'Fuel cut above', kind: 'number', unit: 'RPM', min: 1000, max: 4000, step: 50, pro: true,
    help: 'Engine speed above which a closed throttle cuts fuel.' },
  { path: 'fuel.dfcoExitRpm', section: 'fuel', group: 'Transient', label: 'Fuel back on below', kind: 'number', unit: 'RPM', min: 900, max: 3500, step: 50, pro: true,
    help: 'Fuel returns below this, early enough that the engine catches before idle.' },
  { path: 'fuel.comp', section: 'fuel', group: 'Fuel compensation', label: 'Fuel compensation', kind: 'map', unit: '%', xLabel: 'RPM', yLabel: 'MAP kPa', min: 50, max: 150, step: 0.5, decimals: 1,
    help: 'Fine correction on the final pulse, by speed and load — 100 is the calculated fuel, above adds, below removes. Nissan ECUs tune the last few percent here after the airflow model is right; it is a correction on top of the model, not a replacement for it.' },
  { path: 'fuel.targetDelayS', section: 'fuel', group: 'Fuel compensation', label: 'Target lookup delay', kind: 'number', unit: 's', min: 0, max: 2, step: 0.05, decimals: 2,
    help: 'How long the ECU takes to move to a richer AFR target when the throttle snaps open. Some factory calibrations smooth it; under boost that leaves the first moments of a pull lean, which is exactly when knock starts. Tuners set it to zero.' },
  { path: 'fuel.clStoichOnly', section: 'fuel', group: 'Closed loop', label: 'Closed loop only at 14.7', kind: 'bool', options: onOff, pro: true,
    help: 'Nissan-style: the ECU trims only where the AFR target is stoichiometric, and runs open loop anywhere the table asks for anything else.' },
  { path: 'fuel.cylTrim', section: 'fuel', group: 'Per cylinder', label: 'Cylinder fuel trim', kind: 'cyl', unit: '%', min: -20, max: 20, step: 0.5, decimals: 1,
    help: 'Fuel added or removed on one cylinder. Only meaningful with cylinder modelling on (AIRFLOW page): intake manifolds do not share air evenly, and a trim is how each cylinder is brought to the same mixture.' },
  { path: 'fuel.bankTrim', section: 'fuel', group: 'Per cylinder', label: 'Bank fuel trim', kind: 'cyl', unit: '%', min: -20, max: 20, step: 0.5, decimals: 1, pro: true,
    help: 'Fuel added to a whole bank of a V engine, on top of the cylinder trims.' },

  // ---- INJECTORS ----
  { path: 'injector.deadTime', section: 'injectors', group: 'Injector data', label: 'Dead time', kind: 'curve', unit: 'ms', xLabel: 'Battery V', min: 0, max: 4, step: 0.02, decimals: 2,
    help: 'The delay between the ECU opening an injector and fuel flowing, while the coil builds enough force to lift the needle. It grows as voltage falls. Get it wrong and every pulse is off by the error — worst at idle and cranking, where pulses are short.' },
  { path: 'injector.minEffPwMs', section: 'injectors', group: 'Injector data', label: 'Minimum effective pulse', kind: 'number', unit: 'ms', min: 0, max: 1, step: 0.05, decimals: 2,
    help: 'The shortest opening the ECU will command. Below about 0.35 ms an injector is ballistic — the needle never fully lifts and delivers less than its rating predicts.' },
  { path: 'injector.pressureComp', section: 'injectors', group: 'Fuel pressure', label: 'Pressure compensation', kind: 'enum',
    options: [{ id: 'none', label: 'None (assumes constant)' }, { id: 'manifold', label: 'Fixed rail, MAP-referenced' }, { id: 'sensor', label: 'Rail pressure sensor' }],
    help: 'An injector flows as the square root of the pressure across it. A return-style regulator keeps that constant; a returnless rail does not, and under boost the injectors flow less unless the ECU compensates.' },
  { path: 'injector.refPressureKpa', section: 'injectors', group: 'Fuel pressure', label: 'Assumed rail pressure', kind: 'number', unit: 'kPa', min: 200, max: 600, step: 5, pro: true,
    help: 'The rail pressure the ECU assumes when compensating for a fixed rail.' },
  { path: 'injector.maxDutyPct', section: 'injectors', group: 'Fuel pressure', label: 'Maximum duty', kind: 'number', unit: '%', min: 50, max: 100, step: 1,
    help: 'The longest pulse the ECU will command as a share of the cycle. Past about 90% an injector never fully closes between events and stops metering.' },

  // ---- SPARK ----
  { path: 'ignition.iatCorr', section: 'spark', group: 'Corrections', label: 'Intake temperature', kind: 'curve', unit: '°', xLabel: 'IAT °C', min: -15, max: 10, step: 0.5, decimals: 1,
    help: 'Advance added or removed by charge temperature. Hot air starts compression hotter, so the end gas autoignites sooner — retard here protects a heat-soaked engine.' },
  { path: 'ignition.ectCorr', section: 'spark', group: 'Corrections', label: 'Coolant temperature', kind: 'curve', unit: '°', xLabel: 'Coolant °C', min: -15, max: 15, step: 0.5, decimals: 1,
    help: 'A cold chamber takes more advance: the burn is slower and there is no knock to find. A hot one takes less.' },
  { path: 'ignition.baroCorr', section: 'spark', group: 'Corrections', label: 'Barometric pressure', kind: 'curve', unit: '°', xLabel: 'Baro kPa', min: -10, max: 10, step: 0.5, decimals: 1,
    help: 'At altitude the same manifold pressure comes with less exhaust backpressure and a different charge — some ECUs adjust spark for it.' },
  { path: 'ignition.flexAdd', section: 'spark', group: 'Corrections', label: 'Ethanol advance (at E85)', kind: 'map', unit: '°', xLabel: 'RPM', yLabel: 'MAP kPa', min: 0, max: 15, step: 0.5, decimals: 1,
    help: 'Extra advance at E85, blended in by measured ethanol content. Ethanol resists knock, so the knock limit moves; whether advance there makes torque depends on MBT.' },
  { path: 'ignition.cylTrim', section: 'spark', group: 'Corrections', label: 'Cylinder timing trim', kind: 'cyl', unit: '°', min: -8, max: 4, step: 0.5, decimals: 1,
    help: 'Timing added or removed on one cylinder — how a hot or lean cylinder is kept out of knock without pulling timing from the rest. Needs cylinder modelling on.' },
  { path: 'ignition.oilCorr', section: 'spark', group: 'Corrections', label: 'Oil temperature', kind: 'curve', unit: '°', xLabel: 'Oil °C', min: -10, max: 10, step: 0.5, decimals: 1,
    help: 'Advance by oil temperature — a proxy for how hot the pistons are. Hot pistons heat the end gas.' },
  { path: 'ignition.crankingDeg', section: 'spark', group: 'Special cases', label: 'Cranking timing', kind: 'number', unit: '°', min: -5, max: 25, step: 1,
    help: 'Fixed spark while the starter turns the engine. Too much advance at cranking speed fights the starter.' },
  { path: 'ignition.decelRetard', section: 'spark', group: 'Special cases', label: 'Overrun retard', kind: 'number', unit: '°', min: 0, max: 20, step: 1, pro: true,
    help: 'Timing taken out on a closed throttle with fuel still on, for a softer transition into engine braking.' },
  { path: 'ignition.dwell', section: 'spark', group: 'Coil', label: 'Dwell', kind: 'curve', unit: 'ms', xLabel: 'Battery V', min: 0.5, max: 8, step: 0.1, decimals: 1,
    help: 'How long the coil charges before each spark. The coil stores ½LI², and the voltage it can reach grows with that energy. Boost and advance raise the voltage the gap needs; too little dwell and the spark blows out.' },
  { path: 'ignition.knockEnabled', section: 'spark', group: 'Knock control', label: 'Knock control', kind: 'bool', options: onOff,
    help: 'Off, the ECU never retards for knock — whatever timing it commands is what the engine gets, knock or not.' },
  { path: 'ignition.knockThreshold', section: 'spark', group: 'Knock control', label: 'Knock threshold', kind: 'curve', unit: 'V', xLabel: 'RPM', min: 0.05, max: 2, step: 0.01, decimals: 2,
    help: 'Signal level the ECU calls knock. The sensor hears the valvetrain too, louder with RPM and with stiffer springs. Too low and valve noise is "knock" at high RPM; too high and real knock goes unheard.' },
  { path: 'ignition.knockMinRpm', section: 'spark', group: 'Knock control', label: 'Knock window from', kind: 'number', unit: 'RPM', min: 0, max: 6000, step: 100, pro: true,
    help: 'Knock control only listens above this speed. Below it the ECU trusts the table — which is why a tune that knocks low down gets no help.' },
  { path: 'ignition.knockMinKpa', section: 'spark', group: 'Knock control', label: 'Knock window above', kind: 'number', unit: 'kPa', min: 0, max: 150, step: 5, pro: true,
    help: 'Knock control only listens above this load.' },
  { path: 'ignition.highDetRetard', section: 'spark', group: 'Knock control', label: 'High-det timing offset', kind: 'number', unit: '°', min: 0, max: 12, step: 0.5, decimals: 1,
    help: 'When knock control has had to pull a lot, the ECU drops to a more conservative timing map and stays there until the engine has been quiet a while — the "high detonation" table. Zero leaves it off.' },
  { path: 'ignition.highDetTriggerDeg', section: 'spark', group: 'Knock control', label: 'High-det trigger', kind: 'number', unit: '°', min: 1, max: 20, step: 0.5, decimals: 1, pro: true,
    help: 'Knock retard that switches the ECU to the high-det offset.' },
  { path: 'ignition.knockStep', section: 'spark', group: 'Knock control', label: 'Retard per event', kind: 'number', unit: '°', min: 0.5, max: 6, step: 0.5, decimals: 1, pro: true,
    help: 'Timing pulled each time knock is heard.' },
  { path: 'ignition.knockRecoveryDegS', section: 'spark', group: 'Knock control', label: 'Recovery rate', kind: 'number', unit: '°/s', min: 0.1, max: 10, step: 0.1, decimals: 1, pro: true,
    help: 'How fast pulled timing is given back once knock stops.' },
  { path: 'ignition.knockRecoveryDelayS', section: 'spark', group: 'Knock control', label: 'Recovery delay', kind: 'number', unit: 's', min: 0, max: 5, step: 0.1, decimals: 1, pro: true,
    help: 'How long the ECU waits after the last knock before giving timing back.' },
  { path: 'ignition.knockMaxRetard', section: 'spark', group: 'Knock control', label: 'Maximum retard', kind: 'number', unit: '°', min: 0, max: 25, step: 1, pro: true,
    help: 'The most knock control may pull.' },
  { path: 'ignition.knockPerCylinder', section: 'spark', group: 'Knock control', label: 'Per-cylinder knock control', kind: 'bool', options: onOff, pro: true,
    help: 'Retard only the cylinder that knocked, rather than all of them. Needs cylinder modelling on to make a difference.' },

  // ---- AIRFLOW ----
  { path: 'config.airModel', section: 'airflow', group: 'Load calculation', label: 'Air-mass strategy', kind: 'enum',
    options: [{ id: 'blend', label: 'Speed-density + MAF trim' }, { id: 'sd', label: 'Speed-density' }, { id: 'maf', label: 'MAF' }],
    help: 'How the ECU works out air per cylinder. Speed-density uses MAP, IAT and the VE table; MAF measures airflow directly and ignores VE. The default is the original model: VE for fuel, the MAF\'s error feeding the trims.' },
  { path: 'config.cylinderModel', section: 'airflow', group: 'Load calculation', label: 'Model cylinder-to-cylinder distribution', kind: 'bool', options: onOff,
    help: 'Solve each cylinder separately. Real intake manifolds feed some runners better than others and middle cylinders run hotter, so cylinders differ in mixture and knock limit. Slower to compute.' },
  { path: 'airflow.mafTrim', section: 'airflow', group: 'MAF', label: 'MAF transfer correction', kind: 'curve', unit: '%', xLabel: 'Airflow g/s', min: -30, max: 30, step: 0.5, decimals: 1,
    help: 'Correction to the MAF reading by flow, on top of the scalar. A new intake changes the airflow profile across the sensor, and the error is rarely the same at every flow.' },
  { path: 'airflow.camVeCorr', section: 'airflow', group: 'VE', label: 'VE by intake cam angle', kind: 'map', unit: '%', xLabel: 'RPM', yLabel: 'Intake cam °', min: -30, max: 30, step: 0.5, decimals: 1,
    help: 'Moving the intake cam changes how the cylinder fills, and the VE table does not know. This correction does: calibrated, speed-density fuelling stays right as the phaser moves.' },
  { path: 'airflow.pedalMap', section: 'airflow', group: 'Throttle', label: 'Pedal to throttle', kind: 'curve', unit: '%', xLabel: 'Pedal %', min: 0, max: 100, step: 1,
    help: 'Electronic throttle: how far the blade opens for each pedal position. It changes how the car responds, not what it can make.' },
  { path: 'airflow.etbRatePctS', section: 'airflow', group: 'Throttle', label: 'Throttle slew rate', kind: 'number', unit: '%/s', min: 50, max: 2000, step: 50, pro: true,
    help: 'How fast the electronic throttle is allowed to move.' },

  // ---- BOOST ----
  { path: 'boost.mode', section: 'boost', group: 'Strategy', label: 'Boost control', kind: 'enum',
    options: [{ id: 'closed', label: 'Closed loop (target + PI)' }, { id: 'open', label: 'Open loop (duty table only)' }],
    help: 'Open loop, the wastegate gets the duty in the table and boost is whatever that holds. Closed loop, the ECU compares boost to target and corrects the duty.' },
  { path: 'boost.throttleScale', section: 'boost', group: 'Target', label: 'Target by throttle', kind: 'curve', unit: '%', xLabel: 'Throttle %', min: 0, max: 100, step: 1,
    help: 'How much of the BUILD boost target is requested at each throttle opening.' },
  { path: 'boost.gearLimit', section: 'boost', group: 'Target', label: 'Boost limit by gear', kind: 'curve', unit: 'psi', xLabel: 'Gear', min: 0, max: 40, step: 0.5, decimals: 1,
    help: 'Most boost allowed in each gear. First and second are traction-limited: torque the tyre cannot use is just wheelspin. The dyno pulls in 4th.' },
  { path: 'boost.iatComp', section: 'boost', group: 'Target', label: 'Intake temperature compensation', kind: 'curve', unit: 'psi', xLabel: 'IAT °C', min: -15, max: 5, step: 0.5, decimals: 1,
    help: 'Boost removed as the charge heats up — hot charge knocks sooner, and less boost brings the temperature and the pressure down together.' },
  { path: 'boost.baseDuty', section: 'boost', group: 'Wastegate', label: 'Base wastegate duty', kind: 'map', unit: '%', xLabel: 'RPM', yLabel: 'Target psi', min: 0, max: 100, step: 1,
    help: 'The duty the ECU starts from for each target. Open loop it is the whole answer; closed loop, a good base table means the PI has little to do and boost arrives without overshoot.' },
  { path: 'boost.kp', section: 'boost', group: 'Closed loop', label: 'Proportional gain', kind: 'number', unit: '%/psi', min: 0, max: 20, step: 0.5, decimals: 1,
    help: 'Duty added per psi of error, instantly. Too high and boost oscillates.' },
  { path: 'boost.ki', section: 'boost', group: 'Closed loop', label: 'Integral gain', kind: 'number', unit: '%/psi·s', min: 0, max: 40, step: 0.5, decimals: 1,
    help: 'Duty accumulated per psi of error per second. It removes steady error, but winds up while the turbo spools and overshoots when it arrives.' },
  { path: 'boost.iWindowPsi', section: 'boost', group: 'Closed loop', label: 'Integral active within', kind: 'number', unit: 'psi', min: 0.5, max: 30, step: 0.5, decimals: 1, pro: true,
    help: 'The integrator only runs this close to target — the usual defence against wind-up while spooling.' },
  { path: 'boost.maxDuty', section: 'boost', group: 'Closed loop', label: 'Maximum duty', kind: 'number', unit: '%', min: 0, max: 100, step: 1, pro: true,
    help: 'The most duty the controller may command.' },
  { path: 'boost.rampPsiS', section: 'boost', group: 'Closed loop', label: 'Target ramp rate', kind: 'number', unit: 'psi/s', min: 1, max: 200, step: 1, pro: true,
    help: 'How fast the target may rise — a gentler ramp is easier on traction and on the controller.' },
  { path: 'boost.overboostEnabled', section: 'boost', group: 'Overboost', label: 'Overboost protection', kind: 'bool', options: onOff,
    help: 'Intervene when boost exceeds target by more than the margin — a stuck gate, a split hose, or a controller overshooting.' },
  { path: 'boost.overboostMarginPsi', section: 'boost', group: 'Overboost', label: 'Margin over target', kind: 'number', unit: 'psi', min: 0.5, max: 15, step: 0.5, decimals: 1,
    help: 'How far over target boost may go before the protection acts.' },
  { path: 'boost.overboostAction', section: 'boost', group: 'Overboost', label: 'Action', kind: 'enum',
    options: [{ id: 'boost-cut', label: 'Open the wastegate' }, { id: 'fuel-cut', label: 'Cut fuel' }],
    help: 'What the ECU does about it.' },
  { path: 'boost.overboostDelayS', section: 'boost', group: 'Overboost', label: 'Delay', kind: 'number', unit: 's', min: 0, max: 2, step: 0.05, decimals: 2, pro: true,
    help: 'How long the overboost must last before it counts.' },

  // ---- VVT ----
  { path: 'vvt.intakeTarget', section: 'vvt', group: 'Targets', label: 'Intake cam advance', kind: 'map', unit: '°', xLabel: 'RPM', yLabel: 'MAP kPa', min: 0, max: 50, step: 1,
    help: 'Degrees the intake cam is advanced. Earlier intake close traps more charge at low speed and less at high speed; earlier opening adds overlap.' },
  { path: 'vvt.exhaustTarget', section: 'vvt', group: 'Targets', label: 'Exhaust cam retard', kind: 'map', unit: '°', xLabel: 'RPM', yLabel: 'MAP kPa', min: 0, max: 30, step: 1,
    help: 'Degrees the exhaust cam is retarded. More overlap keeps burned gas in the cylinder — internal EGR — and a later exhaust opening lets the gas work longer on the piston.' },
  { path: 'vvt.rateDegS', section: 'vvt', group: 'Control', label: 'Maximum phaser rate', kind: 'number', unit: '°/s', min: 10, max: 500, step: 10,
    help: 'How fast oil pressure can swing the cam.' },
  { path: 'vvt.gain', section: 'vvt', group: 'Control', label: 'Position gain', kind: 'number', unit: '1/s', min: 0.5, max: 60, step: 0.5, decimals: 1,
    help: 'How hard the controller drives the phaser toward target. Too high and the cam overshoots and hunts.' },
  { path: 'vvt.minOilC', section: 'vvt', group: 'Control', label: 'Unlock above oil temp', kind: 'number', unit: '°C', min: -20, max: 80, step: 1, pro: true,
    help: 'Phasers stay on their lock pin until the oil is warm enough to move them predictably.' },

  // ---- IDLE ----
  { path: 'idle.target', section: 'idle', group: 'Target', label: 'Idle speed', kind: 'curve', unit: 'RPM', xLabel: 'Coolant °C', min: 500, max: 1800, step: 10,
    help: 'Idle target by coolant temperature. A cold engine has more friction and burns worse, so it usually idles higher.' },
  { path: 'idle.baseAir', section: 'idle', group: 'Airflow', label: 'Base idle air', kind: 'curve', unit: '%', xLabel: 'Coolant °C', min: 0, max: 30, step: 0.5, decimals: 1,
    help: 'The idle valve position the ECU starts from. Close to right and the controller only trims; far off and it has to find idle on its own after every start.' },
  { path: 'idle.gainUp', section: 'idle', group: 'Airflow', label: 'Air gain (below target)', kind: 'number', min: 0, max: 0.1, step: 0.001, decimals: 3,
    help: 'How fast idle air is added when the engine sags. Too slow and it stalls; too fast and it overshoots and hunts.' },
  { path: 'idle.gainDown', section: 'idle', group: 'Airflow', label: 'Air gain (above target)', kind: 'number', min: 0, max: 0.02, step: 0.0001, decimals: 4, pro: true,
    help: 'How fast air is removed when idle is high.' },
  { path: 'idle.damp', section: 'idle', group: 'Airflow', label: 'Damping', kind: 'number', min: 0, max: 0.05, step: 0.0005, decimals: 4, pro: true,
    help: 'Opposes fast changes in engine speed so the controller does not chase its own overshoot.' },
  { path: 'idle.sparkGain', section: 'idle', group: 'Spark', label: 'Idle spark gain', kind: 'number', unit: '°/RPM', min: 0, max: 0.1, step: 0.002, decimals: 3,
    help: 'Spark moves torque on the very next firing, air takes several cycles to arrive. Idle spark catches fast dips; air handles the slow drift.' },
  { path: 'idle.sparkLimit', section: 'idle', group: 'Spark', label: 'Idle spark authority', kind: 'number', unit: '°', min: 0, max: 25, step: 1,
    help: 'The most idle spark control may add or take away.' },
  { path: 'idle.acRpmAdd', section: 'idle', group: 'Loads', label: 'A/C idle-up', kind: 'number', unit: 'RPM', min: 0, max: 400, step: 10,
    help: 'Idle raised while the A/C compressor is engaged.' },
  { path: 'idle.acAirAdd', section: 'idle', group: 'Loads', label: 'A/C air feed-forward', kind: 'number', unit: '%', min: 0, max: 10, step: 0.1, decimals: 1,
    help: 'Air added the moment the compressor clutch engages, before the engine speed has dropped. Without it the idle sags every time the A/C cycles.' },
  { path: 'idle.elecAirAdd', section: 'idle', group: 'Loads', label: 'Electrical load feed-forward', kind: 'number', unit: '%', min: 0, max: 10, step: 0.1, decimals: 1,
    help: 'Air added when a heavy electrical load switches on — the alternator\'s drag on the crank rises with the current it has to make.' },
  { path: 'idle.antiStallRpm', section: 'idle', group: 'Loads', label: 'Anti-stall below target by', kind: 'number', unit: 'RPM', min: 0, max: 500, step: 10, pro: true,
    help: 'A sag bigger than this triggers an immediate air kick.' },
  { path: 'idle.antiStallAir', section: 'idle', group: 'Loads', label: 'Anti-stall air kick', kind: 'number', unit: '%', min: 0, max: 15, step: 0.5, decimals: 1, pro: true,
    help: 'How much air the kick adds.' },
  { path: 'idle.tpsIdlePct', section: 'idle', group: 'Target', label: 'Closed-throttle threshold', kind: 'number', unit: '%', min: 0.5, max: 10, step: 0.5, decimals: 1, pro: true,
    help: 'The ECU treats the throttle as closed below this reading. A TPS that reads a few percent at rest keeps the ECU out of idle control and overrun cut altogether.' },

  // ---- PROTECTION ----
  { path: 'limiter.mode', section: 'protect', group: 'Rev limiter', label: 'Limiter strategy', kind: 'enum',
    options: [{ id: 'fuel', label: 'Fuel cut' }, { id: 'spark', label: 'Spark cut' }, { id: 'retard', label: 'Retard, then fuel cut' }],
    help: 'Fuel cut is smooth and cool. Spark cut is abrupt and dumps unburned mixture into a hot manifold, where it lights — pops, and a lot of heat for the turbine. Retard backs torque off progressively before cutting.' },
  { path: 'limiter.offsetRpm', section: 'protect', group: 'Rev limiter', label: 'Hard cut above redline', kind: 'number', unit: 'RPM', min: -1500, max: 500, step: 25,
    help: 'Where the hard cut sits relative to the BUILD redline. Negative stops the engine short of it.' },
  { path: 'limiter.softWindowRpm', section: 'protect', group: 'Rev limiter', label: 'Soft limiter window', kind: 'number', unit: 'RPM', min: 0, max: 1000, step: 25,
    help: 'Below the hard cut, a progressive cut (or retard) ramps in across this window so the engine eases onto the limit instead of bouncing off it.' },
  { path: 'limiter.throttleCutRpm', section: 'protect', group: 'Rev limiter', label: 'Throttle cut before', kind: 'number', unit: 'RPM', min: 0, max: 800, step: 25,
    help: 'The electronic throttle starts closing this far below the fuel cut, so the engine eases onto the limit instead of bouncing off it. Zero leaves it off.' },
  { path: 'limiter.coldLimitRpm', section: 'protect', group: 'Rev limiter', label: 'Cold rev limit', kind: 'number', unit: 'RPM', min: 0, max: 8000, step: 100, pro: true,
    help: 'A lower limit until the engine is warm — cold oil is thick and piston clearances are wide. Zero leaves it off.' },
  { path: 'limiter.speedLimitKph', section: 'protect', group: 'Rev limiter', label: 'Vehicle speed limit', kind: 'number', unit: 'km/h', min: 0, max: 350, step: 5,
    help: 'Fuel is cut above this road speed. It is a real calibration value on most road cars, and the drag strip will find it. Zero leaves it off.' },
  { path: 'limiter.restoreBandRpm', section: 'protect', group: 'Rev limiter', label: 'Restore band', kind: 'number', unit: 'RPM', min: 50, max: 800, step: 10, pro: true,
    help: 'How far below the cut revs must fall before fuel comes back.' },
  { path: 'protect.fanOnC', section: 'protect', group: 'Temperatures', label: 'Cooling fan on', kind: 'number', unit: '°C', min: 80, max: 110, step: 1,
    help: 'Coolant temperature the radiator fan switches on at. It sets where a hot engine settles — and how close that is to the coolant protection.' },
  { path: 'protect.leanEnabled', section: 'protect', group: 'Lean protection', label: 'Lean protection', kind: 'bool', options: onOff,
    help: 'Under boost, a wideband reading leaner than the limit makes the ECU intervene. It acts on what the wideband SAYS — a mis-scaled wideband fools it both ways.' },
  { path: 'protect.leanLambda', section: 'protect', group: 'Lean protection', label: 'Lean limit', kind: 'number', unit: 'λ', min: 0.8, max: 1.3, step: 0.01, decimals: 2,
    help: 'Measured lambda above which the protection acts.' },
  { path: 'protect.leanMinKpa', section: 'protect', group: 'Lean protection', label: 'Active above', kind: 'number', unit: 'kPa', min: 60, max: 250, step: 5, pro: true,
    help: 'Manifold pressure above which lean protection is armed.' },
  { path: 'protect.leanAction', section: 'protect', group: 'Lean protection', label: 'Action', kind: 'enum', options: actions,
    help: 'What the ECU does about it.' },
  { path: 'protect.egtEnabled', section: 'protect', group: 'Exhaust temperature', label: 'Component protection', kind: 'bool', options: onOff,
    help: 'Enrich when exhaust temperature passes the limit. Extra fuel absorbs heat as it evaporates and burns cooler, so the turbine and valves see less.' },
  { path: 'protect.egtLimitC', section: 'protect', group: 'Exhaust temperature', label: 'EGT limit', kind: 'number', unit: '°C', min: 700, max: 1100, step: 10,
    help: 'Exhaust temperature above which enrichment starts.' },
  { path: 'protect.egtEnrichPctPer10C', section: 'protect', group: 'Exhaust temperature', label: 'Enrichment per 10 °C', kind: 'number', unit: '%', min: 0, max: 15, step: 0.5, decimals: 1, pro: true,
    help: 'Fuel added per 10 °C over the limit.' },
  { path: 'protect.egtEnrichMaxPct', section: 'protect', group: 'Exhaust temperature', label: 'Maximum enrichment', kind: 'number', unit: '%', min: 0, max: 40, step: 1, pro: true,
    help: 'The most fuel component protection may add.' },
  { path: 'protect.knockEnabled', section: 'protect', group: 'Knock protection', label: 'Knock protection', kind: 'bool', options: onOff,
    help: 'When knock control is pulling a lot of timing, take boost out too — retard alone is running the engine hot and inefficient.' },
  { path: 'protect.knockRetardDeg', section: 'protect', group: 'Knock protection', label: 'Acts above retard of', kind: 'number', unit: '°', min: 1, max: 20, step: 0.5, decimals: 1,
    help: 'Knock retard beyond which boost is cut.' },
  { path: 'protect.knockBoostCutPsi', section: 'protect', group: 'Knock protection', label: 'Boost removed', kind: 'number', unit: 'psi', min: 0, max: 15, step: 0.5, decimals: 1, pro: true,
    help: 'How much boost is taken out.' },
  { path: 'protect.iatEnabled', section: 'protect', group: 'Temperatures', label: 'Intake temperature protection', kind: 'bool', options: onOff,
    help: 'Retard spark as intake temperature passes the limit.' },
  { path: 'protect.iatLimitC', section: 'protect', group: 'Temperatures', label: 'IAT limit', kind: 'number', unit: '°C', min: 30, max: 120, step: 1,
    help: 'Intake temperature above which the protection retards.' },
  { path: 'protect.iatRetardPerC', section: 'protect', group: 'Temperatures', label: 'Retard per °C', kind: 'number', unit: '°', min: 0, max: 2, step: 0.05, decimals: 2, pro: true,
    help: 'Timing removed per degree over the limit.' },
  { path: 'protect.ectEnabled', section: 'protect', group: 'Temperatures', label: 'Coolant protection', kind: 'bool', options: onOff,
    help: 'Limp mode when coolant overheats: less throttle, no boost, a lower rev limit.' },
  { path: 'protect.ectLimitC', section: 'protect', group: 'Temperatures', label: 'Coolant limit', kind: 'number', unit: '°C', min: 90, max: 130, step: 1,
    help: 'Coolant temperature that triggers limp mode.' },
  { path: 'protect.oilEnabled', section: 'protect', group: 'Pressures', label: 'Oil pressure protection', kind: 'bool', options: onOff,
    help: 'Cut fuel if oil pressure falls below the minimum for this engine speed — a bearing without oil lasts seconds.' },
  { path: 'protect.oilMinKpa', section: 'protect', group: 'Pressures', label: 'Minimum oil pressure', kind: 'curve', unit: 'kPa', xLabel: 'RPM', min: 0, max: 500, step: 5,
    help: 'Oil pressure needed at each speed. A hot idle legitimately reads low, so a flat limit either trips at idle or misses a failure at speed.' },
  { path: 'protect.fuelPressEnabled', section: 'protect', group: 'Pressures', label: 'Fuel pressure protection', kind: 'bool', options: onOff,
    help: 'Limp mode if the pressure across the injectors collapses — a failing pump or a blocked filter leans every cylinder at once.' },
  { path: 'protect.fuelMinDeltaKpa', section: 'protect', group: 'Pressures', label: 'Minimum across injectors', kind: 'number', unit: 'kPa', min: 50, max: 400, step: 5, pro: true,
    help: 'Pressure across the injectors below which the protection acts.' },
  { path: 'protect.dutyEnabled', section: 'protect', group: 'Pressures', label: 'Injector duty protection', kind: 'bool', options: onOff,
    help: 'Take boost out when the injectors are close to flat out — past that point the mixture leans with every extra psi.' },
  { path: 'protect.dutyLimitPct', section: 'protect', group: 'Pressures', label: 'Duty limit', kind: 'number', unit: '%', min: 50, max: 100, step: 1, pro: true,
    help: 'Injector duty that triggers it.' },
  { path: 'protect.sensorLimp', section: 'protect', group: 'Limp mode', label: 'Limp on sensor failure', kind: 'bool', options: onOff,
    help: 'A sensor reading outside what the part can produce is a broken wire or a dead sensor. The ECU substitutes a safe default and limits the engine.' },
  { path: 'protect.limpRpm', section: 'protect', group: 'Limp mode', label: 'Limp rev limit', kind: 'number', unit: 'RPM', min: 2000, max: 6000, step: 100,
    help: 'Rev limit in limp mode.' },
  { path: 'protect.limpThrottlePct', section: 'protect', group: 'Limp mode', label: 'Limp throttle limit', kind: 'number', unit: '%', min: 10, max: 100, step: 5,
    help: 'Most throttle allowed in limp mode.' },
  { path: 'protect.boostCutPsi', section: 'protect', group: 'Limp mode', label: 'Boost removed by protections', kind: 'number', unit: 'psi', min: 0, max: 30, step: 0.5, decimals: 1, pro: true,
    help: 'How much target boost a protection set to "cut boost" takes away.' },

  // ---- TORQUE ----
  { path: 'torque.limitByGear', section: 'torque', group: 'Torque limits', label: 'Crank torque limit by gear', kind: 'curve', unit: 'Nm', xLabel: 'Gear', min: 50, max: 2000, step: 10,
    help: 'Most torque allowed in each gear — protecting a gearbox, or keeping first gear usable. The dyno runs in 4th.' },
  { path: 'torque.limitByRpm', section: 'torque', group: 'Torque limits', label: 'Crank torque limit by RPM', kind: 'curve', unit: 'Nm', xLabel: 'RPM', min: 50, max: 2000, step: 10,
    help: 'Most torque allowed at each engine speed.' },
  { path: 'torque.method', section: 'torque', group: 'Torque limits', label: 'Reduce torque with', kind: 'enum',
    options: [{ id: 'spark', label: 'Spark retard' }, { id: 'throttle', label: 'Throttle' }, { id: 'boost', label: 'Boost' }, { id: 'fuel', label: 'Cylinder cut' }],
    help: 'Spark is instant but burns later and hotter. Throttle is clean but takes a few cycles to empty the manifold. Boost is slowest. Cutting cylinders is instant and coarse.' },
  { path: 'torque.tcEnabled', section: 'torque', group: 'Traction control', label: 'Traction control', kind: 'bool', options: onOff,
    help: 'Compare driven-wheel speed to vehicle speed and take torque out when the tyre is spinning. Used on DRAG.' },
  { path: 'torque.tcSlipPct', section: 'torque', group: 'Traction control', label: 'Target slip', kind: 'number', unit: '%', min: 2, max: 40, step: 1,
    help: 'A tyre makes the most force with a little slip — typically 8–15%. Past it, grip falls away.' },
  { path: 'torque.tcGain', section: 'torque', group: 'Traction control', label: 'Intervention gain', kind: 'number', min: 0.1, max: 10, step: 0.1, decimals: 1,
    help: 'Torque removed per percent of excess slip. Too little and it spins; too much and it bogs.' },
  { path: 'torque.tcMethod', section: 'torque', group: 'Traction control', label: 'Reduce torque with', kind: 'enum',
    options: [{ id: 'spark', label: 'Spark retard' }, { id: 'throttle', label: 'Throttle' }, { id: 'boost', label: 'Boost' }, { id: 'fuel', label: 'Cylinder cut' }],
    help: 'How fast the reduction arrives is the difference between catching the spin and chasing it.' },

  // ---- LAUNCH (drag strip and LIVE) ----
  { path: 'arc.launchEnabled', section: 'torque', group: 'Launch control', label: 'Launch control (two-step)', kind: 'bool', options: onOff,
    help: 'With the clutch in and the throttle pinned, a second rev limiter holds the engine at the launch speed by cutting spark, with timing pulled hard. On DRAG it sets the launch RPM; in LIVE, arm it with the clutch.' },
  { path: 'arc.launchRpm', section: 'torque', group: 'Launch control', label: 'Launch RPM', kind: 'number', unit: 'RPM', min: 1500, max: 8000, step: 100,
    help: 'Where the two-step holds the engine. Too low and it bogs off the line; too high and the tyre goes up in smoke.' },
  { path: 'arc.launchRestoreRpm', section: 'torque', group: 'Launch control', label: 'Launch restore', kind: 'number', unit: 'RPM', min: 1000, max: 8000, step: 100, pro: true,
    help: 'Where spark comes back: the hysteresis that makes a two-step pop.' },
  { path: 'arc.launchTiming', section: 'torque', group: 'Launch control', label: 'Launch timing', kind: 'number', unit: '°', min: -20, max: 20, step: 1,
    help: 'Spark on the two-step. Retarded far enough the burn is still going when the exhaust valve opens, so the manifold runs hot — the energy an anti-lag strategy uses to spool a turbo on the line.' },
  { path: 'arc.ffsEnabled', section: 'torque', group: 'Launch control', label: 'Flat-foot shifting', kind: 'bool', options: onOff,
    help: 'Change gear without lifting: the ECU cuts spark while the clutch is in, so the shift takes the time the gearbox needs and no more. Manual gearboxes only.' },

  // ---- SENSORS ----
  { path: 'sensors.map', section: 'sensors', group: 'Scaling', label: 'MAP sensor scaling', kind: 'enum',
    options: [{ id: 'auto', label: 'Auto' }, { id: '1bar', label: '1 bar' }, { id: '2.5bar', label: '2.5 bar' }, { id: '3bar', label: '3 bar' }, { id: '4bar', label: '4 bar' }],
    help: 'The voltage-to-pressure line the ECU applies. Wrong, and every table is read at the wrong load and speed-density fuels for the wrong air.' },
  { path: 'sensors.wideband', section: 'sensors', group: 'Scaling', label: 'Wideband scaling', kind: 'enum',
    options: [{ id: 'lambda-0.5-1.5', label: 'λ 0.5–1.5' }, { id: 'afr-10-20', label: 'AFR 10–20' }, { id: 'afr-7.3-22.4', label: 'AFR 7.35–22.4' }, { id: 'afr-8.5-18', label: 'AFR 8.5–18' }],
    help: 'Must match the controller\'s output. Wrong, and closed loop drives the mixture to a target it only thinks it has reached.' },
  { path: 'sensors.iat', section: 'sensors', group: 'Scaling', label: 'IAT thermistor', kind: 'enum',
    options: [{ id: 'bosch', label: 'Bosch NTC' }, { id: 'gm', label: 'GM open-element' }],
    help: 'Thermistors differ in resistance at the same temperature. Read one with the other\'s curve and air density is miscalculated.' },
  { path: 'sensors.ect', section: 'sensors', group: 'Scaling', label: 'Coolant thermistor', kind: 'enum',
    options: [{ id: 'bosch', label: 'Bosch NTC' }, { id: 'gm', label: 'GM open-element' }],
    help: 'Wrong curve, wrong warm-up enrichment and idle target.' },
  { path: 'sensors.tpsClosedV', section: 'sensors', group: 'Throttle position', label: 'TPS closed voltage', kind: 'number', unit: 'V', min: 0, max: 2, step: 0.01, decimals: 2,
    help: 'Voltage the ECU treats as a closed throttle. It must match the pot at its stop.' },
  { path: 'sensors.tpsOpenV', section: 'sensors', group: 'Throttle position', label: 'TPS open voltage', kind: 'number', unit: 'V', min: 3, max: 5, step: 0.01, decimals: 2,
    help: 'Voltage the ECU treats as wide open.' },
  { path: 'sensors.mapFilterS', section: 'sensors', group: 'Filtering', label: 'MAP filter', kind: 'number', unit: 's', min: 0, max: 0.5, step: 0.01, decimals: 2, pro: true,
    help: 'Smoothing on the MAP signal. More filtering is steadier and later — transient fuelling reacts to the lagged value.' },
  { path: 'sensors.iatFilterS', section: 'sensors', group: 'Filtering', label: 'IAT filter', kind: 'number', unit: 's', min: 0, max: 10, step: 0.1, decimals: 1, pro: true,
    help: 'Smoothing on intake temperature.' },
  { path: 'sensors.widebandFilterS', section: 'sensors', group: 'Filtering', label: 'Wideband filter', kind: 'number', unit: 's', min: 0, max: 1, step: 0.01, decimals: 2, pro: true,
    help: 'Smoothing on lambda. Closed loop reacting to a lagged reading overshoots.' },
];

/**
 * Reads a dotted path out of a calibration.
 * @param {object} cal
 * @param {string} path
 * @returns {any}
 */
export function getCal(cal, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), cal);
}

/**
 * A copy of a calibration with one path replaced. Every object along the path is copied,
 * so React sees a new reference exactly where something changed.
 * @param {object} cal
 * @param {string} path
 * @param {any} value
 * @returns {object}
 */
export function setCal(cal, path, value) {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...cal, [head]: value };
  return { ...cal, [head]: setCal(cal?.[head] ?? {}, rest.join('.'), value) };
}
