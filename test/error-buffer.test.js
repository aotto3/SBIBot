/**
 * Tests for lib/error-buffer.js — bounded in-memory recent-errors buffer.
 * Run with: node --test test/error-buffer.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const { createErrorBuffer, push, list, clear } = require('../lib/error-buffer');

test('createErrorBuffer — records message + context + timestamp', () => {
  const buf = createErrorBuffer(5);
  const entry = buf.push(new Error('kaboom'), 'job:coverage-pings');
  assert.equal(entry.message, 'kaboom');
  assert.equal(entry.context, 'job:coverage-pings');
  assert.ok(typeof entry.at === 'number' && entry.at > 0);
});

test('createErrorBuffer — non-Error value is stringified; missing context is null', () => {
  const buf = createErrorBuffer(5);
  const entry = buf.push('plain failure');
  assert.equal(entry.message, 'plain failure');
  assert.equal(entry.context, null);
});

test('createErrorBuffer — bounded: drops oldest entries past capacity', () => {
  const buf = createErrorBuffer(3);
  buf.push(new Error('a'));
  buf.push(new Error('b'));
  buf.push(new Error('c'));
  buf.push(new Error('d')); // evicts 'a'

  assert.equal(buf.size, 3, 'never exceeds capacity');
  const msgs = buf.list().map(e => e.message);
  assert.deepEqual(msgs, ['d', 'c', 'b'], 'newest-first, oldest dropped');
  assert.ok(!msgs.includes('a'), 'oldest evicted');
});

test('createErrorBuffer — list() returns newest-first', () => {
  const buf = createErrorBuffer(10);
  buf.push(new Error('first'));
  buf.push(new Error('second'));
  assert.deepEqual(buf.list().map(e => e.message), ['second', 'first']);
});

test('createErrorBuffer — clear() empties the buffer', () => {
  const buf = createErrorBuffer(10);
  buf.push(new Error('x'));
  buf.clear();
  assert.equal(buf.size, 0);
  assert.deepEqual(buf.list(), []);
});

test('shared buffer — module-level push/list/clear operate on one buffer', () => {
  clear();
  push(new Error('shared-1'), 'unhandledRejection');
  push(new Error('shared-2'), 'reaction:add');
  const items = list();
  assert.equal(items[0].message, 'shared-2', 'newest-first');
  assert.equal(items[1].context, 'unhandledRejection');
  clear();
  assert.deepEqual(list(), []);
});
