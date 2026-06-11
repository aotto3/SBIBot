'use strict';

/**
 * Tests for the coverage ping redirect logic in lib/rsvp.js.
 * Run with: node --test test/rsvp.test.js
 *
 * Uses a real in-process SQLite DB (DB_PATH=:memory:).
 * rsvp.js uses raw Discord.js objects directly (not the scheduler adapter),
 * so tests build minimal fake objects that satisfy the call sites.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const repo                = require('../lib/coverage-repository');
const db                  = require('../lib/db');
const { handleReactionChange } = require('../lib/rsvp');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanDb() {
  db.db.prepare('DELETE FROM coverage_requests').run();
  db.db.prepare('DELETE FROM coverage_shifts').run();
  db.db.prepare('DELETE FROM custom_games').run();
  db.db.prepare('DELETE FROM coverage_ping_messages').run();
  db.db.prepare('DELETE FROM meeting_reminders_sent').run();
}

/**
 * Seed a ping record and return a set of spy arrays + the fake Discord objects
 * needed to call handleReactionChange.
 *
 * @param {object} opts
 * @param {string} opts.pingMsgId
 * @param {string} opts.originalMsgId
 * @param {string} opts.show
 * @param {string} opts.emojiName     Emoji the test user reacts with
 * @param {boolean} [opts.alreadyRedirected=false]
 * @param {boolean} [opts.dmFails=false]
 */
function makeSetup(opts) {
  const {
    pingMsgId      = 'ping-msg-1',
    originalMsgId  = 'orig-msg-1',
    show           = 'GGB',
    emojiName      = '✅',
    alreadyRedirected = false,
    dmFails        = false,
  } = opts;

  // Seed ping record
  repo.savePingMessage(pingMsgId, originalMsgId, 'ch-1', show, '2026-06-15', '19:00');
  if (alreadyRedirected) repo.markPingRedirected(pingMsgId);

  const removed = [];
  const edited  = [];
  const dms     = [];

  const fakeMessage = {
    id:      pingMsgId,
    partial: false,
    content: `<@U1> <@U2> Reminder: coverage still needed for Mon Jun 15 at 7:00pm — react ✅ if you're available: https://discord.com/channels/guild-1/ch-1/${originalMsgId}`,
    guild:   { id: 'guild-1' },
    edit:    async (newContent) => { edited.push(newContent); },
  };

  const fakeReaction = {
    partial: false,
    emoji:   { name: emojiName },
    message: fakeMessage,
    users:   {
      remove: async (uid) => { removed.push(uid); },
      fetch:  async () => new Map([['user-1', { id: 'user-1', bot: false }]]),
    },
  };

  const fakeUser = { id: 'user-1', bot: false };

  const fakeClient = {
    users: {
      fetch: async (id) => ({
        id,
        send: async (text) => {
          if (dmFails) throw new Error('Cannot DM this user');
          dms.push({ userId: id, text });
        },
      }),
    },
  };

  return { fakeClient, fakeReaction, fakeUser, removed, edited, dms };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('ping redirect — first mis-react: removes reaction, DMs user, edits message', async () => {
  cleanDb();
  const { fakeClient, fakeReaction, fakeUser, removed, edited, dms } = makeSetup({});

  await handleReactionChange(fakeClient, fakeReaction, fakeUser);

  assert.equal(removed.length, 1,  'reaction should be removed');
  assert.equal(removed[0], 'user-1');

  assert.equal(dms.length, 1, 'DM should be sent');
  assert.ok(dms[0].text.includes('Great Gold Bird'), 'DM should include show label');
  assert.ok(dms[0].text.includes('http'),            'DM should include a link');

  assert.equal(edited.length, 1, 'ping message should be edited once');
  assert.ok(edited[0].includes('React ASAP'),        'edit should contain new call-to-action');
  assert.ok(edited[0].includes('original message'),  'edit should mention original message');
  assert.ok(!edited[0].includes('react ✅'),          'edit should not contain old call-to-action');

  // DB flag should be set
  assert.equal(repo.getPingByMessageId('ping-msg-1').redirected, 1, 'redirected flag should be set');
});

test('ping redirect — second mis-react on already-redirected ping: removes + DMs, does NOT re-edit', async () => {
  cleanDb();
  const { fakeClient, fakeReaction, fakeUser, removed, edited, dms } = makeSetup({ alreadyRedirected: true });

  await handleReactionChange(fakeClient, fakeReaction, fakeUser);

  assert.equal(removed.length, 1, 'reaction should still be removed');
  assert.equal(dms.length,    1, 'DM should still be sent');
  assert.equal(edited.length, 0, 'message should NOT be re-edited');
});

test('ping redirect — non-coverage emoji: no action taken', async () => {
  cleanDb();
  const { fakeClient, fakeReaction, fakeUser, removed, edited, dms } = makeSetup({ emojiName: '🎉' });

  // '🎉' is not in ALL_RSVP_EMOJI_NAMES, so handleReactionChange returns early
  await handleReactionChange(fakeClient, fakeReaction, fakeUser);

  assert.equal(removed.length, 0, 'reaction should not be removed for irrelevant emoji');
  assert.equal(dms.length,    0, 'no DM for irrelevant emoji');
  assert.equal(edited.length, 0, 'message should not be edited for irrelevant emoji');
});

test('ping redirect — DM failure is non-blocking: reaction removed and message still edited', async () => {
  cleanDb();
  const { fakeClient, fakeReaction, fakeUser, removed, edited, dms } = makeSetup({ dmFails: true });

  await assert.doesNotReject(() => handleReactionChange(fakeClient, fakeReaction, fakeUser));

  assert.equal(removed.length, 1, 'reaction should still be removed even when DM fails');
  assert.equal(dms.length,    0, 'DM should not appear in spy (it threw)');
  assert.equal(edited.length, 1, 'message should still be edited even when DM fails');
});
