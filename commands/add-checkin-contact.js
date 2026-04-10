const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-checkin-contact')
    .setDescription('Add a user to the check-in no-show notification list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to add to the notification list')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('user');

    db.addCheckinContact(user.id);

    await interaction.editReply({
      content: `✅ <@${user.id}> added to check-in notification list.`,
    });
  },
};
