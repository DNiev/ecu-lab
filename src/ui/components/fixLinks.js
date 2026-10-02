/**
 * The screens a pull-log fix sends the player to, as routes they can open in one tap.
 *
 * Every event's "Try:" line names where the fix lives — "On TUNE → NITROUS, raise the
 * retard…", "Fit a bigger fuel pump on BUILD → FUEL SYSTEM" — and a reader who has to
 * go and find that screen from the name alone is a reader who gives up. This turns the
 * names into crosslinks. It also tells TUNE's page switcher which pages the last pull's
 * log is pointing at.
 *
 * Pure: text in, routes out. Only names that resolve to a real screen become links, and
 * each screen once, in the order the text first names it.
 */

/**
 * Longest names first, so "BUILD → FUEL SYSTEM" is not read as a shorter match. The two
 * bare "On TIMING" / "On AFR" forms are older pull-log wording for the spark and fuel
 * tables.
 *
 * @type {{re: RegExp, tab: string, section: string, label: string}[]}
 */
const SCREENS = [
  { re: /\bBUILD (?:→|›|>) FUEL SYSTEM\b/, tab: 'build', section: 'fuel', label: 'BUILD › FUEL SYSTEM' },
  { re: /\bBUILD (?:→|›|>) INDUCTION\b/, tab: 'build', section: 'induction', label: 'BUILD › INDUCTION' },
  { re: /\bBUILD (?:→|›|>) ENGINE\b/, tab: 'build', section: 'engine', label: 'BUILD › ENGINE' },
  { re: /\bBUILD (?:→|›|>) EXHAUST\b/, tab: 'build', section: 'exhaust', label: 'BUILD › EXHAUST' },
  { re: /\bTUNE (?:→|›|>) AIRFLOW\b/, tab: 'tune', section: 'airflow', label: 'TUNE › AIRFLOW' },
  { re: /\bTUNE (?:→|›|>) SPARK\b|\bOn TIMING\b/, tab: 'tune', section: 'spark', label: 'TUNE › SPARK' },
  { re: /\bTUNE (?:→|›|>) FUEL\b(?! SYSTEM)|\bOn AFR\b/, tab: 'tune', section: 'fuel', label: 'TUNE › FUEL' },
  { re: /\bTUNE (?:→|›|>) INJECTORS\b/, tab: 'tune', section: 'injectors', label: 'TUNE › INJECTORS' },
  { re: /\bTUNE (?:→|›|>) SENSORS\b/, tab: 'tune', section: 'sensors', label: 'TUNE › SENSORS' },
  { re: /\bTUNE (?:→|›|>) BOOST\b/, tab: 'tune', section: 'boost', label: 'TUNE › BOOST' },
  { re: /\bTUNE (?:→|›|>) VVT\b/, tab: 'tune', section: 'vvt', label: 'TUNE › VVT' },
  { re: /\bTUNE (?:→|›|>) IDLE\b/, tab: 'tune', section: 'idle', label: 'TUNE › IDLE' },
  { re: /\bTUNE (?:→|›|>) PROTECT\b/, tab: 'tune', section: 'protect', label: 'TUNE › PROTECT' },
  { re: /\bTUNE (?:→|›|>) TORQUE\b/, tab: 'tune', section: 'torque', label: 'TUNE › TORQUE' },
  { re: /\bTUNE (?:→|›|>) NITROUS\b/, tab: 'tune', section: 'nitrous', label: 'TUNE › NITROUS' },
];

/**
 * @param {string|null|undefined} text an event's fix line
 * @returns {{tab: string, section: string, label: string, href: string}[]}
 */
export function fixLinks(text) {
  if (!text) return [];
  return SCREENS
    .map((s) => ({ s, at: text.search(s.re) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(({ s }) => ({ tab: s.tab, section: s.section, label: s.label, href: `#/${s.tab}/${s.section}` }));
}

/**
 * How many of a pull's events send the player to each TUNE page.
 *
 * @param {{fix?: string}[]} events
 * @returns {Record<string, number>} TUNE section id → event count
 */
export function tuneAttention(events) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const e of events ?? []) {
    for (const l of fixLinks(e.fix)) {
      if (l.tab === 'tune') counts[l.section] = (counts[l.section] ?? 0) + 1;
    }
  }
  return counts;
}
