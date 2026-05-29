'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const db = require('../lib/db');
const {
  planMultiRoleConfirm,
  setMultiRoleSelection,
  getMultiRoleSelections,
  clearMultiRoleSelections,
} = require('../lib/coverage-session');

function cleanSessions() {
  db.db.prepare('DELETE FROM coverage_confirmation_sessions').run();
}

// ─── DB-backed session accessors ──────────────────────────────────────────────

test('clear then get returns undefined', () => {
  cleanSessions();
  setMultiRoleSelection('admin1', 99, 'Daphne', 'U1');
  clearMultiRoleSelections('admin1', 99);
  assert.equal(getMultiRoleSelections('admin1', 99), undefined);
});

test('different userId:gameId keys are isolated from each other', () => {
  cleanSessions();
  setMultiRoleSelection('adminA', 10, 'Daphne',  'U1');
  setMultiRoleSelection('adminB', 10, 'Houdini', 'U2');
  assert.deepEqual(getMultiRoleSelections('adminA', 10), { Daphne:  'U1' });
  assert.deepEqual(getMultiRoleSelections('adminB', 10), { Houdini: 'U2' });
});

test('accessor round-trip: set then get returns what was set', () => {
  cleanSessions();
  setMultiRoleSelection('admin1', 42, 'Daphne', 'U1');
  const result = getMultiRoleSelections('admin1', 42);
  assert.deepEqual(result, { Daphne: 'U1' });
});

test('multiple setMultiRoleSelection calls merge into the same session', () => {
  cleanSessions();
  setMultiRoleSelection('admin1', 55, 'Daphne',  'U1');
  setMultiRoleSelection('admin1', 55, 'Houdini', 'U2');
  assert.deepEqual(getMultiRoleSelections('admin1', 55), { Daphne: 'U1', Houdini: 'U2' });
});

test('session data survives a simulated fresh module read from the same DB', () => {
  cleanSessions();
  setMultiRoleSelection('admin1', 77, 'HR', 'U-hr');

  // Simulate what happens after a bot restart: reading directly from DB
  const row = db.getConfirmationSession('admin1', 77);
  assert.deepEqual(row, { HR: 'U-hr' });
});

test('deleteExpiredConfirmationSessions removes old sessions', () => {
  cleanSessions();
  setMultiRoleSelection('admin1', 88, 'Daphne', 'U1');

  // Back-date created_at to 40 minutes ago
  db.db.prepare('UPDATE coverage_confirmation_sessions SET created_at = ? WHERE user_id = ? AND game_id = ?')
    .run(Math.floor(Date.now() / 1000) - 40 * 60, 'admin1', 88);

  db.deleteExpiredConfirmationSessions(30 * 60);
  assert.equal(getMultiRoleSelections('admin1', 88), undefined, 'expired session should be deleted');
});

test('deleteExpiredConfirmationSessions keeps recent sessions', () => {
  cleanSessions();
  setMultiRoleSelection('admin1', 89, 'Daphne', 'U1');

  db.deleteExpiredConfirmationSessions(30 * 60);
  assert.deepEqual(getMultiRoleSelections('admin1', 89), { Daphne: 'U1' }, 'recent session should survive');
});

// ─── planMultiRoleConfirm ─────────────────────────────────────────────────────

test('planMultiRoleConfirm — empty selections → all characters in missingRoles', () => {
  const characters = ['Daphne', 'Houdini'];
  const result     = planMultiRoleConfirm(undefined, characters);
  assert.equal(result.valid, false, 'should be invalid');
  assert.deepEqual(result.missingRoles, ['Daphne', 'Houdini'], 'all roles missing');
});

test('planMultiRoleConfirm — one role missing → valid false, missingRoles lists it', () => {
  const pending    = { Daphne: 'U1' }; // Houdini not selected
  const characters = ['Daphne', 'Houdini'];
  const result     = planMultiRoleConfirm(pending, characters);
  assert.equal(result.valid, false, 'should be invalid when a role is missing');
  assert.ok(result.missingRoles.includes('Houdini'), 'Houdini should be listed as missing');
  assert.ok(!result.missingRoles.includes('Daphne'),  'Daphne is selected — not missing');
});

test('planMultiRoleConfirm — all roles selected → valid true with takers', () => {
  const pending    = { Daphne: 'U1', Houdini: 'U2' };
  const characters = ['Daphne', 'Houdini'];
  const result     = planMultiRoleConfirm(pending, characters);
  assert.equal(result.valid, true, 'should be valid when all roles filled');
  assert.ok(Array.isArray(result.takers), 'takers should be an array');
  assert.equal(result.takers.length, 2, 'one taker per role');
  const daphne = result.takers.find(t => t.role === 'Daphne');
  assert.ok(daphne, 'should have a Daphne taker');
  assert.equal(daphne.userId, 'U1', 'Daphne taker should be U1');
});
