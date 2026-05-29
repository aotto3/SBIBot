'use strict';

process.env.DB_PATH = ':memory:';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  formatShiftDateTime,
  resolveChannelByName,
  resolveCoverageChannel,
  resolveCheckinChannel,
  resolveCustomGameChannel,
} = require('../lib/utils');
const db = require('../lib/db');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMockGuild(channelNames = []) {
  const channels = channelNames.map((name, i) => ({ id: String(i + 1), name }));
  return {
    channels: {
      cache: {
        find: (fn) => channels.find(fn),
        get:  (id) => channels.find(c => c.id === id),
      },
    },
  };
}

// ─── formatShiftDateTime ──────────────────────────────────────────────────────

test('formatShiftDateTime — date + time returns readable string with lowercase am/pm', () => {
  assert.equal(formatShiftDateTime('2026-07-17', '19:30'), 'July 17, 2026 at 7:30pm');
});

test('formatShiftDateTime — null time returns date only', () => {
  assert.equal(formatShiftDateTime('2026-07-17', null), 'July 17, 2026');
});

test('formatShiftDateTime — midnight (00:00) shows 12:00am', () => {
  assert.equal(formatShiftDateTime('2026-01-01', '00:00'), 'January 1, 2026 at 12:00am');
});

test('formatShiftDateTime — noon (12:00) shows 12:00pm', () => {
  assert.equal(formatShiftDateTime('2026-12-31', '12:00'), 'December 31, 2026 at 12:00pm');
});

test('formatShiftDateTime — AM hour on the hour shows no leading zero', () => {
  assert.equal(formatShiftDateTime('2026-03-05', '09:00'), 'March 5, 2026 at 9:00am');
});

// ─── resolveChannelByName ─────────────────────────────────────────────────────

test('resolveChannelByName — returns channel when found', async () => {
  const guild = makeMockGuild(['ggb-times', 'mfb-daphne']);
  const ch = await resolveChannelByName(guild, 'ggb-times');
  assert.equal(ch.name, 'ggb-times');
});

test('resolveChannelByName — throws with channel name in error when not found', async () => {
  const guild = makeMockGuild([]);
  await assert.rejects(
    () => resolveChannelByName(guild, 'ggb-times'),
    (err) => {
      assert.ok(err.message.includes('ggb-times'), 'error should name the missing channel');
      return true;
    }
  );
});

// ─── channel resolvers ────────────────────────────────────────────────────────

test('channel resolvers — default naming convention (no overrides)', async () => {
  const guild = makeMockGuild(['ggb-mikey', 'mfb-daphne', 'ggb-times']);
  assert.equal((await resolveCoverageChannel(guild, 'GGB', null)).name,    'ggb-mikey');
  assert.equal((await resolveCoverageChannel(guild, 'MFB', 'Daphne')).name, 'mfb-daphne');
  assert.equal((await resolveCheckinChannel(guild, 'GGB')).name,            'ggb-times');
  assert.equal((await resolveCustomGameChannel(guild, 'GGB')).name,         'ggb-times');
});

test('channel resolvers — bot_config overrides take precedence', async () => {
  const guild = makeMockGuild(['ggb-mikey', 'ggb-times', 'override-ch']);
  db.setConfig('coverage_channel_GGB',     '3');
  db.setConfig('checkin_alert_channel_GGB', '3');
  db.setConfig('custom_game_channel_GGB',  '3');
  try {
    assert.equal((await resolveCoverageChannel(guild, 'GGB', null)).name, 'override-ch');
    assert.equal((await resolveCheckinChannel(guild, 'GGB')).name,         'override-ch');
    assert.equal((await resolveCustomGameChannel(guild, 'GGB')).name,      'override-ch');
  } finally {
    db.deleteConfig('coverage_channel_GGB');
    db.deleteConfig('checkin_alert_channel_GGB');
    db.deleteConfig('custom_game_channel_GGB');
  }
});
