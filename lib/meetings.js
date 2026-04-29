const db    = require('./db');
const utils = require('./utils');

const RSVP_EMOJIS = ['✅', '❌', '❓'];

// Marker used to split the static header from the live RSVP tracker.
// A zero-width space (\u200B) is invisible in Discord but never appears in
// generated post content, making it a reliable split point for all tracker
// formats (meeting, custom game, and MFB role-grouped).
const TRACKER_MARKER = '\n\n\u200B';

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
 * Build the text content for a meeting reminder post.
 * Does not send anything — pure content generation for use by both
 * postMeetingReminder (new posts) and editMeetingPosts (updates).
 */
function buildMeetingReminderContent(meeting, instanceDate, reminderType) {
  let ping;
  if (meeting.target_type === 'everyone') {
    ping = '@everyone';
  } else if (meeting.target_type === 'here') {
    ping = '@here';
  } else {
    const members = db.getMeetingMembers(meeting.id);
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

  const isRecurring = !!meeting.recurrence_type;
  const includeRsvp = !(reminderType === 'created' && isRecurring);

  const duration = meeting.duration ?? 60;

  const [startH, startMin] = meeting.time.split(':').map(Number);
  const endDate    = new Date(2000, 0, 1, startH, startMin + duration);
  const endHHMM    = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
  const endDisplay = utils.formatTime(endHHMM);

  const lines = [
    `${ping} 📅 **${meeting.title}** — ${dateDisplay}, ${timeDisplay} – ${endDisplay}`,
    `_${dayLabel}_`,
  ];

  if (includeRsvp) {
    lines.push('', 'React to RSVP:  ✅ attending  ❌ can\'t make it  ❓ maybe');
  }

  const calUrl = buildGoogleCalendarUrl(meeting.title, instanceDate, meeting.time, duration);
  lines.push('', `📅 [Add to Google Calendar](<${calUrl}>)`);
  lines.push(`_Meeting ID: ${meeting.id}_`);

  return { content: lines.join('\n'), includeRsvp };
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

  if (meeting.target_type === 'members') {
    const members = db.getMeetingMembers(meeting.id);
    if (!members.length) {
      console.warn(`[meetings] Meeting ${meeting.id} has target_type=members but no members added — skipping`);
      return;
    }
  }

  const { content, includeRsvp } = buildMeetingReminderContent(meeting, instanceDate, reminderType);
  const msg = await channel.send(content);

  if (includeRsvp) {
    for (const emoji of RSVP_EMOJIS) {
      await msg.react(emoji);
    }
  }

  db.markReminderSent(meeting.id, instanceDate, reminderType, msg.id);
  console.log(`[meetings] Posted ${reminderType} reminder for "${meeting.title}" on ${instanceDate}`);
}

/**
 * Edit all existing Discord posts for a meeting to reflect updated meeting data.
 * Uses the pre-update channel_id to locate messages (since posts live in the old channel).
 *
 * @param {import('discord.js').Client} client
 * @param {object} meeting      - Updated DB row (post-update)
 * @param {string} oldChannelId - Channel ID where existing posts were sent
 * @returns {Promise<number>} count of successfully edited posts
 */
async function editMeetingPosts(client, meeting, oldChannelId) {
  const records = db.getAllReminderRecords(meeting.id);
  if (!records.length) return 0;

  let channel;
  try {
    channel = await client.channels.fetch(oldChannelId);
  } catch {
    return 0;
  }
  if (!channel) return 0;

  let edited = 0;
  for (const rec of records) {
    try {
      const msg = await channel.messages.fetch(rec.message_id);
      // Preserve the live RSVP tracker section if present
      const parts = msg.content.split(TRACKER_MARKER);
      const { content: newHeader } = buildMeetingReminderContent(meeting, rec.instance_date, rec.reminder_type);
      const newContent = parts.length > 1 ? newHeader + TRACKER_MARKER + parts[1] : newHeader;
      await msg.edit(newContent);
      edited++;
    } catch (err) {
      console.warn(`[meetings] Could not edit message ${rec.message_id} for meeting ${meeting.id}: ${err.message}`);
    }
  }
  return edited;
}

module.exports = { postMeetingReminder, editMeetingPosts, RSVP_EMOJIS, TRACKER_MARKER };
