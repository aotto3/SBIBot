'use strict';

/**
 * Route assembly — mounts the feature routers in the right order.
 *
 * Auth routes (public login, self-guarded logout) come first; then the global
 * auth guard; then every protected feature router below it. Later slices add
 * their routers under the guard here (roster, coverage, check-ins, config, …).
 */

const express = require('express');
const { makeAuthGuard } = require('../middleware');
const { makeAuthRoutes } = require('./auth-routes');
const { makeHealthRoutes } = require('./health-routes');

function makeRouter(deps) {
  const router = express.Router();

  // Public / self-guarded auth endpoints.
  router.use('/', makeAuthRoutes(deps));

  // Everything below requires a valid session.
  router.use(makeAuthGuard(deps.secret));

  // Protected feature routers.
  router.use('/', makeHealthRoutes(deps));

  return router;
}

module.exports = { makeRouter };
