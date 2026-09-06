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
