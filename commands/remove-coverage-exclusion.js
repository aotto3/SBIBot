const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove-coverage-exclusion')
    .setDescription('Re-enable targeted coverage reminder pings for a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to remove from the coverage ping exclusion list')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('user');

    db.removeCoveragePingExclusion(user.id);

    await interaction.editReply({
      content: `✅ <@${user.id}> removed from the coverage ping exclusion list.`,
    });
  },
};
