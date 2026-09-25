/**
 * DRAG — put the engine in a car and run a quarter mile.
 *
 * WHY THIS SCREEN EXISTS
 * Every other page in the app is about MAKING torque. This one is about what happens
 * to it next, and it is the only place the SHAPE of a powerband is worth more than its
 * peak: an engine that falls out of its band on every shift loses to a smaller one
 * that does not.
 *
 * NO PHYSICS IN HERE. Every number on screen comes out of `simulateDragRun`, which
 * solves the whole pass before the tree even goes green. The strip animation is a
 * replay of that solved run, so it cannot disagree with the time slip beside it. If
 * you find yourself doing vehicle dynamics in this file, it belongs in
 * `src/sim/drivetrain.js`.
 *
 * A DYNO PULL IS A HARD PREREQUISITE, and the screen says so rather than inventing a
 * torque curve to drive with. That is the same rule the rest of the app follows:
 * nothing is simulated until it has been measured.
 *
 * THE CONTROLS ARE NOT HANDICAPS. Mass, drag coefficient, frontal area, CG height,
 * wheelbase, static rear weight, ratios, μ and tyre diameter are each a term in an
 * equation that is already running. A van is slow because it is heavy, tall, boxy and
 * nose-heavy — not because it carries a penalty.
 */

import { Activity, Flag, Package, Settings } from 'lucide-react';
import React from 'react';

import {
  CAR_BODIES, DRIVETRAIN_OPTS, GEARBOX_OPTS, MPH_PER_MS, TIRE_GRIP, roadSpeedMs,
} from '../../../sim/index.js';
import { BuildSection } from '../../components/BuildSection.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';
import { Button } from '../../primitives/Button.jsx';
import { Eyebrow } from '../../primitives/Eyebrow.jsx';
import { Note } from '../../primitives/Note.jsx';
import { Panel } from '../../primitives/Panel.jsx';
import { Seg } from '../../primitives/Seg.jsx';
import { StatTile } from '../../primitives/StatTile.jsx';
import { ACTIONS } from '../../state/reducer.js';
import { useSession } from '../../state/StoreProvider.jsx';

import { DragStrip } from './DragStrip.jsx';

import styles from './DragScreen.module.css';

/**
 * Everything a time slip actually depends on, as one comparable string.
 *
 * The same defect the pull scores had (issue #29): a finished run's numbers stay on
 * screen while the setup underneath them changes, and nothing says so. Swap slicks for
 * street tyres and the slip still reads 10.2 at 140 — a time this car cannot run. The
 * fix here is the same one the score panels use: keep the evidence, label it, and let
 * the player decide when to re-run. `peakHp` stands in for the engine, because a new
 * pull is the only thing that changes the torque curve this run was driven with.
 *
 * @param {import('../../../sim/index.js').DragCar} car
 * @param {{peakHp: number}|null} result the dyno pull the run was driven from
 * @returns {string}
 */
export function dragSignature(car, result) {
  return [
    car.bodyIdx, car.gripIdx, car.driveIdx, car.boxIdx,
    car.gearCount, car.finalDrive, car.gears[0], car.tireDiameterIn,
    result ? result.peakHp : 'none',
  ].join('|');
}

/**
 * @param {object} props
 * @param {string|null} props.section which accordion section is open, or null
 * @param {(section: string) => void} props.onToggle opens or closes one
 * @param {object|null} props.result the last dyno pull, or null if there has not been one
 * @param {{redline: number}} props.engineDerived
 * @param {() => void} props.onRun starts the tree and then the run. The shell owns it:
 *   it needs the audio context (the tree beeps) and the playback clock, both of which
 *   live there alongside the dyno reveal's.
 * @returns {React.ReactElement}
 */
export function DragScreen({ section, onToggle, result, engineDerived, onRun }) {
  const [session, dispatch] = useSession();
  const { car, dragResult, dragRunning, dragT, treePhase, dragSetup } = session;

  /** @param {Partial<import('../../../sim/index.js').DragCar>} patch */
  const setCar = (patch) => dispatch({
    type: ACTIONS.SET_SESSION_FIELD, field: 'car', value: { ...car, ...patch },
  });

  const body = CAR_BODIES[car.bodyIdx];
  const grip = TIRE_GRIP[car.gripIdx];
  const drive = DRIVETRAIN_OPTS[car.driveIdx];
  const box = GEARBOX_OPTS[car.boxIdx];
  const topGear = car.gears[car.gearCount - 1];
  const firstMult = car.gears[0] * car.finalDrive;
  const stale = !!dragResult && dragSetup !== dragSignature(car, result);

  return (
    <>
      <Eyebrow icon={Flag}>Drag Strip</Eyebrow>
      <p className={styles.intro}>
        A torque curve is only half of acceleration. Gearing, tyre size, grip, weight transfer and
        aerodynamic drag decide what actually reaches the road — which is why the powerband&apos;s
        {' '}<i>shape</i> matters here and not just its peak.
      </p>

      {!result ? (
        <Note tone="warn">
          Run a dyno pull first — there is no torque curve to drive with until the engine has been
          measured.
        </Note>
      ) : (
        <>
          <DragStrip
            res={dragResult} tNow={dragT} running={dragRunning}
            treePhase={treePhase} bodyIdx={car.bodyIdx}
          />

          <Button block size="lg" onClick={onRun} disabled={dragRunning} className={styles.run}>
            {dragRunning ? 'RUNNING…' : 'RUN THE QUARTER MILE'}
          </Button>

          {dragResult && !dragRunning && (
            <Panel className={styles.slip}>
              <div className={styles.slipTitle}>TIME SLIP</div>
              {stale && (
                <Note tone="warn">
                  These are the last run&apos;s numbers, from before your latest change. The car
                  below is not the car that ran them — run it again to see what the change was
                  worth.
                </Note>
              )}
              {dragResult.finished ? (
                <>
                  <div className={styles.tiles}>
                    <StatTile label="1/4 MILE ET" value={dragResult.et.toFixed(2)} unit="s" tone="acc" />
                    <StatTile label="TRAP SPEED" value={dragResult.trapMph.toFixed(1)} unit="mph" tone="alt" />
                  </div>
                  <div className={styles.tiles}>
                    <StatTile label="60 FOOT" value={dragResult.sixtyFootT ? dragResult.sixtyFootT.toFixed(2) : '—'} unit="s" />
                    <StatTile label="0-60 MPH" value={dragResult.zeroToSixty ? dragResult.zeroToSixty.toFixed(2) : '—'} unit="s" />
                  </div>
                  <div className={styles.tiles}>
                    <StatTile label="1/8 MILE" value={dragResult.eighthET ? dragResult.eighthET.toFixed(2) : '—'} unit="s" />
                    <StatTile label="1/8 TRAP" value={dragResult.eighthMph ? dragResult.eighthMph.toFixed(1) : '—'} unit="mph" />
                    <StatTile label="GEARS" value={dragResult.topGearUsed} />
                  </div>
                </>
              ) : (
                <Note tone="warn">
                  The car never reached the stripe. With {result.peakHp} whp against{' '}
                  {Math.round(car.massKg)} kg it either has too little torque to overcome drag and
                  rolling resistance, or it spent the whole run spinning its tyres. Check the
                  wheelspin note below, then look at gearing.
                </Note>
              )}
              {dragResult.wheelspun && (
                <Note tone="warn">
                  Wheelspin off the line. The engine asked for more force than μ×N allowed, and
                  everything past that limit went into turning the tyres instead of the car. More
                  grip, more static weight over the driven axle, a taller first gear, or all-wheel
                  drive.
                </Note>
              )}
              <p className={styles.slipRead}>
                Read it in two halves. <b className={styles.em}>Trap speed</b> is a measure of power
                against drag, because at the far end aerodynamic resistance dominates and only
                sustained power holds speed against it. <b className={styles.em}>Sixty-foot time</b>{' '}
                is a measure of traction and launch. If the trap is high but the ET poor, the answer
                is grip and gearing, not more boost.
              </p>
            </Panel>
          )}

          <BuildSection
            active={section === 'body'} onClick={() => onToggle('body')}
            icon={Package} label="Car Body"
            sub={`${body.label} · ${body.massKg} kg · Cd ${body.cd.toFixed(2)}`}
          >
            <Seg
              label="Car body" equal
              options={CAR_BODIES.map((b, i) => ({ label: b.label, id: i }))}
              value={car.bodyIdx}
              onChange={(id) => { const i = Number(id); setCar({ bodyIdx: i, ...CAR_BODIES[i] }); }}
            />
            <div className={styles.note}>{body.note}</div>

            <div className={styles.tiles}>
              <StatTile label="MASS" value={body.massKg} unit="kg" />
              <StatTile label="Cd" value={body.cd.toFixed(2)} />
              <StatTile label="FRONTAL" value={body.frontalAreaM2.toFixed(2)} unit="m²" />
            </div>
            <div className={styles.tiles}>
              <StatTile label="CG HEIGHT" value={body.cgHeightM.toFixed(2)} unit="m" />
              <StatTile label="WHEELBASE" value={body.wheelbaseM.toFixed(2)} unit="m" />
              <StatTile label="REAR WEIGHT" value={Math.round(body.rearFrac * 100)} unit="%" />
            </div>

            <ExpandableInfo title="Why the same engine is not the same car">
              Nothing here is a handicap number — every figure is a term in an equation that is already running.
              <br /><br /><b className={styles.em}>Mass</b> divides straight into acceleration (a = F ÷ m). On top of the car's own mass, the engine and gearbox have to be spun up through the gearing, which acts like extra weight — most of all in first, where the ratio is highest.
              <br /><br /><b className={styles.em}>Cd × frontal area</b> is drag, and it grows with the square of speed. Almost nothing at the line, everything at the trap — which is why a van gives up far more trap speed than ET against a coupe.
              <br /><br /><b className={styles.em}>Centre of gravity height and wheelbase</b> set weight transfer, ΔN = m·a·h ÷ L. A tall van transfers more load rearward than a low supercar, which genuinely helps it hook up — one of the few things working in its favour.
              <br /><br /><b className={styles.em}>Static rear weight</b> is how much grip you start with before any transfer at all. A mid-engined supercar begins with 57% over the driven axle; a pickup has 38%.
            </ExpandableInfo>
          </BuildSection>

          <BuildSection
            active={section === 'gearing'} onClick={() => onToggle('gearing')}
            icon={Settings} label="Gearbox"
            sub={`${car.gearCount}-speed ${box.label} · ${car.finalDrive.toFixed(2)} final`}
          >
            <div className={styles.label}>Transmission</div>
            <Seg
              label="Transmission"
              options={GEARBOX_OPTS.map((o, i) => ({ label: o.label, id: i }))}
              value={car.boxIdx} onChange={(id) => setCar({ boxIdx: Number(id) })}
            />
            <div className={styles.note}>{box.note}</div>

            <div className={styles.label}>Number of gears: {car.gearCount}</div>
            <input
              type="range" min={4} max={car.gears.length} step={1} value={car.gearCount}
              aria-label="Number of gears" className={styles.slider}
              onChange={(e) => setCar({ gearCount: Number(e.target.value) })}
            />

            <div className={styles.label}>Final drive: {car.finalDrive.toFixed(2)}:1</div>
            <input
              type="range" min={2.8} max={4.8} step={0.05} value={car.finalDrive}
              aria-label="Final drive ratio" className={styles.slider}
              onChange={(e) => setCar({ finalDrive: Number(e.target.value) })}
            />
            <div className={styles.note}>Numerically higher multiplies torque but runs out of road speed sooner.</div>

            <div className={styles.label}>First gear: {car.gears[0].toFixed(2)}:1</div>
            <input
              type="range" min={2.4} max={4.6} step={0.05} value={car.gears[0]}
              aria-label="First gear ratio" className={styles.slider}
              onChange={(e) => {
                const gears = [...car.gears];
                gears[0] = Number(e.target.value);
                setCar({ gears });
              }}
            />

            <Panel tight className={styles.gearing}>
              <div className={styles.gearingTitle}>WHAT THIS GEARING DOES</div>
              <div>First gear multiplies torque <span className={styles.figure}>{firstMult.toFixed(1)}×</span></div>
              <div>Top gear multiplies torque <span className={styles.figure}>{(topGear * car.finalDrive).toFixed(2)}×</span></div>
              <div>Redline in first is <span className={styles.figure}>{(roadSpeedMs(engineDerived.redline, car.gears[0], car) * MPH_PER_MS).toFixed(0)} mph</span></div>
              <div>Redline in top is <span className={styles.figure}>{(roadSpeedMs(engineDerived.redline, topGear, car) * MPH_PER_MS).toFixed(0)} mph</span></div>
            </Panel>

            <ExpandableInfo title="How gearing multiplies torque">
              Every gear is a torque multiplier and a speed divider by exactly the same factor:
              <br /><br /><span className={styles.formula}>wheelTorque = engineTorque × gearRatio × finalDrive</span><br />
              <span className={styles.formula}>force = wheelTorque ÷ tyreRadius</span>
              <br /><br />So this box multiplies engine torque {firstMult.toFixed(1)}× in first before it reaches the tyre. That is why first gear lights the tyres and top gear cannot — the engine has not changed, the multiplication has.
              <br /><br />The cost is exact and unavoidable: the same ratio divides road speed by the same {firstMult.toFixed(1)}×, so you run out of revs almost immediately. Gearing never creates energy; it trades force against speed. Choosing ratios is really choosing where in the rev range you spend your time, and the answer is: as near peak torque as you can, as often as you can.
              <br /><br />There is a second cost that is easy to miss. The engine and gearbox have to be spun up as well as the car moved, and referred to the road that inertia scales with the <i>square</i> of the ratio — so a very short first gear carries a real weight penalty that a tall one does not.
            </ExpandableInfo>
          </BuildSection>

          <BuildSection
            active={section === 'tyres'} onClick={() => onToggle('tyres')}
            icon={Activity} label="Tyres &amp; Drive"
            sub={`${grip.label} · ${drive.label} · ${car.tireDiameterIn}in`}
          >
            <div className={styles.label}>Grip level</div>
            <Seg
              label="Grip level" equal
              options={TIRE_GRIP.map((o, i) => ({ label: o.label, id: i }))}
              value={car.gripIdx} onChange={(id) => setCar({ gripIdx: Number(id) })}
            />
            <div className={styles.note}>
              {grip.note} — coefficient of friction μ = {grip.mu.toFixed(2)}
            </div>

            <div className={styles.label}>Driven wheels</div>
            <Seg
              label="Driven wheels"
              options={DRIVETRAIN_OPTS.map((o, i) => ({ label: o.label, id: i }))}
              value={car.driveIdx} onChange={(id) => setCar({ driveIdx: Number(id) })}
            />
            <div className={styles.note}>{drive.note}</div>

            <div className={styles.label}>Tyre diameter: {car.tireDiameterIn} in</div>
            <input
              type="range" min={22} max={32} step={1} value={car.tireDiameterIn}
              aria-label="Tyre diameter in inches" className={styles.tyreSlider}
              onChange={(e) => setCar({ tireDiameterIn: Number(e.target.value) })}
            />
            <div className={styles.note}>A taller tyre is a longer lever against the engine — it acts like a numerically lower final drive, and raises the speed reached at any given RPM.</div>

            <ExpandableInfo title="Why grip is a hard ceiling on acceleration">
              However much torque you make, the tyre can only transmit what friction allows:
              <br /><br /><span className={styles.formula}>F_max = μ × N</span>
              <br /><br />μ is the coefficient of friction, N the load pressing the driven tyres onto the road. Typical values: street tyres 0.8–0.9, good summer tyres about 1.0, racing slicks 1.7–1.9, prepared drag surfaces higher again.
              <br /><br />Divide by mass and μ is directly a ceiling on acceleration in g. At μ = 0.85 the very best possible is 0.85 g <i>if every kilogram sat on the driven wheels</i> — and on a rear-drive car only about 47% does at rest. Past that point, more power simply makes smoke.
              <br /><br /><b className={styles.em}>Weight transfer is what rescues it.</b> Accelerating shifts load rearward by <span className={styles.formula}>ΔN = m × a × h ÷ L</span>, so grip grows with the very acceleration it enables. That is why a rear-drive car out-launches its static weight distribution, and why all-wheel drive wins anyway: it starts with all of it.
              <br /><br />There is one more consequence worth noticing, because it surprises people. When the tyre is the limit, a = μ·g·f ÷ (1 − μ·h/L) — the mass cancels out entirely. Adding weight to a car that is already spinning its tyres does not slow the launch at all. It slows everything after it.
            </ExpandableInfo>
          </BuildSection>
        </>
      )}
    </>
  );
}
