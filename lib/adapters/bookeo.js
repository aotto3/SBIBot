'use strict';

/**
 * Bookeo adapter factory for the scheduler execute layer.
 *
 * Wraps bookeo.getSchedule behind a plain-object interface so runShiftDMs
 * can be tested without a live Bookeo connection. The prod adapter delegates
 * to the real bookeo module (which has its own 5-min cache and 15s timeout).
 */

const bookeo = require('../bookeo');

/**
 * Build a production BookeoAdapter.
 * Call once in scheduler.start() and pass the result to runShiftDMs.
 *
 * @returns {BookeoAdapter}
 */
function makeBookeoAdapter() {
  return {
    /**
     * Fetch shifts from Bookeo for the given date range.
     * Delegates to the cached bookeo.getSchedule implementation.
     *
     * Note: bookeo-asst ignores the `to` param and returns a full week.
     * Callers are responsible for client-side filtering to the requested window.
     *
     * @param {string} from  YYYY-MM-DD
     * @param {string} to    YYYY-MM-DD
     * @returns {Promise<object[]>}
     */
    getSchedule(from, to) {
      return bookeo.getSchedule(from, to);
    },
  };
}

module.exports = { makeBookeoAdapter };
