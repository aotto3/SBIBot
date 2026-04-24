const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db     = require('../lib/db');
const utils  = require('../lib/utils');
const bookeo = require('../lib/bookeo');
const { showLabel } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member-schedule')
    .setDescription("Show one cast member's upcoming shifts")
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription("Cast member's first name as it appears in Bookeo (e.g. DeShae)")
        .setRequired(false)
    )
    .addUserOption(opt =>
      opt.setName('discord')
        .setDescription('Or pick by linked Discord user')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('week_of')
        .setDescription('Start date — defaults to today (e.g. May 14, 5/14/2026)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const nameOpt    = interaction.options.getString('name');
    const discordOpt = interaction.options.getUser('discord');
    const weekOfStr  = interaction.options.getString('week_of');

    // Resolve the cast name
    let castName;
    if (discordOpt) {
      const link = db.getMemberByDiscordId(discordOpt.id);
      if (!link) {
        return interaction.editReply(`<@${discordOpt.id}> isn't linked to a Bookeo name yet. Use \`/link-member\` first.`);
      }
      castName = link.bookeo_name;
    } else if (nameOpt) {
      castName = nameOpt.trim();
    } else {
      return interaction.editReply('Provide either a `name` or a `discord` user.');
    }

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
    const endDate = utils.toDateString(new Date(y, mo - 1, d + 7));

    let shifts;
    try {
      shifts = await bookeo.getSchedule(startDate, endDate);
    } catch (err) {
      return interaction.editReply(`Couldn't fetch schedule from Bookeo: ${err.message}\n_Is the bookeo-asst API endpoint live?_`);
    }

    // Filter to this cast member (case-insensitive)
    const memberShifts = shifts.filter(s =>
      s.cast.some(c => c.toLowerCase() === castName.toLowerCase())
    );

    if (!memberShifts.length) {
      return interaction.editReply(`No shifts found for **${castName}** between ${startDate} and ${endDate}.`);
    }

    const [sy, smo, sd] = startDate.split('-').map(Number);
    const lines = [`📅 **${castName}'s schedule: ${utils.formatMeetingDate(new Date(sy, smo - 1, sd))} – next 7 days**\n`];

    for (const shift of memberShifts) {
      const [dy, dmo, dd] = shift.date.split('-').map(Number);
      const dateDisplay   = utils.formatMeetingDate(new Date(dy, dmo - 1, dd));
      const showName      = showLabel(shift.show);
      lines.push(`  • ${showName} — ${dateDisplay} at ${shift.time} (${shift.guest_count} guests)`);
    }

    await interaction.editReply(lines.join('\n'));
  },
};
