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
