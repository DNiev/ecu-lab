/**
 * BUILD > Induction.
 *
 * Turbo kit toggle, turbine and compressor sizing, intercooler, the boost target
 * curve editor (eight RPM columns as bar buttons, tap one to select it, then edit it
 * below with full-width controls), and the Cold Air Intake bolt-on — the one
 * installable part whose physics live on the induction side rather than the exhaust
 * side. See ExhaustScreen for the other two (Cat-Back Exhaust, Long-Tube Headers).
 */

import { Wind } from 'lucide-react';
import React from 'react';

import {
  COMPRESSOR_OPTS, DEFAULT_ECU_HW, LINEAR_SCALES, MOD_INFO, RPM, TURBINE_OPTS, WASTEGATE_OPTS, clamp,
} from '../../../sim/index.js';
import { BuildSection } from '../../components/BuildSection.jsx';
import { SetupNote } from '../../components/ecu/SetupNote.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { PickList } from '../../components/PickList.jsx';
import { Button } from '../../primitives/Button.jsx';
import { Note } from '../../primitives/Note.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { Seg } from '../../primitives/Seg.jsx';
import { Toggle } from '../../primitives/Toggle.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild } from '../../state/StoreProvider.jsx';

import styles from './InductionScreen.module.css';

// `boltons` dissolved into this screen and ExhaustScreen — this is the induction
// half. Keep reading label/blurb off MOD_INFO rather than copying the strings, or
// this list forks from the catalogue it is meant to be a view onto.
const MODS_HERE = ['intake'];

/**
 * @param {object} props
 * @param {boolean} props.active whether this is BUILD's open section
 * @param {(section: string) => void} props.onToggle opens or closes a BUILD section
 * @returns {React.ReactElement}
 */
export function InductionScreen({ active, onToggle }) {
  const [build, dispatch] = useBuild();
  const {
    turboOn, boostCurve, boostSel, turbineIdx, turbineCount, compressorIdx, mods,
  } = build;

  // Every boost-curve write goes through here. Rebuilding from the RPM axis makes it
  // structurally impossible for the curve to be the wrong length or to contain a
  // non-number, which is what previously let a single edit poison the whole sim.
  const setBoostAt = (i, value) => dispatch({
    type: ACTIONS.SET_BUILD_FIELD,
    field: 'boostCurve',
    value: RPM.map((_, idx) => clamp(Number(idx === i ? value : boostCurve[idx]) || 0, 0, 25)),
  });

  const installMod = (key) => {
    if (mods[key]) return;
    // Fitting a part changes airflow but does NOT edit your logged VE table — the
    // VE tab will show the gap and let you accept it once you understand why.
    dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'mods', value: { ...mods, [key]: true } });
  };

  const ceiling = COMPRESSOR_OPTS[compressorIdx].boostCeiling;
  const gate = build.wastegate ?? DEFAULT_ECU_HW.gate;
  const sensorHw = build.sensorHw ?? DEFAULT_ECU_HW.sensorHw;
  const setGate = (patch) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'wastegate', value: { ...gate, ...patch } });
  const peakOverCeiling = Math.max(...boostCurve) > ceiling;
  const selectedOverCeiling = boostCurve[boostSel] > ceiling;

  return (
    <BuildSection
      active={active} onClick={() => onToggle('induction')}
      icon={Wind} label="Induction"
      sub={turboOn ? `On · ${turbineCount > 1 ? `Twin ${TURBINE_OPTS[turbineIdx].label.split(' ')[0].toLowerCase()}` : TURBINE_OPTS[turbineIdx].label.split(' ')[0]} turbine · peak ${Math.max(...boostCurve)} psi` : 'Not installed'}
    >
      {/* The card markup below is verbatim out of the dissolved BoltonsScreen: a plain
          `<button disabled={mods[key]}>` where `disabled` means *installed*, switched
          visually with `data-installed` rather than a `Button` variant — see the brief
          for why this stays a plain button. */}
      <div className={styles.list}>
        {MODS_HERE.map((key) => (
          <button
            key={key} onClick={() => installMod(key)} disabled={mods[key]}
            className={styles.card} data-installed={mods[key] ? 'true' : 'false'}
          >
            <div className={styles.cardHead}>
              <span className={styles.cardLabel} data-installed={mods[key] ? 'true' : 'false'}>{MOD_INFO[key].label}</span>
              <span className={styles.cardStatus} data-installed={mods[key] ? 'true' : 'false'}>{mods[key] ? 'INSTALLED' : 'INSTALL'}</span>
            </div>
            <div className={styles.cardBlurb}>{MOD_INFO[key].blurb}</div>
          </button>
        ))}
      </div>

      <div className={styles.labelTight}>MAP Sensor</div>
      <Seg label="MAP sensor" options={Object.entries(LINEAR_SCALES.map).map(([id, s]) => ({ id, label: s.label.split(' (')[0] }))}
        value={sensorHw.map} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'sensorHw', value: { ...sensorHw, map: v } })} equal />
      <div className={styles.hint}>A sensor reads up to its rating and no further: a 1-bar sensor tops out at atmospheric and never sees boost.</div>
      <SetupNote paths={['sensors.map']} okText="The ECU is set up for this sensor."
        hardwareWarning={turboOn && sensorHw.map === '1bar'
          ? 'This engine makes boost, and a 1-bar sensor stops reading at atmospheric. The ECU will not see boost and will fuel too little under it. Fit 2.5-bar or bigger.'
          : null} />

      <Toggle label="Turbo kit" sub="Adds boost near WOT, with spool lag off idle" checked={turboOn} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'turboOn', value: v })} />

      <div className={styles.subPanel} data-open={turboOn ? 'true' : 'false'}>
        <div className={styles.subPanelInner}>
          {turboOn && Math.max(...boostCurve) <= 0 && (
            <Note>
              The boost target is 0 psi everywhere, so the turbo only restricts the exhaust and the engine makes less power, not more. Set a boost curve under Boost Target Curve below; 6–8 psi is a sensible first step, with timing taken out of the boost rows on TUNE › SPARK before you pull.
            </Note>
          )}
          <div className={styles.label}>Turbine Size</div>
          <PickList options={TURBINE_OPTS.map((o) => ({ label: o.label, value: o.label }))} value={TURBINE_OPTS[turbineIdx].label} onChange={(v) => dispatch({ type: ACTIONS.SET_TURBINE, value: TURBINE_OPTS.findIndex((o) => o.label === v) })} />
          <div className={styles.labelTight}>Compressor Size</div>
          <Seg label="Compressor Size" options={COMPRESSOR_OPTS.map((o) => ({ label: o.label, id: o.label }))} value={COMPRESSOR_OPTS[compressorIdx].label} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'compressorIdx', value: COMPRESSOR_OPTS.findIndex((o) => o.label === v) })} />
          <div className={styles.ceilingNote}>Ceiling before it runs outside its efficient range: ~{ceiling} psi</div>
          <ExpandableInfo title="Turbine vs. compressor — different jobs">
            The turbine sits in the exhaust and spins from exhaust energy — its size sets how quickly it spools (small = fast but chokes exhaust flow up top; large = laggy but flows more at redline). The compressor sits in the intake and does the actual pressurizing — its size sets a practical boost ceiling before it's forced outside its efficient operating range, where a real compressor makes hot, inefficient, knock-prone air. (This app heats the charge at one fixed compressor efficiency, so past the ceiling it warns you rather than heating the air further — see Learn article 39.)
            <br /><br />Real turbo shops size compressors by required <b className={styles.em}>airflow</b>, not boost pressure. The industry rule of thumb is about <b className={styles.em}>10 crank horsepower per lb/min of air</b> (roughly 8.5 whp after drivetrain loss) — so a 400 whp target needs a compressor good for roughly 47 lb/min, which you then check against the manufacturer's compressor map. (This app's engines get about 10–15% more from each lb/min than real ones — see Learn article 39 — so size real hardware by the rule, not by the app.)
            <br /><br />Note that this figure barely changes with fuel. E85 needs far more fuel by volume, but it also releases almost exactly the same energy per unit of <i>air</i> as gasoline, so airflow — not fuel type — sets the power ceiling. Octane still helps, but through better timing, not through a bigger number here.
          </ExpandableInfo>

          <div className={styles.labelTight}>Wastegate Actuator</div>
          <Seg label="Wastegate actuator" options={WASTEGATE_OPTS.map((o) => ({ id: o.id, label: o.label }))} value={gate.type} onChange={(v) => setGate({ type: v })} equal />
          {gate.type === 'pneumatic' && (
            <>
              <div className={styles.labelTight}>Spring Pressure</div>
              <Seg label="Wastegate spring pressure" options={[4, 5, 7, 10, 14].map((p) => ({ id: p, label: `${p} psi` }))} value={gate.springPsi} onChange={(v) => setGate({ springPsi: Number(v) })} equal />
              <div className={styles.hint}>The gate opens at its spring pressure on its own. The boost solenoid can hold it shut longer — it can never open it sooner.</div>
            </>
          )}

          <div className={styles.intercoolerRow}>
            <Toggle label="Intercooler" sub="Cools charge air, buys knock margin under boost" checked={mods.intercooler} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'mods', value: { ...mods, intercooler: v } })} />
          </div>

          <div className={styles.boostLabel}>Boost Target Curve</div>

          <Panel tight style={{ marginBottom: 10 }}>
            {/* Tap a bar to select that RPM point, then edit it below with full-width controls. */}
            <div data-testid="boost-columns" className={styles.columns}>
              {RPM.map((r, i) => {
                const on = boostSel === i;
                const over = boostCurve[i] > ceiling;
                return (
                  <button
                    key={r} onClick={() => dispatch({ type: ACTIONS.SET_BOOST_SEL, value: i })}
                    className={styles.col} data-selected={on ? 'true' : 'false'}
                  >
                    <div className={styles.colValue} data-selected={on ? 'true' : 'false'} data-over={over ? 'true' : 'false'}>
                      {boostCurve[i]}
                    </div>
                    <div
                      className={styles.colFill} data-selected={on ? 'true' : 'false'} data-over={over ? 'true' : 'false'}
                      style={{ height: `${(boostCurve[i] / 25) * 72}%`, minHeight: boostCurve[i] > 0 ? 3 : 0 }}
                    />
                    <div className={styles.colRpm} data-selected={on ? 'true' : 'false'}>
                      {r >= 1000 ? (r / 1000).toFixed(1) + 'k' : r}
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel tight style={{ marginBottom: 10 }}>
            <div className={styles.editorHead}>
              <span className={styles.editorRpm}>{RPM[boostSel]} RPM</span>
              <span className={styles.editorValue} data-over={selectedOverCeiling ? 'true' : 'false'}>
                {boostCurve[boostSel]}<span className={styles.editorUnit}>psi</span>
              </span>
            </div>
            <input type="range" min={0} max={25} step={1} value={boostCurve[boostSel]}
              onChange={(e) => setBoostAt(boostSel, Number(e.target.value))}
              className={styles.slider} />
            <div className={styles.stepRow}>
              {[-5, -1, 1, 5].map((d) => (
                <button key={d} onClick={() => setBoostAt(boostSel, (boostCurve[boostSel] ?? 0) + d)}
                  className={styles.stepButton}>
                  {d > 0 ? '+' : ''}{d}
                </button>
              ))}
            </div>
            <div className={styles.presetRow}>
              <Button variant="ghost" size="sm" style={{ flex: 1 }}
                onClick={() => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'boostCurve', value: RPM.map(() => clamp(Number(boostCurve[boostSel]) || 0, 0, 25)) })}>
                FLAT ACROSS ALL
              </Button>
              <Button variant="ghost" size="sm" style={{ flex: 1 }}
                onClick={() => { const peak = boostCurve[boostSel]; dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'boostCurve', value: RPM.map((r) => Math.round(peak * clamp((r - 1500) / 2600, 0, 1))) }); }}>
                SPOOL RAMP
              </Button>
              {/* Built from RPM so the curve can never be shorter than the
                  axis. A hand-written literal previously had seven entries
                  for eight breakpoints, and the next edit put NaN through
                  the entire simulation. */}
              <Button variant="ghost" size="sm" style={{ flex: 1 }}
                onClick={() => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'boostCurve', value: RPM.map(() => 0) })}>
                ZERO
              </Button>
            </div>
            <div className={styles.ceilingWarning} data-over={peakOverCeiling ? 'true' : 'false'}>
              Compressor efficient to ~{ceiling} psi{peakOverCeiling ? ' — you are past it, expect hot inefficient air' : ''}
            </div>
          </Panel>

          <Note tone="warn">Stock calibrations have no real tuning above ~101 kPa. Adding boost without retarding SPARK and richening FUEL in the high-MAP rows will knock hard — run a pull and read the log.</Note>

          <ExpandableInfo title="Why boost costs you timing">
            Boost packs more air and fuel into the same cylinder volume before combustion starts, raising peak pressure and temperature for a given amount of spark advance. The same timing that was safe with no boost becomes knock-prone at 8-10 psi through the same head and pistons — which is why boosted tunes run less initial timing than a naturally aspirated tune, and why timing has to come out further as boost climbs. Set your target here, then dial in TIMING and AFR to match.
          </ExpandableInfo>
        </div>
      </div>
    </BuildSection>
  );
}
