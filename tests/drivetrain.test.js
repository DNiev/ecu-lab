/**
 * Drivetrain and drag strip intent tests.
 *
 * Same rule as `physics.test.js`: assert on DIRECTION and RELATIONSHIP, never on
 * exact magnitudes. "A lighter car is quicker" is a claim about the model; "it runs
 * 13.42" is a claim about today's coefficients, and belongs to the fingerprint.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

/**
 * A flat torque curve, so a test can change one vehicle property and be sure the
 * engine is not what moved. Shaped like a `simulateSweep` result: lb-ft, wheels.
 */
const flatCurve = (crankNm) => S.torqueCurveFromSweep({
  points: Array.from({ length: 61 }, (_, i) => ({ rpm: 1500 + i * 100, torque: crankNm * 0.7376 })),
});

const MID = flatCurve(300);

/** Runs the quarter mile with the default car, overridden per test. */
function run(over = {}, torqueCurveNm = MID) {
  return S.simulateDragRun({
    car: { ...S.DEFAULT_CAR, ...over },
    torqueCurveNm, redline: 7500, displacementL: 3.5,
  });
}

/** Applies a body's own physical properties, the way the BUILD screen does. */
const body = (i) => ({ bodyIdx: i, ...S.CAR_BODIES[i] });

describe('the run itself', () => {
  it('covers the full quarter mile and reports a finite time', () => {
    const r = run();
    expect(r.finished).toBe(true);
    expect(r.et).toBeGreaterThan(0);
    expect(Number.isFinite(r.et)).toBe(true);
  });

  it('reaches every interval in order — 60 foot, eighth, then the quarter', () => {
    const r = run();
    expect(r.sixtyFootT).toBeLessThan(r.eighthET);
    expect(r.eighthET).toBeLessThan(r.et);
    expect(r.eighthMph).toBeLessThan(r.trapMph);
  });

  it('never produces NaN anywhere in the trace', () => {
    const r = run({ gripIdx: 3 }, flatCurve(900));
    const numbers = r.trace.flatMap((p) => Object.values(p).filter((x) => typeof x === 'number'));
    expect(numbers.every(Number.isFinite)).toBe(true);
  });

  it('gives up rather than looping forever on an engine that cannot move the car', () => {
    const r = S.simulateDragRun({ car: { ...S.DEFAULT_CAR }, torqueCurveNm: () => 0, redline: 7500 });
    expect(r.finished).toBe(false);
    expect(r.et).toBeLessThan(S.DRAG_TIMEOUT_S + S.DRAG_STEP_S);
  });

  it('is deterministic — the same car and curve run the same time twice', () => {
    expect(run().et).toBe(run().et);
  });
});

describe('mass and aerodynamics', () => {
  it('makes a heavier car slower', () => {
    expect(run({ massKg: 2100 }).et).toBeGreaterThan(run({ massKg: 1400 }).et);
  });

  it('charges aerodynamic drag at the stripe and hardly at all off the line', () => {
    // F_aero rises with the SQUARE of speed, so it is nearly nothing at walking pace
    // and everything at the traps. Mass, by contrast, is felt from the moment the
    // car moves — which is why trap speed is a measure of power against drag while
    // the 60-foot time is a measure of traction.
    const base = run();
    const draggy = run({ cd: S.DEFAULT_CAR.cd * 2, frontalAreaM2: S.DEFAULT_CAR.frontalAreaM2 * 2 });
    const heavy = run({ massKg: S.DEFAULT_CAR.massKg * 1.3 });

    expect(draggy.trapMph).toBeLessThan(base.trapMph);
    expect(draggy.sixtyFootT - base.sixtyFootT).toBeLessThan(0.02);
    expect(heavy.et - base.et).toBeGreaterThan(0.2);
  });

  it('makes a traction-limited launch independent of mass', () => {
    // A genuine and slightly counter-intuitive result. When the tyre is the limit,
    // a = μN/m, and N is itself m·g·f plus the transfer term m·a·h/L — so every term
    // carries the mass and it cancels out entirely:
    //     a = μ·g·f ÷ (1 − μ·h/L)
    // Adding weight to a car that is already spinning its tyres off the line does not
    // slow the launch at all. It slows everything after it, once the tyre stops being
    // what is holding the car back.
    // Torque well past what the tyre can hold, so both cars are unambiguously
    // traction-limited for the whole 60 feet and nothing else is deciding the launch.
    const light = run({ gripIdx: 0, massKg: 1400 }, flatCurve(2000));
    const heavy = run({ gripIdx: 0, massKg: 2400 }, flatCurve(2000));
    const spinFrac = (r) => {
      const launch = r.trace.filter((p) => p.x < S.SIXTY_FEET_M);
      return launch.filter((p) => p.spinning).length / launch.length;
    };
    expect(spinFrac(light)).toBeGreaterThan(0.9);
    expect(spinFrac(heavy)).toBeGreaterThan(0.9);
    expect(Math.abs(heavy.sixtyFootT - light.sixtyFootT)).toBeLessThan(S.DRAG_STEP_S * 3);
    // The cancellation is exact only in the traction-limited terms. It is the engine
    // -limited regime — where a = F ÷ (m + m_rotating) — that makes weight tell, which
    // is why the ordinary case above still has the heavier car losing.
    expect(run({ massKg: 2100 }).et).toBeGreaterThan(run({ massKg: 1400 }).et);
  });

  it('makes the truck slower than the coupe on every measure', () => {
    const coupe = run(body(0));
    const truck = run(body(4));
    expect(truck.et).toBeGreaterThan(coupe.et);
    expect(truck.trapMph).toBeLessThan(coupe.trapMph);
  });

  it('makes rolling resistance cost time', () => {
    expect(run({ crr: 0.03 }).et).toBeGreaterThan(run({ crr: 0.008 }).et);
  });
});

describe('grip', () => {
  it('makes a stickier tyre quicker off the line', () => {
    expect(run({ gripIdx: 3 }).sixtyFootT).toBeLessThan(run({ gripIdx: 0 }).sixtyFootT);
  });

  it('spins the tyres when there is more torque than grip, and not when there is not', () => {
    expect(run({ gripIdx: 0 }, flatCurve(900)).wheelspun).toBe(true);
    expect(run({ gripIdx: 3 }, flatCurve(120)).wheelspun).toBe(false);
  });

  it('barely improves a car that was never traction limited', () => {
    // With a small engine on sticky tyres, more grip has nothing left to give: the
    // limit is the engine, and grip is not a power adder.
    const sport = run({ gripIdx: 1 }, flatCurve(120));
    const drag = run({ gripIdx: 3 }, flatCurve(120));
    expect(Math.abs(drag.et - sport.et)).toBeLessThan(0.05);
  });

  it('turns power the tyre cannot hold into wheelspin rather than speed', () => {
    // Triple the torque on a street tyre and the car gets slower, not faster — the
    // surplus goes into spinning the tyre instead of into the road.
    expect(run({ gripIdx: 0 }, flatCurve(900)).et)
      .toBeGreaterThan(run({ gripIdx: 0 }, flatCurve(300)).et);
  });

  it('lets the engine run away from road speed once the tyre breaks loose', () => {
    const r = run({ gripIdx: 0 }, flatCurve(900));
    const spun = r.trace.filter((p) => p.spinning);
    expect(spun.length).toBeGreaterThan(0);
    // Engine speed climbs past what the gearing implies for the car's actual speed —
    // which is what puts a spinning car on the limiter with the speedometer barely
    // moving.
    const worst = spun.reduce((a, b) => (b.rpm - S.gearedRpm(b.v, S.DEFAULT_CAR.gears[b.gear - 1], S.DEFAULT_CAR)
      > a.rpm - S.gearedRpm(a.v, S.DEFAULT_CAR.gears[a.gear - 1], S.DEFAULT_CAR) ? b : a));
    expect(worst.rpm).toBeGreaterThan(S.gearedRpm(worst.v, S.DEFAULT_CAR.gears[worst.gear - 1], S.DEFAULT_CAR));
  });

  it('never lets the engine exceed the rev limiter by more than its hysteresis band', () => {
    const r = run({ gripIdx: 0 }, flatCurve(900));
    const maxRpm = Math.max(...r.trace.map((p) => p.rpm));
    expect(maxRpm).toBeLessThan(7500 + S.COEFF.LIMITER_RESTORE_BAND_RPM);
  });
});

describe('weight transfer and driven wheels', () => {
  it('helps all-wheel drive most when grip is the limit, and not at all when it is not', () => {
    const street = run({ gripIdx: 0 }, flatCurve(900));
    const streetAwd = run({ gripIdx: 0, driveIdx: 1 }, flatCurve(900));
    expect(streetAwd.et).toBeLessThan(street.et);

    const stickyRwd = run({ gripIdx: 3 }, flatCurve(120));
    const stickyAwd = run({ gripIdx: 3, driveIdx: 1 }, flatCurve(120));
    expect(Math.abs(stickyAwd.et - stickyRwd.et)).toBeLessThan(0.05);
  });

  it('launches a rear-drive car better with more static weight over the driven axle', () => {
    const nose = run({ gripIdx: 0, rearFrac: 0.38 }, flatCurve(900));
    const tail = run({ gripIdx: 0, rearFrac: 0.57 }, flatCurve(900));
    expect(tail.sixtyFootT).toBeLessThan(nose.sixtyFootT);
  });

  it('helps a traction-limited rear-drive launch to sit the weight higher', () => {
    // ΔN = m·a·h/L, so a taller centre of gravity transfers more load rearward. It is
    // one of the few things that genuinely works in a tall vehicle's favour.
    const low = run({ gripIdx: 0, cgHeightM: 0.40 }, flatCurve(900));
    const high = run({ gripIdx: 0, cgHeightM: 0.80 }, flatCurve(900));
    expect(high.sixtyFootT).toBeLessThan(low.sixtyFootT);
  });

  it('resists that transfer with a longer wheelbase', () => {
    const short = run({ gripIdx: 0, wheelbaseM: 2.4 }, flatCurve(900));
    const long = run({ gripIdx: 0, wheelbaseM: 3.6 }, flatCurve(900));
    expect(long.sixtyFootT).toBeGreaterThan(short.sixtyFootT);
  });
});

describe('gearing', () => {
  it('multiplies torque and divides road speed by exactly the same ratio', () => {
    const car = { ...S.DEFAULT_CAR };
    const v = S.roadSpeedMs(6000, car.gears[0], car);
    expect(S.gearedRpm(v, car.gears[0], car)).toBeCloseTo(6000, 6);
    // Halving the ratio doubles the road speed reached at the same engine speed.
    expect(S.roadSpeedMs(6000, car.gears[0] / 2, car)).toBeCloseTo(v * 2, 6);
  });

  it('gears the car taller with a bigger tyre', () => {
    const small = S.roadSpeedMs(6000, 1, { ...S.DEFAULT_CAR, tireDiameterIn: 24 });
    const big = S.roadSpeedMs(6000, 1, { ...S.DEFAULT_CAR, tireDiameterIn: 30 });
    expect(big).toBeGreaterThan(small);
  });

  it('trades launch against top end as the final drive gets shorter', () => {
    const tall = run({ gripIdx: 3, finalDrive: 2.8 });
    const short = run({ gripIdx: 3, finalDrive: 4.8 });
    expect(short.sixtyFootT).toBeLessThan(tall.sixtyFootT);
    expect(short.topGearUsed).toBeGreaterThan(tall.topGearUsed);
  });

  it('taxes the short gears hardest for rotating inertia', () => {
    // I referred to the road scales with (ratio ÷ radius)², so first gear carries far
    // more of the engine's inertia as effective mass than top gear does.
    const car = S.DEFAULT_CAR;
    const first = S.rotatingMassKg(car, car.gears[0] * car.finalDrive, true);
    const top = S.rotatingMassKg(car, car.gears[5] * car.finalDrive, true);
    expect(first).toBeGreaterThan(top);
  });

  it('charges nothing for engine inertia once the tyre is slipping', () => {
    const car = S.DEFAULT_CAR;
    const overall = car.gears[0] * car.finalDrive;
    expect(S.rotatingMassKg(car, overall, false)).toBeLessThan(S.rotatingMassKg(car, overall, true));
    // The wheels are still on the car's side of the slipping tyre, so their share stays.
    expect(S.rotatingMassKg(car, overall, false)).toBeGreaterThan(0);
  });

  it('runs out of gears if the box has too few of them', () => {
    const four = run({ gripIdx: 3, gearCount: 4, finalDrive: 4.8 });
    expect(four.topGearUsed).toBeLessThanOrEqual(4);
  });
});

describe('the gearbox', () => {
  it('launches an automatic harder, because the converter multiplies torque', () => {
    const manual = run({ gripIdx: 3, boxIdx: 0 });
    const auto = run({ gripIdx: 3, boxIdx: 1 });
    expect(auto.sixtyFootT).toBeLessThan(manual.sixtyFootT);
  });

  it('shifts an automatic faster, so it loses less time between gears', () => {
    expect(S.GEARBOX_OPTS[1].shiftSec).toBeLessThan(S.GEARBOX_OPTS[0].shiftSec);
    expect(run({ gripIdx: 3, boxIdx: 1 }).et).toBeLessThan(run({ gripIdx: 3, boxIdx: 0 }).et);
  });
});

describe('the torque curve comes from a measured pull', () => {
  it('reads back the sweep torque, converted to newton-metres at the same speed', () => {
    const curve = S.torqueCurveFromSweep({ points: [{ rpm: 2000, torque: 147.52 }, { rpm: 6000, torque: 221.28 }] });
    expect(curve(2000)).toBeCloseTo(200, 1);
    expect(curve(6000)).toBeCloseTo(300, 1);
    expect(curve(4000)).toBeCloseTo(250, 1); // interpolated
  });

  it('holds the end values flat outside the measured range', () => {
    const curve = S.torqueCurveFromSweep({ points: [{ rpm: 2000, torque: 147.52 }, { rpm: 6000, torque: 221.28 }] });
    expect(curve(500)).toBeCloseTo(curve(2000), 6);
    expect(curve(9000)).toBeCloseTo(curve(6000), 6);
  });

  it('turns a stronger engine into a quicker car', () => {
    expect(run({ gripIdx: 3 }, flatCurve(450)).et).toBeLessThan(run({ gripIdx: 3 }, flatCurve(250)).et);
  });
});
