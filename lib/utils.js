// ─── Time parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a human time string into "HH:MM" (24h).
 * Accepts: "7pm", "7:30pm", "7:30 PM", "19:00", "19:30", "1900", "730pm", "7.30pm", "19"
 * Returns null if unparseable.
 */
function parseTime(str) {
  str = str.trim().toLowerCase().replace(/\s+/g, '');

  // 4-digit military: 1900, 0730, 1530
  let m = str.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  // 24h with separator: "19:30" or "19.30"
  m = str.match(/^(\d{1,2})[:\.](\d{2})$/);
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  // 12h with optional separator and optional space: "7pm", "7:30pm", "7.30pm", "730pm"
  m = str.match(/^(\d{1,2})[:\.]?(\d{2})?(am|pm)$/);
  if (m) {
    let h     = parseInt(m[1]);
    const min = m[2] ? parseInt(m[2]) : 0;
    const ap  = m[3];
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  // Bare 24h hour: "19" → 19:00  (only unambiguous if ≥13)
  m = str.match(/^(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1]);
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, '0')}:00`;
    }
  }

  return null;
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

const MONTH_NAMES = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function _isValidDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

function _dateParts(y, mo, d) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** If no year is given, return this year; bump to next year if date already passed. */
function _inferYear(mo, d) {
  const now     = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thisY   = now.getFullYear();
  const candidate = new Date(thisY, mo - 1, d);
  return candidate.getTime() >= todayMs ? thisY : thisY + 1;
}

/**
 * Parse a human date string into "YYYY-MM-DD".
 * Accepts (all with optional ordinals like 1st/2nd):
 *   2026-05-14 · 05/14/2026 · 5/14/2026 · 05-14-2026
 *   5/14        · 05/14        (current/next year inferred)
 *   May 14      · May 14 2026  · May 14, 2026
 *   14 May      · 14 May 2026  · 14th May 2026
 * Returns null if unparseable.
 */
function parseDate(str) {
  str = str.trim();

  // YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m.map(Number);
    if (_isValidDate(y, mo, d)) return _dateParts(y, mo, d);
  }

  // MM/DD/YYYY or M/D/YYYY
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, d, y] = m.map(Number);
    if (_isValidDate(y, mo, d)) return _dateParts(y, mo, d);
  }

  // MM-DD-YYYY
  m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const [, mo, d, y] = m.map(Number);
    if (_isValidDate(y, mo, d)) return _dateParts(y, mo, d);
  }

  // MM/DD or M/D  (no year)
  m = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const [, mo, d] = m.map(Number);
    const y = _inferYear(mo, d);
    if (_isValidDate(y, mo, d)) return _dateParts(y, mo, d);
  }

  // "May 14" / "May 14, 2026" / "May 14th 2026"
  m = str.match(/^([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?$/);
  if (m) {
    const mo = MONTH_NAMES[m[1].toLowerCase()];
    const d  = parseInt(m[2]);
    const y  = m[3] ? parseInt(m[3]) : _inferYear(mo, d);
    if (mo && _isValidDate(y, mo, d)) return _dateParts(y, mo, d);
  }

  // "14 May" / "14th May" / "14 May 2026"
  m = str.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]+)(?:[,\s]+(\d{4}))?$/);
  if (m) {
    const d  = parseInt(m[1]);
    const mo = MONTH_NAMES[m[2].toLowerCase()];
    const y  = m[3] ? parseInt(m[3]) : _inferYear(mo, d);
    if (mo && _isValidDate(y, mo, d)) return _dateParts(y, mo, d);
  }

  return null;
}

/**
 * Format a stored "HH:MM" (24h) to "7:00 PM".
 */
function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Format a Date as "YYYY-MM-DD". */
function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Return today's date as "YYYY-MM-DD" in America/Chicago timezone.
 * Use this instead of toDateString(new Date()) on Railway (UTC) to avoid
 * returning tomorrow's date after ~6pm Central time.
 */
function todayCentral() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

/** Format a Date as "Monday, April 6, 2026". */
function formatMeetingDate(date) {
  const dayName   = date.toLocaleDateString('en-US', { weekday: 'long' });
  const monthName = date.toLocaleDateString('en-US', { month:  'long'  });
  return `${dayName}, ${monthName} ${date.getDate()}, ${date.getFullYear()}`;
}

// ─── Recurrence ───────────────────────────────────────────────────────────────

const DAY_NAMES  = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEK_INDEX = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

/**
 * Return the Date of the Nth occurrence of a weekday in a given month/year.
 * week: 1–4, or -1 for 'last'. dayOfWeek: 0=Sun … 6=Sat.
 * Returns null if that occurrence doesn't exist (e.g. 5th Tuesday in a short month).
 */
function getNthWeekdayOfMonth(year, month, dayOfWeek, week) {
  if (week === -1) {
    const lastDay = new Date(year, month + 1, 0);
    const diff    = (lastDay.getDay() - dayOfWeek + 7) % 7;
    return new Date(year, month, lastDay.getDate() - diff);
  }
  const firstOfMonth = new Date(year, month, 1);
  const diff         = (dayOfWeek - firstOfMonth.getDay() + 7) % 7;
  const date         = 1 + diff + (week - 1) * 7;
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  return date <= daysInMonth ? new Date(year, month, date) : null;
}

/**
 * Given a meeting DB record, return the next occurrence Date on or after `from`.
 * Returns null if the meeting is a past one-time event.
 *
 * @param {object} meeting - DB row from the meetings table
 * @param {Date}   [from]  - default: today (midnight local)
 */
function nextOccurrence(meeting, from = null) {
  // Always compute "today" in Central time so Railway (UTC) doesn't treat
  // same-day meetings as past events.
  if (!from) {
    const centralStr = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    from = new Date(centralStr);
  }
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  if (!meeting.recurrence_type) {
    // One-time
    const [y, mo, d] = meeting.date.split('-').map(Number);
    const dt = new Date(y, mo - 1, d);
    return dt >= today ? dt : null;
  }

  if (meeting.recurrence_type === 'weekly') {
    const targetDay = DAY_NAMES.indexOf(meeting.recurrence_day);
    const diff      = (targetDay - today.getDay() + 7) % 7;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
  }

  if (meeting.recurrence_type === 'monthly_weekday') {
    const targetDay = DAY_NAMES.indexOf(meeting.recurrence_day);
    const weekNum   = WEEK_INDEX[meeting.recurrence_week];

    // Try this month, then next — one of these will always have a valid occurrence
    for (let offset = 0; offset <= 1; offset++) {
      const ref        = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const occurrence = getNthWeekdayOfMonth(ref.getFullYear(), ref.getMonth(), targetDay, weekNum);
      if (occurrence && occurrence >= today) return occurrence;
    }
  }

  return null;
}

// ─── Recurrence description (for display) ─────────────────────────────────────

/**
 * Return a human-readable recurrence description for a meeting record.
 * e.g. "Every Tuesday" or "First Tuesday of every month" or "May 14, 2026"
 */
function describeSchedule(meeting) {
  if (!meeting.recurrence_type) {
    const [y, mo, d] = meeting.date.split('-').map(Number);
    return formatMeetingDate(new Date(y, mo - 1, d));
  }
  const day = meeting.recurrence_day.charAt(0).toUpperCase() + meeting.recurrence_day.slice(1);
  if (meeting.recurrence_type === 'weekly') {
    return `Every ${day}`;
  }
  const week = meeting.recurrence_week.charAt(0).toUpperCase() + meeting.recurrence_week.slice(1);
  return `${week} ${day} of every month`;
}

module.exports = {
  parseTime,
  parseDate,
  formatTime,
  toDateString,
  todayCentral,
  formatMeetingDate,
  nextOccurrence,
  describeSchedule,
  DAY_NAMES,
  WEEK_INDEX,
};
