'use strict';

/**
 * Health route — the authenticated landing page: live uptime + Discord status,
 * plus a small recent-activity feed proving the read-model seam end to end.
 *
 * Mounted below the global auth guard, so req.session is always present here.
 */

const express = require('express');
const views = require('../views');
const { csrfToken } = require('../middleware');

function humanizeUptime(seconds) {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function nowCT() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());
}

/**
 * @param {object} deps
 * @param {string} deps.secret
 * @param {object} deps.discord   adapter (uses getStatus())
 * @param {object} deps.repo      dashboard-repository (recentActivity())
 */
function makeHealthRoutes({ secret, discord, repo }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    let activity = [];
    try {
      activity = repo?.recentActivity ? repo.recentActivity(8) : [];
    } catch (err) {
      console.error('[dashboard] recentActivity read failed:', err.message);
    }

    res.set('Cache-Control', 'no-store');
    res.send(views.healthPage({
      uptime:  humanizeUptime(process.uptime()),
      discord: discord.getStatus(),
      now:     nowCT(),
      csrf:    csrfToken(req.session, secret),
      activity,
    }));
  });

  return router;
}

module.exports = { makeHealthRoutes };
