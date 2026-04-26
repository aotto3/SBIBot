// Single source of truth for cast member identity resolution.
// Every module that needs to go from a Bookeo name, Discord ID, or interaction
// to a display name goes through this module.
const db = require('./db');

/** First word of a Bookeo display name (e.g. "Alice Smith" → "Alice"). */
function firstName(bookeoName) {
  return bookeoName.split(' ')[0];
}

/**
 * Resolve a Bookeo name to member identity.
 * Returns { discordId, bookeoName, firstName } or null if not linked.
 * Logs a warning when null — callers can skip without their own warning.
 */
function resolveByBookeoName(bookeoName) {
  const row = db.getMemberByBookeoName(bookeoName);
  if (!row) {
    console.warn(`[members] No link for bookeo_name: ${bookeoName}`);
    return null;
  }
  return { discordId: row.discord_id, bookeoName: row.bookeo_name, firstName: firstName(row.bookeo_name) };
}

/**
 * Resolve a Discord ID to member identity.
 * Returns { discordId, bookeoName, firstName } or null if not linked.
 */
function resolveByDiscordId(discordId) {
  const row = db.getMemberByDiscordId(discordId);
  if (!row) return null;
  return { discordId: row.discord_id, bookeoName: row.bookeo_name, firstName: firstName(row.bookeo_name) };
}

/**
 * Return a display name for a Discord user.
 * Uses Bookeo first name if linked, otherwise returns `fallback`.
 */
function getDisplayName(discordId, fallback) {
  const member = resolveByDiscordId(discordId);
  return member ? member.firstName : fallback;
}

/**
 * All linked members as { discordId, bookeoName, firstName }.
 * Use for bulk iteration — do not build this Map in callers.
 */
function getAllLinkedMembers() {
  return db.getAllMemberLinks().map(row => ({
    discordId: row.discord_id,
    bookeoName: row.bookeo_name,
    firstName:  firstName(row.bookeo_name),
  }));
}

module.exports = {
  firstName,
  resolveByBookeoName,
  resolveByDiscordId,
  getDisplayName,
  getAllLinkedMembers,
};
