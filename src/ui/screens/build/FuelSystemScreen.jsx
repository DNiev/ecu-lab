/**
 * BUILD > Fuel System.
 *
 * What is physically FITTED: octane in the tank and the injectors bolted in. What
 * the ECU BELIEVES is fitted — the injector scaling it calculates pulse width
 * against — lives on TUNE > Injectors instead, deliberately: `RESCALE ECU TO
 * ###cc` exists precisely because hardware and calibration can disagree, and
 * splitting them across tabs is the honest depiction of that gap rather than two
 * controls sitting side by side pretending to be one setting.
 *
 * Relocated from TUNE > Injectors (originally `EcuScreen.jsx:65-74`) by the
 * BUILD/TUNE re-section; markup and dispatches unchanged.
 */

import { Fuel } from 'lucide-react';
import React from 'react';

import { DEFAULT_ECU_HW, INJECTOR_OPTS, LINEAR_SCALES, FUEL_CHOICES, PUMP_OPTS, REGULATOR_OPTS } from '../../../sim/index.js';
import { Toggle } from '../../primitives/Toggle.jsx';
import { BuildSection } from '../../components/BuildSection.jsx';
import { SetupNote } from '../../components/ecu/SetupNote.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { PickList } from '../../components/PickList.jsx';
import { Seg } from '../../primitives/Seg.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild } from '../../state/StoreProvider.jsx';

import styles from './FuelSystemScreen.module.css';

/**
 * @param {object} props
 * @param {boolean} props.active whether this is BUILD's open section
 * @param {(section: string) => void} props.onToggle opens or closes a BUILD section
 * @returns {React.ReactElement}
 */
export function FuelSystemScreen({ active, onToggle }) {
  const [build, dispatch] = useBuild();
  const { octaneIdx, injIdx } = build;
  const fuelSystem = build.fuelSystem ?? DEFAULT_ECU_HW.fuelSystem;
  const sensorHw = build.sensorHw ?? DEFAULT_ECU_HW.sensorHw;
  const flexTank = !!FUEL_CHOICES[octaneIdx].flex;
  const setFs = (patch) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'fuelSystem', value: { ...fuelSystem, ...patch } });
  const setSensors = (patch) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'sensorHw', value: { ...sensorHw, ...patch } });

  return (
    <BuildSection
      active={active} onClick={() => onToggle('fuel')}
      icon={Fuel} label="Fuel System"
      sub={`${flexTank ? `Flex E${Math.round(build.ethanolPct ?? 0)}` : FUEL_CHOICES[octaneIdx].label} · ${INJECTOR_OPTS[injIdx].label}`}
    >
      <div className={styles.label}>Fuel Octane</div>
      <Seg label="Fuel Octane" options={FUEL_CHOICES.map((o) => ({ label: o.label, id: o.label }))} value={FUEL_CHOICES[octaneIdx].label} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'octaneIdx', value: FUEL_CHOICES.findIndex((o) => o.label === v) })} />
      <SetupNote paths={['config.stoichMode']} />
      <ExpandableInfo title="What Fuel Octane actually does — and what E85 costs you">
        Octane measures a fuel's resistance to auto-igniting under heat and pressure before the spark fires it — not energy content or "power." Higher octane tolerates more cylinder pressure and temperature before knock, letting a tuner run more advance or more boost safely. It does not add power on its own; it raises the ceiling for how much timing/boost you can use before knock becomes the limit.
        <br /><br /><b className={styles.em}>E85 is not a free upgrade.</b> Its stoichiometric point is about 9.8:1, not gasoline's 14.7:1 — so hitting the same lambda takes roughly <b className={styles.emAcc}>1.43× the fuel volume</b>. Switch to E85 without upsizing injectors and you will run out of duty cycle long before you cash in that knock margin. Watch the duty preview on <b className={styles.em}>TUNE &rsaquo; Injectors</b> change the moment you select it.
        <br /><br />That trade — huge knock resistance, huge fuel demand — is exactly why serious E85 builds pair it with bigger injectors and a bigger pump, and why "just run E85" is not a shortcut around a fuel system.
      </ExpandableInfo>

      {flexTank && (
        <>
          <div className={styles.labelSpaced}>Ethanol in the tank: E{Math.round(build.ethanolPct ?? 0)}</div>
          <input type="range" min={0} max={85} step={1} value={build.ethanolPct ?? 0} aria-label="Ethanol content in the tank"
            className={styles.slider}
            onChange={(e) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'ethanolPct', value: Number(e.target.value) })} />
          <Toggle label="Ethanol content sensor" sub="Tells the ECU what blend is actually in the tank — needed for flex fuelling on TUNE › FUEL"
            checked={!!sensorHw.flex} onChange={(v) => setSensors({ flex: v })} />
          <SetupNote paths={['config.flexEnabled']} okText="The ECU reads this sensor and fuels for the blend it measures." />
        </>
      )}

      <div className={styles.labelSpaced}>Fuel Injectors</div>
      <PickList options={INJECTOR_OPTS.map((o) => ({ label: o.label, value: o.label }))} value={INJECTOR_OPTS[injIdx].label} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'injIdx', value: INJECTOR_OPTS.findIndex((o) => o.label === v) })} />

      <div className={styles.labelSpaced}>Fuel Pump</div>
      <PickList options={PUMP_OPTS.map((o) => ({ label: o.label, value: o.id }))} value={PUMP_OPTS[fuelSystem.pumpIdx]?.id} onChange={(v) => setFs({ pumpIdx: PUMP_OPTS.findIndex((o) => o.id === v) })} />
      <div className={styles.labelSpaced}>Pressure Regulation</div>
      <Seg label="Pressure regulation" options={REGULATOR_OPTS.map((o) => ({ id: o.id, label: o.label }))} value={fuelSystem.regulator} onChange={(v) => setFs({ regulator: v })} equal />
      <SetupNote paths={['injector.pressureComp']} />
      <div className={styles.labelSpaced}>Base Fuel Pressure</div>
      <Seg label="Base fuel pressure" options={[250, 300, 350, 400].map((k) => ({ id: k, label: `${(k / 6.895).toFixed(0)} psi` }))} value={fuelSystem.basePressureKpa} onChange={(v) => setFs({ basePressureKpa: Number(v) })} equal />
      <ExpandableInfo title="Pump, regulator and why pressure is fuel">
        An injector is a calibrated hole: it passes fuel as the <b className={styles.em}>square root of the pressure across it</b>. Its flow rating is only true at the pressure it was measured at — 3 bar, 43.5 psi.
        <br /><br />A <b className={styles.em}>return-style</b> regulator references the intake manifold, so rail pressure rises one-for-one with boost and the pressure across the injector never changes. A <b className={styles.em}>returnless</b> rail is held a fixed amount above atmosphere, so at 20 psi of boost a 43 psi rail has only 23 psi left to push with — the injector flows about a quarter less, unless the ECU compensates (TUNE › INJECTORS).
        <br /><br />The pump has to keep up with all of it. Past its capacity at the pressure it is working against, rail pressure sags and every cylinder leans together — the classic "it was fine until 6000 RPM on E85".
      </ExpandableInfo>

      <div className={styles.labelSpaced}>Wideband Controller</div>
      <Seg label="Wideband controller" options={Object.entries(LINEAR_SCALES.wideband).map(([id, s]) => ({ id, label: s.short ?? s.label }))} value={sensorHw.wideband} onChange={(v) => setSensors({ wideband: v })} equal />
      <SetupNote paths={['sensors.wideband']} okText="The ECU is set up for this sensor." />
    </BuildSection>
  );
}
