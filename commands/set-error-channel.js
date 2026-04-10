const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-error-channel')
    .setDescription('Set the channel for bot operational error messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to send bot error messages to')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.options.getChannel('channel');

    db.setConfig('error_channel_id', channel.id);

    await interaction.editReply({
      content: `✅ Error channel set to <#${channel.id}>.`,
    });
  },
};
