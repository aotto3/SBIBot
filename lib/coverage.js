'use strict';

const chrono = require('chrono-node');
const utils  = require('./utils');
const { SHOWS, showLabel } = require('./shows');

// ─── Pure functions ───────────────────────────────────────────────────────────

/**
 * Parse free-text shift input into structured shift objects.
 * Supports natural language dates and times via chrono-node.
 *
 * @param {string} text          User-entered text (may contain multiple shifts)
 * @param {Date}   [referenceDate]  Reference date for relative expressions (default: now)
 * @returns {Array<{ date: string, time: string|null }>}
 *   date: 'YYYY-MM-DD', time: 'HH:MM' 24h or null if no time specified
 */
function parseShiftInput(text, referenceDate = new Date()) {
  // Normalize '@' as a date/time separator (common shorthand: "5/1 @ 7pm")
  const normalized = text.replace(/\s*@\s*/g, ' at ');
  const results = chrono.parse(normalized, referenceDate, { forwardDate: true });

  return results
    .filter(r => r.start.isCertain('month') && r.start.isCertain('day'))
    .map(r => {
      const d   = r.start.date();
      const y   = d.getFullYear();
      const mo  = d.getMonth() + 1;
      const day = d.getDate();
      const date = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      let time = null;
      if (r.start.isCertain('hour')) {
        let h   = d.getHours();
        const m = d.getMinutes();

        // Default ambiguous hours (1–11, no explicit AM/PM) to PM.
        // Most shows run in the evening, so "7" should mean 7:00 PM not 7:00 AM.
        const hasMeridiem = /am\b|pm\b/i.test(r.text);
        if (!hasMeridiem && h >= 1 && h <= 11) h += 12;

        time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }

      return { date, time };
    });
}

/**
 * Return true if any existing open shift matches the new shift's date and time.
 * Only considers shifts with status 'open' — covered/cancelled shifts don't block.
 *
 * @param {Array<{ date: string, time: string, status: string }>} existingShifts
 * @param {{ date: string, time: string }} newShift
 */
function isRequestDuplicate(existingShifts, newShift) {
  return existingShifts.some(
    s => s.status === 'open' && s.date === newShift.date && s.time === newShift.time
  );
}

/**
 * Group an array of shifts by date for display purposes.
 *
 * @param {Array<{ date: string }>} shifts
 * @returns {Object}  Keys are 'YYYY-MM-DD', values are arrays of shifts for that date
 */
function groupShiftsForDisplay(shifts) {
  const groups = {};
  for (const shift of shifts) {
    if (!groups[shift.date]) groups[shift.date] = [];
    groups[shift.date].push(shift);
  }
  return groups;
}

/**
 * Build the content string for the header post of a coverage request.
 * Paired with the first shift post when there's only one shift.
 *
 * @param {{ requester_name: string, show: string }} request
 * @param {Array} shifts
 */
function buildHeaderPost(request, shifts) {
  const { requester_name, show } = request;
  const shiftWord = shifts.length === 1 ? 'shift' : 'shifts';
  return [
    `**${showLabel(show)} — Coverage Request**`,
    `**${requester_name}** is looking for coverage for ${shifts.length} ${shiftWord}.`,
    `React ✅ if available, ❌ if unavailable, or ❓ if unsure.`,
  ].join('\n');
}

/**
 * Build the static content string for an individual shift post.
 * The live tracker section (after \u200B) is managed by the RSVP handler.
 *
 * @param {{ show: string }} request
 * @param {{ date: string, time: string }} shift
 */
function buildShiftPost(request, shift) {
  const { show } = request;
  const [y, mo, d] = shift.date.split('-').map(Number);
  const dateDisplay = utils.formatMeetingDate(new Date(y, mo - 1, d));
  const timeDisplay = utils.formatTime(shift.time);
  return `**${showLabel(show)}** — ${dateDisplay} at ${timeDisplay}`;
}

/**
 * Build the confirmation message Chaney posts after switching a cast member in.
 *
 * @param {string} requesterName  Display name of the person giving up the shift
 * @param {string} takerName      Display name of the person taking the shift
 * @param {string} show           Show key (e.g. 'GGB')
 * @param {string} date           'YYYY-MM-DD'
 * @param {string} time           'HH:MM' 24h
 */
function buildConfirmationPost(requesterName, takerName, show, date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const dateDisplay = utils.formatMeetingDate(new Date(y, mo - 1, d));
  const timeDisplay = utils.formatTime(time);
  return `✅ Confirmed: I have switched **${takerName}** in for **${requesterName}** on ${dateDisplay} at ${timeDisplay}.`;
}

/**
 * Build the updated header post content once all shifts in a request are resolved.
 *
 * @param {{ requester_name: string, show: string }} request
 * @param {string} [roleMention]  Optional Discord role mention string (e.g. '<@&123456>')
 */
function buildResolvedHeaderPost(request, roleMention = '') {
  const { requester_name } = request;
  const prefix = roleMention ? `${roleMention} ` : '';
  return `${prefix}**${requester_name}** was looking for shift coverage — All shifts in this request have been covered! Thank you.`;
}

module.exports = {
  parseShiftInput,
  isRequestDuplicate,
  groupShiftsForDisplay,
  buildHeaderPost,
  buildShiftPost,
  buildConfirmationPost,
  buildResolvedHeaderPost,
};
