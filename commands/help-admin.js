const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildHelpEmbed } = require('../lib/command-catalog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help-admin')
    .setDescription('Show all admin / management bot commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.reply({ embeds: [buildHelpEmbed({ admin: true })], flags: MessageFlags.Ephemeral });
  },
};
