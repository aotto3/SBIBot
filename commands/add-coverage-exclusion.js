const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-coverage-exclusion')
    .setDescription('Exclude a user from targeted coverage reminder pings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to exclude from coverage reminder pings')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('user');

    db.addCoveragePingExclusion(user.id);

    await interaction.editReply({
      content: `✅ <@${user.id}> will no longer receive targeted coverage reminder pings.`,
    });
  },
};
