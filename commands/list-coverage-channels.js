const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('../lib/config');
const { showKeys, showLabel, showCharacters, showPrefix, showAutoRole, hasCheckin } = require('../lib/shows');

function resolveDisplay(guild, overrideId, autoName) {
  if (overrideId) {
    const ch = guild.channels.cache.get(overrideId);
    return ch ? `override: <#${overrideId}>` : `override: _(ID ${overrideId} not found)_`;
  }
  const ch = guild.channels.cache.find(c => c.name === autoName);
  return ch ? `auto: <#${ch.id}>` : `auto: _(#${autoName} not found)_`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-coverage-channels')
    .setDescription('Show channel routing for coverage, check-in alerts, and custom games')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const sections = [];

    for (const showKey of showKeys()) {
      const chars  = showCharacters(showKey);
      const prefix = showPrefix(showKey);
      const label  = showLabel(showKey);
      const lines  = [`**${label}**`];

      // Coverage requests — one row per character/role
      const entries = chars
        ? chars.map(character => ({ character, slug: character.toLowerCase() }))
        : [{ character: null, slug: showAutoRole(showKey)?.toLowerCase() }];

      for (const { character, slug } of entries) {
        const rowLabel   = character ? `  Coverage (${character})` : '  Coverage';
        const overrideId = cfg.getCoverageChannelId(showKey, character);
        lines.push(`${rowLabel}: ${resolveDisplay(guild, overrideId, `${prefix}-${slug}`)}`);
      }

      // Custom game
      lines.push(`  Custom game: ${resolveDisplay(guild, cfg.getCustomGameChannelId(showKey), `${prefix}-times`)}`);

      // Check-in alerts (only shows that have check-in configured)
      if (hasCheckin(showKey)) {
        lines.push(`  Check-in alerts: ${resolveDisplay(guild, cfg.getCheckinAlertChannelId(showKey), `${prefix}-times`)}`);
      }

      sections.push(lines.join('\n'));
    }

    await interaction.editReply({
      content: sections.join('\n\n'),
    });
  },
};
