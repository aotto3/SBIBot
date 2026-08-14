'use strict';

/**
 * Integration tests for lib/audit-log.js — the dashboard's action audit trail.
 * Run with: node --test test/audit-log.test.js
 *
 * Uses a real in-process SQLite DB (DB_PATH=:memory:) — no Discord or Bookeo.
 * Verifies record + read round-trips, JSON serialization of params/result, the
 * optional message_id column (v2 undo depends on it), and most-recent-first order.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const audit = require('../lib/audit-log');

// ─── record + list ──────────────────────────────────────────────────────────

test('record + list — round-trips a logged action', () => {
  audit.record('login', { ip: '1.2.3.4' }, 'success');
  const rows = audit.list();
  assert.ok(rows.length >= 1);
  const row = rows.find(r => r.action === 'login');
  assert.ok(row, 'expected a login row');
  assert.deepEqual(row.params, { ip: '1.2.3.4' });
  assert.equal(row.result, 'success');
  assert.equal(typeof row.created_at, 'number');
});

test('record — stores and returns a message_id when given one', () => {
  const id = audit.record('coverage.confirm', { shiftId: 7 }, { ok: true }, '99887766');
  assert.equal(typeof id, 'number');
  const row = audit.list().find(r => r.id === id);
  assert.ok(row);
  assert.equal(row.message_id, '99887766');
  assert.deepEqual(row.result, { ok: true });
});

test('record — message_id defaults to null when omitted', () => {
  const id = audit.record('config.set', { key: 'daily_shifts_enabled', value: 'false' }, 'ok');
  const row = audit.list().find(r => r.id === id);
  assert.equal(row.message_id, null);
});

test('record — a plain-string result round-trips as a string', () => {
  const id = audit.record('link.remove', { discordId: 'U9' }, 'removed');
  const row = audit.list().find(r => r.id === id);
  assert.equal(row.result, 'removed');
});

test('list — returns rows most-recent-first and respects the limit', () => {
  audit.record('a.1');
  audit.record('a.2');
  audit.record('a.3');
  const rows = audit.list(2);
  assert.equal(rows.length, 2);
  // Newest first: a.3 then a.2 (ids strictly descending).
  assert.ok(rows[0].id > rows[1].id);
  assert.equal(rows[0].action, 'a.3');
});
