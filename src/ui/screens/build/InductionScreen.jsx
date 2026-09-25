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
  BLOWER_OPTS, COMPRESSOR_OPTS, DEFAULT_ECU_HW, KELVIN_OFFSET, LINEAR_SCALES, MOD_INFO, RPM, TURBINE_OPTS,
  WASTEGATE_OPTS, blowerCurve, blowerOf, bottlePressurePsi, clamp, deriveEngine, envFrom, starterRatio, tankFuel,
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
import { useBuild, useSession } from '../../state/StoreProvider.jsx';

import styles from './InductionScreen.module.css';

// `boltons` dissolved into this screen and ExhaustScreen — this is the induction
// half. Keep reading label/blurb off MOD_INFO rather than copying the strings, or
// this list forks from the catalogue it is meant to be a view onto.
const MODS_HERE = ['intake'];

/** What each kind of supercharger is called on the picker. */
const BLOWER_KIND = { roots: 'Roots', twinscrew: 'Twin-screw', centrifugal: 'Centrifugal' };

/**
 * @param {object} props
 * @param {boolean} props.active whether this is BUILD's open section
 * @param {(section: string) => void} props.onToggle opens or closes a BUILD section
 * @returns {React.ReactElement}
 */
export function InductionScreen({ active, onToggle }) {
  const [build, dispatch] = useBuild();
  const [session] = useSession();
  const {
    turboOn, boostCurve, boostSel, turbineIdx, turbineCount, compressorIdx, mods, nitrous,
  } = build;
  const set = (field, value) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field, value });

  // A supercharger and a turbo are not fitted together: switching one on takes the other off.
  const blower = blowerOf(build);
  const fuel = tankFuel(build);
  const curve = React.useMemo(() => (blower ? blowerCurve(build, fuel) : []), [blower, build, fuel]);
  const setTurbo = (v) => { if (v) set('blowerId', null); set('turboOn', v); };
  const setBlower = (id) => {
    if (!id) { set('blowerId', null); return; }
    const next = { ...build, turboOn: false, blowerId: id };
    set('turboOn', false);
    set('blowerId', id);
    set('blowerRatio', starterRatio(next, fuel));
  };
  const ratio = build.blowerRatio ?? blower?.defaultRatio ?? 1;
  const setRatio = (r) => set('blowerRatio', Math.round(clamp(r, 0.5, 4) * 100) / 100);
  const redline = deriveEngine(build.engineConfig).redline ?? 7000;
  const top = curve.at(-1);
  const rated = blower ? (blower.maxRpm ?? blower.maxImpellerRpm) : 1;
  const peakBoost = curve.length ? Math.max(...curve.map((p) => p.boostPsi)) : 0;

  // The nitrous bottle's pressure is its temperature: at the heater's 85 °F with one, the
  // day's without. The jets are sized for about 950 psi.
  const setNitrous = (patch) => set('nitrous', patch === null ? null : { kit: 'wet', shotHp: 100, heater: true, bottleLb: 10, ...(nitrous ?? {}), ...patch });
  const dayK = envFrom(session.env).ambientK;
  const bottlePsi = Math.round(bottlePressurePsi(nitrous?.heater ? (85 - 32) * 5 / 9 + 273.15 : dayK));
  const jetShare = Math.round(Math.sqrt(Math.max(0, bottlePsi) / 950) * 100);

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
      sub={`${turboOn ? `Turbo · ${turbineCount > 1 ? `Twin ${TURBINE_OPTS[turbineIdx].label.split(' ')[0].toLowerCase()}` : TURBINE_OPTS[turbineIdx].label.split(' ')[0]} turbine · peak ${Math.max(...boostCurve)} psi`
        : blower ? `${blower.label} · ${ratio.toFixed(2)}:1 pulley · ~${peakBoost.toFixed(0)} psi`
          : 'Not installed'}${nitrous ? ` · ${nitrous.shotHp} shot ${nitrous.kit} nitrous` : ''}`}
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

      <Toggle label="Turbo kit" sub="Adds boost near WOT, with spool lag off idle" checked={turboOn} onChange={setTurbo} />

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

          {!blower && (
            <div className={styles.intercoolerRow}>
              <Toggle label="Intercooler" sub="Cools charge air, buys knock margin under boost" checked={mods.intercooler} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'mods', value: { ...mods, intercooler: v } })} />
            </div>
          )}

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

      <Toggle label="Supercharger kit" sub="Belt-driven boost: no lag, paid for at the crank" checked={!!blower} onChange={(v) => setBlower(v ? (build.blowerId ?? 'tvs1900') : null)} />

      {blower && (
        <div className={styles.subPanelInner}>
          <div className={styles.label}>Supercharger</div>
          <PickList
            options={BLOWER_OPTS.map((o) => ({ label: `${o.label} · ${BLOWER_KIND[o.type]}`, value: o.id }))}
            value={blower.id} onChange={(v) => setBlower(v)} />
          <div className={styles.hint}>
            {blower.type === 'centrifugal'
              ? `${blower.stepUp}:1 internal step-up · impeller rated ${rated.toLocaleString('en-US')} rpm · up to ${blower.boostCeiling} psi`
              : `${blower.dispL} L per revolution · rated ${rated.toLocaleString('en-US')} rpm · up to ${Math.round(blower.etaPeak * 100)}% efficient`}
          </div>

          <Panel tight style={{ marginBottom: 10 }}>
            <div className={styles.editorHead}>
              <span className={styles.editorRpm}>Pulley ratio</span>
              <span className={styles.editorValue} data-over={top?.overspeed ? 'true' : 'false'}>
                {ratio.toFixed(2)}<span className={styles.editorUnit}>:1</span>
              </span>
            </div>
            <input type="range" min={0.5} max={4} step={0.05} value={ratio} aria-label="Pulley ratio"
              onChange={(e) => setRatio(Number(e.target.value))} className={styles.slider} />
            <div className={styles.stepRow}>
              {[-0.1, -0.05, 0.05, 0.1].map((d) => (
                <button key={d} onClick={() => setRatio(ratio + d)} className={styles.stepButton}>
                  {d > 0 ? '+' : '−'}{Math.abs(d).toFixed(2)}
                </button>
              ))}
            </div>
            <div className={styles.presetRow}>
              <Button variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => set('blowerRatio', starterRatio(build, fuel))}>
                STARTER PULLEY (~8 PSI)
              </Button>
            </div>
            <div className={styles.hint}>Crank pulley over blower pulley. A smaller blower pulley — a higher ratio — spins it faster and makes more boost.</div>
          </Panel>

          <div className={styles.boostLabel}>Boost it makes at full throttle</div>
          <Panel tight style={{ marginBottom: 10 }}>
            <div data-testid="blower-columns" className={styles.columns}>
              {curve.map((p) => (
                <div key={p.rpm} className={styles.col} data-selected="false">
                  <div className={styles.colValue} data-selected="false" data-over={p.overspeed ? 'true' : 'false'}>{p.boostPsi.toFixed(1)}</div>
                  <div className={styles.colFill} data-selected="false" data-over={p.overspeed ? 'true' : 'false'}
                    style={{ height: `${Math.min(1, p.boostPsi / 25) * 72}%`, minHeight: p.boostPsi > 0 ? 3 : 0 }} />
                  <div className={styles.colRpm} data-selected="false">{p.rpm >= 1000 ? (p.rpm / 1000).toFixed(1) + 'k' : p.rpm}</div>
                </div>
              ))}
            </div>
          </Panel>
          {top && (
            <div className={styles.ceilingWarning} data-over={top.overspeed ? 'true' : 'false'}>
              At {redline.toLocaleString('en-US')} RPM it turns {Math.round(top.blowerRpm).toLocaleString('en-US')} rpm — {Math.round((top.blowerRpm / rated) * 100)}% of its rating{top.overspeed ? ', past what it is built for: fit a larger blower pulley' : ''} — and takes about {Math.round(top.driveHp)} hp from the crank to do it.
            </div>
          )}
          {blower.type !== 'centrifugal' && top && top.blowerRpm / rated < 0.45 && (
            <Note>This blower is large for this engine: the pulley that makes sensible boost turns it at under half its rated speed, where it leaks most and heats the air most. A smaller unit would do the same job more efficiently.</Note>
          )}

          <div className={styles.intercoolerRow}>
            <Toggle label="Intercooler" sub="Cools charge air, buys knock margin under boost" checked={mods.intercooler} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'mods', value: { ...mods, intercooler: v } })} />
          </div>

          <Note tone="warn">A supercharger makes boost from the first press of the throttle, and the stock SPARK table was never tuned for it. Take timing out of the boost rows on TUNE › SPARK and run a pull before you trust it.</Note>

          <ExpandableInfo title="Roots, twin-screw, centrifugal — three ways to make boost">
            A <b className={styles.em}>Roots</b> blower is a pair of meshing lobes that carry a fixed volume of air round the outside of the case with every turn. It does not squeeze the air inside itself: the pressure builds in the manifold as the engine fails to swallow it all, which is why a classic Roots like the M90 runs near 50-55% efficient and heats the air the most. Eaton's TVS rotors — four lobes twisted 160° and a high-flow outlet — get a Roots to about 75%. A <b className={styles.em}>twin-screw</b> moves the same kind of fixed volume but squeezes it between its rotors on the way through, so it runs 70-78% efficient and delivers cooler air at the same boost. Both are <i>positive displacement</i>: they pump a fixed amount per turn, and since the engine's appetite also rises with RPM, they make boost from just off idle. The boost is what the blower delivers over what the engine swallows, so it dips where the engine breathes best and climbs toward redline where the engine starts to run out of breath — the bars above show exactly that for this engine.
            <br /><br />A <b className={styles.em}>centrifugal</b> (ProCharger, Vortech, Paxton) is a turbo's compressor driven by a belt and step-up gears instead of an exhaust turbine. Its pressure comes from impeller tip speed, which rises with RPM, so boost climbs with engine speed and peaks at redline — little low down, a lot at the top.
            <br /><br />Every one of them is driven by the crank, so the power to compress the air is taken from the engine you are trying to make power with: tens of horsepower at a few psi, well over a hundred on big boost. That is the price of having no lag. The pulley is how you tune one: there is no wastegate, so a smaller blower pulley — a higher ratio — is more boost.
          </ExpandableInfo>
        </div>
      )}

      <div className={styles.labelTight}>Nitrous Kit</div>
      <Seg label="Nitrous kit" options={[{ id: 'none', label: 'None' }, { id: 'wet', label: 'Wet' }, { id: 'dry', label: 'Dry' }]}
        value={nitrous ? nitrous.kit : 'none'} onChange={(v) => setNitrous(v === 'none' ? null : { kit: v })} equal />
      {nitrous && (
        <>
          <div className={styles.labelTight}>Shot</div>
          <Seg label="Nitrous shot" options={[50, 75, 100, 150, 200].map((h) => ({ id: h, label: `${h} hp` }))}
            value={nitrous.shotHp} onChange={(v) => setNitrous({ shotHp: Number(v) })} equal />
          <div className={styles.labelTight}>Bottle</div>
          <Seg label="Bottle size" options={[10, 15].map((lb) => ({ id: lb, label: `${lb} lb` }))}
            value={nitrous.bottleLb} onChange={(v) => setNitrous({ bottleLb: Number(v) })} equal />
          <Toggle label="Bottle heater" sub="Holds the bottle at 85 °F — about 920 psi" checked={!!nitrous.heater} onChange={(v) => setNitrous({ heater: v })} />
          <div className={styles.hint}>
            {nitrous.heater
              ? `The bottle sits near ${bottlePsi} psi: the jets flow about their rated shot.`
              : `At today's ${Math.round(dayK - KELVIN_OFFSET)} °C the bottle sits near ${bottlePsi} psi: the jets flow about ${jetShare}% of their rated shot.`}
            {nitrous.kit === 'dry' ? ' A dry kit sprays nitrous only — the ECU adds its fuel through the injectors.' : ' A wet kit brings its own fuel through a second jet.'}
          </div>
          <Note>Arm it from LIVE or the dyno; set where it sprays, the timing it takes out and a dry kit's fuel on TUNE › NITROUS.</Note>
          <ExpandableInfo title="How nitrous makes power">
            Nitrous oxide is 36% oxygen by weight — air is 23% — so every pound of it brings the oxygen of about 1.6 pounds of air, and with fuel to match that oxygen burns. It also comes apart as it heats, releasing heat of its own, and it arrives as a liquid that boils in the intake and chills the charge. A <b className={styles.em}>100 shot</b> is a jet sized to add about 100 hp; it flows 5-6 lb of nitrous a minute, so a 10 lb bottle is a handful of passes.
            <br /><br />The bottle holds nitrous as a liquid under its own vapour pressure, and that pressure is set by temperature, not by how full it is: about 760 psi at 70 °F, 920 at 85 °F. The jets are sized for 900-950 psi, so a cold bottle flows short and a hot one long — which is why racers heat bottles, and why a wet kit, whose fuel does not follow the bottle, runs rich when cold and lean when hot.
            <br /><br />The extra oxygen burns faster and hotter, so the knock limit drops: the rule of thumb is about 2° of timing out for every 50 hp of shot. And a nitrous mixture that goes lean does not run hot for a while — it melts pistons in seconds.
          </ExpandableInfo>
        </>
      )}
    </BuildSection>
  );
}
