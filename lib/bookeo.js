const axios = require('axios');
const { showLabel } = require('./shows');
const { CENTRAL_TZ, toDateString } = require('./utils');

// ─── Response cache ───────────────────────────────────────────────────────────
// Keyed on "from|to" param string; entries expire after 5 minutes.
const _cache     = new Map();
const CACHE_TTL  = 5 * 60 * 1000; // ms

// Reachability tracking for /bot-status: updated on every getSchedule attempt.
// STALE_WINDOW = how recently a live call must have succeeded for a subsequent
// failure to count as "stale" (serving cache) rather than "unreachable".
const STALE_WINDOW = 6 * 60 * 60 * 1000; // 6h
let _lastSuccessAt = null;
let _lastErrorAt   = null;

/**
 * Fetch the schedule from bookeo-asst.
 * @param {string} [from] - YYYY-MM-DD start date (defaults to today on the server)
 * @param {string} [to]   - YYYY-MM-DD end date (defaults to from+7 on the server)
 * @returns {Array} Array of shift objects: { date, time, show, cast, guest_count }
 */
async function getSchedule(from, to) {
  const cacheKey = `${from ?? ''}|${to ?? ''}`;
  const cached   = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  const params = {};
  if (from) params.from = from;
  if (to)   params.to   = to;

  const headers = {};
  if (process.env.BOOKEO_API_KEY) {
    headers['X-Api-Key'] = process.env.BOOKEO_API_KEY;
  }

  let response;
  try {
    response = await axios.get(`${process.env.BOOKEO_API_URL}/api/schedule`, { params, headers, timeout: 15000 });
  } catch (err) {
    _lastErrorAt = Date.now();
    throw err;
  }
  _lastSuccessAt = Date.now();

  // Normalize response: the API may return a full ISO `startTime` field instead of
  // separate `date` and `time` strings (depending on bookeo-asst version).
  const result = response.data.map(item => {
    if (item.startTime && (!item.date || !item.time)) {
      const d = new Date(item.startTime);
      return {
        ...item,
        date: d.toLocaleDateString('en-CA', { timeZone: CENTRAL_TZ }), // YYYY-MM-DD
        time: d.toLocaleTimeString('en-US', { timeZone: CENTRAL_TZ, hour: 'numeric', minute: '2-digit' }),
      };
    }
    return item;
  });

  _cache.set(cacheKey, { data: result, expires: Date.now() + CACHE_TTL });
  return result;
}


// bookeo-asst ignores the `to` param and always returns ~1 week from `from`
// (see runShiftDMs in scheduler.js), so a longer horizon needs one call per
// chunk of this size, merged together.
const CHUNK_DAYS = 7;

/**
 * Pure: the "YYYY-MM-DD" chunk boundaries needed to cover `days` days starting
 * at `from`, each chunk spanning CHUNK_DAYS. The last chunk may extend a little
 * past `from + days` — callers filter the merged rows back down to range.
 *
 * @param {string} from  YYYY-MM-DD
 * @param {number} days
 * @returns {Array<{ from: string, to: string }>}
 */
function _buildChunkRanges(from, days) {
  const [y, mo, d] = from.split('-').map(Number);
  const chunkCount  = Math.max(1, Math.ceil(days / CHUNK_DAYS));
  const ranges = [];
  for (let i = 0; i < chunkCount; i++) {
    ranges.push({
      from: toDateString(new Date(y, mo - 1, d + i * CHUNK_DAYS)),
      to:   toDateString(new Date(y, mo - 1, d + i * CHUNK_DAYS + CHUNK_DAYS)),
    });
  }
  return ranges;
}

/**
 * Pure: merge multiple chunks' shift-row arrays into one, deduped by
 * date+time+show and clipped to [from, to] (each chunk's own bookeo-asst call
 * ignores `to`, so rows can spill outside the requested window at the edges).
 *
 * @param {Array<Array<object>>} chunkResults  One row array per chunk, in order.
 * @param {string} from  YYYY-MM-DD (inclusive)
 * @param {string} to    YYYY-MM-DD (inclusive)
 * @returns {Array<object>}
 */
function _mergeScheduleChunks(chunkResults, from, to) {
  const seen   = new Set();
  const merged = [];
  for (const rows of chunkResults) {
    for (const row of rows) {
      if (!row || row.date < from || row.date > to) continue;
      const key = `${row.date}|${row.time}|${row.show}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}

/**
 * Fetch the schedule across a longer horizon than a single bookeo-asst call
 * supports (it ignores `to` and always returns ~1 week from `from`). Issues
 * one call per CHUNK_DAYS-day chunk in parallel (each chunk still benefits
 * from getSchedule's normal 5-min cache) and merges the results.
 *
 * @param {string} from  YYYY-MM-DD start date
 * @param {number} days  How many days out to cover (e.g. 90)
 * @returns {Promise<Array>} Merged shift rows within [from, from+days]
 */
async function getScheduleForDays(from, days) {
  const [y, mo, d] = from.split('-').map(Number);
  const to = toDateString(new Date(y, mo - 1, d + days));
  const chunkResults = await Promise.all(
    _buildChunkRanges(from, days).map(r => getSchedule(r.from, r.to))
  );
  return _mergeScheduleChunks(chunkResults, from, to);
}

/**
 * Cheap reachability probe for /bot-status. Reuses the 5-min cache and adds no
 * new upstream call path: a fresh cache entry counts as reachable outright; only
 * when nothing is cached do we let getSchedule make (at most) its normal call.
 *
 * @returns {Promise<'reachable'|'stale'|'unreachable'>}
 *   reachable   — a live call just succeeded, or fresh cached data exists
 *   stale       — the latest call failed but a live call succeeded recently
 *   unreachable — the latest call failed with no recent success
 */
async function probeReachability(from, to) {
  const cacheKey = `${from ?? ''}|${to ?? ''}`;
  const cached   = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return 'reachable';

  try {
    await getSchedule(from, to);
    return 'reachable';
  } catch {
    if (_lastSuccessAt && Date.now() - _lastSuccessAt < STALE_WINDOW) return 'stale';
    return 'unreachable';
  }
}

/**
 * Group an array of shifts by cast member name.
 * Returns: { [castName]: [shift, shift, ...] }
 */
function groupByCastMember(shifts) {
  const groups = {};
  for (const shift of shifts) {
    for (const name of shift.cast) {
      if (!groups[name]) groups[name] = [];
      groups[name].push(shift);
    }
  }
  return groups;
}

/**
 * Format a YYYY-MM-DD + "H:MM AM/PM" pair into a human-readable line.
 * e.g. "Monday, April 6 at 5:15 PM"
 */
function formatShiftLine(date, time) {
  const [year, month, day] = date.split('-').map(Number);
  // Use UTC to avoid timezone shifts when only a date is given
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayName   = d.toLocaleDateString('en-US', { weekday: 'long',  timeZone: 'UTC' });
  const monthName = d.toLocaleDateString('en-US', { month:  'long',   timeZone: 'UTC' });
  return `${dayName}, ${monthName} ${day} at ${time}`;
}

/**
 * Build the DM text for one actor for a given label ('this week' or 'within 24 hours').
 * All their shifts are grouped into a single message, further grouped by show if needed.
 *
 * @param {string} firstName
 * @param {Array}  shifts     - the actor's shifts for this period
 * @param {string} label      - 'this week' | 'within 24 hours'
 */
function buildShiftDM(firstName, shifts, label) {
  // Group shifts by show abbreviation
  const byShow = {};
  for (const shift of shifts) {
    if (!byShow[shift.show]) byShow[shift.show] = [];
    byShow[shift.show].push(shift);
  }

  const showKeys = Object.keys(byShow);
  const lines = [];

  if (showKeys.length === 1) {
    // Single show — mention show name inline
    const show = showKeys[0];
    lines.push(`${firstName} - this is a reminder you are scheduled for the following shifts for ${showLabel(show)} ${label}:`);
    for (const shift of byShow[show]) {
      lines.push(formatShiftLine(shift.date, shift.time));
    }
  } else {
    // Multiple shows — group under show headers
    lines.push(`${firstName} - this is a reminder you are scheduled for the following shifts ${label}:`);
    for (const show of showKeys) {
      lines.push('');
      lines.push(`${showLabel(show)}:`);
      for (const shift of byShow[show]) {
        lines.push(formatShiftLine(shift.date, shift.time));
      }
    }
  }

  lines.push('');
  lines.push('Reply here if you have any issues!');
  return lines.join('\n');
}

module.exports = {
  getSchedule,
  getScheduleForDays,
  probeReachability,
  groupByCastMember,
  buildShiftDM,
  formatShiftLine,
  // Exported for testing
  _buildChunkRanges,
  _mergeScheduleChunks,
};
