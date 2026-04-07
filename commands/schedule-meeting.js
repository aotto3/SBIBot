const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db             = require('../lib/db');
const utils          = require('../lib/utils');
const { postMeetingReminder } = require('../lib/meetings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule-meeting')
    .setDescription('Schedule a one-time or recurring meeting with RSVP reminders')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Meeting title (e.g. "Company Social Night")')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('Meeting time (e.g. 7pm, 7:30pm, 19:00)')
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to post the reminder in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('Who to ping in the reminder')
        .setRequired(true)
        .addChoices(
          { name: '@everyone',       value: 'everyone' },
          { name: '@here',           value: 'here'     },
          { name: 'Specific members (use /meeting-add-member after)', value: 'members' },
        )
    )

    // One-time
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Date for a one-time meeting — YYYY-MM-DD (e.g. 2026-05-14)')
        .setRequired(false)
    )

    // Recurring
    .addStringOption(opt =>
      opt.setName('recurrence')
        .setDescription('Recurring schedule — omit for one-time')
        .setRequired(false)
        .addChoices(
          { name: 'Weekly',  value: 'weekly'  },
          { name: 'Monthly', value: 'monthly' },
        )
    )
    .addStringOption(opt =>
      opt.setName('day')
        .setDescription('Day of the week (required for recurring)')
        .setRequired(false)
        .addChoices(
          { name: 'Sunday',    value: 'sunday'    },
          { name: 'Monday',    value: 'monday'    },
          { name: 'Tuesday',   value: 'tuesday'   },
          { name: 'Wednesday', value: 'wednesday' },
          { name: 'Thursday',  value: 'thursday'  },
          { name: 'Friday',    value: 'friday'    },
          { name: 'Saturday',  value: 'saturday'  },
        )
    )
    .addStringOption(opt =>
      opt.setName('week')
        .setDescription('Which week of the month (monthly recurrence only)')
        .setRequired(false)
        .addChoices(
          { name: 'First',  value: 'first'  },
          { name: 'Second', value: 'second' },
          { name: 'Third',  value: 'third'  },
          { name: 'Fourth', value: 'fourth' },
          { name: 'Last',   value: 'last'   },
        )
    )

    // Reminder toggles
    .addBooleanOption(opt =>
      opt.setName('reminder_7d')
        .setDescription('Send a reminder 7 days before (default: true)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('reminder_24h')
        .setDescription('Send a reminder 24 hours before (default: true)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const title      = interaction.options.getString('title');
    const timeStr    = interaction.options.getString('time');
    const channel    = interaction.options.getChannel('channel');
    const targetType = interaction.options.getString('target');
    const dateStr    = interaction.options.getString('date');
    const recurrence = interaction.options.getString('recurrence');
    const day        = interaction.options.getString('day');
    const week       = interaction.options.getString('week');
    const reminder7d  = interaction.options.getBoolean('reminder_7d')  ?? true;
    const reminder24h = interaction.options.getBoolean('reminder_24h') ?? true;

    // ── Validate time ─────────────────────────────────────────────────────────
    const parsedTime = utils.parseTime(timeStr);
    if (!parsedTime) {
      return interaction.editReply(`Couldn't parse time \`${timeStr}\`. Try: \`7pm\`, \`7:30pm\`, \`19:00\`, \`1900\``);
    }

    // ── Validate recurrence vs date ───────────────────────────────────────────
    if (!dateStr && !recurrence) {
      return interaction.editReply('Provide either a `date` (one-time) or `recurrence` (recurring).');
    }
    if (dateStr && recurrence) {
      return interaction.editReply('Provide either `date` or `recurrence` — not both.');
    }
    if (recurrence && !day) {
      return interaction.editReply('Recurring meetings require a `day` option.');
    }
    if (recurrence === 'monthly' && !week) {
      return interaction.editReply('Monthly meetings require a `week` option (First / Second / etc.).');
    }

    // ── Parse date ────────────────────────────────────────────────────────────
    let parsedDate = null;
    if (dateStr) {
      parsedDate = utils.parseDate(dateStr);
      if (!parsedDate) {
        return interaction.editReply(`Couldn't parse date \`${dateStr}\`. Try: \`May 14\`, \`5/14/2026\`, \`2026-05-14\``);
      }
    }

    // ── Save to DB ────────────────────────────────────────────────────────────
    const meetingData = {
      title,
      time:             parsedTime,
      date:             parsedDate || null,
      recurrence_type:  recurrence ? (recurrence === 'monthly' ? 'monthly_weekday' : 'weekly') : null,
      recurrence_day:   day        || null,
      recurrence_week:  week ? week.toLowerCase() : null,
      channel_id:       channel.id,
      target_type:      targetType,
      reminder_7d:      reminder7d  ? 1 : 0,
      reminder_24h:     reminder24h ? 1 : 0,
    };

    const id      = db.createMeeting(meetingData);
    const meeting = db.getMeeting(id);

    // ── Post immediately on creation ─────────────────────────────────────────
    // Always announce the meeting right away so the channel sees it.
    // Also fire a 24h reminder immediately if the meeting is within 24 hours
    // (in case the scheduler already ran today and would miss it).
    const next = utils.nextOccurrence(meeting);
    if (next) {
      const instanceDate = utils.toDateString(next);
      const msPerDay     = 86_400_000;
      const daysAway     = Math.round((next - new Date()) / msPerDay);

      await postMeetingReminder(interaction.client, meeting, instanceDate, 'created');

      if (daysAway <= 1 && reminder24h) {
        await postMeetingReminder(interaction.client, meeting, instanceDate, '24h');
      }
    }

    // ── Confirm ───────────────────────────────────────────────────────────────
    const scheduleDisplay = utils.describeSchedule(meeting);
    const timeDisplay     = utils.formatTime(parsedTime);

    let reply = `✅ **Meeting saved** (ID: \`${id}\`)\n**${title}** — ${scheduleDisplay} at ${timeDisplay}\nChannel: <#${channel.id}> · Target: \`${targetType}\``;
    if (targetType === 'members') {
      reply += `\n\nUse \`/meeting-add-member meeting_id:${id}\` to add members.`;
    }

    await interaction.editReply(reply);
  },
};
