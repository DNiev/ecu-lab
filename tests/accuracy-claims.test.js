/**
 * The numbers docs/accuracy.md and Learn article 39 tell people about the model.
 *
 * Those pages describe the model with measured figures — the presets' table, and the
 * size of each known approximation. A page like that goes stale silently: the physics
 * moves, the page does not, and it becomes a claim nobody checked. This makes every such
 * figure a contract. If a change moves one, this fails and names the sentence to update.
 *
 * Only the MODEL's figures are checked here. The real-engine figures those pages compare
 * against come from the published sources the pages cite; tests cannot measure a car.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';
import { makeEngine } from './ecuHarness.js';
import { randomBuild, rng } from './randomBuilds.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = readFileSync(join(ROOT, 'docs/accuracy.md'), 'utf8');
const LEARN = readFileSync(join(ROOT, 'src/ui/screens/dash/LearnScreen.jsx'), 'utf8');

function pullFor(preset) {
  const patch = S.applyPreset(preset);
  const derived = S.deriveEngine(patch.engineConfig);
  return S.simulateSweep({
    loadKpa: 100, ve: patch.ve, veTruth: patch.ve, timing: patch.timing, afr: patch.afr,
    turboOn: patch.turboOn, boostCurve: patch.boostCurve,
    octaneBonus: S.OCTANE_OPTS[patch.octaneIdx].bonus, octaneLabel: S.OCTANE_OPTS[patch.octaneIdx].label,
    fuel: S.OCTANE_OPTS[patch.octaneIdx], injectorCc: S.INJECTOR_OPTS[patch.injIdx].cc,
    ecuInjectorCc: patch.ecuInjectorCc, injectorLabel: S.INJECTOR_OPTS[patch.injIdx].label,
    mods: patch.mods, mafScalar: 1, derived, turbine: S.presetTurbine(preset),
    compressor: S.COMPRESSOR_OPTS[patch.compressorIdx],
  });
}

const PRESETS = S.ENGINE_PRESETS.map((preset) => {
  const pull = pullFor(preset);
  const peak = pull.points.reduce((a, b) => (b.hp > a.hp ? b : a));
  const peakTq = pull.points.reduce((a, b) => (b.torque > a.torque ? b : a));
  return { preset, pull, peak, peakTq, boosted: peak.boostPsi >= 1 };
});
const crank = (whole) => Math.round(whole / S.DRIVETRAIN_EFF);
const span = (xs) => [Math.min(...xs), Math.max(...xs)];

/** A row of the table in docs/accuracy.md, exactly as the doc should print it. */
function tableRow({ preset, pull, peak, peakTq }) {
  const lbMin = (peak.maf * 60) / 453.6;
  return [
    `${crank(pull.peakHp)} hp / ${crank(pull.peakTq)} lb-ft`,
    String(peak.rpm),
    peak.lambda.toFixed(3),
    `${peak.timing.toFixed(1)}°`,
    peak.bsfc.toFixed(3),
    ((peak.hp / S.DRIVETRAIN_EFF) / lbMin).toFixed(1),
    String(peak.egt),
    String(Math.round(Math.max(peak.peakPressure, peakTq.peakPressure))),
    peakTq.bmep.toFixed(1),
    preset.name,
  ];
}

describe('docs/accuracy.md: the presets table is what the model does', () => {
  it.each(PRESETS.map((r) => [r.preset.name, r]))('%s', (name, r) => {
    const line = DOC.split('\n').find((l) => l.startsWith(`| ${name} |`));
    expect(line, `no row for ${name} in docs/accuracy.md`).toBeTruthy();
    const cells = /** @type {string} */ (line).split('|').slice(1, -1).map((c) => c.trim());
    const [sim, rpm, lambda, timing, bsfc, hpPerLb, egt, pmax, bmep] = tableRow(r);
    expect({
      sim: cells[2], rpm: cells[3].split('/').pop()?.trim(), lambda: cells[4], timing: cells[5],
      bsfc: cells[6], hpPerLb: cells[7], egt: cells[8], pmax: cells[9], bmep: cells[10],
    }).toEqual({ sim, rpm, lambda, timing, bsfc, hpPerLb, egt, pmax, bmep });
  });
});

describe('the known approximations are the size the pages say', () => {
  it('fuel per horsepower: presets 0.40-0.43 lb/hp·h, 11.5-12 hp per lb/min of air', () => {
    const [lo, hi] = span(PRESETS.map((r) => r.peak.bsfc));
    expect(lo).toBeGreaterThanOrEqual(0.395);
    expect(hi).toBeLessThan(0.435);
    const [alo, ahi] = span(PRESETS.map((r) => (r.peak.hp / S.DRIVETRAIN_EFF) / ((r.peak.maf * 60) / 453.6)));
    expect(alo).toBeGreaterThanOrEqual(11.45);
    expect(ahi).toBeLessThan(12.05);
  });

  it('turbo spool: 15-55% under the rated torque at 1500-2000 RPM, where the real engine makes it', () => {
    // Each maker publishes a flat torque plateau from a stated RPM; below 2000 RPM that is
    // the real engine's torque wherever the plateau has begun.
    const plateauFrom = { n54: 1400, 'b58-m0': 1380, 'b58-m1': 1800, 'ea888-gti': 1500, 'ea888-r': 1800 };
    const deficits = [];
    for (const { preset, pull, boosted } of PRESETS) {
      if (!boosted) continue;
      for (const rpm of [1500, 2000]) {
        if (rpm < plateauFrom[preset.id]) continue;
        const p = pull.points.find((x) => x.rpm === rpm);
        deficits.push(1 - (p.torque / S.DRIVETRAIN_EFF) / preset.factory.crankTq);
      }
    }
    const [lo, hi] = span(deficits);
    expect(lo).toBeGreaterThanOrEqual(0.15);
    expect(hi).toBeLessThanOrEqual(0.55);
  });

  it('peak torque: most turbo presets 3-8% over their rating, the GTI about 3% under', () => {
    for (const { preset, pull, boosted } of PRESETS) {
      if (!boosted) continue;
      const over = crank(pull.peakTq) / preset.factory.crankTq - 1;
      if (preset.id === 'ea888-gti') expect(over).toBeCloseTo(-0.035, 1);
      else {
        expect(over).toBeGreaterThanOrEqual(0.03);
        expect(over).toBeLessThanOrEqual(0.08);
      }
    }
  });

  it('exhaust temperature at peak power: about 780 °C NA, 790-820 °C boosted', () => {
    for (const { peak, boosted } of PRESETS) {
      if (boosted) {
        expect(peak.egt).toBeGreaterThanOrEqual(785);
        expect(peak.egt).toBeLessThanOrEqual(825);
      } else {
        expect(Math.abs(peak.egt - 780)).toBeLessThanOrEqual(10);
      }
    }
  });

  // One NA and one boosted engine at full load, spark fixed, mixture swept.
  const egtAt = (build, afrCommanded) => {
    const eng = makeEngine({ build });
    const map = build.turboOn ? 160 : 100;
    return S.evaluatePoint({
      rpm: 5000, mapKpa: map, boostPsi: Math.max(0, (map - S.BARO_KPA) / S.PSI_TO_KPA),
      veVal: S.interp2(eng.veTruth, 5000, map), timingVal: 15, afrCommanded, fuel: eng.fuel,
      mods: { ...eng.build.mods, turboFitted: !!build.turboOn }, mafScalar: 1, mafErrorBase: 1,
      injectorCc: 1000, ecuInjectorCc: 1000, derived: eng.derived, compressor: eng.compressor,
      turbine: build.turboOn ? eng.turbine : null,
    });
  };
  const ENGINES = [{}, { turboOn: true, boostCurve: [0, 2, 6, 10, 10, 10, 10, 9], mods: { ...S.DEFAULT_MODS, intercooler: true } }];

  it('enrichment: 13.5 to 11:1 cools the exhaust 10-15 °C, several times less than the turbine-side correlation', () => {
    for (const build of ENGINES) {
      const lean = egtAt(build, 13.5);
      const rich = egtAt(build, 11.0);
      const cooled = lean.egt - rich.egt;
      expect(cooled).toBeGreaterThanOrEqual(9.5);
      expect(cooled).toBeLessThanOrEqual(15.5);
      const correlation = S.exhaustTempK({ chargeIndex: 1, lambda: lean.lambda }) - S.exhaustTempK({ chargeIndex: 1, lambda: rich.lambda });
      expect(correlation / cooled).toBeGreaterThan(3);
    }
  });

  it('exhaust temperature peaks at stoichiometric', () => {
    for (const build of ENGINES) {
      const stoich = egtAt(build, 14.7).egt;
      expect(stoich).toBeGreaterThan(egtAt(build, 13.5).egt);
      expect(stoich).toBeGreaterThan(egtAt(build, 15.5).egt);
    }
  });

  it('best torque: the cycle peaks a median of about 2°, 95% within 7.5° and at most about 15° after the textbook MBT', () => {
    const offsets = [];
    for (let seed = 1; seed <= 200; seed++) {
      const build = randomBuild(seed);
      const eng = makeEngine({ build });
      const r = rng(seed * 7919 + 1);
      const rpm = Math.round(1200 + r() * (build.engineConfig.redline - 1200));
      const peakBoost = build.turboOn ? Math.max(...build.boostCurve) : 0;
      const map = Math.round(35 + r() * (S.BARO_KPA - 35 + peakBoost * S.PSI_TO_KPA));
      const cc = S.INJECTOR_OPTS[build.injIdx].cc;
      const at = (timingVal) => S.evaluatePoint({
        rpm, mapKpa: map, boostPsi: Math.max(0, (map - S.BARO_KPA) / S.PSI_TO_KPA),
        veVal: S.interp2(eng.veTruth, rpm, map), afrCommanded: map > S.BARO_KPA + 7 ? 11.8 : 12.9,
        fuel: eng.fuel, mods: { ...build.mods, turboFitted: build.turboOn }, mafScalar: 1, mafErrorBase: 1,
        injectorCc: cc, ecuInjectorCc: cc, derived: eng.derived, compressor: eng.compressor,
        turbine: build.turboOn ? eng.turbine : null, timingVal,
      });
      const probe = at(10);
      if (probe.imep < 0.5 || probe.mbtIdeal >= S.COEFF.MBT_MAX_DEG) continue;
      let best = { imep: -Infinity, t: probe.mbtIdeal };
      for (let t = Math.max(-5, probe.mbtIdeal - 15); t <= Math.min(probe.threshold - 0.5, probe.mbtIdeal + 20); t += 0.5) {
        const q = at(t);
        if (q.imep > best.imep) best = { imep: q.imep, t };
      }
      offsets.push(probe.mbtIdeal - best.t);
    }
    offsets.sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)];
    expect(median).toBeGreaterThanOrEqual(1);
    expect(median).toBeLessThanOrEqual(3);
    expect(offsets[Math.floor(0.95 * (offsets.length - 1))]).toBeLessThanOrEqual(7.5);
    expect(offsets[offsets.length - 1]).toBeLessThanOrEqual(15);
  });

  it('peak cylinder pressure: 60-70 bar on the NA presets, 75-90 bar on the turbo presets', () => {
    for (const { peak, peakTq, boosted } of PRESETS) {
      const pmax = Math.max(peak.peakPressure, peakTq.peakPressure);
      if (boosted) {
        expect(pmax).toBeGreaterThanOrEqual(75);
        expect(pmax).toBeLessThanOrEqual(90);
      } else {
        expect(pmax).toBeGreaterThanOrEqual(60);
        expect(pmax).toBeLessThanOrEqual(70);
      }
    }
    expect(S.COEFF.PEAK_PRESSURE_LIMIT_BAR).toBe(105);
  });

  it('compressor heat: the charge heats at one fixed 70% compressor efficiency, whatever the map says', () => {
    expect(S.COMP_ISEN_EFF).toBe(0.7);
    // The charge-temperature function takes boost, intercooler and the day — no compressor.
    expect(S.chargeTempK.length).toBe(3);
  });

  it('wheel horsepower is crank × 0.85', () => {
    expect(S.DRIVETRAIN_EFF).toBe(0.85);
  });

  it('boost: 20 psi with an intercooler is about 1.9× the NA engine; a generic turbo build burns 0.46-0.52 lb/hp·h', () => {
    const cfg = { ...S.DEFAULT_ENGINE_CONFIG, compression: 9.0 };
    const derived = S.deriveEngine(cfg);
    const fuel = S.OCTANE_OPTS.find((o) => o.label === '93');
    const powerAt = (psi, intercooler) => {
      const turbo = psi > 0;
      const mods = { ...S.DEFAULT_MODS, intercooler, turboFitted: turbo };
      const ve = S.computeHardwareVE(cfg, mods, { turboOn: turbo, turbine: turbo ? S.TURBINE_OPTS[1] : null, exhaustDia: 3.0, fuel, peakBoostPsi: psi });
      const map = S.BARO_KPA + psi * S.PSI_TO_KPA;
      const at = (timingVal) => S.evaluatePoint({
        rpm: 5500, mapKpa: map, boostPsi: psi, veVal: S.interp2(ve, 5500, map), timingVal,
        afrCommanded: turbo ? 11.8 : 12.8, fuel, mods, mafScalar: 1, mafErrorBase: 1,
        injectorCc: 1000, ecuInjectorCc: 1000, derived, compressor: S.COMPRESSOR_OPTS[2],
        turbine: turbo ? S.TURBINE_OPTS[1] : null,
      });
      const probe = at(10);
      return at(Math.min(probe.threshold - 1, probe.mbtIdeal));
    };
    const na = powerAt(0, true).hp;
    const ratio = powerAt(20, true).hp / na;
    expect(ratio).toBeGreaterThanOrEqual(1.85);
    expect(ratio).toBeLessThan(1.95);
    const [lo, hi] = span([powerAt(10, true), powerAt(20, true), powerAt(10, false), powerAt(20, false)].map((p) => p.bsfc));
    expect(lo).toBeGreaterThanOrEqual(0.455);
    expect(hi).toBeLessThan(0.525);
  });

  it('exhaust backpressure at rated power: 1.0-1.4× the boost pressure on the turbo presets', () => {
    for (const { peak, boosted } of PRESETS) {
      if (!boosted) continue;
      expect(peak.emp / peak.map).toBeGreaterThanOrEqual(0.95);
      expect(peak.emp / peak.map).toBeLessThanOrEqual(1.4);
    }
  });
});

describe('the pages say where their numbers are checked', () => {
  it('points readers at this test, so a stale page is a failing test and not a quiet one', () => {
    expect(DOC).toContain('tests/accuracy-claims.test.js');
    expect(LEARN).toContain('39. What this simulator simplifies');
  });
});

describe('every screen the app sends a player to exists', () => {
  // "BUILD → X", "TUNE › X": wherever a message, tip or article names a screen, the screen
  // has to be there, or the advice is a dead end however right it is. Scanned from the
  // source rather than from messages that happen to fire, so a rare event is covered too.
  const VIEWS = {
    BUILD: ['ENGINE', 'INDUCTION', 'FUEL SYSTEM', 'EXHAUST'],
    TUNE: ['AIRFLOW', 'SPARK', 'FUEL', 'INJECTORS', 'SENSORS', 'BOOST', 'VVT', 'IDLE', 'PROTECT', 'TORQUE', 'NITROUS'],
  };
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(name)) files.push(full);
    }
  };
  walk(join(ROOT, 'src'));

  it('names only real BUILD and TUNE views', () => {
    const bad = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b(BUILD|TUNE) (?:→|›|&rsaquo;) ([A-Z][A-Z ]*[A-Z])/g)) {
        const name = m[2].trim();
        if (!VIEWS[m[1]].some((v) => name === v || name.startsWith(`${v} `))) bad.push(`${f.slice(ROOT.length + 1)}: "${m[0]}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});
