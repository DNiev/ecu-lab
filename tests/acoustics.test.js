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
  const pipeDiaIn = overrides.pipeDiaIn ?? 2.5;
  const turboOn = overrides.turboOn ?? false;
  const { derived, pt } = point({ ...overrides, cfg, rpm });
  return S.acousticDrive({
    rpm, derived, point: pt, configuration: cfg.configuration, pipeDiaIn, turboOn,
    compressor: S.COMPRESSOR_OPTS[1],
  });
}

describe('firing frequency', () => {
  it('is half what the cylinder count suggests, because a four-stroke fires every other revolution', () => {
    expect(S.firingFrequencyHz(6000, 8)).toBeCloseTo(400, 6);
    expect(S.firingFrequencyHz(6000, 4)).toBeCloseTo(200, 6);
  });

  it('is zero at rest and never negative', () => {
    expect(S.firingFrequencyHz(0, 6)).toBe(0);
    expect(S.firingFrequencyHz(-500, 6)).toBe(0);
  });
});

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

describe('exhaust resonance', () => {
  it('rings higher when the gas in it is hotter, because sound travels faster', () => {
    const cold = S.exhaustResonanceHz({ displacementL: 3.5, pipeDiaIn: 2.5, gasTempK: 600 });
    const hot = S.exhaustResonanceHz({ displacementL: 3.5, pipeDiaIn: 2.5, gasTempK: 1100 });
    expect(hot).toBeGreaterThan(cold);
  });

  it('rings lower on a bigger engine, which carries a longer system', () => {
    const small = S.exhaustResonanceHz({ displacementL: 2.0, pipeDiaIn: 2.5, gasTempK: 900 });
    const big = S.exhaustResonanceHz({ displacementL: 6.2, pipeDiaIn: 2.5, gasTempK: 900 });
    expect(big).toBeLessThan(small);
  });

  it('follows c / 2L exactly for the length it reports', () => {
    const lengthM = S.exhaustLengthM({ displacementL: 3.5, pipeDiaIn: 2.5 });
    const c = S.soundSpeedMs(900, S.COEFF.GAMMA_BURNED);
    expect(S.exhaustResonanceHz({ displacementL: 3.5, pipeDiaIn: 2.5, gasTempK: 900 }))
      .toBeCloseTo(c / (2 * lengthM), 6);
  });

  it('adds an end correction, so a wider pipe measures acoustically longer', () => {
    expect(S.exhaustLengthM({ displacementL: 3.5, pipeDiaIn: 3.5 }))
      .toBeGreaterThan(S.exhaustLengthM({ displacementL: 3.5, pipeDiaIn: 2.0 }));
  });
});

describe('blowdown', () => {
  it('is choked at wide-open throttle — which is why a hard-run engine cracks', () => {
    const d = drive({ rpm: 5500, mapKpa: S.BARO_KPA });
    expect(d.blowdownRatio).toBeGreaterThan(S.CRITICAL_PRESSURE_RATIO);
    expect(d.sharpness).toBe(1);
  });

  it('does not happen at all at a throttled idle, so idle is a soft chuff', () => {
    const d = drive({ rpm: 800, mapKpa: 35, timingVal: 14, afrCommanded: 13.5 });
    expect(d.blowdownRatio).toBeLessThan(1);
    expect(d.sharpness).toBe(0);
  });

  it('gets louder with boost, because there is more pressure to let go of', () => {
    const na = drive({ rpm: 4500, mapKpa: S.BARO_KPA, timingVal: 26 });
    const boosted = drive({
      rpm: 4500, mapKpa: 184, boostPsi: 12, timingVal: 18, afrCommanded: 12.2,
      mods: { ...S.DEFAULT_MODS, turboFitted: true },
    });
    expect(boosted.pulseLevel).toBeGreaterThan(na.pulseLevel);
  });

  it('still makes some noise with no blowdown, because the piston pushes the charge out', () => {
    const d = drive({ rpm: 800, mapKpa: 35, timingVal: 14, afrCommanded: 13.5 });
    expect(d.pulseLevel).toBeGreaterThan(0);
  });

  it('spans roughly 30 dB between idle and wide-open throttle', () => {
    const idle = drive({ rpm: 800, mapKpa: 35, timingVal: 14, afrCommanded: 13.5 });
    const wot = drive({ rpm: 5500, mapKpa: S.BARO_KPA });
    const dB = 20 * Math.log10(wot.pulseLevel / idle.pulseLevel);
    expect(dB).toBeGreaterThan(20);
    expect(dB).toBeLessThan(45);
  });
});

describe('pulse shape', () => {
  it('lasts longer on a longer stroke, and is indifferent to bore', () => {
    const at = (bore, stroke) => {
      const derived = S.deriveEngine({ ...STOCK, bore, stroke });
      return S.blowdownDurationS({
        displacementL: derived.displacementL, cyl: derived.cyl, bore,
        compression: STOCK.compression, gasTempK: 1100,
      });
    };
    // Volume scales with bore^2 x stroke and valve area with bore^2, so bore cancels.
    expect(at(88, 105)).toBeGreaterThan(at(88, 81));
    expect(at(105, 88)).toBeCloseTo(at(88, 88), 4);
  });

  it('vents faster when the gas is hotter, because sound travels faster in it', () => {
    const at = (gasTempK) => S.blowdownDurationS({
      displacementL: 3.5, cyl: 6, bore: 95.5, compression: 10.3, gasTempK,
    });
    expect(at(1200)).toBeLessThan(at(600));
  });

  it('lands in the millisecond range a real blowdown occupies', () => {
    for (const gasTempK of [600, 900, 1200]) {
      const ms = S.blowdownDurationS({
        displacementL: 3.5, cyl: 6, bore: 95.5, compression: 10.3, gasTempK,
      }) * 1000;
      expect(ms).toBeGreaterThan(0.5);
      expect(ms).toBeLessThan(4);
    }
  });

  it('renders the reference engine at about unit rate', () => {
    const d = drive({ rpm: 4500, mapKpa: S.BARO_KPA, timingVal: 26 });
    expect(d.pulseRate).toBeGreaterThan(0.85);
    expect(d.pulseRate).toBeLessThan(1.2);
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
    const at = (timingVal) => drive({ rpm: 4500, mapKpa: S.BARO_KPA, timingVal });
    const mbt = at(30), retarded = at(12);
    expect(retarded.exhaustPowerW).toBeGreaterThan(mbt.exhaustPowerW);
  });

  it('spans idle to redline over most of its range', () => {
    const idle = drive({ rpm: 850, mapKpa: 35, timingVal: 14, afrCommanded: 13.5 });
    const wot = drive({ rpm: 6500, mapKpa: S.BARO_KPA, timingVal: 26 });
    expect(idle.exhaustDrive).toBeLessThan(0.1);
    expect(wot.exhaustDrive).toBeGreaterThan(0.7);
  });
});

describe('cycle-to-cycle variation', () => {
  it('sits at the floor when the charge is clean', () => {
    expect(S.cyclicVariation({ residualFrac: 0.05, rpm: 5000 }).cov).toBe(S.ACOUSTIC.COV_FLOOR);
    expect(S.cyclicVariation({ residualFrac: 0.05, rpm: 5000 }).misfireRate).toBe(0);
  });

  it('is FLAT ZERO on a stock cam — a smooth idle must render smooth', () => {
    const stock = S.cyclicVariation({ rpm: 850, overlapDeg: 0 });
    expect(stock.severity).toBe(0);
    expect(stock.misfireRate).toBe(0);
    expect(stock.cov).toBe(S.ACOUSTIC.COV_FLOOR);
  });

  it('rises with valve overlap, which is what opens the window for dilution', () => {
    const mild = S.cyclicVariation({ rpm: 850, overlapDeg: 11 });
    const wild = S.cyclicVariation({ rpm: 850, overlapDeg: 44 });
    expect(wild.severity).toBeGreaterThan(mild.severity);
    expect(wild.misfireRate).toBeGreaterThan(mild.misfireRate);
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
            if (key === 'events') continue;
            expect(Number.isFinite(value), `${configuration} ${rpm}/${mapKpa} ${key}`).toBe(true);
          }
        }
      }
    }
  });

  it('says nothing is happening when the engine is not running', () => {
    const d = S.acousticDrive({
      rpm: 0, derived: S.deriveEngine(STOCK), point: null,
      configuration: STOCK.configuration, pipeDiaIn: 2.5,
    });
    expect(d.firingHz).toBe(0);
    expect(d.sharpness).toBe(0);
    expect(d.whistleHz).toBe(0);
  });
});
