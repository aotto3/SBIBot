/**
 * Tests for /list-outstanding-requests (issue #125, PRD #124).
 *
 * Two layers under test:
 *   - lib/coverage-repository.js query wrappers (getOutstandingShifts) against
 *     an in-memory SQLite DB.
 *   - lib/coverage.js buildOutstandingEmbeds pure helper (no DB/Discord).
 *
 * Run with: node --test test/list-outstanding-requests.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const repo = require('../lib/coverage-repository');
const { buildOutstandingEmbeds } = require('../lib/coverage');

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedRequest(overrides = {}) {
  return repo.createRequest({
    requester_id:   'U100',
    requester_name: 'Alice',
    show:           'GGB',
    character:      null,
    channel_id:     'C1',
    ...overrides,
  });
}

function seedShift(requestId, overrides = {}) {
  return repo.addShift({ request_id: requestId, date: '2026-06-01', time: '19:00', ...overrides });
}

// A "today" far in the past so seeded 2026-06-01 shifts count as future.
const PAST_TODAY = '2026-01-01';

// ─── getOutstandingShifts ─────────────────────────────────────────────────────

test('getOutstandingShifts — returns an open future-dated shift joined with request info', () => {
  const reqId   = seedRequest({ requester_id: 'U300', requester_name: 'Carol', channel_id: 'C3', show: 'GGB' });
  const shiftId = seedShift(reqId, { date: '2026-06-01', time: '19:00' });
  repo.setShiftMessageId(shiftId, 'SMSG1');

  const rows  = repo.getOutstandingShifts(PAST_TODAY);
  const found = rows.find(r => r.id === shiftId);

  assert.ok(found, 'should include the open future-dated shift');
  assert.equal(found.show,             'GGB');
  assert.equal(found.channel_id,       'C3');
  assert.equal(found.requester_name,   'Carol');
  assert.equal(found.date,             '2026-06-01');
  assert.equal(found.time,             '19:00');
  assert.equal(found.shift_message_id, 'SMSG1');
});

test('getOutstandingShifts — excludes past-dated shifts', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId, { date: '2026-06-01' });
  // today is AFTER the shift date → excluded
  const rows = repo.getOutstandingShifts('2026-06-02');
  assert.ok(!rows.some(r => r.id === shiftId), 'past-dated shift should not appear');
});

test('getOutstandingShifts — includes a shift dated exactly today', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId, { date: '2026-06-01' });
  const rows = repo.getOutstandingShifts('2026-06-01');
  assert.ok(rows.some(r => r.id === shiftId), 'shift dated today should appear');
});

test('getOutstandingShifts — excludes cancelled shifts', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.markShiftCancelled(shiftId);
  const rows = repo.getOutstandingShifts(PAST_TODAY);
  assert.ok(!rows.some(r => r.id === shiftId), 'cancelled shift should not appear');
});

test('getOutstandingShifts — excludes covered/confirmed shifts', () => {
  const reqId   = seedRequest();
  const shiftId = seedShift(reqId);
  repo.markShiftCovered(shiftId, 'U999');
  const rows = repo.getOutstandingShifts(PAST_TODAY);
  assert.ok(!rows.some(r => r.id === shiftId), 'covered shift should not appear');
});

test('getOutstandingShifts — reflects fillable_notified state', () => {
  const reqId   = seedRequest();
  const plain   = seedShift(reqId, { date: '2026-06-01', time: '17:00' });
  const notified = seedShift(reqId, { date: '2026-06-01', time: '18:00' });
  repo.setFillableNotified('shift', notified);
  const rows = repo.getOutstandingShifts(PAST_TODAY);
  assert.equal(rows.find(r => r.id === plain).fillable_notified,    0);
  assert.equal(rows.find(r => r.id === notified).fillable_notified, 1);
});

// ─── buildOutstandingEmbeds ───────────────────────────────────────────────────

const GUILD = 'G1';

test('buildOutstandingEmbeds — no shifts or games returns an empty array', () => {
  assert.deepEqual(buildOutstandingEmbeds([], [], GUILD), []);
});

function shiftRow(overrides = {}) {
  return {
    id: 12, date: '2026-06-01', time: '19:00',
    shift_message_id: 'M1', header_message_id: 'H1', fillable_notified: 0,
    show: 'GGB', character: null, channel_id: 'C1',
    requester_name: 'Alice', requester_id: 'U1',
    ...overrides,
  };
}

test('buildOutstandingEmbeds — one coverage shift produces one embed titled with the show label', () => {
  const embeds = buildOutstandingEmbeds([shiftRow()], [], GUILD);
  assert.equal(embeds.length, 1);
  assert.ok(embeds[0].title.includes('Great Gold Bird'), 'title should include show label');
  const desc = embeds[0].description;
  assert.ok(desc.includes('#12'),     'row should include the shift ID');
  assert.ok(desc.includes('Alice'),   'row should include the requester name');
  assert.ok(desc.includes('7:00 PM'), 'row should include the formatted time');
  assert.ok(desc.includes('https://discord.com/channels/G1/C1/M1'), 'row should include the jump link');
});

test('buildOutstandingEmbeds — 🔴 needs coverage when not fillable_notified', () => {
  const desc = buildOutstandingEmbeds([shiftRow({ fillable_notified: 0 })], [], GUILD)[0].description;
  assert.ok(desc.includes('🔴'),             'should show red marker');
  assert.ok(desc.includes('needs coverage'), 'should show needs-coverage status');
  assert.ok(!desc.includes('🟡'),            'should not show yellow marker');
});

test('buildOutstandingEmbeds — 🟡 ready to fill when fillable_notified', () => {
  const desc = buildOutstandingEmbeds([shiftRow({ fillable_notified: 1 })], [], GUILD)[0].description;
  assert.ok(desc.includes('🟡'),                       'should show yellow marker');
  assert.ok(desc.includes('ready to fill'),            'should show ready-to-fill status');
  assert.ok(desc.includes('awaiting confirmation'),    'should note awaiting confirmation');
});

test('buildOutstandingEmbeds — shows character for multi-role shows', () => {
  const desc = buildOutstandingEmbeds(
    [shiftRow({ show: 'MFB', character: 'Daphne' })], [], GUILD)[0].description;
  assert.ok(desc.includes('Daphne'), 'should include the character name');
});

test('buildOutstandingEmbeds — omits character for single-role shows', () => {
  const desc = buildOutstandingEmbeds([shiftRow({ show: 'GGB', character: null })], [], GUILD)[0].description;
  assert.ok(!desc.includes('*null*') && !desc.includes('null'), 'should not render a null character');
});

test('buildOutstandingEmbeds — jump link falls back to header when shift post id missing', () => {
  const desc = buildOutstandingEmbeds(
    [shiftRow({ shift_message_id: null, header_message_id: 'H9', channel_id: 'C1' })], [], GUILD)[0].description;
  assert.ok(desc.includes('https://discord.com/channels/G1/C1/H9'), 'should link to the header message');
});

test('buildOutstandingEmbeds — groups into one embed per show', () => {
  const embeds = buildOutstandingEmbeds([
    shiftRow({ id: 1, show: 'GGB' }),
    shiftRow({ id: 2, show: 'MFB', character: 'Daphne' }),
  ], [], GUILD);
  assert.equal(embeds.length, 2, 'two shows → two embeds');
  const titles = embeds.map(e => e.title);
  assert.ok(titles.some(t => t.includes('Great Gold Bird')), 'should have a GGB embed');
  assert.ok(titles.some(t => t.includes('Man From Beyond')), 'should have an MFB embed');
});

test('buildOutstandingEmbeds — sorts rows within a show by date then time', () => {
  const embeds = buildOutstandingEmbeds([
    shiftRow({ id: 1, date: '2026-06-02', time: '19:00' }),
    shiftRow({ id: 2, date: '2026-06-01', time: '20:00' }),
    shiftRow({ id: 3, date: '2026-06-01', time: '17:00' }),
  ], [], GUILD);
  const desc = embeds[0].description;
  const order = ['#3', '#2', '#1'].map(tag => desc.indexOf(tag));
  assert.ok(order[0] < order[1] && order[1] < order[2], 'rows should be date-then-time ascending');
});

test('buildOutstandingEmbeds — truncates a show that overflows the 4096-char embed limit', () => {
  const many = [];
  for (let i = 1; i <= 80; i++) {
    many.push(shiftRow({ id: i, date: '2026-06-01', time: `${String(6 + (i % 12)).padStart(2, '0')}:00` }));
  }
  const desc = buildOutstandingEmbeds(many, [], GUILD)[0].description;
  assert.ok(desc.length <= 4096, 'description must fit within the embed limit');
  assert.ok(/and \d+ more/.test(desc), 'should append an "…and N more" line');
});
