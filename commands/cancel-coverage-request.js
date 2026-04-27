const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const { planShiftCancel, buildShiftPost, buildResolvedHeaderPost } = require('../lib/coverage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel-coverage-request')
    .setDescription('Cancel a single shift from a coverage request')
    .addIntegerOption(opt =>
      opt.setName('request_id')
        .setDescription('The Shift ID shown at the bottom of the shift post')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const shiftId = interaction.options.getInteger('request_id');
    const shift   = db.getCoverageShiftById(shiftId);

    if (!shift) {
      return interaction.editReply(`❌ No shift found with ID \`${shiftId}\`.`);
    }

    if (shift.status === 'cancelled') {
      return interaction.editReply(`❌ Shift \`${shiftId}\` is already cancelled.`);
    }

    const request = db.getCoverageRequest(shift.request_id);
    if (!request) {
      return interaction.editReply(`❌ Request not found.`);
    }

    // Permission: requester or ManageGuild
    const isRequester = interaction.user.id === request.requester_id;
    const isAdmin     = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (!isRequester && !isAdmin) {
      return interaction.editReply(`❌ You can only cancel your own coverage requests.`);
    }

    db.markShiftCancelled(shiftId);

    const remaining = db.getCoverageShiftsByRequest(request.id).filter(s => s.status === 'open');
    const plan      = planShiftCancel(shift, request, remaining);
    const channel   = await interaction.client.channels.fetch(request.channel_id);

    if (plan.action === 'delete-all') {
      db.markRequestCancelled(request.id);
      if (shift.shift_message_id === request.header_message_id) {
        try {
          const msg = await channel.messages.fetch(request.header_message_id);
          await msg.edit({ content: buildResolvedHeaderPost(request), components: [] });
        } catch { /* already gone */ }
      } else {
        if (shift.shift_message_id) {
          try {
            const msg = await channel.messages.fetch(shift.shift_message_id);
            await msg.edit({ content: `❌ **Cancelled** — ${buildShiftPost(request, shift)}`, components: [] });
          } catch { /* already gone */ }
        }
        if (request.header_message_id) {
          try {
            const msg = await channel.messages.fetch(request.header_message_id);
            await msg.edit({ content: buildResolvedHeaderPost(request), components: [] });
          } catch { /* already gone */ }
        }
      }
    } else if (plan.action === 'edit-header') {
      try {
        const msg = await channel.messages.fetch(shift.shift_message_id);
        const cancelledNote = `~~${buildShiftPost(request, shift)}~~ — Cancelled`;
        await msg.edit({ content: `${plan.headerContent}\n${cancelledNote}`, components: [] });
      } catch { /* already gone */ }
    } else {
      if (shift.shift_message_id) {
        try {
          const msg = await channel.messages.fetch(shift.shift_message_id);
          await msg.edit({ content: `❌ **Cancelled** — ${buildShiftPost(request, shift)}`, components: [] });
        } catch { /* already gone */ }
      }
    }

    console.log(`[coverage] ${interaction.user.tag} cancelled shift ${shiftId} via /cancel-coverage-request`);
    await interaction.editReply(`✅ Shift \`${shiftId}\` cancelled and post updated.`);
  },
};
