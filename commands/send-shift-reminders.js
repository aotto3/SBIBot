const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db     = require('../lib/db');
const utils  = require('../lib/utils');
const bookeo = require('../lib/bookeo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('send-shift-reminders')
    .setDescription('Manually send shift DMs for the coming week (or a specific week)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('week_of')
        .setDescription('Start date YYYY-MM-DD — defaults to today')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Time window to cover (default: weekly)')
        .setRequired(false)
        .addChoices(
          { name: 'This week (7 days)',   value: 'weekly' },
          { name: 'Next 24 hours',        value: 'daily'  },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const weekOfStr = interaction.options.getString('week_of');
    const mode      = interaction.options.getString('mode') ?? 'weekly';

    // Parse week_of date
    let startDate;
    if (weekOfStr) {
      startDate = utils.parseDate(weekOfStr);
      if (!startDate) {
        return interaction.editReply(`Couldn't parse date \`${weekOfStr}\`. Try: \`May 14\`, \`5/14/2026\`, \`2026-05-14\``);
      }
    } else {
      startDate = utils.toDateString(new Date());
    }

    const [y, mo, d] = startDate.split('-').map(Number);
    const start = new Date(y, mo - 1, d);
    const days  = mode === 'daily' ? 1 : 7;
    const end   = new Date(y, mo - 1, d + days);
    const endDate = utils.toDateString(end);
    const label   = mode === 'daily' ? 'within 24 hours' : 'this week';

    // Fetch schedule from Bookeo
    let shifts;
    try {
      shifts = await bookeo.getSchedule(startDate, endDate);
    } catch (err) {
      return interaction.editReply(`Failed to fetch schedule from Bookeo: ${err.message}`);
    }

    if (!shifts.length) {
      return interaction.editReply(`No shifts found between ${startDate} and ${endDate}.`);
    }

    const grouped  = bookeo.groupByCastMember(shifts);
    const sent     = [];
    const noLink   = [];
    const failed   = [];

    for (const [castName, castShifts] of Object.entries(grouped)) {
      const link = db.getMemberByBookeoName(castName);
      if (!link) {
        noLink.push(castName);
        continue;
      }

      const dmText = bookeo.buildShiftDM(castName, castShifts, label);

      try {
        const user = await interaction.client.users.fetch(link.discord_id);
        await user.send(dmText);
        sent.push(castName);
      } catch (err) {
        console.error(`[send-shift-reminders] Failed to DM ${castName}:`, err.message);
        failed.push(castName);
      }
    }

    // Build summary reply
    const lines = [`**Shift reminders sent** (${startDate} → ${endDate})`];

    if (sent.length) {
      lines.push(`✅ Sent (${sent.length}): ${sent.join(', ')}`);
    }
    if (noLink.length) {
      lines.push(`⚠️ Not linked (${noLink.length}): ${noLink.join(', ')} — use \`/link-member\` to set up`);
    }
    if (failed.length) {
      lines.push(`❌ DM failed (${failed.length}): ${failed.join(', ')} — they may have DMs disabled`);
    }
    if (!sent.length && !noLink.length && !failed.length) {
      lines.push('No cast members found in the schedule for this period.');
    }

    await interaction.editReply(lines.join('\n'));
  },
};
