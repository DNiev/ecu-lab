/**
 * HOME > Taking It To A Real Car.
 *
 * What changes between this simulator and a real car on a real laptop: what the tables
 * are called in real software, the order a professional session runs in, why a real log
 * is messier than this app's, and what no simulator can teach. The reference build
 * (v4.8) carried these as a part of its Learn guide; they sit in their own section here
 * because they are about leaving the app rather than about what it computes, and
 * because Learn's articles are numbered in reading order and these are not a step in it.
 *
 * Constant markup and no store read, so it is memoised for the same reason LearnScreen
 * is: HOME re-renders with the live engine, and this has nothing to redraw.
 */

import { Car } from 'lucide-react';
import React from 'react';

import { BuildSection } from '../../components/BuildSection.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';

import styles from './LearnScreen.module.css';

/**
 * @param {object} props
 * @param {boolean} props.active whether this is HOME's open section
 * @param {(section: string) => void} props.onToggle opens or closes a HOME section
 * @returns {React.ReactElement}
 */
function RealCarScreenInner({ active, onToggle }) {
  return (
    <BuildSection
      active={active} onClick={() => onToggle('realcar')}
      icon={Car} label="Taking It To A Real Car"
      sub="Real software, a real session, a real log"
    >
      <div className={styles.intro}>The concepts here are universal. This is what changes when the engine is real.</div>

      <ExpandableInfo title="What the tables are called on real software">
        The concepts here are universal; only the names change. If you open a real title, this is the translation:
        <br /><br /><b className={styles.em}>Airflow</b> — HP Tuners and EFILive call it the <i>VE table</i> on RPM × MAP, exactly as here. COBB and EcuTek often expose <i>Load</i> or <i>Airmass</i>. UpRev on Nissan barely exposes VE at all; you correct airflow through the <i>MAF curve</i> (indexed by sensor voltage) plus the <i>K-fuel multiplier</i>. Different knob, same job: tell the ECU how much air is really there.
        <br /><br /><b className={styles.em}>Fuel target</b> — <i>Commanded AFR</i>, <i>AFR target</i>, <i>Lambda target</i>, or <i>Equivalence ratio</i> (which is 1/λ, so it reads inverted — check which one you have before you edit anything).
        <br /><br /><b className={styles.em}>Spark</b> — <i>Ignition timing</i>, <i>Spark advance</i>, or <i>Base spark</i>, usually with separate <i>knock retard</i> and <i>intake-air-temperature correction</i> tables layered on top. This app has them too: the corrections sit under the SPARK table on TUNE, and the dyno datalog and LIVE show each one's share.
        <br /><br /><b className={styles.em}>Injector scaling</b> — <i>Injector flow rate</i> (HP Tuners), <i>K-fuel multiplier</i> (UpRev), <i>injector constant</i> elsewhere. Always the first thing you change after a fuel system upgrade.
        <br /><br />If you can say what a table <i>does</i> physically, you can find it in any software in about five minutes. That is the transferable skill.
      </ExpandableInfo>

      <ExpandableInfo title="A real tuning session, in order">
        This is the sequence a professional follows. It is deliberately boring, because the boring order is what stops engines being destroyed.
        <br /><br /><b className={styles.em}>1. Verify the hardware before touching software.</b> Confirm what injectors, turbo, cam and fuel are actually fitted — not what the customer says. Check for boost and exhaust leaks. An exhaust leak upstream of the oxygen sensor makes a wideband read lean, and you will chase that error forever.
        <br /><br /><b className={styles.em}>2. Read and save the stock file.</b> Always keep an unmodified copy you can flash back to. Every tuner has needed this.
        <br /><br /><b className={styles.em}>3. Set scaling constants first.</b> Injector size, MAF housing, fuel pressure. These shift everything downstream, so doing them after you tune tables means redoing the tables.
        <br /><br /><b className={styles.em}>4. Get it idling and driving, safely rich.</b> Cold start, idle, light cruise. Nothing aggressive.
        <br /><br /><b className={styles.em}>5. Correct airflow before anything else.</b> Log, build the histogram, apply, re-log. Until the ECU knows how much air is present, every fuel and spark number you set is built on a wrong foundation.
        <br /><br /><b className={styles.em}>6. Set the fuel targets.</b> Now that airflow is right, the commanded mixture is actually delivered.
        <br /><br /><b className={styles.em}>7. Spark last, in small steps, on a dyno or a safe road.</b> Advance a couple of degrees, pull, check for knock, repeat. Stop when torque stops rising — that is MBT, and going past it is pure risk.
        <br /><br /><b className={styles.em}>8. Verify across conditions.</b> Hot engine, cold engine, high gear, low gear. A tune that is only safe on a cool dyno is not finished.
      </ExpandableInfo>

      <ExpandableInfo title="Reading a real log — it is messier than this one">
        The dyno datalog in this app is clean because the simulation is deterministic. A real log is not, and knowing the difference matters:
        <br /><br /><b className={styles.em}>Only trust steady-state cells.</b> During a fast transient the fuel film on the port walls and the sensor lag mean the wideband is reporting something that happened a moment ago. Professional software lets you filter for stable conditions; use it, and discard cells the engine only touched briefly.
        <br /><br /><b className={styles.em}>Widebands lag.</b> Typically 100–200 ms including transport time down the pipe. At 6000 RPM that is many combustion events. Align your log or accept the smear.
        <br /><br /><b className={styles.em}>Widebands lie when the exhaust leaks.</b> Any air drawn in ahead of the sensor reads as lean. If a correction seems impossibly large, suspect the plumbing before the calibration.
        <br /><br /><b className={styles.em}>Knock sensors hear other things.</b> Injector noise, valvetrain rattle and drivetrain clunks can all register as knock, particularly at high RPM. Real tuners correlate with an audio knock detector before pulling timing, rather than trusting the count blindly.
        <br /><br /><b className={styles.em}>One clean pull beats five rushed ones.</b> Let the engine cool between runs, watch coolant and intake temperatures, and stop if anything moves the wrong way.
      </ExpandableInfo>

      <ExpandableInfo title="What this simulator cannot teach you">
        Being straight with you, because a false sense of readiness is genuinely dangerous around engines.
        <br /><br />This app can give you the mental model: what the ECU calculates, why each table exists, how a change propagates to torque, and the diagnostic habit of reading a log before touching a number. That transfers completely and it is most of the theory.
        <br /><br />It cannot give you: the feel of a real dyno session, the sound of genuine detonation (a sharp metallic rattle you learn by hearing it next to someone experienced), the specific quirks of any individual platform, flashing procedure and the risk of bricking an ECU, or the judgement that comes from having seen an engine let go.
        <br /><br /><b className={styles.em}>So the honest advice:</b> use this to understand the physics thoroughly, then start on someone else's spare engine or a cheap car you can afford to lose, tune conservatively, and get a second opinion on your first few calibrations. The theory here is sound. The consequences of a mistake are not simulated.
      </ExpandableInfo>
    </BuildSection>
  );
}

export const RealCarScreen = React.memo(RealCarScreenInner);
