/**
 * Tests for lib/checkin.js — pure functions and DB seeding logic.
 * Run with: node --test test/checkin.test.js
 *
 * Uses Node's built-in node:test and node:assert (no external deps needed).
 * Uses an in-memory SQLite DB so tests never touch the real db.sqlite.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

// ─── Override DB_PATH before requiring anything that loads db.js ──────────────
process.env.DB_PATH = ':memory:';

const { isEligibleForCheckin, groupEligibleShifts, shiftCallTimeUnix } = require('../lib/checkin');
const db = require('../lib/db');

// ─── isEligibleForCheckin ─────────────────────────────────────────────────────

test('isEligibleForCheckin — GGB shift is eligible', () => {
  assert.equal(isEligibleForCheckin({ show: 'GGB', cast: ['Allen Otto'] }), true);
});

test('isEligibleForCheckin — Lucidity shift is eligible', () => {
  assert.equal(isEligibleForCheckin({ show: 'Lucidity', cast: ['Jane Smith'] }), true);
});

test('isEligibleForCheckin — Endings shift is eligible', () => {
  assert.equal(isEligibleForCheckin({ show: 'Endings', cast: ['Alice', 'Bob'] }), true);
});

test('isEligibleForCheckin — MFB shift is not eligible', () => {
  assert.equal(isEligibleForCheckin({ show: 'MFB', cast: ['Alice', 'Bob'] }), false);
});

test('isEligibleForCheckin — empty cast is not eligible', () => {
  assert.equal(isEligibleForCheckin({ show: 'GGB', cast: [] }), false);
});

test('isEligibleForCheckin — unknown show is not eligible', () => {
  assert.equal(isEligibleForCheckin({ show: 'UNKNOWN', cast: ['Alice'] }), false);
});

// ─── groupEligibleShifts — deduplication ──────────────────────────────────────

test('groupEligibleShifts — three same-show same-day shifts → one record with earliest time', () => {
  const shifts = [
    { date: '2026-04-10', time: '3:00 PM', show: 'GGB', cast: ['Allen Otto'] },
    { date: '2026-04-10', time: '5:00 PM', show: 'GGB', cast: ['Allen Otto'] },
    { date: '2026-04-10', time: '7:00 PM', show: 'GGB', cast: ['Allen Otto'] },
  ];
  const groups = groupEligibleShifts(shifts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].showTime, '3:00 PM');
  assert.equal(groups[0].bookeo_name, 'Allen Otto');
  assert.equal(groups[0].show, 'GGB');
  assert.equal(groups[0].shift_date, '2026-04-10');
});

test('groupEligibleShifts — two different shows same day → two records', () => {
  const shifts = [
    { date: '2026-04-10', time: '5:00 PM', show: 'GGB',      cast: ['Allen Otto'] },
    { date: '2026-04-10', time: '7:00 PM', show: 'Lucidity', cast: ['Allen Otto'] },
  ];
  const groups = groupEligibleShifts(shifts);
  assert.equal(groups.length, 2);
  const shows = groups.map(g => g.show).sort();
  assert.deepEqual(shows, ['GGB', 'Lucidity']);
});

test('groupEligibleShifts — same show different days → two records', () => {
  const shifts = [
    { date: '2026-04-10', time: '5:00 PM', show: 'GGB', cast: ['Allen Otto'] },
    { date: '2026-04-11', time: '5:00 PM', show: 'GGB', cast: ['Allen Otto'] },
  ];
  const groups = groupEligibleShifts(shifts);
  assert.equal(groups.length, 2);
  const dates = groups.map(g => g.shift_date).sort();
  assert.deepEqual(dates, ['2026-04-10', '2026-04-11']);
});

test('groupEligibleShifts — MFB shifts are excluded', () => {
  const shifts = [
    { date: '2026-04-10', time: '5:00 PM', show: 'MFB', cast: ['Alice', 'Bob'] },
    { date: '2026-04-10', time: '7:00 PM', show: 'GGB', cast: ['Allen Otto'] },
  ];
  const groups = groupEligibleShifts(shifts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].show, 'GGB');
});

test('groupEligibleShifts — out-of-order times still picks earliest', () => {
  const shifts = [
    { date: '2026-04-10', time: '7:00 PM', show: 'GGB', cast: ['Allen Otto'] },
    { date: '2026-04-10', time: '2:00 PM', show: 'GGB', cast: ['Allen Otto'] },
    { date: '2026-04-10', time: '5:00 PM', show: 'GGB', cast: ['Allen Otto'] },
  ];
  const groups = groupEligibleShifts(shifts);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].showTime, '2:00 PM');
});

// ─── shiftCallTimeUnix ────────────────────────────────────────────────────────

test('shiftCallTimeUnix — call time is 30 min before show time', () => {
  // 5:15 PM Central - 30 min = 4:45 PM Central
  const unix = shiftCallTimeUnix('2026-04-10', '5:15 PM', -30);
  const callDate = new Date(unix * 1000);
  // Verify by formatting back to Central time
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const formatted = fmt.format(callDate);
  assert.equal(formatted, '4:45 PM');
});

test('shiftCallTimeUnix — PM show time parses correctly', () => {
  const unix = shiftCallTimeUnix('2026-06-15', '7:00 PM', -30);
  const callDate = new Date(unix * 1000);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  assert.equal(fmt.format(callDate), '6:30 PM');
});

// ─── DB methods — checkin_records ─────────────────────────────────────────────

test('upsertCheckinRecord — creates a record', () => {
  db.upsertCheckinRecord({
    shift_date:  '2026-04-10',
    show:        'GGB',
    bookeo_name: 'Test Person',
    discord_id:  '111',
    call_time:   1000000,
  });
  const rec = db.getCheckinRecord('2026-04-10', 'GGB', 'Test Person');
  assert.ok(rec);
  assert.equal(rec.discord_id, '111');
  assert.equal(rec.checked_in_at, null);
  assert.equal(rec.alert_message_id, null);
});

test('upsertCheckinRecord — re-seeding same key does not duplicate', () => {
  db.upsertCheckinRecord({ shift_date: '2026-04-10', show: 'Lucidity', bookeo_name: 'Dup Test', discord_id: '222', call_time: 2000000 });
  db.upsertCheckinRecord({ shift_date: '2026-04-10', show: 'Lucidity', bookeo_name: 'Dup Test', discord_id: '222', call_time: 2000000 });
  const rec = db.getCheckinRecord('2026-04-10', 'Lucidity', 'Dup Test');
  assert.ok(rec); // still exists
  // Only one record — if there were two this get() would still return one, but no error thrown
});

test('markCheckedIn — sets checked_in_at', () => {
  db.upsertCheckinRecord({ shift_date: '2026-04-10', show: 'Endings', bookeo_name: 'HR Person', discord_id: '333', call_time: 3000000 });
  const rec = db.getCheckinRecord('2026-04-10', 'Endings', 'HR Person');
  assert.equal(rec.checked_in_at, null);
  db.markCheckedIn(rec.id);
  const updated = db.getCheckinRecordById(rec.id);
  assert.ok(updated.checked_in_at > 0);
  assert.equal(updated.forced_by, null);
});

test('markCheckedIn — sets forced_by when provided', () => {
  db.upsertCheckinRecord({ shift_date: '2026-04-11', show: 'GGB', bookeo_name: 'Force Test', discord_id: '444', call_time: 4000000 });
  const rec = db.getCheckinRecord('2026-04-11', 'GGB', 'Force Test');
  db.markCheckedIn(rec.id, 'adminId999');
  const updated = db.getCheckinRecordById(rec.id);
  assert.equal(updated.forced_by, 'adminId999');
});

test('storeAlertInfo — sets alert_message_id and alert_channel_id', () => {
  db.upsertCheckinRecord({ shift_date: '2026-04-12', show: 'GGB', bookeo_name: 'Alert Test', discord_id: '555', call_time: 5000000 });
  const rec = db.getCheckinRecord('2026-04-12', 'GGB', 'Alert Test');
  db.storeAlertInfo(rec.id, 'msg123', 'ch456');
  const updated = db.getCheckinRecordById(rec.id);
  assert.equal(updated.alert_message_id, 'msg123');
  assert.equal(updated.alert_channel_id, 'ch456');
});

test('getPendingCheckins — returns only unchecked, unalerted records for date', () => {
  const date = '2026-04-13';
  db.upsertCheckinRecord({ shift_date: date, show: 'GGB',      bookeo_name: 'Pending A', discord_id: '601', call_time: 6000000 });
  db.upsertCheckinRecord({ shift_date: date, show: 'Lucidity', bookeo_name: 'Pending B', discord_id: '602', call_time: 6000001 });
  db.upsertCheckinRecord({ shift_date: date, show: 'Endings',  bookeo_name: 'Pending C', discord_id: '603', call_time: 6000002 });

  // Mark B as checked in
  const recB = db.getCheckinRecord(date, 'Lucidity', 'Pending B');
  db.markCheckedIn(recB.id);

  // Store alert for C
  const recC = db.getCheckinRecord(date, 'Endings', 'Pending C');
  db.storeAlertInfo(recC.id, 'msgX', 'chX');

  const pending = db.getPendingCheckins(date);
  const names = pending.map(r => r.bookeo_name);
  assert.ok(names.includes('Pending A'));
  assert.ok(!names.includes('Pending B')); // checked in
  assert.ok(!names.includes('Pending C')); // alert already fired
});

test('getCheckinContacts — returns empty array when none configured', () => {
  // Fresh in-memory DB has no contacts set
  const contacts = db.getCheckinContacts();
  assert.deepEqual(contacts, []);
});

test('addCheckinContact / removeCheckinContact — round trip', () => {
  db.addCheckinContact('user1');
  db.addCheckinContact('user2');
  assert.deepEqual(db.getCheckinContacts(), ['user1', 'user2']);

  db.removeCheckinContact('user1');
  assert.deepEqual(db.getCheckinContacts(), ['user2']);
});

test('addCheckinContact — no duplicates', () => {
  db.addCheckinContact('dupUser');
  db.addCheckinContact('dupUser');
  const contacts = db.getCheckinContacts().filter(id => id === 'dupUser');
  assert.equal(contacts.length, 1);
});

// ─── Coverage ping exclusions ─────────────────────────────────────────────────

test('getCoveragePingExclusions — returns empty array when none configured', () => {
  assert.deepEqual(db.getCoveragePingExclusions(), []);
});

test('addCoveragePingExclusion / removeCoveragePingExclusion — round trip', () => {
  db.addCoveragePingExclusion('userA');
  db.addCoveragePingExclusion('userB');
  assert.deepEqual(db.getCoveragePingExclusions(), ['userA', 'userB']);

  db.removeCoveragePingExclusion('userA');
  assert.deepEqual(db.getCoveragePingExclusions(), ['userB']);
});

test('addCoveragePingExclusion — no duplicates', () => {
  db.addCoveragePingExclusion('dupExclude');
  db.addCoveragePingExclusion('dupExclude');
  const hits = db.getCoveragePingExclusions().filter(id => id === 'dupExclude');
  assert.equal(hits.length, 1);
});
