'use strict';

/**
 * Smoke tests for lib/adapters/discord.js and lib/adapters/bookeo.js.
 * Verifies the adapter factories produce objects with the expected interface.
 * No live Discord or Bookeo connection required.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { makeDiscordAdapter } = require('../lib/adapters/discord');
const { makeBookeoAdapter }  = require('../lib/adapters/bookeo');
const {
  makeTestDiscordAdapter,
  makeTestBookeoAdapter,
  makeFakeGuild,
  makeFakeMessage,
  makeFakeChannel,
} = require('./helpers/adapters');

// ─── Production adapter shapes ────────────────────────────────────────────────

const DISCORD_ADAPTER_METHODS = [
  'fetchChannel',
  'fetchMessage',
  'fetchUser',
  'fetchReactionUsers',
  'sendMessage',
  'sendDM',
  'fetchGuildRoles',
  'fetchGuildMembers',
  'postMeetingReminder',
];

const BOOKEO_ADAPTER_METHODS = [
  'getSchedule',
];

test('makeDiscordAdapter — returns an object with all required methods', () => {
  // Pass a minimal fake client — none of the methods are called in this test
  const fakeClient = {};
  const adapter = makeDiscordAdapter(fakeClient);

  for (const method of DISCORD_ADAPTER_METHODS) {
    assert.equal(typeof adapter[method], 'function',
      `makeDiscordAdapter should expose method "${method}"`);
  }
});

test('makeBookeoAdapter — returns an object with all required methods', () => {
  const adapter = makeBookeoAdapter();

  for (const method of BOOKEO_ADAPTER_METHODS) {
    assert.equal(typeof adapter[method], 'function',
      `makeBookeoAdapter should expose method "${method}"`);
  }
});

// ─── Test stub shapes ─────────────────────────────────────────────────────────

test('makeTestDiscordAdapter — returns an object with all required methods', () => {
  const adapter = makeTestDiscordAdapter();

  for (const method of DISCORD_ADAPTER_METHODS) {
    assert.equal(typeof adapter[method], 'function',
      `makeTestDiscordAdapter should expose method "${method}"`);
  }
});

test('makeTestDiscordAdapter — exposes _fakeGuild, _fakeChannel, _fakeMessage', () => {
  const adapter = makeTestDiscordAdapter();
  assert.ok(adapter._fakeGuild,   'should expose _fakeGuild');
  assert.ok(adapter._fakeChannel, 'should expose _fakeChannel');
  assert.ok(adapter._fakeMessage, 'should expose _fakeMessage');
});

test('makeTestBookeoAdapter — returns an object with all required methods', () => {
  const adapter = makeTestBookeoAdapter();

  for (const method of BOOKEO_ADAPTER_METHODS) {
    assert.equal(typeof adapter[method], 'function',
      `makeTestBookeoAdapter should expose method "${method}"`);
  }
});

test('makeTestDiscordAdapter — defaults return no-op / empty values', async () => {
  const adapter = makeTestDiscordAdapter();

  // fetchReactionUsers returns an empty Map by default
  const users = await adapter.fetchReactionUsers({});
  assert.ok(users instanceof Map);
  assert.equal(users.size, 0);

  // sendDM resolves without throwing
  await assert.doesNotReject(() => adapter.sendDM('user-1', 'hello'));

  // fetchGuildRoles and fetchGuildMembers resolve without throwing
  await assert.doesNotReject(() => adapter.fetchGuildRoles({}));
  await assert.doesNotReject(() => adapter.fetchGuildMembers({}));
});

test('makeTestBookeoAdapter — getSchedule returns empty array by default', async () => {
  const adapter = makeTestBookeoAdapter();
  const result  = await adapter.getSchedule('2026-05-01', '2026-05-07');
  assert.deepEqual(result, []);
});

test('makeTestDiscordAdapter — overrides replace individual methods', async () => {
  const sent = [];
  const adapter = makeTestDiscordAdapter({
    sendMessage: async (_ch, content) => { sent.push(content); },
  });

  await adapter.sendMessage({}, 'hello test');
  assert.deepEqual(sent, ['hello test']);

  // Un-overridden methods still work
  const users = await adapter.fetchReactionUsers({});
  assert.ok(users instanceof Map);
});

test('makeTestBookeoAdapter — overrides replace getSchedule', async () => {
  const fakeShifts = [{ date: '2026-05-07', show: 'GGB', cast: ['Alice'] }];
  const adapter = makeTestBookeoAdapter({
    getSchedule: async () => fakeShifts,
  });

  const result = await adapter.getSchedule('2026-05-07', '2026-05-07');
  assert.deepEqual(result, fakeShifts);
});

// ─── Fake object helpers ──────────────────────────────────────────────────────

test('makeFakeGuild — has expected shape', () => {
  const guild = makeFakeGuild();
  assert.ok(guild.id);
  assert.ok(guild.roles.cache instanceof Map);
  assert.equal(typeof guild.roles.fetch, 'function');
  assert.equal(typeof guild.members.fetch, 'function');
});

test('makeFakeMessage — has empty reactions cache', () => {
  const msg = makeFakeMessage();
  assert.ok(msg.reactions.cache instanceof Map);
  assert.equal(msg.reactions.cache.size, 0);
});

test('makeFakeChannel — guild reference matches provided guild', () => {
  const guild   = makeFakeGuild();
  const channel = makeFakeChannel(guild);
  assert.equal(channel.guild, guild);
});

test('makeFakeChannel — exposes _fakeMessage pre-configured with empty reactions', () => {
  const guild   = makeFakeGuild();
  const channel = makeFakeChannel(guild);
  assert.ok(channel._fakeMessage);
  assert.equal(channel._fakeMessage.reactions.cache.size, 0);
});
