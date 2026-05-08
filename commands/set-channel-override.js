const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('../lib/config');
const { SHOW_CHOICES, showLabel, showCharacters } = require('../lib/shows');

const TYPE_CHOICES = [
  { name: 'Coverage Requests',     value: 'coverage'     },
  { name: 'Check-in Alerts',       value: 'checkin'      },
  { name: 'Custom Game Requests',  value: 'custom-game'  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-channel-override')
    .setDescription('Override the auto-resolved channel for a show (e.g. redirect to #test)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Which channel type to override')
        .setRequired(true)
        .addChoices(...TYPE_CHOICES)
    )
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show')
        .setRequired(true)
        .addChoices(...SHOW_CHOICES)
    )
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to redirect to')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('character')
        .setDescription('Character (required when type=coverage for MFB/Endings)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const show    = interaction.options.getString('show');
    const chars   = show ? showCharacters(show) : null;
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = chars
      ? chars.filter(c => c.toLowerCase().startsWith(focused)).map(c => ({ name: c, value: c }))
      : [];
    await interaction.respond(choices);
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const type      = interaction.options.getString('type');
    const show      = interaction.options.getString('show');
    const channel   = interaction.options.getChannel('channel');
    const character = interaction.options.getString('character');
    const chars     = showCharacters(show);

    if (type === 'coverage' && chars) {
      if (!character) {
        await interaction.editReply({
          content: `❌ **${showLabel(show)}** has multiple characters (${chars.join(', ')}). Please specify a character.`,
        });
        return;
      }
      if (!chars.includes(character)) {
        await interaction.editReply({
          content: `❌ Invalid character **${character}** for **${showLabel(show)}**. Valid options: ${chars.join(', ')}.`,
        });
        return;
      }
    }

    switch (type) {
      case 'coverage':
        cfg.setCoverageChannelId(show, character ?? null, channel.id);
        break;
      case 'checkin':
        cfg.setCheckinAlertChannelId(show, channel.id);
        break;
      case 'custom-game':
        cfg.setCustomGameChannelId(show, channel.id);
        break;
    }

    const label = character ? `${showLabel(show)} — ${character}` : showLabel(show);
    await interaction.editReply({
      content: `✅ **${label}** ${type} channel overridden → <#${channel.id}>.\nRun \`/clear-channel-override\` to revert to auto-resolve.`,
    });
  },
};
