'use strict';

/**
 * Test adapter stub factories for scheduler execute-layer tests.
 *
 * Usage:
 *   const { makeTestDiscordAdapter, makeTestBookeoAdapter } = require('./helpers/adapters');
 *
 *   const sent = [];
 *   const discord = makeTestDiscordAdapter({
 *     sendMessage: async (_ch, content) => sent.push(content),
 *   });
 *   await runCustomGameReminders(discord);
 *   assert.equal(sent.length, 1);
 *
 * All methods default to no-ops or empty returns. Pass per-test overrides to
 * control specific behaviour. The _fake* properties expose the default stub
 * objects so tests can inspect or configure them (e.g. add reactions to
 * _fakeMessage.reactions.cache before calling a run* function).
 */

// ─── Fake Discord object shapes ───────────────────────────────────────────────

/**
 * Minimal guild stub compatible with analyzeCoverage from lib/coverage.js.
 * analyzeCoverage walks guild.roles.cache, so the Map must contain role stubs
 * with a .members Map when tests need to exercise role-targeting logic.
 *
 * Default: empty roles cache (no role targeting, falls back to @here).
 */
/**
 * A Map extended with Discord.js Collection methods used in production code:
 *   .find(fn)  — like Array.find but over Map values
 * Covers guild.roles.cache.find(...) and message.reactions.cache.find(...)
 */
function makeFakeCollection(entries = []) {
  const map = new Map(entries);
  map.find = (fn) => {
    for (const val of map.values()) {
      if (fn(val)) return val;
    }
    return undefined;
  };
  return map;
}

function makeFakeGuild(overrides = {}) {
  return {
    id: 'guild-test-1',
    roles: {
      cache: makeFakeCollection(), // populate via .set(id, { id, name, members: Map<userId, {}> })
      fetch: async () => {},
    },
    members: {
      cache: new Map(),
      fetch: async () => {},
    },
    ...overrides,
  };
}

/**
 * Minimal message stub with an empty reactions cache.
 * Populate reactions.cache for tests that need to exercise reaction-fetching:
 *   fakeMessage.reactions.cache.set('✅', fakeReaction)
 */
function makeFakeMessage(overrides = {}) {
  return {
    id: 'msg-test-1',
    reactions: {
      cache: makeFakeCollection(), // populate: map.set('✅', { emoji: { name }, users: { fetch } })
    },
    ...overrides,
  };
}

/**
 * Minimal channel stub. The guild is shared so tests that configure roles
 * can do so once on the guild object.
 */
function makeFakeChannel(guild, overrides = {}) {
  const message = makeFakeMessage();
  return {
    id: 'channel-test-1',
    guild,
    messages: {
      fetch: async (_id) => message,
    },
    send: async (_content) => ({ id: 'sent-msg-test-1' }),
    _fakeMessage: message,   // expose so tests can pre-configure reactions
    ...overrides,
  };
}

// ─── Adapter stub factories ───────────────────────────────────────────────────

/**
 * Build a test DiscordAdapter with no-op defaults.
 * Overrides are merged shallowly — pass a function to replace any method.
 *
 * @param {Partial<DiscordAdapter>} overrides
 * @returns {DiscordAdapter & { _fakeGuild, _fakeChannel, _fakeMessage }}
 */
function makeTestDiscordAdapter(overrides = {}) {
  const guild   = makeFakeGuild();
  const channel = makeFakeChannel(guild);

  const defaults = {
    async fetchChannel(_channelId)              { return channel; },
    async fetchMessage(_channel, _messageId)    { return channel._fakeMessage; },
    async fetchUser(_userId)                    { return { send: async () => {} }; },
    async fetchReactionUsers(_reaction)         { return new Map(); },
    async sendMessage(_channel, _content)       { return { id: 'sent-msg-test-1' }; },
    async sendDM(_userId, _payload)             {},
    async fetchGuildRoles(_guild)               {},
    async fetchGuildMembers(_guild)             {},
    async postMeetingReminder(_m, _d, _t)       {},

    // Expose stubs for per-test configuration
    _fakeGuild:   guild,
    _fakeChannel: channel,
    _fakeMessage: channel._fakeMessage,
  };

  return { ...defaults, ...overrides };
}

/**
 * Build a test BookeoAdapter returning an empty schedule by default.
 *
 * @param {Partial<BookeoAdapter>} overrides
 * @returns {BookeoAdapter}
 */
function makeTestBookeoAdapter(overrides = {}) {
  return {
    async getSchedule(_from, _to) { return []; },
    ...overrides,
  };
}

module.exports = {
  makeTestDiscordAdapter,
  makeTestBookeoAdapter,
  // Exported for tests that need to build custom fake objects
  makeFakeGuild,
  makeFakeMessage,
  makeFakeChannel,
};
