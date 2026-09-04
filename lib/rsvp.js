const db                          = require('./db');
const repo                        = require('./coverage-repository');
const utils                       = require('./utils');
const cfg                         = require('./config');
const { RSVP_EMOJIS, TRACKER_MARKER } = require('./meetings');
const { resolveReaction, statusForEmoji, buildSharedRsvpTracker, STATUS_EMOJI } = require('./meeting-rsvp');
const { allEmojisForShow, emojiDisplay, getShowRole, showLabel, showEmojis, showReactionList, showRoleGroups, ALL_SHOW_EMOJI_NAMES } = require('./shows');
const members                     = require('./members');
const { buildFillableDM, analyzeCoverage } = require('./coverage');

// Union of all emoji names that can trigger an RSVP update
const ALL_RSVP_EMOJI_NAMES = new Set([...RSVP_EMOJIS, ...ALL_SHOW_EMOJI_NAMES]);

/**
 * Called on every MessageReactionAdd / MessageReactionRemove event.
 * Routes to the appropriate tracker updater based on which post was reacted to.
 *
 * @param {'add'|'remove'} [action='add']  Which reaction event fired. Only the
 *        monthly meeting shared-RSVP path needs it; other paths re-derive state
 *        from the message's current reactions.
 */
async function handleReactionChange(client, reaction, user, action = 'add') {
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
  const reminderRecord = db.getReminderByMessageId(message.id);
  if (reminderRecord) {
    await handleMeetingReaction(client, reaction, user, action, reminderRecord);
    return;
  }

  // Coverage shift post?
  const shiftRecord = repo.getShiftByMessageId(message.id);
  if (shiftRecord && reaction.emoji.name === '✅') {
    await checkCoverageShiftFillable(message, shiftRecord, message.client, message.guild);
    return;
  }

  // Custom game post?
  const gameRecord = repo.getGameByMessageId(message.id);
  if (gameRecord) {
    await updateCustomGameTracker(message, gameRecord);
    // Check fill only when someone reacts ✅
    if (reaction.emoji.name === '✅') {
      await checkGameFillable(message, gameRecord, message.guild);
    }
    return;
  }

  // Coverage ping message? Redirect mis-reactor to the original shift/game post.
  const pingRecord = repo.getPingByMessageId(message.id);
  if (pingRecord) {
    await handlePingRedirect(client, reaction, user, pingRecord);
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

// ─── Monthly recurring: shared per-occurrence RSVP ────────────────────────────

/**
 * Handle a reaction on any meeting reminder post. For monthly recurring 7d/24h
 * posts, the two posts share one occurrence RSVP: reacting on either updates the
 * shared state (most-recent-wins), removes the now-stale reaction from the other
 * post, and re-renders both trackers. All other meeting posts fall back to the
 * single-message tracker.
 */
async function handleMeetingReaction(client, reaction, user, action, reminderRecord) {
  const meeting = db.getMeeting(reminderRecord.meeting_id);
  const isMonthlyOccurrence = meeting
    && meeting.recurrence_type === 'monthly_weekday'
    && (reminderRecord.reminder_type === '7d' || reminderRecord.reminder_type === '24h');

  if (!isMonthlyOccurrence) {
    await updateMeetingTracker(reaction.message);
    return;
  }

  const status = statusForEmoji(reaction.emoji.name);
  if (!status) return;

  const meetingId    = reminderRecord.meeting_id;
  const instanceDate = reminderRecord.instance_date;
  const post         = reminderRecord.reminder_type; // '7d' | '24h'

  const priorRow = db.getMeetingRsvp(meetingId, instanceDate, user.id);
  const prior    = priorRow ? { status: priorRow.status, post: priorRow.post } : null;

  const resolution = resolveReaction(prior, { post, status, action });

  if (resolution.persist.type === 'set') {
    db.setMeetingRsvp(meetingId, instanceDate, user.id,
      resolution.persist.status, resolution.persist.post, Date.now(), resolveReactorName(reaction, user));
  } else if (resolution.persist.type === 'delete') {
    db.removeMeetingRsvp(meetingId, instanceDate, user.id);
  } else {
    return; // no-op (identical re-add, or the echo from our own cleanup removal)
  }

  const postIds = db.getMeetingPostIds(meetingId, instanceDate);
  const channel = reaction.message.channel;

  // Remove now-stale reactions from the other post so emojis never contradict the list.
  for (const c of resolution.cleanup) {
    await removeUserReactionOnPost(channel, postIds[c.post], STATUS_EMOJI[c.status], user.id);
  }

  await renderOccurrenceTrackers(channel, meetingId, instanceDate, postIds);
}

/** Best-effort display name for a reactor, resolved once at write time. */
function resolveReactorName(reaction, user) {
  const gm       = reaction.message.guild?.members?.cache?.get(user.id);
  const fallback = gm?.displayName ?? user.username ?? user.id;
  return members.getDisplayName(user.id, fallback);
}

/** Remove a user's reaction of a given emoji from a post (no-op if absent/missing). */
async function removeUserReactionOnPost(channel, messageId, emojiName, userId) {
  if (!messageId) return;
  try {
    const msg = await channel.messages.fetch(messageId);
    const r   = msg.reactions.cache.find(rr => rr.emoji.name === emojiName);
    if (r) await r.users.remove(userId);
  } catch (err) {
    console.warn(`[rsvp] Could not remove stale ${emojiName} for ${userId} on ${messageId}:`, err.message);
  }
}

/** Re-render the shared RSVP tracker onto both the 7d and 24h posts of an occurrence. */
async function renderOccurrenceTrackers(channel, meetingId, instanceDate, postIds) {
  const tracker = buildSharedRsvpTracker(db.getMeetingRsvps(meetingId, instanceDate));
  for (const pid of [postIds['7d'], postIds['24h']]) {
    if (!pid) continue;
    try {
      const msg = await channel.messages.fetch(pid);
      await editTracker(msg, tracker);
    } catch (err) {
      console.warn(`[rsvp] Could not render tracker on ${pid}:`, err.message);
    }
  }
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

/** Fetch non-bot ✅ reactors from a message. Returns a Map<userId, User>. */
async function fetchYesReactors(message) {
  const reaction = message.reactions.cache.find(r => r.emoji.name === '✅');
  if (!reaction) return new Map();
  return (await reaction.users.fetch()).filter(u => !u.bot);
}

async function checkCoverageShiftFillable(message, shift, client, guild) {
  if (shift.fillable_notified) return;

  const request  = repo.getRequest(shift.request_id);
  const yesUsers = await fetchYesReactors(message);
  const { isFilled, availableByRole } = await analyzeCoverage(guild, yesUsers, request.show, request.character ?? null);
  if (!isFilled) return;

  repo.setFillableNotified('shift', shift.id);

  const managerId = cfg.getCoverageManagerId();
  if (!managerId) {
    console.warn(`[rsvp] Shift ${shift.id} is fillable but no cast manager configured`);
    return;
  }

  const postLink = `https://discord.com/channels/${guild.id}/${request.channel_id}/${shift.shift_message_id}`;
  const dmText   = buildFillableDM({
    show:            request.show,
    date:            shift.date,
    time:            shift.time,
    character:       request.character ?? null,
    availableByRole,
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
  const fresh = repo.getGameByMessageId(message.id);
  if (!fresh || fresh.fillable_notified) return;

  const yesUsers = await fetchYesReactors(message);
  const { isFilled, availableByRole } = await analyzeCoverage(guild, yesUsers, fresh.show);
  if (!isFilled) return;

  repo.markGameFilled(fresh.id);
  repo.setFillableNotified('game', fresh.id);

  const managerId = cfg.getCoverageManagerId();
  if (!managerId) {
    console.warn(`[rsvp] Game ${fresh.id} is fillable but no cast manager configured`);
    return;
  }

  const postLink = `https://discord.com/channels/${guild.id}/${fresh.channel_id}/${fresh.message_id}`;
  const dmText   = buildFillableDM({
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

// ─── Coverage ping redirect ───────────────────────────────────────────────────

/**
 * Called when someone reacts to a coverage role-ping message instead of the
 * original shift/game post. Removes the mis-placed reaction, DMs the user with
 * a link to the original, and edits the ping message once to redirect future readers.
 */
async function handlePingRedirect(client, reaction, user, pingRecord) {
  // Only act on coverage-relevant emojis for this show
  const emojis = showEmojis(pingRecord.show);
  const relevantNames = new Set([
    ...emojis.yes.map(e => e.name),
    ...emojis.maybe.map(e => e.name),
    ...emojis.no.map(e => e.name),
  ]);
  if (!relevantNames.has(reaction.emoji.name)) return;

  const message     = reaction.message;
  const link        = `https://discord.com/channels/${message.guild.id}/${pingRecord.channel_id}/${pingRecord.original_message_id}`;
  const dateTimeStr = utils.formatShiftDateTime(pingRecord.date, pingRecord.time);

  // 1. Remove the mis-placed reaction
  try {
    await reaction.users.remove(user.id);
  } catch (err) {
    console.warn(`[rsvp] Could not remove ping reaction for user ${user.id}:`, err.message);
  }

  // 2. DM the user — failure is non-blocking
  try {
    const dmUser   = await client.users.fetch(user.id);
    const showName = showLabel(pingRecord.show);
    await dmUser.send(
      `Hey! Looks like you reacted to the coverage reminder for **${showName}** on **${dateTimeStr}** — but that message is just a ping, not the actual post. Please react on the original post here: **${link}**`
    );
  } catch (err) {
    console.warn(`[rsvp] Could not DM user ${user.id} about ping redirect:`, err.message);
  }

  // 3. Edit the ping message once to permanently redirect future readers
  if (!pingRecord.redirected) {
    const mentionsPart = message.content.split(' Reminder:')[0];
    const forPart      = dateTimeStr ? ` for ${dateTimeStr}` : '';
    const reactionList = showReactionList(message.guild, pingRecord.show);
    const newContent   = `${mentionsPart} Reminder: coverage still needed${forPart} — react ${reactionList} to the original request ASAP: ${link}`;
    try {
      await message.edit(newContent);
      repo.markPingRedirected(pingRecord.ping_message_id);
    } catch (err) {
      console.error(`[rsvp] Could not edit ping message ${message.id}:`, err.message);
    }
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
