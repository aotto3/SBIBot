const db    = require('./db');
const utils = require('./utils');

const RSVP_EMOJIS = ['✅', '❌', '❓'];

// Marker used to split the static header from the live RSVP tracker.
// Must not appear anywhere in the static message content.
const TRACKER_MARKER = '\n\n✅ **Attending';

/**
 * Build a Google Calendar "Add to Calendar" URL for a meeting occurrence.
 * Times are treated as America/Chicago local time (no UTC conversion —
 * Google Calendar interprets unmarked datetimes as the viewer's local time,
 * which is correct for a single-location company).
 */
function buildGoogleCalendarUrl(title, instanceDate, timeHHMM, durationMinutes) {
  const [y, mo, d]   = instanceDate.split('-').map(Number);
  const [h, min]     = timeHHMM.split(':').map(Number);
  const pad          = n => String(n).padStart(2, '0');
  const fmtDt        = (year, month, day, hour, minute) =>
    `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}00`;

  const startStr = fmtDt(y, mo, d, h, min);

  const endDate  = new Date(y, mo - 1, d, h, min + durationMinutes);
  const endStr   = fmtDt(
    endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate(),
    endDate.getHours(),    endDate.getMinutes()
  );

  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${startStr}/${endStr}` });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/**
 * Post a meeting reminder to its target channel, add RSVP reactions, and record in DB.
 * Skips silently if the reminder was already sent.
 *
 * @param {import('discord.js').Client} client
 * @param {object} meeting       - DB row from meetings table
 * @param {string} instanceDate  - "YYYY-MM-DD" of this specific occurrence
 * @param {string} reminderType  - 'created' | '7d' | '24h'
 */
async function postMeetingReminder(client, meeting, instanceDate, reminderType) {
  const alreadySent = db.hasReminderBeenSent(meeting.id, instanceDate, reminderType);
  if (alreadySent) return;

  let channel;
  try {
    channel = await client.channels.fetch(meeting.channel_id);
  } catch (err) {
    throw new Error(`Could not fetch channel <#${meeting.channel_id}> — make sure I have access to it. (${err.message})`);
  }

  if (!channel) {
    throw new Error(`Channel <#${meeting.channel_id}> not found — it may have been deleted.`);
  }

  // Build the ping prefix based on target type
  let ping;
  if (meeting.target_type === 'everyone') {
    ping = '@everyone';
  } else if (meeting.target_type === 'here') {
    ping = '@here';
  } else {
    const members = db.getMeetingMembers(meeting.id);
    if (!members.length) {
      console.warn(`[meetings] Meeting ${meeting.id} has target_type=members but no members added — skipping`);
      return;
    }
    ping = members.map(m => `<@${m.discord_id}>`).join(' ');
  }

  const [y, mo, d] = instanceDate.split('-').map(Number);
  const dateObj     = new Date(y, mo - 1, d);
  const dateDisplay = utils.formatMeetingDate(dateObj);
  const timeDisplay = utils.formatTime(meeting.time);

  const dayLabel = {
    'created': 'just scheduled',
    '7d':      '7 days away',
    '24h':     'tomorrow',
  }[reminderType] ?? reminderType;

  // RSVP reactions: skip on the 'created' post for recurring meetings
  // (the 7d reminder is the right time to collect RSVPs for recurring events).
  const isRecurring = !!meeting.recurrence_type;
  const includeRsvp = !(reminderType === 'created' && isRecurring);

  const lines = [
    `${ping} 📅 **${meeting.title}** — ${dateDisplay} at ${timeDisplay}`,
    `_${dayLabel}_`,
  ];

  if (includeRsvp) {
    lines.push('', 'React to RSVP:  ✅ attending  ❌ can\'t make it  ❓ maybe');
  }

  // Google Calendar link (always shown)
  const duration = meeting.duration ?? 60;
  const calUrl   = buildGoogleCalendarUrl(meeting.title, instanceDate, meeting.time, duration);
  lines.push('', `📅 [Add to Google Calendar](<${calUrl}>)`);

  const content = lines.join('\n');
  const msg     = await channel.send(content);

  if (includeRsvp) {
    for (const emoji of RSVP_EMOJIS) {
      await msg.react(emoji);
    }
  }

  db.markReminderSent(meeting.id, instanceDate, reminderType, msg.id);
  console.log(`[meetings] Posted ${reminderType} reminder for "${meeting.title}" on ${instanceDate}`);
}

module.exports = { postMeetingReminder, RSVP_EMOJIS, TRACKER_MARKER };
