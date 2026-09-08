/**
 * Tests for lib/bot-status.js — the pure /bot-status render.
 * Run with: node --test test/bot-status.test.js
 *
 * node:test + node:assert/strict, no Discord/DB/clock — the render is a pure
 * function over a plain snapshot object, so a fixed snapshot + fixed `now`
 * produces deterministic output.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const { buildStatusEmbed, _fmtUptime, _fmtDuration } = require('../lib/bot-status');

const NOW = Date.parse('2026-05-01T12:00:00-05:00');

// Helper: find a field by a substring of its name.
function field(embed, nameFragment) {
  return (embed.fields ?? []).find(f => f.name.includes(nameFragment));
}

// ─── _fmtUptime / _fmtDuration ───────────────────────────────────────────────

test('_fmtUptime — days/hours/minutes, always shows minutes', () => {
  assert.equal(_fmtUptime(0), '0m');
  assert.equal(_fmtUptime(59), '0m');
  assert.equal(_fmtUptime(60), '1m');
  assert.equal(_fmtUptime(3600), '1h 0m');
  assert.equal(_fmtUptime(90000), '1d 1h 0m');
});

test('_fmtDuration — ms / seconds / minutes buckets', () => {
  assert.equal(_fmtDuration(820), '820ms');
  assert.equal(_fmtDuration(3400), '3.4s');
  assert.equal(_fmtDuration(65000), '1m 05s');
  assert.equal(_fmtDuration(-1), '—');
});

// ─── buildStatusEmbed — health ───────────────────────────────────────────────

test('buildStatusEmbed — healthy snapshot: green, connected, reachable', () => {
  const embed = buildStatusEmbed({
    health: { uptimeSec: 3660, discord: 'ready', bookeo: 'reachable' },
    jobs: [],
  }, { now: NOW });

  assert.equal(embed.title, '🤖 Bot Status');
  assert.equal(embed.color, 0x2ecc71, 'healthy → green');
  const h = field(embed, 'Health');
  assert.ok(h.value.includes('1h 1m'), 'renders uptime');
  assert.ok(h.value.includes('connected'), 'renders Discord connected');
  assert.ok(h.value.includes('reachable'), 'renders Bookeo reachable');
});

test('buildStatusEmbed — stale Bookeo degrades to amber', () => {
  const embed = buildStatusEmbed({
    health: { uptimeSec: 10, discord: 'ready', bookeo: 'stale' },
    jobs: [],
  }, { now: NOW });
  assert.equal(embed.color, 0xf1c40f, 'stale Bookeo → amber');
  assert.ok(field(embed, 'Health').value.includes('stale'));
});

test('buildStatusEmbed — unreachable Bookeo is red', () => {
  const embed = buildStatusEmbed({
    health: { uptimeSec: 10, discord: 'ready', bookeo: 'unreachable' },
    jobs: [],
  }, { now: NOW });
  assert.equal(embed.color, 0xe74c3c, 'unreachable → red');
  assert.ok(field(embed, 'Health').value.includes('unreachable'));
});

test('buildStatusEmbed — Discord disconnected is red regardless of Bookeo', () => {
  const embed = buildStatusEmbed({
    health: { uptimeSec: 10, discord: 'disconnected', bookeo: 'reachable' },
    jobs: [],
  }, { now: NOW });
  assert.equal(embed.color, 0xe74c3c, 'Discord down → red');
  assert.ok(field(embed, 'Health').value.includes('disconnected'));
});

// ─── buildStatusEmbed — schedule ─────────────────────────────────────────────

test('buildStatusEmbed — next scheduled runs render each job as a Discord timestamp', () => {
  const nextRun = Date.parse('2026-05-02T13:00:00Z'); // 8am CDT May 2
  const embed = buildStatusEmbed({
    health: { uptimeSec: 10, discord: 'ready', bookeo: 'reachable' },
    jobs: [
      { key: 'meeting-reminders', label: 'Meeting reminders', nextRun },
      { key: 'eod-reminder',      label: 'EOD coverage reminder', nextRun: null },
    ],
  }, { now: NOW });

  const sched = field(embed, 'Next scheduled runs');
  assert.ok(sched, 'has a schedule field');
  assert.ok(sched.value.includes('Meeting reminders'), 'lists a job label');
  assert.ok(sched.value.includes(`<t:${Math.floor(nextRun / 1000)}:R>`), 'renders next fire as a Discord timestamp');
  assert.ok(sched.value.includes('not scheduled'), 'renders a null nextRun gracefully');
});

test('buildStatusEmbed — skeleton (no lastRun) shows a run-history placeholder', () => {
  const embed = buildStatusEmbed({
    health: { uptimeSec: 10, discord: 'ready', bookeo: 'reachable' },
    jobs: [{ key: 'meeting-reminders', label: 'Meeting reminders', nextRun: NOW + 3600000 }],
  }, { now: NOW });

  const lastRun = field(embed, 'Last run');
  assert.ok(lastRun, 'has a last-run field');
  assert.ok(/will appear here/i.test(lastRun.value), 'shows placeholder until jobs have run');
});

test('buildStatusEmbed — no jobs → only the health field, no schedule/last-run', () => {
  const embed = buildStatusEmbed({
    health: { uptimeSec: 10, discord: 'ready', bookeo: 'reachable' },
    jobs: [],
  }, { now: NOW });
  assert.equal(embed.fields.length, 1, 'only Health with no jobs');
  assert.ok(field(embed, 'Health'));
});

test('buildStatusEmbed — tolerates a missing snapshot / missing sections', () => {
  const embed = buildStatusEmbed(undefined, { now: NOW });
  assert.equal(embed.title, '🤖 Bot Status');
  const h = field(embed, 'Health');
  assert.ok(h.value.includes('0m'), 'uptime defaults to 0m');
  assert.ok(h.value.includes('unknown'), 'unknown discord/bookeo states render');
});
