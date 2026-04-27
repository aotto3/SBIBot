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
          { name: 'Coverage Shift (individual date/time)',      value: 'shift'   },
          { name: 'Coverage Request (entire multi-shift post)', value: 'request' },
          { name: 'Custom Game',                                value: 'game'    },
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

    if (type === 'request') {
      const request = db.getCoverageRequest(id);
      if (!request) return interaction.editReply(`❌ No coverage request found with ID \`${id}\`.`);

      const shifts = db.getCoverageShiftsByRequest(id);

      // Delete all Discord posts (collect unique message IDs to avoid double-deleting the header)
      const seen = new Set();
      for (const s of shifts) {
        if (!s.shift_message_id || seen.has(s.shift_message_id)) continue;
        seen.add(s.shift_message_id);
        try {
          const channel = await interaction.client.channels.fetch(request.channel_id);
          const message = await channel.messages.fetch(s.shift_message_id);
          await message.delete();
        } catch { /* already gone */ }
      }
      if (request.header_message_id && !seen.has(request.header_message_id)) {
        try {
          const channel = await interaction.client.channels.fetch(request.channel_id);
          const message = await channel.messages.fetch(request.header_message_id);
          await message.delete();
        } catch { /* already gone */ }
      }

      db.hardDeleteRequest(id);
      return interaction.editReply(`✅ Coverage request \`${id}\` and all its shifts purged.`);
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
