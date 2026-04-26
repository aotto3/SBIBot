/**
 * Tests for lib/coverage.js — pure plan functions.
 * Run with: node --test test/coverage.test.js
 *
 * Uses Node's built-in node:test and node:assert (no external deps needed).
 * All tests are synchronous — no Discord/DB calls.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  parseShiftInput,
  isRequestDuplicate,
  groupShiftsForDisplay,
  buildHeaderPost,
  buildShiftPost,
  buildConfirmationPost,
  buildResolvedHeaderPost,
} = require('../lib/coverage');

// ─── parseShiftInput ──────────────────────────────────────────────────────────

// Use a fixed reference date so tests don't depend on current date
const REF = new Date(2026, 0, 1); // Jan 1 2026

test('parseShiftInput — single shift with full date and time', () => {
  const result = parseShiftInput('January 15, 2026 at 7:00pm', REF);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-01-15');
  assert.equal(result[0].time, '19:00');
});

test('parseShiftInput — multiple shifts separated by newlines', () => {
  const text = 'Jan 15 2026 at 5:30pm\nJan 15 2026 at 7pm\nJan 16 2026 at 5:30pm';
  const result = parseShiftInput(text, REF);
  assert.equal(result.length, 3);
  assert.equal(result[0].date, '2026-01-15');
  assert.equal(result[0].time, '17:30');
  assert.equal(result[1].date, '2026-01-15');
  assert.equal(result[1].time, '19:00');
  assert.equal(result[2].date, '2026-01-16');
  assert.equal(result[2].time, '17:30');
});

test('parseShiftInput — slash date format with @ separator', () => {
  const result = parseShiftInput('1/15/2026 @ 7pm', REF);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-01-15');
  assert.equal(result[0].time, '19:00');
});

test('parseShiftInput — no valid dates returns empty array', () => {
  const result = parseShiftInput('hello world no dates here', REF);
  assert.deepEqual(result, []);
});

test('parseShiftInput — ambiguous hour defaults to PM', () => {
  // "7" with no AM/PM should become 19:00, not 07:00
  const result = parseShiftInput('January 15, 2026 at 7', REF);
  assert.equal(result.length, 1);
  assert.equal(result[0].time, '19:00');
});

test('parseShiftInput — ambiguous 5:30 defaults to PM', () => {
  const result = parseShiftInput('January 15, 2026 at 5:30', REF);
  assert.equal(result.length, 1);
  assert.equal(result[0].time, '17:30');
});

test('parseShiftInput — explicit AM is preserved', () => {
  const result = parseShiftInput('January 15, 2026 at 9am', REF);
  assert.equal(result.length, 1);
  assert.equal(result[0].time, '09:00');
});

test('parseShiftInput — date without time returns null time', () => {
  const result = parseShiftInput('January 15, 2026', REF);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-01-15');
  assert.equal(result[0].time, null);
});

// ─── isRequestDuplicate ───────────────────────────────────────────────────────

test('isRequestDuplicate — exact date+time match returns true', () => {
  const existing = [{ date: '2026-05-01', time: '19:00', status: 'open' }];
  assert.equal(isRequestDuplicate(existing, { date: '2026-05-01', time: '19:00' }), true);
});

test('isRequestDuplicate — different time returns false', () => {
  const existing = [{ date: '2026-05-01', time: '19:00', status: 'open' }];
  assert.equal(isRequestDuplicate(existing, { date: '2026-05-01', time: '21:00' }), false);
});

test('isRequestDuplicate — different date returns false', () => {
  const existing = [{ date: '2026-05-01', time: '19:00', status: 'open' }];
  assert.equal(isRequestDuplicate(existing, { date: '2026-05-02', time: '19:00' }), false);
});

test('isRequestDuplicate — covered shift is not a duplicate', () => {
  const existing = [{ date: '2026-05-01', time: '19:00', status: 'covered' }];
  assert.equal(isRequestDuplicate(existing, { date: '2026-05-01', time: '19:00' }), false);
});

test('isRequestDuplicate — cancelled shift is not a duplicate', () => {
  const existing = [{ date: '2026-05-01', time: '19:00', status: 'cancelled' }];
  assert.equal(isRequestDuplicate(existing, { date: '2026-05-01', time: '19:00' }), false);
});

test('isRequestDuplicate — empty existing list returns false', () => {
  assert.equal(isRequestDuplicate([], { date: '2026-05-01', time: '19:00' }), false);
});

// ─── groupShiftsForDisplay ────────────────────────────────────────────────────

test('groupShiftsForDisplay — groups shifts by date', () => {
  const shifts = [
    { date: '2026-05-01', time: '17:30' },
    { date: '2026-05-01', time: '19:00' },
    { date: '2026-05-02', time: '17:30' },
  ];
  const groups = groupShiftsForDisplay(shifts);
  assert.equal(Object.keys(groups).length, 2);
  assert.equal(groups['2026-05-01'].length, 2);
  assert.equal(groups['2026-05-02'].length, 1);
});

test('groupShiftsForDisplay — single shift returns one group', () => {
  const shifts = [{ date: '2026-05-01', time: '19:00' }];
  const groups = groupShiftsForDisplay(shifts);
  assert.equal(Object.keys(groups).length, 1);
  assert.equal(groups['2026-05-01'].length, 1);
});

test('groupShiftsForDisplay — empty list returns empty object', () => {
  assert.deepEqual(groupShiftsForDisplay([]), {});
});

// ─── buildHeaderPost ──────────────────────────────────────────────────────────

test('buildHeaderPost — includes requester name and show label', () => {
  const request = { requester_name: 'Alice', show: 'GGB' };
  const shifts  = [{ date: '2026-05-01', time: '19:00' }];
  const result  = buildHeaderPost(request, shifts);
  assert.ok(result.includes('Alice'),        'should include requester name');
  assert.ok(result.includes('Great Gold Bird'), 'should include show label');
});

test('buildHeaderPost — plural "shifts" when more than one', () => {
  const request = { requester_name: 'Alice', show: 'GGB' };
  const shifts  = [
    { date: '2026-05-01', time: '17:30' },
    { date: '2026-05-01', time: '19:00' },
  ];
  const result = buildHeaderPost(request, shifts);
  assert.ok(result.includes('2'), 'should mention count');
});

test('buildHeaderPost — includes react instructions', () => {
  const request = { requester_name: 'Alice', show: 'GGB' };
  const result  = buildHeaderPost(request, [{ date: '2026-05-01', time: '19:00' }]);
  assert.ok(result.includes('✅'), 'should include ✅ instruction');
});

test('buildHeaderPost — includes bolded character when present', () => {
  const request = { requester_name: 'Alice', show: 'MFB', character: 'Daphne' };
  const result  = buildHeaderPost(request, [{ date: '2026-05-01', time: '19:00' }]);
  assert.ok(result.includes('**Daphne**'), 'should bold character name');
});

test('buildHeaderPost — no character mention for single-role show', () => {
  const request = { requester_name: 'Alice', show: 'GGB', character: null };
  const result  = buildHeaderPost(request, [{ date: '2026-05-01', time: '19:00' }]);
  assert.ok(!result.includes('**null**'), 'should not include null character');
  assert.ok(result.includes('coverage for 1 shift'), 'should say coverage without character');
});

// ─── buildShiftPost ───────────────────────────────────────────────────────────

test('buildShiftPost — formatted date and time, no show label', () => {
  const request = { show: 'GGB' };
  const shift   = { date: '2027-01-01', time: '17:30' };
  const result  = buildShiftPost(request, shift);
  assert.ok(!result.includes('Great Gold Bird'), 'should not include show label');
  assert.ok(result.includes('5:30 PM'),          'should include formatted time');
  assert.ok(result.includes('2027'),             'should include year');
});

test('buildShiftPost — no show label for MFB either', () => {
  const request = { show: 'MFB' };
  const shift   = { date: '2026-06-15', time: '19:00' };
  const result  = buildShiftPost(request, shift);
  assert.ok(!result.includes('Man From Beyond'), 'should not include show label');
  assert.ok(result.includes('7:00 PM'),          'should include formatted time');
});

// ─── buildConfirmationPost ────────────────────────────────────────────────────

test('buildConfirmationPost — correct format with both names, date, and time', () => {
  const result = buildConfirmationPost('Alice', 'Bob', 'GGB', '2027-01-01', '17:30');
  assert.ok(result.startsWith('✅ Confirmed:'), 'should start with confirmed prefix');
  assert.ok(result.includes('**Bob**'),         'should bold taker name');
  assert.ok(result.includes('**Alice**'),       'should bold requester name');
  assert.ok(result.includes('5:30 PM'),         'should include formatted time');
  assert.ok(result.includes('2027'),            'should include year');
  assert.ok(result.includes('January'),         'should include month name');
});

test('buildConfirmationPost — switched in / out phrasing', () => {
  const result = buildConfirmationPost('Alice', 'Bob', 'GGB', '2027-01-01', '19:00');
  assert.ok(result.includes('switched'), 'should include "switched"');
  assert.ok(result.includes('in for'),   'should include "in for"');
});

// ─── buildResolvedHeaderPost ──────────────────────────────────────────────────

test('buildResolvedHeaderPost — includes requester name and all-covered message', () => {
  const request = { requester_name: 'Alice', show: 'GGB' };
  const result  = buildResolvedHeaderPost(request);
  assert.ok(result.includes('**Alice**'), 'should bold requester name');
  assert.ok(result.includes('covered'),   'should mention coverage');
  assert.ok(result.includes('Thank you'), 'should include thank you');
});

test('buildResolvedHeaderPost — prepends role mention when provided', () => {
  const request = { requester_name: 'Alice', show: 'GGB' };
  const result  = buildResolvedHeaderPost(request, '<@&123456>');
  assert.ok(result.startsWith('<@&123456>'), 'should start with role mention');
});

test('buildResolvedHeaderPost — no role mention by default', () => {
  const request = { requester_name: 'Alice', show: 'GGB' };
  const result  = buildResolvedHeaderPost(request);
  assert.ok(!result.startsWith('<@'), 'should not start with a mention by default');
});
