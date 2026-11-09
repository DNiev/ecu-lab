/**
 * What a shop can learn and buy, and what its reputation opens up.
 *
 * Every item changes the game, not just the picture: training unlocks the real TUNE
 * pages (the same screens SANDBOX has, closed until you know what they do), and
 * equipment decides what you can measure (no dyno, no horsepower figure), how many
 * cars you can hold, and which customers will trust you with their car.
 */

/**
 * TUNE pages a brand-new shop can already use: enough to fix what bolt-ons and
 * injector swaps do to the fuelling.
 */
export const STARTING_PAGES = ['airflow', 'fuel', 'injectors', 'sensors'];

/**
 * The ECU settings under those pages that come with them. The air model, the fuel
 * strategy and knock control are a course each.
 */
export const STARTING_SECTIONS = ['injectors', 'sensors'];

/**
 * @typedef {object} Training
 * @property {string} id
 * @property {string} title
 * @property {number} price
 * @property {number} rep reputation needed before the course will take you
 * @property {string[]} [requires] training that has to come first
 * @property {string[]} pages TUNE pages it opens
 * @property {string[]} [sections] ECU settings sections inside a page it opens
 * @property {string} summary one line: what you will be able to do
 * @property {string[]} lesson what the course teaches, in a few short paragraphs
 * @property {string} [deeper] where the full lesson lives
 * @property {boolean} [build] opens BUILD on engine-building jobs
 */

/** @type {Training[]} */
export const TRAINING = [
  {
    id: 'spark', title: 'Ignition timing', price: 600, rep: 0, pages: ['spark'],
    summary: 'Read and set the SPARK table: find best torque, and stop before knock.',
    lesson: [
      'The mixture takes a few milliseconds to burn, so the spark fires before the piston reaches the top. Fire too late and the burn chases a piston already leaving; too early and the pressure fights a piston still coming up.',
      'The best point is MBT, minimum advance for best torque. Past it you gain nothing but knock risk. More boost, heat or compression lowers the knock limit, and the ECU’s knock control will pull timing back out, costing power.',
      'How to tell on a car: too little timing runs hot at the exhaust and down on power with a clean log; too much shows the ECU pulling timing in the log, and makes less power, not more.',
    ],
    deeper: 'The Tuning Course, lessons 2.3 and 3.4',
  },
  {
    id: 'idle', title: 'Idle control', price: 400, rep: 0, pages: ['idle'],
    summary: 'Set idle speed, idle air and the controller that holds it.',
    lesson: [
      'At idle the throttle is shut and the ECU holds speed on its own, with a bypass air valve and a little spark. It is a feedback loop: too little air and the engine sags; too much gain or too little damping and it overshoots, hunts up and down, and can stall.',
      'Idle problems are drivability problems. Customers notice them at every red light, and a car that stalls in traffic is not safe to hand back.',
      'Test idle on LIVE: start it, let it settle, and watch the RPM trace. A healthy idle holds within a few tens of RPM of its target.',
    ],
    deeper: 'Learn article 35, controllers',
  },
  {
    id: 'fuel-strategy', title: 'Advanced fuel strategies', price: 700, rep: 25, requires: [],
    pages: [], sections: ['fuel', 'airflow'],
    summary: 'The ECU’s fuel strategy: enrichment, cold start and the air model.',
    lesson: [
      'Behind the tables is the strategy that uses them: how the ECU works out air (speed-density, MAF, or both blended), how it enriches cold and under heat, and how it treats the wall film on the port.',
      'These settings rarely need touching on a healthy car. When they do, it is because the car is doing something the base tables were never meant to cover.',
    ],
    deeper: 'Learn articles 33 and 43',
  },
  {
    id: 'knock', title: 'Knock control', price: 900, rep: 30, requires: ['spark'], pages: [], sections: ['spark'],
    summary: 'The knock sensor, its threshold, and what the ECU does when it hears knock.',
    lesson: [
      'The ECU does not know knock happened: it hears vibration and compares it with a threshold. Set the threshold too low and valvetrain noise reads as knock, so the ECU pulls timing for nothing (false knock). Too high and real knock goes unheard.',
      'A big cam or stiff springs make more valvetrain noise, so the threshold has to be re-learned after either. The pull log tells false knock and unheard knock apart.',
    ],
    deeper: 'Learn article 34',
  },
  {
    id: 'limits', title: 'Rev limits and protections', price: 700, rep: 30, pages: ['protect'],
    summary: 'Rev limiters, launch, and the protections that save an engine.',
    lesson: [
      'The protections are what stand between a mistake and a broken engine: lean, overheating, knock and pressure all have an action, from pulling timing to limp mode.',
      'Rev and load limits keep an engine inside what its parts survive. Customers with built engines care about them as much as the power figure.',
    ],
    deeper: 'Learn article 36',
  },
  {
    id: 'vvt', title: 'Variable cam timing', price: 900, rep: 60, pages: ['vvt'],
    summary: 'VVT/VTC targets: where the cams sit at each speed and load.',
    lesson: [
      'Moving the intake cam changes when the valve closes, which changes how much air the cylinder traps at each RPM. Advance helps low-speed torque; retard helps the top end.',
      'The VE table depends on cam position, so a cam-timing change is also a breathing change: log it again afterwards.',
    ],
    deeper: 'Learn article 35',
  },
  {
    id: 'boost', title: 'Boost control', price: 1500, rep: 60, requires: ['spark'], pages: ['boost'],
    summary: 'Wastegate duty, closed-loop boost and overboost protection.',
    lesson: [
      'The ECU holds boost by opening and closing the wastegate. Base duty gets it close; the closed loop trims it to the target. Too much gain overshoots, too little and it never arrives.',
      'Boost is cylinder pressure. Every psi lowers the knock limit, so spark comes out of the boost rows and the mixture goes richer to cool the charge.',
    ],
    deeper: 'Learn articles 22 and 35',
  },
  {
    id: 'builder', title: 'Engine building', price: 4000, rep: 90, requires: ['spark'], pages: [], build: true,
    summary: 'Build whole engines to a customer’s wish list: BUILD opens on engine-building jobs.',
    lesson: [
      'An engine builder is handed a wish list, not a fault: this much power, this fuel, no boost, nothing past this RPM, and it still has to idle in traffic. Every part is a trade.',
      'Breathing parts and a longer cam move the power up the rev range and cost idle quality and low-speed torque. Compression is free power until it meets the fuel’s knock limit. Boost is the biggest lever, and it needs injectors, spark and fuel to match.',
      'Build first, then tune: every hardware change makes the VE table out of date, so log it again. A build is only done when the whole list is met on the dyno and it is safe.',
    ],
    deeper: 'The Tuning Course, chapter 4, and Learn articles 22, 40 and 45',
  },
  {
    id: 'torque', title: 'Torque management', price: 800, rep: 80, pages: ['torque'],
    summary: 'Torque limits by gear and speed, to protect the driveline.',
    lesson: [
      'A gearbox and clutch have a torque rating too. Torque management trims boost, throttle or spark so the engine never asks more of the driveline than it can carry.',
    ],
    deeper: 'Learn article 36',
  },
  {
    id: 'nitrous', title: 'Nitrous tuning', price: 1200, rep: 80, requires: ['spark'], pages: ['nitrous'],
    summary: 'The nitrous window, fuel while spraying, and retard per shot.',
    lesson: [
      'Nitrous is oxygen from a bottle. More oxygen burns more fuel, so it needs its own fuel while it sprays, and the extra cylinder pressure lowers the knock limit: about 2° out per 50 hp of shot is the rule of thumb.',
      'A speed-density ECU cannot see the air the nitrous vapour displaces, so a wet kit tends to run rich; a lean nitrous mixture melts pistons in seconds.',
    ],
    deeper: 'Learn article 41',
  },
];

/**
 * @typedef {object} Equipment
 * @property {string} id
 * @property {string} title
 * @property {number} price
 * @property {number} rep
 * @property {string} does what owning it changes
 * @property {string[]} [requires]
 */

/** @type {Equipment[]} */
export const EQUIPMENT = [
  { id: 'laptop', title: 'Tuning laptop and cable', price: 0, rep: 0, does: 'Reads and flashes the ECU. Every shop starts with one.' },
  { id: 'wideband', title: 'Handheld wideband', price: 0, rep: 0, does: 'Logs air-fuel ratio on a road test. Every shop starts with one.' },
  { id: 'dyno', title: 'Chassis dyno', price: 6000, rep: 20, does: 'Measures power. Without it a road test logs everything except horsepower, and power jobs go elsewhere.' },
  { id: 'lift2', title: 'Second lift', price: 3000, rep: 15, does: 'Hold two customer cars at once.' },
  { id: 'flex', title: 'Ethanol content analyser', price: 500, rep: 25, does: 'Measures what is really in the tank. E85 customers will not book without it.' },
  { id: 'egt', title: 'EGT probe kit', price: 700, rep: 60, does: 'Logs exhaust temperature per pull. Boosted and nitrous customers insist on it.' },
  { id: 'sign', title: 'Shop sign', price: 900, rep: 10, does: 'People can find you: one more customer waiting on the board.' },
  { id: 'lounge', title: 'Customer lounge', price: 2500, rep: 60, does: 'Coffee and a couch. Happy customers tip: +10% on every job.' },
  { id: 'expansion', title: 'Shop expansion', price: 15000, rep: 130, requires: ['lift2'], does: 'A third bay and room to grow: hold three cars at once.' },
];

/** Reputation, and what each step up is called. */
export const REP_TIERS = [
  { min: 0, title: 'Garage startup' },
  { min: 20, title: 'Local shop' },
  { min: 60, title: 'Known tuner' },
  { min: 130, title: 'Respected shop' },
  { min: 250, title: 'Destination shop' },
];

/** @param {number} rep */
export const repTier = (rep) => REP_TIERS.reduce((t, x) => (rep >= x.min ? x : t), REP_TIERS[0]);

/** @param {number} rep */
export const nextRepTier = (rep) => REP_TIERS.find((x) => x.min > rep) ?? null;

/**
 * @typedef {object} Milestone
 * @property {string} id
 * @property {string} title
 * @property {(c: import('./shop.js').Career) => boolean} test
 */

/** @type {Milestone[]} */
export const MILESTONES = [
  { id: 'first-job', title: 'First customer paid', test: (c) => c.history.some((h) => h.paid > 0) },
  { id: 'first-training', title: 'First training course', test: (c) => c.trained.length > 0 },
  { id: 'dyno', title: 'A dyno of your own', test: (c) => c.owned.includes('dyno') },
  { id: 'five-jobs', title: 'Five happy customers', test: (c) => c.history.filter((h) => h.verdict === 'pass').length >= 5 },
  { id: 'first-boost', title: 'First boosted car', test: (c) => c.history.some((h) => h.verdict === 'pass' && h.boosted) },
  { id: 'first-build', title: 'First engine built to order', test: (c) => c.history.some((h) => h.built) },
  { id: 'respected', title: 'A respected shop', test: (c) => c.rep >= 130 },
  { id: 'all-story', title: 'Every story customer served', test: (c) => c.storyDone },
];
