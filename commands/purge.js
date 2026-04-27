'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const db = require('../lib/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Hard-delete a coverage shift, coverage request, or custom game (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('What to delete')
        .setRequired(true)
        .addChoices(
          { name: 'Coverage Shift', value: 'shift' },
          { name: 'Custom Game',    value: 'game'  },
        )
    )
    .addIntegerOption(opt =>
      opt.setName('id')
        .setDescription('The numeric ID shown on the post')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const type = interaction.options.getString('type');
    const id   = interaction.options.getInteger('id');

    if (type === 'shift') {
      const shift = db.getCoverageShiftById(id);
      if (!shift) return interaction.editReply(`❌ No shift found with ID \`${id}\`.`);

      const request = db.getCoverageRequest(shift.request_id);

      // Delete the shift's Discord post
      if (shift.shift_message_id && request?.channel_id) {
        try {
          const channel = await interaction.client.channels.fetch(request.channel_id);
          const message = await channel.messages.fetch(shift.shift_message_id);
          await message.delete();
        } catch { /* already gone */ }
      }

      // If this is the only shift in the request, also nuke the header post and the request
      const siblings = db.getCoverageShiftsByRequest(shift.request_id);
      if (siblings.length === 1 && request) {
        if (request.header_message_id && request.header_message_id !== shift.shift_message_id) {
          try {
            const channel = await interaction.client.channels.fetch(request.channel_id);
            const message = await channel.messages.fetch(request.header_message_id);
            await message.delete();
          } catch { /* already gone */ }
        }
        db.hardDeleteRequest(shift.request_id);
      } else {
        db.hardDeleteShift(id);
      }

      return interaction.editReply(`✅ Shift \`${id}\` purged.`);
    }

    if (type === 'game') {
      const game = db.getCustomGameById(id);
      if (!game) return interaction.editReply(`❌ No custom game found with ID \`${id}\`.`);

      if (game.channel_id && game.message_id) {
        try {
          const channel = await interaction.client.channels.fetch(game.channel_id);
          const message = await channel.messages.fetch(game.message_id);
          await message.delete();
        } catch { /* already gone */ }
      }

      db.hardDeleteCustomGame(id);
      return interaction.editReply(`✅ Custom game \`${id}\` purged.`);
    }
  },
};
