'use strict';

/**
 * Dashboard server factory — the embedded Express app.
 *
 * makeDashboardServer({ discord, repo, config, audit, secret, operatorId })
 * returns { app, start(port), stop() }. Dependencies are injected (same
 * adapter-injection philosophy as makeDiscordAdapter / makeBookeoAdapter), so
 * the server is assembled from testable pieces. `discord` is ALWAYS the
 * makeDiscordAdapter instance — the web layer never touches the raw client.
 *
 * This module is thin wiring and is not unit-tested (per PRD #113); its logic
 * lives in the injected deep modules (auth.js, audit-log.js) which are tested.
 */

const express = require('express');
const { cookieParser, makeRateLimiter } = require('./middleware');
const { makeRouter } = require('./routes');

/**
 * @param {object}  deps
 * @param {object}  deps.discord      makeDiscordAdapter instance (required)
 * @param {string}  deps.secret       DASHBOARD_SECRET (required; no secret => caller must not start)
 * @param {object}  deps.audit        lib/audit-log
 * @param {object}  [deps.repo]       dashboard-repository (read models)
 * @param {object}  [deps.config]     lib/config (used by later slices)
 * @param {string}  [deps.operatorId] Discord user ID to DM on login
 * @param {object}  [deps.rateLimiter] override the default limiter (tests)
 */
function makeDashboardServer(deps) {
  if (!deps || !deps.secret) {
    throw new Error('makeDashboardServer requires a secret');
  }
  if (!deps.discord) {
    throw new Error('makeDashboardServer requires a discord adapter');
  }

  const rateLimiter = deps.rateLimiter || makeRateLimiter();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway terminates TLS at its proxy (X-Forwarded-*)

  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser);

  app.use('/', makeRouter({ ...deps, rateLimiter }));

  let server = null;

  function start(port) {
    return new Promise((resolve) => {
      server = app.listen(port, () => {
        console.log(`[dashboard] listening on port ${port}`);
        resolve(server);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server = null;
    });
  }

  return { app, start, stop };
}

module.exports = { makeDashboardServer };
