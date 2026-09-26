/**
 * The exhaust note: every firing event computed from the engine, played through the
 * exhaust system computed from the build.
 *
 * WHERE THE SOUND COMES FROM
 *
 * Each time a cylinder's exhaust valve opens, `exhaustEvent` (src/sim/acoustics.js) works
 * out the gas leaving it, sample by sample: the blowdown through a valve opening along
 * the cam's flank, choked and then subsonic, and then the piston pushing out what is left.
 * That flow, with the turbulence it carries, is the SOURCE. Nothing about it is drawn by
 * hand: the pressure the cylinder opens at is the tune (timing, boost, load, fuelling), the
 * valve is the bore, the volume being emptied is the displacement and the compression, and
 * how the event is spread in time is the cam and the engine speed.
 *
 * The source then goes through the EXHAUST SYSTEM, which is `exhaustImpulseResponse`: the
 * primaries, collector, converter, muffler and tailpipe as tubes that carry, reflect and
 * absorb a pressure wave, computed from the build and played through a convolver. That is
 * what turns a train of gas pulses into a note — and the same approach, a gas-dynamics
 * source convolved with an exhaust's response, is what the best-regarded engine simulator
 * there is (AngeTheGreat's Engine Simulator) does with a recorded one. Here it is computed,
 * so a bigger pipe, headers, a cat-back or a turbine are each heard for what they do.
 *
 * WHY THIS IS NOT THE VERSION BEFORE IT
 *
 * That one radiated each event's rate of change straight to the speaker, through the
 * reference build's (v4.8) fixed filters, with wide-band hiss on top. Its sixes came out
 * "computery" — a fixed comb and fixed resonances with nothing around them — and at the
 * redline everything sounded like air blowing, because hiss rises with flow faster than
 * the note does. Now:
 *
 *   1. The source is the FLOW, the way engine-sim feeds its convolver, and its turbulence
 *      rides on the flow (it cannot exist without it) at a jet's own turbulence intensity,
 *      band-limited to what a pipe carries, about 2 kHz. The pipes decide what reaches the
 *      treble, as they do.
 *   1a. At load each pulse STEEPENS on its way down the primary (`steepenPulse`): a big
 *      pulse's crest outruns its base, and the front sharpens towards a shock. That is
 *      where an exhaust's bark comes from — the harmonics the reference build could only
 *      get by clipping — and why an idle thuds while full throttle cracks.
 *   2. The pipes are real pipes. Many resonances, not two, set by lengths and areas, each
 *      decaying at its own rate — which is what the ear hears as a system rather than a
 *      filter. The mean flow through them damps them as it does in the metal: at idle the
 *      gas barely moves and the pipes ring, which is the burble; flat out it runs at a
 *      fifth of the speed of sound and they do not, so a revving engine is carried by its
 *      firing pulses and sings rather than buzzing (`updateFlow`).
 *   3. Each cylinder reaches the collector through its own primary, so a cast manifold's
 *      unequal runners stagger the pulses by milliseconds and tuned headers line them up.
 *   4. The note plays into a space — a ground bounce, a few reflections and a short tail —
 *      because a tailpipe in a vacuum is what "computery" sounds like.
 *   5. Every engine is matched on what comes out of its pipes, in the band a phone speaker
 *      plays (250 Hz-5 kHz), and a level-follower brings idle up towards full throttle
 *      without flattening the difference. Matching on the source instead left engines
 *      whose energy sat below a phone's range — a V8's burble, a turbine-muffled six —
 *      sounding quiet, with only their hiss and ticks left to hear.
 *
 * A REAL ENGINE NEVER REPEATS ITSELF, so neither does this: combustion scatters from cycle
 * to cycle (`combustionScatter`), each cylinder breathes a little differently, and at idle a
 * strong cycle speeds the crank so the next event arrives early. A fuel cut burns nothing,
 * so nothing scatters. Where the pulses fall is still
 * `firingEvents`: a cross-plane V8's banks are offset, so its events are unevenly spaced,
 * and that unevenness is the rumble.
 *
 * STARTING. The starter turns the engine against compression: every cylinder coming up on
 * its compression stroke slows the crank and every one going over the top lets it run, so
 * the crank surges several times a revolution. The starter's gear whine follows that
 * surge, which is the "rur-rur-rur" of an engine turning over. When it catches the starter
 * lets go and spins down.
 *
 * HOW IT REACHES THE SPEAKER. Events are laid into rings of samples, one per bank, as they
 * are computed, and the rings are played out in short buffers scheduled back to back a
 * little ahead of the clock, each into its bank's convolver. How far ahead grows if the
 * page ever holds the thread long enough to run the queue dry (`LOOKAHEAD`), and the
 * crank glides between the engine speeds it is handed (`RPM_GLIDE`), so neither a busy
 * phone nor a stepped dyno sweep is heard as a stutter or a ratchet.
 */

import {
  ACOUSTIC, combustionScatter, exhaustEvent, exhaustImpulseResponse, primaryLengthsM,
  steepenPulse, tailpipeMach,
} from '../../sim/acoustics.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Clamp, but treat a non-finite value as the low end rather than passing it on.
 *
 * A single NaN written to an AudioParam THROWS, and the throw unwinds the whole frame, so
 * one bad number upstream takes every other layer's update with it and the app goes silent
 * — a failure that is invisible until someone notices there is no sound.
 *
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
const safe = (v, lo, hi) => (Number.isFinite(v) ? clamp(v, lo, hi) : lo);

/** Samples in each scheduled buffer. */
const CHUNK = 1024;

/**
 * How far ahead of the clock the stream is computed, seconds: `min` normally, so the note
 * answers the throttle at once. The stream is computed on the page's main thread, and on a
 * slow phone the page's own work — a dyno chart redrawing, the simulation stepping — can
 * hold that thread for longer than `min`. The audio already queued then runs out, and the
 * note stutters: a rough, scraping stop-start. So when the stream finds it has run out it
 * queues far enough ahead to have covered that gap, plus `margin` — or `max`, if it ran
 * out within `again` seconds before too; when it has nearly run out it queues `grow` times
 * further; and once `hold` seconds have passed since it last ran out, it eases back by
 * `decay` seconds per second of smooth running. Every step ahead is also that much delay
 * between the throttle and the note, which is why `min` is small and the way back quick.
 * A fast device never leaves `min`.
 */
const LOOKAHEAD = {
  min: 0.06, max: 0.6, grow: 1.5, nearly: 0.3, margin: 0.05, again: 3, hold: 2, decay: 0.2,
};

/** How often the stream tops itself up between the app's calls, ms. */
const PUMP_MS = 20;

/** How far ahead of the clock a stream starts, seconds: time for its first buffers. */
const START_AHEAD = 0.05;

/** Samples faded in at the start of a stream, so starting — or restarting — never clicks. */
const FADE_IN = 256;

/** Rings of pending samples; a power of two, and longer than the slowest event. */
const RING = 1 << 16;
const RING_MASK = RING - 1;

/** Fixed trim on everything the events feed. */
const BUS_GAIN = 1;

/**
 * Converts flow, kg/s, into signal before the exhaust system. Fixed for every engine: a
 * bigger cylinder moving more gas is louder because it is, not because it was turned up.
 */
const SOURCE_GAIN = 6;

/**
 * How deeply turbulence modulates the flow while gas is leaving through the valve: its
 * turbulence intensity, the fluctuating velocity over the mean. A jet's shear layer runs
 * at 10-20% whatever the jet's speed, so this is one number, and at idle it is what the
 * note has always had. Scaling it with the jet's Mach number as well, as this once did,
 * put half the flow into noise at full load: the pulses broke up into fragments, heard as
 * a rough scraping under load.
 */
const TURBULENCE = 0.15;

/**
 * Where the source stops, Hz, and where its turbulence stops. engine-sim runs its whole
 * input through a Butterworth low-pass at 1.9 kHz before the exhaust ever sees it. Here
 * the turbulence stops at 2 kHz and the flow itself at 5 kHz, the top of the band a
 * listener hears the engine in (`LEVEL.bandHz`). Above that a sampled model's flow has
 * only its corners, and passed on, those are heard as a tick on every event.
 */
const SOURCE_HZ = 5000;
const RUSH_HZ = 2000;

/**
 * How far a cycle's scatter moves the crank's arrival at the next event, per unit of it,
 * at `WOBBLE_RPM`: a cycle 10% strong speeds the crank by about 1% over the gap that
 * follows. That is an idle. The crank's speed changes by the cycle's extra work over the
 * energy the flywheel carries, and that energy goes as the square of engine speed, so
 * at 4000 RPM the same cycle moves it 25 times less — a fast engine keeps time.
 */
const CRANK_WOBBLE = 0.1;
const WOBBLE_RPM = 800;

/**
 * How long the crank takes to settle on a new speed it is given, seconds. The app updates
 * engine speed a few to a few dozen times a second — a dyno pull steps through its
 * measured points about ten times a second — and a note that jumped at each would climb
 * in a staircase, heard as a ratchet. Half an update long: enough to round the steps off
 * into a sweep, short enough that a blip is not heard arriving late.
 */
const RPM_GLIDE = 0.05;

/** Chance per unit of lope severity that a cycle barely burns at all. */
const MISFIRE_PER_SEVERITY = 0.3;

/** What a barely-burning cycle opens the valve at, as a fraction of a good one. */
const MISFIRE_EVO = 0.45;

/**
 * LEVEL. The radiated level of a real exhaust rises about 30 dB from idle to full power,
 * which no phone speaker and no ear at a comfortable volume can take in one piece. So two
 * things happen, both from the build rather than by ear:
 *
 *   - Every engine is brought to the same level at one reference condition — wide open at
 *     3000 rpm — measured by running one cycle of its own events through `exhaustEvent`.
 *     A V8 and a four are then equally present, the way a recording engineer would set
 *     them, and what differs between them is the note.
 *   - A gentle follower then brings idle up and full noise down, but only part of the way
 *     (`amount`) and never by more than `maxGain` or less than `minGain`, so a lift or a
 *     fuel cut still drops away the way a real one does, and full throttle is still
 *     clearly louder than idle.
 */
const LEVEL = {
  reference: { rpm: 3000, evoKpa: 450, portKpa: 115 },
  target: 0.3, amount: 0.8, maxGain: 16, minGain: 0.4, attack: 0.05, release: 0.35,
  /** The band a listener hears the engine in, Hz — and a phone speaker plays. */
  bandHz: [250, 5000],
  /** Where the follower starts listening, Hz: the bottom of a phone speaker's range. */
  followHz: 300,
  /** Output level at the reference, in the units `referenceLevel` measures. */
  loudness: 0.3,
  /**
   * COASTING: the throttle shut (`load` below `coastLoad`) above `coastRpm`, where the
   * engine is being driven by its own inertia rather than idling — or the fuel cut, on the
   * overrun or the limiter. A lift falls away on a real engine and a cylinder that is not
   * firing is quiet — that is what a lift and a limiter sound like — so coasting, the
   * follower may bring the note up by at most `coastLift` rather than `maxGain`. That
   * eases back to `maxGain` as the engine comes down through the last `coastRpm` above
   * it, so a lift settles into the idle rather than dipping under it and swelling back.
   *
   * THE CEILING NEVER HOLDS A COAST UNDER AN IDLE, though. A motored cylinder at 3000-4000
   * rpm reaches the source only some 12 dB over an idle's, and the follower brings an idle
   * up by more than that, so held to `coastLift` a lift came out under the idle it was
   * coming down to — measured in the app, 7 dB under — and then swelled back into it. So
   * coasting may always be brought up as far as an idle comes out. `idleEnvelope` is where
   * an idling engine's source sits against the reference: 0.085 measured on a cold VQ35DE.
   */
  coastLoad: 0.15, coastRpm: 1500, coastLift: 1, idleEnvelope: 0.1,
};

/**
 * The space the engine is heard in: a listener a few metres from the tailpipe, outdoors
 * near buildings. The ground bounce arrives a couple of milliseconds after the direct
 * sound, a few walls later, and a short diffuse tail after that. Mixed well below the
 * direct sound.
 */
const SPACE = { seconds: 0.55, t60: 0.45, groundMs: 2.4, groundGain: 0.55, wet: 0.22 };

/**
 * THE STARTER. A starter pinion drives the flywheel's ring gear — about 135 teeth — so its
 * mesh whines at the crank's revolutions per second times that; the motor itself turns
 * about 14 times faster than the crank and its commutator adds a thinner whine above.
 * `ripple` is how hard the crank surges against compression per unit of compression ratio
 * over 10, for a four; more cylinders overlap their compressions and surge less.
 */
const STARTER = {
  ringTeeth: 135, motorRatio: 14, commutatorBars: 24, level: 0.16, ripple: 0.3,
  releaseSeconds: 0.18, spinDownSeconds: 0.45,
};

/** How long a change of exhaust system takes to crossfade, seconds. */
const SWAP_SECONDS = 0.12;

/**
 * How the mean exhaust flow is averaged before it damps the pipes, seconds: about a
 * tenth of a second, so it follows a blip of the throttle but not each firing.
 */
const FLOW_SECONDS = 0.1;

/**
 * The most a flowing exhaust's response is brought back up by, against the same pipes with
 * still gas. The flow's damping is there to change the note — to take the pipes' ringing
 * out of it — not to turn it down, which is the level follower's business. Held to a
 * ceiling so a heavily damped system cannot be pulled up into noise.
 */
const FLOW_MAKEUP_MAX = 2.5;

/**
 * How far past the loaded step, in steps, the flow must move before the response follows.
 * Past halfway, so a flow sitting on an edge stays put.
 */
const FLOW_HYSTERESIS = 0.8;

/**
 * How many responses are kept, so a rev, and the gas heating and cooling through it, reuse
 * the ones already worked out.
 */
const RESPONSE_CACHE = 96;

/**
 * A small fast random source, so a stream can own its own and tests can seed it.
 *
 * @param {number} seed
 * @returns {() => number} uniform on [0, 1)
 */
function random(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

/**
 * A standard normal draw.
 *
 * @param {() => number} rnd
 * @returns {number}
 */
function gauss(rnd) {
  const u = Math.max(1e-12, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * A second-order Butterworth section's coefficients, from the RBJ cookbook.
 *
 * @param {'lowpass'|'highpass'} type
 * @param {number} hz corner
 * @param {number} sampleRate
 * @returns {number[]} b0, b1, b2, a1, a2, normalised
 */
function butterworth(type, hz, sampleRate) {
  const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / Math.SQRT2;
  const a0 = 1 + alpha;
  const b1 = type === 'lowpass' ? 1 - cos : -(1 + cos);
  const b0 = type === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
  return [b0 / a0, b1 / a0, b0 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/**
 * Run a buffer through a biquad in place, carrying its state across calls.
 *
 * @param {Float32Array|Float64Array} x
 * @param {number[]} c from `butterworth`
 * @param {number[]} z state: x1, x2, y1, y2
 */
function biquad(x, c, z) {
  const [b0, b1, b2, a1, a2] = c;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + b1 * z[0] + b2 * z[1] - a1 * z[2] - a2 * z[3];
    z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = y;
    x[i] = y;
  }
}

/**
 * A string's hash, for seeding the cylinder spread from the build.
 *
 * @param {string} text
 * @returns {number}
 */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Wrap a response in an AudioBuffer for a convolver.
 *
 * @param {BaseAudioContext} ctx
 * @param {Float32Array} ir
 * @returns {AudioBuffer}
 */
function responseBuffer(ctx, ir) {
  const buffer = ctx.createBuffer(1, ir.length, ctx.sampleRate);
  buffer.getChannelData(0).set(ir);
  return buffer;
}

/**
 * The space's response: direct-sound excluded, so it is mixed in beside the dry note.
 *
 * @param {BaseAudioContext} ctx
 * @returns {AudioBuffer}
 */
function spaceBuffer(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.round(SPACE.seconds * sr);
  const ir = new Float32Array(n);
  const rnd = random(0x5eed);
  // The ground bounce: the same sound from a mirror image of the tailpipe below the ground.
  ir[Math.round((SPACE.groundMs / 1000) * sr)] = SPACE.groundGain;
  // A handful of walls and cars, each a delayed, softened copy.
  for (let k = 0; k < 7; k++) {
    const at = Math.round((0.008 + rnd() * 0.05) * sr);
    ir[at] += (0.18 + rnd() * 0.18) * (rnd() < 0.5 ? -1 : 1);
  }
  // The diffuse tail, decaying at the space's T60, losing its treble faster than its bass.
  let lp = 0;
  const decay = Math.log(1000) / SPACE.t60;
  for (let i = Math.round(0.02 * sr); i < n; i++) {
    const t = i / sr;
    const pole = Math.exp((-2 * Math.PI * (6000 / (1 + 8 * t))) / sr);
    lp = (rnd() * 2 - 1) + pole * (lp - (rnd() * 2 - 1));
    ir[i] += 0.05 * lp * Math.exp(-decay * t);
  }
  return responseBuffer(ctx, ir);
}

/**
 * One bank's path through the exhaust system: two convolvers, so a new response can fade in
 * over the old one instead of cutting it off.
 *
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} into
 * @returns {Record<string, any>}
 */
function bankPath(ctx, into) {
  const input = ctx.createGain();
  input.gain.value = 1;
  const slots = [0, 1].map(() => {
    const conv = ctx.createConvolver();
    conv.normalize = false;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    input.connect(conv);
    conv.connect(gain);
    gain.connect(into);
    return { conv, gain };
  });
  return { input, slots, live: -1, key: '' };
}

/**
 * Build the note.
 *
 * @param {AudioContext} ctx
 * @returns {Record<string, any>}
 */
export function createPulseExhaust(ctx) {
  const sum = ctx.createGain();
  sum.gain.value = 1;
  // A DC block. The flow leaving a pipe is always outward, so the source carries an offset
  // that the exhaust's response removes — but a change of response mid-note can leave a
  // step. Below the lowest note the engine makes, so nothing else changes.
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 12;
  dcBlock.Q.value = 0.7;
  const out = ctx.createGain();
  out.gain.value = 1;
  sum.connect(dcBlock);
  dcBlock.connect(out);
  // The space, beside the dry note.
  const space = ctx.createConvolver();
  space.normalize = false;
  space.buffer = spaceBuffer(ctx);
  const spaceGain = ctx.createGain();
  spaceGain.gain.value = SPACE.wet;
  dcBlock.connect(space);
  space.connect(spaceGain);
  spaceGain.connect(out);

  // Everything the exhaust events feed, per bank, and what the engine itself makes (the
  // starter), which does not go down the pipe.
  const bus = ctx.createGain(); bus.gain.value = BUS_GAIN;
  bus.connect(sum);
  const banks = [bankPath(ctx, bus), bankPath(ctx, bus)];
  const mech = ctx.createGain(); mech.gain.value = 1;
  mech.connect(sum);

  // Knock's rattle and a rich mixture's rougher burn, gated at the firing rate so they
  // arrive in pulses rather than as hiss.
  const noiseLength = 2 * ctx.sampleRate;
  const noiseBuffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
  const nd = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) nd[i] = (Math.random() * 2 - 1) * 0.35;
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer; noise.loop = true;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
  const gateLfo = ctx.createOscillator(); gateLfo.type = 'sawtooth'; gateLfo.frequency.value = 40;
  const gateDepth = ctx.createGain(); gateDepth.gain.value = 0;
  gateLfo.connect(gateDepth); gateDepth.connect(noiseGain.gain);
  const noiseTone = ctx.createBiquadFilter();
  noiseTone.type = 'bandpass'; noiseTone.frequency.value = 5500; noiseTone.Q.value = 1.2;
  noise.connect(noiseTone); noiseTone.connect(noiseGain); noiseGain.connect(sum);

  for (const src of [noise, gateLfo]) {
    try { src.start(); } catch { /* a suspended context starts it on resume */ }
  }

  return {
    out, sum, dcBlock, bus, banks, mech, space, spaceGain,
    noiseGain, gateLfo, gateDepth,
    /** @type {Record<string, any>|null} the `exhaustGeometry` the events are computed in */
    geometry: null,
    /** @type {{angleDeg: number, bank?: number}[]} */
    events: [{ angleDeg: 0 }],
    /** Each cylinder's fixed share of the charge, around 1. */
    trims: [1],
    /** Each cylinder's extra travel to the collector over the shortest, in samples. */
    primaryDelays: [0],
    cyl: 6,
    displacementL: 3.0,
    compression: 10.3,
    catBack: false,
    /** Whether `silencePulseExhaust` has pinned the bus, and nothing has lifted it since. */
    silenced: false,
    /** This engine's source gain at the reference condition, from `referenceLevel`. */
    norm: 1,
    /** The follower's reference: the source's own level at the reference condition. */
    sourceRef: 1,
    stream: {
      rings: [new Float32Array(RING), new Float32Array(RING), new Float32Array(RING)],
      /** Absolute sample the next scheduled buffer starts at; -1 when stopped. */
      head: -1,
      /** Absolute sample, fractional, where the next exhaust event starts. */
      next: 0,
      index: 0,
      /** The combustion scatter's running state: this cycle's deviation, in CoVs. */
      walk: 0,
      /** The turbulence's and each bank's band-limiting state. */
      rushZ: [0, 0, 0, 0],
      sourceZ: [[0, 0, 0, 0], [0, 0, 0, 0]],
      followZ: [[0, 0, 0, 0], [0, 0, 0, 0]],
      /** The level-follower's envelope and the gain it last applied. */
      envelope: 0,
      gain: 1,
      /** Each bank's gas this buffer, kg, and its mean flow, kg/s. */
      massKg: [0, 0],
      massFlow: [0, 0],
      /** Each bank's mean flow as a step of `ACOUSTIC.FLOW_MACH_STEP`, as last loaded. */
      flowStep: [0, 0],
      /** How long each bank's response has been held since it last changed, seconds. */
      flowHeld: [0, 0],
      /** Whether a bank's flow has moved a step and its response is still to be loaded. */
      refreshPending: false,
      /** How far ahead the stream is being computed, seconds (see `LOOKAHEAD`). */
      lookahead: LOOKAHEAD.min,
      /** The clock, in samples, at the last call; -1 before the first. */
      lastCall: -1,
      /** The clock, in samples, when the stream last ran dry; -1 if it never has. */
      lastDry: -1,
      /** Whether the next buffer starts the stream and fades in. */
      fadeIn: false,
      /** The crank's speed as the events see it, gliding to the one it is given. */
      rpm: NaN,
      /** The starter: how engaged, its phase, and the crank speed it last saw. */
      starter: 0, starterPhase: 0, commutatorPhase: 0, starterRpm: 0,
      rnd: random((Math.random() * 4294967296) >>> 0),
    },
    /**
     * The last events computed, newest last: when (seconds), which cylinder, the pressure
     * its valve opened at and the gap to the one before it. For tests and for anyone
     * asking what the note is made of.
     *
     * @type {{at: number, cylinder: number, evoKpa: number, gapSeconds: number}[]}
     */
    log: [],
    geomKey: '',
    trimKey: '',
    /** @type {Map<string, AudioBuffer>} responses already computed for this build */
    responses: new Map(),
    /** @type {Map<string, number>} each bank's still-gas response level, for `flowingResponse` */
    stillLevels: new Map(),
  };
}

/**
 * Load the exhaust system's response into each bank, fading from the old one.
 *
 * @param {Record<string, any>} a
 * @param {BaseAudioContext} ctx
 */
function refreshResponse(a, ctx) {
  const g = a.geometry;
  if (!g) return;
  const t = ctx.currentTime;
  const bankCount = Math.max(1, g.banks || 1);
  a.banks.forEach((path, b) => {
    if (b >= bankCount) {
      for (const slot of path.slots) slot.gain.gain.setTargetAtTime(0, t, SWAP_SECONDS / 3);
      path.live = -1; path.key = '';
      return;
    }
    const step = a.stream.flowStep[b] ?? 0;
    const key = `${a.geomKey}|${a.catBack}|${b}|${step}`;
    if (key === path.key) return;
    path.key = key;
    const next = path.live === 0 ? 1 : 0;
    let buffer = a.responses.get(key);
    if (!buffer) {
      buffer = responseBuffer(ctx, flowingResponse(a, ctx.sampleRate, b, step));
      remember(a.responses, key, buffer);
    }
    path.slots[next].conv.buffer = buffer;
    path.slots[next].gain.gain.setTargetAtTime(1, t, SWAP_SECONDS / 3);
    if (path.live >= 0) path.slots[path.live].gain.gain.setTargetAtTime(0, t, SWAP_SECONDS / 3);
    path.live = next;
  });
}

/**
 * Keep a computed value, dropping the oldest once `RESPONSE_CACHE` are held.
 *
 * @template T
 * @param {Map<string, T>} cache
 * @param {string} key
 * @param {T} value
 */
function remember(cache, key, value) {
  if (cache.size >= RESPONSE_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

/**
 * One bank's response with the exhaust flowing at a step of Mach number, at the level of
 * the same pipes with the gas still, measured in the band a listener hears.
 *
 * @param {Record<string, any>} a
 * @param {number} sampleRate
 * @param {number} bank
 * @param {number} step the mean flow, in steps of `ACOUSTIC.FLOW_MACH_STEP`
 * @returns {Float32Array}
 */
function flowingResponse(a, sampleRate, bank, step) {
  const opts = { bank, catBack: a.catBack };
  const ir = exhaustImpulseResponse(a.geometry, sampleRate,
    { ...opts, flowMach: step * ACOUSTIC.FLOW_MACH_STEP });
  const stillKey = `${a.geomKey}|${a.catBack}|${bank}`;
  if (step <= 0) {
    remember(a.stillLevels, stillKey, bandLevel(ir, sampleRate));
    return ir;
  }
  let still = a.stillLevels.get(stillKey);
  if (still === undefined) {
    still = bandLevel(exhaustImpulseResponse(a.geometry, sampleRate, opts), sampleRate);
    remember(a.stillLevels, stillKey, still);
  }
  const flowing = bandLevel(ir, sampleRate);
  const makeup = flowing > 0 ? clamp(still / flowing, 1, FLOW_MAKEUP_MAX) : 1;
  for (let i = 0; i < ir.length; i++) ir[i] *= makeup;
  return ir;
}

/**
 * A response's level in the band a listener hears the engine in.
 *
 * @param {Float32Array} ir
 * @param {number} sampleRate
 * @returns {number}
 */
function bandLevel(ir, sampleRate) {
  const x = Float64Array.from(ir);
  biquad(x, butterworth('highpass', LEVEL.bandHz[0], sampleRate), [0, 0, 0, 0]);
  biquad(x, butterworth('lowpass', LEVEL.bandHz[1], sampleRate), [0, 0, 0, 0]);
  let sq = 0;
  for (const v of x) sq += v * v;
  return Math.sqrt(sq);
}

/**
 * Point the note at a new build.
 *
 * @param {Record<string, any>} a
 * @param {AudioContext} ctx
 * @param {Record<string, any>} geometry an `exhaustGeometry`
 * @param {string} key a `geometryKey` for it
 */
export function setPulseExhaustGeometry(a, ctx, geometry, key) {
  if (key === a.geomKey) return;
  a.geomKey = key;
  a.geometry = geometry;
  if (geometry.events && geometry.events.length) a.events = geometry.events;
  a.cyl = Math.max(1, geometry.cyl || a.cyl);
  const swept = geometry.sweptM3 ?? 5e-4;
  a.displacementL = safe(swept * 1000 * a.cyl, 0.5, 12);
  a.compression = safe(swept / Math.max(1e-7, geometry.clearanceM3 ?? swept / 9.3) + 1, 6, 16);

  // Each cylinder's own run to the collector, as a delay past the shortest one.
  const lengths = primaryLengthsM(geometry);
  const shortest = Math.min(...lengths);
  const c = geometry.cPrimary || 600;
  a.primaryDelays = lengths.map((l) => Math.round(((l - shortest) / c) * ctx.sampleRate));

  // The cylinders' spread is the engine's own, so it is seeded from the parts that make it
  // and does not change when only the gas temperature does.
  const trimKey = `${a.events.map((e) => e.angleDeg.toFixed(1)).join(',')}|${swept.toFixed(7)}`;
  if (trimKey !== a.trimKey) {
    a.trimKey = trimKey;
    const rnd = random(hash(trimKey));
    a.trims = a.events.map(() => 1 + ACOUSTIC.CYLINDER_SPREAD * gauss(rnd));
    const ref = referenceLevel(a, ctx.sampleRate);
    a.norm = ref > 0 ? LEVEL.loudness / ref : 1;
    // The follower measures the source, not the output; this is the source's own level at
    // the reference, so the follower is neutral there.
    a.sourceRef = sourceLevel(a, ctx.sampleRate);
  }
  refreshResponse(a, ctx);
}

/**
 * Compute one exhaust event into its bank's ring.
 *
 * @param {Record<string, any>} a
 * @param {number} sampleRate
 * @param {number} at absolute sample it starts at
 * @param {Record<string, any>} f the frame, already made safe
 * @returns {number} the gap to the next event, seconds
 */
function addEvent(a, sampleRate, at, f) {
  const s = a.stream;
  const n = a.events.length;
  const k = s.index % n;
  const here = a.events[k];
  const next = a.events[(k + 1) % n];

  // This cycle's combustion, carrying some of the last one's. A cranking engine is not
  // burning, and nor is one on a fuel cut — the overrun and the limiter — so there is
  // nothing to scatter: a motored cylinder pumps the same charge out every cycle.
  const rho = f.persistence;
  s.walk = rho * s.walk + Math.sqrt(1 - rho * rho) * gauss(s.rnd);
  const burning = !f.cranking && !f.cut;
  const cov = burning ? combustionScatter(f.load, f.lope) : 0;
  let evo = f.evoKpa * (a.trims[k] ?? 1) * (1 + cov * s.walk);
  if (burning && f.lope > 0 && s.rnd() < f.lope * MISFIRE_PER_SEVERITY) evo *= MISFIRE_EVO;
  evo = Math.max(20, evo);

  // The crank cannot jump from one speed to another, whatever steps it is given in: it
  // glides there, event by event.
  const rpm = Number.isFinite(s.rpm) && s.rpm > 0 ? s.rpm : f.rpm;
  const event = exhaustEvent({
    geometry: a.geometry, evoKpa: evo, rpm, sampleRate, backKpa: f.portKpa,
  });
  const { jet } = event;
  const flow = steepenPulse(event.flow, a.geometry, sampleRate, f.portKpa);
  const bank = a.geometry && a.geometry.banks > 1 && here.bank === 1 ? 1 : 0;
  const ring = s.rings[bank];
  const gain = SOURCE_GAIN * f.level;
  // Turbulence, band-limited to what a pipe carries. White noise on [-1, 1] has an RMS of
  // 1/sqrt(3); through a 2 kHz Butterworth it keeps sqrt(2 x 2000 / fs) of that, and this
  // puts it back at unit size.
  const noise = new Float64Array(flow.length);
  for (let i = 0; i < noise.length; i++) noise[i] = s.rnd() * 2 - 1;
  biquad(noise, butterworth('lowpass', RUSH_HZ, sampleRate), s.rushZ);
  const rushNorm = Math.sqrt(3) / Math.sqrt((2 * RUSH_HZ) / sampleRate);
  const start = Math.round(at) + (a.primaryDelays[k] ?? 0);
  let mass = 0;
  for (let i = 0; i < event.flow.length; i++) mass += event.flow[i];
  s.massKg[bank] += mass / sampleRate;
  for (let i = 0; i < flow.length; i++) {
    const rush = jet[i] > 0 ? noise[i] * rushNorm * TURBULENCE : 0;
    ring[(start + i) & RING_MASK] += gain * flow[i] * (1 + rush);
  }

  let gapDeg = next.angleDeg - here.angleDeg;
  if (gapDeg <= 0) gapDeg += 720;
  const wobble = CRANK_WOBBLE * Math.min(1, (WOBBLE_RPM / rpm) ** 2);
  const gap = (gapDeg / (6 * rpm)) * (1 - wobble * cov * s.walk);
  s.rpm = rpm + (f.rpm - rpm) * (1 - Math.exp(-gap / RPM_GLIDE));
  a.log.push({ at: start / sampleRate, cylinder: k, evoKpa: evo, gapSeconds: gap });
  if (a.log.length > 256) a.log.splice(0, a.log.length - 256);
  s.index++;
  return gap;
}

/**
 * The starter, for one buffer: its gear whine and its motor, following a crank that surges
 * against every compression. Written into the engine's own ring, which does not go down
 * the pipe.
 *
 * @param {Record<string, any>} a
 * @param {number} sampleRate
 * @param {number} head absolute sample the buffer starts at
 * @param {Record<string, any>} f the frame
 */
function addStarter(a, sampleRate, head, f) {
  const s = a.stream;
  if (!f.cranking && s.starter < 1e-4) return;
  const ring = s.rings[2];
  const release = Math.exp(-1 / (STARTER.releaseSeconds * sampleRate));
  const spinDown = Math.exp(-1 / (STARTER.spinDownSeconds * sampleRate));
  // How hard the crank surges: harder with more compression, softer with more cylinders,
  // because their compressions overlap and fill in each other's dips.
  const ripple = STARTER.ripple * (a.compression / 10) * Math.sqrt(4 / Math.max(1, a.cyl));
  const compressionsPerRev = Math.max(1, a.cyl) / 2;
  for (let i = 0; i < CHUNK; i++) {
    if (f.cranking) {
      s.starter += (1 - s.starter) * 0.002;
      s.starterRpm = f.rpm;
    } else {
      s.starter *= release;
      s.starterRpm *= spinDown;
    }
    // Where the crank is in its surge: slowest as each cylinder comes up on compression.
    const crankPhase = s.starterPhase / STARTER.ringTeeth;
    const surge = f.cranking ? 1 - ripple * Math.cos(2 * Math.PI * compressionsPerRev * crankPhase) : 1;
    const revPerSecond = (s.starterRpm / 60) * surge;
    s.starterPhase += (revPerSecond * STARTER.ringTeeth) / sampleRate;
    s.commutatorPhase += (revPerSecond * STARTER.motorRatio * STARTER.commutatorBars) / sampleRate;
    if (s.starterPhase > 1e6) s.starterPhase -= STARTER.ringTeeth * 1e3;
    if (s.commutatorPhase > 1e6) s.commutatorPhase -= 1e6;
    const mesh = 2 * Math.PI * s.starterPhase;
    // Gear mesh is a tooth-shaped whine, not a sine: several harmonics, and a little grit.
    const whine = Math.sin(mesh) + 0.55 * Math.sin(2 * mesh + 0.7) + 0.3 * Math.sin(3 * mesh + 1.9)
      + 0.2 * Math.sin(2 * Math.PI * s.commutatorPhase) + 0.12 * (s.rnd() * 2 - 1);
    // The motor labours as the crank slows: louder on each compression.
    const labour = 0.6 + 0.8 * Math.max(0, 1 - surge + ripple * 0.5);
    ring[(head + i) & RING_MASK] += STARTER.level * s.starter * labour * whine;
  }
}

/**
 * How loud this engine is at the reference condition: one cycle of its own events, laid out
 * at their crank angles, through its own exhaust system, in the band a listener hears it
 * in. Measured on what comes out of the pipes, so an engine whose exhaust takes more off —
 * a turbine, a long quiet system — is matched on what is left rather than turned down with
 * it.
 *
 * @param {Record<string, any>} a
 * @param {number} sampleRate
 * @returns {number}
 */
function referenceLevel(a, sampleRate) {
  const { rpm, evoKpa, portKpa } = LEVEL.reference;
  const cycle = Math.round((120 / rpm) * sampleRate);
  const src = new Float64Array(cycle);
  const flow = steepenPulse(
    exhaustEvent({ geometry: a.geometry, evoKpa, rpm, sampleRate, backKpa: portKpa }).flow,
    a.geometry, sampleRate, portKpa);
  a.events.forEach((e, k) => {
    const start = Math.round((e.angleDeg / 720) * cycle) + (a.primaryDelays[k] ?? 0);
    for (let i = 0; i < flow.length; i++) src[(start + i) % cycle] += SOURCE_GAIN * flow[i];
  });
  // The engine running steadily is the cycle repeating, so the pipes' response can be
  // folded onto one cycle and applied as a circular convolution: exact, and a cycle's
  // length squared rather than the response's length times anything.
  const ir = exhaustImpulseResponse(a.geometry, sampleRate, { catBack: a.catBack });
  const folded = new Float64Array(cycle);
  for (let j = 0; j < ir.length; j++) folded[j % cycle] += ir[j];
  const once = new Float64Array(cycle);
  for (let t = 0; t < cycle; t++) {
    let acc = 0;
    for (let m = 0; m < cycle; m++) {
      const v = src[(t - m + cycle) % cycle];
      if (v !== 0) acc += folded[m] * v;
    }
    once[t] = acc;
  }
  // Four cycles through the listening band, measuring the last, so the filters have settled.
  const out = new Float64Array(cycle * 4);
  for (let t = 0; t < out.length; t++) out[t] = once[t % cycle];
  biquad(out, butterworth('highpass', LEVEL.bandHz[0], sampleRate), [0, 0, 0, 0]);
  biquad(out, butterworth('lowpass', LEVEL.bandHz[1], sampleRate), [0, 0, 0, 0]);
  let sq = 0;
  for (let t = cycle * 3; t < out.length; t++) sq += out[t] * out[t];
  return Math.sqrt(sq / cycle);
}

/**
 * The source's own level at the reference condition, measured the way the follower measures
 * a running engine: the rate of change of the flow going into the pipes.
 *
 * @param {Record<string, any>} a
 * @param {number} sampleRate
 * @returns {number}
 */
function sourceLevel(a, sampleRate) {
  const { rpm, evoKpa, portKpa } = LEVEL.reference;
  const cycle = Math.round((120 / rpm) * sampleRate);
  const sum = new Float64Array(cycle);
  const flow = steepenPulse(
    exhaustEvent({ geometry: a.geometry, evoKpa, rpm, sampleRate, backKpa: portKpa }).flow,
    a.geometry, sampleRate, portKpa);
  a.events.forEach((e, k) => {
    const start = Math.round((e.angleDeg / 720) * cycle) + (a.primaryDelays[k] ?? 0);
    for (let i = 0; i < flow.length; i++) sum[(start + i) % cycle] += SOURCE_GAIN * flow[i];
  });
  const out = new Float64Array(cycle * 4);
  for (let t = 0; t < out.length; t++) out[t] = sum[t % cycle];
  biquad(out, butterworth('highpass', LEVEL.followHz, sampleRate), [0, 0, 0, 0]);
  let sq = 0;
  for (let t = cycle * 3; t < out.length; t++) sq += out[t] * out[t];
  return Math.sqrt(sq / cycle);
}

/**
 * The most the level follower may bring the note up by: `LEVEL.maxGain`, or while the
 * engine is coasting (see `LEVEL.coastLoad`) `LEVEL.coastLift`, easing back to `maxGain`
 * over the last `coastRpm` above it — but never less than brings the note up to where an
 * idle comes out (`LEVEL.idleEnvelope`).
 *
 * @param {{rpm: number, load: number, cut: boolean}} f the frame
 * @param {number} envelope the follower's envelope, against the reference
 * @returns {number}
 */
function followCeiling(f, envelope) {
  if (!f.cut && f.load >= LEVEL.coastLoad) return LEVEL.maxGain;
  const x = clamp((f.rpm - LEVEL.coastRpm) / LEVEL.coastRpm, 0, 1);
  const coast = Math.pow(LEVEL.maxGain, 1 - x) * Math.pow(LEVEL.coastLift, x);
  // An idle of `idleEnvelope` comes out at idleEnvelope ^ (1 - amount).
  const idle = envelope > 0
    ? Math.pow(LEVEL.idleEnvelope, 1 - LEVEL.amount) / envelope : LEVEL.maxGain;
  return Math.min(LEVEL.maxGain, Math.max(coast, idle));
}

/**
 * Bring a buffer of exhaust to this engine's level, and part of the way towards the
 * target from wherever the engine is running.
 *
 * @param {Record<string, any>} a
 * @param {Float32Array[]} data one buffer per bank
 * @param {number} sampleRate
 * @param {{rpm: number, load: number, cut: boolean}} f the frame, for `followCeiling`
 */
function level(a, data, sampleRate, f) {
  const s = a.stream;
  // The note's level: the source above the lowest of the band a listener hears it in —
  // what a phone speaker can play — against the same measure at the reference.
  let sq = 0;
  let count = 0;
  const hp = butterworth('highpass', LEVEL.followHz, sampleRate);
  data.forEach((d, b) => {
    const x = Float64Array.from(d);
    biquad(x, hp, s.followZ[b]);
    for (const v of x) { sq += v * v; count++; }
  });
  const rms = Math.sqrt(sq / Math.max(1, count)) / Math.max(1e-9, a.sourceRef);
  const seconds = CHUNK / sampleRate;
  const coeff = Math.exp(-seconds / (rms > s.envelope ? LEVEL.attack : LEVEL.release));
  s.envelope = rms + coeff * (s.envelope - rms);
  // A lift or a fuel cut still falls away: the follower only goes part of the way, and
  // coasting it may lift the note far less (see `followCeiling`).
  const most = followCeiling(f, s.envelope);
  const follow = s.envelope > 0
    ? clamp(Math.pow(1 / s.envelope, LEVEL.amount), LEVEL.minGain, most)
    : most;
  const want = a.norm * follow;
  // Glide across the buffer so the gain never steps.
  const from = s.gain;
  for (const d of data) {
    for (let i = 0; i < d.length; i++) d[i] *= from + ((want - from) * i) / d.length;
  }
  s.gain = want;
}

/**
 * Hand the note the engine's state, and keep the stream computed a little ahead of the
 * clock.
 *
 * Call it every engine tick. The stream also tops itself up every `PUMP_MS` between
 * ticks, from the last state it was given, so how far ahead it has to run does not depend
 * on how often the app gets round to calling: the LIVE tab's simulation steps ten times a
 * second, and a stream only refilled then has to queue more than a tenth of a second
 * ahead — which is heard as the note arriving after the rev.
 *
 * @param {Record<string, any>} a
 * @param {AudioContext} ctx
 * @param {{rpm: number, level: number, load: number, audible: boolean, cranking?: boolean,
 *   cut?: boolean,
 *   evoKpa?: number, portKpa?: number, lopeSeverity?: number, covPersistence?: number}} frame
 */
export function schedulePulseExhaust(a, ctx, frame) {
  a.frame = frame;
  pump(a, ctx, frame);
  if (a.stream.head >= 0) startPump(a, ctx);
  else stopPump(a);
}

/**
 * Keep the stream topped up between the app's calls.
 *
 * @param {Record<string, any>} a
 * @param {AudioContext} ctx
 */
function startPump(a, ctx) {
  if (a.pumpTimer || typeof setInterval !== 'function') return;
  a.pumpTimer = setInterval(() => {
    if (ctx.state === 'closed' || !a.frame) { stopPump(a); return; }
    try { pump(a, ctx, a.frame); } catch { stopPump(a); }
    if (a.stream.head < 0) stopPump(a);
  }, PUMP_MS);
  // Under Node (the tests) a pending timer would hold the process open.
  if (typeof a.pumpTimer === 'object' && a.pumpTimer && 'unref' in a.pumpTimer) a.pumpTimer.unref();
}

/**
 * @param {Record<string, any>} a
 */
function stopPump(a) {
  if (a.pumpTimer) clearInterval(a.pumpTimer);
  a.pumpTimer = null;
}

/**
 * Compute and schedule the stream up to a little ahead of the clock, from one frame.
 *
 * It keeps its own cursor, so it tolerates being late, and the rhythm never restarts
 * unless it fell so far behind that it has to.
 *
 * @param {Record<string, any>} a
 * @param {AudioContext} ctx
 * @param {Record<string, any>} frame see `schedulePulseExhaust`
 */
function pump(a, ctx, frame) {
  const s = a.stream;
  const sr = ctx.sampleRate;
  const rpm = safe(frame.rpm, 0, 12000);
  const lvl = safe(frame.level, 0, 4);
  const starterRunning = s.starter > 1e-4;
  if (!frame.audible || !a.geometry || ((rpm < 200 || lvl <= 0.001) && !frame.cranking && !starterRunning)) {
    s.head = -1;
    s.starter = 0;
    return;
  }
  const now = Math.ceil(ctx.currentTime * sr);
  // How the last call left the queue: run out, nearly, or comfortably ahead.
  if (s.head >= 0 && s.lastCall >= 0) {
    const ahead = (s.head - now) / sr;
    if (ahead < 0) {
      // Run dry: queue far enough to have covered the gap that did it, and a margin — or,
      // if it ran dry only a moment ago too, the page is busy for a while, so the most.
      const gap = (now - s.lastCall) / sr;
      const again = s.lastDry >= 0 && (now - s.lastDry) / sr < LOOKAHEAD.again;
      s.lookahead = again ? LOOKAHEAD.max : clamp(
        Math.max(s.lookahead * LOOKAHEAD.grow, gap + LOOKAHEAD.margin), LOOKAHEAD.min, LOOKAHEAD.max);
      s.lastDry = now;
    } else if (ahead < LOOKAHEAD.nearly * s.lookahead) {
      s.lookahead = Math.min(LOOKAHEAD.max, s.lookahead * LOOKAHEAD.grow);
    } else if (s.lastDry < 0 || (now - s.lastDry) / sr > LOOKAHEAD.hold) {
      const elapsed = Math.max(0, (now - s.lastCall) / sr);
      s.lookahead = Math.max(LOOKAHEAD.min, s.lookahead - LOOKAHEAD.decay * elapsed);
    }
  }
  s.lastCall = now;
  if (s.head < 0 || s.head < now) {
    // Starting, or so late that the clock has passed the stream: begin again just ahead.
    // A stream starting after a `silencePulseExhaust` lifts its own gains, whoever forgot
    // to: nothing that starts an engine should have to know the bus was pinned.
    if (a.silenced) wakePulseExhaust(a, ctx);
    for (const r of s.rings) r.fill(0);
    s.massKg.fill(0);
    s.rpm = NaN;
    s.head = now + Math.ceil(START_AHEAD * sr);
    s.next = s.head;
    s.fadeIn = true;
  }
  const f = {
    rpm: Math.max(rpm, 60),
    level: lvl,
    load: safe(frame.load, 0, 1),
    lope: safe(frame.lopeSeverity, 0, 1),
    persistence: safe(frame.covPersistence ?? 0.55, 0, 0.95),
    evoKpa: safe(frame.evoKpa ?? 300, 20, 2000),
    portKpa: safe(frame.portKpa ?? 105, 50, 400),
    cranking: Boolean(frame.cranking),
    cut: Boolean(frame.cut),
  };
  const firing = rpm >= 200 && lvl > 0.001;
  const bankCount = Math.max(1, Math.min(2, a.geometry.banks || 1));
  const until = now + Math.ceil(s.lookahead * sr);
  let guard = 0;
  while (s.head < until && guard++ < 64) {
    const end = s.head + CHUNK;
    if (firing) {
      while (s.next < end) s.next += addEvent(a, sr, s.next, f) * sr;
    } else {
      s.next = end;
    }
    addStarter(a, sr, s.head, f);
    updateFlow(a, ctx, bankCount, f.portKpa);
    const data = [];
    for (let b = 0; b < 3; b++) {
      const d = new Float32Array(CHUNK);
      const ring = s.rings[b];
      for (let i = 0; i < CHUNK; i++) {
        const j = (s.head + i) & RING_MASK;
        d[i] = ring[j];
        ring[j] = 0;
      }
      data.push(d);
    }
    for (let b = 0; b < bankCount; b++) {
      biquad(data[b], butterworth('lowpass', SOURCE_HZ, sr), s.sourceZ[b]);
    }
    level(a, data.slice(0, bankCount), sr, f);
    if (s.fadeIn) {
      s.fadeIn = false;
      for (const d of data) for (let i = 0; i < FADE_IN; i++) d[i] *= i / FADE_IN;
    }
    for (let b = 0; b < 3; b++) {
      if (b === 1 && bankCount < 2) continue;
      if (b === 2 && !f.cranking && s.starter < 1e-4) continue;
      const buffer = ctx.createBuffer(1, CHUNK, sr);
      buffer.getChannelData(0).set(data[b]);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(b === 2 ? a.mech : a.banks[b].input);
      try { src.start(s.head / sr); } catch { /* raced the clock */ }
      src.onended = () => { try { src.disconnect(); } catch { /* gone */ } };
    }
    s.head = end;
  }
  // A new response is worked out only once the stream is queued up ahead of the clock, so
  // the time it takes can never make the audio already due late.
  if (s.refreshPending) {
    s.refreshPending = false;
    refreshResponse(a, ctx);
  }
}

/**
 * Follow each bank's mean exhaust flow over one buffer, and when it has moved by a step of
 * Mach number, load the pipes' response for it.
 *
 * @param {Record<string, any>} a
 * @param {BaseAudioContext} ctx
 * @param {number} bankCount
 * @param {number} portKpa
 */
function updateFlow(a, ctx, bankCount, portKpa) {
  const s = a.stream;
  const seconds = CHUNK / ctx.sampleRate;
  const follow = 1 - Math.exp(-seconds / FLOW_SECONDS);
  let moved = false;
  for (let b = 0; b < bankCount; b++) {
    s.massFlow[b] += follow * (s.massKg[b] / seconds - s.massFlow[b]);
    s.massKg[b] = 0;
    // A step is taken only once the flow is well past its edge and the last change has
    // finished fading, so a flow sitting on an edge does not flick between two responses.
    const at = tailpipeMach(a.geometry, s.massFlow[b], portKpa) / ACOUSTIC.FLOW_MACH_STEP;
    s.flowHeld[b] += seconds;
    // One bank per buffer, so a V's two new responses are never computed back to back.
    if (!moved && Number.isFinite(at) && Math.abs(at - s.flowStep[b]) > FLOW_HYSTERESIS
      && s.flowHeld[b] >= SWAP_SECONDS * 2) {
      s.flowStep[b] = Math.round(at);
      s.flowHeld[b] = 0;
      moved = true;
    }
  }
  if (moved) s.refreshPending = true;
}

/**
 * Update what the events do not carry, for one frame: the exhaust system when a cat-back
 * goes on or off, knock's rattle and a rich burn's roughness.
 *
 * Everything else the player builds or tunes is already in the events and the pipes:
 * displacement, bore, compression and cam in each event; the pipe, headers, a turbine and
 * the gas temperature in the exhaust's response; timing, boost, load and mixture in the
 * pressure each cylinder opens at.
 *
 * @param {Record<string, any>} a
 * @param {AudioContext} ctx
 * @param {{rpm: number, load: number, richness: number, knock: number,
 *   cranking: boolean, catBack: boolean, audible: boolean}} frame
 */
export function tonePulseExhaust(a, ctx, frame) {
  const t = ctx.currentTime;
  const rpm = safe(frame.rpm, 0, 12000);
  const richness = safe(frame.richness, -0.4, 0.8);
  const knock = safe(frame.knock, 0, 1);
  const catBack = Boolean(frame.catBack);
  if (catBack !== a.catBack) {
    a.catBack = catBack;
    refreshResponse(a, ctx);
  }
  a.gateLfo.frequency.setTargetAtTime(Math.max(6, (rpm / 60) * (a.cyl / 2)), t, 0.02);
  // Knock is a shock wave ringing the cylinder at its own acoustic modes — 5-8 kHz for a
  // road engine's bore — and it rattles through the block, not down the pipe.
  // Gated at the firing rate: the gate swings the gain between nothing and twice the level,
  // so with no knock and no richness there is nothing at all.
  const rattle = frame.audible && !frame.cranking ? Math.max(0, richness) * 0.02 + knock * 0.08 : 0;
  a.noiseGain.gain.setTargetAtTime(rattle, t, 0.05);
  a.gateDepth.gain.setTargetAtTime(rattle, t, 0.05);
}

/**
 * Stop the note now. Buffers already handed to the clock cannot be unscheduled, so the bus
 * is pinned to zero and the stream dropped; it starts clean on the next frame.
 *
 * @param {Record<string, any>} a
 * @param {AudioContext} ctx
 */
export function silencePulseExhaust(a, ctx) {
  const t = ctx.currentTime;
  const kill = (p) => { try { p.cancelScheduledValues(t); p.setValueAtTime(0, t); } catch { /* closed */ } };
  kill(a.bus.gain);
  kill(a.mech.gain);
  kill(a.noiseGain.gain);
  a.stream.head = -1;
  a.stream.starter = 0;
  a.silenced = true;
  stopPump(a);
}

/**
 * Let the note run again after a `silencePulseExhaust`.
 *
 * @param {Record<string, any>} a
 * @param {AudioContext} ctx
 */
export function wakePulseExhaust(a, ctx) {
  a.silenced = false;
  try {
    a.bus.gain.setTargetAtTime(BUS_GAIN, ctx.currentTime, 0.02);
    a.mech.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
  } catch { /* noop */ }
}
