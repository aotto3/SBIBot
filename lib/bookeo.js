const axios = require('axios');

const SHOW_FULL_NAMES = {
  MFB:      'The Man From Beyond',
  GGB:      'Great Gold Bird',
  Endings:  'The Endings',
  Lucidity: 'Lucidity',
};

const CENTRAL_TZ = 'America/Chicago';

/**
 * Fetch the schedule from bookeo-asst.
 * @param {string} [from] - YYYY-MM-DD start date (defaults to today on the server)
 * @param {string} [to]   - YYYY-MM-DD end date (defaults to from+7 on the server)
 * @returns {Array} Array of shift objects: { date, time, show, cast, guest_count }
 */
async function getSchedule(from, to) {
  const params = {};
  if (from) params.from = from;
  if (to)   params.to   = to;

  const headers = {};
  if (process.env.BOOKEO_API_KEY) {
    headers['X-Api-Key'] = process.env.BOOKEO_API_KEY;
  }

  const response = await axios.get(`${process.env.BOOKEO_API_URL}/api/schedule`, { params, headers });

  // Normalize response: the API may return a full ISO `startTime` field instead of
  // separate `date` and `time` strings (depending on bookeo-asst version).
  return response.data.map(item => {
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
}

/**
 * Expand a show abbreviation to its full display name.
 * Falls back to the abbreviation itself if not found.
 */
function showFullName(abbr) {
  return SHOW_FULL_NAMES[abbr] || abbr;
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
    lines.push(`${firstName} - this is a reminder you are scheduled for the following shifts for ${showFullName(show)} ${label}:`);
    for (const shift of byShow[show]) {
      lines.push(formatShiftLine(shift.date, shift.time));
    }
  } else {
    // Multiple shows — group under show headers
    lines.push(`${firstName} - this is a reminder you are scheduled for the following shifts ${label}:`);
    for (const show of showKeys) {
      lines.push('');
      lines.push(`${showFullName(show)}:`);
      for (const shift of byShow[show]) {
        lines.push(formatShiftLine(shift.date, shift.time));
      }
    }
  }

  lines.push('');
  lines.push('Reply here if you have any issues!');
  return lines.join('\n');
}

module.exports = { getSchedule, showFullName, groupByCastMember, buildShiftDM, formatShiftLine };
