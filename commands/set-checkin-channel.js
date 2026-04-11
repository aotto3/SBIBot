const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const { CHECKIN_SHOW_CHOICES, showLabel } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-checkin-channel')
    .setDescription('Set the alert channel for check-in no-shows for a specific show')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show to configure')
        .setRequired(true)
        .addChoices(...CHECKIN_SHOW_CHOICES)
    )
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to send check-in no-show alerts to')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const show    = interaction.options.getString('show');
    const channel = interaction.options.getChannel('channel');

    db.setConfig(`checkin_alert_channel_${show}`, channel.id);

    await interaction.editReply({
      content: `✅ Check-in alert channel for **${showLabel(show)}** set to <#${channel.id}>.`,
    });
  },
};
