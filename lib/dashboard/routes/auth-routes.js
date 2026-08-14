'use strict';

/**
 * Auth routes — login form, login submit (rate-limited), and logout.
 *
 * Modular feature router (thin wiring). The login POST is the one endpoint that
 * cannot carry a CSRF token (no session exists yet); it is protected instead by
 * the secret token, the action-keyed rate limiter, and the SameSite=strict
 * cookie. Every other state change is CSRF-guarded.
 */

const express = require('express');
const auth = require('../auth');
const views = require('../views');
const {
  SESSION_COOKIE,
  clientIp,
  makeAuthGuard,
  makeCsrfGuard,
} = require('../middleware');

const SESSION_MAX_AGE_MS = auth.SESSION_MAX_AGE_MS;

function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure, // true behind Railway's HTTPS (trust proxy set on the app)
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

function loginTimeCT() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());
}

/**
 * @param {object} deps
 * @param {string} deps.secret
 * @param {object} deps.discord      adapter (uses sendDM for the login-alert)
 * @param {object} deps.audit        lib/audit-log
 * @param {string} deps.operatorId   Discord user ID to DM on login
 * @param {object} deps.rateLimiter  makeRateLimiter() instance
 */
function makeAuthRoutes({ secret, discord, audit, operatorId, rateLimiter }) {
  const router = express.Router();
  const authGuard = makeAuthGuard(secret);
  const csrfGuard = makeCsrfGuard(secret);

  // GET /login — show the form (redirect to dashboard if already signed in).
  router.get('/login', (req, res) => {
    if (auth.verifySession(req.cookies?.[SESSION_COOKIE], secret)) {
      return res.redirect('/');
    }
    res.set('Cache-Control', 'no-store');
    res.send(views.loginPage({}));
  });

  // POST /login — verify the token, set the signed session, alert the operator.
  router.post('/login', rateLimiter.limit('login'), (req, res) => {
    const ip = clientIp(req);
    if (!auth.verifyToken(req.body?.token, secret)) {
      audit.record('login', { ip }, 'failure');
      res.status(401);
      return res.send(views.loginPage({ error: 'Incorrect token.' }));
    }

    res.cookie(SESSION_COOKIE, auth.signSession(secret), sessionCookieOptions(req));
    audit.record('login', { ip }, 'success');

    // Login-alert DM — a security tripwire and early proof of the dashboard→Discord
    // send path v2 relies on. Fire-and-forget so a DM hiccup never blocks login.
    if (operatorId) {
      Promise.resolve(discord.sendDM(operatorId, `🔐 Dashboard login at ${loginTimeCT()} CT`))
        .catch(err => console.error('[dashboard] login-alert DM failed:', err.message));
    }

    res.redirect('/');
  });

  // POST /logout — clear the session (guarded + CSRF-checked).
  router.post('/logout', authGuard, csrfGuard, (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect('/login');
  });

  return router;
}

module.exports = { makeAuthRoutes };
