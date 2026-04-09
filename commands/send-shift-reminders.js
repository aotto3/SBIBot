const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db     = require('../lib/db');
const utils  = require('../lib/utils');
const bookeo = require('../lib/bookeo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('send-shift-reminders')
    .setDescription('Send shift DMs — or preview what would be sent without DMing anyone')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Time window to cover (default: weekly)')
        .setRequired(false)
        .addChoices(
          { name: 'This week (7 days)', value: 'weekly' },
          { name: 'Next 24 hours',      value: 'daily'  },
        )
    )
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Only process this person (optional — omit to run for everyone)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('preview')
        .setDescription('Show the DM text here instead of sending it (default: false)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('week_of')
        .setDescription('Start date — defaults to today (e.g. May 14, 5/14/2026)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const mode       = interaction.options.getString('mode')    ?? 'weekly';
    const targetUser = interaction.options.getUser('user')      ?? null;
    const preview    = interaction.options.getBoolean('preview') ?? false;
    const weekOfStr  = interaction.options.getString('week_of') ?? null;

    // Resolve date range
    let startDate;
    if (weekOfStr) {
      startDate = utils.parseDate(weekOfStr);
      if (!startDate) {
        return interaction.editReply(`Couldn't parse date \`${weekOfStr}\`. Try: \`May 14\`, \`5/14/2026\`, \`2026-05-14\``);
      }
    } else {
      startDate = utils.todayCentral();
    }

    const [y, mo, d] = startDate.split('-').map(Number);
    const days       = mode === 'daily' ? 1 : 7;
    const end        = new Date(y, mo - 1, d + days);
    const endDate    = utils.toDateString(end);
    const label      = mode === 'daily' ? 'within 24 hours' : 'this week';

    // Fetch schedule from Bookeo
    let shifts;
    try {
      shifts = await bookeo.getSchedule(startDate, endDate);
    } catch (err) {
      return interaction.editReply(`Failed to fetch schedule from Bookeo: ${err.message}`);
    }

    // Log the window and raw results for debugging
    console.log(`[send-shift-reminders] window: ${startDate} → ${endDate}, shifts returned: ${shifts.length}`);
    if (shifts.length) {
      const dates = [...new Set(shifts.map(s => s.date))].sort();
      console.log(`[send-shift-reminders] shift dates in response: ${dates.join(', ')}`);
    }

    if (!shifts.length) {
      return interaction.editReply(`No shifts found between \`${startDate}\` and \`${endDate}\`.`);
    }

    // If targeting one user, resolve their Bookeo name and filter
    let grouped = bookeo.groupByCastMember(shifts);

    if (targetUser) {
      const link = db.getMemberByDiscordId(targetUser.id);
      if (!link) {
        return interaction.editReply(`<@${targetUser.id}> isn't linked to a Bookeo name yet. Use \`/link-member\` first.`);
      }
      const memberShifts = grouped[link.bookeo_name];
      if (!memberShifts) {
        return interaction.editReply(`No shifts found for **${link.bookeo_name}** between \`${startDate}\` and \`${endDate}\`.`);
      }
      grouped = { [link.bookeo_name]: memberShifts };
    }

    // Preview mode: show DM text without sending
    if (preview) {
      const lines = [`**Preview** — what would be sent (${startDate} → ${endDate}, ${label}):\n`];
      for (const [castName, castShifts] of Object.entries(grouped)) {
        const link = db.getMemberByBookeoName(castName);
        const mention = link ? `<@${link.discord_id}>` : `_${castName} (not linked)_`;
        lines.push(`**To: ${mention}**`);
        lines.push('```');
        lines.push(bookeo.buildShiftDM(castName, castShifts, label));
        lines.push('```');
      }
      return interaction.editReply(lines.join('\n'));
    }

    // Send mode
    const sent   = [];
    const noLink = [];
    const failed = [];

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

    const lines = [`**Shift reminders sent** (\`${startDate}\` → \`${endDate}\`)`];
    if (sent.length)   lines.push(`✅ Sent (${sent.length}): ${sent.join(', ')}`);
    if (noLink.length) lines.push(`⚠️ Not linked (${noLink.length}): ${noLink.join(', ')} — use \`/link-member\` to set up`);
    if (failed.length) lines.push(`❌ DM failed (${failed.length}): ${failed.join(', ')} — they may have DMs disabled`);
    if (!sent.length && !noLink.length && !failed.length) {
      lines.push('No cast members found in the schedule for this period.');
    }

    await interaction.editReply(lines.join('\n'));
  },
};
