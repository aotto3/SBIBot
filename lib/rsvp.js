const db                          = require('./db');
const utils                       = require('./utils');
const { RSVP_EMOJIS, TRACKER_MARKER } = require('./meetings');
const { SHOWS, allEmojisForShow, emojiDisplay, getShowRole, ALL_SHOW_EMOJI_NAMES } = require('./shows');

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

  // Custom game post?
  const gameRecord = db.getCustomGameByMessageId(message.id);
  if (gameRecord) {
    await updateCustomGameTracker(message, gameRecord);
    // Check fill only when someone reacts ✅
    if (reaction.emoji.name === '✅') {
      await checkFilled(message, gameRecord, message.guild);
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
  const showKey = gameRecord.show;
  const guild   = message.guild;
  const emojis  = allEmojisForShow(showKey);

  const lines = [];

  for (const emojiDesc of emojis) {
    const r = message.reactions.cache.find(r => r.emoji.name === emojiDesc.name);
    const users = r
      ? (await r.users.fetch()).filter(u => !u.bot).values()
      : [];

    const nameList = [];
    for (const u of users) {
      const role      = await getShowRole(guild, u.id, showKey);
      const firstName = db.getMemberFirstName(u.id, u.displayName ?? u.username);
      nameList.push(role ? `${firstName} (${role})` : firstName);
    }
    nameList.sort();

    const emojiStr = emojiDisplay(guild, emojiDesc);
    lines.push(`${emojiStr} **${emojiDesc.label} (${nameList.length}):** ${nameList.length ? nameList.join(', ') : '_none yet_'}`);
  }

  await editTracker(message, lines.join('\n'));
}

// ─── Fill detection ───────────────────────────────────────────────────────────

async function checkFilled(message, gameRecord, guild) {
  // Re-fetch from DB so filled_at is always current
  const fresh = db.getCustomGameByMessageId(message.id);
  if (!fresh || fresh.filled_at || !fresh.requester_id) return;

  const config = SHOWS[fresh.show];

  // Collect ✅ reactors
  const yesReaction = message.reactions.cache.find(r => r.emoji.name === '✅');
  if (!yesReaction) return;
  const yesUsers = (await yesReaction.users.fetch()).filter(u => !u.bot);
  if (yesUsers.size === 0) return;

  let isFilled = false;
  const castList = []; // { firstName, role } for the DM

  if (config.autoRole) {
    // Single-role show — any yes = filled
    isFilled = true;
    for (const u of yesUsers.values()) {
      castList.push({
        firstName: db.getMemberFirstName(u.id, u.displayName ?? u.username),
        role:      config.autoRole,
      });
    }
  } else if (config.discordRoles) {
    // Multi-role show — need at least one person per role
    const rolesCovered = Object.fromEntries(
      Object.keys(config.discordRoles).map(r => [r, false])
    );

    for (const u of yesUsers.values()) {
      const roleStr = await getShowRole(guild, u.id, fresh.show);
      if (roleStr) {
        for (const part of roleStr.split('/')) {
          if (part in rolesCovered) rolesCovered[part] = true;
        }
        castList.push({
          firstName: db.getMemberFirstName(u.id, u.displayName ?? u.username),
          role:      roleStr,
        });
      }
    }

    isFilled = Object.values(rolesCovered).every(Boolean);
  }

  if (!isFilled) return;

  db.markCustomGameFilled(fresh.id);

  // Build "Alice (Daphne) and Bob (Houdini)" style string
  castList.sort((a, b) => a.firstName.localeCompare(b.firstName));
  const castParts = castList.map(({ firstName, role }) => `${firstName} (${role})`);
  const castStr   = castParts.length === 1
    ? castParts[0]
    : castParts.slice(0, -1).join(', ') + ' and ' + castParts[castParts.length - 1];
  const verb      = castParts.length === 1 ? 'is' : 'are';

  const dateTimeStr = formatGameDateTime(fresh.date, fresh.time);
  const dmContent   = `<@${fresh.requester_id}>, ${castStr} ${verb} available for **${config.label}** on ${dateTimeStr}!`;

  try {
    const requester = await message.client.users.fetch(fresh.requester_id);
    await requester.send(dmContent);
    console.log(`[rsvp] Sent fill DM to requester ${fresh.requester_id} for custom game ${fresh.id}`);
  } catch (err) {
    console.error(`[rsvp] Failed to DM fill notification to ${fresh.requester_id}:`, err.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch sorted first names of non-bot users who reacted with a given unicode emoji. */
async function fetchReactorNames(message, emoji) {
  const r = message.reactions.cache.get(emoji);
  if (!r) return [];
  const users = await r.users.fetch();
  return users
    .filter(u => !u.bot)
    .map(u => db.getMemberFirstName(u.id, u.displayName ?? u.username))
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
 */
async function editTracker(message, trackerContent) {
  const baseContent = message.content.split(TRACKER_MARKER)[0];
  const newContent  = `${baseContent}\n\n${trackerContent}`;
  try {
    await message.edit(newContent);
  } catch (err) {
    console.error(`[rsvp] Failed to edit message ${message.id}:`, err.message);
  }
}

module.exports = { handleReactionChange };
