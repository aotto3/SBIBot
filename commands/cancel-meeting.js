const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db    = require('../lib/db');
const utils = require('../lib/utils');

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

    // Post cancellation notice to the meeting channel
    let channelWarning = '';
    try {
      const channel = await interaction.client.channels.fetch(meeting.channel_id);
      await channel.send(`📅 ~~**${meeting.title}**~~ — ${schedule} at ${time}\n_This meeting has been cancelled._`);
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
