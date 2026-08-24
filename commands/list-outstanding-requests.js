'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const repo  = require('../lib/coverage-repository');
const utils = require('../lib/utils');
const { showKeys, showLabel } = require('../lib/shows');
const { buildOutstandingEmbeds, buildOutstandingEmptyState } = require('../lib/coverage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('list-outstanding-requests')
    .setDescription('List outstanding coverage shifts and custom games (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt => {
      opt.setName('show')
        .setDescription('Limit to one show (default: all shows)')
        .setRequired(false);
      for (const key of showKeys()) opt.addChoices({ name: showLabel(key), value: key });
      return opt;
    }),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const show   = interaction.options.getString('show'); // null when omitted → all shows
    const today  = utils.todayCentral();
    const shifts = repo.getOutstandingShifts(today, show);
    const games  = repo.getOutstandingGames(today, show);
    const embeds = buildOutstandingEmbeds(shifts, games, interaction.guildId, show);

    if (!embeds.length) {
      return interaction.editReply(buildOutstandingEmptyState(show ? showLabel(show) : null));
    }
    return interaction.editReply({ embeds });
  },
};
