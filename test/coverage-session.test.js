'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  planMultiRoleConfirm,
  setMultiRoleSelection,
  getMultiRoleSelections,
  clearMultiRoleSelections,
} = require('../lib/coverage-session');

// ─── pendingMultiRole accessors ───────────────────────────────────────────────

test('clear then get returns undefined', () => {
  setMultiRoleSelection('admin1', 99, 'Daphne', 'U1');
  clearMultiRoleSelections('admin1', 99);
  assert.equal(getMultiRoleSelections('admin1', 99), undefined);
});

test('different userId:gameId keys are isolated from each other', () => {
  setMultiRoleSelection('adminA', 10, 'Daphne',  'U1');
  setMultiRoleSelection('adminB', 10, 'Houdini', 'U2');
  assert.deepEqual(getMultiRoleSelections('adminA', 10), { Daphne:  'U1' });
  assert.deepEqual(getMultiRoleSelections('adminB', 10), { Houdini: 'U2' });
});

test('accessor round-trip: set then get returns what was set', () => {
  setMultiRoleSelection('admin1', 42, 'Daphne', 'U1');
  const result = getMultiRoleSelections('admin1', 42);
  assert.deepEqual(result, { Daphne: 'U1' });
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
