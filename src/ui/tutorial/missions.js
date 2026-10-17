/**
 * Practice missions: the Tuning Course's lessons, done for real in the player's own game.
 *
 * A mission is a short checklist. Each step is a question about the game's state (has
 * a pull been run since the last step? is the intake fitted? is AIRFLOW open?), so the
 * checklist ticks itself as the player works, the way a good in-product tour does:
 * nobody presses "I did it". Steps complete in order, and when one does, the game's
 * state at that moment is kept as its mark, so a later step can ask "since then".
 *
 * Pure: every check reads a context and returns a boolean.
 */

import { LOAD } from '../../sim/index.js';

/**
 * @typedef {object} MissionCtx
 * @property {any} state the whole store: build, tune, session
 * @property {{tab: string|null, section: string|null}} route where the player is
 * @property {any[]} marks one per completed step, oldest first; marks[0] is the start
 */

/**
 * @typedef {object} MissionStep
 * @property {string} text what to do, naming the screen
 * @property {(ctx: MissionCtx) => boolean} check
 * @property {string} [hint] shown while this is the step the player is on
 */

/**
 * @typedef {object} Mission
 * @property {string} id
 * @property {string} title
 * @property {string} blurb
 * @property {MissionStep[]} steps
 * @property {(state: any) => string} done what the player just achieved, with their numbers
 */

/** What is worth remembering about the game when a step completes. */
export const markOf = (state) => ({
  pullCount: state.session.pullCount,
  ve: state.tune.ve,
  timing: state.tune.timing,
});

const at = (tab, section) => (ctx) => ctx.route.tab === tab && (section == null || ctx.route.section === section);
/** A pull has finished since the last step was done. */
const pulledSince = (ctx) => ctx.state.session.pullCount > ctx.marks[ctx.marks.length - 1].pullCount && !ctx.state.session.running;
const events = (ctx) => ctx.state.session.result?.events ?? [];
const WOT = LOAD.indexOf(100);
const rowMean = (t) => t[WOT].reduce((a, b) => a + b, 0) / t[WOT].length;

/** @type {Mission[]} */
export const MISSIONS = [
  {
    id: 'first-pull',
    title: 'Your first pull',
    blurb: 'Run the engine on the dyno and read what it tells you.',
    steps: [
      { text: 'Open DYNO.', check: at('dyno') },
      { text: 'Press RUN DYNO PULL and let it finish.', check: pulledSince },
      { text: 'Open PULL LOG and read it, before the power number.', check: at('dyno', 'log') },
      { text: 'Open DATALOG and drag through the pull.', check: at('dyno', 'data') },
    ],
    done: (s) => `You measured the engine and read its log: ${Math.round(s.session.result?.peakHp ?? 0)} whp. Every tune from here starts this way.`,
  },
  {
    id: 'knock-limit',
    title: 'Find the knock limit',
    blurb: 'Add spark until the engine knocks, see it in the log, then back off.',
    steps: [
      {
        text: 'On TUNE › SPARK, select the 100 kPa row and add about 4°.',
        check: (ctx) => rowMean(ctx.state.tune.timing) - rowMean(ctx.marks[0].timing) >= 3,
        hint: 'Tap the 100 on the left of the table to select the whole row, then +1 four times. On 91 the factory table sits only about 2° under the knock limit at full throttle, as a real one does.',
      },
      { text: 'Run a pull.', check: pulledSince },
      {
        text: 'Find the knock entry on DYNO › PULL LOG.',
        check: (ctx) => at('dyno', 'log')(ctx) && events(ctx).some((e) => e.type === 'knock'),
        hint: 'No knock entry? This engine has more margin: add another 2° and pull again.',
      },
      {
        text: 'Take timing back out until a pull comes back with no knock.',
        check: (ctx) => pulledSince(ctx) && !events(ctx).some((e) => e.type === 'knock'),
        hint: 'Use the Try line: it says roughly how far to go.',
      },
    ],
    done: (s) => `You found where this engine knocks on this fuel, and backed off to a clean ${Math.round(s.session.result?.peakHp ?? 0)} whp. That is how every spark table is finished.`,
  },
  {
    id: 'bolt-on',
    title: 'Bolt-on and retune',
    blurb: 'Fit a cold air intake, read its symptoms, and fix each where it lives.',
    steps: [
      { text: 'Fit the Cold Air Intake on BUILD › INDUCTION.', check: (ctx) => !!ctx.state.build.mods.intake },
      { text: 'Run a pull.', check: pulledSince },
      {
        text: 'On TUNE › AIRFLOW, press APPLY HALF under the table.',
        check: (ctx) => ctx.state.tune.ve !== ctx.marks[ctx.marks.length - 1].ve,
        hint: 'CORRECT VE FROM LOGS is under the VE table. Select a cell and open the advisor to see its maths first.',
      },
      {
        text: 'On TUNE › SENSORS, set the MAF scalar to about 1.11.',
        check: (ctx) => ctx.state.build.mafScalar >= 1.05,
        hint: 'The bigger housing makes the MAF read about 10% low; 1 ÷ 0.90 ≈ 1.11 cancels it.',
      },
      { text: 'Pull again.', check: pulledSince },
      {
        text: 'Get a log with no lean or MAF entries.',
        check: (ctx) => ctx.state.session.result != null && !events(ctx).some((e) => e.type === 'lean' || e.type === 'maf'),
        hint: 'Still an entry? Apply half again on AIRFLOW, and pull.',
      },
    ],
    done: (s) => `You fitted a part and retuned for it: ${Math.round(s.session.result?.peakHp ?? 0)} whp on a clean log. That is a real shop job, start to finish.`,
  },
];

/**
 * Advances a mission as far as the game's state allows: each step whose check now
 * passes is marked done, in order, stopping at the first that does not.
 *
 * @param {Mission} mission
 * @param {{step: number, marks: any[]}} progress
 * @param {any} state
 * @param {{tab: string|null, section: string|null}} route
 * @returns {{step: number, marks: any[]}} the same object when nothing changed
 */
export function advance(mission, progress, state, route) {
  let { step, marks } = progress;
  let changed = false;
  while (step < mission.steps.length && mission.steps[step].check({ state, route, marks })) {
    marks = [...marks, markOf(state)];
    step += 1;
    changed = true;
  }
  return changed ? { ...progress, step, marks } : progress;
}
