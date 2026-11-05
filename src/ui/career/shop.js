/**
 * The shop's save: money, reputation, the day, what it owns and knows, the cars on its
 * lifts and everything it has done. Pure functions from one save to the next, so the
 * whole career is testable without a screen, and the store only ever swaps one save for
 * another.
 */

import { EQUIPMENT, MILESTONES, STARTING_PAGES, STARTING_SECTIONS, TRAINING } from './catalog.js';
import { customerCar } from './cars.js';
import { dayOffers } from './generate.js';
import { JOBS, jobById } from './jobs.js';

export const SAVE_VERSION = 1;
export const START_MONEY = 1000;

/**
 * @typedef {object} LiftCar
 * @property {string} jobId
 * @property {{build: any, tune: any}} car the customer's car as it stands: the work so far
 * @property {number} day the day it came in
 */

/**
 * @typedef {object} HistoryEntry
 * @property {number} day
 * @property {string} jobId
 * @property {'pass'|'partial'|'fail'|'unsafe'} verdict
 * @property {number} paid money in (negative when a repair cost more than the job paid)
 * @property {number} repChange
 * @property {boolean} boosted
 * @property {boolean} [built] an engine the shop built, delivered well
 * @property {number} peakHp
 */

/**
 * @typedef {object} Career
 * @property {number} v
 * @property {number} money
 * @property {number} rep
 * @property {number} day
 * @property {string[]} owned equipment ids
 * @property {string[]} trained training ids
 * @property {Record<string, number>} done story jobs finished well: id -> day
 * @property {LiftCar[]} lifts cars in the shop, one per lift
 * @property {string|null} working the job whose car is on the tuning bay
 * @property {HistoryEntry[]} history newest first
 * @property {string[]} milestones
 * @property {boolean} storyDone every story customer served
 * @property {LastDelivery|null} [last] the most recent hand-back, for the shop to show
 * @property {number} [lastSeen] the `seq` of the last hand-back the player has read
 * @property {number} seed this career's own random seed: its customers are its own
 * @property {string[]} offers today's walk-in customers (generated job ids)
 */

/**
 * @typedef {object} LastDelivery
 * @property {string} jobId
 * @property {'pass'|'partial'|'fail'|'unsafe'} verdict
 * @property {number} paid
 * @property {number} repChange
 * @property {number} repair
 * @property {string} line what the customer said
 * @property {{label: string, kind: string, type?: string, pass: boolean, measured: string}[]} results
 * @property {boolean} leaves whether the car went home
 * @property {number} seq increases with every hand-back, so the shop can tell a new one
 */

/**
 * @param {number} [seed] a fixed seed, for tests; a new career gets a random one
 * @returns {Career}
 */
export function newCareer(seed = Math.floor(Math.random() * 2 ** 32)) {
  return withOffers({
    v: SAVE_VERSION, money: START_MONEY, rep: 0, day: 1,
    owned: ['laptop', 'wideband'], trained: [], done: {}, lifts: [], working: null,
    history: [], milestones: [], storyDone: false, last: null, lastSeen: 0,
    seed: seed >>> 0, offers: [],
  });
}

/** Whether the shop has the training and equipment a template needs. @param {Career} c */
const hasNeeds = (c) => (/** @type {{needs: {training?: string[], equipment?: string[]}}} */ t) => (t.needs.training ?? []).every((x) => c.trained.includes(x))
  && (t.needs.equipment ?? []).every((x) => c.owned.includes(x));

/**
 * Today's walk-in customers, made for this shop, this day and its standing today. Made
 * once when the day starts and kept, so buying or training mid-day never reshuffles who
 * is waiting.
 * @param {Career} c
 * @returns {Career}
 */
function withOffers(c) {
  return { ...c, offers: dayOffers(c, boardSize(c) + 1, hasNeeds(c)) };
}

/**
 * The shop closes for the day: tomorrow brings new customers. The cars on the lifts
 * stay where they are.
 * @param {Career} c
 * @returns {Career}
 */
export function nextDay(c) {
  return advanceDay(c);
}

/**
 * A save read back from storage, or a new career if it is missing or from a format
 * this build does not know. Never throws: a bad save must not stop the game starting.
 *
 * @param {unknown} raw
 * @returns {Career}
 */
export function reviveCareer(raw) {
  const c = /** @type {any} */ (raw);
  if (!c || typeof c !== 'object' || c.v !== SAVE_VERSION) return newCareer();
  const fresh = newCareer(typeof c.seed === 'number' ? c.seed : undefined);
  const revived = {
    ...fresh, ...c,
    seed: fresh.seed,
    owned: Array.isArray(c.owned) ? c.owned : fresh.owned,
    trained: Array.isArray(c.trained) ? c.trained : [],
    lifts: Array.isArray(c.lifts) ? c.lifts.filter((l) => l && jobById(l.jobId) && l.car?.build && l.car?.tune) : [],
    history: Array.isArray(c.history) ? c.history : [],
    milestones: Array.isArray(c.milestones) ? c.milestones : [],
  };
  return Array.isArray(c.offers) && c.offers.every((id) => typeof id === 'string' && jobById(id)) ? revived : withOffers(revived);
}

/** How many customer cars the shop can hold at once. @param {Career} c */
export const capacity = (c) => 1 + (c.owned.includes('lift2') ? 1 : 0) + (c.owned.includes('expansion') ? 1 : 0);

/**
 * What the shop costs to open for a day: rent, and the running costs of what it has
 * grown into (each extra lift is floor space and a tech, the dyno needs power and
 * servicing, the lounge its coffee). Charged every time the day moves on, so growth is
 * a decision, and money earned has somewhere to go. Never stops play: a shop in the red
 * can still take work, it just cannot buy anything.
 * @param {Career} c
 */
export const overhead = (c) => 40 + 70 * (capacity(c) - 1)
  + (c.owned.includes('dyno') ? 60 : 0) + (c.owned.includes('lounge') ? 50 : 0)
  + (c.owned.includes('expansion') ? 120 : 0);

/** The day moves on: the running costs are paid, and tomorrow's customers arrive. @param {Career} c */
const advanceDay = (c) => withOffers({ ...c, day: c.day + 1, money: c.money - overhead(c) });

/** How many customers wait on the board. @param {Career} c */
export const boardSize = (c) => 3 + (c.owned.includes('sign') ? 1 : 0);

/** @param {Career} c @param {string} page a TUNE section id */
export const pageUnlocked = (c, page) => STARTING_PAGES.includes(page)
  || c.trained.some((t) => TRAINING.find((x) => x.id === t)?.pages.includes(page));

/** @param {Career} c @param {string} section an ECU settings section id */
export const sectionUnlocked = (c, section) => STARTING_SECTIONS.includes(section)
  || c.trained.some((t) => TRAINING.find((x) => x.id === t)?.sections?.includes(section));

/**
 * The training that opens a TUNE page, or the ECU settings section of that name, for a
 * locked screen to name.
 * @param {string} id
 * @param {'page'|'section'} [kind]
 */
export const trainingFor = (id, kind = 'page') => TRAINING.find((t) => (kind === 'page' ? t.pages : t.sections ?? []).includes(id)) ?? null;

/**
 * What stands between the shop and a job: reputation, training, equipment, a free lift.
 *
 * @param {Career} c
 * @param {import('./jobs.js').Job} job
 * @returns {string[]} reasons it cannot be taken, empty when it can
 */
export function blockers(c, job) {
  const out = [];
  if (c.rep < job.minRep) out.push(`Reputation ${job.minRep} (you have ${c.rep})`);
  for (const t of job.needs.training ?? []) {
    if (!c.trained.includes(t)) out.push(`${TRAINING.find((x) => x.id === t)?.title ?? t} training`);
  }
  for (const e of job.needs.equipment ?? []) {
    if (!c.owned.includes(e)) out.push(EQUIPMENT.find((x) => x.id === e)?.title ?? e);
  }
  if (c.lifts.length >= capacity(c)) out.push('A free lift');
  return out;
}

/**
 * The customers waiting today: story customers first (lowest tier first), then walk-in
 * work, as many as the board holds. Customers the shop cannot serve yet still show,
 * with what they need, because knowing what the next customer needs is how a shop
 * decides what to buy.
 *
 * @param {Career} c
 * @returns {import('./jobs.js').Job[]}
 */
export function board(c) {
  const inShop = new Set(c.lifts.map((l) => l.jobId));
  // The named customers first, lowest tier first, at most two at a time: they are the
  // story. The rest of the board is today's walk-ins, and there are always walk-ins.
  const story = JOBS.filter((j) => !inShop.has(j.id) && !c.done[j.id] && c.rep + 15 >= j.minRep)
    .sort((a, b) => a.tier - b.tier).slice(0, 2);
  const walkins = (c.offers ?? []).filter((id) => !inShop.has(id)).map(jobById).filter(Boolean);
  return [...story, ...walkins].slice(0, boardSize(c));
}

/**
 * The customer hands over the keys: their car goes on a lift.
 *
 * @param {Career} c
 * @param {string} jobId
 * @returns {Career}
 */
export function accept(c, jobId) {
  const job = jobById(jobId);
  if (!job || blockers(c, job).length) return c;
  const s = customerCar(job.car);
  return { ...c, lifts: [...c.lifts, { jobId, car: { build: s.build, tune: s.tune }, day: c.day }], working: jobId };
}

/**
 * Saves the work on a car back to its lift.
 *
 * @param {Career} c
 * @param {string} jobId
 * @param {{build: any, tune: any}} car
 * @returns {Career}
 */
export function storeCar(c, jobId, car) {
  return { ...c, lifts: c.lifts.map((l) => (l.jobId === jobId ? { ...l, car } : l)) };
}

/**
 * The car goes home and the customer pays, or does not.
 *
 * @param {Career} c
 * @param {string} jobId
 * @param {import('./evaluate.js').Verdict} v
 * @param {{boosted?: boolean}} [extra]
 * @returns {Career}
 */
export function deliver(c, jobId, v, extra = {}) {
  const job = jobById(jobId);
  // A car the job was not finished on stays in the shop: the customer says what is
  // still wrong, and you can keep working on it.
  const leaves = v.verdict !== 'fail';
  const tip = v.verdict === 'pass' && c.owned.includes('lounge') ? Math.round(v.pay * 0.1) : 0;
  const paid = v.pay + tip - v.repair;
  const next = {
    ...c,
    money: c.money + paid,
    rep: Math.max(0, c.rep + v.rep),
    done: v.verdict === 'pass' && !job.generated ? { ...c.done, [jobId]: c.day } : c.done,
    lifts: leaves ? c.lifts.filter((l) => l.jobId !== jobId) : c.lifts,
    working: leaves ? null : c.working,
    history: [{ day: c.day, jobId, verdict: v.verdict, paid, repChange: v.rep, boosted: !!extra.boosted, built: !!job.build && v.verdict === 'pass', peakHp: Math.round(v.peakHp) }, ...c.history].slice(0, 60),
    last: {
      jobId, verdict: v.verdict, paid, repChange: v.rep, repair: v.repair, line: v.line, leaves,
      results: v.results.map((x) => ({ label: x.check.label, kind: x.check.kind, type: x.check.type, pass: x.pass, measured: x.measured })),
      seq: (c.last?.seq ?? 0) + 1,
    },
  };
  return withMilestones(leaves ? advanceDay(next) : next);
}

/**
 * Sends a car home unfinished: no pay, and the customer is not pleased.
 *
 * @param {Career} c
 * @param {string} jobId
 * @returns {Career}
 */
export function giveUp(c, jobId) {
  return advanceDay({
    ...c,
    rep: Math.max(0, c.rep - 2),
    lifts: c.lifts.filter((l) => l.jobId !== jobId),
    working: c.working === jobId ? null : c.working,
    history: [{ day: c.day, jobId, verdict: /** @type {'fail'} */ ('fail'), paid: 0, repChange: -2, boosted: false, peakHp: 0 }, ...c.history].slice(0, 60),
  });
}

/**
 * @param {Career} c
 * @param {string} id
 * @returns {string|null} why it cannot be bought, or null
 */
export function cannotBuy(c, id) {
  const item = EQUIPMENT.find((x) => x.id === id);
  if (!item) return 'Unknown item';
  if (c.owned.includes(id)) return 'Owned';
  if (c.rep < item.rep) return `Reputation ${item.rep} (you have ${c.rep})`;
  const missing = (item.requires ?? []).filter((r) => !c.owned.includes(r));
  if (missing.length) return `Needs ${missing.map((r) => EQUIPMENT.find((x) => x.id === r)?.title).join(', ')}`;
  if (c.money < item.price) return `$${(item.price - c.money).toLocaleString('en-US')} short`;
  return null;
}

/** @param {Career} c @param {string} id @returns {Career} */
export function buy(c, id) {
  if (cannotBuy(c, id)) return c;
  const item = EQUIPMENT.find((x) => x.id === id);
  return withMilestones({ ...c, money: c.money - item.price, owned: [...c.owned, id] });
}

/**
 * @param {Career} c
 * @param {string} id
 * @returns {string|null} why the course cannot be taken, or null
 */
export function cannotTrain(c, id) {
  const t = TRAINING.find((x) => x.id === id);
  if (!t) return 'Unknown course';
  if (c.trained.includes(id)) return 'Completed';
  if (c.rep < t.rep) return `Reputation ${t.rep} (you have ${c.rep})`;
  const missing = (t.requires ?? []).filter((r) => !c.trained.includes(r));
  if (missing.length) return `After ${missing.map((r) => TRAINING.find((x) => x.id === r)?.title).join(', ')}`;
  if (c.money < t.price) return `$${(t.price - c.money).toLocaleString('en-US')} short`;
  return null;
}

/** @param {Career} c @param {string} id @returns {Career} */
export function train(c, id) {
  if (cannotTrain(c, id)) return c;
  const t = TRAINING.find((x) => x.id === id);
  return withMilestones({ ...c, money: c.money - t.price, trained: [...c.trained, id] });
}

/** @param {Career} c @returns {Career} */
function withMilestones(c) {
  const storyDone = JOBS.every((j) => c.done[j.id]);
  const next = { ...c, storyDone };
  const reached = MILESTONES.filter((m) => !next.milestones.includes(m.id) && m.test(next)).map((m) => m.id);
  return reached.length ? { ...next, milestones: [...next.milestones, ...reached] } : next;
}
