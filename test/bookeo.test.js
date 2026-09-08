'use strict';

/**
 * Tests for lib/bookeo.js's pure helpers behind getScheduleForDays — the
 * multi-week fetch used by the /coverage-request shift picker (90-day horizon).
 * The bookeo-asst /api/schedule endpoint caps each call at a 31-day start/end
 * span, so a longer horizon is stitched together from several CHUNK_DAYS-day
 * chunk calls (CHUNK_DAYS = 30). Also guards the wire param names (start/end,
 * not from/to) so the silent date-range bug can't regress.
 * Run with: node --test test/bookeo.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const axios  = require('axios');

const bookeo = require('../lib/bookeo');
const { _buildChunkRanges, _mergeScheduleChunks } = bookeo;

// ─── _buildChunkRanges ─────────────────────────────────────────────────────────

test('_buildChunkRanges — a sub-chunk horizon needs exactly one chunk', () => {
  const ranges = _buildChunkRanges('2026-05-01', 7);
  assert.deepEqual(ranges, [{ from: '2026-05-01', to: '2026-05-31' }]);
});

test('_buildChunkRanges — 90 days needs 3 chunks, each 30 days apart', () => {
  const ranges = _buildChunkRanges('2026-05-01', 90);
  assert.equal(ranges.length, 3);
  assert.deepEqual(ranges[0], { from: '2026-05-01', to: '2026-05-31' });
  assert.deepEqual(ranges[1], { from: '2026-05-31', to: '2026-06-30' });
  assert.deepEqual(ranges[2], { from: '2026-06-30', to: '2026-07-30' });
});

test('_buildChunkRanges — sub-week horizon still returns one chunk', () => {
  const ranges = _buildChunkRanges('2026-05-01', 1);
  assert.equal(ranges.length, 1);
});

test('_buildChunkRanges — chunks span a month/year boundary correctly', () => {
  const ranges = _buildChunkRanges('2026-12-28', 45);
  assert.deepEqual(ranges, [
    { from: '2026-12-28', to: '2027-01-27' },
    { from: '2027-01-27', to: '2027-02-26' },
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

// ─── getSchedule wire params ─────────────────────────────────────────────────
// Regression guards for the silent date-range bug. Against the live bookeo-asst
// /api/schedule endpoint (verified 2026-09-08): `from`/`to` are silently ignored
// (you get its default window); the real params are `start`/`end`; `end` is
// EXCLUSIVE and must be strictly after `start` (start === end -> HTTP 500). Every
// caller treats `to` as inclusive (e.g. getSchedule(today, today) wants today),
// so getSchedule must send `start`/`end` with end = to + 1 day.

async function captureScheduleRequest(from, to) {
  const originalGet = axios.get;
  let captured = null;
  axios.get = async (_url, config) => {
    captured = config;
    return { status: 200, data: [] };
  };
  try {
    await bookeo.getSchedule(from, to);
  } finally {
    axios.get = originalGet;
  }
  return captured;
}

test('getSchedule sends start/end (not from/to) with an inclusive end (to + 1 day)', async () => {
  // Unique dates so the module-level 5-min cache can't short-circuit this call.
  const captured = await captureScheduleRequest('2031-03-04', '2031-03-11');
  assert.ok(captured, 'axios.get should have been called');
  assert.deepEqual(captured.params, { start: '2031-03-04', end: '2031-03-12' });
  assert.equal(captured.params.from, undefined);
  assert.equal(captured.params.to, undefined);
});

test('getSchedule turns a same-day request into a valid 1-day window (guards the 500)', async () => {
  // start === end returns HTTP 500 upstream; the +1-day end keeps same-day
  // callers (check-in seed, late-booking, /bot-status) working.
  const captured = await captureScheduleRequest('2031-07-20', '2031-07-20');
  assert.deepEqual(captured.params, { start: '2031-07-20', end: '2031-07-21' });
});

test('getSchedule end + 1 day rolls across a month boundary', async () => {
  const captured = await captureScheduleRequest('2031-08-25', '2031-08-31');
  assert.deepEqual(captured.params, { start: '2031-08-25', end: '2031-09-01' });
});
