/**
 * The engine's audio graph.
 *
 * Presentation only. Every number that describes the ENGINE arrives in an
 * `AcousticDrive` and an `exhaustGeometry` from `src/sim/acoustics.js`; nothing here
 * works out what the engine is doing. What lives here is how to turn those numbers into
 * Web Audio nodes — a rendering problem, not a physics one, which is why this file sits
 * in `src/ui/`.
 *
 * HOW THE SOUND IS BUILT
 *
 * The note itself is not built here at all. It comes out of `pulseExhaust.js`: every
 * firing event computed from the engine (`exhaustEvent` in src/sim/acoustics.js) and
 * played through the exhaust system computed from the build (`exhaustImpulseResponse`), and
 * the starter while the engine turns over. This file sends it the build
 * when that changes and the engine's state a few times a second.
 *
 * Around it sit the things the note does not make: induction noise, the turbo's whistle
 * and rush, the blow-off and compressor flutter, and the gearchange and converter noises
 * the drag strip uses. Each is a filtered noise band or a tone whose level comes from the
 * drive.
 *
 * THE OUTPUT STAGE IS THE REFERENCE'S, WITHOUT ITS CLIPPING. Exhaust pulses are sharp
 * transients, so raw gain clips long before it sounds loud. The reference's fast limiter
 * brings the running level up while the peaks stay clean, and where the reference then hit
 * the output ceiling and hard-clipped, a smooth saturation stage caps the output below
 * full scale, so nothing reaches the speaker hard-clipped however hard the engine is
 * pushed.
 *
 * WHY IT SLEEPS. The exhaust model is real DSP — a V8 costs a noticeable share of a core
 * — and it would otherwise run for the life of the page once sound had been used once.
 * `setEngineAudioActive` suspends the whole context shortly after nothing is sounding and
 * resumes it when something is.
 */

import {
  createPulseExhaust, setPulseExhaustGeometry, schedulePulseExhaust,
  tonePulseExhaust, silencePulseExhaust, wakePulseExhaust,
} from './pulseExhaust.js';

/**
 * How hard the limiter's output drives the saturation stage. The reference's make-up gain
 * was 2.4, which with the browser's own make-up on top pinned every layout at the ceiling
 * (a crest factor of 0.5-6 dB). At 1.4 the note sits as loud as the reference build did
 * — which, set side by side, is most of what a listener hears as "better" — while the
 * saturation only rounds the tops of the loudest pulses and nothing reaches the ceiling.
 */
const MAKEUP_GAIN = 1.4;

/** Input span of the saturation curve: tanh reaches 0.9999 by here. */
const SAT_RANGE = 5;

/**
 * Final level, scaled by the player's volume. tanh never exceeds 1, so nothing past this
 * point can reach full scale, however hard the engine is pushed.
 */
const OUTPUT_LEVEL = 0.89;

/** Parameter updates per second. Pulse scheduling is unthrottled; this is not. */
const PARAM_HZ = 14;

/**
 * Trim on the layers that bypass the limiter — blow-off, flutter, gearchange.
 *
 * They go straight to the output so the compression that makes the engine dense cannot
 * duck them, which also means they are the only things in the mix not held down by it.
 * With the bed no longer slammed into the ceiling they need to come down with it.
 */
const EFFECT_TRIM = 0.45;


/** Gas-temperature step, K, below which the tube network is not rebuilt. */
const GEOMETRY_TEMP_STEP_K = 25;

/**
 * Fields of an `exhaustGeometry` that follow from gas temperature alone. They are left
 * out of {@link geometryKey} and stood in for by one quantised temperature, because a
 * normally-fluctuating EGT would otherwise rebuild the delay lines on every frame.
 * Twenty-five kelvin moves the speed of sound by about one per cent, which is below what
 * anyone hears as a retune.
 */
const TEMPERATURE_FIELDS = new Set(['portK', 'tailK', 'cylinderK', 'cPrimary', 'cTail']);

/**
 * Signature of the geometry the exhaust was last given.
 *
 * EVERY OTHER FIELD IS IN IT, and that is the point. A hand-picked list of "the ones
 * that matter" missed the turbine and the compression ratio: fitting a turbo changes how
 * much the converter section absorbs and a compression change moves the clearance volume,
 * but neither moved a length or an area, so neither reached the audio thread until the
 * exhaust temperature happened to cross a step — which, with the engine stopped, it never
 * does. Enumerating the object means a field added to `exhaustGeometry` later is covered
 * without anyone having to remember this function.
 *
 * @param {Record<string, any>} geometry an `exhaustGeometry`
 * @param {boolean} openExhaust whether the muffler is replaced by straight pipe
 * @returns {string} equal for two geometries exactly when the model would be built the same
 */
export function geometryKey(geometry, openExhaust) {
  const parts = [openExhaust ? 'open' : 'muffled',
    Math.round(geometry.portK / GEOMETRY_TEMP_STEP_K)];
  for (const k of Object.keys(geometry).sort()) {
    if (TEMPERATURE_FIELDS.has(k)) continue;
    const v = geometry[k];
    parts.push(`${k}=${typeof v === 'number' ? v.toPrecision(6) : JSON.stringify(v)}`);
  }
  return parts.join('|');
}


/**
 * Builds the whole audio graph. Call once; it stays alive for the session.
 *
 * The graph holds no opinion about engine geometry at all: the layout arrives with the
 * exhaust geometry and the exhaust builds its firing pattern from it, so nothing here has
 * to be built per layout.
 *
 * @param {AudioContext} ctx
 * @returns {object} the node graph, or null if the context cannot be built
 */
export function createEngineAudio(ctx) {
  // The reference's limiter: a low threshold, a hard ratio and a fast attack, which is what
  // gives the note its dense, recorded sound while keeping the pulse peaks clean.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 8;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  const outGain = ctx.createGain(); outGain.gain.value = MAKEUP_GAIN;

  // SATURATION, where the reference had clipping. v4.8 drove the limiter's output straight
  // into the ceiling, and the hard clip there turned the low sine thump in its pulses into
  // a buzz — the only upper harmonics that thump had. The events now carry their own edge
  // and rush, so nothing needs manufacturing: the stage is a smooth tanh curve instead of a
  // wall, and then a fixed output level that no input can push past.
  const satIn = ctx.createGain(); satIn.gain.value = 1 / SAT_RANGE;
  const softClip = ctx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = ((i / (curve.length - 1)) * 2 - 1) * SAT_RANGE;
    curve[i] = Math.tanh(x);
  }
  softClip.curve = curve;
  softClip.oversample = '4x';
  const satOut = ctx.createGain(); satOut.gain.value = OUTPUT_LEVEL;
  limiter.connect(outGain); outGain.connect(satIn); satIn.connect(softClip);
  softClip.connect(satOut); satOut.connect(ctx.destination);

  const master = ctx.createGain(); master.gain.value = 0; master.connect(limiter);

  const noiseLen = 2 * ctx.sampleRate;
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = (Math.random() * 2 - 1) * 0.35;
  const noiseSource = () => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; return src;
  };

  // SHIFT CLUNK. A gear change is mechanical — dogs or synchros engaging make a short,
  // low, woody knock. Without it a shift is just a dip in level, which reads as a glitch
  // rather than as a gearchange. Straight to the output, so the limiter cannot duck it.
  const clunkFilt = ctx.createBiquadFilter();
  clunkFilt.type = 'bandpass'; clunkFilt.frequency.value = 190; clunkFilt.Q.value = 3.5;
  const clunkG = ctx.createGain(); clunkG.gain.value = 0;
  const clunkNoise = noiseSource();
  clunkNoise.connect(clunkFilt); clunkFilt.connect(clunkG); clunkG.connect(outGain);

  // TORQUE CONVERTER. A slipping converter has a fluid whine that rises with slip —
  // loudest off the line where the engine is spinning far faster than the gearbox input,
  // fading as it couples up. A manual has nothing equivalent, which is a large part of
  // why the two sound so different from a standstill.
  const convOsc = ctx.createOscillator(); convOsc.type = 'triangle'; convOsc.frequency.value = 320;
  const convFilt = ctx.createBiquadFilter();
  convFilt.type = 'bandpass'; convFilt.frequency.value = 500; convFilt.Q.value = 2.0;
  const convG = ctx.createGain(); convG.gain.value = 0;
  convOsc.connect(convFilt); convFilt.connect(convG); convG.connect(master);

  // Induction: air being dragged past a filter and down a runner.
  const indG = ctx.createGain(); indG.gain.value = 0;
  const indFilt = ctx.createBiquadFilter(); indFilt.type = 'bandpass'; indFilt.frequency.value = 1800; indFilt.Q.value = 1.2;
  const indNoise = noiseSource();
  indNoise.connect(indFilt); indFilt.connect(indG); indG.connect(master);

  // TURBO. A real turbo is not a pure tone — it is a narrow band of noise at the shaft's
  // rotating pressure field, sitting on a broadband rush of moving air. A bare sine is
  // the single biggest reason synthesised turbos sound fake, so the sine only marks the
  // pitch centre and the noise band carries the character.
  const whistle = ctx.createOscillator(); whistle.type = 'sine'; whistle.frequency.value = 3000;
  const whistleG = ctx.createGain(); whistleG.gain.value = 0;
  whistle.connect(whistleG); whistleG.connect(master);
  const bladeFilt = ctx.createBiquadFilter(); bladeFilt.type = 'bandpass';
  bladeFilt.frequency.value = 3000; bladeFilt.Q.value = 9;
  const bladeG = ctx.createGain(); bladeG.gain.value = 0;
  const bladeNoise = noiseSource();
  bladeNoise.connect(bladeFilt); bladeFilt.connect(bladeG); bladeG.connect(master);
  const rushFilt = ctx.createBiquadFilter(); rushFilt.type = 'bandpass';
  rushFilt.frequency.value = 1200; rushFilt.Q.value = 0.7;
  const rushG = ctx.createGain(); rushG.gain.value = 0;
  const rushNoise = noiseSource();
  rushNoise.connect(rushFilt); rushFilt.connect(rushG); rushG.connect(master);

  // Blow-off: trapped boost venting when the throttle shuts. It goes STRAIGHT to the
  // output — routed through master it gets ducked by the very compression that makes the
  // engine note loud, so it never cuts through.
  const bovFilt = ctx.createBiquadFilter(); bovFilt.type = 'bandpass'; bovFilt.frequency.value = 1500; bovFilt.Q.value = 0.9;
  const bovG = ctx.createGain(); bovG.gain.value = 0;
  const bovNoise = noiseSource();
  bovNoise.connect(bovFilt); bovFilt.connect(bovG); bovG.connect(outGain);

  // COMPRESSOR FLUTTER — the "stu-tu-tu". With the throttle shut and the wheel still
  // spinning, air stalls back across the compressor and surges forward again, over and
  // over. That is a PULSATION at 20-48 Hz, not a hiss, so it has to be gated air rather
  // than filtered noise. The gate's base value is 0.5 with a +/-0.5 square LFO so it
  // swings fully closed to fully open; leaving the base at 0 lets audio through at both
  // extremes, because negative gain only inverts phase.
  const flutFilt = ctx.createBiquadFilter(); flutFilt.type = 'bandpass';
  flutFilt.frequency.value = 850; flutFilt.Q.value = 2.4;
  const flutGate = ctx.createGain(); flutGate.gain.value = 0.5;
  const flutEnv = ctx.createGain(); flutEnv.gain.value = 0;
  const flutLfo = ctx.createOscillator(); flutLfo.type = 'square'; flutLfo.frequency.value = 28;
  const flutDepth = ctx.createGain(); flutDepth.gain.value = 0.55;
  flutLfo.connect(flutDepth); flutDepth.connect(flutGate.gain);
  const flutNoise = noiseSource();
  flutNoise.connect(flutFilt); flutFilt.connect(flutGate); flutGate.connect(flutEnv);
  flutEnv.connect(outGain);

  flutLfo.start(); convOsc.start();
  indNoise.start(); bladeNoise.start(); rushNoise.start();
  bovNoise.start(); flutNoise.start(); clunkNoise.start();

  // THE EXHAUST ITSELF, which is the whole note — see `pulseExhaust.js`. It also carries
  // the starter's grind and knock, as the reference's combustion noise did.
  const graph = {};
  graph.exhaust = createPulseExhaust(ctx);
  graph.exhaustGain = ctx.createGain();
  graph.exhaustGain.gain.value = 1;
  graph.exhaustGain.connect(master);
  graph.exhaust.out.connect(graph.exhaustGain);

  return Object.assign(graph, {
    ctx, limiter, outGain, softClip, satOut, master,
    indG, indFilt, whistle, whistleG, bladeFilt, bladeG, rushFilt, rushG,
    bovFilt, bovG, flutFilt, flutEnv, flutLfo,
    clunkFilt, clunkG, convOsc, convFilt, convG,
    prevBoostPsi: 0,
    // Signature of the geometry last sent to the exhaust, so a build that has not changed
    // is not re-sent sixty times a second.
    geomKey: '',
    // Far enough in the past that the first frame is never throttled away.
    paramsAt: -1e9,
    // Until this context time a gearchange owns the master gain; see `shiftEngineAudio`.
    shiftUntil: 0,
    // Whether anything should be sounding, and the pending suspend when nothing is.
    // See `setEngineAudioActive`.
    active: false,
    sleepTimer: null,
  });
}

/**
 * @typedef {object} EngineAudioFrame
 * @property {object} drive an `AcousticDrive` from `src/sim/acoustics.js`
 * @property {object} [geometry] an `exhaustGeometry` from `src/sim/acoustics.js` — the
 *   firing events, displacement, compression and tailpipe the note is voiced from. Sent
 *   to the exhaust only when it changes, which is when the build or the gas temperature
 *   does.
 * @property {number} rpm engine speed
 * @property {string} configuration engine layout
 * @property {number} load driver demand, 0..1 — a throttle position, not a physics term
 * @property {boolean} audible whether this engine should be heard at all right now
 * @property {boolean} cut whether fuel is cut (limiter, overrun)
 * @property {boolean} cranking whether the starter is turning it
 * @property {boolean} openExhaust whether a cat-back or headers are fitted
 * @property {boolean} intakeFitted whether an intake is fitted
 * @property {number} boostPsi current boost, for detecting a lift
 * @property {number} [volume] player-facing master volume, 1 being the tuned balance
 */

/**
 * Pushes one frame of engine state into the graph.
 *
 * Everything is written with `setTargetAtTime` rather than stepped, so the parameters
 * glide and no update can click.
 *
 * @param {object} a the graph from {@link createEngineAudio}
 * @param {EngineAudioFrame} frame
 */
export function updateEngineAudio(a, frame) {
  const {
    drive, geometry, configuration, load, audible, cut, cranking,
    openExhaust, intakeFitted, boostPsi,
  } = frame;
  const t = a.ctx.currentTime;
  // A caller may push frames far faster than any of these values can be heard changing,
  // and each one is a scheduled automation event. The pulse scheduler works at least 150 ms
  // ahead of the clock, so updating it at this rate costs it nothing.
  if (t - a.paramsAt < 1 / PARAM_HZ) return;
  a.paramsAt = t;

  // A rich mixture burns slower and softer; lean is sharp and thin.
  const richness = Math.max(-0.4, Math.min(0.8, (1 - (drive.lambda ?? 1)) * 2.2));
  const catBack = Boolean(openExhaust);

  if (geometry) {
    const key = geometryKey(geometry, openExhaust);
    if (key !== a.geomKey) {
      a.geomKey = key;
      setPulseExhaustGeometry(a.exhaust, a.ctx, geometry, key);
    }
  }
  if (a.exhaust) {
    const rpm = Math.max(0, frame.rpm);
    // A CUT ENGINE IS NOT QUIET. The injectors are off but the cylinders still pump, which
    // is exactly what the rev limiter and the overrun sound like — weaker, not silent.
    schedulePulseExhaust(a.exhaust, a.ctx, {
      rpm,
      level: audible ? 1 : 0,
      load,
      audible,
      cranking,
      cut,
      evoKpa: drive.evoKpa,
      portKpa: drive.portKpa,
      lopeSeverity: drive.lopeSeverity,
      covPersistence: drive.covPersistence,
    });
    tonePulseExhaust(a.exhaust, a.ctx, {
      rpm, load, richness, knock: drive.knockLevel, cranking, catBack, audible,
    });
  }
  a.exhaustGain.gain.setTargetAtTime(audible ? 1 : 0, t, 0.08);

  // Induction noise is the sound of air being moved, so it tracks airflow directly.
  a.indG.gain.setTargetAtTime(intakeFitted && audible ? drive.inductionLevel * 0.09 : 0, t, 0.06);

  if (drive.whistleHz > 0) {
    const boostFrac = Math.min(1.4, Math.max(0, boostPsi / 14));
    a.whistle.frequency.setTargetAtTime(drive.whistleHz, t, 0.07);
    a.whistleG.gain.setTargetAtTime(audible ? Math.min(0.012, boostPsi * 0.0014) * load : 0, t, 0.08);
    // The blade band sits at the same frequency but is noise, not a tone, and it carries
    // most of the character.
    a.bladeFilt.frequency.setTargetAtTime(drive.whistleHz, t, 0.07);
    a.bladeG.gain.setTargetAtTime(audible ? Math.min(0.22, boostFrac * 0.19) * (0.35 + 0.65 * load) : 0, t, 0.08);
    a.rushFilt.frequency.setTargetAtTime(800 + drive.inductionLevel * 1600, t, 0.1);
    // A small boosted engine is mostly induction noise — on a turbo four the whoosh
    // genuinely dominates the exhaust, which is why they sound so unlike a big naturally
    // aspirated engine making the same power.
    const smallEngineBias = Math.max(0.7, Math.min(2.1, 2.6 / Math.max(drive.displacementL, 1.2)));
    a.rushG.gain.setTargetAtTime(
      audible ? Math.min(0.21, drive.inductionLevel * 0.10 * (0.4 + boostFrac) * smallEngineBias) : 0, t, 0.1);
    a.rushFilt.Q.setTargetAtTime(configuration === 'I4' ? 0.45 : 0.8, t, 0.15);
  } else {
    a.whistleG.gain.setTargetAtTime(0, t, 0.1);
    a.bladeG.gain.setTargetAtTime(0, t, 0.1);
    a.rushG.gain.setTargetAtTime(0, t, 0.1);
  }

  // A lift with boost still in the pipe vents it, and if there is nowhere for it to go it
  // stalls back across the compressor instead.
  const lifted = load < 0.15 || cut;
  if (a.prevBoostPsi > 1.5 && lifted && audible) {
    const stored = a.prevBoostPsi;
    a.flutLfo.frequency.setValueAtTime(Math.min(48, 20 + stored * 1.7), t);
    a.flutFilt.frequency.cancelScheduledValues(t);
    a.flutFilt.frequency.setValueAtTime(1000 + stored * 25, t);
    a.flutFilt.frequency.exponentialRampToValueAtTime(500, t + 0.55);
    a.flutEnv.gain.cancelScheduledValues(t);
    a.flutEnv.gain.setValueAtTime(EFFECT_TRIM * Math.min(0.85, 0.30 + stored * 0.030), t);
    a.flutEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);

    a.bovG.gain.cancelScheduledValues(t);
    a.bovG.gain.setValueAtTime(EFFECT_TRIM * Math.min(1.25, 0.55 + stored * 0.045), t);
    a.bovG.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    a.bovFilt.frequency.cancelScheduledValues(t);
    a.bovFilt.frequency.setValueAtTime(3200 + stored * 95, t);
    a.bovFilt.frequency.exponentialRampToValueAtTime(420, t + 0.85);
    a.prevBoostPsi = 0;
  } else {
    a.prevBoostPsi = boostPsi;
  }

  // The whole engine follows the throttle: open it and it gets louder, and a fitted
  // cat-back or headers let a little more out. A fuel cut drops it right back, quickly.
  a.outGain.gain.setTargetAtTime(MAKEUP_GAIN, t, 0.08);
  a.satOut.gain.setTargetAtTime(OUTPUT_LEVEL * (frame.volume ?? 1), t, 0.08);
  const vol = (cut ? 0.10 : 0.55 + load * 0.60) * (catBack ? 1.18 : 1);
  // A gearchange schedules its own dip and swell on this gain. A target written on top
  // of it would be inserted INTO that schedule and pull the level straight back up
  // through the gap, so while one is playing it is left alone.
  if (t >= a.shiftUntil) a.master.gain.setTargetAtTime(audible ? vol : 0, t, cut ? 0.015 : 0.06);
}

/**
 * Fires a gear-change noise.
 *
 * A manual disconnects completely: the note falls away, the dogs engage with a hard
 * mechanical knock, and it catches again as the clutch comes back out. An automatic never
 * disconnects at all — a converter is a fluid coupling, so the engine keeps driving the
 * car through the change and you get a soft dip and a swell instead of a gap, with no
 * engagement noise to hear.
 *
 * @param {object} a the graph from {@link createEngineAudio}
 * @param {{automatic: boolean}} opts
 */
export function shiftEngineAudio(a, { automatic }) {
  const t = a.ctx.currentTime;
  const back = a.master.gain.value > 0.05 ? a.master.gain.value : 0.7;
  a.master.gain.cancelScheduledValues(t);
  a.master.gain.setValueAtTime(a.master.gain.value, t);
  a.clunkG.gain.cancelScheduledValues(t);
  a.clunkFilt.frequency.cancelScheduledValues(t);

  a.shiftUntil = t + (automatic ? 0.26 : 0.30);

  if (automatic) {
    a.master.gain.linearRampToValueAtTime(back * 0.62, t + 0.05);   // slips, never releases
    a.master.gain.linearRampToValueAtTime(back * 1.06, t + 0.15);   // clutch packs take up
    a.master.gain.linearRampToValueAtTime(back, t + 0.26);
    // A soft low swell rather than a knock — the shift you feel more than hear.
    a.clunkG.gain.setValueAtTime(0.0001, t + 0.03);
    a.clunkG.gain.linearRampToValueAtTime(EFFECT_TRIM * 0.13, t + 0.09);
    a.clunkG.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    a.clunkFilt.frequency.setValueAtTime(120, t + 0.03);
    a.clunkFilt.Q.setValueAtTime(1.2, t + 0.03);
  } else {
    a.master.gain.linearRampToValueAtTime(0.03, t + 0.045);         // clutch in
    a.master.gain.setValueAtTime(0.03, t + 0.13);                   // gap while shifting
    a.master.gain.linearRampToValueAtTime(back * 1.12, t + 0.20);   // clutch out, flare
    a.master.gain.linearRampToValueAtTime(back, t + 0.30);
    a.clunkG.gain.setValueAtTime(0.0001, t + 0.10);
    a.clunkG.gain.linearRampToValueAtTime(EFFECT_TRIM * 0.55, t + 0.118);
    a.clunkG.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
    a.clunkFilt.Q.setValueAtTime(3.5, t + 0.10);
    a.clunkFilt.frequency.setValueAtTime(240, t + 0.10);
    a.clunkFilt.frequency.exponentialRampToValueAtTime(140, t + 0.20);
  }
}

/**
 * Sets the torque-converter whine.
 *
 * @param {object} a the graph from {@link createEngineAudio}
 * @param {{rpm: number, slip: number, audible: boolean}} opts slip is 0 (locked up) to 1
 */
export function converterEngineAudio(a, { rpm, slip, audible }) {
  const t = a.ctx.currentTime;
  a.convOsc.frequency.setTargetAtTime(240 + rpm * 0.055, t, 0.08);
  a.convFilt.frequency.setTargetAtTime(420 + rpm * 0.09, t, 0.08);
  a.convG.gain.setTargetAtTime(audible ? Math.max(0, Math.min(1, slip)) * 0.055 : 0, t, 0.1);
}

/**
 * Plays a short tone. Used for the staging-tree lights, and as an audio self-test —
 * if this is silent the problem is the device or the browser, not the engine model.
 *
 * @param {object} a the graph from {@link createEngineAudio}
 * @param {{hz: number, seconds: number, gain: number}} opts
 */
export function beepEngineAudio(a, { hz, seconds, gain }) {
  const t = a.ctx.currentTime;
  const osc = a.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = hz;
  const g = a.ctx.createGain(); g.gain.value = 0;
  osc.connect(g); g.connect(a.outGain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.start(t); osc.stop(t + seconds + 0.05);
  osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* already gone */ } };
}

/**
 * Cancels every scheduled ramp and pins each layer to zero.
 *
 * Scheduled ramps — a blow-off, a flutter burst — can leave a gain parked open if a run
 * ends mid-ramp, so stopping is its own operation rather than a smoothed target the main
 * update happens to write.
 *
 * @param {object} a the graph from {@link createEngineAudio}
 */
export function silenceEngineAudio(a) {
  const t = a.ctx.currentTime;
  const kill = (node) => {
    if (!node) return;
    try { node.gain.cancelScheduledValues(t); node.gain.setValueAtTime(0, t); } catch { /* noop */ }
  };
  kill(a.master); kill(a.exhaustGain); kill(a.indG);
  kill(a.whistleG); kill(a.bladeG); kill(a.rushG); kill(a.bovG); kill(a.flutEnv);
  kill(a.clunkG); kill(a.convG);
  // Pulses already handed to the clock cannot be unscheduled, so the exhaust needs telling
  // to stop rather than just being turned down — otherwise a stopped engine keeps firing
  // for the length of the scheduling horizon.
  if (a.exhaust) silencePulseExhaust(a.exhaust, a.ctx);
  a.prevBoostPsi = 0;
}

/**
 * How long the context keeps running after the last sound stops, seconds. Long enough
 * for a silenced gain to settle and a blow-off tail to finish; short enough that a
 * stopped engine costs nothing to speak of.
 */
const SLEEP_AFTER_S = 0.5;

/**
 * Suspends the context after `seconds`, unless something becomes active first.
 *
 * @param {object} a the graph from {@link createEngineAudio}
 * @param {number} seconds grace period
 */
function scheduleSleep(a, seconds) {
  clearTimeout(a.sleepTimer);
  a.sleepTimer = setTimeout(() => {
    a.sleepTimer = null;
    if (!a.active && a.ctx.state === 'running') a.ctx.suspend?.();
  }, seconds * 1000);
}

/**
 * Says whether anything should be sounding, and puts the whole graph to sleep when not.
 *
 * AUDIO IS NOT FREE. An AudioContext that is never suspended runs every oscillator, loop
 * and noise source in the graph for the life of the page once sound has been used once:
 * stopped engine, sound switched off, player on another tab. On a phone that is battery
 * spent on nothing.
 *
 * So going inactive silences every layer at once (a scheduled ramp can otherwise leave a
 * gain parked open) and suspends the context a moment later; going active resumes it.
 * Every path that starts a sound — START, RUN, the sound toggle — already resumes the
 * context from inside the user's tap, which is what unlocks audio in the first place, so
 * resuming here is only ever undoing this function's own suspend.
 *
 * @param {object} a the graph from {@link createEngineAudio}
 * @param {boolean} active whether an engine (or the drag tree) should be audible now
 */
export function setEngineAudioActive(a, active) {
  if (active) {
    a.active = true;
    clearTimeout(a.sleepTimer);
    a.sleepTimer = null;
    if (a.ctx.state === 'suspended') a.ctx.resume?.();
    // Going inactive pinned the exhaust's bus to zero, and a pinned gain stays pinned.
    // Without lifting it here, every engine after the first stop came back near-silent —
    // and switching engines always stops the one running.
    if (a.exhaust) wakePulseExhaust(a.exhaust, a.ctx);
    return;
  }
  a.active = false;
  silenceEngineAudio(a);
  scheduleSleep(a, SLEEP_AFTER_S);
}

/**
 * Wakes the context for a one-off sound — the TEST beep, a tree light — and lets it
 * sleep again afterwards if nothing else is sounding by then.
 *
 * @param {object} a the graph from {@link createEngineAudio}
 * @param {number} holdSeconds how long the one-off sound needs
 * @returns {Promise<void>} settles once the context has resumed (or failed to)
 */
export function wakeEngineAudio(a, holdSeconds) {
  const resumed = Promise.resolve(a.ctx.state === 'suspended' ? a.ctx.resume?.() : undefined);
  // `silenceEngineAudio` pins the pulse bus to zero, and a gain pinned to zero stays there
  // however many pulses are scheduled into it. Waking has to lift it again or the engine
  // comes back silent.
  if (a.exhaust) wakePulseExhaust(a.exhaust, a.ctx);
  if (!a.active) scheduleSleep(a, holdSeconds + SLEEP_AFTER_S);
  return resumed;
}
