/**
 * Tests for lib/meeting-rsvp.js (pure resolver) and the meeting_rsvps DB layer.
 * Run with: node --test test/meeting-rsvp.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const db = require('../lib/db');
const { resolveReaction, statusForEmoji, STATUS_EMOJI } = require('../lib/meeting-rsvp');

// ─── resolveReaction — pure conflict / cleanup logic ──────────────────────────

test('resolveReaction — first add records status, no cleanup', () => {
  const r = resolveReaction(null, { post: '7d', status: 'yes', action: 'add' });
  assert.equal(r.newStatus, 'yes');
  assert.deepEqual(r.persist, { type: 'set', status: 'yes', post: '7d' });
  assert.deepEqual(r.cleanup, []);
});

test('resolveReaction — changing answer on the OTHER post cleans up the old reaction', () => {
  const r = resolveReaction({ status: 'yes', post: '7d' }, { post: '24h', status: 'no', action: 'add' });
  assert.equal(r.newStatus, 'no');
  assert.deepEqual(r.persist, { type: 'set', status: 'no', post: '24h' });
  assert.deepEqual(r.cleanup, [{ post: '7d', status: 'yes' }]);
});

test('resolveReaction — changing answer on the SAME post cleans up the old emoji there', () => {
  const r = resolveReaction({ status: 'yes', post: '7d' }, { post: '7d', status: 'maybe', action: 'add' });
  assert.equal(r.newStatus, 'maybe');
  assert.deepEqual(r.persist, { type: 'set', status: 'maybe', post: '7d' });
  assert.deepEqual(r.cleanup, [{ post: '7d', status: 'yes' }]);
});

test('resolveReaction — moving the same answer to the other post cleans up the original', () => {
  const r = resolveReaction({ status: 'yes', post: '7d' }, { post: '24h', status: 'yes', action: 'add' });
  assert.equal(r.newStatus, 'yes');
  assert.deepEqual(r.persist, { type: 'set', status: 'yes', post: '24h' });
  assert.deepEqual(r.cleanup, [{ post: '7d', status: 'yes' }]);
});

test('resolveReaction — identical re-add is a no-op', () => {
  const r = resolveReaction({ status: 'yes', post: '7d' }, { post: '7d', status: 'yes', action: 'add' });
  assert.equal(r.newStatus, 'yes');
  assert.deepEqual(r.persist, { type: 'none' });
  assert.deepEqual(r.cleanup, []);
});

test('resolveReaction — removing the current reaction clears the RSVP', () => {
  const r = resolveReaction({ status: 'no', post: '24h' }, { post: '24h', status: 'no', action: 'remove' });
  assert.equal(r.newStatus, null);
  assert.deepEqual(r.persist, { type: 'delete' });
  assert.deepEqual(r.cleanup, []);
});

test('resolveReaction — removing a stale/non-current reaction is a no-op (bot cleanup echo)', () => {
  // Bot removed the old ✅ on the 7d post → that fires a remove event back at us.
  const r = resolveReaction({ status: 'no', post: '24h' }, { post: '7d', status: 'yes', action: 'remove' });
  assert.equal(r.newStatus, 'no');
  assert.deepEqual(r.persist, { type: 'none' });
  assert.deepEqual(r.cleanup, []);
});

test('resolveReaction — remove with no prior is a no-op', () => {
  const r = resolveReaction(null, { post: '7d', status: 'yes', action: 'remove' });
  assert.equal(r.newStatus, null);
  assert.deepEqual(r.persist, { type: 'none' });
  assert.deepEqual(r.cleanup, []);
});

test('statusForEmoji — maps RSVP emojis, rejects others; STATUS_EMOJI is the inverse', () => {
  assert.equal(statusForEmoji('✅'), 'yes');
  assert.equal(statusForEmoji('❌'), 'no');
  assert.equal(statusForEmoji('❓'), 'maybe');
  assert.equal(statusForEmoji('🎉'), null);
  assert.equal(STATUS_EMOJI.yes, '✅');
  assert.equal(STATUS_EMOJI.no, '❌');
  assert.equal(STATUS_EMOJI.maybe, '❓');
});

// ─── meeting_rsvps — DB round-trip ────────────────────────────────────────────

function makeMeeting() {
  return db.createMeeting({
    title: 'Monthly Standup', time: '19:00', duration: 60, date: null,
    recurrence_type: 'monthly_weekday', recurrence_day: 'tuesday', recurrence_week: 'first',
    channel_id: 'C1', target_type: 'here', reminder_7d: 1, reminder_24h: 1,
  });
}

test('meeting_rsvps — set/get round-trip', () => {
  const id = makeMeeting();
  db.setMeetingRsvp(id, '2026-05-05', 'U1', 'yes', '7d', 1000);
  const row = db.getMeetingRsvp(id, '2026-05-05', 'U1');
  assert.equal(row.status, 'yes');
  assert.equal(row.post, '7d');
  assert.equal(row.updated_at, 1000);
});

test('meeting_rsvps — set upserts on conflict (same user + occurrence)', () => {
  const id = makeMeeting();
  db.setMeetingRsvp(id, '2026-05-05', 'U1', 'yes', '7d', 1000);
  db.setMeetingRsvp(id, '2026-05-05', 'U1', 'no', '24h', 2000);
  const rows = db.getMeetingRsvps(id, '2026-05-05');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'no');
  assert.equal(rows[0].post, '24h');
  assert.equal(rows[0].updated_at, 2000);
});

test('meeting_rsvps — remove deletes the row', () => {
  const id = makeMeeting();
  db.setMeetingRsvp(id, '2026-05-05', 'U1', 'maybe', '7d', 1000);
  db.removeMeetingRsvp(id, '2026-05-05', 'U1');
  assert.equal(db.getMeetingRsvp(id, '2026-05-05', 'U1'), null);
});

test('meeting_rsvps — getMeetingRsvps returns all users for one occurrence only', () => {
  const id = makeMeeting();
  db.setMeetingRsvp(id, '2026-05-05', 'U1', 'yes',   '7d',  1000);
  db.setMeetingRsvp(id, '2026-05-05', 'U2', 'maybe', '24h', 1001);
  db.setMeetingRsvp(id, '2026-06-02', 'U1', 'no',    '7d',  1002); // different occurrence
  const rows = db.getMeetingRsvps(id, '2026-05-05');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.user_id).sort(), ['U1', 'U2']);
});

test('meeting_rsvps — unknown lookup returns null / empty', () => {
  const id = makeMeeting();
  assert.equal(db.getMeetingRsvp(id, '2026-05-05', 'nobody'), null);
  assert.deepEqual(db.getMeetingRsvps(id, '2099-01-01'), []);
});

test('getMeetingPostIds — returns 7d/24h message ids, null when a post is missing', () => {
  const id = makeMeeting();
  db.markReminderSent(id, '2026-05-05', '7d',  'MSG7');
  db.markReminderSent(id, '2026-05-05', '24h', 'MSG24');
  assert.deepEqual(db.getMeetingPostIds(id, '2026-05-05'), { '7d': 'MSG7', '24h': 'MSG24' });

  const id2 = makeMeeting();
  db.markReminderSent(id2, '2026-05-05', '7d', 'ONLY7');
  assert.deepEqual(db.getMeetingPostIds(id2, '2026-05-05'), { '7d': 'ONLY7', '24h': null });
});
