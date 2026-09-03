const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const repo    = require('../lib/coverage-repository');
const utils   = require('../lib/utils');
const checkin = require('../lib/checkin');
const { makeDiscordAdapter } = require('../lib/adapters/discord');
const { makeBookeoAdapter }  = require('../lib/adapters/bookeo');
const { buildJobRegistry }   = require('../lib/scheduler');
const { runCoverageRolePings } = require('../lib/coverage-jobs');

// Static choice list — mirrors the keys in buildJobRegistry().
const JOB_CHOICES = [
  { name: 'Coverage role pings',   value: 'coverage-pings' },
  { name: 'Custom-game reminders', value: 'custom-game-reminders' },
  { name: 'Meeting reminders',     value: 'meeting-reminders' },
  { name: 'EOD coverage reminder', value: 'eod-reminder' },
  { name: 'Weekly maybe-nudge',    value: 'maybe-nudge' },
  { name: 'Daily shift DMs',       value: 'shift-dms' },
  { name: 'Late-booking seed',     value: 'latebooking' },
  { name: 'Check-in seeding',      value: 'checkin-seed' },
];

/** Format a job's outcome summary into an ephemeral report string (clamped to Discord's limit). */
function formatRerunReport(label, summary, preview) {
  let text;

  if (preview && summary && Array.isArray(summary.preview)) {
    if (!summary.preview.length) {
      text = `**${label}** preview — nothing would be sent.`;
    } else {
      const lines = summary.preview.map(p =>
        `• \`${p.messageId}\`${p.show ? ` (${p.show})` : ''}${p.dateTime ? ` — ${p.dateTime}` : ''}`);
      text = `**${label}** preview — would ping ${summary.preview.length}:\n${lines.join('\n')}`;
    }
  } else if (!summary || typeof summary !== 'object') {
    text = `✅ Ran **${label}**.`;
  } else {
    const lines = [`✅ Ran **${label}** — sent ${summary.sent ?? 0}/${summary.planned ?? 0}`];
    if (Array.isArray(summary.failed) && summary.failed.length) {
      lines.push(`❌ ${summary.failed.length} failed:`);
      for (const f of summary.failed) lines.push(`• \`${f.id}\`: ${f.reason}`);
    }
    text = lines.join('\n');
  }

  return text.length > 1990 ? `${text.slice(0, 1985)}\n…` : text;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rerun-job')
    .setDescription('Re-run a scheduled job on demand (admin recovery)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('job')
        .setDescription('Which scheduled job to re-run')
        .setRequired(true)
        .addChoices(...JOB_CHOICES)
    )
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Coverage pings only: re-ping all, or smart (skip posts already pinged today)')
        .setRequired(false)
        .addChoices(
          { name: 'All — re-ping every still-missing post', value: 'all' },
          { name: 'Smart — skip posts already pinged today', value: 'smart' },
        )
    )
    .addBooleanOption(opt =>
      opt.setName('preview')
        .setDescription('Coverage pings only: show what would be sent without sending')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const jobKey  = interaction.options.getString('job');
    const mode    = interaction.options.getString('mode') ?? 'all';
    const preview = interaction.options.getBoolean('preview') ?? false;

    const discord   = makeDiscordAdapter(interaction.client);
    const bkAdapter = makeBookeoAdapter();
    const registry  = buildJobRegistry({ discord, repo, bkAdapter, client: interaction.client });

    const entry = registry[jobKey];
    if (!entry) {
      return interaction.editReply(`Unknown job \`${jobKey}\`.`);
    }

    let summary;
    try {
      if (jobKey === 'coverage-pings') {
        let alreadyPingedMessageIds = [];
        if (mode === 'smart') {
          const sinceUnix = checkin.shiftCallTimeUnix(utils.todayCentral(), '12:00 AM', 0);
          alreadyPingedMessageIds = repo.getPingedMessageIdsSince(sinceUnix);
        }
        summary = await runCoverageRolePings(discord, repo, { mode, preview, alreadyPingedMessageIds });
      } else {
        summary = await entry.run();
      }
    } catch (err) {
      console.error(`[rerun-job] ${jobKey} failed:`, err.message);
      return interaction.editReply(`❌ **${entry.label}** threw: ${err.message}`);
    }

    await interaction.editReply(formatRerunReport(entry.label, summary, preview));
  },
};

module.exports.formatRerunReport = formatRerunReport;
