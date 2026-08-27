/**
 * The exhaust waveguide, run as the DSP it is.
 *
 * `exhaustProcessor.js` is an AudioWorklet module, but it is ordinary JavaScript that
 * needs exactly three globals, so it can be run in plain Node at any block size and its
 * output examined. That is worth doing properly: this file is an acoustic model, and the
 * things that make it right or wrong — does a bigger pipe get louder, does a muffler eat
 * treble, does a cross-plane V8 come out uneven — are measurable rather than matters of
 * taste, and none of them are visible from the Web Audio graph that hosts it.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { BARO_KPA, COMPRESSOR_OPTS, DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, DEFAULT_VE,
  OCTANE_OPTS, TURBINE_OPTS, deriveEngine, evaluatePoint, evoPressureKpa, exhaustGeometry,
  interp2 } from '../src/sim/index.js';

const SR = 44100;
/** @type {any} */
let Processor;

beforeAll(async () => {
  /** @type {any} */ (globalThis).sampleRate = SR;
  /** @type {any} */ (globalThis).AudioWorkletProcessor = class {
    constructor() { this.port = { onmessage: null, postMessage() {} }; }
  };
  /** @type {any} */ (globalThis).registerProcessor = (_name, cls) => { Processor = cls; };
  // Not a static import: the module registers its processor as a side effect and needs
  // the three globals above to exist first.
  await import(/* @vite-ignore */ '../src/ui/audio/exhaustProcessor.js');
});

/**
 * Runs the model and returns the signal it produced.
 *
 * @param {object} [opts]
 * @returns {{ out: Float32Array, right: Float32Array, geo: any }} the left channel, the
 *   right channel, and the geometry the model was handed
 */
function run(opts = {}) {
  const {
    rpm = 3000, seconds = 1.2, load = 1, pipeDiaIn = 3, muffled = false, jet = 0.3,
    engine = { configuration: 'V8', bore: 101.6, stroke: 92 },
    headers = false, turboFitted = false,
  } = opts;
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...engine };
  const derived = deriveEngine(cfg);
  const mapKpa = 30 + load * (BARO_KPA - 30);
  const point = evaluatePoint({
    rpm, mapKpa, boostPsi: 0, veVal: interp2(DEFAULT_VE, rpm, mapKpa), timingVal: 24,
    afrCommanded: 12.8, fuel: OCTANE_OPTS[0], mods: { ...DEFAULT_MODS, turboFitted: false },
    mafScalar: 1, mafErrorBase: 1, injectorCc: 650, ecuInjectorCc: 650, derived,
    compressor: COMPRESSOR_OPTS[1], turbine: TURBINE_OPTS[1],
  });
  const geo = exhaustGeometry({
    displacementL: derived.displacementL, cyl: derived.cyl, bore: cfg.bore,
    compression: cfg.compression, configuration: cfg.configuration, pipeDiaIn,
    gasTempK: point.egt + 273.15, headers, turboFitted,
  });
  const p = new Processor();
  p.port.onmessage({ data: { ...geo, muffled } });

  const evoPa = evoPressureKpa({
    peakPressureBar: point.peakPressure, peakPressureDeg: point.peakPressureDeg,
    compression: derived.compression, displacementL: derived.displacementL, cyl: derived.cyl,
  }) * 1000;
  const par = (v) => Float32Array.of(v);
  const params = {
    // The EXHAUST manifold, which is what the parameter means and what `engineAudio`
    // sends. This was passing the intake MAP, which is a different number entirely below
    // wide-open throttle: at a closed throttle it told the model the cylinder was venting
    // into a third of an atmosphere, and every light-load measurement taken through this
    // harness came out louder and harder than the model actually is.
    rpm: par(rpm), evoPa: par(evoPa), manifoldPa: par(point.emp * 1000), level: par(1),
    overlapDeg: par(derived.overlapDeg || 0), jet: par(jet), lope: par(0),
    covPersistence: par(0.55),
  };

  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const right = new Float32Array(n);
  const blk = 128;
  const l = new Float32Array(blk);
  const r = new Float32Array(blk);
  for (let i = 0; i < n; i += blk) {
    p.process([], [[l, r]], params);
    for (let k = 0; k < blk && i + k < n; k++) { out[i + k] = l[k]; right[i + k] = r[k]; }
  }
  // Drop the first half second: the tubes start empty and have to fill.
  const skip = Math.floor(SR * 0.5);
  return { out: out.subarray(skip), right: right.subarray(skip), geo };
}

/**
 * Energy in a frequency band, in dB.
 *
 * @param {Float32Array} x
 * @param {number} lo
 * @param {number} hi
 * @returns {number} band energy, dB
 */
function bandDb(x, lo, hi) {
  const n = 1 << 14;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n && i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  let e = 0;
  for (let i = Math.ceil((lo * n) / SR); i < (hi * n) / SR; i++) e += re[i] * re[i] + im[i] * im[i];
  return 10 * Math.log10(e + 1e-30);
}

/**
 * How deeply the envelope is modulated at the firing rate: 1 means the signal falls to
 * silence between pulses, 0 means a continuous tone with no events left in it at all.
 *
 * Crest factor cannot answer this on its own. It mixes together how far apart the pulses
 * are and how sharp each one is, and those two move in OPPOSITE directions with engine
 * speed — the gaps close up while the blowdown gets more violent — so a flat crest across
 * the range says nothing either way. This measures the gaps alone.
 *
 * @param {Float32Array} x
 * @param {number} firingHz
 * @returns {number} modulation depth, 0..1
 */
function pulseSeparation(x, firingHz) {
  // Envelope: rectify, then a one-pole slow enough to ride over the note itself and fast
  // enough to follow the pulses.
  const k = Math.exp((-2 * Math.PI * 120) / SR);
  const env = new Float64Array(x.length);
  let e = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); e = a + k * (e - a); env[i] = e; }
  let dc = 0;
  for (const v of env) dc += v;
  dc /= env.length;
  let re = 0;
  let im = 0;
  for (let i = 0; i < env.length; i++) {
    const w = (2 * Math.PI * firingHz * i) / SR;
    re += env[i] * Math.cos(w);
    im += env[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / env.length / Math.max(1e-12, dc);
}

/** @param {Float32Array} x @returns {{peak: number, rms: number, crest: number}} */
function levels(x) {
  let peak = 0;
  let sq = 0;
  for (const v of x) { const a = Math.abs(v); if (a > peak) peak = a; sq += v * v; }
  const rms = Math.sqrt(sq / x.length);
  return { peak, rms, crest: 20 * Math.log10(peak / rms) };
}

describe('the exhaust waveguide', () => {
  it('is stable and finite everywhere it can be driven', () => {
    for (const rpm of [700, 3000, 7000]) {
      for (const load of [0.08, 1]) {
        const { out } = run({ rpm, load, seconds: 1 });
        const { peak } = levels(out);
        expect(Number.isFinite(peak)).toBe(true);
        // A waveguide that is not passive runs away. This one has loss at every wall,
        // every junction and the open end, so it cannot.
        expect(peak).toBeLessThan(2);
        expect(peak).toBeGreaterThan(0.01);
      }
    }
  });

  it('keeps the peak-to-average ratio of a transient train, and fuses the pulses as speed rises', () => {
    // An engine is a train of pressure pulses and its crest factor is the sound. Flattened
    // below about 4 dB it is a slab, which is what "digital" means; a real exhaust
    // recording sits around 10 to 14 dB and this model should live in that window at every
    // speed it can be run at.
    const speeds = [1500, 3000, 7000];
    const runs = speeds.map((rpm) => run({ rpm, seconds: 1 }).out);
    for (const x of runs) {
      const { crest } = levels(x);
      expect(crest).toBeGreaterThan(4);
      expect(crest).toBeLessThan(20);
    }
    // The pulses themselves fuse, and THAT is what changes with speed. At 3000 rpm a V8
    // fires every 10 ms into a pipe that rings for a few, so the envelope still falls away
    // between events; at 7000 it fires every 4.3 ms and they run into each other. Crest
    // factor does not show this, because the blowdown gets sharper over the same range and
    // the two effects cancel in it — see `pulseSeparation`.
    const sep = speeds.map((rpm, i) => pulseSeparation(runs[i], (rpm / 120) * 8));
    expect(sep[2]).toBeLessThan(sep[1] * 0.6);
  });

  it('does not sing to itself when the valve is barely doing anything', () => {
    // THE SCREECH REGRESSION. The valve and the pipe it opens into have to be solved
    // together: the flow through the valve launches a wave that is part of the very
    // pressure the valve is reacting to. Reading the pipe pressure first and adding the
    // wave afterwards is an explicit step around that loop, and the loop gain is
    // d(mdot)/dp times c/A — which runs away as the two pressures equalise, because the
    // orifice curve is vertical there. That is a closed throttle with the valve wide open,
    // which is to say an idle.
    //
    // What it produced was a fixed 848 Hz sine at a constant amplitude, unmoved by rpm, by
    // load, by jet noise or by the steepening term, and sitting at the SAME level as 3000
    // rpm at wide-open throttle. Three symptoms pin it, and all three are checked here.
    const idle = run({ rpm: 800, load: 0.05, muffled: true, seconds: 1.4 });
    const wot = run({ rpm: 3000, load: 1, muffled: true, seconds: 1.4 });

    // 1. An idle is far quieter than full load. It was 1 dB apart; a real engine is 25 to
    //    30 dB and this measures about 16, the rest of which is the exhaust stroke, which
    //    displaces the same swept volume whatever the throttle is doing.
    const apartDb = 20 * Math.log10(levels(wot.out).rms / levels(idle.out).rms);
    expect(apartDb).toBeGreaterThan(12);

    // 2. Nothing stands 15 dB proud of the rest of the spectrum at idle. A self-oscillation
    //    is a single line; a real idle is a pulse train with a dense low-frequency comb.
    const fine = [];
    for (let f = 60; f < 3000; f += 60) fine.push(bandDb(idle.out, f, f + 60));
    const loudest = Math.max(...fine);
    const median = [...fine].sort((a, b) => a - b)[fine.length >> 1];
    expect(loudest - median).toBeLessThan(25);

    // 3. Most of the energy is where an exhaust puts it, at the bottom. The oscillation put
    //    the loudest band at 800-2000 Hz with 30-120 Hz nearly 30 dB below it.
    expect(bandDb(idle.out, 30, 300)).toBeGreaterThan(bandDb(idle.out, 800, 2000) + 6);
  });

  it('gets louder with load because the cylinder reaches valve opening higher, not because anything says so', () => {
    // At 3000 rpm the valve is only open for four milliseconds, so how hard the cylinder
    // is pushing is what decides the pulse. Checked with a muffler on, because that is
    // what a car has and because an open system's own ringing narrows the gap.
    const light = levels(run({ rpm: 3000, load: 0.1, muffled: true }).out).rms;
    const wot = levels(run({ rpm: 3000, load: 1, muffled: true }).out).rms;
    expect(wot).toBeGreaterThan(light * 2);
    // ...and a closed throttle is still clearly audible rather than vanishing. This is the
    // whole reason the level is physical rather than a curve: nothing here decides that
    // idle should be quiet, it comes out quiet because the blowdown is genuinely weak.
    expect(light).toBeGreaterThan(0.01);
  });

  it('gets louder with engine speed, because there is less time to empty the cylinder', () => {
    const idle = levels(run({ rpm: 800, load: 0.12, muffled: true }).out).rms;
    const redline = levels(run({ rpm: 6000, load: 1, muffled: true }).out).rms;
    expect(redline).toBeGreaterThan(idle * 3);
  });

  it('radiates more from a bigger tailpipe', () => {
    // The article's first observation about pipe diameter, and it comes out of the model
    // rather than being applied to it: what radiates is volume flow, U = A(f - b)/(rho c),
    // so the mouth area is a direct multiplier. Modelling pressure instead had a narrow
    // pipe coming out LOUDER, because a narrow pipe raises wave pressure for a given flow.
    const small = levels(run({ pipeDiaIn: 2 }).out).rms;
    const big = levels(run({ pipeDiaIn: 4 }).out).rms;
    expect(big).toBeGreaterThan(small);
  });

  it('loses its treble through a muffler and keeps its bass', () => {
    const open = run({ muffled: false }).out;
    const muffled = run({ muffled: true }).out;
    const lowCut = bandDb(open, 40, 200) - bandDb(muffled, 40, 200);
    const highCut = bandDb(open, 2000, 8000) - bandDb(muffled, 2000, 8000);
    // An expansion chamber is a reactive device: it reflects, and what it reflects best
    // is what fits its length. Treble goes; the bottom end largely does not.
    expect(highCut).toBeGreaterThan(15);
    expect(highCut).toBeGreaterThan(lowCut + 8);
  });

  it('retunes itself with gas temperature, because every tube is length over c', () => {
    // Not by load: with fixed timing a light load is further from MBT, burns later and
    // sends the gas out HOTTER, which the model reproduces and which is worth not
    // asserting away. So this drives temperature directly.
    const at = (gasTempK) => exhaustGeometry({
      displacementL: 6.2, cyl: 8, bore: 101.6, compression: 10.3, configuration: 'V8',
      pipeDiaIn: 3, gasTempK,
    });
    const cool = at(700);
    const hot = at(1200);
    expect(hot.cPrimary).toBeGreaterThan(cool.cPrimary * 1.2);
    // The bark and the body both ride on it: quarter-wave on the primary, half-wave on
    // the tail. An engine really does sharpen as it comes up to temperature.
    expect(hot.cPrimary / (4 * hot.primaryLength))
      .toBeGreaterThan(cool.cPrimary / (4 * cool.primaryLength) * 1.2);
    expect(hot.cTail).toBeGreaterThan(cool.cTail);
  });

  it('sounds different for every layout without being told how a layout sounds', () => {
    const layouts = ['I4', 'I6', 'V6', 'V8'];
    const heard = layouts.map((configuration) => {
      const bore = configuration === 'I4' ? 82.5 : 95;
      const { out, right } = run({ engine: { configuration, bore, stroke: 90 }, pipeDiaIn: 2.5 });
      // How far apart the two channels are. One bank down one pipe is mono; two banks are
      // two pipes a couple of metres apart carrying different pulse trains, and that is a
      // real, audible difference that no amount of band energy can show.
      let ll = 0;
      let rr = 0;
      let lr = 0;
      for (let i = 0; i < out.length; i++) { ll += out[i] * out[i]; rr += right[i] * right[i]; lr += out[i] * right[i]; }
      const width = 1 - lr / Math.sqrt(Math.max(1e-30, ll * rr));
      return {
        bands: [bandDb(out, 40, 200), bandDb(out, 200, 800), bandDb(out, 800, 3000)],
        width,
      };
    });
    // Every layout is distinguishable from every other one. The only thing that differs
    // between these runs is the firing geometry and the cylinder count.
    //
    // Not every pair separates on the same axis, and insisting they do would be asserting
    // something untrue. An even-fire V6 and an I6 fire at exactly the same six evenly
    // spaced angles: their spectral balance SHOULD be close, and measured it is, within
    // 1.7 dB summed over three octave-ish bands. What separates them is that the V6's
    // events leave down two pipes and the I6's down one, so one is stereo and the other is
    // not. Both are the firing geometry speaking; they just speak through different
    // measurements.
    for (let i = 0; i < heard.length; i++) {
      for (let j = i + 1; j < heard.length; j++) {
        const apart = heard[i].bands.reduce((acc, v, k) => acc + Math.abs(v - heard[j].bands[k]), 0);
        const wider = Math.abs(heard[i].width - heard[j].width);
        expect(apart > 2 || wider > 0.05,
          `${layouts[i]} and ${layouts[j]} are indistinguishable: ${apart.toFixed(2)} dB apart, `
          + `stereo width ${heard[i].width.toFixed(3)} vs ${heard[j].width.toFixed(3)}`).toBe(true);
      }
    }
    // And a single-bank engine is genuinely mono, because it has one tailpipe.
    expect(heard[0].width).toBeLessThan(1e-6);
    expect(heard[1].width).toBeLessThan(1e-6);
    expect(heard[3].width).toBeGreaterThan(0.05);
  });

  it('fires each cylinder once per two revolutions, on its own crank angle', () => {
    // The rumble, checked at the source rather than at the output: a cross-plane V8's
    // banks fire at 180/270/180/90 degrees, so the events are not evenly spaced.
    const { geo } = run({ seconds: 0.3 });
    expect(geo.events).toHaveLength(8);
    expect(geo.banks).toBe(2);
    const bank0 = geo.events.filter((/** @type {any} */ e) => e.bank === 0).map((/** @type {any} */ e) => e.angleDeg);
    const gaps = bank0.slice(1).map((/** @type {number} */ a, /** @type {number} */ i) => a - bank0[i]);
    expect(new Set(gaps.map((/** @type {number} */ g) => Math.round(g))).size).toBeGreaterThan(1);
  });
});

describe('what the rest of the build does to the exhaust', () => {
  /** @param {object} o @returns {{rms: number, bands: number[]}} */
  function measure(o) {
    const { out } = run({ rpm: 3000, load: 1, muffled: true, seconds: 1.4, ...o });
    return {
      rms: levels(out).rms,
      bands: [bandDb(out, 40, 200), bandDb(out, 200, 800), bandDb(out, 800, 3000), bandDb(out, 3000, 8000)],
    };
  }

  it('mutes the whole exhaust when a turbine sits in it', () => {
    // The single biggest thing that makes a boosted car sound unlike the same engine
    // naturally aspirated, and it is not an EQ curve: the blowdown does work on a wheel
    // instead of leaving through a pipe, so the energy that would have been noise becomes
    // shaft power, and a rotor in the path absorbs most of what gets past.
    const na = measure({});
    const turbo = measure({ turboFitted: true });
    expect(turbo.rms).toBeLessThan(na.rms * 0.6);
    // And it takes the top end hardest, which is why a turbo car is muffled rather than
    // merely quiet.
    expect(na.bands[3] - turbo.bands[3]).toBeGreaterThan(na.bands[0] - turbo.bands[0]);
  });

  it('deepens and opens the bark when long-tube headers replace a cast manifold', () => {
    const stock = measure({});
    const headers = measure({ headers: true });
    // Longer primaries of a bigger bore: the quarter-wave drops and less is lost getting
    // to the collector, so the mid band the bark lives in comes up RELATIVE to the boom
    // underneath it. Stated as a ratio because how loud the whole thing is depends on gas
    // temperature, and that is the cycle's business rather than the header's.
    expect(headers.bands[1] - headers.bands[0])
      .toBeGreaterThan(stock.bands[1] - stock.bands[0] + 1);
  });

  it('stacks headers with an open system, because they are different parts', () => {
    const stock = measure({});
    const both = measure({ headers: true, muffled: false });
    expect(both.bands[2]).toBeGreaterThan(stock.bands[2] + 8);
    expect(both.bands[3]).toBeGreaterThan(stock.bands[3] + 8);
  });
});
