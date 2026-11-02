/**
 * The URL Discord calls for `/dyno`. All the logic is in lib/handler.js; this file only
 * hands it the runtime: Vercel's `waitUntil`, the resvg renderer, `fetch`, and the two
 * environment variables (DISCORD_PUBLIC_KEY, set in the Vercel project, which is public by
 * design; VERCEL_GIT_COMMIT_SHA, which Vercel sets).
 */

import { waitUntil } from '@vercel/functions';
import { createHandler } from '../lib/handler.js';
import { svgToPng } from '../render.js';

const handle = createHandler({
  publicKey: process.env.DISCORD_PUBLIC_KEY,
  waitUntil,
  render: svgToPng,
  fetch: globalThis.fetch,
  sha: process.env.VERCEL_GIT_COMMIT_SHA,
});

/** @param {Request} request */
export function POST(request) {
  return handle(request);
}
