/**
 * Engine acoustics — the physics of what the engine SOUNDS like.
 *
 * Sound is the one output of this simulation the player perceives directly rather than
 * reading off a gauge, and until now it was invented in the UI: pitch from RPM, volume
 * from throttle, "V8-ness" from a hand-typed pattern of pulse spacings. None of that is
 * wrong-sounding, but none of it is connected to the engine, so tuning could not change
 * it and the sound could contradict the physics on screen.
 *
 * This module closes that gap. The same rule the rest of `src/sim/` lives by applies:
 * NOTHING ADDS SOUND. Every audible property is derived from a quantity the cycle model
 * already produces, and the UI layer only renders what comes out of here.
 *
 * WHAT AN EXHAUST NOTE ACTUALLY IS
 *
 * When the exhaust valve cracks open, the cylinder is still at several bar while the
 * manifold is near atmospheric. Gas leaves as a sharp pressure pulse — BLOWDOWN — long
 * before the piston starts pushing, and that pulse runs down a system of pipes that
 * reflect, delay and filter it. The note is what comes out of the tailpipe.
 *
 * So this module describes the engine and the pipes, and `src/ui/audio/pulseExhaust.js`
 * turns that description into sound — every firing event computed here, at the crank
 * angles below, played through the exhaust system computed here:
 *
 *   RHYTHM       which crank angle each cylinder fires at and which collector it fires
 *                into — the whole of the cross-plane V8 rumble: `firingEvents`.
 *   EXCITATION   the cylinder pressure at the moment the valve opens, from the cycle's
 *                own peak pressure: `evoPressureKpa`, via `acousticDrive`.
 *   EACH EVENT   the gas leaving through the valve, sample by sample — blowdown, then the
 *                piston's push: `exhaustEvent` — and how it steepens on its way down the
 *                primary: `steepenPulse`.
 *   THE PIPES    every length, area and gas temperature the wave model is built from:
 *                `exhaustGeometry`, each cylinder's own run to its collector,
 *                `primaryLengthsM`, and what the whole system does to a pulse,
 *                `exhaustImpulseResponse`. The speed of sound in them follows EGT, so the
 *                whole system retunes as the engine heats.
 *   UNEVENNESS   cycle-to-cycle combustion variation, which every engine has a little of
 *                (`combustionScatter`) and a lopey idle has a lot of (`cyclicVariation`).
 *
 * The turbocharger is treated the same way: shaft speed comes from the compressor work
 * needed for the boost being made, and the whistle is that shaft speed — not a number
 * that ramps with RPM because ramping sounded about right.
 */

import { COEFF } from './coefficients.js';
import {
  AMBIENT_C, BARO_KPA, COMP_ISEN_EFF, GAMMA_EXP, KELVIN_OFFSET, KPA_PER_BAR, PSI_TO_KPA,
  R_AIR,
} from './constants.js';
import { EVO_ATDC, cylinderVolumeM3 } from './cycle.js';
import { clamp } from './math.js';

/**
 * Calibration numbers for the sound model.
 *
 * Deliberately NOT part of `COEFF`. That object is hashed whole by the behavioural
 * fingerprint, so adding keys to it would move the fingerprint and demand a fixture
 * update on a change that cannot move a single dyno figure — which would train everyone
 * to update the fixture without reading it. Nothing here feeds torque, knock or fuelling;
 * these numbers only shape sound.
 *
 * The rule from `coefficients.js` still holds: no bare magic numbers in the formulas
 * below, every empirical value named and explained here.
 */
export const ACOUSTIC = {
  // --- Exhaust system geometry ---
  // Primary runner length, head to collector. Production headers run 0.35-0.9 m, longer
  // on bigger engines because the ports are further apart and the collector further away.
  //
  // This length matters more than any other for how an engine SOUNDS. A primary is a tube
  // closed at the valve and open at the collector, so it rings at c/4L — 300-450 Hz for
  // real geometry — and that band is where an exhaust note's hard edge lives. Get it wrong
  // and you have a sub-bass thud with no bark, whatever else the model does correctly.
  RUNNER_LENGTH_BASE_M: 0.34,
  RUNNER_LENGTH_PER_LITRE_M: 0.035,
  // Tailpipe distance from the head. Production systems run roughly 2.5-4.5 m; the
  // displacement term stands in for the fact that bigger engines go in bigger cars.
  EXHAUST_LENGTH_BASE_M: 2.55,
  EXHAUST_LENGTH_PER_LITRE_M: 0.13,
  // Rayleigh end correction: an open pipe behaves as if it were 0.6 radii longer than it
  // measures, because the gas just outside the mouth moves with the column.
  PIPE_END_CORRECTION: 0.6,

  // --- Exhaust system geometry, for `exhaustImpulseResponse` ---
  // The exhaust is modelled as what it is: tubes carrying pressure waves that reflect off
  // every area change. These are the dimensions that model needs, and each one is a real
  // measurable part rather than a filter setting.
  //
  // PRIMARY TUBE DIAMETER. A header primary is sized from the cylinder it serves. Two
  // anchors from production and race practice bracket it: about 1.625" for a 500 cc
  // cylinder and about 1.375" for a 250 cc one. Those two put diameter on the fourth root
  // of swept volume, which is what is used here.
  PRIMARY_DIA_REF_M: 0.0413,
  PRIMARY_DIA_REF_CC: 500,
  PRIMARY_DIA_EXP: 0.25,
  // COLLECTOR AREA, as a fraction of the summed primary area feeding it. A merge collector
  // is deliberately a little smaller than the sum of its primaries — that is what makes it
  // a merge rather than a plenum, and it is why the reflection it sends back is mild.
  COLLECTOR_AREA_FRAC: 0.88,
  // How much of the total run is header-and-collector rather than tailpipe.
  COLLECTOR_TO_TAIL_FRAC: 0.22,
  // MUFFLER. A reactive muffler is an expansion chamber: the pipe opens into a volume
  // several times its own area and then necks back down, and each of those steps reflects.
  // The chamber length sets which frequencies it cancels — a half wavelength in the chamber
  // comes back in antiphase — and the area ratio sets how hard it does it.
  MUFFLER_AREA_RATIO: 2.2,
  MUFFLER_LENGTH_M: 0.36,
  // How much a packed muffler absorbs per pass, as a lowpass corner in Hz for its own
  // length. Glass pack and steel wool eat high frequencies far faster than low ones, and
  // together with the area steps above this lands at about 20 dB off the top and 6 dB off
  // the bottom — which is the point of a muffler: it takes the treble and leaves the boom.
  MUFFLER_ABSORB_HZ: 380,
  // THE CATALYTIC CONVERTER, which is the biggest damper in any road exhaust and is easy
  // to forget because it is not there to be one. It is a honeycomb of channels a
  // millimetre across, and sound crossing it runs into wall friction over an enormous
  // surface area, so it absorbs broadband and hard — a real cat's insertion loss is
  // 10-15 dB across the mid band. Without it the pipes ring on their own between firing
  // events, and at idle, where the excitation is weakest, that ringing is all you hear.
  // `KEEP` is the amplitude that survives one pass; `HZ_M` is its own boundary-layer
  // corner, far lower than open pipe because the channels are far narrower.
  CAT_KEEP: 0.80,
  // A TURBINE IN THE EXHAUST, which is why a turbo car is quiet. The blowdown pulse does
  // not leave through a pipe, it does work on a wheel — the energy that would have become
  // noise becomes shaft power instead, and what gets past is smeared by a rotor sitting in
  // the path. It is the single biggest reason a boosted engine sounds muted and whooshy
  // where the same engine naturally aspirated barks. This is what survives one pass, and
  // the corner is low because a turbine housing is a very effective absorber of the top
  // end in particular.
  TURBINE_KEEP: 0.42,
  TURBINE_HZ_M: 700,
  // LONG-TUBE HEADERS against a cast manifold. Longer primaries of a bigger bore: the
  // quarter-wave drops, so the bark deepens, and the tube is less restrictive so more of
  // the pulse survives to the collector.
  HEADER_LENGTH_MULT: 1.28,
  HEADER_DIA_MULT: 1.10,
  CAT_HZ_M: 1400,
  CAT_LENGTH_M: 0.30,
  // Gas cools on the way down the pipe, so the tailpipe carries a lower speed of sound
  // than the primaries do. A tailpipe runs a few hundred kelvin below the port.
  TAIL_TEMP_FRAC: 0.72,
  // In-cylinder gas at valve opening is hotter than the gas measured downstream.
  CYLINDER_TEMP_FRAC: 1.15,
  // Discharge coefficient of the exhaust valve as an orifice.
  VALVE_CD: 0.72,
  // Wall friction per metre of pipe, as a fraction of wave amplitude lost. Real pipes are
  // lossy, and a model without loss rings like a bell forever.
  WALL_LOSS_PER_M: 0.040,
  // Boundary-layer loss, as a one-pole corner in Hz TIMES METRES — so a longer tube eats
  // treble proportionally harder, which is what makes a long system duller than a short
  // one at the same volume. Anchored at about half a decibel lost at 4 kHz per metre
  // travelled, which is the right order for steel pipe carrying hot gas.
  WALL_LOSS_HZ_M: 4000,
  // How the exhaust valve opens: a ramp of this many CRANK DEGREES to full lift, then a
  // hold, then the same ramp closing. Fixed degrees rather than a fraction of the window,
  // because a bigger cam holds the valve open longer — it does not open it more slowly.
  // Tying the ramp to the window made a 290-degree race cam open lazier than a stock one
  // and come out duller, which is the opposite of what a big cam sounds like.
  CAM_RAMP_DEG: 62,
  // Curvature of that ramp. Below 1 it is convex — off the seat quickly and then easing
  // into full lift, which is what a real lobe's flank does and what puts an edge on the
  // blowdown.
  CAM_RAMP_SHAPE: 0.7,

  // --- Exhaust valve ---
  // Effective exhaust flow area as a fraction of bore area. A valve head runs about
  // 0.36 of the bore and its curtain area at full lift is roughly 0.8 of its own disc,
  // which lands here.
  EXHAUST_FLOW_AREA_FRAC: 0.13,
  // Cylinder pressure at exhaust valve opening with no combustion at all: the floor each
  // exhaust event (`exhaustEvent`) opens its valve from on a closed throttle. A motored
  // cylinder starting from about 20 kPa at intake valve close comes back down to roughly
  // half an atmosphere by the time the crank is 130 degrees past top dead centre, so the
  // exhaust pipe is HIGHER than the cylinder and the first thing that happens when the
  // valve opens is that gas goes the wrong way. That is what an overrun is, and it is why
  // it is quiet.
  MOTORED_EVO_KPA: 48,

  // --- Cycle-to-cycle variation ("lope") ---
  // Below this much valve overlap an engine simply does not loaf. A stock cam is 0 and
  // must render as 0 — anything else puts a wobble on an engine that idles smoothly.
  LOPE_OVERLAP_MIN_DEG: 1.5,
  // How much variation each degree of overlap buys, and the ceiling. 44 degrees (a
  // 290-degree cam) reaches 0.57, which is a thoroughly lumpy idle; a 230-degree cam
  // reaches 0.14 and merely sounds alive.
  LOPE_PER_OVERLAP_DEG: 0.013,
  LOPE_MAX: 0.60,
  // Where lope is measured from, and how fast it washes out with engine speed.
  LOPE_IDLE_RPM: 800,
  LOPE_FADE_RPM: 2000,
  // How much of one cycle's weakness carries into the next.
  //
  // This is the PRIOR-CYCLE EFFECT and it is why a lopey idle loafs instead of buzzing. A
  // weak cycle burns less of its charge, leaves more residual, and dilutes the cycle after
  // it. Published lag-one autocorrelations of IMEP in dilute spark ignition sit around
  // 0.3-0.6. The renderer needs this, not the sim: the same amount of variation without
  // memory produces a fizz.
  COV_PERSISTENCE: 0.55,
  // How much the cylinder pressure at valve opening scatters from one cycle to the next on
  // an engine that idles smoothly, as a coefficient of variation: a floor that is there at
  // any load, plus what light load adds. Combustion is never identical twice — the
  // turbulence the charge is burning in is different every cycle. Published CoV of IMEP
  // runs 1-2% at wide-open throttle and 4-8% at a light idle, and the pressure late in
  // the stroke scatters two to three times as much as the work does, because a burn that
  // runs slow leaves its heat in the gas rather than on the piston. This scatter is most of
  // why a real engine never repeats itself, and a synthesiser without it does.
  COV_FLOOR: 0.05,
  COV_LIGHT_LOAD: 0.125,
  // Cylinder-to-cylinder spread in charge, as a fraction. Runners are different lengths,
  // injectors flow a percent or two apart, and the cylinder at the end of the plenum
  // breathes differently from the one in the middle. It is fixed for an engine, so it
  // repeats every cycle — which is what puts the half-order lines between the firing
  // harmonics, the "character" two engines of the same layout do not share.
  CYLINDER_SPREAD: 0.035,

  // --- Exhaust event ---
  // Where the exhaust valve closes, crank degrees after TDC firing: past exhaust TDC (360)
  // by half the overlap and a little more, because the lobe is centred there.
  EVC_ATDC_BASE: 368,
  // Mean pressure in the exhaust port above the barometer, kPa: what the cylinder blows
  // down against. It rises with how hard the system is being driven — a stock system at
  // full power carries tens of kPa of back pressure.
  PORT_BACK_KPA: 4,
  PORT_BACK_PER_DRIVE_KPA: 30,

  // --- The exhaust as a system of tubes, for its impulse response ---
  // How much of an arriving wave the valve end sends back. A shut valve is a rigid wall
  // (+1); the cylinder behind an open one, and the other primaries meeting at the
  // collector, let some of it go. Between the two.
  VALVE_END_REFLECTION: 0.6,
  // A catalytic converter's shell is wider than the pipe either side of it, by about this
  // much in area — which is itself a reflection at each end.
  CAT_AREA_RATIO: 2.4,
  // How the run between the converter and the tailpipe splits either side of the muffler.
  MID_PIPE_FRAC: 0.45,
  // An open pipe end reflects low frequencies almost completely and inverted, and lets
  // high ones out: the change-over is where the wavelength reaches the pipe's
  // circumference, ka = 1. As a one-pole corner, this fraction of c / (2 pi a).
  OPEN_END_CORNER_FRAC: 0.6,
  // A straight-through cat-back's muffler: a perforated tube in packing, with far less
  // expansion and absorption than a stock reactive box.
  CATBACK_MUFFLER_AREA_RATIO: 1.3,
  // A STOCK MUFFLER as the tube model sees it: two chambers in a shell many times the
  // pipe's area — an oval box round a 2.5" pipe is 4 to 5 — joined by a short neck. Each area step
  // sends back most of what reaches it, and the packing in each chamber absorbs the rest
  // of the treble. That is what a real muffler's 20-40 dB of loss above a few hundred
  // hertz comes from; one shallow chamber lets the edge of every pulse straight through,
  // which is heard as ticking.
  STOCK_MUFFLER_AREA_RATIO: 4.5,
  // The two chambers are never the same length: each cancels a band a quarter-wave above
  // its own length, and two equal ones stack their cancellations on one band — which would
  // take the bark out of every engine at once.
  STOCK_MUFFLER_SPLIT: 0.7,
  // How much faster a stock muffler's packing absorbs than MUFFLER_ABSORB_HZ alone, per
  // chamber: a road muffler's packing is a thin blanket round a perforated tube, not a
  // chamber stuffed full, and with two chambers and the reflections between them it still
  // takes 15-20 dB off by 2 kHz.
  STOCK_ABSORB_MULT: 2.5,
  // The steepest a steepened pulse's front may get, as the least spacing between
  // successive samples once each has moved by its own travel time. A fifth of a sample
  // lets a front sharpen fivefold, which is a shock in all but name.
  SHOCK_MIN_STEP: 0.2,
  STOCK_MUFFLER_NECK_M: 0.09,
  CATBACK_ABSORB_MULT: 3.5,
  // A V's two banks never have identical pipework: the crossover, the routing past the
  // gearbox and the tailpipe placement leave one side a little longer.
  BANK_LENGTH_SPLIT: 0.07,
  // A cast manifold runs the outer cylinders further to the collector than the inner
  // ones: this much extra length per cylinder of distance from the middle, as a fraction
  // of the mean primary. Tuned headers are equal length to within a few percent.
  MANIFOLD_LENGTH_SPREAD: 0.22,
  HEADER_LENGTH_SPREAD: 0.03,
  // FLOW DAMPS THE PIPES. Everything above is for still gas, which is close to true at
  // idle, where the exhaust's mean flow barely reaches Mach 0.01. At full power it runs at
  // Mach 0.2 down the tailpipe, and a pipe carrying turbulent flow damps a wave far
  // harder than a still one:
  //   - the turbulent wall layer takes energy out of every pass at a rate that scales
  //     with the flow's Mach number and the tube's length over its diameter, the way the
  //     pressure drop does (FRICTION is that scale, near a steel pipe's friction factor);
  //   - the flow grazing a muffler's perforated core and a converter's channels raises
  //     their resistance in proportion to its speed, so they absorb further down the
  //     band (CORNER is how fast each section's lowpass corner falls per unit of Mach).
  // So an idling engine rings in its pipes, and one at full noise does not. Its note is
  // then carried by the firing pulses themselves rather than by the pipes' own
  // resonances, which is why a revving engine sounds like a rising note and not a
  // buzzing box.
  FLOW_FRICTION: 0.03,
  FLOW_CORNER: 2.5,
  // How finely the renderer steps the mean flow's Mach number when it recomputes the
  // response. Fine enough that a step is inaudible under the crossfade.
  FLOW_MACH_STEP: 0.02,
  // Where the response stops being worth computing: this far below its peak, or this long.
  IR_FLOOR_DB: -60,
  IR_MAX_SECONDS: 0.45,

  // --- Turbocharger ---
  // Radial compressor slip factor: the fraction of tip speed the gas actually leaves
  // with. Euler's turbomachine equation gives specific work = slip x U^2.
  COMPRESSOR_SLIP: 0.65,
  // Exducer (outer) diameter as a multiple of the inducer throat the choke flow implies.
  // Production automotive wheels run 1.3-1.5.
  WHEEL_TRIM_RATIO: 1.4,
  // Choked mass flux for ambient air, kg/s per m^2 of throat: 0.0404 * p0 / sqrt(T0) in
  // SI. This is what turns a compressor's published choke flow into a wheel size.
  CHOKED_FLUX_COEFF: 0.0404,
  // Full blades on a typical automotive compressor wheel (splitters sit between them and
  // do not set the fundamental).
  COMPRESSOR_BLADES: 6,
  // Which shaft order actually reaches the cabin. True blade-pass on a small turbo lands
  // near 20 kHz — measurable, but the intake tract and the bulkhead are a brutal lowpass
  // and what people call "turbo whistle" is the low-order rotating pressure field.
  WHISTLE_SHAFT_ORDER: 1,
  // Bounds on shaft speed, RPM. Small automotive turbos idle their shafts around 20k and
  // are done by 200k; outside that the model has been asked something it cannot answer.
  SHAFT_RPM_MIN: 15000,
  SHAFT_RPM_MAX: 220000,

  // --- Induction ---
  // Reference airflow for induction noise, g/s. Roughly what a 3.5 L engine pulls at its
  // power peak, so the intake reads about 1 there.
  INDUCTION_REF_GPS: 320,
  // Exhaust enthalpy flux that reads as "fully driven", W. The same 3.5 L engine at its
  // power peak passes roughly a quarter of a megawatt out of the pipe — which is a fair
  // reminder of how much of the fuel never reaches the crank.
  EXHAUST_POWER_REF_W: 260000,
};

/**
 * Which exhaust collector each cylinder fires into, in firing order.
 *
 * This is the single most important table in the file, and it is geometry rather than
 * taste. All four configurations here are EVEN-FIRING at the crank — a firing event
 * every 720/n degrees — so the raw rhythm at the tailpipe is identical for all of them.
 * What differs is which BANK each event comes out of:
 *
 *   I4, I6   one bank. Every pulse takes the same path, so the train is uniform.
 *   V6       a 60-degree V with split crankpins alternates banks cleanly, so each bank
 *            gets three evenly spaced pulses 240 degrees apart.
 *   V8       a CROSS-PLANE crank (journals at 90 degrees, the American V8) cannot
 *            alternate. With the usual 1-8-7-2-6-5-4-3 order and odd cylinders on one
 *            bank the sequence is L,R,L,R,R,L,R,L — so each bank fires at intervals of
 *            180, 270, 180 and 90 degrees. THAT is the rumble. It is not a filter, an
 *            LFO or a chosen pattern: it is what a 90-degree crank does to an eight, and
 *            it is why a flat-plane V8 (which alternates perfectly, like the V6 here)
 *            screams instead of burbling.
 */
const BANK_ORDER = {
  I4: [0, 0, 0, 0],
  I6: [0, 0, 0, 0, 0, 0],
  V6: [0, 1, 0, 1, 0, 1],
  V8: [0, 1, 0, 1, 1, 0, 1, 0],
};

/**
 * How far the second bank's pulses arrive behind the first, as a fraction of the average
 * firing gap.
 *
 * WITHOUT THIS A CROSS-PLANE V8 DOES NOT RUMBLE, and that is worth stating plainly.
 * Its two banks fire at 180/270/180/90 degrees each, but they interleave to a perfectly
 * even 90 degrees at the tailpipe — so if both collectors delivered at the same instant
 * the ear would hear an even train and it would sound like anything else. What it
 * actually hears is two markedly different pulse trains arriving down two collectors of
 * different length, merged well downstream, and that offset pairs the pulses up: the gaps
 * alternate roughly 1.28 and 0.72 of the average instead of sitting at 1.0.
 *
 * The 60-degree V6's banks are even and short-coupled, so the same offset would only
 * smear an already-even train; it gets none. Inline engines have one bank and no offset
 * to have.
 */
const BANK_OFFSET_FRAC = { I4: 0, I6: 0, V6: 0, V8: 0.28 };

/**
 * @typedef {object} FiringEvent
 * @property {number} angleDeg crank angle of the firing event within the 720-degree cycle
 * @property {number} bank which exhaust collector it leaves through, 0 or 1
 */

/**
 * The firing events of one complete engine cycle, in crank degrees.
 *
 * Even-firing spacing plus the bank map above. The synthesiser plays this directly, one
 * pulse per event, which is why the layouts sound different without anything having to
 * describe how they sound.
 *
 * @param {string} configuration one of `CONFIG_OPTS`
 * @returns {FiringEvent[]} one entry per cylinder, angles ascending from 0
 */
export function firingEvents(configuration) {
  const banks = BANK_ORDER[configuration] || BANK_ORDER.I4;
  const gap = 720 / banks.length;
  const offset = (BANK_OFFSET_FRAC[configuration] ?? 0) * gap;
  return banks
    .map((bank, i) => ({ angleDeg: i * gap + (bank === 1 ? offset : 0), bank }))
    .sort((a, b) => a.angleDeg - b.angleDeg);
}

/**
 * The gaps between one bank's own firing events, in crank degrees.
 *
 * A collector only hears its own bank, so this is the rhythm each half of a V actually
 * carries. Sums to 720 for any bank that fires at all.
 *
 * @param {string} configuration one of `CONFIG_OPTS`
 * @param {number} [bank] which collector, 0 or 1
 * @returns {number[]} intervals in crank degrees, ascending from the first event
 */
export function bankFiringIntervalsDeg(configuration, bank = 0) {
  const angles = firingEvents(configuration).filter((e) => e.bank === bank).map((e) => e.angleDeg);
  if (angles.length === 0) return [];
  return angles.map((a, i) => (i === angles.length - 1 ? 720 + angles[0] - a : angles[i + 1] - a));
}

/**
 * Speed of sound in a gas, m/s.
 *
 * sqrt(gamma * R * T). Worth having explicitly because exhaust gas is both hotter and
 * heavier-molecule than air, and the temperature term is large: the same pipe rings
 * roughly a fifth higher at full load than at idle purely because the gas in it is
 * 300 K hotter. Engines really do sharpen up as they come on song.
 *
 * @param {number} tempK gas temperature, K
 * @param {number} gamma ratio of specific heats for that gas — pass `COEFF.GAMMA_BURNED`
 *   for exhaust, which is well below air's because the products are hot and triatomic
 * @returns {number} speed of sound, m/s
 */
export function soundSpeedMs(tempK, gamma) {
  return Math.sqrt(gamma * R_AIR * Math.max(1, tempK));
}

/**
 * Acoustic length of the exhaust system, m.
 *
 * The measured run plus a Rayleigh end correction, because an open pipe resonates as
 * though it continued a little past its mouth — and a wider tailpipe therefore rings
 * very slightly lower, not higher.
 *
 * @param {{displacementL: number, pipeDiaIn: number}} sys
 * @returns {number} effective length, m
 */
export function exhaustLengthM({ displacementL, pipeDiaIn }) {
  const run = ACOUSTIC.EXHAUST_LENGTH_BASE_M + displacementL * ACOUSTIC.EXHAUST_LENGTH_PER_LITRE_M;
  const radiusM = (pipeDiaIn * 0.0254) / 2;
  return run + ACOUSTIC.PIPE_END_CORRECTION * radiusM;
}

/**
 * Length of one primary runner, head to collector, m.
 *
 * @param {number} displacementL total displacement
 * @returns {number} length, m
 */
export function runnerLengthM(displacementL) {
  return ACOUSTIC.RUNNER_LENGTH_BASE_M + displacementL * ACOUSTIC.RUNNER_LENGTH_PER_LITRE_M;
}

/**
 * Cylinder pressure at the instant the exhaust valve opens, kPa.
 *
 * Reconstructed rather than re-integrated: take the peak pressure the cycle measured and
 * expand the burned gas isentropically from where that peak occurred out to EVO, using
 * the same slider-crank volume and the same burned-gas gamma the cycle itself used. It
 * is one line of thermodynamics on numbers the datalog already reports, which keeps the
 * acoustics out of the cycle's hot loop without inventing a second pressure trace.
 *
 * @param {{peakPressureBar: number, peakPressureDeg: number, compression: number,
 *          displacementL: number, cyl: number}} state
 * @returns {number} pressure at exhaust valve opening, kPa
 */
export function evoPressureKpa({ peakPressureBar, peakPressureDeg, compression, displacementL, cyl }) {
  const sweptM3 = (displacementL / cyl) / 1000;
  const clearanceM3 = sweptM3 / Math.max(1.5, compression - 1);
  const vPeak = cylinderVolumeM3(peakPressureDeg, clearanceM3, sweptM3, COEFF.ROD_RATIO);
  const vEvo = cylinderVolumeM3(EVO_ATDC, clearanceM3, sweptM3, COEFF.ROD_RATIO);
  const expansion = Math.pow(vPeak / vEvo, COEFF.GAMMA_BURNED);
  return peakPressureBar * KPA_PER_BAR * expansion;
}

/**
 * How hard cycle-to-cycle combustion variation makes the engine loaf.
 *
 * This is what a lopey idle IS. Valve overlap at low speed lets exhaust back into the
 * cylinder, so the next charge is diluted by its own residual; past roughly a fifth
 * dilution the flame kernel starts to struggle and some cycles burn weakly or not at
 * all. The engine's output then wanders from cycle to cycle, and that wander is the
 * lump you hear.
 *
 * Note what is NOT here: valve overlap in degrees. Overlap causes residual, the cycle
 * model already computes residual, and driving the sound from the consequence rather
 * than the cause means a build that dilutes its charge some other way lopes too.
 *
 * @param {{rpm: number, overlapDeg?: number}} state
 * @returns {{severity: number}} 0 on a stock cam, rising with overlap and fading with speed
 */
export function cyclicVariation({ rpm, overlapDeg = 0 }) {
  // VALVE OVERLAP, NOT RESIDUAL FRACTION, AND THAT IS A COMPROMISE WORTH READING.
  //
  // Residual is the better physical basis and this function used to use it. It does not
  // work against the residual model we have: `residualFraction` in thermo.js is dominated
  // by the pressure ratio across the cylinder, so at a 40 kPa idle it reports 0.12 for a
  // stock cam and 0.13 for a 290-degree race cam — a 9% spread, where the audible
  // difference between those two engines is total. Worse, it reports a HIGH number for a
  // stock engine at deep vacuum, so driving lope from it made every engine loaf at idle.
  // A stock engine does not loaf. It idles smoothly, and it must sound like it.
  //
  // Overlap separates them cleanly (0 degrees against 44) because overlap is the actual
  // mechanism: it is the window where exhaust can push back into the intake. Until the
  // residual model resolves light-load dilution properly, this is the honest lever.
  const severity = overlapDeg > ACOUSTIC.LOPE_OVERLAP_MIN_DEG
    ? Math.min(ACOUSTIC.LOPE_MAX, overlapDeg * ACOUSTIC.LOPE_PER_OVERLAP_DEG)
    : 0;
  // Fast engines have no time to wander far before the next cycle arrives, and the
  // flywheel filters what is left — so a cammed engine loafs at idle and cleans up on the
  // way to redline.
  const speedFade = clamp(
    1 - (Math.max(0, rpm) - ACOUSTIC.LOPE_IDLE_RPM) / ACOUSTIC.LOPE_FADE_RPM, 0.12, 1,
  );
  return { severity: severity * speedFade };
}

/**
 * How much the cylinder pressure at valve opening scatters from cycle to cycle, as a
 * coefficient of variation.
 *
 * Every engine has some — combustion never runs the same twice — and a light load has more
 * than a heavy one, because a thin, slow-burning charge is at the mercy of the turbulence
 * it lights in. A lumpy cam's dilution sits on top (`cyclicVariation`), and there the
 * scatter is the whole character of the idle.
 *
 * @param {number} load 0 (closed throttle) to 1 (wide open)
 * @param {number} severity from `cyclicVariation`
 * @returns {number} coefficient of variation, 0..1
 */
export function combustionScatter(load, severity = 0) {
  return clamp(ACOUSTIC.COV_FLOOR + ACOUSTIC.COV_LIGHT_LOAD * (1 - clamp(load, 0, 1))
    + Math.max(0, severity), 0, 1);
}

/**
 * One cylinder's exhaust event: the mass flow out through its valve, sample by sample,
 * from the valve cracking open to it closing.
 *
 * This is the SOURCE of the exhaust note, computed rather than drawn. A tailpipe radiates
 * the rate of change of the flow leaving it, so what a listener hears from each event is
 * the shape of this curve — and every part of that shape is the build:
 *
 *   - The valve opens along the cam's flank (`camRampDeg`, `camShape`), so how fast the
 *     flow can rise is fixed in CRANK DEGREES. At idle that takes 13 ms and the event is a
 *     soft, low thud; at 6000 rpm it takes under 2 and the same cylinder cracks.
 *   - The cylinder starts at the pressure the combustion left it at (`evoKpa`, from the
 *     tune: timing, boost, load, fuelling) and blows down through a real orifice — choked
 *     while the pressure ratio is high, subsonic after — so a loaded engine barks and a
 *     closed throttle, which leaves the cylinder BELOW the port, pulls gas back in first.
 *   - Then the piston pushes out what is left (slider-crank, `rodRatio`), a slower and
 *     bigger swell of flow that is most of what an idle is made of.
 *   - Bore sets the valve area, displacement per cylinder and compression set the volume
 *     being emptied, and the gas temperature sets how fast it leaves.
 *
 * The charge expands isentropically as it leaves. Each step's flow is limited to what
 * would bring the cylinder level with the port and no further: without that, the flow
 * chatters either side of equilibrium once the piston is doing the pushing, and that
 * chatter is a whine at half the sample rate.
 *
 * @param {object} args
 * @param {object} args.geometry an {@link exhaustGeometry}
 * @param {number} args.evoKpa absolute cylinder pressure when the valve opens, kPa
 * @param {number} args.rpm engine speed
 * @param {number} args.sampleRate samples per second
 * @param {number} [args.backKpa] absolute pressure in the port, kPa
 * @param {number} [args.closeDeg] exhaust valve closing, degrees after TDC firing
 * @returns {{flow: Float32Array, jet: Float32Array}} mass flow out of the port, kg/s
 *   (negative is backflow), and the Mach number of the jet through the valve seat
 */
export function exhaustEvent({
  geometry, evoKpa, rpm, sampleRate,
  backKpa = BARO_KPA + ACOUSTIC.PORT_BACK_KPA, closeDeg = ACOUSTIC.EVC_ATDC_BASE,
}) {
  const g = geometry.gamma;
  const openDeg = geometry.evoDeg;
  const span = Math.max(1, closeDeg - openDeg);
  const degPerSample = (6 * clamp(rpm, 60, 20000)) / sampleRate;
  const n = Math.max(2, Math.ceil(span / degPerSample));
  const flow = new Float32Array(n);
  const jet = new Float32Array(n);

  const vc = geometry.clearanceM3;
  const vs = geometry.sweptM3;
  const rod = geometry.rodRatio;
  const pb = Math.max(1, backKpa) * 1000;
  const tb = Math.max(300, geometry.portK);
  let theta = openDeg;
  const v0 = cylinderVolumeM3(theta, vc, vs, rod);
  const p0 = Math.max(1, evoKpa) * 1000;
  let m = (p0 * v0) / (R_AIR * Math.max(300, geometry.cylinderK));
  // The charge's isentrope, p = k rho^gamma, fixed at valve opening.
  const isentrope = p0 / Math.pow(m / v0, g);

  const critical = Math.pow(2 / (g + 1), g / (g - 1));
  const choked = Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  // Subsonic orifice flow and the jet's Mach number both come from r^(1/gamma): with
  // b = r^(1/gamma), r^(2/gamma) is b^2, r^((gamma+1)/gamma) is b r and (1/r)^((gamma-1)/
  // gamma) is b / r. One power per sample instead of four, the same numbers.
  const flowCoeff = (2 * g) / (g - 1);
  const machCoeff = 2 / (g - 1);
  const subsonic = (r, b) => Math.sqrt(Math.max(0, flowCoeff * (b * b - b * r)));
  const invG = 1 / g;
  const dt = 1 / sampleRate;
  // How dense the charge is once it is down to the port's pressure, which sets the most
  // that can leave by each step.
  const levelDensity = Math.pow(pb / isentrope, invG);

  for (let i = 0; i < n; i++) {
    const into = theta - openDeg;
    // A cam's flank is acceleration-limited: the valve eases off its seat, speeds up, and
    // eases into full lift — a harmonic rise, not a corner. Opening it along a curve with
    // a vertical start would put a click on the front of every event that no valve makes.
    const ramp = clamp(Math.min(into, span - into) / geometry.camRampDeg, 0, 1);
    const lift = ramp >= 1 ? 1 : Math.pow((1 - Math.cos(Math.PI * ramp)) / 2, geometry.camShape);
    const area = geometry.valveArea * geometry.valveCd * lift;
    // Move the piston first and read the pressure it leaves the trapped gas at. Driving the
    // orifice from that, rather than from the pressure before the step, is what lets the
    // piston's push come out as a smooth flow instead of a step-by-step on-off.
    const vNext = cylinderVolumeM3(theta + degPerSample, vc, vs, rod);
    const p1 = isentrope * Math.pow(m / vNext, g);
    const t1 = (p1 * vNext) / (m * R_AIR);
    // Isentropic orifice flow, whichever way the pressure difference points.
    let mdot;
    let mach = 0;
    if (p1 >= pb) {
      const r = pb / p1;
      if (r <= critical) {
        mdot = (area * p1 * choked) / Math.sqrt(R_AIR * t1);
        mach = 1;
      } else {
        const b = Math.pow(r, invG);
        mdot = (area * p1 * subsonic(r, b)) / Math.sqrt(R_AIR * t1);
        mach = Math.sqrt(machCoeff * Math.max(0, b / r - 1));
      }
    } else {
      const r = p1 / pb;
      const through = r <= critical ? choked : subsonic(r, Math.pow(r, invG));
      mdot = -(area * pb * through) / Math.sqrt(R_AIR * tb);
    }
    // The mass that would leave the cylinder level with the port. The flow may not carry
    // it past that point.
    const mLevel = vNext * levelDensity;
    const most = (m - mLevel) / dt;
    mdot = mdot >= 0 ? Math.min(mdot, Math.max(0, most)) : Math.max(mdot, Math.min(0, most));
    flow[i] = mdot;
    jet[i] = mdot > 0 ? mach : 0;
    m = Math.max(1e-9, m - mdot * dt);
    theta += degPerSample;
  }
  return { flow, jet };
}

/**
 * An exhaust pulse after it has run down the primary and collector: STEEPENED.
 *
 * At full load a blowdown pulse is not a small acoustic wave. The gas in it moves at a
 * good fraction of the speed of sound, and a wave's crest travels at c + (gamma + 1)/2 u
 * while its base travels at c — so over a metre or two of pipe the crest catches the front
 * and the pulse sharpens towards a shock. That is the physics of an exhaust's bark: a hard
 * edge full of harmonics that a small, slow pulse at idle never grows. (It is the same
 * finite-amplitude steepening that makes a trombone played loud sound brassy.)
 *
 * Each sample of the flow is moved earlier by how much sooner its own particle velocity
 * gets it to the end of the run, then the pulse is read back onto the sample grid. Where
 * the crest would overtake the front — a true shock — the front is held at a finite
 * steepness rather than a vertical step, which a sampled signal cannot carry cleanly.
 *
 * @param {Float32Array} flow mass flow out of the port, kg/s, from `exhaustEvent`
 * @param {object} geometry an {@link exhaustGeometry}
 * @param {number} sampleRate samples per second
 * @param {number} [portKpa] absolute port pressure, kPa, which sets the gas density
 * @returns {Float32Array} the flow as it reaches the end of the collector
 */
export function steepenPulse(flow, geometry, sampleRate, portKpa = BARO_KPA + ACOUSTIC.PORT_BACK_KPA) {
  const n = flow.length;
  const out = new Float32Array(n);
  const rho = (Math.max(1, portKpa) * 1000) / (R_AIR * Math.max(300, geometry.portK));
  const c = geometry.cPrimary;
  const beta = (geometry.gamma + 1) / 2;
  // The run in its two sections. The same flow through the collector's larger area moves
  // slower, so the collector sharpens the pulse much less than the primary does.
  const sections = [[geometry.primaryLength, geometry.primaryArea],
    [geometry.collectorLength, geometry.collectorArea]];
  // Where each input sample arrives, in output samples.
  const at = new Float64Array(n);
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    let early = 0;
    for (const [length, area] of sections) {
      const u = flow[i] / (rho * area);
      early += length / c - length / Math.max(c * 0.2, c + beta * u);
    }
    const pos = i - early * sampleRate;
    at[i] = Math.max(pos, last + ACOUSTIC.SHOCK_MIN_STEP);
    last = at[i];
  }
  // Read back onto the grid: each output sample from the pair of inputs that straddle it.
  let k = 0;
  for (let j = 0; j < n; j++) {
    while (k < n - 2 && at[k + 1] < j) k++;
    const span = at[k + 1] - at[k];
    const f = span > 0 ? clamp((j - at[k]) / span, 0, 1) : 0;
    out[j] = j < at[0] ? 0 : flow[k] + f * (flow[k + 1] - flow[k]);
  }
  return out;
}

/**
 * Effective exhaust flow area for one cylinder, m^2.
 *
 * @param {number} boreMm cylinder bore
 * @returns {number} area, m^2
 */
export function exhaustFlowAreaM2(boreMm) {
  const boreM = boreMm / 1000;
  return ACOUSTIC.EXHAUST_FLOW_AREA_FRAC * (Math.PI / 4) * boreM * boreM;
}

/**
 * Exhaust enthalpy flux, watts.
 *
 * How much energy per second is actually leaving through the pipe: mass flow times the
 * heat capacity of the burned gas times how far above ambient it is. This is what drives
 * the exhaust system acoustically, and it is the term that lets TUNING reach the sound —
 * retarding the spark finishes the burn later, so more of the heat leaves through the
 * valve instead of the crank, and the pipe is driven harder for the same airflow.
 *
 * @param {{mafGps: number, egtC: number}} state
 * @returns {number} enthalpy flux above ambient, W
 */
export function exhaustPowerW({ mafGps, egtC }) {
  // cp of the burned gas: gamma R / (gamma - 1).
  const cpBurned = (COEFF.GAMMA_BURNED * R_AIR) / (COEFF.GAMMA_BURNED - 1);
  const massFlowKgS = Math.max(0, mafGps) / 1000;
  return massFlowKgS * cpBurned * Math.max(0, egtC - AMBIENT_C);
}

/**
 * Compressor tip speed needed to make a given boost, m/s.
 *
 * Euler's turbomachine equation: the specific work a radial compressor does is
 * slip x U^2, and the work the AIR needs is cp x T1 x (PR^((g-1)/g) - 1) / eta. Setting
 * them equal gives the tip speed the wheel has to be running at, which is the whole
 * reason a turbo's pitch tracks boost and not just engine speed.
 *
 * @param {{boostPsi: number, inletK: number}} state
 * @returns {number} tip speed, m/s
 */
export function compressorTipSpeedMs({ boostPsi, inletK }) {
  const pressureRatio = 1 + Math.max(0, boostPsi) * PSI_TO_KPA / BARO_KPA;
  // cp = gamma R / (gamma - 1), which is exactly R / GAMMA_EXP for the same gas.
  const cpAir = R_AIR / GAMMA_EXP;
  const idealWork = cpAir * inletK * (Math.pow(pressureRatio, GAMMA_EXP) - 1);
  return Math.sqrt(idealWork / COMP_ISEN_EFF / ACOUSTIC.COMPRESSOR_SLIP);
}

/**
 * Compressor wheel diameter implied by a compressor's choke flow, m.
 *
 * A compressor chokes when its inducer throat reaches Mach 1, so the published choke
 * flow fixes that throat area — and therefore the wheel — with no fitting at all. A
 * small turbo comes out around a 37 mm inducer, which is what a small turbo is.
 *
 * @param {{chokeFlowKgS: number}} compressor an entry from `COMPRESSOR_OPTS`
 * @returns {number} exducer diameter, m
 */
export function compressorWheelDiameterM(compressor) {
  const chokedFluxKgSM2 = ACOUSTIC.CHOKED_FLUX_COEFF * (BARO_KPA * 1000) / Math.sqrt(298);
  const throatM2 = Math.max(1e-6, compressor.chokeFlowKgS) / chokedFluxKgSM2;
  const inducerM = Math.sqrt(4 * throatM2 / Math.PI);
  return inducerM * ACOUSTIC.WHEEL_TRIM_RATIO;
}

/**
 * Turbocharger shaft speed and the tones it radiates.
 *
 * @param {{compressor: object, boostPsi: number, inletK: number}} state
 * @returns {{shaftRpm: number, whistleHz: number, bladePassHz: number}}
 */
export function turboAcoustics({ compressor, boostPsi, inletK }) {
  const tipMs = compressorTipSpeedMs({ boostPsi, inletK });
  const diaM = compressorWheelDiameterM(compressor);
  const shaftRpm = clamp(
    (60 * tipMs) / (Math.PI * diaM),
    ACOUSTIC.SHAFT_RPM_MIN, ACOUSTIC.SHAFT_RPM_MAX,
  );
  return {
    shaftRpm,
    whistleHz: (shaftRpm / 60) * ACOUSTIC.WHISTLE_SHAFT_ORDER,
    bladePassHz: (shaftRpm / 60) * ACOUSTIC.COMPRESSOR_BLADES,
  };
}

/**
 * @typedef {object} AcousticDrive
 * @property {number} evoKpa absolute cylinder pressure at exhaust valve opening, kPa —
 *   what each exhaust event (`exhaustEvent`) blows down from
 * @property {number} gasTempK exhaust gas temperature at the port, K
 * @property {number} lopeSeverity 0..1, how hard the idle loafs — 0 on a stock cam
 * @property {number} covPersistence how much of one cycle's variation carries to the next
 * @property {number} portKpa absolute mean pressure in the exhaust port, kPa — what each
 *   cylinder blows down against
 * @property {number} exhaustDrive exhaust enthalpy flux against a reference, 0..1 — how
 *   hard the exhaust system is being driven acoustically
 * @property {number} inductionLevel intake noise, 0..1 against a reference airflow
 * @property {number} knockLevel 0..1, how hard the engine is detonating
 * @property {number} retardDeg degrees the ECU pulled out of the commanded spark
 * @property {number} lambda measured lambda at the operating point, 1 when not running
 * @property {number} displacementL total displacement, litres
 * @property {number} overlapDeg valve overlap, crank degrees
 * @property {number} shaftRpm turbo shaft speed, RPM (0 when not boosted)
 * @property {number} whistleHz turbo tone, Hz (0 when not boosted)
 * @property {number} bladePassHz compressor blade-pass frequency, Hz (0 when not boosted)
 */

/**
 * Diameter of one header primary, m.
 *
 * Sized from the cylinder it serves, not from the whole engine: a primary carries one
 * cylinder's exhaust and nothing else. See ACOUSTIC.PRIMARY_DIA_REF_M for the anchors.
 *
 * @param {number} displacementL total displacement
 * @param {number} cyl cylinder count
 * @returns {number} inside diameter, m
 */
export function primaryDiameterM(displacementL, cyl) {
  const ccPerCyl = (displacementL * 1000) / Math.max(1, cyl);
  return ACOUSTIC.PRIMARY_DIA_REF_M
    * Math.pow(ccPerCyl / ACOUSTIC.PRIMARY_DIA_REF_CC, ACOUSTIC.PRIMARY_DIA_EXP);
}

/**
 * Area of a circle of the given diameter, m^2.
 *
 * @param {number} d diameter, m
 * @returns {number} area, m^2
 */
export function circleAreaM2(d) {
  return (Math.PI / 4) * d * d;
}

/**
 * The exhaust system as a set of tubes, for the exhaust events and the system's response.
 *
 * WHY THIS EXISTS AS GEOMETRY RATHER THAN AS FREQUENCIES. A pipe's fundamentals — c/2L
 * for the whole run, c/4L for a primary — are easy to compute and a renderer can tune a
 * filter to them, but a filter is not a pipe. A pipe carries a wave down its length, reflects part
 * of it off every change of area, and sends it back to interfere with what is still
 * arriving. That is what produces an exhaust note rather than a filtered buzz, and it
 * cannot be faked with resonators, for three reasons the ear notices:
 *
 *   - The reflection off an area change comes back INVERTED. A wave leaving into a bigger
 *     space returns as a rarefaction, which is what scavenges the cylinder during overlap
 *     and what makes a header "come on" at its tuned speed.
 *   - Every section has its own length, area and temperature, so the system rings at many
 *     frequencies at once, each fading at its own rate, rather than at the one or two a
 *     filter would be tuned to.
 *   - Everything retunes together with gas temperature, because everything moves with c.
 *
 * So this returns lengths and areas, and `exhaustImpulseResponse` runs a wave down them.
 *
 * @param {object} sys
 * @param {number} sys.displacementL total displacement, litres
 * @param {number} sys.cyl cylinder count
 * @param {number} sys.bore bore, mm
 * @param {number} sys.compression static compression ratio
 * @param {string} sys.configuration one of `CONFIG_OPTS`
 * @param {number} sys.pipeDiaIn tailpipe diameter, inches
 * @param {number} sys.gasTempK exhaust gas temperature at the port, K
 * @param {boolean} [sys.headers] long-tube headers fitted in place of a cast manifold
 * @param {boolean} [sys.turboFitted] a turbine sits in the exhaust path
 * @returns {object} tube lengths, areas, cylinder geometry and gas state
 */
export function exhaustGeometry({
  displacementL, cyl, bore, compression, configuration, pipeDiaIn, gasTempK,
  headers = false, turboFitted = false,
}) {
  const events = firingEvents(configuration);
  const banks = events.some((e) => e.bank === 1) ? 2 : 1;
  const perBank = Math.max(1, Math.round(cyl / banks));

  const primaryDia = primaryDiameterM(displacementL, cyl)
    * (headers ? ACOUSTIC.HEADER_DIA_MULT : 1);
  const primaryArea = circleAreaM2(primaryDia);
  const collectorArea = primaryArea * perBank * ACOUSTIC.COLLECTOR_AREA_FRAC;
  const tailArea = circleAreaM2(pipeDiaIn * 0.0254);

  // The run splits between header and tailpipe. `exhaustLengthM` is the whole acoustic
  // path, so the tailpipe is what is left once the primaries and the collector have had
  // their share.
  const totalLength = exhaustLengthM({ displacementL, pipeDiaIn });
  const primaryLength = runnerLengthM(displacementL)
    * (headers ? ACOUSTIC.HEADER_LENGTH_MULT : 1);
  const collectorLength = totalLength * ACOUSTIC.COLLECTOR_TO_TAIL_FRAC;
  const tailLength = Math.max(0.4, totalLength - primaryLength - collectorLength);

  const portK = Math.max(400, gasTempK);
  return {
    events,
    banks,
    perBank,
    cyl,
    primaryLength,
    primaryArea,
    collectorLength,
    collectorArea,
    tailLength,
    tailArea,
    mufflerArea: tailArea * ACOUSTIC.MUFFLER_AREA_RATIO,
    mufflerLength: ACOUSTIC.MUFFLER_LENGTH_M,
    mufflerAbsorbHz: ACOUSTIC.MUFFLER_ABSORB_HZ,
    // The converter, and the turbine ahead of it when one is fitted. Both sit in the same
    // place in the model — a lossy section between the collector and the muffler — because
    // that is where they sit in the car and because that is what they do.
    catKeep: ACOUSTIC.CAT_KEEP * (turboFitted ? ACOUSTIC.TURBINE_KEEP : 1),
    catHzM: turboFitted ? ACOUSTIC.TURBINE_HZ_M : ACOUSTIC.CAT_HZ_M,
    catLength: ACOUSTIC.CAT_LENGTH_M,
    headers,
    turboFitted,
    portK,
    tailK: portK * ACOUSTIC.TAIL_TEMP_FRAC,
    cylinderK: portK * ACOUSTIC.CYLINDER_TEMP_FRAC,
    cPrimary: soundSpeedMs(portK, COEFF.GAMMA_BURNED),
    cTail: soundSpeedMs(portK * ACOUSTIC.TAIL_TEMP_FRAC, COEFF.GAMMA_BURNED),
    gamma: COEFF.GAMMA_BURNED,
    // The cylinder the valve opens out of. `exhaustEvent` runs its own piston, because
    // the exhaust STROKE is half of what a listener hears at low speed and it is a
    // volume-driven flow rather than a pressure-driven one.
    sweptM3: (displacementL / Math.max(1, cyl)) / 1000,
    clearanceM3: ((displacementL / Math.max(1, cyl)) / 1000)
      / Math.max(1.5, (compression ?? 10) - 1),
    rodRatio: COEFF.ROD_RATIO,
    evoDeg: EVO_ATDC,
    valveArea: exhaustFlowAreaM2(bore),
    valveCd: ACOUSTIC.VALVE_CD,
    wallLossPerM: ACOUSTIC.WALL_LOSS_PER_M,
    wallLossHzM: ACOUSTIC.WALL_LOSS_HZ_M,
    camRampDeg: ACOUSTIC.CAM_RAMP_DEG,
    camShape: ACOUSTIC.CAM_RAMP_SHAPE,
  };
}

/** Position along the head of each successive firing on one bank, by cylinders per bank. */
const POSITION_ALONG_BANK = { 2: [0, 1], 3: [0, 2, 1], 4: [0, 2, 3, 1], 6: [0, 4, 2, 5, 1, 3] };

/**
 * How far each cylinder's exhaust travels to its collector, m, in firing-event order.
 *
 * A cast manifold is a log: the cylinder at the end of the head runs the length of it,
 * the one beside the outlet barely any. Those differences put a few milliseconds between
 * when each cylinder's pulse reaches the pipe, which is a large part of why a stock
 * engine sounds lumpier than the same engine on tuned headers — and the whole of the
 * Subaru boxer's burble. Headers are built to equal lengths, so the pulses arrive on
 * their firing intervals.
 *
 * @param {object} geometry an {@link exhaustGeometry}
 * @returns {number[]} one length per firing event
 */
export function primaryLengthsM(geometry) {
  const spread = geometry.headers ? ACOUSTIC.HEADER_LENGTH_SPREAD : ACOUSTIC.MANIFOLD_LENGTH_SPREAD;
  const perBank = Math.max(1, geometry.perBank);
  const middle = (perBank - 1) / 2;
  const seen = [0, 0];
  return geometry.events.map((e) => {
    const bank = e.bank === 1 ? 1 : 0;
    // Where along the head each firing lands, from the conventional firing orders: a four
    // fires 1-3-4-2, a six 1-5-3-6-2-4, a V6 bank 1-3-5 (positions 0, 2, 1 once the
    // crankshaft's throws are unfolded), a V8 bank like a four.
    const order = POSITION_ALONG_BANK[perBank] ?? [...Array(perBank).keys()];
    const slot = order[seen[bank]++ % perBank];
    const fromMiddle = perBank > 1 ? Math.abs(slot - middle) / Math.max(1, middle) : 0;
    return geometry.primaryLength * (1 + spread * (fromMiddle - 0.5));
  });
}

/**
 * The Mach number of the mean flow down one bank's tailpipe.
 *
 * @param {object} geometry an {@link exhaustGeometry}
 * @param {number} massFlowKgS mean mass flow through that bank, kg/s
 * @param {number} [portKpa] absolute pressure in the pipe, kPa
 * @returns {number} Mach number, 0 and up
 */
export function tailpipeMach(geometry, massFlowKgS, portKpa = BARO_KPA) {
  const rho = (Math.max(1, portKpa) * 1000) / (R_AIR * Math.max(250, geometry.tailK));
  const u = Math.max(0, massFlowKgS) / (rho * geometry.tailArea);
  return u / Math.max(1, geometry.cTail);
}

/**
 * The exhaust system's impulse response: the sound at the tailpipe, per unit of flow
 * pulse entering one bank's primaries.
 *
 * This is what turns a cylinder's gas pulse into an exhaust NOTE, and it is computed from
 * the pipes rather than recorded or voiced. The system is a chain of tubes — primary,
 * collector, converter, mid pipe, muffler chamber, tailpipe — each with its own length,
 * area and gas temperature. A pressure wave runs down each at the local speed of sound;
 * at every change of area part of it reflects (inverted where the pipe widens, which is
 * what a muffler's chambers and a header's collector are for) and part carries on; the
 * walls, the converter's honeycomb and the muffler's packing take energy out, the high
 * frequencies fastest; and at the open end the lows reflect back up the pipe while the
 * highs escape. What escapes is radiated as the rate of change of the flow leaving the
 * pipe, which is what a listener hears.
 *
 * Every number comes from the build: displacement sets the primaries and the run,
 * the tailpipe menu sets the pipe, headers lengthen and widen the primaries, a turbine
 * swaps the converter's loss for its own, and the gas temperature sets every speed of
 * sound. A cat-back swaps the reactive muffler for a straight-through one.
 *
 * @param {object} geometry an {@link exhaustGeometry}
 * @param {number} sampleRate samples per second
 * @param {{bank?: number, catBack?: boolean, flowMach?: number}} [opts] which bank's
 *   pipework, whether a straight-through cat-back is fitted, and the Mach number of the
 *   mean flow down the tailpipe ({@link tailpipeMach}), which damps every section
 * @returns {Float32Array} the response, peak-normalised so the loudest sample is 1 in size
 */
export function exhaustImpulseResponse(geometry, sampleRate, {
  bank = 0, catBack = false, flowMach = 0,
} = {}) {
  const g = geometry.gamma;
  const cOf = (k) => Math.sqrt(g * R_AIR * Math.max(250, k));
  const stretch = bank === 1 ? 1 + ACOUSTIC.BANK_LENGTH_SPLIT : 1;
  const midLength = geometry.tailLength * ACOUSTIC.MID_PIPE_FRAC * stretch;
  const tailLength = geometry.tailLength * (1 - ACOUSTIC.MID_PIPE_FRAC) * stretch;
  const tailRadius = Math.sqrt(geometry.tailArea / Math.PI);
  const mufflerArea = geometry.tailArea * ACOUSTIC.CATBACK_MUFFLER_AREA_RATIO;
  const absorbHz = geometry.mufflerAbsorbHz * (catBack ? ACOUSTIC.CATBACK_ABSORB_MULT : 1);
  // [length m, area m^2, gas K, extra keep per pass, extra lowpass corner Hz per pass,
  //  how many such tubes side by side share the bank's flow]
  const tubes = [
    [geometry.primaryLength, geometry.primaryArea, geometry.portK, 1, Infinity,
      Math.max(1, geometry.perBank)],
    [geometry.collectorLength, geometry.collectorArea, geometry.portK, 1, Infinity],
    [geometry.catLength, geometry.collectorArea * ACOUSTIC.CAT_AREA_RATIO, geometry.portK,
      geometry.catKeep, geometry.catHzM / geometry.catLength],
    [midLength, geometry.tailArea, geometry.tailK, 1, Infinity],
    ...(catBack
      ? [[geometry.mufflerLength, mufflerArea, geometry.tailK, 1, absorbHz]]
      : [
        [geometry.mufflerLength * ACOUSTIC.STOCK_MUFFLER_SPLIT,
          geometry.tailArea * ACOUSTIC.STOCK_MUFFLER_AREA_RATIO,
          geometry.tailK, 1, absorbHz * ACOUSTIC.STOCK_ABSORB_MULT],
        [ACOUSTIC.STOCK_MUFFLER_NECK_M, geometry.tailArea, geometry.tailK, 1, Infinity],
        [geometry.mufflerLength * (1 - ACOUSTIC.STOCK_MUFFLER_SPLIT),
          geometry.tailArea * ACOUSTIC.STOCK_MUFFLER_AREA_RATIO,
          geometry.tailK, 1, absorbHz * ACOUSTIC.STOCK_ABSORB_MULT],
      ]),
    // The open end behaves as if the pipe were a little longer than it measures.
    [tailLength + ACOUSTIC.PIPE_END_CORRECTION * tailRadius, geometry.tailArea, geometry.tailK,
      1, Infinity],
  ].map(([length, area, k, keep, extraHz, share = 1]) => {
    const c = cOf(k);
    const delay = Math.max(1, Math.round((length / c) * sampleRate));
    // The mean flow's Mach number in this section. The same mass flow moves faster through
    // a narrower pipe and through hotter gas, and a primary carries its share of one bank.
    const mach = flowMach * (geometry.tailArea / (area * share))
      * Math.sqrt(Math.max(250, k) / Math.max(250, geometry.tailK));
    const diameter = Math.sqrt((4 * area) / Math.PI);
    // Wall loss over the length travelled, and the boundary-layer corner for it, combined
    // with whatever the section itself absorbs, all damped further by the flow through it.
    // A muffler's packing sees the flow grazing its core at the pipe's own speed.
    const grazing = Number.isFinite(extraHz) ? Math.max(mach, flowMach) : mach;
    const cornerHz = Math.min(geometry.wallLossHzM / Math.max(0.05, length), extraHz)
      / (1 + ACOUSTIC.FLOW_CORNER * grazing);
    return {
      delay,
      keep: keep * Math.pow(1 - geometry.wallLossPerM, length)
        * Math.exp(-ACOUSTIC.FLOW_FRICTION * mach * (length / diameter)),
      pole: Math.exp((-2 * Math.PI * Math.min(cornerHz, sampleRate * 0.45)) / sampleRate),
      // Characteristic impedance, rho c / A: rho c goes as 1 / sqrt(T) at fixed pressure.
      z: 1 / (area * Math.sqrt(Math.max(250, k))),
      right: new Float64Array(delay), left: new Float64Array(delay),
      lpRight: 0, lpLeft: 0,
    };
  });
  const n = tubes.length;
  const last = tubes[n - 1];
  const openPole = Math.exp(-2 * Math.PI * Math.min(sampleRate * 0.45,
    ACOUSTIC.OPEN_END_CORNER_FRAC * cOf(geometry.tailK) / (2 * Math.PI * tailRadius)) / sampleRate);

  const maxLength = Math.round(ACOUSTIC.IR_MAX_SECONDS * sampleRate);
  const out = new Float32Array(maxLength);
  const arriveRight = new Float64Array(n);
  const arriveLeft = new Float64Array(n);
  let openLp = 0;
  let lastFlow = 0;
  let step = 0;
  // Once nothing left in any tube could put a sample above the trim floor, the rest would
  // be trimmed off anyway; stop there rather than running out the full window.
  const floorOf = Math.pow(10, ACOUSTIC.IR_FLOOR_DB / 20);
  let peakSoFar = 0;
  let length = maxLength;
  for (let t = 0; t < maxLength; t++) {
    if (t > 0 && (t & 127) === 0 && peakSoFar > 0) {
      let left = Math.abs(openLp) + Math.abs(lastFlow);
      for (const tube of tubes) {
        left = Math.max(left, Math.abs(tube.lpRight), Math.abs(tube.lpLeft));
        for (let j = 0; j < tube.delay; j++) {
          left = Math.max(left, Math.abs(tube.right[j]), Math.abs(tube.left[j]));
        }
      }
      // A radiated sample is a difference of two flows, each at most twice what is left.
      if (4 * left < peakSoFar * floorOf) { length = t; break; }
    }
    // What reaches each end of each tube this sample, after the losses along it.
    for (let i = 0; i < n; i++) {
      const tube = tubes[i];
      const j = step % tube.delay;
      tube.lpRight = tube.right[j] + tube.pole * (tube.lpRight - tube.right[j]);
      tube.lpLeft = tube.left[j] + tube.pole * (tube.lpLeft - tube.left[j]);
      arriveRight[i] = tube.lpRight * tube.keep;
      arriveLeft[i] = tube.lpLeft * tube.keep;
    }
    // The valve end, where the pulse enters.
    tubes[0].right[step % tubes[0].delay] = (t === 0 ? 1 : 0)
      + ACOUSTIC.VALVE_END_REFLECTION * arriveLeft[0];
    // Every junction: reflect by the impedance step, transmit the rest.
    for (let i = 0; i < n - 1; i++) {
      const a = tubes[i];
      const b = tubes[i + 1];
      const r = (b.z - a.z) / (b.z + a.z);
      b.right[step % b.delay] = (1 + r) * arriveRight[i] - r * arriveLeft[i + 1];
      a.left[step % a.delay] = r * arriveRight[i] + (1 - r) * arriveLeft[i + 1];
    }
    // The open end: the lows come back inverted, the highs get out.
    const incident = arriveRight[n - 1];
    openLp = incident + openPole * (openLp - incident);
    last.left[step % last.delay] = -openLp;
    const flow = incident + openLp;
    out[t] = flow - lastFlow;
    peakSoFar = Math.max(peakSoFar, Math.abs(out[t]));
    lastFlow = flow;
    step++;
  }

  // Trim to where it has died away, and normalise.
  let peak = 0;
  for (let t = 0; t < length; t++) peak = Math.max(peak, Math.abs(out[t]));
  const floor = peak * Math.pow(10, ACOUSTIC.IR_FLOOR_DB / 20);
  let end = length;
  while (end > 1 && Math.abs(out[end - 1]) < floor) end--;
  const ir = out.slice(0, Math.max(2, end));
  if (peak > 0) for (let i = 0; i < ir.length; i++) ir[i] /= peak;
  return ir;
}

/**
 * The engine's operating state, as the audio renderer needs it.
 *
 * The single seam between physics and presentation: `src/ui` reads these fields and
 * does no engineering maths of its own. The pipes themselves come from
 * {@link exhaustGeometry}; this is what is happening inside them right now.
 *
 * @param {object} input
 * @param {number} input.rpm engine speed
 * @param {object} input.derived from `deriveEngine`
 * @param {object|null} input.point an `evaluatePoint` result, or null when not running
 * @param {boolean} [input.turboOn] whether a turbo is fitted
 * @param {object} [input.compressor] the fitted compressor, from `COMPRESSOR_OPTS`
 * @param {number} [input.throttle] throttle position, 0..1, for callers that know it but
 *   have no MEASURED point at it. A dyno sweep only ever evaluates wide-open points, so
 *   the idle and overrun either side of a pull — and a drag pass — have to borrow one;
 *   scaling the cylinder pressure by throttle is a fair approximation, because pressure
 *   at valve opening tracks trapped charge and trapped charge tracks manifold pressure.
 *   It scales nothing else — the gas is still as hot as it measured. Defaults to 1, which
 *   leaves a measured point exactly as it is.
 * @param {boolean} [input.fuelCut] whether the injectors are off — the rev limiter, or a
 *   closed throttle on the overrun. No combustion means the cylinder reaches valve opening
 *   at motored pressure, and nothing else about the note changes.
 * @returns {AcousticDrive}
 */
export function acousticDrive({
  rpm, derived, point, turboOn, compressor, throttle = 1, fuelCut = false,
}) {
  const { cyl, displacementL, compression } = derived;
  const gasTempK = (point ? point.egt : 0) + KELVIN_OFFSET;

  // THE REAL CYLINDER PRESSURE AT VALVE OPENING, absolute. `exhaustEvent` runs its own
  // piston through its own valve, so the exhaust stroke is already in there: handing it
  // manifold pressure plus an allowance for the stroke double-counted it, and put the
  // cylinder ABOVE the manifold at every operating point in the map.
  //
  // That inverted the overrun. A closed throttle at 5000 rpm leaves the cylinder at
  // roughly half an atmosphere when the valve cracks, so the pipe is HIGHER than the
  // cylinder and gas rushes in before the piston pushes it back out. Told instead that the
  // cylinder was 9 kPa above the pipe, the model blew down on every event and the overrun
  // came out 6 dB LOUDER than wide-open throttle.
  const evoTrueKpa = point
    ? evoPressureKpa({
      peakPressureBar: point.peakPressure, peakPressureDeg: point.peakPressureDeg,
      compression, displacementL, cyl,
    })
    : BARO_KPA;
  // A borrowed wide-open point is scaled by throttle (see `throttle` above); the floor is
  // what a cylinder reaches with no fuel in it at all, which is where a real overrun sits.
  //
  // A FUEL CUT IS THE SAME STATEMENT. On the rev limiter and on the overrun the injectors
  // are off, so there is no combustion and the cylinder reaches the valve at the motored
  // pressure and nothing more. That is the whole of what a cut does to the exhaust note,
  // and it is not a mute: the engine is still turning at seven and a half thousand and
  // still pumping a cylinder of air out of every port, which is exactly why a limiter
  // bangs.
  const evoAtValveKpa = fuelCut
    ? ACOUSTIC.MOTORED_EVO_KPA
    : Math.max(ACOUSTIC.MOTORED_EVO_KPA, evoTrueKpa * clamp(throttle, 0, 1));

  const variation = cyclicVariation({ rpm, overlapDeg: derived.overlapDeg || 0 });
  const powerW = point ? exhaustPowerW({ mafGps: point.maf, egtC: point.egt }) : 0;

  const turbo = turboOn && compressor && point && point.boostPsi > 0
    ? turboAcoustics({ compressor, boostPsi: point.boostPsi, inletK: point.iat + KELVIN_OFFSET })
    : { shaftRpm: 0, whistleHz: 0, bladePassHz: 0 };

  return {
    evoKpa: evoAtValveKpa,
    gasTempK,
    lopeSeverity: variation.severity,
    covPersistence: ACOUSTIC.COV_PERSISTENCE,
    portKpa: BARO_KPA + ACOUSTIC.PORT_BACK_KPA
      + ACOUSTIC.PORT_BACK_PER_DRIVE_KPA * clamp(powerW / ACOUSTIC.EXHAUST_POWER_REF_W, 0, 1),
    exhaustDrive: clamp(powerW / ACOUSTIC.EXHAUST_POWER_REF_W, 0, 1),
    inductionLevel: clamp((point ? point.maf : 0) / ACOUSTIC.INDUCTION_REF_GPS, 0, 1.5),
    knockLevel: point && point.knock ? clamp(point.knockPull / COEFF.MAX_KNOCK_RETARD, 0, 1) : 0,
    // Reported, not derived: how a retarded burn shapes the note is a rendering decision.
    retardDeg: point ? Math.max(0, point.commandedTiming - point.timing) : 0,
    // Reported for the same reason: a rich burn is slower and softer, a lean one sharper.
    lambda: point && Number.isFinite(point.lambda) ? point.lambda : 1,
    displacementL,
    overlapDeg: derived.overlapDeg || 0,
    ...turbo,
  };
}
