/**
 * The exhaust note: every firing event computed from the engine, played through the
 * exhaust system computed from the build.
 *
 * Nothing automated can say it sounds right. What these pin down is what made it sound
 * right against recordings of real engines, and keeps it that way: every event lands on
 * the layout's own crank angle at every speed, no two cycles are alike, the stream is
 * continuous, each bank plays through its own exhaust, and what the player changes —
 * the build, the pipes, the tune, the throttle, the key — reaches the note the way it does
 * on a real engine. The exhaust system's own physics is tested in acoustics.test.js.
 */

import { describe, it, expect } from 'vitest';
import { exhaustGeometry } from '../src/sim/acoustics.js';
import {
  createPulseExhaust, setPulseExhaustGeometry, schedulePulseExhaust, tonePulseExhaust,
  silencePulseExhaust, wakePulseExhaust,
} from '../src/ui/audio/pulseExhaust.js';
import { stubContext } from './ui/audioStub.js';

/** A real geometry, so the tests run against the same numbers the app does. */
function geom(over = {}) {
  return exhaustGeometry({
    configuration: 'V8', cyl: 8, displacementL: 5.0, bore: 95, compression: 10.5,
    pipeDiaIn: 3.0, gasTempK: 900, headers: false, turboFitted: false, ...over,
  });
}

/**
 * Build the note on a stub context, recording every buffer it schedules and where to.
 *
 * @returns {{ctx: any, a: Record<string, any>,
 *   played: {at: number, data: Float32Array, into: any}[]}}
 */
function model(g = geom(), key = 'muffled|x') {
  const ctx = stubContext();
  const played = [];
  const make = ctx.createBufferSource;
  ctx.createBufferSource = () => {
    const src = make();
    const start = src.start;
    const connect = src.connect;
    src.connect = (node) => { src.into = node; return connect.call(src, node); };
    src.start = (when) => {
      start.call(src, when);
      if (src.buffer && src.buffer.length < 4096) {
        played.push({ at: when, data: src.buffer.getChannelData(0), into: src.into });
      }
    };
    return src;
  };
  const a = createPulseExhaust(ctx);
  setPulseExhaustGeometry(a, ctx, g, key);
  return { ctx, a, played };
}

/**
 * Run the stream for a while, a frame at a time, and return the events it computed.
 *
 * @returns {{at: number, cylinder: number, evoKpa: number, gapSeconds: number}[]}
 */
function run(m, frame = {}, seconds = 0.3) {
  const before = m.a.log.length ? m.a.log[m.a.log.length - 1] : null;
  for (let t = 0; t < seconds; t += 0.05) {
    schedulePulseExhaust(m.a, m.ctx, {
      rpm: 1500, level: 1, load: 1, audible: true, cranking: false, evoKpa: 350, portKpa: 110,
      lopeSeverity: 0, covPersistence: 0.55, ...frame,
    });
    m.ctx.currentTime += 0.05;
  }
  return m.a.log.filter((e) => !before || e.at > before.at);
}

/** One tone pass. */
function tone(m, frame = {}) {
  tonePulseExhaust(m.a, m.ctx, {
    rpm: 3000, load: 1, richness: 0, knock: 0, cranking: false, catBack: false,
    audible: true, ...frame,
  });
}

const gaps = (events) => events.slice(1).map((e, i) => e.at - events[i].at);
const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
const spread = (g) => (Math.max(...g) - Math.min(...g)) / mean(g);
const sd = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
/** Energy of the rate of change of what went into the exhaust, which is what it radiates. */
const energy = (m, into = null) => m.played
  .filter((p) => (into ? p.into === into : p.into !== m.a.mech))
  .reduce((t, p) => t + p.data.reduce((u, v, i) => u + (i ? (v - p.data[i - 1]) ** 2 : 0), 0), 0);
const toMech = (m) => m.played.filter((p) => p.into === m.a.mech);

describe('the rhythm, which is the layout', () => {
  it('spaces a cross-plane V8 unevenly and an even-firing six evenly', () => {
    const v8 = run(model(geom({ configuration: 'V8' }), 'v8'), { rpm: 1000 }, 0.4);
    const v6 = run(model(geom({ configuration: 'V6', cyl: 6, displacementL: 3.5 }), 'v6'), { rpm: 1000 }, 0.4);
    // A V8's crank puts some events closer together than others; that is its burble. The
    // six's gaps only differ by the few percent a real crank wobbles and its manifold
    // runners differ.
    const logGaps = (events) => events.map((e) => e.gapSeconds);
    expect(spread(logGaps(v8))).toBeGreaterThan(0.2);
    expect(spread(logGaps(v6))).toBeLessThan(0.1);
  });

  it('gives a four far wider gaps than an eight at the same engine speed', () => {
    const i4 = model(geom({ configuration: 'I4', cyl: 4, displacementL: 2 }), 'i4');
    const v8 = model(geom(), 'v8');
    expect(mean(gaps(run(i4, { rpm: 1000 }, 0.5))))
      .toBeGreaterThan(1.7 * mean(gaps(run(v8, { rpm: 1000 }, 0.5))));
  });

  it('computes every event at every speed, with nothing taking over at the top', () => {
    // An earlier version looped one pre-rendered cycle above about 90 events a second,
    // and a loop is what a synthesiser sounds like.
    const m = model(geom({ configuration: 'I6', cyl: 6, displacementL: 3 }), 'i6');
    const events = run(m, { rpm: 6500 }, 0.3);
    expect(events.length).toBeGreaterThan(80);
    expect(mean(events.map((e) => e.gapSeconds))).toBeCloseTo(120 / (6 * 6500), 4);
  });

  it('never plays the same cycle twice', () => {
    const events = run(model(), { rpm: 3000 }, 0.3);
    const cyl0 = events.filter((e) => e.cylinder === 0).map((e) => e.evoKpa);
    expect(cyl0.length).toBeGreaterThan(3);
    expect(new Set(cyl0.map((v) => v.toFixed(3))).size).toBe(cyl0.length);
  });

  it('glides to a new engine speed rather than jumping, so a stepped sweep is smooth', () => {
    // A dyno pull hands the note its measured points about ten times a second.
    const m = model(geom({ configuration: 'I6', cyl: 6, displacementL: 3.0 }), 'glide');
    run(m, { rpm: 3000 }, 0.5);
    const after = run(m, { rpm: 4000 }, 0.3).map((e) => e.gapSeconds);
    const at = (rpm) => 120 / rpm / 6;
    expect(after[0]).toBeLessThan(at(3000) * 1.02);
    expect(after[0]).toBeGreaterThan(at(4000) * 1.05);
    expect(after.at(-1)).toBeLessThan(at(4000) * 1.03);
  });

  it('gives each cylinder a fixed share of its own, the same every time it is built', () => {
    const a = model(geom(), 'a').a.trims;
    const b = model(geom(), 'b').a.trims;
    expect(a).toEqual(b);
    expect(new Set(a.map((v) => v.toFixed(4))).size).toBe(a.length);
    for (const v of a) expect(Math.abs(v - 1)).toBeLessThan(0.2);
  });

  it('plays each bank out as one continuous stream, back to back and ahead of the clock', () => {
    const m = model();
    run(m, { rpm: 2000 }, 0.5);
    for (const path of m.a.banks) {
      const starts = m.played.filter((p) => p.into === path.input).map((p) => p.at);
      expect(starts.length).toBeGreaterThan(5);
      const step = starts[1] - starts[0];
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(step, 9);
      expect(starts[starts.length - 1]).toBeGreaterThan(m.ctx.currentTime);
    }
  });

  it('tops itself up between the app\'s calls, so it never has to run far ahead', async () => {
    // The LIVE tab steps ten times a second; a stream refilled only then would have to
    // queue over a tenth of a second ahead, and the rev would be heard late.
    const m = model();
    const frame = { rpm: 3000, level: 1, load: 1, audible: true, evoKpa: 350, portKpa: 110 };
    for (let i = 0; i < 20; i++) {
      schedulePulseExhaust(m.a, m.ctx, frame);
      m.ctx.currentTime += 0.02;
    }
    expect(m.a.stream.lookahead).toBeCloseTo(0.06, 6);
    const before = m.played.length;
    m.ctx.currentTime += 0.1;
    await new Promise((resolve) => { setTimeout(resolve, 120); });
    expect(m.played.length).toBeGreaterThan(before);
    schedulePulseExhaust(m.a, m.ctx, { rpm: 3000, level: 1, load: 1, audible: false });
    expect(m.a.pumpTimer).toBeNull();
  });

  it('queues just enough further after a stall, and the most once stalls repeat', () => {
    const m = model();
    const frame = { rpm: 3000, level: 1, load: 1, audible: true, evoKpa: 350, portKpa: 110 };
    const call = (dt) => { m.ctx.currentTime += dt; schedulePulseExhaust(m.a, m.ctx, frame); };
    for (let i = 0; i < 20; i++) call(0.02);
    call(0.2); // the page held the thread for 200 ms and the queue ran dry
    expect(m.a.stream.lookahead).toBeGreaterThan(0.2);
    expect(m.a.stream.lookahead).toBeLessThan(0.4);
    for (let i = 0; i < 20; i++) call(0.02);
    call(0.6); // and again, within a few seconds
    expect(m.a.stream.lookahead).toBeCloseTo(0.6, 6);
  });

  it('starts again cleanly after falling behind the clock', () => {
    const m = model();
    run(m, { rpm: 2000 }, 0.2);
    m.ctx.currentTime += 1;
    run(m, { rpm: 2000 }, 0.1);
    expect(m.played[m.played.length - 1].at).toBeGreaterThan(m.ctx.currentTime - 0.1);
  });
});

describe('the pipes', () => {
  it('sends each bank of a V down its own exhaust, and an inline engine down one', () => {
    const v8 = model();
    run(v8);
    expect(v8.a.banks.every((p) => p.live >= 0 && p.slots[p.live].conv.buffer)).toBe(true);
    expect(energy(v8, v8.a.banks[0].input)).toBeGreaterThan(0);
    expect(energy(v8, v8.a.banks[1].input)).toBeGreaterThan(0);
    const i4 = model(geom({ configuration: 'I4', cyl: 4, displacementL: 2 }), 'i4');
    run(i4);
    expect(i4.a.banks[1].live).toBe(-1);
    expect(energy(i4, i4.a.banks[1].input)).toBe(0);
  });

  it('loads the exhaust system computed from the build, not a filter setting', () => {
    const m = model();
    const loaded = m.a.banks[0].slots[m.a.banks[0].live].conv.buffer.getChannelData(0);
    expect(loaded.length).toBeGreaterThan(100);
    expect(Math.max(...loaded.map(Math.abs))).toBeCloseTo(1, 5);
  });

  it('retunes when the gas heats up, fading to the new system rather than cutting', () => {
    const m = model(geom(), 'cool');
    const path = m.a.banks[0];
    const was = path.live;
    setPulseExhaustGeometry(m.a, m.ctx, geom({ gasTempK: 1150 }), 'hot');
    expect(path.live).not.toBe(was);
    expect(path.slots[path.live].gain.gain.targets.at(-1)).toBe(1);
    expect(path.slots[was].gain.gain.targets.at(-1)).toBe(0);
  });

  it('swaps in a straight-through muffler when a cat-back goes on', () => {
    const m = model();
    tone(m, { catBack: false });
    const stock = m.a.banks[0].key;
    tone(m, { catBack: true });
    expect(m.a.catBack).toBe(true);
    expect(m.a.banks[0].key).not.toBe(stock);
  });

  it('damps the pipes as the exhaust flows harder, and leaves them ringing at idle', () => {
    const idle = model(geom(), 'idle');
    run(idle, { rpm: 800, evoKpa: 150, load: 0.1, portKpa: 103 }, 1);
    expect(idle.a.stream.flowStep[0]).toBe(0);
    const full = model(geom(), 'full');
    run(full, { rpm: 6000, evoKpa: 600, load: 1, portKpa: 130 }, 1);
    expect(full.a.stream.flowStep[0]).toBeGreaterThan(3);
    expect(full.a.stream.flowStep[1]).toBeGreaterThan(3);
    expect(full.a.banks[0].key).toMatch(new RegExp(`\\|${full.a.stream.flowStep[0]}$`));
  });

  it('staggers a cast manifold\'s cylinders and lines tuned headers up', () => {
    const cast = model(geom({ headers: false }), 'c');
    const tuned = model(geom({ headers: true }), 't');
    const range = (xs) => Math.max(...xs) - Math.min(...xs);
    expect(range(cast.a.primaryDelays)).toBeGreaterThan(range(tuned.a.primaryDelays));
    expect(range(cast.a.primaryDelays)).toBeGreaterThan(0);
  });

  it('matches every engine on what comes out of its pipes, not on its source', () => {
    // So an engine whose exhaust takes more off — a turbine, here — is brought up by what
    // it loses rather than left quieter, and a V8 and a four are equally present. What
    // differs between them is the note. The match is computed, not measured at random.
    const na = model(geom(), 'na');
    const turbo = model(geom({ turboFitted: true }), 'turbo');
    expect(turbo.a.norm).toBeGreaterThan(na.a.norm);
    const again = model(geom(), 'na2');
    expect(again.a.norm).toBe(na.a.norm);
    for (const m of [na, turbo, model(geom({ configuration: 'I4', cyl: 4, displacementL: 2 }), 'i4')]) {
      expect(Number.isFinite(m.a.norm) && m.a.norm > 0).toBe(true);
    }
  });
});

describe('what the engine is doing', () => {
  it('hits harder from a harder-run cylinder', () => {
    const light = model();
    const heavy = model();
    run(light, { evoKpa: 150, load: 0.1 });
    run(heavy, { evoKpa: 450, load: 1 });
    expect(energy(heavy)).toBeGreaterThan(energy(light));
  });

  it('drops away on a lift, rather than being turned back up', () => {
    const m = model();
    run(m, { rpm: 5000, evoKpa: 450 }, 1);
    const before = energy(m);
    m.played.length = 0;
    run(m, { rpm: 5000, evoKpa: 48, load: 0 }, 1);
    expect(energy(m)).toBeLessThan(before / 4);
    expect(energy(m)).toBeGreaterThan(0);
  });

  it('burns nothing on a fuel cut, so nothing scatters and nothing misfires', () => {
    const events = run(model(), { rpm: 4000, evoKpa: 48, load: 0, cut: true, lopeSeverity: 0.5 }, 1);
    const byCylinder = new Map();
    for (const e of events) byCylinder.set(e.cylinder, [...(byCylinder.get(e.cylinder) ?? []), e.evoKpa]);
    for (const evos of byCylinder.values()) expect(sd(evos)).toBeLessThan(1e-9);
  });

  it('keeps time at speed: a strong cycle barely moves a fast crank', () => {
    // The flywheel carries energy as the square of engine speed, so the same scatter that
    // makes an idle stumble leaves a fast engine's rhythm almost exact.
    const inline = geom({ configuration: 'I6', cyl: 6, displacementL: 3.0 });
    const jitter = (rpm) => {
      const g = run(model(inline, `i6-${rpm}`), { rpm, load: 0.1, evoKpa: 200 }, 1.5)
        .map((e) => e.gapSeconds);
      return sd(g) / mean(g);
    };
    expect(jitter(4000)).toBeLessThan(jitter(800) / 5);
  });

  it('lets a lift fall away rather than pulling it straight back up', () => {
    const m = model();
    run(m, { rpm: 6000, evoKpa: 600, load: 1, portKpa: 130 }, 1);
    run(m, { rpm: 5000, evoKpa: 110, load: 0.05, portKpa: 104 }, 1);
    expect(m.a.stream.gain).toBeLessThanOrEqual(m.a.norm + 1e-9);
    // At idle it is brought up as usual.
    run(m, { rpm: 850, evoKpa: 110, load: 0.05, portKpa: 104 }, 1.5);
    expect(m.a.stream.gain).toBeGreaterThan(m.a.norm * 2);
  });

  it('settles a lift into the idle rather than dipping under it', () => {
    // A closed throttle at 3000 rpm pumps a motored cylinder out, and its pulses reach the
    // source only some 12 dB over an idle's. Held to the coasting ceiling while the idle is
    // brought up by the follower, it came out under the idle it was coming down to, and
    // then swelled back up into it. Measured as the follower measures it: the source's
    // level against the reference, times the gain it was given.
    const out = (m) => (m.a.stream.envelope * m.a.stream.gain) / m.a.norm;
    const idle = model();
    run(idle, { rpm: 900, evoKpa: 48, load: 0.05, portKpa: 105 }, 2);
    const lift = model();
    run(lift, { rpm: 6000, evoKpa: 450, load: 1, portKpa: 130 }, 1);
    run(lift, { rpm: 3000, evoKpa: 48, load: 0.03, portKpa: 106 }, 2);
    expect(out(lift)).toBeGreaterThanOrEqual(out(idle) * 0.95);
  });

  it('scatters more at light load than wide open', () => {
    const idle = run(model(), { rpm: 900, load: 0.1 }, 1.5).map((e) => e.evoKpa);
    const wot = run(model(), { rpm: 900, load: 1 }, 1.5).map((e) => e.evoKpa);
    expect(sd(idle) / mean(idle)).toBeGreaterThan(sd(wot) / mean(wot));
  });

  it('lopes with a big cam at idle and not with a stock one', () => {
    const stock = run(model(), { rpm: 800, load: 0.1, lopeSeverity: 0 }, 1.5).map((e) => e.evoKpa);
    const cam = run(model(), { rpm: 800, load: 0.1, lopeSeverity: 0.5 }, 1.5).map((e) => e.evoKpa);
    expect(sd(cam) / mean(cam)).toBeGreaterThan(2 * (sd(stock) / mean(stock)));
  });

  it('rattles when it knocks, and is clean when it does not', () => {
    const m = model();
    tone(m, { load: 1, knock: 0 });
    expect(m.a.noiseGain.gain.value).toBe(0);
    tone(m, { load: 1, knock: 1 });
    expect(m.a.noiseGain.gain.value).toBeGreaterThan(0);
  });

  it('lifts its own gains when the stream starts again after being silenced', () => {
    const m = model();
    run(m);
    silencePulseExhaust(m.a, m.ctx);
    expect(m.a.bus.gain.value).toBe(0);
    run(m, { rpm: 900 }, 0.1);
    expect(m.a.bus.gain.value).toBeGreaterThan(0);
    expect(m.a.mech.gain.value).toBeGreaterThan(0);
  });

  it('is silent below cranking speed, when not audible, and when silenced', () => {
    const still = model();
    expect(run(still, { rpm: 0 })).toHaveLength(0);
    expect(still.played).toHaveLength(0);
    expect(run(model(), { audible: false })).toHaveLength(0);
    const m = model();
    run(m);
    silencePulseExhaust(m.a, m.ctx);
    expect(m.a.bus.gain.value).toBe(0);
    expect(m.a.stream.head).toBe(-1);
    wakePulseExhaust(m.a, m.ctx);
    expect(m.a.bus.gain.value).toBeGreaterThan(0);
  });

  it('survives a non-finite number instead of throwing and killing every layer', () => {
    const m = model();
    expect(() => {
      run(m, { rpm: NaN, level: NaN });
      run(m, { evoKpa: NaN, portKpa: NaN, load: NaN, lopeSeverity: NaN });
      run(m, { cranking: true, rpm: NaN });
      tone(m, { rpm: NaN, load: NaN });
    }).not.toThrow();
    for (const p of m.played) for (const v of p.data) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('starting', () => {
  const crank = { rpm: 260, cranking: true, evoKpa: 101, load: 0 };

  it('runs the starter while cranking, and not while running', () => {
    const cranking = model();
    run(cranking, crank, 0.5);
    expect(toMech(cranking).length).toBeGreaterThan(5);
    const running = model();
    run(running, { rpm: 900 }, 0.5);
    expect(toMech(running)).toHaveLength(0);
  });

  it('surges against every compression, so the whine rises and falls', () => {
    // A four cranking at 260 rpm comes up on compression 8.7 times a second, and the
    // starter labours on each: the whine's level swings at that rate.
    const m = model(geom({ configuration: 'I4', cyl: 4, displacementL: 2 }), 'i4');
    run(m, crank, 1.2);
    const x = toMech(m).slice(4).flatMap((p) => Array.from(p.data));
    const win = 441;
    const env = [];
    for (let i = 0; i + win <= x.length; i += win) {
      env.push(Math.sqrt(x.slice(i, i + win).reduce((t, v) => t + v * v, 0) / win));
    }
    const at = (hz) => {
      let re = 0; let im = 0;
      const m0 = mean(env);
      env.forEach((v, i) => { re += (v - m0) * Math.cos(2 * Math.PI * hz * i / 100); im += (v - m0) * Math.sin(2 * Math.PI * hz * i / 100); });
      return Math.hypot(re, im);
    };
    const surge = (260 / 60) * 2;
    expect(at(surge)).toBeGreaterThan(3 * at(surge * 2.6));
  });

  it('lets go of the starter once the engine catches, and it spins down', () => {
    const m = model();
    run(m, crank, 0.4);
    run(m, { rpm: 900 }, 1.2);
    const tail = toMech(m).slice(-3);
    const level = (p) => Math.max(...p.data.map(Math.abs));
    expect(tail.length === 0 || level(tail[tail.length - 1]) < 0.01).toBe(true);
    expect(m.a.stream.starter).toBeLessThan(0.01);
  });
});
