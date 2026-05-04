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
 * Build the text content for a 7d/24h follow-up reminder post.
 * Pure function — no Discord or DB calls. Takes pre-fetched attendee mentions
 * and the URL of the original 'created' post.
 *
 * @param {object} meeting          - DB row from meetings table
 * @param {string} instanceDate     - "YYYY-MM-DD"
 * @param {string} reminderType     - '7d' | '24h'
 * @param {string[]} attendeeMentions - Array of "<@userId>" strings (✅ + ❓ reactors)
 * @param {string|null} originalUrl - Discord message URL, or null if unavailable
 */
function buildFollowupReminderContent(meeting, instanceDate, reminderType, attendeeMentions, originalUrl) {
  const [y, mo, d] = instanceDate.split('-').map(Number);
  const dateObj     = new Date(y, mo - 1, d);
  const dateDisplay = utils.formatMeetingDate(dateObj);
  const timeDisplay = utils.formatTime(meeting.time);

  const duration = meeting.duration ?? 60;
  const [startH, startMin] = meeting.time.split(':').map(Number);
  const endDate    = new Date(2000, 0, 1, startH, startMin + duration);
  const endHHMM    = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
  const endDisplay = utils.formatTime(endHHMM);

  const dayLabel = reminderType === '7d' ? 'is in 7 days' : 'is in 24 hours';

  const lines = [
    `📅 **${meeting.title}** — ${dateDisplay}, ${timeDisplay} – ${endDisplay}`,
    `_${dayLabel}_`,
  ];

  if (attendeeMentions.length) {
    lines.push('', `Attending (so far): ${attendeeMentions.join(' ')}`);
  }

  if (originalUrl) {
    lines.push('', `RSVP on the original post: ${originalUrl}`);
  } else {
    lines.push('', `_(original post unavailable)_`);
  }

  const calUrl = buildGoogleCalendarUrl(meeting.title, instanceDate, meeting.time, duration);
  lines.push('', `📅 [Add to Google Calendar](<${calUrl}>)`);
  lines.push(`_Meeting ID: ${meeting.id}_`);

  return lines.join('\n');
}

/**
 * Build the header content for a cancelled 'created' post.
 * Returns only the header (no tracker) — callers must re-attach the tracker section if present.
 *
 * @param {object} meeting      - DB row from meetings table
 * @param {string} instanceDate - "YYYY-MM-DD"
 */
function buildCancelledPostContent(meeting, instanceDate) {
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

  const duration = meeting.duration ?? 60;
  const [startH, startMin] = meeting.time.split(':').map(Number);
  const endDate    = new Date(2000, 0, 1, startH, startMin + duration);
  const endHHMM    = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
  const endDisplay = utils.formatTime(endHHMM);

  return [
    `${ping} 📅 ~~**${meeting.title}**~~ — ${dateDisplay}, ${timeDisplay} – ${endDisplay}`,
    `_This meeting has been cancelled._`,
  ].join('\n');
}

/**
 * Fetch the Discord user IDs of ✅ and ❓ reactors on a message, excluding bots.
 * Returns a deduplicated array of user ID strings.
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<string[]>}
 */
async function fetchAttendeeIds(message) {
  const ids = new Set();
  for (const emojiName of ['✅', '❓']) {
    const reaction = message.reactions.cache.find(r => r.emoji.name === emojiName);
    if (!reaction) continue;
    const users = await reaction.users.fetch();
    users.filter(u => !u.bot).forEach(u => ids.add(u.id));
  }
  return [...ids];
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

  let msgContent;
  let addReactions = false;

  if (reminderType === '7d' || reminderType === '24h') {
    let attendeeMentions = [];
    let originalUrl = null;

    const createdRecord = db.getCreatedReminderRecord(meeting.id, instanceDate);
    if (createdRecord) {
      try {
        const originalMsg = await channel.messages.fetch(createdRecord.message_id);
        originalUrl = `https://discord.com/channels/${channel.guildId}/${meeting.channel_id}/${createdRecord.message_id}`;
        const ids = await fetchAttendeeIds(originalMsg);
        attendeeMentions = ids.map(id => `<@${id}>`);
      } catch {
        // original post unavailable — post without link or mentions
      }
    }

    msgContent = buildFollowupReminderContent(meeting, instanceDate, reminderType, attendeeMentions, originalUrl);
  } else {
    const { content, includeRsvp } = buildMeetingReminderContent(meeting, instanceDate, reminderType);
    msgContent = content;
    addReactions = includeRsvp;
  }

  const msg = await channel.send(msgContent);

  if (addReactions) {
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
      let newContent;

      if (rec.reminder_type === '7d' || rec.reminder_type === '24h') {
        let attendeeMentions = [];
        let originalUrl = null;

        const createdRecord = db.getCreatedReminderRecord(meeting.id, rec.instance_date);
        if (createdRecord) {
          try {
            const originalMsg = await channel.messages.fetch(createdRecord.message_id);
            originalUrl = `https://discord.com/channels/${channel.guildId}/${oldChannelId}/${createdRecord.message_id}`;
            const ids = await fetchAttendeeIds(originalMsg);
            attendeeMentions = ids.map(id => `<@${id}>`);
          } catch {
            // original post unavailable
          }
        }

        newContent = buildFollowupReminderContent(meeting, rec.instance_date, rec.reminder_type, attendeeMentions, originalUrl);
      } else {
        // 'created' — preserve the live RSVP tracker section
        const parts = msg.content.split(TRACKER_MARKER);
        const { content: newHeader } = buildMeetingReminderContent(meeting, rec.instance_date, rec.reminder_type);
        newContent = parts.length > 1 ? newHeader + TRACKER_MARKER + parts[1] : newHeader;
      }

      await msg.edit(newContent);
      edited++;
    } catch (err) {
      console.warn(`[meetings] Could not edit message ${rec.message_id} for meeting ${meeting.id}: ${err.message}`);
    }
  }
  return edited;
}

module.exports = { postMeetingReminder, editMeetingPosts, buildFollowupReminderContent, buildCancelledPostContent, fetchAttendeeIds, RSVP_EMOJIS, TRACKER_MARKER };
