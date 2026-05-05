const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-coverage-exclusions')
    .setDescription('List all users excluded from targeted coverage reminder pings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const exclusions = db.getCoveragePingExclusions();

    if (!exclusions.length) {
      await interaction.editReply({ content: 'No coverage ping exclusions configured.' });
      return;
    }

    const mentions = exclusions.map(id => `<@${id}>`).join('\n');

    await interaction.editReply({
      content: `**Coverage ping exclusions:**\n${mentions}`,
    });
  },
};
