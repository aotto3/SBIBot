const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db             = require('../lib/db');
const utils          = require('../lib/utils');
const { RSVP_EMOJIS } = require('../lib/meetings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('attendance')
    .setDescription('Show RSVP counts for a meeting reminder')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('meeting_id')
        .setDescription('Meeting ID (from /meetings)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Occurrence date YYYY-MM-DD — defaults to the most recent reminder sent')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const meetingId = interaction.options.getInteger('meeting_id');
    const dateOpt   = interaction.options.getString('date');

    const meeting = db.getMeeting(meetingId);
    if (!meeting) {
      return interaction.editReply(`No meeting found with ID \`${meetingId}\`.`);
    }

    // Find the reminder record to get a message ID
    let record;
    if (dateOpt) {
      const parsedDate = utils.parseDate(dateOpt);
      if (!parsedDate) {
        return interaction.editReply(`Couldn't parse date \`${dateOpt}\`. Try: \`May 14\`, \`5/14/2026\`, \`2026-05-14\``);
      }
      // Prefer 24h over 7d for the given date (more responses expected)
      record = db.getReminderRecord(meetingId, parsedDate, '24h')
            || db.getReminderRecord(meetingId, parsedDate, '7d');
    } else {
      // Most recent reminder sent for this meeting
      record = db.db.prepare(`
        SELECT * FROM meeting_reminders_sent
        WHERE meeting_id = ?
        ORDER BY instance_date DESC, reminder_type DESC
        LIMIT 1
      `).get(meetingId);
    }

    if (!record || !record.message_id) {
      return interaction.editReply(`No reminder has been posted for meeting \`${meetingId}\` yet.`);
    }

    // Fetch the channel and message
    let channel, message;
    try {
      channel = await interaction.client.channels.fetch(meeting.channel_id);
      message = await channel.messages.fetch(record.message_id);
    } catch {
      return interaction.editReply(`Couldn't fetch the reminder message. It may have been deleted.`);
    }

    // Collect reactions — skip bot's own reactions
    const results = { '✅': [], '❌': [], '❓': [] };

    for (const emoji of RSVP_EMOJIS) {
      const reaction = message.reactions.cache.get(emoji);
      if (!reaction) continue;

      const users = await reaction.users.fetch();
      for (const [id, user] of users) {
        if (user.bot) continue;
        const member = await interaction.guild.members.fetch(id).catch(() => null);
        const name   = member
          ? (member.nickname || member.user.globalName || member.user.username)
          : user.username;
        results[emoji].push(name);
      }
    }

    // For members-targeted meetings we can list non-responders
    let noResponse = [];
    if (meeting.target_type === 'members') {
      const allResponded = new Set([
        ...results['✅'],
        ...results['❌'],
        ...results['❓'],
      ]);
      const meetingMembers = db.getMeetingMembers(meetingId);
      for (const mm of meetingMembers) {
        const member = await interaction.guild.members.fetch(mm.discord_id).catch(() => null);
        const name   = member
          ? (member.nickname || member.user.globalName || member.user.username)
          : mm.discord_id;
        if (!allResponded.has(name)) noResponse.push(name);
      }
    }

    // Format output
    const instanceDate = record.instance_date;
    const [y, mo, d]   = instanceDate.split('-').map(Number);
    const dateDisplay  = utils.formatMeetingDate(new Date(y, mo - 1, d));
    const timeDisplay  = utils.formatTime(meeting.time);

    const fmt = (emoji, label, names) => {
      if (!names.length) return `${emoji} ${label} (0)`;
      return `${emoji} ${label} (${names.length}): ${names.join(', ')}`;
    };

    const lines = [
      `**${meeting.title} — ${dateDisplay} at ${timeDisplay}**`,
      '',
      fmt('✅', 'Attending',     results['✅']),
      fmt('❌', "Can't make it", results['❌']),
      fmt('❓', 'Maybe',         results['❓']),
    ];

    if (noResponse.length) {
      lines.push(fmt('⬜', 'No response', noResponse));
    }

    await interaction.editReply(lines.join('\n'));
  },
};
