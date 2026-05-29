'use strict';

/**
 * Boundary tests for lib/coverage-jobs.js.
 * Uses fake discord adapters and fake repo objects — no live Discord, no DB.
 *
 * Run with: node --test test/coverage-jobs.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { runCoverageRolePings, runEodCoverageReminder } = require('../lib/coverage-jobs');
const { makeTestDiscordAdapter, makeFakeGuild, makeFakeChannel, makeFakeMessage } = require('./helpers/adapters');

// ─── Fake repo factory ─────────────────────────────────────────────────────────

function makeRepo(overrides = {}) {
  return {
    getOpenShifts:             () => [],
    getOpenGames:              () => [],
    getUnconfirmedShifts:      () => [],
    getUnconfirmedGames:       () => [],
    markAllRespondedAlertSent: (_id) => {},
    ...overrides,
  };
}

// ─── runCoverageRolePings ──────────────────────────────────────────────────────

test('runCoverageRolePings — empty repo: sendMessage not called', async () => {
  const sent = [];
  const discord = makeTestDiscordAdapter({
    sendMessage: async (_ch, content) => sent.push(content),
  });

  await runCoverageRolePings(discord, makeRepo());
  assert.equal(sent.length, 0);
});

test('runCoverageRolePings — shift without message_id is skipped', async () => {
  const sent = [];
  const discord = makeTestDiscordAdapter({
    sendMessage: async (_ch, content) => sent.push(content),
  });
  const repo = makeRepo({
    getOpenShifts: () => [{
      id: 1, show: 'GGB', date: '2026-01-01', time: '19:00',
      shift_message_id: null,   // no message id — should be skipped
      channel_id: 'ch-1',
      character: null,
      requester_id: null, requester_name: null,
      all_responded_alert_sent: 0,
    }],
  });

  await runCoverageRolePings(discord, repo);
  assert.equal(sent.length, 0);
});

test('runCoverageRolePings — game without message_id is skipped', async () => {
  const sent = [];
  const discord = makeTestDiscordAdapter({
    sendMessage: async (_ch, content) => sent.push(content),
  });
  const repo = makeRepo({
    getOpenGames: () => [{
      id: 1, show: 'GGB', date: '2026-01-01', time: '19:00',
      message_id: null,  // no message id — should be skipped
      channel_id: 'ch-1',
    }],
  });

  await runCoverageRolePings(discord, repo);
  assert.equal(sent.length, 0);
});

test('runCoverageRolePings — fetchChannel error on shift is skipped gracefully', async () => {
  const sent = [];
  const discord = makeTestDiscordAdapter({
    fetchChannel: async () => { throw new Error('channel not found'); },
    sendMessage: async (_ch, content) => sent.push(content),
  });
  const repo = makeRepo({
    getOpenShifts: () => [{
      id: 1, show: 'GGB', date: '2026-01-01', time: '19:00',
      shift_message_id: 'msg-1', channel_id: 'ch-1',
      character: null, requester_id: null, requester_name: null,
      all_responded_alert_sent: 0,
    }],
  });

  await runCoverageRolePings(discord, repo);
  assert.equal(sent.length, 0, 'no message sent when channel fetch fails');
});

test('runCoverageRolePings — shift with already-set all_responded_alert_sent is not re-alerted', async () => {
  const markedIds = [];
  const guild = makeFakeGuild();
  const channel = makeFakeChannel(guild);

  const discord = makeTestDiscordAdapter({
    fetchChannel: async () => channel,
    fetchMessage: async () => channel._fakeMessage,
    fetchReactionUsers: async () => new Map(),
    fetchGuildRoles: async () => {},
    fetchGuildMembers: async () => {},
    sendDM: async () => {},
    sendMessage: async () => {},
  });

  const repo = makeRepo({
    getOpenShifts: () => [{
      id: 99, show: 'GGB', date: '2026-01-01', time: '19:00',
      shift_message_id: 'msg-99', channel_id: 'ch-1',
      character: null, requester_id: null, requester_name: null,
      all_responded_alert_sent: 1,  // already sent — should not re-alert
    }],
    markAllRespondedAlertSent: (id) => markedIds.push(id),
  });

  await runCoverageRolePings(discord, repo);

  assert.equal(markedIds.length, 0, 'should not re-send all-responded alert');
});

// ─── runEodCoverageReminder ────────────────────────────────────────────────────

test('runEodCoverageReminder — no manager configured: sendDM not called', async () => {
  const sent = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (id, _msg) => sent.push(id),
  });

  // bot_config table in :memory: has no coverage_manager entry
  await runEodCoverageReminder(discord, makeRepo());
  assert.equal(sent.length, 0);
});

test('runEodCoverageReminder — empty unconfirmed lists: sendDM not called', async () => {
  const db = require('../lib/db');
  db.db.prepare("INSERT INTO bot_config (key, value) VALUES ('coverage_manager', 'mgr-1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();

  const sent = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (id, _msg) => sent.push(id),
  });

  await runEodCoverageReminder(discord, makeRepo());
  assert.equal(sent.length, 0);

  db.db.prepare("DELETE FROM bot_config WHERE key = 'coverage_manager'").run();
});

test('runEodCoverageReminder — unconfirmed shift triggers DM to manager', async () => {
  const db = require('../lib/db');
  db.db.prepare("INSERT INTO bot_config (key, value) VALUES ('coverage_manager', 'mgr-1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();

  const dmsSent = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (id, msg) => dmsSent.push({ id, msg }),
  });

  const repo = makeRepo({
    getUnconfirmedShifts: () => [{
      id: 10, show: 'GGB', date: '2026-01-01', time: '19:00',
      character: null, channel_id: 'ch-1', shift_message_id: 'msg-1',
    }],
  });

  await runEodCoverageReminder(discord, repo);

  assert.equal(dmsSent.length, 1);
  assert.equal(dmsSent[0].id, 'mgr-1');

  db.db.prepare("DELETE FROM bot_config WHERE key = 'coverage_manager'").run();
});
