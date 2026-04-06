const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meeting-add-member')
    .setDescription('Add a Discord member to a members-targeted meeting')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('meeting_id')
        .setDescription('Meeting ID (from /meetings or shown when meeting was created)')
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Discord user to add')
        .setRequired(true)
    ),

  async execute(interaction) {
    const meetingId = interaction.options.getInteger('meeting_id');
    const user      = interaction.options.getUser('user');

    const meeting = db.getMeeting(meetingId);
    if (!meeting) {
      return interaction.reply({ content: `No meeting found with ID \`${meetingId}\`.`, flags: MessageFlags.Ephemeral });
    }
    if (!meeting.active) {
      return interaction.reply({ content: `Meeting \`${meetingId}\` is cancelled.`, flags: MessageFlags.Ephemeral });
    }
    if (meeting.target_type !== 'members') {
      return interaction.reply({
        content: `**${meeting.title}** targets \`${meeting.target_type}\` — member lists only apply to \`members\`-targeted meetings.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    db.addMeetingMember(meetingId, user.id);

    await interaction.reply({
      content: `Added <@${user.id}> to **${meeting.title}** (ID: \`${meetingId}\`)`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
