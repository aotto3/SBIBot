'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('../lib/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-coverage-manager')
    .setDescription('Set who receives coverage fillable notifications and EOD reminders')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The cast manager who handles coverage confirmations')
        .setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    cfg.setCoverageManagerId(user.id);
    await interaction.reply({
      content: `✅ Coverage manager set to **${user.displayName ?? user.username}**. They will receive fillable notifications and EOD reminders.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
