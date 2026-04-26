const db                          = require('./db');
const utils                       = require('./utils');
const cfg                         = require('./config');
const { RSVP_EMOJIS, TRACKER_MARKER } = require('./meetings');
const { allEmojisForShow, emojiDisplay, getShowRole, showLabel, showRoleGroups, showCharacters, getRoleCoverage, ALL_SHOW_EMOJI_NAMES } = require('./shows');
const members                     = require('./members');
const { buildFillableDM }         = require('./coverage');

// Union of all emoji names that can trigger an RSVP update
const ALL_RSVP_EMOJI_NAMES = new Set([...RSVP_EMOJIS, ...ALL_SHOW_EMOJI_NAMES]);

/**
 * Called on every MessageReactionAdd / MessageReactionRemove event.
 * Routes to the appropriate tracker updater based on which post was reacted to.
 */
async function handleReactionChange(client, reaction, user) {
  if (user.bot) return;
  if (!ALL_RSVP_EMOJI_NAMES.has(reaction.emoji.name)) return;

  // Fetch partials — reactions/messages sent before the last bot restart
  // come in as incomplete objects and need to be fetched before use.
  try {
    if (reaction.partial)         await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch (err) {
    console.error('[rsvp] Failed to fetch partial reaction/message:', err.message);
    return;
  }

  const message = reaction.message;

  // Meeting reminder post?
  if (db.getReminderByMessageId(message.id)) {
    await updateMeetingTracker(message);
    return;
  }

  // Coverage shift post?
  const shiftRecord = db.getCoverageShiftByMessageId(message.id);
  if (shiftRecord && reaction.emoji.name === '✅') {
    await checkCoverageShiftFillable(message, shiftRecord, message.client, message.guild);
    return;
  }

  // Custom game post?
  const gameRecord = db.getCustomGameByMessageId(message.id);
  if (gameRecord) {
    await updateCustomGameTracker(message, gameRecord);
    // Check fill only when someone reacts ✅
    if (reaction.emoji.name === '✅') {
      await checkGameFillable(message, gameRecord, message.guild);
    }
  }
}

// ─── Meeting RSVP tracker ─────────────────────────────────────────────────────

async function updateMeetingTracker(message) {
  const [attending, notAttending, maybe] = await Promise.all(
    RSVP_EMOJIS.map(emoji => fetchReactorNames(message, emoji))
  );

  const tracker = [
    `✅ **Attending (${attending.length}):** ${attending.length ? attending.join(', ') : '_none yet_'}`,
    `❌ **Not attending (${notAttending.length}):** ${notAttending.length ? notAttending.join(', ') : '_none yet_'}`,
    `❓ **Maybe (${maybe.length}):** ${maybe.length ? maybe.join(', ') : '_none yet_'}`,
  ].join('\n');

  await editTracker(message, tracker);
}

// ─── Custom game RSVP tracker ─────────────────────────────────────────────────

async function updateCustomGameTracker(message, gameRecord) {
  const showKey   = gameRecord.show;
  const guild     = message.guild;
  const roleGroups = showRoleGroups(showKey);

  // MFB: role-grouped display (Daphne / Houdini sections, no per-row emoji keys)
  if (roleGroups) {
    // Pre-fetch ✅ reactors once; we'll filter by role per section
    const yesReaction = message.reactions.cache.find(r => r.emoji.name === '✅');
    const yesUsers    = yesReaction
      ? (await yesReaction.users.fetch()).filter(u => !u.bot)
      : new Map();

    const lines = [];

    for (const group of roleGroups) {
      const availableNames = [];
      for (const [, u] of yesUsers) {
        const roleStr = await getShowRole(guild, u.id, showKey);
        if (roleStr && roleStr.split('/').includes(group.role)) {
          availableNames.push(members.getDisplayName(u.id, u.displayName ?? u.username));
        }
      }
      availableNames.sort();

      const unavailableNames = await fetchReactorNames(message, group.unavailable);
      const maybeNames       = await fetchReactorNames(message, group.maybe);

      lines.push(`**${group.name}**`);
      lines.push(`Available — ${availableNames.join(', ')}`);
      lines.push(`Unavailable — ${unavailableNames.join(', ')}`);
      lines.push(`Maybe — ${maybeNames.join(', ')}`);
      lines.push('');
    }
    if (lines[lines.length - 1] === '') lines.pop();

    await editTracker(message, lines.join('\n'));
    return;
  }

  // All other shows: simple emoji-per-line format with role labels
  const emojis = allEmojisForShow(showKey);
  const lines  = [];

  for (const emojiDesc of emojis) {
    const r     = message.reactions.cache.find(r => r.emoji.name === emojiDesc.name);
    const users = r ? (await r.users.fetch()).filter(u => !u.bot).values() : [];

    const nameList = [];
    for (const u of users) {
      const role      = await getShowRole(guild, u.id, showKey);
      const firstName = members.getDisplayName(u.id, u.displayName ?? u.username);
      nameList.push(role ? `${firstName} (${role})` : firstName);
    }
    nameList.sort();

    const emojiStr = emojiDisplay(guild, emojiDesc);
    lines.push(`${emojiStr} **${emojiDesc.label} (${nameList.length}):** ${nameList.length ? nameList.join(', ') : '_none yet_'}`);
  }

  await editTracker(message, lines.join('\n'));
}

// ─── Fillable detection ───────────────────────────────────────────────────────

async function checkCoverageShiftFillable(message, shift, client, guild) {
  if (shift.fillable_notified) return;

  const yesReaction = message.reactions.cache.find(r => r.emoji.name === '✅');
  if (!yesReaction) return;
  const yesUsers = (await yesReaction.users.fetch()).filter(u => !u.bot);
  if (yesUsers.size === 0) return;

  // Any ✅ reactor means this shift can be filled
  db.setFillableNotified('shift', shift.id);

  const managerId = cfg.getCoverageManagerId();
  if (!managerId) {
    console.warn(`[rsvp] Shift ${shift.id} is fillable but no cast manager configured`);
    return;
  }

  const request        = db.getCoverageRequest(shift.request_id);
  const availableNames = [...yesUsers.values()]
    .map(u => members.getDisplayName(u.id, u.displayName ?? u.username))
    .sort();

  const postLink = `https://discord.com/channels/${guild.id}/${request.channel_id}/${shift.shift_message_id}`;

  const dmText = buildFillableDM({
    show:            request.show,
    date:            shift.date,
    time:            shift.time,
    character:       request.character ?? null,
    availableByRole: availableNames,
    postLink,
  });

  try {
    const manager = await client.users.fetch(managerId);
    await manager.send(dmText);
    console.log(`[rsvp] Sent fillable DM to cast manager for shift ${shift.id}`);
  } catch (err) {
    console.error(`[rsvp] Failed to DM cast manager for shift ${shift.id}:`, err.message);
  }
}

async function checkGameFillable(message, gameRecord, guild) {
  const fresh = db.getCustomGameByMessageId(message.id);
  if (!fresh || fresh.fillable_notified) return;

  const yesReaction = message.reactions.cache.find(r => r.emoji.name === '✅');
  if (!yesReaction) return;
  const yesUsers = (await yesReaction.users.fetch()).filter(u => !u.bot);
  if (yesUsers.size === 0) return;

  const { isFilled, cast } = await getRoleCoverage(guild, yesUsers, fresh.show);
  if (!isFilled) return;

  // Mark filled (keeps the scheduler's 48h reminder guard working)
  db.markCustomGameFilled(fresh.id);
  db.setFillableNotified('game', fresh.id);

  const managerId = cfg.getCoverageManagerId();
  if (!managerId) {
    console.warn(`[rsvp] Game ${fresh.id} is fillable but no cast manager configured`);
    return;
  }

  // Build availableByRole: grouped by role for multi-role shows, flat array otherwise
  let availableByRole;
  const characters = showCharacters(fresh.show);
  if (characters) {
    availableByRole = {};
    for (const { userId, role } of cast) {
      for (const part of (role ?? '').split('/').filter(Boolean)) {
        if (!availableByRole[part]) availableByRole[part] = [];
        const u = yesUsers.get(userId);
        availableByRole[part].push(members.getDisplayName(userId, u?.displayName ?? u?.username));
      }
    }
  } else {
    availableByRole = [...yesUsers.values()]
      .map(u => members.getDisplayName(u.id, u.displayName ?? u.username))
      .sort();
  }

  const postLink = `https://discord.com/channels/${guild.id}/${fresh.channel_id}/${fresh.message_id}`;

  const dmText = buildFillableDM({
    show:            fresh.show,
    date:            fresh.date,
    time:            fresh.time,
    character:       null,
    availableByRole,
    postLink,
  });

  try {
    const manager = await message.client.users.fetch(managerId);
    await manager.send(dmText);
    console.log(`[rsvp] Sent fillable DM to cast manager for game ${fresh.id}`);
  } catch (err) {
    console.error(`[rsvp] Failed to DM cast manager for game ${fresh.id}:`, err.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch sorted first names of non-bot users who reacted with the given emoji.
 * emojiName: the unicode character (✅) or custom emoji name (Dno, Hmaybe, …).
 * Uses .find() by name so it works for both unicode and custom server emojis.
 */
async function fetchReactorNames(message, emojiName) {
  const r = message.reactions.cache.find(r => r.emoji.name === emojiName);
  if (!r) return [];
  const users = await r.users.fetch();
  return users
    .filter(u => !u.bot)
    .map(u => members.getDisplayName(u.id, u.displayName ?? u.username))
    .sort();
}

/** Format a stored date + optional time into a human-readable string. */
function formatGameDateTime(dateStr, timeStr) {
  const [y, mo, d]  = dateStr.split('-').map(Number);
  const dateDisplay = utils.formatMeetingDate(new Date(y, mo - 1, d));
  return timeStr ? `${dateDisplay} at ${utils.formatTime(timeStr)}` : dateDisplay;
}

/**
 * Replace the tracker section of a message (everything from TRACKER_MARKER onward)
 * with fresh tracker content, or append it if no tracker exists yet.
 * The marker is always embedded in the updated message so subsequent edits can split on it.
 */
async function editTracker(message, trackerContent) {
  const baseContent = message.content.split(TRACKER_MARKER)[0];
  const newContent  = `${baseContent}${TRACKER_MARKER}${trackerContent}`;
  try {
    await message.edit(newContent);
  } catch (err) {
    console.error(`[rsvp] Failed to edit message ${message.id}:`, err.message);
  }
}

module.exports = { handleReactionChange };
