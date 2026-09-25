/**
 * Acoustics intent tests.
 *
 * Same rule as `physics.test.js`: assert on DIRECTION and RELATIONSHIP, not on
 * magnitudes. What matters is that the sound model stays wired to the engine — that a
 * harder-run engine produces a harder pulse, that a hotter pipe rings higher, and that
 * the cross-plane V8's rhythm is a consequence of its crank rather than a chosen
 * pattern. Exact frequencies are a voicing decision and will move.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

const STOCK = S.DEFAULT_ENGINE_CONFIG;
const NO_MODS = { ...S.DEFAULT_MODS, turboFitted: false };

/** One operating point on a stock V6, overridable per test. */
function point(overrides = {}) {
  const {
    cfg = STOCK, rpm = 5500, mapKpa = S.BARO_KPA, boostPsi = 0,
    timingVal = 30, afrCommanded = 12.6, mods = NO_MODS,
  } = overrides;
  const derived = S.deriveEngine(cfg);
  return {
    derived,
    pt: S.evaluatePoint({
      rpm, mapKpa, boostPsi, veVal: S.interp2(S.DEFAULT_VE, rpm, mapKpa),
      timingVal, afrCommanded, fuel: S.OCTANE_OPTS[0], mods,
      mafScalar: 1, mafErrorBase: 1, injectorCc: 550, ecuInjectorCc: 550,
      derived, compressor: S.COMPRESSOR_OPTS[1], turbine: S.TURBINE_OPTS[1],
    }),
  };
}

/** The full drive for one point. */
function drive(overrides = {}) {
  const cfg = overrides.cfg ?? STOCK;
  const rpm = overrides.rpm ?? 5500;
  const turboOn = overrides.turboOn ?? false;
  const { derived, pt } = point({ ...overrides, cfg, rpm });
  return S.acousticDrive({
    rpm, derived, point: pt, turboOn, compressor: S.COMPRESSOR_OPTS[1],
  });
}

describe('firing geometry', () => {
  it('gives every layout one event per cylinder, in ascending crank order', () => {
    for (const { config, cyl } of [
      { config: 'I4', cyl: 4 }, { config: 'I6', cyl: 6 },
      { config: 'V6', cyl: 6 }, { config: 'V8', cyl: 8 },
    ]) {
      const events = S.firingEvents(config);
      expect(events).toHaveLength(cyl);
      events.forEach((e, i) => {
        expect(e.angleDeg).toBeGreaterThanOrEqual(i === 0 ? 0 : events[i - 1].angleDeg);
        expect(e.angleDeg).toBeLessThan(720);
      });
    }
  });

  it('spaces every layout but the cross-plane V8 evenly at the tailpipe', () => {
    const gapsOf = (config) => {
      const ev = S.firingEvents(config);
      return ev.map((e, i) => ((ev[(i + 1) % ev.length].angleDeg - e.angleDeg + 720) % 720) || 720);
    };
    for (const config of ['I4', 'I6', 'V6']) {
      const gaps = gapsOf(config);
      gaps.forEach((g) => expect(g).toBeCloseTo(720 / gaps.length, 6));
    }
  });

  it('PAIRS a cross-plane V8 at the tailpipe — this is the rumble', () => {
    // Both banks interleave to an even 90 degrees, so if their collectors delivered at the
    // same instant the ear would hear an even train and a V8 would not sound like one.
    // The offset between the two pairs the pulses up.
    const ev = S.firingEvents('V8');
    const gaps = ev.map((e, i) => ((ev[(i + 1) % ev.length].angleDeg - e.angleDeg + 720) % 720) || 720);
    const norm = gaps.map((g) => g / 90);
    expect(Math.max(...norm)).toBeGreaterThan(1.2);
    expect(Math.min(...norm)).toBeLessThan(0.8);
    expect(gaps.reduce((a, b) => a + b, 0)).toBeCloseTo(720, 6);
  });

  it('fires a cross-plane V8 UNEVENLY within each bank — which is the rumble', () => {
    const intervals = S.bankFiringIntervalsDeg('V8', 0);
    expect(intervals).toEqual([180, 270, 180, 90]);
    expect(new Set(intervals).size).toBeGreaterThan(1);
  });

  it('fires every other layout evenly within its bank, which is why none of them rumble', () => {
    for (const config of ['I4', 'I6', 'V6']) {
      const intervals = S.bankFiringIntervalsDeg(config, 0);
      expect(new Set(intervals).size).toBe(1);
    }
  });

  it('accounts for all 720 degrees in every bank', () => {
    for (const config of ['I4', 'I6', 'V6', 'V8']) {
      for (const bank of [0, 1]) {
        const intervals = S.bankFiringIntervalsDeg(config, bank);
        if (intervals.length === 0) continue;
        expect(intervals.reduce((a, b) => a + b, 0)).toBeCloseTo(720, 6);
      }
    }
  });

  it('puts an inline engine\'s cylinders all in one bank and a V\'s in two', () => {
    expect(S.bankFiringIntervalsDeg('I6', 1)).toHaveLength(0);
    expect(S.bankFiringIntervalsDeg('V6', 1)).toHaveLength(3);
    expect(S.bankFiringIntervalsDeg('V8', 1)).toHaveLength(4);
  });
});

describe('the exhaust system', () => {
  it('carries sound faster when the gas in it is hotter', () => {
    expect(S.soundSpeedMs(1100, S.COEFF.GAMMA_BURNED))
      .toBeGreaterThan(S.soundSpeedMs(600, S.COEFF.GAMMA_BURNED));
  });

  it('is longer on a bigger engine, which goes in a bigger car', () => {
    expect(S.exhaustLengthM({ displacementL: 6.2, pipeDiaIn: 2.5 }))
      .toBeGreaterThan(S.exhaustLengthM({ displacementL: 2.0, pipeDiaIn: 2.5 }));
  });

  it('adds an end correction, so a wider pipe measures acoustically longer', () => {
    expect(S.exhaustLengthM({ displacementL: 3.5, pipeDiaIn: 3.5 }))
      .toBeGreaterThan(S.exhaustLengthM({ displacementL: 3.5, pipeDiaIn: 2.0 }));
  });
});

describe('cylinder pressure at valve opening', () => {
  // Each exhaust event's whole excitation: the valve opens between this and the pipe, and an
  // orifice decides what flows.
  const CRITICAL = Math.pow(
    (S.COEFF.GAMMA_BURNED + 1) / 2, S.COEFF.GAMMA_BURNED / (S.COEFF.GAMMA_BURNED - 1),
  );

  it('is past the choked ratio at wide-open throttle — which is why a hard-run engine cracks', () => {
    const { pt } = point({ rpm: 5500, mapKpa: S.BARO_KPA });
    expect(drive({ rpm: 5500, mapKpa: S.BARO_KPA }).evoKpa / pt.emp).toBeGreaterThan(CRITICAL);
  });

  it('is higher with boost, because there is more charge to burn', () => {
    const na = drive({ rpm: 4500, mapKpa: S.BARO_KPA, timingVal: 26 });
    const boosted = drive({
      rpm: 4500, mapKpa: 184, boostPsi: 12, timingVal: 18, afrCommanded: 12.2,
      mods: { ...S.DEFAULT_MODS, turboFitted: true },
    });
    expect(boosted.evoKpa).toBeGreaterThan(na.evoKpa);
  });

  it('is motored pressure on a fuel cut, whatever the point says', () => {
    const { derived, pt } = point({ rpm: 7000, mapKpa: S.BARO_KPA });
    const cut = S.acousticDrive({ rpm: 7000, derived, point: pt, fuelCut: true });
    expect(cut.evoKpa).toBe(S.ACOUSTIC.MOTORED_EVO_KPA);
  });

  it('scales a borrowed wide-open point with throttle, and never drops below motored', () => {
    const { derived, pt } = point({ rpm: 3000, mapKpa: S.BARO_KPA });
    const at = (throttle) => S.acousticDrive({ rpm: 3000, derived, point: pt, throttle }).evoKpa;
    expect(at(0.5)).toBeLessThan(at(1));
    expect(at(0)).toBe(S.ACOUSTIC.MOTORED_EVO_KPA);
  });
});

describe('exhaust enthalpy flux', () => {
  it('rises with airflow and with gas temperature independently', () => {
    const base = S.exhaustPowerW({ mafGps: 150, egtC: 850 });
    expect(S.exhaustPowerW({ mafGps: 200, egtC: 850 })).toBeGreaterThan(base);
    expect(S.exhaustPowerW({ mafGps: 150, egtC: 950 })).toBeGreaterThan(base);
  });

  it('is zero when nothing is flowing', () => {
    expect(S.exhaustPowerW({ mafGps: 0, egtC: 850 })).toBe(0);
  });

  it('rises when spark is retarded, at unchanged airflow', () => {
    // Burning later leaves more of the heat in the exhaust instead of on the piston.
    // This is the path by which a spark change reaches the sound at all.
    const at = (timingVal) => {
      const { pt } = point({ rpm: 4500, mapKpa: S.BARO_KPA, timingVal });
      return S.exhaustPowerW({ mafGps: pt.maf, egtC: pt.egt });
    };
    expect(at(12)).toBeGreaterThan(at(30));
  });

  it('spans idle to redline over most of its range', () => {
    const idle = drive({ rpm: 850, mapKpa: 35, timingVal: 14, afrCommanded: 13.5 });
    const wot = drive({ rpm: 6500, mapKpa: S.BARO_KPA, timingVal: 26 });
    expect(idle.exhaustDrive).toBeLessThan(0.1);
    expect(wot.exhaustDrive).toBeGreaterThan(0.7);
  });
});

describe('cycle-to-cycle variation', () => {
  it('is FLAT ZERO on a stock cam — a smooth idle must render smooth', () => {
    const stock = S.cyclicVariation({ rpm: 850, overlapDeg: 0 });
    expect(stock.severity).toBe(0);
  });

  it('rises with valve overlap, which is what opens the window for dilution', () => {
    const mild = S.cyclicVariation({ rpm: 850, overlapDeg: 11 });
    const wild = S.cyclicVariation({ rpm: 850, overlapDeg: 44 });
    expect(wild.severity).toBeGreaterThan(mild.severity);
  });

  it('washes out as revs rise, because there is no time left to wander', () => {
    const idle = S.cyclicVariation({ rpm: 850, overlapDeg: 44 });
    const revving = S.cyclicVariation({ rpm: 2400, overlapDeg: 44 });
    expect(revving.severity).toBeLessThan(idle.severity);
  });

  it('carries memory from one cycle to the next', () => {
    // A weak cycle leaves more residual, so the next one is diluted too. Without this
    // the renderer produces white noise on the pulse amplitudes, which fizzes.
    expect(S.ACOUSTIC.COV_PERSISTENCE).toBeGreaterThan(0);
    expect(S.ACOUSTIC.COV_PERSISTENCE).toBeLessThan(1);
    expect(drive({ rpm: 850, mapKpa: 40 }).covPersistence).toBe(S.ACOUSTIC.COV_PERSISTENCE);
  });

  it('lopes a big cam and leaves a small one alone', () => {
    const cam = (duration) => {
      const cfg = { ...STOCK, configuration: 'V8', camDuration: duration };
      return drive({ cfg, rpm: 850, mapKpa: 40, timingVal: 14, afrCommanded: 13.5 }).lopeSeverity;
    };
    expect(cam(200)).toBe(0);
    expect(cam(270)).toBeGreaterThan(0.2);
  });
});

describe('turbocharger', () => {
  it('needs more tip speed for more boost', () => {
    const low = S.compressorTipSpeedMs({ boostPsi: 5, inletK: 310 });
    const high = S.compressorTipSpeedMs({ boostPsi: 20, inletK: 310 });
    expect(high).toBeGreaterThan(low);
  });

  it('sizes a wheel from choke flow, and lands in the range real wheels occupy', () => {
    for (const compressor of S.COMPRESSOR_OPTS) {
      const mm = S.compressorWheelDiameterM(compressor) * 1000;
      expect(mm).toBeGreaterThan(30);
      expect(mm).toBeLessThan(90);
    }
  });

  it('spins a small turbo faster than a big one for the same boost', () => {
    const small = S.turboAcoustics({ compressor: S.COMPRESSOR_OPTS[0], boostPsi: 12, inletK: 320 });
    const large = S.turboAcoustics({ compressor: S.COMPRESSOR_OPTS[2], boostPsi: 12, inletK: 320 });
    expect(small.shaftRpm).toBeGreaterThan(large.shaftRpm);
    expect(small.whistleHz).toBeGreaterThan(large.whistleHz);
  });

  it('puts the whistle somewhere a person can hear it', () => {
    for (const compressor of S.COMPRESSOR_OPTS) {
      for (const boostPsi of [3, 10, 20]) {
        const { whistleHz } = S.turboAcoustics({ compressor, boostPsi, inletK: 320 });
        expect(whistleHz).toBeGreaterThan(300);
        expect(whistleHz).toBeLessThan(6000);
      }
    }
  });

  it('is silent when no turbo is fitted', () => {
    const d = drive({ rpm: 5500 });
    expect(d.whistleHz).toBe(0);
    expect(d.shaftRpm).toBe(0);
  });
});

describe('the drive handed to the renderer', () => {
  it('is finite everywhere across the operating envelope', () => {
    for (const configuration of S.CONFIG_OPTS) {
      for (const rpm of [800, 2500, 4500, 7000]) {
        for (const mapKpa of [30, 60, S.BARO_KPA, 200]) {
          const cfg = { ...STOCK, configuration };
          const d = drive({ cfg, rpm, mapKpa, timingVal: 18, afrCommanded: 13 });
          for (const [key, value] of Object.entries(d)) {
            expect(Number.isFinite(value), `${configuration} ${rpm}/${mapKpa} ${key}`).toBe(true);
          }
        }
      }
    }
  });

  it('says nothing is happening when the engine is not running', () => {
    const d = S.acousticDrive({
      rpm: 0, derived: S.deriveEngine(STOCK), point: null,
    });
    expect(d.evoKpa).toBe(S.BARO_KPA);
    expect(d.exhaustDrive).toBe(0);
    expect(d.whistleHz).toBe(0);
  });
});

describe('one exhaust event', () => {
  const geom = (over = {}) => S.exhaustGeometry({
    configuration: 'V8', cyl: 8, displacementL: 5.0, bore: 95, compression: 10.5,
    pipeDiaIn: 3.0, gasTempK: 1000, ...over,
  });
  /** @param {{geometry?: object, evoKpa?: number, rpm?: number}} [args] */
  const event = ({ geometry, ...over } = {}) => S.exhaustEvent({
    geometry: geom(geometry), evoKpa: 400, rpm: 3000, sampleRate: 44100, ...over,
  });
  const peak = (xs) => Math.max(...xs);
  const massG = (flow) => flow.reduce((t, q) => t + q, 0) / 44100 * 1000;

  it('never lets out more gas than was in the cylinder', () => {
    const g = geom();
    const vEvo = S.cylinderVolumeM3(g.evoDeg, g.clearanceM3, g.sweptM3, g.rodRatio);
    const heldG = ((400e3 * vEvo) / (S.R_AIR * g.cylinderK)) * 1000;
    const out = massG(event().flow);
    expect(out).toBeGreaterThan(0.5 * heldG);
    expect(out).toBeLessThan(heldG);
  });

  it('blows down harder from a harder-run cylinder', () => {
    expect(peak(event({ evoKpa: 450 }).flow)).toBeGreaterThan(peak(event({ evoKpa: 180 }).flow));
  });

  it('is quicker at speed, but spread over more of the crank, because gas takes time', () => {
    // The valve opens along a flank fixed in crank degrees, so a faster engine opens it in
    // less time and the event is sharper. But the gas leaves at the speed it can, not at
    // the crank's, so the blowdown takes up more degrees the faster the engine turns —
    // which is why a header's timing matters more at the top end.
    const rise = (rpm) => {
      const { flow } = event({ rpm });
      return flow.indexOf(peak(flow)) / 44100;
    };
    expect(rise(6000)).toBeLessThan(rise(3000));
    expect(rise(6000) * 6000).toBeGreaterThan(rise(3000) * 3000);
  });

  it('pulls gas back in first on a closed throttle, and is far weaker for it', () => {
    const cut = event({ evoKpa: S.ACOUSTIC.MOTORED_EVO_KPA });
    expect(Math.min(...cut.flow)).toBeLessThan(0);
    expect(peak(cut.flow)).toBeLessThan(0.3 * peak(event().flow));
  });

  it('chokes the jet through the seat while the pressure ratio is high', () => {
    expect(peak(event({ evoKpa: 450 }).jet)).toBe(1);
    expect(peak(event({ evoKpa: 130 }).jet)).toBeLessThan(1);
  });

  it('flows smoothly once the piston is pushing, rather than chattering', () => {
    // A step-by-step on-off at equilibrium would be a whine at half the sample rate.
    for (const rpm of [800, 3000, 6500]) {
      const { flow } = event({ rpm, evoKpa: 180 });
      let flips = 0;
      for (let i = 1; i < flow.length; i++) {
        if (Math.sign(flow[i]) !== Math.sign(flow[i - 1]) && Math.abs(flow[i]) > 1e-6) flips++;
      }
      expect(flips, `${rpm} rpm`).toBeLessThan(6);
    }
  });

  it('gives a bigger bore a bigger valve and a bigger blowdown', () => {
    expect(peak(event({ geometry: { bore: 104 } }).flow))
      .toBeGreaterThan(peak(event({ geometry: { bore: 86 } }).flow));
  });

  it('ends at nothing when the valve shuts', () => {
    const { flow } = event();
    expect(Math.abs(flow[flow.length - 1])).toBeLessThan(0.02 * peak(flow));
  });
});

describe('combustion scatter', () => {
  it('is always there, a little, and more at light load', () => {
    expect(S.combustionScatter(1)).toBeGreaterThan(0);
    expect(S.combustionScatter(0.1)).toBeGreaterThan(S.combustionScatter(1));
  });

  it('grows with a lumpy cam on top', () => {
    expect(S.combustionScatter(0.2, 0.4)).toBeGreaterThan(S.combustionScatter(0.2, 0));
  });

  it('puts more back pressure in the port the harder the engine runs', () => {
    expect(drive({ rpm: 6000 }).portKpa).toBeGreaterThan(drive({ rpm: 1500, mapKpa: 40 }).portKpa);
    expect(drive({ rpm: 1500, mapKpa: 40 }).portKpa).toBeGreaterThan(S.BARO_KPA);
  });
});

describe('the exhaust system\'s response', () => {
  const geom = (over = {}) => S.exhaustGeometry({
    configuration: 'V8', cyl: 8, displacementL: 5.0, bore: 95, compression: 10.5,
    pipeDiaIn: 3.0, gasTempK: 1000, ...over,
  });
  const ir = (over = {}, opts = {}) => S.exhaustImpulseResponse(geom(over), 44100, opts);
  /** When the pulse first comes out of the tailpipe, in samples. */
  const arrival = (x) => x.findIndex((v) => Math.abs(v) > 0.1);
  /** Treble against the whole: the first difference's energy over the signal's. */
  const brightness = (x) => {
    let d = 0; let e = 0;
    for (let i = 1; i < x.length; i++) { d += (x[i] - x[i - 1]) ** 2; e += x[i] * x[i]; }
    return d / e;
  };

  it('is finite, peaks at one, and dies away', () => {
    const x = ir();
    expect(x.every(Number.isFinite)).toBe(true);
    expect(Math.max(...x.map(Math.abs))).toBeCloseTo(1, 6);
    const total = x.reduce((t, v) => t + v * v, 0);
    const tail = x.slice(Math.floor(x.length * 0.9)).reduce((t, v) => t + v * v, 0);
    expect(tail / total).toBeLessThan(0.01);
    expect(x.length / 44100).toBeLessThanOrEqual(S.ACOUSTIC.IR_MAX_SECONDS);
  });

  it('takes longer to come out of a longer system, and sooner through hotter gas', () => {
    expect(arrival(ir({ displacementL: 6.5 }))).toBeGreaterThan(arrival(ir({ displacementL: 2.0 })));
    expect(arrival(ir({ gasTempK: 1200 }))).toBeLessThan(arrival(ir({ gasTempK: 700 })));
  });

  it('runs one bank of a V a little further than the other', () => {
    expect(arrival(ir({}, { bank: 1 }))).toBeGreaterThan(arrival(ir({}, { bank: 0 })));
  });

  it('lets more treble out through a straight-through cat-back', () => {
    expect(brightness(ir({}, { catBack: true }))).toBeGreaterThan(brightness(ir()));
  });

  it('takes the top end off with a turbine in the path', () => {
    expect(brightness(ir({ turboFitted: true }))).toBeLessThan(brightness(ir()));
  });

  it('changes with the tailpipe it is given', () => {
    const narrow = ir({ pipeDiaIn: 2.25 });
    const wide = ir({ pipeDiaIn: 3.5 });
    expect(Array.from(narrow)).not.toEqual(Array.from(wide));
  });

  it('stops ringing when the exhaust flows hard, and rings as before at idle', () => {
    // What is left 20 ms after the pulse, against the whole.
    const ringing = (x) => {
      const after = Math.round(0.02 * 44100);
      const total = x.reduce((t, v) => t + v * v, 0);
      return x.slice(after).reduce((t, v) => t + v * v, 0) / total;
    };
    const still = ir();
    const idle = ir({}, { flowMach: 0.01 });
    const full = ir({}, { flowMach: 0.2 });
    expect(Array.from(ir({}, { flowMach: 0 }))).toEqual(Array.from(still));
    expect(ringing(full)).toBeLessThan(ringing(still) / 2);
    expect(brightness(full)).toBeLessThan(brightness(still));
    expect(Math.abs(ringing(idle) - ringing(still)) / ringing(still)).toBeLessThan(0.1);
  });
});

describe('the flow down the tailpipe', () => {
  const geom = (pipeDiaIn) => S.exhaustGeometry({
    configuration: 'V8', cyl: 8, displacementL: 5.0, bore: 95, compression: 10.5,
    pipeDiaIn, gasTempK: 1100,
  });
  const g = geom(2.5);

  it('runs near Mach 0.2 at full power and barely moves at idle', () => {
    // One bank of a 5 litre V8: about 0.2 kg/s near the redline, under 0.01 at idle.
    const full = S.tailpipeMach(g, 0.2, 130);
    expect(full).toBeGreaterThan(0.1);
    expect(full).toBeLessThan(0.35);
    expect(S.tailpipeMach(g, 0.008, 103)).toBeLessThan(0.02);
    expect(S.tailpipeMach(g, 0)).toBe(0);
  });

  it('runs faster down a narrower pipe', () => {
    expect(S.tailpipeMach(geom(2.0), 0.2, 130)).toBeGreaterThan(S.tailpipeMach(g, 0.2, 130));
  });
});

describe('the primaries', () => {
  const geom = (over = {}) => S.exhaustGeometry({
    configuration: 'I6', cyl: 6, displacementL: 3.0, bore: 86, compression: 10.5,
    pipeDiaIn: 2.5, gasTempK: 1000, ...over,
  });
  const range = (xs) => Math.max(...xs) - Math.min(...xs);

  it('gives every cylinder its own run to the collector, around the mean length', () => {
    const g = geom();
    const lengths = S.primaryLengthsM(g);
    expect(lengths).toHaveLength(6);
    const mean = lengths.reduce((t, v) => t + v, 0) / lengths.length;
    expect(Math.abs(mean - g.primaryLength) / g.primaryLength).toBeLessThan(0.15);
  });

  it('runs a cast manifold\'s cylinders unevenly and tuned headers nearly equal', () => {
    expect(range(S.primaryLengthsM(geom({ headers: false }))))
      .toBeGreaterThan(3 * range(S.primaryLengthsM(geom({ headers: true }))));
  });
});

describe('a pulse running down the pipe', () => {
  const g = S.exhaustGeometry({
    configuration: 'V8', cyl: 8, displacementL: 5.0, bore: 95, compression: 10.5,
    pipeDiaIn: 3.0, gasTempK: 1000,
  });
  const event = (evoKpa, rpm) => S.exhaustEvent({ geometry: g, evoKpa, rpm, sampleRate: 44100 }).flow;
  /** Samples from 10% to 90% of the peak on the rising front. */
  const riseSamples = (x) => {
    const peak = Math.max(...x);
    const at = x.indexOf(peak);
    let lo = 0; let hi = at;
    for (let i = 0; i <= at; i++) { if (x[i] >= 0.1 * peak) { lo = i; break; } }
    for (let i = 0; i <= at; i++) { if (x[i] >= 0.9 * peak) { hi = i; break; } }
    return hi - lo;
  };

  it('sharpens a hard-run pulse towards a shock', () => {
    const loaded = event(450, 5000);
    expect(riseSamples(S.steepenPulse(loaded, g, 44100))).toBeLessThan(0.8 * riseSamples(loaded));
  });

  it('barely touches a gentle one, which is why an idle thuds and full load barks', () => {
    const idle = event(130, 800);
    const change = (x) => riseSamples(S.steepenPulse(x, g, 44100)) / riseSamples(x);
    expect(change(idle)).toBeGreaterThan(0.9);
    expect(change(idle)).toBeGreaterThan(change(event(450, 5000)));
  });

  it('sharpens it in the primary far more than in the wider collector', () => {
    // The same pulse down a collector no wider than the primary would sharpen much further.
    const loaded = event(450, 5000);
    const narrow = { ...g, collectorArea: g.primaryArea };
    expect(riseSamples(S.steepenPulse(loaded, g, 44100)))
      .toBeGreaterThan(riseSamples(S.steepenPulse(loaded, narrow, 44100)));
  });

  it('moves the gas rather than making or losing any', () => {
    const x = event(450, 5000);
    const sum = (v) => v.reduce((t, q) => t + q, 0);
    expect(Math.abs(sum(S.steepenPulse(x, g, 44100)) - sum(x)) / sum(x)).toBeLessThan(0.03);
  });

  it('opens the valve gently, with no step on the front of the event', () => {
    const x = event(450, 3000);
    const peak = Math.max(...x);
    for (let i = 1; i < 8; i++) expect(x[i]).toBeLessThan(0.05 * peak);
  });
});
