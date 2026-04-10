const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-checkin-contact')
    .setDescription('Remove a user from the check-in no-show notification list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to remove from the notification list')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('user');

    db.removeCheckinContact(user.id);

    await interaction.editReply({
      content: `✅ <@${user.id}> removed from check-in notification list.`,
    });
  },
};
