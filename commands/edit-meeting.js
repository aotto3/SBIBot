const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db       = require('../lib/db');
const utils    = require('../lib/utils');
const meetings = require('../lib/meetings');

const DURATION_CHOICES = [
  { name: '30 minutes', value: 30  },
  { name: '1 hour',     value: 60  },
  { name: '1.5 hours',  value: 90  },
  { name: '2 hours',    value: 120 },
  { name: '3 hours',    value: 180 },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-meeting')
    .setDescription('Edit an existing scheduled meeting')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt =>
      opt.setName('meeting_id')
        .setDescription('Meeting ID (from /meetings)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('title')
        .setDescription('New title')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('New date (e.g. May 14, 5/14/2026, 2026-05-14) — one-time meetings only')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('New start time (e.g. 7pm, 7:30pm, 19:00)')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('duration')
        .setDescription('New duration')
        .setRequired(false)
        .addChoices(...DURATION_CHOICES)
    )
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('New channel to post reminders in')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const meetingId = interaction.options.getInteger('meeting_id');
    const meeting   = db.getMeeting(meetingId);

    if (!meeting || !meeting.active) {
      return interaction.editReply(`No active meeting found with ID \`${meetingId}\`. Use \`/meetings\` to see your meetings.`);
    }

    const updates = {};
    const changes = [];

    const titleOpt    = interaction.options.getString('title');
    const dateOpt     = interaction.options.getString('date');
    const timeOpt     = interaction.options.getString('time');
    const durationOpt = interaction.options.getInteger('duration');
    const channelOpt  = interaction.options.getChannel('channel');

    if (titleOpt !== null) {
      updates.title = titleOpt;
      changes.push(`Title → **${titleOpt}**`);
    }

    if (dateOpt !== null) {
      if (meeting.recurrence_type) {
        return interaction.editReply('Date cannot be changed on a recurring meeting. Cancel and recreate it if needed.');
      }
      const parsed = utils.parseDate(dateOpt);
      if (!parsed) {
        return interaction.editReply(`Couldn't parse date \`${dateOpt}\`. Try: \`May 14\`, \`5/14/2026\`, \`2026-05-14\``);
      }
      updates.date = parsed;
      changes.push(`Date → **${parsed}**`);
    }

    if (timeOpt !== null) {
      const parsed = utils.parseTime(timeOpt);
      if (!parsed) {
        return interaction.editReply(`Couldn't parse time \`${timeOpt}\`. Try: \`7pm\`, \`7:30pm\`, \`19:00\``);
      }
      updates.time = parsed;
      changes.push(`Time → **${utils.formatTime(parsed)}**`);
    }

    if (durationOpt !== null) {
      updates.duration = durationOpt;
      const label = DURATION_CHOICES.find(c => c.value === durationOpt)?.name ?? `${durationOpt} min`;
      changes.push(`Duration → **${label}**`);
    }

    if (channelOpt !== null) {
      updates.channel_id = channelOpt.id;
      changes.push(`Channel → <#${channelOpt.id}>`);
    }

    if (!changes.length) {
      return interaction.editReply('No changes provided — include at least one field to update.');
    }

    const oldChannelId = meeting.channel_id;
    db.updateMeeting(meetingId, updates);
    const updatedMeeting = db.getMeeting(meetingId);

    const editedCount = await meetings.editMeetingPosts(interaction.client, updatedMeeting, oldChannelId);
    const postNote = editedCount > 0
      ? `_${editedCount} existing reminder post${editedCount === 1 ? '' : 's'} updated._`
      : '_No existing reminder posts found to update._';

    await interaction.editReply(
      `✅ **Meeting \`${meetingId}\` updated:**\n${changes.join('\n')}\n\n${postNote}`
    );
  },
};
