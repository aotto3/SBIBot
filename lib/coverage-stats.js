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
 * cancelled requests, give/take ratio). Slice #145 adds the fill-rate
 * buckets. Slice #146 adds timing (time-to-coverage + lead time).
 * Slice #147 adds most-needed shifts (by show / character / weekday).
 */

const { CENTRAL_TZ } = require('./utils');
const { showKeys, showLabel } = require('./shows');

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
 * @param {object} [opts]
 * @param {number|Date} [opts.now]  Reference "now" for the unfilled/passed cutoff
 *                                  (defaults to the current time). Injected for tests.
 * @param {string} [opts.show]      Narrow every section to one show key.
 * @param {string} [opts.since]     "YYYY-MM-DD" — keep only shifts on/after this date.
 * @param {string} [opts.person]    Discord ID — produce a `person` detail (the caller
 *                                  renders that instead of the global leaderboard).
 * @returns {{
 *   leaderboard, fillRate, timing, mostNeeded,
 *   person: object|null, filters: { show, since, person }
 * }}
 */
function computeCoverageStats(rows = [], opts = {}) {
  const now      = opts.now ?? Date.now();
  const filtered = _applyRowFilters(rows, opts);            // shifts: show + since
  const games    = _applyGameFilters(opts.games ?? [], opts); // games:  show + since

  const byPerson = new Map(); // discordId → { covers, requests, requestsCancelled }

  const ensure = id => {
    let entry = byPerson.get(id);
    if (!entry) {
      entry = { id, covers: 0, requests: 0, requestsCancelled: 0 };
      byPerson.set(id, entry);
    }
    return entry;
  };

  for (const row of filtered) {
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

  // Custom-game takers earn covers too (a game has no requester, so games never
  // touch the requests tally).
  for (const g of games) {
    for (const t of _parseTakers(g.takers)) {
      if (t.userId) ensure(t.userId).covers += 1;
    }
  }

  const leaderboard = [...byPerson.values()]
    .map(e => ({ ...e, ratio: e.requests > 0 ? e.covers / e.requests : null }))
    .sort(_leaderboardOrder);

  return {
    leaderboard,
    fillRate:   _computeFillRate(filtered, games, now),
    timing:     _computeTiming(filtered),
    mostNeeded: _computeMostNeeded(filtered),
    person:     opts.person ? _computePersonDetail(filtered, games, opts.person, now) : null,
    filters:    { show: opts.show ?? null, since: opts.since ?? null, person: opts.person ?? null },
  };
}

/** Apply the show + since row filters. Person is not filtered here (it scopes the detail). */
function _applyRowFilters(rows, { show = null, since = null } = {}) {
  let out = rows;
  if (show)  out = out.filter(r => r.show === show);
  if (since) out = out.filter(r => r.date >= since);
  return out;
}

/** Same show + since filters, for custom-game rows. */
function _applyGameFilters(games, { show = null, since = null } = {}) {
  let out = games;
  if (show)  out = out.filter(g => g.show === show);
  if (since) out = out.filter(g => g.date >= since);
  return out;
}

// ─── Custom-game takers ──────────────────────────────────────────────────────

/**
 * Normalize a list of takers into the record persisted on a custom game.
 * Accepts the shapes the confirm flow produces — single-role
 * `[{ userId, role: null }]` and multi-role `[{ role, userId }]` — and returns
 * a clean `[{ role, userId }]` array (entries without a userId dropped).
 */
function buildGameTakersRecord(takers = []) {
  return takers
    .filter(t => t && t.userId)
    .map(t => ({ role: t.role ?? null, userId: t.userId }));
}

/** Parse a stored takers JSON string into an array; tolerant of null/garbage. */
function _parseTakers(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Person detail ─────────────────────────────────────────────────────────────

/**
 * One person's coverage picture: their covers/requests headline, where they
 * cover, how their own requests resolved, and their timing (how fast they take
 * shifts, how far ahead they ask). Built by reusing the section helpers scoped
 * to rows involving this person.
 */
function _computePersonDetail(rows, games, id, now) {
  let covers = 0, requests = 0, requestsCancelled = 0;
  const coverShowCount = new Map();
  const bumpCover = show => coverShowCount.set(show, (coverShowCount.get(show) ?? 0) + 1);

  for (const row of rows) {
    if (row.confirmed_taker_id === id) {
      covers += 1;
      bumpCover(row.show);
    }
    if (row.requester_id === id) {
      if (row.status === 'cancelled') requestsCancelled += 1;
      else requests += 1;
    }
  }

  // Custom games this person took count toward their covers too.
  for (const g of games) {
    for (const t of _parseTakers(g.takers)) {
      if (t.userId === id) { covers += 1; bumpCover(g.show); }
    }
  }

  const requestRows = rows.filter(r => r.requester_id === id);
  const takerRows   = rows.filter(r => r.confirmed_taker_id === id);

  return {
    id,
    covers,
    requests,
    requestsCancelled,
    ratio: requests > 0 ? covers / requests : null,
    coversByShow: [...coverShowCount.entries()]
      .map(([show, count]) => ({ show, label: showLabel(show), count }))
      .sort(_byCountThenLabel),
    requestOutcomes: _computeFillRate(requestRows, [], now).overall,
    responseTime:    _computeTiming(takerRows).timeToCoverage, // request → they confirmed
    leadTime:        _computeTiming(requestRows).leadTime,
  };
}

// ─── Most-needed shifts ──────────────────────────────────────────────────────

const _WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Where coverage demand concentrates: requested shifts grouped by show, by
 * character (multi-role shows only — single-role rows carry a null character),
 * and by weekday. Each dimension is ranked most-requested first.
 */
function _computeMostNeeded(rows) {
  const showCount = new Map();
  const charCount = new Map(); // `${show}|${character}` → count
  const dayCount  = new Map(); // weekday index 0–6 → count

  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const row of rows) {
    bump(showCount, row.show);
    if (row.character) bump(charCount, `${row.show}|${row.character}`);
    bump(dayCount, _weekdayIndex(row.date));
  }

  const byShow = [...showCount.entries()]
    .map(([show, count]) => ({ show, label: showLabel(show), count }))
    .sort(_byCountThenLabel);

  const byCharacter = [...charCount.entries()]
    .map(([key, count]) => {
      const [show, character] = key.split('|');
      return { show, character, label: `${showLabel(show)} ${character}`, count };
    })
    .sort(_byCountThenLabel);

  const byWeekday = [...dayCount.entries()]
    .map(([wd, count]) => ({ weekday: wd, label: _WEEKDAY_LABELS[wd], count }))
    .sort(_byCountThenLabel);

  return { byShow, byCharacter, byWeekday };
}

/** Most-requested first; ties broken alphabetically for deterministic output. */
function _byCountThenLabel(a, b) {
  return b.count - a.count || a.label.localeCompare(b.label);
}

/** Weekday index (0=Sun) for a "YYYY-MM-DD" date — UTC midnight keeps it tz-stable. */
function _weekdayIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ─── Timing ────────────────────────────────────────────────────────────────────

/**
 * Timing metrics:
 *   - time-to-coverage: request created_at → shift confirmed_at, in hours
 *     (covered shifts only). This is really time-to-*confirm* — an upper bound
 *     on true response time, since confirmed_at is when the manager clicked
 *     Confirm, not when the first "yes" arrived.
 *   - lead time: request created_at → showtime, in whole days (all requested
 *     shifts) — how far in advance people ask.
 * Each reported as median + average, guarded against empty input.
 */
function _computeTiming(rows) {
  const ttcHours = [];
  const leadDays = [];

  for (const row of rows) {
    if (row.request_created_at == null) continue;

    leadDays.push(_calendarDaysBetween(_centralDate(row.request_created_at * 1000), row.date));

    if (row.status === 'covered' && row.confirmed_at != null) {
      const diff = row.confirmed_at - row.request_created_at;
      if (diff >= 0) ttcHours.push(diff / 3600);
    }
  }

  return {
    timeToCoverage: { medianHours: _median(ttcHours), avgHours: _average(ttcHours), count: ttcHours.length },
    leadTime:       { medianDays: _median(leadDays), avgDays: _average(leadDays), count: leadDays.length },
  };
}

function _median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function _average(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Whole calendar days from one "YYYY-MM-DD" to another (UTC midnights → DST-safe). */
function _calendarDaysBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/** Central-time calendar date ("YYYY-MM-DD") for a Date/ms instant. */
function _centralDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: CENTRAL_TZ });
}

// ─── Fill rate ─────────────────────────────────────────────────────────────────

/**
 * Bucket shifts (and custom games) into Covered / Cancelled / Unfilled-passed,
 * overall and per show. Open shifts/games whose showtime is still in the future
 * are pending and excluded. `now` sets the cutoff (Date or ms); comparison is in
 * Central time. Games are only classified when confident (see `_classifyGame`).
 */
function _computeFillRate(rows, games, now) {
  const nowStamp = _centralStamp(now);
  const overall  = _emptyBucket();
  const byShow   = {};

  for (const row of rows) {
    const bucket = _classifyShift(row, nowStamp);
    if (!bucket) continue; // pending (open + future) — not yet resolved
    overall[bucket] += 1;
    (byShow[row.show] ??= _emptyBucket())[bucket] += 1;
  }

  for (const g of games) {
    const bucket = _classifyGame(g, nowStamp);
    if (!bucket) continue;
    overall[bucket] += 1;
    (byShow[g.show] ??= _emptyBucket())[bucket] += 1;
  }

  _withPct(overall);
  for (const show of Object.keys(byShow)) _withPct(byShow[show]);

  return { overall, byShow };
}

function _emptyBucket() {
  return { covered: 0, cancelled: 0, unfilledPassed: 0, coveredPct: null };
}

/** @returns {'covered'|'cancelled'|'unfilledPassed'|null}  null = pending (excluded). */
function _classifyShift(row, nowStamp) {
  if (row.status === 'covered')   return 'covered';
  if (row.status === 'cancelled') return 'cancelled';
  // status 'open': a miss only once its showtime has passed.
  return `${row.date} ${row.time}` < nowStamp ? 'unfilledPassed' : null;
}

/**
 * Classify a custom game — only where we can be confident:
 *   - confirmed AND has takers → covered.
 *   - not confirmed AND showtime passed → unfilled/passed.
 * Everything else (confirmed without takers — deactivated, or pre-logging — and
 * pending future games) is excluded rather than mislabeled.
 * @returns {'covered'|'unfilledPassed'|null}
 */
function _classifyGame(game, nowStamp) {
  const hasTakers = _parseTakers(game.takers).length > 0;
  if (game.confirmed_at && hasTakers) return 'covered';
  if (!game.confirmed_at && `${game.date} ${game.time || '00:00'}` < nowStamp) return 'unfilledPassed';
  return null;
}

/** Coverage rate among shifts that reached their date: covered / (covered + missed). */
function _withPct(bucket) {
  const denom = bucket.covered + bucket.unfilledPassed;
  bucket.coveredPct = denom > 0 ? bucket.covered / denom : null;
}

/** Format a Date/ms as a sortable Central-time "YYYY-MM-DD HH:MM" stamp. */
function _centralStamp(now) {
  const d = now instanceof Date ? now : new Date(now);
  const date = d.toLocaleDateString('en-CA', { timeZone: CENTRAL_TZ });
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: CENTRAL_TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  });
  return `${date} ${time}`;
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
 * @param {string}   [opts.guildId]    Reserved for later slices (jump links).
 * @param {function} opts.resolveName  (discordId) → display string; must never throw.
 * @returns {Array<{ title: string, description: string }>}  [] when there's no activity.
 */
function buildStatsEmbeds(stats, opts = {}) {
  const resolveName = opts.resolveName ?? (id => `<@${id}>`);
  const filters = stats?.filters ?? {};

  // A person filter renders that person's detail view instead of the leaderboard.
  if (stats?.person) return _personEmbeds(stats.person, resolveName, filters);

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

  const embed = { title: `Coverage Stats${_titleSuffix(filters)}`, description: _clampLines(lines) };

  const fields = [];
  const fillField = stats?.fillRate && _fillRateField(stats.fillRate);
  if (fillField) fields.push(fillField);
  const timingField = stats?.timing && _timingField(stats.timing);
  if (timingField) fields.push(timingField);
  const neededField = stats?.mostNeeded && _mostNeededField(stats.mostNeeded);
  if (neededField) fields.push(neededField);
  if (fields.length) embed.fields = fields;

  return [embed];
}

/** Title suffix summarizing active show/since filters, e.g. " — Great Gold Bird · since 2026-01-01". */
function _titleSuffix(filters) {
  const bits = [];
  if (filters.show)  bits.push(showLabel(filters.show));
  if (filters.since) bits.push(`since ${filters.since}`);
  return bits.length ? ` — ${bits.join(' · ')}` : '';
}

/** Render one person's detail embed. Always returns an embed (even at all zeros). */
function _personEmbeds(person, resolveName, filters) {
  const name  = resolveName(person.id);
  const scope = _titleSuffix({ show: filters.show, since: filters.since });

  const headline = [
    `Covered **${person.covers}** · Requested **${person.requests}**`
      + (person.requestsCancelled ? ` (${person.requestsCancelled} cancelled)` : '')
      + (person.ratio !== null ? ` · ratio ${person.ratio.toFixed(1)}` : ''),
  ];
  if (scope) headline.push(`*Filtered${scope}*`);

  const embed = { title: `Coverage Stats — ${name}`, description: headline.join('\n') };
  const fields = [];

  if (person.coversByShow.length) {
    fields.push({ name: '✅ Covers by show', value: _rankLine(person.coversByShow, 10) });
  }

  const ro = person.requestOutcomes;
  if (ro.covered || ro.cancelled || ro.unfilledPassed) {
    fields.push({ name: '📋 Their requests', value: _fillLine(ro) });
  }

  const tlines = [];
  if (person.responseTime.count > 0) {
    tlines.push(`Response time — median ${_fmtHours(person.responseTime.medianHours)} *(request → they confirmed; n=${person.responseTime.count})*`);
  }
  if (person.leadTime.count > 0) {
    tlines.push(`Lead time — median ${person.leadTime.medianDays.toFixed(1)}d *(request → showtime; n=${person.leadTime.count})*`);
  }
  if (tlines.length) fields.push({ name: '⏱️ Timing', value: tlines.join('\n') });

  if (fields.length) embed.fields = fields;
  return [embed];
}

/** Build the "Most-needed" embed field, or null when there are no requests. */
function _mostNeededField(mn) {
  if (!mn.byShow.length) return null;
  const lines = [`**By show** — ${_rankLine(mn.byShow)}`];
  if (mn.byWeekday.length)   lines.push(`**By weekday** — ${_rankLine(mn.byWeekday)}`);
  if (mn.byCharacter.length) lines.push(`**By character** — ${_rankLine(mn.byCharacter)}`);
  return { name: '🔥 Most-needed', value: lines.join('\n') };
}

/** "Label N · Label N · …", capped at the top `n` entries. */
function _rankLine(entries, n = 6) {
  const top = entries.slice(0, n).map(e => `${e.label} ${e.count}`).join(' · ');
  return entries.length > n ? `${top} · …` : top;
}

/** Build the "Timing" embed field, or null when there's no timing data. */
function _timingField(timing) {
  const lines = [];
  const t = timing.timeToCoverage;
  if (t.count > 0) {
    lines.push(`Time to coverage — median ${_fmtHours(t.medianHours)} · avg ${_fmtHours(t.avgHours)} *(request → confirmed; n=${t.count})*`);
  }
  const l = timing.leadTime;
  if (l.count > 0) {
    lines.push(`Lead time — median ${l.medianDays.toFixed(1)}d · avg ${l.avgDays.toFixed(1)}d *(request → showtime; n=${l.count})*`);
  }
  if (!lines.length) return null;
  return { name: '⏱️ Timing', value: lines.join('\n') };
}

/** Hours as "18.5h", or days once it's two days or more ("2.5d"). */
function _fmtHours(hours) {
  return hours >= 48 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(1)}h`;
}

/** Build the "Fill rate" embed field, or null when there's nothing resolved yet. */
function _fillRateField(fillRate) {
  const o = fillRate.overall;
  if (!o.covered && !o.cancelled && !o.unfilledPassed) return null;

  const lines = [`**Overall** — ${_fillLine(o)}`];
  for (const key of showKeys()) {
    const b = fillRate.byShow[key];
    if (!b || (!b.covered && !b.cancelled && !b.unfilledPassed)) continue;
    lines.push(`${showLabel(key)} — ${_fillLine(b)}`);
  }
  return { name: '📊 Fill rate', value: lines.join('\n') };
}

function _fillLine(b) {
  let line = `✅ ${b.covered} covered · 🚫 ${b.cancelled} cancelled · 🔴 ${b.unfilledPassed} unfilled/passed`;
  if (b.coveredPct !== null) line += ` · ${Math.round(b.coveredPct * 100)}% covered`;
  return line;
}

/** The ephemeral line shown when there is no coverage activity to report. */
function buildStatsEmptyState(showLabel = null) {
  return showLabel
    ? `✅ No coverage activity recorded yet for ${showLabel}.`
    : '✅ No coverage activity recorded yet.';
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
  buildGameTakersRecord,
};
