const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const utils  = require('../lib/utils');
const bookeo = require('../lib/bookeo');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Show the full show schedule for the coming week')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('week_of')
        .setDescription('Start date — defaults to today (e.g. May 14, 5/14/2026)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const weekOfStr = interaction.options.getString('week_of');
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
    const endDate = utils.toDateString(new Date(y, mo - 1, d + 7));

    let shifts;
    try {
      shifts = await bookeo.getSchedule(startDate, endDate);
    } catch (err) {
      return interaction.editReply(`Couldn't fetch schedule from Bookeo: ${err.message}\n_Is the bookeo-asst API endpoint live?_`);
    }

    if (!shifts.length) {
      return interaction.editReply(`No shows scheduled between ${startDate} and ${endDate}.`);
    }

    // Group shifts by date
    const byDate = {};
    for (const shift of shifts) {
      if (!byDate[shift.date]) byDate[shift.date] = [];
      byDate[shift.date].push(shift);
    }

    const [sy, smo, sd] = startDate.split('-').map(Number);
    const [ey, emo, ed] = endDate.split('-').map(Number);
    const startDisplay  = utils.formatMeetingDate(new Date(sy, smo - 1, sd));
    const endDisplay    = utils.formatMeetingDate(new Date(ey, emo - 1, ed));

    const lines = [`📅 **Schedule: ${startDisplay} – ${endDisplay}**\n`];

    for (const date of Object.keys(byDate).sort()) {
      const [dy, dmo, dd] = date.split('-').map(Number);
      lines.push(`**${utils.formatMeetingDate(new Date(dy, dmo - 1, dd))}**`);

      for (const shift of byDate[date]) {
        const cast     = shift.cast.length ? shift.cast.join(', ') : '_no cast assigned_';
        const showName = bookeo.showFullName(shift.show);
        lines.push(`  • ${showName} — ${shift.time} | Cast: ${cast} | Guests: ${shift.guest_count}`);
      }
      lines.push('');
    }

    await interaction.editReply(lines.join('\n'));
  },
};
