'use strict';

/**
 * Unit tests for lib/dashboard/auth.js — pure token + signed-session helpers.
 * Run with: node --test test/dashboard-auth.test.js
 *
 * No I/O: verifyToken is a timing-safe compare; signSession/verifySession are
 * HMAC-signed cookie helpers. Nothing here touches the DB, Discord, or Bookeo.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../lib/dashboard/auth');

const SECRET = 'super-secret-token-value';

// ─── verifyToken ────────────────────────────────────────────────────────────

test('verifyToken — accepts the correct token', () => {
  assert.equal(auth.verifyToken(SECRET, SECRET), true);
});

test('verifyToken — rejects a wrong token', () => {
  assert.equal(auth.verifyToken('wrong-token', SECRET), false);
});

test('verifyToken — rejects a token that is a prefix of the secret', () => {
  assert.equal(auth.verifyToken(SECRET.slice(0, -1), SECRET), false);
});

test('verifyToken — rejects empty / missing / non-string input', () => {
  assert.equal(auth.verifyToken('', SECRET), false);
  assert.equal(auth.verifyToken(undefined, SECRET), false);
  assert.equal(auth.verifyToken(null, SECRET), false);
  assert.equal(auth.verifyToken(SECRET, ''), false);
});

// ─── signSession / verifySession ────────────────────────────────────────────

test('signSession + verifySession — round-trips a valid cookie', () => {
  const cookie = auth.signSession(SECRET);
  assert.equal(typeof cookie, 'string');
  assert.ok(cookie.length > 0);
  const session = auth.verifySession(cookie, SECRET);
  assert.ok(session, 'expected a truthy session object');
  assert.equal(typeof session.issuedAt, 'number');
});

test('verifySession — rejects a cookie signed with a different secret', () => {
  const cookie = auth.signSession(SECRET);
  assert.equal(auth.verifySession(cookie, 'a-different-secret'), null);
});

test('verifySession — rejects a tampered payload', () => {
  const cookie = auth.signSession(SECRET);
  const sig = cookie.split('.')[1];
  // Keep the original signature but swap in a clearly-different payload —
  // the signature no longer matches the payload it's paired with.
  const forgedPayload = Buffer.from(JSON.stringify({ issuedAt: 1 })).toString('base64url');
  const tampered = `${forgedPayload}.${sig}`;
  assert.notEqual(tampered, cookie);
  assert.equal(auth.verifySession(tampered, SECRET), null);
});

test('verifySession — rejects malformed / unsigned cookies', () => {
  assert.equal(auth.verifySession('', SECRET), null);
  assert.equal(auth.verifySession('no-dot-here', SECRET), null);
  assert.equal(auth.verifySession('.', SECRET), null);
  assert.equal(auth.verifySession('payload.', SECRET), null);
  assert.equal(auth.verifySession('.sig', SECRET), null);
  assert.equal(auth.verifySession(undefined, SECRET), null);
});

test('verifySession — rejects an expired session', () => {
  const cookie = auth.signSession(SECRET);
  // Roll the clock forward past the max age via a stubbed Date.now.
  const realNow = Date.now;
  Date.now = () => realNow() + auth.SESSION_MAX_AGE_MS + 1000;
  try {
    assert.equal(auth.verifySession(cookie, SECRET), null);
  } finally {
    Date.now = realNow;
  }
});
