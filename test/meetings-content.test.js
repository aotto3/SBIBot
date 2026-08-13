/**
 * Tests for lib/meetings.js content builders (pure) and the monthly-recurring
 * routing in postMeetingReminder (integration with a fake client + in-memory DB).
 * Run with: node --test test/meetings-content.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const db = require('../lib/db');
const {
  postMeetingReminder,
  buildMeetingReminderContent,
  buildFollowupReminderContent,
} = require('../lib/meetings');

// ─── Pure content builders ────────────────────────────────────────────────────

function monthlyMeeting(overrides = {}) {
  return { id: 1, title: 'Board Meeting', time: '19:00', duration: 60, target_type: 'here',
    recurrence_type: 'monthly_weekday', recurrence_day: 'tuesday', recurrence_week: 'first', ...overrides };
}
function oneTimeMeeting(overrides = {}) {
  return { id: 2, title: 'Kickoff', time: '19:00', duration: 60, target_type: 'here',
    recurrence_type: null, date: '2026-05-05', ...overrides };
}

test('buildMeetingReminderContent — monthly 7d post includes RSVP', () => {
  const { content, includeRsvp } = buildMeetingReminderContent(monthlyMeeting(), '2026-05-05', '7d');
  assert.equal(includeRsvp, true);
  assert.ok(content.includes('React to RSVP'), '7d post prompts for RSVP');
  assert.ok(content.includes('7 days away'));
});

test('buildMeetingReminderContent — monthly schedule-time announcement has NO RSVP', () => {
  const { content, includeRsvp } = buildMeetingReminderContent(monthlyMeeting(), '2026-05-05', 'created');
  assert.equal(includeRsvp, false);
  assert.ok(!content.includes('React to RSVP'), 'created announcement is no-RSVP for recurring');
});

test('buildMeetingReminderContent — one-time created post keeps RSVP', () => {
  const { content, includeRsvp } = buildMeetingReminderContent(oneTimeMeeting(), '2026-05-05', 'created');
  assert.equal(includeRsvp, true);
  assert.ok(content.includes('React to RSVP'));
});

test('buildFollowupReminderContent — 24h lists attendees and links to the source post', () => {
  const content = buildFollowupReminderContent(
    monthlyMeeting(), '2026-05-05', '24h', ['<@U1>', '<@U2>'], 'https://discord.com/channels/G/C/M7');
  assert.ok(content.includes('is in 24 hours'));
  assert.ok(content.includes('Attending (so far): <@U1> <@U2>'));
  assert.ok(content.includes('https://discord.com/channels/G/C/M7'));
});

test('buildFollowupReminderContent — no source post falls back to "unavailable"', () => {
  const content = buildFollowupReminderContent(monthlyMeeting(), '2026-05-05', '24h', [], null);
  assert.ok(content.includes('(original post unavailable)'));
});

// ─── postMeetingReminder routing (fake client + in-memory DB) ─────────────────

/** A Map with the Discord.js Collection methods used by the meetings code. */
function coll(entries = []) {
  const m = new Map(entries);
  m.find   = (fn) => { for (const v of m.values()) if (fn(v)) return v; return undefined; };
  m.filter = (fn) => coll([...m.entries()].filter(([, v]) => fn(v)));
  return m;
}

function makeFakeClient() {
  const messagesById = new Map();
  const sent = [];
  let counter = 0;
  const channel = {
    guildId: 'G1',
    async send(content) {
      const id  = `msg${++counter}`;
      const rec = { id, content, reactions: [] };
      sent.push(rec);
      const msg = { id, content, reactions: { cache: coll() }, async react(e) { rec.reactions.push(e); } };
      messagesById.set(id, msg);
      return msg;
    },
    messages: { async fetch(id) { const m = messagesById.get(id); if (!m) throw new Error(`no message ${id}`); return m; } },
  };
  return { channels: { async fetch() { return channel; } }, _sent: sent, _messagesById: messagesById };
}

function insertMonthlyMeeting() {
  return db.createMeeting({
    title: 'Board Meeting', time: '19:00', duration: 60, date: null,
    recurrence_type: 'monthly_weekday', recurrence_day: 'tuesday', recurrence_week: 'first',
    channel_id: 'C1', target_type: 'here', reminder_7d: 1, reminder_24h: 1,
  });
}

test('postMeetingReminder — monthly 7d is posted as an RSVP post (reactions added, recorded)', async () => {
  const id = insertMonthlyMeeting();
  const meeting = db.getMeeting(id);
  const client = makeFakeClient();

  await postMeetingReminder(client, meeting, '2026-05-05', '7d');

  assert.equal(client._sent.length, 1);
  assert.ok(client._sent[0].content.includes('React to RSVP'), '7d carries the RSVP prompt');
  assert.deepEqual(client._sent[0].reactions, ['✅', '❌', '❓'], '7d gets the three RSVP reactions');
  const rec = db.getReminderRecord(id, '2026-05-05', '7d');
  assert.equal(rec.message_id, client._sent[0].id, '7d post recorded with its message id');
});

test('postMeetingReminder — monthly 24h links to the 7d post and lists its attendees', async () => {
  const id = insertMonthlyMeeting();
  const meeting = db.getMeeting(id);
  const client = makeFakeClient();

  // Post the 7d first, then add a ✅ reactor to it.
  await postMeetingReminder(client, meeting, '2026-05-05', '7d');
  const sevenDayId  = client._sent[0].id;
  const sevenDayMsg = client._messagesById.get(sevenDayId);
  sevenDayMsg.reactions.cache.set('✅', { emoji: { name: '✅' }, users: { fetch: async () => coll([['U1', { id: 'U1', bot: false }]]) } });

  await postMeetingReminder(client, meeting, '2026-05-05', '24h');

  const h24 = client._sent[1];
  assert.ok(h24.content.includes(`/${sevenDayId}`), '24h links to the 7d post');
  assert.ok(h24.content.includes('Attending (so far): <@U1>'), '24h lists the 7d post attendees');
  assert.ok(!h24.content.includes('React to RSVP'), '24h is a follow-up, not its own RSVP post');
  assert.deepEqual(h24.reactions, [], '24h gets no reactions in this slice');
});

test('postMeetingReminder — one-time 7d is unchanged (follow-up, no reactions)', async () => {
  const id = db.createMeeting({
    title: 'Kickoff', time: '19:00', duration: 60, date: '2026-05-05',
    recurrence_type: null, recurrence_day: null, recurrence_week: null,
    channel_id: 'C1', target_type: 'here', reminder_7d: 1, reminder_24h: 1,
  });
  const meeting = db.getMeeting(id);
  const client = makeFakeClient();

  await postMeetingReminder(client, meeting, '2026-05-05', '7d');

  assert.equal(client._sent.length, 1);
  assert.ok(!client._sent[0].content.includes('React to RSVP'), 'one-time 7d stays a follow-up');
  assert.ok(client._sent[0].content.includes('is in 7 days'));
  assert.deepEqual(client._sent[0].reactions, [], 'one-time 7d adds no reactions');
});
