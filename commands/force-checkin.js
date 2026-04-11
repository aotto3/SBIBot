const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db    = require('../lib/db');
const utils = require('../lib/utils');
const { CHECKIN_SHOW_CHOICES, showLabel } = require('../lib/shows');
const { editAlertForLateCheckin } = require('../lib/checkin');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('force-checkin')
    .setDescription('Manually confirm a cast member as checked in')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Cast member to check in')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('show')
        .setDescription('Which show (required if they have multiple shifts today)')
        .setRequired(false)
        .addChoices(...CHECKIN_SHOW_CHOICES)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target  = interaction.options.getUser('user');
    const show    = interaction.options.getString('show');
    const today   = utils.todayCentral();

    // Find candidate records — all today's records for this user, not yet checked in
    const allToday = db.getCheckinRecordsByDiscordAndDate(target.id, today);
    const pending  = allToday.filter(r => !r.checked_in_at);

    if (!pending.length) {
      const alreadyIn = allToday.some(r => r.checked_in_at);
      await interaction.editReply({
        content: alreadyIn
          ? `<@${target.id}> is already checked in for today.`
          : `No check-in record found for <@${target.id}> today.`,
      });
      return;
    }

    let rec;
    if (show) {
      rec = pending.find(r => r.show === show);
      if (!rec) {
        await interaction.editReply({
          content: `No pending check-in record found for <@${target.id}> / **${showLabel(show)}** today.`,
        });
        return;
      }
    } else if (pending.length === 1) {
      rec = pending[0];
    } else {
      const showList = pending.map(r => SHOWS[r.show].label).join(', ');
      await interaction.editReply({
        content: `<@${target.id}> has multiple pending check-ins today: **${showList}**.\nUse the \`show\` option to specify which one.`,
      });
      return;
    }

    db.markCheckedIn(rec.id, interaction.user.id);
    const fresh = db.getCheckinRecordById(rec.id);
    await editAlertForLateCheckin(interaction.client, fresh, interaction.user.id);

    await interaction.editReply({
      content: `✅ <@${target.id}> manually confirmed as checked in for **${showLabel(rec.show)}** today.`,
    });

    console.log(`[checkin] ${interaction.user.tag} force-checked-in ${target.tag} for ${rec.show} on ${today}`);
  },
};
