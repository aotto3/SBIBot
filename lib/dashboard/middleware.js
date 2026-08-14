'use strict';

/**
 * Dashboard middleware — thin Express wiring (not unit-tested per PRD #113).
 *
 * Provides the cross-cutting pieces every dashboard route depends on:
 *   - cookie parsing (Express core does not parse cookies)
 *   - session auth guard (redirects unauthenticated requests to the login page)
 *   - a general action-keyed rate limiter (used for login now, reuse for v2 sends)
 *   - CSRF protection for state-changing POSTs (stateless, derived from the
 *     signed session + secret; login POST is necessarily exempt — no session yet)
 *
 * The auth/session crypto itself lives in and is tested via lib/dashboard/auth.js.
 */

const crypto = require('crypto');
const auth = require('./auth');

const SESSION_COOKIE = 'sbi_dash_session';

// ─── Cookie parsing ─────────────────────────────────────────────────────────

/** Populate req.cookies from the Cookie header. */
function cookieParser(req, _res, next) {
  const header = req.headers.cookie;
  const out = {};
  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  }
  req.cookies = out;
  next();
}

// ─── Client IP (behind Railway's proxy) ─────────────────────────────────────

function clientIp(req) {
  // server.js sets `trust proxy`, so req.ip already reflects X-Forwarded-For.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// ─── Auth guard ─────────────────────────────────────────────────────────────

/**
 * Build the middleware that protects every route below it: a valid signed
 * session cookie sets req.session and calls next(); otherwise redirect to /login.
 */
function makeAuthGuard(secret) {
  return function authGuard(req, res, next) {
    const session = auth.verifySession(req.cookies?.[SESSION_COOKIE], secret);
    if (!session) return res.redirect('/login');
    req.session = session;
    next();
  };
}

// ─── Rate limiter (general, keyed by action) ────────────────────────────────

/**
 * Fixed-window rate limiter, keyed by `action:ip`. Returns middleware factories
 * so the same limiter is reused across actions (login now; sends/writes in v2).
 *
 * @param {{ windowMs?: number, max?: number }} [opts]
 */
function makeRateLimiter({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const buckets = new Map(); // key -> { count, resetAt }

  function limit(action) {
    return function rateLimit(req, res, next) {
      const key = `${action}:${clientIp(req)}`;
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > max) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).send(
          `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`
        );
      }
      next();
    };
  }

  return { limit, _buckets: buckets };
}

// ─── CSRF (stateless, tied to the session) ──────────────────────────────────

/**
 * Derive a CSRF token from the session + secret. Stateless: recomputable on any
 * request that carries a valid session, unforgeable without the secret.
 */
function csrfToken(session, secret) {
  const material = `csrf:${session?.issuedAt ?? ''}`;
  return crypto.createHmac('sha256', secret).update(material).digest('base64url');
}

/**
 * Middleware verifying the `_csrf` form field against the session-derived token
 * on state-changing POSTs. Requires req.session (mount below the auth guard).
 */
function makeCsrfGuard(secret) {
  return function csrfGuard(req, res, next) {
    const expected = csrfToken(req.session, secret);
    const provided = req.body?._csrf;
    if (
      typeof provided === 'string' &&
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      return next();
    }
    return res.status(403).send('Invalid CSRF token. Reload the page and try again.');
  };
}

module.exports = {
  SESSION_COOKIE,
  cookieParser,
  clientIp,
  makeAuthGuard,
  makeRateLimiter,
  csrfToken,
  makeCsrfGuard,
};
