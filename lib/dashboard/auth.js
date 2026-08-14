'use strict';

/**
 * Dashboard auth — pure token + signed-session helpers. No I/O.
 *
 * verifyToken:   timing-safe comparison of a provided login token against the
 *                configured secret.
 * signSession /  HMAC-signed cookie value carrying an issued-at timestamp, so a
 * verifySession: valid session survives page loads but a tampered or expired
 *                cookie is rejected. The secret never leaves the process.
 */

const crypto = require('crypto');

/**
 * Timing-safe equality of the provided login token and the secret.
 *
 * Both sides are hashed to a fixed 32-byte digest before comparison so that
 * crypto.timingSafeEqual never sees mismatched lengths (which would throw and
 * leak length via the exception path). Empty/missing input is rejected.
 *
 * @param {string} provided
 * @param {string} secret
 * @returns {boolean}
 */
function verifyToken(provided, secret) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  if (typeof secret !== 'string' || secret.length === 0) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

// ─── Signed session cookie ──────────────────────────────────────────────────

// Cookie format: base64url(payloadJSON) + '.' + base64url(hmac). The HMAC is
// keyed by the secret, so a client cannot forge or alter the payload without it.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

/**
 * Produce a signed session cookie value for a freshly authenticated operator.
 *
 * @param {string} secret
 * @returns {string} cookie value `payload.signature`
 */
function signSession(secret) {
  const payload = JSON.stringify({ issuedAt: Date.now() });
  const encoded = b64url(payload);
  const sig = b64url(hmac(encoded, secret));
  return `${encoded}.${sig}`;
}

/**
 * Verify a session cookie and return its payload, or null if invalid.
 *
 * Rejects: malformed cookies, tampered payloads / bad signatures (timing-safe),
 * cookies signed with a different secret, and sessions older than the max age.
 *
 * @param {string} cookie
 * @param {string} secret
 * @returns {{ issuedAt: number } | null}
 */
function verifySession(cookie, secret) {
  if (typeof cookie !== 'string' || typeof secret !== 'string' || !secret) return null;
  const dot = cookie.indexOf('.');
  if (dot <= 0 || dot === cookie.length - 1) return null;

  const encoded = cookie.slice(0, dot);
  const provided = cookie.slice(dot + 1);

  let providedSig;
  try {
    providedSig = Buffer.from(provided, 'base64url');
  } catch {
    return null;
  }
  const expectedSig = hmac(encoded, secret);
  if (providedSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(providedSig, expectedSig)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.issuedAt !== 'number') return null;
  if (Date.now() - payload.issuedAt > SESSION_MAX_AGE_MS) return null;

  return payload;
}

module.exports = { verifyToken, signSession, verifySession, SESSION_MAX_AGE_MS };
