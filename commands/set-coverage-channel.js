const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('../lib/config');
const { SHOW_CHOICES, showLabel, showCharacters } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-coverage-channel')
    .setDescription('Set the channel where coverage requests for a show are posted')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show to configure')
        .setRequired(true)
        .addChoices(...SHOW_CHOICES)
    )
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to post coverage requests in')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('character')
        .setDescription('Character to configure (required for MFB and The Endings)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const show      = interaction.options.getString('show');
    const channel   = interaction.options.getChannel('channel');
    const character = interaction.options.getString('character');
    const chars     = showCharacters(show);

    if (chars) {
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
      cfg.setCoverageChannelId(show, character, channel.id);
      await interaction.editReply({
        content: `✅ Coverage request channel for **${showLabel(show)} — ${character}** set to <#${channel.id}>.`,
      });
    } else {
      cfg.setCoverageChannelId(show, null, channel.id);
      await interaction.editReply({
        content: `✅ Coverage request channel for **${showLabel(show)}** set to <#${channel.id}>.`,
      });
    }
  },
};
