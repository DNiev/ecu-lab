/**
 * The `/dyno` endpoint's logic, with its runtime passed in.
 *
 * Discord must hear back within 3 seconds. Two pulls and a chart take about a second, but
 * a cold start can eat the rest, so `/dyno` is answered at once with a deferred reply
 * ("ECU Lab Dyno is thinking…") and the work carries on under `waitUntil`, ending in an
 * edit to that reply. Discord allows 15 minutes for the edit.
 *
 * Everything that touches the outside world comes in as a parameter: `waitUntil` (Vercel's),
 * `render` (resvg, in bot/render.js), `fetch`, `log`. That keeps this file free of the bot's
 * own dependencies, so the root test suite can drive it with stubs.
 *
 * The interaction token in the edit URL is a credential for that one reply. It is never
 * logged.
 */

import { dynoChartSvg } from './chart.js';
import { DynoInputError, runDyno } from './dyno.js';
import { dynoReply, problemReply, replyTitle } from './reply.js';
import { verifyDiscordRequest } from './verify.js';

export const DISCORD_API = 'https://discord.com/api/v10';

// Interaction types Discord sends, and response types it accepts.
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 64;

/** @param {object} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A command's options as `{ name: value }`.
 * @param {{ data?: { options?: { name: string, value: unknown }[] } }} interaction
 */
export function optionsOf(interaction) {
  return Object.fromEntries((interaction.data?.options ?? []).map((o) => [o.name, o.value]));
}

/**
 * @param {{
 *   publicKey: string | undefined,
 *   waitUntil: (p: Promise<unknown>) => void,
 *   render: (svg: string) => Uint8Array | Promise<Uint8Array>,
 *   fetch: typeof globalThis.fetch,
 *   sha?: string,
 *   log?: { error: (...a: any[]) => void, warn: (...a: any[]) => void },
 *   dyno?: typeof runDyno,
 * }} runtime
 * @returns {(request: Request) => Promise<Response>}
 */
export function createHandler({ publicKey, waitUntil, render, fetch, sha, log = console, dyno = runDyno }) {
  return async function handle(request) {
    const body = await request.text();
    const authentic = verifyDiscordRequest({
      publicKey,
      signature: request.headers.get('x-signature-ed25519'),
      timestamp: request.headers.get('x-signature-timestamp'),
      body,
    });
    if (!authentic) return new Response('invalid request signature', { status: 401 });

    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response('bad request', { status: 400 });
    }

    if (interaction.type === PING) return json({ type: PONG });
    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'dyno') {
      waitUntil(completeDyno({ interaction, render, fetch, sha, log, dyno }));
      return json({ type: DEFERRED_CHANNEL_MESSAGE });
    }
    return json({ type: CHANNEL_MESSAGE, data: { content: 'Unknown command.', flags: EPHEMERAL } });
  };
}

/**
 * Runs the pulls, draws the chart and edits the deferred reply. Never throws: whatever
 * goes wrong ends as a reply the tester can read, or a log line if Discord itself can't
 * be reached.
 */
async function completeDyno({ interaction, render, fetch, sha, log, dyno }) {
  const options = optionsOf(interaction);
  let message;
  let png = null;
  try {
    const run = dyno(/** @type {any} */ (options));
    try {
      png = await render(dynoChartSvg({ stock: run.stock, modified: run.modified, title: replyTitle(run) }));
    } catch (err) {
      log.error('dyno: the chart failed to render', err);
    }
    message = dynoReply({ ...run, sha, chart: Boolean(png) });
  } catch (err) {
    if (err instanceof DynoInputError) {
      log.warn(`dyno: ${err.message}`);
      message = problemReply({
        title: "That option isn't in this build",
        description: `${err.message}. The sim on this build doesn't have it, so the command needs to re-register (bot/scripts/register.js).`,
        sha,
      });
    } else {
      log.error('dyno: the pull failed', JSON.stringify(options), err);
      message = problemReply({
        title: 'The pull crashed',
        description: "That's a bug in the sim. Please report it with the line below, and the options you used.",
        sha,
      });
    }
  }
  await editReply({ interaction, message, png, fetch, log });
}

/** PATCHes the deferred reply. Multipart when there's a PNG to attach, JSON otherwise. */
async function editReply({ interaction, message, png, fetch, log }) {
  const url = `${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  /** @type {RequestInit} */
  let init;
  if (png) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(message));
    form.append('files[0]', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'dyno.png');
    init = { method: 'PATCH', body: form };
  } else {
    init = { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) };
  }
  const redact = (/** @type {unknown} */ text) => String(text).split(interaction.token).join('[token]');
  try {
    const res = await fetch(url, init);
    if (!res.ok) log.error(`dyno: Discord refused the edit (${res.status}): ${redact(await res.text())}`);
  } catch (err) {
    log.error(`dyno: could not reach Discord: ${redact(err?.message ?? err)}`);
  }
}
