'use strict';

/**
 * Discord adapter factory for the scheduler execute layer.
 *
 * Wraps all Discord.js client I/O behind a plain-object interface so
 * run* functions in lib/scheduler.js can be tested without a live Discord
 * connection. The prod adapter delegates to the real client; tests use the
 * stub from test/helpers/adapters.js.
 *
 * Design decisions:
 *   - fetchReactionUsers filters bots internally — callers never write .filter(u => !u.bot)
 *   - sendDM combines users.fetch + user.send — callers that only need to DM don't
 *     need to hold a user reference
 *   - fetchGuildRoles / fetchGuildMembers consolidate the guild hydration sequence
 *     (roles.fetch + members.fetch) required before guild.roles.cache is reliable;
 *     this sequence was previously duplicated across three run* functions
 *   - postMeetingReminder wraps the meetings.js function so runMeetingReminderCheck
 *     is testable without decomposing meetings.js (a separate follow-on)
 */

const { postMeetingReminder } = require('../meetings');

/**
 * Build a production DiscordAdapter bound to a live Discord.js Client.
 * Call once in scheduler.start(client) and pass the result to run* functions.
 *
 * @param {import('discord.js').Client} client
 * @returns {DiscordAdapter}
 */
function makeDiscordAdapter(client) {
  return {
    /**
     * Fetch a channel by ID.
     * The returned channel object carries a .guild reference usable by
     * fetchGuildRoles, fetchGuildMembers, and analyzeCoverage.
     *
     * @param {string} channelId
     * @returns {Promise<import('discord.js').GuildChannel>}
     */
    fetchChannel(channelId) {
      return client.channels.fetch(channelId);
    },

    /**
     * Fetch a message by ID within a channel.
     *
     * @param {import('discord.js').GuildChannel} channel
     * @param {string} messageId
     * @returns {Promise<import('discord.js').Message>}
     */
    fetchMessage(channel, messageId) {
      return channel.messages.fetch(messageId);
    },

    /**
     * Fetch a user by ID.
     *
     * @param {string} userId
     * @returns {Promise<import('discord.js').User>}
     */
    fetchUser(userId) {
      return client.users.fetch(userId);
    },

    /**
     * Fetch all non-bot users who reacted with a given reaction.
     * Bot-filtering is done here so callers never write .filter(u => !u.bot).
     *
     * @param {import('discord.js').MessageReaction} reaction
     * @returns {Promise<import('discord.js').Collection<string, import('discord.js').User>>}
     */
    async fetchReactionUsers(reaction) {
      return (await reaction.users.fetch()).filter(u => !u.bot);
    },

    /**
     * Send a message to a channel.
     *
     * @param {import('discord.js').GuildChannel} channel
     * @param {string|import('discord.js').MessagePayload} content
     * @returns {Promise<import('discord.js').Message>}
     */
    sendMessage(channel, content) {
      return channel.send(content);
    },

    /**
     * Fetch a user by ID and send them a DM.
     * Combines users.fetch + user.send so callers that only need to DM
     * don't have to hold a user reference.
     *
     * @param {string} userId
     * @param {string|object} payload
     * @returns {Promise<void>}
     */
    async sendDM(userId, payload) {
      const user = await client.users.fetch(userId);
      await user.send(payload);
    },

    /**
     * Populate guild.roles.cache by calling guild.roles.fetch().
     * Must be called before accessing guild.roles.cache or role.members.
     *
     * @param {import('discord.js').Guild} guild
     * @returns {Promise<void>}
     */
    fetchGuildRoles(guild) {
      return guild.roles.fetch();
    },

    /**
     * Populate guild.members.cache by calling guild.members.fetch().
     * Must be called before accessing role.members.
     *
     * @param {import('discord.js').Guild} guild
     * @returns {Promise<void>}
     */
    fetchGuildMembers(guild) {
      return guild.members.fetch();
    },

    /**
     * Post a meeting reminder via lib/meetings.js.
     * Wraps postMeetingReminder(client, ...) so runMeetingReminderCheck
     * can be tested without a live client.
     *
     * @param {object} meeting      Active meeting row from DB
     * @param {string} instanceDate YYYY-MM-DD
     * @param {'7d'|'24h'} reminderType
     * @returns {Promise<void>}
     */
    postMeetingReminder(meeting, instanceDate, reminderType) {
      return postMeetingReminder(client, meeting, instanceDate, reminderType);
    },
  };
}

module.exports = { makeDiscordAdapter };
