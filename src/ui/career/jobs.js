/**
 * The customers. Each brings a real car (an engine from the preset catalogue), a real
 * problem the simulator genuinely produces, and a request. None of them names a table:
 * they describe what the car does, the way customers do, and finding the cause is the
 * job.
 *
 * The six scenarios the old career had are all here, turned into customers: the
 * injector swap, the stale VE after a cam, the untuned turbo, the intake, the full
 * session and the power-with-reliability build. `tests/career.test.js` holds every one
 * to two facts on the real simulator: it fails as delivered, and a real fix passes it.
 *
 * Criteria (see evaluate.js):
 *   events   none of these pull-log entries on the handed-back car
 *   mixture  at full throttle, actual AFR within `pct` of what the table asks
 *   minHp    peak wheel power, as a number or as a share of a reference car's
 *   maxEgt   exhaust temperature ceiling, °C
 *   maxDuty  injector duty ceiling, %
 *   untouched  a table the customer asked you not to bend, within `tol`
 *   idle     holds idle: running, swing and offset from target in RPM
 *   score    Tuning Score at least `min`
 *   fuelIs   runs on the fuel the customer asked for (`octaneIdx`)
 *   naOnly   no turbo, supercharger or nitrous
 *   maxRedline  the rev limit no higher than `max`
 * `kind` sorts them: the complaint is what they came in for, safety is what keeps the
 * engine alive, and request is anything else they asked for.
 */

import { IDLES, SAFE, withMods } from './criteria.js';
import { generatedJob } from './generate.js';

/**
 * @typedef {object} Criterion
 * @property {'events'|'mixture'|'minHp'|'maxEgt'|'maxDuty'|'untouched'|'idle'|'score'|'fuelIs'|'naOnly'|'maxRedline'} type
 * @property {'complaint'|'safety'|'request'} kind
 * @property {string} label what the customer would call it
 * @property {string[]} [types]
 * @property {number} [pct]
 * @property {number} [hp]
 * @property {{spec: import('./cars.js').CarSpec, share: number}} [hpOf]
 * @property {number} [max]
 * @property {'afr'|'timing'|'ve'} [table]
 * @property {number} [tol]
 * @property {number} [swing]
 * @property {number} [offset]
 * @property {number} [min]
 * @property {number} [octaneIdx]
 */

/**
 * @typedef {object} Job
 * @property {string} id
 * @property {1|2|3} tier
 * @property {boolean} [generated] made from a template (generate.js) rather than written by hand
 * @property {string} [carKey] which of the generator's cars it came on
 * @property {string} [template] the template a generated job was made from
 * @property {number} [level] the shop's standing the job was offered at, 0-4
 * @property {object} [params] what the template drew: fault sizes, targets
 * @property {boolean} [build] an engine-building job: BUILD is open, and the customer pays for parts
 * @property {{name: string, car: string, color: string, body?: 'coupe'|'sedan'|'hatch'}} customer `color` names a paint in the shop palette (tokens.js)
 * @property {string} says the complaint, in the customer's words
 * @property {string} wants what they want, in their words
 * @property {string[]} work the work order: what happens when you take the car in
 * @property {import('./cars.js').CarSpec} car
 * @property {{training?: string[], equipment?: string[]}} needs before you can take the job
 * @property {number} minRep
 * @property {number} pay
 * @property {number} rep
 * @property {Criterion[]} checks
 * @property {string} hint what the customer says if it comes back unfixed: a symptom, not an answer
 * @property {string} teaches shown when it is done well
 */

/** @type {Job[]} */
export const JOBS = [
  // ------------------------------------------------------------------ tier 1: street
  {
    id: 'intake-maf', tier: 1,
    customer: { name: 'Marcus', car: '2006 Nissan 350Z', color: 'silver', body: 'coupe' },
    says: 'Put a cold air intake on it last weekend. Sounds great, but it feels flat up top and I’m filling up more often. Did I break something?',
    wants: 'Make it run right with the intake. I’m keeping the intake.',
    work: ['Road test and diagnose', 'Tune for the new intake'],
    car: { preset: 'vq35de-revup', build: withMods({ intake: true }) },
    needs: {}, minRep: 0, pay: 350, rep: 6,
    checks: [
      { type: 'events', kind: 'complaint', types: ['maf'], label: 'Airflow reading right with the intake' },
      { type: 'mixture', kind: 'complaint', pct: 6, label: 'Full-throttle mixture where it should be' },
      ...SAFE, IDLES,
    ],
    hint: 'It’s better on the highway but it still feels off at full throttle, and the gauge you left says it’s leaner than it should be.',
    teaches: 'A bigger intake housing changes what the airflow sensor reads for the same air. The sensor’s own calibration is what fixes it: tune the MAF and VE separately, or each hides the other.',
  },
  {
    id: 'injector-scaling', tier: 1,
    customer: { name: 'Dana', car: '2008 Nissan 350Z', color: 'red', body: 'coupe' },
    says: 'I fitted bigger injectors myself because I’m saving for a turbo. Now it stinks of fuel, the plugs come out black, it’s gutless, and on a cold morning it floods and won’t start.',
    wants: 'Get it running right on these injectors. And don’t just lean the fuel map out to hide it — I’ve read about that.',
    work: ['Road test and diagnose', 'Correct the calibration for the new injectors'],
    car: { preset: 'vq35hr', build: () => ({ injIdx: 4 }) },
    needs: {}, minRep: 0, pay: 300, rep: 5,
    checks: [
      { type: 'events', kind: 'complaint', types: ['rich', 'injscale'], label: 'No longer drowning in fuel' },
      { type: 'untouched', kind: 'request', table: 'afr', tol: 0.3, label: 'Fixed the cause, not by bending the fuel targets' },
      ...SAFE, IDLES,
    ],
    hint: 'It’s still not right, and the plugs still look sooty. Something is still delivering more fuel than it should.',
    teaches: 'The ECU never commands fuel; it commands time, worked out for the injector size it has been told is fitted. Change the injectors without telling it and every table is wrong by the same factor.',
  },
  {
    id: 'headers-lean', tier: 1,
    customer: { name: 'Tony', car: '2006 Nissan 350Z', color: 'blue', body: 'coupe' },
    says: 'My 350Z runs like crap after I installed these headers. It’s showing a lean condition under load. Can you figure it out?',
    wants: 'Fix the lean condition. Everywhere, all the way to the limiter.',
    work: ['Headers and cat-back already fitted by the customer', 'Road test, log and correct'],
    car: { preset: 'vq35de-revup', build: withMods({ headers: true, exhaust: true }) },
    needs: {}, minRep: 0, pay: 450, rep: 7,
    checks: [
      { type: 'mixture', kind: 'complaint', pct: 5, label: 'On target at full throttle, all the way to redline' },
      ...SAFE, IDLES,
    ],
    hint: 'Much better through the middle, but right at the top before the limiter it still goes lean on my gauge.',
    teaches: 'Headers let the engine breathe more, so the table describing its breathing is out of date. Correct it from the log; and where the log cannot reach a cell (past redline, between the last points) a tuner extends the trend by hand.',
  },
  {
    id: 'idle-hunt', tier: 1,
    customer: { name: 'Priya', car: '2008 Nissan 350Z', color: 'white', body: 'coupe' },
    says: 'Since another shop “tuned” it, the idle goes up and down like crazy, and twice it’s just died pulling up to a light.',
    wants: 'I just want it to idle like a normal car again.',
    work: ['Diagnose the idle', 'Correct the calibration'],
    car: { preset: 'vq35hr', tune: (t) => ({ ecu: { ...t.ecu, idle: { ...t.ecu.idle, damp: 0.005 } } }) },
    needs: { training: ['idle'] }, minRep: 0, pay: 350, rep: 6,
    checks: [
      { type: 'idle', kind: 'complaint', swing: 60, offset: 60, label: 'Idles steadily, on its target, without stalling' },
      ...SAFE,
    ],
    hint: 'It’s calmer, but it still rolls up and down at lights. It doesn’t sit still like it used to.',
    teaches: 'Idle is a control loop. Without enough damping the controller overshoots every correction, and the engine hunts until it stalls.',
  },
  // ------------------------------------------------------------------ tier 2: enthusiast
  {
    id: 'cam-swap', tier: 2,
    customer: { name: 'Big Mike', car: '3.5 V6 project car', color: 'orange', body: 'coupe' },
    says: 'Had a shop put a big cam in. It sounds mean, but it bogs, runs rough, and pops lean up top. They said it “just needs a tune”.',
    wants: 'Make it run right with the cam. I know it’ll idle lumpy — that’s the point.',
    work: ['Road test and diagnose', 'Re-map for the new cam'],
    car: { preset: null, build: (b) => ({ engineConfig: { ...b.engineConfig, camDuration: 268, springRate: 78 } }) },
    needs: {}, minRep: 30, pay: 900, rep: 10,
    checks: [
      { type: 'events', kind: 'complaint', types: ['lean', 'rich'], label: 'No longer lean or rich' },
      { type: 'mixture', kind: 'complaint', pct: 6, label: 'Full-throttle mixture where it should be' },
      ...SAFE,
    ],
    hint: 'It still stumbles in places and the fuel gauge I use says it’s all over the place.',
    teaches: 'A VE table is a record of how the engine breathed when it was logged. Change the cam and the record is simply out of date: re-log it.',
  },
  {
    id: 'e85', tier: 2,
    customer: { name: 'Jess', car: '2008 Nissan 350Z', color: 'green', body: 'coupe' },
    says: 'Converted to E85 and fitted 650s. It starts, but it bucks, smells rich, and I honestly don’t know if it’s safe to drive.',
    wants: 'Make it safe and smooth on E85.',
    work: ['Check the ethanol content', 'Correct the calibration for the injectors and the fuel'],
    car: { preset: 'vq35hr', build: () => ({ octaneIdx: 3, injIdx: 3 }) },
    needs: { equipment: ['flex'] }, minRep: 20, pay: 800, rep: 9,
    checks: [
      { type: 'events', kind: 'complaint', types: ['injscale', 'rich'], label: 'Fuelling right for the injectors and the fuel' },
      { type: 'mixture', kind: 'complaint', pct: 6, label: 'Full-throttle mixture where it should be' },
      ...SAFE, IDLES,
    ],
    hint: 'Still bucks a little and I can still smell it. Something about the fuel is still off.',
    teaches: 'E85 needs about half as much fuel again as gasoline for the same air, which is why E85 cars need bigger injectors, and why the ECU has to be told about them.',
  },
  {
    id: 'retarded-timing', tier: 2,
    customer: { name: 'Mr. Okafor', car: '2008 Nissan 350Z', color: 'black', body: 'coupe' },
    says: 'The last shop said they made it “safe”. It’s slower than my friend’s bone-stock one, and the exhaust runs hot.',
    wants: 'What the engine should make, and nothing that will hurt it. Show me on the dyno.',
    work: ['Dyno baseline', 'Correct the calibration'],
    car: { preset: 'vq35hr', tune: (t) => ({ timing: t.timing.map((row, ri) => row.map((v) => (ri <= 3 ? v - 8 : v))) }) },
    needs: { training: ['spark'], equipment: ['dyno'] }, minRep: 25, pay: 900, rep: 10,
    checks: [
      { type: 'minHp', kind: 'complaint', hpOf: { spec: { preset: 'vq35hr' }, share: 0.985 }, label: 'Makes the power a healthy stock engine makes' },
      ...SAFE, IDLES,
    ],
    hint: 'Better, but it’s still not pulling like my friend’s. It still feels lazy at full throttle.',
    teaches: 'Too little spark is not safe, it is slow and hot: the burn finishes late, the exhaust carries the heat, and the power never arrives. The right timing is the least that makes best torque, short of knock.',
  },
  {
    id: 'turbo-kit', tier: 2,
    customer: { name: 'Sam', car: '3.5 V6 turbo project', color: 'purple', body: 'coupe' },
    says: 'Bolted a turbo kit on: 8 psi, intercooler, bigger injectors. The kit said the ECU would “adapt”. It pulls hard, then it rattles and goes flat.',
    wants: 'I want to use the boost, but I don’t want to blow it up.',
    work: ['Turbo kit already fitted, injectors already scaled', 'Road test and tune for boost'],
    car: { preset: null, build: (b) => ({ turboOn: true, boostCurve: [0, 0, 3, 6, 8, 8, 8, 7], injIdx: 2, ecuInjectorCc: 550, octaneIdx: 1, mods: { ...b.mods, intercooler: true } }) },
    needs: { training: ['spark'] }, minRep: 45, pay: 1600, rep: 14,
    checks: [
      { type: 'events', kind: 'complaint', types: ['knock', 'knockprot'], label: 'No rattle under boost' },
      ...SAFE,
      { type: 'score', kind: 'request', min: 85, label: 'A clean calibration overall' },
      IDLES,
    ],
    hint: 'Better, but it still pulls timing on a hard run. I can hear it and the car goes soft.',
    teaches: 'A factory naturally aspirated calibration has nothing real above atmospheric pressure. Boost raises cylinder pressure, so spark comes out and fuel goes richer in the boost rows specifically.',
  },
  // ------------------------------------------------------------------ tier 3: pro
  {
    id: 'full-session', tier: 3,
    customer: { name: 'Coastline Engines', car: '3.5 V6 fresh build', color: 'teal', body: 'coupe' },
    says: 'We finished this build: bigger cam and springs, bigger injectors, intake, 93 octane. It’s still on the factory file. Our name is on this engine too.',
    wants: 'A complete calibration. Clean everywhere. No excuses on the log.',
    work: ['Engine built and fitted by Coastline', 'Complete calibration'],
    car: { preset: null, build: (b) => ({ engineConfig: { ...b.engineConfig, camDuration: 252, springRate: 76 }, injIdx: 3, ecuInjectorCc: 315, mods: { ...b.mods, intake: true }, octaneIdx: 1 }) },
    needs: { training: ['spark', 'knock'] }, minRep: 130, pay: 2800, rep: 20,
    checks: [
      { type: 'events', kind: 'complaint', types: ['rich', 'injscale', 'maf', 'misfire'], label: 'Fuelling and sensors all correct' },
      { type: 'events', kind: 'complaint', types: ['falseknock'], label: 'Knock control not fooled by the new valvetrain' },
      { type: 'mixture', kind: 'complaint', pct: 6, label: 'Full-throttle mixture where it should be' },
      ...SAFE,
    ],
    hint: 'Our log still shows problems. We need every line of it clean before this goes back to the owner.',
    teaches: 'Real tuning is a sequence. Scaling first, then airflow, then fuel, then spark, then knock control, because each assumes the one before it is right.',
  },
  {
    id: 'blower-power', tier: 3,
    customer: { name: 'Rae', car: '3.5 V6 track car, supercharged', color: 'copper', body: 'coupe' },
    says: 'Supercharger’s on with the small pulley, intercooled, injectors sized for it. It’s on the old tune and it rattles. I have a track weekend in two weeks.',
    wants: '380 at the wheels, and it has to survive the whole weekend. No knock, no heat, no drama.',
    work: ['Supercharger kit already fitted and injectors scaled', 'Dyno tune for power and reliability'],
    car: { preset: null, build: (b) => ({ blowerId: 'm90', blowerRatio: 1.6, octaneIdx: 1, injIdx: 2, ecuInjectorCc: 550, mods: { ...b.mods, intercooler: true } }) },
    needs: { training: ['spark'], equipment: ['dyno', 'egt'] }, minRep: 130, pay: 3200, rep: 22,
    checks: [
      { type: 'minHp', kind: 'complaint', hp: 380, label: '380 wheel horsepower' },
      ...SAFE,
      { type: 'maxDuty', kind: 'safety', max: 90, label: 'Injectors with headroom left' },
    ],
    hint: 'Either it’s short of the number, or it isn’t safe yet. I need both.',
    teaches: 'Power is easy. Power that survives a weekend is the job: the best tune is the one closest to the limit without crossing it.',
  },
  {
    id: 'nitrous', tier: 3,
    customer: { name: 'Deshawn', car: '2006 Nissan 350Z', color: 'yellow', body: 'coupe' },
    says: '100 shot, wet kit, bottle heater. Every time I hit the button it bogs, and on one pass it made a noise I really didn’t like.',
    wants: 'Make the nitrous pull clean and safe. I don’t want to hear that noise again.',
    work: ['Nitrous kit already fitted', 'Dyno tune the nitrous'],
    car: { preset: 'vq35de-revup', build: () => ({ nitrous: { kit: 'wet', shotHp: 100, heater: true, bottleLb: 10 } }) },
    needs: { training: ['nitrous'], equipment: ['dyno', 'egt'] }, minRep: 130, pay: 2400, rep: 18,
    checks: [
      { type: 'events', kind: 'complaint', types: ['rich', 'nitrousknock', 'nitrouslean'], label: 'Clean, safe mixture and no knock while spraying' },
      { type: 'events', kind: 'safety', types: ['knock', 'unheardknock', 'lean', 'fuel'], label: 'No knock or lean anywhere' },
      // A spray lasts seconds: 1050 °C at the port is survivable for that long.
      { type: 'maxEgt', kind: 'safety', max: 1050, label: 'Exhaust temperature survivable while spraying' },
    ],
    hint: 'Still bogs when it comes on, or it still makes that noise. It isn’t right yet.',
    teaches: 'Nitrous brings its own oxygen, so it needs its own fuel, and it lowers the knock limit while it sprays. Both are set for the spray alone; the base tune stays as it was.',
  },
];

/** @param {string} id */
export const jobById = (id) => (typeof id === 'string' && id.startsWith('g:') ? generatedJob(id) : JOBS.find((j) => j.id === id));
