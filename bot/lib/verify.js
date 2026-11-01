/**
 * Checks that a request really came from Discord.
 *
 * The endpoint is a public URL, so anyone can POST to it. Discord signs each request with
 * the app's Ed25519 private key over `timestamp + body`; checking that signature against
 * the app's public key is the only thing standing between the endpoint and anyone who
 * finds the URL. Discord also tests this when the URL is saved, and refuses an endpoint
 * that accepts a request with a bad signature.
 *
 * Node's own crypto does Ed25519, so this needs no dependency. Discord gives the public key
 * as 64 hex characters (the raw 32-byte key); Node wants a key object, which a JWK with that
 * key as `x` provides.
 */

import { createPublicKey, verify } from 'node:crypto';

const HEX_KEY = /^[0-9a-f]{64}$/i;
const HEX_SIGNATURE = /^[0-9a-f]{128}$/i;

/**
 * @param {{ publicKey?: string | null, signature?: string | null, timestamp?: string | null, body: string }} request
 * @returns {boolean} true only for a well-formed, correctly signed request
 */
export function verifyDiscordRequest({ publicKey, signature, timestamp, body }) {
  if (!publicKey || !HEX_KEY.test(publicKey)) return false;
  if (!signature || !HEX_SIGNATURE.test(signature)) return false;
  if (!timestamp) return false;
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'hex').toString('base64url') },
      format: 'jwk',
    });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    // A key Node cannot load is a misconfiguration, not a valid request.
    return false;
  }
}
