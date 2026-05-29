/**
 * Integration tests for lib/coverage-repository.js.
 * Run with: node --test test/coverage-repository.test.js
 *
 * Uses a real in-process SQLite DB (DB_PATH=:memory:) — no Discord or Bookeo calls.
 * Tests verify round-trips for the named repository functions and atomicity of
 * markRequestCancelled.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const repo = require('../lib/coverage-repository');
const db   = require('../lib/db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedRequest(overrides = {}) {
  const id = repo.createRequest({
    requester_id:   'U100',
    requester_name: 'Alice',
    show:           'GGB',
    character:      null,
    channel_id:     'C1',
    ...overrides,
  });
  return id;
}

function seedShift(requestId, overrides = {}) {
  const id = repo.addShift({ request_id: requestId, date: '2026-06-01', time: '19:00', ...overrides });
  return id;
}

function seedGame(overrides = {}) {
  const id = repo.createGame({
    channel_id:   'C2',
    show:         'GGB',
    date:         '2026-06-01',
    time:         '19:00',
    requester_id: 'U100',
    ...overrides,
  });
  return id;
}

// ─── Requests ─────────────────────────────────────────────────────────────────

test('createRequest + getRequest — round-trip returns correct fields', () => {
  const id  = seedRequest();
  const req = repo.getRequest(id);
  assert.equal(req.requester_id,   'U100');
  assert.equal(req.requester_name, 'Alice');
  assert.equal(req.show,           'GGB');
  assert.equal(req.channel_id,     'C1');
  assert.equal(req.status,         'open');
});

test('setRequestHeaderMessageId — updates header_message_id', () => {
  const id = seedRequest();
  repo.setRequestHeaderMessageId(id, 'MSG1');
  assert.equal(repo.getRequest(id).header_message_id, 'MSG1');
});

test('getRequestByHeaderMessage — returns request for a known message ID', () => {
  const id = seedRequest();
  repo.setRequestHeaderMessageId(id, 'HDR1');
  const req = repo.getRequestByHeaderMessage('HDR1');
  assert.equal(req.id, id);
});

test('getRequestByHeaderMessage — returns undefined for unknown message ID', () => {
  assert.equal(repo.getRequestByHeaderMessage('UNKNOWN'), undefined);
});

// ─── Shifts ───────────────────────────────────────────────────────────────────

test('addShift + getShiftById — round-trip returns correct fields', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  const shift   = repo.getShiftById(shiftId);
  assert.equal(shift.request_id, reqId);
  assert.equal(shift.date,       '2026-06-01');
  assert.equal(shift.time,       '19:00');
  assert.equal(shift.status,     'open');
});

test('setShiftMessageId + getShiftByMessageId — round-trip', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.setShiftMessageId(shiftId, 'SMSG1');
  const shift = repo.getShiftByMessageId('SMSG1');
  assert.equal(shift.id, shiftId);
});

test('getShiftsByRequest — returns all shifts for a request in date/time order', () => {
  const reqId = seedRequest();
  const s1    = seedShift(reqId, { date: '2026-06-02', time: '19:00' });
  const s2    = seedShift(reqId, { date: '2026-06-01', time: '17:30' });
  const shifts = repo.getShiftsByRequest(reqId);
  assert.equal(shifts.length,   2);
  assert.equal(shifts[0].id,    s2); // earlier date first
  assert.equal(shifts[1].id,    s1);
});

test('getPendingShifts — returns open shifts for a requester', () => {
  const reqId   = seedRequest({ requester_id: 'U200' });
  const shiftId = seedShift(reqId);
  const pending = repo.getPendingShifts('U200');
  assert.ok(pending.some(s => s.id === shiftId));
});

test('markShiftCovered — updates status and taker', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.markShiftCovered(shiftId, 'U999');
  const shift = repo.getShiftById(shiftId);
  assert.equal(shift.status,             'covered');
  assert.equal(shift.confirmed_taker_id, 'U999');
});

test('markShiftCancelled — updates status to cancelled', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.markShiftCancelled(shiftId);
  assert.equal(repo.getShiftById(shiftId).status, 'cancelled');
});

test('confirmShift — sets covered status, taker, and confirmed_at', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.confirmShift(shiftId, 'U888');
  const shift = repo.getShiftById(shiftId);
  assert.equal(shift.status,             'covered');
  assert.equal(shift.confirmed_taker_id, 'U888');
  assert.ok(shift.confirmed_at,          'confirmed_at should be set');
});

test('getOpenShifts — returns open shifts joined with request info', () => {
  const reqId   = seedRequest({ requester_id: 'U300', channel_id: 'C3' });
  const shiftId = seedShift(reqId);
  repo.setShiftMessageId(shiftId, 'SMSG2');
  const open = repo.getOpenShifts();
  const found = open.find(s => s.id === shiftId);
  assert.ok(found,                 'should include the open shift');
  assert.equal(found.show,         'GGB');
  assert.equal(found.channel_id,   'C3');
  assert.equal(found.requester_id, 'U300');
});

test('getUnconfirmedShifts — returns shifts notified but not yet confirmed', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.setShiftMessageId(shiftId, 'SMSG3');
  db.setFillableNotified('shift', shiftId);
  const unconfirmed = repo.getUnconfirmedShifts();
  assert.ok(unconfirmed.some(s => s.id === shiftId));
});

test('getShiftsForDailyReminder — returns open shifts for a given date', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId, { date: '2026-07-04' });
  const shifts  = repo.getShiftsForDailyReminder('2026-07-04');
  assert.ok(shifts.some(s => s.id === shiftId));
});

test('getOpenShiftByShowAndDateTime — finds an open shift', () => {
  const reqId = seedRequest({ show: 'MFB' });
  seedShift(reqId, { date: '2026-08-01', time: '17:30' });
  const found = repo.getOpenShiftByShowAndDateTime('MFB', '2026-08-01', '17:30');
  assert.ok(found);
  assert.equal(found.date, '2026-08-01');
});

test('markAllRespondedAlertSent — sets the flag', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.markAllRespondedAlertSent(shiftId);
  assert.equal(repo.getShiftById(shiftId).all_responded_alert_sent, 1);
});

// ─── markRequestCancelled — atomicity ────────────────────────────────────────

test('markRequestCancelled — cancels both request and its open shifts', () => {
  const reqId = seedRequest();
  const s1    = seedShift(reqId, { date: '2026-09-01', time: '19:00' });
  const s2    = seedShift(reqId, { date: '2026-09-02', time: '17:30' });

  repo.markRequestCancelled(reqId);

  assert.equal(repo.getRequest(reqId).status,    'cancelled');
  assert.equal(repo.getShiftById(s1).status,     'cancelled');
  assert.equal(repo.getShiftById(s2).status,     'cancelled');
});

test('markRequestCancelled — does not cancel already-covered shifts', () => {
  const reqId = seedRequest();
  const open  = seedShift(reqId, { date: '2026-09-03', time: '19:00' });
  const done  = seedShift(reqId, { date: '2026-09-04', time: '17:30' });
  repo.markShiftCovered(done, 'U777');

  repo.markRequestCancelled(reqId);

  assert.equal(repo.getShiftById(open).status, 'cancelled');
  assert.equal(repo.getShiftById(done).status, 'covered', 'covered shift should be untouched');
});

// ─── Games ────────────────────────────────────────────────────────────────────

test('createGame + getGameById — round-trip returns correct fields', () => {
  const id   = seedGame();
  const game = repo.getGameById(id);
  assert.equal(game.show,         'GGB');
  assert.equal(game.channel_id,   'C2');
  assert.equal(game.requester_id, 'U100');
  assert.equal(game.date,         '2026-06-01');
});

test('setGameMessageId + getGameByMessageId — round-trip', () => {
  const id = seedGame();
  repo.setGameMessageId(id, 'GMSG1');
  const game = repo.getGameByMessageId('GMSG1');
  assert.equal(game.id, id);
});

test('markGameFilled — sets filled_at', () => {
  const id = seedGame();
  repo.markGameFilled(id);
  assert.ok(repo.getGameById(id).filled_at, 'filled_at should be set');
});

test('confirmGame — sets confirmed_at', () => {
  const id = seedGame();
  repo.confirmGame(id);
  assert.ok(repo.getGameById(id).confirmed_at, 'confirmed_at should be set');
});

test('getOpenGames — returns unconfirmed games with a message ID', () => {
  const id = seedGame();
  repo.setGameMessageId(id, 'GMSG2');
  const open = repo.getOpenGames();
  assert.ok(open.some(g => g.id === id));
});

test('getOpenGames — excludes confirmed games', () => {
  const id = seedGame();
  repo.setGameMessageId(id, 'GMSG3');
  repo.confirmGame(id);
  const open = repo.getOpenGames();
  assert.ok(!open.some(g => g.id === id), 'confirmed game should not appear');
});

test('getUnconfirmedGames — returns fillable-notified games not yet confirmed', () => {
  const id = seedGame();
  repo.setGameMessageId(id, 'GMSG4');
  db.setFillableNotified('game', id);
  const unconfirmed = repo.getUnconfirmedGames();
  assert.ok(unconfirmed.some(g => g.id === id));
});

test('getUnfilledGames — returns old unfilled games needing a reminder', () => {
  const id     = seedGame({ requester_id: 'U100' });
  const cutoff = Math.floor(Date.now() / 1000) + 1000; // future cutoff — game is "old"
  const games  = repo.getUnfilledGames(cutoff);
  assert.ok(games.some(g => g.id === id));
});

test('markGameReminderSent — sets reminder_sent flag', () => {
  const id = seedGame();
  repo.markGameReminderSent(id);
  assert.equal(repo.getGameById(id).reminder_sent, 1);
});

// ─── setFillableNotified ──────────────────────────────────────────────────────

test('setFillableNotified shift — sets fillable_notified on shift', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.setFillableNotified('shift', shiftId);
  assert.equal(repo.getShiftById(shiftId).fillable_notified, 1);
});

test('setFillableNotified game — sets fillable_notified on game', () => {
  const id = seedGame();
  repo.setFillableNotified('game', id);
  assert.equal(repo.getGameById(id).fillable_notified, 1);
});

// ─── Hard deletes ─────────────────────────────────────────────────────────────

test('hardDeleteShift — removes the shift row', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.hardDeleteShift(shiftId);
  assert.equal(repo.getShiftById(shiftId), undefined);
});

test('hardDeleteRequest — removes request and all its shifts', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.hardDeleteRequest(reqId);
  assert.equal(repo.getRequest(reqId),      undefined);
  assert.equal(repo.getShiftById(shiftId),  undefined);
});

test('hardDeleteGame — removes the game row', () => {
  const id = seedGame();
  repo.hardDeleteGame(id);
  assert.equal(repo.getGameById(id), undefined);
});
