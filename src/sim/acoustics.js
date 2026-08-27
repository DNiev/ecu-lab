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
 * manifold is near atmospheric. Gas leaves as a single sharp pressure pulse — BLOWDOWN —
 * long before the piston starts pushing. That pulse train, one per cylinder per two
 * revolutions, is the exhaust note. Everything that makes engines sound different from
 * each other is a property of that train:
 *
 *   PITCH        how often the pulses arrive: `firingFrequencyHz`.
 *   RHYTHM       how EVENLY they arrive, which is set by crank and bank geometry and is
 *                the whole of the cross-plane V8 rumble: `firingEvents`.
 *   HARDNESS     how violent each pulse is, which is the pressure ratio across the valve
 *                at the moment it opens: `blowdownPressureRatio`, `pulseSharpness`.
 *   RESONANCE    the pipe the pulses travel down, which rings at c/2L — and c depends on
 *                the gas TEMPERATURE, so the note sharpens as the engine heats:
 *                `exhaustResonanceHz`.
 *   UNEVENNESS   cycle-to-cycle combustion variation, which is what a lopey idle is, and
 *                which comes from residual gas rather than from a "lope" knob:
 *                `cyclicVariation`.
 *
 * The turbocharger is treated the same way: shaft speed comes from the compressor work
 * needed for the boost being made, and the whistle is that shaft speed — not a number
 * that ramps with RPM because ramping sounded about right.
 *
 * SCOPE. This is a lumped acoustic model, not a duct-acoustics solver. There is no
 * wave-action solution in the runners, no reflection at each junction, no radiation
 * impedance beyond an end correction. What it does guarantee is that every number the
 * synthesiser is handed traces back to the engine's own state.
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
  // Bounds on the runner fundamental, Hz.
  RUNNER_HZ_MIN: 180,
  RUNNER_HZ_MAX: 620,
  // Tailpipe distance from the head. Production systems run roughly 2.5-4.5 m; the
  // displacement term stands in for the fact that bigger engines go in bigger cars.
  EXHAUST_LENGTH_BASE_M: 2.55,
  EXHAUST_LENGTH_PER_LITRE_M: 0.13,
  // Rayleigh end correction: an open pipe behaves as if it were 0.6 radii longer than it
  // measures, because the gas just outside the mouth moves with the column.
  PIPE_END_CORRECTION: 0.6,
  // Bounds on the fundamental, so a nonsense build cannot ask for an inaudible pipe.
  PIPE_HZ_MIN: 45,
  PIPE_HZ_MAX: 180,

  // --- Waveguide geometry ---
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

  // --- Pulse shape ---
  // Effective exhaust flow area as a fraction of bore area. A valve head runs about
  // 0.36 of the bore and its curtain area at full lift is roughly 0.8 of its own disc,
  // which lands here. It is what turns cylinder volume into a blowdown TIME.
  EXHAUST_FLOW_AREA_FRAC: 0.13,
  // Blowdown duration that renders at unit playback rate — the stock 3.5 L V6 at load.
  // Everything else is pitched relative to it, so a longer-stroke engine vents a longer,
  // lower pulse and a hot engine a shorter, sharper one, without either being asserted.
  PULSE_REF_DURATION_S: 1.01e-3,
  // Bounds on that rate, so a strange build cannot ask for an unrecognisable pulse.
  PULSE_RATE_MIN: 0.55,
  PULSE_RATE_MAX: 1.6,

  // --- Blowdown ---
  // Reference overpressure across the exhaust valve at valve opening, kPa. A stock
  // naturally aspirated engine at wide-open throttle sits near this, so `pulseLevel`
  // reads about 1 there and a boosted engine reads above it.
  BLOWDOWN_REF_KPA: 330,
  // Below this the cylinder is at or under manifold pressure at valve opening — a
  // throttled engine at idle genuinely is — so there is no blowdown pulse, just the
  // piston pushing gas out. That is why idle is a soft chuff and not a crack.
  BLOWDOWN_MIN_RATIO: 1.0,
  // What the exhaust STROKE contributes when there is no blowdown left to hear: the
  // piston still has to push a cylinder of gas through a port, and that takes a small
  // pressure. It is what an idling engine actually sounds like. Small on purpose — the
  // ratio between this and BLOWDOWN_REF_KPA sets the model's dynamic range at about
  // 30 dB, which is roughly the measured spread between idle and wide-open throttle at
  // the tailpipe.
  EXHAUST_STROKE_KPA: 9,
  // Cylinder pressure at exhaust valve opening with no combustion at all: the floor the
  // waveguide's valve sees on a closed throttle. A motored cylinder starting from about
  // 20 kPa at intake valve close comes back down to roughly half an atmosphere by the time
  // the crank is 130 degrees past top dead centre, so the exhaust pipe is HIGHER than the
  // cylinder and the first thing that happens when the valve opens is that gas goes the
  // wrong way. That is what an overrun is, and it is why it is quiet.
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
  // Coefficient of variation of indicated work with no overlap at all. 2% is a healthy
  // production engine and is what a stock build should sit at.
  COV_FLOOR: 0.02,
  // Fraction of cycles that fail to light, per unit of severity. A misfire is the audible
  // gap in a lopey idle, not just a quieter pulse.
  MISFIRE_PER_SEVERITY: 0.30,
  // How much of one cycle's weakness carries into the next.
  //
  // This is the PRIOR-CYCLE EFFECT and it is why a lopey idle loafs instead of buzzing. A
  // weak cycle burns less of its charge, leaves more residual, and dilutes the cycle after
  // it. Published lag-one autocorrelations of IMEP in dilute spark ignition sit around
  // 0.3-0.6. The renderer needs this, not the sim: the same amount of variation without
  // memory produces a fizz.
  COV_PERSISTENCE: 0.55,

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
 * How often cylinders fire, Hz.
 *
 * A four-stroke fires every cylinder once per TWO revolutions, so the exhaust
 * fundamental is half what the cylinder count would suggest: a V8 at 6000 RPM fires
 * 400 times a second, not 800.
 *
 * @param {number} rpm engine speed
 * @param {number} cyl cylinder count
 * @returns {number} firing frequency, Hz
 */
export function firingFrequencyHz(rpm, cyl) {
  return (Math.max(0, rpm) / 60) * (cyl / 2);
}

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
 * Fundamental resonance of the exhaust system, Hz.
 *
 * A pipe open at both ends — which a header-to-tailpipe run effectively is, once the
 * valve is open — resonates at c / 2L and at its harmonics. This is the frequency the
 * whole note is built on top of, and it moves with EGT because c does.
 *
 * @param {{displacementL: number, pipeDiaIn: number, gasTempK: number}} sys
 * @returns {number} fundamental, Hz
 */
export function exhaustResonanceHz({ displacementL, pipeDiaIn, gasTempK }) {
  const c = soundSpeedMs(gasTempK, COEFF.GAMMA_BURNED);
  const hz = c / (2 * exhaustLengthM({ displacementL, pipeDiaIn }));
  return clamp(hz, ACOUSTIC.PIPE_HZ_MIN, ACOUSTIC.PIPE_HZ_MAX);
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
 * Ringing frequency of one primary runner, Hz.
 *
 * A primary is closed at the valve and open into the collector, which makes it a QUARTER
 * wave resonator: it rings at c/4L, not c/2L like the tailpipe. Every blowdown pulse
 * excites it, and what comes back out is the sharp mid-band edge the ear reads as an
 * exhaust note rather than a thump. It rises with gas temperature for the same reason
 * everything else here does.
 *
 * @param {{displacementL: number, gasTempK: number}} sys
 * @returns {number} runner fundamental, Hz
 */
export function runnerResonanceHz({ displacementL, gasTempK }) {
  const c = soundSpeedMs(gasTempK, COEFF.GAMMA_BURNED);
  return clamp(
    c / (4 * runnerLengthM(displacementL)), ACOUSTIC.RUNNER_HZ_MIN, ACOUSTIC.RUNNER_HZ_MAX,
  );
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
 * Pressure ratio across the exhaust valve at the moment it opens.
 *
 * The number that decides how hard the engine sounds. Above the critical ratio the
 * escaping gas reaches Mach 1 in the valve seat and leaves as a shock — the crack of a
 * hard-run engine. Below 1 there is nothing to blow down at all and the piston simply
 * pushes the charge out, which is why a throttled engine at idle is soft no matter how
 * big it is.
 *
 * @param {{peakPressureBar: number, peakPressureDeg: number, compression: number,
 *          displacementL: number, cyl: number, empKpa: number}} state the same cylinder
 *   state {@link evoPressureKpa} takes, plus the manifold it blows down into
 * @returns {number} p_cylinder / p_manifold at valve opening
 */
export function blowdownPressureRatio(state) {
  return evoPressureKpa(state) / Math.max(1, state.empKpa);
}

/**
 * Critical pressure ratio for choked flow through the exhaust valve.
 *
 * ((gamma+1)/2)^(gamma/(gamma-1)) for the burned gas — about 1.81. Past it the valve
 * seat is sonic and no further pressure ratio speeds the gas up; it just makes the shock
 * stronger.
 */
export const CRITICAL_PRESSURE_RATIO = Math.pow(
  (COEFF.GAMMA_BURNED + 1) / 2,
  COEFF.GAMMA_BURNED / (COEFF.GAMMA_BURNED - 1),
);

/**
 * How sharp each exhaust pulse is, 0 (a soft chuff) to 1 (a choked crack).
 *
 * @param {number} ratio from {@link blowdownPressureRatio}
 * @returns {number} 0..1
 */
export function pulseSharpness(ratio) {
  return clamp(
    (ratio - ACOUSTIC.BLOWDOWN_MIN_RATIO) / (CRITICAL_PRESSURE_RATIO - ACOUSTIC.BLOWDOWN_MIN_RATIO),
    0, 1,
  );
}

/**
 * Cycle-to-cycle combustion variation, as a coefficient of variation of indicated work.
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
 * @param {{residualFrac?: number, rpm: number, overlapDeg?: number}} state
 * @returns {{cov: number, severity: number, misfireRate: number}} variation, how hard it
 *   loafs, and the fraction of cycles that fail to light
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
  // residual model resolves light-load dilution properly, this is the honest lever, and
  // the residual model resolves light-load dilution properly, this is the honest lever.
  const severity = overlapDeg > ACOUSTIC.LOPE_OVERLAP_MIN_DEG
    ? Math.min(ACOUSTIC.LOPE_MAX, overlapDeg * ACOUSTIC.LOPE_PER_OVERLAP_DEG)
    : 0;
  // Fast engines have no time to wander far before the next cycle arrives, and the
  // flywheel filters what is left — so a cammed engine loafs at idle and cleans up on the
  // way to redline.
  const speedFade = clamp(
    1 - (Math.max(0, rpm) - ACOUSTIC.LOPE_IDLE_RPM) / ACOUSTIC.LOPE_FADE_RPM, 0.12, 1,
  );
  const cov = ACOUSTIC.COV_FLOOR + severity * speedFade;
  return {
    cov,
    severity: severity * speedFade,
    misfireRate: severity * speedFade * ACOUSTIC.MISFIRE_PER_SEVERITY,
  };
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
 * How long one blowdown pulse lasts, seconds.
 *
 * The cylinder empties through the valve at roughly the speed of sound, so the time it
 * takes is volume divided by (area x sonic velocity). Two things fall out of that, and
 * both are audible:
 *
 *   - Volume scales with bore^2 x stroke and valve area with bore^2, so the pulse
 *     LENGTH tracks STROKE, not displacement. A long-stroke engine genuinely vents a
 *     longer, lower-pitched pulse than a short-stroke one of the same capacity.
 *   - Sonic velocity rises with gas temperature, so a hot engine vents FASTER. The note
 *     sharpens as it comes on song, for the same reason the pipe resonance does.
 *
 * @param {{displacementL: number, cyl: number, bore: number, compression: number,
 *          gasTempK: number}} state
 * @returns {number} pulse duration, seconds
 */
export function blowdownDurationS({ displacementL, cyl, bore, compression, gasTempK }) {
  const sweptM3 = (displacementL / cyl) / 1000;
  const clearanceM3 = sweptM3 / Math.max(1.5, compression - 1);
  const vEvo = cylinderVolumeM3(EVO_ATDC, clearanceM3, sweptM3, COEFF.ROD_RATIO);
  const areaM2 = exhaustFlowAreaM2(bore);
  return vEvo / (areaM2 * soundSpeedMs(gasTempK, COEFF.GAMMA_BURNED));
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
 * @property {number} firingHz firing frequency, Hz
 * @property {FiringEvent[]} events one engine cycle of firing events
 * @property {number} pipeHz exhaust fundamental, Hz
 * @property {number} runnerHz primary runner ring, Hz — the note's hard edge
 * @property {number} blowdownRatio pressure ratio across the exhaust valve at EVO
 * @property {number} evoKpa absolute cylinder pressure at exhaust valve opening, kPa
 * @property {number} empKpa exhaust manifold pressure the cylinder blows down into, kPa
 * @property {number} gasTempK exhaust gas temperature at the port, K
 * @property {number} sharpness 0 (soft chuff) to 1 (choked crack)
 * @property {number} pulseLevel pulse pressure amplitude, 1 being a stock naturally
 *   aspirated engine at wide-open throttle. Linear in PRESSURE, so the renderer is the
 *   thing that maps it to loudness — a factor of ten here is 20 dB, not ten times louder
 * @property {number} pulseRate how fast one blowdown pulse plays out, relative to the
 *   reference engine — under 1 is a longer, lower pulse
 * @property {number} cov cycle-to-cycle variation of indicated work
 * @property {number} lopeSeverity 0..1, how hard the idle loafs — 0 on a stock cam
 * @property {number} covPersistence how much of one cycle's variation carries to the next
 * @property {number} misfireRate fraction of cycles that fail to light
 * @property {number} exhaustPowerW enthalpy leaving through the pipe, W
 * @property {number} exhaustDrive that flux against a reference, 0..1 — how hard the
 *   exhaust system is being driven acoustically
 * @property {number} inductionLevel intake noise, 0..1 against a reference airflow
 * @property {number} knockLevel 0..1, how hard the engine is detonating
 * @property {number} retardDeg degrees the ECU pulled out of the commanded spark
 * @property {number} lambda delivered mixture, 1.0 being stoichiometric
 * @property {number} compression static compression ratio
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
 * The exhaust system as a set of tubes, for the waveguide renderer.
 *
 * WHY THIS EXISTS AS GEOMETRY RATHER THAN AS FREQUENCIES. `exhaustResonanceHz` and
 * `runnerResonanceHz` above give the fundamentals, and a renderer can tune a filter to
 * them — but a filter is not a pipe. A pipe carries a wave down its length, reflects part
 * of it off every change of area, and sends it back to interfere with what is still
 * arriving. That is what produces an exhaust note rather than a filtered buzz, and it
 * cannot be faked with resonators, for three reasons the ear notices:
 *
 *   - The reflection off an area change comes back INVERTED. A wave leaving into a bigger
 *     space returns as a rarefaction, which is what scavenges the cylinder during overlap
 *     and what makes a header "come on" at its tuned speed.
 *   - Cylinders TALK TO EACH OTHER through the collector. Cylinder 1's pulse runs back up
 *     cylinder 3's primary. That crosstalk is a large part of why an engine sounds like one
 *     object rather than like several separate pops.
 *   - Everything retunes together with gas temperature, because everything moves with c.
 *
 * So this returns lengths and areas, and the renderer builds delay lines out of them.
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
    // The cylinder the valve opens out of. The waveguide runs its own piston, because
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

/**
 * Everything the synthesiser needs, derived from one operating point.
 *
 * The single seam between physics and presentation: `src/ui` reads these fields and
 * chooses oscillators and filters, and it does no engineering maths of its own.
 *
 * @param {object} input
 * @param {number} input.rpm engine speed
 * @param {object} input.derived from `deriveEngine`
 * @param {object|null} input.point an `evaluatePoint` result, or null when not running
 * @param {string} input.configuration one of `CONFIG_OPTS`
 * @param {number} input.pipeDiaIn exhaust pipe diameter, inches
 * @param {boolean} [input.turboOn] whether a turbo is fitted
 * @param {object} [input.compressor] the fitted compressor, from `COMPRESSOR_OPTS`
 * @param {number} [input.throttle] throttle position, 0..1, for callers that know it but
 *   have no MEASURED point at it. A dyno sweep only ever evaluates wide-open points, so
 *   the idle and overrun either side of a pull have to borrow the nearest one; scaling
 *   the blowdown by throttle is a fair approximation, because pressure at valve opening
 *   tracks trapped charge and trapped charge tracks manifold pressure. It scales nothing
 *   else — the gas is still as hot as it measured, and the exhaust stroke still pushes.
 *   Defaults to 1, which leaves a measured point exactly as it is.
 * @param {boolean} [input.fuelCut] whether the injectors are off — the rev limiter, or a
 *   closed throttle on the overrun. No combustion means the cylinder reaches valve opening
 *   at motored pressure, and nothing else about the note changes.
 * @returns {AcousticDrive}
 */
export function acousticDrive({
  rpm, derived, point, configuration, pipeDiaIn, turboOn, compressor, throttle = 1,
  fuelCut = false,
}) {
  const { cyl, displacementL, compression } = derived;
  const gasTempK = (point ? point.egt : 0) + KELVIN_OFFSET;
  const empKpa = point ? point.emp : BARO_KPA;

  const ratio = point
    ? blowdownPressureRatio({
      peakPressureBar: point.peakPressure, peakPressureDeg: point.peakPressureDeg,
      compression, displacementL, cyl, empKpa,
    })
    : 0;
  // Blowdown when there is any, plus what the exhaust stroke pushes out regardless.
  const overpressureKpa = Math.max(0, empKpa * (ratio - 1)) * clamp(throttle, 0, 1)
    + ACOUSTIC.EXHAUST_STROKE_KPA;
  const variation = cyclicVariation({ rpm, overlapDeg: derived.overlapDeg || 0 });

  // WHAT THE WAVEGUIDE'S VALVE NEEDS IS THE REAL CYLINDER PRESSURE, not the manifold plus
  // an allowance for the exhaust stroke.
  //
  // `overpressureKpa` above is a LEVEL — it says how hard this cycle hits, and it feeds
  // `pulseLevel`. Handing the same number to the waveguide as an absolute pressure was a
  // leftover from before the waveguide existed, and it double-counted: the waveguide runs
  // its own piston through its own valve, so the exhaust stroke is already in there, and
  // adding EXHAUST_STROKE_KPA on top put the cylinder ABOVE the manifold at every
  // operating point in the map.
  //
  // That inverted the overrun. A closed throttle at 5000 rpm leaves the cylinder at
  // roughly half an atmosphere when the valve cracks, so the pipe is HIGHER than the
  // cylinder and gas rushes in before the piston pushes it back out. Told instead that the
  // cylinder was 9 kPa above the pipe, the model blew down on every event and the overrun
  // came out 6 dB LOUDER than wide-open throttle — measured through the running UI, it was
  // the loudest thing in the program, which is not what lifting off a throttle sounds like.
  const evoTrueKpa = point
    ? evoPressureKpa({
      peakPressureBar: point.peakPressure, peakPressureDeg: point.peakPressureDeg,
      compression, displacementL, cyl,
    })
    : BARO_KPA;
  // A dyno sweep only ever measures wide-open points, so the idle and overrun either side
  // of a pull borrow the nearest one. Pressure at valve opening tracks trapped charge and
  // trapped charge tracks manifold pressure, so throttle scales it; the floor is what a
  // cylinder reaches with no fuel in it at all, which is where a real overrun sits.
  //
  // A FUEL CUT IS THE SAME STATEMENT. On the rev limiter and on the overrun the injectors
  // are off, so there is no combustion and the cylinder reaches the valve at the motored
  // pressure and nothing more. That is the whole of what a cut does to the exhaust note,
  // and it is not a mute: the engine is still turning at seven and a half thousand and
  // still pumping a cylinder of air out of every port, which is exactly why a limiter
  // bangs. The renderer used to express this by scaling the OUTPUT LEVEL to 0.18, which
  // made the loudest part of the rev range the quietest thing in the program.
  const evoAtValveKpa = fuelCut
    ? ACOUSTIC.MOTORED_EVO_KPA
    : Math.max(ACOUSTIC.MOTORED_EVO_KPA, evoTrueKpa * clamp(throttle, 0, 1));

  const durationS = blowdownDurationS({
    displacementL, cyl, bore: derived.bore, compression, gasTempK,
  });
  const powerW = point ? exhaustPowerW({ mafGps: point.maf, egtC: point.egt }) : 0;

  const turbo = turboOn && compressor && point && point.boostPsi > 0
    ? turboAcoustics({ compressor, boostPsi: point.boostPsi, inletK: point.iat + KELVIN_OFFSET })
    : { shaftRpm: 0, whistleHz: 0, bladePassHz: 0 };

  return {
    firingHz: firingFrequencyHz(rpm, cyl),
    events: firingEvents(configuration),
    pipeHz: exhaustResonanceHz({ displacementL, pipeDiaIn, gasTempK }),
    runnerHz: runnerResonanceHz({ displacementL, gasTempK }),
    blowdownRatio: ratio,
    // Cylinder pressure at valve opening, and the manifold it blows down into. The
    // waveguide renderer needs both as absolute pressures: it opens a real valve between
    // them and lets an orifice decide the flow, rather than being handed a pulse shape.
    evoKpa: evoAtValveKpa,
    empKpa,
    gasTempK,
    sharpness: pulseSharpness(ratio),
    pulseLevel: clamp(overpressureKpa / ACOUSTIC.BLOWDOWN_REF_KPA, 0, 2),
    pulseRate: clamp(
      ACOUSTIC.PULSE_REF_DURATION_S / Math.max(1e-6, durationS),
      ACOUSTIC.PULSE_RATE_MIN, ACOUSTIC.PULSE_RATE_MAX,
    ),
    cov: variation.cov,
    lopeSeverity: variation.severity,
    covPersistence: ACOUSTIC.COV_PERSISTENCE,
    misfireRate: variation.misfireRate,
    exhaustPowerW: powerW,
    exhaustDrive: clamp(powerW / ACOUSTIC.EXHAUST_POWER_REF_W, 0, 1),
    inductionLevel: clamp((point ? point.maf : 0) / ACOUSTIC.INDUCTION_REF_GPS, 0, 1.5),
    knockLevel: point && point.knock ? clamp(point.knockPull / COEFF.MAX_KNOCK_RETARD, 0, 1) : 0,
    // Measurements the renderer voices from directly. They are reported, not derived —
    // the acoustic consequence of a retarded burn or a rich mixture is a question about
    // how an exhaust note is SHAPED, which is a rendering decision, not a physics one.
    // Putting them in the drive keeps the renderer from having to reach into the point.
    retardDeg: point ? Math.max(0, point.commandedTiming - point.timing) : 0,
    lambda: point ? point.lambda : 1,
    compression,
    displacementL,
    overlapDeg: derived.overlapDeg || 0,
    ...turbo,
  };
}
