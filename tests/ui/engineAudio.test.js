/**
 * Engine audio graph tests, against a stub AudioContext.
 *
 * The point is not to check that it sounds good — nothing automated can, and the exhaust
 * model's own acoustics are measured in tests/pulseExhaust.test.js. It is to check
 * that the graph stays HONEST to what it is handed: that the tube network is rebuilt when
 * and only when the build changes, that it adds no level curve of its own, and that
 * "stop" really does stop.
 *
 * The last one is the reason this file exists at all. A parked gain from a scheduled
 * ramp is silent in every unit test and screaming in the browser.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acousticDrive, deriveEngine, exhaustGeometry, DEFAULT_ENGINE_CONFIG, DEFAULT_MODS,
  BARO_KPA, COMPRESSOR_OPTS, TURBINE_OPTS, OCTANE_OPTS, DEFAULT_VE, interp2,
  evaluatePoint } from '../../src/sim/index.js';
import { createEngineAudio, geometryKey, setEngineAudioActive, shiftEngineAudio,
  silenceEngineAudio, updateEngineAudio, wakeEngineAudio } from '../../src/ui/audio/engineAudio.js';
import { stubContext } from './audioStub.js';

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
    drive: acousticDrive({ rpm, derived, point: pt }),
    rpm, configuration, load: 1, audible: true, cut: false, cranking: false,
    geometry: exhaustGeometry({
      displacementL: derived.displacementL, cyl: derived.cyl, bore: DEFAULT_ENGINE_CONFIG.bore,
      compression: DEFAULT_ENGINE_CONFIG.compression, configuration,
      pipeDiaIn: 2.5, gasTempK: pt.egt + 273.15,
    }),
    openExhaust: false, intakeFitted: false, boostPsi: 0,
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

  it('follows the throttle, not the revs, the way the reference build did', () => {
    // Open the throttle and the engine gets louder; rev it with the throttle where it is
    // and the level does not move — the pulses and the pipe carry that.
    push(frameFor({ rpm: 4500, load: 1 }));
    const wot = graph.master.gain.value;
    push(frameFor({ rpm: 800, load: 1 }));
    expect(graph.master.gain.value).toBe(wot);
    push(frameFor({ rpm: 800, load: 0.1 }));
    expect(graph.master.gain.value).toBeLessThan(wot);
  });

  it('opens far enough from idle to full throttle to survive the limiter', () => {
    // The limiter takes 12 dB for every 1 over its threshold, so a small spread in front
    // of it is no spread at all out of it: at 5 dB, measured in the app, idle and wide open
    // came out of the speaker 1.5 dB apart. Idle has to sit under the threshold.
    push(frameFor({ rpm: 850, load: 0.12 }));
    const idle = graph.master.gain.value;
    push(frameFor({ rpm: 850, load: 1 }));
    expect(20 * Math.log10(graph.master.gain.value / idle)).toBeGreaterThan(12);
  });

  it('holds its level on the rev limiter, where the throttle is still wide open', () => {
    // The cut already reaches the note through the pulses: `acousticDrive` hands over a
    // motored cylinder. Turning the whole engine down on top of that put the limiter
    // below idle.
    push(frameFor({ load: 1 }));
    const firing = graph.master.gain.value;
    push(frameFor({ load: 1, cut: true }));
    expect(graph.master.gain.value).toBe(firing);
  });

  it('puts an overrun cut at the closed-throttle level, not under it', () => {
    push(frameFor({ load: 0.05 }));
    const closed = graph.master.gain.value;
    push(frameFor({ load: 0.05, cut: true }));
    expect(graph.master.gain.value).toBe(closed);
    expect(graph.master.gain.value).toBeGreaterThan(0);
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
  it('limits the way the reference build did, then saturates instead of clipping', () => {
    // The reference's limiter — low threshold, hard ratio, fast attack — is part of its
    // sound: dense and loud like a recorded engine. What it must never do is let a pulse
    // reach the output hard-clipped, which is heard as a tearing edge. The stage after
    // the make-up gain is a tanh curve scaled below full scale, so no input can reach it.
    const ctx = stubContext();
    const a = createEngineAudio(ctx);
    ctx.currentTime += 0.1;
    updateEngineAudio(a, frameFor({ rpm: 6000, load: 1 }));
    expect(a.limiter.threshold.value).toBe(-14);
    expect(a.limiter.ratio.value).toBe(12);
    expect(a.limiter.attack.value).toBeLessThan(0.01);
    const curve = a.softClip.curve;
    expect(Math.max(...curve.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(a.satOut.gain.value).toBeLessThan(1);
  });
});

describe('when the tube network is rebuilt', () => {
  const V6 = {
    displacementL: 3.5, cyl: 6, bore: 95.5, compression: 10.3, configuration: 'V6',
    pipeDiaIn: 2.5, gasTempK: 1050,
  };
  const key = (overrides) => geometryKey(exhaustGeometry({ ...V6, ...overrides }), false);

  it('rebuilds when a turbine is fitted, because the converter section absorbs more', () => {
    // A hand-picked key of lengths and areas missed this: a turbine moves no length and
    // no area, so fitting one never reached the audio thread.
    expect(key({ turboFitted: true })).not.toBe(key({}));
  });

  it('rebuilds when the compression ratio changes, because the clearance volume does', () => {
    expect(key({ compression: 12.5 })).not.toBe(key({}));
  });

  it('does not rebuild for exhaust temperature wandering inside one step', () => {
    expect(key({ gasTempK: 1060 })).toBe(key({ gasTempK: 1050 }));
    expect(key({ gasTempK: 1150 })).not.toBe(key({ gasTempK: 1050 }));
  });
});

describe('a gearchange', () => {
  it('owns the master gain until it has finished, so a frame cannot fill in its gap', () => {
    const ctx = stubContext();
    const graph = createEngineAudio(ctx);
    ctx.currentTime = 1;
    updateEngineAudio(graph, frameFor());
    const written = graph.master.gain.targets.length;

    shiftEngineAudio(graph, { automatic: false });
    ctx.currentTime = 1.1;
    updateEngineAudio(graph, frameFor());
    expect(graph.master.gain.targets.length).toBe(written);

    ctx.currentTime = 1.4;
    updateEngineAudio(graph, frameFor());
    expect(graph.master.gain.targets.length).toBe(written + 1);
  });
});

describe('sleeping', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('suspends the context shortly after nothing is sounding, and silences it at once', () => {
    const ctx = stubContext();
    const graph = createEngineAudio(ctx);
    ctx.currentTime = 0.5;
    updateEngineAudio(graph, frameFor());

    setEngineAudioActive(graph, false);
    expect(graph.master.gain.value).toBe(0);
    expect(ctx.state).toBe('running');
    vi.advanceTimersByTime(1000);
    expect(ctx.state).toBe('suspended');
  });

  it('does not suspend if something starts sounding inside the grace period', () => {
    const ctx = stubContext();
    const graph = createEngineAudio(ctx);
    setEngineAudioActive(graph, false);
    setEngineAudioActive(graph, true);
    vi.advanceTimersByTime(1000);
    expect(ctx.suspends).toBe(0);
  });

  it('brings the exhaust back when an engine starts again after a stop', () => {
    // Stopping pins the exhaust's bus to zero. Switching engines always stops the one
    // running, and without lifting the bus on the way back every engine after the first
    // came back near-silent — the V6 included.
    const ctx = stubContext();
    const graph = createEngineAudio(ctx);
    setEngineAudioActive(graph, true);
    setEngineAudioActive(graph, false);
    expect(graph.exhaust.bus.gain.value).toBe(0);
    setEngineAudioActive(graph, true);
    expect(graph.exhaust.bus.gain.value).toBeGreaterThan(0);
  });

  it('wakes for a one-off sound and goes back to sleep after it', async () => {
    const ctx = stubContext({ state: 'suspended' });
    const graph = createEngineAudio(ctx);
    const woke = wakeEngineAudio(graph, 0.45);
    vi.advanceTimersByTime(1);
    await woke;
    expect(ctx.state).toBe('running');
    vi.advanceTimersByTime(2000);
    expect(ctx.state).toBe('suspended');
  });
});
