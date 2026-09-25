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

import React, { useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import {
  Grid3x3, Zap, Droplets, Activity, Play,
  Settings, TrendingUp, Fuel, Gauge, RotateCw, Timer, ShieldAlert, Crosshair, Wind, Flame,
} from 'lucide-react';

import {
  BARO_KPA, COMPRESSOR_OPTS,
  DEFAULT_BOOST, DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, EXHAUST_DIA_OPTS, GEARBOX_OPTS,
  INJ_DEADTIME_MS, INJECTOR_OPTS, OCTANE_OPTS,
  PSI_TO_KPA,
  R_AIR, RPM, TURBINE_OPTS, acousticDrive, blowerCurve, blowerOf, blowerSpeedRpm, calibrationAdvice, chargeTempK, clamp,
  computeEngineerScore, computeHardwareVE, computePullScore, computeTuningScore,
  deriveEngine, exhaustGeometry, idealExhaustDiameter, interp1, interp2, isLocatable, presetById,
  simulateDragRun, simulateSweep, torqueCurveFromSweep, turbineWithCount,
  veRecommendations, defaultEcuCalibration, dynoConditions, ecuHardwareOf, tankFuel,
  veTruthByPhaseFor, read1, applyVeCorrections, veCorrections, veSamplesFromLive, veSamplesFromPull,
} from '../sim/index.js';
import {
  beepEngineAudio, converterEngineAudio, createEngineAudio, setEngineAudioActive,
  shiftEngineAudio, silenceEngineAudio, updateEngineAudio, wakeEngineAudio,
} from './audio/engineAudio.js';
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
import { diffMeasuredInputs, pullSignature, measuredInputs } from './state/pullSignature.js';
import { ghostLabel, ghostRun, makeRunRecord } from './state/runLog.js';
import { Button } from './primitives/Button.jsx';
import { Eyebrow } from './primitives/Eyebrow.jsx';
import { Panel } from './primitives/Panel.jsx';
import { StatTile } from './primitives/StatTile.jsx';
import { Seg } from './primitives/Seg.jsx';
import { Toggle } from './primitives/Toggle.jsx';
import { DialMark } from './components/DialMark.jsx';
import { eventBands } from './components/eventBands.js';
import { tuneAttention } from './components/fixLinks.js';
import { EngineScreen } from './screens/build/EngineScreen.jsx';
import { ExhaustScreen } from './screens/build/ExhaustScreen.jsx';
import { FuelSystemScreen } from './screens/build/FuelSystemScreen.jsx';
import { InductionScreen } from './screens/build/InductionScreen.jsx';
import { CAREER_JOBS } from './career.js';
import { DragScreen, dragSignature } from './screens/drag/DragScreen.jsx';
import { HealthScreen } from './screens/dash/HealthScreen.jsx';
import { JobsScreen } from './screens/dash/JobsScreen.jsx';
import { LearnScreen } from './screens/dash/LearnScreen.jsx';
import { RealCarScreen } from './screens/dash/RealCarScreen.jsx';
import { LiveScreen } from './screens/dash/LiveScreen.jsx';
import { StatsScreen } from './screens/dash/StatsScreen.jsx';
import { AirflowScreen } from './screens/tune/AirflowScreen.jsx';
import { FuelScreen } from './screens/tune/FuelScreen.jsx';
import { InjectorsScreen } from './screens/tune/InjectorsScreen.jsx';
import { SensorsScreen } from './screens/tune/SensorsScreen.jsx';
import { EcuControlScreen } from './screens/tune/EcuControlScreen.jsx';
import { EcuSection } from './components/ecu/EcuSection.jsx';
import { MapSlots } from './components/ecu/MapSlots.jsx';
import { SparkScreen } from './screens/tune/SparkScreen.jsx';
import { DataScreen } from './screens/dyno/DataScreen.jsx';
import { HistoryScreen } from './screens/dyno/HistoryScreen.jsx';
import { LogScreen } from './screens/dyno/LogScreen.jsx';
import { ResultScreen } from './screens/dyno/ResultScreen.jsx';
import { ScoreScreen } from './screens/dyno/ScoreScreen.jsx';

// Guided first run. Walks a new player through the actual working order a tuner
// uses — build the engine, calibrate it, hear it run, then measure it — and then
// gets out of the way. Purely navigational: it never changes the simulation.
const JOURNEY = [
  { tab: 'build', title: 'Step 1 · Build the engine',
    body: 'Open Engine Architecture and design a short block: bore, stroke, compression, cam, springs. Then fit parts under Induction and Exhaust. Nothing here is cosmetic — every choice changes how the engine breathes.',
    cta: 'Done building — go tune it', next: 'tune' },
  { tab: 'tune', title: 'Step 2 · Calibrate it',
    body: 'Start with the three tables. AIR is how well the engine breathes: after a build change, run a pull and correct it from the log. SPARK sets ignition timing and FUEL sets the mixture; the advisories say what your hardware will tolerate. The second row of pages (BOOST, VVT, IDLE, PROTECT, TORQUE) is already set up at factory, so leave it for now. A NITROUS page joins them once a nitrous kit is fitted.',
    cta: 'Calibration set — start the engine', next: 'live' },
  { tab: 'live', title: 'Step 3 · Start it and listen',
    body: 'Press START. Watch it idle, hold the throttle to rev it, and watch the sensors and fuel trims respond in real time. This is your calibration actually running.',
    cta: 'Sounds good — put it on the dyno', next: 'dyno' },
  { tab: 'dyno', title: 'Step 4 · Measure it',
    body: 'Run a pull. Then read the Pull Log before you look at the power number — it explains anything that went wrong and what to change. From here the loop is: adjust, pull again, compare.',
    cta: 'Measured — now race it', next: 'drag' },
  { tab: 'drag', title: 'Step 5 · Race it',
    body: 'Put that torque curve in a car and run a quarter mile. Body, gearing, tyres and driven wheels all change the time without touching the engine — because a torque curve is only half of acceleration. Read the 60-foot time for traction and the trap speed for power.',
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
    body: 'An engine can only burn as much fuel as it has air for. So everything starts with air. The ECU works out the air, decides how much fuel to add, and picks the moment to light it.\n\nTuning is getting those last two decisions right at every speed and load.\n\n→ You will do that on three tables. The rest of this tutorial shows you which, and how to check your work.' },
  { title: 'Air: how full the cylinder gets',
    body: 'The ECU works out the air in each cylinder from pressure and temperature:\n\n    air in cylinder = VE × cylinder volume × MAP ÷ (R × T)\n\nVE, volumetric efficiency, is how completely the cylinder fills. It belongs to the hardware. Writing a bigger number in the table does not add air. It only makes the ECU fuel for air that is not there.\n\n→ The AIRFLOW table should match what the engine really breathes. Nobody can see that directly: after a hardware change, log a pull and TUNE › AIRFLOW works out the correction for each cell from the wideband, showing the maths.' },
  { title: 'Fuel: follows from the air',
    body: 'Once the air is known, fuel is arithmetic:\n\n    fuel = air ÷ (λ × 14.7 for gasoline)\n\nλ (lambda) is the mixture you ask for on the FUEL table. 1.00 is exactly enough air to burn the fuel. About 0.87 makes the most power, and a boosted engine runs richer, about 0.83, to keep the charge and the turbo cool.\n\nThe injectors can only be open so long: past about 90% duty there is no time left, and no table can fix that.\n\n→ Set the FUEL table. If the log says the injectors are maxed, you need bigger injectors or less boost.' },
  { title: 'Spark: when to light it',
    body: 'The mixture takes a few milliseconds to burn, so the spark fires before the piston reaches the top. Fire too late and the burn chases a piston that is already leaving. Fire too early and the pressure pushes against a piston still coming up.\n\nThe best point is called MBT. Past it, extra advance makes no more power.\n\n→ On SPARK, find the timing where power stops rising. Stop there, or earlier if the engine knocks.' },
  { title: 'Knock: the limit on everything',
    body: 'Too much advance, heat or pressure and the last of the mixture explodes on its own instead of burning smoothly. That is knock, and it breaks pistons.\n\nThe ECU listens for it and takes timing out. The datalog shows it as commanded timing and actual timing drifting apart.\n\n→ Aim for zero knock. If the log shows knock, take timing out of those cells, or add fuel there, or use better fuel.' },
  { title: 'Where the power number comes from',
    body: 'Nothing here adds horsepower directly. The simulator follows the pressure inside one cylinder through the whole cycle, two crank degrees at a time, and adds up the work it does on the piston. Friction and breathing losses come off. What is left is torque.\n\n    hp = lb-ft × RPM ÷ 5252\n\nSo power only changes when something real changes: more air, the right fuel, better-timed spark.' },
  { title: 'Design it on BUILD',
    body: 'Bore, stroke, compression, cam, springs, turbo, exhaust, fuel system. None of it is cosmetic. Every part changes how the engine breathes or what it can survive.\n\n→ Change the cam and watch the AIRFLOW table on TUNE redraw itself. That is what a cam really does.' },
  { title: 'Three tables, three jobs',
    body: 'On TUNE:\n\nAIRFLOW — how well each cylinder fills (VE).\nSPARK — when the plug fires, in degrees before top dead centre.\nFUEL — the mixture you want, as air-fuel ratio.\n\nColumns are RPM, rows are manifold pressure: the same layout real tuning software uses.\n\n→ These three are the tune. Most sessions never need anything else.' },
  { title: 'Everything else is already set',
    body: 'Real ECUs have far more: corrections for temperature and altitude, and controllers for boost, cams, idle, knock and protection. They are all on TUNE, under the tables and in the second row of buttons.\n\nEvery one starts at a working factory setting. You do not need to touch them to make a great tune. Change one and an amber dot marks it. The Factory button puts a page back.\n\n→ Leave them alone until a log tells you to go there. Each page says when that is.' },
  { title: 'The ECU only knows what it measures',
    body: 'The ECU never sees the truth. It sees sensors, read through the settings it was given. Fit a sensor on BUILD and tell the ECU a different one on TUNE › SENSORS, and it acts on a wrong number without knowing.\n\nThe classic: a 1-bar MAP sensor on a turbo engine. The ECU never sees boost, and fuels too little under it.\n\n→ When you change a sensor on BUILD, match it on TUNE › SENSORS. The page warns you when they differ.' },
  { title: 'Nothing is known until you pull',
    body: 'There is no preview. Press RUN DYNO PULL on DYNO and the engine sweeps from 1500 RPM to its redline and records a full datalog. That is the only way to find out what a change did, exactly like a real dyno day.\n\n→ Pull after every change.' },
  { title: 'Read the log, change one thing, pull again',
    body: 'Every pull writes a Pull Log. Each problem comes with a plain Why (what caused it) and a Try (what to change).\n\nThen: change one thing, pull, compare. The VS. LAST PULL line tells you whether it helped. Change three things at once and you will not know which one worked.\n\n→ Read the Pull Log before you look at the power number.' },
  { title: 'Know what you cannot tune away',
    body: 'Knock, a wrong mixture and a mis-read airflow sensor are calibration faults. The tables and the ECU\'s settings fix them completely.\n\nInjectors out of time, valves floating, a turbo past its limit: those are hardware limits. No table touches them, and the log says so.\n\n→ When the log names a hardware limit, change the part or ask less of it.' },
  { title: 'Hear it, and watch it run',
    body: 'The sound is built from the same numbers as the dyno, not recorded. Retard the spark and it turns raspy. Richen it and it softens. A big cam lopes.\n\nOn LIVE the ECU runs in real time. Its log records every channel. Switch on the A/C and watch idle hold. Try launch control. Break a sensor on purpose and see what the protections do.\n\n→ Start the engine on LIVE and rev it before your first pull.' },
  { title: 'Where this physics comes from',
    body: 'Every relation here is published engineering, checked against its source. The cycle uses the ratio of specific heats, γ, of the gas at each stage: 1.35 for fresh charge falling to 1.235 as it burns. That brackets the ~1.3 average textbooks use, which gives the ideal 10:1 engine its 50% efficiency.\n\nAir density comes out at 1.185 kg/m³ at sea level and 25 °C, matching the published figure.\n\n→ The sources are under Learn on HOME. If a number looks wrong, check it. That has fixed real errors here.' },
  { title: 'Chase the score, then race it',
    body: 'Every pull is graded on Tuning (how clean the calibration is) and Engineer (how sound the build is), then combined with real output into a Pull Score with no ceiling.\n\nOn DRAG the engine goes into a car. Trap speed measures power, the 60-foot time measures traction, and the fastest engine does not always win.' },
  { title: 'Ready',
    body: 'Sandbox: build and tune anything, no objectives. Career: customer cars with real faults to find.\n\nThe loop is always the same: build it, set the three tables, listen to it, pull it, read the log, change one thing.\n\n→ If you are unsure what to do next, run a pull and read the Pull Log. It always tells you.' },
];

/**
 * How long the christmas tree takes to go green, ms.
 *
 * A real sportsman tree is staged, then three ambers half a second apart, then green.
 * The car does not move until it does — the tree is the one thing on DRAG with no
 * physics behind it, and it is honest about that.
 */
const TREE_GREEN_MS = 1900;

/** Playback frame interval, ms — 25 fps, matching the strip's own CSS transition. */
const DRAG_FRAME_MS = 40;

/** How long the finished run stays on screen before the strip resets, seconds. */
const DRAG_HOLD_S = 1.2;

/**
 * Ceiling on how long playback may take in WALL-CLOCK seconds.
 *
 * Almost every pass is under this and plays back in real time. A slow one does not:
 * `simulateDragRun` gives up at DRAG_TIMEOUT_S, so a 48 whp engine in a tall-geared
 * truck solves to a 40-second run that never reaches the stripe — and watching all
 * forty of them, with the RUN button disabled throughout, is not a thing to do to
 * somebody. Runs longer than this are played back fast-forwarded rather than
 * truncated, so the replay still shows the whole solved pass and the readouts still
 * carry the real speed, gear and RPM at each point in it.
 */
const DRAG_PLAYBACK_MAX_S = 15;

/**
 * How many run-seconds one wall-clock second of playback covers.
 *
 * Exported so the ceiling above is testable without watching fifteen real seconds of
 * a truck crawling: this is the whole of that rule.
 *
 * @param {number} etSeconds the solved run's elapsed time
 * @returns {number} 1 for a normal pass, more for one that has to be fast-forwarded
 */
export function dragPlaybackRate(etSeconds) {
  return Math.max(1, etSeconds / DRAG_PLAYBACK_MAX_S);
}

/**
 * The measured sweep point closest in engine speed to `rpm`.
 *
 * @template {{rpm: number}} P
 * @param {P[]} points a sweep, in ascending RPM
 * @param {number} rpm engine speed wanted
 * @returns {P} the nearest point
 */
function nearestPoint(points, rpm) {
  let best = points[0];
  for (const p of points) {
    if (Math.abs(p.rpm - rpm) < Math.abs(best.rpm - rpm)) best = p;
  }
  return best;
}

// ============================================================
/**
 * The application body. Exported so a caller can mount it inside its OWN
 * `<StoreProvider>` and share the store with it — which is how the tests reach
 * build states this component's own guards cannot produce on their own (see
 * tests/ui/build-store.test.jsx). The default export below is the same component
 * with a provider already around it, and is what the app and most tests use.
 * @returns {React.ReactElement}
 */
/**
 * A dyno pull is a SEQUENCE, not just a sweep, and these are its parts in milliseconds.
 *
 *   settle     hold idle, so you hear it running before it is loaded
 *   sweep      load it and take it to redline, drawing the graph as it goes
 *   spooldown  throttle shut; revs fall on the engine's own friction and pumping
 *   rest       settle at idle again, and the pull is over
 *
 * The bookends are not decoration. A pull that teleports from nothing to redline and
 * stops gives the ear no reference for what changed, and never lets you hear the overrun
 * — which is where a boosted engine vents. But they are only for the EAR: with sound off,
 * or no audio in the browser at all, a pull is the sweep alone and nobody waits four and
 * a half seconds for an idle they cannot hear.
 *
 * Exported because the full sequence outlasts a test runner's default timeout, and a test
 * that waits for one should say WHY it waits that long by naming this rather than by
 * carrying a number that has to be remembered if the sequence is ever retimed.
 */
export const DYNO_PULL = Object.freeze({
  SETTLE_MS: 1400,
  SWEEP_MS: 1900,
  DOWN_MS: 2100,
  REST_MS: 900,
  /** Idle the pull settles at either side of the sweep, RPM. */
  IDLE_RPM: 820,
});

/** How long a whole pull takes with its audible bookends, milliseconds — the longest one can. */
export const DYNO_PULL_MS = DYNO_PULL.SETTLE_MS + DYNO_PULL.SWEEP_MS
  + DYNO_PULL.DOWN_MS + DYNO_PULL.REST_MS;

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
    engineConfig, mods, turboOn, boostCurve, injIdx, mafScalar,
    turbineIdx, turbineCount, compressorIdx, exhaustDiaIdx, ecuInjectorCc,
    presetId, blowerRatio, nitrous,
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
    loadKpa, soundOn, volume, dynoPhase, dynoRpm, journeyStep, throttleInput, health,
    result, runs, pinnedRunId, pullScores, running, revealCount, bestScore, totalScore, pullCount,
    live, car, dragResult, dragRunning, dragT, treePhase,
    mode, activeJob, completedJobs, jobResult, env, liveAux, faults,
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
  const dragSection = tab === 'drag' ? route.section : null;
  const revealTimer = useRef(null);
  // The drag run's playback clock, and the christmas tree's four timers. Refs for the
  // same reason `revealTimer` is one: both are cleared from a handler and from an
  // unmount cleanup, neither is ever read during render.
  const dragTimer = useRef(null);
  const treeTimers = useRef(/** @type {ReturnType<typeof setTimeout>[]} */ ([]));
  const liveTimer = useRef(null);
  const liveCfgRef = useRef(null);
  const throttleRef = useRef(0);
  const audioRef = useRef(null);
  // The drag pass's last gear, so a shift is heard once when it happens; and whether the
  // converter whine was last left on, so it is switched off once rather than every frame.
  const dragGearRef = useRef(0);
  const converterOnRef = useRef(false);
  const setSession = (field, value) => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field, value });
  // Guards the persistence effect below: nothing may be written until the saved career
  // has actually been read back, or a cold start overwrites it with zeroes.
  const careerLoaded = useRef(false);

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

  const octaneBonus = tankFuel(build).bonus;
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

  // The fuel actually in the tank: a pump fuel, or whatever blend a flex tank holds.
  const fuel = useMemo(() => tankFuel(build), [build]);
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

  // A supercharger, if one is fitted instead of a turbo, and what it will make across the
  // rev range at full throttle on this engine — the header, the injector-duty preview
  // and the Engineer Score all need its boost before a pull is run.
  const blower = useMemo(() => blowerOf(build), [build]);
  const blowerWot = useMemo(() => (blower ? blowerCurve(build, fuel) : []), [blower, build, fuel]);
  const blowerPeakPsi = blowerWot.length ? Math.max(...blowerWot.map((p) => p.boostPsi)) : 0;

  const hwForVe = useMemo(() => ({
    turboOn,
    turbine: turboOn ? turbine : null,
    exhaustDia: EXHAUST_DIA_OPTS[exhaustDiaIdx].dia,
    fuel,
    peakBoostPsi: turboOn ? Math.max(...boostCurve) : 0,
    supercharged: !!blower,
  }), [turboOn, turbine, exhaustDiaIdx, fuel, boostCurve, blower]);

  // TRUE cylinder filling for the hardware as currently built. The player's `ve` table
  // is only the ECU's BELIEF about this; the gap between the two is what makes the
  // mixture drift off target and what the fuel-trim histogram measures and corrects.
  const veTruth = useMemo(
    () => computeHardwareVE(engineConfig, mods, hwForVe),
    [engineConfig, mods, hwForVe],
  );

  // The engine management's world: the parts it reads and drives, and the day. The
  // breathing curve is solved at each cam phase the VVT model samples — only once, for
  // an engine with fixed cams.
  const ecuHw = useMemo(() => ({
    ...ecuHardwareOf(build),
    veTruthByPhase: veTruthByPhaseFor(engineConfig, mods, hwForVe),
  }), [build, engineConfig, mods, hwForVe]);
  // The nitrous arming switch is the cockpit's, shared by the dyno and LIVE; the bottle
  // starts at the heater's set point, or the day's temperature without one.
  const nitrousArmed = liveAux.nitrous !== false;
  const ecuBundle = useMemo(
    () => ({
      cal: tune.ecu, hw: nitrous ? { ...ecuHw, nitrous } : ecuHw,
      cond: dynoConditions(env, faults, nitrous ? { armed: nitrousArmed, heater: !!nitrous.heater } : null),
    }),
    [tune.ecu, ecuHw, env, faults, nitrous, nitrousArmed],
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
        // The customer's car, not the last build: no supercharger or nitrous it did not come with.
        blowerId: null,
        nitrous: null,
      },
      // A "stale VE" job hands you the OLD log against new hardware, which is the whole
      // point of it: the table is a record of what the engine used to flow.
      ve: job.setup.staleVe
        ? computeHardwareVE(DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, {
          turboOn: false, turbine: null, exhaustDia: EXHAUST_DIA_OPTS[exhaustDiaIdx].dia,
          fuel: OCTANE_OPTS[0],
        })
        : computeHardwareVE(cfg, nextMods, hw),
      ecu: defaultEcuCalibration({ derived: deriveEngine(cfg) }),
    });
    changeTab('dyno');
  };

  /** Puts the active job down without grading it. */
  const abandonJob = () => {
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'activeJob', value: null });
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'jobResult', value: null });
  };

  // THE ADVISOR AND THE DYNO MUST NEVER DISAGREE. The advisor judges the spark table
  // against a full-throttle pull of this exact engine — same physics, same ECU, same
  // manifold pressures the turbo actually makes — so a cell it calls past the knock limit
  // is one a pull knocks on, and one it calls clean is one a pull does not. Deferred, so
  // editing a table never waits on the pull; both read the same deferred tables, so they
  // always describe the same calibration.
  const advisorTables = useMemo(() => ({ ve, timing, afr }), [ve, timing, afr]);
  const deferredTables = useDeferredValue(advisorTables);
  const advisorPull = useMemo(() => simulateSweep({
    loadKpa: 100, ve: deferredTables.ve, veTruth, timing: deferredTables.timing, afr: deferredTables.afr,
    turboOn, boostCurve, octaneBonus, octaneLabel: fuel.label, fuel, injectorCc, ecuInjectorCc,
    injectorLabel: INJECTOR_OPTS[injIdx].label, mods, mafScalar, derived: engineDerived,
    turbine, compressor: COMPRESSOR_OPTS[compressorIdx], ecu: ecuBundle,
    ...(blower ? { blower, blowerRatio } : {}), ...(nitrous ? { nitrous } : {}),
  }), [deferredTables, veTruth, turboOn, boostCurve, octaneBonus, fuel, injectorCc, ecuInjectorCc,
       injIdx, mods, mafScalar, engineDerived, turbine, compressorIdx, ecuBundle, blower, blowerRatio, nitrous]);
  const calAdvice = useMemo(() => calibrationAdvice({
    ve: deferredTables.ve, veTruth, timing: deferredTables.timing, afr: deferredTables.afr,
    derived: engineDerived, octaneBonus, fuel, mods, turboOn, boostCurve,
    compressor: COMPRESSOR_OPTS[compressorIdx], turbine,
    injectorCc, ecuInjectorCc, mafScalar, mafErrorBase, pull: advisorPull,
  }), [deferredTables, veTruth, engineDerived, octaneBonus, fuel, mods, turboOn, boostCurve,
       compressorIdx, turbine, injectorCc, ecuInjectorCc, mafScalar, mafErrorBase, advisorPull]);

  const veAdvice = useMemo(
    () => veRecommendations(ve, engineConfig, mods, hwForVe),
    [ve, engineConfig, mods, hwForVe]
  );

  // Same real-units chain the sim uses, evaluated at WOT / 6500 RPM as a preview.
  const dutyPreview = useMemo(() => {
    const rpm = 6500;
    const boostPsi = turboOn ? boostCurve[RPM.indexOf(6500)]
      : blowerWot.length ? interp1(blowerWot.map((p) => p.rpm), blowerWot.map((p) => p.boostPsi), rpm) : 0;
    const mapKpa = BARO_KPA + boostPsi * PSI_TO_KPA;
    const chargeK = chargeTempK(boostPsi, mods.intercooler);
    const vCylM3 = (engineDerived.displacementL / engineDerived.cyl) / 1000;
    const airDensity = (mapKpa * 1000) / (R_AIR * chargeK);
    const airChargeG = (interp2(ve, rpm, mapKpa) / 100) * vCylM3 * airDensity * 1000;
    const lambda = interp2(afr, rpm, mapKpa) / 14.7;
    const fuelMassG = airChargeG / (lambda * fuel.stoich);
    const pw = fuelMassG / ((ecuInjectorCc * fuel.density) / 60000) + INJ_DEADTIME_MS;
    return clamp((pw / (120000 / rpm)) * 100, 0, 220);
  }, [ve, afr, turboOn, boostCurve, ecuInjectorCc, fuel, mods.intercooler, engineDerived, blowerWot]);
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
  const toggleDragSection = makeToggleSection('drag');
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
  // HOME opens on the jobs board in CAREER and on the stats in free play, which has no
  // jobs board. A ref, so `changeTab` below keeps the referential stability its note
  // depends on instead of changing identity whenever a job is taken.
  const homeFirstSectionRef = useRef('jobs');
  homeFirstSectionRef.current = mode === 'career' || activeJob != null ? 'jobs' : 'stats';
  const changeTab = useCallback((t) => {
    // Browsers only let audio start from inside a user gesture, so take every tap on the
    // nav as another chance to unlock it. Without this a player who never presses START
    // first can navigate the whole app and hear nothing. `audioRef` is a ref, so reading
    // it here costs this closure none of the stability the note above depends on.
    const a = audioRef.current;
    if (a && a.ctx.state === 'suspended') a.ctx.resume();
    navigate({ view: 'app', tab: t, section: t === 'dash' ? homeFirstSectionRef.current : ROUTES[t][0] });
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
    dispatch({
      type: ACTIONS.RESET_TO_STOCK, ve: stockVe,
      ecu: defaultEcuCalibration({ derived: engineDerived, gate: ecuHw.gate }),
    });
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
      audioRef.current = createEngineAudio(new Ctx());
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

  // A deliberately obvious beep, for the same reason and from the same place: if this is
  // silent the problem is the device or the browser — on an iPhone the physical
  // ring/silent switch mutes web audio even at full volume — and not the engine model.
  // Worth being able to prove.
  const testSound = () => {
    const a = ensureAudio();
    if (!a) { setSession('audioStatus', 'unavailable'); return; }
    beepEngineAudio(a, { hz: 220, seconds: 0.45, gain: 0.35 });
    // `resume()` is asynchronous: read straight after the call, the state is still
    // 'suspended' on exactly the tap that unlocks audio, and the first TEST reported
    // "blocked" while the beep played. So the verdict waits for the resume to settle.
    wakeEngineAudio(a, 0.45)
      .catch(() => {})
      .then(() => setSession('audioStatus', a.ctx.state === 'running' ? 'ok' : 'blocked'));
  };

  // The setup currently on screen — build, calibration and dyno load — signed. The
  // same signature is taken at pull time and banked with the scores, then compared
  // against this on every render: the one question banked numbers cannot answer for
  // themselves is whether they are still about the car in front of you. See
  // pullSignature.js for exactly what counts as an input, and what does not.
  const buildSignature = useMemo(
    () => pullSignature(build, tune, loadKpa, { env, faults }),
    [build, tune, loadKpa, env, faults],
  );

  /**
   * Everything a dyno pull is solved from, in one place, so the drag strip's per-gear
   * pulls are the same pull at a different gear and nothing else.
   * @param {number} load
   * @param {object} ecu
   */
  const sweepArgs = (load, ecu) => ({
    loadKpa: load, ve, veTruth, timing, afr, turboOn, boostCurve, octaneBonus, octaneLabel: fuel.label,
    fuel, injectorCc, ecuInjectorCc, injectorLabel: INJECTOR_OPTS[injIdx].label, mods, mafScalar, derived: engineDerived,
    turbine, compressor: COMPRESSOR_OPTS[compressorIdx], ecu,
    ...(blower ? { blower, blowerRatio } : {}), ...(nitrous ? { nitrous } : {}),
  });

  const doRun = () => {
    const a = ensureAudio();
    if (a && a.ctx.state === 'suspended') a.ctx.resume();
    // The reveal animation's own state: `running` gates the RUN button's label and the
    // partial chart, `revealCount` is how much of the sweep has been drawn so far.
    // Neither has an ordering hazard (unlike the banking tail below, which BANK_PULL
    // owns), so they stay plain field writes.
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'running', value: true });
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'revealCount', value: 0 });
    const r = simulateSweep(sweepArgs(loadKpa, ecuBundle));
    const ts = computeTuningScore(r);
    const es = computeEngineerScore({
      engineConfig, turboOn, peakBoostPsi: turboOn ? Math.max(...boostCurve) : blowerPeakPsi,
      supercharged: !!blower, turbine, compressor: COMPRESSOR_OPTS[compressorIdx],
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
    // Banking the pull — result, wear, scores, pull count, run log — lands in the
    // store in one pass. `result` and `pullScore` are precomputed here because the
    // reducer has no access to the useMemo-derived hardware `computePullScore` needs.
    // The local `setResult`/`setHealth` calls that used to sit above this line, and the
    // `setBestScore`/`setTotalScore`/`setPullCount` trio below it, were all mirroring
    // writes this one action already makes.
    // `scores` rides along with the result it belongs to: BANK_PULL keeps the numbers
    // this pull actually measured, and `buildSignature` records the setup it measured
    // them on. Nothing recomputes them afterwards — that is the whole fix (issue #29).
    const nextPulls = pullCount + 1;
    const at = Date.now();
    dispatch({
      type: ACTIONS.BANK_PULL, result: r, pullScore: pull,
      scores: { tuning: ts, engineer: es, signature: buildSignature },
      // `id` pairs the clock with the career ordinal so two records can never collide,
      // and `at`/`id` are read HERE because the reducer must call no clock of its own.
      run: makeRunRecord({
        id: `${at}-${nextPulls}`, n: nextPulls, at,
        // `engineDerived` carries no name — it is displacement, cylinder count and
        // redline. The build's name is the loaded preset's, and a build with no preset
        // is exactly what "Custom build" means everywhere else in this app.
        label: presetById(presetId)?.name ?? 'Custom build',
        result: r, scores: { tuning: ts, engineer: es }, pullScore: pull,
        inputs: measuredInputs(build, tune, loadKpa),
      }),
    });
    const total = r.points.length;
    // The idle and overrun either side of the sweep exist to be HEARD, so they only play
    // when something can hear them.
    const bookends = Boolean(a && soundOn);
    const { SWEEP_MS, IDLE_RPM: idleRpm } = DYNO_PULL;
    const SETTLE_MS = bookends ? DYNO_PULL.SETTLE_MS : 0;
    const DOWN_MS = bookends ? DYNO_PULL.DOWN_MS : 0;
    const REST_MS = bookends ? DYNO_PULL.REST_MS : 0;
    const topRpm = r.points[total - 1].rpm;
    const t0 = Date.now();
    setSession('dynoPhase', bookends ? 'settle' : 'sweep');
    setSession('dynoRpm', bookends ? idleRpm : r.points[0].rpm);
    setSession('revealCount', 0);

    // Every value below is derived from the interval's OWN clock, never from a read of
    // `revealCount` or `dynoRpm`, so there is no stale-closure hazard in carrying them
    // on the actions.
    revealTimer.current = setInterval(() => {
      const el = Date.now() - t0;
      if (el < SETTLE_MS) {
        setSession('dynoPhase', 'settle');
        setSession('dynoRpm', idleRpm + Math.sin(el / 90) * 14);
      } else if (el < SETTLE_MS + SWEEP_MS) {
        const f = (el - SETTLE_MS) / SWEEP_MS;
        const idx = Math.min(total, Math.round(f * total));
        setSession('dynoPhase', 'sweep');
        setSession('revealCount', idx);
        setSession('dynoRpm', r.points[Math.min(total - 1, Math.max(0, idx - 1))].rpm);
      } else if (el < SETTLE_MS + SWEEP_MS + DOWN_MS) {
        // Engine braking: fast at first, easing as friction and pumping fall away with
        // engine speed.
        const f = (el - SETTLE_MS - SWEEP_MS) / DOWN_MS;
        setSession('dynoPhase', 'spooldown');
        setSession('revealCount', total);
        setSession('dynoRpm', idleRpm + (topRpm - idleRpm) * Math.pow(1 - f, 2.2));
      } else if (el < SETTLE_MS + SWEEP_MS + DOWN_MS + REST_MS) {
        setSession('dynoPhase', 'rest');
        setSession('dynoRpm', idleRpm + Math.sin(el / 90) * 12);
      } else {
        clearInterval(revealTimer.current);
        setSession('dynoPhase', null);
        setSession('running', false);
      }
    }, 55);
  };
  useEffect(() => () => { if (revealTimer.current) clearInterval(revealTimer.current); }, []);

  // ---- The quarter mile ---------------------------------------------------
  // The crank-torque lookup the drag run is driven by. Derived from the LAST PULL and
  // nothing else, which is the whole prerequisite: until the engine has been measured
  // there is no torque curve to drive with, and DRAG says so rather than inventing one.
  const torqueCurveNm = useMemo(() => (result ? torqueCurveFromSweep(result) : null), [result]);

  /**
   * A short tone, used for the tree's ambers and its green.
   *
   * Built and discarded per beep rather than added to the engine synth's graph: this
   * is a timing light, not part of the engine's note, and it must sound while the car
   * is still stationary and silent.
   *
   * @param {number} freq Hz
   * @param {number} dur seconds
   * @param {number} vol peak gain
   */
  const beep = (freq, dur, vol) => {
    const au = audioRef.current;
    if (!au || !soundOn) return;
    // The tree lights before the car moves, while the engine audio may be asleep.
    wakeEngineAudio(au, dur);
    const t0 = au.ctx.currentTime;
    const o = au.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = au.ctx.createGain(); g.gain.value = 0;
    o.connect(g); g.connect(au.ctx.destination);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0); o.stop(t0 + dur + 0.05);
  };

  /**
   * Run the quarter mile: solve it in full, then start the tree and play it back.
   *
   * Solving first is the point. The strip animation scrubs a finished run rather than
   * integrating alongside it, so what the player watches and what the time slip says
   * cannot come apart. It also means an eight-second pass costs one solve, not eight
   * seconds of physics running against a repaint.
   */
  const runDrag = () => {
    if (!torqueCurveNm || dragRunning) return;
    const a = ensureAudio();
    if (a && a.ctx.state === 'suspended') a.ctx.resume();

    // Boost limited by gear means a different engine in each gear: each gear that is
    // limited below the curve gets its own full-throttle pull at that gear's boost.
    const gearLimit = tune.ecu.boost.gearLimit;
    const peakBoost = turboOn ? Math.max(...boostCurve) : 0;
    const perGear = turboOn && car.gears.slice(0, car.gearCount).some((_, i) => read1(gearLimit, i + 1) < peakBoost);
    const cache = new Map();
    const torqueCurveForGear = perGear ? (g) => {
      const cap = read1(gearLimit, g);
      if (cap >= peakBoost) return torqueCurveNm;
      if (!cache.has(cap)) {
        cache.set(cap, torqueCurveFromSweep(simulateSweep(sweepArgs(100, { ...ecuBundle, cond: { ...ecuBundle.cond, gear: g } }))));
      }
      return cache.get(cap);
    } : null;
    const res = simulateDragRun({
      car,
      torqueCurveNm,
      redline: engineDerived.redline,
      displacementL: engineDerived.displacementL,
      peakHp: result.peakHp,
      ecu: { cal: tune.ecu, cyl: engineDerived.cyl },
      torqueCurveForGear,
    });
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'dragResult', value: res });
    // Recorded WITH the run, never re-derived afterwards: this is what lets the time
    // slip say the car has changed underneath it. Same rule as `pullScores.signature`.
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'dragSetup', value: dragSignature(car, result) });
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'dragT', value: 0 });

    // A sportsman tree: staged, then three ambers half a second apart, then green.
    // Clearing first matters — pressing RUN again during the countdown must replace
    // the sequence, not race a second one against it.
    treeTimers.current.forEach(clearTimeout);
    clearInterval(dragTimer.current);
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'treePhase', value: 1 });
    treeTimers.current = [
      setTimeout(() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'treePhase', value: 2 }); beep(660, 0.18, 0.08); }, 400),
      setTimeout(() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'treePhase', value: 3 }); beep(660, 0.18, 0.08); }, 900),
      setTimeout(() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'treePhase', value: 4 }); beep(660, 0.18, 0.08); }, 1400),
      setTimeout(() => {
        dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'treePhase', value: 5 });
        beep(990, 0.35, 0.10);
        dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'dragRunning', value: true });
        const t0 = Date.now();
        // 1 for anything that fits in the ceiling, which is very nearly everything.
        const rate = dragPlaybackRate(res.et);
        dragTimer.current = setInterval(() => {
          const el = ((Date.now() - t0) / 1000) * rate;
          dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'dragT', value: el });
          // Hold on the finish for a moment so the time slip is readable.
          if (el > res.et + DRAG_HOLD_S * rate) {
            clearInterval(dragTimer.current);
            dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'dragRunning', value: false });
            dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'treePhase', value: 0 });
          }
        }, DRAG_FRAME_MS);
      }, TREE_GREEN_MS),
    ];
  };
  // Both the tree and the playback clock outlive a single render, so both have to be
  // torn down on unmount or a run continues against a component that is gone.
  useEffect(() => () => {
    clearInterval(dragTimer.current);
    treeTimers.current.forEach(clearTimeout);
  }, []);

  // Keep the live-engine config in a ref so the loop always uses current tuning
  // without needing to restart the interval every time a table changes.
  liveCfgRef.current = {
    ve, veTruth, timing, afr, derived: engineDerived, fuel, injectorCc, ecuInjectorCc, mods, mafScalar, mafErrorBase,
    turboOn, boostCurve, octaneBonus, turbine,
    compressor: COMPRESSOR_OPTS[compressorIdx], exhaustDiaError,
    ...(blower ? { blower, blowerRatio } : {}), ...(nitrous ? { nitrous } : {}),
    // The live engine runs its own ECU controllers against the same calibration, with
    // whatever accessories are switched on.
    ecu: { ...ecuBundle, aux: liveAux },
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
  // Nothing about the note is decided here. `acousticDrive` turns the operating point
  // into the physical properties of the exhaust — firing geometry, cylinder pressure,
  // gas temperature — and `audio/engineAudio.js` renders them.
  // These two functions only start and stop the engine.
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
  //
  // `loadCareer()` is an `await`, so a pull can bank between mount and this resolving
  // — reachable in practice on the `artifact` storage backend, where the underlying
  // `window.storage.get` is a real round trip. A single RESTORE_CAREER action, rather
  // than the five separate `SET_SESSION_FIELD` dispatches this used to fire, is what
  // keeps that race from rolling a banked pull back to the pre-pull snapshot: the
  // reducer MERGES the loaded career with whatever the session already holds instead
  // of overwriting it. See RESTORE_CAREER's own doc in reducer.js for the full case,
  // including why a skip-instead-of-merge fix would only move the data loss.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCareer();
      if (cancelled) return;
      dispatch({ type: ACTIONS.RESTORE_CAREER, career: c });
      careerLoaded.current = true;
    })();
    return () => { cancelled = true; };
    // Stable for the life of the store, so this still loads career stats exactly once.
  }, [dispatch]);

  // Career state is written back whenever it moves. This replaces a save call inside
  // `doRun`, which could not cover the pin: pinning is a dispatch like any other and
  // has no natural "and now save" call site. An effect over the persisted fields does.
  useEffect(() => {
    if (!careerLoaded.current) return;
    saveCareer({ best: bestScore, total: totalScore, pulls: pullCount, runs, pinnedRunId });
  }, [bestScore, totalScore, pullCount, runs, pinnedRunId]);

  // Cmd/Ctrl+Z and Cmd+Shift+Z / Ctrl+Y. This lives here rather than in AppShell,
  // whose header is explicit that the shell owns chrome only and never dispatches to
  // the store — a global key handler is app behaviour, not chrome.
  //
  // PR 4b's arrow-key tuning will need this same seam.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      // Ctrl+Alt is AltGr on many European keyboard layouts, where AltGr+Z / AltGr+Y
      // types a real character. Excluding altKey keeps this handler from stealing
      // that keystroke and swallowing it with preventDefault().
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      // Never steal undo from a field the player is typing in.
      const el = /** @type {HTMLElement|null} */ (e.target);
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      e.preventDefault();
      const redo = key === 'y' || e.shiftKey;
      dispatch({ type: redo ? ACTIONS.REDO : ACTIONS.UNDO });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const ghost = ghostRun(runs, pinnedRunId);

  const chartData = useMemo(() => {
    if (!result) return [];
    // Keyed by RPM, not by array position. Today the two are the same thing —
    // SWEEP_START_RPM and SWEEP_STEP_RPM are constants, so points[i].rpm is always
    // 1500 + 100i — but a PINNED run may be any length, and the join should state
    // what it means rather than lean on an invariant two modules away.
    const ghostByRpm = new Map((ghost?.points ?? []).map((p) => [p.rpm, p]));
    return result.points.slice(0, running ? revealCount : result.points.length).map((p) => {
      const g = ghostByRpm.get(p.rpm);
      return {
        rpm: p.rpm, hp: p.hp, torque: p.torque, afr: p.afr, afrCommanded: p.afrCommanded,
        timing: p.timing, commandedTiming: p.commandedTiming, duty: p.duty, trimPct: p.trimPct,
        prevHp: g?.hp, prevTorque: g?.torque,
      };
    });
  }, [result, ghost, running, revealCount]);

  // The shell computes these for the same reason it computes `chartData`: the screen
  // is handed a model rather than deriving one.
  const bands = useMemo(() => (result ? eventBands(result.events) : []), [result]);
  const wholePullCount = useMemo(
    () => (result ? result.events.filter((e) => !isLocatable(e)).length : 0),
    [result],
  );

  /**
   * Opens the pull log focused on `rpm`, or on nothing when null. Both the bands and
   * the whole-pull note go through here.
   * @param {number|null} rpm
   */
  const selectLogRpm = (rpm) => {
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'logFocusRpm', value: rpm });
    goSection('dyno', 'log');
  };

  // `buildHistogram`/`applyHistogram` moved to DataScreen.jsx: DYNO's DATALOG
  // section was their only caller, and everything they touch (result, histogram,
  // ve) is plain store state DataScreen can read for itself.

  // During a pull the tach follows the pull's own clock, which includes the idle and the
  // overrun either side of the sweep; otherwise it reads the last point drawn.
  const currentRpm = running
    ? dynoRpm
    : (result ? (result.points[Math.min(revealCount, result.points.length - 1)]?.rpm ?? 1500) : 1500);
  // A SCORE IS A MEASUREMENT, SO IT IS TAKEN ONCE AND KEPT.
  //
  // This was a memo that recomputed the Engineer and Pull scores from whatever hardware
  // was selected RIGHT NOW, and graded them against the LAST pull's dyno output. Change
  // a turbo after a pull and that finished run was silently re-graded as though it had
  // been made on the new build — a number the engine never produced, from a session
  // that never happened. The Pull Score moved with it, so it could climb past
  // `bestScore` with nobody running anything, and the badge lit up NEW BEST for a
  // figure that was never banked. The app's whole method is change one thing, MEASURE,
  // revert; a score that moves without a measurement contradicts the thing it teaches.
  //
  // So `doRun` banks what it computed (BANK_PULL) and this only reads it back. The one
  // thing still decided here is WHEN to show it: `result` is replaced at sweep start,
  // so publishing the banked scores during `running` would give away the next pull's
  // final grade before its reveal has drawn a single point.
  const scores = running ? null : pullScores;

  // True when the setup has moved since the pull those scores came from. The evidence
  // stays on screen and is labelled, rather than being deleted: erasing the previous
  // pull would hide the exact before/after comparison the player is in the middle of
  // making. See ScoreScreen and StatsScreen for how each says so.
  const scoresStale = !!scores && scores.signature !== buildSignature;

  // Drive the audio from whichever engine is actually turning — and only while the
  // relevant page is open, so sound stops the moment you navigate away.
  //
  // Nothing here decides what the engine sounds like. `acousticDrive` turns the operating
  // point into the physical properties of the exhaust note, and `updateEngineAudio`
  // renders them; this effect only says which engine is running and how hard.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onDyno = tab === 'dyno' && running && result;
    // Which screen the running engine is heard on.
    const onLive = tab === 'live' && (live.running || live.cranking);
    // The drag run drives the same engine: revs sweep within each gear and drop on every
    // shift, so the whole pass is audible. The trace is the same one the strip is
    // drawing, so what is heard and what is seen are one run.
    const onDrag = tab === 'drag' && dragRunning && dragResult && result;
    const dragPt = onDrag
      ? (dragResult.trace.find((pt) => pt.t >= dragT) ?? dragResult.trace[dragResult.trace.length - 1])
      : null;
    // And whether it is heard at all: one of those has to be on screen.
    const audible = Boolean((onDyno || onLive || onDrag) && soundOn);

    const rpm = onDrag ? (dragPt?.rpm ?? 0) : onDyno ? currentRpm : live.rpm;
    const dynoPt = onDyno ? result.points[Math.min(revealCount, result.points.length - 1)] : null;
    // The operating point the note is rendered from. The drag trace carries no cylinder
    // pressure or gas temperature of its own, but its torque curve IS the last pull's, so
    // it borrows that pull's measured point nearest the engine speed it is at — the same
    // engine, measured at the same revs.
    const point = onDyno ? dynoPt
      : onDrag ? nearestPoint(result.points, rpm)
        : (live.running ? live.live : null);
    // Throttle position. A dyno sweep is wide open; the bookends are not, and the overrun
    // is a closed throttle — which is what makes the blow-off fire when the pull ends,
    // exactly where you would hear it on a real dyno. On the strip it is the DRIVER'S
    // throttle, which is why a car being feathered off a spinning tyre sounds different
    // from one that hooked.
    const load = onDyno
      ? (dynoPhase === 'sweep' ? 1 : dynoPhase === 'spooldown' ? 0.04 : 0.10)
      : onDrag ? (dragPt?.throttle ?? 1)
        : clamp((live.effThrottle ?? 0) / 100, 0, 1);
    const cut = onLive ? live.fuelCut
      : onDrag ? Boolean(dragPt?.limiter)
        : Boolean(onDyno && dynoPhase === 'spooldown');

    const drive = acousticDrive({
      rpm, derived: engineDerived, point, turboOn,
      compressor: COMPRESSOR_OPTS[compressorIdx],
      // The sweep only ever measures wide-open points, so the idle and overrun either
      // side of it — and every point of a drag pass — borrow one and scale it by throttle.
      throttle: onDyno || onDrag ? load : 1,
      // No injectors, no combustion, so the cylinder reaches the exhaust valve at motored
      // pressure. The renderer does not need to know what a rev limiter is.
      fuelCut: cut,
    });
    // A supercharger's whine: its lobes, or its impeller's blades, passing the outlet — a
    // pitch locked to the crank through the belt, where a turbo's whistle floats with the
    // exhaust. It takes the turbo's voice, which a supercharged engine has no other use for.
    const frame = {
      drive: blower
        ? { ...drive, whistleHz: Math.min(9000, (blowerSpeedRpm(blower, rpm, blowerRatio) / 60) * blower.whineOrder) }
        : drive,
      // The exhaust system, for the renderer. Everything the player can change
      // about the hardware arrives here: cylinder count and layout set the firing order
      // and how many primaries meet at each collector, displacement sets their length and
      // bore, the pipe menu sets the tailpipe, and the gas temperature the cycle computed
      // sets the speed of sound that every one of those lengths is divided by.
      geometry: exhaustGeometry({
        displacementL: engineDerived.displacementL, cyl: engineDerived.cyl,
        bore: engineConfig.bore, compression: engineConfig.compression,
        configuration: engineConfig.configuration,
        pipeDiaIn: EXHAUST_DIA_OPTS[exhaustDiaIdx].dia, gasTempK: drive.gasTempK,
        headers: Boolean(mods.headers), turboFitted: Boolean(turboOn),
      }),
      rpm,
      configuration: engineConfig.configuration,
      load,
      audible,
      cut,
      cranking: Boolean(onLive && live.cranking),
      openExhaust: Boolean(mods.exhaust || mods.headers),
      intakeFitted: Boolean(mods.intake),
      // Boost only counts while the throttle is open; dropping it on the overrun is what
      // the renderer watches for to vent. The drag model carries no boost trace of its
      // own, so the whistle and the blow-off sit out the pass rather than being given a
      // number nothing measured at that throttle.
      boostPsi: (onDyno && dynoPhase !== 'sweep') || onDrag ? 0 : (point?.boostPsi ?? 0),
      volume,
    };

    // One call. The renderer schedules its firing events ahead of the audio clock, so
    // nothing about the exhaust's timing depends on how often React gets around to this.
    updateEngineAudio(a, frame);

    // The drivetrain, which only the strip has. A gearchange is heard as the gear in the
    // trace steps up; an automatic's converter whines while it slips off the line and
    // fades as road speed couples it up — both straight from the solved pass.
    const box = GEARBOX_OPTS[car.boxIdx] ?? GEARBOX_OPTS[0];
    const automatic = box.box === 'auto';
    const gear = onDrag ? (dragPt?.gear ?? 0) : 0;
    if (audible && gear > dragGearRef.current && dragGearRef.current > 0) {
      shiftEngineAudio(a, { automatic });
    }
    dragGearRef.current = gear;
    const slip = onDrag && automatic && box.couplingSpeedMs > 0
      ? 1 - clamp((dragPt?.v ?? 0) / box.couplingSpeedMs, 0, 1)
      : 0;
    if (slip > 0 || converterOnRef.current) {
      converterEngineAudio(a, { rpm, slip, audible });
      converterOnRef.current = slip > 0;
    }
  }, [live.rpm, live.running, live.cranking, live.effThrottle, live.fuelCut, live.live, soundOn,
      blower, blowerRatio,
      engineDerived, engineConfig.configuration, engineConfig.bore, engineConfig.compression,
      exhaustDiaIdx, compressorIdx,
      mods.intake, mods.exhaust, mods.headers, turboOn, volume, dynoPhase,
      running, currentRpm, revealCount, result, tab, dragRunning, dragResult, dragT, car.boxIdx]);

  // Whether anything should be making a sound right now. When nothing should, the graph
  // is silenced at once and the audio context suspended a moment later, so a stopped
  // engine costs no DSP at all — see `setEngineAudioActive`.
  const sounding = soundOn && (
    (tab === 'dash' && (live.running || live.cranking))
    || (tab === 'dyno' && running)
    || (tab === 'drag' && (dragRunning || treePhase > 0)));
  useEffect(() => {
    const a = audioRef.current;
    if (a) setEngineAudioActive(a, sounding);
  }, [sounding]);

  // Hard-stop audio on unmount or when the tab changes away from a sounding page.
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) { try { silenceEngineAudio(a); } catch { /* noop */ } }
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
    { id: 'airflow', label: 'AIRFLOW', icon: Grid3x3, row: 0 },
    { id: 'spark', label: 'SPARK', icon: Zap, row: 0 },
    { id: 'fuel', label: 'FUEL', icon: Droplets, row: 0 },
    { id: 'injectors', label: 'INJECTORS', icon: Fuel, row: 0 },
    { id: 'sensors', label: 'SENSORS', icon: Activity, row: 0 },
    { id: 'boost', label: 'BOOST', icon: Gauge, row: 1 },
    { id: 'vvt', label: 'VVT', icon: RotateCw, row: 1 },
    { id: 'idle', label: 'IDLE', icon: Timer, row: 1 },
    { id: 'protect', label: 'PROTECT', icon: ShieldAlert, row: 1 },
    { id: 'torque', label: 'TORQUE', icon: Crosshair, row: 1 },
    // Its own row, and only with a kit fitted — the way real ECU software shows its
    // nitrous tables once nitrous is enabled.
    { id: 'nitrous', label: 'NITROUS', icon: Flame, row: 2 },
  ];
  // The VE table corrected from what was logged: the last pull while it still matches
  // the tune on screen, and the LIVE datalog. Only worked out while AIRFLOW is open.
  const veLogOpen = tab === 'tune' && tuneView === 'airflow';
  const pullFresh = !!result && !!pullScores && pullScores.signature === buildSignature;
  const veLogPull = useMemo(() => (veLogOpen && pullFresh ? veSamplesFromPull(result.points) : []), [veLogOpen, pullFresh, result]);
  const liveLog = live?.ecu?.log;
  const veLogLive = useMemo(() => (veLogOpen ? veSamplesFromLive(liveLog, ve) : []), [veLogOpen, liveLog, ve]);
  // Why the last pull is, or is not, in the numbers — a log only describes the tune it
  // was taken on, and a part-throttle pull is closed loop, where the trims set the mixture.
  /** @type {{state: 'none'|'stale'|'part-load'|'unused'|'ok', changed?: string[]}} */
  const pullInfo = !veLogOpen || !result ? { state: 'none' }
    : !pullFresh ? { state: 'stale', changed: runs?.[0]?.inputs ? diffMeasuredInputs(runs[0].inputs, measuredInputs(build, tune, loadKpa)) : [] }
      : result.points.every((p) => !p.openLoop) ? { state: 'part-load' }
        : veLogPull.length === 0 ? { state: 'unused' } : { state: 'ok' };
  const veLog = veLogOpen ? {
    pull: veLogPull, live: veLogLive, airModel: tune.ecu?.config?.airModel ?? 'blend', pullInfo,
    onApply: (share) => {
      const { ratio } = veCorrections([...veLogPull, ...veLogLive]);
      dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: applyVeCorrections(ve, ratio, share), label: `VE from logs (${share === 1 ? 'all' : 'half'})` });
      // The long-term trim had been covering the error just moved into the table.
      dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'liveAux', value: { ...liveAux, trimResets: (liveAux.trimResets ?? 0) + 1 } });
    },
  } : null;
  const TUNE_GROUPS = ['BASE TABLES & HARDWARE', 'ENGINE MANAGEMENT', 'POWER ADDER'];
  // Which TUNE pages the last pull's log points at — only while that pull still
  // describes the setup on screen, so a fixed problem does not keep its flag.
  const attention = result && !scoresStale && !running ? tuneAttention(result.events) : {};
  // The operating point the table editors mark, while the LIVE engine is running.
  const liveEcu = live?.ecu;
  const liveRow = liveEcu?.log?.[liveEcu.log.length - 1];
  const liveVars = live?.running && liveRow ? {
    rpm: live.rpm, map: liveEcu.sMap, ect: liveEcu.sEct, iat: liveEcu.sIat, volts: liveEcu.volts,
    tps: liveEcu.sTps, pedal: throttleInput, maf: live.live?.maf, camIn: liveEcu.camIn,
    boostTarget: liveEcu.boostTargetRamped, baro: ecuBundle.cond.env.baroKpa,
  } : null;

  if (appView === 'start') {
    return (
      <StartScreen
        onCareer={() => {
          // Career skips the guided build: its jobs hand the player a car that already
          // exists, with a fault in it, and the jobs board is where that starts.
          dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'mode', value: 'career' });
          dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 });
          goSection('dash', 'jobs');
        }}
        onStart={() => {
          dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'mode', value: 'sandbox' });
          goTab('build');
        }}
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
        {/* ---------- HOME: customer jobs, career stats, health, learning ---------- */}
        {/* One component per section, each reading the store for itself. `live` is read
            ONLY inside LiveScreen: the 20 Hz LIVE_STEP re-render stops there rather than
            passing through a HOME-level parent that would drag the other three with it. */}
        {tab === 'dash' && (
          <div style={{ padding: 16 }}>
            {/* Customer jobs are CAREER's. Free play has no objectives, so it has no
                jobs board — unless a job is already underway, which must stay reachable. */}
            {(mode === 'career' || activeJob != null) && (
              <JobsScreen
                active={dashSection === 'jobs'} onToggle={toggleDashSection}
                onTakeJob={takeJob} onAbandon={abandonJob}
              />
            )}
            <StatsScreen
              active={dashSection === 'stats'} onToggle={toggleDashSection}
              scores={scores} scoresStale={scoresStale}
            />
            <HealthScreen
              active={dashSection === 'health'} onToggle={toggleDashSection}
              overallHealth={overallHealth} needsMafRecal={needsMafRecal}
            />
            <LearnScreen active={dashSection === 'learn'} onToggle={toggleDashSection} />
            <RealCarScreen active={dashSection === 'realcar'} onToggle={toggleDashSection} />
          </div>
        )}

        {/* ---------- LIVE: the engine running in real time ---------- */}
        {/* Its own tab, between TUNE and DYNO, because that is the real working order:
            design it, calibrate it, HEAR IT RUN, then measure it. It was a collapsed
            section on HOME, several taps down and easy never to find. It is a page, not
            an accordion card, so nothing about it reads as a HOME section. */}
        {tab === 'live' && (
          <div style={{ padding: 16 }}>
            {journeyStep === 2 && <JourneyBanner step={2} onAdvance={() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 3 }); changeTab('dyno'); }} onDismiss={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} />}
            <LiveScreen
              tachFullScaleRpm={tachFullScaleRpm}
              onStart={startEngine} onStop={stopEngine}
              onToggleSound={toggleSound} onThrottle={setThrottleInput}
              onTestSound={testSound}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px 0' }}>
            <MapSlots />
            {/* Grouped rows, each named for what its pages are: the base tables and the
                parts they are scaled for, the ECU's control strategies, and a power
                adder's own controller. Five to a row at 60px basis so each row stays one
                row on a phone. A number on a page is how many of the last pull's log
                entries send you there — shown only while that pull still describes this
                setup. */}
            {(nitrous ? [0, 1, 2] : [0, 1]).map((rowIdx) => (
              <div key={rowIdx}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: T.ink3, margin: '4px 0 5px' }}>
                  {TUNE_GROUPS[rowIdx]}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {TUNE_VIEWS.filter((v) => v.row === rowIdx).map((v) => {
                    const on = tuneView === v.id;
                    const Icon = v.icon;
                    const flagged = attention[v.id] ?? 0;
                    return (
                      <button key={v.id} onClick={() => { goSection('tune', v.id); setSelection(null); }}
                        aria-label={flagged ? `${v.label}, named by ${flagged} ${flagged === 1 ? 'entry' : 'entries'} in the last pull's log` : undefined}
                        style={{
                          position: 'relative', flex: '1 1 60px', padding: '9px 0 8px', borderRadius: 10, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 9.5, letterSpacing: 0.3,
                          border: `1px solid ${on ? T.acc : T.line}`, background: on ? T.accBg : rowIdx ? T.panel : T.panel2,
                          color: on ? T.accInk : T.ink2,
                        }}>
                        <Icon size={15} />{v.label}
                        {flagged > 0 && (
                          <span aria-hidden="true" style={{
                            position: 'absolute', top: 3, right: 4, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8,
                            background: T.warnBg, border: `1px solid ${T.warn}`, color: T.warnInk,
                            fontSize: 9, fontFamily: T.mono, lineHeight: '13px', textAlign: 'center',
                          }}>{flagged}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {Object.keys(attention).length > 0 && (
              <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 2 }}>
                Numbered pages are where the last pull&apos;s log sends you — DYNO › PULL LOG has the details.
              </div>
            )}
          </div>
        )}

        {tab === 'tune' && journeyStep === 1 && (
          <div style={{ padding: '14px 16px 0' }}>
            {/* Step 2 is LIVE, which this branch gives its own tab. */}
            <JourneyBanner step={1} onAdvance={() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 2 }); changeTab('live'); }} onDismiss={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} />
          </div>
        )}

        {tab === 'tune' && tuneView === 'airflow' && (
          <AirflowScreen veLog={veLog}>
            <EcuSection embedded section="airflow" title="Air model" icon={Wind} liveVars={liveVars} />
          </AirflowScreen>
        )}

        {tab === 'tune' && tuneView === 'spark' && (
          <SparkScreen calAdvice={calAdvice}>
            <EcuSection embedded section="spark" title="Spark corrections & knock control" icon={Zap} liveVars={liveVars} />
          </SparkScreen>
        )}

        {tab === 'tune' && tuneView === 'fuel' && (
          <FuelScreen calAdvice={calAdvice}>
            <EcuSection embedded section="fuel" title="Fuel strategy & enrichment" icon={Droplets} liveVars={liveVars} />
          </FuelScreen>
        )}

        {tab === 'tune' && tuneView === 'injectors' && (
          <InjectorsScreen dutyPreview={dutyPreview} injectorCc={injectorCc}>
            <div style={{ padding: '0 16px' }}>
              <EcuSection embedded section="injectors" title="Injector settings" icon={Fuel} liveVars={liveVars} />
            </div>
          </InjectorsScreen>
        )}

        {tab === 'tune' && tuneView === 'sensors' && (
          <SensorsScreen needsMafRecal={needsMafRecal} chartData={chartData} result={result}>
            <div style={{ padding: '0 16px' }}>
              <EcuSection embedded section="sensors" title="Sensor calibration" icon={Activity} liveVars={liveVars} />
            </div>
          </SensorsScreen>
        )}

        {tab === 'tune' && ['boost', 'vvt', 'idle', 'protect', 'torque', 'nitrous'].includes(tuneView) && (() => {
          const v = TUNE_VIEWS.find((x) => x.id === tuneView);
          const titles = { boost: 'Boost control', vvt: 'Variable cam timing', idle: 'Idle control', protect: 'Engine protection', torque: 'Torque management', nitrous: 'Nitrous control' };
          return <EcuControlScreen section={/** @type {any} */ (tuneView)} title={titles[tuneView]} icon={v.icon} liveVars={liveVars} />;
        })()}

        {/* ---------- DYNO: run a pull, then curves / log / datalog / score ---------- */}
        {tab === 'dyno' && (
          <div style={{ padding: 16 }}>
            {journeyStep === 3 && <JourneyBanner step={3} onAdvance={() => { dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 4 }); changeTab('drag'); }} onDismiss={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} />}
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
            <Eyebrow icon={Activity}>Dyno Cell</Eyebrow>
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8, fontWeight: 600 }}>Manifold pressure for the pull (load)</div>
            <Seg label="Manifold pressure for the pull (load)" options={[100, 70, 40].map((l) => ({ label: `${l} kPa`, id: l }))} value={loadKpa} onChange={(v) => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'loadKpa', value: v })} />
            <div style={{ fontSize: 10.5, color: T.ink3, marginTop: 4, marginBottom: 4 }}>
              ~100 kPa is wide-open throttle naturally aspirated. Boost adds on top and walks the tables into the higher-MAP rows automatically.
            </div>
            {nitrous && (
              <div style={{ marginTop: 10 }}>
                <Toggle label="Spray nitrous on this pull" sub={`${nitrous.shotHp} shot ${nitrous.kit} kit, inside the window on TUNE › NITROUS — the same arming switch as LIVE`}
                  checked={nitrousArmed} onChange={(v) => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'liveAux', value: { ...liveAux, nitrous: v } })} />
              </div>
            )}

            <div style={{ margin: '14px 0' }}><Tach rpm={running || result ? currentRpm : 1500} cylinders={engineDerived.cyl} running={running} fullScaleRpm={tachFullScaleRpm} /></div>

            {/* The app's most important control, and the one PR 1's review caught
                rendering its label at 1.14:1 while running — panel3 fill under ink2
                text. `disabled` now dims the whole button instead of recolouring the
                label, so the contrast between fill and label never changes.

                Deliberately NOT `block`. This sits in the main content column, which
                on a desktop window is the window; the hand-rolled width:100% here is
                the literal button that spanned the screen. `lg` gives it its weight
                instead.

                The label names the PHASE, because the pull is now a sequence rather
                than a single sweep and the button is the only thing on screen that
                says which part of it you are listening to. */}
            <div style={{ marginBottom: 16 }}>
              <Button size="lg" onClick={doRun} disabled={running}>
                <Play size={16} aria-hidden="true" />
                {!running ? 'RUN DYNO PULL'
                  : dynoPhase === 'settle' ? 'IDLING…'
                    : dynoPhase === 'sweep' ? 'SWEEPING…'
                      : dynoPhase === 'spooldown' ? 'COMING BACK DOWN…'
                        : 'SETTLING…'}
              </Button>
            </div>

            {result && (
              <>
                <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  <StatTile label="PEAK WHP" value={result.peakHp} tone="acc" />
                  <StatTile label="PEAK TQ" value={result.peakTq} unit="lb-ft" tone="alt" />
                </div>

                {runs[1] && !running && (() => {
                  const prev = runs[1];
                  const dHp = result.peakHp - prev.peakHp;
                  const dTq = result.peakTq - prev.peakTq;
                  const knockNow = result.events.filter((e) => e.type === 'knock').length;
                  const dKnock = knockNow - prev.knocks;
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
              </>
            )}

            {/* HISTORY sits outside the `result` gate deliberately: its data (`runs`)
                outlives `result` — it is restored from storage on a cold start, while
                `result` is not persisted and is cleared by APPLY_PRESET — so it is the
                first DYNO section for which that is true. When there is no result yet,
                the switcher below shows ONLY the history entry, since the other four
                lead to sections that render nothing without one. */}
            {!running && (result || runs.length > 0) && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {(result
                  ? [['result', 'CURVES'], ['log', 'PULL LOG'], ['data', 'DATALOG'], ['score', 'SCORE'], ['history', 'HISTORY']]
                  : [['history', 'HISTORY']]
                ).map(([id, label]) => {
                  const on = dynoView === id;
                  const flag = id === 'log' && result && result.events.length > 0;
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

            {result && (
              <>
                {/* DYNO's gating is irregular ON PURPOSE, not four uniform
                    `dynoView === x` checks like TUNE's. While a pull is running the
                    switcher above is hidden and CURVES is the only view that can show
                    — "the machine is busy, watch this" — regardless of which section
                    the URL has selected. Normalising these to match TUNE would make a
                    DATALOG/PULL LOG/SCORE view silently go blank the moment a pull
                    starts instead of falling back to the live curves. Preserve every
                    condition exactly. */}
                {(running || dynoView === 'result') && (
                  <ResultScreen
                    chartData={chartData}
                    engineDerived={engineDerived}
                    ghostLabel={ghostLabel(ghost, pinnedRunId)}
                    // `bands` is memoised on `result`, which is banked at sweep START —
                    // same hazard `scores` guards a few lines up, with the same fix:
                    // hide it for the duration of `running` rather than let it leak the
                    // next pull's full knock/lean tint onto a chart that has not drawn a
                    // trace yet. A band clicked mid-reveal would also dispatch and
                    // navigate to a log gated on `!running`, doing nothing for seconds
                    // and then jerking the view once the pull finishes.
                    bands={running ? [] : bands}
                    wholePullCount={running ? 0 : wholePullCount}
                    onSelectRpm={selectLogRpm}
                  />
                )}

                {!running && dynoView === 'data' && (
                  <DataScreen />
                )}

                {!running && dynoView === 'log' && (
                  <LogScreen />
                )}

                {!running && dynoView === 'score' && scores && (
                  <ScoreScreen scores={scores} stale={scoresStale} />
                )}
              </>
            )}

            {!running && dynoView === 'history' && (
              <HistoryScreen />
            )}
          </div>
        )}

        {/* ---------- DRAG: put the engine in a car and run the quarter ---------- */}
        {/* `torqueCurveNm`, `runDrag` and the playback clock are the shell's, for the
            same reason the dyno reveal is: the run needs the audio context and a timer
            that outlives a render. The screen reads the solved run back out of the
            store and draws it. */}
        {tab === 'drag' && (
          <div style={{ padding: 16 }}>
            {journeyStep === 4 && <JourneyBanner step={4} onAdvance={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} onDismiss={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'journeyStep', value: 99 })} />}
            <DragScreen
              section={dragSection} onToggle={toggleDragSection}
              result={result} engineDerived={engineDerived} onRun={runDrag}
            />
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
