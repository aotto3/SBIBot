/**
 * Tests for /coverage-stats slice 1 (issue #144, PRD #143).
 *
 * Layers under test:
 *   - lib/coverage-stats.js  — computeCoverageStats + buildStatsEmbeds (pure).
 *   - lib/owner.js           — the owner-only access guard (pure).
 *   - lib/coverage-repository.js getStatsShiftRows against in-memory SQLite.
 *
 * Run with: node --test test/coverage-stats.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const {
  computeCoverageStats,
  buildStatsEmbeds,
  buildStatsEmptyState,
} = require('../lib/coverage-stats');
const { OWNER_DISCORD_ID, isOwner } = require('../lib/owner');
const repo = require('../lib/coverage-repository');

// ─── Row fixture (pure compute input) ─────────────────────────────────────────

function shiftRow(overrides = {}) {
  return {
    id: 1, request_id: 1, date: '2026-06-01', time: '19:00', status: 'open',
    confirmed_taker_id: null, confirmed_at: null,
    show: 'GGB', character: null,
    requester_id: 'REQ', requester_name: 'Requester',
    request_created_at: 1000,
    ...overrides,
  };
}

const person = (lb, id) => lb.find(e => e.id === id);

// ─── computeCoverageStats — leaderboard ───────────────────────────────────────

test('computeCoverageStats — no rows produces an empty leaderboard', () => {
  assert.deepEqual(computeCoverageStats([]).leaderboard, []);
  assert.deepEqual(computeCoverageStats().leaderboard, []);
});

test('computeCoverageStats — a covered shift credits the taker and counts the request', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ status: 'covered', confirmed_taker_id: 'T1', requester_id: 'R1' }),
  ]);
  const taker = person(leaderboard, 'T1');
  const req   = person(leaderboard, 'R1');
  assert.equal(taker.covers, 1);
  assert.equal(taker.requests, 0);
  assert.equal(req.requests, 1);
  assert.equal(req.covers, 0);
  assert.equal(req.requestsCancelled, 0);
});

test('computeCoverageStats — cancelled requests are counted separately, not as active requests', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ status: 'cancelled', requester_id: 'R1' }),
  ]);
  const req = person(leaderboard, 'R1');
  assert.equal(req.requests, 0);
  assert.equal(req.requestsCancelled, 1);
});

test('computeCoverageStats — an open (still-pending) request counts as an active request', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ status: 'open', requester_id: 'R1' }),
  ]);
  assert.equal(person(leaderboard, 'R1').requests, 1);
});

test('computeCoverageStats — aggregates across rows and computes give/take ratio', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ id: 1, status: 'covered', confirmed_taker_id: 'A', requester_id: 'B' }),
    shiftRow({ id: 2, status: 'covered', confirmed_taker_id: 'A', requester_id: 'C' }),
    shiftRow({ id: 3, status: 'covered', confirmed_taker_id: 'C', requester_id: 'A' }),
  ]);
  const a = person(leaderboard, 'A');
  assert.equal(a.covers, 2);
  assert.equal(a.requests, 1);
  assert.equal(a.ratio, 2); // 2 covers / 1 request
});

test('computeCoverageStats — ratio is null when a person has zero active requests', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ status: 'covered', confirmed_taker_id: 'T', requester_id: 'R' }),
  ]);
  assert.equal(person(leaderboard, 'T').ratio, null);
});

test('computeCoverageStats — requester == taker aggregates onto one entry', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ status: 'covered', confirmed_taker_id: 'X', requester_id: 'X' }),
  ]);
  assert.equal(leaderboard.length, 1);
  const x = person(leaderboard, 'X');
  assert.equal(x.covers, 1);
  assert.equal(x.requests, 1);
  assert.equal(x.ratio, 1);
});

test('computeCoverageStats — a person with only a cancelled request still appears', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ status: 'cancelled', requester_id: 'ONLY', confirmed_taker_id: null }),
  ]);
  const p = person(leaderboard, 'ONLY');
  assert.ok(p, 'requester of a cancelled shift should still be listed');
  assert.equal(p.covers, 0);
  assert.equal(p.requests, 0);
  assert.equal(p.requestsCancelled, 1);
});

test('computeCoverageStats — sorts most covers first, then most requests', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ id: 1, status: 'covered', confirmed_taker_id: 'LOW' }),
    shiftRow({ id: 2, status: 'covered', confirmed_taker_id: 'HIGH' }),
    shiftRow({ id: 3, status: 'covered', confirmed_taker_id: 'HIGH' }),
  ]);
  assert.equal(leaderboard[0].id, 'HIGH', 'the person with more covers ranks first');
});

test('computeCoverageStats — a null taker/requester never creates a phantom entry', () => {
  const { leaderboard } = computeCoverageStats([
    shiftRow({ status: 'open', requester_id: null, confirmed_taker_id: null }),
  ]);
  assert.deepEqual(leaderboard, []);
});

// ─── buildStatsEmbeds — render ────────────────────────────────────────────────

const NAMES = { A: 'Alice', B: 'Bob' };
const resolveName = id => NAMES[id] ?? `<@${id}>`;

test('buildStatsEmbeds — empty leaderboard renders no embeds', () => {
  assert.deepEqual(buildStatsEmbeds({ leaderboard: [] }, { resolveName }), []);
  assert.deepEqual(buildStatsEmbeds({}, { resolveName }), []);
});

test('buildStatsEmbeds — renders names, covers, requests and ratio', () => {
  const stats = computeCoverageStats([
    shiftRow({ id: 1, status: 'covered', confirmed_taker_id: 'A', requester_id: 'B' }),
    shiftRow({ id: 2, status: 'covered', confirmed_taker_id: 'A', requester_id: 'A' }),
  ]);
  const [embed] = buildStatsEmbeds(stats, { resolveName });
  assert.equal(embed.title, 'Coverage Stats');
  assert.ok(embed.description.includes('Alice'),      'resolves the linked name');
  assert.ok(embed.description.includes('covered 2'),  'shows Alice covered 2');
  assert.ok(embed.description.includes('ratio 2.0'),  'shows Alice ratio 2.0');
  assert.ok(embed.description.includes('Bob'),        'lists the requester too');
});

test('buildStatsEmbeds — shows the cancelled count only when non-zero', () => {
  const withCancel = buildStatsEmbeds(
    computeCoverageStats([shiftRow({ status: 'cancelled', requester_id: 'A' })]),
    { resolveName },
  )[0].description;
  assert.ok(withCancel.includes('(1 cancelled)'), 'renders the cancelled note');

  const noCancel = buildStatsEmbeds(
    computeCoverageStats([shiftRow({ status: 'open', requester_id: 'A' })]),
    { resolveName },
  )[0].description;
  assert.ok(!noCancel.includes('cancelled'), 'omits the note when there are no cancellations');
});

test('buildStatsEmbeds — unlinked members fall back to a mention', () => {
  const stats = computeCoverageStats([
    shiftRow({ status: 'covered', confirmed_taker_id: 'U999', requester_id: 'U999' }),
  ]);
  const desc = buildStatsEmbeds(stats, { resolveName })[0].description;
  assert.ok(desc.includes('<@U999>'), 'unresolved id renders as a Discord mention');
});

test('buildStatsEmbeds — description stays within the embed limit', () => {
  const rows = [];
  for (let i = 0; i < 400; i++) {
    rows.push(shiftRow({ id: i, status: 'covered', confirmed_taker_id: `U${i}` }));
  }
  const desc = buildStatsEmbeds(computeCoverageStats(rows), { resolveName })[0].description;
  assert.ok(desc.length <= 4096, 'description must fit within the embed limit');
});

test('buildStatsEmptyState — friendly no-activity line', () => {
  assert.equal(buildStatsEmptyState(), '✅ No coverage activity recorded yet.');
});

// ─── computeCoverageStats — fill rate (slice #145) ────────────────────────────

// Central stamp of this instant is "2027-01-01 06:00" (CST) — well after the
// June 2026 fixtures, so open past shifts count as unfilled/passed.
const FIXED_NOW = new Date('2027-01-01T12:00:00Z');
const fr = rows => computeCoverageStats(rows, { now: FIXED_NOW }).fillRate;

test('fillRate — a covered shift lands in the covered bucket at 100%', () => {
  const { overall } = fr([shiftRow({ status: 'covered', confirmed_taker_id: 'T' })]);
  assert.equal(overall.covered, 1);
  assert.equal(overall.cancelled, 0);
  assert.equal(overall.unfilledPassed, 0);
  assert.equal(overall.coveredPct, 1);
});

test('fillRate — a cancelled shift lands in the cancelled bucket', () => {
  const { overall } = fr([shiftRow({ status: 'cancelled' })]);
  assert.equal(overall.cancelled, 1);
  assert.equal(overall.covered, 0);
  assert.equal(overall.unfilledPassed, 0);
});

test('fillRate — an open shift whose showtime has passed is unfilled/passed', () => {
  const { overall } = fr([shiftRow({ status: 'open', date: '2026-06-01', time: '19:00' })]);
  assert.equal(overall.unfilledPassed, 1);
  assert.equal(overall.covered, 0);
});

test('fillRate — an open shift still in the future is pending and excluded from all buckets', () => {
  const { overall } = fr([shiftRow({ status: 'open', date: '2099-01-01', time: '19:00' })]);
  assert.deepEqual(
    { c: overall.covered, x: overall.cancelled, u: overall.unfilledPassed },
    { c: 0, x: 0, u: 0 },
  );
  assert.equal(overall.coveredPct, null, 'no resolved shifts → no percentage');
});

test('fillRate — coveredPct is covered / (covered + unfilled-passed); cancelled excluded', () => {
  const { overall } = fr([
    shiftRow({ id: 1, status: 'covered', confirmed_taker_id: 'T' }),
    shiftRow({ id: 2, status: 'open', date: '2026-06-01', time: '19:00' }), // passed → miss
    shiftRow({ id: 3, status: 'cancelled' }),                               // excluded from %
  ]);
  assert.equal(overall.coveredPct, 0.5);
});

test('fillRate — buckets are grouped per show', () => {
  const { byShow } = fr([
    shiftRow({ id: 1, show: 'GGB', status: 'covered', confirmed_taker_id: 'T' }),
    shiftRow({ id: 2, show: 'MFB', character: 'Daphne', status: 'cancelled' }),
  ]);
  assert.equal(byShow.GGB.covered, 1);
  assert.equal(byShow.MFB.cancelled, 1);
  assert.equal(byShow.MFB.covered, 0);
});

test('buildStatsEmbeds — renders a Fill rate field with the three buckets', () => {
  const stats = computeCoverageStats([
    shiftRow({ id: 1, status: 'covered', confirmed_taker_id: 'A', requester_id: 'B' }),
    shiftRow({ id: 2, status: 'cancelled', requester_id: 'B' }),
  ], { now: FIXED_NOW });
  const [embed] = buildStatsEmbeds(stats, { resolveName });
  const field = (embed.fields ?? []).find(f => f.name.includes('Fill rate'));
  assert.ok(field, 'a Fill rate field should be present');
  assert.ok(field.value.includes('1 covered'),          'shows covered count');
  assert.ok(field.value.includes('1 cancelled'),        'shows cancelled count');
  assert.ok(field.value.includes('0 unfilled/passed'),  'shows unfilled/passed count');
});

test('buildStatsEmbeds — omits the Fill rate field when nothing is resolved yet', () => {
  const stats = computeCoverageStats(
    [shiftRow({ status: 'open', date: '2099-01-01', time: '19:00', requester_id: 'A' })],
    { now: FIXED_NOW },
  );
  const [embed] = buildStatsEmbeds(stats, { resolveName });
  assert.ok(embed, 'leaderboard still renders (the requester is listed)');
  const hasFill = (embed.fields ?? []).some(f => f.name.includes('Fill rate'));
  assert.equal(hasFill, false, 'no Fill rate field when only pending shifts exist');
});

// ─── computeCoverageStats — timing (slice #146) ───────────────────────────────

// 2026-06-01 12:00 UTC (07:00 CDT) as unix seconds — a stable request timestamp.
const T0 = Math.floor(Date.UTC(2026, 5, 1, 12, 0, 0) / 1000);

test('timing — time-to-coverage median & average over covered shifts (hours)', () => {
  const { timing } = computeCoverageStats([
    shiftRow({ id: 1, status: 'covered', confirmed_taker_id: 'T', request_created_at: T0, confirmed_at: T0 + 10 * 3600, date: '2026-06-10' }),
    shiftRow({ id: 2, status: 'covered', confirmed_taker_id: 'T', request_created_at: T0, confirmed_at: T0 + 20 * 3600, date: '2026-06-10' }),
    shiftRow({ id: 3, status: 'covered', confirmed_taker_id: 'T', request_created_at: T0, confirmed_at: T0 + 60 * 3600, date: '2026-06-10' }),
  ]);
  assert.equal(timing.timeToCoverage.count, 3);
  assert.equal(timing.timeToCoverage.medianHours, 20); // sorted [10,20,60]
  assert.equal(timing.timeToCoverage.avgHours, 30);    // (10+20+60)/3
});

test('timing — time-to-coverage ignores open and cancelled shifts', () => {
  const { timing } = computeCoverageStats([
    shiftRow({ status: 'open', request_created_at: T0, confirmed_at: null }),
    shiftRow({ status: 'cancelled', request_created_at: T0, confirmed_at: null }),
  ]);
  assert.equal(timing.timeToCoverage.count, 0);
  assert.equal(timing.timeToCoverage.medianHours, null);
});

test('timing — lead time is whole days from request to showtime across all shifts', () => {
  const { timing } = computeCoverageStats([
    shiftRow({ id: 1, request_created_at: T0, date: '2026-06-10' }), // 9 days
    shiftRow({ id: 2, request_created_at: T0, date: '2026-06-02' }), // 1 day
  ]);
  assert.equal(timing.leadTime.count, 2);
  assert.equal(timing.leadTime.medianDays, 5); // (1+9)/2
  assert.equal(timing.leadTime.avgDays, 5);
});

test('timing — empty input yields null medians/averages and zero counts', () => {
  const { timing } = computeCoverageStats([]);
  assert.deepEqual(timing.timeToCoverage, { medianHours: null, avgHours: null, count: 0 });
  assert.deepEqual(timing.leadTime, { medianDays: null, avgDays: null, count: 0 });
});

test('timing — a single value: median equals the value (no divide-by-zero)', () => {
  const { timing } = computeCoverageStats([
    shiftRow({ status: 'covered', confirmed_taker_id: 'T', request_created_at: T0, confirmed_at: T0 + 5 * 3600, date: '2026-06-02' }),
  ]);
  assert.equal(timing.timeToCoverage.medianHours, 5);
  assert.equal(timing.timeToCoverage.avgHours, 5);
});

test('buildStatsEmbeds — renders a Timing field, labeling time-to-coverage as confirm time', () => {
  const stats = computeCoverageStats([
    shiftRow({ status: 'covered', confirmed_taker_id: 'A', requester_id: 'B', request_created_at: T0, confirmed_at: T0 + 10 * 3600, date: '2026-06-10' }),
  ], { now: FIXED_NOW });
  const [embed] = buildStatsEmbeds(stats, { resolveName });
  const field = (embed.fields ?? []).find(f => f.name.includes('Timing'));
  assert.ok(field, 'a Timing field should be present');
  assert.ok(field.value.includes('Time to coverage'),   'shows time-to-coverage');
  assert.ok(field.value.includes('request → confirmed'), 'labels it as confirm time');
  assert.ok(field.value.includes('Lead time'),           'shows lead time');
});

// ─── computeCoverageStats — most-needed (slice #147) ──────────────────────────

test('mostNeeded — groups by show, most requests first', () => {
  const { mostNeeded } = computeCoverageStats([
    shiftRow({ id: 1, show: 'GGB' }),
    shiftRow({ id: 2, show: 'GGB' }),
    shiftRow({ id: 3, show: 'MFB', character: 'Daphne' }),
  ]);
  assert.equal(mostNeeded.byShow[0].show, 'GGB');
  assert.equal(mostNeeded.byShow[0].count, 2);
  assert.ok(mostNeeded.byShow.some(e => e.show === 'MFB' && e.count === 1));
});

test('mostNeeded — byCharacter includes only multi-role shows (null character excluded)', () => {
  const { mostNeeded } = computeCoverageStats([
    shiftRow({ show: 'GGB', character: null }),
    shiftRow({ show: 'MFB', character: 'Daphne' }),
    shiftRow({ show: 'MFB', character: 'Daphne' }),
    shiftRow({ show: 'MFB', character: 'Houdini' }),
  ]);
  const daphne = mostNeeded.byCharacter.find(e => e.character === 'Daphne');
  assert.equal(daphne.count, 2);
  assert.equal(daphne.show, 'MFB');
  assert.equal(mostNeeded.byCharacter[0].character, 'Daphne', 'ranked by count');
  assert.ok(!mostNeeded.byCharacter.some(e => e.show === 'GGB'), 'single-role show excluded');
});

test('mostNeeded — groups by weekday, ranked by count', () => {
  const { mostNeeded } = computeCoverageStats([
    shiftRow({ id: 1, date: '2026-06-06' }),
    shiftRow({ id: 2, date: '2026-06-06' }),
    shiftRow({ id: 3, date: '2026-06-05' }),
  ]);
  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const topLabel = NAMES[new Date('2026-06-06T00:00:00Z').getUTCDay()];
  assert.equal(mostNeeded.byWeekday[0].label, topLabel);
  assert.equal(mostNeeded.byWeekday[0].count, 2);
});

test('mostNeeded — empty input yields empty dimensions', () => {
  const { mostNeeded } = computeCoverageStats([]);
  assert.deepEqual(mostNeeded, { byShow: [], byCharacter: [], byWeekday: [] });
});

test('buildStatsEmbeds — renders a Most-needed field with show/weekday/character lines', () => {
  const stats = computeCoverageStats([
    shiftRow({ id: 1, show: 'MFB', character: 'Daphne', date: '2026-06-06' }),
    shiftRow({ id: 2, show: 'GGB', date: '2026-06-05' }),
  ], { now: FIXED_NOW });
  const field = (buildStatsEmbeds(stats, { resolveName })[0].fields ?? [])
    .find(f => f.name.includes('Most-needed'));
  assert.ok(field, 'a Most-needed field should be present');
  assert.ok(field.value.includes('By show'),      'shows the by-show line');
  assert.ok(field.value.includes('By weekday'),   'shows the by-weekday line');
  assert.ok(field.value.includes('By character'), 'shows the by-character line when a multi-role show is present');
});

// ─── owner gate ───────────────────────────────────────────────────────────────

test('isOwner — allows the owner id and denies everyone else', () => {
  assert.equal(isOwner(OWNER_DISCORD_ID), true);
  assert.equal(isOwner('someone-else'), false);
  assert.equal(isOwner(undefined), false);
});

// ─── repository accessor (in-memory SQLite) ───────────────────────────────────

test('getStatsShiftRows — returns shifts of every status joined with request info', () => {
  const reqId = repo.createRequest({
    requester_id: 'U1', requester_name: 'Alice', show: 'GGB', character: null, channel_id: 'C1',
  });
  const open      = repo.addShift({ request_id: reqId, date: '2026-06-01', time: '19:00' });
  const covered   = repo.addShift({ request_id: reqId, date: '2026-06-02', time: '19:00' });
  const cancelled = repo.addShift({ request_id: reqId, date: '2026-06-03', time: '19:00' });
  repo.confirmShift(covered, 'U2');
  repo.markShiftCancelled(cancelled);

  const rows = repo.getStatsShiftRows();
  const byId = id => rows.find(r => r.id === id);

  assert.equal(byId(open).status, 'open');
  assert.equal(byId(covered).status, 'covered');
  assert.equal(byId(covered).confirmed_taker_id, 'U2');
  assert.equal(byId(cancelled).status, 'cancelled');

  // Joined request fields are present on every row.
  assert.equal(byId(open).show, 'GGB');
  assert.equal(byId(open).requester_id, 'U1');
  assert.equal(byId(open).requester_name, 'Alice');
  assert.ok(typeof byId(open).request_created_at === 'number', 'carries the request created_at');
});

test('getStatsShiftRows — end-to-end with computeCoverageStats credits taker and requester', () => {
  const reqId = repo.createRequest({
    requester_id: 'RQ', requester_name: 'Reqr', show: 'Lucidity', character: null, channel_id: 'C9',
  });
  const shiftId = repo.addShift({ request_id: reqId, date: '2026-07-01', time: '20:00' });
  repo.confirmShift(shiftId, 'TK');

  const { leaderboard } = computeCoverageStats(repo.getStatsShiftRows());
  assert.equal(person(leaderboard, 'TK').covers, 1);
  assert.equal(person(leaderboard, 'RQ').requests, 1);
});
