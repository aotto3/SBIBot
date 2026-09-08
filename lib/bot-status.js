'use strict';

/**
 * /bot-status — the pure render behind the owner-only health command (PRD #153).
 *
 * `buildStatusEmbed(snapshot, { now })` turns a plain snapshot object into a
 * Discord embed object (same shape as coverage-stats: `{ title, color, fields }`).
 * It performs no I/O, reads no clock, and touches no Discord client — the command
 * file assembles the snapshot from live sources and calls this.
 *
 * Snapshot shape (sections are optional; each slice fills more in):
 *   {
 *     health: { uptimeSec, discord: 'ready'|'connecting'|'disconnected',
 *               bookeo: 'reachable'|'stale'|'unreachable' },
 *     jobs:   [ { key, label, nextRun: epochMs|null,
 *                 lastRun?: { status:'ok'|'error', finishedAtMs, durationMs, error? } } ],
 *     errors: [ { at: epochMs, context, message } ],        // slice #159
 *     counts: { ... },                                       // slice #160
 *   }
 *
 * Times are rendered as Discord timestamp tags (`<t:unix:R>`) so the embed stays
 * live and the render is deterministic given a fixed snapshot.
 */

const COLOR = {
  healthy:  0x2ecc71, // green
  degraded: 0xf1c40f, // amber
  down:     0xe74c3c, // red
};

const DISCORD_LABEL = {
  ready:        '🟢 connected',
  connecting:   '🟡 connecting',
  disconnected: '🔴 disconnected',
};

const BOOKEO_LABEL = {
  reachable:   '🟢 reachable',
  stale:       '🟡 stale (serving cache)',
  unreachable: '🔴 unreachable',
};

// How many recent errors to show in the feed.
const MAX_ERRORS = 5;

/** Truncate a string to `max` chars with an ellipsis. */
function _truncate(str, max) {
  const s = String(str ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Human-friendly uptime, e.g. "2d 3h 15m" (always shows minutes). */
function _fmtUptime(sec) {
  let s = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600);  s %= 3600;
  const m = Math.floor(s / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/** Compact duration for a job run, e.g. "820ms" or "3.4s" or "1m 05s". */
function _fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  const m = Math.floor(n / 60000);
  const s = Math.round((n % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Discord timestamp tag from epoch ms. Style: R (relative), f (short date+time). */
function _ts(epochMs, style = 'R') {
  return `<t:${Math.floor(epochMs / 1000)}:${style}>`;
}

/**
 * Partition today's Bookeo cast names into linked vs unlinked, by comparing
 * against the known member-link names (case-insensitive). Pure. Both inputs are
 * de-duped case-insensitively so a name cast in two shows counts once.
 *
 * @param {string[]} bookeoNames  Cast names from today's Bookeo schedule.
 * @param {string[]} linkedNames  bookeo_name values from member_links.
 * @returns {{ linked: string[], unlinked: string[] }}  (original casing preserved)
 */
function partitionCastLinks(bookeoNames, linkedNames) {
  const linkedSet = new Set(
    (Array.isArray(linkedNames) ? linkedNames : [])
      .filter(n => typeof n === 'string')
      .map(n => n.trim().toLowerCase())
  );
  const linked = [];
  const unlinked = [];
  const seen = new Set();
  for (const raw of (Array.isArray(bookeoNames) ? bookeoNames : [])) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (linkedSet.has(key) ? linked : unlinked).push(name);
  }
  return { linked, unlinked };
}

/** Overall health color: red if Discord down or Bookeo unreachable, amber if stale. */
function _healthColor(health) {
  if (health.discord !== 'ready' || health.bookeo === 'unreachable') return COLOR.down;
  if (health.bookeo === 'stale') return COLOR.degraded;
  return COLOR.healthy;
}

/**
 * Render the status embed from a snapshot.
 *
 * @param {object} snapshot  See module doc for shape.
 * @param {object} [opts]
 * @param {number|Date} [opts.now]  Reference "now" (epoch ms or Date). Injected for tests.
 * @returns {{ title: string, color: number, fields: Array<{name,value}>, footer?: object }}
 */
function buildStatusEmbed(snapshot, { now = Date.now() } = {}) {
  const s      = snapshot || {};
  const health = s.health || {};
  const jobs   = Array.isArray(s.jobs) ? s.jobs : [];
  const errors = Array.isArray(s.errors) ? s.errors : null;
  const nowMs  = now instanceof Date ? now.getTime() : now;

  const fields = [];

  // ── 💓 Health ──────────────────────────────────────────────────────────────
  fields.push({
    name: '💓 Health',
    value: [
      `Uptime: **${_fmtUptime(health.uptimeSec)}**`,
      `Discord: ${DISCORD_LABEL[health.discord] ?? `⚪ ${health.discord ?? 'unknown'}`}`,
      `Bookeo: ${BOOKEO_LABEL[health.bookeo] ?? `⚪ ${health.bookeo ?? 'unknown'}`}`,
    ].join('\n'),
  });

  // ── ⏭️ Next scheduled runs (schedule) ────────────────────────────────────────
  if (jobs.length) {
    const lines = jobs.map(j =>
      `**${j.label}** — ${j.nextRun ? _ts(j.nextRun) : '_not scheduled_'}`
    );
    fields.push({ name: '⏭️ Next scheduled runs', value: lines.join('\n') });

    // ── 🗂️ Last run — populated by slice #158; placeholder until instrumented ───
    const anyRuns = jobs.some(j => j.lastRun !== undefined);
    if (anyRuns) {
      const lines2 = jobs.map(j => {
        if (!j.lastRun) return `**${j.label}** — _no runs recorded_`;
        const icon = j.lastRun.status === 'error' ? '🔴' : '🟢';
        const when = j.lastRun.finishedAtMs ?? j.lastRun.startedAtMs;
        const dur  = j.lastRun.durationMs != null ? ` in ${_fmtDuration(j.lastRun.durationMs)}` : '';
        return `**${j.label}** — ${icon} ${when ? _ts(when) : '—'}${dur}`;
      });
      fields.push({ name: '🗂️ Last run', value: lines2.join('\n') });
    } else {
      fields.push({
        name: '🗂️ Last run',
        value: '_Run history will appear here once jobs have run._',
      });
    }
  }

  // ── 📊 Data at a glance (slice #160) ─────────────────────────────────────────
  if (s.counts) {
    const c = s.counts;
    const unlinked = c.unlinkedCast;
    const unlinkedLine = unlinked == null
      ? 'Unlinked cast today: _unknown_'
      : unlinked === 0
        ? 'Unlinked cast today: **all cast linked** ✅'
        : `Unlinked cast today: **${unlinked}**`;
    fields.push({
      name: '📊 Data at a glance',
      value: [
        `Open coverage shifts: **${c.openShifts ?? 0}**`,
        `Open custom games: **${c.openGames ?? 0}**`,
        `Unconfirmed (ready to fill): **${c.unconfirmed ?? 0}**`,
        `Pending check-ins today: **${c.pendingCheckins ?? 0}**`,
        unlinkedLine,
      ].join('\n'),
    });
  }

  // ── ⚠️ Recent errors (slice #159) ────────────────────────────────────────────
  if (errors) {
    let value;
    if (!errors.length) {
      value = '🎉 No recent errors.';
    } else {
      value = errors.slice(0, MAX_ERRORS).map(e => {
        const ctx = e.context ? ` \`${e.context}\`` : '';
        return `${e.at ? _ts(e.at) : '—'}${ctx} — ${_truncate(e.message, 140)}`;
      }).join('\n');
      if (errors.length > MAX_ERRORS) value += `\n_…and ${errors.length - MAX_ERRORS} more_`;
    }
    fields.push({ name: '⚠️ Recent errors', value });
  }

  const embed = {
    title: '🤖 Bot Status',
    color: _healthColor(health),
    fields,
    footer: { text: 'Snapshot' },
    timestamp: new Date(nowMs).toISOString(),
  };

  return embed;
}

module.exports = {
  buildStatusEmbed,
  partitionCastLinks,
  // internals exported for unit tests
  _fmtUptime,
  _fmtDuration,
};
