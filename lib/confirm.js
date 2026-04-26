'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const db      = require('./db');
const members = require('./members');
const { buildConfirmationMessage } = require('./coverage');

// ─── Button builder ───────────────────────────────────────────────────────────

/**
 * Build the Confirm Coverage action row.
 *
 * @param {boolean} disabled  true = already confirmed (grayed out)
 * @param {'shift'|'game'} type
 * @param {number} id  DB record ID
 */
function buildConfirmButton(disabled, type, id) {
  const btn = new ButtonBuilder()
    .setCustomId(`confirm_coverage:${type}:${id}`)
    .setLabel(disabled ? '✅ Confirmed' : 'Confirm Coverage')
    .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(disabled);
  return new ActionRowBuilder().addComponents(btn);
}

// ─── Button click handler ─────────────────────────────────────────────────────

async function handleConfirmCoverageButton(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '❌ Only admins can confirm coverage.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const [, type, rawId] = interaction.customId.split(':');
  const id = parseInt(rawId, 10);

  // Check not already confirmed
  if (type === 'shift') {
    const shift = db.getCoverageShiftById(id);
    if (!shift || shift.confirmed_taker_id) {
      return interaction.reply({ content: '❌ This shift has already been confirmed.', flags: MessageFlags.Ephemeral });
    }
  } else {
    const game = db.getCustomGameById(id);
    if (!game || game.confirmed_at) {
      return interaction.reply({ content: '❌ This game has already been confirmed.', flags: MessageFlags.Ephemeral });
    }
  }

  // Fetch ✅ reactors
  const message     = interaction.message;
  const yesReaction = message.reactions.cache.find(r => r.emoji.name === '✅');
  let options       = [];

  if (yesReaction) {
    const yesUsers = (await yesReaction.users.fetch()).filter(u => !u.bot);
    options = [...yesUsers.values()].map(u => ({
      label: members.getDisplayName(u.id, u.displayName ?? u.username).slice(0, 100),
      value: u.id,
    }));
  }

  // Fallback: all guild members sorted by display name
  if (options.length === 0) {
    const guildMembers = await interaction.guild.members.fetch();
    options = [...guildMembers.values()]
      .filter(m => !m.user.bot)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 25)
      .map(m => ({ label: m.displayName.slice(0, 100), value: m.id }));
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`confirm_coverage_select:${type}:${id}`)
    .setPlaceholder('Select who is taking the shift')
    .addOptions(options.slice(0, 25));

  await interaction.reply({
    content: 'Who is taking this shift?',
    components: [new ActionRowBuilder().addComponents(selectMenu)],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Select menu handler ──────────────────────────────────────────────────────

async function handleConfirmCoverageSelect(interaction) {
  const [, type, rawId] = interaction.customId.split(':');
  const id              = parseInt(rawId, 10);
  const takerId         = interaction.values[0];

  let show, date, time, requester, channelId, messageId;

  if (type === 'shift') {
    const shift = db.getCoverageShiftById(id);
    if (!shift) return interaction.update({ content: '❌ Shift not found.', components: [] });
    const request = db.getCoverageRequest(shift.request_id);
    show      = request.show;
    date      = shift.date;
    time      = shift.time;
    requester = request.requester_id;
    channelId = request.channel_id;
    messageId = shift.shift_message_id;
    db.confirmCoverageShift(id, takerId);
  } else {
    const game = db.getCustomGameById(id);
    if (!game) return interaction.update({ content: '❌ Game not found.', components: [] });
    show      = game.show;
    date      = game.date;
    time      = game.time;
    requester = null;
    channelId = game.channel_id;
    messageId = game.message_id;
    db.confirmCustomGame(id);
  }

  // Post public confirmation message
  const confirmMsg = buildConfirmationMessage({
    type,
    show,
    date,
    time,
    takers:    [{ userId: takerId, role: null }],
    requester,
  });

  const channel     = await interaction.client.channels.fetch(channelId);
  await channel.send(confirmMsg);

  // Disable button on the original post
  const originalMsg = await channel.messages.fetch(messageId);
  await originalMsg.edit({ components: [buildConfirmButton(true, type, id)] });

  await interaction.update({ content: '✅ Confirmation recorded.', components: [] });
  console.log(`[confirm] ${interaction.user.tag} confirmed ${type} ${id} → taker ${takerId}`);
}

module.exports = { buildConfirmButton, handleConfirmCoverageButton, handleConfirmCoverageSelect };
