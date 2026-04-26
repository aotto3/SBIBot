'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const { buildConfirmButton } = require('../lib/confirm');

// ─── buildConfirmButton ───────────────────────────────────────────────────────

test('buildConfirmButton — not disabled: correct customId and label', () => {
  const row  = buildConfirmButton(false, 'shift', 5);
  const data = row.toJSON();
  const btn  = data.components[0];
  assert.equal(btn.custom_id, 'confirm_coverage:shift:5', 'customId should encode type and id');
  assert.equal(btn.label,     'Confirm Coverage',         'label should be Confirm Coverage');
  assert.equal(btn.disabled,  false,                      'should not be disabled');
});

test('buildConfirmButton — disabled: label changes, disabled flag set', () => {
  const row  = buildConfirmButton(true, 'game', 12);
  const data = row.toJSON();
  const btn  = data.components[0];
  assert.equal(btn.custom_id, 'confirm_coverage:game:12', 'customId should encode type and id');
  assert.equal(btn.label,     '✅ Confirmed',              'disabled label should say Confirmed');
  assert.equal(btn.disabled,  true,                       'should be disabled');
});

test('buildConfirmButton — works for coverage shift type', () => {
  const row  = buildConfirmButton(false, 'shift', 99);
  const data = row.toJSON();
  assert.ok(data.components[0].custom_id.startsWith('confirm_coverage:shift:'));
});

test('buildConfirmButton — works for game type', () => {
  const row  = buildConfirmButton(false, 'game', 7);
  const data = row.toJSON();
  assert.ok(data.components[0].custom_id.startsWith('confirm_coverage:game:'));
});

// ─── sortRoleOptions ──────────────────────────────────────────────────────────

const { sortRoleOptions } = require('../lib/confirm');

test('sortRoleOptions — role-matching candidate appears before unroled', () => {
  const candidates = [
    { userId: 'U1', displayName: 'Alice', showRole: null },
    { userId: 'U2', displayName: 'Bob',   showRole: 'Daphne' },
  ];
  const result = sortRoleOptions(candidates, 'Daphne');
  assert.equal(result[0].userId, 'U2', 'role-holder should be first');
  assert.equal(result[1].userId, 'U1', 'unroled should be second');
});

test('sortRoleOptions — non-matching role treated as unroled', () => {
  const candidates = [
    { userId: 'U1', displayName: 'Alice', showRole: 'Houdini' },
    { userId: 'U2', displayName: 'Bob',   showRole: 'Daphne' },
  ];
  const result = sortRoleOptions(candidates, 'Daphne');
  assert.equal(result[0].userId, 'U2', 'Daphne role-holder should be first');
  assert.equal(result[1].userId, 'U1', 'Houdini role-holder should be second for Daphne list');
});

test('sortRoleOptions — slash-separated role (Daphne/Houdini) matches both roles', () => {
  const candidates = [
    { userId: 'U1', displayName: 'Alice', showRole: 'Daphne/Houdini' },
    { userId: 'U2', displayName: 'Bob',   showRole: null },
  ];
  const resultD = sortRoleOptions(candidates, 'Daphne');
  assert.equal(resultD[0].userId, 'U1', 'dual-role holder matches Daphne');
  const resultH = sortRoleOptions(candidates, 'Houdini');
  assert.equal(resultH[0].userId, 'U1', 'dual-role holder matches Houdini');
});

test('sortRoleOptions — empty input returns empty array', () => {
  assert.deepEqual(sortRoleOptions([], 'Daphne'), []);
});

test('sortRoleOptions — all candidates same role, order preserved within group', () => {
  const candidates = [
    { userId: 'U1', displayName: 'Alice', showRole: 'Daphne' },
    { userId: 'U2', displayName: 'Bob',   showRole: 'Daphne' },
  ];
  const result = sortRoleOptions(candidates, 'Daphne');
  assert.equal(result.length, 2);
  assert.equal(result[0].userId, 'U1');
  assert.equal(result[1].userId, 'U2');
});
