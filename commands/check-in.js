const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const db    = require('../lib/db');
const utils = require('../lib/utils');
const { SHOWS } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('check-in')
    .setDescription('Check in for your shift today'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const today   = utils.todayCentral();
    const pending = db.getPendingCheckinsByDiscord(interaction.user.id, today);

    if (!pending.length) {
      // Distinguish "already checked in today" from "no shift today"
      const allToday = db.getCheckinRecordsByDiscordAndDate(interaction.user.id, today);
      if (allToday.some(r => r.checked_in_at)) {
        await interaction.editReply({ content: 'You have already checked in for today.' });
      } else {
        await interaction.editReply({ content: 'You have no check-in required for today.' });
      }
      return;
    }

    if (pending.length === 1) {
      const rec = pending[0];
      db.markCheckedIn(rec.id);
      await interaction.editReply({
        content: `✅ Checked in for **${SHOWS[rec.show].label}** today.`,
      });
      return;
    }

    // Multiple pending shows — ask which one
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`checkin_select:${today}`)
      .setPlaceholder('Select a show to check in for')
      .addOptions(
        pending.map(rec =>
          new StringSelectMenuOptionBuilder()
            .setLabel(SHOWS[rec.show].label)
            .setValue(rec.show)
        )
      );

    await interaction.editReply({
      content: 'You have multiple shows today. Which are you checking in for?',
      components: [new ActionRowBuilder().addComponents(menu)],
    });
  },
};
