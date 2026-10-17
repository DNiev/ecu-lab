/**
 * TUNE > Injectors (ECU-side fuel calibration: injector scaling and duty cycle).
 *
 * Fuel octane and the physical injector choice moved to BUILD > Fuel System — what
 * is FITTED lives there now. This screen keeps what the ECU BELIEVES is fitted (the
 * scaling `Seg`, RESCALE) and what that belief costs at the injector (duty preview).
 *
 * `dutyPreview` and `injectorCc` are the shell's rather than this screen's own: both
 * feed the score breakdown and the dyno payload too, so the shell keeps owning them.
 * `fuel`, by contrast, is a pure lookup off `octaneIdx` — which this screen no longer
 * has a control for, but still reads from the store for the duty panel's E85 stoich
 * note — so it is derived here rather than threaded down as its own prop.
 * `dutyDangerous` has exactly one reader — this screen's duty panel — so it is
 * computed here too, off the shared `dutyPreview`, rather than threaded down as its
 * own prop.
 */

import React from 'react';

import { Fuel } from 'lucide-react';

import { INJECTOR_OPTS, FUEL_CHOICES } from '../../../sim/index.js';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { Bar } from '../../primitives/Bar.jsx';
import { Button } from '../../primitives/Button.jsx';
import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { Note } from '../../primitives/Note.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { Seg } from '../../primitives/Seg.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useBuild } from '../../state/StoreProvider.jsx';
import { T, utilisationColor } from '../../theme.js';

import styles from './InjectorsScreen.module.css';

/**
 * @param {object} props
 * @param {number} props.dutyPreview injector duty at WOT/6500rpm — the shell's,
 *   also read by the score breakdown and dyno payload
 * @param {number} props.injectorCc the shell's — `INJECTOR_OPTS[injIdx].cc`, also
 *   read by the same computations as `dutyPreview`
 * @param {React.ReactNode} [props.children] the engine management settings that belong
 *   with this screen, shown under it
 * @returns {React.ReactElement}
 */
export function InjectorsScreen({ dutyPreview, injectorCc, children }) {
  const [build, dispatch] = useBuild();
  const { turboOn, octaneIdx, ecuInjectorCc } = build;
  const fuel = FUEL_CHOICES[octaneIdx];
  const dutyDangerous = utilisationColor(dutyPreview) === T.danger;

  return (
    <div className={styles.wrap}>
      <Eyebrow icon={Fuel}>Injectors</Eyebrow>
      {!turboOn && <Note>Naturally aspirated — no turbo installed. Add one on <b>BUILD</b> if you want boost to tune around.</Note>}
      {turboOn && <Note>Turbo hardware, fuel octane and physical injectors live on <b>BUILD</b> — this tab is ECU-side fuel calibration: injector scaling and duty cycle.</Note>}

      <div className={styles.label}>
        ECU Injector Scaling <span className={styles.subLabel}>— what the ECU thinks is fitted</span>
      </div>
      <Seg label="ECU Injector Scaling" options={INJECTOR_OPTS.map((o) => ({ label: `${o.cc}`, id: o.cc }))} value={ecuInjectorCc} onChange={(v) => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'ecuInjectorCc', value: v })} equal />
      {ecuInjectorCc !== injectorCc ? (
        <div className={styles.mismatchBanner}>
          <b>Scaling mismatch.</b> Hardware is {injectorCc}cc but the ECU is calibrated for {ecuInjectorCc}cc — every pulse delivers about {((injectorCc / ecuInjectorCc) * 100).toFixed(0)}% of the intended fuel, so the engine runs {injectorCc > ecuInjectorCc ? 'far too rich' : 'dangerously lean'} everywhere.
          {/* The wrapper, not the button, is what breaks the line: the button
              sits inside a paragraph and is inline-flex, so without a block
              parent it would run on from the end of the warning text. */}
          <div className={styles.mismatchAction}>
            <Button onClick={() => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field: 'ecuInjectorCc', value: injectorCc })}>
              RESCALE ECU TO {injectorCc}cc
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.matchNote}>ECU scaling matches the fitted injectors.</div>
      )}
      <ExpandableInfo title="Injector scaling — the step everyone forgets">
        The ECU never commands "fuel" — it commands a pulse width, calculated for the injector size it has been <i>told</i> is fitted. Bolt in bigger injectors without updating that number and every pulse delivers proportionally more fuel than intended, so the engine runs rich everywhere regardless of what your AFR table says.
        <br /><br />Every real tuning platform has this constant: UpRev calls it the <b className={styles.em}>K-fuel multiplier</b> (lower it for bigger injectors), HP Tuners calls it <b className={styles.em}>injector flow rate</b>. It is the first thing you change after a fuel system upgrade, before touching any table.
      </ExpandableInfo>

      <ExpandableInfo title="Why injector duty cycle limits everything">
        Injectors flow a rated amount of fuel, and the ECU controls delivery by varying how long each stays open per cycle. As RPM and airflow rise, more fuel is needed in less time, and eventually the injector is open almost the whole cycle — that is duty cycle nearing 100%. Past about 90%, there is no more room to add fuel even if the AFR table calls for it, so the mixture leans out on its own regardless of what you commanded.
      </ExpandableInfo>

      <Panel tight className={styles.dutyPanel} data-tour="inj-duty">
        <div className={styles.dutyHead}>
          <div className={styles.dutyHeadLabel}>INJECTOR DUTY PREVIEW · WOT @ 6500 RPM</div>
          {fuel.stoich < 14 && <div className={styles.dutyFuelNote}>{fuel.label} stoich {fuel.stoich}:1</div>}
        </div>
        <div className={styles.dutyBarWrap}>
          <Bar label="Duty" value={dutyPreview} higherIsBetter={false} />
        </div>
        {/* The figure itself is the Bar's, now that it has a label row of its own —
            restating it here put the same number on screen twice, seven pixels
            apart. What is left is the part the Bar cannot say: what an undersized
            injector is about to do to the mixture. */}
        {dutyDangerous && (
          <div className={styles.dutyWarning}>
            Undersized for this build — expect forced lean-out
          </div>
        )}
      </Panel>
      {children}
    </div>
  );
}
