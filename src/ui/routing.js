/**
 * Pure route <-> hash conversion for the app shell.
 *
 * No DOM, no React, no `location` — this module only converts between a
 * `window.location.hash` string and a plain route object. Task 3 wires this
 * into the shell; nothing here reads or writes the actual URL.
 *
 * `appView` (`'start' | 'tutorial' | 'app'`) does not exist as a separate
 * piece of state after this: `route.view` derives entirely from the hash.
 * `#/` is 'start', `#/tutorial` is 'tutorial', anything else recognized is
 * 'app'.
 */

/**
 * The single source of truth for which tabs exist and which sections each
 * has. `parseRoute`/`formatRoute` derive all validation from this table —
 * there is no second, hand-written list of section names anywhere in this
 * file. Do not rename tabs or sections here; #83 re-sections these.
 *
 * @type {Record<string, string[]>}
 */
export const ROUTES = {
  dash: ['jobs', 'stats', 'health', 'learn'],
  build: ['engine', 'induction', 'fuel', 'exhaust'],
  tune: ['airflow', 'spark', 'fuel', 'injectors', 'sensors'],
  // LIVE is one screen, not an accordion, so it has a single section named for what it
  // shows. It still needs to be in this table: `parseRoute` validates every tab against
  // it, and a tab absent from here is not addressable at all.
  live: ['engine'],
  dyno: ['result', 'data', 'log', 'score'],
};

/**
 * @typedef {Object} Route
 * @property {'start'|'tutorial'|'app'} view - Which top-level screen is showing.
 * @property {string|null} tab - The active tab key (a key of `ROUTES`), or
 *   `null` when `view` is not 'app'.
 * @property {string|null} section - The open accordion section within `tab`,
 *   or `null` when every section is collapsed (a real, reachable state) or
 *   when `view` is not 'app'.
 */

/** @type {Route} */
const START_ROUTE = { view: 'start', tab: null, section: null };

/** @type {Route} */
const TUTORIAL_ROUTE = { view: 'tutorial', tab: null, section: null };

/**
 * Parse a `window.location.hash`-shaped string into a route object.
 *
 * An unknown or missing tab falls back to the start screen. An unknown
 * section is dropped but its (valid) tab is kept, so a stale deep link to a
 * renamed screen lands on the right tab instead of a blank page. A tab with
 * no section segment parses to `section: null` — "everything collapsed" —
 * rather than falling back to a default section, because that state must
 * stay reachable (closing an open accordion's own header produces it).
 *
 * @param {string} hash - e.g. '', '#/', '#/tune/timing'.
 * @returns {Route}
 */
export function parseRoute(hash) {
  const raw = String(hash ?? '');
  // Strip a leading '#', then a leading '/', then split into segments,
  // dropping empty segments (handles '', '#/', trailing slashes, etc).
  const path = raw.replace(/^#/, '').replace(/^\//, '');
  const segments = path.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { ...START_ROUTE };
  }

  const [first, second] = segments;

  if (first === 'tutorial') {
    return { ...TUTORIAL_ROUTE };
  }

  if (!Object.prototype.hasOwnProperty.call(ROUTES, first)) {
    return { ...START_ROUTE };
  }

  const tab = first;
  const sections = ROUTES[tab];
  const section = second != null && sections.includes(second) ? second : null;

  return { view: 'app', tab, section };
}

/**
 * Format a route object back into a `window.location.hash`-shaped string.
 * Inverse of `parseRoute` for every route `parseRoute` can produce.
 *
 * @param {Route} route
 * @returns {string}
 */
export function formatRoute(route) {
  const { view, tab, section } = route ?? {};

  if (view === 'tutorial') {
    return '#/tutorial';
  }

  if (view === 'app' && tab != null) {
    const parts = ['', tab];
    if (section != null) {
      parts.push(section);
    }
    return `#${parts.join('/')}`;
  }

  return '#/';
}
