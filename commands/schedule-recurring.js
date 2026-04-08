const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db             = require('../lib/db');
const utils          = require('../lib/utils');
const { postMeetingReminder } = require('../lib/meetings');

const DURATION_CHOICES = [
  { name: '30 minutes', value: 30  },
  { name: '1 hour',     value: 60  },
  { name: '1.5 hours',  value: 90  },
  { name: '2 hours',    value: 120 },
  { name: '3 hours',    value: 180 },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule-recurring')
    .setDescription('Schedule a recurring (weekly or monthly) meeting with RSVP reminders')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('Meeting title (e.g. "Monday All-Hands")')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('recurrence')
        .setDescription('How often does this meeting repeat?')
        .setRequired(true)
        .addChoices(
          { name: 'Weekly',  value: 'weekly'  },
          { name: 'Monthly', value: 'monthly' },
        )
    )
    .addStringOption(opt =>
      opt.setName('day')
        .setDescription('Day of the week')
        .setRequired(true)
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
      opt.setName('time')
        .setDescription('Start time (e.g. 7pm, 7:30pm, 19:00)')
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to post reminders in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('Who to ping in reminders')
        .setRequired(true)
        .addChoices(
          { name: '@everyone',                                          value: 'everyone' },
          { name: '@here',                                              value: 'here'     },
          { name: 'Specific members (use /meeting-add-member after)',   value: 'members'  },
        )
    )
    .addStringOption(opt =>
      opt.setName('week')
        .setDescription('Which week of the month? (monthly recurrence only)')
        .setRequired(false)
        .addChoices(
          { name: 'First',  value: 'first'  },
          { name: 'Second', value: 'second' },
          { name: 'Third',  value: 'third'  },
          { name: 'Fourth', value: 'fourth' },
          { name: 'Last',   value: 'last'   },
        )
    )
    .addIntegerOption(opt =>
      opt.setName('duration')
        .setDescription('How long is the meeting? (default: 1 hour)')
        .setRequired(false)
        .addChoices(...DURATION_CHOICES)
    )
    .addBooleanOption(opt =>
      opt.setName('reminder_7d')
        .setDescription('Send a reminder 7 days before (default: on)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('reminder_24h')
        .setDescription('Send a reminder 24 hours before (default: on)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const title      = interaction.options.getString('title');
    const recurrence = interaction.options.getString('recurrence');
    const day        = interaction.options.getString('day');
    const timeStr    = interaction.options.getString('time');
    const channel    = interaction.options.getChannel('channel');
    const targetType = interaction.options.getString('target');
    const week       = interaction.options.getString('week');
    const duration   = interaction.options.getInteger('duration') ?? 60;
    const reminder7d  = interaction.options.getBoolean('reminder_7d')  ?? true;
    const reminder24h = interaction.options.getBoolean('reminder_24h') ?? true;

    if (recurrence === 'monthly' && !week) {
      return interaction.editReply('Monthly meetings require a `week` option (First / Second / Third / Fourth / Last).');
    }

    const parsedTime = utils.parseTime(timeStr);
    if (!parsedTime) {
      return interaction.editReply(`Couldn't parse time \`${timeStr}\`. Try: \`7pm\`, \`7:30pm\`, \`19:00\``);
    }

    const id = db.createMeeting({
      title,
      time:            parsedTime,
      duration,
      date:            null,
      recurrence_type: recurrence === 'monthly' ? 'monthly_weekday' : 'weekly',
      recurrence_day:  day,
      recurrence_week: week ?? null,
      channel_id:      channel.id,
      target_type:     targetType,
      reminder_7d:     reminder7d  ? 1 : 0,
      reminder_24h:    reminder24h ? 1 : 0,
    });

    const meeting = db.getMeeting(id);
    const next    = utils.nextOccurrence(meeting);

    if (next) {
      const instanceDate = utils.toDateString(next);
      try {
        await postMeetingReminder(interaction.client, meeting, instanceDate, 'created');
      } catch (err) {
        console.error(`[schedule-recurring] Failed to post announcement for meeting ${id}:`, err);
        return interaction.editReply(`✅ Meeting saved (ID: \`${id}\`) but I couldn't post to <#${channel.id}>. Check that I have permission to send messages there.`);
      }
    }

    const timeDisplay    = utils.formatTime(parsedTime);
    const scheduleDisplay = utils.describeSchedule(meeting);
    const durationLabel  = DURATION_CHOICES.find(c => c.value === duration)?.name ?? `${duration} min`;

    let reply = `✅ **Recurring meeting saved** (ID: \`${id}\`)\n**${title}** — ${scheduleDisplay} at ${timeDisplay} (${durationLabel})\nChannel: <#${channel.id}> · Target: \`${targetType}\``;
    if (targetType === 'members') {
      reply += `\n\nUse \`/meeting-add-member meeting_id:${id}\` to add members.`;
    }

    await interaction.editReply(reply);
  },
};
