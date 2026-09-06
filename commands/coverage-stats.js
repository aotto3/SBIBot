'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const repo    = require('../lib/coverage-repository');
const members = require('../lib/members');
const { isOwner } = require('../lib/owner');
const { computeCoverageStats, buildStatsEmbeds, buildStatsEmptyState } = require('../lib/coverage-stats');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coverage-stats')
    .setDescription('Coverage request & cover stats (owner only)')
    // Hides the command from ordinary members in the UI. The owner-ID check
    // in execute() is the real gate — admins other than the owner still can't run it.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        content: '⛔ This command is restricted.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rows  = repo.getStatsShiftRows();
    const stats = computeCoverageStats(rows, { now: Date.now() });

    // Linked members show as their first name; unlinked fall back to a mention.
    const resolveName = id => members.getDisplayName(id, `<@${id}>`);
    const embeds = buildStatsEmbeds(stats, { guildId: interaction.guildId, resolveName });

    if (!embeds.length) return interaction.editReply(buildStatsEmptyState());
    return interaction.editReply({ embeds });
  },
};
