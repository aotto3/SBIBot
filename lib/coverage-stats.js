'use strict';

/**
 * Coverage stats — the deep, pure module behind /coverage-stats.
 *
 * `computeCoverageStats` turns already-fetched coverage rows into a plain
 * stats object (no I/O, operates purely on Discord IDs). `buildStatsEmbeds`
 * renders that object into Discord embed objects, taking a `resolveName`
 * function so name lookup stays outside the pure computation.
 *
 * Slice #144 implements the per-person leaderboard (covers, requests,
 * cancelled requests, give/take ratio). Later slices extend the same two
 * functions with timing, most-needed shifts, and fill-rate sections.
 */

// ─── Compute ───────────────────────────────────────────────────────────────────

/**
 * Compute coverage stats from shift rows.
 *
 * @param {Array<{
 *   id: number, request_id: number, date: string, time: string, status: string,
 *   confirmed_taker_id: string|null, confirmed_at: number|null,
 *   show: string, character: string|null,
 *   requester_id: string|null, requester_name: string|null,
 *   request_created_at: number|null
 * }>} rows  Shift rows joined with request info, across ALL statuses.
 * @param {object} [opts]  Reserved for later slices (filters, `now`).
 * @returns {{ leaderboard: Array<{
 *   id: string, covers: number, requests: number, requestsCancelled: number,
 *   ratio: number|null
 * }> }}
 */
function computeCoverageStats(rows = [], opts = {}) {
  const byPerson = new Map(); // discordId → { covers, requests, requestsCancelled }

  const ensure = id => {
    let entry = byPerson.get(id);
    if (!entry) {
      entry = { id, covers: 0, requests: 0, requestsCancelled: 0 };
      byPerson.set(id, entry);
    }
    return entry;
  };

  for (const row of rows) {
    // A confirmed taker gets credit for a cover regardless of shift status.
    if (row.confirmed_taker_id) ensure(row.confirmed_taker_id).covers += 1;

    // The requester's ask counts as a request; cancelled asks are tracked
    // separately so the headline "real need" number stays clean.
    if (row.requester_id) {
      const entry = ensure(row.requester_id);
      if (row.status === 'cancelled') entry.requestsCancelled += 1;
      else entry.requests += 1;
    }
  }

  const leaderboard = [...byPerson.values()]
    .map(e => ({ ...e, ratio: e.requests > 0 ? e.covers / e.requests : null }))
    .sort(_leaderboardOrder);

  return { leaderboard };
}

/** Sort: most covers first, then most requests, then id for determinism. */
function _leaderboardOrder(a, b) {
  if (b.covers !== a.covers) return b.covers - a.covers;
  if (b.requests !== a.requests) return b.requests - a.requests;
  return a.id.localeCompare(b.id);
}

// ─── Render ──────────────────────────────────────────────────────────────────

const _EMBED_DESC_LIMIT = 4096;

/**
 * Render the stats object into Discord embed objects.
 *
 * @param {ReturnType<typeof computeCoverageStats>} stats
 * @param {object}   opts
 * @param {string}   [opts.guildId]      Reserved for later slices (jump links).
 * @param {function} opts.resolveName    (discordId) → display string; must never throw.
 * @param {string}   [opts.showFilter]   Reserved for later slices (title suffix).
 * @param {string}   [opts.personFilter] Reserved for later slices (detail view).
 * @returns {Array<{ title: string, description: string }>}  [] when there's no activity.
 */
function buildStatsEmbeds(stats, opts = {}) {
  const resolveName = opts.resolveName ?? (id => `<@${id}>`);
  const rows = stats?.leaderboard ?? [];
  if (!rows.length) return [];

  const lines = rows.map((e, i) => {
    const parts = [
      `**${i + 1}. ${resolveName(e.id)}**`,
      `covered ${e.covers}`,
      `requested ${e.requests}${e.requestsCancelled ? ` (${e.requestsCancelled} cancelled)` : ''}`,
    ];
    if (e.ratio !== null) parts.push(`ratio ${e.ratio.toFixed(1)}`);
    return parts.join(' · ');
  });

  return [{ title: 'Coverage Stats', description: _clampLines(lines) }];
}

/** The ephemeral line shown when there is no coverage activity to report. */
function buildStatsEmptyState() {
  return '✅ No coverage activity recorded yet.';
}

/** Join rows into an embed description, clamping with "…and N more" if over the limit. */
function _clampLines(lines, limit = _EMBED_DESC_LIMIT) {
  const full = lines.join('\n');
  if (full.length <= limit) return full;
  const kept = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    const moreLine = `…and ${lines.length - i} more`;
    const sep = kept.length ? 1 : 0;
    if (len + sep + lines[i].length + 1 + moreLine.length > limit) {
      kept.push(moreLine);
      return kept.join('\n');
    }
    len += sep + lines[i].length;
    kept.push(lines[i]);
  }
  return kept.join('\n');
}

module.exports = {
  computeCoverageStats,
  buildStatsEmbeds,
  buildStatsEmptyState,
};
