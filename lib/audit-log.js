'use strict';

/**
 * Audit log — the admin dashboard's record of operator actions.
 *
 * Wraps the raw audit_log DB access in lib/db.js with a clean, domain-shaped API
 * (mirrors the config.js / coverage-repository.js wrapper pattern). Every write
 * action the dashboard performs — login, config change, cast-link edit, job
 * trigger — records a row here. The message_id column lets v2's undo/delete-last
 * find the Discord message an action produced.
 *
 * params/result may be structured values; they are JSON-serialized on write and
 * parsed back on read so callers work with plain objects.
 */

const db = require('./db');

function serialize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function parse(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value; // stored as a plain string
  }
}

/**
 * Record one operator action.
 *
 * @param {string} action              short action name, e.g. 'login', 'config.set'
 * @param {*}      [params]            structured input (JSON-serialized) or a string
 * @param {*}      [result]            outcome (JSON-serialized) or a string
 * @param {string|null} [messageId]   Discord message ID the action produced, if any
 * @returns {number} the new row id
 */
function record(action, params = null, result = null, messageId = null) {
  return db.insertAuditLog({
    action,
    params:    serialize(params),
    result:    serialize(result),
    messageId: messageId ?? null,
  });
}

/**
 * List recent audit rows, most-recent-first, with params/result parsed back.
 *
 * @param {number} [limit=100]
 * @returns {Array<{ id, action, params, result, message_id, created_at }>}
 */
function list(limit = 100) {
  return db.getAuditLog(limit).map(row => ({
    ...row,
    params: parse(row.params),
    result: parse(row.result),
  }));
}

module.exports = { record, list };
