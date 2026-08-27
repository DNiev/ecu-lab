/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * The exhaust system, as a system of tubes carrying pressure waves.
 *
 * THIS IS NOT A SYNTHESISER AND IT HAS NO OSCILLATORS IN IT. It runs a one-dimensional
 * acoustic model of a real exhaust at audio rate: a cylinder empties through a valve into
 * a primary tube, the wave runs down the primary to a collector where it meets the other
 * cylinders on that bank, on through the tailpipe and a muffler, and out of the open end
 * where part of it radiates and part of it comes back INVERTED to interfere with whatever
 * is still arriving. The sound is what leaves the pipe.
 *
 * WHY IT HAS TO BE DONE THIS WAY. The obvious approach — render a pulse and play it back,
 * filtered — was tried first and it cannot work, for reasons that are audible rather than
 * academic:
 *
 *   1. THE REFLECTION COMES BACK NEGATIVE. A wave arriving at a bigger area, the collector
 *      or the open mouth, returns as a rarefaction. That returning vacuum is what scavenges
 *      the cylinder during overlap and what makes a header "come on" at its tuned speed.
 *      No filter does this, because a filter has no length and therefore no delay.
 *   2. THE CYLINDERS TALK TO EACH OTHER. Cylinder 1's pulse runs back up cylinder 3's
 *      primary and changes the pressure cylinder 3 is trying to vent into. That crosstalk
 *      is a large part of why an engine sounds like one object rather than like several
 *      separate pops in a row, and it is the single thing a sample-playback engine can
 *      never have.
 *   3. IT RETUNES ITSELF. Every length here is divided by the speed of sound in the gas
 *      actually in it, so a cold engine, a hot one and a boosted one are different
 *      instruments without anything having to say so.
 *
 * Everything the model needs arrives as geometry from `exhaustGeometry` in `acoustics.js`
 * and as operating state on the audio parameters. Nothing in this file decides what an
 * engine sounds like; it decides what a pipe does.
 *
 * WAVE VARIABLES. Each duct carries two travelling pressure waves, `f` running away from
 * the engine and `b` running back towards it, both as gauge pressure in pascals. Total
 * pressure anywhere is ambient + f + b, and volume flow is (A/rho c)(f - b). Junctions
 * conserve both, which for N ducts meeting is
 *
 *     pJ = 2 * sum(Yk * fk) / sum(Yk),   bk = pJ - fk,   Yk = Ak / (rho_k * ck)
 *
 * which is the standard Kelly-Lochbaum scattering junction and reduces to the familiar
 * area-ratio reflection when N is two.
 */

/** Pa. Ambient, and the pressure everything is a deviation from. */
const P_ATM = 101325;
/** J/(kg K) for exhaust gas — the same value the simulation uses for air. */
const R_GAS = 287;
/** Fraction of the wave a cylinder head reflects. Not quite 1: the port is not a mirror. */
const HEAD_REFLECTION = 0.90;
/** How much of the wave the open mouth sends back. The rest radiates. */
const MOUTH_REFLECTION = 0.80;
/**
 * Earliest the exhaust valve may shut, crank degrees after top dead centre.
 *
 * A real exhaust lobe closes after TDC on every engine ever built; a cam quoted at "zero
 * overlap" still does. Letting it shut exactly at TDC leaves the piston at clearance
 * volume with a closing orifice above it, which traps the last of the charge and forces
 * it out at an impossible velocity.
 */
const EVC_MIN_ATDC = 14;
/**
 * How much of a wave survives a junction, as an amplitude fraction.
 *
 * `MERGE_KEEP` is the collector, where several streams meet at an angle and mix; that
 * mixing is turbulent and it is the largest single loss in a real exhaust system.
 * `STEP_KEEP` is a plain change of section, which is gentler. Both are what stop the tubes
 * behaving like organ pipes: a lossless network rings on its own between firing events,
 * and at idle, where the excitation is weakest, that ringing is what a listener hears.
 */
const MERGE_KEEP = 0.78;
const STEP_KEEP = 0.96;

/** Longest tube the model will allocate for, m. Guards a nonsense build. */
const MAX_TUBE_M = 8;
/**
 * How much faster the crest of a wave travels than its trough, per unit of overpressure.
 *
 * The lossless plane-wave value is (gamma+1)/(2 gamma), which for burned gas is 0.905.
 * This is deliberately a third of that, and the reason is measurable rather than a matter
 * of taste. Steepening is a signal-dependent delay inside a feedback network, and driven
 * at full strength the network stops settling into a repeating cycle at all: measured,
 * harmonic comb contrast fell from 48 dB to 26 dB in the low band and from 16 dB to 1 dB
 * above 4 kHz, which is another way of saying the model turned itself into noise. At a
 * third of it the crest factor is still 9.6 dB — the crack survives — and the comb is
 * 40/28/21/18/12 dB across the range, which is where real recordings sit.
 *
 * Real steepening is weaker than the lossless figure anyway: dissipation inside the front
 * opposes it, every area change scatters it, and the wave is not a clean plane wave. This
 * is that, with the amount set by measurement rather than assumed.
 */
const STEEPEN_BETA = 0.30;
/**
 * Pressure step, Pa, for the numerical slope of the orifice curve at the valve junction.
 * Small enough to be a local derivative, large enough that the difference of two flows
 * carries real digits in single precision.
 */
const JUNCTION_DP = 150;
/** How far steepening may pull a wave forward, as a fraction of the tube's own delay. */
const STEEPEN_MAX_FRAC = 0.34;
/**
 * The steepest a front is allowed to get, as samples of delay change per sample of time.
 *
 * Below 1 the read position always advances, so the line cannot fold over itself. This is
 * the numerical statement of "a shock has a finite thickness".
 */
const WARP_SLEW = 0.7;
/** Flow noise at the collector, per unit of squared bulk velocity through it. */
const FLOW_NOISE = 0.10;
/** Jet noise per unit of valve flow velocity. Turbulence at the seat, gated by the flow. */
const JET_PER_VEL = 0.020;
/**
 * Calibration from the model's own units to a signal.
 *
 * The waveguide works in pascals and cubic metres per second, so its output scale is
 * whatever the physics happens to produce. This is the one number that says what counts
 * as full scale, and it is set by measurement against the LOUDEST build the app can be
 * asked for — a 6.2 litre V8 on a 4" open system at 6000 rpm — which peaks at 0.80 here.
 * Everything quieter than that is quieter for a physical reason and needs no curve.
 */
const PA_TO_UNIT = 13;

/** A bidirectional delay line standing in for one length of pipe. */
class Tube {
  /**
   * @param {number} maxSamples longest delay this tube will ever need
   */
  constructor(maxSamples) {
    this.f = new Float32Array(maxSamples);
    this.b = new Float32Array(maxSamples);
    this.n = maxSamples;
    this.i = 0;
    this.d = 1;
    this.area = 1e-3;
    this.c = 500;
    this.loss = 0.999;
    this.lpF = 0;
    this.lpB = 0;
    this.lpK = 0.5;
    this.steepen = 0;
    this.maxWarp = 1;
    this.warpF = 0;
    this.warpB = 0;
    // Scratch, filled during the cylinder pass and consumed by the collector junction.
    this.pendingF = 0;
    this.arriving = 0;
    this.y = 0;
  }

  /**
   * Sets length and gas state. Called when the build or the temperature changes.
   *
   * @param {number} lengthM tube length
   * @param {number} c speed of sound in this tube
   * @param {number} area cross-sectional area, m^2
   * @param {number} lossPerM wall loss fraction per metre
   * @param {number} lossHzM boundary-layer corner in Hz-metres; a longer tube eats more
   * @param {number} sr sample rate
   * @param {number} [keep=1] extra broadband survival per pass, for an element that
   *   absorbs rather than reflects — a converter, or a turbine sitting in the stream
   */
  set(lengthM, c, area, lossPerM, lossHzM, sr, keep = 1) {
    const d = Math.max(1, Math.min(this.n - 2, Math.round((lengthM / c) * sr)));
    this.d = d;
    this.area = area;
    this.c = c;
    this.loss = Math.max(0.90, 1 - lossPerM * lengthM) * keep;
    this.lpK = Math.exp((-2 * Math.PI * (lossHzM / Math.max(0.1, lengthM))) / sr);
    // NONLINEAR STEEPENING, and this is the mechanism that makes an exhaust CRACK.
    //
    // A pressure wave of finite amplitude does not travel at one speed. Its crest is
    // hotter and moving with the flow, so it goes faster than its trough, and over a metre
    // or two of pipe the front catches up with itself and steepens towards a shock. An
    // exhaust pulse leaves the port at most of a bar above ambient — genuinely a weak
    // shock wave by the time it reaches the mouth — which is why a 1.2 ms hump at the
    // valve arrives as a crack, and why intake noise, at a tenth the amplitude, does not
    // do this and does not sound like it.
    //
    // Implemented the way brass-instrument waveguides do it, as a delay that shortens with
    // local pressure: dt = (L/c)(1 - (gamma+1)/(2 gamma) * p/p0). It is bounded with a
    // tanh, because a real front stops steepening once it becomes a shock and an unbounded
    // one would simply fold the delay line over itself.
    this.steepen = (d * STEEPEN_BETA) / P_ATM;
    this.maxWarp = Math.max(0.05, d * STEEPEN_MAX_FRAC);
  }

  /**
   * Reads one direction of the line with the amplitude-dependent delay above.
   *
   * THE SLEW LIMIT IS NOT A SAFETY HACK, it is where the shock forms. A steepening front
   * would otherwise pull its own read position backwards faster than time advances, fold
   * the delay line over itself and produce a click — measured, peaks doubled above
   * 5500 rpm while the running level did not move, which is what fold-over looks like.
   * A real front cannot do that either: once it is vertical it is a shock, and dissipation
   * inside the shock stops it steepening further. Capping how fast the delay may shorten
   * caps the front at a finite slope, which is the same statement.
   *
   * @param {Float32Array} buf the forward or backward line
   * @param {boolean} fwd which direction's warp state to advance
   * @returns {number} the wave arriving at the far end of that direction
   */
  read(buf, fwd) {
    const base = this.i + this.n - this.d;
    const raw = buf[base % this.n];
    // ONLY A COMPRESSION STEEPENS. The crest of a finite-amplitude wave catches up with
    // the trough ahead of it, so the leading compression sharpens and the rarefaction
    // behind it stretches out — a shock forms on the front of an exhaust pulse and never
    // on its back. Warping both halves also scrambled the small reflections travelling
    // between pulses into broadband noise: measured, cycle-to-cycle correlation at idle
    // was 0.3 where it should be 1, and the model was manufacturing its own hiss out of
    // its own quiet.
    const drive = raw > 0 ? raw : 0;
    const target = this.maxWarp * Math.tanh((this.steepen * drive) / this.maxWarp);
    let w = fwd ? this.warpF : this.warpB;
    const dw = target - w;
    w += dw > WARP_SLEW ? WARP_SLEW : dw < -WARP_SLEW ? -WARP_SLEW : dw;
    if (fwd) this.warpF = w; else this.warpB = w;
    const pos = base + w;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = buf[((j % this.n) + this.n) % this.n];
    const b = buf[(((j + 1) % this.n) + this.n) % this.n];
    return a + (b - a) * frac;
  }

  /** @returns {number} the forward wave arriving at the far end */
  readF() { return this.read(this.f, true); }

  /** @returns {number} the backward wave arriving at the near end */
  readB() { return this.read(this.b, false); }

  /**
   * Writes this sample's departing waves and advances one sample.
   *
   * The one-pole on each direction is boundary-layer loss: a pipe eats treble faster than
   * bass, which is why a long system sounds duller than a short one even at the same volume.
   *
   * @param {number} fIn wave leaving the near end
   * @param {number} bIn wave leaving the far end
   */
  write(fIn, bIn) {
    this.lpF = fIn + this.lpK * (this.lpF - fIn);
    this.lpB = bIn + this.lpK * (this.lpB - bIn);
    this.f[this.i] = this.lpF * this.loss;
    this.b[this.i] = this.lpB * this.loss;
    this.i = (this.i + 1) % this.n;
  }

  /** Empties the tube. */
  clear() { this.f.fill(0); this.b.fill(0); this.lpF = 0; this.lpB = 0; this.warpF = 0; this.warpB = 0; }
}

/** One cylinder: its volume, its pressure, and the valve it empties through. */
class Cylinder {
  constructor() {
    this.offsetDeg = 0;
    this.bank = 0;
    this.p = P_ATM;
    this.prevPipe = 0;
    this.armed = true;
    // How strong THIS cylinder's last burn was, redrawn once per cycle at valve opening.
    this.strength = 1;
    this.wander = 0;
    this.lastQ = 0;
  }
}

/**
 * The base class, and why there is a choice of one.
 *
 * This file is written as an AudioWorklet module, which is where it belongs: on the audio
 * thread, at sample resolution, immune to whatever the main thread is doing. But a worklet
 * module has to be FETCHED FROM A URL, and this app also ships as a single inlined HTML
 * page served under a strict content-security policy — where `blob:` and `data:` are both
 * refused and there is no second file to point at. Measured: `addModule` rejects with
 * AbortError and the entire exhaust silently never loads, which is exactly what a player
 * hears as an app with no engine sound in it.
 *
 * So the model does not depend on being a worklet. It is a plain class that needs three
 * globals, and when they are absent it runs identically on the main thread inside a
 * ScriptProcessorNode, which needs no module loading and is refused by nothing. Same DSP,
 * same numbers, same tests — see `createExhaustNode` in `engineAudio.js`.
 */
const WorkletBase = typeof AudioWorkletProcessor !== 'undefined'
  ? AudioWorkletProcessor
  : /** @type {any} */ (class {
    constructor() {
      /** @type {any} */
      this.port = { onmessage: null, postMessage() {} };
    }
  });

export class ExhaustProcessor extends WorkletBase {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 12000, automationRate: 'a-rate' },
      { name: 'evoPa', defaultValue: P_ATM, minValue: 0, maxValue: 6e6, automationRate: 'a-rate' },
      { name: 'manifoldPa', defaultValue: P_ATM, minValue: 1000, maxValue: 5e5, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'overlapDeg', defaultValue: 0, minValue: 0, maxValue: 120, automationRate: 'k-rate' },
      { name: 'jet', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'lope', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'covPersistence', defaultValue: 0.55, minValue: 0, maxValue: 0.95, automationRate: 'k-rate' },
    ];
  }

  /**
   * @param {{processorOptions?: {sampleRate?: number}}} [options] the worklet passes
   *   nothing; the main-thread fallback passes the context's sample rate, because the
   *   `sampleRate` global only exists inside an AudioWorkletGlobalScope
   */
  constructor(options) {
    super(options);
    const sr = options?.processorOptions?.sampleRate
      ?? (typeof sampleRate !== 'undefined' ? sampleRate : 44100);
    this.sr = sr;
    const maxD = Math.ceil((MAX_TUBE_M / 300) * sr) + 4;

    this.cyl = [];
    this.primaries = [];
    for (let i = 0; i < 12; i++) {
      this.cyl.push(new Cylinder());
      this.primaries.push(new Tube(maxD));
    }
    this.nCyl = 0;

    this.tailA = [new Tube(maxD), new Tube(maxD)];
    this.cat = [new Tube(maxD), new Tube(maxD)];
    this.chamber = [new Tube(maxD), new Tube(maxD)];
    this.tailB = [new Tube(maxD), new Tube(maxD)];
    this.mouthLp = [0, 0];
    this.prevRad = [0, 0];
    this.mouthLpK = 0.5;
    this.radK = 1;
    this.prevOut = [0, 0];
    this.banks = 1;

    this.theta = 0;
    this.geom = null;
    this.muffled = true;
    this.running = false;

    // Cylinder geometry, set with the rest.
    this.vClear = 5e-5;
    this.vSwept = 5e-4;
    this.rodRatio = 1.75;
    this.evoDeg = 130;
    this.valveArea = 1e-4;
    this.valveCd = 0.72;
    this.camRampDeg = 62;
    this.camShape = 0.7;
    this.cylK = 1100;
    this.gamma = 1.235;

    this.port.onmessage = (e) => this.configure(e.data);
  }

  /**
   * Rebuilds the tube network. Called whenever the build or the gas state changes, which
   * is at parameter rate rather than at audio rate.
   *
   * @param {object} g from `exhaustGeometry`, plus cylinder geometry and muffler state
   */
  configure(g) {
    if (!g || !g.events) return;
    const sr = this.sr;
    this.geom = g;
    this.nCyl = Math.min(this.primaries.length, g.events.length);
    this.banks = g.banks;
    this.muffled = !!g.muffled;

    for (let i = 0; i < this.nCyl; i++) {
      this.cyl[i].offsetDeg = g.events[i].angleDeg;
      this.cyl[i].bank = g.events[i].bank;
      this.primaries[i].set(
        g.primaryLength, g.cPrimary, g.primaryArea, g.wallLossPerM, g.wallLossHzM, sr,
      );
    }
    // The collector run and the tailpipe either side of the muffler. With no muffler
    // fitted the chamber is a plain continuation of the pipe, which is exactly what a
    // straight-through system is.
    const tailTotal = g.collectorLength + g.tailLength;
    const front = tailTotal * 0.40;
    const back = Math.max(0.15, tailTotal - front - g.mufflerLength - g.catLength);
    for (let b = 0; b < 2; b++) {
      // Tailpipe bore from the collector all the way to the muffler, which is how a car is
      // actually plumbed: the area change happens AT the collector, where several primaries
      // become one pipe, and the junction above already models it. Running this section at
      // collector bore instead left the converter as a NARROW tube squeezed between two
      // wider ones — an acoustic constriction, and a strong resonator. Measured, its second
      // mode at 1260 Hz was 17 dB above everything around it at idle and no amount of
      // damping anywhere else could touch it, because the reflection making it was the
      // area step and not the loss.
      this.tailA[b].set(front, g.cTail, g.tailArea, g.wallLossPerM, g.wallLossHzM, sr);
      // The converter, at the same bore as the pipe either side of it, so it reflects
      // nothing at all and does its work purely by absorbing — which is what a honeycomb
      // substrate does and why it is modelled as loss rather than as another area step.
      this.cat[b].set(g.catLength, g.cTail, g.tailArea, g.wallLossPerM, g.catHzM, sr, g.catKeep);
      this.chamber[b].set(
        g.mufflerLength, g.cTail, this.muffled ? g.mufflerArea : g.tailArea,
        g.wallLossPerM,
        this.muffled ? g.mufflerAbsorbHz * g.mufflerLength : g.wallLossHzM, sr,
      );
      this.tailB[b].set(back, g.cTail, g.tailArea, g.wallLossPerM, g.wallLossHzM, sr);
    }

    this.vClear = g.clearanceM3;
    this.vSwept = g.sweptM3;
    this.rodRatio = g.rodRatio;
    this.evoDeg = g.evoDeg;
    this.valveArea = g.valveArea;
    this.valveCd = g.valveCd;
    this.camRampDeg = g.camRampDeg;
    this.camShape = g.camShape;
    this.cylK = g.cylinderK;
    this.gamma = g.gamma;
    // ka = 1 for the tailpipe's own radius: where the mouth stops behaving like a piston
    // and starts behaving like a point source.
    const mouthRadius = Math.sqrt(g.tailArea / Math.PI);
    const kaHz = g.cTail / (2 * Math.PI * mouthRadius);
    this.mouthLpK = Math.exp((-2 * Math.PI * kaHz) / sr);
    this.radK = Math.exp((-2 * Math.PI * kaHz) / sr);
  }

  /**
   * Valve lift at a crank angle, 0 to 1.
   *
   * Lift ramps over a FIXED number of crank degrees and then holds. A bigger cam is a
   * longer window, not a lazier one — tying the ramp to a fraction of the window made a
   * 290-degree race cam open more slowly than a stock one and come out duller, which is
   * the opposite of what a big cam sounds like.
   *
   * @param {number} deg crank degrees after firing TDC
   * @param {number} evoClose crank angle the valve shuts at
   * @returns {number} lift, 0 to 1
   */
  liftAt(deg, evoClose) {
    const span = evoClose - this.evoDeg;
    const since = deg - this.evoDeg;
    if (since <= 0 || since >= span) return 0;
    const ramp = Math.min(this.camRampDeg, span * 0.45);
    return Math.min(1, Math.min(since / ramp, (span - since) / ramp)) ** this.camShape;
  }

  /**
   * Cylinder volume at a crank angle, m^3. Slider-crank with a finite rod, because an
   * infinite rod misplaces the piston by several per cent around TDC — which is exactly
   * where the exhaust valve opens.
   *
   * @param {number} deg crank degrees after firing TDC
   * @returns {number} volume, m^3
   */
  volumeAt(deg) {
    const th = (deg * Math.PI) / 180;
    const l = this.rodRatio;
    const x = 1 - Math.cos(th) + l - Math.sqrt(Math.max(0, l * l - Math.sin(th) * Math.sin(th)));
    return this.vClear + (this.vSwept / 2) * x;
  }

  /**
   * Mass flow through one exhaust valve, kg/s. Positive is out of the cylinder.
   *
   * Compressible orifice flow, choked above the critical pressure ratio and subsonic
   * below it. Both branches matter and both are audible: a cylinder several bar above the
   * pipe is choked and cracks, and the same cylinder at idle is not and chuffs. It runs in
   * both directions, so a returning wave that pushes the pipe above the cylinder drives
   * flow backwards — which is reversion, and it is real.
   *
   * @param {number} pUp upstream pressure, Pa (absolute)
   * @param {number} pDown downstream pressure, Pa
   * @param {number} area effective flow area, m^2
   * @param {number} tempK upstream temperature, K
   * @returns {number} mass flow, kg/s
   */
  orifice(pUp, pDown, area, tempK) {
    if (area <= 0) return 0;
    const g = this.gamma;
    let hi = pUp;
    let lo = pDown;
    let sign = 1;
    if (lo > hi) { hi = pDown; lo = pUp; sign = -1; }
    if (hi <= 0) return 0;
    const crit = Math.pow((g + 1) / 2, g / (g - 1));
    const base = (area * hi) / Math.sqrt(R_GAS * tempK);
    if (hi / Math.max(1, lo) >= crit) {
      return sign * base * Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
    }
    const pr = lo / hi;
    const t = Math.pow(pr, 2 / g) - Math.pow(pr, (g + 1) / g);
    return sign * base * Math.sqrt(Math.max(0, ((2 * g) / (g - 1)) * t));
  }

  /**
   * @param {Float32Array[][]} _inputs
   * @param {Float32Array[][]} outputs
   * @param {Record<string, Float32Array>} params
   * @returns {boolean}
   */
  process(_inputs, outputs, params) {
    const outL = outputs[0][0];
    const outR = outputs[0][1] || outputs[0][0];
    const n = outL.length;
    if (!this.geom || this.nCyl === 0) { outL.fill(0); if (outR !== outL) outR.fill(0); return true; }

    const rpmA = params.rpm;
    const evoA = params.evoPa;
    const manifold = params.manifoldPa[0];
    const level = params.level[0];
    const overlap = params.overlapDeg[0];
    const jetGain = params.jet[0] * JET_PER_VEL;
    const flowGain = params.jet[0] * FLOW_NOISE;
    const lope = params.lope[0];
    const persistence = params.covPersistence[0];
    const sr = this.sr;
    const g = this.gamma;

    // Gas density in the primaries, for turning mass flow into a wave amplitude.
    const rhoPrimary = P_ATM / (R_GAS * this.geom.portK);
    // The exhaust valve always shuts AFTER top dead centre, even on a cam quoted at zero
    // overlap — an exhaust lobe closing exactly at TDC would trap the last of the charge
    // and squeeze it through a shutting orifice, which no engine does and which the model
    // heard as a velocity spike on every cylinder every cycle. Overlap extends it further.
    const evoClose = 360 + Math.max(EVC_MIN_ATDC, overlap * 0.5);

    for (let s = 0; s < n; s++) {
      const rpm = rpmA.length > 1 ? rpmA[s] : rpmA[0];
      const evo = evoA.length > 1 ? evoA[s] : evoA[0];
      if (rpm > 1) this.theta = (this.theta + (6 * rpm) / sr) % 720;

      // ---- Cylinders and primaries -------------------------------------------------
      // Each cylinder vents into its own tube. Nothing here knows the firing ORDER; it
      // knows each cylinder's crank offset, and the order falls out of that.
      const collectorIn = [0, 0];
      const collectorY = [0, 0];
      const collectorFlow = [0, 0];
      for (let i = 0; i < this.nCyl; i++) {
        const cy = this.cyl[i];
        const tube = this.primaries[i];
        const deg = (this.theta + 720 - cy.offsetDeg) % 720;
        const open = deg >= this.evoDeg && deg <= evoClose;

        // Arm at the start of the cycle, and set the cylinder to the pressure the
        // combustion model says it reached by valve opening.
        if (!open) { cy.armed = true; cy.lastQ = 0; }
        else if (cy.armed) {
          // CYCLE-TO-CYCLE VARIATION, and it belongs here rather than on the output.
          // A diluted charge burns weakly, so it reaches valve opening at a LOWER
          // pressure, so its blowdown is softer and its pulse is smaller — and because a
          // weak cycle leaves more residual behind, the next one on that cylinder starts
          // diluted too. That correlation is the difference between an engine loafing and
          // a gate chattering, and modelling it as a weaker BURN rather than as a quieter
          // pulse means the pipe hears it too: a soft pulse steepens less, so a loping
          // engine is duller as well as unevener. On a stock cam `lope` is zero and this
          // whole term is a no-op.
          cy.wander = cy.wander * persistence + (Math.random() * 2 - 1) * (1 - persistence);
          cy.strength = Math.max(0.12, 1 + cy.wander * lope);
          // ABSOLUTE cylinder pressure at valve opening, not overpressure. Adding
          // atmosphere to it again made a closed throttle louder than a wide-open one,
          // because at idle the cylinder is genuinely at about manifold pressure by the
          // time the valve cracks and there is no blowdown to hear at all.
          cy.p = Math.max(1000, evo * cy.strength);
          cy.armed = false;
        }

        const bwd = tube.readB();
        // WHAT THE PRIMARY SEES AT ITS OTHER END DEPENDS ON THE VALVE, and this is the
        // single thing that stops a header ringing like an organ pipe.
        //
        // Shut, the port is very nearly a rigid wall and reflects almost everything. Wide
        // open, the primary looks into the cylinder — a volume many times its own bore —
        // and the reflection collapses: the area ratio alone takes it from 0.96 down to
        // about 0.28 at full lift. So the tube is heavily damped for exactly as long as it
        // is being driven and free to ring only when it is not, which is why a real header
        // barks rather than whistles. Holding it constant instead left the primary's higher
        // modes with almost nothing to damp them, and at idle — where the excitation is
        // weakest and the valve is shut two thirds of the time — those modes were louder
        // than the engine and read as a screech that moved with pipe diameter and layout.
        const liftArea = open
          ? this.valveCd * this.valveArea * this.liftAt(deg, evoClose)
          : 0;
        const rHead = HEAD_REFLECTION * ((tube.area - liftArea) / (tube.area + liftArea));
        let fwd = rHead * bwd;

        if (open && rpm > 1) {
          const area = liftArea;

          // THE VALVE AND THE PIPE HAVE TO BE SOLVED TOGETHER, and getting this wrong is
          // what made the idle scream.
          //
          // The pressure at the port is not something the valve can read off and then
          // react to: the flow the valve passes launches a wave that IS part of that
          // pressure. In wave terms the tube offers the valve a Thevenin source — an
          // open-circuit pressure `pOpen` behind a characteristic impedance `rho c / A` —
          // and the orifice equation is a curve through that same (p, mdot) plane. The
          // physical answer is where the two meet.
          //
          // Evaluating the orifice at `pOpen` alone and adding its wave afterwards is an
          // explicit step around that loop, and its gain is d(mdot)/dp times c/A. Near
          // equalised pressure d(mdot)/dp goes to infinity — the orifice curve is vertical
          // there — so at light load with the valve wide open the loop gain passes one and
          // the model oscillates on its own. Measured, that is exactly what it did: a
          // fixed 848 Hz sine at a constant 8e-3 peak, unchanged by rpm, by load, by jet
          // noise, by the steepening term, and running at the SAME level as 3000 rpm at
          // wide-open throttle. It was not the engine at all, it was the solver, and it is
          // the screech.
          //
          // One Newton step on mdot = f(pOpen + (c/A) mdot) closes the loop instead. The
          // derivative is negative — more pressure downstream, less flow — so the
          // denominator is always above one and the step can never overshoot the meeting
          // point. It is also the right physics for free: a valve opened into a pipe far
          // narrower than itself is limited by the PIPE, and this is the term that says so.
          const pOpen = P_ATM + bwd + fwd;
          const zByRho = this.geom.cPrimary / tube.area;
          const explicit = this.orifice(cy.p, pOpen, area, this.cylK);
          const slope = (this.orifice(cy.p, pOpen + JUNCTION_DP, area, this.cylK) - explicit)
            / JUNCTION_DP;
          let mdot = explicit / (1 - Math.min(0, slope) * zByRho);
          const pPipe = pOpen + zByRho * mdot;

          // Cylinder state: isentropic, losing mass through the valve while the piston
          // changes the volume underneath it. Both terms are audible — the first is the
          // blowdown crack, the second is the exhaust stroke that follows it.
          //
          // THE VOLUME TERM IS EXACT rather than linearised. p V^gamma is constant, so
          // the new pressure is the old one times (V/V')^gamma; the differential form
          // -gamma p dV/V is the same thing to first order and misbehaves near TDC, which
          // is precisely where the exhaust stroke ends.
          const vol = this.volumeAt(deg);
          const dDeg = (6 * rpm) / sr;
          const vNext = this.volumeAt(deg + dDeg);
          const dt = dDeg / (6 * Math.max(1, rpm));
          cy.p *= Math.pow(vol / vNext, g);

          // AND THE FLOW TERM CANNOT OVERSHOOT. Gas leaves the cylinder until the
          // pressures equalise and then it stops; it does not carry on past and reverse.
          // An explicit step does exactly that when the two are close and the valve is
          // wide open — which is a light load, at idle, on every cylinder — and the result
          // was the pressure ringing between samples and the model manufacturing its own
          // broadband noise. Measured, cycle-to-cycle correlation at 800 rpm on a closed
          // throttle was 0.36 where it should be 1: the idle was mostly numerical.
          // Clamping the step at the point where flow would stop is both the fix and the
          // physical statement.
          let dpFlow = -(g * mdot * R_GAS * this.cylK * dt) / vol;
          const gap = pPipe - cy.p;
          if (Math.abs(dpFlow) > Math.abs(gap)) {
            mdot *= Math.abs(gap) / Math.abs(dpFlow);
            dpFlow = gap;
          }
          cy.p += dpFlow;
          if (cy.p < 1000) cy.p = 1000;
          void manifold;

          // The wave the flow launches down the primary. A volume flow Q injected at the
          // closed end of a duct raises the pressure there by rho*c*Q/A.
          const q = mdot / rhoPrimary;
          cy.lastQ = q;
          fwd += (this.geom.cPrimary * rhoPrimary * q) / tube.area;

          // Turbulence at the seat, in proportion to how fast gas is going through it.
          // It is loudest exactly during blowdown and silent between events, so it
          // arrives as rasp on each pulse rather than as a bed of hiss underneath them.
          if (area > 1e-7) {
            // Capped at the sonic velocity the gas can actually reach. Without it the
            // ratio blows up as the valve shuts and the flow area goes to zero faster
            // than the flow does.
            const vel = Math.min(this.geom.cPrimary, Math.abs(q) / area);
            fwd += (Math.random() * 2 - 1) * vel * jetGain * rhoPrimary * this.geom.cPrimary / tube.area * 1e-3;
          }
        }

        // Hand the far end of this primary to its bank's collector.
        const arriving = tube.readF();
        const y = tube.area / (rhoPrimary * this.geom.cPrimary);
        collectorIn[cy.bank] += y * arriving;
        collectorY[cy.bank] += y;
        collectorFlow[cy.bank] += Math.abs(cy.lastQ);
        // Stash for the junction pass below.
        tube.pendingF = fwd;
        tube.arriving = arriving;
        tube.y = y;
      }

      // ---- Collector junction, tailpipe, muffler and mouth ---------------------------
      let left = 0;
      let right = 0;
      for (let b = 0; b < this.banks; b++) {
        const tA = this.tailA[b];
        const ch = this.chamber[b];
        const tB = this.tailB[b];
        const rhoTail = P_ATM / (R_GAS * this.geom.tailK);
        const cT = this.geom.cTail;
        const yA = tA.area / (rhoTail * cT);
        const yC = ch.area / (rhoTail * cT);
        const yB = tB.area / (rhoTail * cT);

        // THE COLLECTOR. Every primary on this bank and the tailpipe all meet here at one
        // pressure, and each one is handed back the difference between that pressure and
        // what it brought. This single junction is where the cylinders hear each other.
        // FLOW NOISE. Gas moving through a merge, a converter and a set of baffles
        // separates and reattaches, and that turbulence radiates broadband — it is one of
        // the three named sources of exhaust noise alongside the firing pulses, and it is
        // what a listener actually hears between chuffs on an idling car. It belongs here
        // rather than at the output because everything downstream then colours it: it
        // arrives having been through the cat, the muffler and the mouth, so it is part of
        // the pipe rather than a bed laid under it. Amplitude goes with the square of bulk
        // velocity, which is the usual scaling for flow past an obstruction, so it grows
        // with airflow and is nearly absent at a closed throttle.
        const bulk = collectorFlow[b] / tA.area;
        const flowNoise = (Math.random() * 2 - 1) * bulk * bulk * flowGain;

        const tailBack = tA.readB();
        const sumY = collectorY[b] + yA;
        const pJ = (2 * (collectorIn[b] + yA * tailBack)) / (sumY || 1) + flowNoise;
        // AND IT LOSES ENERGY DOING IT. Four pipes merging is not a lossless junction: the
        // streams arrive at different angles and different times and mix turbulently, and
        // that mixing is dissipation. Without it a primary is a closed tube with a nearly
        // rigid end at the shut valve and almost nothing to damp it, so it rings on its own
        // between chuffs — measured at idle, a 460 Hz mode was twelve decibels above the
        // engine and reading as a screech, and it moved with pipe diameter and layout
        // exactly as a pipe mode would.
        for (let i = 0; i < this.nCyl; i++) {
          if (this.cyl[i].bank !== b) continue;
          const tube = this.primaries[i];
          tube.write(tube.pendingF, (pJ - tube.arriving) * MERGE_KEEP);
        }

        // THE MUFFLER, which is an expansion chamber and nothing more: the pipe opens into
        // a volume several times its area and necks back down, and each of those two steps
        // reflects. Waves that go round the chamber and come back a half wavelength late
        // cancel what is still arriving — which is exactly how a reactive muffler is
        // quiet at some frequencies and not at others. Fit a straight-through system and
        // the areas match, nothing reflects, and it is simply more pipe.
        // Collector pipe, then the converter, then the muffler chamber, then the tailpipe.
        const cat = this.cat[b];
        const yCat = cat.area / (rhoTail * cT);
        const aAtCat = tA.readF();
        const catBack = cat.readB();
        const pJ0 = (2 * (yA * aAtCat + yCat * catBack)) / (yA + yCat);
        const aAtCh = cat.readF();
        const chBack = ch.readB();
        const pJ1 = (2 * (yCat * aAtCh + yC * chBack)) / (yCat + yC);
        const chAtB = ch.readF();
        const bBack = tB.readB();
        const pJ2 = (2 * (yC * chAtB + yB * bBack)) / (yC + yB);

        // THE OPEN MOUTH. Most of the wave turns round and comes back INVERTED — that
        // minus sign is the whole reason a pipe has a note — and the rest radiates. The
        // reflection is stronger at low frequency than high, because a mouth radiates
        // treble far more easily than bass, so it is filtered on the way back.
        const atMouth = tB.readF();
        this.mouthLp[b] = atMouth + this.mouthLpK * (this.mouthLp[b] - atMouth);
        const reflected = -MOUTH_REFLECTION * this.mouthLp[b];

        tA.write((pJ - tailBack) * MERGE_KEEP, (pJ0 - aAtCat) * STEP_KEEP);
        cat.write((pJ0 - catBack) * STEP_KEEP, (pJ1 - aAtCh) * STEP_KEEP);
        ch.write((pJ1 - chBack) * STEP_KEEP, (pJ2 - chAtB) * STEP_KEEP);
        tB.write((pJ2 - bBack) * STEP_KEEP, reflected);

        // WHAT A LISTENER ACTUALLY HEARS, and this had it exactly backwards.
        //
        // A pipe mouth radiates as a compact monopole only while it is small compared with
        // the wavelength. There the far-field pressure follows the TIME DERIVATIVE of the
        // volume flow, so it rises at 6 dB/octave. But that cannot continue: once ka passes
        // one the mouth is no longer compact, it beams instead of radiating spherically,
        // and its radiation efficiency stops rising and plateaus. The standard result is
        // that radiated amplitude goes as ka/sqrt(1 + (ka)^2) — RISING below ka = 1 and
        // FLAT above it, which is a first-order highpass at that corner.
        //
        // What was here was the mirror image: flat below and rising for ever above, which
        // is an unbounded differentiator. Measured, it put +18.5 dB into the top octave
        // relative to DC and lifted every high mode, every numerical artefact and all of
        // the jet noise with it. That is a screech, and no amount of damping inside the
        // pipes could reach it, because it was applied after them.
        // What radiates is the VOLUME FLOW leaving the mouth, not the pressure in the
        // pipe: U = A(f - b) / (rho c). That factor of area is why a bigger tailpipe is
        // louder and more open and a small one is subdued, which is the first thing anyone
        // notices about pipe diameter — and without it the model had it backwards, because
        // a narrow pipe raises wave pressure for the same flow.
        const leaving = ((atMouth - reflected) * tB.area) / (rhoTail * cT);
        // One-pole highpass at ka = 1. It also removes the standing offset the exhaust
        // stroke leaves in the flow, for free and for the same reason: steady flow makes
        // no sound, and a source that cannot radiate at low frequency certainly cannot
        // radiate at zero.
        const rad = this.radK * (this.prevRad[b] + leaving - this.prevOut[b]);
        this.prevRad[b] = rad;
        this.prevOut[b] = leaving;
        if (b === 0) left += rad; else right += rad;
      }

      if (this.banks === 1) { right = left; }
      else {
        // Two banks down two pipes, heard from two places a couple of metres apart.
        const l = left * 0.80 + right * 0.36;
        const r = right * 0.80 + left * 0.36;
        left = l; right = r;
      }

      const trim = level * PA_TO_UNIT;
      outL[s] = left * trim;
      if (outR !== outL) outR[s] = right * trim;
    }
    return true;
  }

}

/** The name the worklet registers under, when it is running as one. */
export const PROCESSOR_NAME = 'exhaust-waveguide';

// Only inside an AudioWorkletGlobalScope. On the main thread and in Node this is a plain
// module export and nothing is registered.
if (typeof registerProcessor !== 'undefined') {
  registerProcessor(PROCESSOR_NAME, ExhaustProcessor);
}
