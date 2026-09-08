'use strict';

/**
 * Tests for lib/bookeo.js's pure helpers behind getScheduleForDays — the
 * multi-week fetch used by the /coverage-request shift picker (90-day horizon).
 * bookeo-asst ignores the `to` param and always returns ~1 week from `from`,
 * so a longer horizon is stitched together from several 7-day chunk calls.
 * Run with: node --test test/bookeo.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

const { _buildChunkRanges, _mergeScheduleChunks } = require('../lib/bookeo');

// ─── _buildChunkRanges ─────────────────────────────────────────────────────────

test('_buildChunkRanges — 7 days needs exactly one chunk', () => {
  const ranges = _buildChunkRanges('2026-05-01', 7);
  assert.deepEqual(ranges, [{ from: '2026-05-01', to: '2026-05-08' }]);
});

test('_buildChunkRanges — 90 days needs 13 chunks, each 7 days apart', () => {
  const ranges = _buildChunkRanges('2026-05-01', 90);
  assert.equal(ranges.length, 13);
  assert.deepEqual(ranges[0],  { from: '2026-05-01', to: '2026-05-08' });
  assert.deepEqual(ranges[1],  { from: '2026-05-08', to: '2026-05-15' });
  assert.deepEqual(ranges[12], { from: '2026-07-24', to: '2026-07-31' });
});

test('_buildChunkRanges — sub-week horizon still returns one chunk', () => {
  const ranges = _buildChunkRanges('2026-05-01', 1);
  assert.equal(ranges.length, 1);
});

test('_buildChunkRanges — chunks span a month/year boundary correctly', () => {
  const ranges = _buildChunkRanges('2026-12-28', 14);
  assert.deepEqual(ranges, [
    { from: '2026-12-28', to: '2027-01-04' },
    { from: '2027-01-04', to: '2027-01-11' },
  ]);
});

// ─── _mergeScheduleChunks ───────────────────────────────────────────────────────

function row(date, time, show, extra = {}) {
  return { date, time, show, cast: ['Someone'], guest_count: 0, ...extra };
}

test('_mergeScheduleChunks — concatenates rows from every chunk', () => {
  const chunks = [
    [row('2026-05-01', '7:00 PM', 'GGB')],
    [row('2026-05-08', '7:00 PM', 'GGB')],
  ];
  const merged = _mergeScheduleChunks(chunks, '2026-05-01', '2026-05-31');
  assert.equal(merged.length, 2);
});

test('_mergeScheduleChunks — dedupes identical date+time+show across chunks', () => {
  const dup = row('2026-05-08', '7:00 PM', 'GGB');
  const chunks = [[dup], [dup]];
  const merged = _mergeScheduleChunks(chunks, '2026-05-01', '2026-05-31');
  assert.equal(merged.length, 1);
});

test('_mergeScheduleChunks — same date+time but different show is kept separately', () => {
  const chunks = [[
    row('2026-05-08', '7:00 PM', 'GGB'),
    row('2026-05-08', '7:00 PM', 'Lucidity'),
  ]];
  const merged = _mergeScheduleChunks(chunks, '2026-05-01', '2026-05-31');
  assert.equal(merged.length, 2);
});

test('_mergeScheduleChunks — clips rows outside [from, to] (chunk overshoot at the edges)', () => {
  const chunks = [[
    row('2026-04-30', '7:00 PM', 'GGB'), // before window
    row('2026-05-15', '7:00 PM', 'GGB'), // inside window
    row('2026-06-01', '7:00 PM', 'GGB'), // after window (last chunk's overshoot)
  ]];
  const merged = _mergeScheduleChunks(chunks, '2026-05-01', '2026-05-31');
  assert.deepEqual(merged.map(r => r.date), ['2026-05-15']);
});

test('_mergeScheduleChunks — window boundaries are inclusive', () => {
  const chunks = [[
    row('2026-05-01', '7:00 PM', 'GGB'),
    row('2026-05-31', '7:00 PM', 'GGB'),
  ]];
  const merged = _mergeScheduleChunks(chunks, '2026-05-01', '2026-05-31');
  assert.equal(merged.length, 2);
});

test('_mergeScheduleChunks — empty chunks produce an empty result', () => {
  assert.deepEqual(_mergeScheduleChunks([[], []], '2026-05-01', '2026-05-31'), []);
});
