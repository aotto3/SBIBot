const db                          = require('./db');
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
    // Get all non-bot users who reacted with this emoji
    const r = message.reactions.cache.find(r => r.emoji.name === emojiDesc.name);
    const users = r
      ? (await r.users.fetch()).filter(u => !u.bot).values()
      : [];

    // Look up each user's show role and format their display name
    const nameList = [];
    for (const u of users) {
      const role        = await getShowRole(guild, u.id, showKey);
      const displayName = u.displayName ?? u.username;
      nameList.push(role ? `${displayName} (${role})` : displayName);
    }
    nameList.sort();

    const emojiStr = emojiDisplay(guild, emojiDesc);
    lines.push(`${emojiStr} **${emojiDesc.label} (${nameList.length}):** ${nameList.length ? nameList.join(', ') : '_none yet_'}`);
  }

  await editTracker(message, lines.join('\n'));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch sorted display names of non-bot users who reacted with a given unicode emoji.
 */
async function fetchReactorNames(message, emoji) {
  const r = message.reactions.cache.get(emoji);
  if (!r) return [];
  const users = await r.users.fetch();
  return users
    .filter(u => !u.bot)
    .map(u => u.displayName ?? u.username)
    .sort();
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
