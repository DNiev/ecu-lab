/**
 * The endpoint, driven as Discord drives it: signed requests in, a deferred reply out,
 * then an edit to that reply. `fetch`, `waitUntil` and the PNG renderer are stubs, so
 * nothing leaves the machine and resvg is never loaded.
 */

import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { DISCORD_API, createHandler } from '../../bot/lib/handler.js';
import { DynoInputError } from '../../bot/lib/dyno.js';

const { publicKey: pub, privateKey } = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function signedRequest(payload, { tamper = false } = {}) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
  return new Request('https://bot.example/api/interactions', {
    method: 'POST',
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp, 'content-type': 'application/json' },
    body: tamper ? body.replace('}', ',"x":1}') : body,
  });
}

const dynoInteraction = (options) => ({
  type: 2, application_id: 'APP', token: 'TOKEN-SECRET',
  data: { name: 'dyno', options: Object.entries(options).map(([name, value]) => ({ name, value })) },
});

function setup(overrides = {}) {
  const pending = [];
  // Parameters named so the mock's recorded calls are typed as [url, init].
  const fetch = vi.fn(async (_url, _init) => new Response('{}', { status: 200 }));
  const log = { error: vi.fn(), warn: vi.fn() };
  const handle = createHandler({
    publicKey, waitUntil: (p) => pending.push(p), render: () => PNG, fetch, sha: 'abcdef0123', log, ...overrides,
  });
  return { handle, fetch, log, settle: () => Promise.all(pending) };
}

describe('createHandler', () => {
  it('answers Discord\'s PING with a PONG', async () => {
    const { handle } = setup();
    const res = await handle(signedRequest({ type: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('rejects an unsigned or tampered request with 401', async () => {
    const { handle } = setup();
    expect((await handle(new Request('https://x/', { method: 'POST', body: '{"type":1}' }))).status).toBe(401);
    expect((await handle(signedRequest({ type: 1 }, { tamper: true }))).status).toBe(401);
  });

  it('defers /dyno, then edits the reply with the chart attached', async () => {
    const { handle, fetch, settle } = setup();
    const res = await handle(signedRequest(dynoInteraction({ engine: 'vq35hr', intake: true })));
    expect(await res.json()).toEqual({ type: 5 });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${DISCORD_API}/webhooks/APP/TOKEN-SECRET/messages/@original`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBeInstanceOf(FormData);
    const payload = JSON.parse(init.body.get('payload_json'));
    expect(payload.embeds[0].title).toContain('Nissan VQ35HR');
    expect(payload.embeds[0].footer.text).toContain('main @ abcdef0');
    expect(payload.attachments).toEqual([{ id: 0, filename: 'dyno.png' }]);
    const file = init.body.get('files[0]');
    expect(file.type).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it('still replies, without the image, when the chart fails to render', async () => {
    const { handle, fetch, log, settle } = setup({ render: () => { throw new Error('resvg broke'); } });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    const [, init] = fetch.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(payload.attachments).toEqual([]);
    expect(payload.embeds[0].description).toContain("chart couldn't be drawn");
    expect(log.error).toHaveBeenCalled();
  });

  it('explains an option the sim does not know', async () => {
    const { handle, fetch, log, settle } = setup();
    await handle(signedRequest(dynoInteraction({ engine: 'sr20det' })));
    await settle();
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.embeds[0].description).toContain('re-register');
    expect(log.warn).toHaveBeenCalled();
  });

  it('reports a crashed pull as a bug, with the build line', async () => {
    const dyno = () => { throw new Error('NaN everywhere'); };
    const { handle, fetch, log, settle } = setup({ dyno });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.embeds[0].title).toBe('The pull crashed');
    expect(payload.embeds[0].footer.text).toContain('main @ abcdef0');
    expect(log.error).toHaveBeenCalled();
  });

  // Each stub puts the token into what the handler logs, so the test fails if `redact` is
  // removed. A stub that never echoes the URL would pass with or without redaction.
  it('logs a refused edit without ever logging the token', async () => {
    const fetch = vi.fn(async (url, _init) => new Response(`unknown webhook ${url}`, { status: 404 }));
    const { handle, log, settle } = setup({ fetch });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    const logged = JSON.stringify(log.error.mock.calls);
    expect(logged).toContain('404');
    expect(logged).toContain('[token]');
    expect(logged).not.toContain('TOKEN-SECRET');
  });

  it('logs a network failure without ever logging the token', async () => {
    const fetch = vi.fn(async (url, _init) => { throw new Error(`connect failed for ${url}`); });
    const { handle, log, settle } = setup({ fetch });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    const logged = JSON.stringify(log.error.mock.calls);
    expect(logged).toContain('[token]');
    expect(logged).not.toContain('TOKEN-SECRET');
  });

  it('turns away any other command, privately', async () => {
    const { handle } = setup();
    const res = await handle(signedRequest({ type: 2, application_id: 'APP', token: 'T', data: { name: 'other' } }));
    expect(await res.json()).toEqual({ type: 4, data: { content: 'Unknown command.', flags: 64 } });
  });

  it('accepts a DynoInputError from a custom pull too', async () => {
    const dyno = () => { throw new DynoInputError('Unknown fuel "x"', 'x'); };
    const { handle, fetch, settle } = setup({ dyno });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    expect(JSON.parse(fetch.mock.calls[0][1].body).embeds[0].description).toContain('re-register');
  });
});
