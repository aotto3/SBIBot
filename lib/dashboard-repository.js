'use strict';

/**
 * Dashboard repository — the dashboard's read/write data layer.
 *
 * Mirrors lib/coverage-repository.js: a clean, domain-shaped seam over lib/db.js
 * (and, later, coverage-repository.js) so route handlers never touch db directly.
 * The walking skeleton needs only one read — recent audit activity for the health
 * page — but the module exists now so #116–#120 grow it in place rather than
 * retrofitting a data layer.
 */

const audit = require('./audit-log');

/** Most-recent operator actions, shaped for the health page's activity feed. */
function recentActivity(limit = 8) {
  return audit.list(limit).map(row => ({
    action:     row.action,
    result:     row.result,
    created_at: row.created_at,
  }));
}

module.exports = { recentActivity };
