/**
 * ECU LAB — the composition root: store provider, shell, and the route switch that
 * hands each tab's markup to its screen components.
 *
 * WHAT THIS FILE IS
 * Presentation only. It reads the simulation's output but contains no physics — if
 * you find yourself doing engineering maths in here, it belongs in `src/sim/`
 * instead. That separation is what keeps the physics testable in plain Node.
 *
 * LAYOUT
 * This used to be one large single-component app; it has been split into
 * `ui/primitives/`, `ui/screens/` and `ui/AppShell.jsx`. What remains here is the
 * store setup, the pieces still shared across more than one screen (`JourneyBanner`,
 * `Tach`, the tutorial content), and the top-level component that reads the route and
 * renders the right screen into the shell.
 *
 * TYPE CHECKING
 * No longer opts out. This file used to carry `@ts-nocheck` while it was one large
 * untyped component; now that it is a thin, typed root, it is checked like everything
 * else under `npm run typecheck`.
 */

import React, { useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Grid3x3, Zap, Droplets, Activity, Play,
  Settings, TrendingUp, Fuel,
} from 'lucide-react';

import {
  BARO_KPA, COMPRESSOR_OPTS,
  DEFAULT_BOOST, DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, EXHAUST_DIA_OPTS,
  INJ_DEADTIME_MS, INJECTOR_OPTS, OCTANE_OPTS,
  PSI_TO_KPA,
  R_AIR, RPM, TURBINE_OPTS, calibrationAdvice, chargeTempK, clamp,
  computeEngineerScore, computeHardwareVE, computePullScore, computeTuningScore,
  deriveEngine, idealExhaustDiameter, interp2, presetById,
  simulateSweep, turbineWithCount, veRecommendations
} from '../sim/index.js';
import { T, utilisationColor } from './theme.js';
import { BUILD_VERSION } from '../version.js';
import { loadCareer, saveCareer } from '../storage.js';
import { AppShell } from './AppShell.jsx';
import { StartScreen } from './screens/StartScreen.jsx';
import { TutorialScreen } from './screens/TutorialScreen.jsx';
import { StoreProvider, useBuild, useSession, useTune } from './state/StoreProvider.jsx';
import { ROUTES } from './routing.js';
import { useRoute } from './useRoute.js';
import { ACTIONS } from './state/reducer.js';
import { Button } from './primitives/Button.jsx';
import { Eyebrow } from './primitives/Eyebrow.jsx';
import { Panel } from './primitives/Panel.jsx';
import { StatTile } from './primitives/StatTile.jsx';
import { Seg } from './primitives/Seg.jsx';
import { DialMark } from './components/DialMark.jsx';
import { EngineScreen } from './screens/build/EngineScreen.jsx';
import { ExhaustScreen } from './screens/build/ExhaustScreen.jsx';
import { FuelSystemScreen } from './screens/build/FuelSystemScreen.jsx';
import { InductionScreen } from './screens/build/InductionScreen.jsx';
import { CAREER_JOBS } from './career.js';
import { HealthScreen } from './screens/dash/HealthScreen.jsx';
import { JobsScreen } from './screens/dash/JobsScreen.jsx';
import { LearnScreen } from './screens/dash/LearnScreen.jsx';
import { LiveScreen } from './screens/dash/LiveScreen.jsx';
import { StatsScreen } from './screens/dash/StatsScreen.jsx';
import { AirflowScreen } from './screens/tune/AirflowScreen.jsx';
import { FuelScreen } from './screens/tune/FuelScreen.jsx';
import { InjectorsScreen } from './screens/tune/InjectorsScreen.jsx';
import { SensorsScreen } from './screens/tune/SensorsScreen.jsx';
import { SparkScreen } from './screens/tune/SparkScreen.jsx';
import { DataScreen } from './screens/dyno/DataScreen.jsx';
import { LogScreen } from './screens/dyno/LogScreen.jsx';
import { ResultScreen } from './screens/dyno/ResultScreen.jsx';
import { ScoreScreen } from './screens/dyno/ScoreScreen.jsx';

// Guided first run. Walks a new player through the actual working order a tuner
// uses — build the engine, calibrate it, hear it run, then measure it — and then
// gets out of the way. Purely navigational: it never changes the simulation.
const JOURNEY = [
  { tab: 'build', title: 'Step 1 · Build the engine',
    body: 'Open Engine Architecture and design a short block: bore, stroke, compression, cam, springs. Then fit parts under Bolt-Ons. Nothing here is cosmetic — every choice changes how the engine breathes.',
    cta: 'Done building — go tune it', next: 'tune' },
  { tab: 'tune', title: 'Step 2 · Calibrate it',
    body: 'AIR is your airflow log — if it is stale after your build, accept the re-logged values. Then SPARK sets ignition timing and FUEL sets the mixture. The advisories tell you what your hardware will tolerate; the editing is yours.',
    cta: 'Calibration set — start the engine', next: 'live' },
  { tab: 'live', title: 'Step 3 · Start it and listen',
    body: 'Open Live Engine and press START. Watch it idle, hold the throttle to rev it, and watch the sensors and fuel trims respond in real time. This is your calibration actually running.',
    cta: 'Sounds good — put it on the dyno', next: 'dyno' },
  { tab: 'dyno', title: 'Step 4 · Measure it',
    body: 'Run a pull. Then read the Pull Log before you look at the power number — it explains anything that went wrong and what to change. From here the loop is: adjust, pull again, compare.',
    cta: 'Finish — let me explore freely', next: null },
];

function JourneyBanner({ step, onAdvance, onDismiss }) {
  const j = JOURNEY[step];
  if (!j) return null;
  return (
    <div style={{ background: T.accBg, border: `1px solid ${T.acc}`, borderRadius: 12, padding: '13px 14px', margin: '0 0 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: 1, color: T.accInk, fontWeight: 800 }}>{j.title.toUpperCase()}</div>
        <Button variant="quiet" size="sm" style={{ flexShrink: 0 }} onClick={onDismiss}>SKIP GUIDE</Button>
      </div>
      <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.55, marginTop: 7 }}>{j.body}</div>
      <div style={{ display: 'flex', gap: 5, marginTop: 11, marginBottom: 10 }}>
        {JOURNEY.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? T.acc : T.line }} />
        ))}
      </div>
      {/* The closest thing this file has to a justified `block`, and still not one.
          The card looks bounded, but nothing bounds it: index.html lays the app out
          mobile-first and neither the shell nor any tab body sets a max-width, so
          this banner is as wide as the window. `block` here would put a 2500px-wide
          "Done building — go tune it" on a desktop monitor, which is the complaint
          this PR exists to answer. Give the app a max-width first; `block` becomes
          honest the moment a container is genuinely narrow. */}
      <Button onClick={onAdvance}>
        {j.cta}
      </Button>
    </div>
  );
}

function Tach({ rpm, cylinders, running, fullScaleRpm }) {
  const pct = clamp(rpm / fullScaleRpm, 0, 1);
  // fullScaleRpm is redline * 1.1 (see tachFullScaleRpm), so redline itself always
  // sits at pct ≈ 0.909 regardless of engine — the red zone has to start at or just
  // below that, not above it, or the needle never shows red at the engine's own redline.
  const zoneColor = utilisationColor(pct * 100);
  return (
    <Panel style={{ textAlign: 'center', background: T.panel }}>
      <style>{`@keyframes cylpulse{0%,100%{opacity:.25;transform:scaleY(.6)}50%{opacity:1;transform:scaleY(1)}}`}</style>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <DialMark size={168} pct={pct} live={running} />
        <div style={{ position: 'absolute', top: '58%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 800, fontFamily: T.mono, color: T.ink }}>{Math.round(rpm)}</div>
          <div style={{ fontSize: 8.5, color: T.ink3, letterSpacing: 1.5, fontWeight: 700 }}>RPM</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 8, height: 26 }}>
        {Array.from({ length: cylinders }).map((_, i) => (
          <div key={i} style={{
            width: 8, height: 24, borderRadius: 2, background: zoneColor,
            // Duration then delay, both inside the shorthand: `animation` resets
            // `animation-delay`, so declaring the longhand beside it left the
            // per-cylinder stagger dependent on property order.
            animation: running ? `cylpulse ${Math.max(0.12, 50 / Math.max(rpm, 500))}s ${i * (0.5 / cylinders)}s ease-in-out infinite` : 'none',
            opacity: running ? undefined : 0.3,
          }} />
        ))}
      </div>
    </Panel>
  );
}

const TUTORIAL_STEPS = [
  { title: 'This is an air pump',
    body: 'An engine makes power by burning fuel, and it can only burn as much fuel as it has air to burn it with. So everything starts with airflow. The ECU measures the air, decides how much fuel to inject, and picks the moment to light it. Tuning is adjusting those last two decisions.' },
  { title: 'The one equation everything rests on',
    body: 'The ECU works out how much air is in the cylinder using the ideal gas law:\n\n    ρ = MAP ÷ (R × T)\n    airCharge = VE × V_cylinder × ρ\n\nMAP is manifold pressure, T is charge temperature in kelvin, R is a constant for air. VE — volumetric efficiency — is how completely the cylinder fills. That last number is the one you tune on the AIR table.' },
  { title: 'Fuel follows from air, not the other way round',
    body: 'Once air mass is known, fuel is pure arithmetic:\n\n    fuelMass = airCharge ÷ (λ × stoichRatio)\n\nλ (lambda) is your mixture target from the FUEL table. Best power is about λ0.87, richer under boost. stoichRatio is a property of the fuel: 14.7 for gasoline, 9.8 for E85 — which is why E85 needs roughly 1.5× the fuel mass for the same lambda.' },
  { title: 'The ECU commands time, not fuel',
    body: 'It converts fuel mass into an injector pulse width:\n\n    PW = fuelMass ÷ (injectorCC × density ÷ 60000) + deadtime\n    cycleTime = 120000 ÷ RPM\n    duty% = PW ÷ cycleTime × 100\n\nAt 7500 RPM a cycle is only 16 ms. Past about 90% duty there is no time left, and the mixture goes lean no matter what your FUEL table says. That is a physical wall, not a calibration choice.' },
  { title: 'Spark decides how much of that energy you keep',
    body: 'Fuel burns over a few milliseconds, so you light it before top dead center and aim for peak pressure just after. Too early and pressure fights the rising piston; too late and you are burning into an escaping piston.\n\n    timingEff = 1 − 0.0016 × (yourTiming − MBT)²\n\nThat is why the SPARK table changes power without changing a single thing about airflow — it changes how much of the same burn reaches the crank.' },
  { title: 'Where the horsepower number actually comes from',
    body: 'Nothing in this sim adds horsepower directly. Torque is derived last:\n\n    IMEP = fuelMass × LHV × η × timingEff × afrEff ÷ V_cyl\n    BMEP = IMEP − FMEP\n    torque = BMEP × Vd ÷ 4π\n\nη comes from your compression ratio. FMEP is what the engine spends on friction, pumping and valve springs. Change anything upstream and the dyno number changes — exactly like a real engine.' },
  { title: 'Design it on BUILD',
    body: 'Bore, stroke, compression, cam duration, valve springs, materials, turbo, exhaust. None of it is cosmetic — every choice feeds the physics. Change the cam and watch the VE table on TUNE redraw itself, because that is genuinely what changing a cam does to an engine.' },
  { title: 'Three tables, three jobs',
    body: 'On TUNE: AIR (volumetric efficiency — how well each cylinder fills), SPARK (ignition timing in degrees before top dead center), FUEL (target air-fuel ratio). Rows are manifold pressure in kPa, columns are RPM — the same axes real speed-density tuning software uses.' },
  { title: 'Nothing is simulated until you pull',
    body: 'No preview, no live guess. Press RUN DYNO PULL on DYNO and the engine sweeps 1500 RPM to its own redline, producing a real datalog. That is the only way to find out what your changes did — exactly like a real dyno session.' },
  { title: 'Read the log before touching anything',
    body: 'Every pull produces a Pull Log. Each problem gets a plain-language Why (what physically caused it) and a Try (what to change). The datalog next to it shows commanded vs. actual for timing and mixture. A gap between those two columns is the ECU telling you something.' },
  { title: 'Change one thing, then pull again',
    body: 'This is the entire method: one change, one pull, read the log, adjust. The VS. LAST PULL line tells you whether it actually helped. Tuners who change three things at once cannot tell which one worked — and tuners who guess instead of logging break engines.' },
  { title: 'Know what you cannot tune away',
    body: 'Knock, mixture and MAF errors are calibration faults — tables fix them completely. Injectors out of duty cycle, valve float, a compressor past its range: those are physical limits, and the log will tell you so. Recognising which kind you are looking at is most of the skill.' },
  { title: 'You can hear the physics too',
    body: 'Engine sound here is generated from the same numbers, not sampled. Each cylinder firing schedules an exhaust pulse:\n\n    firingHz = RPM ÷ 60 × cylinders ÷ 2\n\nA cross-plane V8 is even at the crank but not down either pipe — each bank fires at 180, 270, 180 and 90 degrees — and that irregular spacing is what makes it rumble. A V6 fires evenly and rings hard and hornlike. A four fires only twice per revolution, so you hear each pulse separately.\n\nRetard the timing and it turns raspy, because the charge is still burning into the exhaust. Richen it and it softens. Fit a big cam and it lopes. Add a turbo to a small engine and induction noise takes over. Tuners diagnose by ear for a reason — the sound is data.' },
  { title: 'Where this physics comes from',
    body: 'Every relation in this simulator is standard published engineering, and each figure has been checked against a source rather than assumed.\n\nMIT OpenCourseWare 8.21 gives the Otto-cycle efficiency and, critically, the value of gamma to use: about 1.3 for combustion products at cycle temperature, which yields 50% ideal efficiency at a 10:1 compression ratio. This app originally used 1.35 and was corrected to match.\n\nNASA Glenn provides the underlying pressure and temperature relations that efficiency formula derives from. x-engineer.org confirms the foundation the whole model rests on: one engine cycle is two crank rotations, and only the power stroke produces energy.\n\nEvery formula was also checked for unit consistency. Air density resolves to 1.185 kg/m3 at sea level and 25 C against a published 1.184, and injector cycle time derives exactly from two crank revolutions.\n\nThe full source list, including what checking them changed, is under Learn on the HOME tab. If a number here looks wrong to you, go and check it — that instinct has already corrected real errors in this simulator.' },
  { title: 'Chase the score',
    body: 'Every pull grades Tuning (how clean the calibration is) and Engineer (how sound the hardware choices are), then combines them with actual output into an uncapped Pull Score. A big, slightly dirty pull can beat a small spotless one — the same tension a real tuner balances.' },
];

// ============================================================
/**
 * The application body. Exported so a caller can mount it inside its OWN
 * `<StoreProvider>` and share the store with it — which is how the tests reach
 * build states this component's own guards cannot produce on their own (see
 * tests/ui/build-store.test.jsx). The default export below is the same component
 * with a provider already around it, and is what the app and most tests use.
 * @returns {React.ReactElement}
 */
export function EcuLabApp() {
  // Navigation lives in the URL, not in state. `appView`, `tab` and the four section
  // hooks that used to sit here are all one `route` now — see src/ui/routing.js.
  const [route, navigate] = useRoute();
  const appView = route.view;
  const tab = route.tab;
  // The BUILD slice — hardware and ECU configuration — lives in the store. Destructured
  // so every READ site below stays a bare `engineConfig` / `mods` / ...; only the WRITES
  // changed, from setters to dispatches. All three domain slices are in the store now.
  const [build, dispatch] = useBuild();
  const {
    engineConfig, mods, turboOn, boostCurve, octaneIdx, injIdx, mafScalar,
    turbineIdx, turbineCount, compressorIdx, exhaustDiaIdx, ecuInjectorCc,
    presetId,
  } = build;
  // `presetPrompt` and `boostSel` are read from the store directly by EngineScreen
  // and InductionScreen now — neither is a shell-level derivation, so there is
  // nothing to destructure here once their one call site each moved with them.
  //
  // The TUNE slice — calibration tables, the unsaved-work flag, and the grid cursor.
  // Same destructuring shape as `build` above; `dispatch` is the SAME function
  // useBuild() returned (one reducer, one useReducer call — see StoreProvider.jsx),
  // so it is not re-bound here.
  const [tune] = useTune();
  const { ve, timing, afr } = tune;
  // `tablesDirty` is read from the store directly by EngineScreen now (it is
  // `hasTuningWork()`'s one input) — nothing else in the shell reads it.
  // `selection` itself is read from the store directly by AirflowScreen/SparkScreen/
  // FuelScreen now — the shell only still needs `setSelection` below, to clear the
  // cursor on tab/view navigation, which is nav-adjacent and stays here.
  // The SESSION slice — everything about the current run and career progress that is
  // neither hardware nor calibration. Same destructuring shape again, same `dispatch`.
  // There is no local `useState` left in this file: `appView`, `tab`, `buildSection`,
  // `tuneView`, `dynoView` and `dashSection` were VIEW state (which screen and which
  // accordion panel is open) and have all moved into the URL — see `useRoute()` above
  // and `route.section`, narrowed per tab, just below.
  const [session] = useSession();
  const {
    loadKpa, soundOn, journeyStep, throttleInput, health,
    result, prevResult, running, revealCount, bestScore, totalScore, pullCount,
    live,
    activeJob, completedJobs, jobResult,
  } = session;
  // One `route.section` serves all four tabs, narrowed per tab so every call site below
  // keeps reading the name it always read — and so a later task can move a tab's markup
  // into a screen file without renaming anything. The narrowing is not decorative:
  // `tab` is the only thing that says which tab a section belongs to.
  //
  // `null` is a REAL value here, not "unset". Each of these is null while that tab's
  // accordion is fully collapsed, which is the state clicking an open section's own
  // header produces (see `toggleSection`) and the state `#/build` — a tab with no
  // section segment — spells. Defaulting it to a section would make closing impossible,
  // and no existing test would fail.
  const buildSection = tab === 'build' ? route.section : null;
  const tuneView = tab === 'tune' ? route.section : null;
  const dynoView = tab === 'dyno' ? route.section : null;
  const dashSection = tab === 'dash' ? route.section : null;
  const liveSection = tab === 'live' ? route.section : null;
  const revealTimer = useRef(null);
  const liveTimer = useRef(null);
  const liveCfgRef = useRef(null);
  const throttleRef = useRef(0);
  const audioRef = useRef(null);

  // `withPresetField` is gone: SET_BUILD_FIELD clears `presetId` itself, so the
  // invalidation now happens inside the reducer rather than in a wrapper each new
  // hardware field had to remember to be threaded through. The one hand-edit path that
  // used to cross the build/tune boundary in two local calls (`clearPresetId` then
  // `setTablesDirty(true)`) is now the single SET_TABLE action, which clears `presetId`
  // and flags unsaved work in the SAME reducer pass — see reducer.js. `withTableEdit`
  // and its three derived setters (`setVeEdited`/`setTimingEdited`/`setAfrEdited`) are
  // gone; every table-edit call site below dispatches SET_TABLE directly.
  //
  // `CLEAR_PRESET_ID` (touches `presetId` alone, no `tablesDirty` side effect) is
  // dispatched from EngineScreen now — its one caller, the preset picker's "Custom
  // build" option, moved there with the rest of the Engine Architecture section.
  // The build-side analogue of a table edit is a cursor, not a calibration edit:
  // `SET_TUNE_FIELD` deliberately does NOT clear `presetId` or flag `tablesDirty`
  // (see reducer.js), so moving the highlighted grid cell never disowns a loaded
  // preset.
  const setSelection = (value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value });

  const octaneBonus = OCTANE_OPTS[octaneIdx].bonus;
  const engineDerived = useMemo(() => deriveEngine(engineConfig), [engineConfig]);
  // The live tach needle used to top out at a hardcoded 7500 — correct only for the
  // one preset whose redline happened to match it. Key it off this engine's own
  // redline instead, with headroom sized for what it actually needs to show: the
  // tach has to leave room for the rev limiter's overshoot bounce (liveStep cuts
  // fuel at redline + 100 RPM) without pegging. (DYNO's own chart axis does the
  // equivalent thing with tighter headroom — see ResultScreen.jsx.)
  const tachFullScaleRpm = engineDerived.redline * 1.1;
  const idealExhaustDia = useMemo(() => idealExhaustDiameter(engineDerived.displacementL, turboOn ? Math.max(...boostCurve) : 0), [engineDerived, turboOn, boostCurve]);
  const exhaustDiaError = EXHAUST_DIA_OPTS[exhaustDiaIdx].dia - idealExhaustDia;
  const mafErrorBase = useMemo(() => {
    let e = 1.0;
    if (mods.intake) e *= 0.90;
    if (turboOn) e *= 0.92;
    return e;
  }, [mods.intake, turboOn]);

  const fuel = OCTANE_OPTS[octaneIdx];
  const injectorCc = INJECTOR_OPTS[injIdx].cc;

  // Every hardware choice that physically changes how the engine breathes feeds the
  // VE table: bore/stroke, cylinder count, compression, cam duration, valve springs,
  // head material, bolt-ons, exhaust diameter, turbine backpressure, and the fuel's
  // charge-cooling effect.
  //
  // The table is NEVER rewritten silently. Changing hardware leaves your logged VE
  // stale — exactly as it would in a real shop, where the old log does not update
  // itself because you bolted something on. The VE tab shows what changed and by how
  // much, and you choose when to accept it.
  // The turbine as actually fitted, count included. EVERY consumer below reads this
  // rather than indexing TURBINE_OPTS directly, so a twin-turbo preset cannot be
  // simulated as a single housing.
  const turbine = useMemo(
    () => turbineWithCount(TURBINE_OPTS[turbineIdx], turbineCount),
    [turbineIdx, turbineCount],
  );

  const hwForVe = useMemo(() => ({
    turboOn,
    turbine: turboOn ? turbine : null,
    exhaustDia: EXHAUST_DIA_OPTS[exhaustDiaIdx].dia,
    fuel,
    peakBoostPsi: turboOn ? Math.max(...boostCurve) : 0,
  }), [turboOn, turbine, exhaustDiaIdx, fuel, boostCurve]);

  // TRUE cylinder filling for the hardware as currently built. The player's `ve` table
  // is only the ECU's BELIEF about this; the gap between the two is what makes the
  // mixture drift off target and what the fuel-trim histogram measures and corrects.
  const veTruth = useMemo(
    () => computeHardwareVE(engineConfig, mods, hwForVe),
    [engineConfig, mods, hwForVe],
  );

  // `recalcVE` moved into AirflowScreen — its one caller — where it dispatches off this
  // same `veTruth`, passed down as a prop since it also feeds `calAdvice` below and
  // the dyno payload.

  /**
   * Takes on a career job: resets the car to stock, then applies that customer's fault.
   *
   * @param {number} i index into {@link CAREER_JOBS}
   */
  const takeJob = (i) => {
    const job = CAREER_JOBS[i];
    const cfg = { ...DEFAULT_ENGINE_CONFIG };
    if (job.setup.camDuration) cfg.camDuration = job.setup.camDuration;
    if (job.setup.springRate) cfg.springRate = job.setup.springRate;
    const nextMods = { ...DEFAULT_MODS, intake: !!job.setup.intake };
    const nextTurbo = !!job.setup.turboOn;
    const hw = {
      turboOn: nextTurbo,
      turbine: nextTurbo ? turbineWithCount(TURBINE_OPTS[1], 1) : null,
      exhaustDia: EXHAUST_DIA_OPTS[exhaustDiaIdx].dia,
      fuel: OCTANE_OPTS[job.setup.octaneIdx ?? 0],
    };
    // ONE action, not fifteen writes. A half-applied job is a car with the customer's
    // fault fitted and the previous job's tables still loaded, which is not a car anyone
    // was handed — see TAKE_JOB in reducer.js. The stock timing and fuel tables, full
    // health and the cleared bench are the reducer's to set; the hardware and the VE
    // table are computed here because they need `computeHardwareVE`.
    dispatch({
      type: ACTIONS.TAKE_JOB,
      index: i,
      build: {
        engineConfig: cfg,
        mods: nextMods,
        turboOn: nextTurbo,
        boostCurve: job.setup.boostCurve ? [...job.setup.boostCurve] : [...DEFAULT_BOOST],
        octaneIdx: job.setup.octaneIdx ?? 0,
        injIdx: job.setup.injIdx ?? 0,
        ecuInjectorCc: job.setup.ecuInjectorCc ?? INJECTOR_OPTS[job.setup.injIdx ?? 0].cc,
      },
      // A "stale VE" job hands you the OLD log against new hardware, which is the whole
      // point of it: the table is a record of what the engine used to flow.
      ve: job.setup.staleVe
        ? computeHardwareVE(DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, {
          turboOn: false, turbine: null, exhaustDia: EXHAUST_DIA_OPTS[exhaustDiaIdx].dia,
          fuel: OCTANE_OPTS[0],
        })
        : computeHardwareVE(cfg, nextMods, hw),
    });
    changeTab('dyno');
  };

  /** Puts the active job down without grading it. */
  const abandonJob = () => {
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'activeJob', value: null });
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'jobResult', value: null });
  };

  const calAdvice = useMemo(() => calibrationAdvice({
    ve, veTruth, timing, afr, derived: engineDerived, octaneBonus, fuel, mods, turboOn, boostCurve,
    compressor: COMPRESSOR_OPTS[compressorIdx],
    injectorCc, ecuInjectorCc, mafScalar, mafErrorBase,
  }), [ve, veTruth, timing, afr, engineDerived, octaneBonus, fuel, mods, turboOn, boostCurve,
       compressorIdx, injectorCc, ecuInjectorCc, mafScalar, mafErrorBase]);

  const veAdvice = useMemo(
    () => veRecommendations(ve, engineConfig, mods, hwForVe),
    [ve, engineConfig, mods, hwForVe]
  );

  // Same real-units chain the sim uses, evaluated at WOT / 6500 RPM as a preview.
  const dutyPreview = useMemo(() => {
    const rpm = 6500;
    const boostPsi = turboOn ? boostCurve[RPM.indexOf(6500)] : 0;
    const mapKpa = BARO_KPA + boostPsi * PSI_TO_KPA;
    const chargeK = chargeTempK(boostPsi, mods.intercooler);
    const vCylM3 = (engineDerived.displacementL / engineDerived.cyl) / 1000;
    const airDensity = (mapKpa * 1000) / (R_AIR * chargeK);
    const airChargeG = (interp2(ve, rpm, mapKpa) / 100) * vCylM3 * airDensity * 1000;
    const lambda = interp2(afr, rpm, mapKpa) / 14.7;
    const fuelMassG = airChargeG / (lambda * fuel.stoich);
    const pw = fuelMassG / ((ecuInjectorCc * fuel.density) / 60000) + INJ_DEADTIME_MS;
    return clamp((pw / (120000 / rpm)) * 100, 0, 220);
  }, [ve, afr, turboOn, boostCurve, ecuInjectorCc, fuel, mods.intercooler, engineDerived]);
  // `dutyDangerous` moved into InjectorsScreen — its one reader — computed there off
  // this same `dutyPreview`, which stays here because the score breakdown and dyno
  // payload below also read it.

  const needsMafRecal = mods.intake || turboOn;
  /** Open a tab at its first section — what a tab button means. */
  const goTab = (t) => navigate({ view: 'app', tab: t, section: ROUTES[t][0] });
  /** Open a specific section of a tab. */
  const goSection = (t, sec) => navigate({ view: 'app', tab: t, section: sec });
  // Screens live in their own files, and some are memoised (LearnScreen today; any
  // BUILD/TUNE/DYNO screen that earns it tomorrow), so their `onToggle` prop has to be
  // REFERENTIALLY STABLE or the memo never bails out. A plain closure over
  // `route.section` is a new function every render — including the twenty a second the
  // live engine causes — which is why `sectionRef` exists: it is written during render
  // (like `liveCfgRef`/`throttleRef` below) and read only from a click handler, so it
  // cannot be stale by the time one fires.
  //
  // `makeToggleSection` is that pattern generalised to all four tabs instead of copied
  // once per tab: it hands back one cached closure per tab id, built once and reused
  // for the component's life, so `toggleBuildSection` below and `toggleDashSection`
  // are both stable — and a TUNE or DYNO screen that wants the same stability later
  // just calls `makeToggleSection('tune')` / `makeToggleSection('dyno')` rather than
  // getting a fifth hand-written copy of this closure.
  const sectionRef = useRef(route.section);
  sectionRef.current = route.section;
  const toggleCacheRef = useRef(/** @type {Record<string, (sec: string|null) => void>} */ ({}));
  // `[navigate]` documents what this closure reads, but the cache does not actually
  // respect it: once a tab's closure is built, `toggleCacheRef` keeps serving that
  // exact closure for the component's life, even if `navigate` were later to change
  // identity. That is only safe because `useRoute` guarantees `navigate` never does
  // — it is `useCallback(..., [])` (see `useRoute.js`), permanently stable — so the
  // dependency is inert in practice. Kept rather than dropped to `[]` because it is
  // still the accurate list of what the closure reads; the note above is what
  // resolves the apparent inconsistency.
  const makeToggleSection = useCallback((t) => {
    if (!toggleCacheRef.current[t]) {
      toggleCacheRef.current[t] = (sec) => navigate({
        view: 'app', tab: t, section: sectionRef.current === sec ? null : sec,
      });
    }
    return toggleCacheRef.current[t];
  }, [navigate]);
  const toggleDashSection = makeToggleSection('dash');
  const toggleBuildSection = makeToggleSection('build');
  const toggleLiveSection = makeToggleSection('live');
  const goTutorial = () => navigate({ view: 'tutorial', tab: null, section: null });
  // `AppShell`'s `SideNav` is `React.memo`'d and reads no store, so at 20 Hz it only
  // stays skipped if `onNavigate` is referentially stable — see AppShell.jsx's header.
  // `goTab`/`setSelection` above are plain closures rebuilt every render, so calling
  // them from here would still make a new `changeTab` on every render even inside a
  // `useCallback`; the body is inlined against `navigate` and `dispatch` instead,
  // which are each stable for the life of the store (see the `[dispatch]` and
  // `[navigate]` notes elsewhere in this file), so this closure is genuinely stable
  // for the component's life, the same guarantee `makeToggleSection` gives its
  // per-tab closures above.
  const changeTab = useCallback((t) => {
    navigate({ view: 'app', tab: t, section: ROUTES[t][0] });
    dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value: null });
  }, [navigate, dispatch]);

  const resetToStock = () => {
    // Wipes the calibration back to a generic stock baseline — which, if a factory
    // preset was loaded, is NOT that preset's validated tables, so RESET_TO_STOCK
    // drops the preset label with it and pins tablesDirty back to false in the same
    // pass: a reset baseline is not unsaved player work.
    //
    // The reducer does NOT compute the stock VE table; the caller does, and the mix of
    // arguments is the point: DEFAULT_MODS (the bolt-ons come off) against the CURRENT
    // `hwForVe` (the turbo does not — resetting the calibration is not uninstalling the
    // hardware). Either half swapped for the other yields a perfectly plausible table
    // that is wrong.
    const stockVe = computeHardwareVE(engineConfig, DEFAULT_MODS, hwForVe);
    dispatch({ type: ACTIONS.RESET_TO_STOCK, ve: stockVe });
  };
  // The REPAIR button's only handler. Before the extraction this wrote a local
  // `health` that the store never saw, while REPAIR_ENGINE sat in the reducer with no
  // caller at all — so this is an ADDED dispatch, not a converted one. Drop it and the
  // button goes inert with nothing raising an error: see tests/ui/session-store.test.jsx.
  const repairEngine = () => dispatch({ type: ACTIONS.REPAIR_ENGINE });

  const ensureAudio = () => {
    if (audioRef.current) return audioRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      const ctx = new Ctx();
      const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);

      // An exhaust note is a PULSE TRAIN, not a smooth wave — each cylinder fires a
      // sharp pressure spike. Building a periodic wave with many harmonics falling
      // off ~1/n gives that pulse character, which sounds far more like an engine
      // than a raw sawtooth does.
      const N = 24;
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let n = 1; n < N; n++) { re[n] = 0; im[n] = (1 / n) * Math.exp(-n / 14); }
      const pulseWave = ctx.createPeriodicWave(re, im, { disableNormalization: false });

      // Two slightly detuned pulse oscillators — real engines never hold a perfectly
      // pure pitch, and the beating between them is what stops it sounding synthetic.
      const oscA = ctx.createOscillator(); oscA.setPeriodicWave(pulseWave); oscA.frequency.value = 40;
      const oscB = ctx.createOscillator(); oscB.setPeriodicWave(pulseWave); oscB.frequency.value = 40; oscB.detune.value = 9;
      const oscG = ctx.createGain(); oscG.gain.value = 0.5;
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 20;
      const subG = ctx.createGain(); subG.gain.value = 0.35;

      // Exhaust system: a resonant body plus an overall lowpass.
      const body = ctx.createBiquadFilter(); body.type = 'bandpass'; body.frequency.value = 320; body.Q.value = 0.9;
      const bodyG = ctx.createGain(); bodyG.gain.value = 0.8;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 2;
      filter.connect(master); body.connect(bodyG); bodyG.connect(master);
      oscA.connect(oscG); oscB.connect(oscG); oscG.connect(filter); oscG.connect(body);
      sub.connect(subG); subG.connect(filter);

      const bufLen = 2 * ctx.sampleRate;
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const dch = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) dch[i] = (Math.random() * 2 - 1) * 0.35;

      // Combustion roughness, amplitude-modulated at the firing rate so the noise
      // arrives in pulses rather than as constant hiss.
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const ng = ctx.createGain(); ng.gain.value = 0.04;
      const pulseLfo = ctx.createOscillator(); pulseLfo.type = 'sawtooth'; pulseLfo.frequency.value = 40;
      const pulseDepth = ctx.createGain(); pulseDepth.gain.value = 0.03;
      pulseLfo.connect(pulseDepth); pulseDepth.connect(ng.gain);
      noise.connect(ng); ng.connect(filter);

      // LOPE: valve overlap makes combustion inconsistent cylinder-to-cylinder at
      // idle, so output surges and dips at a slow sub-multiple of the firing rate.
      // That uneven pulsing is the classic cammed idle.
      const lopeLfo = ctx.createOscillator(); lopeLfo.type = 'triangle'; lopeLfo.frequency.value = 6;
      const lopeDepth = ctx.createGain(); lopeDepth.gain.value = 0;
      lopeLfo.connect(lopeDepth); lopeDepth.connect(master.gain);
      lopeLfo.start();

      const indG = ctx.createGain(); indG.gain.value = 0;
      const indFilt = ctx.createBiquadFilter(); indFilt.type = 'bandpass'; indFilt.frequency.value = 1800; indFilt.Q.value = 1.2;
      const noise2 = ctx.createBufferSource(); noise2.buffer = buf; noise2.loop = true;
      noise2.connect(indFilt); indFilt.connect(indG); indG.connect(master);

      const whistle = ctx.createOscillator(); whistle.type = 'sine'; whistle.frequency.value = 3000;
      const whistleG = ctx.createGain(); whistleG.gain.value = 0;
      whistle.connect(whistleG); whistleG.connect(master);
      const bovFilt = ctx.createBiquadFilter(); bovFilt.type = 'bandpass'; bovFilt.frequency.value = 2600; bovFilt.Q.value = 0.8;
      const bovG = ctx.createGain(); bovG.gain.value = 0;
      const noise3 = ctx.createBufferSource(); noise3.buffer = buf; noise3.loop = true;
      noise3.connect(bovFilt); bovFilt.connect(bovG); bovG.connect(master);

      oscA.start(); oscB.start(); sub.start(); noise.start(); noise2.start(); noise3.start(); pulseLfo.start();
      audioRef.current = { ctx, oscA, oscB, oscG, sub, subG, master, filter, body, bodyG, ng, pulseLfo, lopeLfo, lopeDepth, indG, whistle, whistleG, bovG };
      return audioRef.current;
    } catch { return null; }
  };

  // The live panel's sound button. The audio context has to be resumed from the same
  // user gesture that switches sound on — browsers will not start one otherwise — so
  // this cannot live in the screen: `ensureAudio` and the context it builds are the
  // shell's.
  const toggleSound = () => {
    if (!soundOn) ensureAudio()?.ctx.resume();
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'soundOn', value: !soundOn });
  };

  // Persistence goes through the storage adapter, which picks whichever backend is
  // available (artifact host, localStorage, or in-memory) so career stats survive a
  // refresh wherever the app is deployed.
  const persistCareer = (best, total, pulls) => saveCareer({ best, total, pulls });

  const doRun = () => {
    const a = ensureAudio();
    if (a && a.ctx.state === 'suspended') a.ctx.resume();
    // The reveal animation's own state: `running` gates the RUN button's label and the
    // partial chart, `revealCount` is how much of the sweep has been drawn so far.
    // Neither has an ordering hazard (unlike the banking tail below, which BANK_PULL
    // owns), so they stay plain field writes.
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'running', value: true });
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'revealCount', value: 0 });
    const r = simulateSweep({
      loadKpa, ve, veTruth, timing, afr, turboOn, boostCurve, octaneBonus, octaneLabel: OCTANE_OPTS[octaneIdx].label,
      fuel, injectorCc, ecuInjectorCc, injectorLabel: INJECTOR_OPTS[injIdx].label, mods, mafScalar, derived: engineDerived,
      turbine, compressor: COMPRESSOR_OPTS[compressorIdx],
    });
    const ts = computeTuningScore(r);
    const es = computeEngineerScore({
      engineConfig, turboOn, peakBoostPsi: turboOn ? Math.max(...boostCurve) : 0,
      turbine, compressor: COMPRESSOR_OPTS[compressorIdx],
      exhaustDiaError, dutyPreview, displacementL: engineDerived.displacementL, fuel, mods,
    });
    const pull = computePullScore({ peakHp: r.peakHp, peakTq: r.peakTq, tuningScore: ts.score, engineerScore: es.score });
    // A career job is graded against the pull that was just measured, not against the
    // build as it stands — same rule as the scores themselves.
    if (activeJob != null) {
      const passed = CAREER_JOBS[activeJob].goal(r, { tuningScore: ts.score, engineerScore: es.score });
      dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'jobResult', value: passed ? 'pass' : 'fail' });
      if (passed && !completedJobs.includes(activeJob)) {
        dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'completedJobs', value: [...completedJobs, activeJob] });
      }
    }
    // Banking the pull — prevResult rotation, wear, scores, pull count — lands in the
    // store in one pass. `result` and `pullScore` are precomputed here because the
    // reducer has no access to the useMemo-derived hardware `computePullScore` needs.
    // The local `setPrevResult`/`setResult`/`setHealth` calls that used to sit above
    // this line, and the `setBestScore`/`setTotalScore`/`setPullCount` trio below it,
    // were all mirroring writes this one action already makes — including the
    // prevResult-before-result rotation whose ordering it exists to own.
    dispatch({ type: ACTIONS.BANK_PULL, result: r, pullScore: pull });
    // BANK_PULL writes bestScore/totalScore/pullCount itself, from the same three
    // expressions. They are still computed here because `persistCareer` needs the new
    // values NOW: reading them back off `session` would read this render's stale ones.
    const nextBest = Math.max(bestScore, pull);
    const nextTotal = totalScore + pull;
    const nextPulls = pullCount + 1;
    persistCareer(nextBest, nextTotal, nextPulls);
    const total = r.points.length;
    let i = 0;
    revealTimer.current = setInterval(() => {
      i += Math.ceil(total / 30);
      // `i` is the interval's own counter, not a read of `revealCount`, so there is no
      // stale-closure hazard in carrying the value on the action.
      dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'revealCount', value: Math.min(i, total) });
      if (i >= total) { clearInterval(revealTimer.current); dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'running', value: false }); }
    }, 55);
  };
  useEffect(() => () => { if (revealTimer.current) clearInterval(revealTimer.current); }, []);

  // Keep the live-engine config in a ref so the loop always uses current tuning
  // without needing to restart the interval every time a table changes.
  liveCfgRef.current = {
    ve, veTruth, timing, afr, derived: engineDerived, fuel, injectorCc, ecuInjectorCc, mods, mafScalar, mafErrorBase,
    turboOn, boostCurve, octaneBonus, turbine,
    compressor: COMPRESSOR_OPTS[compressorIdx], exhaustDiaError,
  };
  throttleRef.current = throttleInput;

  // The engine runs continuously in the background at 20 Hz, integrating real
  // crankshaft dynamics and running one ECU control pass per step.
  //
  // The step itself happens in the REDUCER, not here. This interval is installed once
  // and never re-created, so its callback closes over the `live` of the first render
  // forever — computing `liveStep(live, ...)` here and dispatching the result would
  // integrate from a permanently frozen engine-off state, and the readout would sit
  // dead or jitter between two adjacent steps. That reads as a physics bug, not a
  // state bug. The old `setLive((prev) => ...)` functional form has no action
  // equivalent (actions must not carry functions), so LIVE_STEP carries only the two
  // things the reducer cannot see — the driver input and the current tune — and
  // resolves `prev` against the store. Both come from REFS, which are current at every
  // tick, so nothing stale reaches the engine.
  useEffect(() => {
    liveTimer.current = setInterval(() => {
      dispatch({
        type: ACTIONS.LIVE_STEP,
        dt: 0.05,
        input: { throttle: throttleRef.current, load: 0 },
        cfg: liveCfgRef.current,
      });
    }, 50);
    return () => clearInterval(liveTimer.current);
    // Stable for the life of the store, so the interval is still installed exactly once
    // — re-creating it would restart the engine's 20 Hz clock on every render.
  }, [dispatch]);

  // The throttle pad's three pointer handlers. `throttleRef` is what the 20 Hz loop
  // actually reads (the interval is installed once and never sees a re-render), so the
  // dispatch and the ref write are one operation and belong together in the shell that
  // owns the ref.
  const setThrottleInput = (value) => {
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'throttleInput', value });
    throttleRef.current = value;
  };

  // ---- Engine audio -------------------------------------------------------
  // Synthesised from the firing frequency: a 4-stroke fires cyl/2 times per
  // crank revolution, so pitch tracks RPM and cylinder count exactly. A lowpass
  // that opens with throttle gives the "load" character — closed throttle is
  // muffled, wide open is bright and raspy.
  const startEngine = () => {
    const a = ensureAudio();
    if (a && a.ctx.state === 'suspended') a.ctx.resume();
    dispatch({ type: ACTIONS.LIVE_PATCH, patch: { cranking: true } });
  };
  const stopEngine = () => {
    setThrottleInput(0);
    dispatch({ type: ACTIONS.LIVE_PATCH, patch: { running: false, cranking: false } });
  };

  // Safety net: if a pointerup/cancel is missed (scroll, app switch, lost focus)
  // the throttle must still close, or the engine would hang at redline.
  useEffect(() => {
    const release = () => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'throttleInput', value: 0 }); throttleRef.current = 0; };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    };
    // `dispatch` is stable for the life of the store (useReducer guarantees it), so
    // this effect still installs its listeners exactly once — the dependency is here
    // to satisfy exhaustive-deps honestly rather than to make the effect re-run.
  }, [dispatch]);

  // Career stats persist across sessions so the high score is worth chasing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCareer();
      if (cancelled) return;
      dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'bestScore', value: c.best });
      dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'totalScore', value: c.total });
      dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'pullCount', value: c.pulls });
    })();
    return () => { cancelled = true; };
    // Stable for the life of the store, so this still loads career stats exactly once.
  }, [dispatch]);

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.points.slice(0, running ? revealCount : result.points.length).map((p, i) => ({
      rpm: p.rpm, hp: p.hp, torque: p.torque, afr: p.afr, afrCommanded: p.afrCommanded,
      timing: p.timing, commandedTiming: p.commandedTiming, duty: p.duty, trimPct: p.trimPct,
      prevHp: prevResult?.points?.[i]?.hp, prevTorque: prevResult?.points?.[i]?.torque,
    }));
  }, [result, prevResult, running, revealCount]);

  // `buildHistogram`/`applyHistogram` moved to DataScreen.jsx: DYNO's DATALOG
  // section was their only caller, and everything they touch (result, histogram,
  // ve) is plain store state DataScreen can read for itself.

  const currentRpm = result ? (result.points[Math.min(revealCount, result.points.length - 1)]?.rpm ?? 1500) : 1500;
  const scores = useMemo(() => {
    if (!result || running) return null;
    const tuning = computeTuningScore(result);
    const engineer = computeEngineerScore({
      engineConfig, turboOn, peakBoostPsi: turboOn ? Math.max(...boostCurve) : 0,
      turbine, compressor: COMPRESSOR_OPTS[compressorIdx],
      exhaustDiaError, dutyPreview, displacementL: engineDerived.displacementL, fuel, mods,
    });
    const pull = computePullScore({ peakHp: result.peakHp, peakTq: result.peakTq, tuningScore: tuning.score, engineerScore: engineer.score });
    return { tuning, engineer, pull };
  }, [result, running, engineConfig, turboOn, turbine, compressorIdx, exhaustDiaError, dutyPreview, engineDerived, fuel, mods, boostCurve]);

  // Drive the audio from whichever engine is actually turning — and only while the
  // relevant page is open, so sound stops the moment you navigate away.
  const prevBoostRef = useRef(0);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const t = a.ctx.currentTime;

    const onDyno = tab === 'dyno' && running && result;
    // Which screen the running engine is heard on.
    const onLive = tab === 'live' && (live.running || live.cranking);
    // And whether it is heard at all: one of those two has to be on screen.
    const audible = onDyno || onLive;

    const rpm = onDyno ? currentRpm : live.rpm;
    const dynoPt = onDyno ? result.points[Math.min(revealCount, result.points.length - 1)] : null;
    const load = onDyno ? 1 : clamp((live.effThrottle ?? 0) / 100, 0, 1);
    const boostNow = onDyno ? (dynoPt?.boostPsi ?? 0) : (live.live?.boostPsi ?? 0);
    const cut = onLive ? live.fuelCut : false;

    const cyl = engineDerived.cyl;
    const fire = Math.max(6, (rpm / 60) * (cyl / 2));
    a.oscA.frequency.setTargetAtTime(fire, t, 0.02);
    a.oscB.frequency.setTargetAtTime(fire, t, 0.02);
    a.sub.frequency.setTargetAtTime(fire / 2, t, 0.02);
    a.pulseLfo.frequency.setTargetAtTime(fire, t, 0.02);

    // Layout character. A four is rough and buzzy (wider detune, more upper content);
    // a V8 leans on its low-order rumble; a six sits between.
    const isFour = cyl === 4, isEight = cyl === 8;
    a.oscB.detune.setTargetAtTime(isFour ? 16 : isEight ? 6 : 9, t, 0.2);
    a.oscG.gain.setTargetAtTime(isFour ? 0.55 : isEight ? 0.42 : 0.50, t, 0.1);
    a.subG.gain.setTargetAtTime(isFour ? 0.20 : isEight ? 0.58 : 0.35, t, 0.1);
    a.body.frequency.setTargetAtTime(isEight ? 240 : isFour ? 420 : 320, t, 0.15);

    // Exhaust diameter: a bigger pipe is louder, deeper and less restricted.
    const dia = EXHAUST_DIA_OPTS[exhaustDiaIdx].dia;
    const diaOpen = 0.72 + (dia - 2.5) * 0.20;
    const catBack = mods.exhaust || mods.headers;
    a.filter.frequency.setTargetAtTime((300 + fire * 7 + load * 2400) * diaOpen, t, 0.05);
    a.filter.Q.setTargetAtTime(isFour ? 3.2 : isEight ? 1.8 : 2.4, t, 0.1);
    a.bodyG.gain.setTargetAtTime(0.5 + (dia - 2.5) * 0.22, t, 0.15);

    a.indG.gain.setTargetAtTime(mods.intake && audible ? load * 0.055 * (rpm / 7500 + 0.3) : 0, t, 0.06);

    if (turboOn) {
      a.whistle.frequency.setTargetAtTime(1400 + (rpm / 7500) * 5200, t, 0.08);
      a.whistleG.gain.setTargetAtTime(audible ? Math.min(0.05, boostNow * 0.006) * load : 0, t, 0.08);
      if (prevBoostRef.current > 3 && load < 0.15 && audible) {
        a.bovG.gain.cancelScheduledValues(t);
        a.bovG.gain.setValueAtTime(0.09, t);
        a.bovG.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      }
      prevBoostRef.current = boostNow;
    } else {
      a.whistleG.gain.setTargetAtTime(0, t, 0.1);
      prevBoostRef.current = 0;
    }

    // Lope is loudest at idle and washes out as revs rise and combustion evens up.
    const overlap = engineDerived.overlapDeg || 0;
    const lopeRate = clamp(fire / 6, 2.5, 14);
    a.lopeLfo.frequency.setTargetAtTime(lopeRate, t, 0.15);
    const lopeStrength = audible && overlap > 2 && rpm < 2200
      ? Math.min(0.085, overlap * 0.0022) * clamp(1 - (rpm - 800) / 1600, 0.15, 1)
      : 0;
    a.lopeDepth.gain.setTargetAtTime(lopeStrength, t, 0.12);

    a.ng.gain.setTargetAtTime(live.cranking && onLive ? 0.12 : 0.03 + load * 0.045, t, 0.05);
    const vol = cut ? 0.012 : 0.05 + load * 0.11;
    a.master.gain.setTargetAtTime(audible && soundOn ? vol * (catBack ? 1.18 : 1) : 0, t, cut ? 0.015 : 0.06);
  }, [live.rpm, live.running, live.cranking, live.effThrottle, live.fuelCut, live.live, soundOn,
      engineDerived.cyl, exhaustDiaIdx, mods.intake, mods.exhaust, mods.headers, turboOn,
      running, currentRpm, revealCount, result, tab, engineDerived.overlapDeg]);

  // Hard-stop audio on unmount or when the tab changes away from a sounding page.
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) { try { a.master.gain.setTargetAtTime(0, a.ctx.currentTime, 0.02); } catch { /* noop */ } }
    };
  }, [tab]);

  // `engineName`/`overallColor` are gone: both were the header's, and the header is
  // gone with them — `StatusStrip` in AppShell.jsx now derives the same figures from
  // the store itself rather than being handed them from here (see that file's header
  // for why it reads the store directly instead of taking props). `overallHealth`
  // stays: HealthScreen below still reads it as a prop.
  const overallHealth = Math.min(health.piston, health.bearing, health.valve);
  const activePreset = presetId ? presetById(presetId) : null;

  // The four top-level destinations moved into AppShell.jsx's NAV_ITEMS — one
  // definition for the section nav rather than this file's copy and the shell's.
  // TUNE's own sub-view switcher below is unrelated: it is a second level of
  // navigation inside the TUNE tab, not the tabs themselves.
  const TUNE_VIEWS = [
    { id: 'airflow', label: 'AIRFLOW', icon: Grid3x3 },
    { id: 'spark', label: 'SPARK', icon: Zap },
    { id: 'fuel', label: 'FUEL', icon: Droplets },
    { id: 'injectors', label: 'INJECTORS', icon: Fuel },
    { id: 'sensors', label: 'SENSORS', icon: Activity },
  ];

  if (appView === 'start') {
    return (
      <StartScreen
        onCareer={() => goTab('dash')}
        onStart={() => goTab('build')}
        onTutorial={goTutorial}
        version={BUILD_VERSION}
        dial={<DialMark size={92} pct={0.62} />}
      />
    );
  }
  if (appView === 'tutorial') {
    return (
      <TutorialScreen
        steps={TUTORIAL_STEPS}
        onDone={() => { goTab('build'); dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 0 }); }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', maxHeight: '100dvh', background: T.bg, color: T.ink, fontFamily: T.sans, overflow: 'hidden' }}>
      {/* The nav, the status strip and the capped content column are all `AppShell`'s
          now — see AppShell.jsx for what each owns and why. This outer div stays: it
          is the 100dvh/overflow:hidden frame the shell's own `flex: 1` needs to fill,
          not chrome AppShell has any opinion about. */}
      <AppShell route={route} onNavigate={changeTab} onTutorial={goTutorial} onRepair={repairEngine}>
        {/* ---------- HOME: live engine, career stats, health, learning ---------- */}
        {/* One component per section, each reading the store for itself. `live` is read
            ONLY inside LiveScreen: the 20 Hz LIVE_STEP re-render stops there rather than
            passing through a HOME-level parent that would drag the other three with it. */}
        {tab === 'dash' && (
          <div style={{ padding: 16 }}>
            <JobsScreen
              active={dashSection === 'jobs'} onToggle={toggleDashSection}
              onTakeJob={takeJob} onAbandon={abandonJob}
            />
            <StatsScreen
              active={dashSection === 'stats'} onToggle={toggleDashSection}
              scores={scores}
            />
            <HealthScreen
              active={dashSection === 'health'} onToggle={toggleDashSection}
              overallHealth={overallHealth} needsMafRecal={needsMafRecal}
            />
            <LearnScreen active={dashSection === 'learn'} onToggle={toggleDashSection} />
          </div>
        )}

        {/* ---------- LIVE: the engine running in real time ---------- */}
        {/* Its own tab, between TUNE and DYNO, because that is the real working order:
            design it, calibrate it, HEAR IT RUN, then measure it. It was a collapsed
            section on HOME, several taps down and easy never to find. The screen is
            upstream's, unchanged — only where it is reached from moved. */}
        {tab === 'live' && (
          <div style={{ padding: 16 }}>
            {journeyStep === 2 && <JourneyBanner step={2} onAdvance={() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 3 }); changeTab('dyno'); }} onDismiss={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} />}
            <LiveScreen
              active={liveSection !== null} onToggle={toggleLiveSection}
              tachFullScaleRpm={tachFullScaleRpm}
              onStart={startEngine} onStop={stopEngine}
              onToggleSound={toggleSound} onThrottle={setThrottleInput}
            />
          </div>
        )}

        {/* ---------- BUILD: engine architecture, induction, fuel system, exhaust ---------- */}
        {/* One component per section, each reading the store for itself. `engineDerived`,
            `activePreset` and `veAdvice` are the shell's: each feeds a second consumer
            elsewhere (the tach/dyno chart, the header's engine label, the AIR screen's
            advisory), so they stay here and are passed down rather than recomputed.
            `idealExhaustDia` stays for the same reason — it is the input to
            `exhaustDiaError`, which the score breakdown and the dyno payload also read. */}
        {tab === 'build' && (
          <div style={{ padding: 16 }}>
            {journeyStep === 0 && <JourneyBanner step={0} onAdvance={() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 1 }); changeTab('tune'); }} onDismiss={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} />}
            <Eyebrow icon={Settings}>Garage</Eyebrow>
            <p style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6, marginTop: 0, marginBottom: 14 }}>
              Design the car before you tune it. Tap a section to open it — every choice inside changes real physics elsewhere in the sandbox.
            </p>

            <EngineScreen
              active={buildSection === 'engine'} onToggle={toggleBuildSection}
              engineDerived={engineDerived} activePreset={activePreset} veAdvice={veAdvice}
              onResetToStock={resetToStock}
            />
            <InductionScreen
              active={buildSection === 'induction'} onToggle={toggleBuildSection}
            />
            <FuelSystemScreen
              active={buildSection === 'fuel'} onToggle={toggleBuildSection}
            />
            <ExhaustScreen
              active={buildSection === 'exhaust'} onToggle={toggleBuildSection}
              idealExhaustDia={idealExhaustDia}
            />
          </div>
        )}

        {/* ---------- TUNE: sub-view switcher for the calibration tables ---------- */}
        {tab === 'tune' && (
          // flexWrap + a real flex-basis (rather than the old `flex: 1` /
          // flex-basis:0%) so five items wrap to a second row on narrow
          // viewports instead of shrinking below their min-content width and
          // overflowing the column. No media query needed, so this doesn't
          // touch the hand-maintained breakpoint list in tokens.css.
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '14px 16px 0' }}>
            {TUNE_VIEWS.map((v) => {
              const on = tuneView === v.id;
              const Icon = v.icon;
              return (
                <button key={v.id} onClick={() => { goSection('tune', v.id); setSelection(null); }} style={{
                  flex: '1 1 88px', padding: '10px 0 9px', borderRadius: 10, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 10, letterSpacing: 0.4,
                  border: `1px solid ${on ? T.acc : T.line}`, background: on ? T.accBg : T.panel2,
                  color: on ? T.accInk : T.ink2,
                }}>
                  <Icon size={15} />{v.label}
                </button>
              );
            })}
          </div>
        )}

        {tab === 'tune' && journeyStep === 1 && (
          <div style={{ padding: '14px 16px 0' }}>
            {/* Step 2 is LIVE, which this branch gives its own tab. */}
            <JourneyBanner step={1} onAdvance={() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 2 }); changeTab('live'); }} onDismiss={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} />
          </div>
        )}

        {tab === 'tune' && tuneView === 'airflow' && <AirflowScreen veAdvice={veAdvice} veTruth={veTruth} />}

        {tab === 'tune' && tuneView === 'spark' && <SparkScreen calAdvice={calAdvice} />}

        {tab === 'tune' && tuneView === 'fuel' && <FuelScreen calAdvice={calAdvice} />}

        {tab === 'tune' && tuneView === 'injectors' && <InjectorsScreen dutyPreview={dutyPreview} injectorCc={injectorCc} />}

        {tab === 'tune' && tuneView === 'sensors' && <SensorsScreen needsMafRecal={needsMafRecal} chartData={chartData} result={result} />}

        {/* ---------- DYNO: run a pull, then curves / log / datalog / score ---------- */}
        {tab === 'dyno' && (
          <div style={{ padding: 16 }}>
            {activeJob != null && (
              <div style={{
                background: jobResult === 'pass' ? T.okBg : jobResult === 'fail' ? T.dangerBg : T.panel2,
                border: `1px solid ${jobResult === 'pass' ? T.okLine : jobResult === 'fail' ? T.dangerLine : T.line}`,
                borderRadius: 11, padding: '12px 13px', marginBottom: 14,
              }}>
                <div style={{
                  fontSize: 10, letterSpacing: 1, fontWeight: 800,
                  color: jobResult === 'pass' ? T.ok : jobResult === 'fail' ? T.danger : T.ink2,
                }}>
                  {jobResult === 'pass' ? 'JOB COMPLETE' : jobResult === 'fail' ? 'NOT THERE YET' : 'JOB IN PROGRESS'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 3 }}>{CAREER_JOBS[activeJob].title}</div>
                <div style={{ fontSize: 11.5, color: T.ink2, marginTop: 5 }}>Target: {CAREER_JOBS[activeJob].target}</div>
                {jobResult === 'pass' && (
                  <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.line}` }}>
                    <b style={{ color: T.ok }}>What this job taught: </b>{CAREER_JOBS[activeJob].teaches}
                  </div>
                )}
                {jobResult === 'fail' && (
                  <div style={{ fontSize: 11.5, color: T.dangerInk, marginTop: 7 }}>
                    Read the Pull Log below — it names the cause and what to change.
                  </div>
                )}
              </div>
            )}
            {journeyStep === 3 && <JourneyBanner step={3} onAdvance={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} onDismiss={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} />}
            <Eyebrow icon={Activity}>Dyno Cell</Eyebrow>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8, fontWeight: 600 }}>Manifold pressure for the pull (load)</div>
            <Seg label="Manifold pressure for the pull (load)" options={[100, 70, 40].map((l) => ({ label: `${l} kPa`, id: l }))} value={loadKpa} onChange={(v) => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'loadKpa', value: v })} />
            <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 4, marginBottom: 4 }}>
              ~100 kPa is wide-open throttle naturally aspirated. Boost adds on top and walks the tables into the higher-MAP rows automatically.
            </div>

            <div style={{ margin: '14px 0' }}><Tach rpm={running || result ? currentRpm : 1500} cylinders={engineDerived.cyl} running={running} fullScaleRpm={tachFullScaleRpm} /></div>

            {/* The app's most important control, and the one PR 1's review caught
                rendering its label at 1.14:1 while running — panel3 fill under ink2
                text. `disabled` now dims the whole button instead of recolouring the
                label, so the contrast between fill and label never changes.

                Deliberately NOT `block`. This sits in the main content column, which
                on a desktop window is the window; the hand-rolled width:100% here is
                the literal button that spanned the screen. `lg` gives it its weight
                instead. */}
            <div style={{ marginBottom: 16 }}>
              <Button size="lg" onClick={doRun} disabled={running}>
                <Play size={16} aria-hidden="true" />
                {running ? 'SWEEPING…' : 'RUN DYNO PULL'}
              </Button>
            </div>

            {result && (
              <>
                <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  <StatTile label="PEAK WHP" value={result.peakHp} tone="acc" />
                  <StatTile label="PEAK TQ" value={result.peakTq} unit="lb-ft" tone="alt" />
                </div>

                {prevResult && !running && (() => {
                  const dHp = result.peakHp - prevResult.peakHp;
                  const dTq = result.peakTq - prevResult.peakTq;
                  const knockNow = result.events.filter((e) => e.type === 'knock').length;
                  const knockPrev = prevResult.events.filter((e) => e.type === 'knock').length;
                  const dKnock = knockNow - knockPrev;
                  const fmtDelta = (v, unit) => `${v > 0 ? '+' : ''}${v}${unit}`;
                  return (
                    <Panel tight style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TrendingUp size={15} color={T.ink2} style={{ flexShrink: 0 }} />
                      <div style={{ display: 'flex', gap: 14, fontSize: 12.5, flexWrap: 'wrap' }}>
                        <span style={{ color: dHp === 0 ? T.ink2 : dHp > 0 ? T.ok : T.dangerInk, fontFamily: T.mono, fontWeight: 800 }}>{fmtDelta(dHp, ' whp')}</span>
                        <span style={{ color: dTq === 0 ? T.ink2 : dTq > 0 ? T.ok : T.dangerInk, fontFamily: T.mono, fontWeight: 800 }}>{fmtDelta(dTq, ' lb-ft')}</span>
                        <span style={{ color: dKnock === 0 ? T.ink2 : dKnock < 0 ? T.ok : T.dangerInk, fontFamily: T.mono, fontWeight: 800 }}>{knockNow} knock{knockNow === 1 ? '' : 's'} {dKnock !== 0 ? `(${fmtDelta(dKnock, '')})` : ''}</span>
                      </div>
                    </Panel>
                  );
                })()}

                {!running && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                    {[['result', 'CURVES'], ['log', 'PULL LOG'], ['data', 'DATALOG'], ['score', 'SCORE']].map(([id, label]) => {
                      const on = dynoView === id;
                      const flag = id === 'log' && result.events.length > 0;
                      return (
                        <button key={id} onClick={() => goSection('dyno', id)} style={{
                          flex: 1, padding: '9px 0', borderRadius: 9, fontWeight: 800, fontSize: 10, letterSpacing: 0.3,
                          border: `1px solid ${on ? T.acc : T.line}`, background: on ? T.accBg : T.panel2,
                          color: on ? T.accInk : T.ink2, position: 'relative',
                        }}>
                          {label}
                          {flag && <span style={{ position: 'absolute', top: 5, right: 7, width: 5, height: 5, borderRadius: 3, background: T.danger }} />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* DYNO's gating is irregular ON PURPOSE, not four uniform
                    `dynoView === x` checks like TUNE's. While a pull is running the
                    switcher above is hidden and CURVES is the only view that can show
                    — "the machine is busy, watch this" — regardless of which section
                    the URL has selected. Normalising these to match TUNE would make a
                    DATALOG/PULL LOG/SCORE view silently go blank the moment a pull
                    starts instead of falling back to the live curves. Preserve every
                    condition exactly. */}
                {(running || dynoView === 'result') && (
                  <ResultScreen chartData={chartData} engineDerived={engineDerived} />
                )}

                {!running && dynoView === 'data' && (
                  <DataScreen />
                )}

                {!running && dynoView === 'log' && (
                  <LogScreen />
                )}

                {!running && dynoView === 'score' && scores && (
                  <ScoreScreen scores={scores} />
                )}
              </>
            )}
          </div>
        )}
      </AppShell>
    </div>
  );
}

/**
 * The app shell: the store, then the app inside it.
 *
 * The provider is mounted HERE rather than in `main.jsx` because the store is this
 * module's own state — every consumer of it lives inside this file (and, after PR 3,
 * inside the screens this file splits into). Mounting it at the module boundary means
 * `<EcuLab />` is self-contained: `main.jsx` stays the thin "mount the app in an error
 * boundary" entry point it documents itself as, and a test that renders `<EcuLab />`
 * gets the same single store the browser does instead of having to reconstruct the
 * app's root providers by hand.
 *
 * @returns {React.ReactElement}
 */
export default function EcuLab() {
  return (
    <StoreProvider>
      <EcuLabApp />
    </StoreProvider>
  );
}
