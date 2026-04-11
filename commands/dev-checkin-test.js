/**
 * DEV ONLY — seeds a test check-in record for today and fires the DM button.
 * Use this to test the check-in flow without waiting for a real Bookeo shift.
 * Safe to delete once Slice 5 is verified in production.
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db    = require('../lib/db');
const utils = require('../lib/utils');
const { CHECKIN_SHOW_CHOICES, showLabel } = require('../lib/shows');
const checkin = require('../lib/checkin');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dev-checkin-test')
    .setDescription('[DEV] Seed a test check-in record and send the DM button')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('seed')
        .setDescription('Seed a record and send the DM button')
        .addStringOption(opt =>
          opt.setName('show')
            .setDescription('Which show to test')
            .setRequired(true)
            .addChoices(...CHECKIN_SHOW_CHOICES)
        )
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('User to send the test DM to (defaults to you)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Delete all check-in records for today')
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (interaction.options.getSubcommand() === 'clear') {
      const today   = utils.todayCentral();
      const result  = db.db.prepare('DELETE FROM checkin_records WHERE shift_date = ?').run(today);
      await interaction.editReply({ content: `🗑️ Deleted ${result.changes} check-in record(s) for ${today}.` });
      return;
    }

    const show   = interaction.options.getString('show');
    const target = interaction.options.getUser('user') ?? interaction.user;

    const today  = utils.todayCentral();

    // Resolve bookeo_name — use linked name if available, fall back to Discord username
    const link       = db.getMemberByDiscordId(target.id);
    const bookeoName = link ? link.bookeo_name : target.username;

    // Seed the record (idempotent — silently ignores if it already exists)
    db.upsertCheckinRecord({
      shift_date:  today,
      show,
      bookeo_name: bookeoName,
      discord_id:  target.id,
      call_time:   Math.floor(Date.now() / 1000),
    });

    // Re-fetch so we have the row (in case it pre-existed and was already checked in)
    const rec = db.getCheckinRecordByDiscordAndShow(target.id, show, today);

    if (rec.checked_in_at) {
      await interaction.editReply({
        content: `⚠️ A check-in record already exists for <@${target.id}> / ${show} today and is already marked checked in.\nDelete it from the DB or pick a different show to test a fresh flow.`,
      });
      return;
    }

    // Schedule the no-show alert
    checkin.scheduleCheckinAlert(rec);

    // Send the DM
    const showName = showLabel(show);
    const btn = new ButtonBuilder()
      .setCustomId(`checkin:${show}:${today}`)
      .setLabel(`Check in: ${showName}`)
      .setStyle(ButtonStyle.Success);

    const dmContent = `🧪 **[Test DM]** You have a check-in for **${showName}** today.\nTap the button below when you're on location.`;

    try {
      const user = await interaction.client.users.fetch(target.id);
      await user.send({
        content: dmContent,
        components: [new ActionRowBuilder().addComponents(btn)],
      });
    } catch (err) {
      await interaction.editReply({
        content: `❌ Could not DM <@${target.id}>: ${err.message}\n\nRecord was seeded — you can still test \`/check-in\`.`,
      });
      return;
    }

    await interaction.editReply({
      content: `✅ Seeded check-in record and sent test DM to <@${target.id}> for **${showName}** (${today}).\n\nYou can also test \`/check-in\` from the server.`,
    });
  },
};
