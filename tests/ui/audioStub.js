/**
 * A stub Web Audio context, shared by the renderer's own tests and by the app tests that
 * need audio to EXIST — jsdom has none, so without this the app runs its no-audio path.
 */

/**
 * A minimal AudioParam that records what was written to it.
 *
 * @param {number} [value]
 * @returns {any}
 */
export function param(value = 0) {
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
 * `resume` and `suspend` behave like the real ones in the one way that matters here:
 * `resume` settles LATER, so code that reads `state` straight after calling it sees the
 * old value — exactly as a browser does on the tap that unlocks audio.
 *
 * @param {{state?: 'running'|'suspended'}} [opts]
 * @returns {any}
 */
export function stubContext({ state = 'running' } = {}) {
  const started = [];
  const node = (extra = {}) => ({
    connect() {}, disconnect() {}, start(when) { started.push(when ?? 0); }, stop() {}, ...extra,
  });
  const ctx = {
    started,
    state,
    suspends: 0,
    sampleRate: 44100,
    currentTime: 0,
    destination: node(),
    resume() {
      return new Promise((resolve) => { setTimeout(() => { ctx.state = 'running'; resolve(); }, 0); });
    },
    suspend() { ctx.suspends += 1; ctx.state = 'suspended'; return Promise.resolve(); },
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
    createConvolver: () => node({ buffer: null, normalize: true }),
  };
  return ctx;
}

/**
 * Installs a stub `window.AudioContext` for the app to build its graph on, and returns
 * the list every context it builds is pushed to, plus a function that removes it.
 *
 * @returns {{contexts: any[], restore: () => void}}
 */
export function installStubAudio() {
  const w = /** @type {any} */ (window);
  const before = w.AudioContext;
  const contexts = [];
  w.AudioContext = function StubAudioContext() {
    const ctx = stubContext({ state: 'suspended' });
    contexts.push(ctx);
    return ctx;
  };
  return { contexts, restore: () => { w.AudioContext = before; } };
}
