const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db      = require('../lib/db');
const utils   = require('../lib/utils');
const { buildCancelledPostContent, TRACKER_MARKER } = require('../lib/meetings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel-meeting')
    .setDescription('Cancel (deactivate) a scheduled meeting')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('meeting_id')
        .setDescription('Meeting ID (from /meetings)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const meetingId = interaction.options.getInteger('meeting_id');
    const meeting   = db.getMeeting(meetingId);

    if (!meeting) {
      return interaction.reply({ content: `No meeting found with ID \`${meetingId}\`.`, flags: MessageFlags.Ephemeral });
    }
    if (!meeting.active) {
      return interaction.reply({ content: `**${meeting.title}** is already cancelled.`, flags: MessageFlags.Ephemeral });
    }

    db.deactivateMeeting(meetingId);

    const schedule = utils.describeSchedule(meeting);
    const time     = utils.formatTime(meeting.time);

    // Edit all existing 'created' posts to show cancellation; find the most recent for a link
    const createdRecords = db.getAllReminderRecords(meetingId)
      .filter(r => r.reminder_type === 'created')
      .sort((a, b) => (b.instance_date > a.instance_date ? 1 : -1));

    let originalPostUrl = null;
    let channel = null;
    let channelWarning = '';

    try {
      channel = await interaction.client.channels.fetch(meeting.channel_id);

      for (const rec of createdRecords) {
        try {
          const msg = await channel.messages.fetch(rec.message_id);
          const cancelledHeader = buildCancelledPostContent(meeting, rec.instance_date);
          const parts = msg.content.split(TRACKER_MARKER);
          const newContent = parts.length > 1 ? cancelledHeader + TRACKER_MARKER + parts[1] : cancelledHeader;
          await msg.edit(newContent);
        } catch {
          // message gone or inaccessible — skip silently
        }
      }

      if (createdRecords.length) {
        originalPostUrl = `https://discord.com/channels/${interaction.guildId}/${meeting.channel_id}/${createdRecords[0].message_id}`;
      }

      const linkLine = originalPostUrl ? `\nOriginal post: ${originalPostUrl}` : '';
      await channel.send(`📅 ~~**${meeting.title}**~~ — ${schedule} at ${time}\n_This meeting has been cancelled._${linkLine}`);
    } catch (err) {
      console.error(`[cancel-meeting] Could not post cancellation notice for meeting ${meetingId}:`, err);
      channelWarning = `\n⚠️ Couldn't post to <#${meeting.channel_id}> — check that I have permission to send messages there.`;
    }

    await interaction.reply({
      content: `❌ Cancelled **${meeting.title}** (${schedule} at ${time}).\nPast reminder records are preserved.${channelWarning}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
