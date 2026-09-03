const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildHelpEmbed } = require('../lib/command-catalog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the bot commands available to everyone'),

  async execute(interaction) {
    await interaction.reply({ embeds: [buildHelpEmbed({ admin: false })], flags: MessageFlags.Ephemeral });
  },
};
