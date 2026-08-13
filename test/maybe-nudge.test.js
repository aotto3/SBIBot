/**
 * Tests for lib/maybe-nudge.js — pure planner + DM builder.
 * Run with: node --test test/maybe-nudge.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { extractMaybeReactorIds, planMaybeNudges, buildMaybeNudgeDM } = require('../lib/maybe-nudge');
const { showLabel } = require('../lib/shows');

// ─── extractMaybeReactorIds ───────────────────────────────────────────────────

test('extractMaybeReactorIds — GGB: ❓ reactors only, ✅/❌ ignored', () => {
  const reactions = [
    { name: '✅', userIds: ['A'] },
    { name: '❓', userIds: ['B', 'C'] },
    { name: '❌', userIds: ['D'] },
  ];
  assert.deepEqual(extractMaybeReactorIds(reactions, 'GGB').sort(), ['B', 'C']);
});

test('extractMaybeReactorIds — MFB: Dmaybe and Hmaybe both count as maybe', () => {
  const reactions = [
    { name: 'Dmaybe', userIds: ['A'] },
    { name: 'Hmaybe', userIds: ['B'] },
    { name: 'Dno',    userIds: ['C'] },
    { name: '✅',      userIds: ['D'] },
  ];
  assert.deepEqual(extractMaybeReactorIds(reactions, 'MFB').sort(), ['A', 'B']);
});

test('extractMaybeReactorIds — dedupes a user who reacted with two maybe emojis', () => {
  const reactions = [
    { name: 'Dmaybe', userIds: ['A', 'B'] },
    { name: 'Hmaybe', userIds: ['A'] },
  ];
  assert.deepEqual(extractMaybeReactorIds(reactions, 'MFB').sort(), ['A', 'B']);
});

test('extractMaybeReactorIds — no maybe reactions returns empty', () => {
  const reactions = [{ name: '✅', userIds: ['A'] }, { name: '❌', userIds: ['B'] }];
  assert.deepEqual(extractMaybeReactorIds(reactions, 'GGB'), []);
});

// ─── planMaybeNudges ──────────────────────────────────────────────────────────

const TODAY = '2026-08-16';

test('planMaybeNudges — consolidates one person across multiple posts into a single entry', () => {
  const posts = [
    { show: 'GGB', date: '2026-08-20', time: '19:00', link: 'L1', maybeUserIds: ['U1'] },
    { show: 'MFB', date: '2026-08-22', time: '19:30', link: 'L2', maybeUserIds: ['U1', 'U2'] },
  ];
  const result = planMaybeNudges(posts, [], TODAY);
  assert.equal(result.size, 2);
  assert.equal(result.get('U1').length, 2);
  assert.equal(result.get('U2').length, 1);
  assert.deepEqual(result.get('U1').map(i => i.link), ['L1', 'L2']);
});

test('planMaybeNudges — excludes past-dated posts', () => {
  const posts = [
    { show: 'GGB', date: '2026-08-10', time: '19:00', link: 'PAST',   maybeUserIds: ['U1'] },
    { show: 'GGB', date: '2026-08-20', time: '19:00', link: 'FUTURE', maybeUserIds: ['U1'] },
  ];
  const result = planMaybeNudges(posts, [], TODAY);
  assert.equal(result.get('U1').length, 1);
  assert.equal(result.get('U1')[0].link, 'FUTURE');
});

test('planMaybeNudges — a post exactly on today is still included', () => {
  const posts = [{ show: 'GGB', date: TODAY, time: '19:00', link: 'TODAY', maybeUserIds: ['U1'] }];
  const result = planMaybeNudges(posts, [], TODAY);
  assert.equal(result.get('U1').length, 1);
});

test('planMaybeNudges — excludes users on the coverage-ping exclusion list', () => {
  const posts = [{ show: 'GGB', date: '2026-08-20', time: '19:00', link: 'L1', maybeUserIds: ['U1', 'U2'] }];
  const result = planMaybeNudges(posts, ['U1'], TODAY);
  assert.equal(result.has('U1'), false);
  assert.equal(result.get('U2').length, 1);
});

test('planMaybeNudges — returns empty map when there are no qualifying maybes', () => {
  const posts = [{ show: 'GGB', date: '2026-08-20', time: '19:00', link: 'L1', maybeUserIds: [] }];
  assert.equal(planMaybeNudges(posts, [], TODAY).size, 0);
  assert.equal(planMaybeNudges([], [], TODAY).size, 0);
});

test('planMaybeNudges — formats date/time, and omits time when null (custom game)', () => {
  const posts = [{ show: 'GGB', date: '2026-08-20', time: null, link: 'L1', maybeUserIds: ['U1'] }];
  const item = planMaybeNudges(posts, [], TODAY).get('U1')[0];
  assert.ok(item.dateTimeStr.includes('August 20, 2026'));
  assert.ok(!item.dateTimeStr.includes(' at '), 'no time segment when time is null');
});

// ─── buildMaybeNudgeDM ────────────────────────────────────────────────────────

test('buildMaybeNudgeDM — single post uses the exact single-shift wording', () => {
  const dm = buildMaybeNudgeDM([{ show: 'GGB', dateTimeStr: 'August 20, 2026 at 7:00pm', link: 'https://x/1' }]);
  assert.ok(dm.includes('still marked **maybe**'));
  assert.ok(dm.includes(showLabel('GGB')));
  assert.ok(dm.includes('August 20, 2026 at 7:00pm'));
  assert.ok(dm.includes('still needs coverage'));
  assert.ok(dm.includes('React ✅ or ❌'));
  assert.ok(dm.trimEnd().endsWith('https://x/1'));
});

test('buildMaybeNudgeDM — multiple posts render an intro + one bullet per post', () => {
  const dm = buildMaybeNudgeDM([
    { show: 'GGB', dateTimeStr: 'August 20, 2026 at 7:00pm', link: 'https://x/1' },
    { show: 'MFB', dateTimeStr: 'August 22, 2026 at 7:30pm', link: 'https://x/2' },
  ]);
  const bullets = dm.split('\n').filter(l => l.startsWith('• '));
  assert.equal(bullets.length, 2);
  assert.ok(dm.includes(showLabel('GGB')));
  assert.ok(dm.includes(showLabel('MFB')));
  assert.ok(dm.includes('https://x/1'));
  assert.ok(dm.includes('https://x/2'));
});
