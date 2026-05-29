'use strict';

const db      = require('./db');
const utils   = require('./utils');
const cfg     = require('./config');
const members = require('./members');
const { showAutoRole, showCharacters, getDiscordRoleName, getShowRole, showEmojis } = require('./shows');
const { planMissingRolePings, buildEodDM, buildAllRespondedDM, analyzeCoverage } = require('./coverage');

// ─── Shared helpers ────────────────────────────────────────────────────────────

async function fetchYesReactors(discord, message) {
  const reaction = message.reactions.cache.find(r => r.emoji.name === '✅');
  if (!reaction) return new Map();
  return discord.fetchReactionUsers(reaction);
}

function planNonResponderMentions(memberIds, reactorIds, exclusionIds) {
  const reacted  = new Set(reactorIds);
  const excluded = new Set(exclusionIds);
  return memberIds.filter(id => !reacted.has(id) && !excluded.has(id));
}

// ─── Coverage role-ping execute ────────────────────────────────────────────────

async function runCoverageRolePings(discord, repo) {
  const openShifts   = repo.getOpenShifts();
  const openGames    = repo.getOpenGames();
  if (!openShifts.length && !openGames.length) return;

  const exclusionIds = db.getCoveragePingExclusions();

  // Maps: messageId → show / dateTimeStr / requester_id / requester_name / shift meta (needed in the send loop)
  const showByMessageId          = new Map();
  const dateTimeByMessageId      = new Map();
  const requesterByMessageId     = new Map(); // coverage shifts only; used to exclude requester from pings
  const requesterNameByMessageId = new Map(); // coverage shifts only; used in manager DM
  const shiftMetaByMessageId     = new Map(); // coverage shifts only; messageId → { id, alertSent }

  // Enrich shifts with missingRoles
  const enrichedShifts = [];
  for (const s of openShifts) {
    if (!s.shift_message_id || !s.channel_id) continue;

    const roleForShift = s.character ?? showAutoRole(s.show);
    if (!roleForShift) continue;

    let missingRoles = [roleForShift];
    try {
      const ch       = await discord.fetchChannel(s.channel_id);
      const msg      = await discord.fetchMessage(ch, s.shift_message_id);
      const yesUsers = await fetchYesReactors(discord, msg);
      const { isFilled } = await analyzeCoverage(ch.guild, yesUsers, s.show, s.character ?? null);
      if (isFilled) missingRoles = [];
    } catch (err) {
      console.warn(`[scheduler] Could not check reactions for shift ${s.id}:`, err.message);
      continue;
    }

    showByMessageId.set(s.shift_message_id, s.show);
    dateTimeByMessageId.set(s.shift_message_id, utils.formatShiftDateTime(s.date, s.time));
    if (s.requester_id)   requesterByMessageId.set(s.shift_message_id, s.requester_id);
    if (s.requester_name) requesterNameByMessageId.set(s.shift_message_id, s.requester_name);
    shiftMetaByMessageId.set(s.shift_message_id, { id: s.id, alertSent: !!s.all_responded_alert_sent });
    enrichedShifts.push({ ...s, missingRoles });
  }

  // Enrich games with missingRoles
  const enrichedGames = [];
  for (const g of openGames) {
    if (!g.message_id || !g.channel_id) continue;

    let missingRoles = [];
    try {
      const ch       = await discord.fetchChannel(g.channel_id);
      const guild    = ch.guild;
      const msg      = await discord.fetchMessage(ch, g.message_id);
      const yesUsers = await fetchYesReactors(discord, msg);
      const { isFilled, missingRoles: mr } = await analyzeCoverage(guild, yesUsers, g.show);
      if (!isFilled) {
        if (mr.length > 0) {
          missingRoles = mr;
        } else {
          const autoRole = showAutoRole(g.show);
          if (autoRole) missingRoles = [autoRole];
        }
      }
    } catch (err) {
      console.warn(`[scheduler] Could not check reactions for game ${g.id}:`, err.message);
      continue;
    }

    showByMessageId.set(g.message_id, g.show);
    dateTimeByMessageId.set(g.message_id, utils.formatShiftDateTime(g.date, g.time));
    enrichedGames.push({ ...g, missingRoles });
  }

  const plan = planMissingRolePings(enrichedShifts, enrichedGames);
  if (!plan.length) return;

  console.log(`[scheduler] Sending ${plan.length} missing-role ping(s)`);

  for (const { channelId, roleNames, messageId } of plan) {
    try {
      const ch    = await discord.fetchChannel(channelId);
      const guild = ch.guild;
      await discord.fetchGuildRoles(guild);
      await discord.fetchGuildMembers(guild);

      const show            = showByMessageId.get(messageId);
      const maybeEmojiNames = show ? new Set(showEmojis(show).maybe.map(e => e.name)) : new Set();

      // Collect all reactors (any emoji) + maybe-reactors in one pass
      const reactorIds      = new Set();
      const maybeReactorIds = new Set();
      try {
        const msg = await discord.fetchMessage(ch, messageId);
        for (const reaction of msg.reactions.cache.values()) {
          const users = await discord.fetchReactionUsers(reaction);
          users.forEach(u => {
            reactorIds.add(u.id);
            if (maybeEmojiNames.has(reaction.emoji.name)) maybeReactorIds.add(u.id);
          });
        }
      } catch (err) {
        console.warn(`[scheduler] Could not fetch reactors for ${messageId}, falling back to role pings:`, err.message);
      }

      const mentions       = [];
      const exhaustedRoles = []; // roles where all effective members responded but none said yes

      for (const roleName of roleNames) {
        const discordRoleName = show ? getDiscordRoleName(show, roleName) : roleName;
        const discordRole     = guild.roles.cache.find(r => r.name === discordRoleName);

        if (!discordRole) {
          mentions.push(`@${discordRoleName}`);
          continue;
        }

        const memberIds        = [...discordRole.members.keys()];
        const shiftRequester   = requesterByMessageId.get(messageId);
        const pingExclusionIds = shiftRequester ? [...exclusionIds, shiftRequester] : exclusionIds;
        const nonResponders    = planNonResponderMentions(memberIds, reactorIds, pingExclusionIds);

        // Effective members are those not in the exclusion list (e.g. not the requester)
        const excludedSet      = new Set(pingExclusionIds);
        const effectiveMembers = memberIds.filter(id => !excludedSet.has(id));

        if (nonResponders.length > 0) {
          // Some members haven't responded yet — ping them individually
          mentions.push(...nonResponders.map(id => `<@${id}>`));
        } else if (effectiveMembers.length > 0) {
          // All effective members responded but none said yes — DM path, no channel ping
          exhaustedRoles.push(roleName);
        } else {
          // No effective members in role (empty or fully excluded) — @role fallback
          mentions.push(`<@&${discordRole.id}>`);
        }
      }

      // Send DMs when all cast for one or more roles have responded with no availability
      const shiftMeta = shiftMetaByMessageId.get(messageId);
      if (exhaustedRoles.length > 0 && shiftMeta && !shiftMeta.alertSent) {
        const dateTimeStr = dateTimeByMessageId.get(messageId);
        const postLink    = `https://discord.com/channels/${guild.id}/${channelId}/${messageId}`;
        const maybeNames  = [...maybeReactorIds]
          .map(id => members.getDisplayName(id, null))
          .filter(Boolean);

        const requesterId = requesterByMessageId.get(messageId);
        if (requesterId) {
          try {
            await discord.sendDM(requesterId,
              buildAllRespondedDM(exhaustedRoles, show, dateTimeStr, postLink, 'requester', maybeNames));
          } catch (err) {
            console.warn(`[scheduler] Could not DM requester for shift ${shiftMeta.id}:`, err.message);
          }
        }

        const managerId     = cfg.getCoverageManagerId();
        const requesterName = requesterNameByMessageId.get(messageId) ?? null;
        if (managerId) {
          try {
            await discord.sendDM(managerId,
              buildAllRespondedDM(exhaustedRoles, show, dateTimeStr, postLink, 'manager', maybeNames, requesterName));
          } catch (err) {
            console.warn(`[scheduler] Could not DM cast manager for shift ${shiftMeta.id}:`, err.message);
          }
        }

        repo.markAllRespondedAlertSent(shiftMeta.id);
        shiftMeta.alertSent = true;
        console.log(`[scheduler] Sent all-responded alert for shift ${shiftMeta.id} (${exhaustedRoles.join(', ')})`);
      }

      // Send channel ping for roles that still have non-responders
      if (mentions.length > 0) {
        const dateTimeStr = dateTimeByMessageId.get(messageId);
        const forPart     = dateTimeStr ? ` for ${dateTimeStr}` : '';
        const link        = `https://discord.com/channels/${guild.id}/${channelId}/${messageId}`;
        const content     = `${mentions.join(' ')} Reminder: coverage still needed${forPart} — react ✅ if you're available: ${link}`;
        await discord.sendMessage(ch, content);
        console.log(`[scheduler] Sent role ping in channel ${channelId} for message ${messageId}`);
      }
    } catch (err) {
      console.error(`[scheduler] Role ping failed for message ${messageId}:`, err.message);
    }
  }
}

// ─── EOD coverage reminder execute ────────────────────────────────────────────

async function runEodCoverageReminder(discord, repo) {
  const managerId = cfg.getCoverageManagerId();
  if (!managerId) {
    console.warn('[scheduler] EOD reminder: no cast manager configured');
    return;
  }

  const unconfirmedShifts = repo.getUnconfirmedShifts();
  const unconfirmedGames  = repo.getUnconfirmedGames();
  if (!unconfirmedShifts.length && !unconfirmedGames.length) return;

  const pendingItems = [];

  for (const s of unconfirmedShifts) {
    let guildId = null;
    let availableByRole = [];
    try {
      const ch  = await discord.fetchChannel(s.channel_id);
      guildId   = ch.guild.id;
      const msg = await discord.fetchMessage(ch, s.shift_message_id);
      const yes = msg.reactions.cache.find(r => r.emoji.name === '✅');
      if (yes) {
        const yesUsers = await discord.fetchReactionUsers(yes);
        availableByRole = [...yesUsers.values()]
          .map(u => members.getDisplayName(u.id, u.displayName ?? u.username))
          .sort();
      }
    } catch (err) {
      console.warn(`[scheduler] EOD: could not fetch shift ${s.id} info:`, err.message);
      if (!guildId) continue;
    }

    pendingItems.push({
      show:            s.show,
      date:            s.date,
      time:            s.time,
      character:       s.character ?? null,
      availableByRole,
      postLink: `https://discord.com/channels/${guildId}/${s.channel_id}/${s.shift_message_id}`,
    });
  }

  for (const g of unconfirmedGames) {
    let guildId = null;
    let availableByRole = [];
    try {
      const ch    = await discord.fetchChannel(g.channel_id);
      guildId     = ch.guild.id;
      const guild = ch.guild;
      const msg   = await discord.fetchMessage(ch, g.message_id);
      const yes   = msg.reactions.cache.find(r => r.emoji.name === '✅');
      const yesUsers = yes
        ? await discord.fetchReactionUsers(yes)
        : new Map();

      if (showCharacters(g.show) && yesUsers.size > 0) {
        availableByRole = {};
        for (const u of yesUsers.values()) {
          const roleStr = await getShowRole(guild, u.id, g.show);
          if (roleStr) {
            for (const part of roleStr.split('/')) {
              if (!availableByRole[part]) availableByRole[part] = [];
              availableByRole[part].push(members.getDisplayName(u.id, u.displayName ?? u.username));
            }
          }
        }
      } else {
        availableByRole = [...yesUsers.values()]
          .map(u => members.getDisplayName(u.id, u.displayName ?? u.username))
          .sort();
      }
    } catch (err) {
      console.warn(`[scheduler] EOD: could not fetch game ${g.id} info:`, err.message);
      if (!guildId) continue;
    }

    pendingItems.push({
      show:            g.show,
      date:            g.date,
      time:            g.time,
      character:       null,
      availableByRole,
      postLink: `https://discord.com/channels/${guildId}/${g.channel_id}/${g.message_id}`,
    });
  }

  if (!pendingItems.length) return;

  const dmText = buildEodDM(pendingItems);
  try {
    await discord.sendDM(managerId, dmText);
    console.log(`[scheduler] Sent EOD coverage reminder (${pendingItems.length} item(s)) to cast manager`);
  } catch (err) {
    console.error('[scheduler] Failed to send EOD coverage reminder:', err.message);
  }
}

module.exports = {
  runCoverageRolePings,
  runEodCoverageReminder,
  fetchYesReactors,
  planNonResponderMentions,
};
