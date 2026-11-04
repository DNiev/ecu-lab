/**
 * The URL Discord calls for `/dyno`. All the logic is in lib/handler.js; this file only
 * hands it the runtime: Vercel's `waitUntil`, the resvg renderer, `fetch`, and the two
 * environment variables (DISCORD_PUBLIC_KEY, set in the Vercel project, which is public by
 * design; VERCEL_GIT_COMMIT_SHA, which Vercel sets).
 */

import { waitUntil } from '@vercel/functions';
import { createHandler } from '../lib/handler.js';

const handle = createHandler({
  publicKey: process.env.DISCORD_PUBLIC_KEY,
  waitUntil,
  // Loaded on first use, inside the deferred work: resvg's native binary stays off the
  // path that has to answer Discord within 3 seconds.
  render: async (svg) => (await import('../render.js')).svgToPng(svg),
  fetch: globalThis.fetch,
  sha: process.env.VERCEL_GIT_COMMIT_SHA,
});

/** @param {Request} request */
export function POST(request) {
  return handle(request);
}
