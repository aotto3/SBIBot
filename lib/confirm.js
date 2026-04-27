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
const { buildConfirmationMessage, buildResolvedHeaderPost, planShiftCancel } = require('./coverage');
const { showCharacters, showLabel, getShowRole, getDiscordRoleName } = require('./shows');

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

// ─── In-memory state for multi-step multi-role confirmations ─────────────────
// Key: `${userId}:${gameId}` → { [roleName]: takerId }
const pendingMultiRole = new Map();

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
    // Multi-role games get their own two-dropdown flow
    if (showCharacters(game.show)) {
      return handleMultiRoleButton(interaction, id, game);
    }
  }

  // Single-role path: fetch ✅ reactors from the original coverage post
  let channelId, messageId;
  if (type === 'shift') {
    const s   = db.getCoverageShiftById(id);
    const req = db.getCoverageRequest(s.request_id);
    channelId = req.channel_id;
    messageId = s.shift_message_id;
  } else {
    const g = db.getCustomGameById(id);
    channelId = g.channel_id;
    messageId = g.message_id;
  }

  let options = [];
  let originalMsg;
  try {
    const ch  = await interaction.client.channels.fetch(channelId);
    originalMsg = await ch.messages.fetch(messageId);
  } catch { /* post deleted or inaccessible — skip reactors */ }
  const yesReaction = originalMsg?.reactions.cache.find(r => r.emoji.name === '✅');

  if (yesReaction) {
    const yesUsers = (await yesReaction.users.fetch()).filter(u => !u.bot);
    options = [...yesUsers.values()].map(u => ({
      label: members.getDisplayName(u.id, u.displayName ?? u.username).slice(0, 100),
      value: u.id,
    }));
  }

  // Fallback: all cached guild members sorted by display name
  if (options.length === 0) {
    options = [...interaction.guild.members.cache.values()]
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

// ─── Multi-role button handler ────────────────────────────────────────────────

async function handleMultiRoleButton(interaction, gameId, game) {
  const characters = showCharacters(game.show);

  // Build candidate list from ✅ reactors on the original coverage post
  let originalMsg;
  try {
    const ch  = await interaction.client.channels.fetch(game.channel_id);
    originalMsg = await ch.messages.fetch(game.message_id);
  } catch { /* post deleted or inaccessible — skip reactors */ }
  const yesReaction = originalMsg?.reactions.cache.find(r => r.emoji.name === '✅');
  let candidates    = [];

  if (yesReaction) {
    const yesUsers = (await yesReaction.users.fetch()).filter(u => !u.bot);
    candidates = await Promise.all([...yesUsers.values()].map(async u => ({
      userId:      u.id,
      displayName: members.getDisplayName(u.id, u.displayName ?? u.username),
      showRole:    await getShowRole(interaction.guild, u.id, game.show),
    })));
  }

  // Fallback: all cached guild members
  if (candidates.length === 0) {
    candidates = await Promise.all(
      [...interaction.guild.members.cache.values()]
        .filter(m => !m.user.bot)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, 25)
        .map(async m => ({
          userId:      m.id,
          displayName: members.getDisplayName(m.id, m.displayName),
          showRole:    await getShowRole(interaction.guild, m.id, game.show),
        }))
    );
  }

  // One ActionRow per role, sorted so role-holders float to top
  const rows = characters.map(roleName => {
    const sorted = sortRoleOptions(candidates, roleName).slice(0, 25);
    const opts   = sorted.map(c => ({
      label: c.displayName.slice(0, 100),
      value: c.userId,
    }));
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cmr_select:${gameId}:${roleName}`)
        .setPlaceholder(`Who is playing ${roleName}?`)
        .addOptions(opts)
    );
  });

  const submitRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cmr_submit:${gameId}`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success)
  );

  await interaction.reply({
    content: `Who is playing each role for **${showLabel(game.show)}**?`,
    components: [...rows, submitRow],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Multi-role select handler ────────────────────────────────────────────────

async function handleMultiRoleSelect(interaction) {
  const parts   = interaction.customId.split(':');
  const gameId  = parseInt(parts[1], 10);
  const roleName = parts[2];
  const takerId  = interaction.values[0];
  const key      = `${interaction.user.id}:${gameId}`;

  const pending  = pendingMultiRole.get(key) ?? {};
  pending[roleName] = takerId;
  pendingMultiRole.set(key, pending);

  await interaction.deferUpdate();
}

// ─── Multi-role submit handler ────────────────────────────────────────────────

async function handleMultiRoleSubmit(interaction) {
  const gameId  = parseInt(interaction.customId.split(':')[1], 10);
  const key     = `${interaction.user.id}:${gameId}`;
  const pending = pendingMultiRole.get(key);

  const game = db.getCustomGameById(gameId);
  if (!game) {
    return interaction.update({ content: '❌ Game not found.', components: [] });
  }

  const characters = showCharacters(game.show);
  const missing    = characters.filter(r => !pending?.[r]);

  if (missing.length) {
    return interaction.update({
      content: `❌ Please select someone for: ${missing.join(', ')}`,
      components: interaction.message.components,
    });
  }

  pendingMultiRole.delete(key);
  db.confirmCustomGame(gameId);

  const takers = characters.map(role => ({ userId: pending[role], role }));

  const confirmMsg = buildConfirmationMessage({
    type:      'game',
    show:      game.show,
    date:      game.date,
    time:      game.time,
    takers,
    requester: null,
  });

  const channel     = await interaction.client.channels.fetch(game.channel_id);
  await channel.send(confirmMsg);

  const originalMsg = await channel.messages.fetch(game.message_id);
  await originalMsg.edit({ components: [buildConfirmButton(true, 'game', gameId)] });

  await interaction.update({ content: '✅ Confirmation recorded.', components: [] });
  console.log(`[confirm] ${interaction.user.tag} confirmed multi-role game ${gameId}`);
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

    // Check if this was the last open shift — if so, update the header post
    const allShifts = db.getCoverageShiftsByRequest(shift.request_id);
    const stillOpen = allShifts.filter(s => s.status === 'open');
    if (stillOpen.length === 0 && request.header_message_id) {
      let roleMention = '';
      if (request.character) {
        const discordRoleName = getDiscordRoleName(show, request.character);
        const discordRole     = interaction.guild.roles.cache.find(r => r.name === discordRoleName);
        if (discordRole) roleMention = discordRole.toString();
      }
      const resolvedText = buildResolvedHeaderPost(request, roleMention);
      const headerChannel = await interaction.client.channels.fetch(channelId);
      const headerMsg     = await headerChannel.messages.fetch(request.header_message_id);
      await headerMsg.edit({ content: resolvedText, components: [] });
    }
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

// ─── sortRoleOptions ──────────────────────────────────────────────────────────

/**
 * Sort candidates so those holding `roleName` appear first.
 * Slash-separated roles (e.g. "Daphne/Houdini") match either part.
 * Stable within each group (original order preserved).
 *
 * @param {Array<{userId: string, displayName: string, showRole: string|null}>} candidates
 * @param {string} roleName
 * @returns {Array}
 */
function sortRoleOptions(candidates, roleName) {
  const hasRole = c => c.showRole?.split('/').includes(roleName) ?? false;
  return [...candidates].sort((a, b) => hasRole(b) - hasRole(a));
}

// ─── Cancel button handler (from /open-coverage) ─────────────────────────────

async function handleCovCancelButton(interaction) {
  const [, type, rawId] = interaction.customId.split(':');
  const id = parseInt(rawId, 10);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (type === 'shift') {
    const shift = db.getCoverageShiftById(id);
    if (!shift) return interaction.editReply('❌ Shift not found.');
    if (shift.status === 'cancelled') return interaction.editReply('❌ Already cancelled.');
    const request = db.getCoverageRequest(shift.request_id);
    if (!request) return interaction.editReply('❌ Request not found.');

    db.markShiftCancelled(id);

    const remaining = db.getCoverageShiftsByRequest(request.id).filter(s => s.status === 'open');
    const plan = planShiftCancel(shift, request, remaining);

    const channel = await interaction.client.channels.fetch(request.channel_id);

    if (plan.action === 'delete-all') {
      db.markRequestCancelled(request.id);
      // Delete the shift post (may be same as header)
      if (shift.shift_message_id) {
        try { await (await channel.messages.fetch(shift.shift_message_id)).delete(); } catch { /* already gone */ }
      }
      // Delete the header post if it's a separate message
      if (request.header_message_id && request.header_message_id !== shift.shift_message_id) {
        try { await (await channel.messages.fetch(request.header_message_id)).delete(); } catch { /* already gone */ }
      }
    } else if (plan.action === 'edit-header') {
      // This shift's post IS the header — edit it to show header-only content (strip the shift line)
      try {
        const msg = await channel.messages.fetch(shift.shift_message_id);
        await msg.edit({ content: plan.headerContent, components: [] });
      } catch { /* already gone */ }
    } else {
      // delete-shift: non-header post, others remain
      if (shift.shift_message_id) {
        try { await (await channel.messages.fetch(shift.shift_message_id)).delete(); } catch { /* already gone */ }
      }
    }

    console.log(`[confirm] ${interaction.user.tag} cancelled shift ${id} via /open-coverage`);
    await interaction.editReply(`✅ Shift \`${id}\` cancelled and post deleted.`);
  } else {
    const game = db.getCustomGameById(id);
    if (!game) return interaction.editReply('❌ Game not found.');
    if (game.confirmed_at) return interaction.editReply('❌ This game is already confirmed.');

    db.deactivateCustomGame(id);
    if (game.channel_id && game.message_id) {
      try {
        const channel = await interaction.client.channels.fetch(game.channel_id);
        const message = await channel.messages.fetch(game.message_id);
        await message.delete();
      } catch (err) {
        console.error(`[confirm] Failed to delete game ${id} post:`, err.message);
      }
    }
    console.log(`[confirm] ${interaction.user.tag} cancelled custom game ${id} via /open-coverage`);
    await interaction.editReply(`✅ Custom game \`${id}\` cancelled and post deleted.`);
  }
}

module.exports = {
  buildConfirmButton,
  sortRoleOptions,
  handleConfirmCoverageButton,
  handleConfirmCoverageSelect,
  handleMultiRoleSelect,
  handleMultiRoleSubmit,
  handleCovCancelButton,
};
