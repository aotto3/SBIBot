'use strict';

/**
 * Unit tests for the job-failure notifier (lib/job-notifier.js).
 *
 * Run with: node --test --test-force-exit test/job-notifier.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

const { buildJobOutcomeNotice, runJob, notifyJobOutcome } = require('../lib/job-notifier');

// ─── buildJobOutcomeNotice — hard failure ─────────────────────────────────────

test('buildJobOutcomeNotice — hard failure names the job and the error reason', () => {
  const msg = buildJobOutcomeNotice({
    label: 'Coverage role pings',
    error: new Error('Request with opcode 8 was rate limited'),
  });

  assert.match(msg, /Coverage role pings/, 'notice should name the job');
  assert.match(msg, /opcode 8 was rate limited/, 'notice should include the error reason');
  assert.match(msg, /fail/i, 'notice should read as a failure');
});

// ─── runJob ───────────────────────────────────────────────────────────────────

test('runJob — a thrown job triggers notify with the label + error and does not rethrow', async () => {
  const boom  = new Error('kaboom');
  const calls = [];
  const notify = async (outcome) => { calls.push(outcome); };

  // Must not throw — a failing job must not abort sibling jobs in the same cron block.
  await runJob('Coverage role pings', async () => { throw boom; }, notify);

  assert.equal(calls.length, 1, 'notify should be called exactly once on failure');
  assert.equal(calls[0].label, 'Coverage role pings');
  assert.equal(calls[0].error, boom, 'the original error should be passed through');
});

test('runJob — a successful job does not notify and returns its result', async () => {
  const calls = [];
  const notify = async (outcome) => { calls.push(outcome); };

  const result = await runJob('Coverage role pings', async () => 'done', notify);

  assert.equal(calls.length, 0, 'notify should not be called on success');
  assert.equal(result, 'done', 'the job result should be returned');
});

// ─── notifyJobOutcome (dispatcher) ────────────────────────────────────────────

test('notifyJobOutcome — DMs the ops contact and posts to the error channel', async () => {
  const dms = [];
  const channelSends = [];
  const errCh = { id: 'err-ch' };
  const discord = {
    sendDM:       async (userId, content) => dms.push({ userId, content }),
    fetchChannel: async (id) => (id === 'err-ch' ? errCh : null),
    sendMessage:  async (ch, content) => channelSends.push({ ch, content }),
  };

  await notifyJobOutcome(
    discord,
    { label: 'Meeting reminders', error: new Error('boom') },
    { opsContactId: 'owner-1', errorChannelId: 'err-ch' },
  );

  assert.equal(dms.length, 1, 'one DM to the ops contact');
  assert.equal(dms[0].userId, 'owner-1');
  assert.match(dms[0].content, /Meeting reminders/);
  assert.equal(channelSends.length, 1, 'one post to the error channel');
  assert.equal(channelSends[0].ch, errCh);
  assert.match(channelSends[0].content, /Meeting reminders/);
});

test('notifyJobOutcome — with no error channel configured, only the DM is sent', async () => {
  const dms = [];
  const discord = {
    sendDM:       async (userId, content) => dms.push({ userId, content }),
    fetchChannel: async () => { throw new Error('fetchChannel must not be called'); },
    sendMessage:  async () => { throw new Error('sendMessage must not be called'); },
  };

  await notifyJobOutcome(
    discord,
    { label: 'X', error: new Error('e') },
    { opsContactId: 'owner-1', errorChannelId: null },
  );

  assert.equal(dms.length, 1, 'the DM should still be sent with no error channel');
});

test('notifyJobOutcome — a DM failure still lets the error-channel post go out', async () => {
  const channelSends = [];
  const errCh = { id: 'err-ch' };
  const discord = {
    sendDM:       async () => { throw new Error('DMs closed'); },
    fetchChannel: async () => errCh,
    sendMessage:  async (ch, content) => channelSends.push({ ch, content }),
  };

  await notifyJobOutcome(
    discord,
    { label: 'X', error: new Error('e') },
    { opsContactId: 'owner-1', errorChannelId: 'err-ch' },
  );

  assert.equal(channelSends.length, 1, 'error-channel post should happen despite the DM failure');
});

// ─── runJob + notifyJobOutcome composed (what scheduler wires) ─────────────────

test('runJob + notifyJobOutcome — a failing job produces a DM and an error-channel post', async () => {
  const dms = [];
  const channelSends = [];
  const errCh = { id: 'err-ch' };
  const discord = {
    sendDM:       async (userId, content) => dms.push({ userId, content }),
    fetchChannel: async () => errCh,
    sendMessage:  async (ch, content) => channelSends.push({ ch, content }),
  };
  const notify = (outcome) =>
    notifyJobOutcome(discord, outcome, { opsContactId: 'owner-1', errorChannelId: 'err-ch' });

  await runJob('Coverage role pings', async () => { throw new Error('opcode 8 rate limited'); }, notify);

  assert.equal(dms.length, 1, 'ops contact DMed');
  assert.match(dms[0].content, /Coverage role pings/);
  assert.match(dms[0].content, /opcode 8 rate limited/);
  assert.equal(channelSends.length, 1, 'error channel posted');
});
