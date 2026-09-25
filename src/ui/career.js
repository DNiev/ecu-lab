/**
 * The career: customer cars, each with one diagnosable fault.
 *
 * Its own module because it is DATA, not a screen. Nothing here is scripted — every
 * fault below is one the simulation already models, so every job is solved by reading
 * what the pull log actually says rather than by following a walkthrough.
 *
 *   `setup`          the state overrides applied when the job is taken on
 *   `goal(r, ctx)`   whether the job is complete, judged on the pull just measured
 *   `teaches`        shown once it is, because the point is the lesson and not the tick
 */

export const CAREER_JOBS = [
  {
    id: 'rich-injectors',
    title: 'Runs terrible since the fuel upgrade',
    customer: 'Owner fitted bigger injectors himself. Says it now stinks of fuel, fouls plugs and feels gutless.',
    brief: 'Something is delivering far more fuel than the tables ask for. Run a pull, read the log, and find the cause rather than bending the fuel table around it.',
    target: 'Reach Tuning Score 90+ without touching the AFR table.',
    setup: { injIdx: 4, ecuInjectorCc: 315 },
    goal: (r, ctx) => ctx.tuningScore >= 90 && !r.events.some((e) => e.type === 'rich' || e.type === 'injscale'),
    teaches: 'The ECU calculates pulse width for the injector size it has been told is fitted. Hardware changed; the ECU was never told.',
  },
  {
    id: 'stale-ve',
    title: 'Cam swap, never re-logged',
    customer: 'Shop fitted a big cam and handed it back on the old calibration. Customer says it runs rough and lean up top.',
    brief: 'The engine breathes differently now. The VE table is still describing the old engine, so the ECU is fuelling for air that is not there.',
    target: 'Get the mixture back on target and reach Tuning Score 85+.',
    setup: { camDuration: 268, springRate: 78, staleVe: true },
    goal: (r, ctx) => ctx.tuningScore >= 85 && !r.events.some((e) => e.type === 'lean' || e.type === 'rich'),
    teaches: 'A VE table is a log of measured airflow. Change the hardware and that log is simply out of date.',
  },
  {
    id: 'untuned-turbo',
    title: 'Turbo kit, stock calibration',
    customer: 'Customer bolted on a turbo and drove it home. Says it pulls hard then goes flat and rattles under load.',
    brief: 'A factory naturally-aspirated calibration has nothing meaningful above atmospheric pressure. Everything above 101 kPa is your job.',
    target: 'Survive 8 psi with Tuning Score 85+ and no knock events.',
    setup: { turboOn: true, boostCurve: [0, 0, 3, 6, 8, 8, 8, 7], injIdx: 2, ecuInjectorCc: 550, octaneIdx: 1 },
    goal: (r, ctx) => ctx.tuningScore >= 85 && !r.events.some((e) => e.type === 'knock'),
    teaches: 'Boost raises cylinder pressure enormously. Spark has to come out and mixture has to come richer, in the boost rows specifically.',
  },
  {
    id: 'lean-intake',
    title: 'Intake fitted, now it hesitates',
    customer: 'Aftermarket intake went on last week. Customer reports poor economy and a stumble at part throttle.',
    brief: 'The airflow sensor is reading against a housing it was never calibrated for. Watch the fuel trims, not just the power number.',
    target: 'Clear the trim fault and reach Tuning Score 95+.',
    setup: { intake: true },
    goal: (r, ctx) => ctx.tuningScore >= 95 && !r.events.some((e) => e.type === 'maf'),
    teaches: 'Closed loop hides small airflow errors at cruise. At wide open throttle the ECU stops listening to the O2 sensor and the error passes straight through.',
  },
  {
    id: 'full-session',
    title: 'Fresh build, no calibration at all',
    customer: 'Engine shop finished a build and handed it over with the factory file still loaded. Nothing on it has been tuned.',
    brief: 'This is a complete session, and the order matters. Verify what is actually fitted, set the scaling constants, correct airflow, then set fuel, then spark — last and in small steps. Skip a step and you will be tuning on a wrong foundation.',
    target: 'Tuning 90+ with no knock, no mixture faults and no scaling errors. The cam advisory will remain — that is a hardware trade-off, not something calibration can remove.',
    setup: { camDuration: 252, springRate: 76, injIdx: 3, ecuInjectorCc: 315, intake: true, staleVe: true, octaneIdx: 1 },
    goal: (r, ctx) => ctx.tuningScore >= 90
      && !r.events.some((e) => ['knock', 'lean', 'rich', 'injscale', 'maf', 'fuel'].includes(e.type)),
    teaches: 'Real tuning is a sequence, not a set of independent knobs. Scaling first, then airflow, then fuel, then spark — because each step assumes the one before it is already right.',
  },
  {
    id: 'power-goal',
    title: 'Customer wants 320 whp, safely',
    customer: 'Track day car. Owner wants real power but has to finish the weekend — reliability matters more than a headline number.',
    brief: 'Build and calibrate whatever it takes. The constraint is that it has to be clean: no knock, no lean cells, nothing running out of fuel.',
    target: '320+ whp with Tuning Score 90+ and zero knock.',
    setup: {},
    goal: (r, ctx) => r.peakHp >= 320 && ctx.tuningScore >= 90 && !r.events.some((e) => e.type === 'knock'),
    teaches: 'Power is easy. Power that survives a weekend is the actual job.',
  },
];
