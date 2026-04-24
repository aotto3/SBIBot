const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel-coverage-request')
    .setDescription('Cancel a coverage request and delete its Discord post(s)')
    .addIntegerOption(opt =>
      opt.setName('request_id')
        .setDescription('Coverage Request ID shown at the bottom of the post')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const shiftId = interaction.options.getInteger('request_id');
    const shift   = db.getCoverageShiftById(shiftId);

    if (!shift) {
      return interaction.editReply(`❌ No coverage request found with ID \`${shiftId}\`.`);
    }

    const request = db.getCoverageRequest(shift.request_id);

    if (!request) {
      return interaction.editReply(`❌ No coverage request found with ID \`${shiftId}\`.`);
    }

    // Permission: requester or ManageGuild
    const isRequester = interaction.user.id === request.requester_id;
    const isAdmin     = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (!isRequester && !isAdmin) {
      return interaction.editReply(`❌ You can only cancel your own coverage requests.`);
    }

    if (request.status === 'cancelled') {
      return interaction.editReply(`❌ Coverage request \`${shiftId}\` is already cancelled.`);
    }

    // Delete all shift messages (collect unique IDs — first shift shares a message with the header)
    const allShifts = db.getCoverageShiftsByRequest(request.id);
    const seen      = new Set();

    for (const s of allShifts) {
      if (!s.shift_message_id || seen.has(s.shift_message_id)) continue;
      seen.add(s.shift_message_id);

      try {
        const channel = await interaction.client.channels.fetch(request.channel_id);
        const message = await channel.messages.fetch(s.shift_message_id);
        await message.delete();
      } catch (err) {
        // Already deleted or inaccessible — skip silently
      }
    }

    db.markRequestCancelled(request.id);

    await interaction.editReply(`✅ Coverage request \`${shiftId}\` cancelled and post(s) deleted.`);
  },
};
