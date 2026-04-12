const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const { SHOW_CHOICES, showLabel } = require('../lib/shows');

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
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const show    = interaction.options.getString('show');
    const channel = interaction.options.getChannel('channel');

    db.setConfig(`coverage_channel_${show}`, channel.id);

    await interaction.editReply({
      content: `✅ Coverage request channel for **${showLabel(show)}** set to <#${channel.id}>.`,
    });
  },
};
