/**
 * The five-minute tutorial: the basics of tuning and of the app, and nothing more.
 *
 * Five cards, one idea each, about a minute apiece. Each shows at most one real game
 * screen. Everything deeper lives in the Tuning Course (lessons.jsx), opened from
 * HOME › Learn, where there is room for worked maths and practice missions.
 */

import React from 'react';

import { AppShell } from '../AppShell.jsx';
import { TuningGrid } from '../components/TuningGrid.jsx';
import { LogScreen } from '../screens/dyno/LogScreen.jsx';
import { ACTIONS } from '../state/reducer.js';
import { useTune } from '../state/StoreProvider.jsx';

import { K, List, P } from './LessonParts.jsx';
import { LOAD, RPM, overAdvanced, peaks, stock } from './scenarios.js';
import { ScreenSnippet } from './ScreenSnippet.jsx';

function AirPump() {
  const { hp } = peaks(stock());
  return (
    <>
      <P>An engine is an air pump. The air it swallows decides how much fuel it can burn, and burning fuel is the power. The engine computer (the ECU) makes three decisions, hundreds of times a second:</P>
      <List items={[
        <><b>How much air</b> is in the cylinder: the <K>AIRFLOW</K> table.</>,
        <><b>How much fuel</b> that air needs: the <K>FUEL</K> table.</>,
        <><b>When to fire the spark</b>: the <K>SPARK</K> table.</>,
      ]} />
      <P>Tuning is getting those three tables right at every speed and load. The engine you start with makes {hp.hp} horsepower at the wheels; in four cards you will know how to make it more, safely.</P>
    </>
  );
}

function FindYourWay() {
  return (
    <>
      <P>The tabs run in a tuner&apos;s working order, left to right: build it, tune it, measure it.</P>
      <ScreenSnippet
        where="Every screen"
        demo={stock()}
        height={300}
        callouts={[
          { at: '[data-tour="nav-build"]', text: <><K>BUILD</K>: the hardware. Every part changes the real engine.</> },
          { at: '[data-tour="nav-tune"]', text: <><K>TUNE</K>: the three tables, then the ECU&apos;s own settings.</> },
          { at: '[data-tour="nav-dyno"]', text: <><K>DYNO</K>: measures it. Nothing is known until you pull.</> },
          { at: '[data-tour="strip-last-pull"]', text: 'Your last pull’s peak power, always in view.' },
        ]}
        caption="The real frame around every screen. HOME has your stats and Learn; LIVE runs the engine in real time; DRAG puts it in a car."
      >
        <div style={{ height: 290, display: 'flex', flexDirection: 'column' }}>
          <AppShell route={{ view: 'app', tab: 'tune', section: 'airflow' }} onNavigate={() => {}} onTutorial={() => {}} onRepair={() => {}}>
            <div style={{ padding: 16, color: 'var(--ink-soft)', fontSize: 13 }}>The screen for the tab you pick opens here.</div>
          </AppShell>
        </div>
      </ScreenSnippet>
    </>
  );
}

/**
 * The AIRFLOW table on its own: the real grid, in the snippet's sandbox store, without
 * the page's explainers and panels, which are the course's business.
 */
function AirflowGrid() {
  const [tune, dispatch] = useTune();
  return (
    <div style={{ padding: 12 }}>
      <TuningGrid
        data={tune.ve} min={10} max={130} decimals={0}
        selection={tune.selection} rangeMode={false}
        setSelection={(value) => dispatch({ type: ACTIONS.SET_TUNE_FIELD, field: 'selection', value })}
        setData={(value) => dispatch({ type: ACTIONS.SET_TABLE, table: 've', value })}
      />
    </div>
  );
}

function ThreeTables() {
  const d = stock();
  const ve = d.state.tune.ve[LOAD.indexOf(100)][RPM.indexOf(4500)];
  return (
    <>
      <P>All three tables share one layout, the one real tuning software uses. Here is AIRFLOW, live:</P>
      <ScreenSnippet
        where="TUNE › AIRFLOW"
        demo={d}
        height={300}
        callouts={[
          { at: '[data-tour="grid-rpm-axis"]', text: 'Columns: engine speed, RPM.' },
          { at: '[data-tour="grid-load-100"]', text: 'Rows: manifold pressure, kPa. 100 is full throttle without boost.' },
          { at: '[aria-label="4500 RPM, 100 kPa"]', text: `One cell: at 4500 RPM, full throttle, the cylinder fills to ${Math.round(ve)}%.` },
        ]}
        caption="Tap a cell to edit it. This copy is a sandbox: nothing here changes your game."
      >
        <AirflowGrid />
      </ScreenSnippet>
      <P><K>AIRFLOW</K> is how well the engine breathes (VE). It belongs to the hardware, so you correct it from a log rather than guess it. <K>FUEL</K> is the mixture you ask for: 14.7:1 cruising, about 12.6:1 at full throttle for power. <K>SPARK</K> is how many degrees before the top the plug fires.</P>
    </>
  );
}

function PullAndRead() {
  const d = overAdvanced();
  return (
    <>
      <P>There is no preview. On <K>DYNO</K>, press <K>RUN DYNO PULL</K>: the engine sweeps to redline and logs everything. Then read the <b>Pull Log</b> before the power number. Here is one from an engine with too much spark:</P>
      <ScreenSnippet
        where="DYNO › PULL LOG"
        demo={d}
        height={300}
        callouts={[
          { at: '[data-tour="log-title"]', text: 'What happened, and at what RPM.' },
          { at: '[data-tour="log-why"]', text: 'Why: the cause, in plain words.' },
          { at: '[data-tour="log-try"]', text: 'Try: the change that fixes it. The link below it opens that screen.' },
        ]}
        caption={`The real Pull Log. That extra spark made ${d.result.peakHp} whp, less than stock: the ECU pulled timing back out wherever it heard knock.`}
      >
        <LogScreen />
      </ScreenSnippet>
    </>
  );
}

function TheLoop() {
  return (
    <>
      <P>That is the whole method, and every tuner runs it:</P>
      <List items={[
        <><b>Change one thing.</b> Change three and you will not know which one worked.</>,
        <><b>Pull.</b> The last pull is drawn dashed behind the new one, so you see what changed.</>,
        <><b>Read the log.</b> It says what is wrong, why, and where the fix is.</>,
        <><b>Repeat.</b></>,
      ]} />
      <P>Some problems are parts, not tables (injectors that run out of time, valves that float), and the log says which. When it does, change the part on <K>BUILD</K> or ask less of it.</P>
      <P><b>Want the full course?</b> <K>HOME › Learn</K> has <b>The Tuning Course</b>: 16 lessons, about 40 minutes, with live screens, worked maths, a real bolt-on retune and practice missions that tick themselves off in the game. Take it any time.</P>
    </>
  );
}

/** @type {import('./lessons.jsx').Chapter[]} */
export const QUICK_CHAPTERS = [
  { id: 'quick', title: 'Tuning in five minutes', minutes: 5, lessons: [
    { id: 'q-air-pump', title: 'An engine is an air pump', Body: AirPump },
    { id: 'q-find-your-way', title: 'Finding your way around', Body: FindYourWay },
    { id: 'q-three-tables', title: 'The three tables', Body: ThreeTables },
    { id: 'q-pull', title: 'Pull, then read the log', Body: PullAndRead },
    { id: 'q-loop', title: 'The loop, and where next', Body: TheLoop },
  ] },
];

export const QUICK_OUTCOMES = [
  'Know what the ECU decides, and the three tables that decide it.',
  'Find your way around the game.',
  'Run a pull and read what it tells you.',
];
