/**
 * Customers without end: jobs made from templates, so the shop always has work.
 *
 * A template is a fault the simulator genuinely produces (an intake nobody recalibrated
 * for, injectors the ECU was never told about, a cam on a stale VE table) or, once the
 * shop has trained in engine building, a customer's wish list for a whole engine. Each
 * one draws its car, its customer, how bad the fault is and what they pay from a seeded
 * random number, so the same id always makes the same job: a job is its id, and the save
 * never has to store one.
 *
 * `level` is the shop's standing when the job was offered (0 to 4, from reputation).
 * It makes the work harder as the shop grows: tighter tolerances, bigger faults, two
 * faults at once, pickier customers, and more money.
 *
 * `tests/career-generated.test.js` holds every template, on every car it can come on and
 * at every level, to the same two facts as the story jobs: it fails as delivered, and the
 * real fix passes it.
 */

import { INJECTOR_OPTS, OCTANE_OPTS, presetById } from '../../sim/index.js';

import { IDLES, SAFE, withMods } from './criteria.js';

/** @typedef {import('./jobs.js').Job} Job */
/** @typedef {import('./jobs.js').Criterion} Criterion */

/** A small, fast, seedable generator (mulberry32). @param {number} seed */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** @template T @param {T[]} xs @returns {T} */
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    /** @param {number} lo @param {number} hi */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    /** @param {number} lo @param {number} hi */
    range: (lo, hi) => lo + next() * (hi - lo),
  };
}

/** Mixes numbers into one seed (for a day's customers: the career's seed, the day, the slot). */
export const mix = (...xs) => xs.reduce((h, x) => Math.imul(h ^ (x >>> 0), 2654435761) >>> 0, 0x9e3779b9);

/** The shop's standing, 0 to 4, from reputation. */
export const levelOf = (rep) => (rep >= 250 ? 4 : rep >= 130 ? 3 : rep >= 60 ? 2 : rep >= 20 ? 1 : 0);

/**
 * The cars customers drive. `na` cars are the ones a bolt-on, cam or boost kit can go on;
 * the factory-turbo ones bring the faults any car can have.
 */
const CARS = {
  v6: { preset: null, na: true, names: ['3.5 V6 sedan', '3.5 V6 coupe', '3.5 V6 daily'], bodies: ['sedan', 'coupe'] },
  hr: { preset: 'vq35hr', na: true, names: ['2008 Nissan 350Z', '2009 Nissan 370Z-swapped 350Z', '2007 Nissan 350Z'], bodies: ['coupe'] },
  de: { preset: 'vq35de-revup', na: true, names: ['2006 Nissan 350Z', '2005 Nissan 350Z Track'], bodies: ['coupe'] },
  n54: { preset: 'n54', na: false, names: ['2008 BMW 335i', '2010 BMW 135i'], bodies: ['sedan', 'coupe'] },
  gti: { preset: 'ea888-gti', na: false, names: ['2017 VW GTI', '2019 VW GTI'], bodies: ['hatch'] },
};

const FIRST = [
  'Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Jamie', 'Avery', 'Quinn', 'Rowan',
  'Luis', 'Mei', 'Omar', 'Hana', 'Dev', 'Nia', 'Kofi', 'Ines', 'Tomas', 'Yuki',
  'Grace', 'Malik', 'Sofia', 'Ravi', 'Lena', 'Andre', 'Chloe', 'Mateo', 'Aisha', 'Kai',
];
const PAINT = ['silver', 'red', 'blue', 'white', 'orange', 'green', 'black', 'purple', 'teal', 'copper', 'yellow', 'grey', 'pewter', 'pearl'];

/** Pay grows with the shop's standing: better shops charge more. @param {number} base @param {number} level */
const payAt = (base, level, r) => Math.round((base * (1 + level * 0.25) * r.range(0.9, 1.15)) / 10) * 10;

/**
 * How much reputation a walk-in job earns, by standing. A clean intake retune makes a new
 * shop's name; at a destination shop it is Tuesday. Without this the shop reached the
 * top of the ladder in about two weeks of perfect play (measured by the producer run in
 * tests/career-economy.test.js), and an endless career had nowhere left to go.
 */
const REP_TAPER = [1, 0.7, 0.5, 0.35, 0.25];

/** Full-throttle mixture tolerance: the better the shop, the pickier the customers. */
const mixPct = (level) => [6, 6, 5, 5, 4][level];

/** The idle check, stricter as the customers get pickier. */
const idleAt = (level) => ({ ...IDLES, swing: [120, 120, 100, 90, 80][level] });

/**
 * @typedef {object} Draw what a template needs from the car and customer it was dealt
 * @property {ReturnType<typeof rng>} r
 * @property {number} level
 * @property {{preset: string|null, na: boolean}} car
 * @property {string} carName
 */

/**
 * @typedef {object} Template
 * @property {string} id
 * @property {number} minLevel the lowest standing it is offered at
 * @property {string[]} cars CARS keys it can come on
 * @property {{training?: string[], equipment?: string[]}} needs
 * @property {(d: Draw) => object} make the job's own fields, and its `params`
 */

/**
 * A fault on its own, reused by the two-fault template.
 * @type {Record<string, {build: (p: any) => (b: any) => object, params: (r: any, car: any) => object, checks: (level: number) => Criterion[], symptom: (r: any, p?: any) => string}>}
 */
const FAULTS = {
  intake: {
    build: (_p) => withMods({ intake: true }),
    params: () => ({}),
    checks: (level) => [
      { type: 'events', kind: 'complaint', types: ['maf'], label: 'Airflow reading right with the intake' },
      { type: 'mixture', kind: 'complaint', pct: mixPct(level), label: 'Full-throttle mixture where it should be' },
    ],
    symptom: (r) => r.pick([
      'New intake, and now it hesitates and I’m filling up more often.',
      'Fitted a cold air intake. It sounds great, but it feels flat up top.',
      'Since the intake went on it stumbles when I floor it.',
    ]),
  },
  injectors: {
    params: (r, car) => {
      const stock = car.preset ? (presetById(car.preset)?.parts?.injectorIdx ?? 0) : 0;
      const from = Math.max(1, stock + 1);
      return { injIdx: r.int(from, Math.min(INJECTOR_OPTS.length - 1, from + 2)) };
    },
    build: (p) => () => ({ injIdx: p.injIdx }),
    checks: () => [
      { type: 'events', kind: 'complaint', types: ['rich', 'injscale'], label: 'No longer drowning in fuel' },
      { type: 'untouched', kind: 'request', table: 'afr', tol: 0.3, label: 'Fixed the cause, not by bending the fuel targets' },
    ],
    symptom: (r, p) => r.pick([
      `I put ${INJECTOR_OPTS[p.injIdx].cc}s in it for later and now it runs like it’s choking.`,
      `Bigger injectors went in (${INJECTOR_OPTS[p.injIdx].cc} cc). Now it stinks of fuel and the plugs are black.`,
      `Swapped to ${INJECTOR_OPTS[p.injIdx].cc} cc injectors. It’s gutless and won’t start cold without a fight.`,
    ]),
  },
  headers: {
    build: (_p) => withMods({ headers: true, exhaust: true }),
    params: () => ({}),
    checks: (level) => [
      { type: 'mixture', kind: 'complaint', pct: mixPct(level), label: 'On target at full throttle, all the way to redline' },
    ],
    symptom: (r) => r.pick([
      'Headers and a cat-back went on. My gauge says it goes lean under load.',
      'Full exhaust, headers back. It pulls, but the wideband reads lean near the top.',
    ]),
  },
};

const TEMPLATES = /** @type {Template[]} */ ([
  {
    id: 'intake', minLevel: 0, cars: ['v6', 'hr', 'de', 'n54', 'gti'], needs: {},
    make: ({ r, level }) => ({
      tier: 1, pay: payAt(300, level, r), rep: 4,
      says: FAULTS.intake.symptom(r), wants: 'Make it run right with the intake. I’m keeping it.',
      work: ['Intake already fitted', 'Road test, diagnose and correct'],
      carBuild: FAULTS.intake.build({}), params: {},
      checks: [...FAULTS.intake.checks(level), ...SAFE, idleAt(level)],
      hint: 'It’s still not right at full throttle, and the gauge you left says it’s off.',
      teaches: 'An intake housing changes what the airflow sensor reads for the same air. Its calibration is what fixes it.',
    }),
  },
  {
    id: 'injectors', minLevel: 0, cars: ['v6', 'hr', 'de', 'n54', 'gti'], needs: {},
    make: ({ r, level, car }) => {
      const p = FAULTS.injectors.params(r, car);
      return {
        tier: 1, pay: payAt(280, level, r), rep: 4,
        says: FAULTS.injectors.symptom(r, p), wants: 'Get it running right on these injectors. Don’t just lean the map out to hide it.',
        work: ['Injectors already fitted', 'Diagnose and correct'],
        carBuild: FAULTS.injectors.build(p), params: p,
        checks: [...FAULTS.injectors.checks(level), ...SAFE, idleAt(level)],
        hint: 'Still rich. Something is still delivering more fuel than it should.',
        teaches: 'The ECU commands injector time, worked out for the size it has been told is fitted. Change the part, change the number.',
      };
    },
  },
  {
    id: 'idle', minLevel: 0, cars: ['v6', 'hr', 'de'], needs: { training: ['idle'] },
    make: ({ r, level }) => {
      const damp = Number(r.range(0.003, 0.009).toFixed(4));
      return {
        tier: 1, pay: payAt(320, level, r), rep: 4,
        says: r.pick([
          'Since someone “fixed” it, the idle goes up and down and it nearly died at a light.',
          'The idle hunts. Up, down, up, down. Twice it has stalled in traffic.',
        ]),
        wants: 'A normal, steady idle.',
        work: ['Diagnose the idle', 'Correct the calibration'],
        carTune: { idleDamp: damp }, params: { damp },
        checks: [
          { type: 'idle', kind: 'complaint', swing: 60, offset: 60, label: 'Idles steadily, on its target, without stalling' },
          ...SAFE,
        ],
        hint: 'Calmer, but it still rolls up and down at lights.',
        teaches: 'Idle is a control loop. Without enough damping the controller overshoots every correction until the engine stalls.',
      };
    },
  },
  {
    id: 'headers', minLevel: 0, cars: ['v6', 'hr', 'de'], needs: {},
    make: ({ r, level }) => ({
      tier: 1, pay: payAt(420, level, r), rep: 5,
      says: FAULTS.headers.symptom(r), wants: 'Fix the lean condition, all the way to the limiter.',
      work: ['Headers and exhaust already fitted', 'Road test, log and correct'],
      carBuild: FAULTS.headers.build({}), params: {},
      checks: [...FAULTS.headers.checks(level), ...SAFE, idleAt(level)],
      hint: 'Better through the middle, but right at the top it still goes lean on my gauge.',
      teaches: 'More exhaust flow makes the VE table out of date. Correct it from the log, and extend the trend by hand where no log can reach.',
    }),
  },
  {
    id: 'cam', minLevel: 1, cars: ['v6', 'hr', 'de'], needs: {},
    make: ({ r, level }) => {
      const cam = r.pick([248, 252, 256, 260, 264].slice(0, 3 + Math.min(2, level)));
      const springs = cam >= 256 ? 78 : 72;
      return {
        tier: 2, pay: payAt(800, level, r), rep: 8,
        says: `A shop put a ${cam}° cam in. It sounds mean but it bogs, runs rough and pops up top. They said it “just needs a tune”.`,
        wants: 'Make it run right with the cam. I know it’ll idle lumpy.',
        work: ['Cam and springs already fitted', 'Re-map for the new cam'],
        carBuild: (b) => ({ engineConfig: { ...b.engineConfig, camDuration: cam, springRate: springs } }), params: { cam, springs },
        checks: [
          { type: 'events', kind: 'complaint', types: ['lean', 'rich'], label: 'No longer lean or rich' },
          { type: 'mixture', kind: 'complaint', pct: mixPct(level) + 1, label: 'Full-throttle mixture where it should be' },
          ...SAFE,
        ],
        hint: 'Still stumbles in places, and my gauge says the mixture is all over the place.',
        teaches: 'A VE table records how the engine breathed when it was logged. A new cam makes the record out of date: re-log it.',
      };
    },
  },
  {
    id: 'retarded', minLevel: 1, cars: ['hr', 'de', 'v6'], needs: { training: ['spark'], equipment: ['dyno'] },
    make: ({ r, level, car }) => {
      const deg = r.int(8, 12);
      const rows = r.int(3, 5);
      return {
        tier: 2, pay: payAt(850, level, r), rep: 8,
        says: r.pick([
          'The last shop said they made it “safe”. It’s slower than a stock one and the exhaust runs hot.',
          'Had it “detuned for reliability”. Now it’s lazy everywhere and the cat glows after a drive.',
        ]),
        wants: 'What the engine should make, and nothing that hurts it. Show me on the dyno.',
        work: ['Dyno baseline', 'Correct the calibration'],
        carTune: { retard: { deg, rows } }, params: { deg, rows },
        checks: [
          { type: 'minHp', kind: 'complaint', hpOf: { spec: { preset: car.preset }, share: 0.985 }, label: 'Makes the power a healthy stock engine makes' },
          ...SAFE, idleAt(level),
        ],
        hint: 'Better, but it still feels lazy at full throttle.',
        teaches: 'Too little spark is slow and hot: the burn finishes late, the exhaust carries the heat and the power never arrives.',
      };
    },
  },
  {
    id: 'e85', minLevel: 1, cars: ['hr', 'de', 'v6'], needs: { equipment: ['flex'] },
    make: ({ r, level }) => {
      const injIdx = r.int(3, 4);
      return {
        tier: 2, pay: payAt(760, level, r), rep: 8,
        says: `Converted to E85 with ${INJECTOR_OPTS[injIdx].cc} cc injectors. It bucks, smells rich, and I don’t know if it’s safe.`,
        wants: 'Make it safe and smooth on E85.',
        work: ['Check the ethanol content', 'Correct the calibration for the injectors and fuel'],
        carBuild: () => ({ octaneIdx: 3, injIdx }), params: { injIdx },
        checks: [
          { type: 'events', kind: 'complaint', types: ['injscale', 'rich'], label: 'Fuelling right for the injectors and the fuel' },
          { type: 'mixture', kind: 'complaint', pct: mixPct(level), label: 'Full-throttle mixture where it should be' },
          ...SAFE, idleAt(level),
        ],
        hint: 'Still bucks and I can still smell it. Something about the fuel is still off.',
        teaches: 'E85 needs about half as much fuel again for the same air, which is why E85 cars need bigger injectors and an ECU that knows it.',
      };
    },
  },
  {
    id: 'turbo', minLevel: 1, cars: ['v6'], needs: { training: ['spark'] },
    make: ({ r, level }) => {
      // From 7 psi: below that a naturally aspirated table survives the boost, and there
      // is no fault to find.
      const psi = r.int(7, 8 + Math.min(2, level));
      const curve = [0, 0, Math.round(psi * 0.4), Math.round(psi * 0.75), psi, psi, psi, Math.max(0, psi - 1)];
      return {
        tier: 2, pay: payAt(1400, level, r), rep: 12,
        says: `Bolted on a turbo kit: ${psi} psi, intercooler, 550s. The kit said the ECU would “adapt”. It pulls hard, then it rattles and goes flat.`,
        wants: 'I want to use the boost, but I don’t want to blow it up.',
        work: ['Turbo kit fitted, injectors scaled', 'Road test and tune for boost'],
        carBuild: (b) => ({ turboOn: true, boostCurve: curve, injIdx: 2, ecuInjectorCc: 550, octaneIdx: 1, mods: { ...b.mods, intercooler: true } }),
        params: { psi },
        checks: [
          { type: 'events', kind: 'complaint', types: ['knock', 'knockprot'], label: 'No rattle under boost' },
          ...SAFE,
          { type: 'score', kind: 'request', min: 80 + level * 2, label: 'A clean calibration overall' },
          idleAt(level),
        ],
        hint: 'It still pulls timing on a hard run. I can hear it and the car goes soft.',
        teaches: 'A naturally aspirated calibration has nothing real above atmospheric. Boost needs less spark and more fuel in the boost rows.',
      };
    },
  },
  {
    id: 'pair', minLevel: 2, cars: ['v6', 'hr', 'de'], needs: {},
    make: ({ r, level, car }) => {
      const [a, b] = r.pick([['intake', 'injectors'], ['headers', 'injectors'], ['intake', 'headers']]);
      const pa = FAULTS[a].params(r, car);
      const pb = FAULTS[b].params(r, car);
      const byType = new Map();
      for (const c of [...FAULTS[a].checks(level), ...FAULTS[b].checks(level)]) byType.set(`${c.type}:${c.label}`, c);
      return {
        tier: 2, pay: payAt(900, level, r), rep: 9,
        says: `${FAULTS[a].symptom(r, pa)} And then: ${FAULTS[b].symptom(r, pb).replace(/^./, (x) => x.toLowerCase())}`,
        wants: 'Sort all of it out. I want it to drive like it should.',
        work: ['Parts already fitted', 'Diagnose everything, then correct it'],
        carBuild: (bb) => ({ ...FAULTS[a].build(pa)(bb), ...FAULTS[b].build(pb)({ ...bb, ...FAULTS[a].build(pa)(bb) }) }),
        params: { faults: [a, b], ...pa, ...pb },
        checks: [...byType.values(), ...SAFE, idleAt(level)],
        hint: 'Some of it is better. Not all of it.',
        teaches: 'Two faults hide each other. Fix the scaling first, then the airflow, and read the log again after each.',
      };
    },
  },
  // ------------------------------------------------------------------ engine building
  {
    id: 'build-na', minLevel: 2, cars: ['v6', 'hr', 'de'], needs: { training: ['builder'], equipment: ['dyno'] },
    make: ({ r, level, car }) => {
      const octaneIdx = r.pick([0, 1]);
      // Up to +14%: every car here reaches +15-21% naturally aspirated with bolt-ons, a
      // 240° cam and a retune, so the hardest ask still leaves room for a sensible build.
      const share = r.range(1.06, 1.09 + level * 0.0125);
      const redline = r.pick([null, null, 7200]);
      return {
        tier: 3, pay: payAt(2200, level, r), rep: 14, build: true,
        says: `I want more out of it without a turbo. It lives on ${OCTANE_OPTS[octaneIdx].label} octane, and I drive it every day.`,
        wants: `${Math.round(share * 100 - 100)}% more wheel horsepower than stock, naturally aspirated, on ${OCTANE_OPTS[octaneIdx].label}${redline ? `, and nothing past ${redline} RPM` : ''}.`,
        work: ['Customer pays for parts', 'Build the engine in BUILD, then tune it'],
        params: { octaneIdx, share, redline },
        checks: [
          { type: 'minHp', kind: 'complaint', hpOf: { spec: { preset: car.preset }, share }, label: `${Math.round(share * 100 - 100)}% more power than stock` },
          { type: 'naOnly', kind: 'request', label: 'No turbo, supercharger or nitrous' },
          { type: 'fuelIs', kind: 'request', octaneIdx, label: `Runs on ${OCTANE_OPTS[octaneIdx].label}` },
          ...(redline ? [{ type: 'maxRedline', kind: 'request', max: redline, label: `Revs no higher than ${redline}` }] : []),
          ...SAFE, idleAt(Math.min(level, 1)),
        ],
        hint: 'It isn’t what I asked for yet. Read my list again.',
        teaches: 'Naturally aspirated power is airflow: breathing parts, cam, and a VE table logged on the engine as it is now.',
      };
    },
  },
  {
    id: 'build-boost', minLevel: 3, cars: ['v6', 'hr', 'de'], needs: { training: ['builder', 'boost'], equipment: ['dyno', 'egt'] },
    make: ({ r, level, car }) => {
      const octaneIdx = r.pick([1, 1, 3]);
      const share = r.range(1.25, 1.3 + (level - 3) * 0.08);
      return {
        tier: 3, pay: payAt(3400, level, r), rep: 18, build: true,
        says: `I want it fast, and I want to drive it to work. Boost is fine. ${octaneIdx === 3 ? 'There’s E85 at my station.' : 'Pump 93 only.'}`,
        wants: `${Math.round(share * 100 - 100)}% more than stock at the wheels on ${OCTANE_OPTS[octaneIdx].label}, and it has to survive.`,
        work: ['Customer pays for parts', 'Build the engine in BUILD, then tune it'],
        params: { octaneIdx, share },
        checks: [
          { type: 'minHp', kind: 'complaint', hpOf: { spec: { preset: car.preset }, share }, label: `${Math.round(share * 100 - 100)}% more power than stock` },
          { type: 'fuelIs', kind: 'request', octaneIdx, label: `Runs on ${OCTANE_OPTS[octaneIdx].label}` },
          { type: 'maxDuty', kind: 'safety', max: 90, label: 'Injectors with headroom left' },
          ...SAFE, idleAt(1),
        ],
        hint: 'Either it’s short of what I asked for, or it isn’t safe yet. I need both.',
        teaches: 'Boosted power that survives is fuel, spark and heat managed together: injectors with headroom, spark out of the boost rows, fuel in.',
      };
    },
  },
]);

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

/** The template ids a shop at `level` can be offered. @param {number} level */
export const templatesAt = (level) => TEMPLATES.filter((t) => t.minLevel <= level);

/** @param {string} id */
export const templateById = (id) => TEMPLATES.find((t) => t.id === id);

/** An id for a generated job. @param {string} tpl @param {number} seed @param {number} level */
export const genId = (tpl, seed, level) => `g:${tpl}:${seed >>> 0}:${level}`;

/**
 * The job an id stands for, made fresh (and identically) every time.
 *
 * @param {string} id `g:<template>:<seed>:<level>`
 * @returns {Job|undefined}
 */
export function generatedJob(id) {
  const [, tplId, seedStr, levelStr] = id.split(':');
  const tpl = templateById(tplId);
  if (!tpl) return undefined;
  const seed = Number(seedStr) >>> 0;
  const level = Math.max(0, Math.min(4, Number(levelStr) || 0));
  const r = rng(seed);
  const carKey = r.pick(tpl.cars);
  const car = CARS[carKey];
  const carName = r.pick(car.names);
  const name = r.pick(FIRST);
  const color = r.pick(PAINT);
  const body = /** @type {'coupe'|'sedan'|'hatch'} */ (r.pick(car.bodies));
  const made = tpl.make({ r, level, car, carName });
  const { carBuild, carTune, params, ...rest } = made;
  return {
    id, generated: true, template: tpl.id, level, carKey,
    customer: { name, car: carName, color, body },
    car: {
      preset: car.preset,
      ...(carBuild ? { build: carBuild } : {}),
      ...(carTune ? { tune: tuneFor(carTune) } : {}),
    },
    needs: tpl.needs, minRep: 0,
    params,
    ...rest,
    rep: Math.max(1, Math.round(rest.rep * REP_TAPER[level])),
  };
}

/** Calibration faults, as tune patches. @param {{idleDamp?: number, retard?: {deg: number, rows: number}}} f */
function tuneFor(f) {
  return (t) => ({
    ...(f.idleDamp != null ? { ecu: { ...t.ecu, idle: { ...t.ecu.idle, damp: f.idleDamp } } } : {}),
    ...(f.retard ? { timing: t.timing.map((row, ri) => row.map((v) => (ri <= f.retard.rows ? v - f.retard.deg : v))) } : {}),
  });
}

/**
 * A day's walk-in customers for a shop: seeded by the career, the day and the slot, at the
 * shop's standing that day. The first slots only offer work the shop can take right now,
 * so a day is never all locked doors; the rest may show what a purchase would open.
 *
 * @param {{seed: number, day: number, rep: number}} c
 * @param {number} count
 * @param {(tpl: Template) => boolean} canTake whether the shop has what a template needs
 * @returns {string[]}
 */
export function dayOffers(c, count, canTake) {
  const level = levelOf(c.rep);
  const all = templatesAt(level);
  const open = all.filter(canTake);
  const out = [];
  for (let slot = 0; slot < count; slot += 1) {
    const seed = mix(c.seed, c.day, slot);
    const r = rng(seed);
    const pool = slot < 2 && open.length ? open : all;
    // Bigger work is rarer: weight by how close the template is to the shop's level.
    const weighted = pool.flatMap((t) => Array(1 + Math.max(0, 2 - (level - t.minLevel))).fill(t));
    out.push(genId(r.pick(weighted).id, mix(seed, 7), level));
  }
  return out;
}
