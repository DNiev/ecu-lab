/**
 * The two things the lesson reader shows: the five-minute tutorial and the Tuning
 * Course. Same reader, same lesson parts; they differ in length, in what the contents
 * page promises, and in where finishing takes you.
 */

import { CHAPTERS, OUTCOMES } from './lessons.jsx';
import { QUICK_CHAPTERS, QUICK_OUTCOMES } from './quickTour.jsx';

/** @typedef {import('./lessons.jsx').Chapter} Chapter */

/**
 * @typedef {object} Book
 * @property {string} id also its progress key
 * @property {string} label the bar's name for it
 * @property {string} title
 * @property {string} lede
 * @property {string[]} outcomes
 * @property {Chapter[]} chapters
 * @property {(Chapter['lessons'][number] & {chapter: Chapter, number: string})[]} lessons every lesson in reading order, numbered
 * @property {boolean} showResult whether the contents page opens on the stock engine's dyno pull
 * @property {string} doneLabel the last lesson's button
 */

/** @param {Chapter[]} chapters */
const numbered = (chapters) => chapters.flatMap((c, ci) => c.lessons.map((l, li) => ({
  ...l, chapter: c, number: chapters.length > 1 ? `${ci + 1}.${li + 1}` : `${li + 1}`,
})));

/** @type {Book} */
export const TUTORIAL = {
  id: 'tutorial',
  label: 'TUTORIAL',
  title: 'Tuning in five minutes',
  lede: 'Five short cards: what tuning is, where things are, and how to measure your work. Every screen in it is the real game, running live.',
  outcomes: QUICK_OUTCOMES,
  chapters: QUICK_CHAPTERS,
  lessons: numbered(QUICK_CHAPTERS),
  showResult: false,
  doneLabel: 'START TUNING',
};

/** @type {Book} */
export const COURSE = {
  id: 'course',
  label: 'COURSE',
  title: 'The Tuning Course',
  lede: `About ${CHAPTERS.reduce((m, c) => m + c.minutes, 0)} minutes, in ${CHAPTERS.length} chapters of short lessons. Every screen in it is the real game screen, running live, and every number is the one your own game will show. Take it in any order, a lesson at a time.`,
  outcomes: OUTCOMES,
  chapters: CHAPTERS,
  lessons: numbered(CHAPTERS),
  showResult: true,
  doneLabel: 'BACK TO LEARN',
};
