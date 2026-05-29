'use strict';

/**
 * Boundary tests for the scheduler execute layer.
 * Tests run* functions using injected adapter stubs — no live Discord or Bookeo.
 *
 * Run with: node --test test/scheduler-execute.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const db      = require('../lib/db');
const utils   = require('../lib/utils');
const {
  runMeetingReminderCheck, runShiftDMs,
  runCustomGameReminders, runCoverageRolePings, runEodCoverageReminder,
} = require('../lib/scheduler');
const { makeTestDiscordAdapter, makeTestBookeoAdapter, makeFakeGuild, makeFakeChannel } = require('./helpers/adapters');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wipe all mutable rows so tests don't bleed state into each other. */
function cleanDb() {
  db.db.prepare('DELETE FROM meetings').run();
  db.db.prepare('DELETE FROM member_links').run();
  db.db.prepare('DELETE FROM checkin_records').run();
  db.db.prepare('DELETE FROM custom_games').run();
  db.db.prepare('DELETE FROM coverage_shifts').run();
  db.db.prepare('DELETE FROM coverage_requests').run();
  db.db.prepare('DELETE FROM bot_config').run();
}

/**
 * Insert a coverage request + single open shift with a Discord message ID set,
 * so it shows up in getOpenCoverageShiftsWithRequests().
 */
function insertCoverageShift(overrides = {}) {
  const requestId = db.createCoverageRequest({
    requester_id:   overrides.requesterId  ?? 'requester-test-1',
    requester_name: overrides.requesterName ?? 'Requester Test',
    show:           overrides.show         ?? 'GGB',
    character:      overrides.character    ?? null,
    channel_id:     overrides.channelId    ?? 'channel-test-1',
  });
  const shiftId = db.addCoverageShift({
    request_id: requestId,
    date:       overrides.date ?? utils.todayCentral(),
    time:       overrides.time ?? '19:00',
  });
  if (overrides.messageId) {
    db.setCoverageShiftMessageId(shiftId, overrides.messageId);
  }
  return { requestId, shiftId };
}

/**
 * Insert a custom game older than the 48h cutoff so it shows up in
 * getUnfilledCustomGames(). Returns the inserted row id.
 */
function insertOldCustomGame(overrides = {}) {
  const pastTimestamp = Math.floor(Date.now() / 1000) - (50 * 3600); // 50h ago
  const id = db.createCustomGame({
    channel_id:   overrides.channelId   ?? 'channel-test-1',
    show:         overrides.show        ?? 'GGB',
    date:         overrides.date        ?? utils.todayCentral(),
    time:         overrides.time        ?? '19:00',
    requester_id: overrides.requesterId ?? 'requester-test-1',
  });
  // Back-date created_at so it falls before the cutoff
  db.db.prepare('UPDATE custom_games SET created_at = ? WHERE id = ?').run(pastTimestamp, id);
  if (overrides.messageId) {
    db.setCustomGameMessageId(id, overrides.messageId);
  }
  return id;
}

/** Insert a one-time meeting due exactly `daysOut` days from today. */
function insertMeeting(daysOut, overrides = {}) {
  const todayStr = utils.todayCentral();
  const [y, mo, d] = todayStr.split('-').map(Number);
  const target = new Date(y, mo - 1, d + daysOut);
  const dateStr = utils.toDateString(target);

  return db.createMeeting({
    title:           overrides.title          ?? 'Test Meeting',
    time:            overrides.time           ?? '19:00',
    duration:        overrides.duration       ?? 60,
    date:            dateStr,
    recurrence_type: overrides.recurrenceType ?? null,
    recurrence_day:  null,
    recurrence_week: null,
    channel_id:      overrides.channelId      ?? 'channel-test-1',
    target_type:     overrides.targetType     ?? 'here',
    reminder_7d:     overrides.reminder7d     ?? 1,
    reminder_24h:    overrides.reminder24h    ?? 1,
  });
}

/** Insert a member link so planShiftDMs can match a Bookeo name to a Discord ID. */
function linkMember(bookeoName, discordId = 'user-test-1') {
  db.linkMember(discordId, bookeoName, bookeoName);
}

/** Build a minimal shift object as returned by Bookeo. */
function makeShift(overrides = {}) {
  const today = utils.todayCentral();
  return {
    date:  overrides.date  ?? today,
    time:  overrides.time  ?? '7:00 PM',
    show:  overrides.show  ?? 'GGB',
    cast:  overrides.cast  ?? ['Alice Otto'],
    title: overrides.title ?? 'Great Gold Bird',
  };
}

// ─── runMeetingReminderCheck ──────────────────────────────────────────────────

test('runMeetingReminderCheck — meeting due in 7 days calls postMeetingReminder', async () => {
  cleanDb();
  insertMeeting(7, { reminder7d: 1, reminder24h: 0 });

  const calls = [];
  const discord = makeTestDiscordAdapter({
    postMeetingReminder: async (meeting, dateStr, window) => {
      calls.push({ meeting, dateStr, window });
    },
  });

  await runMeetingReminderCheck(discord);

  assert.equal(calls.length, 1, 'should call postMeetingReminder exactly once');
  assert.equal(calls[0].window, '7d');
  assert.equal(calls[0].meeting.title, 'Test Meeting');
});

test('runMeetingReminderCheck — meeting due tomorrow calls postMeetingReminder with 24h', async () => {
  cleanDb();
  insertMeeting(1, { reminder7d: 0, reminder24h: 1 });

  const calls = [];
  const discord = makeTestDiscordAdapter({
    postMeetingReminder: async (meeting, dateStr, window) => {
      calls.push({ meeting, dateStr, window });
    },
  });

  await runMeetingReminderCheck(discord);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].window, '24h');
});

test('runMeetingReminderCheck — no meetings due: postMeetingReminder not called', async () => {
  cleanDb();
  // Insert a meeting due in 3 days — neither 7d nor 24h window
  insertMeeting(3, { reminder7d: 1, reminder24h: 1 });

  const calls = [];
  const discord = makeTestDiscordAdapter({
    postMeetingReminder: async (...args) => calls.push(args),
  });

  await runMeetingReminderCheck(discord);

  assert.equal(calls.length, 0);
});

test('runMeetingReminderCheck — no active meetings: postMeetingReminder not called', async () => {
  cleanDb();
  const calls = [];
  const discord = makeTestDiscordAdapter({
    postMeetingReminder: async (...args) => calls.push(args),
  });

  await runMeetingReminderCheck(discord);
  assert.equal(calls.length, 0);
});

// ─── runShiftDMs ──────────────────────────────────────────────────────────────

test('runShiftDMs (weekly) — linked cast member receives a DM', async () => {
  cleanDb();
  linkMember('Alice Otto', 'user-alice');
  const today = utils.todayCentral();

  const sentTo = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (userId, _payload) => { sentTo.push(userId); },
  });
  const bk = makeTestBookeoAdapter({
    getSchedule: async () => [makeShift({ cast: ['Alice Otto'], date: today })],
  });

  await runShiftDMs(discord, bk, 'weekly');

  assert.ok(sentTo.includes('user-alice'), 'should DM the linked cast member');
});

test('runShiftDMs — unlinked cast member is skipped', async () => {
  cleanDb();
  const today = utils.todayCentral();
  const sentTo = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (userId) => sentTo.push(userId),
  });
  const bk = makeTestBookeoAdapter({
    // "No Link" has no entry in member_links
    getSchedule: async () => [makeShift({ cast: ['No Link'], date: today })],
  });

  await runShiftDMs(discord, bk, 'weekly');
  assert.equal(sentTo.length, 0);
});

test('runShiftDMs — Bookeo fetch throws: returns early, no DM sent', async () => {
  cleanDb();
  linkMember('Alice Otto', 'user-alice');

  const sentTo = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (userId) => sentTo.push(userId),
  });
  const bk = makeTestBookeoAdapter({
    getSchedule: async () => { throw new Error('Bookeo down'); },
  });

  // Should not throw
  await assert.doesNotReject(() => runShiftDMs(discord, bk, 'weekly'));
  assert.equal(sentTo.length, 0);
});

test('runShiftDMs — no shifts in window: no DMs sent', async () => {
  cleanDb();
  linkMember('Alice Otto', 'user-alice');

  const sentTo = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (userId) => sentTo.push(userId),
  });
  const bk = makeTestBookeoAdapter({
    getSchedule: async () => [],
  });

  await runShiftDMs(discord, bk, 'weekly');
  assert.equal(sentTo.length, 0);
});

test('runShiftDMs — shifts outside window are filtered out', async () => {
  cleanDb();
  linkMember('Alice Otto', 'user-alice');
  const sentTo = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (userId) => sentTo.push(userId),
  });

  // Daily mode window: today only. Return a shift dated 10 days out.
  const todayStr = utils.todayCentral();
  const [y, mo, d] = todayStr.split('-').map(Number);
  const farDate = utils.toDateString(new Date(y, mo - 1, d + 10));

  const bk = makeTestBookeoAdapter({
    getSchedule: async () => [makeShift({ cast: ['Alice Otto'], date: farDate })],
  });

  await runShiftDMs(discord, bk, 'daily');
  assert.equal(sentTo.length, 0, 'shift outside the daily window should be filtered');
});

test('runShiftDMs (daily) — pending checkin record: DM payload has components', async () => {
  cleanDb();
  linkMember('Alice Otto', 'user-alice');
  const today = utils.todayCentral();

  // Seed a pending check-in record for Alice
  db.upsertCheckinRecord({
    shift_date:  today,
    show:        'GGB',
    bookeo_name: 'Alice Otto',
    discord_id:  'user-alice',
    call_time:   Math.floor(Date.now() / 1000) + 3600,
  });

  const payloads = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (_userId, payload) => payloads.push(payload),
  });
  const bk = makeTestBookeoAdapter({
    getSchedule: async () => [makeShift({ cast: ['Alice Otto'], date: today })],
  });

  await runShiftDMs(discord, bk, 'daily');

  assert.equal(payloads.length, 1, 'should send one DM');
  const payload = payloads[0];
  // In daily mode with a pending record, payload becomes { content, components }
  assert.ok(typeof payload === 'object' && payload !== null && !Array.isArray(payload),
    'payload should be an object (not a plain string) when checkin button is attached');
  assert.ok(payload.components, 'payload should have a components field');
  assert.ok(Array.isArray(payload.components) && payload.components.length > 0,
    'components should be a non-empty array');
});

test('runShiftDMs (daily) — no pending checkin record: DM payload is plain string', async () => {
  cleanDb();
  linkMember('Bob Smith', 'user-bob');
  const today = utils.todayCentral();
  // No checkin record inserted for Bob

  const payloads = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (_userId, payload) => payloads.push(payload),
  });
  const bk = makeTestBookeoAdapter({
    getSchedule: async () => [makeShift({ cast: ['Bob Smith'], date: today })],
  });

  await runShiftDMs(discord, bk, 'daily');

  assert.equal(payloads.length, 1);
  assert.equal(typeof payloads[0], 'string', 'payload should be a plain string when no checkin button needed');
});

test('runShiftDMs — sendDM failure is caught and does not abort remaining DMs', async () => {
  cleanDb();
  linkMember('Alice Otto', 'user-alice');
  linkMember('Bob Smith',  'user-bob');
  const today = utils.todayCentral();

  const succeeded = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (userId, _payload) => {
      if (userId === 'user-alice') throw new Error('Cannot send messages to this user');
      succeeded.push(userId);
    },
  });
  const bk = makeTestBookeoAdapter({
    getSchedule: async () => [
      makeShift({ cast: ['Alice Otto'], date: today }),
      makeShift({ cast: ['Bob Smith'],  date: today }),
    ],
  });

  await assert.doesNotReject(() => runShiftDMs(discord, bk, 'weekly'));
  assert.ok(succeeded.includes('user-bob'), 'Bob should still receive a DM even though Alice failed');
});

// ─── runCustomGameReminders ───────────────────────────────────────────────────

test('runCustomGameReminders — no unfilled games: sendMessage not called', async () => {
  cleanDb();

  const sent = [];
  const discord = makeTestDiscordAdapter({
    sendMessage: async (_ch, content) => sent.push(content),
  });

  await runCustomGameReminders(discord);
  assert.equal(sent.length, 0, 'no games → sendMessage should not be called');
});

test('runCustomGameReminders — game exists: sendMessage called once', async () => {
  cleanDb();
  insertOldCustomGame({ channelId: 'channel-test-1', show: 'GGB', requesterId: 'req-1' });

  const sent = [];
  const discord = makeTestDiscordAdapter({
    sendMessage: async (_ch, content) => sent.push(content),
  });

  await runCustomGameReminders(discord);

  assert.equal(sent.length, 1, 'one game → sendMessage should be called once');
  assert.ok(sent[0].includes('req-1'), 'message should mention the requester');
  assert.ok(sent[0].includes('Great Gold Bird'), 'message should include the show label');
});

test('runCustomGameReminders — fetchChannel throws: does not crash, skips game', async () => {
  cleanDb();
  insertOldCustomGame();

  const discord = makeTestDiscordAdapter({
    fetchChannel: async () => { throw new Error('Channel not found'); },
  });

  await assert.doesNotReject(() => runCustomGameReminders(discord));
});

test('runCustomGameReminders — failure for one game does not abort the next', async () => {
  cleanDb();
  insertOldCustomGame({ channelId: 'ch-bad',  show: 'GGB', requesterId: 'req-bad' });
  insertOldCustomGame({ channelId: 'ch-good', show: 'GGB', requesterId: 'req-good' });

  const sent = [];
  const badChannel = { guild: { id: 'guild-1', roles: { cache: new Map() }, members: { cache: new Map() } } };
  const goodChannel = {
    guild: { id: 'guild-1', roles: { cache: new Map() }, members: { cache: new Map() } },
    send: async () => {},
  };

  const discord = makeTestDiscordAdapter({
    fetchChannel: async (channelId) => {
      if (channelId === 'ch-bad') throw new Error('bad channel');
      return goodChannel;
    },
    sendMessage: async (_ch, content) => sent.push(content),
  });

  await assert.doesNotReject(() => runCustomGameReminders(discord));
  assert.equal(sent.length, 1, 'should send to the good game despite the bad one failing');
  assert.ok(sent[0].includes('req-good'));
});

// ─── runCoverageRolePings ─────────────────────────────────────────────────────

test('runCoverageRolePings — no open shifts or games: sendMessage not called', async () => {
  cleanDb();

  const sent = [];
  const discord = makeTestDiscordAdapter({
    sendMessage: async (_ch, content) => sent.push(content),
  });

  await runCoverageRolePings(discord);
  assert.equal(sent.length, 0, 'no open items → sendMessage should not be called');
});

test('runCoverageRolePings — coverage requester not mentioned even when silent', async () => {
  cleanDb();

  const REQUESTER_ID = 'user-requester-1';
  const OTHER_ID     = 'user-other-1';
  const MSG_ID       = 'msg-shift-test-1';

  insertCoverageShift({ requesterId: REQUESTER_ID, show: 'GGB', messageId: MSG_ID });

  // Guild with a "Mikey" role containing both the requester and another cast member
  const guild = makeFakeGuild();
  guild.roles.cache.set('role-mikey-1', {
    id: 'role-mikey-1',
    name: 'Mikey',
    members: new Map([
      [REQUESTER_ID, {}],
      [OTHER_ID,     {}],
    ]),
  });

  const channel = makeFakeChannel(guild, { id: 'channel-test-1' });
  // No reactions on the message — both users are silent

  const sent = [];
  const discord = makeTestDiscordAdapter({
    fetchChannel:  async () => channel,
    fetchMessage:  async () => channel._fakeMessage,
    fetchGuildRoles:   async () => {},
    fetchGuildMembers: async () => {},
    sendMessage: async (_ch, content) => sent.push(content),
    _fakeGuild:   guild,
    _fakeChannel: channel,
    _fakeMessage: channel._fakeMessage,
  });

  await runCoverageRolePings(discord);

  assert.equal(sent.length, 1, 'one ping message should be sent');
  assert.ok(!sent[0].includes(`<@${REQUESTER_ID}>`), 'requester must not be pinged');
  assert.ok(sent[0].includes(`<@${OTHER_ID}>`),     'other cast member must be pinged');
});

test('runCoverageRolePings — requester is only silent member: falls back to role ping', async () => {
  // When the requester is the only member who hasn't responded, excluding them leaves
  // nonResponders empty → the bot should fall back to a @role mention rather than pinging nobody.
  cleanDb();

  const REQUESTER_ID = 'user-requester-2';
  const ROLE_ID      = 'role-mikey-2';
  const MSG_ID       = 'msg-shift-test-2';

  insertCoverageShift({ requesterId: REQUESTER_ID, show: 'GGB', messageId: MSG_ID });

  const guild = makeFakeGuild();
  guild.roles.cache.set(ROLE_ID, {
    id: ROLE_ID,
    name: 'Mikey',
    members: new Map([[REQUESTER_ID, {}]]),  // only member is the requester
  });

  const channel = makeFakeChannel(guild, { id: 'channel-test-1' });
  // No reactions — requester is silent but should be excluded

  const sent = [];
  const discord = makeTestDiscordAdapter({
    fetchChannel:      async () => channel,
    fetchMessage:      async () => channel._fakeMessage,
    fetchGuildRoles:   async () => {},
    fetchGuildMembers: async () => {},
    sendMessage: async (_ch, content) => sent.push(content),
    _fakeGuild:   guild,
    _fakeChannel: channel,
    _fakeMessage: channel._fakeMessage,
  });

  await runCoverageRolePings(discord);

  assert.equal(sent.length, 1, 'one ping message should be sent');
  assert.ok(!sent[0].includes(`<@${REQUESTER_ID}>`), 'requester must not be individually mentioned');
  assert.ok(sent[0].includes(`<@&${ROLE_ID}>`),      'role fallback ping must be used when no non-requesters remain');
});

// ─── runEodCoverageReminder ───────────────────────────────────────────────────

test('runEodCoverageReminder — no manager configured: sendDM not called', async () => {
  cleanDb();
  // Ensure coverage_manager is not set (cleanDb cleared bot_config)

  const dmsSent = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (userId) => dmsSent.push(userId),
  });

  await runEodCoverageReminder(discord);
  assert.equal(dmsSent.length, 0, 'no manager → sendDM should not be called');
});

test('runEodCoverageReminder — manager set but no unconfirmed items: sendDM not called', async () => {
  cleanDb();
  db.setConfig('coverage_manager', 'manager-test-1');

  const dmsSent = [];
  const discord = makeTestDiscordAdapter({
    sendDM: async (userId) => dmsSent.push(userId),
  });

  await runEodCoverageReminder(discord);
  assert.equal(dmsSent.length, 0, 'no unconfirmed items → sendDM should not be called');
});
