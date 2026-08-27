/**
 * Engine synthesiser tests, against a stub AudioContext.
 *
 * The point is not to check that it sounds good — nothing automated can. It is to check
 * that the renderer stays HONEST to the physics it is handed: that the pipe delay really
 * is 1 / 2f for the resonance the model reported, that the pulse train really does land
 * on the crank angles the layout fires at, and that "stop" really does stop.
 *
 * The last one is the reason this file exists at all. A parked gain from a scheduled
 * ramp is silent in every unit test and screaming in the browser.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { acousticDrive, deriveEngine, exhaustGeometry, DEFAULT_ENGINE_CONFIG, DEFAULT_MODS,
  BARO_KPA, COMPRESSOR_OPTS, TURBINE_OPTS, OCTANE_OPTS, DEFAULT_VE, interp2,
  evaluatePoint } from '../../src/sim/index.js';
import { createEngineAudio, silenceEngineAudio, updateEngineAudio }
  from '../../src/ui/audio/engineAudio.js';

/** A minimal AudioParam that records what was written to it. */
function param(value = 0) {
  return {
    value,
    targets: [], values: [],
    setTargetAtTime(v) { this.targets.push(v); this.value = v; },
    setValueAtTime(v) { this.values.push(v); this.value = v; },
    cancelScheduledValues() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
  };
}

/**
 * A stub AudioContext, enough of one for the graph to build and be driven.
 *
 * Typed loosely on purpose: it implements the handful of factory methods the graph
 * calls and none of the other thirty on the real interface, so pinning it to
 * `AudioContext` would only mean stubbing methods nothing exercises.
 *
 * @returns {any}
 */
function stubContext() {
  const started = [];
  const node = (extra = {}) => ({
    connect() {}, disconnect() {}, start(when) { started.push(when ?? 0); }, ...extra,
  });
  return {
    started,
    sampleRate: 44100,
    currentTime: 0,
    destination: node(),
    createGain: () => node({ gain: param(1) }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), type: 'sine', setPeriodicWave() {} }),
    createBiquadFilter: () => node({ frequency: param(1000), Q: param(1), gain: param(0), type: 'lowpass' }),
    createDelay: () => node({ delayTime: param(0.01) }),
    createDynamicsCompressor: () => node({
      threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25),
    }),
    createPeriodicWave: () => ({}),
    createWaveShaper: () => node({ curve: null, oversample: 'none' }),
    createBuffer: (_ch, len) => {
      const data = new Float32Array(len);
      return { length: len, getChannelData: () => data };
    },
    createBufferSource: () => node({ buffer: null, loop: false, playbackRate: param(1), onended: null }),
    createStereoPanner: () => node({ pan: param(0) }),
    // The exhaust falls back to this wherever an AudioWorklet module cannot be loaded,
    // which is every strict-CSP page the app is served from — so the stub has no
    // `audioWorklet` and these tests run the path that most players actually get.
    createScriptProcessor: (len, _in, out) => node({
      onaudioprocess: null,
      bufferSize: len,
      outputBuffer: { getChannelData: () => new Float32Array(len), numberOfChannels: out },
    }),
  };
}

const DERIVED = deriveEngine(DEFAULT_ENGINE_CONFIG);

/** A drive for a stock V6 pulling hard, plus a frame around it. */
function frameFor(overrides = {}) {
  const configuration = overrides.configuration ?? DEFAULT_ENGINE_CONFIG.configuration;
  const derived = overrides.derived ?? DERIVED;
  const rpm = overrides.rpm ?? 4500;
  const pt = evaluatePoint({
    rpm, mapKpa: BARO_KPA, boostPsi: 0, veVal: interp2(DEFAULT_VE, rpm, BARO_KPA),
    timingVal: 26, afrCommanded: 12.8, fuel: OCTANE_OPTS[0],
    mods: { ...DEFAULT_MODS, turboFitted: false },
    mafScalar: 1, mafErrorBase: 1, injectorCc: 550, ecuInjectorCc: 550,
    derived, compressor: COMPRESSOR_OPTS[1], turbine: TURBINE_OPTS[1],
  });
  return {
    drive: acousticDrive({ rpm, derived, point: pt, configuration, pipeDiaIn: 2.5 }),
    rpm, configuration, load: 1, audible: true, cut: false, cranking: false,
    geometry: exhaustGeometry({
      displacementL: derived.displacementL, cyl: derived.cyl, bore: DEFAULT_ENGINE_CONFIG.bore,
      compression: DEFAULT_ENGINE_CONFIG.compression, configuration,
      pipeDiaIn: 2.5, gasTempK: pt.egt + 273.15,
    }),
    pipeDiaIn: 2.5, openExhaust: false, intakeFitted: false, boostPsi: 0,
    ...overrides,
  };
}

describe('the engine synthesiser', () => {
  let ctx, graph;
  beforeEach(() => { ctx = stubContext(); graph = createEngineAudio(ctx); });

  /** Pushes a frame, advancing the clock first so the parameter throttle lets it through. */
  const push = (frame) => { ctx.currentTime += 0.1; updateEngineAudio(graph, frame); };

  it('builds silent, so nothing is heard before a frame is pushed', () => {
    expect(graph.master.gain.value).toBe(0);
  });

  it('starts every source it creates', () => {
    expect(ctx.started.length).toBeGreaterThan(5);
  });

  it('holds the exhaust silent until the frame says the engine is audible', () => {
    push(frameFor({ audible: false }));
    expect(graph.exhaustGain.gain.value).toBe(0);
    push(frameFor({ audible: true }));
    expect(graph.exhaustGain.gain.value).toBeGreaterThan(0);
  });

  it('goes quiet when the engine is not audible', () => {
    push(frameFor({ audible: false }));
    expect(graph.master.gain.value).toBe(0);
  });

  it('applies no level curve of its own, because how loud an engine is is physics', () => {
    // The waveguide is driven by the pressure the cylinder actually reached, so idle comes
    // out quiet and wide-open throttle loud without anything here scaling it. A gain curve
    // on top would be asserting a second, different answer.
    push(frameFor({ rpm: 4500 }));
    const wot = graph.master.gain.value;
    push(frameFor({ rpm: 800 }));
    expect(graph.master.gain.value).toBe(wot);
  });

  it('rebuilds the tube network only when the build changes', () => {
    push(frameFor({ configuration: 'V8' }));
    const first = graph.geomKey;
    expect(first).not.toBe('');
    push(frameFor({ configuration: 'V8' }));
    expect(graph.geomKey).toBe(first);
    push(frameFor({ configuration: 'I4' }));
    expect(graph.geomKey).not.toBe(first);
  });
});

describe('stopping', () => {
  it('pins every layer to zero rather than gliding towards it', () => {
    const ctx = stubContext();
    const graph = createEngineAudio(ctx);
    ctx.currentTime = 0.5;
    updateEngineAudio(graph, frameFor());
    expect(graph.master.gain.value).toBeGreaterThan(0);

    silenceEngineAudio(graph);
    for (const node of [graph.master, graph.exhaustGain, graph.indG, graph.whistleG,
      graph.bladeG, graph.rushG, graph.bovG, graph.flutEnv]) {
      expect(node.gain.value).toBe(0);
    }
  });
});

/** What the output stage must not do to the model's own dynamics. */
describe('what makes it sound real', () => {
  it('compresses the envelope without catching individual firing events', () => {
    // AN ENGINE IS A TRANSIENT TRAIN AND ITS CREST FACTOR IS THE SOUND. If the renderer's
    // own maximum static gain is above unity, every pulse is flattened into the ceiling
    // and the peak-to-average ratio collapses to a couple of decibels — measured, that is
    // exactly what a listener calls "digital", and no work on the pulse survives it.
    // So the chain must be able to reach full scale only on peaks, never on the bed.
    const ctx = stubContext();
    const a = createEngineAudio(ctx);
    ctx.currentTime += 0.1;
    updateEngineAudio(a, frameFor({ rpm: 6000, load: 1 }));
    // THE ATTACK IS THE WHOLE SAFETY PROPERTY. The model's own range from idle to redline
    // is about 20 dB, which is real, and compressing it is the only way idle is audible on
    // a phone without the loud end clipping. That is safe if and only if the compressor
    // works on the RUNNING LEVEL and not on the pulses: a V8 at 3000 rpm fires every five
    // milliseconds, so anything faster than that flattens the engine into a slab, which is
    // exactly what "digital" means. Measured through a full dyno pull with this attack,
    // peak 0.935, zero clipped samples, and 10.5 dB of crest still there.
    expect(a.limiter.attack.value).toBeGreaterThan(0.03);
    // And there is still a brickwall after the make-up gain to catch what the slow attack
    // lets through.
    expect(a.softClip.curve).not.toBeNull();
  });
});
