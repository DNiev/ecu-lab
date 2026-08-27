/**
 * The engine synthesiser.
 *
 * Presentation only. Every number that describes the ENGINE arrives in an
 * `AcousticDrive` from `src/sim/acoustics.js`; nothing here works out what the engine is
 * doing. What lives here is how to turn those numbers into Web Audio nodes — which is a
 * rendering problem, not a physics one, and is why this file sits in `src/ui/`.
 *
 * HOW THE SOUND IS BUILT
 *
 * The note is a train of discrete exhaust pulses, not a waveform. That is the single
 * decision the whole file turns on. An oscillator sweeping in pitch sounds like a
 * synthesiser because it is one; a burst of individually scheduled pressure pulses,
 * arriving at the crank angles the engine actually fires at, sounds like an engine
 * because the ear resolves the pulses and hears their rhythm.
 *
 * EVERY FIRING EVENT IS SCHEDULED, at every engine speed, right up to redline. There used
 * to be a looped buffer above the point where the ear stops resolving individual pulses,
 * on the reasoning that one node per event costs more than it is worth up there. It costs
 * about twenty milliseconds of main thread per second at 7000 rpm, which is two per cent
 * of a core — and the loop it replaced was doing real damage: a loop is pitched by playback
 * rate, so every resonance baked into it rises with engine speed like a tape running fast,
 * and its bandwidth is whatever it was rendered at. Measured, handing over to it at 5500
 * rpm cost 26 dB of content above 4 kHz and collapsed the harmonic comb from 30 dB to 11.
 * One mechanism at every speed is both cheaper to reason about and the only correct one.
 *
 * Underneath the train sits a faint pulse-wave and sub oscillator that only fill in body.
 * If that layer is ever loud enough to notice on its own, the result stops sounding like
 * an engine.
 *
 * Everything then passes through an exhaust model: two resonant bodies, a lowpass, and
 * a delay line with feedback standing in for the pipe itself. A pipe is a resonant tube
 * — a pulse travels down it, reflects off the open end, and comes back — and a short
 * feedback delay reproduces that directly. It is the largest single difference between
 * "filtered buzz" and something that sounds like it came out of a car.
 *
 * WHY THERE IS A LIMITER. Exhaust pulses are sharp transients, so raw gain clips long
 * before it sounds loud. Compressing the output lets the average level come up a long
 * way while the peaks stay clean, which is the same reason engine recordings are
 * compressed before anyone hears them.
 */


import { ExhaustProcessor, PROCESSOR_NAME } from './exhaustProcessor.js';
import EXHAUST_PROCESSOR_SOURCE from './exhaustProcessor.js?raw';

/**
 * How each layout is voiced.
 *
 * A NOTE ON `oscGain` AND `subGain`. They are a steady tonal bed at the firing order and
 * at half of it, and they are deliberately small. A real engine's tone is not a drone with
 * pulses laid over it — the tone IS the pulse train, heard fast enough that the ear fuses
 * it. Anything held steady underneath is the most static thing in the mix by definition,
 * and static is what a listener identifies as synthetic: measured, running these an octave
 * louder buries a third of the spectrum above 2 kHz and flattens the peak-to-average ratio
 * that makes the note read as mechanical. They are here to fill the very bottom, not to
 * carry the note.
 *
 * These are mixing decisions, not physics — the physics of why a V8 rumbles is the
 * firing geometry in `acoustics.js`, and it arrives here as the event list. What is
 * here is how each layout's exhaust system is shaped: a V8's collectors are large and
 * loose and blur its uneven pulses into a rumble, an inline four's are small and tight
 * so its widely spaced pulses stay individually audible.
 */
const VOICING = {
  I4: { exhaustGain: 1.20 },
  I6: { exhaustGain: 1.00 },
  V6: { exhaustGain: 1.05 },
  V8: { exhaustGain: 0.92 },
};

/**
 * Make-up gain after the limiter, before the brickwall.
 *
 * Set with the leveller above rather than against it: the compressor pulls a 20 dB range
 * down to about 10, and this puts what is left where it can be heard — idle around
 * -12 dBFS peak and the loudest build just under full scale. The brickwall after it
 * catches whatever the slow attack lets through.
 */
const MAKEUP_GAIN = 3.0;

/**
 * How much turbulence the model injects at the valve seat, as a multiplier on the flow
 * velocity through it.
 *
 * This is the one knob that decides how PITCHED the note is against how RASPY. At zero the
 * waveguide is perfectly periodic and reads as a buzzer; wound up it fills the gaps between
 * the harmonics with noise and reads as hiss. Measured as harmonic comb contrast — level at
 * multiples of the engine cycle rate against level between them — this lands it at roughly
 * 20 dB in the mid band and 13 dB at the top, which is where real recordings sit.
 */
const EXHAUST_JET = 0.30;

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

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Block size for the main-thread fallback below.
 *
 * 1024 samples is 23 ms, which is short enough that a throttle blip does not feel late and
 * long enough to survive an ordinary React render without the buffer running dry.
 */
const FALLBACK_BLOCK = 1024;

/**
 * Creates the node the exhaust model runs in, whichever way this browser allows.
 *
 * AN AUDIOWORKLET IS THE RIGHT PLACE FOR THIS and it is tried first: the audio thread, at
 * sample resolution, immune to whatever the UI is doing. But a worklet module has to be
 * fetched from a URL, and this app also ships as a single inlined HTML page served under a
 * strict content-security policy. Measured there, `addModule` rejects with AbortError for
 * a `blob:` URL AND for a `data:` one — so the exhaust never loaded and the app was
 * completely silent, while the same build served from a dev server was fine. That is a bad
 * failure to have: silent, browser-dependent, and invisible to every test that runs the
 * DSP directly.
 *
 * So there is a second path. The processor is a plain class, so on failure it is
 * instantiated on the main thread and driven from a ScriptProcessorNode, which needs no
 * module loading and is refused by nothing. Same code, same coefficients, same output; it
 * costs main-thread time and can glitch under heavy layout, which is the price of working
 * everywhere. The shim below gives it the two things it expects from Web Audio — a port to
 * receive geometry on, and parameters that smooth — so nothing above this line knows or
 * cares which one it got.
 *
 * @param {AudioContext} ctx
 * @param {(node: any) => void} ready called with the node once it exists
 */
function createExhaustNode(ctx, ready) {
  const fallback = () => {
    let processor;
    try {
      processor = new ExhaustProcessor({ processorOptions: { sampleRate: ctx.sampleRate } });
    } catch { return; }
    const node = ctx.createScriptProcessor(FALLBACK_BLOCK, 0, 2);
    /** One audio parameter, smoothed the way `setTargetAtTime` smooths. */
    const param = (value) => {
      const p = {
        value,
        target: value,
        coeff: 0,
        setTargetAtTime(v, _t, tau) {
          p.target = v;
          p.coeff = Math.exp(-FALLBACK_BLOCK / (ctx.sampleRate * Math.max(1e-3, tau)));
        },
        setValueAtTime(v) { p.target = v; p.value = v; p.coeff = 0; },
        cancelScheduledValues() { p.target = p.value; p.coeff = 0; },
        step() { p.value = p.target + (p.value - p.target) * p.coeff; return p.value; },
      };
      return p;
    };
    /** @type {Record<string, any>} */
    const params = {};
    for (const d of ExhaustProcessor.parameterDescriptors) params[d.name] = param(d.defaultValue);
    /** @type {Record<string, Float32Array>} */
    const view = {};
    for (const name of Object.keys(params)) view[name] = new Float32Array(1);
    node.onaudioprocess = (e) => {
      for (const name of Object.keys(params)) view[name][0] = params[name].step();
      processor.process([], [[e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1)]], view);
    };
    // A ScriptProcessorNode only runs while it is connected to something, so it is wired
    // up here and the caller connects it onward.
    ready({
      port: { postMessage: (data) => processor.port.onmessage?.({ data }) },
      parameters: { get: (name) => params[name] },
      connect: (dest) => node.connect(dest),
      disconnect: () => node.disconnect(),
    });
  };

  if (!ctx.audioWorklet) { fallback(); return; }
  let url;
  try {
    url = URL.createObjectURL(new Blob([EXHAUST_PROCESSOR_SOURCE], { type: 'text/javascript' }));
  } catch { fallback(); return; }
  ctx.audioWorklet.addModule(url).then(() => {
    URL.revokeObjectURL(url);
    ready(new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    }));
  }).catch(() => {
    URL.revokeObjectURL(url);
    fallback();
  });
}

/**
 * Builds the whole audio graph. Call once; it stays alive for the session.
 *
 * The graph holds no opinion about engine geometry at all: the firing order arrives per
 * frame on `drive.events` and is placed by the scheduler, so nothing here has to be built
 * per layout.
 *
 * @param {AudioContext} ctx
 * @returns {object} the node graph, or null if the context cannot be built
 */
export function createEngineAudio(ctx) {
  // A SAFETY NET, NOT A SOUND. It is set to catch the top few decibels of the loudest
  // pulses and nothing else — see MASTER_TRIM for why it used to be doing far more than
  // that, and why an engine cannot survive it.
  // A LEVELLER, NOT A LIMITER, and the distinction is the whole reason it is safe.
  //
  // The exhaust model's own dynamic range from idle to redline is about 20 dB, which is
  // real and correct — but it means that calibrating the loud end leaves idle at -21 dBFS,
  // and on a phone that is inaudible. Measured, that is exactly what a player got.
  //
  // The fix is not more gain: it is the same thing a recording chain does, which is to
  // compress the ENVELOPE and leave the transients alone. The attack is eighty
  // milliseconds — far slower than the five between firing events at 3000 rpm — so
  // individual pulses pass through untouched and only the running level is pulled up.
  // A fast attack here is what flattens an engine into a slab; a slow one is what makes a
  // quiet one audible without doing that.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -20;
  limiter.knee.value = 12;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.08;
  limiter.release.value = 0.4;
  const outGain = ctx.createGain(); outGain.gain.value = MAKEUP_GAIN;

  // A brickwall after the make-up gain. The limiter is a compressor, so a fast enough
  // transient still gets past it, and anything over full scale is HARD clipped by the
  // output — which is audible as a tearing edge on exactly the loudest pulses.
  //
  // Linear below the knee and rounded above it. A plain tanh is a saturator: it is
  // already bending the curve at half scale, so it eats the very transients this renderer
  // exists to produce. This one is transparent until the signal is nearly at the ceiling
  // and only then rounds over, which is what makes it a brickwall rather than a colour.
  const softClip = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  const knee = 0.72;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x
      : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  softClip.curve = curve;
  softClip.oversample = '2x';
  limiter.connect(outGain); outGain.connect(softClip); softClip.connect(ctx.destination);

  const master = ctx.createGain(); master.gain.value = 0; master.connect(limiter);

  const noiseLen = 2 * ctx.sampleRate;
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = (Math.random() * 2 - 1) * 0.35;
  const noiseSource = () => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; return src;
  };

  // THE ONLY BROADBAND BED LEFT, and it carries two things that are genuinely random:
  // the starter grinding, and detonation. Everything that used to be here — a blanket of
  // "combustion roughness" rising with load — is gone, because the exhaust model makes its
  // own turbulence at the valve seat, where it belongs and where it arrives in pulses.
  const noise = noiseSource();
  const ng = ctx.createGain(); ng.gain.value = 0;
  const ngFilt = ctx.createBiquadFilter();
  ngFilt.type = 'bandpass'; ngFilt.frequency.value = 2600; ngFilt.Q.value = 0.8;
  noise.connect(ngFilt); ngFilt.connect(ng); ng.connect(master);

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
  noise.start(); indNoise.start(); bladeNoise.start(); rushNoise.start();
  bovNoise.start(); flutNoise.start(); clunkNoise.start();

  // THE EXHAUST ITSELF, which is the whole note and is not built out of any of the above.
  //
  // It runs a one-dimensional acoustic model of a real exhaust system at audio rate — see
  // `exhaustProcessor.js`. A scattering junction cannot be built out of Web Audio nodes:
  // any cycle through the graph costs a whole render block, and a collector is nothing but
  // a cycle. So the model runs as sample-rate code, either in an AudioWorklet or, where
  // one cannot be loaded, on the main thread. See `createExhaustNode`.
  const graph = {};
  graph.exhaust = null;
  graph.exhaustGain = ctx.createGain();
  graph.exhaustGain.gain.value = 1;
  graph.exhaustGain.connect(master);
  createExhaustNode(ctx, (node) => {
    node.connect(graph.exhaustGain);
    graph.exhaust = node;
    if (graph.pendingGeometry) node.port.postMessage(graph.pendingGeometry);
  });

  return Object.assign(graph, {
    ctx, limiter, outGain, softClip, master,
    ng, ngFilt, indG, indFilt, whistle, whistleG, bladeFilt, bladeG, rushFilt, rushG,
    bovFilt, bovG, flutFilt, flutEnv, flutLfo,
    clunkFilt, clunkG, convOsc, convFilt, convG,
    prevBoostPsi: 0,
    // Signature of the geometry last sent to the worklet, so a build that has not changed
    // does not rebuild the tube network sixty times a second.
    geomKey: '',
    // Far enough in the past that the first frame is never throttled away.
    paramsAt: -1e9,
  });
}

/**
 * @typedef {object} EngineAudioFrame
 * @property {object} drive an `AcousticDrive` from `src/sim/acoustics.js`
 * @property {object} [geometry] an `exhaustGeometry` from `src/sim/acoustics.js` — the
 *   tube lengths and areas the waveguide is built from. Sent to the audio thread only
 *   when it changes, which is when the build or the gas temperature does.
 * @property {number} rpm engine speed
 * @property {string} configuration engine layout, keying {@link VOICING}
 * @property {number} load driver demand, 0..1 — a throttle position, not a physics term
 * @property {boolean} audible whether this engine should be heard at all right now
 * @property {boolean} cut whether fuel is cut (limiter, overrun)
 * @property {boolean} cranking whether the starter is turning it
 * @property {number} pipeDiaIn exhaust pipe diameter, inches
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
  // and each one is a scheduled automation event. The exhaust itself is not affected:
  // its crank runs on the audio thread at sample resolution, so nothing about its timing
  // depends on how often this is called.
  if (t - a.paramsAt < 1 / PARAM_HZ) return;
  a.paramsAt = t;
  const voice = VOICING[configuration] || VOICING.I4;

  // RASP. Burning later dumps more of the heat out through the valve instead of into the
  // crank, so more energy goes through the seat and the jet there is more violent.
  //
  // Mixture needs no term of its own any more, and that is worth noticing: a rich charge
  // burns cooler, a cooler charge carries a lower speed of sound, and every tube in the
  // model is length divided by that speed. The whole system retunes itself and softens,
  // from the gas temperature the cycle already computed. It used to need a voicing knob.
  const rasp = clamp01(drive.retardDeg / 12);

  // --- THE EXHAUST -------------------------------------------------------------------
  // Two things go to the waveguide: the system's GEOMETRY, which changes only when the
  // build does, and the engine's STATE, which changes continuously. Nothing here shapes
  // the note. It says how long the tubes are and how hard the cylinder is pushing, and
  // the model works out what that sounds like.
  if (geometry) {
    // Gas temperature is quantised into 25 K steps so a normally-fluctuating EGT does not
    // rebuild the delay lines on every frame. Twenty-five kelvin moves the speed of sound
    // by about one per cent, which is below what anyone hears as a retune.
    const key = `${configuration}|${geometry.primaryLength.toFixed(3)}`
      + `|${geometry.primaryArea.toFixed(6)}|${geometry.tailArea.toFixed(6)}`
      + `|${geometry.tailLength.toFixed(3)}|${Math.round(geometry.portK / 25)}`
      + `|${openExhaust ? 'open' : 'muffled'}`;
    if (key !== a.geomKey) {
      a.geomKey = key;
      a.pendingGeometry = { ...geometry, muffled: !openExhaust };
      if (a.exhaust) a.exhaust.port.postMessage(a.pendingGeometry);
    }
  }
  if (a.exhaust) {
    const p = a.exhaust.parameters;
    // Engine speed, and the pressure the cylinder has reached by the time its valve
    // cracks. Those two numbers are the entire excitation: everything else the listener
    // hears is what the pipes do with them.
    p.get('rpm').setTargetAtTime(Math.max(0, frame.rpm), t, 0.05);
    p.get('evoPa').setTargetAtTime(Math.max(0, drive.evoKpa) * 1000, t, 0.06);
    p.get('manifoldPa').setTargetAtTime(Math.max(5, drive.empKpa) * 1000, t, 0.1);
    p.get('overlapDeg').setTargetAtTime(drive.overlapDeg, t, 0.2);
    // Turbulence at the valve seat rises with how hard the gas is being pushed through
    // it, and a retarded engine sends more energy out of the port, so it rasps.
    p.get('jet').setTargetAtTime(
      EXHAUST_JET * (0.7 + 0.6 * clamp01(drive.exhaustDrive)) * (1 + rasp * 0.4), t, 0.1);
    p.get('lope').setTargetAtTime(drive.lopeSeverity, t, 0.15);
    p.get('covPersistence').setValueAtTime(drive.covPersistence, t);
    // A stopped engine is silent, and the waveguide keeps ringing for a few milliseconds
    // after it stops, which is correct — the gas in the pipe does not know the ignition has
    // been switched off.
    //
    // A CUT ENGINE IS NOT QUIET, and this used to say it was: a fuel cut scaled the level
    // to 0.18, so the rev limiter — the loudest, angriest thing a road engine does — came
    // out fifteen decibels below the rest of the rev range and the overrun after it was
    // louder than wide-open throttle. Nothing needs saying here at all. A cut is an absent
    // combustion, `acousticDrive` reports it as motored cylinder pressure at valve opening,
    // and the waveguide renders a cylinder of air being pumped out of a port at 7500 rpm,
    // which is what it is.
    p.get('level').setTargetAtTime(audible ? (frame.volume ?? 1) : 0, t, 0.05);
  }
  a.exhaustGain.gain.setTargetAtTime(audible ? voice.exhaustGain : 0, t, 0.08);


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

  // THIS BED CARRIES ONLY WHAT IS GENUINELY APERIODIC, and that is a deliberate cut.
  //
  // It used to carry a blanket `0.03 + load*0.045 + contMix*0.11` — constant white noise
  // rising to 0.185 at high load, where the mix is thinnest. Measured, it was the single
  // loudest thing above 2 kHz: muting it at 5500 rpm moved comb contrast in that band from
  // 4.7 dB to 14.3 dB. A running engine is periodic
  // (see CYL_DETUNE), and a steady hiss laid across it is the most synthetic-sounding
  // thing it is possible to add, because it is the one component with no engine in it.
  //
  // Combustion roughness is real, but it is per-event — it belongs to the blowdown, where
  // the jet noise now carries it, arriving in pulses and repeating every cycle. What is
  // left here is the starter, which is genuinely a random scrape, and knock, which is
  // genuinely stochastic detonation and has to sound like it.
  a.ng.gain.setTargetAtTime(cranking ? 0.12 : drive.knockLevel * 0.06, t, 0.05);

  // THERE IS NO LEVEL CURVE ANY MORE, and that is the point. How loud an engine is at a
  // given moment used to be a power law applied to a pressure amplitude; now it is simply
  // how hard the model is actually pushing gas out of a pipe. Idle is quiet because a
  // throttled cylinder reaches valve opening barely above manifold pressure, and wide-open
  // throttle is loud because it reaches four bar. Measured end to end that spread is about
  // 17 dB, which is a real engine's, and none of it is asserted anywhere.
  a.outGain.gain.setTargetAtTime(MAKEUP_GAIN, t, 0.08);
  a.master.gain.setTargetAtTime(audible ? 1 : 0, t, cut ? 0.015 : 0.06);
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
  kill(a.clunkG); kill(a.convG); kill(a.ng);
  // The waveguide keeps its own state, so silencing it means stopping the engine turning
  // as well as closing the gain — otherwise it carries on venting into a muted pipe.
  if (a.exhaust) {
    try {
      a.exhaust.parameters.get('level').cancelScheduledValues(t);
      a.exhaust.parameters.get('level').setValueAtTime(0, t);
      a.exhaust.parameters.get('rpm').cancelScheduledValues(t);
      a.exhaust.parameters.get('rpm').setValueAtTime(0, t);
    } catch { /* noop */ }
  }
  a.prevBoostPsi = 0;
}
