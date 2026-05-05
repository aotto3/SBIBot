'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const { formatShiftDateTime } = require('../lib/utils');

// ─── formatShiftDateTime ──────────────────────────────────────────────────────

test('formatShiftDateTime — date + time returns readable string with lowercase am/pm', () => {
  assert.equal(formatShiftDateTime('2026-07-17', '19:30'), 'July 17, 2026 at 7:30pm');
});

test('formatShiftDateTime — null time returns date only', () => {
  assert.equal(formatShiftDateTime('2026-07-17', null), 'July 17, 2026');
});

test('formatShiftDateTime — midnight (00:00) shows 12:00am', () => {
  assert.equal(formatShiftDateTime('2026-01-01', '00:00'), 'January 1, 2026 at 12:00am');
});

test('formatShiftDateTime — noon (12:00) shows 12:00pm', () => {
  assert.equal(formatShiftDateTime('2026-12-31', '12:00'), 'December 31, 2026 at 12:00pm');
});

test('formatShiftDateTime — AM hour on the hour shows no leading zero', () => {
  assert.equal(formatShiftDateTime('2026-03-05', '09:00'), 'March 5, 2026 at 9:00am');
});
