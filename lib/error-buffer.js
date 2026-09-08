'use strict';

/**
 * Bounded in-memory recent-errors buffer (shared with dashboard slice #115).
 *
 * A ring buffer of the most recent captured errors, so /bot-status (and later the
 * dashboard health page) can show a triage feed without scrolling Railway logs.
 * Fed from the global error handlers in index.js (unhandledRejection, the
 * interaction/reaction catch blocks) and from the cron wrappers (recordJobRun).
 *
 * Purely in-memory and process-local — it resets on restart, which is fine: it's
 * a "what's gone wrong lately" view, not durable storage.
 */

const DEFAULT_CAPACITY = 25;

/**
 * Create an error buffer with a fixed capacity.
 * @param {number} [capacity]
 */
function createErrorBuffer(capacity = DEFAULT_CAPACITY) {
  const buf = [];

  return {
    /**
     * Record an error. `err` may be an Error or any value; `ctx` is a short
     * free-text context tag (e.g. 'unhandledRejection', 'job:coverage-pings').
     * @returns {{ at: number, context: string|null, message: string }}
     */
    push(err, ctx = null) {
      const entry = {
        at:      Date.now(),
        context: ctx == null ? null : String(ctx),
        message: err && err.message ? err.message : String(err),
      };
      buf.push(entry);
      if (buf.length > capacity) buf.splice(0, buf.length - capacity); // drop oldest
      return entry;
    },

    /** Recorded errors, newest-first. */
    list() {
      return buf.slice().reverse();
    },

    /** Empty the buffer (used by tests). */
    clear() {
      buf.length = 0;
    },

    get capacity() { return capacity; },
    get size()     { return buf.length; },
  };
}

// Process-wide shared buffer used by the app.
const shared = createErrorBuffer(DEFAULT_CAPACITY);

module.exports = {
  createErrorBuffer,
  DEFAULT_CAPACITY,
  push:  (err, ctx) => shared.push(err, ctx),
  list:  () => shared.list(),
  clear: () => shared.clear(),
};
