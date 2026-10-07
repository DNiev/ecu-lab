#!/usr/bin/env node
/**
 * Posts one embed to a Discord webhook. Used by the GitHub Actions workflows to say
 * "a release shipped", "the deploy finished" or "CI broke on main" where a maintainer
 * will actually see it.
 *
 * Configured entirely through environment variables, so a workflow step is just `env:` +
 * `run: node scripts/discord-notify.js`:
 *
 *   DISCORD_WEBHOOK   the webhook URL (a repository secret)
 *   TITLE             embed title
 *   URL               link the title points at (the run, the release, the commit)
 *   DESCRIPTION       embed body text
 *   DESCRIPTION_FILE  path to a file holding the body; wins over DESCRIPTION if both set
 *   COLOR             integer, or hex as 0x2ecc71 / #2ecc71
 *   FIELDS            JSON array of { name, value, inline? }
 *   FOOTER            footer text
 *
 * This exists because releases and failed runs otherwise land only in GitHub, where they
 * are easy to miss until someone happens to open the Actions tab.
 *
 * It NEVER fails the job. A missing DISCORD_WEBHOOK is a quiet no-op, so forks and fork
 * PRs (which are not given the secret) stay green; and a Discord outage, a bad FIELDS
 * value or a network error is reported as a workflow warning and exits 0. A notification
 * is a courtesy — it must not be the reason a successful deploy turns red.
 *
 * Plain Node with the built-in `fetch` (Node 20+) and no imports from node_modules, so a
 * job can run it right after `actions/setup-node` without paying for `npm ci`. The
 * webhook URL is a credential and is never printed, not even in an error.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Discord rejects the whole webhook body if any of these is exceeded.
const LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, fields: 25 };
const ELLIPSIS = '…';
const MAX_COLOR = 0xffffff;

/**
 * Cuts `text` to at most `limit` characters, marking the cut with an ellipsis so a reader
 * can tell it was shortened. Text already within the limit is returned untouched.
 * @param {string} text
 * @param {number} limit
 */
function truncate(text, limit) {
  if (text.length <= limit) return text;
  let cut = text.slice(0, limit - 1);
  // Never leave half of a surrogate pair at the end: it serialises to invalid text.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut + ELLIPSIS;
}

/**
 * Text to send, or `undefined` if there is nothing worth sending. Discord rejects empty
 * strings, so "empty" must mean "leave the key out", not "send an empty value".
 * @param {unknown} value
 * @param {number} limit
 */
function text(value, limit) {
  if (value === undefined || value === null) return undefined;
  const s = String(value);
  return s.trim() === '' ? undefined : truncate(s, limit);
}

/**
 * A Discord embed colour (an integer 0..0xFFFFFF), or `undefined` if `value` isn't one.
 * Accepts a number, a decimal string, or hex written 0x2ecc71 / #2ecc71 — workflows pass
 * everything as strings, and hex is what people copy from a colour picker.
 * @param {unknown} value
 */
function parseColor(value) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d+$/.test(s)) n = Number(s);
    else if (/^(0x|#)[0-9a-f]{1,6}$/i.test(s)) n = parseInt(s.replace(/^(0x|#)/i, ''), 16);
  }
  return Number.isInteger(n) && n >= 0 && n <= MAX_COLOR ? n : undefined;
}

/**
 * Builds the webhook body for one embed, clamped to Discord's limits and with every
 * empty optional part left out.
 * @param {{
 *   title?: string, url?: string, description?: string, color?: number | string,
 *   fields?: { name?: string, value?: string, inline?: boolean }[], footer?: string,
 * }} input
 * @returns {{ embeds: Record<string, any>[] }}
 */
export function buildPayload({ title, url, description, color, fields, footer } = {}) {
  /** @type {Record<string, any>} */
  const embed = {};

  const t = text(title, LIMITS.title);
  if (t !== undefined) embed.title = t;
  const u = text(url, Infinity);
  if (u !== undefined) embed.url = u;
  const d = text(description, LIMITS.description);
  if (d !== undefined) embed.description = d;
  const c = parseColor(color);
  if (c !== undefined) embed.color = c;

  // Drop empty fields before applying the cap, so junk never crowds out a real one.
  const kept = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    const name = text(field?.name, LIMITS.fieldName);
    const value = text(field?.value, LIMITS.fieldValue);
    if (name === undefined || value === undefined) continue;
    kept.push(field.inline === undefined ? { name, value } : { name, value, inline: Boolean(field.inline) });
  }
  if (kept.length > 0) embed.fields = kept.slice(0, LIMITS.fields);

  const f = text(footer, LIMITS.footer);
  if (f !== undefined) embed.footer = { text: f };

  return { embeds: [embed] };
}

/**
 * Reports a problem as a workflow warning. One line, because the annotation syntax ends
 * at the first newline.
 * @param {string} message
 */
function warn(message) {
  console.log(`::warning::${message.replace(/\s+/g, ' ').trim()}`);
}

/** Reads the environment, posts the embed, and reports (never throws) on failure. */
async function main() {
  const env = process.env;
  const webhook = env.DISCORD_WEBHOOK?.trim();
  if (!webhook) {
    console.log('::notice::DISCORD_WEBHOOK is not set; skipping Discord notification.');
    return;
  }

  try {
    let fields;
    if (env.FIELDS) {
      try {
        fields = JSON.parse(env.FIELDS);
      } catch (err) {
        throw new Error(`FIELDS is not valid JSON (${err.message})`);
      }
      if (!Array.isArray(fields)) throw new Error('FIELDS must be a JSON array');
    }

    // The file wins so a workflow can hand over text too long or too awkward to quote
    // safely in an env var (a release's notes, a captured log tail).
    const description = env.DESCRIPTION_FILE ? readFileSync(env.DESCRIPTION_FILE, 'utf8') : env.DESCRIPTION;

    const payload = buildPayload({
      title: env.TITLE,
      url: env.URL,
      description,
      color: env.COLOR,
      fields,
      footer: env.FOOTER,
    });

    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Discord responded ${res.status} ${res.statusText} ${body}`);
    }
    console.log('Discord notification sent.');
  } catch (err) {
    // Network errors can echo the request URL, which here is a credential.
    const reason = String(err?.message ?? err).split(webhook).join('[webhook]');
    warn(`Discord notification failed: ${reason}`);
  }
}

// Only when run directly, so importing buildPayload (the tests do) has no side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
