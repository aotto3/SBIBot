const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('../lib/config');
const { showKeys, showLabel, showCharacters, showPrefix, showAutoRole } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-coverage-channels')
    .setDescription('Show coverage request channel routing for each show')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const lines = [];

    for (const showKey of showKeys()) {
      const chars = showCharacters(showKey);
      const prefix = showPrefix(showKey);
      const entries = chars
        ? chars.map(character => ({ character, slug: character.toLowerCase() }))
        : [{ character: null, slug: showAutoRole(showKey)?.toLowerCase() }];

      for (const { character, slug } of entries) {
        const label      = character ? `**${showLabel(showKey)} — ${character}**` : `**${showLabel(showKey)}**`;
        const overrideId = cfg.getCoverageChannelId(showKey, character);

        if (overrideId) {
          const ch = guild.channels.cache.get(overrideId);
          const chStr = ch ? `<#${overrideId}>` : `_(override ID ${overrideId} not found)_`;
          lines.push(`${label} — override: ${chStr}`);
        } else {
          const autoName = `${prefix}-${slug}`;
          const ch = guild.channels.cache.find(c => c.name === autoName);
          const chStr = ch ? `<#${ch.id}>` : `_(channel \`#${autoName}\` not found)_`;
          lines.push(`${label} — auto: ${chStr}`);
        }
      }
    }

    await interaction.editReply({
      content: `**Coverage request channels:**\n${lines.join('\n')}`,
    });
  },
};
