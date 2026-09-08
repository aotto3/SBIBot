'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const bookeo    = require('../lib/bookeo');
const scheduler = require('../lib/scheduler');
const jobRuns   = require('../lib/job-runs');
const errorBuffer = require('../lib/error-buffer');
const utils     = require('../lib/utils');
const { isOwner } = require('../lib/owner');
const { buildStatusEmbed } = require('../lib/bot-status');

/** Map the Discord client's connection state to the snapshot's discord field. */
function discordState(client) {
  if (client?.isReady?.()) return 'ready';
  // ws.status: 5 = Disconnected in discord.js; anything else means it's mid-connect.
  const status = client?.ws?.status;
  if (status == null || status === 5) return 'disconnected';
  return 'connecting';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Bot health, schedule, and recent activity (owner only)')
    // Hidden from ordinary members in the UI (matches other admin commands via
    // Manage Server). The owner-ID check in execute() is the real gate.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        content: '⛔ This command is restricted.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const now   = new Date();
    const today = utils.todayCentral();

    // Bookeo reachability — cheap, reuses the 5-min cache (no new upstream load).
    let bookeoState;
    try {
      bookeoState = await bookeo.probeReachability(today, today);
    } catch {
      bookeoState = 'unreachable';
    }

    // Merge next-fire (schedule) with last-run (instrumentation), keyed by job.
    // lastRun is null (not undefined) for a job that has never run, so the embed
    // renders "no runs recorded" rather than omitting the section.
    const lastRuns = jobRuns.getLastRuns();
    const jobs = scheduler.buildJobScheduleView(now).map(j => {
      const lr = lastRuns[j.key];
      return {
        ...j,
        lastRun: lr
          ? {
              status:       lr.status,
              finishedAtMs: lr.finishedAtMs,
              startedAtMs:  lr.startedAtMs,
              durationMs:   lr.durationMs,
              error:        lr.error,
            }
          : null,
      };
    });

    const snapshot = {
      health: {
        uptimeSec: process.uptime(),
        discord:   discordState(interaction.client),
        bookeo:    bookeoState,
      },
      jobs,
      errors: errorBuffer.list(),
    };

    return interaction.editReply({ embeds: [buildStatusEmbed(snapshot, { now })] });
  },
};
