/**
 * BUILD > Engine Architecture.
 *
 * Start from a real factory engine or build a custom short block: configuration,
 * bore/stroke, compression, cam duration, valve springs, block/head material.
 *
 * `engineDerived`, `activePreset` and `veAdvice` are the shell's, not this screen's:
 * `engineDerived` also feeds the tach and the dyno chart's RPM axis, `activePreset`
 * also names the header's engine label, and `veAdvice` also drives the AIR screen's
 * advisory panel. One definition each, passed in.
 */

import { RotateCcw, Settings } from 'lucide-react';
import React from 'react';

import {
  COIL_OPTS, CONFIG_OPTS, CYL_COUNT, ENGINE_PRESETS, INJECTION_OPTS, MATERIAL_OPTS, PRESET_GROUPS, VVT_OPTS, applyPreset,
} from '../../../sim/index.js';
import { BuildSection } from '../../components/BuildSection.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { Button } from '../../primitives/Button.jsx';
import { Note } from '../../primitives/Note.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { Seg } from '../../primitives/Seg.jsx';
import { Select } from '../../primitives/Select.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild, useHistory, useSession, useTune } from '../../state/StoreProvider.jsx';

import styles from './EngineScreen.module.css';

/**
 * @typedef {object} EngineDerived
 * @property {number} displacementL
 * @property {number} ratio
 * @property {string} character
 * @property {number} overlapDeg
 * @property {number} floatRpm
 * @property {number} redline
 */

/**
 * @typedef {object} VeAdvice
 * @property {boolean} inSync
 * @property {number} maxAbs
 */

/**
 * @param {object} props
 * @param {boolean} props.active whether this is BUILD's open section
 * @param {(section: string) => void} props.onToggle opens or closes a BUILD section
 * @param {EngineDerived} props.engineDerived
 * @param {object|null} props.activePreset the catalogue entry `presetId` names, or null
 * @param {VeAdvice} props.veAdvice
 * @param {() => void} props.onResetToStock wipes the calibration back to a stock
 *   baseline. The shell owns it because it rebuilds the VE table from `hwForVe`, a
 *   derivation several other screens and the sim payload also read.
 * @returns {React.ReactElement}
 */
export function EngineScreen({ active, onToggle, engineDerived, activePreset, veAdvice, onResetToStock }) {
  const [build, dispatch] = useBuild();
  const { engineConfig, presetId, presetPrompt } = build;
  const [tune] = useTune();
  const { tablesDirty } = tune;
  const [session] = useSession();
  const { result } = session;
  // `dispatch` above is the store's one dispatch function — useHistory() would hand
  // back the identical reference, so only `history` is taken from it here.
  const [history] = useHistory();
  // Only the two acts that replace the whole calibration get an offer here. A table
  // edit is undoable too, but its undo lives above the grid on TUNE, where the edit
  // happened — an offer on BUILD for something the player did on another tab would be
  // a control with no visible cause.
  const top = history.past[history.past.length - 1];
  const undoable = top && (top.label.startsWith('Preset · ') || top.label === 'Reset to stock');

  const setCfg = (patch) => dispatch({ type: ACTIONS.SET_ENGINE_CONFIG_PATCH, patch });
  const clearPresetId = () => dispatch({ type: ACTIONS.CLEAR_PRESET_ID });

  /** Whether the player has unsaved calibration work — hand-edited VE/spark/fuel —
   *  that loading a preset would silently overwrite. Tracked directly via
   *  `tablesDirty` rather than pull count: pullCount is restored from career
   *  storage on load, so it nags a returning player on an untouched default
   *  engine, and it misses a player who edited every table but never pulled. */
  const hasTuningWork = () => tablesDirty;

  const applyEnginePreset = (preset) => {
    const p = applyPreset(preset);
    // The whole BUILD slice — including the preset's own `mafScalar`, and `presetId` SET
    // rather than cleared — lands in ONE pass; see APPLY_PRESET in reducer.js.
    dispatch({ type: ACTIONS.APPLY_PRESET, preset: p });
  };

  const choosePreset = (preset) => {
    if (hasTuningWork()) dispatch({ type: ACTIONS.SET_PRESET_PROMPT, value: preset });
    else applyEnginePreset(preset);
  };

  const floating = engineDerived.floatRpm < engineDerived.redline;

  return (
    <BuildSection
      active={active} onClick={() => onToggle('engine')}
      icon={Settings} label="Engine Architecture"
      sub={`${engineDerived.displacementL.toFixed(1)}L ${engineConfig.configuration} · ${engineConfig.compression.toFixed(1)}:1 · ${engineConfig.camDuration}° cam`}
    >
      <div className={styles.label}>Start From a Real Engine</div>
      <Select
        // Select's wrapper takes `className` straight onto its own hardcoded
        // `className={styles.wrap}` via rest-prop spread with no merge, so a
        // caller's class REPLACES the wrap style rather than adding to it —
        // `style` is the only safe passthrough here today. Kept inline for
        // that reason rather than moved into the stylesheet.
        style={{ display: 'block', marginBottom: 13 }}
        label="Start From a Real Engine"
        groups={PRESET_GROUPS.map((g) => ({
          label: g.manufacturer,
          // The heading carries the manufacturer, so strip it off the option
          // where the name spells it the same way: "BMW B58B30M0" under a "BMW"
          // heading becomes "B58B30M0". The two Volkswagens are deliberately
          // left alone — they are named "VW EA888.3 (...)" against a
          // "Volkswagen" heading, so this replace finds nothing and they keep
          // their prefix. That reads fine (VW is the badge, Volkswagen the
          // maker) and is not worth an abbreviation table in the UI layer.
          options: g.presets.map((p) => ({
            label: `${p.name.replace(`${p.manufacturer} `, '')} · ${p.factory.crankHp} hp`,
            value: p.id,
          })),
        }))}
        extra={[{ label: 'Custom build', value: '__custom__' }]}
        value={presetId ?? '__custom__'}
        onChange={(v) => {
          if (v === '__custom__') { clearPresetId(); return; }
          const p = ENGINE_PRESETS.find((e) => e.id === v);
          if (p) choosePreset(p);
        }}
      />
      {activePreset && (
        // Panel builds its own className from `tight` and spreads rest props AFTER
        // it with no merge, so a caller's `className` would replace `tight` outright
        // rather than adding to it — `style` is the only safe way to add margin here.
        <Panel tight style={{ marginBottom: 13 }}>
          <div className={styles.blurb}>{activePreset.blurb}</div>
          <div className={styles.statRow}>
            <span>FACTORY RATING</span>
            <span className={styles.statValue}>
              {activePreset.factory.crankHp} hp · {activePreset.factory.crankTq} lb-ft
            </span>
          </div>
          <div className={styles.statRowLast}>
            <span>YOUR LAST PULL</span>
            <span className={styles.pullValue} data-have={result ? 'true' : 'false'}>
              {result ? `${result.peakHp} whp · ${result.peakTq} lb-ft` : 'no pull logged'}
            </span>
          </div>
          <div className={styles.footnote}>
            Factory figures are at the crank; the dyno here reads at the wheels, so expect roughly 15% less. The factory calibration is deliberately conservative — beating it is the exercise.
          </div>
        </Panel>
      )}
      {!presetId && (
        <Note>Custom build — every value below is yours to set. Pick a real engine above to start from a known-good factory configuration instead.</Note>
      )}
      {presetPrompt && (
        <div className={styles.callout}>
          <div className={styles.calloutText}>
            <b className={styles.calloutAccent}>This replaces your current tune.</b> Loading {presetPrompt.name} overwrites your VE, spark and fuel tables with its factory calibration. Your sandbox stats are kept.
          </div>
          <div className={styles.calloutRow}>
            {/* The one `danger` in the app. This prompt is raised ONLY when
                `hasTuningWork()` is true, so confirming it always overwrites
                hand-edited VE/spark/fuel tables. It is no longer irreversible —
                APPLY_PRESET is undoable, and the offer to undo it renders a few
                lines below — but it is still a whole calibration replaced in one
                click, and the undo stack is 50 deep and lives only for the session,
                so the warning stays. */}
            {/* Button has the same rest-spread-after-className shape as Panel and
                Select, so `style`, not `className`, is what actually reaches it
                without discarding its variant class. */}
            <Button variant="danger" style={{ flex: 1 }} onClick={() => applyEnginePreset(presetPrompt)}>
              LOAD {presetPrompt.name.toUpperCase()}
            </Button>
            <Button variant="ghost" style={{ flex: 1 }} onClick={() => dispatch({ type: ACTIONS.SET_PRESET_PROMPT, value: null })}>
              CANCEL
            </Button>
          </div>
        </div>
      )}
      {undoable && (
        <Note tone="warn">
          <span className={styles.undoRow}>
            <span>{top.label} replaced your tune. Undo restores the tables and hardware as they were before it.</span>
            <Button
              variant="quiet" size="sm"
              aria-label={`Undo ${top.label}`}
              onClick={() => dispatch({ type: ACTIONS.UNDO })}
            >
              UNDO
            </Button>
          </span>
        </Note>
      )}
      <Panel tight style={{ marginBottom: 13 }}>
        <div className={styles.displacementRow}><span>DISPLACEMENT</span><span className={styles.statValue}>{engineDerived.displacementL.toFixed(2)} L</span></div>
        <div className={styles.displacementRow}><span>BORE : STROKE</span><span className={styles.statValue}>{engineDerived.ratio.toFixed(3)}</span></div>
        <div className={styles.character}>{engineDerived.character}</div>
      </Panel>

      {!veAdvice.inSync && (
        <div className={styles.callout}>
          <b className={styles.calloutAccent}>Your VE table is now stale.</b> This hardware breathes differently than the engine your table was logged on. Log it again — a dyno pull for full throttle, a LIVE drive for the rest — and correct it from the log on <b className={styles.em}>TUNE &rsaquo; AIRFLOW</b>.
        </div>
      )}
      <ExpandableInfo title="Why changing hardware does not update your VE table">
        Everything that physically changes how this engine breathes feeds volumetric efficiency: bore/stroke ratio, cylinder count, compression, cam duration, valve springs, head material, intake/headers/exhaust, pipe diameter, turbine backpressure, even fuel choice (E85 evaporates cold enough to measurably densify the charge).
        <br /><br />But your VE table is a <b className={styles.em}>log</b> — a record of what the engine actually flowed last time it was measured. Bolt on a cam and that log does not rewrite itself; it just becomes wrong. In a real shop you would go back to the dyno and re-log airflow before trusting any of it.
        <br /><br />So this app never edits it silently. It tells you the table no longer matches the hardware; the logs tell you by how much, cell by cell, the way a tuner finds out — and you apply the correction once you understand why it moved.
        <br /><br />Note that <b className={styles.em}>boost is not part of VE</b>. VE measures how well the cylinder fills relative to the pressure available; boost raises that pressure (MAP) separately. That is why adding boost does not change these numbers, but adding a turbine does — the turbine is a restriction in the exhaust.
      </ExpandableInfo>

      <div className={styles.labelSpaced}>Configuration</div>
      <Seg label="Configuration" options={CONFIG_OPTS.map((c) => ({ label: `${c} · ${CYL_COUNT[c]}cyl`, id: c }))} value={engineConfig.configuration} onChange={(v) => setCfg({ configuration: v })} />
      <ExpandableInfo title="Why cylinder count and layout matter">
        For the same total displacement, spreading it across more, smaller cylinders means a shorter flame path in each, so the burn finishes sooner and the end gas has less time to knock — a small real knock-margin benefit — and more, smaller firing pulses smooth the delivery. More cylinders also means more bearings and friction, so it is a trade-off, not a free upgrade.
      </ExpandableInfo>

      <div className={styles.labelSpaced}>Bore: {engineConfig.bore.toFixed(1)} mm</div>
      <input type="range" min={75} max={105} step={0.5} value={engineConfig.bore} onChange={(e) => setCfg({ bore: Number(e.target.value) })} className={styles.slider} />
      <div className={styles.labelSpaced}>Stroke: {engineConfig.stroke.toFixed(1)} mm</div>
      <input type="range" min={65} max={100} step={0.5} value={engineConfig.stroke} onChange={(e) => setCfg({ stroke: Number(e.target.value) })} className={styles.slider} />
      <ExpandableInfo title="Bore, stroke, and engine character">
        Bore is cylinder diameter, stroke is how far the piston travels; together with cylinder count they set displacement. But the ratio between them shapes character independent of displacement: big-bore/short-stroke ("oversquare") tends to breathe and rev higher; small-bore/long-stroke ("undersquare") tends toward stronger low-end torque. This sandbox shifts your VE curve's effective bias toward high or low RPM based on what you set here.
      </ExpandableInfo>

      <div className={styles.labelSpaced}>Compression Ratio: {engineConfig.compression.toFixed(1)}:1</div>
      <input type="range" min={8.5} max={13.0} step={0.1} value={engineConfig.compression} onChange={(e) => setCfg({ compression: Number(e.target.value) })} className={styles.slider} />
      <ExpandableInfo title="Compression ratio's trade-off">
        Higher compression squeezes the mixture tighter before ignition, extracting more work from the same fuel — genuinely more efficient and torquey. The same squeeze also raises end-gas temperature and pressure, which is what causes knock. That is exactly why turbocharged engines usually run lower static compression than naturally aspirated ones: boost already adds cylinder pressure on its own.
      </ExpandableInfo>

      <div className={styles.labelSpaced}>
        Camshaft Duration: {engineConfig.camDuration}° <span className={styles.overlapNote}>· overlap {Math.round(engineDerived.overlapDeg)}°</span>
      </div>
      <input type="range" min={180} max={300} step={2} value={engineConfig.camDuration} onChange={(e) => setCfg({ camDuration: Number(e.target.value) })} className={styles.slider} />
      <div className={styles.rangeCaption}>
        <span>mild · low-end torque</span><span>wild · top-end power</span>
      </div>
      <ExpandableInfo title="What camshaft duration actually does">
        Duration is how long, in crank degrees, a valve stays open. Hold the intake valve open longer and at <b className={styles.em}>low RPM</b> some charge gets pushed back out during compression — you lose bottom end. But at <b className={styles.em}>high RPM</b> there is barely time to fill the cylinder at all, and that extra open time is exactly what keeps it breathing.
        <br /><br />So a bigger cam does not add power everywhere — it <i>moves</i> the power. Watch the VE table and the dyno curve: the peak slides up the RPM range and the low-RPM cells drop. This sandbox models it by sampling the breathing curve at a cam-shifted engine speed, which is the honest way to represent it.
        <br /><br /><b className={styles.em}>Overlap</b> is the window where both valves are open together. It grows with duration, and it is why cammed engines idle lumpy, pull weak manifold vacuum, and sound the way they do.
      </ExpandableInfo>

      <div className={styles.labelSpaced}>
        Valve Spring Rate: {engineConfig.springRate} <span className={styles.floatCaption} data-float={floating ? 'true' : 'false'}>· float at {Math.round(engineDerived.floatRpm)} RPM</span>
      </div>
      <input type="range" min={20} max={100} step={1} value={engineConfig.springRate} onChange={(e) => setCfg({ springRate: Number(e.target.value) })} className={styles.springSlider} data-float={floating ? 'true' : 'false'} />
      {floating && (
        <div className={styles.floatWarning}>
          Springs float below redline — cylinder filling collapses above {Math.round(engineDerived.floatRpm)} RPM. Stiffen them or fit a milder cam.
        </div>
      )}
      <ExpandableInfo title="Why springs decide how far a cam can go">
        The cam pushes the valve open; only the spring closes it. As RPM rises the valve has less and less time to follow the closing ramp, and past the spring's limit it stops following the lobe entirely — <b className={styles.em}>valve float</b>. The cylinder cannot fill, and power falls off a cliff rather than tapering.
        <br /><br />Bigger cams open valves further and faster, so they need stiffer springs. That is why "cam and springs" are sold together: fit an aggressive cam on stock springs and you will make <i>less</i> power than stock up top, because you float before you reach the RPM the cam was designed for.
        <br /><br />Stiffness is not free either — every cycle the engine compresses those springs, and that parasitic loss shows up in FMEP. Over-spring a mild cam and you simply lose a little power for nothing.
      </ExpandableInfo>

      <div className={styles.label}>Cam Phasers</div>
      <Seg label="Cam phasers" options={VVT_OPTS.map((o) => ({ id: o.id, label: o.label }))} value={engineConfig.vvt ?? 'none'} onChange={(v) => setCfg({ vvt: v })} equal />
      <ExpandableInfo title="What a cam phaser does — and what it does not">
        A phaser turns the camshaft against the crank with oil pressure, moving every event on that cam by the same angle. It does not change the lobe: duration and lift are the grind's. What it changes is <i>when</i> — and that is enough to move the torque curve, because the intake valve closing is what decides how much charge is trapped.
        <br /><br />Advance the intake and it closes earlier: at low speed the charge has no momentum to keep filling after bottom dead centre, so closing early traps more of it; at high speed it cuts the ramming short. Every move also changes overlap, and overlap decides how much burned gas stays in the cylinder. The targets live on <b className={styles.em}>TUNE › VVT</b>; parked at zero, a phased engine is exactly the fixed-cam one.
      </ExpandableInfo>

      <div className={styles.labelSpaced}>Fuel Injection</div>
      <Seg label="Fuel injection" options={INJECTION_OPTS} value={engineConfig.injection ?? 'port'} onChange={(v) => setCfg({ injection: v })} equal />
      <ExpandableInfo title="Port injection versus direct injection">
        <b className={styles.em}>Port injection</b> (multi-point manifold injection) puts one injector in each intake runner, aimed at the back of the intake valve. The fuel boils off that hot valve, so it cools the metal, not the air: the charge reaches the cylinder barely colder than it left the manifold. The Nissan VQs here are port-injected.
        <br /><br /><b className={styles.em}>Direct injection</b> sprays into the cylinder itself, at far higher pressure. The fuel takes its heat of evaporation from the air, and measured on the same engine that is about 14 °C colder on gasoline and 49 °C on E85. Colder air is denser, so more of it gets in (about 6% on gasoline here), and colder end gas takes longer to light itself, so the knock limit rises. That is how the BMW and VW turbo engines here run their compression under boost. There is no port wall for fuel to soak into, either, so a direct-injected engine needs far less acceleration enrichment.
        <br /><br />Swap one for the other and the fuel tables stay the engine&apos;s own: re-tune after the change, as you would on a real conversion.
      </ExpandableInfo>

      <div className={styles.labelSpaced}>Ignition</div>
      <Seg label="Ignition coils" options={COIL_OPTS.map((o) => ({ id: o.id, label: o.label }))} value={build.coil ?? 'stock'} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'coil', value: v })} equal />
      <div className={styles.labelSpaced}>Plug Gap</div>
      <Seg label="Spark plug gap" options={[0.6, 0.7, 0.8, 0.9, 1.0, 1.1].map((g) => ({ id: g, label: `${g.toFixed(1)} mm` }))} value={build.plugGapMm ?? 1.0} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'plugGapMm', value: Number(v) })} equal />
      <ExpandableInfo title="Why boosted engines close the plug gap">
        Before a spark can do anything, the gap has to break down — and the voltage that takes rises with the density of the gas across it. Boost and advance both mean denser gas at the plug when it fires. Past what the coil can make, some events never light: a misfire that feels like a stutter and costs power exactly where the engine is working hardest. A smaller gap, a longer dwell or a stronger coil all buy it back.
      </ExpandableInfo>

      <div className={styles.labelSpaced}>Block Material</div>
      <Seg label="Block Material" options={MATERIAL_OPTS.map((m) => ({ label: m, id: m }))} value={engineConfig.blockMaterial} onChange={(v) => setCfg({ blockMaterial: v })} />
      <div className={styles.labelSpaced}>Head Material</div>
      <Seg label="Head Material" options={MATERIAL_OPTS.map((m) => ({ label: m, id: m }))} value={engineConfig.headMaterial} onChange={(v) => setCfg({ headMaterial: v })} />
      <ExpandableInfo title="Why block and head material matter">
        Aluminum conducts heat roughly three times faster than cast iron, so an aluminum head pulls heat away from the combustion chamber faster — a real, measurable knock-margin benefit. Cast iron is heavier and a worse conductor, but stiffer under heat, which is part of why some high-output blocks still use it.
      </ExpandableInfo>
      <Note>Changing bore, stroke, or configuration does not retroactively rewrite your VE/timing/AFR tables — you will feel the shift on your next dyno pull and can re-tune from there, just like swapping a real short block.</Note>
      {/* RESET ALL TO STOCK sits with the preset picker because both set the WHOLE
          build to a known state — one to a factory engine, one to a generic stock
          baseline. It came off the dissolved BoltonsScreen, where it had lived only
          because bolt-ons were what it reset; it is not a bolt-on action and it is
          certainly not an exhaust one. */}
      <div className={styles.resetRow}>
        <Button variant="quiet" size="sm" onClick={onResetToStock}>
          <RotateCcw size={12} aria-hidden="true" /> RESET ALL TO STOCK
        </Button>
      </div>
    </BuildSection>
  );
}
