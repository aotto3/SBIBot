const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db     = require('../lib/db');
const utils  = require('../lib/utils');
const bookeo = require('../lib/bookeo');
const { showLabel } = require('../lib/shows');

// How far out to look. A fixed horizon fetched unconditionally — no early-stop
// on empty weeks, since a real multi-week dark spell between shows is common
// here and would otherwise cause a booking past the gap to be silently missed.
const SCHEDULE_HORIZON_DAYS = 90;
const DISCORD_CONTENT_LIMIT = 2000;

/** Join shift lines into the reply, clamping to Discord's content limit with an "…and N more" tail. */
function _clampLines(lines, limit = DISCORD_CONTENT_LIMIT) {
  const full = lines.join('\n');
  if (full.length <= limit) return full;

  const kept = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    const moreLine = `…and ${lines.length - i} more`;
    const sep = kept.length ? 1 : 0;
    if (len + sep + lines[i].length + 1 + moreLine.length > limit) {
      kept.push(moreLine);
      return kept.join('\n');
    }
    len += sep + lines[i].length;
    kept.push(lines[i]);
  }
  return kept.join('\n');
}

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
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const nameOpt    = interaction.options.getString('name');
    const discordOpt = interaction.options.getUser('discord');

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

    const startDate = utils.todayCentral();

    let scheduleRows;
    try {
      scheduleRows = await bookeo.getScheduleForDays(startDate, SCHEDULE_HORIZON_DAYS);
    } catch (err) {
      return interaction.editReply(`Couldn't fetch schedule from Bookeo: ${err.message}\n_Is the bookeo-asst API endpoint live?_`);
    }

    const memberShifts = scheduleRows
      .filter(s => s.cast.some(c => c.toLowerCase() === castName.toLowerCase()))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (utils.parseTime(a.time) ?? '').localeCompare(utils.parseTime(b.time) ?? '');
      });

    if (!memberShifts.length) {
      return interaction.editReply(`No upcoming shifts found for **${castName}** in the next ${SCHEDULE_HORIZON_DAYS} days.`);
    }

    const lines = [`📅 **${castName}'s upcoming schedule**\n`];

    for (const shift of memberShifts) {
      const [dy, dmo, dd] = shift.date.split('-').map(Number);
      const dateDisplay   = utils.formatMeetingDate(new Date(dy, dmo - 1, dd));
      const showName      = showLabel(shift.show);
      lines.push(`  • ${showName} — ${dateDisplay} at ${shift.time} (${shift.guest_count} guests)`);
    }

    await interaction.editReply(_clampLines(lines));
  },
};
