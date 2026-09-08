'use strict';

/**
 * Job-run instrumentation (shared with dashboard slice #115).
 *
 * `recordJobRun(name, asyncFn)` runs a job, records its start/finish/duration and
 * success-or-failure to the `job_runs` table, and preserves the wrapped function's
 * throw/return so it composes cleanly with `job-notifier.runJob`:
 *
 *   runJob(label, () => recordJobRun(key, run), notify)
 *
 * — recordJobRun *records* every run (ok or error); runJob *notifies* on failure.
 * The two are complementary and don't double-handle: recording never notifies.
 *
 * Reads: `getLastRuns()` (latest run per job) and `getHistory(name?)`.
 */

const db          = require('./db');
const errorBuffer = require('./error-buffer');

/**
 * Run `asyncFn`, recording the outcome. Returns its resolved value on success and
 * re-throws on failure (after recording status 'error' + the message).
 *
 * @param {string} name  Logical job key (e.g. 'coverage-pings').
 * @param {() => Promise<any>} asyncFn
 * @returns {Promise<any>}
 */
async function recordJobRun(name, asyncFn) {
  const startedAt = Date.now();
  try {
    const result   = await asyncFn();
    const finished = Date.now();
    db.insertJobRun({
      job_name:    name,
      started_at:  startedAt,
      finished_at: finished,
      duration_ms: finished - startedAt,
      status:      'ok',
    });
    return result;
  } catch (err) {
    const finished = Date.now();
    db.insertJobRun({
      job_name:    name,
      started_at:  startedAt,
      finished_at: finished,
      duration_ms: finished - startedAt,
      status:      'error',
      error:       err && err.message ? err.message : String(err),
    });
    errorBuffer.push(err, `job:${name}`); // feed the recent-errors triage view
    throw err; // preserve the wrapped function's throw behavior
  }
}

/**
 * Latest run per job, keyed by job name.
 * @returns {Object<string, { status, startedAtMs, finishedAtMs, durationMs, error }>}
 */
function getLastRuns() {
  const out = {};
  for (const r of db.getLastJobRuns()) {
    out[r.job_name] = {
      status:       r.status,
      startedAtMs:  r.started_at,
      finishedAtMs: r.finished_at,
      durationMs:   r.duration_ms,
      error:        r.error,
    };
  }
  return out;
}

/**
 * Run history, newest-first. Pass a job name to filter to one job.
 * @param {string|null} [name]
 * @param {number} [limit]
 */
function getHistory(name = null, limit = 20) {
  return db.getJobRunHistory(name, limit);
}

module.exports = { recordJobRun, getLastRuns, getHistory };
