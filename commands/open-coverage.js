'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db      = require('../lib/db');
const utils   = require('../lib/utils');
const { showLabel } = require('../lib/shows');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('open-coverage')
    .setDescription('List all open coverage requests and custom games with cancel/confirm buttons')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const openShifts = db.getOpenCoverageShiftsWithRequests();
    const openGames  = db.getOpenCustomGamesForPings();

    if (!openShifts.length && !openGames.length) {
      return interaction.editReply('✅ No open coverage requests or custom games.');
    }

    // Build a flat list of display items
    const items = [];

    const guildId = interaction.guildId;

    for (const s of openShifts) {
      const [y, mo, d] = s.date.split('-').map(Number);
      const dateStr    = utils.formatMeetingDate(new Date(y, mo - 1, d));
      const timeStr    = s.time ? ` at ${utils.formatTime(s.time)}` : '';
      const charStr    = s.character ? ` (${s.character})` : '';
      const link       = s.shift_message_id
        ? `\nhttps://discord.com/channels/${guildId}/${s.channel_id}/${s.shift_message_id}`
        : '';
      items.push({
        line: `**${showLabel(s.show)}${charStr}** — ${dateStr}${timeStr}\nRequested by ${s.requester_name}  •  Shift ID: \`${s.id}\`${link}`,
        type: 'shift',
        id:   s.id,
      });
    }

    for (const g of openGames) {
      const [y, mo, d] = g.date.split('-').map(Number);
      const dateStr    = utils.formatMeetingDate(new Date(y, mo - 1, d));
      const timeStr    = g.time ? ` at ${utils.formatTime(g.time)}` : '';
      const link       = g.message_id
        ? `\nhttps://discord.com/channels/${guildId}/${g.channel_id}/${g.message_id}`
        : '';
      items.push({
        line: `**${showLabel(g.show)}** — ${dateStr}${timeStr}\nCustom Game  •  Game ID: \`${g.id}\`${link}`,
        type: 'game',
        id:   g.id,
      });
    }

    // Send one message per item so buttons appear directly below their item
    const header = `**Open Coverage Requests** (${items.length} total)`;
    await interaction.editReply({ content: header, components: [] });

    for (let i = 0; i < items.length; i++) {
      const item      = items[i];
      const typeLabel = item.type === 'shift' ? 'Shift' : 'Game';
      const content   = `${i + 1}. ${item.line}`;
      const row       = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cov_cancel:${item.type}:${item.id}`)
          .setLabel(`Cancel ${typeLabel} ${item.id}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`confirm_coverage:${item.type}:${item.id}`)
          .setLabel(`Confirm ${typeLabel} ${item.id}`)
          .setStyle(ButtonStyle.Primary),
      );
      await interaction.followUp({ content, components: [row], flags: MessageFlags.Ephemeral });
    }
  },
};
