const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db    = require('../lib/db');
const utils = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meetings')
    .setDescription('List all active scheduled meetings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const meetings = db.getActiveMeetings();

    if (!meetings.length) {
      return interaction.reply({ content: 'No active meetings scheduled.', flags: MessageFlags.Ephemeral });
    }

    const lines = ['**Active Meetings**\n'];

    for (const m of meetings) {
      const schedule    = utils.describeSchedule(m);
      const time        = utils.formatTime(m.time);
      const next        = utils.nextOccurrence(m);
      const nextDisplay = next ? ` · next: ${utils.toDateString(next)}` : ' · (past)';

      const reminders = [];
      if (m.reminder_7d)  reminders.push('7d');
      if (m.reminder_24h) reminders.push('24h');
      const reminderDisplay = reminders.length ? reminders.join(', ') : 'none';

      lines.push(
        `\`${m.id}\` **${m.title}**`,
        `  ${schedule} at ${time}${nextDisplay}`,
        `  Channel: <#${m.channel_id}> · Target: \`${m.target_type}\` · Reminders: ${reminderDisplay}`,
        '',
      );
    }

    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
  },
};
