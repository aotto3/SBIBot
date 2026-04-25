const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('../lib/config');
const { showKeys, showLabel, showCharacters } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-coverage-channels')
    .setDescription('Show the configured coverage request channel for each show')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const lines = [];
    for (const showKey of showKeys()) {
      const chars = showCharacters(showKey);
      if (chars) {
        for (const character of chars) {
          const channelId  = cfg.getCoverageChannelId(showKey, character);
          const channelStr = channelId ? `<#${channelId}>` : '_Not set_';
          lines.push(`**${showLabel(showKey)} — ${character}** — ${channelStr}`);
        }
      } else {
        const channelId  = cfg.getCoverageChannelId(showKey);
        const channelStr = channelId ? `<#${channelId}>` : '_Not set_';
        lines.push(`**${showLabel(showKey)}** — ${channelStr}`);
      }
    }

    await interaction.editReply({
      content: `**Coverage request channels:**\n${lines.join('\n')}`,
    });
  },
};
