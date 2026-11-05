/**
 * Discord signs every interaction request with the app's Ed25519 key, and refuses to
 * save an endpoint that accepts an unsigned one. These use a key pair made in the test,
 * so no real key is ever needed.
 */

import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { MAX_CLOCK_SKEW_S, verifyDiscordRequest } from '../../bot/lib/verify.js';

const { publicKey: pub, privateKey } = generateKeyPairSync('ed25519');
// Discord shows the public key as 64 hex characters: the raw 32-byte key.
const publicKey = Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex');
const timestamp = String(Math.floor(Date.now() / 1000));
const body = '{"type":1}';
const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');

describe('verifyDiscordRequest', () => {
  it('accepts a correctly signed request', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body })).toBe(true);
  });

  it('rejects a changed body', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body: '{"type":2}' })).toBe(false);
  });

  it('rejects a request signed by a different key', () => {
    // A forger with their own key pair can produce a perfectly valid signature, just not
    // one that verifies against the application's public key.
    const forger = generateKeyPairSync('ed25519');
    const forged = sign(null, Buffer.from(timestamp + body), forger.privateKey).toString('hex');
    expect(verifyDiscordRequest({ publicKey, signature: forged, timestamp, body })).toBe(false);
  });

  it('rejects a changed timestamp', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp: String(Number(timestamp) + 1), body })).toBe(false);
  });

  it('rejects a changed signature', () => {
    const flipped = (signature[0] === '0' ? '1' : '0') + signature.slice(1);
    expect(verifyDiscordRequest({ publicKey, signature: flipped, timestamp, body })).toBe(false);
  });

  it('rejects a correctly signed request that is no longer fresh', () => {
    // A replay: the signature still checks out, but the request is too old to accept.
    const later = (Number(timestamp) + MAX_CLOCK_SKEW_S + 1) * 1000;
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body, now: later })).toBe(false);
    const earlier = (Number(timestamp) - MAX_CLOCK_SKEW_S - 1) * 1000;
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body, now: earlier })).toBe(false);
    const withinSkew = (Number(timestamp) + MAX_CLOCK_SKEW_S - 1) * 1000;
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body, now: withinSkew })).toBe(true);
  });

  it('rejects a timestamp that is not a whole number of seconds', () => {
    const odd = `${timestamp}.5`;
    const signed = sign(null, Buffer.from(odd + body), privateKey).toString('hex');
    expect(verifyDiscordRequest({ publicKey, signature: signed, timestamp: odd, body })).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyDiscordRequest({ publicKey, signature: null, timestamp, body })).toBe(false);
    expect(verifyDiscordRequest({ publicKey, signature, timestamp: undefined, body })).toBe(false);
  });

  it('rejects, without throwing, a malformed key or signature', () => {
    expect(verifyDiscordRequest({ publicKey: 'not hex', signature, timestamp, body })).toBe(false);
    expect(verifyDiscordRequest({ publicKey: publicKey.slice(2), signature, timestamp, body })).toBe(false);
    expect(verifyDiscordRequest({ publicKey: undefined, signature, timestamp, body })).toBe(false);
    expect(verifyDiscordRequest({ publicKey, signature: 'abc', timestamp, body })).toBe(false);
  });
});
