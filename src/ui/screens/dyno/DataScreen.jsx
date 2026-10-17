/**
 * DYNO > DATALOG (the RPM scrubber and per-point readout, and the fuel-trim histogram).
 *
 * Everything here reads the store directly rather than taking props — `result`,
 * `histogram` and `ve` are all plain state, not shell-level derivations, and
 * nothing here has a second consumer elsewhere in the app. `buildHistogram` and
 * `applyHistogram` moved down with the markup for the same reason: their only
 * caller was this section's two buttons.
 */

import React from 'react';

import { Grid3x3, Info } from 'lucide-react';

import { clamp, LOAD, presetById, RPM, SWEEP_STEP_RPM, veCorrections, veSamplesFromPull } from '../../../sim/index.js';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { downloadCsv, dynoSheetFilename, sweepToCsv } from '../../components/dynoCsv.js';
import { eventBands } from '../../components/eventBands.js';
import { initialScrubRpm, pointAt, pointGauges } from '../../components/scrubPoint.js';
import { CorrectionStack } from '../../components/ecu/CorrectionStack.jsx';
import { Button } from '../../primitives/Button.jsx';
import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { StatTile } from '../../primitives/StatTile.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild, useRoadTest, useSession, useTune } from '../../state/StoreProvider.jsx';
import { deltaHeat, T, utilisationTone } from '../../theme.js';

import styles from './DataScreen.module.css';

/**
 * The three asked-to-got pairs for one sweep point.
 *
 * These are rows rather than gauges because each is a PAIR: the VE table's claim against
 * what the engine actually flowed, commanded timing against what the ECU ran, commanded
 * mixture against what came out. A bare number cannot say that the ECU overrode you,
 * which is the entire diagnostic idea of a datalog.
 *
 * `data-pair-asked` carries the pair's id on the element holding the asked half, so a
 * test can assert the SPLIT rather than a count — three rows existing proves nothing
 * about which three.
 *
 * @param {{point: object}} props
 * @returns {React.ReactElement}
 */
function PairRows({ point: p }) {
  const rows = [
    { id: 've', k: 'Cylinder filling', asked: `${p.veTable}% VE`, got: `${p.ve}% VE`,
      note: p.veTable !== p.ve
        ? `${p.map} kPa manifold · table says ${p.veTable}% VE, engine actually flowed ${p.ve}%`
        : `${p.map} kPa manifold · table and engine agree at ${p.ve}%`,
      ok: Math.abs(p.veTable - p.ve) / Math.max(1, p.ve) < 0.03 },
    { id: 'timing', k: 'Timing', asked: `${p.commandedTiming}°`, got: `${p.timing}°`,
      note: p.knock ? `ECU pulled ${p.knockPull.toFixed(1)}° — too advanced for this cylinder pressure` : 'ran your commanded value',
      ok: !p.knock },
    { id: 'mixture', k: 'Mixture', asked: `${p.afrCommanded}:1`, got: `${p.afr}:1`,
      note: p.fuelLimited ? 'injectors out of time — mixture leaned out on its own'
        : p.richRisk ? 'far richer than commanded — check injector scaling'
          : `lambda ${p.lambda} · best power here is ${p.bestAfr}:1`,
      ok: !p.fuelLimited && !p.richRisk && !p.leanRisk },
  ];
  return (
    <div className={styles.cardBody}>
      {rows.map((row) => (
        <div key={row.id} className={styles.row}>
          <div className={styles.rowTop}>
            <span className={styles.rowKey}>{row.k}</span>
            <span className={styles.rowValue} data-ok={row.ok ? 'true' : 'false'}>
              <span className={styles.rowAsked} data-pair-asked={row.id}>{row.asked}</span> → {row.got}
            </span>
          </div>
          <div className={styles.rowNote} data-ok={row.ok ? 'true' : 'false'}>{row.note}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * @returns {React.ReactElement}
 */
export function DataScreen() {
  const [session, dispatch] = useSession();
  const { result, histogram } = session;
  const [tune] = useTune();
  const [build] = useBuild();
  const roadTest = useRoadTest();

  /**
   * The pull, as a file.
   *
   * Every column the datalog carries, not the three a power graph shows — the cycle
   * quantities are the ones a spreadsheet is better at than a gauge, and they are the
   * reason to take the log away at all: you diff two tunes on them.
   */
  const exportSheet = () => {
    const name = build.presetId ? presetById(build.presetId)?.name : 'custom build';
    downloadCsv(sweepToCsv(result.points), dynoSheetFilename({ engineName: name }));
  };
  const { ve } = tune;
  const { logFocusRpm } = session;
  // Local, not session state. The store is one useReducer behind one context, so every
  // dispatch re-renders every consumer — the reason LiveScreen is its own file. A drag
  // gesture must not go through that path.
  const [scrubRpm, setScrubRpm] = React.useState(
    () => initialScrubRpm(result.points, logFocusRpm),
  );
  const shown = pointAt(result.points, scrubRpm) ?? result.points[0];
  const gauges = pointGauges(shown);

  // Three of the eight gauges above carry their verdict ONLY through
  // StatTile's `.danger .value { color: var(--danger) }` — colour with no text
  // to back it up. These sentences are the prose those rows used to carry
  // before they became gauges, restored as ordinary visible text rather than
  // an ARIA-only aside, so the fix serves every reader, not just assistive
  // technology. Wording and thresholds are carried over verbatim from the old
  // Injectors/Heat/Pressure rows (`git show 07288c2` has them).
  const riskNotes = [
    utilisationTone(shown.duty) === 'danger' && {
      key: 'injectors',
      text: `Injectors at the limit — ${shown.pw} ms of the ${(120000 / shown.rpm).toFixed(1)} ms available.`,
    },
    shown.egtRisk && {
      key: 'heat',
      text: 'Exhaust running hot — retard and lean mixture are what put it there.',
    },
    shown.pressureRisk && {
      key: 'pressure',
      text: 'Past what stock pistons and rods take — a mechanical limit, not detonation.',
    },
  ].filter(Boolean);
  const bad = shown.knock || shown.fuelLimited || shown.leanRisk || shown.richRisk || shown.pressureRisk;
  // `> 85` is the card's own existing threshold, carried over verbatim. It is NOT
  // utilisationTone's 75 — that governs a single gauge's colour, this governs the whole
  // readout's border, and they have always been different numbers. Swapping one for the
  // other here would change when the panel goes amber, which is a behaviour change
  // nobody asked for hiding inside a refactor.
  const warn = !bad && (shown.duty > 85 || shown.egtRisk);
  const tone = bad ? 'danger' : warn ? 'warn' : 'ok';

  // From the DATA, never from SWEEP_START_RPM/SWEEP_END_RPM: a low-redline build makes
  // a shorter pull, and a track built from the constants would scrub past its end.
  const firstRpm = result.points[0].rpm;
  const lastRpm = result.points[result.points.length - 1].rpm;

  // The same function both charts call in 5b, so the tint on the track and the tint on
  // the chart are one rule's output rather than two that drift. Whole-pull findings are
  // dropped by `eventBands` itself — a band spanning the whole track would claim a
  // location the finding does not have.
  const span = Math.max(1, lastRpm - firstRpm);
  const bands = eventBands(result.events).map((b) => ({
    ...b,
    left: `${((b.rpmStart - firstRpm) / span) * 100}%`,
    width: `${((b.rpmEnd - b.rpmStart) / span) * 100}%`,
  }));

  // HISTOGRAM — the core real-world tuning workflow. A pull's lambda error is
  // binned onto the same RPM x MAP grid as the VE table, so the correction can be
  // applied cell-for-cell. This is what HP Tuners' scanner histogram does. It is
  // the same measurement TUNE > AIRFLOW's correction runs on (src/sim/veLearn.js), so
  // the two never disagree: the wideband's reading against the table's target, the
  // MAF's own error left to the MAF calibration, and points the VE table did not set
  // (nitrous, injectors at their limit, protection, fuel cut) left out.
  //
  // Sign convention, because getting it backwards makes the tool teach the exact wrong
  // reflex: a positive number means the engine ran LEANER than commanded, so it
  // swallowed MORE air than the table claimed, so the cell must come UP by that much.
  const buildHistogram = () => {
    if (!result) return;
    const { ratio } = veCorrections(veSamplesFromPull(result.points));
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'histogram', value: ratio.map((row) => row.map((r) => (r == null ? null : (r - 1) * 100))) });
  };
  const applyHistogram = () => {
    if (!histogram) return;
    // SET_TABLE carries a value, not a function, so the old functional update
    // (`setVeEdited((prev) => ...)`) is resolved here against the CURRENT `ve` — the
    // one already in scope from the store — before dispatching.
    const nextVe = ve.map((row, ri) => row.map((v, ci) => {
      const e = histogram[ri][ci];
      return e == null ? v : Number(clamp(v * (1 + e / 100), 10, 130).toFixed(1));
    }));
    dispatch({ type: ACTIONS.SET_TABLE, table: 've', value: nextVe });
    dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'histogram', value: null });
  };

  return (
    <>
      <Eyebrow icon={Info}>Datalog</Eyebrow>
      <div className={styles.intro}>
        Every point of the pull, one at a time. Each line pairs <b className={styles.em}>what you asked for</b> with <b className={styles.em}>what the engine actually did</b> — a mismatch is the ECU telling you something.
      </div>

      {/* Native range, not a hand-built drag surface: keyboard, touch, pointer and
          screen-reader support all come with it, and #81 already tracks this
          project's accessibility debt. `step` is the sweep step, so every position
          lands on a real point rather than between two. */}
      <div className={styles.trackWrap}>
        {bands.map((b) => (
          <div
            key={b.id}
            className={styles.trackBand}
            data-track-band={b.id}
            data-tone={b.tone}
            aria-hidden="true"
            /* A single-point event's width is 0% — real, but nothing for a mouse
               user to see. `ResultScreen` floors the same case to 3px at paint
               time for the same reason; this is that floor's CSS equivalent,
               since a bare percentage width has no px minimum of its own. */
            style={{ left: b.left, width: b.width, minWidth: '3px' }}
          />
        ))}
        <input
          type="range"
          className={styles.track}
          min={firstRpm} max={lastRpm} step={SWEEP_STEP_RPM}
          value={scrubRpm}
          onChange={(e) => setScrubRpm(Number(e.target.value))}
          aria-label="Scrub the pull by RPM"
          aria-valuetext={`${shown.rpm} RPM`}
        />
      </div>

      <div className={styles.card} data-tone={tone}>
        <div className={styles.cardHead}>
          <span className={styles.cardRpm}>{shown.rpm} RPM</span>
          <span className={styles.cardStat}>{roadTest ? 'road test' : `${shown.hp} whp · ${shown.torque} lb-ft`}</span>
        </div>
        <div className={styles.gauges}>
          {gauges.map((g) => (
            <div key={g.key} data-gauge={g.key} data-tone={g.tone}>
              <StatTile label={g.label} value={g.value} unit={g.unit} tone={g.tone} />
            </div>
          ))}
        </div>
        {riskNotes.length > 0 && (
          <div className={styles.riskNotes}>
            {riskNotes.map((n) => (
              <div key={n.key} className={styles.riskNote} data-risk-note={n.key}>{n.text}</div>
            ))}
          </div>
        )}
        <PairRows point={shown} />
        {shown.breakdown && (
          <div className={styles.ecu} data-testid="ecu-readout">
            <div className={styles.ecuHead}>ENGINE MANAGEMENT AT THIS POINT</div>
            <p className={styles.ecuNote}>
              {!shown.protect?.length && !(shown.knockPull > 0) && !(shown.knockUnheard > 0.3) && !(shown.misfire > 5)
                ? 'Nothing stepped in here: the engine ran your tables as written.'
                : 'Something stepped in here. The amber and red tiles say what; the lists below show exactly how each value was changed.'}
            </p>
            <div className={styles.gauges}>
              <StatTile label="KNOCK RETARD" value={shown.knockPull.toFixed(1)} unit="°" tone={shown.knockPull > 0 ? 'warn' : 'neutral'} />
              <StatTile label="UNHEARD KNOCK" value={(shown.knockUnheard ?? 0).toFixed(1)} unit="°" tone={shown.knockUnheard > 0.3 ? 'danger' : 'neutral'} />
              {shown.boostTarget > 0 && <StatTile label="BOOST TARGET" value={shown.boostTarget} unit="psi" />}
              {shown.boostTarget > 0 && <StatTile label="WASTEGATE" value={shown.wgDuty} unit="%" />}
              <StatTile label="FUEL ΔP" value={shown.railDp} unit="kPa" tone={shown.fuelStarved ? 'danger' : 'neutral'} />
              <StatTile label="MISFIRE" value={shown.misfire} unit="%" tone={shown.misfire > 5 ? 'danger' : 'neutral'} />
              {shown.blowerRpm != null && <StatTile label="BLOWER" value={shown.blowerRpm.toLocaleString('en-US')} unit="rpm" tone={shown.blowerOverspeed ? 'danger' : 'neutral'} />}
              {shown.blowerHp != null && <StatTile label="BLOWER DRIVE" value={shown.blowerHp} unit="hp" />}
              {shown.nitrousLbMin > 0 && <StatTile label="NITROUS" value={shown.nitrousLbMin} unit="lb/min" />}
              {shown.nitrousLbMin > 0 && <StatTile label="BOTTLE" value={shown.bottlePsi} unit="psi" tone={shown.bottlePsi < 850 ? 'warn' : 'neutral'} />}
              {(shown.camIn > 0 || shown.camEx > 0) && <StatTile label="CAMS IN / EX" value={`${shown.camIn} / ${shown.camEx}`} unit="°" />}
              <StatTile label="PROTECTIONS" value={shown.protect?.length ? shown.protect.join(', ') : 'none'} tone={shown.protect?.length ? 'warn' : 'ok'} />
            </div>
            <CorrectionStack breakdown={shown.breakdown} result={{ timing: shown.timing, lambda: shown.lambda }} />
          </div>
        )}
      </div>

      <ExpandableInfo title="How to read a datalog">
        Diagnosis happens in the <b className={styles.em}>asked → got</b> pairs, not in the power number.
        <br /><br /><b className={styles.em}>Timing</b>: if the two differ, the ECU overrode you. That is knock retard, and the gap is roughly how far past the limit your table was (the ECU retards in whole steps). A common rule of thumb treats anything sustained above ~2° as a problem to fix.
        <br /><br /><b className={styles.em}>Mixture</b>: if actual is not what you commanded, the cause is upstream of the fuel table — usually injectors out of duty cycle, MAF scaling, or injector scaling (TUNE › INJECTORS) that does not match the hardware. Do not paper over it by editing fuel cells; fix the cause.
        <br /><br /><b className={styles.em}>INJ PW / DUTY</b>: duty is a time budget. At 7500 RPM there are only 16 ms in an engine cycle. Past about 90% there is no room left and the mixture goes lean regardless of what you asked for.
        <br /><br /><b className={styles.em}>EGT</b>: exhaust temperature rises with retarded timing and as the mixture leans toward stoichiometric. Sustained above about 950–1000°C cooks turbines and valves.
        <br /><br /><b className={styles.em}>PEAK P</b>: peak cylinder pressure is what the piston, rod and bearings physically carry, and it is set by compression ratio multiplied by manifold pressure, not by boost alone. In this app a naturally aspirated engine peaks around 60–70 bar and a factory turbo engine around 75–90; practitioners quote about 100–120 for real production turbo engines, so the app runs low here (see Learn article 39). Its own limit, about 105 bar, is set on the app&apos;s scale. Past that, stock pistons and rods start failing <i>without</i> any detonation to warn you — which is exactly what high-octane fuel hides, because octane buys knock margin and nothing else.
      </ExpandableInfo>

      <div className={styles.buildWrap}>
        <Button variant="ghost" onClick={exportSheet}>
          EXPORT DYNO SHEET (CSV)
        </Button>
      </div>

      <Eyebrow icon={Grid3x3}>Fuel Trim Histogram</Eyebrow>
      <ExpandableInfo title="How real tuners actually correct a VE table">
        This is the workflow every professional platform is built around. You log a pull, bin the difference between commanded and actual mixture onto the same RPM x MAP grid as your VE table, then apply that error back into the cells.
        <br /><br />A cell reading <b className={styles.em}>+6%</b> means the engine ran 6% leaner than you commanded, which can only happen if it actually pulled 6% <i>more</i> air than your VE table claimed — so that cell should go <b className={styles.em}>up</b> 6%. A negative cell means the opposite: the table is over-reporting airflow, the ECU is over-fuelling, and the number should come down.
        <br /><br />The ECU has no way to measure cylinder filling directly. It fuels from your table and nothing else, so a wrong table means wrong fuel, every time. Blue cells are within tolerance; red means your table is lying to the ECU at that point. Correct, re-pull, repeat until it is flat. A cell you hit squarely lands on the truth in one pass; the rest take a couple, because every logged point is interpolated between four cells.
        <br /><br />With a MAF blended into the fuel, part of the error is the MAF's own: a new intake housing changes what it reads. That part is taken out here and left for TUNE › SENSORS, because folding it into VE would have to be undone the moment the MAF is fixed. Points the table did not fuel (nitrous, maxed injectors, protection, fuel cut) are left out. TUNE › AIRFLOW runs the same numbers with the working shown per cell, and lets you apply half.
      </ExpandableInfo>
      {!histogram ? (
        /* Was a cyan-outlined width:100% bar. Cyan is the chart-series
           hue — the same borrowed colour Task 6 took off the intercooler
           toggle — so this takes the accent like every other action. */
        <div className={styles.buildWrap}>
          <Button onClick={buildHistogram}>
            BUILD HISTOGRAM FROM THIS PULL
          </Button>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <div className={styles.tableScroll}>
            <div className={styles.tableInner}>
              <div className={styles.tableRow}>
                <div className={styles.cornerCell} />
                {RPM.map((r) => (
                  <div key={r} className={styles.headerCell}>{r}</div>
                ))}
              </div>
              {LOAD.map((m, ri) => (
                <div key={m} className={styles.tableRow}>
                  <div className={styles.loadCell}>{m}</div>
                  {RPM.map((_, ci) => {
                    const e = histogram[ri][ci];
                    const bg = e == null ? T.panel2 : deltaHeat(e);
                    return (
                      <div key={ci} className={styles.dataCell} data-empty={e == null ? 'true' : 'false'} style={{ background: bg }}>
                        {e == null ? '—' : `${e > 0 ? '+' : ''}${e.toFixed(1)}`}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.legend}>Cells show % airflow error (blank = not visited during this pull). Rows are MAP kPa, columns RPM.</div>
          <div className={styles.actions}>
            <Button style={{ flex: 2 }} onClick={applyHistogram}>
              APPLY CORRECTIONS TO VE
            </Button>
            {/* Not `danger`: discarding throws away a histogram that
                BUILD HISTOGRAM regenerates from the same pull. */}
            <Button variant="ghost" style={{ flex: 1 }} onClick={() => dispatch({ type: ACTIONS.SET_SESSION_FIELD, field: 'histogram', value: null })}>
              DISCARD
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
