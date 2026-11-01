/**
 * Discord signs every interaction request with the app's Ed25519 key, and refuses to
 * save an endpoint that accepts an unsigned one. These use a key pair made in the test,
 * so no real key is ever needed.
 */

import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyDiscordRequest } from '../../bot/lib/verify.js';

const { publicKey: pub, privateKey } = generateKeyPairSync('ed25519');
// Discord shows the public key as 64 hex characters: the raw 32-byte key.
const publicKey = Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex');
const timestamp = '1730000000';
const body = '{"type":1}';
const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');

describe('verifyDiscordRequest', () => {
  it('accepts a correctly signed request', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body })).toBe(true);
  });

  it('rejects a changed body', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body: '{"type":2}' })).toBe(false);
  });

  it('rejects a changed timestamp', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp: '1730000001', body })).toBe(false);
  });

  it('rejects a changed signature', () => {
    const flipped = (signature[0] === '0' ? '1' : '0') + signature.slice(1);
    expect(verifyDiscordRequest({ publicKey, signature: flipped, timestamp, body })).toBe(false);
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
