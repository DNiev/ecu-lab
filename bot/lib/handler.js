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

/**
 * How long to wait, after handing back the deferral, before the work starts.
 *
 * The pulls and the renderer are synchronous CPU work (about 300 ms or more) that blocks
 * the event loop. Starting them in a microtask would not help: microtasks run before the
 * runtime gets another turn, so they would block the loop before the `{type: 5}` response
 * was flushed to the socket. That eats Discord's 3-second budget, and lets the edit reach
 * Discord before the reply it edits exists (a 404, leaving "thinking…" on screen forever).
 * A timer lets the response go out first. The delay is slack for the runtime to write it.
 *
 * The timer only protects this request's own deferral. Another request on the same
 * instance would wait behind the work, so `vercel.json` turns Fluid compute off: each
 * instance then serves one request at a time, and a second tester gets an instance of
 * their own instead of queueing past Discord's 3 seconds.
 */
export const WORK_START_DELAY_MS = 100;

/**
 * Belt and braces: if Discord still answers 404 to the edit (the deferral hadn't landed
 * yet), wait this long and try once more before giving up.
 */
export const EDIT_RETRY_DELAY_MS = 1000;

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
  // Checked once, at creation (a cold start on Vercel). A bad key makes every request fail
  // closed with 401, and the rejection itself is deliberately never logged (Discord's own
  // endpoint check sends a bad signature on purpose), so without this line the first deploy
  // would fail with nothing in the function log. The key is public, but only its state is
  // printed, never its value.
  if (typeof publicKey !== 'string' || !/^[0-9a-f]{64}$/i.test(publicKey)) {
    const problem = typeof publicKey === 'string' && publicKey !== ''
      ? `is malformed (${publicKey.length} characters, expected 64 hex)`
      : 'is missing';
    log.error(
      `dyno: DISCORD_PUBLIC_KEY ${problem}, so every request will be rejected with 401. ` +
      'Set it in the Vercel project (Settings, Environment Variables), then Redeploy: ' +
      'environment variables only reach new deployments.',
    );
  }

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
      // A timer, not a bare call: see WORK_START_DELAY_MS for why the work must wait.
      waitUntil(
        new Promise((resolve) => setTimeout(resolve, WORK_START_DELAY_MS)).then(() =>
          completeDyno({ interaction, render, fetch, sha, log, dyno }),
        ),
      );
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
  let options;
  let message;
  let png = null;
  try {
    options = optionsOf(interaction);
    const run = dyno(/** @type {any} */ (options));
    try {
      png = await render(dynoChartSvg({ stock: run.stock, modified: run.modified, isStock: run.isStock, title: replyTitle(run) }));
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

/**
 * PATCHes the deferred reply. Multipart when there's a PNG to attach, JSON otherwise. A 404
 * is retried once after EDIT_RETRY_DELAY_MS, in case the edit overtook the deferral.
 */
async function editReply({ interaction, message, png, fetch, log }) {
  const url = `${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  // Built per attempt: a request body is consumed when sent, so a retry needs a fresh one.
  const makeInit = () => {
    if (png) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(message));
      form.append('files[0]', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'dyno.png');
      return /** @type {RequestInit} */ ({ method: 'PATCH', body: form });
    }
    return /** @type {RequestInit} */ ({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) });
  };
  const redact = (/** @type {unknown} */ text) => String(text).split(interaction.token).join('[token]');
  try {
    let res = await fetch(url, makeInit());
    if (res.status === 404) {
      // Release the refused response's connection rather than leaving it for the GC.
      await res.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, EDIT_RETRY_DELAY_MS));
      res = await fetch(url, makeInit());
    }
    if (!res.ok) log.error(`dyno: Discord refused the edit (${res.status}): ${redact(await res.text())}`);
  } catch (err) {
    log.error(`dyno: could not reach Discord: ${redact(err?.message ?? err)}`);
  }
}
