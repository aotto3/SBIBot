const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const { SHOW_CHOICES, showLabel, showCharacters, showPrefix, showAutoRole } = require('../lib/shows');

const TYPE_CHOICES = [
  { name: 'Coverage Requests',     value: 'coverage'     },
  { name: 'Check-in Alerts',       value: 'checkin'      },
  { name: 'Custom Game Requests',  value: 'custom-game'  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear-channel-override')
    .setDescription('Remove a channel override — bot will auto-resolve by name convention')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Which channel type to clear')
        .setRequired(true)
        .addChoices(...TYPE_CHOICES)
    )
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show')
        .setRequired(true)
        .addChoices(...SHOW_CHOICES)
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

    let key;
    let autoName;
    const prefix = showPrefix(show);

    switch (type) {
      case 'coverage': {
        const slug = character ? character.toLowerCase() : showAutoRole(show)?.toLowerCase();
        key      = character ? `coverage_channel_${show}_${character}` : `coverage_channel_${show}`;
        autoName = `${prefix}-${slug}`;
        break;
      }
      case 'checkin':
        key      = `checkin_alert_channel_${show}`;
        autoName = `${prefix}-times`;
        break;
      case 'custom-game':
        key      = `custom_game_channel_${show}`;
        autoName = `${prefix}-times`;
        break;
    }

    const had = db.getConfig(key);
    db.deleteConfig(key);

    const label = character ? `${showLabel(show)} — ${character}` : showLabel(show);
    if (had) {
      await interaction.editReply({
        content: `✅ Override cleared for **${label}** ${type}. Will now auto-resolve to \`#${autoName}\`.`,
      });
    } else {
      await interaction.editReply({
        content: `ℹ️ No override was set for **${label}** ${type}. Already auto-resolving to \`#${autoName}\`.`,
      });
    }
  },
};
