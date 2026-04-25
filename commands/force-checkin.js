const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const checkin = require('../lib/checkin');
const utils   = require('../lib/utils');
const { CHECKIN_SHOW_CHOICES, showLabel } = require('../lib/shows');

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

    const { pending, all: allToday } = checkin.queryCheckins(target.id, today);

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
      const showList = pending.map(r => showLabel(r.show)).join(', ');
      await interaction.editReply({
        content: `<@${target.id}> has multiple pending check-ins today: **${showList}**.\nUse the \`show\` option to specify which one.`,
      });
      return;
    }

    await checkin.performCheckin(rec.id, { forcedBy: interaction.user.id });

    await interaction.editReply({
      content: `✅ <@${target.id}> manually confirmed as checked in for **${showLabel(rec.show)}** today.`,
    });

    console.log(`[checkin] ${interaction.user.tag} force-checked-in ${target.tag} for ${rec.show} on ${today}`);
  },
};
