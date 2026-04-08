const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const HELP_TEXT = `📋 **SBIBot Commands**

**Meetings** 🔒
\`/schedule-meeting\` — Schedule a one-time meeting with RSVP
\`/schedule-recurring\` — Set up a repeating weekly/monthly meeting
\`/cancel-meeting\` — Cancel a meeting
\`/edit-meeting\` — Update a meeting's title, time, date, or channel
\`/meetings\` — List all active meetings with IDs
\`/attendance\` — See RSVP breakdown for a meeting
\`/meeting-add-member\` — Add someone to a specific-members meeting

**Custom Games** 👥
\`/custom-game\` — Post availability check for a show (MFB, Endings, GGB, Lucidity)
\`/cancel-custom-game\` — Close a custom game availability post

**Schedules** 🔒
\`/schedule\` — Show full schedule for the coming week
\`/member-schedule\` — Show one cast member's upcoming shifts
\`/send-shift-reminders\` — Manually trigger shift DMs

**Cast Member Setup** 🔒
\`/link-member\` — Link a Bookeo name to a Discord account
\`/unlink-member\` — Remove a cast member link
\`/list-members\` — See all Bookeo ↔ Discord links

**Bot Settings** 🔒
\`/bot-config\` — Toggle automated shift DMs on/off

🔒 = Requires Manage Server  👥 = Any member`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available bot commands'),

  async execute(interaction) {
    await interaction.reply({ content: HELP_TEXT, flags: MessageFlags.Ephemeral });
  },
};
