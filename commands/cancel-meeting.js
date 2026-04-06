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

    await interaction.reply({
      content: `❌ Cancelled **${meeting.title}** (${schedule} at ${time}).\nPast reminder records are preserved.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
