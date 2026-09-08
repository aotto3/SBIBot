/**
 * Tests for lib/job-runs.js — job-run instrumentation, against in-memory SQLite.
 * Run with: node --test test/job-runs.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const db      = require('../lib/db');
const jobRuns = require('../lib/job-runs');

// Clear the table between tests so each starts clean.
function reset() {
  db.db.exec('DELETE FROM job_runs');
}

test('recordJobRun — success records status ok + duration and returns the value', async () => {
  reset();
  const result = await jobRuns.recordJobRun('coverage-pings', async () => {
    return { planned: 3, sent: 3, failed: [] };
  });
  assert.deepEqual(result, { planned: 3, sent: 3, failed: [] }, 'preserves the returned value');

  const [row] = db.getJobRunHistory('coverage-pings');
  assert.equal(row.status, 'ok');
  assert.ok(row.started_at > 0 && row.finished_at >= row.started_at, 'timestamps set');
  assert.ok(row.duration_ms >= 0 && row.duration_ms != null, 'duration recorded');
  assert.equal(row.error, null, 'no error on success');
});

test('recordJobRun — thrown error records status error + message and re-throws', async () => {
  reset();
  await assert.rejects(
    () => jobRuns.recordJobRun('meeting-reminders', async () => { throw new Error('boom'); }),
    /boom/,
    'preserves the throw',
  );

  const [row] = db.getJobRunHistory('meeting-reminders');
  assert.equal(row.status, 'error');
  assert.equal(row.error, 'boom', 'error message stored');
  assert.ok(row.duration_ms != null, 'duration still recorded on failure');
});

test('recordJobRun — non-Error throw is stringified', async () => {
  reset();
  await assert.rejects(() => jobRuns.recordJobRun('eod-reminder', async () => { throw 'plain string'; }));
  const [row] = db.getJobRunHistory('eod-reminder');
  assert.equal(row.error, 'plain string');
});

test('getLastRuns — returns the latest run per job', async () => {
  reset();
  // Two runs of the same job; the later one (error) must win.
  await jobRuns.recordJobRun('shift-dms', async () => 'ok1');
  await new Promise(r => setTimeout(r, 2)); // ensure a later started_at
  await assert.rejects(() => jobRuns.recordJobRun('shift-dms', async () => { throw new Error('later fail'); }));
  await jobRuns.recordJobRun('latebooking', async () => 'seed-ok');

  const last = jobRuns.getLastRuns();
  assert.equal(Object.keys(last).length, 2, 'one entry per distinct job');
  assert.equal(last['shift-dms'].status, 'error', 'latest shift-dms run is the failure');
  assert.equal(last['shift-dms'].error, 'later fail');
  assert.equal(last['latebooking'].status, 'ok');
  assert.ok(typeof last['latebooking'].durationMs === 'number');
});

test('getHistory — newest-first, optionally filtered by job', async () => {
  reset();
  await jobRuns.recordJobRun('maybe-nudge', async () => 1);
  await new Promise(r => setTimeout(r, 2));
  await jobRuns.recordJobRun('maybe-nudge', async () => 2);
  await jobRuns.recordJobRun('coverage-pings', async () => 3);

  const nudge = jobRuns.getHistory('maybe-nudge');
  assert.equal(nudge.length, 2);
  assert.ok(nudge[0].started_at >= nudge[1].started_at, 'newest first');

  const all = jobRuns.getHistory();
  assert.equal(all.length, 3, 'no filter returns every run');
});

test('deleteExpiredJobRuns — prunes rows older than the cutoff', async () => {
  reset();
  // Insert an old row directly (25h ago) and a fresh one via recordJobRun.
  db.insertJobRun({
    job_name: 'checkin-seed',
    started_at: Date.now() - 25 * 60 * 60 * 1000,
    finished_at: Date.now() - 25 * 60 * 60 * 1000,
    duration_ms: 5,
    status: 'ok',
  });
  await jobRuns.recordJobRun('checkin-seed', async () => 'fresh');

  db.deleteExpiredJobRuns(24 * 60 * 60); // keep last 24h
  const rows = db.getJobRunHistory('checkin-seed');
  assert.equal(rows.length, 1, 'old row pruned, fresh row kept');
  assert.equal(rows[0].status, 'ok');
});
