/**
 * The shop, drawn: a side-on cutaway of the garage, with the tuner in it.
 *
 * It is the career's home screen, so it shows the career: every lift you own, every car
 * on one, the dyno once you have bought it, the tools on the bench, the sign, the
 * lounge, and a third bay once the shop has grown. Customers drive in from the street
 * and the finished car drives out again. Everything is plain SVG shapes, animated with
 * CSS, and none of it moves for a reader who has asked for reduced motion.
 */

import React from 'react';

import { shop as P } from '../tokens.js';

import { jobById } from './jobs.js';
import { capacity } from './shop.js';
import styles from './ShopScene.module.css';

const FLOOR = 262;
/** Where each bay's car sits, left edge. */
const BAY_X = [196, 420, 790];

/**
 * A car, side on, nose to the right.
 * @param {{color: string, body?: string}} props
 */
function Car({ color, body = 'coupe' }) {
  const paint = P.paint[color] ?? P.paint.silver;
  const roof = body === 'sedan'
    ? 'M44 30 L66 12 L128 12 L150 30 Z'
    : body === 'hatch' ? 'M40 30 L62 10 L146 10 L154 30 Z' : 'M50 30 L78 11 L122 11 L152 30 Z';
  return (
    <g>
      <path d="M8 44 Q10 30 34 29 L160 28 Q182 30 186 42 L186 50 Q186 56 178 56 L14 56 Q6 56 8 48 Z" fill={paint} stroke={P.outline} strokeWidth="1.5" />
      <path d={roof} fill={paint} stroke={P.outline} strokeWidth="1.5" />
      <path d={roof} fill={P.glass} transform="translate(6 3) scale(0.94)" />
      <rect x="170" y="38" width="12" height="5" rx="2" fill={P.headlight} />
      <rect x="10" y="38" width="8" height="5" rx="2" fill={P.taillight} />
      {[42, 146].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="56" r="14" fill={P.tyre} />
          <circle cx={cx} cy="56" r="7" fill={P.hub} />
        </g>
      ))}
    </g>
  );
}

/**
 * The tuner, or a customer.
 * @param {{shirt: string, cap?: boolean, className?: string}} props
 */
function Person({ shirt, cap = false, className }) {
  return (
    <g className={className}>
      <circle cx="0" cy="-58" r="9" fill={P.skin} />
      {cap && <path d="M-10 -61 Q0 -73 10 -61 L14 -60 L-10 -60 Z" fill="var(--acc)" />}
      <rect x="-10" y="-48" width="20" height="28" rx="6" fill={P.paint[shirt] ?? shirt} />
      <rect x="-9" y="-20" width="8" height="20" rx="3" fill={P.trousers} />
      <rect x="1" y="-20" width="8" height="20" rx="3" fill={P.trousers} />
    </g>
  );
}

/** A two-post lift, raised or not. @param {{x: number, up: boolean}} props */
function Lift({ x, up }) {
  const armY = up ? FLOOR - 40 : FLOOR - 16;
  return (
    <g>
      <rect x={x - 10} y={FLOOR - 150} width="8" height="150" fill={P.steel} />
      <rect x={x + 190} y={FLOOR - 150} width="8" height="150" fill={P.steel} />
      <rect x={x - 12} y={FLOOR - 152} width="220" height="6" fill={P.steelHi} />
      <rect x={x - 2} y={armY} width="36" height="5" rx="2" fill={P.liftArm} className={styles.arm} />
      <rect x={x + 156} y={armY} width="36" height="5" rx="2" fill={P.liftArm} className={styles.arm} />
    </g>
  );
}

/**
 * @param {object} props
 * @param {import('./shop.js').Career} props.career
 * @param {string|null} [props.arriving] the job whose car is driving in right now
 * @param {{color: string, body?: string}|null} [props.departing] the car driving home right now
 * @param {{text: string, shirt: string}|null} [props.speech] a customer at the door, talking
 * @returns {React.ReactElement}
 */
export function ShopScene({ career, arriving = null, departing = null, speech = null }) {
  const owned = new Set(career.owned);
  const bays = capacity(career);
  const width = owned.has('expansion') ? 980 : 800;
  const workingBay = career.lifts.findIndex((l) => l.jobId === career.working);
  const tunerX = workingBay >= 0 ? BAY_X[workingBay] + 232 : 680;

  return (
    <div className={styles.wrap}>
      <svg className={styles.scene} viewBox={`0 0 ${width} 300`} role="img" aria-label={`Your shop: ${bays} ${bays === 1 ? 'bay' : 'bays'}, ${career.lifts.length} customer ${career.lifts.length === 1 ? 'car' : 'cars'} in${owned.has('dyno') ? ', a dyno' : ''}`}>
        {/* Sky, street and pavement. */}
        <rect x="0" y="0" width={width} height="300" fill="var(--bg)" />
        <rect x="0" y={FLOOR} width={width} height="38" fill={P.road} />
        <rect x="0" y={FLOOR + 14} width="170" height="3" fill={P.roadLine} strokeDasharray="12 10" />
        {/* The building, cut away. */}
        <rect x="170" y="40" width={width - 185} height={FLOOR - 40} fill="var(--panel)" stroke="var(--line-hi)" strokeWidth="2" />
        <rect x="170" y="28" width={width - 185} height="14" fill={P.fascia} />
        {owned.has('sign') ? (
          <text x={170 + (width - 185) / 2} y="23" textAnchor="middle" className={styles.neon} fill={P.neon} style={{ filter: `drop-shadow(0 0 4px ${P.neon})` }}>TUNING</text>
        ) : (
          <text x={170 + (width - 185) / 2} y="23" textAnchor="middle" className={styles.plainSign}>tuning shop</text>
        )}
        {/* Roll-up door opening and its rolled-up door. */}
        <rect x="166" y="96" width="10" height={FLOOR - 96} fill={P.fixture} />
        <rect x="164" y="90" width="18" height="10" rx="3" fill={P.steel} />
        {/* Shelves and posters on the back wall. */}
        <rect x="200" y="60" width="120" height="6" fill={P.fixture} />
        <rect x="206" y="44" width="16" height="16" fill={P.boxRed} /><rect x="228" y="48" width="12" height="12" fill={P.boxBlue} /><rect x="246" y="46" width="20" height="14" fill={P.boxGrey} />
        <rect x="450" y="52" width="46" height="34" fill={P.device} stroke={P.fixture} /><text x="473" y="73" textAnchor="middle" className={styles.poster}>λ 0.87</text>
        {/* Bays and lifts. */}
        <Lift x={BAY_X[0]} up={workingBay === 0} />
        {bays >= 2 ? <Lift x={BAY_X[1]} up={workingBay === 1} /> : (
          <text x={BAY_X[1] + 94} y={FLOOR - 60} textAnchor="middle" className={styles.hint}>room for a second lift</text>
        )}
        {owned.has('expansion') && <Lift x={BAY_X[2]} up={workingBay === 2} />}
        {/* The dyno: rollers in the floor of bay one, and the cooling fan. */}
        {owned.has('dyno') && (
          <g>
            <rect x={BAY_X[0] + 20} y={FLOOR - 4} width="60" height="8" rx="4" fill={P.roller} className={styles.roller} />
            <rect x={BAY_X[0] + 116} y={FLOOR - 4} width="60" height="8" rx="4" fill={P.roller} className={styles.roller} />
            <g transform={`translate(${BAY_X[0] + 212} ${FLOOR - 60})`}>
              <rect x="-4" y="30" width="8" height="30" fill={P.steel} />
              <circle r="26" fill={P.device} stroke={P.steel} strokeWidth="3" />
              <g className={styles.fan}><path d="M0 0 L0 -22 L6 -4 Z M0 0 L22 0 L4 6 Z M0 0 L0 22 L-6 4 Z M0 0 L-22 0 L-4 -6 Z" fill={P.hub} /></g>
            </g>
          </g>
        )}
        {/* Customer cars on the lifts. */}
        {career.lifts.map((l, i) => {
          const job = jobById(l.jobId);
          const up = i === workingBay;
          return (
            <g key={l.jobId} transform={`translate(${BAY_X[i]} ${FLOOR - 56 - (up ? 24 : 0)})`}>
              <g className={l.jobId === arriving ? styles.arriving : undefined}>
                <Car color={job.customer.color} body={job.customer.body} />
              </g>
            </g>
          );
        })}
        {departing && (
          <g transform={`translate(${BAY_X[0]} ${FLOOR - 56})`}>
            <g className={styles.departing}><Car color={departing.color} body={departing.body} /></g>
          </g>
        )}
        {/* The bench: the wideband, and whatever else the shop has bought. */}
        <g transform={`translate(${owned.has('expansion') ? 640 : 640} ${FLOOR - 60})`}>
          <rect x="0" y="0" width="120" height="8" fill={P.benchTop} />
          <rect x="6" y="8" width="6" height="52" fill={P.benchLeg} /><rect x="108" y="8" width="6" height="52" fill={P.benchLeg} />
          <g transform="translate(10 -18)"><rect width="22" height="18" rx="3" fill={P.device} /><circle cx="11" cy="9" r="6" fill="none" stroke="var(--cyan)" strokeWidth="2" /></g>
          {owned.has('egt') && <g transform="translate(40 -14)"><rect width="26" height="14" rx="2" fill={P.egtKit} /><path d="M26 4 Q40 -10 48 6" stroke={P.probeWire} fill="none" /></g>}
          {owned.has('flex') && <g transform="translate(76 -16)"><rect width="16" height="16" rx="2" fill={P.flexKit} /><rect x="3" y="3" width="10" height="5" fill={P.flexScreen} /></g>}
        </g>
        {/* The lounge. */}
        {owned.has('lounge') && (
          <g transform={`translate(${owned.has('expansion') ? 690 : 700} ${FLOOR - 36})`}>
            <rect x="-60" y="10" width="54" height="22" rx="6" fill={P.couch} />
            <rect x="-60" y="0" width="12" height="32" rx="5" fill={P.couchBack} />
            <rect x="4" y="4" width="14" height="28" fill={P.fixture} /><rect x="6" y="8" width="10" height="6" fill={P.lamp} />
          </g>
        )}
        {/* The tuner, at the laptop by the car being worked on. */}
        <g transform={`translate(${Math.min(tunerX, width - 70)} ${FLOOR})`}>
          <g transform="translate(-30 -58)">
            <rect x="0" y="36" width="34" height="22" fill={P.fixture} />
            <rect x="2" y="18" width="30" height="18" rx="2" fill={P.laptop} />
            <rect x="4" y="20" width="26" height="14" fill={workingBay >= 0 ? 'var(--acc)' : P.fascia} className={workingBay >= 0 ? styles.screen : undefined} />
          </g>
          <Person shirt={P.tunerShirt} cap className={styles.tuner} />
        </g>
        {/* A customer at the door. */}
        {speech && (
          <g className={styles.customer}>
            <g transform={`translate(150 ${FLOOR})`}><Person shirt={speech.shirt} /></g>
          </g>
        )}
      </svg>
      {/* What they say: HTML over the drawing rather than inside it, so it is the same
          readable size at every screen width while the drawing scales. */}
      {speech && <div className={styles.bubble} role="status">{speech.text}</div>}
    </div>
  );
}
