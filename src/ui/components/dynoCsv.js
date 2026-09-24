/**
 * The dyno sheet, as a file you can take away.
 *
 * Every tuning tool that logs a pull lets you export it, because the log is the
 * evidence: it is what you diff between two tunes, what you hand to someone else, and
 * what you keep after the session is gone. A log you can only look at is half a log.
 *
 * The columns are the datalog's own, in the order the screen reads them — what you
 * asked for beside what the engine did — and then the cycle quantities underneath,
 * which is the part a spreadsheet is actually better at than a gauge.
 */

/**
 * Columns written, in order: the CSV header and the point field it reads.
 *
 * Kept as data rather than inlined so a test can assert the shape without parsing a
 * string, and so adding a datalog field is one line here rather than three.
 */
/** @type {[string, string][]} */
export const DYNO_COLUMNS = [
  ['rpm', 'rpm'],
  ['hp', 'hp'],
  ['torque_lbft', 'torque'],
  ['map_kpa', 'map'],
  ['boost_psi', 'boostPsi'],
  // Asked beside got — the three pairs the DATALOG screen is built around.
  ['ve_table_pct', 'veTable'],
  ['ve_actual_pct', 've'],
  ['timing_commanded_deg', 'commandedTiming'],
  ['timing_actual_deg', 'timing'],
  ['afr_commanded', 'afrCommanded'],
  ['afr_actual', 'afr'],
  ['lambda', 'lambda'],
  // What the ECU was doing about it. The flag is `knockPull > 0` and so carries nothing
  // the retard column does not, but it carries it in the form the question is asked in:
  // how many points knocked is SUM(knock), against a COUNTIF with a threshold in it
  // that a reader has to get right. It is also the datalog's own flag, and a column
  // that disagrees with the screen is a column people stop trusting.
  ['knock', 'knock'],
  ['knock_pull_deg', 'knockPull'],
  ['knock_threshold_deg', 'threshold'],
  ['knock_integral', 'knockIntegral'],
  ['mbt_deg', 'mbtIdeal'],
  ['injector_duty_pct', 'duty'],
  ['pulse_width_ms', 'pw'],
  ['maf_gps', 'maf'],
  ['fuel_trim_pct', 'trimPct'],
  // The cycle itself — the numbers no gauge has room for.
  ['iat_c', 'iat'],
  ['egt_c', 'egt'],
  ['emp_kpa', 'emp'],
  ['peak_pressure_bar', 'peakPressure'],
  ['peak_pressure_deg_atdc', 'peakPressureDeg'],
  ['mfb50_deg_atdc', 'mfb50'],
  ['burn_duration_deg', 'burnDeg'],
  ['residual_fraction', 'residualFrac'],
  ['effective_cr', 'effectiveCr'],
  ['end_gas_k', 'endGasK'],
  ['imep_bar', 'imep'],
  ['bmep_bar', 'bmep'],
  ['pmep_bar', 'pmep'],
  ['fmep_bar', 'fmep'],
  ['bsfc', 'bsfc'],
];

/**
 * One CSV cell.
 *
 * Booleans go out as 0/1 rather than "true"/"false" so a spreadsheet can sum them —
 * counting the knocking points in a pull is a thing people actually do. Anything that
 * could carry a comma or a quote is quoted and its quotes doubled, per RFC 4180;
 * nothing in the datalog does today, but a CSV writer that assumes its input is tame
 * is a CSV writer that corrupts a file later.
 *
 * @param {unknown} v
 * @returns {string}
 */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The sweep as RFC 4180 CSV, header row first.
 *
 * @param {object[]} points the pull's points, in RPM order
 * @param {[string, string][]} [columns] defaults to {@link DYNO_COLUMNS}
 * @returns {string}
 */
export function sweepToCsv(points, columns = DYNO_COLUMNS) {
  const head = columns.map(([name]) => name).join(',');
  const rows = points.map((p) => columns.map(([, key]) => cell(p[key])).join(','));
  // Trailing newline: POSIX text files end with one, and its absence is why some
  // tools report the last row as malformed.
  return `${[head, ...rows].join('\n')}\n`;
}

/**
 * A filename that says what the pull was, so a folder of these stays readable.
 *
 * The stamp is the local clock, not UTC. These files are named for the moment you ran
 * the pull, and the only clock you can check that against is the one on your own wall —
 * a UTC stamp reads as the wrong hour, or on an evening pull as the wrong day, and a
 * stamp you have to convert before you trust it is one you misread instead.
 *
 * @param {object} input
 * @param {string} [input.engineName]
 * @param {Date} [input.at]
 * @returns {string}
 */
export function dynoSheetFilename({ engineName = 'engine', at = new Date() } = {}) {
  const slug = engineName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'engine';
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = [at.getFullYear(), pad(at.getMonth() + 1), pad(at.getDate()),
    pad(at.getHours()), pad(at.getMinutes())].join('-');
  return `eculab-dyno-${slug}-${stamp}.csv`;
}

/**
 * Hands the browser a file.
 *
 * Split from {@link sweepToCsv} so the part worth testing is a pure string function and
 * the part that cannot be tested in jsdom is four lines with no logic in them. The
 * object URL is revoked on the next frame rather than immediately: Safari has been
 * known to cancel a download whose URL is revoked in the same tick as the click.
 *
 * @param {string} text file contents
 * @param {string} filename
 */
export function downloadCsv(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.requestAnimationFrame(() => URL.revokeObjectURL(url));
}
