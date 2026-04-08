const db                        = require('./db');
const { RSVP_EMOJIS, TRACKER_MARKER } = require('./meetings');

const RSVP_EMOJI_SET = new Set(RSVP_EMOJIS); // ✅ ❌ ❓

/**
 * Called on every MessageReactionAdd / MessageReactionRemove event.
 * If the message is one of our RSVP reminder posts, edit it to show
 * an up-to-date list of who has reacted with each emoji.
 */
async function handleReactionChange(client, reaction, user) {
  // Ignore bot reactions (the bot adds its own RSVP emojis when posting)
  if (user.bot) return;

  // Only care about our three RSVP emojis
  if (!RSVP_EMOJI_SET.has(reaction.emoji.name)) return;

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

  // Check if this message is one of our reminder posts
  const record = db.getReminderByMessageId(message.id);
  if (!record) return;

  // Fetch all three emoji reaction user lists in parallel
  const [attending, notAttending, maybe] = await Promise.all(
    RSVP_EMOJIS.map(async emoji => {
      const r = message.reactions.cache.get(emoji);
      if (!r) return [];
      const users = await r.users.fetch();
      return users
        .filter(u => !u.bot)
        .map(u => u.displayName ?? u.username)
        .sort();
    })
  );

  // Build the tracker section
  const tracker = [
    `✅ **Attending (${attending.length}):** ${attending.length ? attending.join(', ') : '_none yet_'}`,
    `❌ **Not attending (${notAttending.length}):** ${notAttending.length ? notAttending.join(', ') : '_none yet_'}`,
    `❓ **Maybe (${maybe.length}):** ${maybe.length ? maybe.join(', ') : '_none yet_'}`,
  ].join('\n');

  // Strip any existing tracker from the message, then append the fresh one.
  // TRACKER_MARKER = '\n\n✅ **Attending' — unique enough to never appear in the static header.
  const baseContent  = message.content.split(TRACKER_MARKER)[0];
  const newContent   = `${baseContent}\n\n${tracker}`;

  try {
    await message.edit(newContent);
  } catch (err) {
    console.error(`[rsvp] Failed to edit message ${message.id}:`, err.message);
  }
}

module.exports = { handleReactionChange };
