/**
 * The Discord messages `/dyno` replies with.
 *
 * A reply leads with the two peaks and how they moved against stock, then the pull log's
 * worst warnings: that pairing is the lesson. Bolting parts onto a factory tune buys
 * little and costs a mixture problem, and the reply should show both in one glance. Each
 * warning's `cause` and `fix` stay in the app; a chat message is for noticing, the app is
 * for understanding.
 *
 * Embeds go through `buildPayload` from scripts/discord-notify.js, so Discord's length
 * limits are enforced by the same code the workflows use.
 */

import { MOD_INFO, OCTANE_OPTS } from '../../src/sim/index.js';
import { tokens } from '../../src/ui/tokens.js';
import { buildPayload } from '../../scripts/discord-notify.js';
import { MOD_KEYS } from './dyno.js';

/** How many pull-log events a reply lists before counting the rest. */
export const MAX_EVENTS = 3;

/** A token's `#rrggbb` as the integer Discord wants. */
const embedColour = (/** @type {string} */ hex) => parseInt(hex.slice(1), 16);

/**
 * A whole-number difference with its sign. A real minus sign (U+2212), as a printed
 * dyno sheet would have it, and ±0 for no change.
 * @param {number} n
 */
export function signed(n) {
  const r = Math.round(n);
  if (r > 0) return `+${r}`;
  if (r < 0) return `−${-r}`;
  return '±0';
}

/**
 * `<engine> · <what changed> · factory tune`.
 * @param {{ preset: any, mods: Record<string, boolean>, fuel: { label: string } }} run
 */
export function replyTitle({ preset, mods, fuel }) {
  const changes = [];
  for (const k of MOD_KEYS) {
    if (mods[k] && !preset.mods[k]) changes.push(MOD_INFO[k].label);
    if (!mods[k] && preset.mods[k]) changes.push(`no ${MOD_INFO[k].label}`);
  }
  if (fuel.label !== OCTANE_OPTS[preset.parts.octaneIdx].label) changes.push(fuel.label);
  return `${preset.name} · ${changes.length ? changes.join(' + ') : 'stock'} · factory tune`;
}

/**
 * Which sim answered. On `main`, BUILD_VERSION still names the last release, so the
 * commit is the only honest build id for a tester's bug report.
 * @param {string} [sha]
 */
export function footerText(sha) {
  return sha ? `main @ ${sha.slice(0, 7)} (unreleased) · ECU Lab sim` : 'local build · ECU Lab sim';
}

/**
 * Events worst first; equal severities keep the order the sim logged them.
 * @template {{ severity: number }} T
 * @param {T[]} events
 * @returns {T[]}
 */
function worstFirst(events) {
  return events.map((e, i) => ({ e, i })).sort((a, b) => (b.e.severity - a.e.severity) || (a.i - b.i)).map(({ e }) => e);
}

/**
 * The reply to a pull that ran.
 * @param {{ preset: any, mods: Record<string, boolean>, fuel: { label: string }, isStock: boolean,
 *   stock: { peakHp: number, peakTq: number }, modified: { peakHp: number, peakTq: number, events: any[] },
 *   sha?: string, chart: boolean }} run
 */
export function dynoReply({ preset, mods, fuel, isStock, stock, modified, sha, chart }) {
  const hp = Math.round(modified.peakHp);
  const tq = Math.round(modified.peakTq);
  // Differences are taken between the rounded figures, so they always agree with the
  // numbers printed next to them.
  const lines = [isStock
    ? `**${hp} whp** · **${tq} lb-ft**`
    : `**${hp} whp** (${signed(hp - Math.round(stock.peakHp))} vs stock) · **${tq} lb-ft** (${signed(tq - Math.round(stock.peakTq))})`];

  const events = worstFirst(modified.events);
  if (events.length === 0) lines.push('Clean pull, no warnings.');
  for (const e of events.slice(0, MAX_EVENTS)) lines.push(`${e.severity >= 3 ? '🛑' : '⚠️'} ${e.msg}`);
  if (events.length > MAX_EVENTS) lines.push(`…and ${events.length - MAX_EVENTS} more in the app`);
  if (!chart) lines.push("_The chart couldn't be drawn this time._");

  const worst = Math.max(0, ...modified.events.map((e) => e.severity));
  const colour = worst >= 3 ? tokens.danger : worst >= 1 ? tokens.warn : tokens.ok;

  const { embeds: [embed] } = buildPayload({
    title: replyTitle({ preset, mods, fuel }),
    description: lines.join('\n'),
    color: embedColour(colour),
    footer: footerText(sha),
  });
  if (chart) embed.image = { url: 'attachment://dyno.png' };
  return {
    embeds: [embed],
    attachments: chart ? [{ id: 0, filename: 'dyno.png' }] : [],
    // Nothing in a reply should ever ping anyone, whatever text a pull log contains.
    allowed_mentions: { parse: [] },
  };
}

/**
 * The reply when there is no pull to show: a bad option or a crash.
 * @param {{ title: string, description: string, sha?: string }} problem
 */
export function problemReply({ title, description, sha }) {
  const { embeds } = buildPayload({ title, description, color: embedColour(tokens.danger), footer: footerText(sha) });
  return { embeds, attachments: [], allowed_mentions: { parse: [] } };
}
