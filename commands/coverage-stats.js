'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const repo    = require('../lib/coverage-repository');
const members = require('../lib/members');
const utils   = require('../lib/utils');
const { showKeys, showLabel } = require('../lib/shows');
const { isOwner } = require('../lib/owner');
const { computeCoverageStats, buildStatsEmbeds, buildStatsEmptyState } = require('../lib/coverage-stats');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coverage-stats')
    .setDescription('Coverage request & cover stats (owner only)')
    // Hides the command from ordinary members in the UI. The owner-ID check
    // in execute() is the real gate — admins other than the owner still can't run it.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => {
      opt.setName('show')
        .setDescription('Limit to one show (default: all shows)')
        .setRequired(false);
      for (const key of showKeys()) opt.addChoices({ name: showLabel(key), value: key });
      return opt;
    })
    .addUserOption(opt =>
      opt.setName('person')
        .setDescription('Show one person\'s detail instead of the leaderboard')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('since')
        .setDescription('Only include shifts on/after this date (e.g. 2026-01-01)')
        .setRequired(false)),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        content: '⛔ This command is restricted.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const showKey   = interaction.options.getString('show');   // null → all shows
    const person    = interaction.options.getUser('person');   // null → leaderboard
    const sinceRaw  = interaction.options.getString('since');

    let since = null;
    if (sinceRaw) {
      since = utils.parseDate(sinceRaw);
      if (!since) {
        return interaction.reply({
          content: `❌ Couldn't read that date: \`${sinceRaw}\`. Try something like \`2026-01-01\` or \`May 14\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rows  = repo.getStatsShiftRows();
    const stats = computeCoverageStats(rows, { show: showKey, person: person?.id, since, now: Date.now() });

    // Linked members show as their first name; unlinked fall back to a mention.
    const resolveName = id => members.getDisplayName(id, `<@${id}>`);
    const embeds = buildStatsEmbeds(stats, { guildId: interaction.guildId, resolveName });

    if (!embeds.length) return interaction.editReply(buildStatsEmptyState(showKey ? showLabel(showKey) : null));
    return interaction.editReply({ embeds });
  },
};
