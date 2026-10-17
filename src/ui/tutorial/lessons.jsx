/**
 * The Tuning Course: five chapters of lessons, each teaching one thing, about forty
 * minutes in all. Opened from HOME › Learn; the five-minute tutorial (quickTour.jsx)
 * is the way in for someone new, and points here.
 *
 * Every number a lesson quotes is worked out when the lesson opens, from the same
 * simulator the game runs (see scenarios.js), so "the stock V6 makes 254 whp at 6500
 * RPM" is whatever the player's own first pull will say, today and after the physics
 * next changes. Every screen shown is the real screen (see ScreenSnippet.jsx).
 *
 * The lesson shape follows what tutorial writers keep arriving at: say what the reader
 * will be able to do and what they need, show the real thing, work one example through
 * with real numbers, have them do it in the game, tell them what they did, and cover
 * what usually goes wrong. Background that is useful but not needed goes in an Aside.
 */

import React, { useState } from 'react';

import { AppShell } from '../AppShell.jsx';
import { AirflowScreen } from '../screens/tune/AirflowScreen.jsx';
import { FuelScreen } from '../screens/tune/FuelScreen.jsx';
import { SparkScreen } from '../screens/tune/SparkScreen.jsx';
import { SensorsScreen } from '../screens/tune/SensorsScreen.jsx';
import { DataScreen } from '../screens/dyno/DataScreen.jsx';
import { LogScreen } from '../screens/dyno/LogScreen.jsx';
import { ResultScreen } from '../screens/dyno/ResultScreen.jsx';

import { applyVeCorrections, veCorrections } from '../../sim/index.js';
import { ACTIONS } from '../state/reducer.js';
import { useTune } from '../state/StoreProvider.jsx';

import { airPerCylinder, runDemo, veCellMaths } from './demoEngine.js';
import { Aside, Did, Do, F, Goal, H, K, List, P, Trouble, Worked } from './LessonParts.jsx';
import {
  INTAKE_MAF_SCALAR, LOAD, RPM, SPARK_ADDED_DEG, WOT, intakeFitted, intakeRetuned, overAdvanced, peaks, pointAt, stock,
} from './scenarios.js';
import { ScreenSnippet } from './ScreenSnippet.jsx';

/** A selected grid cell, as the store holds it. */
const cell = (rpm, load) => ({ type: 'cell', row: LOAD.indexOf(load), col: RPM.indexOf(rpm) });
/** A seed that selects `sel` on the snippet's grid. @param {object} sel */
const selecting = (sel) => (/** @type {any} */ s) => ({ ...s, tune: { ...s.tune, selection: sel } });
const n1 = (v) => v.toFixed(1);

/** E85 on the stock 315cc injectors: the fuel it needs outruns the time there is. */
const e85StockInjectors = () => runDemo('e85-stock-injectors', (s) => ({ ...s, build: { ...s.build, octaneIdx: 3 } }));

/**
 * AIRFLOW inside a snippet, with its log correction working the way it does in the
 * game: APPLY changes the sandbox's own table, and the pull then no longer describes
 * the tune on screen, so the panel asks for another one. Rendered inside the
 * snippet's store, so `useTune` is the sandbox's.
 *
 * @param {{demo: import('./demoEngine.js').Demo}} props
 */
function LiveAirflow({ demo }) {
  const [tune, dispatch] = useTune();
  const [applied, setApplied] = useState(false);
  const veLog = applied
    ? { ...demo.veLog, pull: [], pullInfo: { state: /** @type {'stale'} */ ('stale'), changed: ['VE table'] } }
    : {
      ...demo.veLog,
      onApply: (/** @type {number} */ share) => {
        const { ratio } = veCorrections(demo.veLog.pull);
        dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: applyVeCorrections(tune.ve, ratio, share), label: `VE from logs (${share === 1 ? 'all' : 'half'})` });
        setApplied(true);
      },
    };
  return <AirflowScreen veLog={veLog} />;
}

/* ------------------------------------------------------------------ chapter 1 */

function AirPump() {
  const d = stock();
  const { hp, tq } = peaks(d);
  return (
    <>
      <Goal learn="know the three decisions an engine computer makes, and which screen holds each one." need="Nothing. No car knowledge is assumed." />
      <P>An engine is an air pump. However much air it swallows decides how much fuel can be burned, and burning fuel is what makes power. The engine computer (the ECU) makes three decisions, hundreds of times a second:</P>
      <List items={[
        <><b>How much air is in the cylinder?</b> It works this out from pressure, temperature and the <K>AIRFLOW</K> table.</>,
        <><b>How much fuel does that air need?</b> The <K>FUEL</K> table says what mixture to aim for.</>,
        <><b>When should the spark fire?</b> The <K>SPARK</K> table says how early.</>,
      ]} />
      <P>Tuning means getting those three tables right at every speed and load. Everything else in the game exists to change how much air gets in, or how much of the fuel&apos;s energy you can safely use.</P>
      <Worked title="the engine you start with" rows={[
        ['Engine', `${d.derived.displacementL.toFixed(1)} L V${d.derived.cyl}, naturally aspirated`],
        ['Fuel', `${d.fuel.label} octane pump gas`],
        ['Peak power on the dyno', `${hp.hp} whp at ${hp.rpm} RPM`],
        ['Peak torque', `${tq.torque} lb-ft at ${tq.rpm} RPM`],
      ]}>
        These are the numbers your own first pull will show. They come from the same simulation the game runs, not from a spec sheet.
      </Worked>
      <Did>You now know the whole job in one sentence: measure the air, add the right fuel, light it at the right moment. Every lesson after this is one of those three, or how to check your work.</Did>
      <Aside title="Why &ldquo;wheel horsepower&rdquo;?">
        <p>The dyno measures power at the wheels (whp), after the gearbox and driveline have taken their share. It is lower than the crank figure a maker quotes. Every number in the game is at the wheels unless it says otherwise.</p>
      </Aside>
    </>
  );
}

function FindYourWay() {
  const d = stock();
  return (
    <>
      <Goal learn="find every part of the game, and read the strip that is always on screen." need="Lesson 1.1." />
      <P>This is the frame around every screen in the game. It is shown here live, with the SANDBOX engine you get when you start.</P>
      <ScreenSnippet
        where="Every screen"
        demo={d}
        height={330}
        callouts={[
          { at: '[data-tour="nav-build"]', text: <><K>BUILD</K> is the hardware: bore, stroke, cam, turbo, fuel system. Change it here and the engine really changes.</> },
          { at: '[data-tour="nav-tune"]', text: <><K>TUNE</K> is the calibration: the three tables, then the ECU&apos;s own settings.</> },
          { at: '[data-tour="nav-dyno"]', text: <><K>DYNO</K> measures it. Nothing is known until you pull.</> },
          { at: '[data-testid="build-line"]', text: 'The build line: engine, induction, fuel, injectors and the game version.' },
          { at: '[data-tour="strip-last-pull"]', text: 'LAST PULL: the peak power of your most recent dyno pull.' },
          { at: '[data-tour="strip-health"]', text: 'HEALTH: knock, heat and pressure wear the engine. The wrench next to it repairs it.' },
        ]}
        caption="The nav and the status strip. HOME has your jobs and the Learn articles; LIVE runs the engine in real time; DRAG puts it in a car."
      >
        <div style={{ height: 320, display: 'flex', flexDirection: 'column' }}>
          <AppShell route={{ view: 'app', tab: 'tune', section: 'airflow' }} onNavigate={() => {}} onTutorial={() => {}} onRepair={() => {}}>
            <div style={{ padding: 16, color: 'var(--ink-soft)', fontSize: 13 }}>The screen for the tab you pick opens here.</div>
          </AppShell>
        </div>
      </ScreenSnippet>
      <Do steps={[
        <>Tap each of <K>BUILD</K>, <K>TUNE</K> and <K>DYNO</K> once, to see where things live.</>,
        <>This course is always on <K>HOME › Learn</K>; the <K>(i)</K> button at the right of the strip opens the five-minute tutorial.</>,
      ]} />
      <Did>You know the working order a tuner uses: build it, tune it, measure it. The tabs run in that order, left to right.</Did>
    </>
  );
}

/* ------------------------------------------------------------------ chapter 2 */

function AirflowLesson() {
  const d = stock();
  const a = airPerCylinder(d, 4500, 100);
  return (
    <>
      <Goal learn="read the AIRFLOW (VE) table, and work out the air in one cylinder yourself." need="Chapter 1." />
      <P>The ECU cannot weigh the air going into a cylinder. It works it out from three things it can measure (manifold pressure, air temperature and engine speed) and one it is told: <b>volumetric efficiency</b>, or VE. VE is how completely the cylinder fills compared with its own size. 100% means it took in a full cylinder of air at the pressure in the manifold.</P>
      <ScreenSnippet
        where="TUNE › AIRFLOW"
        demo={d}
        seed={selecting(cell(4500, 100))}
        focus='[data-testid="tuning-grid"]'
        callouts={[
          { at: '[data-tour="grid-rpm-axis"]', text: 'Columns are engine speed, in RPM.' },
          { at: '[data-tour="grid-load-100"]', text: 'Rows are manifold pressure, in kPa. 100 kPa is the atmosphere: full throttle on an engine without boost. Lower rows are part throttle; the rows above 100 are only reached with a turbo or supercharger.' },
          { at: '[aria-label="4500 RPM, 100 kPa"]', text: `One cell: at 4500 RPM and full throttle the table says the cylinder fills to ${Math.round(a.ve)}%.` },
          { at: '[data-testid="selection-dock"]', text: 'Tapping a cell opens this editor. You will rarely type VE in by hand: Chapter 4 corrects it from a log.' },
        ]}
        caption="The real AIRFLOW page, with the 4500 RPM, 100 kPa cell selected. Tap around: this copy is yours to play with and changes nothing in your game."
      >
        <AirflowScreen veLog={d.veLog} />
      </ScreenSnippet>
      <P>From the cell, the ECU works out the air with the ideal gas law. It is the same arithmetic in every speed-density ECU:</P>
      <F>air in one cylinder = VE × cylinder volume × MAP ÷ (R × T)</F>
      <Worked title="4500 RPM, full throttle" rows={[
        ['VE from the table', `${n1(a.ve)}%`],
        ['Cylinder volume (3.5 L ÷ 6)', `${a.vCylL.toFixed(3)} L`],
        ['MAP', '100 kPa'],
        ['Air temperature', `${Math.round(a.iatC)} °C = ${a.tK.toFixed(1)} K`],
        ['Air density = MAP ÷ (287 × T)', `${a.rho.toFixed(3)} kg/m³`],
        ['Air in one cylinder', `${Math.round(a.mg)} mg`],
      ]}>
        The game&apos;s own log for this point says {Math.round(a.point.airCharge * 1000)} mg. Same number: the ECU in the game does exactly this sum.
      </Worked>
      <P><b>The most important idea in tuning:</b> VE belongs to the hardware. Typing a bigger number into the table does not put more air in the engine. It only makes the ECU fuel for air that is not there.</P>
      <Do steps={[
        <>Open <K>TUNE › AIRFLOW</K>.</>,
        <>Tap the cell at <K>4500</K> across and <K>100</K> down. It should read {Math.round(a.ve)}.</>,
        <>Tap <K>DONE</K> without changing it.</>,
      ]} />
      <Did>You read the ECU&apos;s belief about how the engine breathes, and worked out the air it calculates from it. Fuel and power both follow from this number.</Did>
      <Trouble items={[
        ['My cell shows a different number.', <>You have changed the build or loaded a preset. On <K>BUILD</K>, <K>RESET ALL TO STOCK</K> puts the SANDBOX engine back.</>],
        ['The table redrew itself when I changed the cam.', 'That is BUILD showing you what the new cam breathes like. Your ECU still runs the old table until you correct it from a log.'],
      ]} />
      <Aside title="Why kelvin, and why 287?">
        <p>Gas laws need absolute temperature: at 0 K a gas has no volume, and at 0 °C it plainly does. Add 273.15 to °C. 287 J/(kg·K) is the gas constant for air: a property of air, the same on every engine. Learn articles 7 and the Symbol key go through every symbol.</p>
      </Aside>
    </>
  );
}

function FuelLesson() {
  const d = stock();
  const a = airPerCylinder(d, 4500, 100);
  const p = a.point;
  const cycleMs = 120000 / p.rpm;
  return (
    <>
      <Goal learn="read the FUEL table as a mixture target, and follow air into injector time." need="Lesson 2.1." />
      <P>Once the air is known, fuel is arithmetic. The FUEL table says what mixture to aim for, as an air-fuel ratio. <b>Lambda</b> (λ) is that ratio divided by the fuel&apos;s chemically exact ratio: 1.00 burns all the fuel and all the oxygen; below 1 is rich (spare fuel), above 1 is lean (spare air).</P>
      <ScreenSnippet
        where="TUNE › FUEL"
        demo={d}
        seed={selecting(cell(4500, 100))}
        focus='[data-testid="tuning-grid"]'
        callouts={[
          { at: '[aria-label="4500 RPM, 100 kPa"]', text: `Full throttle at 4500 RPM asks for ${p.afrCommanded}:1, λ ${(p.afrCommanded / 14.7).toFixed(2)}: a little rich, where the most power is.` },
          { at: '[aria-label="4500 RPM, 40 kPa"]', text: 'Part throttle asks for 14.7:1, λ 1.00: clean and economical, and where the catalytic converter works.' },
          { at: '[data-testid="advisor-panel"]', text: 'The advisor judges the target you picked for the selected cell.' },
        ]}
        caption="The real FUEL page. The numbers are air-fuel ratios on gasoline&apos;s scale, where 14.7 is λ 1.00."
      >
        <FuelScreen calAdvice={d.calAdvice} />
      </ScreenSnippet>
      <F>fuel = air ÷ (λ × the fuel&apos;s exact ratio)     injector time = fuel ÷ injector flow + opening delay</F>
      <Worked title="the same cell, 4500 RPM full throttle" rows={[
        ['Air in one cylinder (Lesson 2.1)', `${Math.round(a.mg)} mg`],
        ['Target', `${p.afrCommanded}:1 = λ ${p.lambda}`],
        ['Fuel per cylinder = air ÷ ratio', `${n1(a.mg / p.afrCommanded)} mg`],
        ['Injector open time (pulse width)', `${p.pw} ms`],
        ['Time for one engine cycle at 4500 RPM', `${n1(cycleMs)} ms`],
        ['Duty = open time ÷ cycle time', `${p.duty}%`],
      ]}>
        The game&apos;s log for this point: {p.fuelMass} mg of fuel and {p.duty}% duty. Duty is the injector&apos;s time budget. Past about 90% there is no time left, and the mixture goes lean whatever the table asks for (Lesson 5.1).
      </Worked>
      <Do steps={[
        <>Open <K>TUNE › FUEL</K> and find the 100 kPa row: it asks for 12.6–13.2:1 across the rev range, richest where torque peaks.</>,
        <>Find the 40 kPa row: it asks for 14.7:1.</>,
      ]} />
      <Did>You followed one cylinder&apos;s air all the way to how long the injector stays open. The ECU never commands &ldquo;fuel&rdquo;: it commands time.</Did>
      <Trouble items={[
        ['The engine runs lean or rich on the dyno even though the FUEL table looks right.', <>The FUEL table is only the target. If the mixture misses it, the air estimate is wrong (AIRFLOW, or the MAF on <K>TUNE › SENSORS</K>) or the injectors are not what the ECU thinks (<K>TUNE › INJECTORS</K>). Fix the cause, not the target.</>],
      ]} />
    </>
  );
}

function SparkLesson() {
  const d = stock();
  const p = pointAt(d, 4500);
  const usPerDeg = (60 / p.rpm / 360) * 1e6;
  return (
    <>
      <Goal learn="read the SPARK table, and say what MBT and knock mean for one cell." need="Lessons 2.1 and 2.2." />
      <P>The mixture takes a few milliseconds to burn, so the spark fires <i>before</i> the piston reaches the top. Too late and the burn chases a piston already on its way down; too early and the pressure pushes against a piston still coming up. The best point is called <b>MBT</b> (minimum advance for best torque): past it, more advance makes no more power, only more risk.</P>
      <ScreenSnippet
        where="TUNE › SPARK"
        demo={d}
        seed={selecting(cell(4500, 100))}
        focus='[data-testid="tuning-grid"]'
        callouts={[
          { at: '[aria-label="4500 RPM, 100 kPa"]', text: `${p.commandedTiming}° before top dead centre at 4500 RPM, full throttle.` },
          { at: '[aria-label="4500 RPM, 40 kPa"]', text: 'Part-throttle cells carry more advance: thinner charge, slower burn, and far from knock.' },
          { at: '[data-testid="advisor-panel"]', text: 'The advisor runs a full-throttle pull of this exact engine and says where the knock limit is for the selected cell.' },
        ]}
        caption="The real SPARK page. Numbers are degrees of crank rotation before top dead centre (° BTDC)."
      >
        <SparkScreen calAdvice={d.calAdvice} />
      </ScreenSnippet>
      <Worked title={`how early is ${p.timing} degrees?`} rows={[
        ['One crank degree at 4500 RPM', `${usPerDeg.toFixed(0)} µs`],
        ['Spark', `${p.timing}° before top = ${(p.timing * usPerDeg / 1000).toFixed(2)} ms early`],
        ['Half the fuel has burned at', `${p.mfb50}° after top`],
        ['Where torque is best', 'about 8–10° after top'],
      ]}>
        The spark fires {(p.timing * usPerDeg / 1000).toFixed(2)} ms before the piston reaches the top, so that the burn is half done just after it, where the crank has leverage.
      </Worked>
      <H>Knock: the limit on everything</H>
      <P>Too much advance, heat or pressure and the last of the mixture explodes on its own instead of burning smoothly. That is knock, and it breaks pistons. The ECU listens for it and takes timing out. In the log you see it as commanded timing and actual timing drifting apart (Lesson 3.3).</P>
      <Do steps={[
        <>Open <K>TUNE › SPARK</K> and select the 4500 RPM, 100 kPa cell.</>,
        <>Open the advisor (tap its bar on a phone) and read what it says about this cell.</>,
      ]} />
      <Did>You can now read all three tables. The rest of the game is changing them and measuring what happened.</Did>
      <Aside title="Why burn time barely changes with RPM">
        <p>At 7500 RPM a crank degree lasts a fifth as long as at 1500, yet the burn takes only about a quarter more degrees. Turbulence scales with piston speed, so the flame speeds up nearly as fast as the crank. What really moves the burn is the mixture and the leftover exhaust gas in the cylinder. Learn article 4 goes further.</p>
      </Aside>
    </>
  );
}

/* ------------------------------------------------------------------ chapter 3 */

function FirstPull() {
  const d = stock();
  const { hp, tq } = peaks(d);
  return (
    <>
      <Goal learn="run a dyno pull and read the two charts it draws." need="Chapter 2." />
      <P>There is no preview. Press <K>RUN DYNO PULL</K> and the engine sweeps from 1500 RPM to its redline at full throttle, recording every channel at every 100 RPM. That is the only way to find out what a change did, exactly like a real dyno day.</P>
      <ScreenSnippet
        where="DYNO › CURVES"
        demo={d}
        height={430}
        callouts={[
          { at: '[data-tour="dyno-power"]', text: `Power (blue) and torque (cyan) against RPM. This engine peaks at ${hp.hp} whp at ${hp.rpm} RPM and ${tq.torque} lb-ft at ${tq.rpm} RPM.` },
          { at: '[data-tour="dyno-afr-timing"]', text: 'Mixture asked for (dashed) against mixture got (solid), and the timing the engine really ran. Where the lines part, something overrode your table.' },
        ]}
        caption="The real DYNO charts for the stock SANDBOX engine. Coloured bands appear on these charts when the pull log has something to say at those RPMs."
      >
        <ResultScreen chartData={d.chartData} engineDerived={d.derived} bands={d.bands} wholePullCount={d.wholePullCount} />
      </ScreenSnippet>
      <Worked title="power from torque" rows={[
        ['Torque at the power peak', `${hp.torque} lb-ft at ${hp.rpm} RPM`],
        ['hp = lb-ft × RPM ÷ 5252', `${hp.torque} × ${hp.rpm} ÷ 5252 = ${(hp.torque * hp.rpm / 5252).toFixed(0)} whp`],
      ]}>
        Power is torque times speed. That is why the power peak comes later than the torque peak: past {tq.rpm} RPM the torque falls, but more slowly than the speed rises.
      </Worked>
      <Do steps={[
        <>Open <K>DYNO</K> and press <K>RUN DYNO PULL</K>.</>,
        <>Check <K>LAST PULL</K> in the strip: about {hp.hp} whp on the stock engine.</>,
      ]} />
      <Did>You measured the engine. From now on every change gets a pull, and every pull gets compared with the one before.</Did>
      <Trouble items={[
        ['No sound.', <>Sound is optional. On an iPhone the ring/silent switch mutes web audio; the <K>TEST</K> button on DYNO says whether the browser allowed sound.</>],
        ['My number is not the one above.', 'Something in your build or tune differs from SANDBOX stock. That is fine: every lesson works on any engine, only the numbers change.'],
      ]} />
    </>
  );
}

function PullLog() {
  const d = overAdvanced();
  const s = stock();
  const knock = d.result.events.find((e) => e.type === 'knock');
  return (
    <>
      <Goal learn="read a Pull Log entry: what went wrong, why, and what to try." need="Lesson 3.1." />
      <P>Every pull writes a Pull Log. Read it <i>before</i> you look at the power number. To show you one with something in it, the engine below had {SPARK_ADDED_DEG}° added to every full-throttle spark cell, one of the most common beginner mistakes.</P>
      <ScreenSnippet
        where="DYNO › PULL LOG"
        demo={d}
        height={380}
        callouts={[
          { at: '[data-tour="log-title"]', text: 'What happened, and where. The number on the right is how many points it cost the pull score.' },
          { at: '[data-tour="log-why"]', text: 'Why: the cause, in plain words.' },
          { at: '[data-tour="log-try"]', text: 'Try: the change that fixes it, with numbers.' },
          { at: '[data-tour="log-links"]', text: 'Links to the screens the fix names. One tap and you are there.' },
        ]}
        caption={`The real Pull Log for that pull. It made ${d.result.peakHp} whp, ${s.result.peakHp - d.result.peakHp} less than stock: more advance made LESS power, because the ECU pulled timing back out wherever it heard knock.`}
      >
        <LogScreen />
      </ScreenSnippet>
      <P>{knock ? <>The entry says: <i>{knock.msg}</i>.</> : null} The fix is on SPARK, and it is specific: which row, which RPM, roughly how far.</P>
      <Do steps={[
        <>After any pull, open <K>DYNO › PULL LOG</K> first.</>,
        <>For each entry, read <b>Why</b> and <b>Try</b>, and tap the link to the screen it names.</>,
        <>Change <b>one</b> thing, then pull again.</>,
      ]} />
      <Did>You turned a problem into a single change. Change three things at once and you will not know which one worked; that is the habit that separates tuners from people who get lucky.</Did>
      <Trouble items={[
        ['The log is empty.', 'A clean pull. Nothing went wrong that the ECU or the dyno could see: now it is about finding more power, carefully.'],
        ['An entry says it is a hardware limit.', 'No table fixes it: change the part, or ask less of it. Lesson 5.1.'],
      ]} />
    </>
  );
}

function Datalog() {
  const d = overAdvanced();
  const knockPt = d.result.points.find((p) => p.knock) ?? d.result.points[0];
  return (
    <>
      <Goal learn="use the datalog to see what the engine really did at one RPM." need="Lesson 3.2." />
      <P>The log tells you what went wrong; the datalog shows you. Drag through the pull and every channel is there, point by point. Diagnosis lives in the <b>asked → got</b> pairs: what your tables asked for, against what the engine actually ran.</P>
      <ScreenSnippet
        where="DYNO › DATALOG"
        demo={d}
        seed={(s) => ({ ...s, session: { ...s.session, logFocusRpm: knockPt.rpm } })}
        focus='input[aria-label="Scrub the pull by RPM"]'
        height={420}
        callouts={[
          { at: 'input[aria-label="Scrub the pull by RPM"]', text: 'Drag to move through the pull. It opens here on a point where the engine knocked.' },
          { at: '[data-pair-asked="timing"]', text: `Timing asked → got: ${knockPt.commandedTiming}° asked, ${knockPt.timing}° run. The ECU pulled ${n1(knockPt.knockPull)}° because it heard knock.` },
          { at: '[data-pair-asked="mixture"]', text: 'Mixture asked → got. Here they match: the fuel side is fine.' },
          { at: '[data-testid="ecu-readout"]', text: 'What the engine management did at this point, and why.' },
        ]}
        caption={`The real datalog of the over-advanced pull, opened at ${knockPt.rpm} RPM.`}
      >
        <DataScreen />
      </ScreenSnippet>
      <Do steps={[
        <>Open <K>DYNO › DATALOG</K> after a pull.</>,
        <>Drag the slider through the rev range and watch the <b>Timing</b> and <b>Mixture</b> pairs.</>,
      ]} />
      <Did>You can now see a problem at the exact RPM it happens, not just read that it happened. That is how you know which cells to change.</Did>
      <Aside title="The other gauges">
        <p>INJ DUTY is the injector time budget (past about 90% the mixture leans on its own). EGT is exhaust temperature, raised by retarded timing and lean mixture. PEAK P is the cylinder pressure the piston and bearings carry. Learn article 14 explains every column.</p>
      </Aside>
    </>
  );
}

function OneThing() {
  const s = stock();
  const d = overAdvanced();
  const knock = d.result.events.find((e) => e.type === 'knock');
  return (
    <>
      <Goal learn="fix a knock problem with one change, and prove it with a second pull." need="Lessons 3.2 and 3.3." />
      <P>This is the loop every tuner runs, from the first pull to the last: <b>pull → read the log → change one thing → pull again → compare</b>.</P>
      <ScreenSnippet
        where="TUNE › SPARK"
        demo={d}
        seed={selecting(cell(4500, 100))}
        focus='[data-testid="tuning-grid"]'
        callouts={[
          { at: '[data-tour="grid-load-100"]', text: `The 100 kPa row, ${SPARK_ADDED_DEG}° more advanced than stock. The log pointed here.` },
          { at: '[data-testid="advisor-panel"]', text: 'The advisor agrees with the log: this cell is past what the engine tolerates on this fuel.' },
        ]}
        caption="The same over-advanced tune on SPARK. The advisor and the dyno always agree, because the advisor runs the same pull."
      >
        <SparkScreen calAdvice={d.calAdvice} />
      </ScreenSnippet>
      <Worked title="the before and after" rows={[
        ['Stock spark', `${s.result.peakHp} whp, no knock`],
        [`+${SPARK_ADDED_DEG}° at full throttle`, `${d.result.peakHp} whp, knock ${knock ? `${knock.rpmStart}–${knock.rpmEnd} RPM` : ''}`],
        ['Following the log (take it back out)', `${s.result.peakHp} whp, clean`],
      ]}>
        More advance bought nothing. On 91 this engine knocks before it reaches best torque (MBT) through most of the rev range, as a real 10.3:1 engine on pump fuel does, so the knock control took the extra timing straight back out: the same power, with the pistons being hammered the whole way. The best spark is not the most aggressive; it is MBT, or the knock limit if the engine knocks first. Here the knock limit comes first below about 6000 RPM: this engine's full-throttle spark is set by its fuel, not by best torque.
      </Worked>
      <Do steps={[
        <>On <K>TUNE › SPARK</K>, tap the <K>100</K> row label to select the row, then press <K>+1</K> {SPARK_ADDED_DEG} times.</>,
        <>Pull. Read the knock entry in the Pull Log.</>,
        <>Select the row again and press <K>-1</K> until the log comes back clean. Pull again.</>,
      ]} />
      <Did>You found the knock limit on this fuel by experiment, the way it is found on a real dyno, and you know how to back off from it.</Did>
      <Trouble items={[
        ['The row will not select.', 'Tap the row label (the kPa number on the left), not a cell. SELECT RANGE lets you drag across cells instead.'],
        ['I pressed the wrong thing.', 'Every table has undo and redo (the arrows above it).'],
      ]} />
    </>
  );
}

/* ------------------------------------------------------------------ chapter 4 */

function BoltOn() {
  const s = stock();
  const d = intakeFitted();
  return (
    <>
      <Goal learn="see what a bolt-on does before any retune, and recognise its two symptoms." need="Chapter 3." />
      <P>A cold air intake is the classic first mod. It changes two things at once: the engine breathes a little better (VE goes up), and its bigger housing changes what the airflow sensor (the MAF) reads. The ECU knows neither. It keeps running the old tables.</P>
      <ScreenSnippet
        where="DYNO › PULL LOG"
        demo={d}
        height={400}
        callouts={[
          { at: '[data-tour="log-title"]', text: 'Symptom one has its own entry: the MAF reads low, so the whole pull runs lean of what FUEL asks for.' },
          { at: '[data-tour="log-try"]', text: 'Its fix points at SENSORS. Symptom two, better breathing, has no entry of its own: AIRFLOW’s correction from the log finds it (Lesson 4.2).' },
        ]}
        caption={`The real Pull Log after fitting a cold air intake to the stock engine and pulling, with nothing retuned. It made ${d.result.peakHp} whp against ${s.result.peakHp} stock.`}
      >
        <LogScreen />
      </ScreenSnippet>
      <P><b>Symptom one: the MAF reads low.</b> The bigger housing makes the same airflow read about 10% less, so the ECU fuels for less air than there is, and the engine runs lean.</P>
      <P><b>Symptom two: the VE table is out of date.</b> The engine breathes a few percent better than the table says, so there is more air than the ECU calculated from AIRFLOW too. It is too small to earn a log entry of its own (the lean warning is for mixtures past 15.2:1, where damage starts), which is exactly why a tuner reads the wideband against the target on every pull, not just the warnings.</P>
      <Did>You have seen the most common situation in real tuning: new hardware, old calibration. The next two lessons fix each symptom where it lives.</Did>
    </>
  );
}

function VeFromLogs() {
  const d = intakeFitted();
  const row = WOT;
  const col = RPM.indexOf(5500);
  const m = veCellMaths(d, row, col);
  const table = d.state.tune.ve[row][col];
  const truth = d.veTruth[row][col];
  return (
    <>
      <Goal learn="correct the VE table from a log, and follow the maths for one cell." need="Lesson 4.1." />
      <P>No tuner can see an engine&apos;s true VE. What they can see is the wideband: where the mixture the engine got differs from the one the table asked for, the ECU&apos;s air estimate was off by that ratio. Real tuning software (HP Tuners&apos; VE histograms, Holley&apos;s learn, Haltech&apos;s quick-tune) all run on this one line:</P>
      <F>VE new = VE × (λ measured ÷ λ target) × fuel trims × MAF factor</F>
      <ScreenSnippet
        where="TUNE › AIRFLOW"
        demo={d}
        seed={selecting(cell(5500, 100))}
        focus='section[aria-label="Correct VE from logs"]'
        height={420}
        callouts={[
          { at: 'section[aria-label="Correct VE from logs"]', text: `CORRECT VE FROM LOGS: ${d.veLog.pull.length} samples from the pull, sorted into the cells they were taken in.` },
          { at: '[data-tour="velog-maf"]', text: 'The MAF part of the error is taken out here and left for SENSORS (Lesson 4.3). Tune the two separately, or each hides the other.' },
          { at: 'table[aria-label="Logged VE error by cell, percent"]', text: 'How far each logged cell is off. Positive: the engine got more air than the table thought. Dots: no data, no change.' },
          { at: '[data-tour="velog-apply"]', text: 'APPLY HALF is what tuners do: apply half, pull again, repeat until every cell is within 2–3%.' },
        ]}
        caption="The real AIRFLOW page after the intake pull. Select a cell and open the advisor to see its maths; the worked example below is the same calculation. APPLY HALF works here too, on this copy only: watch the table change and the panel ask for a new pull."
      >
        <LiveAirflow demo={d} />
      </ScreenSnippet>
      {m && (
        <Worked title="5500 RPM, 100 kPa" rows={[
          ['Table VE now', `${n1(table)}%`],
          ['λ measured ÷ λ target (the wideband)', m.lambdaRatio.toFixed(3)],
          ['× MAF error taken out', m.maf.toFixed(3)],
          ['= correction', `${m.ratio.toFixed(3)} (${m.ratio >= 1 ? '+' : ''}${((m.ratio - 1) * 100).toFixed(1)}%)`],
          ['New VE', `${n1(table)} × ${m.ratio.toFixed(3)} = ${n1(table * m.ratio)}%`],
          ['Applying half', `${n1(table + (table * m.ratio - table) / 2)}%`],
        ]}>
          The wideband alone says the engine got {((m.lambdaRatio - 1) * 100).toFixed(0)}% more air than planned. Most of that is the MAF misreading, not the engine breathing better. With the MAF part taken out, the log asks for {((m.ratio - 1) * 100).toFixed(1)}%, and the intake really did raise VE here by {((truth / table - 1) * 100).toFixed(1)}%. Folding the MAF&apos;s 10% into VE would have to be undone the moment the MAF was fixed.
        </Worked>
      )}
      <Do steps={[
        <>Fit <K>Cold Air Intake</K> on <K>BUILD › INDUCTION</K>, then run a pull.</>,
        <>Open <K>TUNE › AIRFLOW</K>. Under the table, <K>CORRECT VE FROM LOGS</K> now has samples.</>,
        <>Select the 5500 RPM, 100 kPa cell and open the advisor to see its maths.</>,
        <>Press <K>APPLY HALF</K>. Pull again, and repeat until the panel says every cell is within 2%.</>,
      ]} />
      <Did>You corrected a speed-density table from a wideband log, the way it is done on real cars, and you can check the software&apos;s working by hand.</Did>
      <Trouble items={[
        ['The panel says the last pull is out of date.', 'A log only describes the tune it was taken on. Anything you change after a pull (the table, the MAF scalar, a part) makes it stale. Run another pull.'],
        ['It found no samples.', 'The pull was part-throttle (set DYNO load back to 100 kPa), or every point was excluded: nitrous, injectors at their limit, protection and fuel cut are left out on purpose.'],
        ['The error came back after I applied it.', 'Applying half leaves half: that is the point. Pull again and apply again. It converges in two or three passes.'],
      ]} />
      <Aside title="Why only half?">
        <p>Each logged point is shared among the four cells around it, and the mixture itself moves a little between cells. Trusting one pass completely tends to overshoot. Half-steps converge without overshooting, and the game resets the fuel trims when you apply, because they had been covering the same error. Learn article 42 goes through the whole method.</p>
      </Aside>
    </>
  );
}

function MafLesson() {
  const d = intakeFitted();
  const p = pointAt(d, 5500);
  return (
    <>
      <Goal learn="rescale the MAF after an intake change, and know when the MAF matters." need="Lesson 4.2." />
      <P>This game&apos;s ECU blends two air estimates: speed-density (MAP and the VE table) and the airflow sensor, the MAF. The MAF measures the air directly, but only through a curve calibrated for the stock housing. Fit a bigger housing and the same air reads differently.</P>
      <ScreenSnippet
        where="TUNE › SENSORS"
        demo={d}
        height={400}
        callouts={[
          { at: '[data-tour="sensors-maf"]', text: 'HARDWARE CHANGED: the intake changed how air reads across the MAF.' },
          { at: '[data-tour="sensors-scalar"]', text: `The MAF scalar. The log said the MAF reads about 10% low; 1 ÷ 0.90 = ${INTAKE_MAF_SCALAR.toFixed(2)} cancels it.` },
          { at: '[data-tour="sensors-trim"]', text: `The MAF error across the last pull: ${p.trimPct}% at 5500 RPM. Aim for a flat line at zero.` },
        ]}
        caption="The real SENSORS page after the intake pull."
      >
        <SensorsScreen needsMafRecal chartData={d.chartData} result={d.result} />
      </ScreenSnippet>
      <Worked title="the scalar" rows={[
        ['MAF reads', 'about 90% of the real air'],
        ['Scalar that cancels it', `1 ÷ 0.90 ≈ ${INTAKE_MAF_SCALAR.toFixed(2)}`],
      ]}>
        The Pull Log&apos;s MAF entry names this number too. After setting it, pull again: the MAF line on this page should sit near zero.
      </Worked>
      <Do steps={[
        <>Open <K>TUNE › SENSORS</K> and drag the <K>MAF Scalar</K> to {INTAKE_MAF_SCALAR.toFixed(2)}.</>,
        <>Pull again. The MAF entry should be gone from the Pull Log.</>,
      ]} />
      <Did>You fixed the sensor, not the symptom. If you had richened the FUEL table instead, the car would run right at full throttle and wrong everywhere the MAF matters.</Did>
    </>
  );
}

function Compare() {
  const s = stock();
  const f = intakeFitted();
  const r = intakeRetuned();
  return (
    <>
      <Goal learn="prove a retune worked, with numbers." need="Lessons 4.1 to 4.3." />
      <P>A retune is not finished until a pull says so. Here is the whole job, measured by the game:</P>
      <Worked title="cold air intake, start to finish" rows={[
        ['Stock', `${s.result.peakHp} whp · clean log`],
        ['Intake fitted, nothing retuned', `${f.result.peakHp} whp · ${f.result.events.map((e) => e.type).join(', ') || 'clean'}`],
        [`MAF scalar ${INTAKE_MAF_SCALAR.toFixed(2)} + VE from the log`, `${r.result.peakHp} whp · ${r.result.events.map((e) => e.type).join(', ') || 'clean log'}`],
      ]}>
        The part was worth {r.result.peakHp - s.result.peakHp} whp, and {r.result.peakHp - f.result.peakHp} of that only arrived once it was tuned for. That is why real shops sell the tune with the part.
      </Worked>
      <ScreenSnippet
        where="DYNO › PULL LOG"
        demo={r}
        height={150}
        caption="The real Pull Log after the retune: nothing to report."
      >
        <LogScreen />
      </ScreenSnippet>
      <Do steps={[
        <>After your retune pull, look at the curves on <K>DYNO</K>: the previous pull is drawn dashed behind the new one, labelled <K>Prev</K>.</>,
        <>To compare against one particular pull instead, pin it on <K>DYNO › HISTORY</K>.</>,
      ]} />
      <Did>You did a complete, real-world tuning job: fitted a part, read its symptoms, fixed each where it lives, and proved it with a pull. That is the job.</Did>
    </>
  );
}

/* ------------------------------------------------------------------ chapter 5 */

function Limits() {
  const d = e85StockInjectors();
  const moreFuel = (stock().fuel.stoich / d.fuel.stoich - 1) * 100;
  const fuelEv = d.result.events.find((e) => e.type === 'fuel');
  return (
    <>
      <Goal learn="tell a calibration fault from a hardware limit." need="Chapters 3 and 4." />
      <P>Knock, a wrong mixture target and a misread airflow sensor are calibration faults: the tables and settings fix them completely. Some things no table can touch: injectors out of time, valves floating, a turbo past its limit. The log says which kind it is.</P>
      <ScreenSnippet
        where="DYNO › PULL LOG"
        demo={d}
        height={300}
        callouts={[
          { at: '[data-tour="log-title"]', text: 'Injectors maxed: a hardware limit.' },
          { at: '[data-tour="log-try"]', text: 'The fix is a part, not a table.' },
        ]}
        caption={`The real Pull Log for the stock engine on E85. E85 burns at ${d.fuel.stoich}:1 against gasoline\u2019s ${stock().fuel.stoich}:1, so the same air needs about ${Math.round(moreFuel)}% more fuel, and the stock 315cc injectors run out of time.`}
      >
        <LogScreen />
      </ScreenSnippet>
      {fuelEv && <P>At high RPM the injectors are open {fuelEv.msg.match(/\d+% duty/)?.[0] ?? 'almost all the time'}: there is no time left in the cycle to add fuel, so the mixture leans whatever the FUEL table says.</P>}
      <Do steps={[
        <>If the log names a hardware limit, change the part on <K>BUILD</K> (here, bigger injectors on <K>BUILD › FUEL SYSTEM</K>), then tell the ECU on <K>TUNE › INJECTORS</K>.</>,
        'Or ask less of it: less boost, a milder fuel, a lower rev limit.',
      ]} />
      <Did>You know when to stop tuning and start wrenching. That judgement saves real engines.</Did>
    </>
  );
}

function TheRest() {
  return (
    <>
      <Goal learn="know what the rest of the game is for, and when you need it." need="Nothing new." />
      <H>The rest of TUNE</H>
      <P>Real ECUs have far more than three tables: corrections for temperature and altitude, and controllers for boost, cams, idle, knock and protection. They are on TUNE, in the second row. Every one starts at a working factory setting. Change one and an amber dot marks it; <K>Factory</K> puts a page back. Leave them alone until a log sends you there; a numbered badge on a TUNE page means the last pull&apos;s log points at it.</P>
      <H>The ECU only knows what it measures</H>
      <P>Fit a sensor on BUILD and tell the ECU a different one on TUNE › SENSORS, and it acts on a wrong number without knowing. The classic: a 1-bar MAP sensor on a turbo engine never sees boost, and fuels too little under it. Each page warns you when the two differ.</P>
      <H>LIVE</H>
      <P>The ECU running in real time. Start the engine, rev it, watch idle hold when the A/C switches on, try launch control, break a sensor on purpose and see what the protections do. Its datalog records every channel, and TUNE › AIRFLOW corrects part-throttle VE from it the same way it does from a pull.</P>
      <H>DRAG and the scores</H>
      <P>Every pull is graded on Tuning (how clean the calibration is) and Engineer (how sound the build is), combined with real output into a Pull Score with no ceiling. On DRAG the engine goes into a car: trap speed measures power, the 60-foot time measures traction, and the fastest engine does not always win.</P>
      <Did>You have seen every part of the game and know which lesson to come back to for each.</Did>
    </>
  );
}

function NextSteps() {
  return (
    <>
      <Goal learn="know where to go next." />
      <P>You can read the three tables, run a pull, read its log and datalog, fix knock, retune after a hardware change with the same maths real software uses, and tell a calibration fault from a hardware limit. That is the core of engine tuning.</P>
      <H>Practise</H>
      <P>The practice missions (below) put you in the real game with a checklist that ticks itself as you go. Start with <b>Your first pull</b>.</P>
      <H>Go deeper</H>
      <P>HOME › Learn How It Works has the whole subject in numbered articles. Good next reads: 12 (the tuning loop), 14 (every datalog column), 42 (correcting VE from logs, in depth), 44 (troubleshooting by symptom) and 45 (a full worked session).</P>
      <H>Real cars</H>
      <P>CAREER gives you a tuning shop of your own. Customers bring cars with real faults and describe what the car does, not what is wrong with it. Every fault is one this course taught you to diagnose. Training opens more of the ECU, and a dyno, more lifts and better tools open bigger jobs.</P>
      <Did>That is the course done. The loop is always the same: build it, set the tables, pull it, read the log, change one thing.</Did>
    </>
  );
}

/* ------------------------------------------------------------------ the book */

/**
 * @typedef {object} Lesson
 * @property {string} id
 * @property {string} title
 * @property {() => React.ReactElement} Body
 * @property {string} [mission] the practice mission that goes with it
 */

/** @typedef {{id: string, title: string, minutes: number, lessons: Lesson[]}} Chapter */

/** @type {Chapter[]} */
export const CHAPTERS = [
  { id: 'idea', title: 'The big idea', minutes: 3, lessons: [
    { id: 'air-pump', title: 'An engine is an air pump', Body: AirPump },
    { id: 'find-your-way', title: 'Finding your way around', Body: FindYourWay },
  ] },
  { id: 'tables', title: 'The three tables', minutes: 10, lessons: [
    { id: 'airflow', title: 'AIRFLOW: how full the cylinder gets', Body: AirflowLesson },
    { id: 'fuel', title: 'FUEL: the mixture you ask for', Body: FuelLesson },
    { id: 'spark', title: 'SPARK: when to light it', Body: SparkLesson },
  ] },
  { id: 'measure', title: 'Measure it: the dyno', minutes: 10, lessons: [
    { id: 'first-pull', title: 'Your first pull', Body: FirstPull, mission: 'first-pull' },
    { id: 'pull-log', title: 'Reading the Pull Log', Body: PullLog },
    { id: 'datalog', title: 'The datalog: asked against got', Body: Datalog },
    { id: 'one-thing', title: 'Change one thing, pull again', Body: OneThing, mission: 'knock-limit' },
  ] },
  { id: 'job', title: 'A real job: bolt-on and retune', minutes: 12, lessons: [
    { id: 'bolt-on', title: 'What a bolt-on does to the tune', Body: BoltOn },
    { id: 've-from-logs', title: 'Correct VE from the log', Body: VeFromLogs, mission: 'bolt-on' },
    { id: 'maf', title: 'Rescale the MAF', Body: MafLesson },
    { id: 'compare', title: 'Pull again and prove it', Body: Compare },
  ] },
  { id: 'beyond', title: 'Limits, and the rest of the game', minutes: 5, lessons: [
    { id: 'limits', title: 'What you cannot tune away', Body: Limits },
    { id: 'the-rest', title: 'The rest of TUNE, LIVE and DRAG', Body: TheRest },
    { id: 'next', title: 'Where to go next', Body: NextSteps },
  ] },
];

/** What the whole course teaches: shown before lesson one. */
export const OUTCOMES = [
  'Read the AIRFLOW, FUEL and SPARK tables, and work one cell of each through by hand.',
  'Run a dyno pull, and read its Pull Log and datalog.',
  'Find the knock limit on your fuel, and back off from it.',
  'Retune after a hardware change the way real tuning software does: VE from the wideband, MAF from its own error.',
  'Tell a calibration fault from a hardware limit.',
];
