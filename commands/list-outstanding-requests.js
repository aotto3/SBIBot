'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const repo  = require('../lib/coverage-repository');
const utils = require('../lib/utils');
const { buildOutstandingEmbeds } = require('../lib/coverage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-outstanding-requests')
    .setDescription('List outstanding coverage shifts and custom games (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const today  = utils.todayCentral();
    const shifts = repo.getOutstandingShifts(today);
    const embeds = buildOutstandingEmbeds(shifts, [], interaction.guildId);

    if (!embeds.length) {
      return interaction.editReply('✅ No outstanding requests.');
    }
    return interaction.editReply({ embeds });
  },
};
