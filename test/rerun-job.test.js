'use strict';

/**
 * Unit tests for the /rerun-job report formatter.
 *
 * Run with: node --test --test-force-exit test/rerun-job.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { formatRerunReport } = require('../commands/rerun-job');

test('formatRerunReport — a summary with drops lists sent/planned and the failures', () => {
  const msg = formatRerunReport(
    'Coverage role pings',
    { planned: 11, sent: 1, failed: [{ id: 'm-232', type: 'coverage-ping', reason: 'rate limited' }] },
    false,
  );
  assert.match(msg, /Coverage role pings/);
  assert.match(msg, /sent 1\/11/);
  assert.match(msg, /1 failed/);
  assert.match(msg, /m-232/);
});

test('formatRerunReport — a clean summary reports success with no failures', () => {
  const msg = formatRerunReport('Daily shift DMs', { planned: 3, sent: 3, failed: [] }, false);
  assert.match(msg, /Ran \*\*Daily shift DMs\*\* — sent 3\/3/);
  assert.doesNotMatch(msg, /failed/);
});

test('formatRerunReport — preview lists the targets and does not claim anything was sent', () => {
  const msg = formatRerunReport(
    'Coverage role pings',
    { planned: 2, sent: 0, failed: [], preview: [{ messageId: 'm1', show: 'MFB', dateTime: 'Wed 7:30 PM' }, { messageId: 'm2' }] },
    true,
  );
  assert.match(msg, /preview/i);
  assert.match(msg, /would ping 2/);
  assert.match(msg, /m1/);
  assert.doesNotMatch(msg, /sent/);
});
