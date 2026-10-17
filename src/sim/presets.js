/**
 * Pre-configured factory engines.
 *
 * Each preset is a real production engine with its published specifications, so a
 * player can start from something they recognise instead of guessing at slider
 * values. Every figure below is sourced in the comment beside it.
 *
 * WHAT "FACTORY CALIBRATION" MEANS HERE
 * Real OEM binaries (BMW MSD80, Siemens Simos 18.1) are not publicly available in a
 * form this project can source or ship. These calibrations are RECONSTRUCTIONS built
 * from what is public — factory boost, compression, published power and torque peaks
 * and typical OEM wide-open-throttle lambda — and then validated against the real
 * power figures by `tests/presets.test.js`. The test is what keeps the claim honest.
 *
 * The tables are generated from the physics rather than hand-authored, so a
 * coefficient change can never leave a stale calibration behind.
 */

import {
  COMPRESSOR_OPTS, CONFIG_OPTS, CYL_COUNT, EXHAUST_DIA_OPTS, INJECTOR_OPTS, MATERIAL_OPTS, OCTANE_OPTS, TURBINE_OPTS,
  VALVES_PER_CYL_OPTS, VALVETRAIN_OPTS, compressorWithCount, idealExhaustDiameter, turbineWithCount,
} from './hardware.js';
import { BARO_KPA, INJ_DEADTIME_MS, PSI_TO_KPA, RHO_AIR } from './constants.js';
import { COEFF } from './coefficients.js';
import { engineLayout, layoutById, readEcuTable, readTable } from './layouts.js';
import { chargeIndexOf } from './knock.js';
import { cycleInputsFor, knockLimitedSpark, mbtFromBurn, trappedAirGrams } from './cycle.js';
import { exhaustManifoldKpa } from './friction.js';
import { bestPowerAfr, peakMapKpaOf, reachableKpa } from './manifold.js';
import { mafErrorFactor } from './sweep.js';
import { chargeTempK, exhaustTempK } from './thermo.js';
import { defaultEcuCalibration } from './ecu/calibration.js';
import { DEFAULT_ECU_HW, factoryIntakeSchedule, intakeCamAt, scheduledVeAt, tankFuel } from './ecu/context.js';
import { deriveEngine, valveFloatRpm } from './engine.js';
import { BOTTOM_END_OPTS, DEFAULT_BOTTOM_END } from './bottomEnd.js';
import { clamp, curveAt } from './math.js';
import { inductionAtMap } from './turbo.js';
import {
  CURVE_RPM, effectiveMafFactor, interpolationRoomDeg, OPEN_LOOP_KPA, RPM, SPARK_MAX_DEG,
  SPARK_MIN_DEG,
} from './tables.js';

/**
 * How far below the knock limit a factory calibration sits, in degrees.
 *
 * Manufacturers leave margin for fuel quality, altitude, heat soak and engine
 * wear — they do not calibrate to the edge the way a dyno tune can. This margin is
 * why the factory tune is beatable, which is the whole exercise.
 *
 * Exported deliberately, not because anything outside this module currently imports
 * it: it is part of this module's documented interface (the number a reader or a
 * future test needs to know "how much margin is a factory tune leaving on the
 * table"), not leftover surface.
 */
export const FACTORY_KNOCK_MARGIN_DEG = 2;

/**
 * @typedef {object} Preset
 * @property {string} id
 * @property {string} name
 * @property {string} manufacturer
 * @property {string} years
 * @property {string} blurb
 * @property {object} factory published ratings
 * @property {import('./engine.js').EngineConfig} engine
 * @property {object} induction
 * @property {object} parts
 * @property {object} mods
 * @property {object} [fuel] the tank's fuel (`tankFuel`), when it is not one of OCTANE_OPTS
 * @property {number} [bottomEndRatedRpm] the speed the factory pistons and rods are rated to,
 *   when it is not the published limiter
 *   by index: a flex-fuel blend. A catalogue preset names its pump fuel by index instead
 */

/** @type {Preset[]} */
export const ENGINE_PRESETS = [
  {
    id: 'vq35de-revup',
    name: 'Nissan VQ35DE Rev-Up',
    manufacturer: 'Nissan',
    years: '2005-2006',
    blurb: 'The high-revving 350Z engine this simulator was originally calibrated around. Its naturally aspirated V6 is the cleanest starting point for learning what the stock tables and hardware are doing.',
    factory: {
      crankHp: 300, crankHpRpm: 6400,   // 300 hp @ 6400 rpm
      crankTq: 260, crankTqRpm: 4800,   // 260 lb-ft @ 4800 rpm
      displacementL: 3.50,
    },
    engine: {
      configuration: 'V6',
      // Nissan's 2006 350Z specifications publish 95.5 x 81.4 mm and 10.3:1.
      // These are also the geometry and compression the simulator's generic default
      // was calibrated around. The factory 7000 RPM limit replaces that default's
      // deliberately generic 7500 RPM ceiling here.
      bore: 95.5, stroke: 81.4,
      compression: 10.3,
      blockMaterial: 'Aluminum', headMaterial: 'Aluminum', injection: 'port', // sequential multi-port
      // DOHC, four valves, direct-acting buckets with shims (Nissan parts list: intake valve
      // shim buckets; Tomei: 'conventional direct-acting valve train').
      valvetrain: 'dohc', valvesPerCyl: 4, follower: 'flat',
      // Bore, stroke, compression and redline above are published; `camDuration` and
      // `springRate` are not — Nissan states only that the Rev-Up revised the cams and
      // raised the limit — so they are where this preset is fitted, as `vq35hr` is.
      //
      // REFITTED for the two-zone cycle. #38 landed 220 degrees against the model of the
      // day; on this one that reads +8.6% on power, outside the +/-5% floor. 202 centres
      // the fit instead: 0.0% on power and +2.3% on torque, the best simultaneous fit in
      // the range. The band is event-free from 198 to 226, so the fit is bounded by the
      // power tolerance rather than by any advisory.
      //
      // Do NOT read 210 here as a published number if you see it in the history — that
      // was the generic custom-build default left in place, which #38 correctly called
      // out as a coin toss rather than a fit.
      //
      // `springRate` 60 does not change power; it sets where the valvetrain gives up.
      // `valveFloatRpm` lands ~8530, about 1530 RPM clear of the 7000 redline, mid-pack
      // against the rest of the set. No pull should ever show a `float` event here — if
      // one appears that is a bug, not "the character".
      //
      // REFITTED from 202 for the inlet Mach index (#15). That term takes volumetric
      // efficiency out of the top end, so duration comes back up to pay for it: power
      // lands on the published figure (0.0%, torque +5.0%), and the power curve's flat top
      // (within 1 hp of peak) now runs 6500-6900 against a published 6400 instead of
      // climbing into the 7000 limiter.
      // REFITTED for the geometry-based friction model (friction.js), which charges this
      // engine more friction at speed than the old straight line did: duration moved to
      // where power lands on the published rating again (friction.js).
      // REFITTED for the breathing curve read at speed scaled to its peak (airflow.js) and
      // the corrected rod length: 214 (power -3.9%, torque 0.0%) is the longest duration
      // whose power still falls away before the 7000 limiter (peak 6600 against a
      // published 6400). Longer lands power on the rating but flat into the limiter,
      // which the real engine does not do.
      // REFITTED for the rich-flame chemistry (thermo.js, heatReleasedShare): a rich mixture
      // now releases only what its CO and H2 leave it, about 4% less heat per kg of air at
      // full-throttle lambda. Duration stays at 214, still the longest whose power falls
      // away before the 7000 limiter: every longer cam runs flat into it, which the real
      // engine does not do. So this preset now reads about 9% under its rating, a known gap
      // recorded in tests/presets.test.js (KNOWN_GAPS): the model's top-end rolloff, not
      // its cam, is what holds it there.
      camDuration: 214, springRate: 60,
      redline: 7000,
    },
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    parts: { injectorIdx: 0, exhaustDiaIdx: 2, octaneIdx: 0 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  },
  {
    id: 'vq35hr',
    name: 'Nissan VQ35HR',
    manufacturer: 'Nissan',
    years: '2007-2016',
    blurb: 'A high-revving naturally aspirated V6 — the reference point for what an engine makes without boost. Rewards cam and exhaust work, punishes anyone hoping for torque down low.',
    factory: {
      crankHp: 306, crankHpRpm: 6800,   // 306 hp @ 6800 rpm
      crankTq: 268, crankTqRpm: 4800,   // 268 lb-ft @ 4800 rpm
      displacementL: 3.50,
    },
    engine: {
      configuration: 'V6',
      bore: 95.5, stroke: 81.4,          // 95.5 x 81.4 mm
      compression: 10.6,                 // 10.6:1
      blockMaterial: 'Aluminum', headMaterial: 'Aluminum', injection: 'port', // sequential multi-port
      valvetrain: 'dohc', valvesPerCyl: 4, follower: 'flat', // as the DE: direct-acting buckets
      // Bore, stroke, compression and redline above are published figures and do not
      // move. `camDuration` and `springRate` are not published, so they are where this
      // preset is fitted.
      //
      // REFITTED TWICE. It was 228 degrees against the old algebraic combustion model,
      // then 214 when work started being integrated from a pressure trace. 218 is the
      // refit for the inlet Mach index (#15): that term takes real volumetric efficiency
      // out of the top end, so a little more duration comes back to pay for it. Power
      // lands on the published figure (-0.0%) and torque +1.8%.
      //
      // The spring rate carries it easily: valve float sits near 8880 RPM, well clear of
      // the 7500 redline, and the cam stays short of the overlap that trips the cam
      // advisory (see the refit note below).
      //
      // THE ROLLOFF NOW EXISTS. This preset used to climb monotonically into its limiter
      // and read peak power at 7500, 700 RPM above the published 6800, because nothing in
      // the shared physics made VE fall at speed. The Mach index is that term, and the
      // simulated flat top (within 1 hp of peak) now runs 6400-7100, bracketing the
      // published 6800 rather than sitting 700 RPM above it. What remains missing is still worth naming: the real
      // engine's rolloff is cam profile, VVEL variable lift and intake-tract tuning, and
      // the Mach term stands in for all three at once rather than reproducing any of them.
      // REFITTED for the geometry-based friction model (friction.js), which charges this
      // engine more friction at speed than the old straight line did: 228 is the longest
      // duration that stays clear of the overlap advisory, which a factory cam does not
      // trip (power -2.0%, torque -2.1%; 232 lands power on the rating but trips it).
      // REFITTED for the breathing curve read at speed scaled to its peak (airflow.js) and
      // the corrected rod length: 226 lands power on the rating (0.0%, torque +0.1%, peak
      // 7000 against a published 6800), clear of the overlap advisory.
      // KEPT through the rich-flame chemistry (thermo.js, heatReleasedShare), which took
      // about 4% of heat per kg of air out of full throttle: power now reads about -5%. 228
      // reads -3.9%, but then the stock spark table knocks at 5100 RPM once an intake and
      // headers are fitted, which a factory margin does not allow.
      camDuration: 226, springRate: 68,
      redline: 7500,
    },
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    // The 315 cc option, the smallest the parts list carries and the nearest to the real
    // engine's (about 290 cc): a factory injector runs about 75-85% duty at peak power.
    // It was the 550 here, which left a stock engine at 44%.
    parts: { injectorIdx: 0, exhaustDiaIdx: 1, octaneIdx: 1 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  },
  {
    id: 'n54',
    name: 'BMW N54',
    manufacturer: 'BMW',
    years: '2006-2013',
    blurb: 'A twin-turbo straight six running unusually high compression for a boosted engine. Famous for leaving power on the table from the factory — which makes it the best argument in the app for why tuning exists.',
    factory: {
      crankHp: 302, crankHpRpm: 5800,   // 302 hp @ 5800 rpm
      crankTq: 295, crankTqRpm: 3000,   // 295 lb-ft, flat 1400-5000
      displacementL: 2.98,
    },
    engine: {
      boostRatedBottomEnd: true,       // a factory turbo engine: see BEARING_PRESSURE_FREE_BAR
      configuration: 'I6',
      bore: 84.0, stroke: 89.6,          // 84 x 89.6 mm
      compression: 10.2,                 // 10.2:1 — high for a turbo engine, thanks to DI
      blockMaterial: 'Aluminum', headMaterial: 'Aluminum', injection: 'direct', // BMW High Precision Injection: piezo, direct only
      // DOHC, four valves; roller finger followers on hydraulic lash adjusters, as BMW's
      // later B58 (an inference for the N54, not a sourced figure).
      valvetrain: 'dohc', valvesPerCyl: 4, follower: 'roller',
      // REFITTED for the geometry-based friction model (friction.js), which charges this
      // engine more friction at speed than the old straight line did: duration moved to
      // where power lands on the published rating again (friction.js).
      camDuration: 214, springRate: 58,
      redline: 7000,
    },
    induction: {
      turboOn: true, turbineIdx: 0, compressorIdx: 0,
      // TWO small turbos (Mitsubishi TD03s), each with its own turbine and compressor.
      // Now that backpressure is solved from turbine flow area rather than assumed
      // proportional to boost, the count is load-bearing: a pair of small housings
      // passes twice the exhaust of one before it starts choking, and a pair of small
      // compressors twice the air, which is the whole reason a manufacturer fits two
      // small turbos instead of one big one.
      turbineCount: 2,
      // Twin small turbos spool early (0.6 bar / 8.5 psi target by 3500), but the
      // factory ECU tapers boost above that as exhaust backpressure and heat climb
      // toward redline — the well-documented N54 "boost taper" that trades away
      // top-end for turbo longevity rather than chasing peak power to the limiter.
      boost: RPM.map((r) => (r < 1500 ? 0 : r < 2500 ? 7 : r < 4500 ? 8.5
        : r < 5500 ? 7.2 : r < 6500 ? 6.2 : 5.2)),
    },
    parts: { injectorIdx: 3, exhaustDiaIdx: 2, octaneIdx: 1 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: true },
  },
  {
    id: 'b58-m0',
    name: 'BMW B58B30M0',
    manufacturer: 'BMW',
    years: '2016-2018',
    blurb: 'One twin-scroll turbo where the N54 ran two, and 11.0:1 compression no 2006 turbo engine could have run — two BMW turbo-six generations apart. Load it next to the N54 to see what a decade of combustion development actually bought.',
    factory: {
      crankHp: 320, crankHpRpm: [5500, 6500],  // plateau-rated
      crankTq: 330, crankTqRpm: 1380,          // 330 lb-ft, flat 1380-5000
      displacementL: 3.00,
    },
    engine: {
      boostRatedBottomEnd: true,       // a factory turbo engine: see BEARING_PRESSURE_FREE_BAR
      configuration: 'I6',
      bore: 82.0, stroke: 94.6,          // 82 x 94.6 mm
      compression: 11.0,                 // 11.0:1 — higher than the N54, two generations back
      blockMaterial: 'Aluminum', headMaterial: 'Aluminum', injection: 'direct', // solenoid direct injection, no port injectors
      // DOHC, four valves, roller finger followers ('roller drag lever', BMW part 11337640533).
      valvetrain: 'dohc', valvesPerCyl: 4, follower: 'roller',
      // Bore, stroke, compression and redline are published and do not move.
      // `camDuration` and `springRate` are not published in terms comparable to this
      // model, so they are free to be fitted — see the VQ35HR comment above for the
      // same arrangement and why it is not a fudge factor. In the event neither had to
      // move: this engine's peak torque is set almost entirely by manifold pressure.
      // Measured with `python3 scripts/analyze_presets.py --id b58-m0` (peak torque
      // 297 wlb-ft at camDuration 214): swapping duration 212->214->216 moves it only
      // 298->297->296, about 1 wlb-ft per 2°, while +1 psi of boost at the 3500 node,
      // the 4500 node, or added across the whole curve each move it 297->306/308/308
      // — 9-11 wlb-ft per psi. So the boost curve
      // below is what was actually fitted. 214° sits just below the N54's 216° and
      // carries 2.20° of overlap, well inside the advisory.
      // `springRate` 60 puts `valveFloatRpm` at ~8474, 1474 RPM clear of the 7000
      // limiter — the same order of margin the other presets carry (1242-1682). No
      // pull on a healthy engine should ever log a `float` event.
      camDuration: 214, springRate: 60,
      redline: 7000,
    },
    induction: {
      turboOn: true, turbineIdx: 1, compressorIdx: 1,
      // One twin-scroll turbo rather than the N54's pair. A twin-scroll housing keeps
      // the exhaust pulses of the two cylinder groups separated right up to the
      // turbine, so a single larger turbo spools nearly as early as two small ones —
      // which is why peak boost is commanded from just above idle and the torque
      // plateau is rated from 1380. It then tapers toward redline for the same reasons
      // the N54's does: backpressure and heat.
      //
      // PEAK is the published figure — 13 psi, ~0.9 bar — and does not move. The SHAPE
      // across RPM is not published, and it is the only thing fitted here: 13 psi held
      // to 2500, then a taper down to about 6.75 psi at the 7000 limiter (the curve's
      // last node, 6.5, sits at 7500 and is never reached — redline cuts the pull
      // first). That taper is steeper than the
      // real engine's, and deliberately so. This model was calibrated on a naturally
      // aspirated V6, and it reports more torque per unit of manifold pressure than a
      // real high-compression boosted six makes — hold 13 psi flat to 4500 here and the
      // pull returns about 340 wlb-ft against a 281 target. Everything above the torque peak
      // is where that error can be absorbed without contradicting a published number,
      // so that is where it is absorbed.
      //
      // WHAT THIS PRESET DOES NOT REPRODUCE: the rated torque plateau. BMW publishes
      // 330 lb-ft flat from 1380 RPM; this preset reaches 64% of its 281 wlb-ft target
      // at 1500 and its target by 3000 (180 / 238 / 285 / 293 wlb-ft at 1500 / 2000 /
      // 2500 / 3000; measured after the turbo solve was made to spool up from zero). The line above about boost "commanded from just above idle"
      // describes the curve this preset ASKS for, not torque it delivers down there.
      // The N54 above has the same gap and no test asserts torque-peak placement, so
      // this is a shared limit of the model rather than a fault in this data — the
      // same absent term tracked as issue #31, which costs nothing for stacking
      // compression on boost and shows up here in the torque channel.
      boost: RPM.map((r) => (r < 1500 ? 0 : r < 3500 ? 13 : r < 4500 ? 11
        : r < 5500 ? 9 : r < 6500 ? 8 : r < 7500 ? 7 : 6.5)),
    },
    parts: { injectorIdx: 3, exhaustDiaIdx: 2, octaneIdx: 1 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: true },
  },
  {
    id: 'b58-m1',
    name: 'BMW B58B30M1',
    manufacturer: 'BMW',
    years: '2019-present',
    blurb: 'The same three litres with more boost and a far sharper calibration — 382 hp from an identical short block. What the Golf R is to the GTI, one engine family later.',
    factory: {
      crankHp: 382, crankHpRpm: 5800,   // 382 hp @ 5800 rpm
      crankTq: 369, crankTqRpm: 1800,   // 369 lb-ft, flat 1800-5000
      displacementL: 3.00,
    },
    engine: {
      boostRatedBottomEnd: true,       // a factory turbo engine: see BEARING_PRESSURE_FREE_BAR
      configuration: 'I6',
      bore: 82.0, stroke: 94.6,
      compression: 11.0,
      blockMaterial: 'Aluminum', headMaterial: 'Aluminum', injection: 'direct', // solenoid direct injection, no port injectors
      valvetrain: 'dohc', valvesPerCyl: 4, follower: 'roller',
      // Same short block, so bore, stroke and compression are the M0's. The revised
      // engine's sharper calibration is carried by a slightly longer duration and the
      // spring rate to match: `valveFloatRpm` ~8534, 1534 RPM clear of the limiter.
      // REFITTED for the geometry-based friction model (friction.js), which charges this
      // engine more friction at speed than the old straight line did: duration moved to
      // where power lands on the published rating again (friction.js).
      camDuration: 210, springRate: 62,
      redline: 7000,
    },
    induction: {
      turboOn: true, turbineIdx: 1, compressorIdx: 1,
      // The revised engine runs meaningfully more boost than the M0 through the same
      // architecture — roughly 1.2 bar against 0.9. Nothing about the short block
      // changed, which is the entire lesson of shipping both.
      //
      // Peak is the published 17 psi and does not move; as on the M0, only the taper is
      // fitted, and it absorbs the same model error the M0's does (see that comment
      // above) — this physics reports more torque per unit of manifold pressure than
      // an 11.0:1 boosted six really makes, and the taper is where the excess is
      // absorbed without contradicting a published number. It is a far gentler taper
      // than the M0's: 17 psi held to 2500 — as on the M0, the last node carrying peak
      // is 2500, not 3500, so the plateau is already falling by 3000 (15.5 psi) — then
      // tapering to about 10.75 psi at the 7000 limiter (the curve's last node, 10.5,
      // sits at 7500 and is never reached), against the M0's 13 held to the same 2500
      // and tapering to about 6.75 at its own 7000 limiter. The two engines differ in
      // the DEPTH of the taper, not in where it starts — but that depth is still NOT
      // the same relationship the Golf R has to the GTI
      // below. Each retained-boost figure is that engine's boost curve linearly
      // interpolated at its own redline (the same way the sim samples it), divided by
      // its peak boost — not the value written last in each curve's ternary, which
      // sits at the 7500 breakpoint, past every one of these four engines' redlines,
      // and so is never itself sampled: the Golf R interpolates to 15.2 psi at its
      // 6800 limiter, 15.2/17 = 89% of peak; the GTI's 6500 limiter lands exactly on
      // an RPM breakpoint at 8.5 psi, 8.5/14 = 61% (coincidentally the same number as
      // that curve's final ternary clause); and the M1 interpolates to 10.75 psi at
      // its 7000 limiter, 10.75/17 = 63% — still on the GTI's side of that split, not
      // the Golf R's. The real reason the M1 needs a gentler taper is a fitting
      // constraint, not a wastegate schedule: its power target is 19% above the
      // M0's while its torque target is only 12% above, so less of the M0's curve can be
      // cut before power falls out of tolerance. Together the two published targets
      // give a 62 hp gap (382-320); the two simulated curves give 40 whp (320-280) —
      // the model doesn't reproduce the full published gap, but the direction and most
      // of the magnitude are there.
      //
      // WHAT THIS PRESET DOES NOT REPRODUCE: the rated torque plateau, exactly as on
      // the M0. Published 369 lb-ft flat from 1800 RPM; this preset reaches 56% of its
      // 314 wlb-ft target at 1500 and its target by 2500 (176 / 232 / 314 / 321 wlb-ft at
      // 1500 / 2000 / 2500 / 3000). Same shared limit, same issue #31.
      boost: RPM.map((r) => (r < 1500 ? 0 : r < 3500 ? 17 : r < 4500 ? 14
        : r < 6500 ? 12 : r < 7500 ? 11 : 10.5)),
    },
    parts: { injectorIdx: 4, exhaustDiaIdx: 2, octaneIdx: 1 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: true },
  },
  {
    id: 'ea888-gti',
    name: 'VW EA888.3 (GTI)',
    manufacturer: 'Volkswagen',
    years: '2013-2021',
    blurb: 'A small, heavily boosted four with a long stroke and a broad torque plateau. Same short block as the Golf R below — the difference is entirely turbo and calibration, which is the point.',
    factory: {
      crankHp: 220, crankHpRpm: [4700, 6200],  // plateau-rated
      crankTq: 258, crankTqRpm: 1500,
      displacementL: 1.98,
    },
    engine: {
      boostRatedBottomEnd: true,       // a factory turbo engine: see BEARING_PRESSURE_FREE_BAR
      configuration: 'I4',
      bore: 82.5, stroke: 92.8,          // 82.5 x 92.8 mm
      compression: 9.6,                  // 9.6:1
      blockMaterial: 'Cast Iron', headMaterial: 'Aluminum', injection: 'direct',
      // DOHC, four valves; roller finger followers (an inference: the layout VW's modern
      // four-valve heads use, not a sourced figure for the EA888.3).
      valvetrain: 'dohc', valvesPerCyl: 4, follower: 'roller',
      // Direct injection only: the North American EA888.3 has no port injectors (the
      // European one is dual-injected). Duration is fitted, not published: 200 puts both
      // this and the Golf R, which share it, on their rated power and torque.
      // REFITTED for the geometry-based friction model (friction.js), which charges this
      // engine more friction at speed than the old straight line did: duration moved to
      // where power lands on the published rating again (friction.js).
      camDuration: 210, springRate: 54,
      redline: 6500,
    },
    induction: {
      turboOn: true, turbineIdx: 0, compressorIdx: 1,
      // IHI IS20: quick-spooling, so boost is in by 2500. It peaks around 14 psi in
      // the low-mid range where the plateau torque figure is rated, then the ECU
      // eases off toward redline the way the taper above does for the N54 — the
      // same physical trade-off, smaller turbo. A "Small" compressor (12 psi
      // ceiling) cannot sustain this without running outside its efficient range
      // every pull, so this is sized Medium (20 psi ceiling) instead.
      boost: RPM.map((r) => (r < 1500 ? 0 : r < 2500 ? 12 : r < 3500 ? 14
        : r < 4500 ? 13 : r < 5500 ? 11.2 : r < 6500 ? 9.5 : 8.5)),
    },
    parts: { injectorIdx: 2, exhaustDiaIdx: 1, octaneIdx: 1 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: true },
  },
  {
    id: 'ea888-r',
    name: 'VW EA888.3 (Golf R)',
    manufacturer: 'Volkswagen',
    years: '2015-2021',
    blurb: 'The same 2.0 litre block with the larger IS38 turbo and a far more aggressive calibration. Compare it against the GTI preset to see how much of an engine is decided after the metal is cast.',
    factory: {
      crankHp: 292, crankHpRpm: [5400, 6500],  // plateau-rated
      crankTq: 280, crankTqRpm: 1800,
      displacementL: 1.98,
    },
    engine: {
      boostRatedBottomEnd: true,       // a factory turbo engine: see BEARING_PRESSURE_FREE_BAR
      configuration: 'I4',
      bore: 82.5, stroke: 92.8,
      compression: 9.6,
      blockMaterial: 'Cast Iron', headMaterial: 'Aluminum', injection: 'direct',
      valvetrain: 'dohc', valvesPerCyl: 4, follower: 'roller',
      // Direct injection only: the North American EA888.3 has no port injectors (the
      // European one is dual-injected). Duration is fitted, not published: 200 puts both
      // this and the Golf R, which share it, on their rated power and torque.
      // REFITTED for the geometry-based friction model (friction.js), which charges this
      // engine more friction at speed than the old straight line did: duration moved to
      // where power lands on the published rating again (friction.js).
      // REFITTED for the rich-flame chemistry (thermo.js, heatReleasedShare): a rich mixture
      // now releases only what its CO and H2 leave it, about 4% less heat per kg of air at
      // full-throttle lambda, so duration came up until power is on the rating again.
      camDuration: 212, springRate: 54,
      redline: 6800,
    },
    induction: {
      turboOn: true, turbineIdx: 1, compressorIdx: 1,
      // IS38 at 1.2 bar / 17.4 psi, held through the mid-range where this engine's
      // plateau torque is rated, then the same top-end taper as the smaller turbos
      // above — a bigger compressor gives it less of a fall-off, which is exactly
      // the point of the upgrade over the GTI's IS20.
      boost: RPM.map((r) => (r < 1500 ? 0 : r < 2500 ? 14 : r < 3500 ? 17
        : r < 4500 ? 17 : r < 5500 ? 16.5 : r < 6500 ? 15.8 : 15.2)),
    },
    parts: { injectorIdx: 4, exhaustDiaIdx: 1, octaneIdx: 1 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: true },
  },
  // ---------------------------------------------------------------------------------
  // PUSHROD V8s. Two valves per cylinder worked by pushrods and roller lifters, so the
  // valvetrain, valve area and friction inputs (engine.js, friction.js) are what make
  // these engines differ from the overhead-cam set above, not a per-engine factor.
  //
  // As for every preset, `camDuration` is the one fitted input: the simulator's single
  // duration stands in for a real cam card, and is set where peak POWER lands on the
  // published figure. Torque, and the speeds at which power and torque peak, are then
  // predictions, and `tests/presets.test.js` holds them to the same bands as the rest.
  // GM's Gen III engines run the "Older (1990s-2000s)" friction level: that level IS
  // GM's measured friction for this family ("Friction Torque" in the factory
  // calibrations of the LM7, LR4 and two Vortec small-blocks; see friction.js), so for
  // these it is in-sample, not a prediction.
  //
  // Intake valve sizes are cylinder-head casting figures from enthusiast references
  // (2.00 in on the 241/243/317 castings, 1.89 in on the 706/862 truck castings), not
  // GM documents; they set the valve area the inlet Mach index reads.
  {
    id: 'ls1',
    name: 'GM LS1 (C5 Corvette)',
    manufacturer: 'GM',
    years: '2001-2004',
    blurb: 'The all-aluminium small-block that started the LS family. Pushrods and two big valves per cylinder make strong torque from a mild cam; a good engine for learning how a big naturally aspirated V8 fills.',
    factory: {
      // GM's 2004 Corvette specifications: 350 hp @ 5600, 375 lb-ft @ 4400 with the
      // manual (360 lb-ft @ 4000 with the automatic). corvetteactioncenter.com/specs/c5/2004
      crankHp: 350, crankHpRpm: 5600,
      crankTq: 375, crankTqRpm: 4400,
      displacementL: 5.67,
    },
    engine: {
      configuration: 'V8',
      // 99.0 x 92.0 mm, 10.1:1, 6000 RPM limit (GM 2004 Corvette specifications).
      bore: 99.0, stroke: 92.0,
      compression: 10.1,
      blockMaterial: 'Aluminum', headMaterial: 'Aluminum', injection: 'port',
      valvetrain: 'ohv', valvesPerCyl: 2, follower: 'roller', intakeValveMm: 50.8,
      frictionLevel: 'older',
      // Fitted: power -0.2% of the rating, torque -0.5% (predicted), power flat-top
      // 5500-5800 against a published 5600.
      // REFITTED for the rich-flame chemistry (thermo.js, heatReleasedShare): a rich mixture
      // now releases only what its CO and H2 leave it, about 4% less heat per kg of air at
      // full-throttle lambda, so duration came up until power is on the rating again.
      camDuration: 210, springRate: 60,
      redline: 6000,
    },
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    // Factory injectors are about 28-29 lb/hr (about 300 cc/min); the 315 cc option is
    // the nearest. Twin 2.5 in pipes have about the flow area of one 3.5 in pipe.
    parts: { injectorIdx: 0, exhaustDiaIdx: 3, octaneIdx: 0 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  },
  {
    id: 'ls6',
    name: 'GM LS6 (Cadillac CTS-V)',
    manufacturer: 'GM',
    years: '2004-2005',
    blurb: 'The LS1 with the Z06 treatment: higher compression, better-flowing heads and a bigger cam. It makes its power higher in the rev range, which is where the bigger cam earns its keep.',
    factory: {
      // 400 hp @ 6000, 395 lb-ft @ 4800 (Cadillac CTS-V specifications; MotorWeek
      // road test #2324). The Corvette Z06's version is rated 405 / 400.
      crankHp: 400, crankHpRpm: 6000,
      crankTq: 395, crankTqRpm: 4800,
      displacementL: 5.67,
    },
    engine: {
      configuration: 'V8',
      // 99 x 92 mm and 10.5:1 (GM); 6500 RPM limit.
      bore: 99.0, stroke: 92.0,
      compression: 10.5,
      blockMaterial: 'Aluminum', headMaterial: 'Aluminum', injection: 'port',
      valvetrain: 'ohv', valvesPerCyl: 2, follower: 'roller', intakeValveMm: 50.8,
      frictionLevel: 'older',
      // Fitted: power -1.5%, torque -4.1% (predicted), flat-top 5800-6400 against a
      // published 6000. 228 rather than the 230 that lands power closer: 230 starts to
      // trip the overlap advisory, which a factory cam does not.
      camDuration: 228, springRate: 60,
      redline: 6500,
    },
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    parts: { injectorIdx: 0, exhaustDiaIdx: 3, octaneIdx: 0 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  },
  {
    id: 'lq4',
    name: 'GM LQ4 Vortec 6000',
    manufacturer: 'GM',
    years: '1999-2007',
    blurb: 'The iron-block 6.0 truck engine, and one of the most popular engines to turbocharge: low compression, a strong bottom end and a mild cam that makes torque everywhere.',
    factory: {
      // The LQ4 carried several ratings. 325 hp @ 5200 and 370 lb-ft @ 4000 is the 2001
      // GMC Sierra C3's (also the Yukon Denali and Suburban LTZ range). The heavy-duty
      // trucks' 300 hp @ 4400 is a separate calibration that peaks far lower; this
      // preset does not reproduce that one.
      crankHp: 325, crankHpRpm: 5200,
      crankTq: 370, crankTqRpm: 4000,
      displacementL: 5.97,
    },
    engine: {
      configuration: 'V8',
      // 101.6 x 92 mm, 9.4:1; iron block, aluminium 317 heads. 5600 RPM is the fuel
      // cut-off in GM's truck calibrations.
      bore: 101.6, stroke: 92.0,
      compression: 9.4,
      blockMaterial: 'Cast Iron', headMaterial: 'Aluminum', injection: 'port',
      valvetrain: 'ohv', valvesPerCyl: 2, follower: 'roller', intakeValveMm: 50.8,
      frictionLevel: 'older',
      // Fitted: power +1.0%, torque +0.2% (predicted), flat-top 5100-5500. 188 lands
      // nearer (-0.1%), but 190 is the shortest duration the duration terms are checked
      // down to (Pro's envelope), and a truck cam is at that end of the range.
      // REFITTED for the rich-flame chemistry (thermo.js, heatReleasedShare): a rich mixture
      // now releases only what its CO and H2 leave it, about 4% less heat per kg of air at
      // full-throttle lambda, so duration came up until power is on the rating again.
      camDuration: 198, springRate: 60,
      redline: 5600,
    },
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    // GM rates its trucks on 87 regular, which this game's fuel list does not carry; 91
    // is the nearest, and a factory calibration on 91 is no more knock-limited than on 87.
    parts: { injectorIdx: 0, exhaustDiaIdx: 2, octaneIdx: 0 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  },
  {
    id: 'lm7',
    name: 'GM LM7 Vortec 5300',
    manufacturer: 'GM',
    years: '2004-2007',
    blurb: 'The 5.3 from millions of Silverados and Tahoes. Iron block, small-port truck heads and a mild cam: built for torque and longevity, and the cheapest way into an LS swap.',
    factory: {
      // 295 hp @ 5200 and 335 lb-ft @ 4000 (2004-2007 rating; 285 / 325 before).
      crankHp: 295, crankHpRpm: 5200,
      crankTq: 335, crankTqRpm: 4000,
      displacementL: 5.33,
    },
    engine: {
      configuration: 'V8',
      // 96 x 92 mm, 9.5:1; the 4.8's bore with the 6.0's stroke.
      bore: 96.0, stroke: 92.0,
      compression: 9.5,
      blockMaterial: 'Cast Iron', headMaterial: 'Aluminum', injection: 'port',
      valvetrain: 'ohv', valvesPerCyl: 2, follower: 'roller', intakeValveMm: 48.0,
      frictionLevel: 'older',
      // Fitted: power +1.7%, torque -0.3% (predicted), flat-top 5200-5600. 186 lands
      // nearer (-0.3%); 190 for the same reason as the LQ4.
      // REFITTED for the rich-flame chemistry (thermo.js, heatReleasedShare): a rich mixture
      // now releases only what its CO and H2 leave it, about 4% less heat per kg of air at
      // full-throttle lambda, so duration came up until power is on the rating again.
      camDuration: 198, springRate: 60,
      redline: 5800,
    },
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    parts: { injectorIdx: 0, exhaustDiaIdx: 2, octaneIdx: 0 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  },
  {
    id: 'lr4',
    name: 'GM LR4 Vortec 4800',
    manufacturer: 'GM',
    years: '2005-2006',
    blurb: 'The short-stroke 4.8: the 5.3 with 9 mm less stroke. It needs revs to make power, so it shows plainly how stroke trades torque for engine speed.',
    factory: {
      // 285 hp @ 5200 and 295 lb-ft @ 4000 (2005-2006 rating).
      crankHp: 285, crankHpRpm: 5200,
      crankTq: 295, crankTqRpm: 4000,
      displacementL: 4.81,
    },
    engine: {
      configuration: 'V8',
      // 96 x 83 mm, 9.4:1.
      bore: 96.0, stroke: 83.0,
      compression: 9.4,
      blockMaterial: 'Cast Iron', headMaterial: 'Aluminum', injection: 'port',
      valvetrain: 'ohv', valvesPerCyl: 2, follower: 'roller', intakeValveMm: 48.0,
      frictionLevel: 'older',
      // Fitted: power +0.3%, torque +2.9% (predicted), flat-top 5500-5800 against a
      // published 5200.
      // REFITTED for the rich-flame chemistry (thermo.js, heatReleasedShare): a rich mixture
      // now releases only what its CO and H2 leave it, about 4% less heat per kg of air at
      // full-throttle lambda, so duration came up until power is on the rating again.
      // Back to 200 with dissociation (thermo.js, dissociatedEnergyJPerKg): at 202 the
      // power peak reached the 6000 limiter; 200 lands -2.6% and peaks before it.
      camDuration: 200, springRate: 60,
      redline: 6000,
    },
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    parts: { injectorIdx: 0, exhaustDiaIdx: 2, octaneIdx: 0 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  },
  {
    id: 'hemi-392',
    name: 'Chrysler 6.4 HEMI (392)',
    manufacturer: 'Chrysler',
    years: '2015',
    blurb: 'A modern pushrod V8 with two spark plugs per cylinder and big 2.14 in intake valves. The twin plugs burn the charge fast, so it needs less spark advance than a one-plug engine.',
    factory: {
      // 2015 Jeep Grand Cherokee SRT: 475 hp @ 6000, 470 lb-ft @ 4300 (Jeep's launch
      // release; cars.com specifications).
      crankHp: 475, crankHpRpm: 6000,
      crankTq: 470, crankTqRpm: 4300,
      displacementL: 6.42,
    },
    engine: {
      configuration: 'V8',
      // 103.9 x 94.6 mm, 10.9:1, iron block, aluminium heads, 2.14 in intake valves, two
      // plugs per cylinder (Chrysler; Ward's: two plugs "to get the burn rate we needed").
      bore: 103.9, stroke: 94.6,
      compression: 10.9,
      blockMaterial: 'Cast Iron', headMaterial: 'Aluminum', injection: 'port', sparkPlugs: 2,
      valvetrain: 'ohv', valvesPerCyl: 2, follower: 'roller', intakeValveMm: 54.4,
      // A 2011-on design, so the published friction level; nothing measured for it.
      frictionLevel: 'modern',
      // Fitted: power -0.9%, torque +1.9% (predicted), within 1 hp of peak from 5800,
      // peaking at 5900 against a published 6000. 212 lands power nearer (-0.2%) but stays flat to the 6400 limiter,
      // which the real engine does not; 210 is the longest cam whose power falls before it.
      // REFITTED for the rich-flame chemistry (thermo.js, heatReleasedShare): a rich mixture
      // now releases only what its CO and H2 leave it, about 4% less heat per kg of air at
      // full-throttle lambda, so duration came up until power is on the rating again.
      camDuration: 220, springRate: 60,
      redline: 6400,
    },
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    // Factory injectors are about 40 lb/hr (about 420 cc/min): the 440 cc option.
    parts: { injectorIdx: 1, exhaustDiaIdx: 4, octaneIdx: 0 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  },
];

/**
 * The turbine as fitted, with its flow area scaled by how many of them there are.
 *
 * @param {Preset} preset
 * @returns {object|null}
 */
export function presetTurbine(preset) {
  const { turboOn, turbineIdx, turbineCount = 1 } = preset.induction;
  if (!turboOn) return null;
  return turbineWithCount(TURBINE_OPTS[turbineIdx], turbineCount);
}

/**
 * The compressors as fitted: one per turbo, so a twin-turbo engine has two.
 *
 * @param {Preset} preset
 * @returns {object}
 */
export function presetCompressor(preset) {
  const { compressorIdx, turbineCount = 1 } = preset.induction;
  return compressorWithCount(COMPRESSOR_OPTS[compressorIdx], turbineCount);
}

/** The induction hardware bundle `computeHardwareVE` expects. */
function hardwareFor(preset) {
  const { turboOn, boost } = preset.induction;
  return {
    turboOn,
    // Every turbine the engine carries, as the app's own hardware does (pullInputs):
    // a twin-turbo engine breathes against two housings, not one.
    turbine: presetTurbine(preset),
    exhaustDia: EXHAUST_DIA_OPTS[preset.parts.exhaustDiaIdx].dia,
    fuel: preset.fuel ?? OCTANE_OPTS[preset.parts.octaneIdx],
    peakBoostPsi: turboOn ? Math.max(...boost) : 0,
  };
}

/**
 * The breakpoints a preset's tables are generated on when none are asked for: sized to
 * the engine (`engineLayout`), from cranking to just past its rev limit and from overrun
 * to just past the most manifold pressure it makes.
 *
 * @param {Preset} preset
 * @param {{rpmCount?: number, loadCount?: number}} [depth] the target computer's table size
 * @returns {import('./layouts.js').Layout}
 */
export function presetLayout(preset, depth = {}) {
  return engineLayout({
    redline: preset.engine.redline ?? 7000,
    peakMapKpa: peakMapKpaOf({ turboOn: preset.induction.turboOn, boostCurve: preset.induction.boost }),
    ...depth,
  });
}

/**
 * Generates the factory calibration for a preset, on any layout: the engine-sized one
 * by default, or an engine computer's own breakpoints.
 *
 * Order matters: VE first (it is the physical truth), then FUEL (the knock model
 * needs the mixture), then SPARK (which is knock-limited given that mixture).
 *
 * The airflow every cell is written for is the engine's own breathing at that speed and
 * pressure (`hardwareVeAt`), not a value read off a coarser grid: a table cell at 9000 RPM
 * is the engine at 9000 RPM. A spark table indexed by air per cylinder is solved at the
 * manifold pressure that traps that much air at that speed, which is the cell an engine
 * computer reading its own airmass looks up.
 *
 * @param {Preset} preset
 * @param {import('./layouts.js').Layout|string|null} [layout] the engine-sized layout when absent
 * @returns {{ve: number[][], timing: number[][], afr: number[][], mafScalar: number, layout: import('./layouts.js').Layout,
 *   ecu: ReturnType<typeof defaultEcuCalibration>, boost: number[]}} `ecu` is the engine management the
 *   tables go with; `boost` the boost target curve the factory runs them at
 */
export function factoryCalibration(preset, layout = null) {
  const L = layout ? layoutById(layout) : presetLayout(preset);
  const derived = deriveEngine(preset.engine);
  const fuel = preset.fuel ?? OCTANE_OPTS[preset.parts.octaneIdx];
  const hw = hardwareFor(preset);
  // An engine with cam phasers is calibrated with them working: the factory schedule puts
  // the intake cam where it fills the cylinder best, on the ECU's own VVT breakpoints, and
  // every table below is written for the cylinder filling at that phase.
  const ecu = defaultEcuCalibration({ derived, gate: DEFAULT_ECU_HW.gate, axes: L.timing });
  const schedule = factoryIntakeSchedule(preset.engine, preset.mods, hw, ecu.vvt.intakeTarget.x, ecu.vvt.intakeTarget.y);
  if (schedule) ecu.vvt.intakeTarget = { ...ecu.vvt.intakeTarget, z: schedule };
  const veAt = scheduledVeAt(preset.engine, preset.mods, hw, schedule ? ecu.vvt : null);
  const camAt = schedule ? intakeCamAt(preset.engine, ecu.vvt) : null;

  // Boost actually present at a cell, read off the MAP the cell is indexed by rather than
  // off the preset's boost curve keyed by RPM: a generated table has to be a valid,
  // self-consistent surface at every pressure, whatever this curve reaches at this speed.
  const boostAt = (kpa) => (preset.induction.turboOn && kpa > BARO_KPA ? Math.max(0, (kpa - BARO_KPA) / PSI_TO_KPA) : 0);

  // A turbo (or a bigger intake) changes the airflow profile across the MAF, so at a
  // scalar of 1 the ECU under-reads true air by this factor — see `mafErrorFactor` in
  // sweep.js. A FACTORY calibration was made on its own intake and turbo plumbing, so its
  // MAF calibration already cancels it: the scalar is the reciprocal, the ECU reads the
  // true air, and the fuel table commands exactly the mixture it wants delivered.
  const mafScalar = Number((1 / mafErrorFactor(preset.mods, preset.induction.turboOn)).toFixed(3));
  const turbine = presetTurbine(preset);

  // A spooled turbo at part throttle still compresses, and heats, the air upstream of the
  // plate. The dyno and LIVE solve that (`solveInduction`), and so does the advisor
  // (`inductionAtMap`), so the generator must too.
  const memo = new Map();
  const inductionAt = (rpm, kpa) => {
    if (!preset.induction.turboOn) return null;
    const key = `${rpm}:${kpa.toFixed(3)}`;
    if (!memo.has(key)) {
      memo.set(key, inductionAtMap({
        rpm, mapKpa: kpa, boostTargetPsi: curveAt(preset.induction.boost, rpm), turbine,
        compressor: presetCompressor(preset), veAt: (m) => veAt(rpm, m), derived,
        intakeKAt: (b) => chargeTempK(b, preset.mods.intercooler),
      }));
    }
    return memo.get(key);
  };
  const boostPsiAt = (rpm, kpa) => inductionAt(rpm, kpa)?.boostPsi ?? boostAt(kpa);
  const sweptM3 = (derived.displacementL / derived.cyl) / 1000;
  const chargeKAt = (rpm, kpa) => chargeTempK(boostPsiAt(rpm, kpa), preset.mods.intercooler);
  const airAt = (rpm, kpa) => trappedAirGrams({ veActual: veAt(rpm, kpa), mapKpa: kpa, chargeK: chargeKAt(rpm, kpa), sweptM3 });
  /** Manifold pressure for a load-axis value: itself, or the pressure trapping that air. */
  const kpaOf = (axes, rpm, v) => {
    if (axes.loadUnit === 'kPa') return v;
    const g = axes.loadUnit === 'mg/cyl' ? v / 1000 : v;
    let lo = 5; let hi = 600;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (airAt(rpm, mid) < g) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const loadOf = (axes, rpm, kpa) => (axes.loadUnit === 'kPa' ? kpa : airAt(rpm, kpa) * (axes.loadUnit === 'mg/cyl' ? 1000 : 1));
  const grid = (axes, f) => axes.load.map((v) => axes.rpm.map((rpm) => f(rpm, kpaOf(axes, rpm, v))));

  // VE: the engine's breathing at each cell. FUEL: stoichiometric where a real ECU runs
  // closed loop, best-power enrichment above.
  const ve = grid(L.ve, (rpm, kpa) => Number(veAt(rpm, kpa).toFixed(1)));
  const afr = grid(L.afr, (rpm, kpa) => (kpa < OPEN_LOOP_KPA ? 14.7 : Number(bestPowerAfr(boostPsiAt(rpm, kpa)).toFixed(2))));

  // SPARK: MBT where there is margin for it, knock-limited minus the factory safety
  // margin where there is not. That is what a production calibration is. Knock is
  // evaluated against the mixture the engine will ACTUALLY see: the fuel table just
  // written, read the way the running ECU reads it (interpolated to whatever pressure is
  // asked about, between rows too), then un-corrected for the MAF error it was
  // pre-compensated with. That is `evaluatePoint`'s own arithmetic.
  const cellAt = (rpm, kpa) => {
    const induction = inductionAt(rpm, kpa);
    const boostPsi = induction ? induction.boostPsi : boostAt(kpa);
    const veActual = veAt(rpm, kpa);
    const afrCommanded = readTable(afr, L.afr, rpm, loadOf(L.afr, rpm, kpa));
    // The ECU fuels for the air its VE table CLAIMS. Between rows that is the table's
    // straight-line blend, and breathing is not a straight line in pressure, so the real
    // mixture there is off by truth / table — leaner where the blend under-reads. Exact
    // on the rows themselves; it is the between-row mixture the interpolation walk below
    // has to protect (point.js: airChargeBelievedG).
    const veTable = readTable(ve, L.ve, rpm, loadOf(L.ve, rpm, kpa));
    const lambda = (afrCommanded / 14.7) / effectiveMafFactor(mafErrorFactor(preset.mods, preset.induction.turboOn) * mafScalar, kpa)
      * (veActual / veTable);
    const chargeK = chargeTempK(boostPsi, preset.mods.intercooler);
    const airChargeG = trappedAirGrams({ veActual, mapKpa: kpa, chargeK, sweptM3 });
    const exhaustFlowKgS = (airChargeG / 1000) * (1 + 1 / (fuel.stoich * lambda)) * derived.cyl * (rpm / 2) / 60;
    const empKpa = induction ? induction.empKpa : exhaustManifoldKpa({
      turboOn: preset.induction.turboOn, exhaustFlowKgS, turbine,
      exhaustK: exhaustTempK({ chargeIndex: chargeIndexOf(veActual, kpa), lambda }),
    });
    // The generator asks the physics the same question the running ECU asks — how much
    // spark will this cylinder take — by solving the same cycle. Burnable mass releases
    // the heat; delivered mass evaporates and cools the charge, split as point.js splits it.
    const deliveredFuelG = airChargeG / (fuel.stoich * lambda);
    // At the cam phase the schedule puts the intake cam: advance closes the intake valve
    // earlier, raising effective compression, which is what the knock limit answers to.
    const cyc = cycleInputsFor({
      rpm, mapKpa: kpa, empKpa, intakeK: chargeK, airChargeG,
      burnedFuelG: Math.min(deliveredFuelG, airChargeG / fuel.stoich), fuelMassG: deliveredFuelG, lambda, fuel, derived,
      ...(camAt ? { cam: { intakeAdvDeg: camAt(rpm, kpa) } } : {}),
    });
    return { safe: knockLimitedSpark(cyc) - FACTORY_KNOCK_MARGIN_DEG, mbt: mbtFromBurn(cyc.burnDeg) };
  };
  // A FACTORY BOOST TARGET NEVER ASKS FOR PRESSURE ITS SPARK TABLE CANNOT PROTECT. Where
  // even the most retard the table can hold is past the knock limit at the published boost
  // (low speed, full boost: the longest time the end gas has to light itself), a
  // production calibration limits boost there instead — the low-speed torque or boost
  // limit every turbo ECU carries. Stepped down by half a psi until spark can protect it.
  const curveRpm = preset.induction.boost.length === CURVE_RPM.length ? CURVE_RPM : RPM;
  const boost = preset.induction.boost.map((psi, i) => {
    if (!preset.induction.turboOn || psi <= 0) return psi;
    let p = psi;
    while (p > 0 && cellAt(curveRpm[i], BARO_KPA + p * PSI_TO_KPA).safe < SPARK_MIN_DEG) p -= 0.5;
    return Math.max(0, p);
  });

  const T = L.timing;
  // Which cells can knock at all: a row gap between two that cannot needs no check
  // between them, because knock only gets likelier with pressure.
  const unbounded = T.load.map(() => T.rpm.map(() => false));
  const timing = T.load.map((v, ri) => T.rpm.map((rpm, ci) => {
    const { safe, mbt } = cellAt(rpm, kpaOf(T, rpm, v));
    unbounded[ri][ci] = safe >= COEFF.KNOCK_UNBOUNDED_BTDC - FACTORY_KNOCK_MARGIN_DEG;
    return Number(clamp(Math.min(mbt, safe), SPARK_MIN_DEG, SPARK_MAX_DEG).toFixed(1));
  }));

  // THE TABLE HAS TO BE SAFE BETWEEN ITS ROWS, NOT ONLY ON THEM. The ECU reads the table
  // interpolated, so between two rows the cylinder gets a blend at a pressure no row sits
  // on, and the knock ceiling falls faster than the blend does (#43, #46). Same
  // constraint and direction of walk as the advisor: from the most boosted row down, so
  // the excess comes out of the cell reaching up into pressure it does not have to carry.
  // Asked at the preset's PEAK boost at every speed: a factory table has to be a valid
  // surface at every pressure, not only the ones this curve reaches at this speed.
  const peakBoostCurve = CURVE_RPM.map(() => Math.max(0, ...preset.induction.boost));
  T.rpm.forEach((rpm, ci) => {
    const reachKpa = reachableKpa({ turboOn: preset.induction.turboOn, boostCurve: peakBoostCurve, rpm });
    const reach = loadOf(T, rpm, reachKpa);
    for (let ri = 1; ri < T.load.length; ri += 1) {
      const span = T.load[ri - 1] - T.load[ri];
      const entered = clamp((reach - T.load[ri]) / span, 0, 1);
      if (entered <= 0 || (unbounded[ri][ci] && unbounded[ri - 1][ci])) continue;
      const room = interpolationRoomDeg({
        ceilingAtFrac: (f) => cellAt(rpm, kpaOf(T, rpm, T.load[ri] + f * span)).safe,
        aboveDeg: timing[ri - 1][ci],
        entered,
      });
      if (room < timing[ri][ci]) timing[ri][ci] = Number(clamp(Math.floor(room * 2) / 2, SPARK_MIN_DEG, SPARK_MAX_DEG).toFixed(1));
    }
  });
  // Tables written for the boost the engine will actually be asked for: where the limit
  // took boost out, the calibration is generated again at the limited curve (once — the
  // limit is already met there), so RESET, which starts from that curve, gives it back.
  if (boost.some((b, i) => b !== preset.induction.boost[i])) {
    return factoryCalibration({ ...preset, induction: { ...preset.induction, boost } }, layout);
  }
  return { ve, timing, afr, mafScalar, layout: L, ecu, boost };
}

/**
 * The factory calibration on an engine computer's own breakpoints (layouts.js), or on the
 * engine-sized layout when `layout` is null. Kept for callers written before every
 * calibration could take a layout.
 *
 * @param {Preset} preset
 * @param {import('./layouts.js').Layout|string|null} layout
 */
export function factoryCalibrationOn(preset, layout) {
  return factoryCalibration(preset, layout);
}

/**
 * Everything the app needs to switch to this engine, as one patch.
 *
 * Returned rather than applied, so preset behaviour is testable without React.
 *
 * @param {Preset} preset
 * @returns {object} a complete state patch
 */
export function applyPreset(preset, layout = null) {
  const { ve, timing, afr, mafScalar, layout: L, ecu, boost } = factoryCalibration(preset, layout);
  return {
    presetId: preset.id,
    mafScalar,
    // A catalogue engine's own reciprocating assembly, rated to its own factory limiter:
    // raise the redline past that and BUILD and the pull log say the parts are past it.
    engineConfig: { ...preset.engine, bottomEndRatedRpm: preset.bottomEndRatedRpm ?? preset.engine.redline },
    mods: { ...preset.mods },
    turboOn: preset.induction.turboOn,
    // The published boost, limited where the spark table cannot protect it (factoryCalibration).
    boostCurve: boost,
    turbineIdx: preset.induction.turbineIdx,
    turbineCount: preset.induction.turbineCount ?? 1,
    compressorIdx: preset.induction.compressorIdx,
    injIdx: preset.parts.injectorIdx,
    ecuInjectorCc: INJECTOR_OPTS[preset.parts.injectorIdx].cc,
    octaneIdx: preset.parts.octaneIdx,
    exhaustDiaIdx: preset.parts.exhaustDiaIdx,
    ve, timing, afr,
    // The breakpoints the three tables are on, kept with them.
    layout: L,
    // The engine management a factory ships with: its knock threshold is set to this
    // engine's own valvetrain noise, which is why a preset carries its own; and, on an
    // engine with cam phasers, the intake schedule its tables were written for.
    ecu,
  };
}

/**
 * What a player must type to describe an engine of their own, and the range each figure
 * can take: the range the model's physics is checked across, and no wider. The property
 * and consistency tests (tests/physics-invariants.test.js, tests/consistency-fuzz.test.js)
 * build thousands of random engines from exactly these ranges (tests/randomBuilds.js) and
 * hold every one to energy, mass, units and the direction each lever pulls. Widened to a
 * 110 mm bore and 14:1, those tests found engines where enrichment stops cooling the
 * exhaust and the ECU stops matching the open-loop model, so the form refuses such
 * figures rather than show numbers nobody has checked. The stroke reaches 102 mm for the
 * GM LQ4's 101.6.
 *
 * The redline reaches 11,000 RPM. The tables are sized to the engine (layouts.js) and the
 * breathing is worked out at every speed, not read off a grid, so nothing stops at a
 * column. What can stop an engine is its bottom end: the form takes what the pistons and
 * rods are built from (`bottomEnd`), and BUILD and the pull log say when the redline puts
 * them past their mean piston speed (bottomEnd.js). The physics above 7500 RPM is checked
 * against five published high-revving engines (docs/accuracy.md), not against 11,000-RPM
 * ones, of which there are none on sale; past about 9,000 it is extrapolation and BUILD
 * says so.
 *
 * BUILD's sliders use the same ranges, so anything the form accepts, the sliders can show
 * and the player can then adjust.
 */
export const CUSTOM_ENGINE_LIMITS = Object.freeze({
  bore: { min: 75, max: 105, step: 0.5, unit: 'mm', why: 'Outside this range the simulator\'s physics has not been checked.' },
  stroke: { min: 65, max: 102, step: 0.5, unit: 'mm', why: 'Outside this range the simulator\'s physics has not been checked.' },
  compression: { min: 8.5, max: 13, step: 0.1, unit: ':1', why: 'Outside this range the simulator\'s physics has not been checked.' },
  redline: {
    min: 4000, max: 11000, step: 100, unit: 'rpm',
    why: 'Past 11,000 rpm is racing-engine territory the simulator has no published engine to check against.',
  },
  camDuration: { min: 180, max: 300, step: 2, unit: '°' },
});

/** How far past the limiter a builder's valve springs hold the valves on the cam, RPM. */
const SPRING_MARGIN_RPM = 500;

/**
 * The spring rate that floats the valves SPRING_MARGIN_RPM past a redline with this cam
 * (the inverse of `valveFloatRpm`), never below the stock 50.
 *
 * @param {number} redline
 * @param {number} camDuration
 * @returns {number}
 */
export function springRateFor(redline, camDuration) {
  const needed = 50 + (redline + SPRING_MARGIN_RPM - valveFloatRpm(50, camDuration)) / COEFF.FLOAT_PER_SPRING_RATE;
  return Math.max(50, Math.ceil(needed));
}

/** The most a player's own engine's injectors are sized to be open at full throttle (85 %, the usual rule). */
const INJECTOR_SIZING_MAX_DUTY = 0.85;

/**
 * Checks the figures a player entered for an engine of their own.
 *
 * @param {{configuration?: string, bore?: number|string, stroke?: number|string, compression?: number|string,
 *   redline?: number|string, camDuration?: number|string|null, injection?: string, valvetrain?: string,
 *   valvesPerCyl?: number|string, blockMaterial?: string, headMaterial?: string, bottomEnd?: string}} spec
 * @returns {{ok: true, engine: import('./engine.js').EngineConfig, estimated: string[], assumed: string[]}
 *   | {ok: false, errors: Record<string, string>}} `estimated` names every figure that was
 *   not entered and so was filled with a stated typical value; `assumed` is the same figures'
 *   `EngineConfig` keys, which the app keeps so the engine screen can say so until they are set
 */
export function validateCustomEngine(spec) {
  /** @type {Record<string, string>} */
  const errors = {};
  const num = (key) => {
    const raw = spec[key];
    if (raw === '' || raw == null) { errors[key] = 'Required.'; return null; }
    const v = Number(raw);
    const lim = CUSTOM_ENGINE_LIMITS[key];
    if (!Number.isFinite(v)) { errors[key] = 'Enter a number.'; return null; }
    if (v < lim.min || v > lim.max) { errors[key] = `Between ${lim.min} and ${lim.max} ${lim.unit}.${lim.why ? ` ${lim.why}` : ''}`; return null; }
    return v;
  };
  if (!CONFIG_OPTS.includes(spec.configuration)) errors.configuration = 'Choose the cylinder layout.';
  const bore = num('bore');
  const stroke = num('stroke');
  const compression = num('compression');
  const redline = num('redline');
  /** @type {string[]} */
  const estimated = [];
  /** @type {string[]} */
  const assumed = [];
  let camDuration = 210;
  if (spec.camDuration === '' || spec.camDuration == null) { estimated.push('cam duration (210° assumed)'); assumed.push('camDuration'); }
  else {
    const v = Number(spec.camDuration);
    const lim = CUSTOM_ENGINE_LIMITS.camDuration;
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) errors.camDuration = `Between ${lim.min} and ${lim.max} ${lim.unit}, or leave blank.`;
    else camDuration = v;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const bottomEnd = BOTTOM_END_OPTS.some((o) => o.id === spec.bottomEnd) ? spec.bottomEnd : DEFAULT_BOTTOM_END;
  const valvetrain = /** @type {'ohv'|'sohc'|'dohc'} */ (VALVETRAIN_OPTS.some((o) => o.id === spec.valvetrain) ? spec.valvetrain : 'dohc');
  const valvesPerCyl = /** @type {2|3|4|5} */ (VALVES_PER_CYL_OPTS.includes(Number(spec.valvesPerCyl)) ? Number(spec.valvesPerCyl) : 4);
  if (!spec.valvetrain) { estimated.push('valvetrain (DOHC assumed)'); assumed.push('valvetrain'); }
  if (!spec.valvesPerCyl) { estimated.push('valves per cylinder (4 assumed)'); assumed.push('valvesPerCyl'); }
  const material = (m) => (MATERIAL_OPTS.includes(m) ? m : 'Aluminum');
  if (!spec.blockMaterial) { estimated.push('block material (aluminium assumed)'); assumed.push('blockMaterial'); }
  if (!spec.headMaterial) { estimated.push('head material (aluminium assumed)'); assumed.push('headMaterial'); }
  if (!spec.injection) { estimated.push('fuel injection (port assumed)'); assumed.push('injection'); }
  if (!spec.bottomEnd) { estimated.push('pistons and rods (production assumed)'); assumed.push('bottomEnd'); }
  return {
    ok: true,
    estimated,
    assumed,
    engine: {
      configuration: /** @type {'I4'|'I6'|'V6'|'V8'} */ (spec.configuration),
      bore: /** @type {number} */ (bore), stroke: /** @type {number} */ (stroke),
      compression: /** @type {number} */ (compression),
      blockMaterial: /** @type {'Cast Iron'|'Aluminum'} */ (material(spec.blockMaterial)),
      headMaterial: /** @type {'Cast Iron'|'Aluminum'} */ (material(spec.headMaterial)),
      injection: spec.injection === 'direct' ? 'direct' : 'port',
      // Valve springs specified for the redline, as a builder specifies them: stiff enough
      // to keep the valves on the cam SPRING_MARGIN_RPM past the limiter, never softer than
      // the stock rate. A 9000-RPM engine on stock springs floats its valves at 8000, which
      // no one who chose that redline would build.
      camDuration, springRate: springRateFor(/** @type {number} */ (redline), camDuration), redline: /** @type {number} */ (redline),
      valvetrain, valvesPerCyl, bottomEnd,
    },
  };
}

/**
 * Everything the app needs to start on an engine the player described, as one patch: the
 * same shape `applyPreset` returns, with a factory-style calibration generated from the
 * physics for these exact figures (never a table borrowed from another engine), the
 * smallest stock injector that feeds that calibration's own full-throttle airflow at no
 * more than 85 % duty, and the exhaust nearest the ideal diameter. `presetId` is null: it is not a catalogue
 * engine, so nothing may claim to be a published figure.
 *
 * @param {import('./engine.js').EngineConfig} engine from {@link validateCustomEngine}
 * @param {string[]} [assumed] the `assumed` keys from {@link validateCustomEngine}
 * @returns {object} a complete state patch
 */
export function customEnginePatch(engine, assumed = []) {
  const derived = deriveEngine(engine);
  const cylinders = CYL_COUNT[engine.configuration];
  const ideal = idealExhaustDiameter(derived.displacementL);
  const exhaustDiaIdx = EXHAUST_DIA_OPTS.reduce((best, o, i) => (Math.abs(o.dia - ideal) < Math.abs(EXHAUST_DIA_OPTS[best].dia - ideal) ? i : best), 0);
  /** @param {number} injectorIdx @returns {Preset} */
  const adHoc = (injectorIdx) => ({
    id: 'custom', name: 'Your engine', manufacturer: '', years: '', blurb: '',
    factory: { displacementL: derived.displacementL },
    engine,
    induction: { turboOn: false, turbineIdx: 1, compressorIdx: 1, boost: RPM.map(() => 0) },
    parts: { injectorIdx, exhaustDiaIdx, octaneIdx: 0 },
    mods: { intake: false, exhaust: false, headers: false, intercooler: false },
  });
  // Injectors sized from this engine's own full-throttle airflow, cam and all, read off the
  // calibration's VE and fuel tables at every speed up to the redline: each cylinder's fuel
  // per cycle has to fit in 85 % of the cycle, less the injector's dead time. (A flat
  // power-per-litre guess left a 270-degree cam out of injector at the top of its first pull.)
  const fuel = OCTANE_OPTS[0];
  const cal = applyPreset(adHoc(INJECTOR_OPTS.length - 1));
  const speeds = [];
  for (let r = 1500; r < engine.redline; r += 250) speeds.push(r);
  speeds.push(engine.redline);
  const neededCc = Math.max(...speeds.map((rpm) => {
    const airPerCylG = (readEcuTable(cal, 've', rpm, { mapKpa: BARO_KPA }) / 100) * (derived.displacementL / 1000 / cylinders) * RHO_AIR * 1000;
    const fuelPerCylG = airPerCylG / ((readEcuTable(cal, 'afr', rpm, { mapKpa: BARO_KPA }) / 14.7) * fuel.stoich);
    const openMs = INJECTOR_SIZING_MAX_DUTY * (120000 / rpm) - INJ_DEADTIME_MS;
    return (fuelPerCylG * 60000) / (fuel.density * openMs);
  }));
  // The smallest that covers it; the largest stocked when none does.
  const fits = INJECTOR_OPTS.findIndex((o) => o.cc >= neededCc);
  const injectorIdx = fits === -1 ? INJECTOR_OPTS.length - 1 : fits;
  const patch = applyPreset(adHoc(injectorIdx));
  // Not a catalogue engine: its pistons and rods are what the player said they are
  // (`bottomEnd`), not a factory assembly rated to whatever redline was typed.
  const { bottomEndRatedRpm: _rated, ...engineConfig } = patch.engineConfig;
  return { ...patch, engineConfig, presetId: null, assumed };
}

/**
 * The bolt-ons RESET ALL TO STOCK leaves on: none, except an intercooler while a turbo or a
 * supercharger is fitted. The reset keeps the induction hardware (it resets a calibration,
 * it does not uninstall a turbo), and the intercooler is part of it: every factory turbo
 * engine in the catalogue has one. Taking it off left a stock N54 or Golf R logging IAT and
 * EGT protection on its next pull.
 *
 * @param {{mods?: {intercooler?: boolean}, turboOn?: boolean, blowerId?: string|null}} build
 * @returns {{intake: boolean, exhaust: boolean, headers: boolean, intercooler: boolean}}
 */
export function stockModsOf(build) {
  const forced = !!build.turboOn || !!build.blowerId;
  return { intake: false, exhaust: false, headers: false, intercooler: forced && !!build.mods?.intercooler };
}

/**
 * The factory-style calibration for the hardware on the bench, with its bolt-ons taken off
 * (`stockModsOf`): what RESET ALL TO STOCK writes. Generated from the physics for THIS engine, fuel and
 * boost, exactly as a catalogue preset's own is, so it is knock-safe on a turbo or a big V8
 * as much as on the Nissan V6 the generic tables were drawn for.
 *
 * @param {{engineConfig: object, turboOn: boolean, boostCurve: number[], turbineIdx: number,
 *   turbineCount?: number, compressorIdx: number, injIdx: number, exhaustDiaIdx: number,
 *   octaneIdx: number, ethanolPct?: number, mods?: object, blowerId?: string|null}} build the BUILD
 *   slice (or the fields of it named)
 * @param {import('./layouts.js').Layout|string|null} [layout] the breakpoints to write on: the
 *   tune's own, so a reset changes the numbers and not the axes the player is looking at
 * @returns {ReturnType<typeof factoryCalibration>}
 */
export function stockCalibrationFor(build, layout = null) {
  /** @type {Preset} */
  const hardware = {
    id: 'stock', name: 'Stock', manufacturer: '', years: '', blurb: '',
    factory: {},
    engine: /** @type {any} */ (build.engineConfig),
    induction: {
      turboOn: build.turboOn, turbineIdx: build.turbineIdx, turbineCount: build.turbineCount ?? 1,
      compressorIdx: build.compressorIdx, boost: build.boostCurve,
    },
    parts: { injectorIdx: build.injIdx, exhaustDiaIdx: build.exhaustDiaIdx, octaneIdx: build.octaneIdx },
    mods: stockModsOf(build),
    fuel: tankFuel(/** @type {any} */ (build)),
  };
  return factoryCalibration(hardware, layout);
}

/**
 * Finds a preset by id.
 * @param {string} id
 * @returns {Preset|undefined}
 */
export const presetById = (id) => ENGINE_PRESETS.find((p) => p.id === id);

/**
 * Presets grouped by manufacturer, in first-appearance order.
 *
 * The picker needs headings once the list outgrows a flat stack of buttons. Deriving
 * the grouping here rather than in the component keeps it assertable in plain Node —
 * the same reason `applyPreset` returns a patch instead of applying one — and means
 * the JSX renders a shape rather than computing one.
 *
 * Order comes from {@link ENGINE_PRESETS} itself, never from a second list kept
 * alongside it. A separate ordering table would be free to drift out of agreement
 * with the presets it claims to order; this cannot.
 *
 * @type {{manufacturer: string, presets: Preset[]}[]}
 */
export const PRESET_GROUPS = ENGINE_PRESETS.reduce((groups, preset) => {
  const group = groups.find((g) => g.manufacturer === preset.manufacturer);
  if (group) group.presets.push(preset);
  else groups.push({ manufacturer: preset.manufacturer, presets: [preset] });
  return groups;
}, /** @type {{manufacturer: string, presets: Preset[]}[]} */ ([]));
