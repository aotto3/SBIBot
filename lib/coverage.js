'use strict';

const chrono = require('chrono-node');
const utils  = require('./utils');
const { showLabel } = require('./shows');

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
  const { requester_name, show, character } = request;
  const shiftWord   = shifts.length === 1 ? 'shift' : 'shifts';
  const coverageFor = character ? `**${character}** coverage` : 'coverage';
  return [
    `**${showLabel(show)} — Coverage Request**`,
    `**${requester_name}** is looking for ${coverageFor} for ${shifts.length} ${shiftWord}.`,
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
  const [y, mo, d] = shift.date.split('-').map(Number);
  const dateDisplay = utils.formatMeetingDate(new Date(y, mo - 1, d));
  const timeDisplay = utils.formatTime(shift.time);
  return `${dateDisplay} at ${timeDisplay}`;
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
  return `${prefix}**${requester_name}** was looking for shift coverage — All shifts in this request have been resolved. Thank you.`;
}

/**
 * Build the DM sent to the cast manager when a shift becomes fillable.
 *
 * @param {{ show, date, time, character, availableByRole, postLink }} opts
 *   availableByRole: flat string[] for single-role shows, or
 *                    object { roleName: string[] } for multi-role shows
 */
function buildFillableDM({ show, date, time, character, availableByRole, postLink }) {
  const [y, mo, d]  = date.split('-').map(Number);
  const dateDisplay = utils.formatMeetingDate(new Date(y, mo - 1, d));
  const timeDisplay = utils.formatTime(time);

  const lines = [`✅ **${showLabel(show)}** is ready to be filled!`];
  if (character) lines.push(`Character: ${character}`);
  lines.push(`${dateDisplay} at ${timeDisplay}`);

  if (Array.isArray(availableByRole)) {
    lines.push(`Available: ${availableByRole.join(', ')}`);
  } else {
    for (const [role, names] of Object.entries(availableByRole)) {
      lines.push(`${role}: ${names.join(', ')}`);
    }
  }

  lines.push(`→ ${postLink}`);
  return lines.join('\n');
}

/**
 * Build the consolidated 9pm EOD DM to the cast manager.
 *
 * @param {Array} pendingItems  Same shape as buildFillableDM input
 */
function buildEodDM(pendingItems) {
  if (!pendingItems.length) return '';

  const header = `📋 **Unconfirmed coverage requests as of 9pm:**`;
  const blocks = pendingItems.map(item => buildFillableDM(item));
  return [header, ...blocks].join('\n\n');
}

/**
 * Build the public confirmation message posted after Chaney confirms a shift.
 *
 * @param {{ type, show, date, time, takers, requester }} opts
 *   type:     'shift' | 'game'
 *   takers:   Array<{ userId: string, role: string|null }>
 *   requester: Discord user ID string, or null for custom games
 */
function buildConfirmationMessage({ type, show, date, time, takers, requester }) {
  const [y, mo, d]  = date.split('-').map(Number);
  const dateDisplay = utils.formatMeetingDate(new Date(y, mo - 1, d));
  const timeDisplay = utils.formatTime(time);

  if (type === 'shift') {
    const taker = takers[0];
    return `Confirmed <@${taker.userId}> for <@${requester}> on ${dateDisplay} at ${timeDisplay}.`;
  }

  // Custom game
  const isMultiRole = takers.some(t => t.role);
  if (isMultiRole) {
    const parts = takers.map(t => `<@${t.userId}> as ${t.role}`);
    const takerStr = parts.length === 1
      ? parts[0]
      : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    return `Confirmed ${takerStr} for **${showLabel(show)}** on ${dateDisplay} at ${timeDisplay}.`;
  }

  return `Confirmed <@${takers[0].userId}> for **${showLabel(show)}** custom game on ${dateDisplay} at ${timeDisplay}.`;
}

/**
 * Group open unfilled shift/game posts by channel and missing role.
 * Pure — no I/O. Caller is responsible for computing missingRoles per post.
 *
 * @param {Array<{ show, channel_id, shift_message_id, missingRoles: string[] }>} openShifts
 * @param {Array<{ show, channel_id, message_id, missingRoles: string[] }>}       openGames
 * @returns {Array<{ channelId: string, roleNames: string[], messageId: string }>}
 */
function planMissingRolePings(openShifts, openGames) {
  const results = [];

  for (const s of openShifts) {
    if (!s.missingRoles || s.missingRoles.length === 0) continue;
    results.push({ channelId: s.channel_id, roleNames: s.missingRoles, messageId: s.shift_message_id });
  }

  for (const g of openGames) {
    if (!g.missingRoles || g.missingRoles.length === 0) continue;
    results.push({ channelId: g.channel_id, roleNames: g.missingRoles, messageId: g.message_id });
  }

  return results;
}

/**
 * Decide what action to take when a single shift is cancelled.
 *
 * @param {{ id, shift_message_id, request_id }} shift  The shift being cancelled
 * @param {{ header_message_id, show, requester_name, character }} request
 * @param {Array} remainingOpenShifts  Open shifts in this request excluding the one being cancelled
 * @returns {{ action: 'delete-all'|'edit-header'|'delete-shift', headerContent?: string }}
 */
function planShiftCancel(shift, request, remainingOpenShifts) {
  if (remainingOpenShifts.length === 0) {
    return { action: 'delete-all' };
  }

  const isHeader = shift.shift_message_id === request.header_message_id;
  if (isHeader) {
    return {
      action: 'edit-header',
      headerContent: buildHeaderPost(request, remainingOpenShifts),
    };
  }

  return { action: 'delete-shift' };
}

module.exports = {
  parseShiftInput,
  isRequestDuplicate,
  groupShiftsForDisplay,
  buildHeaderPost,
  buildShiftPost,
  buildConfirmationPost,
  buildResolvedHeaderPost,
  buildFillableDM,
  buildEodDM,
  buildConfirmationMessage,
  planMissingRolePings,
  planShiftCancel,
};
