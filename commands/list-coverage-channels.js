const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const { SHOWS, showLabel } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-coverage-channels')
    .setDescription('Show the configured coverage request channel for each show')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const lines = Object.keys(SHOWS).map(showKey => {
      const channelId = db.getConfig(`coverage_channel_${showKey}`);
      const channelStr = channelId ? `<#${channelId}>` : '_Not set_';
      return `**${showLabel(showKey)}** — ${channelStr}`;
    });

    await interaction.editReply({
      content: `**Coverage request channels:**\n${lines.join('\n')}`,
    });
  },
};
