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
  buildFillableDM,
  buildEodDM,
  buildConfirmationMessage,
  planMissingRolePings,
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

// ─── buildFillableDM ──────────────────────────────────────────────────────────

test('buildFillableDM — multi-role: names grouped by role on separate lines', () => {
  const result = buildFillableDM({
    show:            'MFB',
    date:            '2026-05-01',
    time:            '19:00',
    character:       null,
    availableByRole: { Daphne: ['Alice'], Houdini: ['Bob', 'Carol'] },
    postLink:        'https://discord.com/channels/1/2/3',
  });
  assert.ok(result.includes('Man From Beyond'), 'should include show label');
  assert.ok(result.includes('Daphne: Alice'),   'should list Daphne reactors');
  assert.ok(result.includes('Houdini: Bob'),    'should list Houdini reactors');
  assert.ok(!result.includes('Available:'),     'should not use flat Available: line');
});

test('buildFillableDM — includes character name when present', () => {
  const result = buildFillableDM({
    show:            'Endings',
    date:            '2026-06-01',
    time:            '19:00',
    character:       'HR',
    availableByRole: ['Dave'],
    postLink:        'https://discord.com/channels/1/2/3',
  });
  assert.ok(result.includes('HR'), 'should include character name');
});

test('buildFillableDM — single-role: includes show label, date+time, names, link', () => {
  const result = buildFillableDM({
    show:           'GGB',
    date:           '2026-05-01',
    time:           '19:00',
    character:      null,
    availableByRole: ['Alice', 'Bob'],
    postLink:       'https://discord.com/channels/1/2/3',
  });
  assert.ok(result.includes('Great Gold Bird'),              'should include show label');
  assert.ok(result.includes('May 1'),                        'should include date');
  assert.ok(result.includes('7:00 PM'),                      'should include time');
  assert.ok(result.includes('Alice'),                        'should include first name');
  assert.ok(result.includes('Bob'),                          'should include second name');
  assert.ok(result.includes('https://discord.com/channels/1/2/3'), 'should include link');
});

// ─── buildEodDM ───────────────────────────────────────────────────────────────

test('buildEodDM — empty list returns empty string', () => {
  assert.equal(buildEodDM([]), '');
});

test('buildEodDM — single item contains show, date, names, and link', () => {
  const result = buildEodDM([{
    show:            'GGB',
    date:            '2026-05-01',
    time:            '19:00',
    character:       null,
    availableByRole: ['Alice'],
    postLink:        'https://discord.com/channels/1/2/3',
  }]);
  assert.ok(result.includes('Great Gold Bird'),                    'should include show label');
  assert.ok(result.includes('Alice'),                              'should include name');
  assert.ok(result.includes('https://discord.com/channels/1/2/3'), 'should include link');
});

test('buildEodDM — multiple items each have their own link', () => {
  const result = buildEodDM([
    { show: 'GGB', date: '2026-05-01', time: '19:00', character: null, availableByRole: ['Alice'], postLink: 'https://discord.com/link1' },
    { show: 'MFB', date: '2026-05-02', time: '17:30', character: null, availableByRole: { Daphne: ['Bob'] }, postLink: 'https://discord.com/link2' },
  ]);
  assert.ok(result.includes('https://discord.com/link1'), 'should include first link');
  assert.ok(result.includes('https://discord.com/link2'), 'should include second link');
  assert.ok(result.includes('Great Gold Bird'),            'should include first show');
  assert.ok(result.includes('Man From Beyond'),            'should include second show');
});

// ─── buildConfirmationMessage ─────────────────────────────────────────────────

test('buildConfirmationMessage — coverage shift: @mentions taker and requester', () => {
  const result = buildConfirmationMessage({
    type:      'shift',
    show:      'GGB',
    date:      '2026-05-01',
    time:      '19:00',
    takers:    [{ userId: 'U111', role: null }],
    requester: 'U222',
  });
  assert.ok(result.includes('<@U111>'), 'should mention taker');
  assert.ok(result.includes('<@U222>'), 'should mention requester');
  assert.ok(result.includes('May 1'),  'should include date');
  assert.ok(result.includes('7:00 PM'), 'should include time');
});

test('buildConfirmationMessage — single-role game: includes show name, no requester mention', () => {
  const result = buildConfirmationMessage({
    type:      'game',
    show:      'GGB',
    date:      '2026-05-01',
    time:      '19:00',
    takers:    [{ userId: 'U111', role: null }],
    requester: null,
  });
  assert.ok(result.includes('<@U111>'),       'should mention taker');
  assert.ok(!result.includes('<@null>'),      'should not mention null requester');
  assert.ok(result.includes('Great Gold Bird'), 'should include show label');
  assert.ok(result.includes('custom game'),   'should say custom game');
});

test('buildConfirmationMessage — multi-role game: each taker listed with their role', () => {
  const result = buildConfirmationMessage({
    type:      'game',
    show:      'MFB',
    date:      '2026-05-01',
    time:      '19:00',
    takers:    [{ userId: 'U111', role: 'Daphne' }, { userId: 'U222', role: 'Houdini' }],
    requester: null,
  });
  assert.ok(result.includes('<@U111> as Daphne'),  'should list first taker with role');
  assert.ok(result.includes('<@U222> as Houdini'), 'should list second taker with role');
  assert.ok(result.includes('Man From Beyond'),    'should include show label');
  assert.ok(!result.includes('custom game'),       'should not say "custom game" for multi-role');
});

// ─── planMissingRolePings ─────────────────────────────────────────────────────

test('planMissingRolePings — excludes posts where missingRoles is empty', () => {
  const shifts = [{ show: 'GGB', channel_id: 'C1', shift_message_id: 'M1', missingRoles: [] }];
  const result = planMissingRolePings(shifts, []);
  assert.equal(result.length, 0, 'should return nothing when all roles are covered');
});

test('planMissingRolePings — single-role shift returns entry with its missing role', () => {
  const shifts = [{ show: 'GGB', channel_id: 'C1', shift_message_id: 'M1', missingRoles: ['Mikey'] }];
  const result = planMissingRolePings(shifts, []);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].roleNames, ['Mikey']);
  assert.equal(result[0].channelId, 'C1');
  assert.equal(result[0].messageId, 'M1');
});

test('planMissingRolePings — multi-role game returns only missing roles', () => {
  const games = [{ show: 'MFB', channel_id: 'C2', message_id: 'M2', missingRoles: ['Houdini'] }];
  const result = planMissingRolePings([], games);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].roleNames, ['Houdini']);
  assert.equal(result[0].messageId, 'M2');
});

test('planMissingRolePings — empty inputs return empty array', () => {
  assert.deepEqual(planMissingRolePings([], []), []);
});
