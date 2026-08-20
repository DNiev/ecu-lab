/**
 * Behavioural fingerprint of the simulation layer.
 *
 * This walks a large matrix of engine configurations, hardware combinations and
 * operating points, and reduces the whole simulation to one deterministic JSON blob.
 * Its hash is committed to `tests/fixtures/fingerprint.sha256`.
 *
 * WHY THIS EXISTS
 * The physics is a web of coupled formulas — a change to the knock envelope moves
 * torque, which moves the event log, which moves the score. Unit tests catch the
 * behaviour you thought to check; this catches the behaviour you did not.
 *
 * WHEN IT FAILS
 * A failure is not automatically a bug. It means the simulation now produces
 * different numbers than it did before your change. Either:
 *   - you did not mean to change the physics -> find what you broke, or
 *   - you did mean to change it -> review the diff, satisfy yourself the new numbers
 *     are right, then run `npm run test:fingerprint:update` and explain the change
 *     in your pull request.
 *
 * Never update the fixture just to make CI green. The whole value of this file is
 * that it forces a physics change to be a deliberate, reviewed act.
 */

/** Rounds to 6 decimal places so float noise across platforms cannot flap the hash. */
const r6 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(6)) : v);

const roundAll = (obj) => Object.fromEntries(
  Object.entries(obj).map(([k, v]) => {
    if (typeof v === 'number') return [k, r6(v)];
    // A legitimate absent reading (e.g. bsfc when the engine makes no power) is a
    // literal null, and typeof null is "object", not "number" — so it never reaches
    // r6 above. NaN and Infinity, by contrast, are still typeof "number", so a real
    // blow-up still flows through r6, stays non-finite, and still serialises to
    // JSON's `null`. Remapping only the literal-null case here keeps the two
    // distinguishable, which is what lets the ": null" guard in
    // fingerprint.test.js still mean "physics blew up" and nothing else.
    if (v === null) return [k, 'n/a'];
    return [k, v];
  }),
);

/** Engine configurations spanning the whole design space, including failure modes. */
export const FINGERPRINT_CONFIGS = {
  stockV6:     { configuration: 'V6', bore: 95.5, stroke: 81.4, compression: 10.3, blockMaterial: 'Aluminum', headMaterial: 'Aluminum', camDuration: 210, springRate: 50 },
  smallI4:     { configuration: 'I4', bore: 82.0, stroke: 78.0, compression: 11.5, blockMaterial: 'Aluminum', headMaterial: 'Aluminum', camDuration: 220, springRate: 60 },
  turboI6:     { configuration: 'I6', bore: 84.0, stroke: 89.6, compression: 10.2, blockMaterial: 'Aluminum', headMaterial: 'Aluminum', camDuration: 216, springRate: 55 },
  bigV8:       { configuration: 'V8', bore: 103.0, stroke: 92.0, compression: 9.5, blockMaterial: 'Cast Iron', headMaterial: 'Cast Iron', camDuration: 200, springRate: 45 },
  cammedV8:    { configuration: 'V8', bore: 101.6, stroke: 88.4, compression: 11.0, blockMaterial: 'Aluminum', headMaterial: 'Aluminum', camDuration: 280, springRate: 90 },
  floatTrap:   { configuration: 'V6', bore: 95.5, stroke: 81.4, compression: 10.3, blockMaterial: 'Aluminum', headMaterial: 'Aluminum', camDuration: 290, springRate: 25 },
  undersquare: { configuration: 'I4', bore: 78.0, stroke: 98.0, compression: 12.5, blockMaterial: 'Cast Iron', headMaterial: 'Aluminum', camDuration: 190, springRate: 55 },
};

const MODSETS = {
  none:   { intake: false, exhaust: false, headers: false, intercooler: false },
  all:    { intake: true, exhaust: true, headers: true, intercooler: true },
  intake: { intake: true, exhaust: false, headers: false, intercooler: false },
};

const BOOSTS = {
  na:    [0, 0, 0, 0, 0, 0, 0, 0],
  mild:  [0, 0, 3, 6, 8, 8, 8, 8],
  heavy: [0, 2, 8, 14, 20, 22, 24, 24],
};

/**
 * Exhaust diameter used by the sweep matrix, as a VALUE not an index.
 *
 * Indexing into `EXHAUST_DIA_OPTS` made the fingerprint shift the moment a new size
 * was added to the catalogue, which silently compared different hardware between
 * revisions and buried the real diff in noise. Pin the physical quantity instead.
 */
const SWEEP_EXHAUST_DIA = 3.0;

/**
 * Builds the full fingerprint from a simulation module.
 *
 * @param {object} S the `src/sim` public API
 * @returns {object} deterministic, JSON-serialisable snapshot
 */
export function buildFingerprint(S) {
  const out = {};

  // ---- deriveEngine ----
  out.deriveEngine = {};
  for (const [name, cfg] of Object.entries(FINGERPRINT_CONFIGS)) {
    out.deriveEngine[name] = roundAll(S.deriveEngine(cfg));
  }

  // ---- computeHardwareVE across hardware permutations ----
  out.computeHardwareVE = {};
  for (const [cname, cfg] of Object.entries(FINGERPRINT_CONFIGS)) {
    for (const [mname, mods] of Object.entries(MODSETS)) {
      for (const turboOn of [false, true]) {
        for (const dia of [2.5, 3.5]) {
          for (const fi of [0, 3]) {
            const key = `${cname}|${mname}|turbo=${turboOn}|dia=${dia}|fuel=${S.OCTANE_OPTS[fi].label}`;
            out.computeHardwareVE[key] = S.computeHardwareVE(cfg, mods, {
              turboOn,
              turbine: turboOn ? S.TURBINE_OPTS[1] : null,
              exhaustDia: dia,
              fuel: S.OCTANE_OPTS[fi],
            });
          }
        }
      }
    }
  }

  // ---- evaluatePoint over a dense grid ----
  out.evaluatePoint = {};
  const derivedStock = S.deriveEngine(FINGERPRINT_CONFIGS.stockV6);
  for (const rpm of [800, 2500, 4500, 6500, 7500]) {
    for (const mapKpa of [20, 40, 70, 101.325, 150, 200]) {
      for (const veVal of [45, 90, 120]) {
        for (const timingVal of [8, 24, 40]) {
          for (const afrCommanded of [11.5, 12.6, 14.7, 16.0]) {
            for (const fi of [0, 3]) {
              for (const [injectorCc, ecuInjectorCc] of [[315, 315], [850, 315], [315, 650]]) {
                const boostPsi = Math.max(0, (mapKpa - S.BARO_KPA) / S.PSI_TO_KPA);
                const key = `${rpm}|${mapKpa}|${veVal}|${timingVal}|${afrCommanded}|${S.OCTANE_OPTS[fi].label}|${injectorCc}/${ecuInjectorCc}`;
                out.evaluatePoint[key] = roundAll(S.evaluatePoint({
                  rpm, mapKpa, boostPsi,
                  veVal, timingVal, afrCommanded,
                  octaneBonus: S.OCTANE_OPTS[fi].bonus,
                  fuel: S.OCTANE_OPTS[fi],
                  mods: { ...MODSETS.none, turboFitted: boostPsi > 0 },
                  mafScalar: 1.0, mafErrorBase: 1.0,
                  injectorCc, ecuInjectorCc,
                  derived: derivedStock, compressor: S.COMPRESSOR_OPTS[1],
                }));
              }
            }
          }
        }
      }
    }
  }

  // ---- full sweeps, including the event log and scoring ----
  out.simulateSweep = {};
  for (const [cname, cfg] of Object.entries(FINGERPRINT_CONFIGS)) {
    for (const [bname, boostCurve] of Object.entries(BOOSTS)) {
      for (const [mname, mods] of Object.entries(MODSETS)) {
        for (const fi of [0, 3]) {
          for (const [injectorCc, ecuInjectorCc] of [[315, 315], [850, 315]]) {
            for (const loadKpa of [40, 100]) {
              const turboOn = bname !== 'na';
              const derived = S.deriveEngine(cfg);
              const ve = S.computeHardwareVE(cfg, mods, {
                turboOn,
                turbine: turboOn ? S.TURBINE_OPTS[1] : null,
                exhaustDia: SWEEP_EXHAUST_DIA,
                fuel: S.OCTANE_OPTS[fi],
              });
              const r = S.simulateSweep({
                loadKpa, ve,
                timing: S.clone2D(S.DEFAULT_TIMING),
                afr: S.clone2D(S.DEFAULT_AFR),
                turboOn, boostCurve,
                octaneBonus: S.OCTANE_OPTS[fi].bonus,
                octaneLabel: S.OCTANE_OPTS[fi].label,
                fuel: S.OCTANE_OPTS[fi],
                injectorCc, ecuInjectorCc, injectorLabel: `${injectorCc}cc`,
                mods, mafScalar: 1.0, derived,
                turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
              });
              const tuning = S.computeTuningScore(r);
              const engineer = S.computeEngineerScore({
                engineConfig: cfg, turboOn, peakBoostPsi: Math.max(...boostCurve),
                turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
                exhaustDiaError: 0.1, dutyPreview: 80, displacementL: derived.displacementL,
                fuel: S.OCTANE_OPTS[fi], mods,
              });
              const key = `${cname}|${bname}|${mname}|${S.OCTANE_OPTS[fi].label}|${injectorCc}/${ecuInjectorCc}|${loadKpa}kPa`;
              out.simulateSweep[key] = {
                peakHp: r.peakHp,
                peakTq: r.peakTq,
                wear: { piston: r6(r.wear.piston), bearing: r6(r.wear.bearing), valve: r6(r.wear.valve) },
                needsMafRecal: r.needsMafRecal,
                nPoints: r.points.length,
                events: r.events.map((e) => ({ type: e.type, severity: e.severity, impact: e.impact, msg: e.msg })),
                tuning: { score: tuning.score, label: tuning.label },
                engineer: { score: engineer.score, label: engineer.label },
                pull: S.computePullScore({
                  peakHp: r.peakHp, peakTq: r.peakTq,
                  tuningScore: tuning.score, engineerScore: engineer.score,
                }),
                samples: [0, 20, 40, 55].map((i) => r.points[i] && roundAll(r.points[i])),
              };
            }
          }
        }
      }
    }
  }

  // ---- factoryCalibration: the generated VE/timing/AFR surface for every shipped
  // preset. This is what actually exercises tuned constants that live in
  // src/sim/presets.js itself (FACTORY_KNOCK_MARGIN_DEG, OPEN_LOOP_KPA) — numbers that
  // move the dyno figures but sit outside COEFF and outside any other section of this
  // matrix, so nothing above catches them moving. Gating the whole generated surface
  // rather than the constants individually means a future constant added to the
  // generator is covered automatically, with no matching addition required here.
  out.factoryCalibration = {};
  for (const preset of S.ENGINE_PRESETS) {
    const { ve, timing, afr } = S.factoryCalibration(preset);
    out.factoryCalibration[preset.id] = {
      ve: ve.map((row) => row.map(r6)),
      timing: timing.map((row) => row.map(r6)),
      afr: afr.map((row) => row.map(r6)),
    };
  }

  // ---- calibrationAdvice: what the spark and fuel advisors SAY about every shipped
  // preset's own factory calibration. The advisors are what the player actually reads
  // in TUNE, and until now nothing in this matrix called them at all — so the whole
  // advisory layer could change what it tells people with no hash movement and no
  // review. Gating the advice itself, rather than the constants behind it, means a
  // future ceiling or tolerance added to advisors.js is covered without a matching
  // addition here.
  //
  // Wired exactly as src/ui/EcuLab.jsx wires it, MAF error included. That matters:
  // passing mafErrorBase 1 makes a turbo build's delivered mixture richer than the
  // factory table intends, which lifts the knock threshold and hides real cells. The
  // app never does that, so neither does this.
  out.calibrationAdvice = {};
  for (const preset of S.ENGINE_PRESETS) {
    const p = S.applyPreset(preset);
    const fuel = S.OCTANE_OPTS[p.octaneIdx];
    const advice = S.calibrationAdvice({
      ve: p.ve, veTruth: p.ve, timing: p.timing, afr: p.afr,
      derived: S.deriveEngine(p.engineConfig), fuel,
      mods: p.mods, turboOn: p.turboOn, boostCurve: p.boostCurve,
      compressor: S.COMPRESSOR_OPTS[p.compressorIdx],
      turbine: S.presetTurbine(preset),
      injectorCc: S.INJECTOR_OPTS[p.injIdx].cc, ecuInjectorCc: p.ecuInjectorCc,
      mafScalar: 1.0, mafErrorBase: S.mafErrorFactor(p.mods, p.turboOn),
    });
    out.calibrationAdvice[preset.id] = {
      overAdvanced: advice.overAdvanced.length,
      pastMbt: advice.pastMbt.length,
      underAdvanced: advice.underAdvanced.length,
      wrongMix: advice.wrongMix.length,
      knocking: advice.spark.filter((c) => c.knocking).length,
      spark: advice.spark.map((c) => ({
        ri: c.ri, ci: c.ci,
        current: r6(c.current), suggested: r6(c.suggested),
        mbt: r6(c.mbt), knockCeiling: r6(c.knockCeiling),
        knockLimited: c.knockLimited, knocking: c.knocking,
      })),
      // The fuel side used to be recorded only as `wrongMix.length` — a count that an
      // edit to the `map >= 85` gate or the 0.45 tolerance could move without changing.
      // Record every cell in the same detail as spark, so a change to either constant
      // is caught here even when it does not flip which cells cross the threshold.
      fuelAdv: advice.fuelAdv.map((c) => ({
        ri: c.ri, ci: c.ci, suggested: r6(c.suggested), delta: r6(c.delta),
      })),
    };
  }

  // ---- drag runs: the vehicle model, driven by real measured torque curves ----
  // Fed from an actual sweep rather than a synthetic curve, so this gates the whole
  // chain — engine to torque curve to elapsed time. The matrix spans the two regimes
  // that behave differently (traction-limited and power-limited) and every catalogue
  // the vehicle model reads, because a change to any of them moves a real number a
  // player sees on the time slip.
  out.simulateDragRun = {};
  {
    const dragCases = [
      ['stockV6', 'na', 'none'],
      ['bigV8', 'na', 'all'],
      ['turboI6', 'heavy', 'all'],
    ];
    for (const [cname, bname, mname] of dragCases) {
      const cfg = FINGERPRINT_CONFIGS[cname];
      const boostCurve = BOOSTS[bname];
      const mods = MODSETS[mname];
      const turboOn = bname !== 'na';
      const derived = S.deriveEngine(cfg);
      const ve = S.computeHardwareVE(cfg, mods, {
        turboOn,
        turbine: turboOn ? S.TURBINE_OPTS[1] : null,
        exhaustDia: SWEEP_EXHAUST_DIA,
        fuel: S.OCTANE_OPTS[0],
      });
      const sweep = S.simulateSweep({
        loadKpa: 100, ve,
        timing: S.clone2D(S.DEFAULT_TIMING),
        afr: S.clone2D(S.DEFAULT_AFR),
        turboOn, boostCurve,
        octaneBonus: S.OCTANE_OPTS[0].bonus,
        octaneLabel: S.OCTANE_OPTS[0].label,
        fuel: S.OCTANE_OPTS[0],
        injectorCc: 850, ecuInjectorCc: 850, injectorLabel: '850cc',
        mods, mafScalar: 1.0, derived,
        turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
      });
      const torqueCurveNm = S.torqueCurveFromSweep(sweep);
      for (const bodyIdx of [0, 1, 4]) {
        for (const gripIdx of [0, 2]) {
          for (const driveIdx of [0, 1]) {
            for (const boxIdx of [0, 1]) {
              const car = {
                ...S.DEFAULT_CAR, bodyIdx, ...S.CAR_BODIES[bodyIdx],
                gripIdx, driveIdx, boxIdx,
              };
              const d = S.simulateDragRun({
                car, torqueCurveNm, redline: derived.redline,
                displacementL: derived.displacementL, peakHp: sweep.peakHp,
              });
              const key = `${cname}|${bname}|${mname}|${S.CAR_BODIES[bodyIdx].body}`
                + `|${S.TIRE_GRIP[gripIdx].grade}|${S.DRIVETRAIN_OPTS[driveIdx].drive}`
                + `|${S.GEARBOX_OPTS[boxIdx].box}`;
              out.simulateDragRun[key] = {
                et: r6(d.et), trapMph: r6(d.trapMph),
                sixtyFootT: r6(d.sixtyFootT), zeroToSixty: r6(d.zeroToSixty),
                eighthET: r6(d.eighthET), eighthMph: r6(d.eighthMph),
                topGearUsed: d.topGearUsed, wheelspun: d.wheelspun, finished: d.finished,
                nTrace: d.trace.length,
                // Sampled rather than dumped whole: enough to catch the shape of the
                // run moving without burying the diff in ten thousand rows.
                samples: [0, 50, 150, 300].map((i) => d.trace[i] && roundAll(d.trace[i])),
              };
            }
          }
        }
      }
    }
  }

  // ---- helpers ----
  out.helpers = {
    interp1: [1000, 1500, 3000, 4500, 6000, 7500, 9000].map((x) => r6(S.interp1(S.RPM, S.DEFAULT_TIMING[0], x))),
    interp2: [[800, 20], [2500, 70], [4500, 101.325], [6500, 150], [7500, 200]].map(([rpm, l]) => r6(S.interp2(S.DEFAULT_VE, rpm, l))),
    chargeTempK: [0, 5, 10, 20, 30].flatMap((psi) => [true, false].map((ic) => r6(S.chargeTempK(psi, ic)))),
    idealExhaustDiameter: [2.0, 3.5, 5.0].flatMap((d) => [0, 5, 10, 20].map((b) => r6(S.idealExhaustDiameter(d, b)))),
    solveInduction: [1500, 3500, 5500, 7500].flatMap((rpm) => [40, 100].map((load) =>
      roundAll(S.solveInduction({
        rpm, loadKpa: load, turboOn: true, boostTargetPsi: 12,
        turbine: S.TURBINE_OPTS[1], compressor: S.COMPRESSOR_OPTS[1],
        veAt: () => 95, derived: S.deriveEngine(FINGERPRINT_CONFIGS.stockV6),
        intakeKAt: (psi) => S.chargeTempK(psi, true), lambda: 1, exhaustK: 1100,
      })))),
    clamp: [[-5, 0, 10], [5, 0, 10], [15, 0, 10]].map(([v, lo, hi]) => S.clamp(v, lo, hi)),
  };

  // ---- constants, so a typo'd coefficient is caught too ----
  out.constants = {
    RPM: S.RPM, LOAD: S.LOAD, COEFF: S.COEFF,
    DEFAULT_VE: S.DEFAULT_VE, DEFAULT_TIMING: S.DEFAULT_TIMING,
    DEFAULT_AFR: S.DEFAULT_AFR, DEFAULT_BOOST: S.DEFAULT_BOOST,
    OCTANE_OPTS: S.OCTANE_OPTS, INJECTOR_OPTS: S.INJECTOR_OPTS,
    TURBINE_OPTS: S.TURBINE_OPTS, COMPRESSOR_OPTS: S.COMPRESSOR_OPTS,
    EXHAUST_DIA_OPTS: S.EXHAUST_DIA_OPTS,
    TIRE_GRIP: S.TIRE_GRIP, CAR_BODIES: S.CAR_BODIES,
    DRIVETRAIN_OPTS: S.DRIVETRAIN_OPTS, GEARBOX_OPTS: S.GEARBOX_OPTS,
    DEFAULT_CAR: S.DEFAULT_CAR,
  };

  return out;
}

/** Serialises a fingerprint to the exact form that gets hashed. */
export const serialiseFingerprint = (fp) => JSON.stringify(fp, null, 1);
