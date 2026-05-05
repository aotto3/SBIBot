/**
 * Tests for lib/scheduler.js — pure plan functions.
 * Run with: node --test test/scheduler.test.js
 *
 * Uses Node's built-in node:test and node:assert (no external deps needed).
 * All tests are synchronous — no mocks, no Discord/Bookeo calls.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { planMeetingReminders, planShiftDMs, planCustomGameReminders, planNonResponderMentions } = require('../lib/scheduler');

// ─── planMeetingReminders ─────────────────────────────────────────────────────

// Helpers for building minimal meeting rows
function weeklyMeeting(day, opts = {}) {
  return {
    id: 1, recurrence_type: 'weekly', recurrence_day: day,
    reminder_7d: 1, reminder_24h: 1, ...opts,
  };
}
function monthlyMeeting(day, week, opts = {}) {
  return {
    id: 2, recurrence_type: 'monthly_weekday',
    recurrence_day: day, recurrence_week: week,
    reminder_7d: 1, reminder_24h: 1, ...opts,
  };
}
function oneTimeMeeting(dateStr, opts = {}) {
  return {
    id: 3, recurrence_type: null, date: dateStr,
    reminder_7d: 1, reminder_24h: 1, ...opts,
  };
}

test('planMeetingReminders — weekly Tuesday: today is Monday April 13 → fires 7d on April 20', () => {
  // today = Mon Apr 13 2026 → in7 = Mon Apr 20 → next Tuesday is Apr 21 ≠ Apr 20 → no 7d
  // Actually let's pick today = Monday April 12 so in7 = April 19 (Sunday) — nope
  // To get 7d to fire: today must be such that today+7 falls on the meeting day
  // Tuesday is day index 2. today+7 must also be Tuesday.
  // today = Tue April 11 → in7 = Tue April 18 → nextOccurrence(meeting, April 18) = April 18 → match!
  const today   = new Date(2026, 3, 11); // Sat April 11, 2026 — actually let's verify: April 11 is a Saturday
  // April 1 = Wednesday. April 6 = Monday. April 11 = Saturday. So today+7 = April 18 = Saturday, not Tuesday.
  // Need today to be a Tuesday too. April 7 = Tuesday. in7 = April 14 = Tuesday.
  const tuesday = new Date(2026, 3, 7); // Tue April 7 2026
  const meeting = weeklyMeeting('tuesday');
  const result  = planMeetingReminders([meeting], tuesday);
  const item7d  = result.find(r => r.window === '7d');
  assert.ok(item7d, '7d reminder should fire');
  assert.equal(item7d.dateStr, '2026-04-14');
});

test('planMeetingReminders — weekly Tuesday: today is Wednesday → 7d misses', () => {
  const wednesday = new Date(2026, 3, 8); // Wed April 8
  const meeting   = weeklyMeeting('tuesday');
  const result    = planMeetingReminders([meeting], wednesday);
  assert.equal(result.filter(r => r.window === '7d').length, 0);
});

test('planMeetingReminders — 24h window fires when today+1 matches meeting day', () => {
  const monday  = new Date(2026, 3, 6); // Mon April 6 → tomorrow = Tue April 7
  const meeting = weeklyMeeting('tuesday');
  const result  = planMeetingReminders([meeting], monday);
  const item24h = result.find(r => r.window === '24h');
  assert.ok(item24h, '24h reminder should fire');
  assert.equal(item24h.dateStr, '2026-04-07');
});

test('planMeetingReminders — reminder_7d=0 suppresses 7d even when in window', () => {
  const tuesday = new Date(2026, 3, 7);
  const meeting = weeklyMeeting('tuesday', { reminder_7d: 0 });
  const result  = planMeetingReminders([meeting], tuesday);
  assert.equal(result.filter(r => r.window === '7d').length, 0);
});

test('planMeetingReminders — reminder_24h=0 suppresses 24h', () => {
  const monday  = new Date(2026, 3, 6);
  const meeting = weeklyMeeting('tuesday', { reminder_24h: 0 });
  const result  = planMeetingReminders([meeting], monday);
  assert.equal(result.filter(r => r.window === '24h').length, 0);
});

test('planMeetingReminders — one-time meeting in 7d window', () => {
  const today   = new Date(2026, 3, 7); // April 7 → in7 = April 14
  const meeting = oneTimeMeeting('2026-04-14');
  const result  = planMeetingReminders([meeting], today);
  assert.equal(result.length, 1);
  assert.equal(result[0].window, '7d');
  assert.equal(result[0].dateStr, '2026-04-14');
});

test('planMeetingReminders — one-time meeting in 24h window', () => {
  const today   = new Date(2026, 3, 13); // April 13 → tomorrow = April 14
  const meeting = oneTimeMeeting('2026-04-14');
  const result  = planMeetingReminders([meeting], today);
  assert.equal(result.length, 1);
  assert.equal(result[0].window, '24h');
});

test('planMeetingReminders — one-time meeting in both windows returns two entries', () => {
  // today+1 and today+7 both match (impossible for one-time, but multiple entries possible)
  // Use two separate meetings to verify multiple results
  const today = new Date(2026, 3, 7);
  const m1    = oneTimeMeeting('2026-04-14'); // in 7d
  const m2    = oneTimeMeeting('2026-04-08'); // tomorrow
  const result = planMeetingReminders([m1, m2], today);
  assert.equal(result.length, 2);
});

test('planMeetingReminders — monthly_weekday: first Tuesday of month', () => {
  // First Tuesday of May 2026 = May 5.
  // For 7d window to fire, today must be April 28 (April 28 + 7 = May 5).
  const today   = new Date(2026, 3, 28); // Tue April 28
  const meeting = monthlyMeeting('tuesday', 'first');
  const result  = planMeetingReminders([meeting], today);
  const item7d  = result.find(r => r.window === '7d');
  assert.ok(item7d, '7d reminder should fire for first Tuesday of May');
  assert.equal(item7d.dateStr, '2026-05-05');
});

test('planMeetingReminders — monthly_weekday: last weekday of month, month boundary', () => {
  // Last Tuesday of April 2026 = April 28.
  // For 24h window: today = April 27, tomorrow = April 28.
  const today   = new Date(2026, 3, 27); // Mon April 27
  const meeting = monthlyMeeting('tuesday', 'last');
  const result  = planMeetingReminders([meeting], today);
  const item24h = result.find(r => r.window === '24h');
  assert.ok(item24h, '24h reminder should fire for last Tuesday of April');
  assert.equal(item24h.dateStr, '2026-04-28');
});

test('planMeetingReminders — empty meetings list returns empty array', () => {
  assert.deepEqual(planMeetingReminders([], new Date(2026, 3, 7)), []);
});

// ─── planShiftDMs ─────────────────────────────────────────────────────────────

const SAMPLE_SHIFTS = [
  { date: '2026-04-14', time: '7:00 PM', show: 'GGB',  cast: ['Alice Smith'],       guest_count: 10 },
  { date: '2026-04-14', time: '9:00 PM', show: 'GGB',  cast: ['Alice Smith'],       guest_count: 8  },
  { date: '2026-04-15', time: '7:00 PM', show: 'MFB',  cast: ['Bob Jones', 'Carol Brown'], guest_count: 6 },
];

test('planShiftDMs — returns descriptor for each linked cast member', () => {
  const memberLinks = new Map([
    ['Alice Smith', { discordId: 'U001' }],
    ['Bob Jones',   { discordId: 'U002' }],
    ['Carol Brown', { discordId: 'U003' }],
  ]);
  const result = planShiftDMs(SAMPLE_SHIFTS, memberLinks, 'weekly');
  // Alice gets one entry (both GGB shifts grouped), Bob and Carol each get one
  assert.equal(result.length, 3);
  const alice = result.find(r => r.discord_id === 'U001');
  assert.ok(alice);
  assert.equal(alice.castName, 'Alice Smith');
  assert.ok(alice.dmText.includes('Alice'));
});

test('planShiftDMs — cast member without Discord link is skipped', () => {
  const memberLinks = new Map([
    ['Alice Smith', { discordId: 'U001' }],
    // Bob and Carol not linked
  ]);
  const result = planShiftDMs(SAMPLE_SHIFTS, memberLinks, 'weekly');
  assert.equal(result.length, 1);
  assert.equal(result[0].discord_id, 'U001');
});

test('planShiftDMs — empty shifts returns empty array', () => {
  const memberLinks = new Map([['Alice Smith', { discordId: 'U001' }]]);
  assert.deepEqual(planShiftDMs([], memberLinks, 'weekly'), []);
});

test('planShiftDMs — empty memberLinks returns empty array', () => {
  assert.deepEqual(planShiftDMs(SAMPLE_SHIFTS, new Map(), 'weekly'), []);
});

test('planShiftDMs — daily label appears in dmText', () => {
  const memberLinks = new Map([['Alice Smith', { discordId: 'U001' }]]);
  const [result]    = planShiftDMs(SAMPLE_SHIFTS, memberLinks, 'daily');
  assert.ok(result.dmText.includes('within 24 hours'), 'daily DM should say "within 24 hours"');
});

test('planShiftDMs — weekly label appears in dmText', () => {
  const memberLinks = new Map([['Alice Smith', { discordId: 'U001' }]]);
  const [result]    = planShiftDMs(SAMPLE_SHIFTS, memberLinks, 'weekly');
  assert.ok(result.dmText.includes('this week'), 'weekly DM should say "this week"');
});

// ─── planCustomGameReminders ──────────────────────────────────────────────────

const now = Math.floor(Date.now() / 1000);

const SAMPLE_GAMES = [
  { id: 1, show: 'GGB',  date: '2026-05-01', time: '7:00 PM', requester_id: 'U001', channel_id: 'C001', message_id: 'M001', created_at: now - 50 * 3600 },
  { id: 2, show: 'MFB',  date: '2026-05-02', time: null,       requester_id: 'U002', channel_id: 'C002', message_id: 'M002', created_at: now - 100 * 3600 },
];

test('planCustomGameReminders — returns descriptor for each game', () => {
  const result = planCustomGameReminders(SAMPLE_GAMES);
  assert.equal(result.length, 2);
});


test('planCustomGameReminders — dateTimeStr formats date+time', () => {
  const result       = planCustomGameReminders(SAMPLE_GAMES);
  const withTime     = result.find(r => r.game.id === 1);
  const withoutTime  = result.find(r => r.game.id === 2);
  assert.ok(withTime.dateTimeStr.includes(' at '), 'should include time when present');
  assert.ok(!withoutTime.dateTimeStr.includes(' at '), 'should omit time when null');
});

// ─── planNonResponderMentions ─────────────────────────────────────────────────

test('planNonResponderMentions — unreacted non-excluded members are returned', () => {
  const result = planNonResponderMentions(['U1', 'U2', 'U3'], [], []);
  assert.deepEqual(result, ['U1', 'U2', 'U3']);
});

test('planNonResponderMentions — all reacted returns empty array (role-ping fallback)', () => {
  const result = planNonResponderMentions(['U1', 'U2'], ['U1', 'U2'], []);
  assert.deepEqual(result, []);
});

test('planNonResponderMentions — partial responders: only silent members returned', () => {
  const result = planNonResponderMentions(['U1', 'U2', 'U3'], ['U2'], []);
  assert.deepEqual(result, ['U1', 'U3']);
});

test('planNonResponderMentions — excluded members are not mentioned even if silent', () => {
  const result = planNonResponderMentions(['U1', 'U2', 'U3'], [], ['U1']);
  assert.deepEqual(result, ['U2', 'U3']);
});

test('planNonResponderMentions — all excluded returns empty array (role-ping fallback)', () => {
  const result = planNonResponderMentions(['U1', 'U2'], [], ['U1', 'U2']);
  assert.deepEqual(result, []);
});

test('planNonResponderMentions — empty member list returns empty array', () => {
  assert.deepEqual(planNonResponderMentions([], ['U1'], ['U2']), []);
});

test('planCustomGameReminders — empty list returns empty array', () => {
  assert.deepEqual(planCustomGameReminders([]), []);
});
